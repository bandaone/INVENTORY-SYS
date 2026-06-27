export const dynamic = "force-dynamic";
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { fetchTenantQuery } from '@/lib/db';
import { normalizeSearchText, normalizeText } from '@/lib/smart-import';

type CatalogCaps = {
  subtype: boolean;
  review: boolean;
};

function parseJsonObject(value: unknown) {
  if (!value) return {};
  if (typeof value === 'object') return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function parseMissingFields(value: unknown) {
  if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean);
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.map((entry) => String(entry).trim()).filter(Boolean) : [];
  } catch {
    return String(value)
      .replace(/^\[/, '')
      .replace(/\]$/, '')
      .split(',')
      .map((entry) => entry.trim().replace(/^"|"$/g, ''))
      .filter(Boolean);
  }
}

function buildSearchText(parts: Array<unknown>) {
  return parts
    .flatMap((part) => {
      if (part === null || part === undefined) return [];
      if (typeof part === 'object') return [JSON.stringify(part)];
      return String(part).split(/\s+/g);
    })
    .map((part) => normalizeSearchText(part))
    .filter(Boolean)
    .join(' ')
    .trim();
}

async function loadCaps(tenantId: string): Promise<CatalogCaps> {
  const columns = await fetchTenantQuery(
    tenantId,
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'variants'
        AND column_name IN ('subtype', 'missing_fields', 'detail_status')
    `
  );

  const columnNames = new Set(columns.map((row: any) => row.column_name));
  return {
    subtype: columnNames.has('subtype'),
    review: columnNames.has('missing_fields') && columnNames.has('detail_status'),
  };
}

function pickRequiredFields(value: {
  name: string | null;
  category: string | null;
  subtype: string | null;
  color: string | null;
  size: string | null;
  barcode_token: string | null;
  retail_price: number | null;
}) {
  return [
    !value.name && 'name',
    !value.category && 'category',
    !value.subtype && 'subtype',
    !value.color && 'color',
    !value.size && 'size',
    !value.barcode_token && 'code',
    (value.retail_price === null || !Number.isFinite(Number(value.retail_price))) && 'retail_price',
  ].filter(Boolean) as string[];
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const tenantId = cookies().get('tenant_id')?.value;
    if (!tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = params;
    if (!id) {
      return NextResponse.json({ error: 'Missing catalog item id' }, { status: 400 });
    }

    const body = await req.json();
    const caps = await loadCaps(tenantId);

    const existingRows = (await fetchTenantQuery(
      tenantId,
      `
        SELECT
          id,
          name,
          category,
          ${caps.subtype ? 'subtype' : 'NULL::varchar AS subtype'},
          color,
          size,
          cost_price,
          retail_price,
          discount_percent,
          barcode_token,
          barcode_payload,
          metadata,
          ${caps.review ? 'missing_fields, detail_status,' : ''}
          search_text
        FROM variants
        WHERE id = $1
        LIMIT 1
      `,
      [id]
    )) as Array<Record<string, any>>;

    const existing = existingRows[0];
    if (!existing) {
      return NextResponse.json({ error: 'Catalog item not found' }, { status: 404 });
    }

    const nextName = normalizeText(body.name ?? existing.name);
    const nextCategory = body.category === undefined ? existing.category : normalizeText(body.category) || null;
    const nextSubtype = body.subtype === undefined ? existing.subtype : normalizeText(body.subtype) || null;
    const nextColor = body.color === undefined ? existing.color : normalizeText(body.color) || null;
    const nextSize = body.size === undefined ? existing.size : normalizeText(body.size) || null;
    const nextBarcodeToken = body.barcode_token === undefined ? existing.barcode_token : normalizeText(body.barcode_token) || null;
    const nextRetailPrice = body.retail_price === undefined ? Number(existing.retail_price) : Number(body.retail_price);
    const nextCostPrice = body.cost_price === undefined
      ? Number(existing.cost_price ?? nextRetailPrice)
      : Number(body.cost_price);
    const nextDiscountPercent = body.discount_percent === undefined
      ? Number(existing.discount_percent ?? 0)
      : Math.max(0, Math.min(100, Number(body.discount_percent) || 0));

    if (!nextName.trim()) {
      return NextResponse.json({ error: 'Product name is required' }, { status: 400 });
    }
    if (!Number.isFinite(nextRetailPrice) || nextRetailPrice < 0) {
      return NextResponse.json({ error: 'Retail price must be a valid number' }, { status: 400 });
    }

    const metadata = {
      ...parseJsonObject(existing.metadata),
      ...parseJsonObject(body.metadata),
    };
    const description = body.description === undefined
      ? String((metadata as Record<string, unknown>).description ?? '').trim()
      : normalizeText(body.description);
    if (description) {
      metadata.description = description;
    } else {
      delete metadata.description;
    }

    const nextBarcodePayload = {
      ...parseJsonObject(existing.barcode_payload),
      serial: nextBarcodeToken || existing.barcode_token || id,
      code: nextBarcodeToken || existing.barcode_token || id,
      name: nextName || existing.name,
      category: nextCategory,
      subtype: nextSubtype,
      color: nextColor,
      size: nextSize,
      description: description || null,
      price: Number.isFinite(nextRetailPrice) ? nextRetailPrice : Number(existing.retail_price),
      metadata,
    };

    const nextMissingFields = parseMissingFields(body.missing_fields?.length ? body.missing_fields : null);
    const computedMissingFields = nextMissingFields.length
      ? nextMissingFields
      : pickRequiredFields({
          name: nextName || null,
          category: nextCategory,
          subtype: nextSubtype,
          color: nextColor,
          size: nextSize,
          barcode_token: nextBarcodeToken,
          retail_price: Number.isFinite(nextRetailPrice) ? nextRetailPrice : null,
        });
    const nextDetailStatus = body.detail_status || (computedMissingFields.length > 0 ? 'needs_review' : 'complete');
    const nextSearchText = buildSearchText([
      nextName,
      nextCategory,
      nextSubtype,
      nextColor,
      nextSize,
      nextBarcodeToken,
      nextRetailPrice,
      description,
      metadata,
    ]);

    const updates: string[] = [];
    const queryParams: unknown[] = [id];
    const push = (sql: string, value: unknown) => {
      queryParams.push(value);
      updates.push(`${sql} = $${queryParams.length}`);
    };

    push('name', nextName);
    push('category', nextCategory);
    if (caps.subtype) push('subtype', nextSubtype);
    push('color', nextColor);
    push('size', nextSize);
    push('cost_price', Number.isFinite(nextCostPrice) ? nextCostPrice : null);
    push('retail_price', Number.isFinite(nextRetailPrice) ? nextRetailPrice : null);
    push('discount_percent', Number.isFinite(nextDiscountPercent) ? nextDiscountPercent : 0);
    push('barcode_token', nextBarcodeToken);
    push('barcode_payload', JSON.stringify(nextBarcodePayload));
    push('metadata', JSON.stringify(metadata));
    if (caps.review) {
      push('missing_fields', JSON.stringify(computedMissingFields));
      push('detail_status', nextDetailStatus);
    }
    push('search_text', nextSearchText);

    const updatedRows = await fetchTenantQuery(
      tenantId,
      `
        UPDATE variants
        SET ${updates.join(', ')},
            updated_at = NOW()
        WHERE id = $1
        RETURNING
          id,
          name,
          category,
          ${caps.subtype ? 'subtype' : 'NULL::varchar AS subtype'},
          color,
          size,
          cost_price,
          retail_price,
          discount_percent,
          barcode_token,
          barcode_payload,
          metadata,
          ${caps.review ? 'missing_fields, detail_status,' : ''}
          search_text
      `,
      queryParams
    );

    const variant = updatedRows[0];
    if (!variant) {
      return NextResponse.json({ error: 'Failed to update catalog item' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      variant: caps.review
        ? variant
        : {
            ...variant,
            missing_fields: computedMissingFields,
            detail_status: nextDetailStatus,
          },
    });
  } catch (err) {
    console.error('[Catalog PATCH]', err);
    return NextResponse.json({ error: 'Failed to update catalog item' }, { status: 500 });
  }
}
