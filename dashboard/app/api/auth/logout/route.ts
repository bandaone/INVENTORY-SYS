export const dynamic = "force-dynamic";
import { adminPool } from '@/lib/db';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST() {
  try {
    const cookieStore = cookies();
    const shiftId   = cookieStore.get('shift_id')?.value;
    const tenantId  = cookieStore.get('tenant_id')?.value;
    const staffId   = cookieStore.get('staff_id')?.value;

    // Close the shift: record end time and final stats
    if (shiftId && tenantId) {
      const shiftResult = await adminPool.query(`
        SELECT id, staff_id, location_id, started_at
        FROM shifts
        WHERE id = $1 AND tenant_id = $2
        LIMIT 1
      `, [shiftId, tenantId]);

      const shift = shiftResult.rows[0];
      if (shift) {
        const txStats = await adminPool.query(`
          SELECT
            COUNT(*)::int as transactions_count,
            COALESCE(SUM(total), 0) as gross_sales
          FROM transactions
          WHERE cashier_id = $1
            AND tenant_id = $2
            AND created_at >= $3
        `, [shift.staff_id, tenantId, shift.started_at]);

        const discountStats = await adminPool.query(`
          SELECT
            COALESCE(SUM(ti.discount_amount * ti.quantity), 0) as discount_total
          FROM transactions t
          JOIN transaction_items ti ON ti.transaction_id = t.id
          WHERE t.cashier_id = $1
            AND t.tenant_id = $2
            AND t.created_at >= $3
        `, [shift.staff_id, tenantId, shift.started_at]);

        const returnStats = await adminPool.query(`
          SELECT
            COUNT(*)::int as returns_count,
            COALESCE(SUM(refund_total), 0) as returns_total
          FROM sales_returns
          WHERE cashier_id = $1
            AND tenant_id = $2
            AND created_at >= $3
        `, [shift.staff_id, tenantId, shift.started_at]);

        const stats = txStats.rows[0] || {};
        const discounts = discountStats.rows[0] || {};
        const returns = returnStats.rows[0] || {};
        const grossSales = Number(stats.gross_sales || 0);
        const discountTotal = Number(discounts.discount_total || 0);
        const returnsTotal = Number(returns.returns_total || 0);
        const netSales = Math.max(grossSales - returnsTotal, 0);

        const reportResult = await adminPool.query(`
          INSERT INTO shift_closing_reports (
            tenant_id, shift_id, cashier_id, location_id, report_date,
            transactions_count, gross_sales, discount_total, returns_count, returns_total, net_sales, opened_at, closed_at, summary
          )
          VALUES ($1,$2,$3,$4,CURRENT_DATE,$5,$6,$7,$8,$9,$10,$11,NOW(),$12)
          RETURNING id
        `, [
          tenantId,
          shiftId,
          shift.staff_id,
          shift.location_id || null,
          Number(stats.transactions_count || 0),
          grossSales,
          discountTotal,
          Number(returns.returns_count || 0),
          returnsTotal,
          netSales,
          shift.started_at,
          JSON.stringify({
            cashier_id: shift.staff_id,
            location_id: shift.location_id || null,
            started_at: shift.started_at,
            gross_sales: grossSales,
            discount_total: discountTotal,
            returns_total: returnsTotal,
            net_sales: netSales,
          }),
        ]);

        await adminPool.query(`
          UPDATE shifts SET
            ended_at = NOW(),
            transactions_count = $2,
            total_sales = $3,
            discount_total = $4,
            returns_count = $5,
            returns_total = $6,
            closing_report_id = $7,
            summary = $8
          WHERE id = $1
        `, [
          shiftId,
          Number(stats.transactions_count || 0),
          grossSales,
          discountTotal,
          Number(returns.returns_count || 0),
          returnsTotal,
          reportResult.rows[0]?.id || null,
          JSON.stringify({
            cashier_id: shift.staff_id,
            location_id: shift.location_id || null,
            started_at: shift.started_at,
            ended_at: new Date().toISOString(),
            gross_sales: grossSales,
            discount_total: discountTotal,
            returns_total: returnsTotal,
            net_sales: netSales,
          }),
          ]);

        await adminPool.query(`
          INSERT INTO platform_access_events (tenant_id, staff_id, event_type, source, metadata)
          VALUES ($1, $2, 'LOGOUT', 'DASHBOARD', $3)
        `, [tenantId, staffId || shift.staff_id, JSON.stringify({ shift_id: shiftId })]);
      }
    }

    // Clear all session cookies
    const clear = { path: '/', maxAge: 0 };
    ['tenant_id','staff_id','shift_id','staff_role','staff_name','tenant_name','location_id','location_name']
      .forEach(name => cookieStore.set(name, '', clear));

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[Logout Error]', err);
    return NextResponse.json({ error: 'Logout failed' }, { status: 500 });
  }
}
