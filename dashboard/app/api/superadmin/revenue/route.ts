export const dynamic = 'force-dynamic'

import { ensureTenantInvoice } from '@/lib/billing'
import { adminPool } from '@/lib/db'
import { requirePlatformSession, SessionError } from '@/lib/session'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    await requirePlatformSession()
    const [mrrResult, overdueResult, eventsResult] = await Promise.all([
      adminPool.query(`
        SELECT COALESCE(SUM(plan.price_zmw), 0) AS mrr
        FROM tenants AS tenant
        JOIN subscription_plans AS plan ON plan.id = tenant.subscription_plan_id
        WHERE UPPER(tenant.status) = 'ACTIVE'
      `),
      adminPool.query(`
        SELECT
          invoice.id,
          invoice.tenant_id,
          tenant.name AS tenant_name,
          'SUBSCRIPTION_INVOICE' AS event_type,
          (invoice.total_amount - invoice.amount_paid) AS amount,
          invoice.currency,
          CASE
            WHEN invoice.due_at < NOW() THEN 'OVERDUE'
            ELSE invoice.status
          END AS status,
          invoice.due_at,
          invoice.created_at
        FROM subscription_invoices AS invoice
        JOIN tenants AS tenant ON tenant.id = invoice.tenant_id
        WHERE invoice.status IN ('OPEN', 'PARTIALLY_PAID', 'OVERDUE')
        ORDER BY invoice.due_at
      `),
      adminPool.query(`
        SELECT
          payment.id,
          payment.tenant_id,
          tenant.name AS tenant_name,
          payment.provider || '_PAYMENT' AS event_type,
          payment.amount,
          payment.currency,
          payment.status,
          invoice.due_at,
          payment.created_at
        FROM subscription_payments AS payment
        JOIN tenants AS tenant ON tenant.id = payment.tenant_id
        JOIN subscription_invoices AS invoice
          ON invoice.id = payment.invoice_id AND invoice.tenant_id = payment.tenant_id
        ORDER BY payment.created_at DESC
        LIMIT 50
      `),
    ])

    return NextResponse.json({
      mrr: Number(mrrResult.rows[0]?.mrr || 0),
      overdue: overdueResult.rows.map((row) => ({ ...row, amount: Number(row.amount) })),
      events: eventsResult.rows.map((row) => ({ ...row, amount: Number(row.amount) })),
    })
  } catch (error) {
    if (error instanceof SessionError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('[Revenue API GET]', error)
    return NextResponse.json({ error: 'Failed to load revenue data' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    await requirePlatformSession()
    const { action, tenantId } = await req.json()
    if (action === 'MARK_PAID') {
      return NextResponse.json({
        error: 'Invoices can only be settled by a verified provider payment or an audited bank-settlement workflow.',
      }, { status: 409 })
    }
    if (action === 'GENERATE_INVOICE' && /^[0-9a-f-]{36}$/i.test(String(tenantId || ''))) {
      const invoice = await ensureTenantInvoice(tenantId)
      return NextResponse.json({ success: true, invoice })
    }
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    if (error instanceof SessionError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('[Revenue API POST]', error)
    return NextResponse.json({ error: 'Failed to process revenue action' }, { status: 500 })
  }
}
