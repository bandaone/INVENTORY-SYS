import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const PUBLIC_API_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/logout',
  '/api/pos/login',
  '/api/register/tenant',
  '/api/subscription/momo/callback',
])
const SESSION_EXEMPT_API_PATHS = new Set([
  '/api/cron/trial-check',
  '/api/cron/zra-sync',
  '/api/cron/metrics-rollup',
])
const PUBLIC_PAGE_PATHS = new Set(['/login', '/register', '/monitoring'])

function apiError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function loginRedirect(request: NextRequest) {
  const login = new URL('/login', request.url)
  if (request.nextUrl.pathname !== '/') login.searchParams.set('next', request.nextUrl.pathname)
  return NextResponse.redirect(login)
}

function copyAuthCookies(source: NextResponse, target: NextResponse) {
  source.cookies.getAll().forEach((cookie) => target.cookies.set(cookie))
  target.headers.set('Cache-Control', 'private, no-store')
  return target
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  const isApi = pathname.startsWith('/api/')

  if (!isApi && PUBLIC_PAGE_PATHS.has(pathname)) return NextResponse.next()
  if (isApi && (PUBLIC_API_PATHS.has(pathname) || SESSION_EXEMPT_API_PATHS.has(pathname))) {
    return NextResponse.next()
  }

  const requestHeaders = new Headers(request.headers)
  requestHeaders.delete('x-retail-pathname')
  requestHeaders.set('x-retail-pathname', pathname)
  let response = NextResponse.next({ request: { headers: requestHeaders } })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request: { headers: requestHeaders } })
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        },
      },
    },
  )

  // getUser revalidates the cookie-backed session with Supabase Auth.
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    const denied = isApi
      ? apiError('Unauthorized: invalid or expired session', 401)
      : loginRedirect(request)
    return copyAuthCookies(response, denied)
  }

  response.headers.set('Cache-Control', 'private, no-store')
  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
