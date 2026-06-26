'use client';
import { useEffect, useState } from 'react';
import { Activity, MapPin, User, TrendingUp, Loader2, RefreshCw } from 'lucide-react';

interface ActiveShift {
  shift_id: string;
  started_at: string;
  staff_name: string;
  staff_role: string;
  location_name: string;
  transactions_count: number;
  total_sales: number;
}

interface RecentSale {
  receipt_number: string;
  total: number;
  payment_method: string;
  created_at: string;
  cashier_name: string;
  location_name: string;
}

interface LocationSummary {
  location_name: string;
  sales_count: number;
  total_revenue: number;
  active_cashiers: number;
}

export default function LiveActivity() {
  const [data, setData] = useState<{ activeShifts: ActiveShift[]; recentSales: RecentSale[]; locationSummary: LocationSummary[] } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    fetch('/api/live-activity')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // Auto-refresh every 30 seconds
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  const [showAllSales, setShowAllSales] = useState(false);
  const SALES_PREVIEW = 5;

  const timeSince = (ts: string) => {
    const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
    if (diff < 60)   return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  };

  const ROLE_COLORS: Record<string, string> = {
    owner: '#4ade80', store_manager: '#60a5fa', cashier: '#fbbf24', stock_clerk: '#a78bfa',
  };

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', padding: '20px' }}>
      <Loader2 size={16} className="spin" /> Loading live activity...
    </div>
  );

  return (
    <div style={{ marginTop: '24px' }}>
      {/* Section header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--primary)', boxShadow: '0 0 0 3px rgba(74,222,128,0.2)', animation: 'pulse 2s infinite' }} />
          <h2 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>Live Activity</h2>
        </div>
        <button onClick={load} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: '1px solid var(--panel-border)', color: 'var(--text-muted)', borderRadius: '6px', padding: '5px 10px', cursor: 'pointer', fontSize: '12px' }}>
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>

        {/* Active Shifts */}
        <div className="glass-panel">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <User size={16} color="var(--primary)" />
            <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>Today's Staff Activity ({data?.activeShifts.length || 0})</h3>
          </div>
          {!data?.activeShifts.length ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No staff activity recorded today.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {data.activeShifts.map((s: any) => {
                const isOnline = !s.ended_at;
                return (
                <div key={s.shift_id || s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px', background: 'var(--hover-bg)', borderRadius: '8px', opacity: isOnline ? 1 : 0.7 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: isOnline ? 'var(--primary)' : 'var(--text-muted)', flexShrink: 0, boxShadow: isOnline ? '0 0 0 2px rgba(74,222,128,0.2)' : 'none' }} title={isOnline ? 'Online' : 'Offline'} />
                      <span style={{ color: ROLE_COLORS[s.staff_role] || 'var(--text-main)' }}>{s.staff_name}</span>
                      {!isOnline && <span style={{ fontSize: '10px', background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '10px', color: 'var(--text-muted)' }}>Offline</span>}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <MapPin size={11} /> {s.location_name || 'No location'} · {isOnline ? `since ${timeSince(s.started_at)}` : 'Shift ended'}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--primary)' }}>K{Number(s.total_sales).toFixed(0)}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{s.transactions_count} sales</div>
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Per-location today */}
        <div className="glass-panel">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <TrendingUp size={16} color="var(--secondary)" />
            <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>Today by Location</h3>
          </div>
          {!data?.locationSummary.length ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No locations found.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {data.locationSummary.map((loc, i) => (
                <div key={i} style={{ padding: '10px', background: 'var(--hover-bg)', borderRadius: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <span style={{ fontWeight: 600, fontSize: '13px' }}>{loc.location_name}</span>
                    <span style={{ fontWeight: 700, color: 'var(--primary)', fontSize: '13px' }}>K{Number(loc.total_revenue).toFixed(2)}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '12px', fontSize: '12px', color: 'var(--text-muted)' }}>
                    <span>{loc.sales_count} sales</span>
                    <span>{loc.active_cashiers} active cashier{loc.active_cashiers !== 1 ? 's' : ''}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent sales feed */}
      {(data?.recentSales.length ?? 0) > 0 && (
        <div className="glass-panel" style={{ marginTop: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <Activity size={16} color="var(--warning)" />
            <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>Recent Sales</h3>
            <span style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--text-muted)' }}>
              {data!.recentSales.length} transactions
            </span>
          </div>
          <table className="data-table">
            <thead>
              <tr><th>Receipt</th><th>Cashier</th><th>Location</th><th>Amount</th><th>Method</th><th>When</th></tr>
            </thead>
            <tbody>
              {(showAllSales ? data!.recentSales : data!.recentSales.slice(0, SALES_PREVIEW)).map((s, i) => (
                <tr key={i}>
                  <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>{s.receipt_number}</td>
                  <td style={{ fontWeight: 600, fontSize: '13px' }}>{s.cashier_name || '—'}</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{s.location_name || '—'}</td>
                  <td style={{ fontWeight: 700 }}>K{Number(s.total).toFixed(2)}</td>
                  <td>
                    <span style={{ padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, background: s.payment_method === 'CASH' ? 'rgba(96,165,250,0.12)' : 'rgba(245,158,11,0.12)', color: s.payment_method === 'CASH' ? 'var(--secondary)' : 'var(--warning)' }}>
                      {s.payment_method === 'CASH' ? 'Cash' : 'Mobile'}
                    </span>
                  </td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{timeSince(s.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data!.recentSales.length > SALES_PREVIEW && (
            <button onClick={() => setShowAllSales(v => !v)}
              style={{ marginTop: '12px', width: '100%', padding: '8px', background: 'none', border: '1px solid var(--panel-border)', color: 'var(--text-muted)', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontFamily: 'Outfit' }}>
              {showAllSales ? 'Show fewer' : `Show all ${data!.recentSales.length} transactions`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
