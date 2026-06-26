'use client'

import { useState, useEffect } from 'react'
import Header from '@/components/Header'
import { getSyncConflicts } from '@/lib/api'

type Conflict = {
  id: string
  conflict_type: string
  serial_number: string
  device_a_id: string
  device_b_id: string
  resolution: string
  created_at: string
  resolved_at?: string
  resolved_by?: string
  notes?: string
}

const CONFLICT_TYPES: Record<string, { label: string; desc: string; color: string }> = {
  'SALE_BEFORE_STOCKTAKE': {
    label: 'Sale vs Stocktake',
    desc: 'Sale recorded after stocktake marked item as MISSING. Sale takes precedence.',
    color: 'var(--color-warning)',
  },
  'TRANSFER_VS_SALE': {
    label: 'Transfer vs Sale',
    desc: 'Item was simultaneously transferred and sold from different devices.',
    color: 'var(--color-danger)',
  },
  'DUPLICATE_SALE': {
    label: 'Duplicate Sale',
    desc: 'Same item was sold twice from different devices.',
    color: 'var(--color-danger)',
  },
}

const DEMO_CONFLICTS: Conflict[] = [
  {
    id: 'conf_001',
    conflict_type: 'TRANSFER_VS_SALE',
    serial_number: 'RTL-2026-M3N4O5',
    device_a_id: 'POS-STORE-A-001',
    device_b_id: 'POS-STORE-B-002',
    resolution: 'MANUAL_REQUIRED',
    created_at: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: 'conf_002',
    conflict_type: 'DUPLICATE_SALE',
    serial_number: 'RTL-2026-X1Y2Z3',
    device_a_id: 'POS-STORE-A-001',
    device_b_id: 'POS-STORE-A-002',
    resolution: 'MANUAL_REQUIRED',
    created_at: new Date(Date.now() - 7200000).toISOString(),
  },
  {
    id: 'conf_003',
    conflict_type: 'SALE_BEFORE_STOCKTAKE',
    serial_number: 'RTL-2026-P4Q5R6',
    device_a_id: 'STOCKTAKE-001',
    device_b_id: 'POS-STORE-A-001',
    resolution: 'AUTO_PREFER_SALE',
    created_at: new Date(Date.now() - 86400000).toISOString(),
    resolved_at: new Date(Date.now() - 86300000).toISOString(),
    resolved_by: 'system',
    notes: 'Automatically resolved — Sale takes precedence over Stocktake',
  },
]

export default function SyncPage() {
  const [conflicts, setConflicts] = useState<Conflict[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const token = sessionStorage.getItem('retail_token') || ''
        const data = await getSyncConflicts(token)
        setConflicts((data.conflicts as Conflict[]) || [])
      } catch (err) {
        setError('Backend not connected — showing demo conflicts.')
        setConflicts(DEMO_CONFLICTS)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const pending = conflicts.filter(c => c.resolution === 'MANUAL_REQUIRED')
  const resolved = conflicts.filter(c => c.resolution !== 'MANUAL_REQUIRED')

  const formatDate = (d: string) =>
    new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

  return (
    <>
      <Header
        title="Sync Engine"
        subtitle="Manage conflict resolution for offline device sync"
      />
      <div className="animate-fade-in" style={{ paddingTop: 'var(--header-height)' }}>

        {error && (
          <div style={{
            padding: '12px var(--space-md)',
            background: 'rgba(255,179,71,0.1)',
            border: '1px solid rgba(255,179,71,0.3)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-warning)',
            fontSize: 13,
            marginBottom: 'var(--space-lg)',
          }}>⚠ {error}</div>
        )}

        {/* Stats */}
        <div className="grid-3" style={{ marginBottom: 'var(--space-xl)' }}>
          <div className="stat-card">
            <div className="stat-card-value" style={{ color: pending.length > 0 ? 'var(--color-danger)' : 'var(--color-success)' }}>
              {pending.length}
            </div>
            <div className="stat-card-label">Pending Manual Review</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-value" style={{ color: 'var(--color-success)' }}>{resolved.length}</div>
            <div className="stat-card-label">Auto-Resolved</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-value">{conflicts.length}</div>
            <div className="stat-card-label">Total Conflicts</div>
          </div>
        </div>

        {/* Pending Conflicts */}
        {pending.length > 0 && (
          <div style={{ marginBottom: 'var(--space-xl)' }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-sm)',
              marginBottom: 'var(--space-lg)',
            }}>
              <div style={{
                width: 8, height: 8,
                borderRadius: '50%',
                background: 'var(--color-danger)',
                boxShadow: '0 0 6px var(--color-danger)',
              }} />
              <div className="section-title">Pending Resolution ({pending.length})</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
              {pending.map((conflict) => {
                const cfg = CONFLICT_TYPES[conflict.conflict_type] || {
                  label: conflict.conflict_type,
                  desc: '',
                  color: 'var(--color-warning)',
                }
                return (
                  <div key={conflict.id} className="card" style={{
                    borderColor: `${cfg.color}44`,
                    background: `${cfg.color}08`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-lg)' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-sm)' }}>
                          <span className="badge badge-danger">{cfg.label}</span>
                          <span className="mono">{conflict.serial_number}</span>
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 'var(--space-md)' }}>{cfg.desc}</div>
                        <div style={{ display: 'flex', gap: 'var(--space-xl)', fontSize: 12, color: 'var(--text-muted)' }}>
                          <span>Device A: <span className="mono" style={{ color: 'var(--text-secondary)' }}>{conflict.device_a_id}</span></span>
                          <span>Device B: <span className="mono" style={{ color: 'var(--text-secondary)' }}>{conflict.device_b_id}</span></span>
                          <span>Detected: {formatDate(conflict.created_at)}</span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 'var(--space-sm)', flexShrink: 0 }}>
                        <button className="btn btn-secondary btn-sm">Prefer Device A</button>
                        <button className="btn btn-secondary btn-sm">Prefer Device B</button>
                        <button className="btn btn-danger btn-sm">Reject Both</button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Resolved Conflicts */}
        <div>
          <div className="section-title" style={{ marginBottom: 'var(--space-lg)' }}>Recently Resolved</div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Serial Number</th>
                  <th>Conflict Type</th>
                  <th>Resolution</th>
                  <th>Resolved By</th>
                  <th>Resolved At</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {resolved.length === 0 ? (
                  <tr><td colSpan={6}>
                    <div className="empty-state">
                      <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No resolved conflicts</div>
                    </div>
                  </td></tr>
                ) : (
                  resolved.map((c) => (
                    <tr key={c.id}>
                      <td><span className="mono">{c.serial_number}</span></td>
                      <td><span className="badge badge-neutral">{c.conflict_type}</span></td>
                      <td><span className="badge badge-success">{c.resolution}</span></td>
                      <td style={{ color: 'var(--text-secondary)' }}>{c.resolved_by || '—'}</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{c.resolved_at ? formatDate(c.resolved_at) : '—'}</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{c.notes || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Rules Explainer */}
        <div className="card" style={{ marginTop: 'var(--space-xl)' }}>
          <div className="section-title" style={{ marginBottom: 'var(--space-lg)' }}>Conflict Resolution Rules</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
            {[
              { type: 'Sale vs Stocktake', rule: 'AUTO: Sale wins', rationale: 'Transaction is authoritative', badge: 'badge-success' },
              { type: 'Transfer vs Sale', rule: 'MANUAL: Requires review', rationale: 'Business decision needed', badge: 'badge-danger' },
              { type: 'Duplicate Sale', rule: 'MANUAL: Requires review', rationale: 'Data integrity violation', badge: 'badge-danger' },
              { type: 'Multiple Stocktakes', rule: 'AUTO: Last committed wins', rationale: 'Timestamp-based tie-breaker', badge: 'badge-warning' },
            ].map((row) => (
              <div key={row.type} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-lg)',
                padding: '10px 12px',
                background: 'var(--bg-surface-2)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border)',
              }}>
                <div style={{ flex: 1, fontWeight: 500, color: 'var(--text-primary)', fontSize: 13 }}>{row.type}</div>
                <div style={{ flex: 1 }}><span className={`badge ${row.badge}`}>{row.rule}</span></div>
                <div style={{ flex: 2, fontSize: 12, color: 'var(--text-muted)' }}>{row.rationale}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
