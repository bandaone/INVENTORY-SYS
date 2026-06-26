import { fetchTenantQuery } from '@/lib/db';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

function getTenantId() {
  const t = cookies().get('tenant_id')?.value;
  if (!t) throw new Error('Unauthorized');
  return t;
}

// GET all staff for this tenant
export async function GET() {
  try {
    const tenantId = getTenantId();
    const rows = await fetchTenantQuery(tenantId, `
      SELECT s.id, s.name, s.email, s.role, s.is_active,
             l.name as location_name
      FROM staff s
      LEFT JOIN locations l ON s.location_id = l.id
      ORDER BY s.created_at ASC
    `);
    return NextResponse.json(rows);
  } catch (err: any) {
    if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('[Staff GET]', err);
    return NextResponse.json({ error: 'Failed to load staff' }, { status: 500 });
  }
}

// POST: create staff member
export async function POST(req: Request) {
  try {
    const tenantId = getTenantId();
    const { name, email, role, pin, location_id } = await req.json();

    if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    if (!role)         return NextResponse.json({ error: 'Role is required' }, { status: 400 });
    if (!pin || !/^\d{4}$/.test(pin)) return NextResponse.json({ error: 'PIN must be exactly 4 digits' }, { status: 400 });
    if (!['owner','store_manager','cashier','stock_clerk'].includes(role))
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });

    const rows = await fetchTenantQuery(tenantId, `
      INSERT INTO staff (tenant_id, name, email, role, pin_hash, location_id, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, true)
      RETURNING id, name, email, role, is_active
    `, [tenantId, name.trim(), email?.trim() || null, role, pin, location_id || null]);

    return NextResponse.json({ success: true, staff: rows[0] });
  } catch (err: any) {
    if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (err.code === '23505') return NextResponse.json({ error: 'A staff member with this email already exists in this store' }, { status: 409 });
    console.error('[Staff POST]', err);
    return NextResponse.json({ error: 'Failed to create staff member' }, { status: 500 });
  }
}

// PATCH: update a staff member
export async function PATCH(req: Request) {
  try {
    const tenantId = getTenantId();
    const body = await req.json();
    const { id, name, email, role, pin, is_active, location_id } = body;

    if (!id) return NextResponse.json({ error: 'Staff ID is required' }, { status: 400 });

    // Build parameterized SET clauses safely
    const setClauses: string[] = [];
    const params: any[] = [];

    const add = (col: string, val: any) => {
      params.push(val);
      setClauses.push(`${col} = $${params.length}`);
    };

    if (name        !== undefined) add('name',        name.trim());
    if (email       !== undefined) add('email',       email?.trim() || null);
    if (role        !== undefined) add('role',        role);
    if (pin         !== undefined && pin !== '') {
      if (!/^\d{4}$/.test(pin)) return NextResponse.json({ error: 'PIN must be exactly 4 digits' }, { status: 400 });
      add('pin_hash', pin);
    }
    if (is_active   !== undefined) add('is_active',   is_active);
    if (location_id !== undefined) add('location_id', location_id || null);

    if (setClauses.length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

    setClauses.push('updated_at = NOW()');
    params.push(id); // last param = the staff id

    const rows = await fetchTenantQuery(tenantId, `
      UPDATE staff
      SET ${setClauses.join(', ')}
      WHERE id = $${params.length}
      RETURNING id, name, email, role, is_active
    `, params);

    if (!rows.length) return NextResponse.json({ error: 'Staff member not found or access denied' }, { status: 404 });
    return NextResponse.json({ success: true, staff: rows[0] });
  } catch (err: any) {
    if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('[Staff PATCH]', err);
    return NextResponse.json({ error: 'Failed to update staff member' }, { status: 500 });
  }
}

// DELETE: soft-deactivate
export async function DELETE(req: Request) {
  try {
    const tenantId = getTenantId();
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: 'Staff ID required' }, { status: 400 });

    await fetchTenantQuery(tenantId, `
      UPDATE staff SET is_active = false, updated_at = NOW() WHERE id = $1
    `, [id]);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('[Staff DELETE]', err);
    return NextResponse.json({ error: 'Failed to deactivate staff member' }, { status: 500 });
  }
}
