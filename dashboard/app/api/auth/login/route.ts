export const dynamic = 'force-dynamic'

import { adminPool } from '@/lib/db'
import { hashPin, needsPinUpgrade, validPin, verifyPin } from '@/lib/pin'
import { setSessionDisplayCookies, type AppSession } from '@/lib/session'
import { createClient } from '@/lib/supabase/server'
import {
  createSupabaseIdentity,
  deleteSupabaseIdentity,
  deriveSupabasePassword,
} from '@/lib/supabase/identity'
import { SESSION_ROLES, type SessionRole } from '@/lib/session-token'
import {
  clearPlatformLoginFailures,
  clearStaffLoginFailures,
  recordPlatformLoginFailure,
  recordStaffLoginFailure,
} from '@/lib/login-lockout'
import { NextResponse } from 'next/server'

type StaffLoginRow = {
  staff_id: string
  staff_name: string
  role: SessionRole
  pin_hash: string
  tenant_id: string
  tenant_name: string
  tenant_status: string
  location_id: string | null
  location_name: string | null
  is_locked: boolean
  auth_version: number
  auth_user_id: string | null
}

function invalidCredentials() {
  return NextResponse.json({ error: 'Invalid email or PIN' }, { status: 401 })
}

async function startSupabaseSession(
  email: string,
  pin: string,
  currentAuthUserId: string | null,
  linkIdentity: (userId: string) => Promise<void>,
) {
  const supabase = createClient()
  const password = deriveSupabasePassword(email, pin)
  let result = await supabase.auth.signInWithPassword({ email, password })

  if (result.data.user) {
    if (currentAuthUserId && currentAuthUserId !== result.data.user.id) {
      await supabase.auth.signOut({ scope: 'local' })
      return null
    }
    if (!currentAuthUserId) {
      try {
        await linkIdentity(result.data.user.id)
      } catch (error) {
        await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
        throw error
      }
    }
    return result.data.user
  }

  if (currentAuthUserId) return null
  const created = await createSupabaseIdentity(email, pin)
  try {
    await linkIdentity(created.id)
  } catch (error) {
    await deleteSupabaseIdentity(created.id).catch(console.error)
    throw error
  }
  result = await supabase.auth.signInWithPassword({ email, password })
  return result.data.user || null
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const email = typeof body.email === 'string' ? body.email.trim().toLocaleLowerCase() : ''
    const pin = body.pin

    if (!email || !validPin(pin)) {
      return NextResponse.json({ error: 'Email and a 4-digit PIN are required' }, { status: 400 })
    }

    const adminResult = await adminPool.query(`
      SELECT id, name, email, pin_hash, auth_version, auth_user_id,
             (lockout_until IS NOT NULL AND lockout_until > NOW()) AS is_locked
      FROM platform_admins
      WHERE LOWER(BTRIM(email)) = $1 AND is_active = true
      LIMIT 1
    `, [email])

    const admin = adminResult.rows[0]
    if (admin) {
      const overlappingStaff = await adminPool.query(
        `SELECT 1 FROM staff WHERE LOWER(BTRIM(email)) = $1 AND is_active = true LIMIT 1`,
        [email]
      )
      if ((overlappingStaff.rowCount ?? 0) > 0) {
        return NextResponse.json({
          error: 'This identity is linked to both platform and store access. Contact support to separate the accounts.',
          code: 'AMBIGUOUS_ACCOUNT_TYPE',
        }, { status: 409 })
      }
    }
    if (admin?.is_locked) return invalidCredentials()
    if (admin && await verifyPin(pin, admin.pin_hash)) {
      const authUser = await startSupabaseSession(email, pin, admin.auth_user_id, async (userId) => {
        await adminPool.query(
          'UPDATE platform_admins SET auth_user_id = $1, updated_at = NOW() WHERE id = $2 AND auth_user_id IS NULL',
          [userId, admin.id],
        )
      })
      if (!authUser) {
        await recordPlatformLoginFailure(admin.id)
        return invalidCredentials()
      }
      if (needsPinUpgrade(admin.pin_hash)) {
        await adminPool.query('UPDATE platform_admins SET pin_hash = $1, updated_at = NOW() WHERE id = $2', [
          await hashPin(pin),
          admin.id,
        ])
      }

      await clearPlatformLoginFailures(admin.id)

      setSessionDisplayCookies({
        type: 'platform', authUserId: authUser.id, staffId: admin.id, role: 'superadmin',
        tenantId: null, locationId: null, shiftId: null,
        authVersion: Number(admin.auth_version || 0),
      }, {
        staffName: admin.name,
        tenantName: 'Retail OS HQ',
      })

      return NextResponse.json({
        success: true,
        redirect: '/superadmin',
        user: { name: admin.name, role: 'superadmin', tenant: 'Retail OS HQ', location: null },
      })
    }
    if (admin) await recordPlatformLoginFailure(admin.id)

    const result = await adminPool.query<StaffLoginRow>(`
      SELECT
        s.id AS staff_id,
        s.name AS staff_name,
        s.role,
        s.pin_hash,
        s.tenant_id,
        s.location_id,
        s.auth_version,
        s.auth_user_id,
        t.name AS tenant_name,
        t.status AS tenant_status,
        l.name AS location_name
        , (s.lockout_until IS NOT NULL AND s.lockout_until > NOW()) AS is_locked
      FROM staff s
      JOIN tenants t ON t.id = s.tenant_id
      LEFT JOIN locations l ON l.id = s.location_id AND l.tenant_id = s.tenant_id
      WHERE LOWER(BTRIM(s.email)) = $1 AND s.is_active = true
      ORDER BY s.created_at ASC
    `, [email])

    if (result.rows.length > 1) {
      return NextResponse.json({
        error: 'This email is linked to more than one store. Contact support to separate the accounts.',
        code: 'AMBIGUOUS_TENANT_ACCOUNT',
      }, { status: 409 })
    }

    const credentialMatches: StaffLoginRow[] = []
    for (const candidate of result.rows) {
      if (!candidate.is_locked && await verifyPin(pin, candidate.pin_hash)) credentialMatches.push(candidate)
    }

    if (credentialMatches.length === 0) {
      await recordStaffLoginFailure(email)
      return invalidCredentials()
    }
    if (credentialMatches.length > 1) {
      return NextResponse.json({
        error: 'This email is linked to more than one store with the same PIN. Contact support to separate the accounts.',
        code: 'AMBIGUOUS_TENANT_ACCOUNT',
      }, { status: 409 })
    }

    const user = credentialMatches[0]
    if (!SESSION_ROLES.includes(user.role) || user.role === 'superadmin') return invalidCredentials()
    const tenantRestricted = ['SUSPENDED', 'CANCELLED'].includes(String(user.tenant_status).toUpperCase())
    if (tenantRestricted && user.role !== 'owner') {
      return NextResponse.json({ error: 'This store account is suspended. Contact support.' }, { status: 403 })
    }
    if (user.role !== 'owner' && !user.location_id) {
      return NextResponse.json({
        error: 'Your account has no store assigned. Contact your manager to assign you to a branch.',
      }, { status: 403 })
    }

    let redirectTo = tenantRestricted ? '/subscription' : '/'
    if (user.role === 'owner' && !tenantRestricted) {
      const onboardingResult = await adminPool.query(`
        SELECT go_live_approved
        FROM onboarding_sessions
        WHERE tenant_id = $1
        LIMIT 1
      `, [user.tenant_id])
      redirectTo = onboardingResult.rows[0]?.go_live_approved ? '/' : '/setup'
    }

    const redirectMap: Record<SessionRole, string> = {
      superadmin: '/superadmin',
      owner: redirectTo,
      store_manager: '/operations',
      cashier: '/pos',
      stock_clerk: '/operations',
    }

    const authUser = await startSupabaseSession(email, pin, user.auth_user_id, async (userId) => {
      await adminPool.query(
        'UPDATE staff SET auth_user_id = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3 AND auth_user_id IS NULL',
        [userId, user.staff_id, user.tenant_id],
      )
    })
    if (!authUser) {
      await recordStaffLoginFailure(email)
      return invalidCredentials()
    }

    if (needsPinUpgrade(user.pin_hash)) {
      await adminPool.query('UPDATE staff SET pin_hash = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3', [
        await hashPin(pin),
        user.staff_id,
        user.tenant_id,
      ])
    }

    await clearStaffLoginFailures(user.staff_id, user.tenant_id)

    // A dropped browser session may leave a legitimate shift open. Reuse the
    // single database-enforced open shift instead of creating duplicates.
    const shiftResult = await adminPool.query(`
      INSERT INTO shifts (tenant_id, staff_id, location_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (tenant_id, staff_id) WHERE ended_at IS NULL
      DO UPDATE SET location_id = shifts.location_id
      RETURNING id, location_id
    `, [user.tenant_id, user.staff_id, user.location_id])
    if ((shiftResult.rows[0]?.location_id || null) !== (user.location_id || null)) {
      await createClient().auth.signOut({ scope: 'local' }).catch(() => undefined)
      return NextResponse.json({
        error: 'An open shift belongs to a previous store assignment. Close it before signing in.',
        code: 'OPEN_SHIFT_LOCATION_MISMATCH',
      }, { status: 409 })
    }
    const shiftId = shiftResult.rows[0].id

    await adminPool.query(`
      INSERT INTO platform_access_events (tenant_id, staff_id, event_type, source, metadata)
      VALUES ($1, $2, 'LOGIN', 'DASHBOARD', $3)
    `, [user.tenant_id, user.staff_id, JSON.stringify({ role: user.role, location_id: user.location_id })])

    const session: AppSession = {
      type: 'tenant', authUserId: authUser.id, staffId: user.staff_id, role: user.role,
      tenantId: user.tenant_id, locationId: user.location_id, shiftId,
      authVersion: Number(user.auth_version || 0),
    }
    setSessionDisplayCookies(session, {
      staffName: user.staff_name,
      tenantName: user.tenant_name,
      locationName: user.location_name,
    })

    return NextResponse.json({
      success: true,
      redirect: redirectMap[user.role],
      user: {
        name: user.staff_name,
        role: user.role,
        tenant: user.tenant_name,
        location: user.location_name,
      },
    })
  } catch (error) {
    console.error('[Login Error]', error)
    return NextResponse.json({ error: 'Authentication service unavailable' }, { status: 500 })
  }
}
