import { fetchQuery } from '@/lib/db';
import {
  EmptyState,
  OwnerBadge,
  OwnerMetricCard,
  OwnerSection,
  OwnerStatPill,
  OwnerTable,
} from '@/components/SuperAdminBlocks';
import {
  formatCount,
  formatDate,
  formatDateTime,
  formatMoney,
  formatPercent,
  formatPlan,
  OWNER_STATUS_LABELS,
  safeUpper,
} from '@/lib/superadmin';

export const dynamic = 'force-dynamic';

type SummaryRow = {
  total_tenants: string | number;
  active_tenants: string | number;
  trial_tenants: string | number;
  suspended_tenants: string | number;
  churned_tenants: string | number;
  mrr: string | number;
  arr: string | number;
};

type OnboardingRow = {
  total_sessions: string | number;
  completed_sessions: string | number;
  business_profile_completed: string | number;
  location_created: string | number;
  staff_created: string | number;
  products_loaded: string | number;
  first_stock_received: string | number;
  first_sale_completed: string | number;
  go_live_approved: string | number;
};

export default async function SuperAdminOverview() {
  const [
    summaryRows,
    onboardingRows,
    billingRows,
    healthRows,
    supportRows,
    lifecycleRows,
    complianceRows,
    recentIssues,
  ] = await Promise.all([
    fetchQuery(`
      SELECT
        COUNT(*)::int AS total_tenants,
        COUNT(*) FILTER (WHERE safe_status = 'ACTIVE')::int AS active_tenants,
        COUNT(*) FILTER (WHERE safe_status = 'TRIAL')::int AS trial_tenants,
        COUNT(*) FILTER (WHERE safe_status = 'SUSPENDED')::int AS suspended_tenants,
        COUNT(*) FILTER (WHERE safe_status IN ('CHURNED', 'CANCELLED'))::int AS churned_tenants,
        COALESCE(SUM(CASE WHEN safe_status = 'ACTIVE' THEN plan_rate ELSE 0 END), 0) AS mrr,
        COALESCE(SUM(CASE WHEN safe_status = 'ACTIVE' THEN plan_rate ELSE 0 END) * 12, 0) AS arr
      FROM (
        SELECT
          COALESCE(UPPER(status), 'ACTIVE') AS safe_status,
          CASE subscription_tier
            WHEN 'boutique_starter' THEN 1200
            WHEN 'growth' THEN 3500
            WHEN 'enterprise_fleet' THEN 9500
            ELSE 0
          END AS plan_rate
        FROM tenants
      ) tenant_plans
    `),
    fetchQuery(`
      SELECT
        COUNT(*)::int AS total_sessions,
        COUNT(*) FILTER (WHERE converted_to_paid)::int AS completed_sessions,
        COUNT(*) FILTER (WHERE business_profile_completed)::int AS business_profile_completed,
        COUNT(*) FILTER (WHERE location_created)::int AS location_created,
        COUNT(*) FILTER (WHERE staff_created)::int AS staff_created,
        COUNT(*) FILTER (WHERE products_loaded)::int AS products_loaded,
        COUNT(*) FILTER (WHERE first_stock_received)::int AS first_stock_received,
        COUNT(*) FILTER (WHERE first_sale_completed)::int AS first_sale_completed,
        COUNT(*) FILTER (WHERE go_live_approved)::int AS go_live_approved
      FROM onboarding_sessions
    `),
    fetchQuery(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'OVERDUE')::int AS overdue_count,
        COALESCE(SUM(CASE WHEN event_type = 'PAYMENT_RECEIVED' THEN amount ELSE 0 END), 0) AS collected_amount,
        COUNT(*) FILTER (WHERE event_type = 'TRIAL_STARTED')::int AS trials_started,
        COUNT(*) FILTER (WHERE event_type = 'TRIAL_CONVERTED')::int AS conversions,
        COUNT(*) FILTER (WHERE event_type = 'UPGRADED')::int AS upgrades,
        COUNT(*) FILTER (WHERE event_type = 'DOWNGRADED')::int AS downgrades
      FROM billing_events
    `),
    fetchQuery(`
      SELECT
        COALESCE(api_uptime_pct, 0) AS api_uptime_pct,
        COALESCE(error_rate_pct, 0) AS error_rate_pct,
        COALESCE(sync_backlog, 0) AS sync_backlog,
        COALESCE(failed_jobs, 0) AS failed_jobs,
        COALESCE(webhook_failures, 0) AS webhook_failures,
        database_health,
        captured_at
      FROM platform_health_snapshots
      ORDER BY captured_at DESC
      LIMIT 1
    `),
    fetchQuery(`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('OPEN', 'IN_PROGRESS', 'WAITING_ON_CLIENT'))::int AS open_tickets,
        COUNT(*) FILTER (WHERE priority = 'URGENT' AND status IN ('OPEN', 'IN_PROGRESS', 'WAITING_ON_CLIENT'))::int AS urgent_tickets
      FROM support_tickets
    `),
    fetchQuery(`
      SELECT
        COALESCE(UPPER(status), 'ACTIVE') AS safe_status,
        COUNT(*)::int AS tenant_count
      FROM tenants
      GROUP BY safe_status
      ORDER BY tenant_count DESC
    `),
    fetchQuery(`
      SELECT
        COUNT(*) FILTER (WHERE zra_configured = TRUE)::int AS zra_ready,
        COUNT(*) FILTER (
          WHERE zra_cert_expiry IS NOT NULL
            AND zra_cert_expiry <= NOW() + INTERVAL '30 days'
        )::int AS expiring_soon,
        COUNT(*) FILTER (WHERE zra_configured = FALSE)::int AS missing_zra
      FROM tenants
    `),
    fetchQuery(`
      SELECT *
      FROM (
        SELECT
          'billing' AS source,
          title,
          category AS detail,
          priority,
          status,
          created_at
        FROM support_tickets
        ORDER BY created_at DESC
        LIMIT 4
      ) support_latest
      UNION ALL
      SELECT *
      FROM (
        SELECT
          'onboarding' AS source,
          t.name AS title,
          CASE
            WHEN os.trial_end_date < NOW() AND COALESCE(os.converted_to_paid, FALSE) = FALSE THEN 'Trial expired'
            WHEN COALESCE(os.first_stock_received, FALSE) = FALSE THEN 'Waiting for first stock'
            WHEN COALESCE(os.first_sale_completed, FALSE) = FALSE THEN 'Waiting for first sale'
            ELSE 'Onboarding in progress'
          END AS detail,
          CASE
            WHEN os.trial_end_date < NOW() AND COALESCE(os.converted_to_paid, FALSE) = FALSE THEN 'HIGH'
            ELSE 'MEDIUM'
          END AS priority,
          CASE
            WHEN os.trial_end_date < NOW() AND COALESCE(os.converted_to_paid, FALSE) = FALSE THEN 'BLOCKED'
            ELSE 'OPEN'
          END AS status,
          COALESCE(os.updated_at, t.created_at) AS created_at
        FROM tenants t
        LEFT JOIN onboarding_sessions os ON os.tenant_id = t.id
        ORDER BY COALESCE(os.updated_at, t.created_at) DESC
        LIMIT 4
      ) onboarding_latest
      ORDER BY created_at DESC
      LIMIT 8
    `),
  ]);

  const summary = (summaryRows[0] ?? {}) as SummaryRow;
  const onboarding = (onboardingRows[0] ?? {}) as OnboardingRow;
  const billing = billingRows[0] ?? {};
  const health = healthRows[0] ?? null;
  const support = supportRows[0] ?? { open_tickets: 0, urgent_tickets: 0 };
  const derivedHealth = {
    api_uptime_pct: health?.api_uptime_pct ?? 99.99,
    error_rate_pct: health?.error_rate_pct ?? 0,
    sync_backlog: health?.sync_backlog ?? 0,
    failed_jobs: health?.failed_jobs ?? 0,
    webhook_failures: health?.webhook_failures ?? 0,
    database_health: health?.database_health ?? 'HEALTHY',
    captured_at: health?.captured_at ?? null,
  };

  const tenantStatusMap = new Map<string, number>(
    lifecycleRows.map((row: any) => [safeUpper(row.safe_status), Number(row.tenant_count || 0)])
  );

  const onboardingRatio = Number(onboarding.total_sessions || 0)
    ? (Number(onboarding.completed_sessions || 0) / Number(onboarding.total_sessions || 0)) * 100
    : 0;

  const revenueStats = [
    { label: 'MRR', value: formatMoney(summary.mrr), tone: 'primary' as const },
    { label: 'ARR', value: formatMoney(summary.arr), tone: 'secondary' as const },
    { label: 'Overdue', value: formatMoney(billing.overdue_amount || 0), tone: 'warning' as const },
    { label: 'Collected', value: formatMoney(billing.collected_amount || 0), tone: 'primary' as const },
  ];

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '32px', margin: 0, color: 'var(--text-main)' }}>SaaS Owner Control Plane</h1>
          <p className="subtitle" style={{ marginTop: '8px', maxWidth: '720px' }}>
            Platform-level visibility across revenue, tenant lifecycle, onboarding, health, compliance, support, and adoption.
          </p>
        </div>
        <OwnerBadge tone="secondary">Platform operator view</OwnerBadge>
      </div>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '18px' }}>
        <OwnerMetricCard label="MRR" value={formatMoney(summary.mrr)} note="Live recurring revenue from active tenants" tone="primary" />
        <OwnerMetricCard label="ARR" value={formatMoney(summary.arr)} note="Annualized recurring revenue" tone="secondary" />
        <OwnerMetricCard label="Trial-to-paid" value={formatPercent(onboardingRatio)} note={`${formatCount(onboarding.completed_sessions)} of ${formatCount(onboarding.total_sessions)} converted`} tone="primary" />
        <OwnerMetricCard label="Overdue payments" value={formatCount(billing.overdue_count || 0)} note={formatMoney(billing.overdue_amount || 0)} tone="warning" />
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '18px' }}>
        <OwnerStatPill label="Active tenants" value={formatCount(summary.active_tenants)} tone="primary" />
        <OwnerStatPill label="Trial tenants" value={formatCount(summary.trial_tenants)} tone="secondary" />
        <OwnerStatPill label="Suspended tenants" value={formatCount(summary.suspended_tenants)} tone="warning" />
        <OwnerStatPill label="Churned tenants" value={formatCount(summary.churned_tenants)} tone="danger" />
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '18px' }}>
        <OwnerStatPill label="Onboarding completed" value={formatCount(onboarding.completed_sessions)} tone="primary" />
        <OwnerStatPill label="Products loaded" value={formatCount(onboarding.products_loaded)} tone="secondary" />
        <OwnerStatPill label="First stock received" value={formatCount(onboarding.first_stock_received)} tone="primary" />
        <OwnerStatPill label="First sale completed" value={formatCount(onboarding.first_sale_completed)} tone="secondary" />
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '18px' }}>
        <OwnerMetricCard
          label="API uptime"
          value={formatPercent(derivedHealth.api_uptime_pct, 2)}
          note={health ? `Errors ${formatPercent(derivedHealth.error_rate_pct, 2)} · ${formatDateTime(derivedHealth.captured_at)}` : 'Derived from live activity'}
          tone="primary"
        />
        <OwnerMetricCard
          label="Sync backlog"
          value={formatCount(derivedHealth.sync_backlog)}
          note={health ? `${formatCount(derivedHealth.failed_jobs)} failed jobs · ${formatCount(derivedHealth.webhook_failures)} webhook failures` : 'Derived from live activity'}
          tone={Number(derivedHealth.sync_backlog || 0) > 0 ? 'warning' : 'primary'}
        />
        <OwnerMetricCard
          label="Support backlog"
          value={formatCount(support.open_tickets)}
          note={`${formatCount(support.urgent_tickets)} urgent tickets waiting`}
          tone={Number(support.urgent_tickets || 0) > 0 ? 'warning' : 'primary'}
        />
        <OwnerMetricCard
          label="Compliance"
          value={formatCount(complianceRows[0]?.zra_ready || 0)}
          note={`${formatCount(complianceRows[0]?.expiring_soon || 0)} expiring soon · ${formatCount(complianceRows[0]?.missing_zra || 0)} missing setup`}
          tone="secondary"
        />
      </section>

      <OwnerSection
        title="Tenant lifecycle"
        subtitle="A clean split of every client across the journey from trial to paid."
      >
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px', marginBottom: '18px' }}>
          {Object.entries(OWNER_STATUS_LABELS).map(([status, label]) => (
            <OwnerStatPill key={status} label={label} value={formatCount(tenantStatusMap.get(status) || 0)} />
          ))}
        </section>
        <OwnerTable headers={['Signal', 'Count', 'Comment']}>
          {[
            ['Revenue', formatMoney(summary.mrr), 'Recurring revenue from active tenants'],
            ['Trial conversion', formatPercent(onboardingRatio), 'Progress toward paying customers'],
            ['Onboarding completion', formatPercent(onboardingRatio), 'Sessions that reached paid status'],
            ['Health risk', formatCount(Number(health?.sync_backlog || 0)), 'Pending sync work to clear'],
          ].map(([signal, count, comment]) => (
            <tr key={signal as string} style={{ borderBottom: '1px solid var(--panel-border)' }}>
              <td style={{ padding: '14px 12px', color: 'var(--text-main)', fontWeight: 600 }}>{signal}</td>
              <td style={{ padding: '14px 12px', color: 'var(--text-main)' }}>{count}</td>
              <td style={{ padding: '14px 12px', color: 'var(--text-muted)' }}>{comment}</td>
            </tr>
          ))}
        </OwnerTable>
      </OwnerSection>

      <OwnerSection title="Revenue, onboarding, and health at a glance">
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
          {revenueStats.map((item) => (
            <OwnerStatPill key={item.label} label={item.label} value={item.value} tone={item.tone} />
          ))}
        </section>
      </OwnerSection>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '18px' }}>
        <OwnerSection
          title="Recent exceptions"
          subtitle="Issues that need attention before they become customer-facing."
        >
          {recentIssues.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {recentIssues.map((issue: any, index: number) => (
                <div
                  key={`${issue.source}-${issue.created_at}-${index}`}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '16px',
                    padding: '14px 16px',
                    borderRadius: '14px',
                    border: '1px solid var(--panel-border)',
                    background: 'var(--hover-bg)',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, color: 'var(--text-main)' }}>{issue.title}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                      {issue.source} · {issue.detail || issue.category}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <OwnerBadge tone={safeUpper(issue.priority) === 'URGENT' ? 'danger' : safeUpper(issue.status) === 'BLOCKED' ? 'warning' : 'muted'}>
                      {safeUpper(issue.status) || 'OPEN'}
                    </OwnerBadge>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px' }}>
                      {formatDate(issue.created_at)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No active exceptions"
              description="Support tickets, onboarding blockers, and billing issues will appear here once the platform has live tenant activity."
            />
          )}
        </OwnerSection>

        <OwnerSection title="Platform health" subtitle="Latest system snapshot from the platform monitoring layer.">
          {health ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '14px' }}>
              <OwnerStatPill label="Database" value={String(derivedHealth.database_health || 'UNKNOWN')} tone={String(derivedHealth.database_health || '').toUpperCase() === 'HEALTHY' ? 'primary' : 'warning'} />
              <OwnerStatPill label="API uptime" value={formatPercent(derivedHealth.api_uptime_pct, 2)} tone="primary" />
              <OwnerStatPill label="Error rate" value={formatPercent(derivedHealth.error_rate_pct, 2)} tone={Number(derivedHealth.error_rate_pct || 0) > 1 ? 'warning' : 'secondary'} />
              <OwnerStatPill label="Backlog" value={formatCount(derivedHealth.sync_backlog)} tone={Number(derivedHealth.sync_backlog || 0) > 0 ? 'warning' : 'primary'} />
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '14px' }}>
              <OwnerStatPill label="Database" value={String(derivedHealth.database_health || 'HEALTHY')} tone="primary" />
              <OwnerStatPill label="API uptime" value={formatPercent(derivedHealth.api_uptime_pct, 2)} tone="primary" />
              <OwnerStatPill label="Error rate" value={formatPercent(derivedHealth.error_rate_pct, 2)} tone="secondary" />
              <OwnerStatPill label="Backlog" value={formatCount(derivedHealth.sync_backlog)} tone="primary" />
            </div>
          )}
        </OwnerSection>
      </section>
    </div>
  );
}
