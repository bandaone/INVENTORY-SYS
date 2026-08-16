export const dynamic = "force-dynamic";
import { fetchTenantQuery } from '@/lib/db';
import { hashPin, validPin } from '@/lib/pin';
import { requireTenantSession, SessionError } from '@/lib/session';
import { IdentityConflictError, withIdentityEmailLock } from '@/lib/identity-lock';
import { createSupabaseIdentity, deleteSupabaseIdentity, updateSupabaseIdentity } from '@/lib/supabase/identity';
import { NextResponse } from 'next/server';

const ADMIN_ROLES = ['owner', 'store_manager'] as const;

async function assertLocation(tenantId: string, locationId?: string | null) {
  if (!locationId) throw new SessionError('A store location is required for every user', 400);
  const locations = await fetchTenantQuery(tenantId, 'SELECT id FROM locations WHERE id = $1 AND tenant_id = $2 AND is_active = true', [locationId, tenantId]);
  if (!locations.length) throw new SessionError('Location does not belong to this tenant', 400);
}

// GET all staff for this tenant
export async function GET() {
  try {
    const session = await requireTenantSession(ADMIN_ROLES);
    const tenantId = session.tenantId;
    const locationId = session.role === 'owner' ? null : session.locationId;
    const rows = await fetchTenantQuery(tenantId, `
      SELECT s.id, s.name, s.email, s.role, s.is_active, s.location_id,
             l.name as location_name
      FROM staff s
      LEFT JOIN locations l ON s.location_id = l.id AND l.tenant_id = s.tenant_id
      WHERE ($1::uuid IS NULL OR s.location_id = $1)
      ORDER BY s.created_at ASC
    `, [locationId]);
    return NextResponse.json(rows);
  } catch (err: any) {
    if (err instanceof SessionError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[Staff GET]', err);
    return NextResponse.json({ error: 'Failed to load staff' }, { status: 500 });
  }
}

// POST: create staff member
export async function POST(req: Request) {
  let createdAuthUserId: string | null = null;
  try {
    const { tenantId } = await requireTenantSession(['owner']);
    const { name, email, role, pin, location_id } = await req.json();

    if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    if (!role)         return NextResponse.json({ error: 'Role is required' }, { status: 400 });
    if (!validPin(pin)) return NextResponse.json({ error: 'PIN must be exactly 4 digits' }, { status: 400 });
    if (!['owner','store_manager','cashier','stock_clerk'].includes(role))
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    if (!location_id) {
      return NextResponse.json({ error: 'Every user must be assigned to a store location' }, { status: 400 });
    }

    const normalizedEmail = email?.trim()?.toLocaleLowerCase() || null;
    if (!normalizedEmail || normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return NextResponse.json({ error: 'A valid email is required for staff login' }, { status: 400 });
    }
    await assertLocation(tenantId, location_id);
    const pinHash = await hashPin(pin);

    const result = await withIdentityEmailLock(normalizedEmail, {}, async (client) => {
      const authUser = await createSupabaseIdentity(normalizedEmail, pin);
      createdAuthUserId = authUser.id;
      return client.query(`
        INSERT INTO staff (tenant_id, auth_user_id, name, email, role, pin_hash, location_id, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, $7, true)
        RETURNING id, name, email, role, is_active
      `, [tenantId, authUser.id, name.trim(), normalizedEmail, role, pinHash, location_id || null]);
    });

    return NextResponse.json({ success: true, staff: result.rows[0] });
  } catch (err: any) {
    if (createdAuthUserId) await deleteSupabaseIdentity(createdAuthUserId).catch(console.error);
    if (err instanceof SessionError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof IdentityConflictError) return NextResponse.json({ error: err.message }, { status: 409 });
    if (err.code === '23505') return NextResponse.json({ error: 'A staff member with this email already exists in this store' }, { status: 409 });
    if (err.code === '23514') return NextResponse.json({ error: err.message }, { status: 403 });
    console.error('[Staff POST]', err);
    return NextResponse.json({ error: 'Failed to create staff member' }, { status: 500 });
  }
}

// PATCH: update a staff member
export async function PATCH(req: Request) {
  try {
    const session = await requireTenantSession(['owner']);
    const tenantId = session.tenantId;
    const body = await req.json();
    const { id, name, email, role, pin, is_active, location_id } = body;

    if (!id) return NextResponse.json({ error: 'Staff ID is required' }, { status: 400 });
    if (is_active !== undefined && typeof is_active !== 'boolean') {
      return NextResponse.json({ error: 'Invalid active status' }, { status: 400 });
    }
    if (id === session.staffId && role !== undefined && role !== 'owner') {
      return NextResponse.json({ error: 'You cannot remove your own owner role' }, { status: 400 });
    }
    if (id === session.staffId && is_active === false) {
      return NextResponse.json({ error: 'You cannot deactivate your own account' }, { status: 400 });
    }

    const existingRows = await fetchTenantQuery(tenantId, `
      SELECT role, location_id, email, auth_user_id, is_active
      FROM staff
      WHERE id = $1 AND tenant_id = $2
      LIMIT 1
    `, [id, tenantId]);
    if (!existingRows.length) {
      return NextResponse.json({ error: 'Staff member not found or access denied' }, { status: 404 });
    }
    const nextRole = role === undefined ? existingRows[0].role : role;
    const nextLocationId = location_id === undefined
      ? existingRows[0].location_id
      : (location_id || null);
    const nextEmail = email === undefined
      ? String(existingRows[0].email).toLocaleLowerCase()
      : String(email).trim().toLocaleLowerCase();
    if (!nextLocationId) {
      return NextResponse.json({ error: 'Every user must be assigned to a store location' }, { status: 400 });
    }
    const assignmentChanges = nextLocationId !== existingRows[0].location_id;
    const deactivating = is_active === false && existingRows[0].is_active;
    if (assignmentChanges || deactivating) {
      const openShift = await fetchTenantQuery(tenantId, `
        SELECT id FROM shifts
        WHERE tenant_id = $1 AND staff_id = $2 AND ended_at IS NULL
        LIMIT 1
      `, [tenantId, id]);
      if (openShift.length) {
        return NextResponse.json({
          error: 'This staff member has an open shift. Ask them to sign out before changing their store assignment or deactivating the account.',
        }, { status: 409 });
      }
    }

    // Build parameterized SET clauses safely
    const setClauses: string[] = [];
    const params: any[] = [];
    let normalizedEmailForLock: string | null = null;

    const add = (col: string, val: any) => {
      params.push(val);
      setClauses.push(`${col} = $${params.length}`);
    };

    if (name        !== undefined) add('name',        name.trim());
    if (email !== undefined) {
      const normalizedEmail = email?.trim()?.toLocaleLowerCase() || null;
      if (!normalizedEmail || normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return NextResponse.json({ error: 'A valid email is required for staff login' }, { status: 400 });
      }
      normalizedEmailForLock = normalizedEmail;
      add('email', normalizedEmail);
    }
    if (role !== undefined) {
      if (!['owner','store_manager','cashier','stock_clerk'].includes(role)) {
        return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
      }
      add('role', role);
    }
    if (pin         !== undefined && pin !== '') {
      if (!validPin(pin)) return NextResponse.json({ error: 'PIN must be exactly 4 digits' }, { status: 400 });
      add('pin_hash', await hashPin(pin));
      setClauses.push(
        'failed_login_attempts = 0',
        'lockout_until = NULL'
      );
    }
    if (is_active   !== undefined) add('is_active',   is_active);
    if (location_id !== undefined) {
      await assertLocation(tenantId, location_id);
      add('location_id', location_id || null);
    }

    if (email !== undefined || role !== undefined || pin || is_active !== undefined || location_id !== undefined) {
      setClauses.push('auth_version = auth_version + 1');
    }

    if (setClauses.length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

    setClauses.push('updated_at = NOW()');
    params.push(id); // last param = the staff id
    params.push(tenantId);

    const result = await withIdentityEmailLock(
      normalizedEmailForLock,
      { excludeStaffId: id },
      async (client) => {
        const updated = await client.query(`
        UPDATE staff
        SET ${setClauses.join(', ')}
        WHERE id = $${params.length - 1} AND tenant_id = $${params.length}
        RETURNING id, name, email, role, is_active
      `, params);
        if (existingRows[0].auth_user_id && (email !== undefined || (pin !== undefined && pin !== ''))) {
          await updateSupabaseIdentity(existingRows[0].auth_user_id, {
            email: nextEmail,
            pin: pin || undefined,
          });
        }
        return updated;
      }
    );

    if (!result.rows.length) return NextResponse.json({ error: 'Staff member not found or access denied' }, { status: 404 });
    return NextResponse.json({ success: true, staff: result.rows[0] });
  } catch (err: any) {
    if (err instanceof SessionError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof IdentityConflictError) return NextResponse.json({ error: err.message }, { status: 409 });
    if (err.code === '23514') return NextResponse.json({ error: err.message }, { status: 403 });
    console.error('[Staff PATCH]', err);
    return NextResponse.json({ error: 'Failed to update staff member' }, { status: 500 });
  }
}

// DELETE: soft-deactivate
export async function DELETE(req: Request) {
  try {
    const session = await requireTenantSession(['owner']);
    const tenantId = session.tenantId;
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: 'Staff ID required' }, { status: 400 });
    if (id === session.staffId) return NextResponse.json({ error: 'You cannot deactivate your own account' }, { status: 400 });

    const openShift = await fetchTenantQuery(tenantId, `
      SELECT id FROM shifts
      WHERE tenant_id = $1 AND staff_id = $2 AND ended_at IS NULL
      LIMIT 1
    `, [tenantId, id]);
    if (openShift.length) {
      return NextResponse.json({ error: 'This staff member has an open shift and must sign out before deactivation.' }, { status: 409 });
    }

    await fetchTenantQuery(tenantId, `
      UPDATE staff
      SET is_active = false, auth_version = auth_version + 1, updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2
    `, [id, tenantId]);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    if (err instanceof SessionError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[Staff DELETE]', err);
    return NextResponse.json({ error: 'Failed to deactivate staff member' }, { status: 500 });
  }
}
