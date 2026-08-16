import { createHash, randomUUID } from 'crypto'
import type { PoolClient } from 'pg'
import { adminPool } from './db'

export type PaymentProvider = 'MTN_MOMO' | 'FLUTTERWAVE' | 'SANDBOX'
export type VerifiedPaymentStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED'

export class EntitlementError extends Error {
  status = 403
}

export type SubscriptionPlan = {
  id: string
  code: string
  name: string
  description: string | null
  price_zmw: string
  currency: string
  billing_interval_days: number
  max_locations: number
  max_users: number
  features: string[]
  entitlements: Record<string, boolean | string | number>
  version: number
  is_active: boolean
}

export type TenantSubscription = {
  tenant_id: string
  tenant_name: string
  tenant_status: string
  subscription_end_date: string | null
  business_timezone: string
  plan: SubscriptionPlan
  active_locations: number
  active_users: number
}

type InvoiceRow = {
  id: string
  tenant_id: string
  plan_id: string
  invoice_number: string
  period_start: Date | string
  period_end: Date | string
  total_amount: string
  amount_paid: string
  currency: string
  status: string
  due_at: Date | string
  paid_at: Date | string | null
  created_at: Date | string
}

type PaymentRow = {
  id: string
  tenant_id: string
  invoice_id: string
  provider: string
  provider_reference: string
  provider_transaction_id: string | null
  amount: string
  currency: string
  status: string
  payer_msisdn: string | null
  created_at: Date | string
  succeeded_at: Date | string | null
}

function parseFeatures(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : []
}

function parseEntitlements(value: unknown): Record<string, boolean | string | number> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, boolean | string | number>
    : {}
}

function mapPlan(row: any): SubscriptionPlan {
  return {
    id: row.plan_id,
    code: row.plan_code,
    name: row.plan_name,
    description: row.plan_description ?? null,
    price_zmw: String(row.price_zmw),
    currency: row.plan_currency,
    billing_interval_days: Number(row.billing_interval_days),
    max_locations: Number(row.max_locations),
    max_users: Number(row.max_users),
    features: parseFeatures(row.plan_features),
    entitlements: parseEntitlements(row.plan_entitlements),
    version: Number(row.plan_version),
    is_active: Boolean(row.plan_is_active),
  }
}

export async function getTenantSubscription(
  tenantId: string,
  client: Pick<PoolClient, 'query'> = adminPool,
): Promise<TenantSubscription> {
  const result = await client.query(`
    SELECT
      tenant.id AS tenant_id,
      tenant.name AS tenant_name,
      tenant.status AS tenant_status,
      tenant.subscription_end_date,
      tenant.business_timezone,
      plan.id AS plan_id,
      plan.code AS plan_code,
      plan.name AS plan_name,
      plan.description AS plan_description,
      plan.price_zmw,
      plan.currency AS plan_currency,
      plan.billing_interval_days,
      plan.max_locations,
      plan.max_users,
      plan.features AS plan_features,
      plan.entitlements AS plan_entitlements,
      plan.version AS plan_version,
      plan.is_active AS plan_is_active,
      (SELECT COUNT(*)::integer FROM locations WHERE tenant_id = tenant.id AND is_active) AS active_locations,
      (SELECT COUNT(*)::integer FROM staff WHERE tenant_id = tenant.id AND is_active) AS active_users
    FROM tenants AS tenant
    JOIN subscription_plans AS plan ON plan.id = tenant.subscription_plan_id
    WHERE tenant.id = $1
    LIMIT 1
  `, [tenantId])

  if (result.rowCount !== 1) throw new Error('Tenant subscription is not configured')
  const row = result.rows[0]
  return {
    tenant_id: row.tenant_id,
    tenant_name: row.tenant_name,
    tenant_status: String(row.tenant_status || '').toUpperCase(),
    subscription_end_date: row.subscription_end_date ?? null,
    business_timezone: row.business_timezone || 'Africa/Lusaka',
    plan: mapPlan(row),
    active_locations: Number(row.active_locations || 0),
    active_users: Number(row.active_users || 0),
  }
}

export async function requireEntitlement(tenantId: string, entitlement: string) {
  const subscription = await getTenantSubscription(tenantId)
  if (!subscription.plan.is_active || !subscription.plan.entitlements[entitlement]) {
    throw new EntitlementError(`Your ${subscription.plan.name} plan does not include ${entitlement.replace(/_/g, ' ')}`)
  }
  return subscription
}

function invoiceNumber(tenantId: string) {
  const month = new Date().toISOString().slice(0, 7).replace('-', '')
  return `INV-${month}-${tenantId.slice(0, 8).toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}`
}

async function ensureOpenInvoice(client: PoolClient, tenantId: string): Promise<InvoiceRow> {
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtextextended('subscription-invoice:' || $1::text, 0))`,
    [tenantId],
  )

  const existing = await client.query<InvoiceRow>(`
    SELECT *
    FROM subscription_invoices
    WHERE tenant_id = $1
      AND status IN ('OPEN', 'PARTIALLY_PAID', 'OVERDUE')
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE
  `, [tenantId])
  if (existing.rowCount === 1) return existing.rows[0]

  const subscription = await getTenantSubscription(tenantId, client)
  if (!subscription.plan.is_active) throw new Error('The selected subscription plan is not active')

  const now = new Date()
  const paidThrough = subscription.subscription_end_date
    ? new Date(subscription.subscription_end_date)
    : null
  const periodStart = paidThrough && paidThrough > now ? paidThrough : now
  const periodEnd = new Date(periodStart)
  periodEnd.setUTCDate(periodEnd.getUTCDate() + subscription.plan.billing_interval_days)

  const created = await client.query<InvoiceRow>(`
    INSERT INTO subscription_invoices (
      tenant_id, plan_id, invoice_number, period_start, period_end,
      subtotal, tax_amount, total_amount, amount_paid, currency, status, due_at,
      metadata
    )
    VALUES ($1,$2,$3,$4,$5,$6,0,$6,0,$7,'OPEN',NOW() + INTERVAL '7 days',$8)
    RETURNING *
  `, [
    tenantId,
    subscription.plan.id,
    invoiceNumber(tenantId),
    periodStart,
    periodEnd,
    Number(subscription.plan.price_zmw),
    subscription.plan.currency,
    JSON.stringify({
      plan_code: subscription.plan.code,
      plan_version: subscription.plan.version,
      pricing_model: 'flat_monthly',
    }),
  ])
  return created.rows[0]
}

export async function ensureTenantInvoice(tenantId: string) {
  const client = await adminPool.connect()
  try {
    await client.query('BEGIN')
    const invoice = await ensureOpenInvoice(client, tenantId)
    await client.query('COMMIT')
    return invoice
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

export async function createPendingPayment(input: {
  tenantId: string
  provider: PaymentProvider
  providerReference: string
  payerMsisdn?: string | null
}) {
  const client = await adminPool.connect()
  try {
    await client.query('BEGIN')
    const invoice = await ensureOpenInvoice(client, input.tenantId)
    const amountDue = Math.max(Number(invoice.total_amount) - Number(invoice.amount_paid), 0)
    if (amountDue <= 0) throw new Error('This invoice is already paid')

    const pending = await client.query<PaymentRow>(`
      SELECT * FROM subscription_payments
      WHERE tenant_id = $1 AND invoice_id = $2 AND status = 'PENDING'
      ORDER BY requested_at DESC LIMIT 1
      FOR UPDATE
    `, [input.tenantId, invoice.id])
    if (pending.rowCount === 1) {
      if (pending.rows[0].provider !== input.provider) {
        throw new Error(`This invoice already has a pending ${pending.rows[0].provider} payment`)
      }
      await client.query('COMMIT')
      return { invoice, payment: pending.rows[0], reused: true }
    }

    const inserted = await client.query<PaymentRow>(`
      INSERT INTO subscription_payments (
        tenant_id, invoice_id, provider, provider_reference, amount, currency,
        status, payer_msisdn
      )
      VALUES ($1,$2,$3,$4,$5,$6,'PENDING',$7)
      RETURNING *
    `, [
      input.tenantId,
      invoice.id,
      input.provider,
      input.providerReference,
      amountDue,
      invoice.currency,
      input.payerMsisdn || null,
    ])
    await client.query('COMMIT')
    return { invoice, payment: inserted.rows[0], reused: false }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

export async function markPaymentFailed(input: {
  tenantId: string
  provider: PaymentProvider
  providerReference: string
  code?: string
  message?: string
}) {
  await adminPool.query(`
    UPDATE subscription_payments
    SET status = 'FAILED', failed_at = NOW(), failure_code = $4,
        failure_message = $5, updated_at = NOW()
    WHERE tenant_id = $1 AND provider = $2 AND provider_reference = $3
      AND status = 'PENDING'
  `, [input.tenantId, input.provider, input.providerReference, input.code || null, input.message || null])
}

export async function findTenantPayment(
  tenantId: string,
  provider: PaymentProvider,
  providerReference: string,
) {
  const result = await adminPool.query<PaymentRow>(`
    SELECT * FROM subscription_payments
    WHERE tenant_id = $1 AND provider = $2 AND provider_reference = $3
    LIMIT 1
  `, [tenantId, provider, providerReference])
  return result.rows[0] || null
}

export async function findPaymentByReference(provider: PaymentProvider, providerReference: string) {
  const result = await adminPool.query<PaymentRow>(`
    SELECT * FROM subscription_payments
    WHERE provider = $1 AND provider_reference = $2
    LIMIT 2
  `, [provider, providerReference])
  if ((result.rowCount ?? 0) > 1) throw new Error('Ambiguous payment reference')
  return result.rows[0] || null
}

export async function finalizeVerifiedPayment(input: {
  provider: PaymentProvider
  providerReference: string
  status: VerifiedPaymentStatus
  paidAmount?: number
  currency?: string
  providerTransactionId?: string | null
  providerMetadata?: Record<string, unknown>
}) {
  const client = await adminPool.connect()
  try {
    await client.query('BEGIN')
    const locked = await client.query<PaymentRow & {
      period_end: string
      invoice_total: string
      invoice_amount_paid: string
      invoice_status: string
    }>(`
      SELECT payment.*, invoice.period_end, invoice.total_amount AS invoice_total,
             invoice.amount_paid AS invoice_amount_paid, invoice.status AS invoice_status
      FROM subscription_payments AS payment
      JOIN subscription_invoices AS invoice
        ON invoice.id = payment.invoice_id AND invoice.tenant_id = payment.tenant_id
      WHERE payment.provider = $1 AND payment.provider_reference = $2
      FOR UPDATE OF payment, invoice
    `, [input.provider, input.providerReference])
    if (locked.rowCount !== 1) throw new Error('Payment reference was not found')

    const payment = locked.rows[0]
    if (payment.status !== 'PENDING') {
      await client.query('COMMIT')
      return { payment, changed: false, receipt: null }
    }
    if (input.status === 'PENDING') {
      await client.query('COMMIT')
      return { payment, changed: false, receipt: null }
    }

    if (input.status === 'FAILED') {
      const failed = await client.query<PaymentRow>(`
        UPDATE subscription_payments
        SET status = 'FAILED', failed_at = NOW(), provider_transaction_id = COALESCE($2, provider_transaction_id),
            provider_metadata = provider_metadata || $3::jsonb, updated_at = NOW()
        WHERE id = $1 AND status = 'PENDING'
        RETURNING *
      `, [payment.id, input.providerTransactionId || null, JSON.stringify(input.providerMetadata || {})])
      await client.query('COMMIT')
      return { payment: failed.rows[0], changed: true, receipt: null }
    }

    const paidAmount = Number(input.paidAmount)
    const paidCurrency = String(input.currency || '').toUpperCase()
    const expectedAmount = Number(payment.amount)
    if (!Number.isFinite(paidAmount) || Math.abs(paidAmount - expectedAmount) > 0.005) {
      throw new Error('Verified payment amount does not exactly match the payment request')
    }
    if (paidCurrency !== String(payment.currency).toUpperCase()) {
      throw new Error('Verified payment currency does not match the invoice')
    }
    if (['PAID', 'VOID'].includes(locked.rows[0].invoice_status)) {
      throw new Error('The linked invoice is no longer payable; manual reconciliation is required')
    }
    const invoiceBalance = Number(locked.rows[0].invoice_total) - Number(locked.rows[0].invoice_amount_paid)
    if (Math.abs(invoiceBalance - expectedAmount) > 0.005) {
      throw new Error('The verified payment no longer matches the invoice balance')
    }

    const succeeded = await client.query<PaymentRow>(`
      UPDATE subscription_payments
      SET status = 'SUCCEEDED', succeeded_at = NOW(), provider_transaction_id = COALESCE($3, provider_transaction_id),
          provider_metadata = provider_metadata || $4::jsonb, updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2 AND status = 'PENDING'
      RETURNING *
    `, [payment.id, payment.tenant_id, input.providerTransactionId || null, JSON.stringify(input.providerMetadata || {})])
    if (succeeded.rowCount !== 1) throw new Error('Payment state changed during reconciliation')

    const invoice = await client.query<InvoiceRow>(`
      UPDATE subscription_invoices
      SET amount_paid = amount_paid + $3,
          status = CASE WHEN amount_paid + $3 >= total_amount THEN 'PAID' ELSE 'PARTIALLY_PAID' END,
          paid_at = CASE WHEN amount_paid + $3 >= total_amount THEN NOW() ELSE paid_at END,
          updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2
      RETURNING *
    `, [payment.invoice_id, payment.tenant_id, Number(payment.amount)])

    await client.query(`
      UPDATE tenants
      SET status = 'ACTIVE',
          subscription_end_date = GREATEST(
            COALESCE(subscription_end_date, NOW()),
            $2::timestamptz
          ),
          updated_at = NOW()
      WHERE id = $1
    `, [payment.tenant_id, locked.rows[0].period_end])
    await client.query(`
      UPDATE onboarding_sessions
      SET converted_to_paid = TRUE,
          conversion_date = COALESCE(conversion_date, NOW()),
          updated_at = NOW()
      WHERE tenant_id = $1
    `, [payment.tenant_id])
    await client.query(`
      INSERT INTO billing_events (
        tenant_id, event_type, amount, currency, status, effective_at, metadata
      ) VALUES ($1,'PAYMENT_RECEIVED',$2,$3,'POSTED',NOW(),$4)
    `, [
      payment.tenant_id,
      Number(payment.amount),
      payment.currency,
      JSON.stringify({
        payment_id: payment.id,
        invoice_id: payment.invoice_id,
        provider: payment.provider,
        provider_reference: payment.provider_reference,
      }),
    ])

    const contact = await client.query(`
      SELECT tenant.name, settings.owner_email
      FROM tenants AS tenant
      LEFT JOIN tenant_settings AS settings ON settings.tenant_id = tenant.id
      WHERE tenant.id = $1
    `, [payment.tenant_id])
    await client.query('COMMIT')

    return {
      payment: succeeded.rows[0],
      invoice: invoice.rows[0],
      changed: true,
      receipt: contact.rows[0]?.owner_email ? {
        email: contact.rows[0].owner_email as string,
        businessName: contact.rows[0].name as string,
        referenceId: payment.provider_reference,
        amount: Number(payment.amount),
        currency: payment.currency,
        payerMsisdn: payment.payer_msisdn,
      } : null,
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

export async function recordProviderEvent(input: {
  provider: PaymentProvider
  eventId: string
  eventType: string
  paymentId?: string | null
  tenantId?: string | null
  payload: Record<string, unknown>
  status: 'PROCESSED' | 'IGNORED' | 'FAILED'
  error?: string | null
}) {
  const serialized = JSON.stringify(input.payload)
  await adminPool.query(`
    INSERT INTO private.payment_provider_events (
      provider, provider_event_id, payment_id, tenant_id, event_type,
      payload_hash, payload, processing_status, processing_error, processed_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
    ON CONFLICT (provider, provider_event_id) DO NOTHING
  `, [
    input.provider,
    input.eventId,
    input.paymentId || null,
    input.tenantId || null,
    input.eventType,
    createHash('sha256').update(serialized).digest('hex'),
    serialized,
    input.status,
    input.error || null,
  ])
}

export async function getTenantBillingOverview(tenantId: string) {
  const [subscription, invoiceRows, paymentRows] = await Promise.all([
    getTenantSubscription(tenantId),
    adminPool.query<InvoiceRow>(`
      SELECT * FROM subscription_invoices
      WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 12
    `, [tenantId]),
    adminPool.query<PaymentRow>(`
      SELECT * FROM subscription_payments
      WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 20
    `, [tenantId]),
  ])

  const openInvoice = invoiceRows.rows.find((row) => ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'].includes(row.status)) || null
  return {
    subscription,
    openInvoice,
    amountDue: openInvoice
      ? Math.max(Number(openInvoice.total_amount) - Number(openInvoice.amount_paid), 0)
      : Number(subscription.plan.price_zmw),
    invoices: invoiceRows.rows,
    payments: paymentRows.rows,
  }
}
