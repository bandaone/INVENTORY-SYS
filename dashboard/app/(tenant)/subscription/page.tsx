'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, Store, CalendarDays, Lock } from 'lucide-react';

export default function SubscriptionPage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [paying, setPaying] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    loadBilling();
  }, []);

  const loadBilling = async () => {
    try {
      const res = await fetch('/api/settings');
      const json = await res.json();
      const locRes = await fetch('/api/locations');
      const locJson = await locRes.json();
      setData({
        tenant: json.tenant,
        history: json.billing_history || [],
        locations: locJson.locations?.filter((l: any) => l.is_active)?.length || 1,
      });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSandboxPayment = async (method: string) => {
    setPaying(true);
    try {
      const amount = data.locations * 2500;
      const res = await fetch('/api/subscription/sandbox-pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, method }),
      });
      if (!res.ok) throw new Error('Payment failed');
      setSuccess(true);
      await loadBilling();
      setTimeout(() => setSuccess(false), 5000);
    } catch {
      alert('Sandbox payment failed.');
    } finally {
      setPaying(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', minHeight: '60vh', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)' }}>
        <Loader2 size={36} className="spin" />
      </div>
    );
  }

  const isTrial = data?.tenant?.status === 'TRIAL';
  const isActive = data?.tenant?.status === 'ACTIVE';
  const amountDue = (data?.locations || 1) * 2500;

  const tierLabel: Record<string, string> = {
    boutique_starter: 'Boutique Starter',
    growth: 'Growth',
    enterprise_fleet: 'Enterprise Fleet',
  };
  const planName = tierLabel[data?.tenant?.subscription_tier] || 'Premium SaaS Plan';

  return (
    <div style={{ maxWidth: '960px', margin: '0 auto', padding: '40px 32px', fontFamily: 'Outfit, sans-serif', color: 'var(--text-main)' }}>
      <h1 style={{ fontSize: '28px', fontWeight: 700, marginBottom: '6px' }}>Billing &amp; Subscription</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: '40px', fontSize: '15px' }}>
        Manage your Retail OS plan and payment methods.
      </p>

      {success && (
        <div style={{ padding: '16px 20px', background: 'var(--primary-glow)', border: '1px solid var(--primary)', color: 'var(--primary)', borderRadius: '12px', marginBottom: '32px', display: 'flex', alignItems: 'center', gap: '12px', fontWeight: 600 }}>
          <CheckCircle2 size={20} />
          Payment Successful! Your store is now fully active.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px', alignItems: 'start' }}>

        {/* Plan Card */}
        <div className="glass-panel" style={{ padding: '36px', position: 'relative' }}>

          {/* Status badge */}
          <div style={{ position: 'absolute', top: '24px', right: '24px' }}>
            {isTrial && (
              <span style={{ padding: '6px 14px', borderRadius: '20px', background: 'rgba(245,158,11,0.15)', color: 'var(--warning)', fontSize: '13px', fontWeight: 700, border: '1px solid rgba(245,158,11,0.3)' }}>
                Free Trial
              </span>
            )}
            {isActive && (
              <span style={{ padding: '6px 14px', borderRadius: '20px', background: 'var(--primary-glow)', color: 'var(--primary)', fontSize: '13px', fontWeight: 700, border: '1px solid var(--primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <CheckCircle2 size={14} /> Active Plan
              </span>
            )}
            {!isTrial && !isActive && (
              <span style={{ padding: '6px 14px', borderRadius: '20px', background: 'rgba(239,68,68,0.15)', color: 'var(--danger)', fontSize: '13px', fontWeight: 700, border: '1px solid rgba(239,68,68,0.3)' }}>
                Suspended
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
            <div style={{ width: '56px', height: '56px', background: 'var(--primary-glow)', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)' }}>
              <Store size={28} />
            </div>
            <div>
              <h2 style={{ fontSize: '22px', fontWeight: 700 }}>{planName}</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>{data?.locations} Active Location{data?.locations > 1 ? 's' : ''}</p>
            </div>
          </div>

          <div style={{ marginBottom: '28px' }}>
            <span style={{ fontSize: '48px', fontWeight: 900, letterSpacing: '-0.03em' }}>
              ZMW {amountDue.toLocaleString()}
            </span>
            <span style={{ color: 'var(--text-muted)', fontWeight: 600, marginLeft: '8px' }}>/ month</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '32px' }}>
            {[
              'Unlimited Users & Cashiers',
              'Unlimited Products & Sales',
              'Advanced Stock Analytics',
              'ZRA Smart Invoice Integration',
            ].map((feature) => (
              <div key={feature} style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '15px', color: 'var(--text-muted)' }}>
                <CheckCircle2 size={18} color="var(--primary)" />
                {feature}
              </div>
            ))}
          </div>

          {isTrial && (
            <div style={{ padding: '24px', borderRadius: '16px', background: 'var(--hover-bg)', border: '1px solid var(--panel-border)' }}>
              <h3 style={{ fontWeight: 700, fontSize: '16px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Lock size={16} color="var(--primary)" />
                Activate your subscription
              </h3>
              <p style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '20px' }}>
                Your trial will expire soon. Secure your store data by activating your plan today.
              </p>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <button
                  onClick={() => handleSandboxPayment('MTN MoMo')}
                  disabled={paying}
                  style={{ flex: 1, minWidth: '120px', background: '#ffcc00', color: '#000', fontWeight: 700, padding: '14px 20px', borderRadius: '10px', border: 'none', cursor: paying ? 'not-allowed' : 'pointer', fontFamily: 'Outfit, sans-serif', fontSize: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                >
                  {paying ? <Loader2 size={18} className="spin" /> : 'Pay via MTN MoMo'}
                </button>
                <button
                  onClick={() => handleSandboxPayment('Airtel Money')}
                  disabled={paying}
                  style={{ flex: 1, minWidth: '120px', background: '#e60000', color: '#fff', fontWeight: 700, padding: '14px 20px', borderRadius: '10px', border: 'none', cursor: paying ? 'not-allowed' : 'pointer', fontFamily: 'Outfit, sans-serif', fontSize: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                >
                  {paying ? <Loader2 size={18} className="spin" /> : 'Pay via Airtel'}
                </button>
              </div>
              <p style={{ marginTop: '16px', textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
                Test Sandbox Mode
              </p>
            </div>
          )}
        </div>

        {/* Billing History */}
        <div className="glass-panel" style={{ padding: '28px' }}>
          <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <CalendarDays size={20} color="var(--text-muted)" />
            Billing History
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {data?.history?.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '40px 0', fontSize: '14px' }}>
                No billing events yet.
              </p>
            ) : (
              data?.history?.map((evt: any) => (
                <div key={evt.id} style={{ padding: '16px 20px', borderRadius: '12px', background: 'var(--hover-bg)', border: '1px solid var(--panel-border)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 600, fontSize: '14px' }}>
                      {evt.event_type.replace(/_/g, ' ')}
                    </span>
                    <span style={{
                      fontSize: '12px', fontWeight: 700, padding: '4px 10px', borderRadius: '20px',
                      background: evt.status === 'POSTED' ? 'var(--primary-glow)' : 'rgba(245,158,11,0.15)',
                      color: evt.status === 'POSTED' ? 'var(--primary)' : 'var(--warning)',
                    }}>
                      {evt.status}
                    </span>
                  </div>
                  <div style={{ fontSize: '20px', fontWeight: 700 }}>ZMW {Number(evt.amount).toLocaleString()}</div>
                  <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                    {new Date(evt.due_at || evt.effective_at).toLocaleDateString('en-ZM', { year: 'numeric', month: 'long', day: 'numeric' })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
