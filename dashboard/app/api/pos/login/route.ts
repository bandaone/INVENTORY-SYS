import { NextResponse } from 'next/server'

// Backward-compatible alias for older POS clients. A 307 preserves the method
// and request body while moving authentication to the Supabase-backed endpoint.
export async function POST(request: Request) {
  return NextResponse.redirect(new URL('/api/auth/login', request.url), 307)
}

export async function DELETE(request: Request) {
  return NextResponse.redirect(new URL('/api/auth/logout', request.url), 307)
}
