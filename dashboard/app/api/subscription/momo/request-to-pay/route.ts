export const dynamic = "force-dynamic";
import { connectTenantClient, fetchTenantQuery } from '@/lib/db';
import { NextResponse } from 'next/server';
import { requireTenantSession, SessionError } from '@/lib/session';

// Helper to generate a UUID v4
import crypto from 'crypto';

export async function POST(req: Request) {
  try {
    const { tenantId } = await requireTenantSession(['owner'], { allowSuspended: true });
    const { phoneNumber, amount } = await req.json();
    const numericAmount = Number(amount);
    const normalizedPhone = String(phoneNumber || '').replace(/[\s()-]/g, '');
    if (!/^\+?\d{10,15}$/.test(normalizedPhone) || !Number.isFinite(numericAmount)) {
      return NextResponse.json({ error: 'Invalid phone number or amount' }, { status: 400 });
    }

    const locationCountRows = await fetchTenantQuery(tenantId, `
      SELECT GREATEST(COUNT(*)::integer, 1) AS location_count
      FROM locations
      WHERE tenant_id = $1 AND is_active = true
    `, [tenantId]);
    const expectedAmount = Number(locationCountRows[0]?.location_count || 1) * 2500;
    if (numericAmount !== expectedAmount) {
      return NextResponse.json({ error: 'The payment amount no longer matches your active stores. Refresh and try again.' }, { status: 409 });
    }

    const MOMO_SUB_KEY = process.env.MTN_MOMO_SUBSCRIPTION_KEY || 'sandbox';
    const MOMO_API_USER = process.env.MTN_MOMO_API_USER || 'sandbox';
    const MOMO_API_KEY = process.env.MTN_MOMO_API_KEY || 'sandbox';
    const MOMO_ENV = process.env.MTN_MOMO_ENVIRONMENT || 'sandbox';
    if (process.env.NODE_ENV === 'production' && (
      MOMO_SUB_KEY === 'sandbox' || MOMO_API_USER === 'sandbox' || MOMO_API_KEY === 'sandbox' || MOMO_ENV === 'sandbox'
    )) {
      return NextResponse.json({ error: 'Payment provider is not configured for production' }, { status: 503 });
    }
    // Get the base URL from env or use localhost in dev
    const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const referenceId = crypto.randomUUID();
    const currency = MOMO_ENV === 'sandbox' ? 'EUR' : 'ZMW';

    // Serialize payment creation per tenant so two clicks/requests cannot both
    // observe an empty pending set and generate duplicate provider prompts.
    const billingClient = await connectTenantClient();
    try {
      await billingClient.query('BEGIN');
      await billingClient.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
      await billingClient.query(
        `SELECT pg_advisory_xact_lock(hashtextextended('momo-payment:' || $1::text, 0))`,
        [tenantId]
      );
      const existingReq = await billingClient.query(`
        SELECT reference_id FROM billing_history
        WHERE tenant_id = $1 AND status = 'PENDING'
          AND created_at > NOW() - INTERVAL '10 minutes'
        ORDER BY created_at DESC LIMIT 1
      `, [tenantId]);
      if ((existingReq.rowCount ?? 0) > 0) {
        await billingClient.query('COMMIT');
        return NextResponse.json({
          success: true,
          message: 'Resuming existing payment session',
          referenceId: existingReq.rows[0].reference_id,
        });
      }
      await billingClient.query(`
        INSERT INTO billing_history
          (tenant_id, event_type, amount, currency, status, reference_id, payer_msisdn)
        VALUES ($1, 'subscription_payment', $2, $3, 'PENDING', $4, $5)
      `, [tenantId, expectedAmount, currency, referenceId, normalizedPhone]);
      await billingClient.query('COMMIT');
    } catch (error) {
      await billingClient.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      billingClient.release();
    }

    const authString = Buffer.from(`${MOMO_API_USER}:${MOMO_API_KEY}`).toString('base64');
    let tokenRes;
    try {
      if (MOMO_SUB_KEY !== 'sandbox') {
        tokenRes = await fetch(`https://${MOMO_ENV === 'sandbox' ? 'sandbox.momodeveloper.mtn.com' : 'momodeveloper.mtn.com'}/collection/token/`, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${authString}`,
            'Ocp-Apim-Subscription-Key': MOMO_SUB_KEY
          },
          signal: AbortSignal.timeout(10_000),
        });
        if (!tokenRes.ok) throw new Error('Failed to authenticate with MTN');
      }
    } catch (providerError) {
      await fetchTenantQuery(
        tenantId,
        `UPDATE billing_history SET status = 'FAILED', updated_at = NOW()
         WHERE reference_id = $1 AND tenant_id = $2 AND status = 'PENDING'`,
        [referenceId, tenantId]
      ).catch(() => undefined);
      throw providerError;
    }

    const tokenData = tokenRes ? await tokenRes.json() : { access_token: 'sandbox-token' };
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

      let payRes: Response;
      try {
        payRes = await fetch(`https://${MOMO_ENV === 'sandbox' ? 'sandbox.momodeveloper.mtn.com' : 'momodeveloper.mtn.com'}/collection/v1_0/requesttopay`, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({
            amount: expectedAmount.toString(),
            currency: currency,
            externalId: `ROS-${tenantId}-${Date.now()}`,
            payer: {
              partyIdType: 'MSISDN',
              partyId: normalizedPhone.replace(/^\+/, '')
            },
            payerMessage: 'Retail OS Subscription',
            payeeNote: 'Thank you for using Retail OS'
          }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch (providerError) {
        await fetchTenantQuery(
          tenantId,
          `UPDATE billing_history SET status = 'FAILED', updated_at = NOW()
           WHERE reference_id = $1 AND tenant_id = $2 AND status = 'PENDING'`,
          [referenceId, tenantId]
        ).catch(() => undefined);
        throw providerError;
      }

      if (!payRes.ok && payRes.status !== 202) {
        // If MTN rejects, mark as FAILED
        await fetchTenantQuery(
          tenantId,
          `UPDATE billing_history SET status = 'FAILED', updated_at = NOW()
           WHERE reference_id = $1 AND tenant_id = $2`,
          [referenceId, tenantId]
        );
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
    if (error instanceof SessionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('MTN MoMo Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
