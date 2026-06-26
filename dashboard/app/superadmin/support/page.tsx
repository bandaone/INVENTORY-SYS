import { fetchQuery } from '@/lib/db';
import { EmptyState, OwnerBadge, OwnerMetricCard, OwnerSection, OwnerTable } from '@/components/SuperAdminBlocks';
import { formatCount, formatDateTime, safeUpper } from '@/lib/superadmin';

export const dynamic = 'force-dynamic';

export default async function SupportPage() {
  const [ticketRows, blockerRows, conflictRows] = await Promise.all([
    fetchQuery(`
      SELECT
        st.id,
        st.title,
        st.category,
        st.priority,
        st.status,
        st.reporter_name,
        st.assignee_name,
        st.due_at,
        st.created_at,
        t.name AS tenant_name
      FROM support_tickets st
      LEFT JOIN tenants t ON t.id = st.tenant_id
      ORDER BY st.created_at DESC
      LIMIT 20
    `),
    fetchQuery(`
      SELECT
        t.id,
        t.name,
        os.current_step,
        os.trial_end_date,
        os.converted_to_paid,
        os.updated_at
      FROM tenants t
      LEFT JOIN onboarding_sessions os ON os.tenant_id = t.id
      WHERE COALESCE(os.converted_to_paid, FALSE) = FALSE
        AND (os.trial_end_date IS NOT NULL AND os.trial_end_date <= NOW() OR COALESCE(os.current_step, 1) <= 3)
      ORDER BY COALESCE(os.updated_at, t.created_at) DESC
      LIMIT 10
    `),
    fetchQuery(`
      SELECT
        tenant_id,
        COUNT(*) FILTER (WHERE resolution IS NULL)::int AS unresolved,
        MAX(created_at) AS latest_at
      FROM sync_conflicts
      GROUP BY tenant_id
      HAVING COUNT(*) FILTER (WHERE resolution IS NULL) > 0
      ORDER BY latest_at DESC
      LIMIT 10
    `),
  ]);

  const openTickets = ticketRows.filter((row: any) => ['OPEN', 'IN_PROGRESS', 'WAITING_ON_CLIENT'].includes(safeUpper(row.status)));
  const urgentTickets = ticketRows.filter((row: any) => safeUpper(row.priority) === 'URGENT');

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div>
        <h1 style={{ fontSize: '32px', margin: 0, color: 'var(--text-main)' }}>Support</h1>
        <p className="subtitle" style={{ marginTop: '8px', maxWidth: '720px' }}>
          Surface the issues that need human attention: tickets, onboarding blockers, and sync conflicts.
        </p>
      </div>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '18px' }}>
        <OwnerMetricCard label="Open tickets" value={formatCount(openTickets.length)} note="Active support workload" tone="primary" />
        <OwnerMetricCard label="Urgent tickets" value={formatCount(urgentTickets.length)} note="Needs immediate response" tone="warning" />
        <OwnerMetricCard label="Onboarding blockers" value={formatCount(blockerRows.length)} note="Sessions stuck in setup" tone="secondary" />
        <OwnerMetricCard label="Sync conflict tenants" value={formatCount(conflictRows.length)} note="Clients with unresolved conflicts" tone="warning" />
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '18px' }}>
        <OwnerSection title="Open tickets" subtitle="The working queue for support and operations.">
          {ticketRows.length ? (
            <OwnerTable headers={['Tenant', 'Title', 'Priority', 'Status', 'Updated']}>
              {ticketRows.map((row: any) => (
                <tr key={row.id} style={{ borderBottom: '1px solid var(--panel-border)' }}>
                  <td style={{ padding: '14px 12px' }}>
                    <div style={{ fontWeight: 700, color: 'var(--text-main)' }}>{row.tenant_name || 'Unknown tenant'}</div>
                    <div style={{ marginTop: '4px', fontSize: '12px', color: 'var(--text-muted)' }}>{row.category}</div>
                  </td>
                  <td style={{ padding: '14px 12px', color: 'var(--text-main)' }}>{row.title}</td>
                  <td style={{ padding: '14px 12px' }}>
                    <OwnerBadge tone={safeUpper(row.priority) === 'URGENT' ? 'danger' : safeUpper(row.priority) === 'HIGH' ? 'warning' : 'muted'}>
                      {safeUpper(row.priority)}
                    </OwnerBadge>
                  </td>
                  <td style={{ padding: '14px 12px' }}>
                    <OwnerBadge tone={safeUpper(row.status) === 'RESOLVED' ? 'primary' : 'secondary'}>{safeUpper(row.status)}</OwnerBadge>
                  </td>
                  <td style={{ padding: '14px 12px', color: 'var(--text-muted)' }}>{formatDateTime(row.created_at)}</td>
                </tr>
              ))}
            </OwnerTable>
          ) : (
            <EmptyState title="No support tickets" description="Open tickets will show here as soon as the team starts logging issues." />
          )}
        </OwnerSection>

        <OwnerSection title="Onboarding blockers" subtitle="Clients that are stuck before go-live.">
          {blockerRows.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {blockerRows.map((row: any) => (
                <div key={row.id} style={{ padding: '14px 16px', borderRadius: '14px', border: '1px solid var(--panel-border)', background: 'var(--hover-bg)', display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                  <div>
                    <div style={{ fontWeight: 700, color: 'var(--text-main)' }}>{row.name}</div>
                    <div style={{ marginTop: '4px', fontSize: '12px', color: 'var(--text-muted)' }}>
                      Step {formatCount(row.current_step)} · Trial ends {row.trial_end_date ? formatDateTime(row.trial_end_date) : '—'}
                    </div>
                  </div>
                  <OwnerBadge tone="warning">Needs follow-up</OwnerBadge>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No onboarding blockers" description="Blocked sessions will be visible here so the team can intervene early." />
          )}
        </OwnerSection>
      </section>

      <OwnerSection title="Unresolved sync conflicts" subtitle="Tenants with conflict queues that still need resolution.">
        {conflictRows.length ? (
          <OwnerTable headers={['Tenant ID', 'Conflicts', 'Latest']}>
            {conflictRows.map((row: any) => (
              <tr key={`${row.tenant_id}-${row.latest_at}`} style={{ borderBottom: '1px solid var(--panel-border)' }}>
                <td style={{ padding: '14px 12px', color: 'var(--text-main)', fontWeight: 600 }}>{row.tenant_id}</td>
                <td style={{ padding: '14px 12px', color: 'var(--text-main)' }}>{formatCount(row.unresolved)}</td>
                <td style={{ padding: '14px 12px', color: 'var(--text-muted)' }}>{formatDateTime(row.latest_at)}</td>
              </tr>
            ))}
          </OwnerTable>
        ) : (
          <EmptyState title="No unresolved conflicts" description="Any tenant with an open sync conflict will appear here." />
        )}
      </OwnerSection>
    </div>
  );
}
