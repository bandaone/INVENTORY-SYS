export const dynamic = "force-dynamic";
import { fetchTenantQuery } from '@/lib/db';
import { NextResponse } from 'next/server';
import { requireTenantSession, SessionError } from '@/lib/session';

// GET: real sales trend for the last 7 days, per location
export async function GET() {
  try {
    const session = await requireTenantSession(['owner', 'store_manager']);
    const tenantId = session.tenantId;
    const locationId = session.role === 'owner' ? null : session.locationId;
    const tenant = await fetchTenantQuery(tenantId, `
      SELECT business_timezone FROM tenants WHERE id = $1
    `, [tenantId]);
    const businessTimezone = tenant[0]?.business_timezone || 'Africa/Lusaka';

    // Get all locations for this tenant
    const locations = await fetchTenantQuery(tenantId, `
      SELECT id, name FROM locations
      WHERE tenant_id = $1 AND is_active = true
        AND ($2::uuid IS NULL OR id = $2)
      ORDER BY name
    `, [tenantId, locationId]);

    // Get daily revenue for the last 7 days, grouped by location
    const [days, rows] = await Promise.all([
      fetchTenantQuery(tenantId, `
        SELECT to_char(day, 'YYYY-MM-DD') AS date_key, to_char(day, 'Dy') AS label
        FROM generate_series(
          (NOW() AT TIME ZONE $1)::date - 6,
          (NOW() AT TIME ZONE $1)::date,
          INTERVAL '1 day'
        ) AS day
        ORDER BY day
      `, [businessTimezone]),
      fetchTenantQuery(tenantId, `
      SELECT 
        t.location_id,
        to_char((t.created_at AT TIME ZONE $3)::date, 'YYYY-MM-DD') as sale_date,
        COALESCE(SUM(t.total), 0) as daily_total
      FROM transactions t
      WHERE t.tenant_id = $1
        AND (t.created_at AT TIME ZONE $3)::date
          >= (NOW() AT TIME ZONE $3)::date - 6
        AND ($2::uuid IS NULL OR t.location_id = $2)
      GROUP BY t.location_id, (t.created_at AT TIME ZONE $3)::date
      ORDER BY t.location_id, sale_date
    `, [tenantId, locationId, businessTimezone]),
    ]);

    const labels = days.map((day: any) => day.label);

    // Build datasets per location
    const datasets = locations.map((loc: any, idx: number) => {
      const colors = ['#4ade80', '#60a5fa', '#f472b6', '#fb923c', '#a78bfa'];
      const color = colors[idx % colors.length];
      const data = days.map((day: any) => {
        const match = rows.find((row: any) => row.location_id === loc.id && row.sale_date === day.date_key);
        return match ? Number(match.daily_total) : 0;
      });
      return { label: loc.name, data, color };
    });

    return NextResponse.json({ labels, datasets });
  } catch (err) {
    if (err instanceof SessionError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[Sales Trend Error]', err);
    return NextResponse.json({ error: 'Failed to load trend data' }, { status: 500 });
  }
}
