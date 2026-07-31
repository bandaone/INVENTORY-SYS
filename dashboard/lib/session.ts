import { cookies } from 'next/headers'
import { adminPool, fetchTenantQuery } from './db'
import {
  createSessionToken,
  sessionCookieName,
  sessionMaxAge,
  verifySessionToken,
  type NewSessionClaims,
  type SessionClaims,
  type SessionRole,
} from './session-token'

const LEGACY_COOKIE_NAMES = [
  'tenant_id',
  'staff_id',
  'shift_id',
  'staff_role',
  'staff_name',
  'tenant_name',
  'location_id',
  'location_name',
] as const

export class SessionError extends Error {
  status: number

  constructor(message = 'Unauthorized', status = 401) {
    super(message)
    this.name = 'SessionError'
    this.status = status
  }
}

type TenantSessionOptions = {
  allowSuspended?: boolean
}

type SessionDisplay = {
  staffName: string
  tenantName?: string | null
  locationName?: string | null
}

export async function issueSession(input: NewSessionClaims, display: SessionDisplay) {
  const token = await createSessionToken(input)
  const claims = await verifySessionToken(token)
  if (!claims) throw new Error('Unable to create session')

  const secure = process.env.NODE_ENV === 'production'
  const maxAge = sessionMaxAge(claims)
  const protectedOptions = { path: '/', httpOnly: true, secure, sameSite: 'lax' as const, maxAge }
  const displayOptions = { ...protectedOptions, httpOnly: false }
  const store = cookies()

  store.set(sessionCookieName(), token, { ...protectedOptions, priority: 'high' })
  store.set('staff_id', claims.staffId, protectedOptions)
  store.set('staff_role', claims.role, displayOptions)
  store.set('staff_name', display.staffName, displayOptions)

  if (claims.tenantId) store.set('tenant_id', claims.tenantId, protectedOptions)
  else store.set('tenant_id', '', { ...protectedOptions, maxAge: 0 })

  if (claims.shiftId) store.set('shift_id', claims.shiftId, protectedOptions)
  else store.set('shift_id', '', { ...protectedOptions, maxAge: 0 })

  if (claims.locationId) store.set('location_id', claims.locationId, protectedOptions)
  else store.set('location_id', '', { ...protectedOptions, maxAge: 0 })

  if (display.tenantName) store.set('tenant_name', display.tenantName, displayOptions)
  else store.set('tenant_name', '', { ...displayOptions, maxAge: 0 })

  if (display.locationName) store.set('location_name', display.locationName, displayOptions)
  else store.set('location_name', '', { ...displayOptions, maxAge: 0 })

  return claims
}

export async function getVerifiedSession() {
  return verifySessionToken(cookies().get(sessionCookieName())?.value)
}

export async function requireSession(allowedRoles?: readonly SessionRole[]): Promise<SessionClaims> {
  const session = await getVerifiedSession()
  if (!session) throw new SessionError()
  if (allowedRoles && !allowedRoles.includes(session.role)) {
    throw new SessionError('Forbidden', 403)
  }
  return session
}

export async function requireTenantSession(
  allowedRoles?: readonly SessionRole[],
  options: TenantSessionOptions = {},
) {
  const session = await requireSession(allowedRoles)
  if (!session.tenantId) throw new SessionError('Tenant context required')

  const rows = await fetchTenantQuery(
    session.tenantId,
    `SELECT s.role, s.location_id, s.auth_version, t.status AS tenant_status
     FROM staff s
     JOIN tenants t ON t.id = s.tenant_id
     WHERE s.id = $1 AND s.tenant_id = $2 AND s.is_active = true
     LIMIT 1`,
    [session.staffId, session.tenantId]
  )
  const membership = rows[0]
  if (!membership || membership.role !== session.role) {
    throw new SessionError('Session membership is no longer active')
  }
  if ((membership.location_id || null) !== session.locationId) {
    throw new SessionError('Your store assignment changed. Please sign in again.')
  }
  if (Number(membership.auth_version || 0) !== session.authVersion) {
    throw new SessionError('Your credentials changed. Please sign in again.')
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
  const result = await adminPool.query(
    `SELECT id, auth_version FROM platform_admins WHERE id = $1 AND is_active = true LIMIT 1`,
    [session.staffId]
  )
  if (result.rowCount !== 1) throw new SessionError('Platform session is no longer active')
  if (Number(result.rows[0].auth_version || 0) !== session.authVersion) {
    throw new SessionError('Your credentials changed. Please sign in again.')
  }
  return session
}

export function clearSessionCookies() {
  const store = cookies()
  const options = {
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 0,
  }
  store.set(sessionCookieName(), '', { ...options, priority: 'high' })
  LEGACY_COOKIE_NAMES.forEach((name) => store.set(name, '', options))
}
