'use client';
import { useState, useEffect } from 'react';
import { CheckCircle2, AlertTriangle, Loader2, RefreshCw } from 'lucide-react';

interface Conflict {
  id: string;
  garment_serial: string | null;
  conflict_type: string;
  local_value: string;
  server_value: string;
  resolved: boolean;
  created_at: string;
  resolved_by_name: string | null;
}

const CONFLICT_LABELS: Record<string, { label: string; color: string }> = {
  duplicate_sale:  { label: 'Duplicate Sale',    color: 'var(--danger)' },
  missing_serial:  { label: 'Missing Serial',     color: 'var(--warning)' },
  price_mismatch:  { label: 'Price Mismatch',     color: 'rgba(96,165,250,1)' },
  offline_gap:     { label: 'Offline Gap',         color: 'var(--text-muted)' },
};

export default function ConflictsPage() {
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState<string | null>(null);

  const fetchConflicts = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/conflicts');
      const data = await res.json();
      setConflicts(Array.isArray(data) ? data : []);
    } catch { setConflicts([]); }
    setLoading(false);
  };

  useEffect(() => { fetchConflicts(); }, []);

  const resolve = async (id: string) => {
    setResolving(id);
    await fetch('/api/conflicts', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    fetchConflicts();
    setResolving(null);
  };

  const pending = conflicts.filter(c => !c.resolved);
  const resolved = conflicts.filter(c => c.resolved);

  return (
    <div className="animate-fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Sync Conflicts</h1>
          <p className="subtitle">Data collisions detected when POS devices re-connected from offline mode.</p>
        </div>
        <button onClick={fetchConflicts} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'transparent', border: '1px solid var(--panel-border)', color: 'var(--text-muted)', padding: '8px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {loading ? (
        <div style={{ marginTop: '40px', textAlign: 'center', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
          <Loader2 size={20} className="spin" /> Checking sync status...
        </div>
      ) : pending.length === 0 ? (
        <div className="glass-panel" style={{ marginTop: '32px', textAlign: 'center', padding: '64px 24px' }}>
          <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'rgba(74,222,128,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <CheckCircle2 size={32} color="var(--primary)" />
          </div>
          <h3 style={{ marginBottom: '8px' }}>All Systems Synced</h3>
          <p className="subtitle">No outstanding conflicts. All POS devices are in sync with the server.</p>
          {resolved.length > 0 && <p style={{ marginTop: '16px', color: 'var(--text-muted)', fontSize: '13px' }}>{resolved.length} previously resolved conflict{resolved.length !== 1 ? 's' : ''} on record.</p>}
        </div>
      ) : (
        <>
          <div className="glass-panel" style={{ marginTop: '24px', borderLeft: '3px solid var(--danger)' }}>
            <div className="chart-header">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertTriangle size={18} color="var(--danger)" /> {pending.length} Pending Conflict{pending.length !== 1 ? 's' : ''}
              </h3>
            </div>
            <table className="data-table">
              <thead>
                <tr><th>Type</th><th>Serial</th><th>Local Value</th><th>Server Value</th><th>Detected</th><th>Action</th></tr>
              </thead>
              <tbody>
                {pending.map(c => (
                  <tr key={c.id}>
                    <td>
                      <span style={{ padding: '3px 8px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, background: 'rgba(239,68,68,0.1)', color: CONFLICT_LABELS[c.conflict_type]?.color || 'var(--text-muted)' }}>
                        {CONFLICT_LABELS[c.conflict_type]?.label || c.conflict_type}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: '13px' }}>{c.garment_serial || '—'}</td>
                    <td style={{ color: 'var(--danger)', fontSize: '13px' }}>{c.local_value || '—'}</td>
                    <td style={{ color: 'var(--primary)', fontSize: '13px' }}>{c.server_value || '—'}</td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{new Date(c.created_at).toLocaleString()}</td>
                    <td>
                      <button onClick={() => resolve(c.id)} disabled={resolving === c.id} style={{ background: 'var(--primary)', color: '#0f1115', border: 'none', padding: '5px 12px', borderRadius: '6px', fontWeight: 600, cursor: 'pointer', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        {resolving === c.id ? <Loader2 size={12} className="spin" /> : <CheckCircle2 size={12} />}
                        Resolve
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {resolved.length > 0 && (
            <div className="glass-panel" style={{ marginTop: '20px', opacity: 0.7 }}>
              <h3 style={{ marginBottom: '16px', fontSize: '14px', color: 'var(--text-muted)' }}>Resolved ({resolved.length})</h3>
              <table className="data-table">
                <thead>
                  <tr><th>Type</th><th>Serial</th><th>Resolved By</th><th>Detected</th></tr>
                </thead>
                <tbody>
                  {resolved.map(c => (
                    <tr key={c.id}>
                      <td style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{CONFLICT_LABELS[c.conflict_type]?.label || c.conflict_type}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: '13px', color: 'var(--text-muted)' }}>{c.garment_serial || '—'}</td>
                      <td style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{c.resolved_by_name || 'System'}</td>
                      <td style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{new Date(c.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
