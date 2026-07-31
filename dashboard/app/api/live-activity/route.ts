export const dynamic = "force-dynamic";
import { fetchTenantQuery } from '@/lib/db';
import { NextResponse } from 'next/server';
import { requireTenantSession, SessionError } from '@/lib/session';


export async function GET() {
  try {
    const session = await requireTenantSession(['owner', 'store_manager']);
    const tenantId = session.tenantId;
    const locationId = session.role === 'owner' ? null : session.locationId;

    // Active shifts right now
    const activeShifts = await fetchTenantQuery(tenantId, `
      SELECT DISTINCT ON (st.id)
        sh.id, sh.started_at, sh.ended_at,
        st.name as staff_name, st.role as staff_role,
        l.name as location_name,
        (SELECT COUNT(t.id) FROM transactions t WHERE t.cashier_id = st.id AND DATE(t.created_at) = CURRENT_DATE AND t.tenant_id = $1 AND ($2::uuid IS NULL OR t.location_id = $2)) as transactions_count,
        (SELECT COALESCE(SUM(t.total), 0) FROM transactions t WHERE t.cashier_id = st.id AND DATE(t.created_at) = CURRENT_DATE AND t.tenant_id = $1 AND ($2::uuid IS NULL OR t.location_id = $2)) as total_sales
      FROM shifts sh
      JOIN staff st ON sh.staff_id = st.id AND st.tenant_id = sh.tenant_id
      LEFT JOIN locations l ON sh.location_id = l.id AND l.tenant_id = sh.tenant_id
      WHERE DATE(sh.started_at) = CURRENT_DATE
        AND sh.tenant_id = $1
        AND ($2::uuid IS NULL OR sh.location_id = $2)
      ORDER BY st.id, sh.started_at DESC
    `, [tenantId, locationId]);

    // Last 20 transactions with cashier names
    const recentSales = await fetchTenantQuery(tenantId, `
      SELECT 
        t.receipt_number, t.total, t.payment_method, t.created_at,
        st.name as cashier_name,
        l.name as location_name
      FROM transactions t
      LEFT JOIN staff st ON t.cashier_id = st.id AND st.tenant_id = t.tenant_id
      LEFT JOIN locations l ON t.location_id = l.id AND l.tenant_id = t.tenant_id
      WHERE t.tenant_id = $1
        AND ($2::uuid IS NULL OR t.location_id = $2)
      ORDER BY t.created_at DESC
      LIMIT 20
    `, [tenantId, locationId]);

    // Per-location summary today
    const locationSummary = await fetchTenantQuery(tenantId, `
      SELECT 
        l.name as location_name,
        COUNT(t.id) as sales_count,
        COALESCE(SUM(t.total), 0) as total_revenue,
        COUNT(DISTINCT t.cashier_id) as active_cashiers
      FROM locations l
      LEFT JOIN transactions t ON t.location_id = l.id AND t.tenant_id = l.tenant_id
        AND DATE(t.created_at) = CURRENT_DATE
      WHERE l.tenant_id = $1 AND l.is_active = true
        AND ($2::uuid IS NULL OR l.id = $2)
      GROUP BY l.id, l.name
      ORDER BY total_revenue DESC
    `, [tenantId, locationId]);

    return NextResponse.json({ activeShifts, recentSales, locationSummary });
  } catch (err) {
    if (err instanceof SessionError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[Live Activity Error]', err);
    return NextResponse.json({ error: 'Failed to load activity' }, { status: 500 });
  }
}
