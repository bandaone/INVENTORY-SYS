import { fetchTenantQuery, adminPool } from '@/lib/db';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

function getTenantId() {
  const t = cookies().get('tenant_id')?.value;
  if (!t) throw new Error('Unauthorized');
  return t;
}

export async function GET() {
  try {
    const tenantId = getTenantId();

    const rows = await fetchTenantQuery(tenantId, `
      SELECT id, name, address, is_active
      FROM locations
      WHERE is_active = true
      ORDER BY name ASC
    `);
    return NextResponse.json(rows);
  } catch (err: any) {
    if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('[Locations GET]', err);
    return NextResponse.json({ error: 'Failed to load locations' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const tenantId = getTenantId();
    const { name, address } = await req.json();

    if (!name) {
      return NextResponse.json({ error: 'Location name is required' }, { status: 400 });
    }

    // Check limits
    const tenantRes = await adminPool.query('SELECT max_locations FROM tenants WHERE id = $1', [tenantId]);
    if (tenantRes.rows.length === 0) throw new Error('Tenant not found');
    const { max_locations } = tenantRes.rows[0];

    const currentLocationsRes = await fetchTenantQuery(tenantId, 'SELECT COUNT(*) as count FROM locations WHERE is_active = true');
    const currentCount = Number(currentLocationsRes[0].count);

    if (currentCount >= max_locations) {
      return NextResponse.json({ error: `Subscription limit reached. Your plan allows a maximum of ${max_locations} active location(s). Please upgrade to add more.` }, { status: 403 });
    }

    // Insert new location
    const newLoc = await fetchTenantQuery(tenantId, `
      INSERT INTO locations (tenant_id, name, address, is_active)
      VALUES ($1, $2, $3, true)
      RETURNING id, name, address, is_active
    `, [tenantId, name, address]);

    // Update count in tenants table
    await adminPool.query('UPDATE tenants SET active_locations_count = active_locations_count + 1 WHERE id = $1', [tenantId]);

    return NextResponse.json({ success: true, location: newLoc[0] });
  } catch (err: any) {
    if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (err.code === '23505') {
      return NextResponse.json({ error: 'A location with this name already exists' }, { status: 400 });
    }
    console.error('[Locations POST]', err);
    return NextResponse.json({ error: 'Failed to create location' }, { status: 500 });
  }
}
