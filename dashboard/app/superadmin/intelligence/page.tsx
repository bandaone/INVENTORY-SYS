import { fetchQuery } from '@/lib/db';
import { EmptyState, OwnerMetricCard, OwnerSection, OwnerTable } from '@/components/SuperAdminBlocks';
import { formatCount, formatDateTime, formatMoney, formatPercent, formatPlan } from '@/lib/superadmin';

export const dynamic = 'force-dynamic';

export default async function IntelligencePage() {
  const [planRows, valueRows, adoptionRows, featureRows] = await Promise.all([
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
          END ELSE 0 END) AS mrr,
        COUNT(DISTINCT l.id)::int AS locations
      FROM tenants t
      LEFT JOIN locations l ON l.tenant_id = t.id
      GROUP BY subscription_tier
      ORDER BY tenant_count DESC
    `),
    fetchQuery(`
      SELECT
        t.id,
        t.name,
        t.subscription_tier,
        COALESCE(SUM(r.sales_value), 0) AS sales_30d,
        COALESCE(SUM(r.sales_count), 0)::int AS sales_count_30d,
        COALESCE(SUM(r.receiving_count), 0)::int AS receiving_30d,
        COALESCE(SUM(r.stocktake_count), 0)::int AS stocktake_30d,
        COALESCE(SUM(r.returns_count), 0)::int AS returns_30d
      FROM tenants t
      LEFT JOIN tenant_daily_rollups r
        ON r.tenant_id = t.id
       AND r.rollup_date >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY t.id, t.name, t.subscription_tier
      ORDER BY sales_30d DESC
      LIMIT 10
    `),
    fetchQuery(`
      SELECT
        t.subscription_tier,
        COUNT(*) FILTER (WHERE os.business_profile_completed)::int AS profile_complete,
        COUNT(*) FILTER (WHERE os.products_loaded)::int AS products_loaded,
        COUNT(*) FILTER (WHERE os.first_stock_received)::int AS first_stock_received,
        COUNT(*) FILTER (WHERE os.first_sale_completed)::int AS first_sale_completed
      FROM tenants t
      LEFT JOIN onboarding_sessions os ON os.tenant_id = t.id
      GROUP BY t.subscription_tier
      ORDER BY t.subscription_tier
    `),
    fetchQuery(`
      SELECT
        t.subscription_tier,
        COUNT(*) FILTER (WHERE COALESCE(t.zra_configured, FALSE))::int AS zra_ready,
        COUNT(*) FILTER (WHERE COALESCE(t.zra_configured, FALSE) = FALSE)::int AS zra_missing
      FROM tenants t
      GROUP BY t.subscription_tier
      ORDER BY t.subscription_tier
    `),
  ]);

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div>
        <h1 style={{ fontSize: '32px', margin: 0, color: 'var(--text-main)' }}>Commercial Intelligence</h1>
        <p className="subtitle" style={{ marginTop: '8px', maxWidth: '720px' }}>
          Use usage, value, and adoption signals to shape pricing, packaging, and customer success decisions.
        </p>
      </div>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '18px' }}>
        <OwnerMetricCard label="Highest-value tenants" value={formatCount(valueRows.length)} note="Accounts ranked by 30-day sales" tone="primary" />
        <OwnerMetricCard label="Plan groups" value={formatCount(planRows.length)} note="Commercial segmentation" tone="secondary" />
        <OwnerMetricCard label="ZRA coverage" value={formatPercent((featureRows.reduce((sum: number, row: any) => sum + Number(row.zra_ready || 0), 0) / Math.max(planRows.reduce((sum: number, row: any) => sum + Number(row.tenant_count || 0), 0), 1)) * 100)} note="Configured across the tenant base" tone="primary" />
        <OwnerMetricCard label="Adoption signals" value={formatCount(adoptionRows.reduce((sum: number, row: any) => sum + Number(row.first_sale_completed || 0), 0))} note="Sessions that reached first sale" tone="secondary" />
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '18px' }}>
        <OwnerSection title="Plan distribution" subtitle="How tenants are spread across tiers and what that means for revenue.">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px' }}>
            {planRows.map((row: any) => (
              <div key={row.subscription_tier} className="glass-panel" style={{ padding: '18px', border: '1px solid var(--panel-border)' }}>
                <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '8px' }}>{formatPlan(row.subscription_tier)}</div>
                <div style={{ fontSize: '26px', fontWeight: 800, color: 'var(--text-main)' }}>{formatCount(row.tenant_count)}</div>
                <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
                  {formatMoney(row.mrr)} MRR · {formatCount(row.locations)} locations
                </div>
              </div>
            ))}
          </div>
        </OwnerSection>

        <OwnerSection title="Feature usage by plan" subtitle="Which capabilities each tier is actually using.">
          <OwnerTable headers={['Plan', 'Profile', 'Products', 'First stock', 'First sale']}>
            {adoptionRows.map((row: any) => (
              <tr key={row.subscription_tier} style={{ borderBottom: '1px solid var(--panel-border)' }}>
                <td style={{ padding: '14px 12px', color: 'var(--text-main)', fontWeight: 600 }}>{formatPlan(row.subscription_tier)}</td>
                <td style={{ padding: '14px 12px', color: 'var(--text-main)' }}>{formatCount(row.profile_complete)}</td>
                <td style={{ padding: '14px 12px', color: 'var(--text-main)' }}>{formatCount(row.products_loaded)}</td>
                <td style={{ padding: '14px 12px', color: 'var(--text-main)' }}>{formatCount(row.first_stock_received)}</td>
                <td style={{ padding: '14px 12px', color: 'var(--text-main)' }}>{formatCount(row.first_sale_completed)}</td>
              </tr>
            ))}
          </OwnerTable>
        </OwnerSection>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '18px' }}>
        <OwnerSection title="Top tenants by value" subtitle="Accounts with the strongest 30-day sales signal.">
          {valueRows.length ? (
            <OwnerTable headers={['Tenant', 'Plan', 'Sales', 'Sales count', 'Activity']}>
              {valueRows.map((row: any) => (
                <tr key={row.id} style={{ borderBottom: '1px solid var(--panel-border)' }}>
                  <td style={{ padding: '14px 12px', color: 'var(--text-main)', fontWeight: 600 }}>{row.name}</td>
                  <td style={{ padding: '14px 12px', color: 'var(--text-muted)' }}>{formatPlan(row.subscription_tier)}</td>
                  <td style={{ padding: '14px 12px', color: 'var(--text-main)' }}>{formatMoney(row.sales_30d)}</td>
                  <td style={{ padding: '14px 12px', color: 'var(--text-main)' }}>{formatCount(row.sales_count_30d)}</td>
                  <td style={{ padding: '14px 12px', color: 'var(--text-muted)' }}>
                    {formatCount(row.receiving_30d)} receiving · {formatCount(row.stocktake_30d)} stocktakes
                  </td>
                </tr>
              ))}
            </OwnerTable>
          ) : (
            <EmptyState title="No sales rollups yet" description="Once rollups are populated, the top-value tenants will appear here." />
          )}
        </OwnerSection>

        <OwnerSection title="Compliance by plan" subtitle="Where ZRA setup is strongest or weakest by tier.">
          <OwnerTable headers={['Plan', 'ZRA ready', 'Missing']}>
            {featureRows.map((row: any) => (
              <tr key={row.subscription_tier} style={{ borderBottom: '1px solid var(--panel-border)' }}>
                <td style={{ padding: '14px 12px', color: 'var(--text-main)', fontWeight: 600 }}>{formatPlan(row.subscription_tier)}</td>
                <td style={{ padding: '14px 12px', color: 'var(--text-main)' }}>{formatCount(row.zra_ready)}</td>
                <td style={{ padding: '14px 12px', color: 'var(--text-main)' }}>{formatCount(row.zra_missing)}</td>
              </tr>
            ))}
          </OwnerTable>
        </OwnerSection>
      </section>
    </div>
  );
}
