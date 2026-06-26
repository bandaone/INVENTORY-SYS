import { fetchTenantQuery } from '@/lib/db';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET(req: Request) {
  try {
    const cookieStore = cookies();
    const tenantId = cookieStore.get('tenant_id')?.value;
    if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const query = searchParams.get('q')?.trim() || '';
    const locationId = searchParams.get('location_id')?.trim() || '';

    const rows = await fetchTenantQuery(tenantId, `
      WITH search AS (
        SELECT LOWER($1::text) AS q, $1::text AS raw_q, NULLIF($2::text, '') AS location_id
      )
      SELECT
        g.variant_id AS id,
        g.serial,
        g.variant_id,
        g.location_id,
        g.retail_price,
        g.cost_price,
        g.barcode_token,
        g.barcode_payload,
        g.metadata AS garment_metadata,
        g.missing_fields AS garment_missing_fields,
        g.detail_status AS garment_detail_status,
        g.search_text AS garment_search_text,
        g.source_code,
        v.name,
        v.category,
        v.subtype,
        v.color,
        v.size,
        v.discount_percent,
        v.metadata AS variant_metadata,
        v.missing_fields AS variant_missing_fields,
        v.detail_status AS variant_detail_status,
        v.search_text AS variant_search_text,
        COUNT(*) OVER (PARTITION BY g.variant_id, g.location_id) AS available_count,
        LOWER(
          CONCAT_WS(
            ' ',
            v.name,
            COALESCE(v.category, ''),
            COALESCE(v.subtype, ''),
            COALESCE(v.color, ''),
            COALESCE(v.size, ''),
            COALESCE(g.serial, ''),
            COALESCE(g.source_code, ''),
            COALESCE(g.barcode_token, ''),
            COALESCE(g.search_text, ''),
            COALESCE(v.search_text, ''),
            g.retail_price::text
          )
        ) AS search_blob
      FROM garments g
      JOIN variants v ON g.variant_id = v.id
      CROSS JOIN search
      WHERE g.status = 'in_stock'
        AND (search.location_id IS NULL OR g.location_id = search.location_id::uuid)
        AND (
          search.raw_q = ''
          OR LOWER(
            CONCAT_WS(
              ' ',
              v.name,
              COALESCE(v.category, ''),
              COALESCE(v.subtype, ''),
              COALESCE(v.color, ''),
              COALESCE(v.size, ''),
              COALESCE(g.serial, ''),
              COALESCE(g.source_code, ''),
              COALESCE(g.barcode_token, ''),
              COALESCE(g.search_text, ''),
              COALESCE(v.search_text, ''),
              g.retail_price::text
            )
          ) LIKE '%' || search.q || '%'
        )
      ORDER BY
        CASE WHEN LOWER(g.serial) = search.raw_q THEN 0 ELSE 1 END,
        v.category ASC NULLS LAST,
        v.subtype ASC NULLS LAST,
        v.name ASC,
        v.color ASC NULLS LAST,
        v.size ASC NULLS LAST,
        g.serial ASC
    `, [query, locationId]);

    return NextResponse.json(rows.map((row: any) => ({
      ...row,
      display_name: [row.category, row.subtype, row.name].filter(Boolean).join(' / '),
      display_variant: [row.name, row.size, row.color].filter(Boolean).join(' · '),
      barcode: row.barcode_token || row.serial,
    })));
  } catch (error) {
    console.error("API Error:", error);
    return NextResponse.json({ error: "Failed to fetch catalog" }, { status: 500 });
  }
}
