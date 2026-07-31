export const dynamic = "force-dynamic";
import { adminPool } from '@/lib/db';
import { NextResponse } from 'next/server';
import { requirePlatformSession, SessionError } from '@/lib/session';

export async function POST(req: Request) {
  const client = await adminPool.connect();
  try {
    await requirePlatformSession();
    const { name, tier, location } = await req.json();
    if (!String(name || '').trim() || !String(location || '').trim()) {
      return NextResponse.json({ error: 'Tenant name and location are required' }, { status: 400 });
    }
    if (!['boutique_starter', 'growth', 'enterprise_fleet'].includes(tier)) {
      return NextResponse.json({ error: 'Invalid subscription tier' }, { status: 400 });
    }

    await client.query('BEGIN');

    // 1. Insert Tenant
    const tenantRes = await client.query(`
      INSERT INTO tenants (name, subscription_tier, status, max_locations)
      VALUES ($1, $2, 'TRIAL', $3)
      RETURNING id
    `, [name, tier, tier === 'enterprise_fleet' ? 20 : tier === 'growth' ? 5 : 1]);

    const tenantId = tenantRes.rows[0].id;

    // 2. Insert Default Location for the tenant
    await client.query(`
      INSERT INTO locations (tenant_id, name)
      VALUES ($1, $2)
    `, [tenantId, location]);

    await client.query(`
      INSERT INTO tenant_settings (
        tenant_id, business_name, owner_email, owner_phone, currency, tax_rate, receipt_footer, zra_enabled, updated_at
      )
      VALUES ($1, $2, NULL, NULL, 'ZMW', 16, 'Thank you for your business.', false, NOW())
      ON CONFLICT (tenant_id) DO UPDATE SET
        business_name = EXCLUDED.business_name,
        updated_at = NOW()
    `, [tenantId, name]);

    await client.query(`
      INSERT INTO onboarding_sessions (
        tenant_id, current_step, trial_start_date, trial_end_date,
        onboarding_type, business_profile_completed, location_created, staff_created,
        products_loaded, first_stock_received, hardware_paired, first_sale_completed,
        converted_to_paid, go_live_approved
      )
      VALUES ($1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '14 days',
        'PLATFORM_ASSISTED', true, true, false,
        false, false, false, false,
        false, false)
    `, [tenantId]);

    await client.query(`
      INSERT INTO onboarding_events (tenant_id, event_type, step_number)
      VALUES ($1, 'PLATFORM_ONBOARDING_STARTED', 1)
    `, [tenantId]);

    await client.query(`
      INSERT INTO billing_events (
        tenant_id, event_type, old_tier, new_tier, amount, currency, status, due_at, metadata
      )
      VALUES ($1, 'TRIAL_STARTED', NULL, $2, 0, 'ZMW', 'POSTED', CURRENT_TIMESTAMP + INTERVAL '14 days', $3)
    `, [tenantId, tier, JSON.stringify({ source: 'superadmin_onboard' })]);

    await client.query('COMMIT');
    return NextResponse.json({ success: true, tenantId });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (error instanceof SessionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Onboarding Error:", error);
    return NextResponse.json({ error: "Failed to onboard tenant" }, { status: 500 });
  } finally {
    client.release();
  }
}
