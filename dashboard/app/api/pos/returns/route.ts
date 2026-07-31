export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { connectTenantClient, fetchTenantQuery } from '@/lib/db';
import { requireTenantSession, SessionError } from '@/lib/session';

const RETURN_ROLES = ['owner', 'store_manager', 'cashier'] as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class ReturnError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function requireActiveReturnSession() {
  const session = await requireTenantSession(RETURN_ROLES);
  const staffRows = await fetchTenantQuery(session.tenantId, `
    SELECT id, role, location_id
    FROM staff
    WHERE id = $1
      AND tenant_id = $2
      AND is_active = true
    LIMIT 1
  `, [session.staffId, session.tenantId]);
  const staff = staffRows[0];

  if (!staff || staff.role !== session.role) {
    throw new SessionError('Session is no longer valid');
  }

  const currentLocationId = staff.location_id || null;
  if (currentLocationId !== session.locationId) {
    throw new SessionError('Session location has changed. Please sign in again.');
  }
    if (session.role !== 'owner' && !session.locationId) {
    throw new SessionError('Your account has no store location assigned.', 403);
  }

  return session;
}

async function getShiftContext(
  tenantId: string,
  staffId: string,
  shiftId: string | null,
  locationId: string | null,
) {
  if (!shiftId) {
    throw new SessionError('An active shift is required to process a return.', 403);
  }

  const rows = await fetchTenantQuery(tenantId, `
    SELECT id, staff_id, location_id, started_at
    FROM shifts
    WHERE id = $1
      AND tenant_id = $2
      AND staff_id = $3
      AND location_id IS NOT DISTINCT FROM $4::uuid
      AND ended_at IS NULL
    LIMIT 1
  `, [shiftId, tenantId, staffId, locationId]);
  if (!rows.length) {
    throw new SessionError('Your shift is no longer active. Please sign in again.');
  }
  return rows[0];
}

export async function GET(req: Request) {
  try {
    const session = await requireActiveReturnSession();
    const tenantId = session.tenantId;
    await getShiftContext(tenantId, session.staffId, session.shiftId, session.locationId);

    const { searchParams } = new URL(req.url);
    const receipt = searchParams.get('receipt')?.trim() || '';
    const transactionId = searchParams.get('transaction_id')?.trim() || '';

    if (!receipt && !transactionId) {
      return NextResponse.json({ error: 'receipt or transaction_id is required' }, { status: 400 });
    }
    if (!receipt && !UUID_PATTERN.test(transactionId)) {
      return NextResponse.json({ error: 'Invalid transaction ID' }, { status: 400 });
    }

    const txRows = await fetchTenantQuery(tenantId, `
      SELECT t.id, t.receipt_number, t.location_id, t.total, t.subtotal, t.tax, t.payment_method, t.created_at,
             st.name as cashier_name, l.name as location_name
      FROM transactions t
      LEFT JOIN staff st ON t.cashier_id = st.id AND st.tenant_id = t.tenant_id
      JOIN locations l ON t.location_id = l.id AND l.tenant_id = t.tenant_id
      WHERE (${receipt ? 't.receipt_number = $1' : 't.id = $1'})
        AND t.tenant_id = $2
        AND ($3::uuid IS NULL OR t.location_id = $3::uuid)
      LIMIT 1
    `, [receipt || transactionId, tenantId, session.role !== 'owner' ? session.locationId : null]);

    if (!txRows.length) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });

    const tx = txRows[0];
    const items = await fetchTenantQuery(tenantId, `
      SELECT
        ti.id,
        g.serial AS garment_serial,
        ti.variant_id,
        ti.description,
        ti.quantity,
        ti.unit_price,
        ti.discount_percent,
        ti.discount_amount,
        ti.total_price,
        v.name as variant_name,
        v.color,
        v.size,
        COALESCE(SUM(CASE WHEN sr.id IS NOT NULL THEN ri.quantity ELSE 0 END), 0) as returned_quantity
      FROM transaction_items ti
      JOIN transactions t ON t.id = ti.transaction_id AND t.tenant_id = $2
      LEFT JOIN garments g ON g.serial = ti.garment_serial AND g.tenant_id = t.tenant_id
      LEFT JOIN variants v ON ti.variant_id = v.id AND v.tenant_id = t.tenant_id
      LEFT JOIN sales_return_items ri ON ri.transaction_item_id = ti.id
      LEFT JOIN sales_returns sr ON sr.id = ri.return_id AND sr.tenant_id = t.tenant_id
      WHERE ti.transaction_id = $1
      GROUP BY ti.id, g.serial, v.name, v.color, v.size
      ORDER BY ti.id ASC
    `, [tx.id, tenantId]);

    return NextResponse.json({
      transaction: tx,
      items: items.map((item: any) => ({
        ...item,
        returnable_quantity: Math.max(Number(item.quantity || 0) - Number(item.returned_quantity || 0), 0),
      })),
    });
  } catch (err) {
    if (err instanceof SessionError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[Returns GET]', err);
    return NextResponse.json({ error: 'Failed to lookup transaction' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireActiveReturnSession();
    const tenantId = session.tenantId;
    const staffId = session.staffId;
    const staffRole = session.role;

    const body = await req.json();
    const transactionId = String(body?.transaction_id || '').trim();
    const items = Array.isArray(body?.items) ? body.items : [];
    const refundMethod = String(body?.refund_method || 'CASH').toUpperCase();
    const reason = String(body?.reason || '').trim();

    if (!transactionId || !items.length) {
      return NextResponse.json({ error: 'Transaction and return items are required' }, { status: 400 });
    }
    if (!UUID_PATTERN.test(transactionId)) {
      return NextResponse.json({ error: 'Invalid transaction ID' }, { status: 400 });
    }
    if (!['CASH', 'MOBILE_MONEY', 'STORE_CREDIT', 'VOID'].includes(refundMethod)) {
      return NextResponse.json({ error: 'Invalid refund method' }, { status: 400 });
    }

    if (!session.shiftId) throw new SessionError('An active shift is required to process a return.', 403);

    const requestedQuantities = new Map<string, number>();
    for (const item of items) {
      const itemId = String(item?.transaction_item_id || '').trim();
      const quantity = Number(item?.quantity || 0);
      if (!UUID_PATTERN.test(itemId) || !Number.isInteger(quantity) || quantity <= 0) continue;
      requestedQuantities.set(itemId, (requestedQuantities.get(itemId) || 0) + quantity);
    }
    const normalizedItems = Array.from(requestedQuantities, ([transaction_item_id, quantity]) => ({
      transaction_item_id,
      quantity,
    }));
    if (!normalizedItems.length) {
      return NextResponse.json({ error: 'No valid return items were provided' }, { status: 400 });
    }

    const client = await connectTenantClient();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

      const shift = await client.query(`
        SELECT id FROM shifts
        WHERE id = $1 AND tenant_id = $2 AND staff_id = $3
          AND location_id IS NOT DISTINCT FROM $4::uuid AND ended_at IS NULL
        LIMIT 1
        FOR UPDATE
      `, [session.shiftId, tenantId, staffId, session.locationId]);
      if ((shift.rowCount ?? 0) !== 1) throw new SessionError('Your shift is no longer active. Please sign in again.');

      const result = await client.query(`
        SELECT t.id, t.receipt_number, t.location_id, t.cashier_id, t.created_at
        FROM transactions t
        JOIN locations l ON l.id = t.location_id AND l.tenant_id = t.tenant_id
        WHERE t.id = $1 AND t.tenant_id = $2
          AND ($3::uuid IS NULL OR t.location_id = $3::uuid)
        LIMIT 1
        FOR UPDATE OF t
      `, [transactionId, tenantId, session.role !== 'owner' ? session.locationId : null]);
      if ((result.rowCount ?? 0) !== 1) throw new ReturnError('Transaction not found', 404);
      const transaction = result.rows[0];

      const txItems = await client.query(`
        SELECT
          ti.id,
          g.serial AS garment_serial,
          ti.garment_serial AS recorded_garment_serial,
          ti.quantity,
          ti.unit_price,
          ti.discount_amount,
          COALESCE((
            SELECT SUM(ri.quantity)
            FROM sales_return_items ri
            JOIN sales_returns sr ON sr.id = ri.return_id
            WHERE ri.transaction_item_id = ti.id AND sr.tenant_id = t.tenant_id
          ), 0) AS returned_quantity
        FROM transaction_items ti
        JOIN transactions t ON t.id = ti.transaction_id AND t.tenant_id = $2
        LEFT JOIN garments g ON g.serial = ti.garment_serial AND g.tenant_id = t.tenant_id
        WHERE ti.transaction_id = $1 AND ti.id = ANY($3::uuid[])
        FOR UPDATE OF ti
      `, [transactionId, tenantId, normalizedItems.map((item) => item.transaction_item_id)]);
      const txItemMap = new Map(txItems.rows.map((row: any) => [row.id, row]));

      let refundTotal = 0;
      const returnItemPayload: Array<{
        transaction_item_id: string;
        garment_serial: string | null;
        quantity: number;
        unit_price: number;
        refund_amount: number;
        restocked: boolean;
      }> = [];

      for (const item of normalizedItems) {
        const txItem = txItemMap.get(item.transaction_item_id);
        if (!txItem) throw new ReturnError('One of the selected items is invalid.', 400);
        if (txItem.recorded_garment_serial && !txItem.garment_serial) {
          throw new ReturnError('One of the selected items is not linked to this store.', 400);
        }
        const remaining = Number(txItem.quantity || 0) - Number(txItem.returned_quantity || 0);
        if (item.quantity > remaining) throw new ReturnError('Return quantity exceeds what remains on the receipt.', 400);

        // POS stores unit_price after discount; do not subtract it a second time.
        const unitPrice = Number(txItem.unit_price || 0);
        const refundAmount = unitPrice * item.quantity;
        refundTotal += refundAmount;
        returnItemPayload.push({
          transaction_item_id: txItem.id,
          garment_serial: txItem.garment_serial || null,
          quantity: item.quantity,
          unit_price: unitPrice,
          refund_amount: refundAmount,
          restocked: Boolean(txItem.garment_serial),
        });
      }

      const createdReturn = await client.query(`
        INSERT INTO sales_returns (
          tenant_id, shift_id, transaction_id, cashier_id, location_id, refund_method, reason, refund_total
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING id
      `, [tenantId, shift.rows[0].id, transactionId, staffId, transaction.location_id, refundMethod, reason || null, refundTotal]);
      const returnId = createdReturn.rows[0].id;

      for (const item of returnItemPayload) {
        await client.query(`
          INSERT INTO sales_return_items (
            return_id, transaction_item_id, garment_serial, quantity, unit_price, refund_amount, restocked
          ) VALUES ($1,$2,$3,$4,$5,$6,$7)
        `, [returnId, item.transaction_item_id, item.garment_serial, item.quantity, item.unit_price, item.refund_amount, item.restocked]);

        if (item.garment_serial && item.restocked) {
          const restocked = await client.query(`
            UPDATE garments
            SET status = 'in_stock', location_id = $2, updated_at = NOW()
            WHERE serial = $1 AND tenant_id = $3 AND status = 'sold'
          `, [item.garment_serial, transaction.location_id, tenantId]);
          if (restocked.rowCount !== 1) throw new ReturnError('An item could not be safely restocked.', 409);

          await client.query(`
            INSERT INTO stock_movements (
              tenant_id, garment_serial, movement_type, from_location_id, to_location_id,
              from_status, to_status, actor_id, notes
            ) VALUES ($1,$2,'ADJUSTMENT',$3,$4,'sold','in_stock',$5,$6)
          `, [tenantId, item.garment_serial, transaction.location_id, transaction.location_id, staffId,
            `Return processed against ${transaction.receipt_number}`]);
        }
      }

      await client.query(`
        INSERT INTO audit_trail (
          tenant_id, action_type, actor_id, actor_role, resource_type, resource_id, changes
        ) VALUES ($1, 'SALE_RETURNED', $2, $3, 'transaction', $4, $5)
      `, [tenantId, staffId, staffRole, transactionId, JSON.stringify({
        receipt_number: transaction.receipt_number,
        refund_total: refundTotal,
        refund_method: refundMethod,
        reason,
      })]);

      await client.query('COMMIT');
      return NextResponse.json({ success: true, return_id: returnId, refund_total: refundTotal });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (err) {
    if (err instanceof SessionError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof ReturnError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[Returns POST]', err);
    return NextResponse.json({ error: 'Failed to process return' }, { status: 500 });
  }
}
