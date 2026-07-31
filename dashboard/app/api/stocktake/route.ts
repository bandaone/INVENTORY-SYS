export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import type { PoolClient } from 'pg'
import { connectTenantClient } from '@/lib/db'
import { requireTenantSession, SessionError } from '@/lib/session'

const STOCKTAKE_ROLES = ['owner', 'store_manager', 'stock_clerk'] as const

async function withTenantClient<T>(tenantId: string, work: (client: PoolClient) => Promise<T>) {
  const client = await connectTenantClient()
  try {
    await client.query('BEGIN')
    await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId])
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof SessionError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  console.error(`[Stocktake Error] ${fallback}`, error)
  return NextResponse.json({ error: fallback }, { status: 500 })
}

// Return only inventory visible inside the signed-in tenant.
export async function GET() {
  try {
    const session = await requireTenantSession(STOCKTAKE_ROLES)
    const locationId = session.role === 'owner' ? null : session.locationId
    if (session.role !== 'owner' && !locationId) {
      throw new SessionError('Your account has no store location assigned.', 403)
    }
    const stock = await withTenantClient(session.tenantId, async (client) => {
      const result = await client.query(
        `SELECT g.serial, v.name, g.status, l.name AS location_name
         FROM garments g
         JOIN variants v ON v.id = g.variant_id AND v.tenant_id = g.tenant_id
         LEFT JOIN locations l ON l.id = g.location_id AND l.tenant_id = g.tenant_id
         WHERE g.tenant_id = $1
           AND g.status = 'in_stock'
           AND ($2::uuid IS NULL OR g.location_id = $2::uuid)
         ORDER BY g.status, v.name`,
        [session.tenantId, locationId]
      )
      return result.rows
    })
    return NextResponse.json(stock)
  } catch (error) {
    return errorResponse(error, 'Failed to fetch stock')
  }
}

// Record a scan, creating a tenant- and clerk-bound session when needed.
export async function POST(req: Request) {
  try {
    const session = await requireTenantSession(STOCKTAKE_ROLES)
    const body = await req.json()
    const serial = String(body?.serial || '').trim().toUpperCase()
    const providedSessionId = body?.sessionId ? String(body.sessionId) : null

    if (!serial || serial.length > 255) {
      return NextResponse.json({ error: 'Invalid serial' }, { status: 400 })
    }

    const result = await withTenantClient(session.tenantId, async (client) => {
      const actor = await client.query(
        `SELECT id, location_id
         FROM staff
         WHERE id = $1 AND tenant_id = $2 AND role = $3 AND is_active = true`,
        [session.staffId, session.tenantId, session.role]
      )
      if (actor.rowCount !== 1) throw new SessionError('Stocktake session is no longer active')

      let locationId = session.locationId || actor.rows[0].location_id || null
      if (!locationId && session.role === 'owner') {
        const firstLocation = await client.query(
          `SELECT id FROM locations
           WHERE tenant_id = $1 AND is_active = true
           ORDER BY created_at ASC LIMIT 1`,
          [session.tenantId]
        )
        locationId = firstLocation.rows[0]?.id || null
      }
      if (!locationId) throw new SessionError('An assigned store is required', 403)

      const location = await client.query(
        `SELECT id FROM locations
         WHERE id = $1 AND tenant_id = $2 AND is_active = true`,
        [locationId, session.tenantId]
      )
      if (location.rowCount !== 1) throw new SessionError('Assigned store is invalid', 403)

      let sessionId = providedSessionId
      if (sessionId) {
        const supplied = await client.query(
          `SELECT id FROM stocktake_sessions
           WHERE id = $1 AND tenant_id = $2 AND clerk_id = $3
             AND location_id = $4 AND status = 'active'
           FOR UPDATE`,
          [sessionId, session.tenantId, session.staffId, locationId]
        )
        if (supplied.rowCount !== 1) throw new SessionError('Stocktake session does not belong to this user and store', 403)
      } else {
        const existing = await client.query(
          `SELECT id FROM stocktake_sessions
           WHERE tenant_id = $1 AND clerk_id = $2 AND location_id = $3 AND status = 'active'
           ORDER BY started_at DESC LIMIT 1
           FOR UPDATE`,
          [session.tenantId, session.staffId, locationId]
        )
        sessionId = existing.rows[0]?.id || null
      }

      if (!sessionId) {
        const expected = await client.query(
          `SELECT COUNT(*)::integer AS count
           FROM garments
           WHERE tenant_id = $1 AND location_id = $2 AND status = 'in_stock'`,
          [session.tenantId, locationId]
        )
        const created = await client.query(
          `INSERT INTO stocktake_sessions
             (tenant_id, location_id, clerk_id, status, expected_count)
           VALUES ($1, $2, $3, 'active', $4)
           RETURNING id`,
          [session.tenantId, locationId, session.staffId, expected.rows[0]?.count || 0]
        )
        sessionId = created.rows[0].id
      }

      // Scan classification is authoritative server state, never a caller
      // assertion. "Missing" is calculated when the session is completed.
      const inventoryMatch = await client.query(
        `SELECT serial
         FROM garments
         WHERE tenant_id = $1 AND serial = $2
           AND location_id = $3 AND status = 'in_stock'
         LIMIT 1`,
        [session.tenantId, serial, locationId]
      )
      const category = inventoryMatch.rowCount === 1 ? 'matched' : 'unexpected'

      await client.query(
        `INSERT INTO stocktake_scans (session_id, garment_serial, category)
         SELECT ss.id, $2, $3
         FROM stocktake_sessions ss
         WHERE ss.id = $1 AND ss.tenant_id = $4 AND ss.clerk_id = $5 AND ss.status = 'active'
           AND NOT EXISTS (
             SELECT 1 FROM stocktake_scans existing
             WHERE existing.session_id = ss.id AND existing.garment_serial = $2
           )`,
        [sessionId, serial, category, session.tenantId, session.staffId]
      )

      await client.query(
        `UPDATE stocktake_sessions ss SET
           scanned_count = (SELECT COUNT(*) FROM stocktake_scans sc WHERE sc.session_id = ss.id),
           matched_count = (SELECT COUNT(*) FROM stocktake_scans sc WHERE sc.session_id = ss.id AND sc.category = 'matched'),
           missing_count = 0,
           unexpected_count = (SELECT COUNT(*) FROM stocktake_scans sc WHERE sc.session_id = ss.id AND sc.category = 'unexpected')
         WHERE ss.id = $1 AND ss.tenant_id = $2 AND ss.clerk_id = $3`,
        [sessionId, session.tenantId, session.staffId]
      )

      return { sessionId }
    })

    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    return errorResponse(error, 'Failed to record scan')
  }
}

// Complete only the caller's own active session in the signed tenant.
export async function PUT(req: Request) {
  try {
    const session = await requireTenantSession(STOCKTAKE_ROLES)
    const { sessionId } = await req.json()
    if (!sessionId) return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 })

    const completed = await withTenantClient(session.tenantId, async (client) => {
      const result = await client.query(
        `UPDATE stocktake_sessions
         SET status = 'completed',
             completed_at = NOW(),
             missing_count = GREATEST(COALESCE(expected_count, 0) - COALESCE(matched_count, 0), 0)
         WHERE id = $1 AND tenant_id = $2 AND clerk_id = $3 AND status = 'active'
         RETURNING id, matched_count, missing_count, unexpected_count, expected_count`,
        [String(sessionId), session.tenantId, session.staffId]
      )
      if (result.rowCount !== 1) return null

      const stats = result.rows[0]
      await client.query(
        `INSERT INTO audit_trail
           (tenant_id, action_type, actor_id, actor_role, resource_type, resource_id, changes)
         VALUES ($1, 'STOCKTAKE_COMPLETED', $2, $3, 'stocktake_session', $4, $5)`,
        [session.tenantId, session.staffId, session.role, stats.id, JSON.stringify(stats)]
      )
      return stats
    })

    if (!completed) return NextResponse.json({ error: 'Active stocktake session not found' }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch (error) {
    return errorResponse(error, 'Failed to complete session')
  }
}
