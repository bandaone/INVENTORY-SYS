export const dynamic = "force-dynamic";
import { fetchTenantQuery, adminPool } from '@/lib/db';
import { requireTenantSession, SessionError } from '@/lib/session';
import { NextResponse } from 'next/server';

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
  try {
    const { tenantId } = await requireTenantSession(['owner']);
    const { name, address } = await req.json();
    const locationName = typeof name === 'string' ? name.trim() : '';
    const locationAddress = typeof address === 'string' ? address.trim() : null;

    if (!locationName || locationName.length > 160) {
      return NextResponse.json({ error: 'Location name is required' }, { status: 400 });
    }

    // The database trigger serializes this insert against the tenant row and
    // enforces the canonical plan limit, including concurrent requests.
    const newLoc = await adminPool.query(`
      INSERT INTO locations (tenant_id, name, address, is_active)
      VALUES ($1, $2, $3, true)
      RETURNING id, name, address, is_active
    `, [tenantId, locationName, locationAddress]);

    return NextResponse.json({ success: true, location: newLoc.rows[0] });
  } catch (err: any) {
    if (err instanceof SessionError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err.code === '23514') {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err.code === '23505') {
      return NextResponse.json({ error: 'A location with this name already exists' }, { status: 400 });
    }
    console.error('[Locations POST]', err);
    return NextResponse.json({ error: 'Failed to create location' }, { status: 500 });
  }
}
