export const dynamic = 'force-dynamic'

import { fetchTenantQuery } from '@/lib/db'
import { requirePosTerminalSession } from '@/lib/pos-terminal'
import { SessionError } from '@/lib/session'
import { NextResponse } from 'next/server'

const POS_ROLES = ['owner', 'store_manager', 'cashier'] as const
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DEFAULT_PAGE_SIZE = 36
const MAX_PAGE_SIZE = 60
const MAX_SNAPSHOT_PAGE_SIZE = 500

type CatalogCursor = { rank: number; name: string; id: string }

function decodeCursor(value: string): CatalogCursor | null {
  if (!value || value.length > 500) return null
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as CatalogCursor
    if (!parsed || ![0, 1].includes(parsed.rank) || typeof parsed.name !== 'string'
      || parsed.name.length > 300 || !UUID_PATTERN.test(parsed.id)) return null
    return parsed
  } catch {
    return null
  }
}

function encodeCursor(row: any) {
  return Buffer.from(JSON.stringify({
    rank: Number(row.exact_rank),
    name: String(row.sort_name),
    id: String(row.id),
  })).toString('base64url')
}

export async function GET(req: Request) {
  try {
    const session = await requirePosTerminalSession(req, POS_ROLES)
    const { searchParams } = new URL(req.url)
    const query = (searchParams.get('q')?.trim().toLocaleLowerCase() || '').slice(0, 200)
    const category = (searchParams.get('category')?.trim() || '').slice(0, 120)
    const requestedLocationId = searchParams.get('location_id')?.trim() || ''
    const snapshot = searchParams.get('snapshot') === '1'
    const requestedLimit = Number(searchParams.get('limit') || DEFAULT_PAGE_SIZE)
    const maximumLimit = snapshot ? MAX_SNAPSHOT_PAGE_SIZE : MAX_PAGE_SIZE
    const limit = Number.isInteger(requestedLimit)
      ? Math.max(12, Math.min(maximumLimit, requestedLimit))
      : DEFAULT_PAGE_SIZE
    const cursorValue = searchParams.get('cursor') || ''
    const cursor = cursorValue ? decodeCursor(cursorValue) : null
    if (cursorValue && !cursor) return NextResponse.json({ error: 'Invalid catalog cursor' }, { status: 400 })

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
    if (!locationId || !UUID_PATTERN.test(locationId)) {
      return NextResponse.json({ error: 'Select a valid store location' }, { status: 400 })
    }

    const locations = await fetchTenantQuery(
      session.tenantId,
      `SELECT id FROM locations WHERE id = $1 AND tenant_id = $2 AND is_active = true`,
      [locationId, session.tenantId],
    )
    if (locations.length !== 1) return NextResponse.json({ error: 'Store location not found' }, { status: 404 })

    const [rawRows, categoryRows] = await Promise.all([
      fetchTenantQuery(session.tenantId, `
        WITH candidates AS (
          SELECT
            v.id, v.name, v.category, v.subtype, v.color, v.size,
            v.retail_price, v.discount_percent, v.search_text,
            LOWER(v.name) AS sort_name,
            CASE WHEN $1::text <> '' AND EXISTS (
              SELECT 1 FROM garments exact_item
              WHERE exact_item.tenant_id = v.tenant_id
                AND exact_item.variant_id = v.id
                AND exact_item.location_id = $2::uuid
                AND exact_item.status = 'in_stock'
                AND (
                  LOWER(exact_item.serial) = $1
                  OR LOWER(COALESCE(exact_item.barcode_token, '')) = $1
                  OR LOWER(COALESCE(exact_item.source_code, '')) = $1
                )
            ) THEN 0 ELSE 1 END AS exact_rank
          FROM variants v
          WHERE v.tenant_id = $3
            AND ($4::text = '' OR v.category = $4)
            AND EXISTS (
              SELECT 1 FROM garments stock_item
              WHERE stock_item.tenant_id = v.tenant_id
                AND stock_item.variant_id = v.id
                AND stock_item.location_id = $2::uuid
                AND stock_item.status = 'in_stock'
            )
            AND (
              $1::text = ''
              OR LOWER(COALESCE(v.search_text, '')) LIKE '%' || $1 || '%'
              OR LOWER(v.name) LIKE '%' || $1 || '%'
              OR EXISTS (
                SELECT 1 FROM garments search_item
                WHERE search_item.tenant_id = v.tenant_id
                  AND search_item.variant_id = v.id
                  AND search_item.location_id = $2::uuid
                  AND search_item.status = 'in_stock'
                  AND (
                    LOWER(search_item.serial) = $1
                    OR LOWER(COALESCE(search_item.barcode_token, '')) = $1
                    OR LOWER(COALESCE(search_item.source_code, '')) = $1
                    OR LOWER(COALESCE(search_item.search_text, '')) LIKE '%' || $1 || '%'
                  )
              )
            )
        ), page AS (
          SELECT * FROM candidates
          WHERE $7::uuid IS NULL
             OR (exact_rank, sort_name, id) > ($5::integer, $6::text, $7::uuid)
          ORDER BY exact_rank ASC, sort_name ASC, id ASC
          LIMIT $8
        )
        SELECT page.*, stock.available_count, stock.barcode_token,
          stock.identifiers, stock.offline_search
        FROM page
        CROSS JOIN LATERAL (
          SELECT
            COUNT(*)::integer AS available_count,
            MIN(item.barcode_token) AS barcode_token,
            CASE WHEN $9::boolean THEN ARRAY_REMOVE(
              ARRAY_AGG(DISTINCT NULLIF(LOWER(item.serial), ''))
              || ARRAY_AGG(DISTINCT NULLIF(LOWER(item.barcode_token), ''))
              || ARRAY_AGG(DISTINCT NULLIF(LOWER(item.source_code), '')),
              NULL
            ) ELSE ARRAY[]::text[] END AS identifiers,
            CASE WHEN $9::boolean THEN STRING_AGG(
              DISTINCT LOWER(COALESCE(item.search_text, '')), ' '
            ) ELSE NULL END AS offline_search
          FROM garments item
          WHERE item.tenant_id = $3
            AND item.variant_id = page.id
            AND item.location_id = $2::uuid
            AND item.status = 'in_stock'
        ) stock
        ORDER BY page.exact_rank ASC, page.sort_name ASC, page.id ASC
      `, [query, locationId, session.tenantId, category, cursor?.rank ?? 0,
        cursor?.name ?? '', cursor?.id ?? null, limit + 1, snapshot]),
      searchParams.get('include_facets') === '1'
        ? fetchTenantQuery(session.tenantId, `
            SELECT DISTINCT v.category
            FROM variants v
            WHERE v.tenant_id = $1
              AND NULLIF(BTRIM(v.category), '') IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM garments item
                WHERE item.tenant_id = v.tenant_id
                  AND item.variant_id = v.id
                  AND item.location_id = $2::uuid
                  AND item.status = 'in_stock'
              )
            ORDER BY v.category ASC
          `, [session.tenantId, locationId])
        : Promise.resolve([]),
    ])

    const hasMore = rawRows.length > limit
    const rows = rawRows.slice(0, limit)
    const items = rows.map((row: any) => ({
      id: row.id,
      variant_id: row.id,
      name: row.name,
      category: row.category,
      subtype: row.subtype,
      color: row.color,
      size: row.size,
      retail_price: Number(row.retail_price),
      discount_percent: Number(row.discount_percent || 0),
      available_count: Number(row.available_count || 0),
      barcode_token: row.barcode_token || null,
      barcode: row.barcode_token || null,
      search_text: row.search_text || null,
      ...(snapshot ? {
        identifiers: Array.isArray(row.identifiers) ? row.identifiers : [],
        search_blob: row.offline_search || null,
      } : {}),
      exact_match: Number(row.exact_rank) === 0,
      display_name: [row.category, row.subtype, row.name].filter(Boolean).join(' / '),
      display_variant: [row.name, row.size, row.color].filter(Boolean).join(' · '),
    }))

    return NextResponse.json({
      items,
      hasMore,
      nextCursor: hasMore && rows.length ? encodeCursor(rows[rows.length - 1]) : null,
      categories: categoryRows.map((row: any) => String(row.category)),
      pageSize: limit,
      query,
      snapshot,
    })
  } catch (error) {
    if (error instanceof SessionError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('[POS Catalog Error]', error)
    return NextResponse.json({ error: 'Failed to fetch catalog' }, { status: 500 })
  }
}
