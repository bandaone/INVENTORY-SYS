import { NextResponse } from 'next/server'
import { adminPool } from '@/lib/db'
import { sendSubscriptionReceiptEmail } from '@/lib/email'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function getVerifiedMomoStatus(referenceId: string) {
  const subscriptionKey = process.env.MTN_MOMO_SUBSCRIPTION_KEY
  const apiUser = process.env.MTN_MOMO_API_USER
  const apiKey = process.env.MTN_MOMO_API_KEY
  const environment = process.env.MTN_MOMO_ENVIRONMENT

  // Never let an unauthenticated callback mutate billing from its body alone.
  // Local sandbox payments use the authenticated sandbox-pay route instead.
  if (!subscriptionKey || !apiUser || !apiKey || !environment || subscriptionKey === 'sandbox') {
    return null
  }

  const host = environment === 'sandbox'
    ? 'sandbox.momodeveloper.mtn.com'
    : 'momodeveloper.mtn.com'
  const auth = Buffer.from(`${apiUser}:${apiKey}`).toString('base64')
  const tokenResponse = await fetch(`https://${host}/collection/token/`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Ocp-Apim-Subscription-Key': subscriptionKey,
    },
    signal: AbortSignal.timeout(10_000),
  })
  if (!tokenResponse.ok) throw new Error('Unable to authenticate payment status check')

  const token = await tokenResponse.json()
  const statusResponse = await fetch(
    `https://${host}/collection/v1_0/requesttopay/${encodeURIComponent(referenceId)}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        'X-Target-Environment': environment,
        'Ocp-Apim-Subscription-Key': subscriptionKey,
      },
      signal: AbortSignal.timeout(10_000),
    }
  )
  if (!statusResponse.ok) throw new Error('Unable to verify payment status')

  const verified = await statusResponse.json()
  return ['PENDING', 'SUCCESSFUL', 'FAILED'].includes(verified?.status)
    ? {
        status: verified.status as 'PENDING' | 'SUCCESSFUL' | 'FAILED',
        amount: Number(verified.amount),
        currency: String(verified.currency || '').toUpperCase(),
      }
    : null
}

export async function POST(req: Request) {
  try {
    const payload = await req.json()
    const referenceId = String(payload?.referenceId || '').trim()
    if (!UUID_PATTERN.test(referenceId)) {
      return new NextResponse('Invalid reference', { status: 400 })
    }

    // Reject unknown references locally before spending provider API quota.
    // Keep the response generic so this endpoint is not a payment oracle.
    const localReference = await adminPool.query(
      `SELECT 1 FROM billing_history WHERE reference_id = $1 AND status = 'PENDING' LIMIT 2`,
      [referenceId]
    )
    if ((localReference.rowCount ?? 0) === 0) return new NextResponse('OK', { status: 200 })
    if ((localReference.rowCount ?? 0) !== 1) {
      throw new Error('Ambiguous payment reference; manual reconciliation required')
    }

    // MTN callback documentation does not guarantee a cryptographic signature.
    // Treat the callback only as a notification and independently query MTN's
    // authenticated status API before changing any tenant or payment record.
    const verifiedPayment = await getVerifiedMomoStatus(referenceId)
    if (!verifiedPayment) {
      return new NextResponse('Payment verification unavailable', { status: 503 })
    }
    if (verifiedPayment.status === 'PENDING') return new NextResponse('OK', { status: 200 })

    const client = await adminPool.connect()
    let receipt: null | {
      email: string
      referenceId: string
      amount: number
      currency: string
      payerMsisdn: string | null
    } = null

    try {
      await client.query('BEGIN')
      const pending = await client.query(`
        SELECT id, tenant_id, reference_id, amount, currency, payer_msisdn
        FROM billing_history
        WHERE reference_id = $1 AND status = 'PENDING'
        FOR UPDATE
      `, [referenceId])

      if ((pending.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK')
        return new NextResponse('OK', { status: 200 })
      }
      if ((pending.rowCount ?? 0) !== 1) {
        throw new Error('Ambiguous payment reference; manual reconciliation required')
      }

      const billing = pending.rows[0]
      if (verifiedPayment.status === 'SUCCESSFUL') {
        if (
          !Number.isFinite(verifiedPayment.amount)
          || verifiedPayment.amount < Number(billing.amount)
          || verifiedPayment.currency !== String(billing.currency).toUpperCase()
        ) {
          throw new Error('Verified payment does not match the pending invoice')
        }
      }

      await client.query(`
        UPDATE billing_history
        SET status = $1, updated_at = NOW()
        WHERE id = $2 AND status = 'PENDING'
      `, [verifiedPayment.status, billing.id])

      if (verifiedPayment.status === 'SUCCESSFUL') {
        const tenant = await client.query(`
          SELECT tenant.id, tenant.subscription_end_date, settings.owner_email
          FROM tenants AS tenant
          LEFT JOIN tenant_settings AS settings ON settings.tenant_id = tenant.id
          WHERE tenant.id = $1
          FOR UPDATE OF tenant
        `, [billing.tenant_id])

        if ((tenant.rowCount ?? 0) !== 1) throw new Error('Payment tenant not found')
        let newEndDate = new Date()
        const currentEndDate = tenant.rows[0].subscription_end_date
          ? new Date(tenant.rows[0].subscription_end_date)
          : null
        if (currentEndDate && currentEndDate > newEndDate) newEndDate = currentEndDate
        newEndDate.setDate(newEndDate.getDate() + 30)

        await client.query(`
          UPDATE tenants
          SET status = 'ACTIVE', subscription_end_date = $1, updated_at = NOW()
          WHERE id = $2
        `, [newEndDate, billing.tenant_id])

        if (tenant.rows[0].owner_email) {
          receipt = {
            email: tenant.rows[0].owner_email,
            referenceId: billing.reference_id,
            amount: billing.amount,
            currency: billing.currency,
            payerMsisdn: billing.payer_msisdn,
          }
        }
      }

      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }

    if (receipt) {
      await sendSubscriptionReceiptEmail(receipt.email, {
        referenceId: receipt.referenceId,
        date: new Date().toISOString(),
        amount: receipt.amount,
        currency: receipt.currency,
        payerMsisdn: receipt.payerMsisdn,
      })
    }

    return new NextResponse('OK', { status: 200 })
  } catch (error) {
    console.error('[MTN Callback Error]', error)
    return new NextResponse('Internal Server Error', { status: 500 })
  }
}
