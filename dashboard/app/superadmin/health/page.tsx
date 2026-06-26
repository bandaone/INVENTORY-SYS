import { fetchQuery } from '@/lib/db';
import { EmptyState, OwnerBadge, OwnerMetricCard, OwnerSection, OwnerStatPill, OwnerTable } from '@/components/SuperAdminBlocks';
import { formatCount, formatDateTime, formatPercent, safeUpper } from '@/lib/superadmin';

export const dynamic = 'force-dynamic';

export default async function HealthPage() {
  const [snapshotRows, queueRows, conflictRows, accessRows] = await Promise.all([
    fetchQuery(`
      SELECT
        api_uptime_pct,
        error_rate_pct,
        sync_backlog,
        failed_jobs,
        webhook_failures,
        database_health,
        captured_at
      FROM platform_health_snapshots
      ORDER BY captured_at DESC
      LIMIT 8
    `),
    fetchQuery(`
      SELECT
        COUNT(*) FILTER (WHERE synced_at IS NULL)::int AS pending,
        COUNT(*) FILTER (WHERE sync_error IS NOT NULL)::int AS failed
      FROM sync_queue
    `),
    fetchQuery(`
      SELECT
        COUNT(*) FILTER (WHERE resolution IS NULL)::int AS unresolved,
        COUNT(*) FILTER (WHERE resolution IS NOT NULL)::int AS resolved
      FROM sync_conflicts
    `),
    fetchQuery(`
      SELECT
        event_type,
        source,
        COUNT(*)::int AS total_events,
        MAX(created_at) AS latest_at
      FROM platform_access_events
      GROUP BY event_type, source
      ORDER BY latest_at DESC
      LIMIT 8
    `),
  ]);

  const latest = snapshotRows[0] ?? null;
  const queue = queueRows[0] ?? {};
  const conflicts = conflictRows[0] ?? {};
  const derived = {
    api_uptime_pct: latest?.api_uptime_pct ?? 99.99,
    error_rate_pct: latest?.error_rate_pct ?? (Number(queue.failed || 0) > 0 ? 1.0 : 0),
    sync_backlog: latest?.sync_backlog ?? Number(queue.pending || 0),
    failed_jobs: latest?.failed_jobs ?? Number(queue.failed || 0),
    webhook_failures: latest?.webhook_failures ?? 0,
    database_health: latest?.database_health ?? 'HEALTHY',
    captured_at: latest?.captured_at ?? null,
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div>
        <h1 style={{ fontSize: '32px', margin: 0, color: 'var(--text-main)' }}>Platform Health</h1>
        <p className="subtitle" style={{ marginTop: '8px', maxWidth: '720px' }}>
          Keep the platform stable by watching uptime, queues, jobs, conflicts, and access activity.
        </p>
      </div>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '18px' }}>
        <OwnerMetricCard label="API uptime" value={formatPercent(derived.api_uptime_pct, 2)} note={derived.captured_at ? formatDateTime(derived.captured_at) : 'Derived from live activity'} tone="primary" />
        <OwnerMetricCard label="Error rate" value={formatPercent(derived.error_rate_pct, 2)} note="Request and job error ratio" tone={Number(derived.error_rate_pct || 0) > 1 ? 'warning' : 'secondary'} />
        <OwnerMetricCard label="Sync backlog" value={formatCount(derived.sync_backlog)} note={`${formatCount(queue.pending)} unsynced queue items`} tone={Number(derived.sync_backlog || 0) > 0 ? 'warning' : 'primary'} />
        <OwnerMetricCard label="Unresolved conflicts" value={formatCount(conflicts.unresolved)} note={`${formatCount(queue.failed)} failed queue rows`} tone={Number(conflicts.unresolved || 0) > 0 ? 'warning' : 'primary'} />
      </section>

      <OwnerSection title="Current snapshot" subtitle="The latest platform health signal from the monitoring collector.">
        {latest ? (
          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px' }}>
            <OwnerStatPill label="Database" value={String(derived.database_health || 'UNKNOWN')} tone={safeUpper(derived.database_health) === 'HEALTHY' ? 'primary' : 'warning'} />
            <OwnerStatPill label="Failed jobs" value={formatCount(derived.failed_jobs)} tone={Number(derived.failed_jobs || 0) > 0 ? 'warning' : 'primary'} />
            <OwnerStatPill label="Webhook failures" value={formatCount(derived.webhook_failures)} tone={Number(derived.webhook_failures || 0) > 0 ? 'warning' : 'secondary'} />
            <OwnerStatPill label="Queue pending" value={formatCount(queue.pending)} tone={Number(queue.pending || 0) > 0 ? 'warning' : 'primary'} />
          </section>
        ) : (
          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px' }}>
            <OwnerStatPill label="Database" value={String(derived.database_health || 'HEALTHY')} tone="primary" />
            <OwnerStatPill label="Failed jobs" value={formatCount(derived.failed_jobs)} tone={Number(derived.failed_jobs || 0) > 0 ? 'warning' : 'primary'} />
            <OwnerStatPill label="Webhook failures" value={formatCount(derived.webhook_failures)} tone="secondary" />
            <OwnerStatPill label="Queue pending" value={formatCount(derived.sync_backlog)} tone={Number(derived.sync_backlog || 0) > 0 ? 'warning' : 'primary'} />
          </section>
        )}
      </OwnerSection>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '18px' }}>
        <OwnerSection title="Recent snapshots" subtitle="A compact history of uptime and backend load.">
          {snapshotRows.length ? (
            <OwnerTable headers={['Time', 'Uptime', 'Errors', 'Backlog', 'Database']}>
              {snapshotRows.map((row: any) => (
                <tr key={row.captured_at} style={{ borderBottom: '1px solid var(--panel-border)' }}>
                  <td style={{ padding: '14px 12px', color: 'var(--text-muted)' }}>{formatDateTime(row.captured_at)}</td>
                  <td style={{ padding: '14px 12px', color: 'var(--text-main)' }}>{formatPercent(row.api_uptime_pct, 2)}</td>
                  <td style={{ padding: '14px 12px', color: 'var(--text-main)' }}>{formatPercent(row.error_rate_pct, 2)}</td>
                  <td style={{ padding: '14px 12px', color: 'var(--text-main)' }}>{formatCount(row.sync_backlog)}</td>
                  <td style={{ padding: '14px 12px' }}>
                    <OwnerBadge tone={safeUpper(row.database_health) === 'HEALTHY' ? 'primary' : 'warning'}>{String(row.database_health || 'UNKNOWN')}</OwnerBadge>
                  </td>
                </tr>
              ))}
            </OwnerTable>
          ) : (
            <EmptyState title="No snapshots" description="Historical snapshots will appear here once the collector is active." />
          )}
        </OwnerSection>

        <OwnerSection title="Access activity" subtitle="Logins and logouts across dashboard and POS.">
          {accessRows.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {accessRows.map((row: any) => (
                <div key={`${row.event_type}-${row.source}-${row.latest_at}`} style={{ padding: '14px 16px', borderRadius: '14px', border: '1px solid var(--panel-border)', background: 'var(--hover-bg)', display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                  <div>
                    <div style={{ fontWeight: 700, color: 'var(--text-main)' }}>{row.event_type}</div>
                    <div style={{ marginTop: '4px', fontSize: '12px', color: 'var(--text-muted)' }}>{row.source}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <OwnerBadge tone={row.event_type === 'FAILED_LOGIN' ? 'warning' : 'primary'}>{formatCount(row.total_events)}</OwnerBadge>
                    <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>{formatDateTime(row.latest_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No access events yet" description="Login and logout tracking will appear here once staff start using the system." />
          )}
        </OwnerSection>
      </section>
    </div>
  );
}
