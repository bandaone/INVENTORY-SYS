export const dynamic = "force-dynamic";
import { adminPool } from '@/lib/db';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST(req: Request) {
  const client = await adminPool.connect();
  try {
    const data = await req.json();
    const { business_name, owner_name, phone, email, address, tier } = data;

    if (!email || !owner_name || !business_name) {
      return NextResponse.json({ error: 'Business name, owner name and email are required.' }, { status: 400 });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    // --- IDEMPOTENCY CHECK ---
    // If this email is already registered as an owner, just log them back in
    // instead of creating a duplicate tenant. This handles retries and back-button replays.
    const existingStaff = await client.query(`
      SELECT s.id as staff_id, s.name as staff_name, s.tenant_id, t.name as tenant_name,
             o.go_live_approved
      FROM staff s
      JOIN tenants t ON s.tenant_id = t.id
      LEFT JOIN onboarding_sessions o ON o.tenant_id = t.id
      WHERE s.email = $1 AND s.role = 'owner' AND s.is_active = true
      LIMIT 1
    `, [normalizedEmail]);

    if (existingStaff.rows.length > 0) {
      // Owner already exists — resume their session
      const existing = existingStaff.rows[0];
      const redirectTo = existing.go_live_approved ? '/' : '/setup';

      const cookieOptions = {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax' as const,
        maxAge: 60 * 60 * 24 * 7,
      };
      const cookieStore = cookies();
      cookieStore.set('tenant_id', existing.tenant_id, cookieOptions);
      cookieStore.set('staff_id', existing.staff_id, cookieOptions);
      cookieStore.set('tenant_name', existing.tenant_name, cookieOptions);
      cookieStore.set('staff_name', existing.staff_name, cookieOptions);
      cookieStore.set('staff_role', 'owner', { ...cookieOptions, httpOnly: false });

      return NextResponse.json({
        success: true,
        resumed: true,
        tenantId: existing.tenant_id,
        redirect: redirectTo,
      });
    }

    // --- NEW TENANT CREATION (wrapped in a transaction) ---
    // If ANY step fails, the entire registration is rolled back.
    // The user can safely retry without creating partial/duplicate records.
    await client.query('BEGIN');

    let max_locations = 1;
    if (tier === 'growth') max_locations = 5;
    if (tier === 'enterprise_fleet') max_locations = 9999;

    // 1. Create Tenant
    const tenantRes = await client.query(`
      INSERT INTO tenants (name, subscription_tier, status, max_locations)
      VALUES ($1, $2, 'TRIAL', $3)
      RETURNING id
    `, [business_name.trim(), tier, max_locations]);
    const tenantId = tenantRes.rows[0].id;

    // 2. Create Initial Location (single insert)
    await client.query(`
      INSERT INTO locations (tenant_id, name, address)
      VALUES ($1, 'Main Store', $2)
    `, [tenantId, address?.trim() || '']);

    // 3. Create Owner Staff Record, RETURNING the ID for the session cookie
    const staffRes = await client.query(`
      INSERT INTO staff (tenant_id, name, email, role, pin_hash)
      VALUES ($1, $2, $3, 'owner', '1234')
      RETURNING id
    `, [tenantId, owner_name.trim(), normalizedEmail]);
    const staffId = staffRes.rows[0].id;

    // 4. Create Tenant Settings
    await client.query(`
      INSERT INTO tenant_settings (
        tenant_id, business_name, owner_email, owner_phone, currency, tax_rate, receipt_footer, zra_enabled, updated_at
      ) VALUES ($1, $2, $3, $4, 'ZMW', 16, $5, false, NOW())
    `, [tenantId, business_name.trim(), normalizedEmail, phone?.trim() || '', `Thank you for shopping at ${business_name.trim()}!`]);

    // 5. Create Onboarding Session
    await client.query(`
      INSERT INTO onboarding_sessions (
        tenant_id, current_step, trial_start_date, trial_end_date,
        onboarding_type, business_profile_completed, location_created, staff_created,
        products_loaded, first_stock_received, hardware_paired, first_sale_completed,
        converted_to_paid, go_live_approved
      ) VALUES ($1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '7 days',
        'SELF_SERVICE', true, true, true,
        false, false, false, false, false, false)
    `, [tenantId]);

    // 6. Log onboarding event
    await client.query(`
      INSERT INTO onboarding_events (tenant_id, event_type, step_number)
      VALUES ($1, 'SELF_SERVICE_REGISTRATION_COMPLETED', 1)
    `, [tenantId]);

    // 7. Log initial billing event (trial)
    await client.query(`
      INSERT INTO billing_events (
        tenant_id, event_type, old_tier, new_tier, amount, currency, status, due_at, metadata
      ) VALUES ($1, 'TRIAL_STARTED', NULL, $2, 0, 'ZMW', 'POSTED', CURRENT_TIMESTAMP + INTERVAL '7 days', $3)
    `, [tenantId, tier, JSON.stringify({ trial_days: 7, source: 'public_registration' })]);

    await client.query('COMMIT');

    // Set all session cookies — including staff_id — so middleware is satisfied
    const cookieOptions = {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      maxAge: 60 * 60 * 24 * 7,
    };
    const cookieStore = cookies();
    cookieStore.set('tenant_id', tenantId, cookieOptions);
    cookieStore.set('staff_id', staffId, cookieOptions);
    cookieStore.set('tenant_name', business_name.trim(), cookieOptions);
    cookieStore.set('staff_name', owner_name.trim(), cookieOptions);
    cookieStore.set('staff_role', 'owner', { ...cookieOptions, httpOnly: false });

    // Send welcome email (non-blocking)
    import('@/lib/email').then(({ sendWelcomeEmail }) => {
      sendWelcomeEmail(normalizedEmail, owner_name.trim()).catch(console.error);
    });

    return NextResponse.json({ success: true, tenantId });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Self-Serve Registration Error:', error);
    return NextResponse.json(
      { error: 'Our system encountered a problem while provisioning your store. Please try again.' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
