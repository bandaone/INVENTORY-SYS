'use client'

import { useState, useEffect } from 'react'
import Header from '@/components/Header'
import { listStocktakeSessions, startStocktake, getStocktakeSession } from '@/lib/api'

type Session = {
  id: string
  location_id: string
  area?: string
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED'
  initiated_by: string
  matched_count?: number
  missing_count?: number
  unexpected_count?: number
  shrinkage_value?: number
  created_at: string
  committed_at?: string
}

const STATUS_MAP = {
  ACTIVE: { label: 'Active', class: 'badge-success' },
  COMPLETED: { label: 'Completed', class: 'badge-info' },
  CANCELLED: { label: 'Cancelled', class: 'badge-neutral' },
}

export default function StocktakePage() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [selectedSession, setSelectedSession] = useState<Session | null>(null)
  const [newSession, setNewSession] = useState({ location_id: '', area: '' })
  const [creating, setCreating] = useState(false)
  const [scanInput, setScanInput] = useState('')

  useEffect(() => {
    loadSessions()
  }, [])

  async function loadSessions() {
    setLoading(true)
    try {
      const token = sessionStorage.getItem('retail_token') || ''
      const data = await listStocktakeSessions(token)
      setSessions(data.sessions || [])
    } catch (err) {
      setError('Backend not connected. Showing demo data.')
      setSessions([
        {
          id: 'sess_001',
          location_id: 'loc_store_a',
          area: 'Main Floor',
          status: 'COMPLETED',
          initiated_by: 'manager_001',
          matched_count: 245,
          missing_count: 3,
          unexpected_count: 1,
          shrinkage_value: 75000,
          created_at: new Date(Date.now() - 86400000).toISOString(),
          committed_at: new Date(Date.now() - 82800000).toISOString(),
        },
        {
          id: 'sess_002',
          location_id: 'loc_store_b',
          area: 'Storage Room',
          status: 'ACTIVE',
          initiated_by: 'manager_002',
          created_at: new Date().toISOString(),
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  async function handleStartSession(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    try {
      const token = sessionStorage.getItem('retail_token') || ''
      await startStocktake(token, {
        location_id: newSession.location_id,
        area: newSession.area || undefined,
      })
      setShowModal(false)
      setNewSession({ location_id: '', area: '' })
      loadSessions()
    } catch (err) {
      alert('Failed to start stocktake session. Check backend connection.')
    } finally {
      setCreating(false)
    }
  }

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  const formatPrice = (p?: number) =>
    p !== undefined ? new Intl.NumberFormat('en-ZM', { style: 'currency', currency: 'ZMW', maximumFractionDigits: 0 }).format(p / 100) : '—'

  return (
    <>
      <Header
        title="Stocktake"
        subtitle="Manage inventory counting sessions"
        actions={
          <button className="btn btn-primary btn-sm" onClick={() => setShowModal(true)}>
            + New Session
          </button>
        }
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
          }}>
            ⚠ {error}
          </div>
        )}

        {/* Summary */}
        <div className="grid-3" style={{ marginBottom: 'var(--space-xl)' }}>
          <div className="stat-card">
            <div className="stat-card-value">{sessions.filter(s => s.status === 'ACTIVE').length}</div>
            <div className="stat-card-label">Active Sessions</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-value">{sessions.filter(s => s.status === 'COMPLETED').length}</div>
            <div className="stat-card-label">Completed Sessions</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-value" style={{ color: 'var(--color-danger)' }}>
              {sessions.reduce((sum, s) => sum + (s.missing_count || 0), 0)}
            </div>
            <div className="stat-card-label">Total Missing Items</div>
          </div>
        </div>

        {/* Sessions Table */}
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: 'var(--space-xl)', borderBottom: '1px solid var(--border)' }}>
            <div className="section-title">Stocktake Sessions</div>
            <div className="section-subtitle">All counting sessions across locations</div>
          </div>
          <div className="table-wrapper" style={{ border: 'none', borderRadius: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Session ID</th>
                  <th>Location</th>
                  <th>Area</th>
                  <th>Status</th>
                  <th>Matched</th>
                  <th>Missing</th>
                  <th>Shrinkage</th>
                  <th>Started</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={9}><div className="empty-state"><div className="loading-spinner" /></div></td></tr>
                ) : sessions.length === 0 ? (
                  <tr><td colSpan={9}>
                    <div className="empty-state">
                      <div className="empty-state-icon">◎</div>
                      <div style={{ fontWeight: 600 }}>No stocktake sessions yet</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Start a session to begin counting inventory</div>
                    </div>
                  </td></tr>
                ) : (
                  sessions.map((sess) => {
                    const sc = STATUS_MAP[sess.status]
                    return (
                      <tr key={sess.id}>
                        <td><span className="mono">{sess.id.substring(0, 12)}...</span></td>
                        <td style={{ color: 'var(--text-secondary)' }}>{sess.location_id}</td>
                        <td style={{ color: 'var(--text-muted)' }}>{sess.area || '—'}</td>
                        <td><span className={`badge ${sc.class}`}>{sc.label}</span></td>
                        <td style={{ color: 'var(--color-success)', fontWeight: 600 }}>{sess.matched_count ?? '—'}</td>
                        <td style={{ color: sess.missing_count ? 'var(--color-danger)' : 'var(--text-muted)', fontWeight: sess.missing_count ? 600 : 400 }}>
                          {sess.missing_count ?? '—'}
                        </td>
                        <td style={{ color: 'var(--color-danger)' }}>{formatPrice(sess.shrinkage_value)}</td>
                        <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{formatDate(sess.created_at)}</td>
                        <td>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => setSelectedSession(sess)}
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* How It Works */}
        <div className="card" style={{ marginTop: 'var(--space-xl)' }}>
          <div className="section-title" style={{ marginBottom: 'var(--space-lg)' }}>How Stocktake Works</div>
          <div className="grid-3">
            {[
              { step: '1', icon: '◌', title: 'Start Session', desc: 'Select a location and area to count. System creates an active counting session.' },
              { step: '2', icon: '◎', title: 'Scan Items', desc: 'Use the Stocktake App or RFID wand to scan garment QR codes. Supports batches of 1000+.' },
              { step: '3', icon: '✓', title: 'Commit Results', desc: 'Unscanned items are marked MISSING. Shrinkage is calculated and the audit trail is updated.' },
            ].map((s) => (
              <div key={s.step} style={{
                padding: 'var(--space-lg)',
                background: 'var(--bg-surface-2)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border)',
              }}>
                <div style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  background: 'rgba(108,99,255,0.15)',
                  color: 'var(--color-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: 14,
                  marginBottom: 'var(--space-md)',
                }}>
                  {s.step}
                </div>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>{s.title}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>{s.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* New Session Modal */}
      {showModal && (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.7)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div className="card-glass" style={{
            width: 440,
            padding: 'var(--space-xl)',
            border: '1px solid var(--border-accent)',
          }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 'var(--space-lg)' }}>
              Start New Stocktake Session
            </div>
            <form onSubmit={handleStartSession}>
              <div className="input-group" style={{ marginBottom: 'var(--space-md)' }}>
                <label className="label">Location ID *</label>
                <input
                  className="input"
                  type="text"
                  placeholder="e.g. loc_store_a"
                  value={newSession.location_id}
                  onChange={(e) => setNewSession(s => ({ ...s, location_id: e.target.value }))}
                  required
                />
              </div>
              <div className="input-group" style={{ marginBottom: 'var(--space-xl)' }}>
                <label className="label">Area (optional)</label>
                <input
                  className="input"
                  type="text"
                  placeholder="e.g. Main Floor, Storage Room"
                  value={newSession.area}
                  onChange={(e) => setNewSession(s => ({ ...s, area: e.target.value }))}
                />
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-md)', justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={creating}>
                  {creating ? 'Creating...' : 'Start Session'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
