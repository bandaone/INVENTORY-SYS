import { NextResponse } from 'next/server';
import { adminPool } from '@/lib/db';
import { sendSubscriptionReceiptEmail } from '@/lib/email';
import { requireTenantSession, SessionError } from '@/lib/session';

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { referenceId: string } }) {
  try {
    const session = await requireTenantSession(['owner'], { allowSuspended: true });
    const referenceId = params.referenceId;
    if (!referenceId || referenceId.length > 200) return NextResponse.json({ error: 'Invalid referenceId' }, { status: 400 });

    const client = await adminPool.connect();
    let billingRecord;
    
    try {
      const dbRes = await client.query(
        `SELECT status, amount, currency, payer_msisdn
         FROM billing_history WHERE reference_id = $1 AND tenant_id = $2`,
        [referenceId, session.tenantId]
      );
      if (dbRes.rowCount === 0) {
        return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
      }
      billingRecord = dbRes.rows[0];
    } finally {
      client.release();
    }

    // 1. If our DB already says it's resolved (via Webhook), return immediately without calling MTN
    if (billingRecord.status === 'SUCCESSFUL' || billingRecord.status === 'FAILED') {
      return NextResponse.json({ status: billingRecord.status });
    }

    // 2. If it's still PENDING in our DB, we do a fallback check directly with MTN
    const MOMO_SUB_KEY = process.env.MTN_MOMO_SUBSCRIPTION_KEY || 'sandbox';
    const MOMO_API_USER = process.env.MTN_MOMO_API_USER || 'sandbox';
    const MOMO_API_KEY = process.env.MTN_MOMO_API_KEY || 'sandbox';
    const MOMO_ENV = process.env.MTN_MOMO_ENVIRONMENT || 'sandbox';

    if (MOMO_SUB_KEY !== 'sandbox') {
       const authString = Buffer.from(`${MOMO_API_USER}:${MOMO_API_KEY}`).toString('base64');
       const tokenRes = await fetch(`https://${MOMO_ENV === 'sandbox' ? 'sandbox.momodeveloper.mtn.com' : 'momodeveloper.mtn.com'}/collection/token/`, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${authString}`,
            'Ocp-Apim-Subscription-Key': MOMO_SUB_KEY
          },
          signal: AbortSignal.timeout(10_000),
       });
       if (tokenRes.ok) {
          const tokenData = await tokenRes.json();
          const statusRes = await fetch(`https://${MOMO_ENV === 'sandbox' ? 'sandbox.momodeveloper.mtn.com' : 'momodeveloper.mtn.com'}/collection/v1_0/requesttopay/${referenceId}`, {
             method: 'GET',
             headers: {
               'Authorization': `Bearer ${tokenData.access_token}`,
               'X-Target-Environment': MOMO_ENV,
               'Ocp-Apim-Subscription-Key': MOMO_SUB_KEY
             },
             signal: AbortSignal.timeout(10_000),
          });

          if (statusRes.ok) {
             const statusData = await statusRes.json();
             // Valid MTN statuses: PENDING, SUCCESSFUL, FAILED
             if (statusData.status === 'SUCCESSFUL' || statusData.status === 'FAILED') {
                if (statusData.status === 'SUCCESSFUL') {
                  const paidAmount = Number(statusData.amount);
                  const paidCurrency = String(statusData.currency || '').toUpperCase();
                  if (
                    !Number.isFinite(paidAmount)
                    || paidAmount < Number(billingRecord.amount)
                    || paidCurrency !== String(billingRecord.currency || '').toUpperCase()
                  ) {
                    return NextResponse.json({ error: 'Verified payment does not match the pending invoice' }, { status: 409 });
                  }
                }

                const client = await adminPool.connect();
                let receipt: null | { email: string; record: any } = null;
                try {
                  await client.query('BEGIN');
                  const updateRes = await client.query(`
                    UPDATE billing_history
                    SET status = $1, updated_at = NOW()
                    WHERE reference_id = $2 AND tenant_id = $3 AND status = 'PENDING'
                    RETURNING *
                  `, [statusData.status, referenceId, session.tenantId]);
                  
                  if ((updateRes.rowCount ?? 0) > 0 && statusData.status === 'SUCCESSFUL') {
                    const billingRecord = updateRes.rows[0];
                    const tenantRes = await client.query(
                      `SELECT tenant.subscription_end_date, settings.owner_email
                       FROM tenants AS tenant
                       LEFT JOIN tenant_settings AS settings ON settings.tenant_id = tenant.id
                       WHERE tenant.id = $1
                       FOR UPDATE OF tenant`,
                      [session.tenantId]
                    );
                    if ((tenantRes.rowCount ?? 0) !== 1) throw new Error('Payment tenant not found');
                    let newEndDate = new Date();
                    const currentEndDate = tenantRes.rows[0].subscription_end_date ? new Date(tenantRes.rows[0].subscription_end_date) : null;
                    if (currentEndDate && currentEndDate > newEndDate) newEndDate = currentEndDate;
                    newEndDate.setDate(newEndDate.getDate() + 30);
                    await client.query(`UPDATE tenants SET status = 'ACTIVE', subscription_end_date = $1, updated_at = NOW() WHERE id = $2`, [newEndDate, session.tenantId]);

                    if (tenantRes.rows[0].owner_email) {
                      receipt = { email: tenantRes.rows[0].owner_email, record: billingRecord };
                    }
                  }
                  await client.query('COMMIT');
                } catch (dbError) {
                  await client.query('ROLLBACK').catch(() => undefined);
                  throw dbError;
                } finally {
                  client.release();
                }

                if (receipt) {
                  await sendSubscriptionReceiptEmail(receipt.email, {
                    referenceId: receipt.record.reference_id,
                    date: new Date().toISOString(),
                    amount: receipt.record.amount,
                    currency: receipt.record.currency,
                    payerMsisdn: receipt.record.payer_msisdn,
                  }).catch((emailError) => console.error('Subscription receipt email failed:', emailError));
                }
                
                return NextResponse.json({ status: statusData.status });
             }
          }
       }
    }

    return NextResponse.json({ status: 'PENDING' });

  } catch (error: any) {
    if (error instanceof SessionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('MTN Status Poll Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
