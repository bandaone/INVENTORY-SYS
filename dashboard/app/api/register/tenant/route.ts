export const dynamic = 'force-dynamic'

import { adminPool } from '@/lib/db'
import { hashPin, validPin } from '@/lib/pin'
import { setSessionDisplayCookies, type AppSession } from '@/lib/session'
import { createClient } from '@/lib/supabase/server'
import {
  createSupabaseIdentity,
  deleteSupabaseIdentity,
  deriveSupabasePassword,
} from '@/lib/supabase/identity'
import { NextResponse } from 'next/server'
import type { PoolClient } from 'pg'

const TIERS = ['boutique_starter', 'growth', 'enterprise_fleet'] as const
type Tier = (typeof TIERS)[number]

export async function POST(req: Request) {
  let client: PoolClient | null = null
  let inTransaction = false
  let authUserId: string | null = null

  try {
    const data = await req.json()
    const businessName = typeof data.business_name === 'string' ? data.business_name.trim() : ''
    const ownerName = typeof data.owner_name === 'string' ? data.owner_name.trim() : ''
    const phone = typeof data.phone === 'string' ? data.phone.trim() : ''
    const email = typeof data.email === 'string' ? data.email.trim().toLocaleLowerCase() : ''
    const address = typeof data.address === 'string' ? data.address.trim() : ''
    const tier = TIERS.includes(data.tier as Tier) ? data.tier as Tier : null
    const pin = data.pin
    const confirmPin = data.confirm_pin

    if (!businessName || !ownerName || !email || !tier) {
      return NextResponse.json({ error: 'Business name, owner name, email and plan are required.' }, { status: 400 })
    }
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Enter a valid owner email.' }, { status: 400 })
    }
    if (!validPin(pin)) {
      return NextResponse.json({ error: 'Choose a 4-digit PIN.' }, { status: 400 })
    }
    if (pin !== confirmPin) {
      return NextResponse.json({ error: 'PIN confirmation does not match.' }, { status: 400 })
    }

    // Perform CPU-heavy hashing before reserving a database connection.
    const pinHash = await hashPin(pin)

    client = await adminPool.connect()
    await client.query('BEGIN')
    inTransaction = true

    // Serializes registrations for the same normalized email, preventing a race
    // from provisioning the same identity into two tenants.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [email])

    const existingIdentity = await client.query(`
      SELECT 'staff' AS identity_type
      FROM staff
      WHERE LOWER(BTRIM(email)) = $1
      UNION ALL
      SELECT 'platform_admin' AS identity_type
      FROM platform_admins
      WHERE LOWER(BTRIM(email)) = $1
      LIMIT 1
    `, [email])

    if (existingIdentity.rowCount && existingIdentity.rowCount > 0) {
      await client.query('ROLLBACK')
      inTransaction = false
      return NextResponse.json({
        error: 'An account already exists for this email. Sign in instead of creating another store.',
        code: 'EMAIL_ALREADY_REGISTERED',
      }, { status: 409 })
    }

    const authUser = await createSupabaseIdentity(email, pin)
    authUserId = authUser.id

    const planResult = await client.query(`
      SELECT id, max_locations
      FROM subscription_plans
      WHERE code = $1 AND is_active = TRUE
      FOR SHARE
    `, [tier])
    if (planResult.rowCount !== 1) throw new Error('Selected subscription plan is unavailable')
    const plan = planResult.rows[0]

    const tenantResult = await client.query(`
      INSERT INTO tenants (name, subscription_tier, subscription_plan_id, status, max_locations)
      VALUES ($1, $2, $3, 'TRIAL', $4)
      RETURNING id
    `, [businessName, tier, plan.id, plan.max_locations])
    const tenantId = tenantResult.rows[0].id

    const locationResult = await client.query(`
      INSERT INTO locations (tenant_id, name, address)
      VALUES ($1, 'Main Store', $2)
      RETURNING id, name
    `, [tenantId, address])
    const location = locationResult.rows[0]

    const staffResult = await client.query(`
      INSERT INTO staff (tenant_id, auth_user_id, name, email, role, pin_hash, location_id)
      VALUES ($1, $2, $3, $4, 'owner', $5, $6)
      RETURNING id
    `, [tenantId, authUserId, ownerName, email, pinHash, location.id])
    const staffId = staffResult.rows[0].id

    await client.query(`
      INSERT INTO tenant_settings (
        tenant_id, business_name, owner_email, owner_phone, currency, tax_rate,
        receipt_footer, zra_enabled, updated_at
      ) VALUES ($1, $2, $3, $4, 'ZMW', 16, $5, false, NOW())
    `, [tenantId, businessName, email, phone, `Thank you for shopping at ${businessName}!`])

    await client.query(`
      INSERT INTO onboarding_sessions (
        tenant_id, current_step, trial_start_date, trial_end_date,
        onboarding_type, business_profile_completed, location_created, staff_created,
        products_loaded, first_stock_received, hardware_paired, first_sale_completed,
        converted_to_paid, go_live_approved
      ) VALUES ($1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '7 days',
        'SELF_SERVICE', true, true, true, false, false, false, false, false, false)
    `, [tenantId])

    await client.query(`
      INSERT INTO onboarding_events (tenant_id, event_type, step_number)
      VALUES ($1, 'SELF_SERVICE_REGISTRATION_COMPLETED', 1)
    `, [tenantId])

    await client.query(`
      INSERT INTO billing_events (
        tenant_id, event_type, old_tier, new_tier, amount, currency, status, due_at, metadata
      ) VALUES ($1, 'TRIAL_STARTED', NULL, $2, 0, 'ZMW', 'POSTED',
        CURRENT_TIMESTAMP + INTERVAL '7 days', $3)
    `, [tenantId, tier, JSON.stringify({ trial_days: 7, source: 'public_registration' })])

    const supabase = createClient()
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password: deriveSupabasePassword(email, pin),
    })
    if (authError || !authData.user) throw authError || new Error('Unable to start Supabase session')

    await client.query('COMMIT')
    inTransaction = false

    const session: AppSession = {
      type: 'tenant', authUserId: authData.user.id, staffId, role: 'owner',
      tenantId, locationId: location.id, shiftId: null, authVersion: 0,
    }
    setSessionDisplayCookies(session, {
      staffName: ownerName,
      tenantName: businessName,
      locationName: location.name,
    })

    import('@/lib/email').then(({ sendWelcomeEmail }) => {
      sendWelcomeEmail(email, ownerName).catch(console.error)
    })

    return NextResponse.json({ success: true, tenantId, redirect: '/setup' }, { status: 201 })
  } catch (error) {
    if (inTransaction && client) await client.query('ROLLBACK').catch(() => {})
    if (inTransaction && authUserId) await deleteSupabaseIdentity(authUserId).catch(console.error)
    console.error('Self-Serve Registration Error:', error)
    return NextResponse.json({
      error: 'Our system encountered a problem while provisioning your store. Please try again.',
    }, { status: 500 })
  } finally {
    client?.release()
  }
}
