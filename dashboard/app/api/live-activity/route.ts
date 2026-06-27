export const dynamic = "force-dynamic";
import { fetchTenantQuery } from '@/lib/db';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';


export async function GET() {
  try {
    const tenantId = cookies().get('tenant_id')?.value;
    if (!tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Active shifts right now
    const activeShifts = await fetchTenantQuery(tenantId, `
      SELECT DISTINCT ON (st.id)
        sh.id, sh.started_at, sh.ended_at,
        st.name as staff_name, st.role as staff_role,
        l.name as location_name,
        (SELECT COUNT(t.id) FROM transactions t WHERE t.cashier_id = st.id AND DATE(t.created_at) = CURRENT_DATE AND t.tenant_id = '${tenantId}') as transactions_count,
        (SELECT COALESCE(SUM(t.total), 0) FROM transactions t WHERE t.cashier_id = st.id AND DATE(t.created_at) = CURRENT_DATE AND t.tenant_id = '${tenantId}') as total_sales
      FROM shifts sh
      JOIN staff st ON sh.staff_id = st.id
      LEFT JOIN locations l ON sh.location_id = l.id
      WHERE DATE(sh.started_at) = CURRENT_DATE
        AND sh.tenant_id = '${tenantId}'
      ORDER BY st.id, sh.started_at DESC
    `);

    // Last 20 transactions with cashier names
    const recentSales = await fetchTenantQuery(tenantId, `
      SELECT 
        t.receipt_number, t.total, t.payment_method, t.created_at,
        st.name as cashier_name,
        l.name as location_name
      FROM transactions t
      LEFT JOIN staff st ON t.cashier_id = st.id
      LEFT JOIN locations l ON t.location_id = l.id
      ORDER BY t.created_at DESC
      LIMIT 20
    `);

    // Per-location summary today
    const locationSummary = await fetchTenantQuery(tenantId, `
      SELECT 
        l.name as location_name,
        COUNT(t.id) as sales_count,
        COALESCE(SUM(t.total), 0) as total_revenue,
        COUNT(DISTINCT t.cashier_id) as active_cashiers
      FROM locations l
      LEFT JOIN transactions t ON t.location_id = l.id
        AND DATE(t.created_at) = CURRENT_DATE
      WHERE l.is_active = true
      GROUP BY l.id, l.name
      ORDER BY total_revenue DESC
    `);

    return NextResponse.json({ activeShifts, recentSales, locationSummary });
  } catch (err) {
    console.error('[Live Activity Error]', err);
    return NextResponse.json({ error: 'Failed to load activity' }, { status: 500 });
  }
}
