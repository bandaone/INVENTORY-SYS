export const dynamic = "force-dynamic";
import { adminPool } from '@/lib/db';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

function requireSuperadmin() {
  const role = cookies().get('staff_role')?.value || '';
  if (role !== 'superadmin') throw new Error('Unauthorized');
}

export async function GET() {
  try {
    requireSuperadmin();
    const currentId = cookies().get('staff_id')?.value;
    const result = await adminPool.query(`
      SELECT id, name, email, is_active, created_at, updated_at
      FROM platform_admins
      WHERE id = $1
      LIMIT 1
    `, [currentId]);

    return NextResponse.json({ profile: result.rows[0] || null });
  } catch (err: any) {
    if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('[Superadmin Profile GET]', err);
    return NextResponse.json({ error: 'Failed to load profile' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    requireSuperadmin();
    const currentId = cookies().get('staff_id')?.value;
    const { name, email, pin } = await req.json();

    if (!currentId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    if (!email?.trim()) return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    if (pin !== undefined && pin !== '' && !/^\d{4}$/.test(pin)) {
      return NextResponse.json({ error: 'PIN must be exactly 4 digits' }, { status: 400 });
    }

    const params: any[] = [name.trim(), email.trim(), currentId];
    let query = `
      UPDATE platform_admins
      SET name = $1,
          email = $2,
          updated_at = NOW()
      WHERE id = $3
    `;

    if (pin && pin.trim()) {
      params.splice(2, 0, pin.trim());
      query = `
        UPDATE platform_admins
        SET name = $1,
            email = $2,
            pin_hash = $3,
            updated_at = NOW()
        WHERE id = $4
      `;
    }

    await adminPool.query(query, params);

    cookies().set('staff_name', name.trim(), { path: '/', httpOnly: false });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (err.code === '23505') return NextResponse.json({ error: 'That email is already in use' }, { status: 409 });
    console.error('[Superadmin Profile PUT]', err);
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 });
  }
}
