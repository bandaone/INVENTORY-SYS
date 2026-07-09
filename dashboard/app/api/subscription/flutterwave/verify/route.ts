export const dynamic = "force-dynamic";
import { pool } from '@/lib/db';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST(req: Request) {
  try {
    const { transaction_id } = await req.json();
    if (!transaction_id) {
      return NextResponse.json({ error: 'Missing transaction_id' }, { status: 400 });
    }

    const cookieStore = cookies();
    const tenantId = cookieStore.get('tenant_id')?.value;
    if (!tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 1. Call Flutterwave to securely verify the transaction status and amount
    const FLW_SECRET = process.env.FLUTTERWAVE_SECRET_KEY || 'FLWSECK_TEST-SANDBOXDEMOKEY-X';
    const flwRes = await fetch(`https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${FLW_SECRET}`,
        'Content-Type': 'application/json'
      }
    });

    const flwData = await flwRes.json();
    
    // Check if flutterwave says it was successful
    if (flwData.status !== 'success' || flwData.data.status !== 'successful') {
      console.error('Flutterwave verification failed:', flwData);
      return NextResponse.json({ error: 'Payment verification failed' }, { status: 400 });
    }

    const amountPaid = flwData.data.amount;
    const currency = flwData.data.currency;

    // 2. Fetch current tenant status
    const tenantRes = await pool.query('SELECT status, subscription_end_date FROM tenants WHERE id = $1', [tenantId]);
    if (tenantRes.rows.length === 0) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    // 3. Add 30 days to the subscription
    let newEndDate = new Date();
    if (tenantRes.rows[0].subscription_end_date && new Date(tenantRes.rows[0].subscription_end_date) > new Date()) {
      newEndDate = new Date(tenantRes.rows[0].subscription_end_date);
    }
    newEndDate.setDate(newEndDate.getDate() + 30);

    // 4. Record transaction in database
    await pool.query(`
      INSERT INTO billing_history 
      (tenant_id, event_type, amount, currency, status, reference_id, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      tenantId, 
      'subscription_payment', 
      amountPaid, 
      currency, 
      'paid', 
      flwData.data.tx_ref,
      JSON.stringify(flwData.data)
    ]);

    // 5. Update tenant status
    await pool.query(`
      UPDATE tenants 
      SET status = 'ACTIVE',
          subscription_end_date = $1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [newEndDate, tenantId]);

    return NextResponse.json({ success: true, newEndDate });
    
  } catch (error: any) {
    console.error('Flutterwave verification error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
