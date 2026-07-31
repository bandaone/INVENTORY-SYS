export const dynamic = 'force-dynamic'

import { getVerifiedSession } from '@/lib/session'
import { NextResponse } from 'next/server'

export async function GET() {
  const session = await getVerifiedSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  return NextResponse.json({
    role: session.role,
    tenantId: session.tenantId,
    locationId: session.locationId,
    shiftId: session.shiftId,
  })
}
