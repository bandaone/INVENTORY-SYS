export const dynamic = "force-dynamic";
import { connectTenantClient } from '@/lib/db';
import { NextResponse } from 'next/server';
import type { PoolClient } from 'pg';
import crypto from 'crypto';
import { requireTenantSession, SessionError } from '@/lib/session';

const TRANSFER_ROLES = ['owner', 'store_manager', 'stock_clerk'] as const;

async function getActiveLocation(client: any, tenantId: string, locationId: string) {
  const result = await client.query(
    'SELECT id, name FROM locations WHERE id = $1 AND tenant_id = $2 AND is_active = true',
    [locationId, tenantId]
  );
  return result.rows[0] || null;
}

export async function GET(req: Request) {
  let client: PoolClient | null = null;
  try {
    const session = await requireTenantSession(TRANSFER_ROLES);
    const tenantId = session.tenantId;
    const { searchParams } = new URL(req.url);
    const kind = searchParams.get('kind') || 'source';
    const locationId = searchParams.get('location_id');

    if (!locationId) {
      return NextResponse.json({ error: 'Location is required' }, { status: 400 });
    }

    client = await connectTenantClient();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
      const location = await getActiveLocation(client, tenantId, locationId);
      if (!location) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Location not found' }, { status: 404 });
      }
      if (session.role !== 'owner' && session.locationId !== locationId) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'You can only view transfers for your assigned store' }, { status: 403 });
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
           JOIN variants v ON v.id = g.variant_id AND v.tenant_id = g.tenant_id
           LEFT JOIN LATERAL (
             SELECT from_location_id, notes, created_at
             FROM stock_movements sm
             WHERE sm.tenant_id = g.tenant_id
               AND sm.garment_serial = g.serial
               AND sm.movement_type = 'TRANSFER'
             ORDER BY sm.created_at DESC
             LIMIT 1
           ) sm ON true
           LEFT JOIN locations origin ON origin.id = sm.from_location_id AND origin.tenant_id = g.tenant_id
           WHERE g.tenant_id = $1
             AND g.location_id = $2
             AND g.status = 'transferred'
           ORDER BY g.updated_at DESC, g.serial ASC`,
          [tenantId, locationId]
        );

        await client.query('COMMIT');
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
         JOIN variants v ON v.id = g.variant_id AND v.tenant_id = g.tenant_id
         WHERE g.tenant_id = $1
           AND g.location_id = $2
           AND g.status = 'in_stock'
         ORDER BY v.name ASC, g.created_at DESC, g.serial ASC`,
        [tenantId, locationId]
      );

      await client.query('COMMIT');
      return NextResponse.json({ location, items: items.rows });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
      client = null;
    }
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => undefined);
    if (error instanceof SessionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[Transfers GET Error]', error);
    return NextResponse.json({ error: 'Failed to load transfer stock' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let client: PoolClient | null = null;
  let inTransaction = false;

  try {
    const session = await requireTenantSession(TRANSFER_ROLES);
    const tenantId = session.tenantId;
    const staffId = session.staffId;
    const staffRole = session.role;
    const { from_location_id, to_location_id, serials } = await req.json();

    if (!from_location_id || !to_location_id) return NextResponse.json({ error: 'Source and destination are required' }, { status: 400 });
    if (from_location_id === to_location_id) return NextResponse.json({ error: 'Source and destination must be different' }, { status: 400 });
    if (!Array.isArray(serials) || serials.length === 0) return NextResponse.json({ error: 'Add at least one serial' }, { status: 400 });

    const normalizedSerials = Array.from(
      new Set(serials.map((serial: string) => String(serial).trim().toUpperCase()).filter(Boolean))
    );
    if (normalizedSerials.length === 0) return NextResponse.json({ error: 'Add at least one valid serial' }, { status: 400 });

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
    if (staffRole !== 'owner' && actor.rows[0].location_id !== from_location_id) {
      await client.query('ROLLBACK');
      inTransaction = false;
      return NextResponse.json({ error: 'You can only transfer stock from your assigned store' }, { status: 403 });
    }

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
    if (inTransaction && client) {
      await client.query('ROLLBACK');
    }
    if (error instanceof SessionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[Transfers POST Error]', error);
    return NextResponse.json({ error: 'Failed to transfer stock' }, { status: 500 });
  } finally {
    client?.release();
  }
}
