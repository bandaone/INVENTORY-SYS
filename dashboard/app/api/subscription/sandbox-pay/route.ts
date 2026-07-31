export const dynamic = "force-dynamic";
import { adminPool } from '@/lib/db';
import { NextResponse } from 'next/server';
import { requireTenantSession, SessionError } from '@/lib/session';

export async function POST(req: Request) {
  try {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const { tenantId } = await requireTenantSession(['owner'], { allowSuspended: true });

    const { amount, method } = await req.json();

    // 1. Simulate a payment gateway delay (Sandbox experience)
    await new Promise((resolve) => setTimeout(resolve, 2500));

    // 2. Update the tenant status from TRIAL to ACTIVE
    await adminPool.query(`
      UPDATE tenants 
      SET status = 'ACTIVE', updated_at = NOW()
      WHERE id = $1
    `, [tenantId]);

    // 3. Record the Sandbox payment in the ledger
    await adminPool.query(`
      INSERT INTO billing_events (tenant_id, event_type, amount, currency, status, due_at, metadata)
      VALUES ($1, 'PAYMENT_RECEIVED', $2, 'ZMW', 'POSTED', NOW(), $3)
    `, [
      tenantId, 
      amount, 
      JSON.stringify({ 
        provider: 'sandbox', 
        method, 
        transaction_id: `SANDBOX_TX_${Math.random().toString(36).substring(2, 9).toUpperCase()}`,
        note: 'Activated via Sandbox Payment Gateway'
      })
    ]);

    return NextResponse.json({ success: true, message: 'Payment successful (Sandbox)' });

  } catch (error) {
    if (error instanceof SessionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[Sandbox Payment Error]', error);
    return NextResponse.json({ error: 'Payment simulation failed' }, { status: 500 });
  }
}
