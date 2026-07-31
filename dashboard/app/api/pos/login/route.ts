export const dynamic = 'force-dynamic'

import { adminPool } from '@/lib/db'
import { hashPin, needsPinUpgrade, validPin, verifyPin } from '@/lib/pin'
import { clearSessionCookies, getVerifiedSession, issueSession } from '@/lib/session'
import { assertSessionConfiguration, type SessionRole } from '@/lib/session-token'
import { clearStaffLoginFailures, recordStaffLoginFailure } from '@/lib/login-lockout'
import { NextResponse } from 'next/server'

type PosLoginRow = {
  id: string
  name: string
  role: SessionRole
  pin_hash: string
  tenant_id: string
  tenant_name: string
  tenant_status: string
  default_location_id: string | null
  default_location_name: string | null
  is_locked: boolean
  auth_version: number
}

export async function POST(req: Request) {
  try {
    assertSessionConfiguration()
    const body = await req.json()
    const email = typeof body.email === 'string' ? body.email.trim().toLocaleLowerCase() : ''
    const pin = body.pin

    if (!email || !validPin(pin)) {
      return NextResponse.json({ error: 'Email and a 4-digit PIN are required' }, { status: 400 })
    }

    const result = await adminPool.query<PosLoginRow>(`
      SELECT
        s.id,
        s.name,
        s.role,
        s.pin_hash,
        s.tenant_id,
        s.auth_version,
        t.name AS tenant_name,
        t.status AS tenant_status,
        l.id AS default_location_id,
        l.name AS default_location_name
        , (s.lockout_until IS NOT NULL AND s.lockout_until > NOW()) AS is_locked
      FROM staff s
      JOIN tenants t ON t.id = s.tenant_id
      LEFT JOIN locations l ON l.id = s.location_id AND l.tenant_id = s.tenant_id
      WHERE LOWER(BTRIM(s.email)) = $1
        AND s.is_active = true
        AND s.role IN ('cashier', 'stock_clerk', 'store_manager', 'owner')
      ORDER BY s.created_at ASC
    `, [email])

    const platformIdentity = await adminPool.query(
      `SELECT 1 FROM platform_admins WHERE LOWER(BTRIM(email)) = $1 AND is_active = true LIMIT 1`,
      [email]
    )
    if ((platformIdentity.rowCount ?? 0) > 0 || result.rows.length > 1) {
      return NextResponse.json({
        error: 'This email is linked to more than one account. Contact support to separate the accounts.',
        code: 'AMBIGUOUS_TENANT_ACCOUNT',
      }, { status: 409 })
    }

    const matches: PosLoginRow[] = []
    for (const candidate of result.rows) {
      if (!candidate.is_locked && await verifyPin(pin, candidate.pin_hash)) matches.push(candidate)
    }

    if (matches.length === 0) {
      await recordStaffLoginFailure(email)
      return NextResponse.json({ error: 'Invalid credentials or account inactive' }, { status: 401 })
    }
    if (matches.length > 1) {
      return NextResponse.json({
        error: 'This email and PIN identify more than one store. Contact support to separate the accounts.',
        code: 'AMBIGUOUS_TENANT_ACCOUNT',
      }, { status: 409 })
    }

    const user = matches[0]
    if (user.tenant_status === 'SUSPENDED' || user.tenant_status === 'CANCELLED') {
      return NextResponse.json({ error: 'This store account is suspended. Contact support.' }, { status: 403 })
    }
    if (user.role !== 'owner' && !user.default_location_id) {
      return NextResponse.json({ error: 'Your account has no store location assigned.' }, { status: 403 })
    }

    const shift = await adminPool.query(`
      INSERT INTO shifts (tenant_id, staff_id, location_id)
      VALUES ($1, $2, $3)
      RETURNING id
    `, [user.tenant_id, user.id, user.default_location_id])

    if (needsPinUpgrade(user.pin_hash)) {
      await adminPool.query('UPDATE staff SET pin_hash = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3', [
        await hashPin(pin),
        user.id,
        user.tenant_id,
      ])
    }

    await clearStaffLoginFailures(user.id, user.tenant_id)

    await adminPool.query(`
      INSERT INTO platform_access_events (tenant_id, staff_id, event_type, source, metadata)
      VALUES ($1, $2, 'LOGIN', 'POS', $3)
    `, [user.tenant_id, user.id, JSON.stringify({ role: user.role, location_id: user.default_location_id })])

    await issueSession({
      staffId: user.id,
      role: user.role,
      tenantId: user.tenant_id,
      locationId: user.default_location_id,
      shiftId: shift.rows[0].id,
      authVersion: Number(user.auth_version || 0),
    }, {
      staffName: user.name,
      tenantName: user.tenant_name,
      locationName: user.default_location_name,
    })

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        tenant_name: user.tenant_name,
        location_name: user.default_location_name,
      },
    })
  } catch (error) {
    console.error('[POS Login Error]', error)
    return NextResponse.json({ error: 'Authentication failed' }, { status: 500 })
  }
}

export async function DELETE() {
  const session = await getVerifiedSession()
  clearSessionCookies()

  if (!session?.tenantId) return NextResponse.json({ success: true })

  try {
    if (session.shiftId) {
      await adminPool.query(`
        UPDATE shifts
        SET ended_at = COALESCE(ended_at, NOW())
        WHERE id = $1 AND tenant_id = $2 AND staff_id = $3 AND ended_at IS NULL
      `, [session.shiftId, session.tenantId, session.staffId])
    }
    await adminPool.query(`
      UPDATE staff SET auth_version = auth_version + 1, updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2 AND auth_version = $3
    `, [session.staffId, session.tenantId, session.authVersion])
    await adminPool.query(`
      INSERT INTO platform_access_events (tenant_id, staff_id, event_type, source, metadata)
      VALUES ($1, $2, 'LOGOUT', 'POS', $3)
    `, [session.tenantId, session.staffId, JSON.stringify({ shift_id: session.shiftId })])
  } catch (error) {
    console.error('[POS Logout Error]', error)
  }

  return NextResponse.json({ success: true })
}
