import { adminPool } from '@/lib/db';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import crypto from 'crypto';

function getTenantId() {
  const tenantId = cookies().get('tenant_id')?.value;
  if (!tenantId) throw new Error('Unauthorized');
  return tenantId;
}

export async function POST(req: Request) {
  const client = await adminPool.connect();
  let inTransaction = false;

  try {
    const tenantId = getTenantId();
    const staffId = cookies().get('staff_id')?.value;
    const staffRole = cookies().get('staff_role')?.value || 'stock_clerk';
    const { location_id, serials } = await req.json();

    if (!staffId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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

    await client.query('BEGIN');
    inTransaction = true;

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
    if (inTransaction) {
      await client.query('ROLLBACK');
    }
    console.error('[Transfers Accept Error]', error);
    return NextResponse.json({ error: 'Failed to accept transfer stock' }, { status: 500 });
  } finally {
    client.release();
  }
}
