import { fetchTenantQuery } from '@/lib/db';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function StocktakeSessionsPage() {
  const cookieStore = cookies();
  const tenantId = cookieStore.get('tenant_id')?.value;
  if (!tenantId) redirect('/login');

  const sessions = await fetchTenantQuery(tenantId, `
    SELECT 
      ss.id,
      ss.status,
      ss.expected_count,
      ss.scanned_count,
      ss.matched_count,
      ss.missing_count,
      ss.unexpected_count,
      ss.started_at,
      ss.completed_at,
      st.name as clerk_name,
      l.name as location_name
    FROM stocktake_sessions ss
    JOIN staff st ON ss.clerk_id = st.id
    LEFT JOIN locations l ON ss.location_id = l.id
    ORDER BY ss.started_at DESC
    LIMIT 50
  `);

  const statusColor: Record<string, string> = {
    active:    'rgba(74,222,128,0.15)',
    completed: 'rgba(96,165,250,0.12)',
    cancelled: 'rgba(239,68,68,0.1)',
  };
  const statusTextColor: Record<string, string> = {
    active:    'var(--primary)',
    completed: 'var(--secondary)',
    cancelled: 'var(--danger)',
  };

  return (
    <div className="animate-fade-in">
      <h1>Stocktake Sessions</h1>
      <p className="subtitle">Live audit sessions conducted by your stock clerks.</p>

      {sessions.length === 0 ? (
        <div className="glass-panel" style={{ marginTop: '32px', textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: '40px', marginBottom: '16px' }}>📦</div>
          <div style={{ fontWeight: 600, fontSize: '16px', marginBottom: '8px' }}>No stocktake sessions yet</div>
          <div style={{ fontSize: '13px' }}>When a stock clerk logs in and begins scanning, their session will appear here in real-time.</div>
        </div>
      ) : (
        <div className="glass-panel" style={{ marginTop: '32px' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Clerk</th>
                <th>Location</th>
                <th style={{ textAlign: 'center' }}>Expected</th>
                <th style={{ textAlign: 'center' }}>Scanned</th>
                <th style={{ textAlign: 'center' }}>✓ Matched</th>
                <th style={{ textAlign: 'center' }}>✗ Missing</th>
                <th style={{ textAlign: 'center' }}>! Extra</th>
                <th>Started</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s: any) => {
                const started = new Date(s.started_at);
                const ended   = s.completed_at ? new Date(s.completed_at) : new Date();
                const diffMs  = ended.getTime() - started.getTime();
                const mins    = Math.floor(diffMs / 60000);
                const secs    = Math.floor((diffMs % 60000) / 1000);
                const duration = `${mins}m ${secs}s`;
                const accuracy = s.expected_count > 0
                  ? Math.round((s.matched_count / s.expected_count) * 100)
                  : 0;

                return (
                  <tr key={s.id}>
                    <td>
                      <span style={{
                        padding: '4px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700,
                        background: statusColor[s.status] || 'var(--hover-bg)',
                        color: statusTextColor[s.status] || 'var(--text-main)',
                      }}>
                        {s.status === 'active' ? '● LIVE' : s.status.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ fontWeight: 600 }}>{s.clerk_name}</td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '13px' }}>{s.location_name || '—'}</td>
                    <td style={{ textAlign: 'center' }}>{s.expected_count ?? '—'}</td>
                    <td style={{ textAlign: 'center', fontWeight: 600 }}>{s.scanned_count}</td>
                    <td style={{ textAlign: 'center', color: 'var(--primary)', fontWeight: 700 }}>{s.matched_count}</td>
                    <td style={{ textAlign: 'center', color: 'var(--danger)', fontWeight: 700 }}>{s.missing_count}</td>
                    <td style={{ textAlign: 'center', color: 'var(--warning)', fontWeight: 700 }}>{s.unexpected_count}</td>
                    <td style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{started.toLocaleString()}</td>
                    <td style={{ fontSize: '12px' }}>
                      {duration}
                      {s.expected_count > 0 && (
                        <span style={{ marginLeft: '6px', fontSize: '11px', color: accuracy >= 90 ? 'var(--primary)' : accuracy >= 70 ? 'var(--warning)' : 'var(--danger)', fontWeight: 600 }}>
                          ({accuracy}% acc)
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
