import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { fetchTenantQuery } from '@/lib/db';

class ReturnError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function getShiftContext(tenantId: string) {
  const shiftId = cookies().get('shift_id')?.value || null;
  if (!shiftId) return null;

  const rows = await fetchTenantQuery(tenantId, `
    SELECT id, staff_id, location_id, started_at
    FROM shifts
    WHERE id = $1 AND tenant_id = $2
    LIMIT 1
  `, [shiftId, tenantId]);
  return rows[0] || null;
}

export async function GET(req: Request) {
  try {
    const tenantId = cookies().get('tenant_id')?.value;
    if (!tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const receipt = searchParams.get('receipt');
    const transactionId = searchParams.get('transaction_id');

    if (!receipt && !transactionId) {
      return NextResponse.json({ error: 'receipt or transaction_id is required' }, { status: 400 });
    }

    const txRows = await fetchTenantQuery(tenantId, `
      SELECT t.id, t.receipt_number, t.total, t.subtotal, t.tax, t.payment_method, t.created_at,
             st.name as cashier_name, l.name as location_name
      FROM transactions t
      LEFT JOIN staff st ON t.cashier_id = st.id
      LEFT JOIN locations l ON t.location_id = l.id
      WHERE (${receipt ? 't.receipt_number = $1' : 't.id = $1'})
      LIMIT 1
    `, [receipt || transactionId]);

    if (!txRows.length) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });

    const tx = txRows[0];
    const items = await fetchTenantQuery(tenantId, `
      SELECT
        ti.id,
        ti.garment_serial,
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
        COALESCE(SUM(ri.quantity), 0) as returned_quantity
      FROM transaction_items ti
      LEFT JOIN variants v ON ti.variant_id = v.id
      LEFT JOIN sales_return_items ri ON ri.transaction_item_id = ti.id
      WHERE ti.transaction_id = $1
      GROUP BY ti.id, v.name, v.color, v.size
      ORDER BY ti.id ASC
    `, [tx.id]);

    return NextResponse.json({
      transaction: tx,
      items: items.map((item: any) => ({
        ...item,
        returnable_quantity: Math.max(Number(item.quantity || 0) - Number(item.returned_quantity || 0), 0),
      })),
    });
  } catch (err) {
    console.error('[Returns GET]', err);
    return NextResponse.json({ error: 'Failed to lookup transaction' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const tenantId = cookies().get('tenant_id')?.value;
    const staffId = cookies().get('staff_id')?.value;
    const staffRole = cookies().get('staff_role')?.value || 'cashier';
    if (!tenantId || !staffId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const transactionId = String(body?.transaction_id || '').trim();
    const items = Array.isArray(body?.items) ? body.items : [];
    const refundMethod = String(body?.refund_method || 'CASH').toUpperCase();
    const reason = String(body?.reason || '').trim();

    if (!transactionId || !items.length) {
      return NextResponse.json({ error: 'Transaction and return items are required' }, { status: 400 });
    }
    if (!['CASH', 'MOBILE_MONEY', 'STORE_CREDIT', 'VOID'].includes(refundMethod)) {
      return NextResponse.json({ error: 'Invalid refund method' }, { status: 400 });
    }

    const shift = await getShiftContext(tenantId);

    const result = await fetchTenantQuery(tenantId, `
      SELECT t.id, t.receipt_number, t.location_id, t.cashier_id, t.created_at
      FROM transactions t
      WHERE t.id = $1 AND t.tenant_id = $2
      LIMIT 1
    `, [transactionId, tenantId]);

    if (!result.length) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }

    const transaction = result[0];
    const txItems = await fetchTenantQuery(tenantId, `
      SELECT
        ti.id,
        ti.garment_serial,
        ti.quantity,
        ti.unit_price,
        ti.discount_percent,
        ti.discount_amount,
        ti.total_price,
        COALESCE(SUM(ri.quantity), 0) as returned_quantity
      FROM transaction_items ti
      LEFT JOIN sales_return_items ri ON ri.transaction_item_id = ti.id
      WHERE ti.transaction_id = $1
      GROUP BY ti.id
    `, [transactionId]);

    const txItemMap = new Map(txItems.map((row: any) => [row.id, row]));
    const normalizedItems = items.map((item: any) => ({
      transaction_item_id: String(item?.transaction_item_id || '').trim(),
      quantity: Number(item?.quantity || 0),
    })).filter((item: any) => item.transaction_item_id && Number.isInteger(item.quantity) && item.quantity > 0);

    if (!normalizedItems.length) {
      return NextResponse.json({ error: 'No valid return items were provided' }, { status: 400 });
    }

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
      const remaining = Number(txItem.quantity || 0) - Number(txItem.returned_quantity || 0);
      if (item.quantity > remaining) {
        throw new ReturnError('Return quantity exceeds what remains on the receipt.', 400);
      }

      const unitPrice = Number(txItem.unit_price || 0) - Number(txItem.discount_amount || 0);
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

    const returnRows = await fetchTenantQuery(tenantId, `
      INSERT INTO sales_returns (
        tenant_id, shift_id, transaction_id, cashier_id, location_id, refund_method, reason, refund_total
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING id
    `, [
      tenantId,
      shift?.id || null,
      transactionId,
      staffId,
      transaction.location_id,
      refundMethod,
      reason || null,
      refundTotal,
    ]);

    const returnId = returnRows[0].id;

    for (const item of returnItemPayload) {
      await fetchTenantQuery(tenantId, `
        INSERT INTO sales_return_items (
          return_id, transaction_item_id, garment_serial, quantity, unit_price, refund_amount, restocked
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7)
      `, [returnId, item.transaction_item_id, item.garment_serial, item.quantity, item.unit_price, item.refund_amount, item.restocked]);

      if (item.garment_serial && item.restocked) {
        await fetchTenantQuery(tenantId, `
          UPDATE garments
          SET status = 'in_stock', location_id = $2, updated_at = NOW()
          WHERE serial = $1
        `, [item.garment_serial, transaction.location_id]);
      }

      if (item.garment_serial && item.restocked) {
        await fetchTenantQuery(tenantId, `
          INSERT INTO stock_movements (
            tenant_id, garment_serial, movement_type, from_location_id, to_location_id, from_status, to_status, actor_id, notes
          )
          VALUES ($1,$2,'ADJUSTMENT',$3,$4,'sold','in_stock',$5,$6)
        `, [
          tenantId,
          item.garment_serial,
          transaction.location_id,
          transaction.location_id,
          staffId,
          `Return processed against ${transaction.receipt_number}`,
        ]);
      }
    }

    await fetchTenantQuery(tenantId, `
      INSERT INTO audit_trail (
        tenant_id, action_type, actor_id, actor_role, resource_type, resource_id, changes
      )
      VALUES ($1, 'SALE_RETURNED', $2, $3, 'transaction', $4, $5)
    `, [
      tenantId,
      staffId,
      staffRole,
      transactionId,
      JSON.stringify({
        receipt_number: transaction.receipt_number,
        refund_total: refundTotal,
        refund_method: refundMethod,
        reason,
      }),
    ]);

    return NextResponse.json({
      success: true,
      return_id: returnId,
      refund_total: refundTotal,
    });
  } catch (err) {
    if (err instanceof ReturnError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[Returns POST]', err);
    return NextResponse.json({ error: 'Failed to process return' }, { status: 500 });
  }
}
