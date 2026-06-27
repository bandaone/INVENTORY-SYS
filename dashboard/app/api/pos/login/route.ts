export const dynamic = "force-dynamic";
import { adminPool } from '@/lib/db';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

// POST: authenticate a cashier by email + PIN (or PIN only for POS tablets)
export async function POST(req: Request) {
  try {
    const { email, pin } = await req.json();

    if (!pin || pin.length !== 4) {
      return NextResponse.json({ error: 'PIN must be 4 digits' }, { status: 400 });
    }

    // Build query — email is optional (POS tablets may use PIN-only from a pre-paired tenant)
    const tenantIdFromCookie = cookies().get('tenant_id')?.value;

    let query: string;
    let params: any[];

    if (email) {
      // Full login: email + PIN — works across tenants (for manager/owner logging in fresh)
      query = `
        SELECT s.id, s.name, s.role, s.tenant_id, t.name as tenant_name,
               l.id as default_location_id, l.name as default_location_name
        FROM staff s
        JOIN tenants t ON s.tenant_id = t.id
        LEFT JOIN locations l ON s.location_id = l.id
        WHERE s.email = $1 AND s.pin_hash = $2 AND s.is_active = true
        LIMIT 1
      `;
      params = [email, pin];
    } else if (tenantIdFromCookie) {
      // PIN-only login: device already knows the tenant (pre-paired tablet)
      query = `
        SELECT s.id, s.name, s.role, s.tenant_id, t.name as tenant_name,
               l.id as default_location_id, l.name as default_location_name
        FROM staff s
        JOIN tenants t ON s.tenant_id = t.id
        LEFT JOIN locations l ON s.location_id = l.id
        WHERE s.tenant_id = $1 AND s.pin_hash = $2 AND s.is_active = true
        AND s.role IN ('cashier', 'store_manager', 'owner')
        LIMIT 1
      `;
      params = [tenantIdFromCookie, pin];
    } else {
      return NextResponse.json({ error: 'Email is required for first login' }, { status: 400 });
    }

    const result = await adminPool.query(query, params);

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Invalid credentials or account inactive' }, { status: 401 });
    }

    const user = result.rows[0];

    // Set session cookies
    const opts = { path: '/', maxAge: 60 * 60 * 12 }; // 12-hour shift
    cookies().set('tenant_id', user.tenant_id, { ...opts, httpOnly: true });
    cookies().set('staff_id', user.id, { ...opts, httpOnly: true });
    cookies().set('staff_name', user.name, opts);
    cookies().set('staff_role', user.role, opts);
    cookies().set('tenant_name', user.tenant_name, opts);
    if (user.default_location_id) {
      cookies().set('location_id', user.default_location_id, opts);
      cookies().set('location_name', user.default_location_name, opts);
    }

    await adminPool.query(`
      INSERT INTO platform_access_events (tenant_id, staff_id, event_type, source, metadata)
      VALUES ($1, $2, 'LOGIN', 'POS', $3)
    `, [user.tenant_id, user.id, JSON.stringify({ role: user.role, email: email || null, location_id: user.default_location_id || null })]);

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        tenant_name: user.tenant_name,
        location_name: user.default_location_name,
      }
    });
  } catch (err) {
    console.error('[POS Login Error]', err);
    return NextResponse.json({ error: 'Authentication failed' }, { status: 500 });
  }
}

// DELETE: end shift / log out
export async function DELETE() {
  try {
    const tenantId = cookies().get('tenant_id')?.value;
    const staffId = cookies().get('staff_id')?.value;
    const cookieOpts = { path: '/', maxAge: 0 };
    cookies().set('staff_id', '', cookieOpts);
    cookies().set('staff_name', '', cookieOpts);
    cookies().set('staff_role', '', cookieOpts);
    cookies().set('location_id', '', cookieOpts);
    cookies().set('location_name', '', cookieOpts);
    if (tenantId && staffId) {
      await adminPool.query(`
        INSERT INTO platform_access_events (tenant_id, staff_id, event_type, source, metadata)
        VALUES ($1, $2, 'LOGOUT', 'POS', $3)
      `, [tenantId, staffId, JSON.stringify({ source: 'pos_logout' })]);
    }
    // NOTE: we keep tenant_id cookie so the tablet remembers which store it belongs to
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: 'Logout failed' }, { status: 500 });
  }
}
