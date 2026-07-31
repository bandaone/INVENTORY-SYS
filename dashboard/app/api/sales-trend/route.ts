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

    // Get all locations for this tenant
    const locations = await fetchTenantQuery(tenantId, `
      SELECT id, name FROM locations
      WHERE tenant_id = $1 AND is_active = true
        AND ($2::uuid IS NULL OR id = $2)
      ORDER BY name
    `, [tenantId, locationId]);

    // Get daily revenue for the last 7 days, grouped by location
    const rows = await fetchTenantQuery(tenantId, `
      SELECT 
        l.name as location_name,
        DATE(t.created_at) as sale_date,
        COALESCE(SUM(t.total), 0) as daily_total
      FROM transactions t
      JOIN locations l ON t.location_id = l.id AND l.tenant_id = t.tenant_id
      WHERE t.tenant_id = $1 AND t.created_at >= NOW() - INTERVAL '7 days'
        AND ($2::uuid IS NULL OR t.location_id = $2)
      GROUP BY l.name, DATE(t.created_at)
      ORDER BY l.name, sale_date
    `, [tenantId, locationId]);

    // Build labels = last 7 days
    const labels: string[] = [];
    const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      labels.push(dayNames[d.getDay()]);
    }

    // Build datasets per location
    const datasets = locations.map((loc: any, idx: number) => {
      const colors = ['#4ade80', '#60a5fa', '#f472b6', '#fb923c', '#a78bfa'];
      const color = colors[idx % colors.length];
      const data = labels.map((_, dayOffset) => {
        const d = new Date();
        d.setDate(d.getDate() - (6 - dayOffset));
        const dateStr = d.toISOString().split('T')[0];
        const match = rows.find((r: any) => r.location_name === loc.name && r.sale_date?.toISOString?.().startsWith(dateStr));
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
