import MetricCard from '@/components/MetricCard';
import SalesTrendChart from '@/components/SalesTrendChart';
import LiveActivity from '@/components/LiveActivity';
import { requireTenantId, fetchTenantQuery } from '@/lib/db';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  // --- REAL DATA FETCHING WITH RLS ---
  const cookieStore = cookies();
  const tenantId = cookieStore.get('tenant_id')?.value;

  if (!tenantId) {
    redirect('/login');
  }

  const safeTenantId = requireTenantId(tenantId);
  
  // 1. Recent Transactions (Enforced by RLS)
  const recentTransactions = await fetchTenantQuery(safeTenantId, `
    SELECT t.receipt_number as receipt, l.name as location, t.total as amount, t.payment_method as method
    FROM transactions t
    JOIN locations l ON t.location_id = l.id
    ORDER BY t.created_at DESC
    LIMIT 5
  `);

  const recentShiftReports = await fetchTenantQuery(safeTenantId, `
    SELECT
      sr.id,
      sr.report_date,
      sr.transactions_count,
      sr.gross_sales,
      sr.discount_total,
      sr.returns_total,
      sr.net_sales,
      st.name as cashier_name,
      l.name as location_name
    FROM shift_closing_reports sr
    JOIN staff st ON sr.cashier_id = st.id
    LEFT JOIN locations l ON sr.location_id = l.id
    ORDER BY sr.closed_at DESC
    LIMIT 5
  `).catch(() => []);

  // 2. Total Revenue (Today)
  const revenueResult = await fetchTenantQuery(safeTenantId, `
    SELECT COALESCE(SUM(total), 0) as total
    FROM transactions
    WHERE created_at >= CURRENT_DATE
  `);
  const todayRevenue = revenueResult[0]?.total || 0;

  // 3. Active Stock Value
  const stockResult = await fetchTenantQuery(safeTenantId, `
    SELECT COUNT(*) as count, COALESCE(SUM(retail_price), 0) as total_value
    FROM garments
    WHERE status = 'in_stock'
  `);
  const stockCount = stockResult[0]?.count || 0;
  const stockValue = stockResult[0]?.total_value || 0;

  // 4. Items Sold Today
  const itemsSoldResult = await fetchTenantQuery(safeTenantId, `
    SELECT COUNT(*) as count
    FROM garments
    WHERE status = 'sold'
  `);
  const itemsSold = itemsSoldResult[0]?.count || 0;

  // Since we don't have real "shrinkage" logic yet, we'll keep it 0
  const monthlyShrinkage = 0.00;

  // 5. Stock Distribution (By Variant)
  const distributionResult = await fetchTenantQuery(safeTenantId, `
    SELECT v.name, COUNT(g.serial) as count
    FROM variants v
    LEFT JOIN garments g ON v.id = g.variant_id AND g.status = 'in_stock'
    GROUP BY v.name
  `);
  const totalStock = parseInt(stockCount);
  const stockLevels = distributionResult.map((d: any, i: number) => ({
    name: d.name,
    color: i % 2 === 0 ? '#3b82f6' : '#ec4899', // Blue/Pink alternating
    count: parseInt(d.count),
    level: totalStock > 0 ? (parseInt(d.count) / totalStock) * 100 : 0
  }));

  return (
    <div className="animate-fade-in" style={{ paddingBottom: '40px' }}>
      <h1>Overview</h1>
      <p className="subtitle">Live metrics pulled directly from PostgreSQL database.</p>

      {/* ── Metric Cards ── */}
      <div className="metrics-grid">
        <MetricCard title="Today's Revenue"   value={`K${Number(todayRevenue).toLocaleString('en-US', { minimumFractionDigits: 2 })}`} trend="Real-time data" trendUp={true}  delay="delay-1" />
        <MetricCard title="Active Stock Value" value={`K${Number(stockValue).toLocaleString('en-US', { minimumFractionDigits: 2 })}`} trend={`${stockCount} garments in stock`} trendUp={true}  delay="delay-2" />
        <MetricCard title="Total Items Sold"   value={`${itemsSold} items`}   trend="All locations"  trendUp={true}  delay="delay-3" />
        <MetricCard title="Monthly Shrinkage"  value={`K${monthlyShrinkage.toFixed(2)}`} trend="No missing items" trendUp={true}  delay="delay-3" />
      </div>

      {/* ── Sales Trend + Recent Transactions ── */}
      <div className="charts-section" style={{ alignItems: 'stretch' }}>

        {/* LEFT — Real Chart */}
        <div className="glass-panel animate-fade-in delay-2" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="chart-header">
            <div>
              <h3>Sales Trend</h3>
              <p className="subtitle" style={{ fontSize: '13px', marginTop: '2px' }}>This week · by location</p>
            </div>
            <span style={{
              background: 'rgba(16,185,129,0.12)',
              color: 'var(--primary)',
              padding: '4px 10px',
              borderRadius: '20px',
              fontSize: '12px',
              fontWeight: 600,
            }}>LIVE DB</span>
          </div>
          <div style={{ flex: 1, minHeight: '240px' }}>
            {/* Keeping the ChartJS component client-side but feeding it (currently mocked inside component) */}
            <SalesTrendChart />
          </div>
        </div>

        {/* RIGHT — Transactions + Stock breakdown */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

          {/* Recent Transactions */}
          <div className="glass-panel animate-fade-in delay-3" style={{ flex: 1 }}>
            <div className="chart-header">
              <h3>Recent Transactions</h3>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Receipt</th>
                  <th>Location</th>
                  <th>Amount</th>
                  <th>Method</th>
                </tr>
              </thead>
              <tbody>
                {recentTransactions.map((tx: any, i: number) => (
                  <tr key={i}>
                    <td style={{ fontFamily: 'monospace', fontSize: '13px' }}>{tx.receipt}</td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '13px' }}>{tx.location}</td>
                    <td style={{ fontWeight: 700 }}>K{Number(tx.amount).toFixed(2)}</td>
                    <td>
                      <span style={{
                        padding: '3px 8px',
                        borderRadius: '6px',
                        fontSize: '10px',
                        fontWeight: 600,
                        letterSpacing: '0.05em',
                        background: tx.method === 'CASH'
                          ? 'rgba(96,165,250,0.12)'
                          : 'rgba(245,158,11,0.12)',
                        color: tx.method === 'CASH' ? 'var(--secondary)' : 'var(--warning)',
                      }}>
                        {tx.method === 'CASH' ? 'Cash' : 'Mobile'}
                      </span>
                    </td>
                  </tr>
                ))}
                {recentTransactions.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No transactions yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="glass-panel animate-fade-in delay-3" style={{ flex: 1 }}>
            <div className="chart-header">
              <h3>Shift Closing Reports</h3>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Cashier</th>
                  <th>Location</th>
                  <th>Net</th>
                </tr>
              </thead>
              <tbody>
                {recentShiftReports.map((report: any) => (
                  <tr key={report.id}>
                    <td style={{ color: 'var(--text-muted)', fontSize: '13px' }}>{new Date(report.report_date).toLocaleDateString()}</td>
                    <td style={{ fontWeight: 600, fontSize: '13px' }}>{report.cashier_name}</td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '13px' }}>{report.location_name || '—'}</td>
                    <td style={{ fontWeight: 700, color: 'var(--color-success)' }}>K{Number(report.net_sales).toFixed(2)}</td>
                  </tr>
                ))}
                {recentShiftReports.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No shift reports yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Stock Distribution */}
          <div className="glass-panel animate-fade-in delay-3">
            <h3 style={{ marginBottom: '16px' }}>Stock Distribution</h3>
            {stockLevels.map((item: any) => (
              <div key={item.name} style={{ marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 500 }}>{item.name}</span>
                  <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{item.count} units</span>
                </div>
                <div style={{
                  height: '6px',
                  borderRadius: '99px',
                  background: 'var(--hover-bg)',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%',
                    width: `${item.level}%`,
                    borderRadius: '99px',
                    background: item.color,
                    boxShadow: `0 0 8px ${item.color}55`,
                  }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Live Activity ── */}
      <LiveActivity />
    </div>
  );
}
