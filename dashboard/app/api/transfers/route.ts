export const dynamic = "force-dynamic";
import { adminPool } from '@/lib/db';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import crypto from 'crypto';

function getTenantId() {
  const tenantId = cookies().get('tenant_id')?.value;
  if (!tenantId) throw new Error('Unauthorized');
  return tenantId;
}

async function getActiveLocation(client: any, tenantId: string, locationId: string) {
  const result = await client.query(
    'SELECT id, name FROM locations WHERE id = $1 AND tenant_id = $2 AND is_active = true',
    [locationId, tenantId]
  );
  return result.rows[0] || null;
}

export async function GET(req: Request) {
  try {
    const tenantId = getTenantId();
    const { searchParams } = new URL(req.url);
    const kind = searchParams.get('kind') || 'source';
    const locationId = searchParams.get('location_id');

    if (!locationId) {
      return NextResponse.json({ error: 'Location is required' }, { status: 400 });
    }

    const client = await adminPool.connect();
    try {
      const location = await getActiveLocation(client, tenantId, locationId);
      if (!location) {
        return NextResponse.json({ error: 'Location not found' }, { status: 404 });
      }

      if (kind === 'incoming') {
        const items = await client.query(
          `SELECT
             g.serial,
             v.name AS product_name,
             v.color,
             v.size,
             g.status,
             g.updated_at,
             origin.name AS source_location_name,
             sm.created_at AS transferred_at,
             sm.notes AS transfer_notes
           FROM garments g
           JOIN variants v ON v.id = g.variant_id
           LEFT JOIN LATERAL (
             SELECT from_location_id, notes, created_at
             FROM stock_movements sm
             WHERE sm.tenant_id = g.tenant_id
               AND sm.garment_serial = g.serial
               AND sm.movement_type = 'TRANSFER'
             ORDER BY sm.created_at DESC
             LIMIT 1
           ) sm ON true
           LEFT JOIN locations origin ON origin.id = sm.from_location_id
           WHERE g.tenant_id = $1
             AND g.location_id = $2
             AND g.status = 'transferred'
           ORDER BY g.updated_at DESC, g.serial ASC`,
          [tenantId, locationId]
        );

        return NextResponse.json({ location, items: items.rows });
      }

      const items = await client.query(
        `SELECT
           g.serial,
           v.name AS product_name,
           v.color,
           v.size,
           g.status,
           g.updated_at
         FROM garments g
         JOIN variants v ON v.id = g.variant_id
         WHERE g.tenant_id = $1
           AND g.location_id = $2
           AND g.status = 'in_stock'
         ORDER BY v.name ASC, g.created_at DESC, g.serial ASC`,
        [tenantId, locationId]
      );

      return NextResponse.json({ location, items: items.rows });
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[Transfers GET Error]', error);
    return NextResponse.json({ error: 'Failed to load transfer stock' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const client = await adminPool.connect();
  let inTransaction = false;

  try {
    const tenantId = getTenantId();
    const staffId = cookies().get('staff_id')?.value;
    const staffRole = cookies().get('staff_role')?.value || 'stock_clerk';
    const { from_location_id, to_location_id, serials } = await req.json();

    if (!staffId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!from_location_id || !to_location_id) return NextResponse.json({ error: 'Source and destination are required' }, { status: 400 });
    if (from_location_id === to_location_id) return NextResponse.json({ error: 'Source and destination must be different' }, { status: 400 });
    if (!Array.isArray(serials) || serials.length === 0) return NextResponse.json({ error: 'Add at least one serial' }, { status: 400 });

    const normalizedSerials = Array.from(
      new Set(serials.map((serial: string) => String(serial).trim().toUpperCase()).filter(Boolean))
    );
    if (normalizedSerials.length === 0) return NextResponse.json({ error: 'Add at least one valid serial' }, { status: 400 });

    await client.query('BEGIN');
    inTransaction = true;

    const source = await getActiveLocation(client, tenantId, from_location_id);
    const destination = await getActiveLocation(client, tenantId, to_location_id);
    if (!source || !destination) {
      if (inTransaction) await client.query('ROLLBACK');
      return NextResponse.json({ error: 'One of the selected locations is invalid' }, { status: 400 });
    }

    const moved: Array<{ serial: string }> = [];

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
      if (garment.location_id !== from_location_id) {
        if (inTransaction) await client.query('ROLLBACK');
        return NextResponse.json({ error: `Serial ${serial} is not at the selected source location.` }, { status: 400 });
      }

      if (garment.status !== 'in_stock') {
        if (inTransaction) await client.query('ROLLBACK');
        return NextResponse.json({ error: `Serial ${serial} is not available for transfer.` }, { status: 400 });
      }

      await client.query(
        `UPDATE garments
         SET location_id = $1,
             status = 'transferred',
             updated_at = NOW()
         WHERE tenant_id = $2 AND serial = $3`,
        [to_location_id, tenantId, serial]
      );

      await client.query(
        `INSERT INTO stock_movements (
           tenant_id, garment_serial, movement_type, from_location_id, to_location_id,
           from_status, to_status, actor_id, device_id, sequence_number, notes
         )
         VALUES ($1, $2, 'TRANSFER', $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          tenantId,
          serial,
          from_location_id,
          to_location_id,
          'in_stock',
          'transferred',
          staffId,
          null,
          null,
          `Transferred from ${source.name} to ${destination.name}. Awaiting acceptance at destination.`,
        ]
      );

      moved.push({ serial });
    }

    const batchId = crypto.randomUUID();
    await client.query(
      `INSERT INTO audit_trail (
         tenant_id, action_type, actor_id, actor_role, resource_type, resource_id, changes
       )
       VALUES ($1, 'STOCK_TRANSFER', $2, $3, 'transfer_batch', $4, $5)`,
      [
        tenantId,
        staffId,
        staffRole,
        batchId,
        JSON.stringify({
          count: moved.length,
          serials: moved.map(item => item.serial),
          from_location_id,
          to_location_id,
          destination_status: 'transferred',
        }),
      ]
    );

    await client.query('COMMIT');
    inTransaction = false;

    return NextResponse.json({
      success: true,
      count: moved.length,
      batch_id: batchId,
      from_location_id,
      to_location_id,
      destination_status: 'transferred',
    });
  } catch (error) {
    if (inTransaction) {
      await client.query('ROLLBACK');
    }
    console.error('[Transfers POST Error]', error);
    return NextResponse.json({ error: 'Failed to transfer stock' }, { status: 500 });
  } finally {
    client.release();
  }
}
