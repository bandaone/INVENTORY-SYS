export const dynamic = 'force-dynamic'

import { adminPool, fetchTenantQuery } from '@/lib/db'
import { IdentityConflictError, withIdentityEmailLock } from '@/lib/identity-lock'
import { hashPin, validPin } from '@/lib/pin'
import { requireTenantSession, SessionError } from '@/lib/session'
import { createSupabaseIdentity, deleteSupabaseIdentity } from '@/lib/supabase/identity'
import { NextResponse } from 'next/server'
import type { PoolClient } from 'pg'

const STEP_FIELDS = {
  business: { field: 'business_profile_completed', step: 2, event: 'BUSINESS_PROFILE_COMPLETED' },
  location: { field: 'location_created', step: 3, event: 'LOCATION_CONFIRMED' },
  team: { field: 'staff_created', step: 4, event: 'STAFF_SETUP_COMPLETED' },
  catalog: { field: 'products_loaded', step: 5, event: 'PRODUCTS_LOADED' },
  payments: { field: 'hardware_paired', step: 6, event: 'PAYMENTS_PREPARED' },
  tax: { field: 'first_stock_received', step: 7, event: 'TAX_SETUP_REVIEWED' },
  launch: { field: 'go_live_approved', step: 8, event: 'GO_LIVE_APPROVED' },
} as const

type StepKey = keyof typeof STEP_FIELDS

class OnboardingInputError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
    this.name = 'OnboardingInputError'
  }
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function validEmail(value: string) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

async function markStep(client: PoolClient, tenantId: string, stepKey: StepKey) {
  const step = STEP_FIELDS[stepKey]
  const locked = await client.query(`
    SELECT COALESCE(${step.field}, false) AS completed
    FROM onboarding_sessions
    WHERE tenant_id = $1
    FOR UPDATE
  `, [tenantId])
  if (locked.rowCount !== 1) throw new Error('Onboarding session not found')

  await client.query(`
    UPDATE onboarding_sessions
    SET ${step.field} = true,
        current_step = GREATEST(COALESCE(current_step, 1), $1),
        steps_completed = CASE
          WHEN $2 = ANY(COALESCE(steps_completed, '{}'::text[])) THEN steps_completed
          ELSE array_append(COALESCE(steps_completed, '{}'::text[]), $2)
        END,
        go_live_approved_at = CASE WHEN $2 = 'launch' THEN NOW() ELSE go_live_approved_at END,
        updated_at = NOW()
    WHERE tenant_id = $3
  `, [step.step, stepKey, tenantId])

  if (!locked.rows[0].completed) {
    await client.query(`
      INSERT INTO onboarding_events (tenant_id, event_type, step_number)
      VALUES ($1, $2, $3)
    `, [tenantId, step.event, step.step])
  }
}

async function withOnboardingTransaction<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await adminPool.connect()
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

export async function GET() {
  try {
    const session = await requireTenantSession(['owner'])
    const tenantId = session.tenantId
    const [sessionRows, tenantResult, settingsRows, locationRows, staffRows, productRows, stockRows] = await Promise.all([
      fetchTenantQuery(tenantId, 'SELECT * FROM onboarding_sessions WHERE tenant_id = $1 LIMIT 1', [tenantId]),
      adminPool.query(`
        SELECT tenant.id, tenant.name, tenant.subscription_tier, tenant.status,
               tenant.zra_configured, tenant.created_at,
               plan.name AS plan_name, plan.price_zmw, plan.currency,
               plan.max_locations, plan.max_users,
               (SELECT COUNT(*)::integer FROM locations WHERE tenant_id = tenant.id AND is_active) AS active_locations,
               (SELECT COUNT(*)::integer FROM staff WHERE tenant_id = tenant.id AND is_active) AS active_users
        FROM tenants AS tenant
        JOIN subscription_plans AS plan ON plan.id = tenant.subscription_plan_id
        WHERE tenant.id = $1
      `, [tenantId]),
      fetchTenantQuery(tenantId, 'SELECT * FROM tenant_settings WHERE tenant_id = $1 LIMIT 1', [tenantId]).catch(() => []),
      fetchTenantQuery(tenantId, `SELECT id, name, address FROM locations WHERE tenant_id = $1 AND is_active ORDER BY created_at ASC LIMIT 1`, [tenantId]),
      fetchTenantQuery(tenantId, `SELECT id, name, email, role, is_active, location_id FROM staff WHERE tenant_id = $1 AND is_active ORDER BY created_at ASC`, [tenantId]),
      fetchTenantQuery(tenantId, 'SELECT COUNT(*)::int AS count FROM variants WHERE tenant_id = $1', [tenantId]),
      fetchTenantQuery(tenantId, `SELECT COUNT(*)::int AS count FROM garments WHERE tenant_id = $1 AND status = 'in_stock'`, [tenantId]),
    ])

    const tenant = tenantResult.rows[0] || null
    return NextResponse.json({
      session: sessionRows[0] || null,
      tenant: tenant ? {
        id: tenant.id,
        name: tenant.name,
        subscription_tier: tenant.subscription_tier,
        status: tenant.status,
        zra_configured: tenant.zra_configured,
        created_at: tenant.created_at,
      } : null,
      subscription: tenant ? {
        name: tenant.plan_name,
        price_zmw: Number(tenant.price_zmw),
        currency: tenant.currency,
        max_locations: Number(tenant.max_locations),
        max_users: Number(tenant.max_users),
        active_locations: Number(tenant.active_locations),
        active_users: Number(tenant.active_users),
      } : null,
      settings: settingsRows[0] || null,
      location: locationRows[0] || null,
      staff: staffRows,
      counts: {
        products: Number(productRows[0]?.count || 0),
        stock: Number(stockRows[0]?.count || 0),
      },
    })
  } catch (error) {
    if (error instanceof SessionError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[Onboarding GET]', error)
    return NextResponse.json({ error: 'Failed to load onboarding' }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  let createdAuthUserId: string | null = null
  try {
    const session = await requireTenantSession(['owner'])
    const tenantId = session.tenantId
    const body = await req.json().catch(() => {
      throw new OnboardingInputError('Setup details must be valid JSON.')
    })
    const step = String(body.step || '') as StepKey
    const payload = body.payload && typeof body.payload === 'object' ? body.payload : {}
    if (!STEP_FIELDS[step]) throw new OnboardingInputError('Invalid onboarding step.')

    if (step === 'team') {
      const name = text(payload.name)
      const email = text(payload.email).toLocaleLowerCase()
      const role = text(payload.role)
      const pin = payload.pin
      const hasTeamInput = Boolean(name || email || pin)

      if (!hasTeamInput) {
        await withOnboardingTransaction((client) => markStep(client, tenantId, step))
        return NextResponse.json({ success: true })
      }
      if (name.length < 2 || name.length > 120) throw new OnboardingInputError('Enter the team member’s full name.')
      if (!validEmail(email)) throw new OnboardingInputError('Enter a valid team member email.')
      if (!['cashier', 'stock_clerk', 'store_manager'].includes(role)) throw new OnboardingInputError('Choose a valid team role.')
      if (!validPin(pin)) throw new OnboardingInputError('Team member PIN must be exactly 4 digits.')

      const pinHash = await hashPin(pin)
      await withIdentityEmailLock(email, {}, async (client) => {
        const location = await client.query(`
          SELECT id FROM locations
          WHERE tenant_id = $1 AND is_active
          ORDER BY created_at ASC
          LIMIT 1
          FOR SHARE
        `, [tenantId])
        if (location.rowCount !== 1) throw new OnboardingInputError('Confirm the first store before adding a team member.', 409)

        const authUser = await createSupabaseIdentity(email, pin)
        createdAuthUserId = authUser.id
        await client.query(`
          INSERT INTO staff (tenant_id, auth_user_id, name, email, role, pin_hash, location_id, is_active)
          VALUES ($1, $2, $3, $4, $5, $6, $7, true)
        `, [tenantId, authUser.id, name, email, role, pinHash, location.rows[0].id])
        await markStep(client, tenantId, step)
      })
      return NextResponse.json({ success: true })
    }

    await withOnboardingTransaction(async (client) => {
      if (step === 'business') {
        const businessName = text(payload.business_name)
        const ownerEmail = text(payload.owner_email).toLocaleLowerCase()
        const ownerPhone = text(payload.owner_phone)
        const receiptFooter = text(payload.receipt_footer) || 'Thank you for shopping with us.'
        if (businessName.length < 2 || businessName.length > 160) throw new OnboardingInputError('Enter a valid business name.')
        if (!validEmail(ownerEmail)) throw new OnboardingInputError('Enter a valid business contact email.')
        if (ownerPhone && (ownerPhone.replace(/\D/g, '').length < 9 || ownerPhone.replace(/\D/g, '').length > 15)) throw new OnboardingInputError('Enter a valid business phone number.')
        if (receiptFooter.length > 300) throw new OnboardingInputError('Receipt footer must be 300 characters or fewer.')

        await client.query(`
          INSERT INTO tenant_settings (tenant_id, business_name, owner_email, owner_phone, currency, tax_rate, receipt_footer, updated_at)
          VALUES ($1, $2, $3, $4, 'ZMW', 16, $5, NOW())
          ON CONFLICT (tenant_id) DO UPDATE SET
            business_name = EXCLUDED.business_name,
            owner_email = EXCLUDED.owner_email,
            owner_phone = EXCLUDED.owner_phone,
            receipt_footer = EXCLUDED.receipt_footer,
            updated_at = NOW()
        `, [tenantId, businessName, ownerEmail, ownerPhone, receiptFooter])
        await client.query('UPDATE tenants SET name = $1, updated_at = NOW() WHERE id = $2', [businessName, tenantId])
      }

      if (step === 'location') {
        const name = text(payload.name)
        const address = text(payload.address)
        if (name.length < 2 || name.length > 120) throw new OnboardingInputError('Enter a valid store name.')
        if (address.length < 5 || address.length > 300) throw new OnboardingInputError('Enter a valid store address.')
        const existing = await client.query(`SELECT id FROM locations WHERE tenant_id = $1 AND is_active ORDER BY created_at ASC LIMIT 1 FOR UPDATE`, [tenantId])
        if (existing.rowCount === 1) {
          await client.query(`UPDATE locations SET name = $1, address = $2, updated_at = NOW() WHERE tenant_id = $3 AND id = $4`, [name, address, tenantId, existing.rows[0].id])
        } else {
          await client.query(`INSERT INTO locations (tenant_id, name, address) VALUES ($1, $2, $3)`, [tenantId, name, address])
        }
      }

      if (step === 'catalog') {
        const productName = text(payload.product_name)
        if (productName) {
          const retailPrice = Number(payload.retail_price)
          if (productName.length > 160) throw new OnboardingInputError('Product name must be 160 characters or fewer.')
          if (!Number.isFinite(retailPrice) || retailPrice <= 0) throw new OnboardingInputError('Enter a retail price greater than zero.')
          await client.query(`
            INSERT INTO variants (tenant_id, name, category, color, size, cost_price, retail_price)
            VALUES ($1, $2, $3, $4, $5, 0, $6)
            ON CONFLICT ON CONSTRAINT unique_variant DO UPDATE SET
              category = EXCLUDED.category, retail_price = EXCLUDED.retail_price, updated_at = NOW()
          `, [tenantId, productName, text(payload.category) || 'General', text(payload.color) || null, text(payload.size) || null, retailPrice])
        }
      }

      if (step === 'payments') {
        const mtnEnabled = Boolean(payload.mtn_momo_enabled)
        const airtelEnabled = Boolean(payload.airtel_enabled)
        const mtnNumber = text(payload.mtn_momo_number)
        const airtelNumber = text(payload.airtel_number)
        if (mtnEnabled && mtnNumber.replace(/\D/g, '').length < 6) throw new OnboardingInputError('Enter a valid MTN merchant wallet or till number.')
        if (airtelEnabled && airtelNumber.replace(/\D/g, '').length < 6) throw new OnboardingInputError('Enter a valid Airtel merchant wallet or till number.')
        await client.query(`
          INSERT INTO tenant_settings (
            tenant_id, business_name, currency, tax_rate, mtn_momo_enabled, mtn_momo_number,
            airtel_enabled, airtel_number, updated_at
          ) VALUES ($1, NULL, 'ZMW', 16, $2, $3, $4, $5, NOW())
          ON CONFLICT (tenant_id) DO UPDATE SET
            mtn_momo_enabled = EXCLUDED.mtn_momo_enabled,
            mtn_momo_number = EXCLUDED.mtn_momo_number,
            airtel_enabled = EXCLUDED.airtel_enabled,
            airtel_number = EXCLUDED.airtel_number,
            updated_at = NOW()
        `, [tenantId, mtnEnabled, mtnNumber || null, airtelEnabled, airtelNumber || null])
      }

      if (step === 'tax') {
        const zraEnabled = Boolean(payload.zra_enabled)
        const tpin = text(payload.zra_tpin).replace(/\s/g, '')
        if (zraEnabled && !/^\d{10}$/.test(tpin)) throw new OnboardingInputError('Enter the 10-digit company TPIN.')
        await client.query(`
          INSERT INTO tenant_settings (tenant_id, business_name, currency, tax_rate, zra_enabled, zra_tpin, updated_at)
          VALUES ($1, NULL, 'ZMW', 16, $2, $3, NOW())
          ON CONFLICT (tenant_id) DO UPDATE SET zra_enabled = EXCLUDED.zra_enabled, zra_tpin = EXCLUDED.zra_tpin, updated_at = NOW()
        `, [tenantId, zraEnabled, tpin || null])
        await client.query('UPDATE tenants SET zra_configured = $1, updated_at = NOW() WHERE id = $2', [zraEnabled, tenantId])
      }

      if (step === 'launch') {
        const required = await client.query(`
          SELECT business_profile_completed, location_created
          FROM onboarding_sessions WHERE tenant_id = $1 FOR UPDATE
        `, [tenantId])
        if (!required.rows[0]?.business_profile_completed || !required.rows[0]?.location_created) {
          throw new OnboardingInputError('Confirm the business profile and first store before launch.', 409)
        }
      }

      await markStep(client, tenantId, step)
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    if (createdAuthUserId) await deleteSupabaseIdentity(createdAuthUserId).catch(console.error)
    if (error instanceof SessionError) return NextResponse.json({ error: error.message }, { status: error.status })
    if (error instanceof OnboardingInputError) return NextResponse.json({ error: error.message }, { status: error.status })
    if (error instanceof IdentityConflictError) return NextResponse.json({ error: error.message }, { status: 409 })
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') return NextResponse.json({ error: 'A record with those details already exists.' }, { status: 409 })
    if (error && typeof error === 'object' && 'code' in error && error.code === '23514') return NextResponse.json({ error: error instanceof Error ? error.message : 'Your subscription capacity has been reached.' }, { status: 403 })
    console.error('[Onboarding PATCH]', error)
    return NextResponse.json({ error: 'Failed to save this setup step.' }, { status: 500 })
  }
}
