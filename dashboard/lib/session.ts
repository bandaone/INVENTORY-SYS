import { cookies } from 'next/headers'
import { adminPool, fetchTenantQuery } from './db'
import { createClient } from './supabase/server'
import type { SessionRole } from './session-token'

const DISPLAY_COOKIE_NAMES = [
  'tenant_id',
  'staff_id',
  'shift_id',
  'staff_role',
  'staff_name',
  'tenant_name',
  'location_id',
  'location_name',
] as const

export type AppSession = {
  type: 'tenant' | 'platform'
  authUserId: string
  staffId: string
  role: SessionRole
  tenantId: string | null
  locationId: string | null
  shiftId: string | null
  authVersion: number
  tenantStatus?: string
}

export class SessionError extends Error {
  status: number

  constructor(message = 'Unauthorized', status = 401) {
    super(message)
    this.name = 'SessionError'
    this.status = status
  }
}

type TenantSessionOptions = { allowSuspended?: boolean }
type SessionDisplay = { staffName: string; tenantName?: string | null; locationName?: string | null }

export async function setSessionDisplayCookies(session: AppSession, display: SessionDisplay) {
  const store = await cookies()
  const secure = process.env.NODE_ENV === 'production'
  const protectedOptions = { path: '/', httpOnly: true, secure, sameSite: 'lax' as const }
  const displayOptions = { ...protectedOptions, httpOnly: false }

  store.set('staff_id', session.staffId, protectedOptions)
  store.set('staff_role', session.role, displayOptions)
  store.set('staff_name', display.staffName, displayOptions)
  const clearProtected = { ...protectedOptions, maxAge: 0 }
  const clearDisplay = { ...displayOptions, maxAge: 0 }
  if (session.tenantId) store.set('tenant_id', session.tenantId, protectedOptions)
  else store.set('tenant_id', '', clearProtected)
  if (session.shiftId) store.set('shift_id', session.shiftId, protectedOptions)
  else store.set('shift_id', '', clearProtected)
  if (session.locationId) store.set('location_id', session.locationId, protectedOptions)
  else store.set('location_id', '', clearProtected)
  if (display.tenantName) store.set('tenant_name', display.tenantName, displayOptions)
  else store.set('tenant_name', '', clearDisplay)
  if (display.locationName) store.set('location_name', display.locationName, displayOptions)
  else store.set('location_name', '', clearDisplay)
}

export async function getVerifiedSession(): Promise<AppSession | null> {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return null

  const adminResult = await adminPool.query(`
    SELECT id, auth_version
    FROM platform_admins
    WHERE auth_user_id = $1 AND is_active = true
    LIMIT 1
  `, [user.id])
  if (adminResult.rowCount === 1) {
    return {
      type: 'platform', authUserId: user.id, staffId: adminResult.rows[0].id,
      role: 'superadmin', tenantId: null, locationId: null, shiftId: null,
      authVersion: Number(adminResult.rows[0].auth_version || 0),
    }
  }

  const staffResult = await adminPool.query(`
    SELECT s.id, s.role, s.tenant_id, s.location_id, s.auth_version,
           t.status AS tenant_status,
           (SELECT sh.id FROM shifts sh
            WHERE sh.staff_id = s.id AND sh.tenant_id = s.tenant_id AND sh.ended_at IS NULL
            ORDER BY sh.started_at DESC LIMIT 1) AS shift_id
    FROM staff s
    JOIN tenants t ON t.id = s.tenant_id
    WHERE s.auth_user_id = $1 AND s.is_active = true
    LIMIT 1
  `, [user.id])
  if (staffResult.rowCount !== 1) return null
  const row = staffResult.rows[0]
  return {
    type: 'tenant', authUserId: user.id, staffId: row.id, role: row.role,
    tenantId: row.tenant_id, locationId: row.location_id || null,
    shiftId: row.shift_id || null, authVersion: Number(row.auth_version || 0),
    tenantStatus: String(row.tenant_status || '').toUpperCase(),
  }
}

export async function requireSession(allowedRoles?: readonly SessionRole[]): Promise<AppSession> {
  const session = await getVerifiedSession()
  if (!session) throw new SessionError()
  if (allowedRoles && !allowedRoles.includes(session.role)) throw new SessionError('Forbidden', 403)
  return session
}

export async function requireTenantSession(
  allowedRoles?: readonly SessionRole[],
  options: TenantSessionOptions = {},
) {
  const session = await requireSession(allowedRoles)
  if (!session.tenantId || session.type !== 'tenant') throw new SessionError('Tenant context required')

  const rows = await fetchTenantQuery(
    session.tenantId,
    `SELECT s.role, s.location_id, t.status AS tenant_status
     FROM staff s JOIN tenants t ON t.id = s.tenant_id
     WHERE s.id = $1 AND s.tenant_id = $2 AND s.auth_user_id = $3 AND s.is_active = true
     LIMIT 1`,
    [session.staffId, session.tenantId, session.authUserId],
  )
  const membership = rows[0]
  if (!membership || membership.role !== session.role) throw new SessionError('Session membership is no longer active')
  if ((membership.location_id || null) !== session.locationId) {
    throw new SessionError('Your store assignment changed. Please sign in again.')
  }
  const tenantStatus = String(membership.tenant_status || '').toUpperCase()
  if (!options.allowSuspended && (tenantStatus === 'SUSPENDED' || tenantStatus === 'CANCELLED')) {
    throw new SessionError('This store account is suspended', 403)
  }
  return { ...session, tenantId: session.tenantId, tenantStatus }
}

export async function requirePlatformSession() {
  const session = await requireSession(['superadmin'])
  if (session.type !== 'platform' || session.tenantId !== null) throw new SessionError()
  return session
}

export async function clearSessionCookies() {
  const store = await cookies()
  const options = {
    path: '/', httpOnly: true, secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const, maxAge: 0,
  }
  DISPLAY_COOKIE_NAMES.forEach((name) => store.set(name, '', options))
}
