import 'server-only'

import type { AppSession } from './session'
import { SessionError, requireTenantSession } from './session'
import { createSessionToken, verifySessionToken, type SessionRole } from './session-token'
import { POS_TERMINAL_HEADER } from './pos-constants'

export const POS_TERMINAL_MAX_AGE_SECONDS = 60 * 60 * 8

const POS_ROLES = ['owner', 'store_manager', 'cashier'] as const

export async function createPosTerminalToken(session: AppSession) {
  if (!session.tenantId || !session.locationId || !session.shiftId || session.type !== 'tenant') {
    return null
  }
  if (!POS_ROLES.includes(session.role as (typeof POS_ROLES)[number])) return null

  return createSessionToken({
    staffId: session.staffId,
    role: session.role,
    tenantId: session.tenantId,
    locationId: session.locationId,
    shiftId: session.shiftId,
    authVersion: session.authVersion,
    maxAgeSeconds: POS_TERMINAL_MAX_AGE_SECONDS,
  })
}

export async function requirePosTerminalSession(
  request: Request,
  allowedRoles: readonly SessionRole[] = POS_ROLES,
) {
  const session = await requireTenantSession(allowedRoles)
  const terminalToken = request.headers.get(POS_TERMINAL_HEADER)
  const terminal = await verifySessionToken(terminalToken)

  if (!terminal || terminal.type !== 'tenant') {
    throw new SessionError('This till is locked. Sign in to unlock it.', 401)
  }
  if (
    terminal.staffId !== session.staffId
    || terminal.role !== session.role
    || terminal.tenantId !== session.tenantId
    || terminal.locationId !== session.locationId
    || terminal.shiftId !== session.shiftId
    || terminal.authVersion !== session.authVersion
  ) {
    throw new SessionError('This till session is no longer valid. Sign in again.', 401)
  }

  return session
}
