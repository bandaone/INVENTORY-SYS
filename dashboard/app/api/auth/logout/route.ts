export const dynamic = 'force-dynamic'

import { adminPool } from '@/lib/db'
import { clearSessionCookies, getVerifiedSession } from '@/lib/session'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST() {
  const session = await getVerifiedSession()

  try {
    if (session?.type === 'platform') {
      await adminPool.query(
        `UPDATE platform_admins SET auth_version = auth_version + 1, updated_at = NOW()
         WHERE id = $1 AND auth_version = $2`,
        [session.staffId, session.authVersion]
      )
      return NextResponse.json({ success: true })
    }
    if (session?.tenantId && !session.shiftId) {
      await adminPool.query(`
        UPDATE staff SET auth_version = auth_version + 1, updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2 AND auth_version = $3
      `, [session.staffId, session.tenantId, session.authVersion])
      return NextResponse.json({ success: true })
    }
    if (!session?.tenantId || !session.shiftId) {
      return NextResponse.json({ success: true })
    }

    const client = await adminPool.connect()
    try {
      await client.query('BEGIN')
      const shiftResult = await client.query(`
        SELECT id, staff_id, location_id, started_at
        FROM shifts
        WHERE id = $1 AND tenant_id = $2 AND staff_id = $3 AND ended_at IS NULL
        FOR UPDATE
      `, [session.shiftId, session.tenantId, session.staffId])

      const shift = shiftResult.rows[0]
      if (!shift) {
        await client.query('COMMIT')
        return NextResponse.json({ success: true })
      }

      const txStats = await client.query(`
        SELECT COUNT(*)::int AS transactions_count,
               COALESCE(SUM(total), 0) AS gross_sales
        FROM transactions
        WHERE cashier_id = $1 AND tenant_id = $2
          AND location_id IS NOT DISTINCT FROM $3::uuid
          AND created_at >= $4
      `, [shift.staff_id, session.tenantId, shift.location_id, shift.started_at])
      const discountStats = await client.query(`
        SELECT COALESCE(SUM(ti.discount_amount * ti.quantity), 0) AS discount_total
        FROM transactions t
        JOIN transaction_items ti ON ti.transaction_id = t.id
        WHERE t.cashier_id = $1 AND t.tenant_id = $2
          AND t.location_id IS NOT DISTINCT FROM $3::uuid
          AND t.created_at >= $4
      `, [shift.staff_id, session.tenantId, shift.location_id, shift.started_at])
      const returnStats = await client.query(`
        SELECT COUNT(*)::int AS returns_count,
               COALESCE(SUM(refund_total), 0) AS returns_total
        FROM sales_returns
        WHERE cashier_id = $1 AND tenant_id = $2
          AND location_id IS NOT DISTINCT FROM $3::uuid
          AND created_at >= $4
      `, [shift.staff_id, session.tenantId, shift.location_id, shift.started_at])

      const stats = txStats.rows[0] || {}
      const discounts = discountStats.rows[0] || {}
      const returns = returnStats.rows[0] || {}
      const grossSales = Number(stats.gross_sales || 0)
      const discountTotal = Number(discounts.discount_total || 0)
      const returnsTotal = Number(returns.returns_total || 0)
      const netSales = Math.max(grossSales - returnsTotal, 0)
      const summary = JSON.stringify({
        cashier_id: shift.staff_id,
        location_id: shift.location_id || null,
        started_at: shift.started_at,
        ended_at: new Date().toISOString(),
        gross_sales: grossSales,
        discount_total: discountTotal,
        returns_total: returnsTotal,
        net_sales: netSales,
      })

      const reportResult = await client.query(`
        INSERT INTO shift_closing_reports (
          tenant_id, shift_id, cashier_id, location_id, report_date,
          transactions_count, gross_sales, discount_total, returns_count,
          returns_total, net_sales, opened_at, closed_at, summary
        )
        SELECT $1,$2,$3,$4,CURRENT_DATE,$5,$6,$7,$8,$9,$10,$11,NOW(),$12
        WHERE NOT EXISTS (
          SELECT 1 FROM shift_closing_reports WHERE tenant_id = $1 AND shift_id = $2
        )
        RETURNING id
      `, [
        session.tenantId,
        session.shiftId,
        shift.staff_id,
        shift.location_id || null,
        Number(stats.transactions_count || 0),
        grossSales,
        discountTotal,
        Number(returns.returns_count || 0),
        returnsTotal,
        netSales,
        shift.started_at,
        summary,
      ])

      await client.query(`
        UPDATE shifts SET
          ended_at = NOW(), transactions_count = $4, total_sales = $5,
          discount_total = $6, returns_count = $7, returns_total = $8,
          closing_report_id = COALESCE($9, closing_report_id), summary = $10
        WHERE id = $1 AND tenant_id = $2 AND staff_id = $3 AND ended_at IS NULL
      `, [
        session.shiftId,
        session.tenantId,
        session.staffId,
        Number(stats.transactions_count || 0),
        grossSales,
        discountTotal,
        Number(returns.returns_count || 0),
        returnsTotal,
        reportResult.rows[0]?.id || null,
        summary,
      ])

      await client.query(`
        INSERT INTO platform_access_events (tenant_id, staff_id, event_type, source, metadata)
        VALUES ($1, $2, 'LOGOUT', 'DASHBOARD', $3)
      `, [session.tenantId, session.staffId, JSON.stringify({ shift_id: session.shiftId })])
      await client.query(`
        UPDATE staff SET auth_version = auth_version + 1, updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2 AND auth_version = $3
      `, [session.staffId, session.tenantId, session.authVersion])
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Logout Error]', error)
    return NextResponse.json({ error: 'Logout failed' }, { status: 500 })
  } finally {
    try {
      await createClient().auth.signOut({ scope: 'local' })
    } catch {
      // Local cookies are still cleared below if Supabase is unavailable.
    }
    clearSessionCookies()
  }
}

export async function DELETE() {
  return POST()
}
