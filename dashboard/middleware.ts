import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { sessionCookieName, verifySessionToken, type SessionClaims, type SessionRole } from '@/lib/session-token'

const PUBLIC_API_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/logout',
  '/api/pos/login',
  '/api/register/tenant',
  '/api/subscription/momo/callback',
])

const SESSION_EXEMPT_API_PATHS = new Set(['/api/cron/trial-check', '/api/cron/zra-sync'])
const PUBLIC_PAGE_PATHS = new Set(['/login', '/register', '/monitoring'])

function apiError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function loginRedirect(request: NextRequest) {
  const login = new URL('/login', request.url)
  if (request.nextUrl.pathname !== '/') login.searchParams.set('next', request.nextUrl.pathname)
  return NextResponse.redirect(login)
}

function cookieMatchesSession(request: NextRequest, session: SessionClaims) {
  const staffId = request.cookies.get('staff_id')?.value
  const staffRole = request.cookies.get('staff_role')?.value
  const tenantId = request.cookies.get('tenant_id')?.value || null
  const shiftId = request.cookies.get('shift_id')?.value || null
  const locationId = request.cookies.get('location_id')?.value || null

  if (staffId !== session.staffId || staffRole !== session.role) return false
  if (tenantId !== session.tenantId) return false
  if (shiftId !== session.shiftId) return false
  if (locationId !== session.locationId) return false

  return true
}

function allowed(role: SessionRole, roles: readonly SessionRole[]) {
  return roles.includes(role)
}

function pageRoles(pathname: string): readonly SessionRole[] | null {
  if (pathname.startsWith('/superadmin')) return ['superadmin']
  if (pathname.startsWith('/operations')) return ['store_manager', 'stock_clerk']
  if (pathname.startsWith('/pos')) return ['owner', 'store_manager', 'cashier']
  if (pathname.startsWith('/setup')) return ['owner']
  return null
}

function apiRoles(pathname: string, method: string): readonly SessionRole[] | null {
  const readOnly = method === 'GET' || method === 'HEAD'

  if (pathname === '/api/staff') {
    return readOnly ? ['owner', 'store_manager'] : ['owner']
  }
  if (pathname === '/api/settings' || pathname === '/api/onboarding') {
    return ['owner']
  }
  if (pathname.startsWith('/api/zra/') || pathname.startsWith('/api/subscription/')) {
    return ['owner']
  }
  if (pathname === '/api/locations') {
    return readOnly
      ? ['owner', 'store_manager', 'cashier', 'stock_clerk']
      : ['owner']
  }
  if (pathname === '/api/catalog' || pathname.startsWith('/api/catalog/')) {
    return readOnly
      ? ['owner', 'store_manager', 'cashier', 'stock_clerk']
      : ['owner', 'store_manager', 'stock_clerk']
  }
  if (pathname === '/api/receive' || pathname === '/api/import-profiles') {
    return ['owner', 'store_manager', 'stock_clerk']
  }
  if (pathname === '/api/conflicts') {
    return method === 'PATCH'
      ? ['owner', 'store_manager']
      : ['owner', 'store_manager', 'stock_clerk']
  }
  if (pathname === '/api/transfers' || pathname === '/api/transfers/accept' || pathname === '/api/stocktake') {
    return ['owner', 'store_manager', 'stock_clerk']
  }
  if (pathname === '/api/pos' || pathname === '/api/pos/catalog') {
    return ['owner', 'store_manager', 'cashier']
  }
  if (pathname === '/api/pos/returns') {
    return ['owner', 'store_manager', 'cashier']
  }
  if (pathname === '/api/live-activity' || pathname === '/api/sales-trend') {
    return ['owner', 'store_manager']
  }
  return null
}

function withVerifiedHeaders(request: NextRequest, session: SessionClaims) {
  const headers = new Headers(request.headers)
  ;[
    'x-retail-staff-id',
    'x-retail-role',
    'x-retail-tenant-id',
    'x-retail-location-id',
    'x-retail-shift-id',
    'x-retail-pathname',
  ].forEach((name) => headers.delete(name))
  headers.set('x-retail-staff-id', session.staffId)
  headers.set('x-retail-role', session.role)
  if (session.tenantId) headers.set('x-retail-tenant-id', session.tenantId)
  if (session.locationId) headers.set('x-retail-location-id', session.locationId)
  if (session.shiftId) headers.set('x-retail-shift-id', session.shiftId)
  headers.set('x-retail-pathname', request.nextUrl.pathname)
  return NextResponse.next({ request: { headers } })
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  const isApi = pathname.startsWith('/api/')

  if (!isApi && PUBLIC_PAGE_PATHS.has(pathname)) return NextResponse.next()

  if (isApi && (PUBLIC_API_PATHS.has(pathname) || SESSION_EXEMPT_API_PATHS.has(pathname))) {
    return NextResponse.next()
  }

  const session = await verifySessionToken(request.cookies.get(sessionCookieName())?.value)
  if (!session) return isApi ? apiError('Unauthorized: invalid or expired session', 401) : loginRedirect(request)

  if (!cookieMatchesSession(request, session)) {
    return isApi ? apiError('Unauthorized: session context mismatch', 401) : loginRedirect(request)
  }

  if (isApi) {
    if (pathname.startsWith('/api/superadmin') && session.role !== 'superadmin') {
      return apiError('Forbidden: superadmin access required', 403)
    }
    if (pathname !== '/api/auth/logout' && !pathname.startsWith('/api/superadmin') && !session.tenantId) {
      return apiError('Unauthorized: tenant session required', 401)
    }
    const roles = apiRoles(pathname, request.method)
    if (roles && !allowed(session.role, roles)) return apiError('Forbidden', 403)
    return withVerifiedHeaders(request, session)
  }

  const roles = pageRoles(pathname)
  if (roles && !allowed(session.role, roles)) return loginRedirect(request)
  if (!roles && session.role === 'superadmin') return NextResponse.redirect(new URL('/superadmin', request.url))
  if (!roles && !session.tenantId) return loginRedirect(request)

  return withVerifiedHeaders(request, session)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
