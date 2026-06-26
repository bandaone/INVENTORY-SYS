import Header from '@/components/Header'
import Link from 'next/link'

const QUICK_STATS = [
  {
    icon: '◉',
    label: 'Total Serials',
    value: '—',
    change: null,
    color: 'var(--color-primary)',
    bg: 'rgba(108,99,255,0.12)',
    href: '/dashboard/inventory',
  },
  {
    icon: '✓',
    label: 'Items Sold Today',
    value: '—',
    change: null,
    color: 'var(--color-success)',
    bg: 'rgba(46,213,115,0.12)',
    href: '/dashboard/orders',
  },
  {
    icon: '⚠',
    label: 'Missing Items',
    value: '—',
    change: null,
    color: 'var(--color-danger)',
    bg: 'rgba(255,71,87,0.12)',
    href: '/dashboard/inventory?status=MISSING',
  },
  {
    icon: '⟳',
    label: 'Sync Conflicts',
    value: '—',
    change: null,
    color: 'var(--color-warning)',
    bg: 'rgba(255,179,71,0.12)',
    href: '/dashboard/sync',
  },
]

const RECENT_ACTIVITY = [
  { type: 'SALE', serial: 'RTL-2026-A1B2C3', location: 'Store A', time: '2 min ago', icon: '✓', color: 'var(--color-success)' },
  { type: 'INGESTION', serial: 'RTL-2026-D4E5F6', location: 'Warehouse', time: '15 min ago', icon: '↑', color: 'var(--color-primary)' },
  { type: 'STOCKTAKE', serial: 'RTL-2026-G7H8I9', location: 'Store B', time: '1 hr ago', icon: '◎', color: 'var(--color-info)' },
  { type: 'MISSING', serial: 'RTL-2026-J0K1L2', location: 'Store A', time: '2 hr ago', icon: '✗', color: 'var(--color-danger)' },
  { type: 'TRANSFER', serial: 'RTL-2026-M3N4O5', location: 'Store A → B', time: '4 hr ago', icon: '↔', color: 'var(--color-accent)' },
]

export default function DashboardPage() {
  return (
    <>
      <Header
        title="Dashboard"
        subtitle="Real-time overview of your retail operations"
        actions={
          <Link href="/dashboard/stocktake" className="btn btn-primary btn-sm">
            + Start Stocktake
          </Link>
        }
      />
      <div className="animate-fade-in" style={{ paddingTop: 'var(--header-height)' }}>

        {/* Stats Grid */}
        <div className="grid-4" style={{ marginBottom: 'var(--space-xl)' }}>
          {QUICK_STATS.map((stat) => (
            <Link key={stat.label} href={stat.href} style={{ textDecoration: 'none' }}>
              <div className="stat-card" style={{ cursor: 'pointer' }}>
                <div className="stat-card-icon" style={{ background: stat.bg, color: stat.color }}>
                  <span style={{ fontSize: 20 }}>{stat.icon}</span>
                </div>
                <div className="stat-card-value">{stat.value}</div>
                <div className="stat-card-label">{stat.label}</div>
                <div className="stat-card-change" style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                  Connect backend to see live data
                </div>
              </div>
            </Link>
          ))}
        </div>

        <div className="grid-2">
          {/* Recent Activity */}
          <div className="card">
            <div className="section-header">
              <div>
                <div className="section-title">Recent Activity</div>
                <div className="section-subtitle">Latest inventory events across all locations</div>
              </div>
              <Link href="/dashboard/audit" className="btn btn-secondary btn-sm">View All</Link>
            </div>
            <div>
              {RECENT_ACTIVITY.map((item, i) => (
                <div key={i} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-md)',
                  padding: '12px 0',
                  borderBottom: i < RECENT_ACTIVITY.length - 1 ? '1px solid var(--border)' : 'none',
                }}>
                  <div style={{
                    width: 32,
                    height: 32,
                    borderRadius: 'var(--radius-sm)',
                    background: `rgba(${item.color === 'var(--color-success)' ? '46,213,115' : item.color === 'var(--color-danger)' ? '255,71,87' : item.color === 'var(--color-primary)' ? '108,99,255' : item.color === 'var(--color-info)' ? '59,130,246' : '0,212,170'},0.15)`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: item.color,
                    fontSize: 14,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}>
                    {item.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="mono">{item.serial}</span>
                      <span className="badge badge-neutral">{item.type}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{item.location}</div>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>{item.time}</div>
                </div>
              ))}
            </div>
          </div>

          {/* System Status */}
          <div className="card">
            <div className="section-header">
              <div>
                <div className="section-title">System Status</div>
                <div className="section-subtitle">Service health and connectivity</div>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
              {[
                { label: 'Backend Proxy', url: '/api/backend', status: 'online' },
                { label: 'PostgreSQL Database', url: 'localhost:5432', status: 'online' },
                { label: 'Redis Queue', url: 'localhost:6379', status: 'online' },
                { label: 'ZRA Gateway', url: 'sandbox.zra.org.zm', status: 'warning' },
                { label: 'MTN MoMo API', url: 'sandbox.momodeveloper.mtn.com', status: 'warning' },
                { label: 'Airtel Money API', url: 'sandbox.airtel.com', status: 'warning' },
              ].map((svc) => (
                <div key={svc.label} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-md)',
                  padding: '10px 12px',
                  background: 'var(--bg-surface-2)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border)',
                }}>
                  <span className={`status-dot ${svc.status}`} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{svc.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{svc.url}</div>
                  </div>
                  <div style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: svc.status === 'online' ? 'var(--color-success)' : 'var(--color-warning)',
                    textTransform: 'uppercase',
                  }}>
                    {svc.status === 'online' ? 'Online' : 'Sandbox'}
                  </div>
                </div>
              ))}
            </div>

            <div style={{
              marginTop: 'var(--space-lg)',
              padding: '12px 14px',
              background: 'rgba(108,99,255,0.08)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid rgba(108,99,255,0.2)',
              fontSize: 12,
              color: 'var(--text-secondary)',
              lineHeight: 1.6,
            }}>
              <strong style={{ color: 'var(--color-primary-light)' }}>Getting Started:</strong>{' '}
              Run <code style={{ fontFamily: 'monospace', color: 'var(--color-accent)' }}>docker-compose up</code> from the project root to launch all services.
              The backend is reached through <code style={{ fontFamily: 'monospace', color: 'var(--color-accent)' }}>/api/backend</code> from the 3000 dashboard.
            </div>
          </div>
        </div>

        {/* Quick Links */}
        <div style={{ marginTop: 'var(--space-xl)' }}>
          <div className="section-title" style={{ marginBottom: 'var(--space-lg)' }}>Quick Actions</div>
          <div className="grid-4">
            {[
              { icon: '◉', label: 'View Serial Inventory', desc: 'Browse all tracked garments', href: '/dashboard/inventory', color: 'var(--color-primary)' },
              { icon: '◎', label: 'Start Stocktake', desc: 'Begin a new counting session', href: '/dashboard/stocktake', color: 'var(--color-accent)' },
              { icon: '⊛', label: 'Audit Trail', desc: 'View all system events', href: '/dashboard/audit', color: 'var(--color-info)' },
              { icon: '⟳', label: 'Sync Conflicts', desc: 'Resolve pending conflicts', href: '/dashboard/sync', color: 'var(--color-warning)' },
            ].map((action) => (
              <Link key={action.href} href={action.href} style={{ textDecoration: 'none' }}>
                <div className="card" style={{ cursor: 'pointer', transition: 'all var(--transition-base)' }}>
                  <div style={{
                    fontSize: 24,
                    marginBottom: 'var(--space-md)',
                    color: action.color,
                  }}>{action.icon}</div>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4, color: 'var(--text-primary)' }}>{action.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{action.desc}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
