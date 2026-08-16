export const dynamic = 'force-dynamic'

import { createPendingPayment, finalizeVerifiedPayment } from '@/lib/billing'
import { requireTenantSession, SessionError } from '@/lib/session'
import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'

export async function POST() {
  try {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const { tenantId } = await requireTenantSession(['owner'], { allowSuspended: true })
    const referenceId = randomUUID()
    const { payment } = await createPendingPayment({
      tenantId,
      provider: 'SANDBOX',
      providerReference: referenceId,
    })
    const result = await finalizeVerifiedPayment({
      provider: 'SANDBOX',
      providerReference: payment.provider_reference,
      status: 'SUCCEEDED',
      paidAmount: Number(payment.amount),
      currency: payment.currency,
      providerTransactionId: `SANDBOX-${randomUUID()}`,
      providerMetadata: { simulated: true },
    })
    return NextResponse.json({
      success: true,
      status: result.payment.status,
      referenceId: payment.provider_reference,
    })
  } catch (error) {
    if (error instanceof SessionError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('[Sandbox Payment Error]', error)
    return NextResponse.json({ error: 'Payment simulation failed' }, { status: 500 })
  }
}
