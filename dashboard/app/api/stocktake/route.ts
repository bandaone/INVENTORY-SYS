import { fetchTenantQuery, adminPool } from '@/lib/db';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

// ── GET: return ALL garments (in_stock + sold) so scanner can identify everything
export async function GET() {
  try {
    const cookieStore = cookies();
    const tenantId = cookieStore.get('tenant_id')?.value;
    if (!tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const stock = await fetchTenantQuery(tenantId, `
      SELECT g.serial, v.name, g.status, l.name as location_name
      FROM garments g
      JOIN variants v ON g.variant_id = v.id
      LEFT JOIN locations l ON g.location_id = l.id
      ORDER BY g.status, v.name
    `);
    return NextResponse.json(stock);
  } catch (err) {
    console.error('[Stocktake GET Error]', err);
    return NextResponse.json({ error: 'Failed to fetch stock' }, { status: 500 });
  }
}

// ── POST: record a scan (creates session on first scan if none active)
export async function POST(req: Request) {
  try {
    const cookieStore = cookies();
    const tenantId  = cookieStore.get('tenant_id')?.value;
    const staffId   = cookieStore.get('staff_id')?.value;
    const locationId = cookieStore.get('location_id')?.value;
    if (!tenantId || !staffId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { serial, category, sessionId: providedSessionId } = await req.json();
    if (!serial || !category) return NextResponse.json({ error: 'Missing serial or category' }, { status: 400 });

    // Resolve location: use cookie or first active location
    let locId = locationId;
    if (!locId) {
      const locs = await fetchTenantQuery(tenantId, `SELECT id FROM locations WHERE is_active = true LIMIT 1`);
      locId = locs[0]?.id;
    }
    if (!locId) return NextResponse.json({ error: 'No location found' }, { status: 400 });

    // Get or create active session for this clerk
    let sessionId = providedSessionId;
    if (!sessionId) {
      const existing = await adminPool.query(
        `SELECT id FROM stocktake_sessions WHERE clerk_id = $1 AND status = 'active' ORDER BY started_at DESC LIMIT 1`,
        [staffId]
      );
      if (existing.rows.length > 0) {
        sessionId = existing.rows[0].id;
      } else {
        // Get expected count
        const countResult = await fetchTenantQuery(tenantId, `SELECT COUNT(*) as c FROM garments WHERE status = 'in_stock'`);
        const expectedCount = parseInt(countResult[0]?.c || '0');
        const newSession = await adminPool.query(
          `INSERT INTO stocktake_sessions (tenant_id, location_id, clerk_id, status, expected_count)
           VALUES ($1, $2, $3, 'active', $4) RETURNING id`,
          [tenantId, locId, staffId, expectedCount]
        );
        sessionId = newSession.rows[0].id;
      }
    }

    // Record the scan
    await adminPool.query(
      `INSERT INTO stocktake_scans (session_id, garment_serial, category) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [sessionId, serial.toUpperCase(), category]
    );

    // Update session counters
    await adminPool.query(`
      UPDATE stocktake_sessions SET
        scanned_count    = (SELECT COUNT(*) FROM stocktake_scans WHERE session_id = $1),
        matched_count    = (SELECT COUNT(*) FROM stocktake_scans WHERE session_id = $1 AND category = 'matched'),
        missing_count    = (SELECT COUNT(*) FROM stocktake_scans WHERE session_id = $1 AND category = 'missing'),
        unexpected_count = (SELECT COUNT(*) FROM stocktake_scans WHERE session_id = $1 AND category = 'unexpected')
      WHERE id = $1
    `, [sessionId]);

    return NextResponse.json({ success: true, sessionId });
  } catch (err) {
    console.error('[Stocktake POST Error]', err);
    return NextResponse.json({ error: 'Failed to record scan' }, { status: 500 });
  }
}

// ── PUT: complete the active session
export async function PUT(req: Request) {
  try {
    const cookieStore = cookies();
    const tenantId = cookieStore.get('tenant_id')?.value;
    const staffId  = cookieStore.get('staff_id')?.value;
    if (!tenantId || !staffId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { sessionId } = await req.json();
    if (!sessionId) return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });

    await adminPool.query(
      `UPDATE stocktake_sessions SET status = 'completed', completed_at = NOW() WHERE id = $1 AND clerk_id = $2`,
      [sessionId, staffId]
    );

    // Fetch final stats for audit log
    const statsResult = await adminPool.query(
      `SELECT matched_count, missing_count, unexpected_count, expected_count FROM stocktake_sessions WHERE id = $1`,
      [sessionId]
    );
    if (statsResult.rows.length > 0) {
      const stats = statsResult.rows[0];
      const staffRole = cookieStore.get('staff_role')?.value || 'stock_clerk';
      await adminPool.query(`
        INSERT INTO audit_trail (tenant_id, action_type, actor_id, actor_role, resource_type, resource_id, changes)
        VALUES ($1, 'STOCKTAKE_COMPLETED', $2, $3, 'stocktake_session', $4, $5)
      `, [tenantId, staffId, staffRole, sessionId, JSON.stringify(stats)]);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[Stocktake PUT Error]', err);
    return NextResponse.json({ error: 'Failed to complete session' }, { status: 500 });
  }
}
