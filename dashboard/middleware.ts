import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // Public API paths that do not require authentication
  const publicApiPaths = [
    '/api/auth/login',
    '/api/register',
  ];

  // If the request is for the API
  if (request.nextUrl.pathname.startsWith('/api/')) {
    // Check if it's a public path
    if (publicApiPaths.some(path => request.nextUrl.pathname.startsWith(path))) {
      return NextResponse.next();
    }

    const staffId = request.cookies.get('staff_id')?.value;
    const staffRole = request.cookies.get('staff_role')?.value;

    if (!staffId || !staffRole) {
      return NextResponse.json({ error: 'Unauthorized: Missing session tokens' }, { status: 401 });
    }

    // Superadmin paths
    if (request.nextUrl.pathname.startsWith('/api/superadmin')) {
      if (staffRole !== 'superadmin') {
        return NextResponse.json({ error: 'Forbidden: Superadmin access required' }, { status: 403 });
      }
      return NextResponse.next();
    }

    // Tenant paths
    const tenantId = request.cookies.get('tenant_id')?.value;
    if (!tenantId && staffRole !== 'superadmin') {
      return NextResponse.json({ error: 'Unauthorized: Missing tenant context' }, { status: 401 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all API routes
     */
    '/api/:path*',
  ],
};
