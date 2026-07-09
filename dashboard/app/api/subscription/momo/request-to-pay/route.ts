export const dynamic = "force-dynamic";
import { pool } from '@/lib/db';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

// Helper to generate a UUID v4
function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

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

    // These should be in your .env.local
    const MOMO_SUB_KEY = process.env.MTN_MOMO_SUBSCRIPTION_KEY || 'sandbox';
    const MOMO_API_USER = process.env.MTN_MOMO_API_USER || 'sandbox';
    const MOMO_API_KEY = process.env.MTN_MOMO_API_KEY || 'sandbox';
    const MOMO_ENV = process.env.MTN_MOMO_ENVIRONMENT || 'sandbox';

    // 1. Generate an Access Token
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
    const referenceId = uuidv4(); // Unique transaction reference for MTN

    // 2. Send RequestToPay (Pushes USSD to client's phone)
    if (MOMO_SUB_KEY !== 'sandbox') {
      const payRes = await fetch(`https://${MOMO_ENV === 'sandbox' ? 'sandbox.momodeveloper.mtn.com' : 'momodeveloper.mtn.com'}/collection/v1_0/requesttopay`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'X-Reference-Id': referenceId,
          'X-Target-Environment': MOMO_ENV,
          'Ocp-Apim-Subscription-Key': MOMO_SUB_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          amount: amount.toString(),
          // Sandbox only accepts EUR. Live Zambia uses ZMW.
          currency: MOMO_ENV === 'sandbox' ? 'EUR' : 'ZMW',
          externalId: `ROS-${tenantId}-${Date.now()}`,
          payer: {
            partyIdType: 'MSISDN',
            partyId: phoneNumber // e.g. 26096XXXXXXX
          },
          payerMessage: 'Retail OS Subscription',
          payeeNote: 'Thank you for using Retail OS'
        })
      });

      if (!payRes.ok && payRes.status !== 202) {
        throw new Error('MTN API rejected the payment request');
      }
    }

    // 3. Record PENDING transaction in our database
    await pool.query(`
      INSERT INTO billing_history 
      (tenant_id, event_type, amount, currency, status, reference_id)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [tenantId, 'subscription_payment', amount, 'ZMW', 'PENDING', referenceId]);

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
