export const dynamic = 'force-dynamic'

import { adminPool } from '@/lib/db'
import { requireTenantSession, SessionError } from '@/lib/session'
import { NextResponse } from 'next/server'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  })[character] || character);
}

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const { tenantId } = await requireTenantSession(['owner'], { allowSuspended: true })
    const paymentId = String(params.id || '')
    if (!UUID_PATTERN.test(paymentId)) return new NextResponse('Invalid receipt ID', { status: 400 })

    const result = await adminPool.query(`
      SELECT
        payment.id,
        payment.provider,
        payment.provider_reference,
        payment.provider_transaction_id,
        payment.amount,
        payment.currency,
        payment.status,
        payment.payer_msisdn,
        payment.succeeded_at,
        invoice.invoice_number,
        invoice.period_start,
        invoice.period_end,
        plan.name AS plan_name,
        tenant.name AS tenant_name,
        coalesce(settings.business_name, tenant.name) AS business_name
      FROM subscription_payments AS payment
      JOIN subscription_invoices AS invoice
        ON invoice.id = payment.invoice_id AND invoice.tenant_id = payment.tenant_id
      JOIN subscription_plans AS plan ON plan.id = invoice.plan_id
      JOIN tenants AS tenant ON tenant.id = payment.tenant_id
      LEFT JOIN tenant_settings AS settings ON settings.tenant_id = tenant.id
      WHERE payment.id = $1 AND payment.tenant_id = $2 AND payment.status = 'SUCCEEDED'
      LIMIT 1
    `, [paymentId, tenantId])
    if (result.rowCount !== 1) return new NextResponse('Receipt not found', { status: 404 })

    const record = result.rows[0]
    const paidAt = new Date(record.succeeded_at).toLocaleString('en-ZM', {
      dateStyle: 'long',
      timeStyle: 'short',
      timeZone: 'Africa/Lusaka',
    })
    const servicePeriod = `${new Date(record.period_start).toLocaleDateString('en-ZM')} – ${new Date(record.period_end).toLocaleDateString('en-ZM')}`
    const amount = new Intl.NumberFormat('en-ZM', {
      style: 'currency',
      currency: record.currency,
    }).format(Number(record.amount))

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Receipt ${escapeHtml(record.invoice_number)}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #f4f6f8; color: #17202a; font: 15px/1.55 Arial, sans-serif; }
    main { width: min(760px, calc(100% - 32px)); margin: 40px auto; padding: 44px; background: white; border: 1px solid #e4e7eb; border-radius: 16px; }
    header, .row { display: flex; justify-content: space-between; gap: 24px; }
    header { padding-bottom: 26px; border-bottom: 2px solid #17202a; }
    h1 { margin: 0; font-size: 30px; letter-spacing: .08em; }
    .brand { font-size: 22px; font-weight: 800; color: #16834b; }
    .muted { color: #637083; }
    .details { margin: 32px 0; display: grid; gap: 12px; }
    .row { padding-bottom: 10px; border-bottom: 1px solid #edf0f2; }
    .value { font-weight: 700; text-align: right; }
    .line-item { margin-top: 30px; padding: 20px 0; border-top: 2px solid #17202a; border-bottom: 1px solid #dfe4e8; }
    .total { padding-top: 20px; font-size: 21px; font-weight: 800; }
    .status { display: inline-block; padding: 5px 10px; border-radius: 999px; color: #096b3a; background: #e2f7ec; font-size: 12px; font-weight: 800; }
    footer { margin-top: 52px; color: #637083; font-size: 13px; text-align: center; }
    @media print { body { background: white; } main { width: 100%; margin: 0; border: 0; padding: 24px; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div><div class="brand">Retail OS</div><div class="muted">Subscription billing</div></div>
      <div style="text-align:right"><h1>RECEIPT</h1><div class="muted">${escapeHtml(record.invoice_number)}</div></div>
    </header>
    <section class="details" aria-label="Receipt details">
      <div class="row"><span class="muted">Billed to</span><span class="value">${escapeHtml(record.business_name)}</span></div>
      <div class="row"><span class="muted">Paid</span><span class="value">${escapeHtml(paidAt)}</span></div>
      <div class="row"><span class="muted">Provider</span><span class="value">${escapeHtml(String(record.provider).replace(/_/g, ' '))}</span></div>
      <div class="row"><span class="muted">Provider reference</span><span class="value">${escapeHtml(record.provider_reference)}</span></div>
      <div class="row"><span class="muted">Paying number</span><span class="value">${escapeHtml(record.payer_msisdn || 'Not supplied')}</span></div>
      <div class="row"><span class="muted">Status</span><span class="value"><span class="status">PAID</span></span></div>
    </section>
    <section class="line-item">
      <div class="row" style="border:0">
        <span><strong>${escapeHtml(record.plan_name)}</strong><br><span class="muted">Service period ${escapeHtml(servicePeriod)}</span></span>
        <span class="value">${escapeHtml(amount)}</span>
      </div>
    </section>
    <div class="row total"><span>Total paid</span><span>${escapeHtml(amount)}</span></div>
    <footer>This receipt records a payment independently verified with the payment provider.</footer>
  </main>
</body>
</html>`

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
      },
    })
  } catch (error) {
    if (error instanceof SessionError) return new NextResponse(error.message, { status: error.status })
    console.error('[Subscription Receipt Error]', error)
    return new NextResponse('Unable to generate receipt', { status: 500 })
  }
}
