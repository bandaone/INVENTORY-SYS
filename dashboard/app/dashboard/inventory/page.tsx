'use client'

import { useState, useEffect } from 'react'
import Header from '@/components/Header'
import { listSerialItems } from '@/lib/api'

type SerialItem = {
  id: string
  serial_number: string
  status: 'IN_STOCK' | 'SOLD' | 'MISSING' | 'TRANSFERRED'
  inventory_item_id: string
  location_id: string
  retail_price: number
  cost_price: number
  batch_date: string
  last_scanned_at: string | null
  created_at: string
}

const STATUS_CONFIG = {
  IN_STOCK: { label: 'In Stock', class: 'badge-success' },
  SOLD: { label: 'Sold', class: 'badge-info' },
  MISSING: { label: 'Missing', class: 'badge-danger' },
  TRANSFERRED: { label: 'Transferred', class: 'badge-warning' },
}

const FILTER_OPTIONS = ['ALL', 'IN_STOCK', 'SOLD', 'MISSING', 'TRANSFERRED']

export default function InventoryPage() {
  const [items, setItems] = useState<SerialItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('ALL')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const PER_PAGE = 20

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const token = sessionStorage.getItem('retail_token') || ''
        const params: Record<string, string> = {
          limit: String(PER_PAGE),
          offset: String((page - 1) * PER_PAGE),
        }
        if (filter !== 'ALL') params.status = filter
        if (search) params.serial_number = search

        const data = await listSerialItems(token, params)
        setItems(data.serial_items || [])
      } catch (err) {
        setError('Failed to load inventory. Make sure the backend is running.')
        // Demo data
        setItems([
          {
            id: '1',
            serial_number: 'RTL-2026-A1B2C3',
            status: 'IN_STOCK',
            inventory_item_id: 'item_001',
            location_id: 'loc_store_a',
            retail_price: 25000,
            cost_price: 12000,
            batch_date: new Date().toISOString(),
            last_scanned_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
          },
          {
            id: '2',
            serial_number: 'RTL-2026-D4E5F6',
            status: 'SOLD',
            inventory_item_id: 'item_002',
            location_id: 'loc_store_b',
            retail_price: 45000,
            cost_price: 20000,
            batch_date: new Date().toISOString(),
            last_scanned_at: null,
            created_at: new Date().toISOString(),
          },
          {
            id: '3',
            serial_number: 'RTL-2026-G7H8I9',
            status: 'MISSING',
            inventory_item_id: 'item_001',
            location_id: 'loc_store_a',
            retail_price: 25000,
            cost_price: 12000,
            batch_date: new Date().toISOString(),
            last_scanned_at: new Date(Date.now() - 86400000).toISOString(),
            created_at: new Date().toISOString(),
          },
        ])
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [filter, search, page])

  const formatPrice = (price: number) =>
    new Intl.NumberFormat('en-ZM', { style: 'currency', currency: 'ZMW', maximumFractionDigits: 0 }).format(price / 100)

  const formatDate = (date: string | null) =>
    date ? new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

  return (
    <>
      <Header
        title="Serial Inventory"
        subtitle="Track every garment from ingestion to sale"
        actions={
          <button className="btn btn-primary btn-sm">+ Generate Serials</button>
        }
      />
      <div className="animate-fade-in" style={{ paddingTop: 'var(--header-height)' }}>

        {/* Summary Stats */}
        <div className="grid-4" style={{ marginBottom: 'var(--space-xl)' }}>
          {FILTER_OPTIONS.slice(1).map((status) => {
            const count = items.filter(i => i.status === status).length
            const cfg = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG]
            return (
              <div key={status} className="stat-card" style={{ cursor: 'pointer' }} onClick={() => setFilter(filter === status ? 'ALL' : status)}>
                <div className="stat-card-value" style={{
                  color: status === 'MISSING' ? 'var(--color-danger)' :
                         status === 'SOLD' ? 'var(--color-success)' :
                         status === 'TRANSFERRED' ? 'var(--color-warning)' : 'var(--color-primary)',
                }}>{count}</div>
                <div className="stat-card-label">{cfg.label}</div>
              </div>
            )
          })}
        </div>

        {/* Filters & Search */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-md)',
          marginBottom: 'var(--space-lg)',
          flexWrap: 'wrap',
        }}>
          <div style={{ flex: 1, maxWidth: 320 }}>
            <input
              type="text"
              className="input"
              placeholder="Search by serial number..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            />
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
            {FILTER_OPTIONS.map((f) => (
              <button
                key={f}
                className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => { setFilter(f); setPage(1) }}
              >
                {f === 'ALL' ? 'All' : STATUS_CONFIG[f as keyof typeof STATUS_CONFIG]?.label || f}
              </button>
            ))}
          </div>
        </div>

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
            ⚠ {error} — Showing demo data below.
          </div>
        )}

        {/* Table */}
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Serial Number</th>
                <th>Status</th>
                <th>Inventory Item</th>
                <th>Location</th>
                <th>Retail Price</th>
                <th>Cost Price</th>
                <th>Last Scanned</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8}>
                    <div className="empty-state">
                      <div className="loading-spinner" />
                      <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading serials...</span>
                    </div>
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <div className="empty-state">
                      <div className="empty-state-icon">◉</div>
                      <div style={{ fontWeight: 600 }}>No items found</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        Generate serials during stock ingestion to see them here
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const cfg = STATUS_CONFIG[item.status]
                  return (
                    <tr key={item.id}>
                      <td>
                        <span className="mono">{item.serial_number}</span>
                      </td>
                      <td>
                        <span className={`badge ${cfg.class}`}>{cfg.label}</span>
                      </td>
                      <td>
                        <span className="truncate" style={{ maxWidth: 160, display: 'block', color: 'var(--text-secondary)' }}>
                          {item.inventory_item_id}
                        </span>
                      </td>
                      <td style={{ color: 'var(--text-secondary)' }}>{item.location_id}</td>
                      <td style={{ fontWeight: 600 }}>{formatPrice(item.retail_price)}</td>
                      <td style={{ color: 'var(--text-muted)' }}>{formatPrice(item.cost_price)}</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{formatDate(item.last_scanned_at)}</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{formatDate(item.created_at)}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 'var(--space-lg)',
          color: 'var(--text-muted)',
          fontSize: 13,
        }}>
          <span>Showing {items.length} items</span>
          <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page === 1}
            >
              ← Previous
            </button>
            <span className="btn btn-secondary btn-sm" style={{ cursor: 'default' }}>Page {page}</span>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setPage(page + 1)}
              disabled={items.length < PER_PAGE}
            >
              Next →
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
