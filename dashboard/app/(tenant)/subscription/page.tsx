'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, Store, CalendarDays, Lock, CreditCard, ArrowUpRight, ShieldCheck, Download } from 'lucide-react';

export default function SubscriptionPage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [paying, setPaying] = useState(false);
  const [success, setSuccess] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('260');

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

  const pollPaymentStatus = async (referenceId: string, attempts = 0) => {
    if (attempts >= 18) { // 90 seconds max
      setPaying(false);
      alert('Payment is taking longer than expected. We will update your dashboard once MTN confirms it.');
      return;
    }
    
    try {
      const res = await fetch(`/api/subscription/momo/status/${referenceId}`);
      if (res.ok) {
        const json = await res.json();
        if (json.status === 'SUCCESSFUL') {
          setPaying(false);
          setSuccess(true);
          await loadBilling();
          setTimeout(() => setSuccess(false), 5000);
          return;
        } else if (json.status === 'FAILED') {
          setPaying(false);
          alert('Payment was declined or cancelled. Please try again.');
          return;
        }
      }
    } catch (err) {
      console.error('Polling error:', err);
    }
    
    // Continue polling
    setTimeout(() => pollPaymentStatus(referenceId, attempts + 1), 5000);
  };

  const handleMtnPayment = async () => {
    if (phoneNumber.length < 10) return alert('Please enter a valid MTN number (e.g. 26096...)');
    
    setPaying(true);
    try {
      const amount = (data?.locations || 1) * 2500;
      const res = await fetch('/api/subscription/momo/request-to-pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, phoneNumber }),
      });
      if (!res.ok) throw new Error('Payment failed');
      const json = await res.json();
      
      alert(json.message || 'A payment prompt has been sent to ' + phoneNumber + '. Please check your phone and enter your PIN.');
      
      if (json.referenceId) {
        pollPaymentStatus(json.referenceId);
      } else {
        setPaying(false); // Fallback if no reference returned
      }
    } catch {
      alert('Failed to send payment prompt. Please try again.');
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
  const isActive = data?.tenant?.status === 'ACTIVE' || data?.tenant?.status === 'active';
  const amountDue = (data?.locations || 1) * 2500;

  const tierLabel: Record<string, string> = {
    boutique_starter: 'Boutique Starter',
    growth: 'Growth',
    enterprise_fleet: 'Enterprise Fleet',
  };
  const planName = tierLabel[data?.tenant?.subscription_tier] || 'Premium SaaS Plan';

  return (
    <div className="animate-fade-in" style={{ paddingBottom: '60px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '32px' }}>
        <div>
          <h1>Billing & Subscription</h1>
          <p className="subtitle">Centrally manage your active plan, payment methods, and billing history.</p>
        </div>
        {!isTrial && (
          <button 
            onClick={() => window.location.href = 'mailto:billing@retailos.com?subject=Upgrade%20Request'}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--primary)', color: '#0f1115', border: 'none', padding: '10px 20px', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s', boxShadow: '0 4px 14px rgba(74,222,128,0.2)' }}
          >
            <ArrowUpRight size={18} />
            Upgrade Plan
          </button>
        )}
      </div>

      {success && (
        <div style={{ padding: '16px 20px', background: 'var(--primary-glow)', border: '1px solid var(--primary)', color: 'var(--primary)', borderRadius: '12px', marginBottom: '32px', display: 'flex', alignItems: 'center', gap: '12px', fontWeight: 600 }}>
          <CheckCircle2 size={20} />
          Payment successfully processed. Your workspace is fully secured.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '24px', alignItems: 'start' }}>
        
        {/* Active Plan Card */}
        <div className="glass-panel" style={{ padding: '32px', position: 'relative' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{ width: '48px', height: '48px', background: 'var(--primary-glow)', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)' }}>
                <Store size={24} />
              </div>
              <div>
                <h2 style={{ fontSize: '20px', fontWeight: 700, margin: 0 }}>{planName}</h2>
                <div style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '2px' }}>
                  {data?.locations} Licensed Branch{data?.locations !== 1 ? 'es' : ''}
                </div>
              </div>
            </div>
            
            {/* Status Badge */}
            <div>
              {isTrial && (
                <span style={{ padding: '6px 12px', borderRadius: '20px', background: 'rgba(245,158,11,0.1)', color: 'var(--warning)', fontSize: '12px', fontWeight: 700, border: '1px solid rgba(245,158,11,0.2)' }}>
                  Free Trial
                </span>
              )}
              {isActive && (
                <span style={{ padding: '6px 12px', borderRadius: '20px', background: 'var(--primary-glow)', color: 'var(--primary)', fontSize: '12px', fontWeight: 700, border: '1px solid rgba(74,222,128,0.2)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <ShieldCheck size={14} /> Active
                </span>
              )}
              {!isTrial && !isActive && (
                <span style={{ padding: '6px 12px', borderRadius: '20px', background: 'rgba(239,68,68,0.1)', color: 'var(--danger)', fontSize: '12px', fontWeight: 700, border: '1px solid rgba(239,68,68,0.2)' }}>
                  Suspended
                </span>
              )}
            </div>
          </div>

          <div style={{ padding: '24px', background: 'var(--hover-bg)', borderRadius: '12px', border: '1px solid var(--panel-border)', marginBottom: '24px' }}>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Current Billing Cycle</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
              <span style={{ fontSize: '40px', fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--text-main)' }}>
                ZMW {amountDue.toLocaleString()}
              </span>
              <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>/ month</span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: isTrial ? '32px' : '0' }}>
            {[
              'Unlimited System Users & Cashiers',
              'Unlimited SKUs & Sales Volume',
              'Real-Time Cross-Branch Synchronization',
              'ZRA Smart Invoice / VSDC Integration',
            ].map((feature) => (
              <div key={feature} style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px', color: 'var(--text-main)', fontWeight: 500 }}>
                <CheckCircle2 size={18} color="var(--primary)" />
                {feature}
              </div>
            ))}
          </div>

          {isTrial && (
            <div style={{ marginTop: '32px', paddingTop: '24px', borderTop: '1px dashed var(--panel-border)' }}>
              <h3 style={{ fontWeight: 700, fontSize: '15px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Lock size={16} color="var(--primary)" />
                Secure Your Workspace
              </h3>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '20px', lineHeight: 1.5 }}>
                Your trial will expire soon. Process your payment today to maintain uninterrupted access to your enterprise data.
              </p>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
                  <div style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', fontSize: '14px', fontWeight: 600, color: 'var(--text-muted)' }}>MTN:</div>
                  <input 
                    type="text" 
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value.replace(/\\D/g, ''))}
                    placeholder="26096XXXXXXX"
                    style={{ width: '100%', padding: '12px 12px 12px 55px', borderRadius: '8px', border: '1px solid var(--panel-border)', background: 'var(--bg-color)', color: 'var(--text-main)', fontSize: '15px', fontWeight: 600, outline: 'none' }}
                  />
                </div>
                <button
                  onClick={handleMtnPayment}
                  disabled={paying}
                  style={{ flex: 1, minWidth: '160px', background: '#ffcc00', color: '#000', fontWeight: 700, padding: '12px 16px', borderRadius: '8px', border: 'none', cursor: paying ? 'not-allowed' : 'pointer', fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', transition: 'opacity 0.2s' }}
                >
                  {paying ? <Loader2 size={16} className="spin" /> : 'Send PIN Prompt to Phone'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Billing History Card */}
        <div className="glass-panel" style={{ padding: '32px' }}>
          <h3 style={{ fontSize: '18px', fontWeight: 700, margin: '0 0 24px 0', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <CalendarDays size={20} color="var(--primary)" />
            Transaction History
          </h3>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {data?.history?.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)', background: 'var(--hover-bg)', borderRadius: '12px', border: '1px dashed var(--panel-border)', fontSize: '14px' }}>
                No recent transactions found.
              </div>
            ) : (
              data?.history?.map((evt: any) => (
                <div key={evt.id} style={{ padding: '16px 20px', borderRadius: '12px', background: 'var(--hover-bg)', border: '1px solid var(--panel-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', transition: 'transform 0.2s, box-shadow 0.2s' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: evt.status === 'POSTED' || evt.status === 'paid' ? 'var(--primary-glow)' : 'rgba(96,165,250,0.1)', color: evt.status === 'POSTED' || evt.status === 'paid' ? 'var(--primary)' : 'var(--secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <CreditCard size={18} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '14px', textTransform: 'capitalize', color: 'var(--text-main)' }}>
                        {evt.event_type.replace(/_/g, ' ')}
                      </div>
                      <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '2px' }}>
                        {new Date(evt.due_at || evt.effective_at).toLocaleDateString('en-ZM', { year: 'numeric', month: 'long', day: 'numeric' })}
                      </div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-main)' }}>
                      {evt.currency || 'ZMW'} {Number(evt.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </div>
                    <div style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      marginTop: '4px',
                      fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px',
                      background: evt.status === 'POSTED' || evt.status === 'paid' || evt.status === 'SUCCESSFUL' ? 'var(--primary-glow)' : 'rgba(245,158,11,0.1)',
                      color: evt.status === 'POSTED' || evt.status === 'paid' || evt.status === 'SUCCESSFUL' ? 'var(--primary)' : 'var(--warning)',
                    }}>
                      {evt.status === 'POSTED' || evt.status === 'paid' || evt.status === 'SUCCESSFUL' ? 'SUCCESS' : evt.status}
                    </div>
                  </div>
                  {(evt.status === 'POSTED' || evt.status === 'paid' || evt.status === 'SUCCESSFUL') && (
                    <div style={{ marginLeft: '16px' }}>
                      <a href={`/api/subscription/receipt/${evt.id}`} target="_blank" rel="noopener noreferrer" style={{ background: 'transparent', border: '1px solid var(--panel-border)', color: 'var(--text-main)', padding: '6px', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Download Receipt">
                        <Download size={16} />
                      </a>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
