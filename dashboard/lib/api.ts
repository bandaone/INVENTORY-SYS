/**
 * API Client for Retail OS Backend (MedusaJS)
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api/backend'
const TIMEOUT = parseInt(process.env.NEXT_PUBLIC_API_TIMEOUT || '30000')

class RetailOsApiError extends Error {
  constructor(public status: number, message: string, public data?: unknown) {
    super(message)
    this.name = 'RetailOsApiError'
  }
}

async function apiFetch<T>(
  path: string,
  options: RequestInit & { token?: string } = {}
): Promise<T> {
  const { token, ...fetchOptions } = options
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT)

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...fetchOptions.headers,
      },
    })
    clearTimeout(timeoutId)

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new RetailOsApiError(res.status, data.message || `HTTP ${res.status}`, data)
    }

    if (res.status === 204) return {} as T
    return res.json()
  } catch (err) {
    clearTimeout(timeoutId)
    if (err instanceof RetailOsApiError) throw err
    if ((err as Error).name === 'AbortError') {
      throw new RetailOsApiError(408, 'Request timed out')
    }
    throw err
  }
}

// ─── Auth ──────────────────────────────────────────────────────────────────────

export async function loginAdmin(email: string, password: string) {
  return apiFetch<{ token: string; user: Record<string, unknown> }>('/auth/token/emailpass', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

// ─── Dashboard / Analytics ─────────────────────────────────────────────────────

export async function getDashboardStats(token: string) {
  // Aggregate data from multiple endpoints
  const [inventory, movements] = await Promise.all([
    apiFetch<{ count: number; items: unknown[] }>('/admin/inventory-items?limit=1', { token }),
    apiFetch<{ stock_movements: unknown[] }>('/stock-movements?limit=50', { token }).catch(() => ({ stock_movements: [] })),
  ])
  return { inventory, movements }
}

// ─── Inventory / Serials ───────────────────────────────────────────────────────

export async function listSerialItems(token: string, params?: Record<string, string>) {
  const qs = params ? '?' + new URLSearchParams(params).toString() : ''
  return apiFetch<{
    serial_items: Array<{
      id: string
      serial_number: string
      status: 'IN_STOCK' | 'SOLD' | 'MISSING' | 'TRANSFERRED'
      inventory_item_id: string
      location_id: string
      retail_price: number
      cost_price: number
      batch_date: string
      last_scanned_at: string | null
      created_at: string
    }>
    count: number
  }>(`/serial-items${qs}`, { token })
}

export async function generateSerials(token: string, data: {
  inventory_item_id: string
  location_id: string
  quantity: number
  cost_price: number
  retail_price: number
}) {
  return apiFetch<{ serials: unknown[] }>('/serial-items/generate', {
    method: 'POST',
    token,
    body: JSON.stringify(data),
  })
}

export async function getSerialHistory(token: string, serial: string) {
  return apiFetch<{ movements: unknown[] }>(`/serial-items/${serial}/history`, { token })
}

// ─── Stocktake ─────────────────────────────────────────────────────────────────

export async function listStocktakeSessions(token: string) {
  return apiFetch<{
    sessions: Array<{
      id: string
      location_id: string
      area?: string
      status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED'
      initiated_by: string
      matched_count?: number
      missing_count?: number
      unexpected_count?: number
      shrinkage_value?: number
      created_at: string
      committed_at?: string
    }>
  }>('/stocktake', { token })
}

export async function startStocktake(token: string, data: { location_id: string; area?: string }) {
  return apiFetch<{ session: unknown }>('/stocktake/start', {
    method: 'POST',
    token,
    body: JSON.stringify(data),
  })
}

export async function getStocktakeSession(token: string, id: string) {
  return apiFetch<{
    session: unknown
    items: { matched: unknown[]; missing: unknown[]; unexpected: unknown[] }
    counts: { matched: number; missing: number; unexpected: number }
  }>(`/stocktake/${id}`, { token })
}

// ─── Sync Engine ───────────────────────────────────────────────────────────────

export async function getSyncConflicts(token: string) {
  return apiFetch<{ conflicts: unknown[] }>('/sync/conflicts', { token })
}

// ─── Audit Trail ───────────────────────────────────────────────────────────────

export async function getAuditTrail(token: string, params?: {
  event_type?: string
  actor_id?: string
  limit?: number
  offset?: number
}) {
  const qs = params ? '?' + new URLSearchParams(
    Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])
    )
  ).toString() : ''
  return apiFetch<{
    events: Array<{
      id: string
      event_type: string
      actor_id?: string
      actor_role?: string
      resource_type?: string
      resource_id?: string
      payload: unknown
      created_at: string
    }>
  }>(`/audit-trail${qs}`, { token })
}

// ─── Medusa Admin APIs ─────────────────────────────────────────────────────────

export async function listInventoryItems(token: string) {
  return apiFetch<{ inventory_items: unknown[]; count: number }>('/admin/inventory-items', { token })
}

export async function listLocations(token: string) {
  return apiFetch<{ stock_locations: unknown[]; count: number }>('/admin/stock-locations', { token })
}

export async function listOrders(token: string, params?: Record<string, string>) {
  const qs = params ? '?' + new URLSearchParams(params).toString() : ''
  return apiFetch<{ orders: unknown[]; count: number }>(`/admin/orders${qs}`, { token })
}

export async function healthCheck() {
  return apiFetch<{ status: string }>('/health')
}
