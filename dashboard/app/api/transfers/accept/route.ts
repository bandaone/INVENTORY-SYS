export const dynamic = "force-dynamic";
import { connectTenantClient } from '@/lib/db';
import { NextResponse } from 'next/server';
import type { PoolClient } from 'pg';
import crypto from 'crypto';
import { requireTenantSession, SessionError } from '@/lib/session';

const TRANSFER_ROLES = ['owner', 'store_manager', 'stock_clerk'] as const;

export async function POST(req: Request) {
  let client: PoolClient | null = null;
  let inTransaction = false;

  try {
    const session = await requireTenantSession(TRANSFER_ROLES);
    const tenantId = session.tenantId;
    const staffId = session.staffId;
    const staffRole = session.role;
    const { location_id, serials } = await req.json();

    if (!location_id) return NextResponse.json({ error: 'Destination location is required' }, { status: 400 });
    if (!Array.isArray(serials) || serials.length === 0) {
      return NextResponse.json({ error: 'Select at least one serial to accept' }, { status: 400 });
    }

    const normalizedSerials = Array.from(
      new Set(serials.map((serial: string) => String(serial).trim().toUpperCase()).filter(Boolean))
    );
    if (normalizedSerials.length === 0) {
      return NextResponse.json({ error: 'Select at least one valid serial' }, { status: 400 });
    }

    client = await connectTenantClient();
    await client.query('BEGIN');
    inTransaction = true;
    await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

    const actor = await client.query(
      `SELECT id, location_id FROM staff
       WHERE id = $1 AND tenant_id = $2 AND role = $3 AND is_active = true`,
      [staffId, tenantId, staffRole]
    );
    if (actor.rowCount !== 1) throw new SessionError('Operations session is no longer active');
    if (staffRole !== 'owner' && actor.rows[0].location_id !== location_id) {
      await client.query('ROLLBACK');
      inTransaction = false;
      return NextResponse.json({ error: 'You can only accept stock into your assigned store' }, { status: 403 });
    }

    const locationRes = await client.query(
      'SELECT id, name FROM locations WHERE id = $1 AND tenant_id = $2 AND is_active = true',
      [location_id, tenantId]
    );
    if (locationRes.rowCount === 0) {
      if (inTransaction) await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Destination location is invalid' }, { status: 400 });
    }

    const accepted: Array<{ serial: string }> = [];

    for (const serial of normalizedSerials) {
      const garmentRes = await client.query(
        `SELECT serial, location_id, status
         FROM garments
         WHERE tenant_id = $1 AND serial = $2
         FOR UPDATE`,
        [tenantId, serial]
      );

      if (garmentRes.rowCount === 0) {
        if (inTransaction) await client.query('ROLLBACK');
        return NextResponse.json({ error: `Serial not found: ${serial}` }, { status: 404 });
      }

      const garment = garmentRes.rows[0];
      if (garment.location_id !== location_id) {
        if (inTransaction) await client.query('ROLLBACK');
        return NextResponse.json({ error: `Serial ${serial} is not at the selected destination.` }, { status: 400 });
      }

      if (garment.status !== 'transferred') {
        if (inTransaction) await client.query('ROLLBACK');
        return NextResponse.json({ error: `Serial ${serial} is not waiting for acceptance.` }, { status: 400 });
      }

      await client.query(
        `UPDATE garments
         SET status = 'in_stock',
             updated_at = NOW()
         WHERE tenant_id = $1 AND serial = $2`,
        [tenantId, serial]
      );

      await client.query(
        `INSERT INTO stock_movements (
           tenant_id, garment_serial, movement_type, from_location_id, to_location_id,
           from_status, to_status, actor_id, device_id, sequence_number, notes
         )
         VALUES ($1, $2, 'INGESTION', $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          tenantId,
          serial,
          null,
          location_id,
          'transferred',
          'in_stock',
          staffId,
          null,
          null,
          `Accepted transfer into active stock at ${locationRes.rows[0].name}.`,
        ]
      );

      accepted.push({ serial });
    }

    const batchId = crypto.randomUUID();
    await client.query(
      `INSERT INTO audit_trail (
         tenant_id, action_type, actor_id, actor_role, resource_type, resource_id, changes
       )
       VALUES ($1, 'TRANSFER_ACCEPTED', $2, $3, 'transfer_batch', $4, $5)`,
      [
        tenantId,
        staffId,
        staffRole,
        batchId,
        JSON.stringify({
          count: accepted.length,
          serials: accepted.map(item => item.serial),
          location_id,
          destination_status: 'in_stock',
        }),
      ]
    );

    await client.query('COMMIT');
    inTransaction = false;

    return NextResponse.json({
      success: true,
      count: accepted.length,
      batch_id: batchId,
      location_id,
      destination_status: 'in_stock',
    });
  } catch (error) {
    if (inTransaction && client) {
      await client.query('ROLLBACK');
    }
    if (error instanceof SessionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[Transfers Accept Error]', error);
    return NextResponse.json({ error: 'Failed to accept transfer stock' }, { status: 500 });
  } finally {
    client?.release();
  }
}
