import { fetchQuery } from '@/lib/db';
import { EmptyState, OwnerBadge, OwnerMetricCard, OwnerSection, OwnerTable } from '@/components/SuperAdminBlocks';
import { formatCount, formatDate, formatDateTime, safeUpper } from '@/lib/superadmin';

export const dynamic = 'force-dynamic';

export default async function CompliancePage() {
  const [summaryRows, tenantRows, conflictRows, failedLoginRows] = await Promise.all([
    fetchQuery(`
      SELECT
        COUNT(t.id) FILTER (WHERE ts.zra_enabled = TRUE)::int AS zra_ready,
        COUNT(t.id) FILTER (WHERE COALESCE(ts.zra_enabled, FALSE) = FALSE)::int AS zra_missing,
        COUNT(t.id) FILTER (WHERE ts.zra_enabled = TRUE AND (ts.zra_vsdc_url IS NULL OR ts.zra_vsdc_url = ''))::int AS certs_expiring_soon,
        COUNT(t.id) FILTER (WHERE COALESCE(UPPER(t.status), 'ACTIVE') = 'SUSPENDED')::int AS suspended
      FROM tenants t
      LEFT JOIN tenant_settings ts ON ts.tenant_id = t.id
    `),
    fetchQuery(`
      SELECT
        t.id,
        t.name,
        COALESCE(UPPER(t.status), 'ACTIVE') AS safe_status,
        COALESCE(ts.zra_enabled, FALSE) AS zra_configured,
        ts.zra_vsdc_url,
        t.created_at
      FROM tenants t
      LEFT JOIN tenant_settings ts ON ts.tenant_id = t.id
      WHERE COALESCE(ts.zra_enabled, FALSE) = FALSE
         OR (ts.zra_enabled = TRUE AND (ts.zra_vsdc_url IS NULL OR ts.zra_vsdc_url = ''))
      ORDER BY t.created_at ASC
      LIMIT 12
    `),
    fetchQuery(`
      SELECT
        q.tenant_id,
        t.name,
        COUNT(q.id) FILTER (WHERE q.status = 'PENDING')::int AS unresolved,
        COUNT(q.id) FILTER (WHERE q.status = 'COMPLETED')::int AS resolved,
        MAX(q.created_at) AS latest_at
      FROM zra_sync_queue q
      LEFT JOIN tenants t ON t.id = q.tenant_id
      GROUP BY q.tenant_id, t.name
      HAVING COUNT(q.id) FILTER (WHERE q.status = 'PENDING') > 0
      ORDER BY latest_at DESC
      LIMIT 10
    `),
    fetchQuery(`
      SELECT
        tenant_id,
        t.name,
        COUNT(*)::int AS failed_logins,
        MAX(platform_access_events.created_at) AS latest_at
      FROM platform_access_events
      LEFT JOIN tenants t ON t.id = platform_access_events.tenant_id
      WHERE event_type = 'FAILED_LOGIN'
      GROUP BY tenant_id, t.name
      ORDER BY latest_at DESC
      LIMIT 10
    `),
  ]);

  const summary = summaryRows[0] ?? {};

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div>
        <h1 style={{ fontSize: '32px', margin: 0, color: 'var(--text-main)' }}>Compliance & Risk</h1>
        <p className="subtitle" style={{ marginTop: '8px', maxWidth: '720px' }}>
          Watch for compliance gaps, certificate expiry, unresolved conflicts, and repeated login failure patterns.
        </p>
      </div>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '18px' }}>
        <OwnerMetricCard label="ZRA ready" value={formatCount(summary.zra_ready)} note="Configured and active for VSDC sync" tone="primary" />
        <OwnerMetricCard label="ZRA missing" value={formatCount(summary.zra_missing)} note="Needs tax setup attention" tone="warning" />
        <OwnerMetricCard label="VSDC Config Missing" value={formatCount(summary.certs_expiring_soon)} note="Enabled but missing credentials" tone="warning" />
        <OwnerMetricCard label="Suspended tenants" value={formatCount(summary.suspended)} note="Platform status restrictions" tone="secondary" />
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '18px' }}>
        <OwnerSection title="Risky tenants" subtitle="Tenants with missing compliance setup or expiring certificates.">
          {tenantRows.length ? (
            <OwnerTable headers={['Tenant', 'Status', 'ZRA', 'Certificate', 'Joined']}>
              {tenantRows.map((row: any) => (
                <tr key={row.id} style={{ borderBottom: '1px solid var(--panel-border)' }}>
                  <td style={{ padding: '14px 12px', color: 'var(--text-main)', fontWeight: 600 }}>{row.name}</td>
                  <td style={{ padding: '14px 12px' }}>
                    <OwnerBadge tone={safeUpper(row.safe_status) === 'SUSPENDED' ? 'warning' : 'muted'}>{safeUpper(row.safe_status)}</OwnerBadge>
                  </td>
                  <td style={{ padding: '14px 12px' }}>
                    <OwnerBadge tone={row.zra_configured ? 'primary' : 'warning'}>{row.zra_configured ? 'READY' : 'MISSING'}</OwnerBadge>
                  </td>
                  <td style={{ padding: '14px 12px', color: 'var(--text-muted)' }}>
                    {row.zra_configured ? (row.zra_vsdc_url ? 'Configured' : 'Missing URL') : '—'}
                  </td>
                  <td style={{ padding: '14px 12px', color: 'var(--text-muted)' }}>{formatDate(row.created_at)}</td>
                </tr>
              ))}
            </OwnerTable>
          ) : (
            <EmptyState title="No compliance risks" description="Risky tenants will appear here when certificates are missing or near expiry." />
          )}
        </OwnerSection>

        <OwnerSection title="Sync conflicts" subtitle="Tenants with unresolved sync conflicts.">
          {conflictRows.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {conflictRows.map((row: any) => (
                <div key={`${row.tenant_id}-${row.latest_at}`} style={{ padding: '14px 16px', borderRadius: '14px', border: '1px solid var(--panel-border)', background: 'var(--hover-bg)', display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                  <div>
                    <div style={{ fontWeight: 700, color: 'var(--text-main)' }}>{row.name || row.tenant_id}</div>
                    <div style={{ marginTop: '4px', fontSize: '12px', color: 'var(--text-muted)' }}>
                      {formatCount(row.unresolved)} pending offline invoice(s)
                    </div>
                  </div>
                  <OwnerBadge tone="warning">{formatDateTime(row.latest_at)}</OwnerBadge>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No unresolved sync conflicts" description="Any repeated sync conflicts will be surfaced here for review." />
          )}
        </OwnerSection>
      </section>

      <OwnerSection title="Failed logins" subtitle="Repeated failed access attempts are surfaced here.">
        {failedLoginRows.length ? (
          <OwnerTable headers={['Tenant', 'Failed logins', 'Latest attempt']}>
            {failedLoginRows.map((row: any) => (
              <tr key={`${row.tenant_id}-${row.latest_at}`} style={{ borderBottom: '1px solid var(--panel-border)' }}>
                <td style={{ padding: '14px 12px', color: 'var(--text-main)', fontWeight: 600 }}>{row.name || row.tenant_id}</td>
                <td style={{ padding: '14px 12px', color: 'var(--text-main)' }}>{formatCount(row.failed_logins)}</td>
                <td style={{ padding: '14px 12px', color: 'var(--text-muted)' }}>{formatDateTime(row.latest_at)}</td>
              </tr>
            ))}
          </OwnerTable>
        ) : (
          <EmptyState title="No failed logins recorded" description="Once failed login events are captured, this page will flag them for review." />
        )}
      </OwnerSection>
    </div>
  );
}
