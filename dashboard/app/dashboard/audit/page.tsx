'use client'

import { useState, useEffect } from 'react'
import Header from '@/components/Header'
import { getAuditTrail } from '@/lib/api'

type AuditEvent = {
  id: string
  event_type: string
  actor_id?: string
  actor_role?: string
  resource_type?: string
  resource_id?: string
  payload: unknown
  created_at: string
}

const EVENT_COLORS: Record<string, string> = {
  'order.placed': 'var(--color-success)',
  'order.updated': 'var(--color-info)',
  'serial_tracking.status_changed': 'var(--color-primary)',
  'stocktake.committed': 'var(--color-accent)',
  'sync.conflict.detected': 'var(--color-warning)',
  'ZRA_INVOICE_ERROR': 'var(--color-danger)',
  'ZRA_INVOICE_REJECTION': 'var(--color-danger)',
}

const EVENT_ICONS: Record<string, string> = {
  'order': '⊞',
  'serial': '◉',
  'stocktake': '◎',
  'sync': '⟳',
  'ZRA': '⊕',
  'default': '⊛',
}

function getIcon(eventType: string) {
  const k = Object.keys(EVENT_ICONS).find(k => eventType.toUpperCase().includes(k.toUpperCase()))
  return EVENT_ICONS[k || 'default']
}

const DEMO_EVENTS: AuditEvent[] = [
  { id: '1', event_type: 'order.placed', actor_id: 'cashier_001', actor_role: 'cashier', resource_type: 'order', resource_id: 'ord_001', payload: {}, created_at: new Date().toISOString() },
  { id: '2', event_type: 'serial_tracking.status_changed', actor_id: 'system', actor_role: 'system', resource_type: 'serial_item', resource_id: 'RTL-2026-A1B2', payload: {}, created_at: new Date(Date.now() - 3600000).toISOString() },
  { id: '3', event_type: 'stocktake.committed', actor_id: 'manager_001', actor_role: 'store_manager', resource_type: 'stocktake_session', resource_id: 'sess_001', payload: {}, created_at: new Date(Date.now() - 7200000).toISOString() },
  { id: '4', event_type: 'sync.conflict.detected', actor_id: 'system', actor_role: 'system', resource_type: 'sync', resource_id: 'conf_001', payload: {}, created_at: new Date(Date.now() - 10800000).toISOString() },
  { id: '5', event_type: 'ZRA_INVOICE_ERROR', actor_id: 'system', actor_role: 'system', resource_type: 'order', resource_id: 'ord_002', payload: {}, created_at: new Date(Date.now() - 14400000).toISOString() },
]

export default function AuditPage() {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterType, setFilterType] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const token = sessionStorage.getItem('retail_token') || ''
        const data = await getAuditTrail(token, { limit: 100, event_type: filterType || undefined })
        setEvents(data.events || [])
      } catch (err) {
        setError('Backend not connected — showing demo events.')
        setEvents(DEMO_EVENTS)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [filterType])

  const formatDate = (d: string) =>
    new Date(d).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    })

  const getColor = (eventType: string) =>
    Object.entries(EVENT_COLORS).find(([k]) => eventType.startsWith(k))?.[1] || 'var(--text-muted)'

  return (
    <>
      <Header
        title="Audit Trail"
        subtitle="Immutable log of all system events"
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

        {/* Filter Bar */}
        <div style={{ display: 'flex', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)', alignItems: 'center' }}>
          <input
            type="text"
            className="input"
            style={{ maxWidth: 280 }}
            placeholder="Filter by event type..."
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
          />
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            {events.length} events
          </div>
        </div>

        {/* Event Timeline */}
        <div className="card" style={{ padding: 0 }}>
          {loading ? (
            <div className="empty-state"><div className="loading-spinner" /></div>
          ) : events.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">⊛</div>
              <div style={{ fontWeight: 600 }}>No events yet</div>
            </div>
          ) : (
            <div>
              {events.map((event, i) => {
                const color = getColor(event.event_type)
                const isExpanded = expanded === event.id
                return (
                  <div
                    key={event.id}
                    style={{
                      display: 'flex',
                      gap: 'var(--space-md)',
                      padding: 'var(--space-md) var(--space-xl)',
                      borderBottom: i < events.length - 1 ? '1px solid var(--border)' : 'none',
                      cursor: 'pointer',
                      transition: 'background var(--transition-fast)',
                    }}
                    onClick={() => setExpanded(isExpanded ? null : event.id)}
                  >
                    {/* Icon */}
                    <div style={{
                      width: 36,
                      height: 36,
                      borderRadius: 'var(--radius-md)',
                      background: `${color}22`,
                      color,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 16,
                      flexShrink: 0,
                    }}>
                      {getIcon(event.event_type)}
                    </div>

                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 600, color, fontSize: 13 }}>{event.event_type}</span>
                        {event.resource_type && (
                          <span className="badge badge-neutral">{event.resource_type}</span>
                        )}
                        {event.actor_role && (
                          <span className="badge badge-info" style={{ textTransform: 'lowercase' }}>{event.actor_role}</span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, display: 'flex', gap: 'var(--space-lg)' }}>
                        {event.actor_id && <span>Actor: <span style={{ color: 'var(--text-secondary)' }}>{event.actor_id}</span></span>}
                        {event.resource_id && <span>Resource: <span className="mono">{event.resource_id}</span></span>}
                      </div>
                      {isExpanded && (
                        <pre style={{
                          marginTop: 'var(--space-md)',
                          padding: 'var(--space-md)',
                          background: 'var(--bg-surface-2)',
                          borderRadius: 'var(--radius-md)',
                          fontSize: 11,
                          fontFamily: 'JetBrains Mono, monospace',
                          color: 'var(--color-accent)',
                          overflow: 'auto',
                          maxHeight: 200,
                          border: '1px solid var(--border)',
                        }}>
                          {JSON.stringify(event.payload, null, 2)}
                        </pre>
                      )}
                    </div>

                    {/* Timestamp */}
                    <div style={{
                      fontSize: 11,
                      color: 'var(--text-muted)',
                      flexShrink: 0,
                      fontFamily: 'monospace',
                      alignSelf: 'flex-start',
                      marginTop: 2,
                    }}>
                      {formatDate(event.created_at)}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
