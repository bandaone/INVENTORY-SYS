import type { ReactNode } from 'react';

type Tone = 'primary' | 'secondary' | 'warning' | 'danger' | 'muted';

const toneStyles: Record<Tone, { bg: string; color: string; border: string }> = {
  primary:   { bg: 'rgba(74,222,128,0.10)', color: 'var(--primary)', border: 'rgba(74,222,128,0.22)' },
  secondary: { bg: 'rgba(96,165,250,0.10)', color: 'var(--secondary)', border: 'rgba(96,165,250,0.22)' },
  warning:   { bg: 'rgba(245,158,11,0.12)', color: 'var(--warning)', border: 'rgba(245,158,11,0.25)' },
  danger:    { bg: 'rgba(239,68,68,0.10)', color: 'var(--danger)', border: 'rgba(239,68,68,0.25)' },
  muted:     { bg: 'var(--hover-bg)', color: 'var(--text-muted)', border: 'var(--panel-border)' },
};

export function OwnerMetricCard({
  label,
  value,
  note,
  tone = 'primary',
}: {
  label: string;
  value: string;
  note?: string;
  tone?: Tone;
}) {
  const theme = toneStyles[tone];
  return (
    <div className="glass-panel" style={{ padding: '22px', border: `1px solid ${theme.border}` }}>
      <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '8px', fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: '30px', lineHeight: 1.1, fontWeight: 800, color: theme.color }}>{value}</div>
      {note && <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>{note}</div>}
    </div>
  );
}

export function OwnerSection({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="glass-panel" style={{ padding: '22px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', alignItems: 'flex-start', marginBottom: '18px' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--text-main)' }}>{title}</h3>
          {subtitle && <p style={{ marginTop: '4px', fontSize: '13px', color: 'var(--text-muted)' }}>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function OwnerBadge({
  children,
  tone = 'muted',
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  const theme = toneStyles[tone];
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      padding: '4px 10px',
      borderRadius: '999px',
      background: theme.bg,
      color: theme.color,
      border: `1px solid ${theme.border}`,
      fontSize: '12px',
      fontWeight: 700,
      letterSpacing: '0.02em',
      whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  );
}

export function OwnerTable({
  headers,
  children,
}: {
  headers: string[];
  children: ReactNode;
}) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--panel-border)' }}>
            {headers.map((header) => (
              <th key={header} style={{ textAlign: 'left', padding: '14px 12px', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', fontWeight: 700 }}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function OwnerStatPill({
  label,
  value,
  tone = 'muted',
}: {
  label: string;
  value: string | number;
  tone?: Tone;
}) {
  const theme = toneStyles[tone];
  return (
    <div style={{
      padding: '14px 16px',
      borderRadius: '14px',
      border: `1px solid ${theme.border}`,
      background: theme.bg,
    }}>
      <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>{label}</div>
      <div style={{ fontSize: '22px', fontWeight: 800, color: theme.color }}>{value}</div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
      <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--text-main)', marginBottom: '6px' }}>{title}</div>
      <div style={{ fontSize: '13px', maxWidth: '520px', margin: '0 auto' }}>{description}</div>
    </div>
  );
}
