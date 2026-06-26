import { fetchQuery } from '@/lib/db';
import { Building2, Clock3, ShieldAlert, Sparkles, Users } from 'lucide-react';
import { EmptyState, OwnerBadge, OwnerMetricCard, OwnerSection, OwnerStatPill, OwnerTable } from '@/components/SuperAdminBlocks';
import { formatCount, formatDate, formatDateTime, formatMoney, formatPercent, formatPlan, safeUpper } from '@/lib/superadmin';

export const dynamic = 'force-dynamic';

export default async function TenantsPage() {
  const [tenantRows, lifecycleRows] = await Promise.all([
    fetchQuery(`
      SELECT
        t.id,
        t.name,
        t.subscription_tier,
        COALESCE(UPPER(t.status), 'ACTIVE') AS safe_status,
        t.created_at,
        t.zra_configured,
        t.zra_cert_expiry,
        COUNT(DISTINCT l.id)::int AS location_count,
        COUNT(DISTINCT s.id)::int AS staff_count,
        COALESCE(os.current_step, 1) AS current_step,
        COALESCE(os.converted_to_paid, FALSE) AS converted_to_paid,
        os.trial_end_date,
        COALESCE((SELECT MAX(rollup_date) FROM tenant_daily_rollups r WHERE r.tenant_id = t.id), NULL) AS last_rollup_date,
        COALESCE((SELECT MAX(created_at) FROM platform_access_events a WHERE a.tenant_id = t.id), NULL) AS last_access_at,
        COALESCE((SELECT COUNT(*) FROM support_tickets st WHERE st.tenant_id = t.id AND st.status IN ('OPEN', 'IN_PROGRESS', 'WAITING_ON_CLIENT')), 0)::int AS open_tickets,
        COALESCE((SELECT SUM(sales_value) FROM tenant_daily_rollups r WHERE r.tenant_id = t.id AND r.rollup_date >= CURRENT_DATE - INTERVAL '30 days'), 0) AS sales_30d
      FROM tenants t
      LEFT JOIN locations l ON l.tenant_id = t.id
      LEFT JOIN staff s ON s.tenant_id = t.id
      LEFT JOIN onboarding_sessions os ON os.tenant_id = t.id
      GROUP BY t.id, os.current_step, os.converted_to_paid, os.trial_end_date
      ORDER BY t.created_at DESC
    `),
    fetchQuery(`
      SELECT
        COALESCE(UPPER(status), 'ACTIVE') AS safe_status,
        COUNT(*)::int AS tenant_count
      FROM tenants
      GROUP BY safe_status
    `),
  ]);

  const statusMap = new Map<string, number>(lifecycleRows.map((row: any) => [safeUpper(row.safe_status), Number(row.tenant_count || 0)]));

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div>
        <h1 style={{ fontSize: '32px', margin: 0, color: 'var(--text-main)' }}>Tenants</h1>
        <p className="subtitle" style={{ marginTop: '8px', maxWidth: '720px' }}>
          Monitor every client account from trial to active, including compliance, onboarding, and activity status.
        </p>
      </div>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '18px' }}>
        <OwnerMetricCard label="Total tenants" value={formatCount(tenantRows.length)} note="All onboarded accounts" tone="primary" />
        <OwnerMetricCard label="Active" value={formatCount(statusMap.get('ACTIVE') || 0)} note="Paying or live tenants" tone="primary" />
        <OwnerMetricCard label="Trial" value={formatCount(statusMap.get('TRIAL') || 0)} note="Still onboarding" tone="secondary" />
        <OwnerMetricCard label="At risk" value={formatCount(statusMap.get('SUSPENDED') || 0)} note="Suspended or blocked" tone="warning" />
      </section>

      <OwnerSection title="Lifecycle distribution" subtitle="A clean view of where every tenant sits in the account journey.">
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '14px' }}>
          <OwnerStatPill label="Active" value={formatCount(statusMap.get('ACTIVE') || 0)} tone="primary" />
          <OwnerStatPill label="Trial" value={formatCount(statusMap.get('TRIAL') || 0)} tone="secondary" />
          <OwnerStatPill label="Suspended" value={formatCount(statusMap.get('SUSPENDED') || 0)} tone="warning" />
          <OwnerStatPill label="Churned" value={formatCount(statusMap.get('CHURNED') || 0)} tone="danger" />
        </section>
      </OwnerSection>

      <OwnerSection title="Tenant accounts" subtitle="Operational snapshot for each client.">
        {tenantRows.length ? (
          <OwnerTable headers={['Tenant', 'Plan', 'Status', 'Sites', 'Users', 'Onboarding', 'Activity']}>
            {tenantRows.map((row: any) => {
              const risk =
                !row.zra_configured ? 'warning' :
                row.safe_status === 'SUSPENDED' || row.safe_status === 'CHURNED' ? 'danger' :
                row.open_tickets > 0 ? 'secondary' : 'primary';

              return (
                <tr key={row.id} style={{ borderBottom: '1px solid var(--panel-border)' }}>
                  <td style={{ padding: '14px 12px' }}>
                    <div style={{ fontWeight: 700, color: 'var(--text-main)' }}>{row.name}</div>
                    <div style={{ marginTop: '4px', fontSize: '12px', color: 'var(--text-muted)' }}>
                      Joined {formatDate(row.created_at)}
                    </div>
                  </td>
                  <td style={{ padding: '14px 12px', color: 'var(--text-muted)' }}>{formatPlan(row.subscription_tier)}</td>
                  <td style={{ padding: '14px 12px' }}>
                    <OwnerBadge tone={risk}>{safeUpper(row.safe_status)}</OwnerBadge>
                  </td>
                  <td style={{ padding: '14px 12px', color: 'var(--text-main)' }}>
                    {formatCount(row.location_count)}
                  </td>
                  <td style={{ padding: '14px 12px', color: 'var(--text-main)' }}>
                    {formatCount(row.staff_count)}
                  </td>
                  <td style={{ padding: '14px 12px', color: 'var(--text-muted)' }}>
                    Step {formatCount(row.current_step)}
                    <div style={{ fontSize: '12px', marginTop: '4px' }}>
                      {row.converted_to_paid ? 'Converted' : row.trial_end_date ? `Trial ends ${formatDate(row.trial_end_date)}` : 'In progress'}
                    </div>
                  </td>
                  <td style={{ padding: '14px 12px', color: 'var(--text-muted)' }}>
                    {row.last_access_at ? `Last access ${formatDateTime(row.last_access_at)}` : 'No access yet'}
                    <div style={{ fontSize: '12px', marginTop: '4px' }}>
                      {formatMoney(row.sales_30d)} sales in 30 days
                    </div>
                  </td>
                </tr>
              );
            })}
          </OwnerTable>
        ) : (
          <EmptyState
            title="No tenants yet"
            description="New client accounts will appear here as they are provisioned or imported."
          />
        )}
      </OwnerSection>
    </div>
  );
}
