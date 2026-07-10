export const dynamic = "force-dynamic";
import { pool } from '@/lib/db';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

// Helper to generate a UUID v4
import crypto from 'crypto';

export async function POST(req: Request) {
  try {
    const { phoneNumber, amount } = await req.json();
    if (!phoneNumber || !amount) {
      return NextResponse.json({ error: 'Missing phone number or amount' }, { status: 400 });
    }

    const cookieStore = cookies();
    const tenantId = cookieStore.get('tenant_id')?.value;
    if (!tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Idempotency Check (Layer 1) - If there's already a PENDING request in the last 10 minutes, return it
    const existingReq = await pool.query(`
      SELECT reference_id FROM billing_history 
      WHERE tenant_id = $1 AND status = 'PENDING' AND created_at > NOW() - INTERVAL '10 minutes'
      ORDER BY created_at DESC LIMIT 1
    `, [tenantId]);

    if (existingReq.rowCount && existingReq.rowCount > 0) {
      return NextResponse.json({ 
        success: true, 
        message: 'Resuming existing payment session',
        referenceId: existingReq.rows[0].reference_id 
      });
    }

    const MOMO_SUB_KEY = process.env.MTN_MOMO_SUBSCRIPTION_KEY || 'sandbox';
    const MOMO_API_USER = process.env.MTN_MOMO_API_USER || 'sandbox';
    const MOMO_API_KEY = process.env.MTN_MOMO_API_KEY || 'sandbox';
    const MOMO_ENV = process.env.MTN_MOMO_ENVIRONMENT || 'sandbox';
    // Get the base URL from env or use localhost in dev
    const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

    const authString = Buffer.from(`${MOMO_API_USER}:${MOMO_API_KEY}`).toString('base64');
    let tokenRes;
    
    if (MOMO_SUB_KEY !== 'sandbox') {
      tokenRes = await fetch(`https://${MOMO_ENV === 'sandbox' ? 'sandbox.momodeveloper.mtn.com' : 'momodeveloper.mtn.com'}/collection/token/`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${authString}`,
          'Ocp-Apim-Subscription-Key': MOMO_SUB_KEY
        }
      });
      if (!tokenRes.ok) throw new Error('Failed to authenticate with MTN');
    }

    const tokenData = tokenRes ? await tokenRes.json() : { access_token: 'sandbox-token' };
    const referenceId = crypto.randomUUID(); // Unique transaction reference

    // Store PENDING transaction in our database BEFORE calling MTN (Idempotency Layer 2)
    // We do this first so that if the MTN call succeeds but our DB fails, we don't have a ghost payment.
    const currency = MOMO_ENV === 'sandbox' ? 'EUR' : 'ZMW';
    await pool.query(`
      INSERT INTO billing_history 
      (tenant_id, event_type, amount, currency, status, reference_id, payer_msisdn)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (reference_id) DO NOTHING
    `, [tenantId, 'subscription_payment', amount, currency, 'PENDING', referenceId, phoneNumber]);

    // Send RequestToPay (Pushes USSD to client's phone)
    if (MOMO_SUB_KEY !== 'sandbox') {
      const headers: any = {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'X-Reference-Id': referenceId,
        'X-Target-Environment': MOMO_ENV,
        'Ocp-Apim-Subscription-Key': MOMO_SUB_KEY,
        'Content-Type': 'application/json'
      };

      // MTN strictly validates the callback host against what was registered during API user creation.
      // We only send it in production (non-sandbox and non-localhost) to prevent INVALID_CALLBACK_URL_HOST errors.
      // For local testing/sandbox, the frontend polling fallback handles status checking.
      if (MOMO_ENV !== 'sandbox' && !BASE_URL.includes('localhost')) {
         headers['X-Callback-Url'] = `${BASE_URL}/api/subscription/momo/callback`;
      }

      const payRes = await fetch(`https://${MOMO_ENV === 'sandbox' ? 'sandbox.momodeveloper.mtn.com' : 'momodeveloper.mtn.com'}/collection/v1_0/requesttopay`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          amount: MOMO_ENV === 'sandbox' ? '5.0' : amount.toString(),
          currency: currency,
          externalId: `ROS-${tenantId}-${Date.now()}`,
          payer: {
            partyIdType: 'MSISDN',
            partyId: phoneNumber 
          },
          payerMessage: 'Retail OS Subscription',
          payeeNote: 'Thank you for using Retail OS'
        })
      });

      if (!payRes.ok && payRes.status !== 202) {
        // If MTN rejects, mark as FAILED
        await pool.query(`UPDATE billing_history SET status = 'FAILED' WHERE reference_id = $1`, [referenceId]);
        const errorText = await payRes.text().catch(() => 'No response body');
        console.error('MTN API Rejection body:', errorText);
        throw new Error(`MTN API rejected the payment request: ${payRes.status} - ${errorText}`);
      }
    }

    return NextResponse.json({ 
      success: true, 
      message: 'USSD Prompt sent to phone',
      referenceId 
    });

  } catch (error: any) {
    console.error('MTN MoMo Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
