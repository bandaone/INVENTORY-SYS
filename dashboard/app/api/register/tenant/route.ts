export const dynamic = 'force-dynamic'

import { adminPool } from '@/lib/db'
import { hashPin, validPin } from '@/lib/pin'
import { REGISTRATION_TRIAL_DAYS } from '@/lib/registration'
import { setSessionDisplayCookies, type AppSession } from '@/lib/session'
import { createClient } from '@/lib/supabase/server'
import {
  createSupabaseIdentity,
  deleteSupabaseIdentity,
  deriveSupabasePassword,
} from '@/lib/supabase/identity'
import { NextResponse } from 'next/server'
import type { PoolClient } from 'pg'

type ProvisionedAccount = {
  tenantId: string
  tenantName: string
  locationId: string
  locationName: string
  staffId: string
  ownerName: string
  authUserId: string
  authVersion: number
}

class RegistrationError extends Error {
  constructor(message: string, readonly status = 400, readonly code?: string) {
    super(message)
    this.name = 'RegistrationError'
  }
}

function textField(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function isAuthIdentityConflict(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { code?: string; status?: number; message?: string }
  return candidate.code === 'email_exists'
    || candidate.code === 'user_already_exists'
    || (candidate.status === 422 && /already|registered|exists/i.test(candidate.message || ''))
}

async function startOwnerSession(account: ProvisionedAccount, email: string, pin: string) {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: deriveSupabasePassword(email, pin),
  })
  if (error || !data.user) {
    throw new RegistrationError(
      'This registration is already complete. Sign in with the PIN used when the workspace was created.',
      409,
      'REGISTRATION_ALREADY_COMPLETED',
    )
  }
  if (data.user.id !== account.authUserId) {
    throw new Error('Authenticated identity does not match the provisioned owner')
  }

  const session: AppSession = {
    type: 'tenant',
    authUserId: data.user.id,
    staffId: account.staffId,
    role: 'owner',
    tenantId: account.tenantId,
    locationId: account.locationId,
    shiftId: null,
    authVersion: account.authVersion,
  }
  await setSessionDisplayCookies(session, {
    staffName: account.ownerName,
    tenantName: account.tenantName,
    locationName: account.locationName,
  })
}

export async function POST(req: Request) {
  let client: PoolClient | null = null
  let inTransaction = false
  let committed = false
  let createdAuthUserId: string | null = null

  try {
    const data = await req.json().catch(() => {
      throw new RegistrationError('Registration details must be valid JSON.')
    })
    const requestId = textField(data.request_id)
    const businessName = textField(data.business_name)
    const ownerName = textField(data.owner_name)
    const locationName = textField(data.location_name)
    const phone = textField(data.phone)
    const email = textField(data.email).toLocaleLowerCase()
    const address = textField(data.address)
    const tier = textField(data.tier)
    const pin = data.pin
    const confirmPin = data.confirm_pin

    if (!isUuid(requestId)) throw new RegistrationError('Restart registration to create a valid secure request.')
    if (businessName.length < 2 || businessName.length > 160) throw new RegistrationError('Enter a valid business name.')
    if (ownerName.length < 2 || ownerName.length > 120) throw new RegistrationError('Enter the account owner’s full name.')
    if (locationName.length < 2 || locationName.length > 120) throw new RegistrationError('Enter a valid first store name.')
    if (address.length < 5 || address.length > 300) throw new RegistrationError('Enter a valid physical store address.')
    const phoneDigits = phone.replace(/\D/g, '')
    if (phoneDigits.length < 9 || phoneDigits.length > 15) throw new RegistrationError('Enter a valid business phone number.')
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new RegistrationError('Enter a valid owner email.')
    if (!tier || tier.length > 64) throw new RegistrationError('Choose an available subscription plan.')
    if (!validPin(pin)) throw new RegistrationError('Choose a 4-digit PIN.')
    if (pin !== confirmPin) throw new RegistrationError('PIN confirmation does not match.')

    const pinHash = await hashPin(pin)
    client = await adminPool.connect()
    await client.query('BEGIN')
    inTransaction = true

    // Request and email locks make retries and simultaneous submissions resolve
    // to one tenant, one store, and one owner identity.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`registration:${requestId}`])
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [email])

    const replay = await client.query(`
      SELECT onboarding.tenant_id, tenant.name AS tenant_name,
             staff.id AS staff_id, staff.name AS owner_name,
             staff.email, staff.auth_user_id, staff.auth_version,
             location.id AS location_id, location.name AS location_name
      FROM onboarding_sessions AS onboarding
      JOIN tenants AS tenant ON tenant.id = onboarding.tenant_id
      JOIN staff ON staff.tenant_id = tenant.id AND staff.role = 'owner'
      JOIN locations AS location
        ON location.tenant_id = tenant.id AND location.id = staff.location_id
      WHERE onboarding.registration_request_id = $1
      ORDER BY staff.created_at ASC
      LIMIT 1
      FOR UPDATE OF onboarding
    `, [requestId])

    let account: ProvisionedAccount
    let replayed = false

    if (replay.rowCount === 1) {
      const row = replay.rows[0]
      if (String(row.email).toLocaleLowerCase() !== email) {
        throw new RegistrationError('This secure registration request is already linked to another owner.', 409)
      }
      if (!row.auth_user_id) throw new Error('Provisioned owner is missing an authentication identity')
      account = {
        tenantId: row.tenant_id,
        tenantName: row.tenant_name,
        locationId: row.location_id,
        locationName: row.location_name,
        staffId: row.staff_id,
        ownerName: row.owner_name,
        authUserId: row.auth_user_id,
        authVersion: Number(row.auth_version || 0),
      }
      replayed = true
    } else {
      const existingIdentity = await client.query(`
        SELECT 1
        FROM (
          SELECT email FROM staff WHERE LOWER(BTRIM(email)) = $1
          UNION ALL
          SELECT email FROM platform_admins WHERE LOWER(BTRIM(email)) = $1
        ) identities
        LIMIT 1
      `, [email])
      if ((existingIdentity.rowCount ?? 0) > 0) {
        throw new RegistrationError(
          'An account already exists for this email. Sign in instead of creating another store.',
          409,
          'EMAIL_ALREADY_REGISTERED',
        )
      }

      const planResult = await client.query(`
        SELECT id, code, max_locations
        FROM subscription_plans
        WHERE code = $1 AND is_active = TRUE
        FOR SHARE
      `, [tier])
      if (planResult.rowCount !== 1) {
        throw new RegistrationError('The selected subscription plan is no longer available. Choose another plan.', 422)
      }
      const plan = planResult.rows[0]

      try {
        const authUser = await createSupabaseIdentity(email, pin)
        createdAuthUserId = authUser.id
      } catch (error) {
        if (isAuthIdentityConflict(error)) {
          throw new RegistrationError('An account already exists for this email. Sign in instead.', 409, 'EMAIL_ALREADY_REGISTERED')
        }
        throw error
      }

      const tenantResult = await client.query(`
        INSERT INTO tenants (name, subscription_tier, subscription_plan_id, status, max_locations)
        VALUES ($1, $2, $3, 'TRIAL', $4)
        RETURNING id
      `, [businessName, plan.code, plan.id, plan.max_locations])
      const tenantId = tenantResult.rows[0].id

      const locationResult = await client.query(`
        INSERT INTO locations (tenant_id, name, address)
        VALUES ($1, $2, $3)
        RETURNING id, name
      `, [tenantId, locationName, address])
      const location = locationResult.rows[0]

      const staffResult = await client.query(`
        INSERT INTO staff (tenant_id, auth_user_id, name, email, role, pin_hash, location_id)
        VALUES ($1, $2, $3, $4, 'owner', $5, $6)
        RETURNING id, auth_version
      `, [tenantId, createdAuthUserId, ownerName, email, pinHash, location.id])
      const staff = staffResult.rows[0]

      await client.query(`
        INSERT INTO tenant_settings (
          tenant_id, business_name, owner_email, owner_phone, currency, tax_rate,
          receipt_footer, zra_enabled, updated_at
        ) VALUES ($1, $2, $3, $4, 'ZMW', 16, $5, false, NOW())
      `, [tenantId, businessName, email, phone, `Thank you for shopping at ${businessName}!`])

      await client.query(`
        INSERT INTO onboarding_sessions (
          tenant_id, registration_request_id, current_step, trial_start_date, trial_end_date,
          onboarding_type, business_profile_completed, location_created, staff_created,
          products_loaded, first_stock_received, hardware_paired, first_sale_completed,
          converted_to_paid, go_live_approved
        ) VALUES ($1, $2, 1, CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP + ($3 * INTERVAL '1 day'), 'SELF_SERVICE',
          true, true, true, false, false, false, false, false, false)
      `, [tenantId, requestId, REGISTRATION_TRIAL_DAYS])

      await client.query(`
        INSERT INTO onboarding_events (tenant_id, event_type, step_number)
        VALUES ($1, 'SELF_SERVICE_REGISTRATION_COMPLETED', 1)
      `, [tenantId])

      await client.query(`
        INSERT INTO billing_events (
          tenant_id, event_type, old_tier, new_tier, amount, currency, status, due_at, metadata
        ) VALUES ($1, 'TRIAL_STARTED', NULL, $2, 0, 'ZMW', 'POSTED',
          CURRENT_TIMESTAMP + ($3 * INTERVAL '1 day'), $4)
      `, [tenantId, plan.code, REGISTRATION_TRIAL_DAYS, JSON.stringify({
        trial_days: REGISTRATION_TRIAL_DAYS,
        source: 'public_registration',
        registration_request_id: requestId,
      })])

      account = {
        tenantId,
        tenantName: businessName,
        locationId: location.id,
        locationName: location.name,
        staffId: staff.id,
        ownerName,
        authUserId: createdAuthUserId,
        authVersion: Number(staff.auth_version || 0),
      }
    }

    await client.query('COMMIT')
    inTransaction = false
    committed = true
    client.release()
    client = null

    await startOwnerSession(account, email, pin)

    if (!replayed) {
      import('@/lib/email').then(({ sendWelcomeEmail }) => {
        sendWelcomeEmail(email, ownerName).catch(console.error)
      })
    }

    return NextResponse.json({
      success: true,
      tenantId: account.tenantId,
      redirect: '/setup',
      replayed,
    }, { status: replayed ? 200 : 201 })
  } catch (error) {
    if (inTransaction && client) await client.query('ROLLBACK').catch(() => undefined)
    if (!committed && createdAuthUserId) await deleteSupabaseIdentity(createdAuthUserId).catch(console.error)

    if (error instanceof RegistrationError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
      return NextResponse.json({ error: 'Those registration details are already in use. Sign in or restart registration.' }, { status: 409 })
    }

    console.error('Self-Serve Registration Error:', error)
    return NextResponse.json({
      error: 'Our system encountered a problem while provisioning your store. Your existing records were not mixed with another workspace. Please try again.',
    }, { status: 500 })
  } finally {
    client?.release()
  }
}
