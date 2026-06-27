export const dynamic = "force-dynamic";
import { fetchQuery } from '@/lib/db';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST(req: Request) {
  try {
    const data = await req.json();
    const { business_name, owner_name, phone, email, address, tier } = data;

    let max_locations = 1;
    if (tier === 'growth') max_locations = 5;
    if (tier === 'enterprise_fleet') max_locations = 9999;

    // 1. Create Tenant (Trial Mode)
    const tenantRes = await fetchQuery(`
      INSERT INTO tenants (name, subscription_tier, status, max_locations)
      VALUES ($1, $2, 'TRIAL', $3)
      RETURNING id
    `, [business_name, tier, max_locations]);
    
    const tenantId = tenantRes[0].id;

    // 2. Create Initial Location
    await fetchQuery(`
      INSERT INTO locations (tenant_id, name, address)
      VALUES ($1, $2, $3)
    `, [tenantId, 'Main Store', address]);

    // 3. Create Owner Staff Record (with mocked 1234 PIN for testing)
    await fetchQuery(`
      INSERT INTO staff (tenant_id, name, email, role, pin_hash)
      VALUES ($1, $2, $3, 'owner', '1234')
    `, [tenantId, owner_name, email]);

    await fetchQuery(`
      INSERT INTO tenant_settings (
        tenant_id, business_name, owner_email, owner_phone, currency, tax_rate, receipt_footer, zra_enabled, updated_at
      )
      VALUES ($1, $2, $3, $4, 'ZMW', 16, 'Thank you for shopping with us.', false, NOW())
      ON CONFLICT (tenant_id) DO UPDATE SET
        business_name = EXCLUDED.business_name,
        owner_email = EXCLUDED.owner_email,
        owner_phone = EXCLUDED.owner_phone,
        updated_at = NOW()
    `, [tenantId, business_name, email, phone]);

    // 4. Create Onboarding Session Record
    await fetchQuery(`
      INSERT INTO onboarding_sessions (
        tenant_id, current_step, trial_start_date, trial_end_date,
        onboarding_type, business_profile_completed, location_created, staff_created,
        products_loaded, first_stock_received, hardware_paired, first_sale_completed,
        converted_to_paid, go_live_approved
      )
      VALUES ($1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '7 days',
        'SELF_SERVICE', true, true, true,
        false, false, false, false,
        false, false)
    `, [tenantId]);

    // 5. Log the onboarding event
    await fetchQuery(`
      INSERT INTO onboarding_events (tenant_id, event_type, step_number)
      VALUES ($1, 'SELF_SERVICE_REGISTRATION_COMPLETED', 1)
    `, [tenantId]);

    await fetchQuery(`
      INSERT INTO billing_events (
        tenant_id, event_type, old_tier, new_tier, amount, currency, status, due_at, metadata
      )
      VALUES ($1, 'TRIAL_STARTED', NULL, $2, 0, 'ZMW', 'POSTED', CURRENT_TIMESTAMP + INTERVAL '7 days', $3)
    `, [tenantId, tier, JSON.stringify({ trial_days: 7, source: 'public_registration' })]);

    // In a real system, you would call MTN/Airtel SMS gateway here to send the PIN to the 'phone'.
    // console.log(`[SMS MOCK] Sending temporary PIN '1234' to ${phone}`);

    // Set a secure mock session cookie so the dashboard knows who just logged in
    const cookieOptions = {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      maxAge: 60 * 60 * 24 * 7,
    };
    cookies().set('tenant_id', tenantId, cookieOptions);
    cookies().set('tenant_name', business_name, cookieOptions);
    cookies().set('staff_name', owner_name, cookieOptions);
    cookies().set('staff_role', 'owner', cookieOptions);

    // Send the Welcome Email (Non-blocking)
    import('@/lib/email').then(({ sendWelcomeEmail }) => {
      sendWelcomeEmail(email, owner_name).catch(console.error);
    });

    return NextResponse.json({ success: true, tenantId });
  } catch (error) {
    // Log the actual error to the server console safely, do NOT expose 'error' object to client
    console.error("Self-Serve Registration Error:", error);
    return NextResponse.json(
      { error: "Our system encountered a problem while provisioning your store. Please try again later." }, 
      { status: 500 }
    );
  }
}
