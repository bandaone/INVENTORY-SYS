export const dynamic = 'force-dynamic'

import { getVerifiedSession } from '@/lib/session'
import { requirePosTerminalSession } from '@/lib/pos-terminal'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const session = url.searchParams.get('context') === 'pos'
      ? await requirePosTerminalSession(request)
      : await getVerifiedSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    return NextResponse.json({
      role: session.role,
      tenantId: session.tenantId,
      staffId: session.staffId,
      locationId: session.locationId,
      shiftId: session.shiftId,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 })
  }
}
