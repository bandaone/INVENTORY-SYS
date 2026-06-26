import { adminPool } from '@/lib/db';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST(req: Request) {
  try {
    const { email, pin } = await req.json();

    if (!email || !pin) {
      return NextResponse.json({ error: 'Email and PIN are required' }, { status: 400 });
    }

    const adminResult = await adminPool.query(`
      SELECT id, name, email
      FROM platform_admins
      WHERE email = $1 AND pin_hash = $2 AND is_active = true
      LIMIT 1
    `, [email, pin]);

    if (adminResult.rows.length > 0) {
      const admin = adminResult.rows[0];
      const cookieStore = cookies();
      const opts = {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax' as const,
        maxAge: 60 * 60 * 12,
      };
      const publicOpts = { ...opts, httpOnly: false };

      cookieStore.set('staff_id', admin.id, opts);
      cookieStore.set('staff_role', 'superadmin', publicOpts);
      cookieStore.set('staff_name', admin.name, publicOpts);
      cookieStore.set('tenant_name', 'Retail OS HQ', publicOpts);
      cookieStore.set('tenant_id', '', { path: '/', maxAge: 0 });
      cookieStore.set('shift_id', '', { path: '/', maxAge: 0 });
      cookieStore.set('location_id', '', { path: '/', maxAge: 0 });
      cookieStore.set('location_name', '', { path: '/', maxAge: 0 });

      return NextResponse.json({
        success: true,
        redirect: '/superadmin',
        user: {
          name: admin.name,
          role: 'superadmin',
          tenant: 'Retail OS HQ',
          location: null,
        },
      });
    }

    // Cross-tenant lookup — must use adminPool, RLS would block this
    const result = await adminPool.query(`
      SELECT 
        s.id as staff_id, s.name as staff_name, s.role,
        s.tenant_id, s.location_id,
        t.name as tenant_name,
        l.name as location_name
      FROM staff s
      JOIN tenants t ON s.tenant_id = t.id
      LEFT JOIN locations l ON s.location_id = l.id
      WHERE s.email = $1 AND s.pin_hash = $2 AND s.is_active = true
      LIMIT 1
    `, [email, pin]);

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Invalid email or PIN' }, { status: 401 });
    }

    const user = result.rows[0];
    let redirectTo = '/';

    if (user.role === 'owner') {
      const onboardingResult = await adminPool.query(`
        SELECT go_live_approved, current_step
        FROM onboarding_sessions
        WHERE tenant_id = $1
        LIMIT 1
      `, [user.tenant_id]);
      const onboarding = onboardingResult.rows[0];
      redirectTo = onboarding?.go_live_approved ? '/' : '/setup';
    }

    // Record shift start in DB
    const shiftResult = await adminPool.query(`
      INSERT INTO shifts (tenant_id, staff_id, location_id)
      VALUES ($1, $2, $3)
      RETURNING id
    `, [user.tenant_id, user.staff_id, user.location_id || null]);
    const shiftId = shiftResult.rows[0].id;

    // Role → redirect destination
    const redirectMap: Record<string, string> = {
      superadmin:  '/superadmin',
      owner:         redirectTo,
      store_manager: '/operations',
      cashier:       '/pos',
      stock_clerk:   '/operations',
    };
    redirectTo = redirectMap[user.role] || redirectTo;

    // Issue httpOnly session cookies
    const opts = {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      maxAge: 60 * 60 * 12, // 12-hour shift
    };
    const publicOpts = { ...opts, httpOnly: false }; // UI-readable (non-sensitive)

    const cookieStore = cookies();
    cookieStore.set('tenant_id',     user.tenant_id,    opts);
    cookieStore.set('staff_id',      user.staff_id,     opts);
    cookieStore.set('shift_id',      shiftId,           opts);
    cookieStore.set('staff_role',    user.role,         publicOpts);
    cookieStore.set('staff_name',    user.staff_name,   publicOpts);
    cookieStore.set('tenant_name',   user.tenant_name,  publicOpts);
    if (user.location_id)   cookieStore.set('location_id',   user.location_id,   opts);
    if (user.location_name) cookieStore.set('location_name', user.location_name, publicOpts);

    await adminPool.query(`
      INSERT INTO platform_access_events (tenant_id, staff_id, event_type, source, metadata)
      VALUES ($1, $2, 'LOGIN', 'DASHBOARD', $3)
    `, [user.tenant_id, user.staff_id, JSON.stringify({ role: user.role, location_id: user.location_id || null })]);

    return NextResponse.json({ success: true, redirect: redirectTo, user: {
      name: user.staff_name,
      role: user.role,
      tenant: user.tenant_name,
      location: user.location_name,
    }});

  } catch (err) {
    console.error('[Login Error]', err);
    return NextResponse.json({ error: 'Authentication service unavailable' }, { status: 500 });
  }
}
