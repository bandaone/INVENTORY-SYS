export const dynamic = "force-dynamic";
import { fetchTenantQuery, adminPool } from '@/lib/db';
import { requireTenantSession, SessionError } from '@/lib/session';
import { NextResponse } from 'next/server';
import type { PoolClient } from 'pg';

export async function GET() {
  try {
    const session = await requireTenantSession(
      ['owner', 'store_manager', 'cashier', 'stock_clerk'],
      { allowSuspended: true }
    );
    if (['SUSPENDED', 'CANCELLED'].includes(session.tenantStatus) && session.role !== 'owner') {
      throw new SessionError('This store account is suspended', 403);
    }
    const tenantId = session.tenantId;

    const rows = await fetchTenantQuery(tenantId, `
      SELECT id, name, address, is_active
      FROM locations
      WHERE is_active = true
      ORDER BY name ASC
    `);
    return NextResponse.json(rows);
  } catch (err: any) {
    if (err instanceof SessionError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[Locations GET]', err);
    return NextResponse.json({ error: 'Failed to load locations' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let client: PoolClient | null = null;
  try {
    const { tenantId } = await requireTenantSession(['owner']);
    const { name, address } = await req.json();

    if (!name) {
      return NextResponse.json({ error: 'Location name is required' }, { status: 400 });
    }

    client = await adminPool.connect();
    await client.query('BEGIN');
    const tenantRes = await client.query(
      'SELECT max_locations FROM tenants WHERE id = $1 FOR UPDATE',
      [tenantId]
    );
    if (tenantRes.rowCount !== 1) throw new Error('Tenant not found');
    const maxLocations = Number(tenantRes.rows[0].max_locations);
    const currentLocationsRes = await client.query(
      'SELECT COUNT(*)::integer AS count FROM locations WHERE tenant_id = $1 AND is_active = true',
      [tenantId]
    );
    const currentCount = Number(currentLocationsRes.rows[0]?.count || 0);
    if (currentCount >= maxLocations) {
      await client.query('ROLLBACK');
      client.release();
      client = null;
      return NextResponse.json({ error: `Subscription limit reached. Your plan allows a maximum of ${maxLocations} active location(s). Please upgrade to add more.` }, { status: 403 });
    }

    const newLoc = await client.query(`
      INSERT INTO locations (tenant_id, name, address, is_active)
      VALUES ($1, $2, $3, true)
      RETURNING id, name, address, is_active
    `, [tenantId, String(name).trim(), address]);
    await client.query(
      'UPDATE tenants SET active_locations_count = $1, updated_at = NOW() WHERE id = $2',
      [currentCount + 1, tenantId]
    );
    await client.query('COMMIT');

    return NextResponse.json({ success: true, location: newLoc.rows[0] });
  } catch (err: any) {
    if (client) await client.query('ROLLBACK').catch(() => undefined);
    if (err instanceof SessionError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err.code === '23505') {
      return NextResponse.json({ error: 'A location with this name already exists' }, { status: 400 });
    }
    console.error('[Locations POST]', err);
    return NextResponse.json({ error: 'Failed to create location' }, { status: 500 });
  } finally {
    client?.release();
  }
}
