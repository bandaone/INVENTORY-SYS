export const dynamic = "force-dynamic";
import { adminPool } from '@/lib/db';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requirePlatformSession, SessionError } from '@/lib/session';
import { hashPin, validPin } from '@/lib/pin';
import { IdentityConflictError, withIdentityEmailLock } from '@/lib/identity-lock';
import { updateSupabaseIdentity } from '@/lib/supabase/identity';

export async function GET() {
  try {
    const session = await requirePlatformSession();
    const currentId = session.staffId;
    const result = await adminPool.query(`
      SELECT id, name, email, is_active, created_at, updated_at
      FROM platform_admins
      WHERE id = $1
      LIMIT 1
    `, [currentId]);

    return NextResponse.json({ profile: result.rows[0] || null });
  } catch (err: any) {
    if (err instanceof SessionError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[Superadmin Profile GET]', err);
    return NextResponse.json({ error: 'Failed to load profile' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const session = await requirePlatformSession();
    const currentId = session.staffId;
    const { name, email, pin } = await req.json();

    if (!currentId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    if (!email?.trim()) return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    if (pin !== undefined && pin !== '' && !validPin(pin)) {
      return NextResponse.json({ error: 'PIN must be exactly 4 digits' }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLocaleLowerCase();
    const identity = await adminPool.query(
      'SELECT auth_user_id FROM platform_admins WHERE id = $1 LIMIT 1',
      [currentId],
    );
    if (!identity.rows[0]?.auth_user_id) {
      return NextResponse.json({ error: 'This administrator is not linked to Supabase Auth yet. Sign out and sign in before changing credentials.' }, { status: 409 });
    }
    const params: any[] = [name.trim(), normalizedEmail, currentId];
    let query = `
      UPDATE platform_admins
      SET name = $1,
          email = $2,
          updated_at = NOW()
      WHERE id = $3
    `;

    if (pin && pin.trim()) {
      params.splice(2, 0, await hashPin(pin.trim()));
      query = `
        UPDATE platform_admins
        SET name = $1,
            email = $2,
            pin_hash = $3,
            failed_login_attempts = 0,
            lockout_until = NULL,
            auth_version = auth_version + 1,
            updated_at = NOW()
        WHERE id = $4
      `;
    }

    await withIdentityEmailLock(
      normalizedEmail,
      { excludeStaffId: currentId },
      async (client) => {
        await updateSupabaseIdentity(identity.rows[0].auth_user_id, {
          email: normalizedEmail,
          pin: pin?.trim() || undefined,
        });
        return client.query(query, params);
      }
    );

    (await cookies()).set('staff_name', name.trim(), { path: '/', httpOnly: false });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    if (err instanceof SessionError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof IdentityConflictError) return NextResponse.json({ error: err.message }, { status: 409 });
    if (err.code === '23505') return NextResponse.json({ error: 'That email is already in use' }, { status: 409 });
    console.error('[Superadmin Profile PUT]', err);
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 });
  }
}
