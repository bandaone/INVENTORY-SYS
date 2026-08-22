export const dynamic = 'force-dynamic'

import { adminPool } from '@/lib/db'
import { clearSessionCookies, getVerifiedSession } from '@/lib/session'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST() {
  const session = await getVerifiedSession()

  try {
    if (session?.tenantId) {
      await adminPool.query(`
        UPDATE staff
        SET auth_version = auth_version + 1, updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2 AND auth_version = $3
      `, [session.staffId, session.tenantId, session.authVersion])
      await adminPool.query(`
        INSERT INTO platform_access_events (tenant_id, staff_id, event_type, source, metadata)
        VALUES ($1, $2, 'LOCK', 'POS', $3)
      `, [session.tenantId, session.staffId, JSON.stringify({
        shift_id: session.shiftId,
        location_id: session.locationId,
      })]).catch(() => undefined)
    }
  } catch (error) {
    console.error('[POS Lock Error]', error)
  } finally {
    await (await createClient()).auth.signOut({ scope: 'local' }).catch(() => undefined)
    await clearSessionCookies()
  }

  return NextResponse.json({ success: true })
}
