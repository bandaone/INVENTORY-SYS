import {
  finalizeVerifiedPayment,
  findPaymentByReference,
  recordProviderEvent,
} from '@/lib/billing'
import { sendSubscriptionReceiptEmail } from '@/lib/email'
import { NextResponse } from 'next/server'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function getVerifiedMomoStatus(referenceId: string) {
  const subscriptionKey = process.env.MTN_MOMO_SUBSCRIPTION_KEY
  const apiUser = process.env.MTN_MOMO_API_USER
  const apiKey = process.env.MTN_MOMO_API_KEY
  const environment = process.env.MTN_MOMO_ENVIRONMENT
  if (!subscriptionKey || !apiUser || !apiKey || !environment || subscriptionKey === 'sandbox') return null

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
  if (!tokenResponse.ok) throw new Error('Unable to authenticate the MTN status check')

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
    },
  )
  if (!statusResponse.ok) throw new Error('Unable to verify the MTN payment status')

  const verified = await statusResponse.json()
  if (!['PENDING', 'SUCCESSFUL', 'FAILED'].includes(verified?.status)) return null
  return {
    status: verified.status as 'PENDING' | 'SUCCESSFUL' | 'FAILED',
    amount: Number(verified.amount),
    currency: String(verified.currency || '').toUpperCase(),
    financialTransactionId: verified.financialTransactionId
      ? String(verified.financialTransactionId)
      : null,
    externalId: verified.externalId ? String(verified.externalId) : null,
  }
}

export async function POST(req: Request) {
  const startedAt = Date.now()
  let referenceId = ''
  try {
    const payload = await req.json().catch(() => ({}))
    referenceId = String(payload?.referenceId || '').trim()
    if (!UUID_PATTERN.test(referenceId)) return new NextResponse('Invalid reference', { status: 400 })

    const localPayment = await findPaymentByReference('MTN_MOMO', referenceId)
    if (!localPayment || localPayment.status !== 'PENDING') return new NextResponse('OK', { status: 200 })

    // MTN callbacks are notifications, not proof. Always query the authenticated
    // provider status endpoint before changing billing state.
    const verified = await getVerifiedMomoStatus(referenceId)
    if (!verified) return new NextResponse('Payment verification unavailable', { status: 503 })

    const result = await finalizeVerifiedPayment({
      provider: 'MTN_MOMO',
      providerReference: referenceId,
      status: verified.status === 'SUCCESSFUL' ? 'SUCCEEDED' : verified.status,
      paidAmount: verified.amount,
      currency: verified.currency,
      providerTransactionId: verified.financialTransactionId,
      providerMetadata: {
        external_id: verified.externalId,
        verified_status: verified.status,
      },
    })
    await recordProviderEvent({
      provider: 'MTN_MOMO',
      eventId: `verified:${referenceId}:${verified.status}`,
      eventType: 'request_to_pay_status',
      paymentId: localPayment.id,
      tenantId: localPayment.tenant_id,
      payload: {
        reference_id: referenceId,
        status: verified.status,
        amount: verified.amount,
        currency: verified.currency,
        financial_transaction_id: verified.financialTransactionId,
      },
      status: verified.status === 'PENDING' ? 'IGNORED' : 'PROCESSED',
    })

    if (result.receipt) {
      await sendSubscriptionReceiptEmail(result.receipt.email, {
        referenceId: result.receipt.referenceId,
        date: new Date().toISOString(),
        amount: result.receipt.amount,
        currency: result.receipt.currency,
        payerMsisdn: result.receipt.payerMsisdn,
      }).catch((error) => console.error(JSON.stringify({
        level: 'error', message: 'Subscription receipt email failed', referenceId,
        error: error instanceof Error ? error.message : String(error),
      })))
    }

    console.log(JSON.stringify({
      level: 'info', message: 'MTN callback reconciled', referenceId,
      status: verified.status, changed: result.changed, durationMs: Date.now() - startedAt,
    }))
    return new NextResponse('OK', { status: 200 })
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error', message: 'MTN callback failed', referenceId,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    }))
    return new NextResponse('Internal Server Error', { status: 500 })
  }
}
