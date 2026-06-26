import { fetchQuery } from '@/lib/db';
import { EmptyState, OwnerBadge, OwnerMetricCard, OwnerSection, OwnerStatPill, OwnerTable } from '@/components/SuperAdminBlocks';
import { formatCount, formatDate, formatDateTime, formatPercent, formatPlan, safeUpper } from '@/lib/superadmin';

export const dynamic = 'force-dynamic';

const funnelSteps = [
  { key: 'business_profile_completed', label: 'Business profile' },
  { key: 'location_created', label: 'Location created' },
  { key: 'staff_created', label: 'Staff created' },
  { key: 'products_loaded', label: 'Products loaded' },
  { key: 'first_stock_received', label: 'First stock received' },
  { key: 'hardware_paired', label: 'Hardware paired' },
  { key: 'first_sale_completed', label: 'First sale completed' },
  { key: 'go_live_approved', label: 'Go-live approved' },
];

export default async function OnboardingPage() {
  const [sessionRows, eventRows] = await Promise.all([
    fetchQuery(`
      SELECT
        t.id,
        t.name,
        t.subscription_tier,
        COALESCE(os.current_step, 1) AS current_step,
        COALESCE(os.converted_to_paid, FALSE) AS converted_to_paid,
        COALESCE(os.business_profile_completed, FALSE) AS business_profile_completed,
        COALESCE(os.location_created, FALSE) AS location_created,
        COALESCE(os.staff_created, FALSE) AS staff_created,
        COALESCE(os.products_loaded, FALSE) AS products_loaded,
        COALESCE(os.first_stock_received, FALSE) AS first_stock_received,
        COALESCE(os.hardware_paired, FALSE) AS hardware_paired,
        COALESCE(os.first_sale_completed, FALSE) AS first_sale_completed,
        COALESCE(os.go_live_approved, FALSE) AS go_live_approved,
        os.trial_start_date,
        os.trial_end_date,
        os.grace_period_end_date,
        os.onboarding_type,
        os.updated_at
      FROM tenants t
      LEFT JOIN onboarding_sessions os ON os.tenant_id = t.id
      ORDER BY COALESCE(os.updated_at, t.created_at) DESC
    `),
    fetchQuery(`
      SELECT
        tenant_id,
        t.name AS tenant_name,
        event_type,
        step_number,
        error_message,
        onboarding_events.created_at
      FROM onboarding_events
      LEFT JOIN tenants t ON t.id = onboarding_events.tenant_id
      ORDER BY onboarding_events.created_at DESC
      LIMIT 12
    `),
  ]);

  const total = sessionRows.length || 1;
  const counts = funnelSteps.map((step) => ({
    ...step,
    count: sessionRows.filter((row: any) => row[step.key]).length,
  }));
  const activeTrials = sessionRows.filter((row: any) => !row.converted_to_paid).length;
  const completed = sessionRows.filter((row: any) => row.go_live_approved).length;
  const blocked = sessionRows.filter((row: any) => row.trial_end_date && new Date(row.trial_end_date) < new Date() && !row.converted_to_paid).length;

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div>
        <h1 style={{ fontSize: '32px', margin: 0, color: 'var(--text-main)' }}>Onboarding</h1>
        <p className="subtitle" style={{ marginTop: '8px', maxWidth: '720px' }}>
          Track where every tenant is in setup, what is blocking them, and how quickly they move to go-live.
        </p>
      </div>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '18px' }}>
        <OwnerMetricCard label="Trials in progress" value={formatCount(activeTrials)} note="Tenants not yet converted" tone="secondary" />
        <OwnerMetricCard label="Go-live approved" value={formatCount(completed)} note="Fully activated sessions" tone="primary" />
        <OwnerMetricCard label="Blocked trials" value={formatCount(blocked)} note="Trials past end date" tone="warning" />
        <OwnerMetricCard label="Completion rate" value={formatPercent((completed / total) * 100)} note="Sessions that reached approval" tone="primary" />
      </section>

      <OwnerSection title="Onboarding funnel" subtitle="Each step shows how far clients are progressing.">
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px' }}>
          {counts.map((step) => (
            <OwnerStatPill key={step.key} label={step.label} value={formatCount(step.count)} tone={step.count > 0 ? 'primary' : 'muted'} />
          ))}
        </section>
      </OwnerSection>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '18px' }}>
        <OwnerSection title="Sessions" subtitle="Live onboarding state for each tenant.">
          {sessionRows.length ? (
            <OwnerTable headers={['Tenant', 'Plan', 'Step', 'Status', 'Trial window']}>
              {sessionRows.slice(0, 12).map((row: any) => (
                <tr key={row.id} style={{ borderBottom: '1px solid var(--panel-border)' }}>
                  <td style={{ padding: '14px 12px' }}>
                    <div style={{ fontWeight: 700, color: 'var(--text-main)' }}>{row.name}</div>
                    <div style={{ marginTop: '4px', fontSize: '12px', color: 'var(--text-muted)' }}>{row.onboarding_type}</div>
                  </td>
                  <td style={{ padding: '14px 12px', color: 'var(--text-muted)' }}>{formatPlan(row.subscription_tier)}</td>
                  <td style={{ padding: '14px 12px', color: 'var(--text-main)' }}>Step {formatCount(row.current_step)}</td>
                  <td style={{ padding: '14px 12px' }}>
                    <OwnerBadge tone={row.converted_to_paid ? 'primary' : row.trial_end_date && new Date(row.trial_end_date) < new Date() ? 'warning' : 'secondary'}>
                      {row.converted_to_paid ? 'LIVE' : row.trial_end_date && new Date(row.trial_end_date) < new Date() ? 'BLOCKED' : 'IN PROGRESS'}
                    </OwnerBadge>
                  </td>
                  <td style={{ padding: '14px 12px', color: 'var(--text-muted)' }}>
                    {formatDate(row.trial_start_date)} - {formatDate(row.trial_end_date)}
                    <div style={{ fontSize: '12px', marginTop: '4px' }}>Updated {formatDateTime(row.updated_at)}</div>
                  </td>
                </tr>
              ))}
            </OwnerTable>
          ) : (
            <EmptyState
              title="No onboarding sessions yet"
              description="New tenants will appear here with their step-by-step setup progress."
            />
          )}
        </OwnerSection>

        <OwnerSection title="Recent events" subtitle="The operational log of onboarding activity.">
          {eventRows.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {eventRows.map((event: any) => (
                <div key={`${event.tenant_id}-${event.created_at}-${event.event_type}`} style={{ padding: '14px 16px', borderRadius: '14px', border: '1px solid var(--panel-border)', background: 'var(--hover-bg)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                    <div>
                    <div style={{ fontWeight: 700, color: 'var(--text-main)' }}>{event.event_type}</div>
                    <div style={{ marginTop: '4px', fontSize: '12px', color: 'var(--text-muted)' }}>
                        {event.tenant_name || 'Unknown tenant'} · Step {event.step_number || '—'}
                    </div>
                  </div>
                    <div style={{ textAlign: 'right' }}>
                      <OwnerBadge tone={event.error_message ? 'warning' : 'primary'}>{event.error_message ? 'ERROR' : 'OK'}</OwnerBadge>
                      <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>{formatDateTime(event.created_at)}</div>
                    </div>
                  </div>
                  {event.error_message && <div style={{ marginTop: '10px', fontSize: '12px', color: 'var(--text-muted)' }}>{event.error_message}</div>}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No onboarding events yet"
              description="Event logs will appear here as tenants move through the setup flow."
            />
          )}
        </OwnerSection>
      </section>

      <OwnerSection title="Blockers" subtitle="Sessions that need attention before they can go live.">
        {blocked ? (
          <div style={{ display: 'grid', gap: '14px' }}>
            {sessionRows
              .filter((row: any) => row.trial_end_date && new Date(row.trial_end_date) < new Date() && !row.converted_to_paid)
              .slice(0, 6)
              .map((row: any) => (
                <div key={row.id} style={{ padding: '16px', borderRadius: '14px', border: '1px solid var(--panel-border)', background: 'var(--hover-bg)', display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
                  <div>
                    <div style={{ fontWeight: 700, color: 'var(--text-main)' }}>{row.name}</div>
                    <div style={{ marginTop: '4px', fontSize: '12px', color: 'var(--text-muted)' }}>
                      Trial ended {formatDate(row.trial_end_date)} · Current step {formatCount(row.current_step)}
                    </div>
                  </div>
                  <OwnerBadge tone="warning">Needs review</OwnerBadge>
                </div>
              ))}
          </div>
        ) : (
          <EmptyState
            title="No blockers"
            description="Once trials begin to stall or onboarding steps are missed, they will be listed here."
          />
        )}
      </OwnerSection>
    </div>
  );
}
