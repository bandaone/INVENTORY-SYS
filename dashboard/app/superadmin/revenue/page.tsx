import { fetchQuery } from '@/lib/db';
import {
  EmptyState,
  OwnerBadge,
  OwnerMetricCard,
  OwnerSection,
  OwnerTable,
} from '@/components/SuperAdminBlocks';
import {
  formatCount,
  formatDate,
  formatDateTime,
  formatMoney,
  formatPercent,
  formatPlan,
  safeUpper,
} from '@/lib/superadmin';

export const dynamic = 'force-dynamic';

export default async function RevenuePage() {
  const [summaryRows, planRows, monthlyRows, overdueRows, recentRows] = await Promise.all([
    fetchQuery(`
      SELECT
        COUNT(*) FILTER (WHERE event_type = 'TRIAL_STARTED')::int AS trials_started,
        COUNT(*) FILTER (WHERE event_type = 'TRIAL_CONVERTED')::int AS conversions,
        COUNT(*) FILTER (WHERE event_type = 'UPGRADED')::int AS upgrades,
        COUNT(*) FILTER (WHERE event_type = 'DOWNGRADED')::int AS downgrades,
        COUNT(*) FILTER (WHERE status = 'OVERDUE')::int AS overdue_count,
        COALESCE(SUM(CASE WHEN status = 'OVERDUE' THEN amount ELSE 0 END), 0) AS overdue_amount,
        COALESCE(SUM(CASE WHEN event_type = 'PAYMENT_RECEIVED' THEN amount ELSE 0 END), 0) AS cash_collected
      FROM billing_events
    `),
    fetchQuery(`
      SELECT
        subscription_tier,
        COUNT(*)::int AS tenant_count,
        SUM(CASE WHEN COALESCE(UPPER(status), 'ACTIVE') = 'ACTIVE' THEN
          CASE subscription_tier
            WHEN 'boutique_starter' THEN 1200
            WHEN 'growth' THEN 3500
            WHEN 'enterprise_fleet' THEN 9500
            ELSE 0
          END ELSE 0 END) AS mrr
      FROM tenants
      GROUP BY subscription_tier
      ORDER BY mrr DESC, tenant_count DESC
    `),
    fetchQuery(`
      SELECT
        TO_CHAR(date_trunc('month', effective_at), 'Mon YYYY') AS month_label,
        SUM(CASE WHEN event_type = 'PAYMENT_RECEIVED' AND status = 'POSTED' THEN amount ELSE 0 END) AS revenue,
        COUNT(*) FILTER (WHERE event_type = 'PAYMENT_RECEIVED')::int AS payment_count
      FROM billing_events
      WHERE effective_at >= NOW() - INTERVAL '12 months'
      GROUP BY 1, date_trunc('month', effective_at)
      ORDER BY date_trunc('month', effective_at)
    `),
    fetchQuery(`
      SELECT
        b.tenant_id,
        t.name,
        t.subscription_tier,
        b.amount,
        b.currency,
        b.due_at,
        b.status,
        b.event_type,
        b.created_at
      FROM billing_events b
      LEFT JOIN tenants t ON t.id = b.tenant_id
      WHERE b.status = 'OVERDUE'
      ORDER BY COALESCE(b.due_at, b.created_at) DESC
      LIMIT 10
    `),
    fetchQuery(`
      SELECT
        t.name,
        t.subscription_tier,
        COALESCE(UPPER(t.status), 'ACTIVE') AS safe_status,
        os.converted_to_paid,
        os.trial_end_date,
        os.go_live_approved,
        os.updated_at,
        COALESCE(os.current_step, 1) AS current_step
      FROM tenants t
      LEFT JOIN onboarding_sessions os ON os.tenant_id = t.id
      ORDER BY t.created_at DESC
      LIMIT 6
    `),
  ]);

  const summary = summaryRows[0] ?? {};
  const planCards = planRows.map((row: any) => ({
    tier: formatPlan(row.subscription_tier),
    count: Number(row.tenant_count || 0),
    mrr: Number(row.mrr || 0),
  }));
  const monthlyRevenue = monthlyRows.map((row: any) => ({
    label: row.month_label,
    revenue: Number(row.revenue || 0),
    paymentCount: Number(row.payment_count || 0),
  }));
  const maxRevenue = Math.max(...monthlyRevenue.map((item: any) => item.revenue), 1);
  const trialConversion = Number(summary.trials_started || 0)
    ? (Number(summary.conversions || 0) / Number(summary.trials_started || 0)) * 100
    : 0;

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div>
        <h1 style={{ fontSize: '32px', margin: 0, color: 'var(--text-main)' }}>Revenue</h1>
        <p className="subtitle" style={{ marginTop: '8px', maxWidth: '720px' }}>
          Track recurring revenue, collections, upgrades, downgrades, and overdue accounts from one place.
        </p>
      </div>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '18px' }}>
        <OwnerMetricCard label="Cash collected" value={formatMoney(summary.cash_collected)} note="Posted payment receipts" tone="primary" />
        <OwnerMetricCard label="Overdue balance" value={formatMoney(summary.overdue_amount)} note={`${formatCount(summary.overdue_count)} overdue invoices`} tone="warning" />
        <OwnerMetricCard label="Trial-to-paid" value={formatPercent(trialConversion)} note={`${formatCount(summary.conversions)} conversions`} tone="secondary" />
        <OwnerMetricCard label="Plan churn pressure" value={formatCount(summary.downgrades)} note={`${formatCount(summary.upgrades)} upgrades · ${formatCount(summary.downgrades)} downgrades`} tone="primary" />
      </section>

      <OwnerSection title="Monthly revenue" subtitle="Revenue captured from posted payment events over the last 12 months.">
        {monthlyRevenue.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {monthlyRevenue.map((row: any) => (
              <div key={row.label} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 90px', gap: '12px', alignItems: 'center' }}>
                <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{row.label}</div>
                <div style={{ height: '12px', borderRadius: '999px', background: 'var(--hover-bg)', overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${Math.max((row.revenue / maxRevenue) * 100, row.revenue > 0 ? 8 : 0)}%`,
                      height: '100%',
                      background: 'linear-gradient(90deg, var(--primary), var(--secondary))',
                    }}
                  />
                </div>
                <div style={{ textAlign: 'right', fontWeight: 700, color: 'var(--text-main)' }}>{formatMoney(row.revenue)}</div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No revenue events yet"
            description="When payment receipts are posted, they will appear here with a month-by-month trend."
          />
        )}
      </OwnerSection>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '18px' }}>
        <OwnerSection title="Plan performance" subtitle="How each subscription tier contributes to recurring revenue.">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px' }}>
            {planCards.map((plan: any) => (
              <div key={plan.tier} className="glass-panel" style={{ padding: '18px', border: '1px solid var(--panel-border)' }}>
                <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '8px' }}>{plan.tier}</div>
                <div style={{ fontSize: '26px', fontWeight: 800, color: 'var(--text-main)' }}>{formatMoney(plan.mrr)}</div>
                <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>{formatCount(plan.count)} tenants</div>
              </div>
            ))}
          </div>
        </OwnerSection>

        <OwnerSection title="Billing events" subtitle="Recent revenue-affecting events and their status.">
          <OwnerTable headers={['Tenant', 'Event', 'Amount', 'Status', 'Date']}>
            {recentRows.length ? recentRows.map((row: any) => (
              <tr key={`${row.name}-${row.created_at}`} style={{ borderBottom: '1px solid var(--panel-border)' }}>
                <td style={{ padding: '14px 12px', color: 'var(--text-main)', fontWeight: 600 }}>{row.name || 'Unknown tenant'}</td>
                <td style={{ padding: '14px 12px', color: 'var(--text-muted)' }}>{row.event_type}</td>
                <td style={{ padding: '14px 12px', color: 'var(--text-main)' }}>{formatMoney(row.amount)}</td>
                <td style={{ padding: '14px 12px' }}>
                  <OwnerBadge tone={safeUpper(row.status) === 'OVERDUE' ? 'warning' : 'primary'}>
                    {safeUpper(row.status)}
                  </OwnerBadge>
                </td>
                <td style={{ padding: '14px 12px', color: 'var(--text-muted)' }}>{formatDateTime(row.created_at)}</td>
              </tr>
            )) : (
              <tr>
                <td colSpan={5} style={{ padding: '28px 12px' }}>
                  <EmptyState
                    title="No billing events yet"
                    description="As tenants convert, upgrade, and pay, the billing log will populate here."
                  />
                </td>
              </tr>
            )}
          </OwnerTable>
        </OwnerSection>
      </section>

      <OwnerSection title="Accounts that need attention" subtitle="Overdue tenants and recurring revenue risk.">
        {overdueRows.length ? (
          <OwnerTable headers={['Tenant', 'Plan', 'Amount', 'Due', 'Status']}>
            {overdueRows.map((row: any) => (
              <tr key={`${row.tenant_id}-${row.created_at}`} style={{ borderBottom: '1px solid var(--panel-border)' }}>
                <td style={{ padding: '14px 12px', color: 'var(--text-main)', fontWeight: 600 }}>{row.name || 'Unknown tenant'}</td>
                <td style={{ padding: '14px 12px', color: 'var(--text-muted)' }}>{formatPlan(row.subscription_tier)}</td>
                <td style={{ padding: '14px 12px', color: 'var(--text-main)' }}>{formatMoney(row.amount)}</td>
                <td style={{ padding: '14px 12px', color: 'var(--text-muted)' }}>{formatDate(row.due_at)}</td>
                <td style={{ padding: '14px 12px' }}>
                  <OwnerBadge tone="warning">OVERDUE</OwnerBadge>
                </td>
              </tr>
            ))}
          </OwnerTable>
        ) : (
          <EmptyState
            title="No overdue accounts"
            description="When payments become overdue, the accounts will appear here so you can act quickly."
          />
        )}
      </OwnerSection>
    </div>
  );
}
