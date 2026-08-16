export const dynamic = 'force-dynamic'

import crypto from 'crypto'
import { createPendingPayment, markPaymentFailed } from '@/lib/billing'
import { requireTenantSession, SessionError } from '@/lib/session'
import { NextResponse } from 'next/server'

function providerConfig() {
  const subscriptionKey = process.env.MTN_MOMO_SUBSCRIPTION_KEY || ''
  const apiUser = process.env.MTN_MOMO_API_USER || ''
  const apiKey = process.env.MTN_MOMO_API_KEY || ''
  const environment = process.env.MTN_MOMO_ENVIRONMENT || ''
  const configured = Boolean(subscriptionKey && apiUser && apiKey && environment)
    && ![subscriptionKey, apiUser, apiKey, environment].includes('sandbox')
  return { subscriptionKey, apiUser, apiKey, environment, configured }
}

function providerHost(environment: string) {
  return environment === 'sandbox'
    ? 'sandbox.momodeveloper.mtn.com'
    : 'momodeveloper.mtn.com'
}

export async function POST(req: Request) {
  const startedAt = Date.now()
  let tenantId: string | null = null
  let referenceId: string | null = null

  try {
    const session = await requireTenantSession(['owner'], { allowSuspended: true })
    tenantId = session.tenantId
    const body = await req.json()
    const normalizedPhone = String(body.phoneNumber || '').replace(/[\s()-]/g, '')
    if (!/^\+?\d{10,15}$/.test(normalizedPhone)) {
      return NextResponse.json({ error: 'Enter a valid mobile money number' }, { status: 400 })
    }

    const config = providerConfig()
    if (process.env.NODE_ENV === 'production' && !config.configured) {
      return NextResponse.json({ error: 'Payment provider is not configured for production' }, { status: 503 })
    }

    referenceId = crypto.randomUUID()
    const currency = config.environment === 'sandbox' ? 'EUR' : 'ZMW'
    const pending = await createPendingPayment({
      tenantId,
      provider: 'MTN_MOMO',
      providerReference: referenceId,
      payerMsisdn: normalizedPhone,
    })

    if (pending.reused) {
      return NextResponse.json({
        success: true,
        reused: true,
        message: 'Resuming the existing payment request',
        referenceId: pending.payment.provider_reference,
        amount: Number(pending.payment.amount),
        currency: pending.payment.currency,
      })
    }

    referenceId = pending.payment.provider_reference
    const expectedAmount = Number(pending.payment.amount)
    const expectedCurrency = String(pending.payment.currency).toUpperCase()
    if (expectedCurrency !== currency) {
      await markPaymentFailed({
        tenantId,
        provider: 'MTN_MOMO',
        providerReference: referenceId,
        code: 'CURRENCY_CONFIGURATION_MISMATCH',
        message: 'Invoice currency does not match the configured MTN environment',
      })
      return NextResponse.json({ error: 'Payment currency is not configured correctly' }, { status: 503 })
    }

    // Provider I/O happens after the short invoice/payment transaction commits.
    const host = providerHost(config.environment)
    const authString = Buffer.from(`${config.apiUser}:${config.apiKey}`).toString('base64')
    let accessToken = 'sandbox-token'
    if (config.subscriptionKey !== 'sandbox') {
      const tokenResponse = await fetch(`https://${host}/collection/token/`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${authString}`,
          'Ocp-Apim-Subscription-Key': config.subscriptionKey,
        },
        signal: AbortSignal.timeout(10_000),
      })
      if (!tokenResponse.ok) throw new Error('MTN authentication failed')
      accessToken = String((await tokenResponse.json()).access_token || '')
      if (!accessToken) throw new Error('MTN returned an invalid access token')
    }

    if (config.subscriptionKey !== 'sandbox') {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        'X-Reference-Id': referenceId,
        'X-Target-Environment': config.environment,
        'Ocp-Apim-Subscription-Key': config.subscriptionKey,
        'Content-Type': 'application/json',
      }
      const baseUrl = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || ''
      if (config.environment !== 'sandbox' && /^https:\/\//.test(baseUrl)) {
        headers['X-Callback-Url'] = `${baseUrl.replace(/\/$/, '')}/api/subscription/momo/callback`
      }

      const paymentResponse = await fetch(`https://${host}/collection/v1_0/requesttopay`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          amount: expectedAmount.toFixed(2),
          currency: expectedCurrency,
          externalId: `ROS-${pending.invoice.invoice_number}`,
          payer: {
            partyIdType: 'MSISDN',
            partyId: normalizedPhone.replace(/^\+/, ''),
          },
          payerMessage: `Retail OS ${pending.invoice.invoice_number}`,
          payeeNote: 'Retail OS subscription',
        }),
        signal: AbortSignal.timeout(10_000),
      })
      if (!paymentResponse.ok && paymentResponse.status !== 202) {
        const providerMessage = await paymentResponse.text().catch(() => '')
        await markPaymentFailed({
          tenantId,
          provider: 'MTN_MOMO',
          providerReference: referenceId,
          code: `HTTP_${paymentResponse.status}`,
          message: providerMessage.slice(0, 500),
        })
        return NextResponse.json({ error: 'MTN rejected the payment request' }, { status: 502 })
      }
    }

    console.log(JSON.stringify({
      level: 'info',
      message: 'MTN payment requested',
      route: '/api/subscription/momo/request-to-pay',
      tenantId,
      referenceId,
      amount: expectedAmount,
      currency: expectedCurrency,
      durationMs: Date.now() - startedAt,
    }))
    return NextResponse.json({
      success: true,
      message: 'USSD prompt sent to the payment phone',
      referenceId,
      invoiceId: pending.invoice.id,
      invoiceNumber: pending.invoice.invoice_number,
      amount: expectedAmount,
      currency: expectedCurrency,
    })
  } catch (error) {
    if (tenantId && referenceId) {
      await markPaymentFailed({
        tenantId,
        provider: 'MTN_MOMO',
        providerReference: referenceId,
        code: 'PROVIDER_REQUEST_FAILED',
        message: error instanceof Error ? error.message.slice(0, 500) : 'Unknown provider error',
      }).catch(() => undefined)
    }
    if (error instanceof SessionError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error(JSON.stringify({
      level: 'error',
      message: 'MTN payment request failed',
      route: '/api/subscription/momo/request-to-pay',
      tenantId,
      referenceId,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    }))
    return NextResponse.json({ error: 'Unable to start the payment request' }, { status: 502 })
  }
}
