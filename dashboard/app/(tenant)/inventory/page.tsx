import { fetchTenantQuery } from '@/lib/db';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function InventoryPage({
  searchParams,
}: {
  searchParams?: { q?: string };
}) {
  const cookieStore = cookies();
  const tenantId = cookieStore.get('tenant_id')?.value;
  const query = String(searchParams?.q || '').trim();
  const queryTerm = query.toLowerCase();

  if (!tenantId) {
    redirect('/login');
  }

  const whereClause = queryTerm
    ? `
      WHERE (
        LOWER(COALESCE(v.name, '')) LIKE $1
        OR LOWER(COALESCE(v.category, '')) LIKE $1
        OR LOWER(COALESCE(v.subtype, '')) LIKE $1
        OR LOWER(COALESCE(v.color, '')) LIKE $1
        OR LOWER(COALESCE(v.size, '')) LIKE $1
        OR LOWER(COALESCE(v.barcode_token, '')) LIKE $1
        OR LOWER(COALESCE(v.search_text, '')) LIKE $1
        OR LOWER(COALESCE(v.metadata::text, '')) LIKE $1
        OR LOWER(COALESCE(v.missing_fields::text, '')) LIKE $1
      )
    `
    : '';

  // Fetch stock grouped by product family, then by variant/color/size and location.
  const inventoryData = await fetchTenantQuery(tenantId, `
    SELECT 
      v.id,
      v.name as variant_name,
      COALESCE(v.category, '') as category,
      COALESCE(v.subtype, '') as subtype,
      COALESCE(v.color, '') as color,
      COALESCE(v.size, '') as size,
      COALESCE(v.missing_fields::text, '[]') as missing_fields,
      COALESCE(v.detail_status, 'complete') as detail_status,
      l.name as location_name,
      COUNT(g.serial) as stock_level
    FROM variants v
    CROSS JOIN locations l
    LEFT JOIN garments g ON g.variant_id = v.id AND g.location_id = l.id AND g.status = 'in_stock'
    ${whereClause}
    GROUP BY v.id, v.name, v.category, v.subtype, v.color, v.size, v.missing_fields, v.detail_status, l.name
    ORDER BY
      COALESCE(v.category, '') ASC,
      COALESCE(v.subtype, '') ASC,
      v.name ASC,
      COALESCE(v.color, '') ASC,
      COALESCE(v.size, '') ASC,
      l.name ASC
  `, queryTerm ? [`%${queryTerm}%`] : undefined);

  // Transform the stock rows into grouped matrix sections.
  const locationsSet = new Set<string>();
  type MatrixRow = {
    variantId: string;
    familyLabel: string;
    variantLabel: string;
    detailStatus: string;
    missingFields: string[];
    color: string;
    size: string;
    total: number;
    locations: Record<string, number>;
  };
  const matrix = new Map<string, MatrixRow[]>();
  const parseMissingFields = (value: unknown) => {
    if (Array.isArray(value)) {
      return value.map((entry) => String(entry).trim()).filter(Boolean);
    }
    const raw = String(value ?? '[]').trim();
    if (!raw || raw === '[]') return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.map((entry) => String(entry).trim()).filter(Boolean)
        : [];
    } catch {
      return raw
        .replace(/^\[/, '')
        .replace(/\]$/, '')
        .split(',')
        .map((entry) => entry.trim().replace(/^"|"$/g, ''))
        .filter(Boolean);
    }
  };

  inventoryData.forEach((row: any) => {
    locationsSet.add(row.location_name);
    const familyLabel = [row.category, row.subtype, row.variant_name].filter(Boolean).join(' / ') || row.variant_name;
    const variantLabel = [row.variant_name, row.size, row.color].filter(Boolean).join(' · ');
    const count = Number.parseInt(row.stock_level, 10) || 0;
    const missingFields = parseMissingFields(row.missing_fields);
    const existingGroup = matrix.get(familyLabel) || [];
    const existingRow = existingGroup.find((entry) => entry.variantId === row.id);

    if (existingRow) {
      existingRow.locations[row.location_name] = count;
      existingRow.total += count;
    } else {
      existingGroup.push({
        variantId: row.id,
        familyLabel,
        variantLabel,
        detailStatus: row.detail_status,
        missingFields,
        color: row.color,
        size: row.size,
        total: count,
        locations: { [row.location_name]: count },
      });
    }

    matrix.set(familyLabel, existingGroup);
  });

  const locations = Array.from(locationsSet);
  const groups = Array.from(matrix.entries()).map(([familyLabel, rows]) => ({
    familyLabel,
    rows: rows.sort((a, b) => a.variantLabel.localeCompare(b.variantLabel)),
    total: rows.reduce((sum, row) => sum + row.total, 0),
    attentionCount: rows.filter((row) => row.detailStatus !== 'complete' || row.missingFields.length > 0).length,
  }));

  return (
    <div className="animate-fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1>Inventory Matrix</h1>
          <p className="subtitle">Grouped by product family, searchable, and ready for repairs when fields are missing.</p>
        </div>
        <form method="get" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            name="q"
            defaultValue={query}
            placeholder="Search code, color, size, description..."
            style={{ minWidth: '280px', padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--panel-border)', background: 'var(--bg-color)', color: 'var(--text-main)' }}
          />
          <button
            type="submit"
            style={{ padding: '12px 16px', borderRadius: '10px', border: 'none', background: 'var(--primary)', color: '#0f1115', cursor: 'pointer', fontWeight: 800 }}
          >
            Search
          </button>
          {query && (
            <Link
              href="/inventory"
              style={{ padding: '12px 16px', borderRadius: '10px', border: '1px solid var(--panel-border)', background: 'var(--hover-bg)', color: 'var(--text-main)', fontWeight: 700 }}
            >
              Clear
            </Link>
          )}
        </form>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', marginTop: '32px' }}>
        {groups.map((group) => (
          <div key={group.familyLabel} className="glass-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '16px' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '18px' }}>{group.familyLabel}</h2>
                <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: '13px' }}>
                  {group.rows.length} variant{group.rows.length === 1 ? '' : 's'} in this family
                </p>
              </div>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                {group.attentionCount > 0 && (
                  <span style={{ padding: '6px 10px', borderRadius: '999px', background: 'rgba(245, 158, 11, 0.12)', color: 'var(--warning)', fontSize: '12px', fontWeight: 700 }}>
                    {group.attentionCount} need review
                  </span>
                )}
                <div style={{ fontWeight: 700, color: 'var(--primary)' }}>Total: {group.total}</div>
              </div>
            </div>

            <table className="data-table">
              <thead>
                <tr>
                  <th>Variant</th>
                  <th style={{ textAlign: 'center' }}>Status</th>
                  {locations.map((loc) => (
                    <th key={loc} style={{ textAlign: 'center' }}>{loc}</th>
                  ))}
                  <th style={{ textAlign: 'right' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map((row) => (
                  <tr key={row.variantId}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{row.variantLabel}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                        {[row.color, row.size].filter(Boolean).join(' · ') || 'Unspecified'}
                      </div>
                      {row.missingFields.length > 0 && (
                        <div style={{ fontSize: '12px', color: 'var(--warning)', marginTop: '4px' }}>
                          Missing: {row.missingFields.join(', ')}
                        </div>
                      )}
                      <div style={{ marginTop: '8px' }}>
                        <Link
                          href={`/operations/receive?edit=${encodeURIComponent(row.variantId)}`}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '7px 10px', borderRadius: '999px', border: '1px solid var(--panel-border)', background: 'var(--hover-bg)', color: 'var(--text-main)', fontSize: '12px', fontWeight: 700 }}
                        >
                          Edit item
                        </Link>
                      </div>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '6px 10px',
                        borderRadius: '999px',
                        fontSize: '12px',
                        fontWeight: 700,
                        background: row.detailStatus === 'complete' && row.missingFields.length === 0
                          ? 'rgba(74,222,128,0.12)'
                          : 'rgba(245,158,11,0.14)',
                        color: row.detailStatus === 'complete' && row.missingFields.length === 0
                          ? 'var(--primary)'
                          : 'var(--warning)',
                      }}>
                        {row.detailStatus === 'complete' && row.missingFields.length === 0 ? 'Ready' : 'Needs review'}
                      </span>
                    </td>
                    {locations.map((loc) => {
                      const count = row.locations[loc] || 0;
                      return (
                        <td key={loc} style={{ textAlign: 'center' }}>
                          <span
                            style={{
                              display: 'inline-block',
                              minWidth: '44px',
                              padding: '4px 12px',
                              borderRadius: '12px',
                              background: count === 0 ? 'rgba(239, 68, 68, 0.1)' : 'var(--hover-bg)',
                              color: count === 0 ? 'var(--danger)' : 'var(--text-main)',
                              fontWeight: count > 0 ? 600 : 400,
                            }}
                          >
                            {count}
                          </span>
                        </td>
                      );
                    })}
                    <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--primary)' }}>
                      {row.total}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
