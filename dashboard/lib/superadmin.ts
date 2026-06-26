export const PLAN_RATES: Record<string, number> = {
  boutique_starter: 1200,
  growth: 3500,
  enterprise_fleet: 9500,
};

export const PLAN_LABELS: Record<string, string> = {
  boutique_starter: 'Boutique Starter',
  growth: 'Growth',
  enterprise_fleet: 'Enterprise Fleet',
};

export const OWNER_STATUS_LABELS: Record<string, string> = {
  TRIAL: 'Trial',
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  CHURNED: 'Churned',
  PAUSED: 'Paused',
  CANCELLED: 'Churned',
};

export function formatMoney(value: number | string | null | undefined) {
  const amount = Number(value ?? 0);
  return `K${amount.toLocaleString('en-ZM', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

export function formatPercent(value: number | string | null | undefined, digits = 1) {
  return `${Number(value ?? 0).toFixed(digits)}%`;
}

export function formatCount(value: number | string | null | undefined) {
  return Number(value ?? 0).toLocaleString('en-ZM');
}

export function formatPlan(tier: string | null | undefined) {
  if (!tier) return 'Unknown';
  return PLAN_LABELS[tier] ?? tier.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

export function planRate(tier: string | null | undefined) {
  if (!tier) return 0;
  return PLAN_RATES[tier] ?? 0;
}

export function formatDate(value: string | Date | null | undefined) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleDateString('en-ZM', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleString('en-ZM', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function safeUpper(value: string | null | undefined) {
  return (value ?? '').toString().toUpperCase();
}
