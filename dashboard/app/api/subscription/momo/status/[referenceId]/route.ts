export const dynamic = 'force-dynamic'

import { finalizeVerifiedPayment, findTenantPayment, recordProviderEvent } from '@/lib/billing'
import { sendSubscriptionReceiptEmail } from '@/lib/email'
import { requireTenantSession, SessionError } from '@/lib/session'
import { NextResponse } from 'next/server'

export async function GET(_req: Request, props: { params: Promise<{ referenceId: string }> }) {
  const params = await props.params;
  try {
    const session = await requireTenantSession(['owner'], { allowSuspended: true })
    const referenceId = String(params.referenceId || '').trim()
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(referenceId)) {
      return NextResponse.json({ error: 'Invalid payment reference' }, { status: 400 })
    }

    const payment = await findTenantPayment(session.tenantId, 'MTN_MOMO', referenceId)
    if (!payment) return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    if (payment.status !== 'PENDING') return NextResponse.json({ status: payment.status })

    const subscriptionKey = process.env.MTN_MOMO_SUBSCRIPTION_KEY || ''
    const apiUser = process.env.MTN_MOMO_API_USER || ''
    const apiKey = process.env.MTN_MOMO_API_KEY || ''
    const environment = process.env.MTN_MOMO_ENVIRONMENT || ''
    if (!subscriptionKey || !apiUser || !apiKey || !environment || subscriptionKey === 'sandbox') {
      return NextResponse.json({ status: 'PENDING' })
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
    if (!tokenResponse.ok) return NextResponse.json({ status: 'PENDING' })
    const accessToken = String((await tokenResponse.json()).access_token || '')
    if (!accessToken) return NextResponse.json({ status: 'PENDING' })

    const statusResponse = await fetch(
      `https://${host}/collection/v1_0/requesttopay/${encodeURIComponent(referenceId)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Target-Environment': environment,
          'Ocp-Apim-Subscription-Key': subscriptionKey,
        },
        signal: AbortSignal.timeout(10_000),
      },
    )
    if (!statusResponse.ok) return NextResponse.json({ status: 'PENDING' })
    const verified = await statusResponse.json()
    if (!['PENDING', 'SUCCESSFUL', 'FAILED'].includes(verified?.status)) {
      return NextResponse.json({ status: 'PENDING' })
    }

    const result = await finalizeVerifiedPayment({
      provider: 'MTN_MOMO',
      providerReference: referenceId,
      status: verified.status === 'SUCCESSFUL' ? 'SUCCEEDED' : verified.status,
      paidAmount: Number(verified.amount),
      currency: String(verified.currency || '').toUpperCase(),
      providerTransactionId: verified.financialTransactionId
        ? String(verified.financialTransactionId)
        : null,
      providerMetadata: {
        external_id: verified.externalId ? String(verified.externalId) : null,
        verified_status: verified.status,
      },
    })
    await recordProviderEvent({
      provider: 'MTN_MOMO',
      eventId: `poll:${referenceId}:${verified.status}`,
      eventType: 'status_poll',
      paymentId: payment.id,
      tenantId: payment.tenant_id,
      payload: {
        reference_id: referenceId,
        status: verified.status,
        amount: Number(verified.amount),
        currency: String(verified.currency || '').toUpperCase(),
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
      }).catch((error) => console.error('Subscription receipt email failed:', error))
    }

    return NextResponse.json({
      status: verified.status === 'SUCCESSFUL' ? 'SUCCEEDED' : verified.status,
    })
  } catch (error) {
    if (error instanceof SessionError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('[MTN Status Poll Error]', error)
    return NextResponse.json({ error: 'Unable to verify payment status' }, { status: 502 })
  }
}
