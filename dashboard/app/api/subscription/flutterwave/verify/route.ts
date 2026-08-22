export const dynamic = 'force-dynamic'

import { finalizeVerifiedPayment, findTenantPayment, recordProviderEvent } from '@/lib/billing'
import { sendSubscriptionReceiptEmail } from '@/lib/email'
import { requireTenantSession, SessionError } from '@/lib/session'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  try {
    const { tenantId } = await requireTenantSession(['owner'], { allowSuspended: true })
    const { transaction_id: transactionId } = await req.json()
    if (!/^\d{1,30}$/.test(String(transactionId || ''))) {
      return NextResponse.json({ error: 'Invalid transaction ID' }, { status: 400 })
    }

    const secret = process.env.FLUTTERWAVE_SECRET_KEY
    if (!secret) return NextResponse.json({ error: 'Payment provider is not configured' }, { status: 503 })

    const response = await fetch(
      `https://api.flutterwave.com/v3/transactions/${encodeURIComponent(String(transactionId))}/verify`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10_000),
      },
    )
    if (!response.ok) return NextResponse.json({ error: 'Payment verification failed' }, { status: 502 })

    const verified = await response.json()
    if (verified?.status !== 'success' || verified?.data?.status !== 'successful') {
      return NextResponse.json({ error: 'Payment has not succeeded' }, { status: 409 })
    }

    const referenceId = String(verified.data.tx_ref || '')
    const pending = await findTenantPayment(tenantId, 'FLUTTERWAVE', referenceId)
    if (!pending) {
      return NextResponse.json({ error: 'No matching payment request was found' }, { status: 404 })
    }

    const result = await finalizeVerifiedPayment({
      provider: 'FLUTTERWAVE',
      providerReference: referenceId,
      status: 'SUCCEEDED',
      paidAmount: Number(verified.data.amount),
      currency: String(verified.data.currency || '').toUpperCase(),
      providerTransactionId: String(verified.data.id),
      providerMetadata: {
        processor_response: verified.data.processor_response || null,
        payment_type: verified.data.payment_type || null,
      },
    })
    await recordProviderEvent({
      provider: 'FLUTTERWAVE',
      eventId: `verify:${verified.data.id}`,
      eventType: 'transaction_verify',
      paymentId: pending.id,
      tenantId,
      payload: {
        transaction_id: String(verified.data.id),
        reference_id: referenceId,
        amount: Number(verified.data.amount),
        currency: String(verified.data.currency || '').toUpperCase(),
      },
      status: 'PROCESSED',
    })

    if (result.receipt) {
      await sendSubscriptionReceiptEmail(result.receipt.email, {
        referenceId: result.receipt.referenceId,
        date: new Date().toISOString(),
        amount: result.receipt.amount,
        currency: result.receipt.currency,
        payerMsisdn: result.receipt.payerMsisdn,
      }).catch((error) => console.error('[Flutterwave Receipt Email]', error))
    }

    return NextResponse.json({ success: true, status: result.payment.status })
  } catch (error) {
    if (error instanceof SessionError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('[Flutterwave Verify Error]', error)
    return NextResponse.json({ error: 'Payment verification failed' }, { status: 500 })
  }
}
