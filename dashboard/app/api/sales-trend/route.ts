import { fetchTenantQuery } from '@/lib/db';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

// GET: real sales trend for the last 7 days, per location
export async function GET() {
  try {
    const tenantId = cookies().get('tenant_id')?.value;
    if (!tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Get all locations for this tenant
    const locations = await fetchTenantQuery(tenantId, `
      SELECT id, name FROM locations WHERE is_active = true ORDER BY name
    `);

    // Get daily revenue for the last 7 days, grouped by location
    const rows = await fetchTenantQuery(tenantId, `
      SELECT 
        l.name as location_name,
        DATE(t.created_at) as sale_date,
        COALESCE(SUM(t.total), 0) as daily_total
      FROM transactions t
      JOIN locations l ON t.location_id = l.id
      WHERE t.created_at >= NOW() - INTERVAL '7 days'
      GROUP BY l.name, DATE(t.created_at)
      ORDER BY l.name, sale_date
    `);

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
    console.error('[Sales Trend Error]', err);
    return NextResponse.json({ error: 'Failed to load trend data' }, { status: 500 });
  }
}
