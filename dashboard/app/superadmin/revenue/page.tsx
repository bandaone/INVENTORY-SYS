'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, AlertCircle, TrendingUp, Receipt, ShieldCheck } from 'lucide-react';
import { OwnerSection, OwnerMetricCard, OwnerBadge } from '@/components/SuperAdminBlocks';

type BillingEvent = {
  id: string;
  tenant_id: string;
  tenant_name: string;
  event_type: string;
  amount: number;
  currency: string;
  status: string;
  due_at: string | null;
  created_at: string;
};

export default function RevenuePipelinePage() {
  const [data, setData] = useState<{ mrr: number; overdue: BillingEvent[]; events: BillingEvent[] } | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = () => {
    fetch('/api/superadmin/revenue')
      .then(r => r.json())
      .then(d => setData(d))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
  }, []);

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '28px', maxWidth: '1000px' }}>
      
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '30px' }}>Revenue & Billing</h1>
          <p className="subtitle" style={{ marginTop: '6px' }}>
            Track contracted revenue, provider-verified collections, and overdue accounts.
          </p>
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 14px', borderRadius: '999px', background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.25)', color: '#4ade80', fontSize: '13px', fontWeight: 700 }}>
          <TrendingUp size={16} /> Financial Pipeline Active
        </div>
      </div>

      {/* Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
        <OwnerMetricCard 
          label="Monthly Recurring Revenue" 
          value={loading ? '...' : `ZMW ${data?.mrr.toLocaleString() || '0'}`} 
          note="Contracted plan revenue from active tenants"
          tone="primary" 
        />
        <OwnerMetricCard 
          label="Pending / Overdue" 
          value={loading ? '...' : String(data?.overdue.length || 0)} 
          note="Open invoices requiring verified settlement"
          tone="secondary" 
        />
        <OwnerMetricCard 
          label="Collection Mode" 
          value="Verified"
          note="Provider confirmation required before activation"
          tone="primary" 
        />
      </div>

      {/* Overdue Collection Queue */}
      <OwnerSection title="Collection Queue" subtitle="Open invoices that still require verified settlement.">
        {loading ? (
          <div style={{ padding: '20px', color: 'var(--text-muted)' }}>Loading queue...</div>
        ) : !data?.overdue.length ? (
          <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px dashed var(--panel-border)' }}>
            <CheckCircle2 size={32} style={{ marginBottom: '12px', opacity: 0.5 }} />
            <div style={{ fontWeight: 600 }}>All Clear!</div>
            <div style={{ fontSize: '13px' }}>No pending or overdue invoices to collect right now.</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '12px' }}>
            {data.overdue.map((invoice) => (
              <div key={invoice.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', background: 'var(--hover-bg)', border: '1px solid var(--panel-border)', borderRadius: '12px', gap: '16px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <div style={{ width: '42px', height: '42px', borderRadius: '10px', background: 'rgba(239, 68, 68, 0.1)', color: '#f87171', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <AlertCircle size={20} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '16px', color: 'var(--text-main)' }}>{invoice.tenant_name}</div>
                    <div style={{ fontSize: '13px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Clock size={12} /> Due: {invoice.due_at ? new Date(invoice.due_at).toLocaleDateString() : 'Immediate'}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 800, fontSize: '18px', color: 'var(--text-main)' }}>{invoice.currency} {invoice.amount.toLocaleString()}</div>
                    <OwnerBadge tone={invoice.status === 'OVERDUE' ? 'warning' : 'secondary'}>{invoice.status}</OwnerBadge>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--text-muted)', fontSize: 12 }}>
                    <ShieldCheck size={15} /> Awaiting verified payment
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </OwnerSection>

      {/* Ledger */}
      <OwnerSection title="Revenue Ledger" subtitle="Canonical provider payment attempts and outcomes.">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '600px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--panel-border)' }}>
                <th style={{ padding: '12px', color: 'var(--text-muted)', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Date</th>
                <th style={{ padding: '12px', color: 'var(--text-muted)', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tenant</th>
                <th style={{ padding: '12px', color: 'var(--text-muted)', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Event</th>
                <th style={{ padding: '12px', color: 'var(--text-muted)', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Amount</th>
                <th style={{ padding: '12px', color: 'var(--text-muted)', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {data?.events.map((ev) => (
                <tr key={ev.id} style={{ borderBottom: '1px solid var(--panel-border)' }}>
                  <td style={{ padding: '14px 12px', fontSize: '14px', color: 'var(--text-main)' }}>{new Date(ev.created_at).toLocaleDateString()}</td>
                  <td style={{ padding: '14px 12px', fontSize: '14px', fontWeight: 600, color: 'var(--text-main)' }}>{ev.tenant_name}</td>
                  <td style={{ padding: '14px 12px', fontSize: '14px', color: 'var(--text-muted)' }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'var(--hover-bg)', padding: '4px 8px', borderRadius: '6px' }}>
                      <Receipt size={14} /> {ev.event_type}
                    </div>
                  </td>
                  <td style={{ padding: '14px 12px', fontSize: '14px', fontWeight: 700 }}>
                    {ev.amount > 0 ? `${ev.currency} ${ev.amount.toLocaleString()}` : '--'}
                  </td>
                  <td style={{ padding: '14px 12px' }}>
                    <OwnerBadge tone={ev.status === 'SUCCEEDED' ? 'primary' : ev.status === 'FAILED' ? 'danger' : 'secondary'}>
                      {ev.status}
                    </OwnerBadge>
                  </td>
                </tr>
              ))}
              {!data?.events.length && !loading && (
                <tr><td colSpan={5} style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>No billing events yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </OwnerSection>

    </div>
  );
}
