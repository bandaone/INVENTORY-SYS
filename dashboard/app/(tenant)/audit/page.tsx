import { fetchTenantQuery } from '@/lib/db';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

function formatAuditDetails(actionType: string, changes: any) {
  if (!changes) return '—';
  try {
    const data = typeof changes === 'string' ? JSON.parse(changes) : changes;
    
    switch (actionType) {
      case 'SALE_COMPLETED':
        return `Receipt: ${data.receipt_number} • Total: K${data.total} • Paid via: ${data.method}`;
      case 'STOCK_INGESTION': {
        const value = data.total_value || 0;
        let itemName = 'Items';
        if (data.items && data.items.length === 1) {
          itemName = data.items[0].product || data.items[0].variant || 'Item';
        } else if (data.items && data.items.length > 1) {
          itemName = 'Multiple Items (Bulk)';
        } else if (data.source_signature) {
          itemName = 'Excel Upload';
        }
        return `Received ${data.count} units of "${itemName}" (Total Value: K${value})`;
      }
      case 'STOCKTAKE_COMPLETED':
        return `Matched: ${data.matched_count} • Missing: ${data.missing_count} • Extra: ${data.unexpected_count}`;
      default:
        // Generic fallback for unknown actions
        return Object.entries(data)
          .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
          .join(' • ');
    }
  } catch {
    return '—';
  }
}

export default async function AuditPage() {
  const cookieStore = cookies();
  const tenantId = cookieStore.get('tenant_id')?.value;

  if (!tenantId) {
    redirect('/login');
  }

  const auditLogs = await fetchTenantQuery(tenantId, `
    SELECT 
      a.id,
      a.action_type,
      a.resource_type,
      a.changes,
      a.created_at,
      COALESCE(s.name, 'System') as actor_name
    FROM audit_trail a
    LEFT JOIN staff s ON a.actor_id = s.id
    ORDER BY a.created_at DESC
  `);

  return (
    <div className="animate-fade-in">
      <h1>Audit Trail</h1>
      <p className="subtitle">Immutable system logs fetched live from PostgreSQL DB.</p>

      <div className="glass-panel" style={{ marginTop: '32px' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Actor</th>
              <th>Action Type</th>
              <th>Resource</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {auditLogs.map((log: any) => (
              <tr key={log.id}>
                <td style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
                  {new Date(log.created_at).toLocaleString()}
                </td>
                <td style={{ fontWeight: 500 }}>{log.actor_name}</td>
                <td>
                  <span style={{
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    background: 'rgba(96, 165, 250, 0.1)',
                    color: 'var(--secondary)',
                    fontWeight: 600
                  }}>
                    {log.action_type}
                  </span>
                </td>
                <td>{log.resource_type}</td>
                <td style={{ fontSize: '13px', color: 'var(--text-main)', lineHeight: '1.5' }}>
                  {formatAuditDetails(log.action_type, log.changes)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
