'use client'

import {
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  CreditCard,
  Download,
  Loader2,
  ShieldCheck,
  Store,
  Users,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

type Plan = {
  code: string
  name: string
  description: string | null
  price_zmw: string
  currency: string
  max_locations: number
  max_users: number
  features: string[]
}

type Subscription = {
  tenant_name: string
  tenant_status: string
  subscription_end_date: string | null
  active_locations: number
  active_users: number
  plan: Plan
}

type Payment = {
  id: string
  provider: string
  provider_reference: string
  amount: string
  currency: string
  status: string
  created_at: string
  succeeded_at: string | null
}

type BillingResponse = {
  billing: {
    subscription: Subscription
    amountDue: number
    openInvoice: { invoice_number: string; due_at: string; status: string } | null
    payments: Payment[]
  }
}

const money = (amount: number, currency = 'ZMW') =>
  new Intl.NumberFormat('en-ZM', { style: 'currency', currency }).format(amount)

export default function SubscriptionPage() {
  const [data, setData] = useState<BillingResponse['billing'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [paying, setPaying] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('260')

  const loadBilling = useCallback(async () => {
    try {
      const response = await fetch('/api/settings', { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Unable to load billing')
      setData((payload as BillingResponse).billing)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load billing')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadBilling()
  }, [loadBilling])

  const pollPaymentStatus = useCallback(async (referenceId: string) => {
    for (let attempt = 0; attempt < 18; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, attempt === 0 ? 1500 : 5000))
      const response = await fetch(`/api/subscription/momo/status/${encodeURIComponent(referenceId)}`, {
        cache: 'no-store',
      }).catch(() => null)
      if (!response?.ok) continue
      const result = await response.json()
      if (result.status === 'SUCCEEDED') {
        setNotice('Payment confirmed. Your subscription is active.')
        await loadBilling()
        return
      }
      if (result.status === 'FAILED') {
        throw new Error('MTN declined or cancelled the payment request.')
      }
    }
    setNotice('MTN is still processing this payment. You can safely leave this page; reconciliation will continue.')
  }, [loadBilling])

  const handleMtnPayment = async () => {
    if (!/^260\d{9}$/.test(phoneNumber)) {
      setError('Enter a Zambian MTN number in the format 26096XXXXXXX.')
      return
    }

    setPaying(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch('/api/subscription/momo/request-to-pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Unable to start payment')
      setNotice(result.message || 'Approve the payment prompt on your phone.')
      if (result.referenceId) await pollPaymentStatus(result.referenceId)
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : 'Unable to process payment')
    } finally {
      setPaying(false)
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'grid', minHeight: '60vh', placeItems: 'center', color: 'var(--primary)' }}>
        <Loader2 size={36} className="spin" aria-label="Loading subscription" />
      </div>
    )
  }

  if (!data) {
    return <div className="glass-panel" style={{ padding: 24, color: 'var(--danger)' }}>{error || 'Billing is unavailable.'}</div>
  }

  const { subscription, payments, openInvoice, amountDue } = data
  const isActive = subscription.tenant_status === 'ACTIVE'
  const canPay = !isActive || Boolean(openInvoice)
  const paidThrough = subscription.subscription_end_date
    ? new Date(subscription.subscription_end_date).toLocaleDateString('en-ZM', { dateStyle: 'long' })
    : 'Trial period'

  return (
    <div className="animate-fade-in" style={{ paddingBottom: 60 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, alignItems: 'flex-start', marginBottom: 32, flexWrap: 'wrap' }}>
        <div>
          <h1>Billing & Subscription</h1>
          <p className="subtitle">Plan capacity, invoices, and verified payment history for {subscription.tenant_name}.</p>
        </div>
        <a
          href="mailto:billing@retailos.com?subject=Retail%20OS%20plan%20change"
          style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--primary)', color: '#0f1115', padding: '10px 18px', borderRadius: 8, fontWeight: 700, textDecoration: 'none' }}
        >
          <ArrowUpRight size={18} /> Change plan
        </a>
      </div>

      {notice && (
        <div role="status" style={{ padding: '14px 18px', background: 'var(--primary-glow)', border: '1px solid var(--primary)', color: 'var(--primary)', borderRadius: 10, marginBottom: 20, display: 'flex', gap: 10 }}>
          <CheckCircle2 size={20} /> {notice}
        </div>
      )}
      {error && (
        <div role="alert" style={{ padding: '14px 18px', background: 'rgba(239,68,68,.1)', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 10, marginBottom: 20 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 24, alignItems: 'start' }}>
        <section className="glass-panel" style={{ padding: 32 }} aria-labelledby="active-plan-heading">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', marginBottom: 24 }}>
            <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
              <div style={{ width: 48, height: 48, display: 'grid', placeItems: 'center', borderRadius: 12, background: 'var(--primary-glow)', color: 'var(--primary)' }}>
                <Store size={24} />
              </div>
              <div>
                <h2 id="active-plan-heading" style={{ margin: 0, fontSize: 21 }}>{subscription.plan.name}</h2>
                <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 3 }}>Paid through {paidThrough}</div>
              </div>
            </div>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 999, background: isActive ? 'var(--primary-glow)' : 'rgba(245,158,11,.1)', color: isActive ? 'var(--primary)' : 'var(--warning)', fontSize: 12, fontWeight: 800 }}>
              <ShieldCheck size={14} /> {subscription.tenant_status}
            </span>
          </div>

          <div style={{ padding: 22, background: 'var(--hover-bg)', border: '1px solid var(--panel-border)', borderRadius: 12, marginBottom: 22 }}>
            <div style={{ color: 'var(--text-muted)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700 }}>
              {openInvoice ? `${openInvoice.invoice_number} · ${openInvoice.status}` : 'Plan price per billing cycle'}
            </div>
            <div style={{ fontSize: 38, fontWeight: 800, marginTop: 6 }}>
              {money(openInvoice ? amountDue : Number(subscription.plan.price_zmw), subscription.plan.currency)}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 }}>
            <div style={{ padding: 14, border: '1px solid var(--panel-border)', borderRadius: 10 }}>
              <Store size={17} color="var(--secondary)" />
              <div style={{ marginTop: 8, fontWeight: 700 }}>{subscription.active_locations} / {subscription.plan.max_locations}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Active stores</div>
            </div>
            <div style={{ padding: 14, border: '1px solid var(--panel-border)', borderRadius: 10 }}>
              <Users size={17} color="var(--secondary)" />
              <div style={{ marginTop: 8, fontWeight: 700 }}>{subscription.active_users} / {subscription.plan.max_users}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Active users</div>
            </div>
          </div>

          <div style={{ display: 'grid', gap: 11 }}>
            {subscription.plan.features.map((feature) => (
              <div key={feature} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 14 }}>
                <CheckCircle2 size={17} color="var(--primary)" /> {feature}
              </div>
            ))}
          </div>

          {canPay && (
            <div style={{ marginTop: 28, paddingTop: 24, borderTop: '1px dashed var(--panel-border)' }}>
              <h3 style={{ margin: '0 0 7px', fontSize: 16 }}>Pay securely with MTN MoMo</h3>
              <p style={{ margin: '0 0 16px', color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.5 }}>
                The amount is taken from your server-issued invoice; it cannot be changed in the browser.
              </p>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <input
                  aria-label="MTN Mobile Money number"
                  inputMode="numeric"
                  value={phoneNumber}
                  onChange={(event) => setPhoneNumber(event.target.value.replace(/\D/g, '').slice(0, 12))}
                  placeholder="26096XXXXXXX"
                  style={{ flex: '1 1 190px', padding: '12px 14px', borderRadius: 8, border: '1px solid var(--panel-border)', background: 'var(--bg-color)', color: 'var(--text-main)', fontWeight: 600 }}
                />
                <button
                  onClick={handleMtnPayment}
                  disabled={paying}
                  style={{ flex: '1 1 170px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, border: 0, borderRadius: 8, padding: '12px 16px', background: '#ffcc00', color: '#111', fontWeight: 800, cursor: paying ? 'wait' : 'pointer', opacity: paying ? .7 : 1 }}
                >
                  {paying ? <Loader2 size={17} className="spin" /> : <CreditCard size={17} />}
                  {paying ? 'Confirming…' : `Pay ${money(amountDue, subscription.plan.currency)}`}
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="glass-panel" style={{ padding: 32 }} aria-labelledby="payment-history-heading">
          <h2 id="payment-history-heading" style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 22px', fontSize: 18 }}>
            <CalendarDays size={20} color="var(--primary)" /> Payment history
          </h2>
          {payments.length === 0 ? (
            <div style={{ padding: '38px 20px', textAlign: 'center', color: 'var(--text-muted)', background: 'var(--hover-bg)', borderRadius: 12, border: '1px dashed var(--panel-border)' }}>
              No payment attempts yet.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 11 }}>
              {payments.map((payment) => {
                const succeeded = payment.status === 'SUCCEEDED'
                return (
                  <div key={payment.id} style={{ padding: '15px 16px', borderRadius: 11, background: 'var(--hover-bg)', border: '1px solid var(--panel-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{payment.provider.replace(/_/g, ' ')}</div>
                      <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 3 }}>
                        {new Date(payment.succeeded_at || payment.created_at).toLocaleDateString('en-ZM', { dateStyle: 'medium' })}
                      </div>
                      <div style={{ marginTop: 6, color: succeeded ? 'var(--primary)' : payment.status === 'FAILED' ? 'var(--danger)' : 'var(--warning)', fontSize: 11, fontWeight: 800 }}>
                        {payment.status}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <strong>{money(Number(payment.amount), payment.currency)}</strong>
                      {succeeded && (
                        <a href={`/api/subscription/receipt/${payment.id}`} target="_blank" rel="noopener noreferrer" aria-label="Open payment receipt" style={{ display: 'grid', placeItems: 'center', padding: 7, border: '1px solid var(--panel-border)', borderRadius: 7, color: 'var(--text-main)' }}>
                          <Download size={16} />
                        </a>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
