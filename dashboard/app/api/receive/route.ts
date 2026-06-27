export const dynamic = "force-dynamic";
import crypto from 'crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import type { PoolClient } from 'pg';
import { pool } from '@/lib/db';
import { normalizeSearchText, normalizeText, type ColumnMap, type ParsedSheetRow } from '@/lib/smart-import';

type ReceiveItem = {
  variant_id: string;
  quantity: number;
};

type VariantRow = {
  id: string;
  name: string;
  category: string | null;
  subtype: string | null;
  color: string | null;
  size: string | null;
  cost_price: string | number;
  retail_price: string | number;
  discount_percent?: string | number;
  metadata?: Record<string, unknown> | null;
  missing_fields?: string[] | null;
  detail_status?: 'complete' | 'needs_review' | null;
  search_text?: string | null;
  barcode_token?: string | null;
  barcode_payload?: Record<string, unknown> | null;
};

type NewVariantInput = {
  name: string;
  category?: string | null;
  subtype?: string | null;
  color?: string | null;
  size?: string | null;
  retail_price: number;
  cost_price?: number | null;
  metadata?: Record<string, unknown>;
  missing_fields?: string[];
  detail_status?: 'complete' | 'needs_review';
};

type SheetImportPayload = {
  rows: ParsedSheetRow[];
  headers: string[];
  mapping: ColumnMap;
  source_signature: string;
  source_name?: string;
  profile_name?: string;
};

type ReceiveSchemaCaps = {
  variantReviewColumns: boolean;
  garmentReviewColumns: boolean;
  variantSubtypeColumn: boolean;
};

class ReceiveHttpError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function generateShortSerial(prefix: string) {
  const shortPrefix = prefix.substring(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, 'X').padEnd(3, 'X');
  const hex = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `${shortPrefix}-${hex.substring(0, 4)}-${hex.substring(4, 8)}`;
}

function safeJson(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function isMissingColumnError(err: unknown) {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === '42703';
}

function attachReviewMetadata(metadata: Record<string, unknown>, missingFields: string[] | null | undefined, detailStatus: string | null | undefined) {
  return {
    ...metadata,
    review_missing_fields: missingFields || [],
    review_detail_status: detailStatus || 'complete',
  };
}

async function loadReceiveSchemaCaps(client: PoolClient): Promise<ReceiveSchemaCaps> {
  const result = await client.query<{ table_name: string; column_name: string }>(
    `
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('variants', 'garments')
        AND column_name IN ('missing_fields', 'detail_status')
    `
  );

  const variantColumns = new Set(
    result.rows.filter((row) => row.table_name === 'variants').map((row) => row.column_name)
  );
  const garmentColumns = new Set(
    result.rows.filter((row) => row.table_name === 'garments').map((row) => row.column_name)
  );

  return {
    variantReviewColumns: variantColumns.has('missing_fields') && variantColumns.has('detail_status'),
    garmentReviewColumns: garmentColumns.has('missing_fields') && garmentColumns.has('detail_status'),
    variantSubtypeColumn: variantColumns.has('subtype'),
  };
}

function variantSelectSql(caps: ReceiveSchemaCaps, reviewColumns = true) {
  const subtypeColumn = caps.variantSubtypeColumn ? 'subtype' : 'NULL::varchar AS subtype';
  const reviewSelect = reviewColumns && caps.variantReviewColumns
    ? 'missing_fields, detail_status,'
    : '';
  return `
    SELECT id, name, category, ${subtypeColumn}, color, size, cost_price, retail_price, discount_percent, metadata, ${reviewSelect} search_text, barcode_token, barcode_payload
    FROM variants
  `;
}

function variantWhereSubtypeClause(caps: ReceiveSchemaCaps) {
  return caps.variantSubtypeColumn
    ? `AND COALESCE(LOWER(subtype), '') = COALESCE(LOWER($4), '')`
    : '';
}

function variantWhereParams(caps: ReceiveSchemaCaps) {
  return caps.variantSubtypeColumn ? 6 : 5;
}

function buildSearchText(parts: Array<unknown>) {
  return parts
    .flatMap(part => String(part ?? '').split(/\s+/g))
    .map(part => normalizeSearchText(part))
    .filter(Boolean)
    .join(' ')
    .trim();
}

function buildLabelPayload(input: {
  serial: string;
  code: string | null;
  name: string;
  category: string | null;
  subtype: string | null;
  color: string | null;
  size: string | null;
  retail_price: number;
  description?: string | null;
}) {
  return JSON.stringify({
    serial: input.serial,
    code: input.code || input.serial,
    name: input.name,
    category: input.category,
    subtype: input.subtype,
    color: input.color,
    size: input.size,
    description: input.description || null,
    price: input.retail_price,
  });
}

async function withTenantClient<T>(tenantId: string, work: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant = '${tenantId}'`);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function normalizeIncomingItems(body: any): ReceiveItem[] | null {
  if (Array.isArray(body?.items) && body.items.length > 0) {
    return body.items
      .map((item: any) => ({
        variant_id: String(item?.variant_id || '').trim(),
        quantity: Number(item?.quantity),
      }))
      .filter((item: ReceiveItem) => item.variant_id && Number.isInteger(item.quantity) && item.quantity > 0);
  }

  if (body?.new_variant) {
    const quantity = Number(body.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) return null;
    return [{ variant_id: '', quantity }];
  }

  if (body?.variant_id) {
    const quantity = Number(body.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) return null;
    return [{ variant_id: String(body.variant_id).trim(), quantity }];
  }

  return null;
}

function toNumber(value: unknown) {
  const parsed = Number(String(value ?? '').replace(/[, ]+/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

async function resolveVariant(
  client: PoolClient,
  tenantId: string,
  item: ReceiveItem,
  newVariant: NewVariantInput | null,
  caps: ReceiveSchemaCaps
) {
  if (!newVariant) {
    const query = `
      SELECT id, name, category, ${caps.variantSubtypeColumn ? 'subtype' : 'NULL::varchar AS subtype'}, color, size, cost_price, retail_price, discount_percent, metadata, ${caps.variantReviewColumns ? 'missing_fields, detail_status,' : ''} search_text, barcode_token, barcode_payload
      FROM variants
      WHERE id = $1
    `;
    const rows = await client.query<VariantRow>(query, [item.variant_id]);
    const row = rows.rows[0] || null;
    return row && !caps.variantReviewColumns
      ? {
          ...row,
          missing_fields: [] as string[],
          detail_status: 'complete' as const,
        }
      : row;
  }

  const name = normalizeText(newVariant.name);
  const category = normalizeText(newVariant.category || null) || null;
  const subtype = normalizeText(newVariant.subtype || null) || null;
  const color = normalizeText(newVariant.color || null) || null;
  const size = normalizeText(newVariant.size || null) || null;
  const retailPrice = Number(newVariant.retail_price);
  const costPrice = Number.isFinite(Number(newVariant.cost_price)) ? Number(newVariant.cost_price) : retailPrice;

  if (!name) throw new ReceiveHttpError('Product name is required for a new item.', 400);
  if (!Number.isFinite(retailPrice) || retailPrice < 0) {
    throw new ReceiveHttpError('Retail price is required for a new item.', 400);
  }

  const existing = await client.query<VariantRow>(
    `
      SELECT id, name, category, ${caps.variantSubtypeColumn ? 'subtype' : 'NULL::varchar AS subtype'}, color, size, cost_price, retail_price, discount_percent, metadata, ${caps.variantReviewColumns ? 'missing_fields, detail_status,' : ''} search_text, barcode_token, barcode_payload
      FROM variants
      WHERE tenant_id = $1
        AND LOWER(name) = LOWER($2)
        AND COALESCE(LOWER(color), '') = COALESCE(LOWER($3), '')
        AND COALESCE(LOWER(size), '') = COALESCE(LOWER($4), '')
      LIMIT 1
    `,
    [tenantId, name, color, size]
  );

  const reviewMissingFields: string[] = newVariant.missing_fields || [];
  const reviewDetailStatus: 'complete' | 'needs_review' = newVariant.detail_status || 'complete';
  const nextMetadata = attachReviewMetadata(safeJson(newVariant.metadata || {}), reviewMissingFields, reviewDetailStatus);
  const nextSearchText = buildSearchText([name, category, subtype, color, size, JSON.stringify(nextMetadata)]);

  if (existing.rows[0]) {
    const row = existing.rows[0];
    const mergedMetadata = {
      ...(row.metadata || {}),
      ...nextMetadata,
    };
    if (caps.variantReviewColumns) {
      const updated = await client.query<VariantRow>(
        `
          UPDATE variants
          SET cost_price = $2,
              retail_price = $3,
              metadata = $4,
              missing_fields = COALESCE($5, missing_fields),
              detail_status = COALESCE($6, detail_status),
              search_text = $7,
              updated_at = NOW()
          WHERE id = $1
          RETURNING id, name, category, ${caps.variantSubtypeColumn ? 'subtype' : 'NULL::varchar AS subtype'}, color, size, cost_price, retail_price, discount_percent, metadata, missing_fields, detail_status, search_text, barcode_token, barcode_payload
        `,
        [
          row.id,
          costPrice,
          retailPrice,
          JSON.stringify(mergedMetadata),
          reviewMissingFields.length ? JSON.stringify(reviewMissingFields) : null,
          reviewDetailStatus || null,
          nextSearchText,
        ]
      );
      return updated.rows[0] || row;
    }
    const updated = await client.query<VariantRow>(
      `
        UPDATE variants
        SET cost_price = $2,
            retail_price = $3,
            metadata = $4,
            search_text = $5,
            updated_at = NOW()
        WHERE id = $1
        RETURNING id, name, category, ${caps.variantSubtypeColumn ? 'subtype' : 'NULL::varchar AS subtype'}, color, size, cost_price, retail_price, discount_percent, metadata, search_text, barcode_token, barcode_payload
      `,
      [
        row.id,
        costPrice,
        retailPrice,
        JSON.stringify(mergedMetadata),
        nextSearchText,
      ]
    );
    return updated.rows[0]
      ? {
          ...updated.rows[0],
          missing_fields: reviewMissingFields,
          detail_status: reviewDetailStatus,
        }
      : row;
  }

  if (caps.variantReviewColumns) {
    const created = await client.query<VariantRow>(
      caps.variantSubtypeColumn
        ? `
            INSERT INTO variants (
              tenant_id,
              name,
              category,
              subtype,
              color,
              size,
              cost_price,
              retail_price,
              metadata,
              missing_fields,
              detail_status,
              search_text
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING id, name, category, subtype, color, size, cost_price, retail_price, discount_percent, metadata, missing_fields, detail_status, search_text, barcode_token, barcode_payload
          `
        : `
            INSERT INTO variants (
              tenant_id,
              name,
              category,
              color,
              size,
              cost_price,
              retail_price,
              metadata,
              missing_fields,
              detail_status,
              search_text
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING id, name, category, NULL::varchar AS subtype, color, size, cost_price, retail_price, discount_percent, metadata, missing_fields, detail_status, search_text, barcode_token, barcode_payload
          `,
      caps.variantSubtypeColumn
        ? [
            tenantId,
            name,
            category,
            subtype,
            color,
            size,
            costPrice,
            retailPrice,
            JSON.stringify(nextMetadata),
            JSON.stringify(reviewMissingFields),
            reviewDetailStatus,
            nextSearchText,
          ]
        : [
            tenantId,
            name,
            category,
            color,
            size,
            costPrice,
            retailPrice,
            JSON.stringify(nextMetadata),
            JSON.stringify(reviewMissingFields),
            reviewDetailStatus,
            nextSearchText,
          ]
    );

    return created.rows[0] || null;
  }

  const created = await client.query<VariantRow>(
    caps.variantSubtypeColumn
      ? `
          INSERT INTO variants (
            tenant_id,
            name,
            category,
            subtype,
            color,
            size,
            cost_price,
            retail_price,
            metadata,
            search_text
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING id, name, category, subtype, color, size, cost_price, retail_price, discount_percent, metadata, search_text, barcode_token, barcode_payload
        `
      : `
          INSERT INTO variants (
            tenant_id,
            name,
            category,
            color,
            size,
            cost_price,
            retail_price,
            metadata,
            search_text
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING id, name, category, NULL::varchar AS subtype, color, size, cost_price, retail_price, discount_percent, metadata, search_text, barcode_token, barcode_payload
        `,
    caps.variantSubtypeColumn
      ? [
          tenantId,
          name,
          category,
          subtype,
          color,
          size,
          costPrice,
          retailPrice,
          JSON.stringify(nextMetadata),
          nextSearchText,
        ]
      : [
          tenantId,
          name,
          category,
          color,
          size,
          costPrice,
          retailPrice,
          JSON.stringify(nextMetadata),
          nextSearchText,
        ]
  );

  return created.rows[0]
    ? {
        ...created.rows[0],
        missing_fields: reviewMissingFields,
        detail_status: reviewDetailStatus,
      }
    : null;
}

async function saveImportProfile(
  client: PoolClient,
  tenantId: string,
  payload: SheetImportPayload,
  profileName?: string | null
) {
  if (!payload.source_signature) return;

  await client.query(
    `
      INSERT INTO import_profiles (tenant_id, source_signature, profile_name, mapping, sample_headers)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (tenant_id, source_signature)
      DO UPDATE SET
        profile_name = EXCLUDED.profile_name,
        mapping = EXCLUDED.mapping,
        sample_headers = EXCLUDED.sample_headers,
        updated_at = NOW()
    `,
    [
      tenantId,
      payload.source_signature,
      profileName || payload.source_name || null,
      JSON.stringify(payload.mapping || {}),
      JSON.stringify(payload.headers || []),
    ]
  );
}

async function createGarmentsForRows(
  client: PoolClient,
  tenantId: string,
  locationId: string,
  staffId: string,
  caps: ReceiveSchemaCaps,
  rows: Array<{
    variant: VariantRow;
    item: ParsedSheetRow;
    quantity: number;
  }>,
  sourceLabel: string
) {
  const labels: Array<Record<string, unknown>> = [];
  const auditItems: Array<Record<string, unknown>> = [];
  let totalQuantity = 0;
  let totalValue = 0;

  for (const entry of rows) {
    const { variant, item } = entry;
    const quantity = Math.max(entry.quantity, 1);
    totalQuantity += quantity;
    totalValue += Number(variant.retail_price || 0) * quantity;

    auditItems.push({
      variant_id: variant.id,
      quantity,
      product: item.productName || variant.name,
      category: item.category || variant.category,
      subtype: item.subtype || variant.subtype,
      color: item.color || variant.color,
      size: item.size || variant.size,
      code: item.code || null,
      missing_fields: item.missingFields,
      detail_status: item.detailStatus,
    });

    for (let index = 0; index < quantity; index += 1) {
      const serial = generateShortSerial(variant.name);
      const labelPayload = buildLabelPayload({
        serial,
        code: item.code || null,
        name: variant.name,
        category: variant.category,
        subtype: variant.subtype,
        color: variant.color,
        size: variant.size,
        retail_price: Number(variant.retail_price),
        description: item.description || null,
      });
      const barcodeSearchText = buildSearchText([
        variant.name,
        variant.category,
        variant.subtype,
        variant.color,
        variant.size,
        item.productName,
        item.description,
        item.color,
        item.size,
        item.code,
        item.familyLabel,
        item.extraFields,
      ]);
      const garmentMetadata = JSON.stringify(attachReviewMetadata({
        source_label: sourceLabel,
        source_code: item.code || null,
        family_key: item.familyKey,
        family_label: item.familyLabel,
        extra_fields: item.extraFields,
        source_row: item.rowNumber,
      }, item.missingFields, item.detailStatus));

      if (caps.garmentReviewColumns) {
        await client.query(
          `
            INSERT INTO garments (
              serial,
              tenant_id,
              variant_id,
              location_id,
              status,
              cost_price,
              retail_price,
              barcode_token,
              barcode_payload,
              metadata,
              missing_fields,
              detail_status,
              search_text,
              source_code
            )
            VALUES ($1, $2, $3, $4, 'in_stock', $5, $6, $7, $8, $9, $10, $11, $12, $13)
          `,
          [
            serial,
            tenantId,
            variant.id,
            locationId,
            variant.cost_price,
            variant.retail_price,
            serial,
            labelPayload,
            garmentMetadata,
            JSON.stringify(item.missingFields || []),
            item.detailStatus,
            barcodeSearchText,
            item.code || null,
          ]
        );
      } else {
        await client.query(
          `
            INSERT INTO garments (
              serial,
              tenant_id,
              variant_id,
              location_id,
              status,
              cost_price,
              retail_price,
              barcode_token,
              barcode_payload,
              metadata,
              search_text,
              source_code
            )
            VALUES ($1, $2, $3, $4, 'in_stock', $5, $6, $7, $8, $9, $10, $11)
          `,
          [
            serial,
            tenantId,
            variant.id,
            locationId,
            variant.cost_price,
            variant.retail_price,
            serial,
            labelPayload,
            garmentMetadata,
            barcodeSearchText,
            item.code || null,
          ]
        );
      }

      await client.query(
        `
          INSERT INTO stock_movements (
            tenant_id,
            garment_serial,
            movement_type,
            from_location_id,
            to_location_id,
            from_status,
            to_status,
            actor_id,
            device_id,
            sequence_number,
            transaction_id,
            notes
          )
          VALUES ($1, $2, 'INGESTION', NULL, $3, NULL, 'in_stock', $4, NULL, NULL, NULL, $5)
        `,
        [
          tenantId,
          serial,
          locationId,
          staffId,
          `${sourceLabel} row ${item.rowNumber}`,
        ]
      );

      labels.push({
        serial,
        barcodeToken: serial,
        barcodePayload: labelPayload,
        name: variant.name,
        category: variant.category,
        subtype: variant.subtype,
        size: variant.size,
        color: variant.color,
        retail_price: Number(variant.retail_price),
      });
    }
  }

  return { labels, totalQuantity, totalValue, auditItems };
}

async function processSheetImport(
  client: PoolClient,
  tenantId: string,
  staffId: string,
  staffRole: string,
  locationId: string,
  payload: SheetImportPayload,
  caps: ReceiveSchemaCaps
) {
  if (!Array.isArray(payload.rows) || payload.rows.length === 0) {
    throw new ReceiveHttpError('The spreadsheet does not contain any ready rows.', 400);
  }

  const readyRows = payload.rows.filter((row) => row && Number.isInteger(row.quantity) && row.quantity > 0);
  if (!readyRows.length) {
    throw new ReceiveHttpError('No import rows are ready for receiving.', 400);
  }

  const variantWork: Array<{ variant: VariantRow; item: ParsedSheetRow; quantity: number }> = [];

  for (const row of readyRows) {
    const variant = await resolveVariant(client, tenantId, {
      variant_id: '',
      quantity: row.quantity,
    }, {
      name: row.productName || row.familyLabel,
      category: row.category || null,
      subtype: row.subtype || null,
      color: row.color || null,
      size: row.size || null,
      retail_price: row.retailPrice ?? row.costPrice ?? 0,
      cost_price: row.costPrice,
      metadata: {
        source_signature: payload.source_signature,
        source_name: payload.source_name || null,
        headers: payload.headers || [],
        extra_fields: row.extraFields,
      },
      missing_fields: row.missingFields,
      detail_status: row.detailStatus,
    }, caps);

    if (!variant) {
      throw new ReceiveHttpError(`Failed to resolve variant for row ${row.rowNumber}.`, 400);
    }

    variantWork.push({
      variant,
      item: row,
      quantity: row.quantity,
    });
  }

  const result = await createGarmentsForRows(client, tenantId, locationId, staffId, caps, variantWork, payload.source_name || 'Spreadsheet import');

  await saveImportProfile(client, tenantId, payload, payload.profile_name || payload.source_name || null);

  await client.query(
    `
      INSERT INTO audit_trail (tenant_id, action_type, actor_id, actor_role, resource_type, changes)
      VALUES ($1, 'STOCK_INGESTION', $2, $3, 'garments', $4)
    `,
    [
      tenantId,
      staffId,
      staffRole,
      JSON.stringify({
        count: result.totalQuantity,
        location_id: locationId,
        total_value: result.totalValue,
        source_signature: payload.source_signature,
        items: result.auditItems,
      }),
    ]
  );

  return {
    ...result,
    createdVariant: null,
  };
}

async function processLegacyOrQuickReceive(
  client: PoolClient,
  tenantId: string,
  staffId: string,
  staffRole: string,
  locationId: string,
  body: any,
  caps: ReceiveSchemaCaps
) {
  const incomingItems = normalizeIncomingItems(body);
  const newVariantInput = body?.new_variant
    ? {
        name: String(body.new_variant.name || '').trim(),
        category: body.new_variant.category === undefined ? null : String(body.new_variant.category || '').trim(),
        subtype: body.new_variant.subtype === undefined ? null : String(body.new_variant.subtype || '').trim(),
        color: body.new_variant.color === undefined ? null : String(body.new_variant.color || '').trim(),
        size: body.new_variant.size === undefined ? null : String(body.new_variant.size || '').trim(),
        retail_price: Number(body.new_variant.retail_price),
        cost_price: body.new_variant.cost_price === undefined ? null : Number(body.new_variant.cost_price),
        metadata: body.new_variant.metadata || {},
      }
    : null;

  if (!locationId || !incomingItems?.length) {
    throw new ReceiveHttpError('Invalid payload.', 400);
  }

  const totalQuantity = incomingItems.reduce((sum, item) => sum + item.quantity, 0);
  if (totalQuantity < 1) {
    throw new ReceiveHttpError('Quantity must be at least 1 unit.', 400);
  }

  const variantsById = new Map<string, VariantRow>();
  const rowsToReceive: Array<{ variant: VariantRow; quantity: number }> = [];

  for (const item of incomingItems) {
    const variant = await resolveVariant(client, tenantId, item, newVariantInput, caps);
    if (!variant) continue;
    variantsById.set(variant.id, variant);
    rowsToReceive.push({ variant, quantity: item.quantity });
  }

  const result = await createGarmentsForRows(
    client,
    tenantId,
    locationId,
    staffId,
    caps,
    rowsToReceive.map((entry, index) => ({
      variant: entry.variant,
      item: {
        rowNumber: index + 1,
        source: {},
        productName: entry.variant.name,
        category: entry.variant.category || '',
        subtype: entry.variant.subtype || '',
        description: '',
        color: entry.variant.color || '',
        size: entry.variant.size || '',
        code: '',
        quantity: entry.quantity,
        costPrice: Number(entry.variant.cost_price),
        retailPrice: Number(entry.variant.retail_price),
        extraFields: {},
        familyKey: `${entry.variant.name}:${entry.variant.category || ''}:${entry.variant.subtype || ''}:${entry.variant.color || ''}:${entry.variant.size || ''}`,
        familyLabel: [entry.variant.category, entry.variant.subtype, entry.variant.name].filter(Boolean).join(' / ') || entry.variant.name,
        missingFields: [],
        detailStatus: 'complete',
      } as ParsedSheetRow,
      quantity: entry.quantity,
    })),
    'Operations intake'
  );

  const totalValue = result.totalValue;
  const itemSummary = incomingItems.map(item => ({
    variant_id: item.variant_id || null,
    quantity: item.quantity,
    variant: variantsById.get(item.variant_id)?.name || newVariantInput?.name,
  }));

  await client.query(
    `
      INSERT INTO audit_trail (tenant_id, action_type, actor_id, actor_role, resource_type, changes)
      VALUES ($1, 'STOCK_INGESTION', $2, $3, 'garments', $4)
    `,
    [
      tenantId,
      staffId,
      staffRole,
      JSON.stringify({
        count: result.totalQuantity,
        location_id: locationId,
        total_value: totalValue,
        items: itemSummary,
      }),
    ]
  );

  return {
    labels: result.labels,
    totalQuantity: result.totalQuantity,
    createdVariant: newVariantInput ? rowsToReceive[0]?.variant || null : null,
  };
}

export async function POST(req: Request) {
  try {
    const tenantId = cookies().get('tenant_id')?.value;
    const staffId = cookies().get('staff_id')?.value;
    const staffRole = cookies().get('staff_role')?.value || 'stock_clerk';

    if (!tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!staffId) return NextResponse.json({ error: 'Operations session required.' }, { status: 401 });

    const body = await req.json();
    const locationId = String(body?.location_id || '').trim();

    const result = await withTenantClient(tenantId, async (client) => {
      const caps = await loadReceiveSchemaCaps(client);
      if (body?.sheet_import) {
        return await processSheetImport(
          client,
          tenantId,
          staffId,
          staffRole,
          locationId,
          body.sheet_import as SheetImportPayload,
          caps
        );
      }

      return await processLegacyOrQuickReceive(client, tenantId, staffId, staffRole, locationId, body, caps);
    });

    return NextResponse.json({
      success: true,
      labels: result.labels,
      received: result.totalQuantity,
      variant: result.createdVariant || null,
    });
  } catch (err) {
    if (err instanceof ReceiveHttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[Receive POST]', err);
    return NextResponse.json({ error: 'Failed to receive stock.' }, { status: 500 });
  }
}
