export const dynamic = 'force-dynamic'

import { fetchTenantQuery } from '@/lib/db'
import { requireTenantSession, SessionError } from '@/lib/session'
import { NextResponse } from 'next/server'

const POS_ROLES = ['owner', 'store_manager', 'cashier'] as const

export async function GET(req: Request) {
  try {
    const session = await requireTenantSession(POS_ROLES)
    const { searchParams } = new URL(req.url)
    const query = searchParams.get('q')?.trim() || ''
    const requestedLocationId = searchParams.get('location_id')?.trim() || ''

    let locationId = requestedLocationId
    if (session.role !== 'owner') {
      if (!session.locationId) {
        return NextResponse.json({ error: 'No store is assigned to this staff member' }, { status: 403 })
      }
      if (requestedLocationId && requestedLocationId !== session.locationId) {
        return NextResponse.json({ error: 'Staff can only view their assigned store' }, { status: 403 })
      }
      locationId = session.locationId
    }

    if (locationId) {
      const locations = await fetchTenantQuery(
        session.tenantId,
        `SELECT id FROM locations
         WHERE id = $1 AND tenant_id = $2 AND is_active = true`,
        [locationId, session.tenantId]
      )
      if (locations.length !== 1) {
        return NextResponse.json({ error: 'Store location not found' }, { status: 404 })
      }
    }

    const rows = await fetchTenantQuery(session.tenantId, `
      WITH search AS (
        SELECT LOWER($1::text) AS q, $1::text AS raw_q, NULLIF($2::text, '') AS location_id
      )
      SELECT
        g.variant_id AS id,
        g.serial,
        g.variant_id,
        g.location_id,
        g.retail_price,
        g.barcode_token,
        v.name,
        v.category,
        v.subtype,
        v.color,
        v.size,
        v.discount_percent,
        COUNT(*) OVER (PARTITION BY g.variant_id, g.location_id) AS available_count,
        LOWER(CONCAT_WS(' ', v.name, COALESCE(v.category, ''), COALESCE(v.subtype, ''),
          COALESCE(v.color, ''), COALESCE(v.size, ''), COALESCE(g.serial, ''),
          COALESCE(g.source_code, ''), COALESCE(g.barcode_token, ''),
          COALESCE(g.search_text, ''), COALESCE(v.search_text, ''), g.retail_price::text)) AS search_blob
      FROM garments g
      JOIN variants v ON v.id = g.variant_id AND v.tenant_id = g.tenant_id
      CROSS JOIN search
      WHERE g.tenant_id = $3
        AND g.status = 'in_stock'
        AND (search.location_id IS NULL OR g.location_id = search.location_id::uuid)
        AND (
          search.raw_q = ''
          OR LOWER(CONCAT_WS(' ', v.name, COALESCE(v.category, ''), COALESCE(v.subtype, ''),
            COALESCE(v.color, ''), COALESCE(v.size, ''), COALESCE(g.serial, ''),
            COALESCE(g.source_code, ''), COALESCE(g.barcode_token, ''),
            COALESCE(g.search_text, ''), COALESCE(v.search_text, ''), g.retail_price::text))
            LIKE '%' || search.q || '%'
        )
      ORDER BY CASE WHEN LOWER(g.serial) = search.raw_q THEN 0 ELSE 1 END,
        v.category ASC NULLS LAST, v.subtype ASC NULLS LAST, v.name ASC,
        v.color ASC NULLS LAST, v.size ASC NULLS LAST, g.serial ASC
    `, [query, locationId, session.tenantId])

    return NextResponse.json(rows.map((row: any) => ({
      ...row,
      display_name: [row.category, row.subtype, row.name].filter(Boolean).join(' / '),
      display_variant: [row.name, row.size, row.color].filter(Boolean).join(' · '),
      barcode: row.barcode_token || row.serial,
    })))
  } catch (error) {
    if (error instanceof SessionError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('[POS Catalog Error]', error)
    return NextResponse.json({ error: 'Failed to fetch catalog' }, { status: 500 })
  }
}
