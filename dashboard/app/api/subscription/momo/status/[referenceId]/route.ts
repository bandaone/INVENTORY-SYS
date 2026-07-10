import { NextResponse } from 'next/server';
import { adminPool } from '@/lib/db';

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { referenceId: string } }) {
  try {
    const referenceId = params.referenceId;
    if (!referenceId) return NextResponse.json({ error: 'Missing referenceId' }, { status: 400 });

    const client = await adminPool.connect();
    let billingRecord;
    
    try {
      const dbRes = await client.query('SELECT status FROM billing_history WHERE reference_id = $1', [referenceId]);
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
          }
       });
       if (tokenRes.ok) {
          const tokenData = await tokenRes.json();
          const statusRes = await fetch(`https://${MOMO_ENV === 'sandbox' ? 'sandbox.momodeveloper.mtn.com' : 'momodeveloper.mtn.com'}/collection/v1_0/requesttopay/${referenceId}`, {
             method: 'GET',
             headers: {
               'Authorization': `Bearer ${tokenData.access_token}`,
               'X-Target-Environment': MOMO_ENV,
               'Ocp-Apim-Subscription-Key': MOMO_SUB_KEY
             }
          });

          if (statusRes.ok) {
             const statusData = await statusRes.json();
             console.log('MTN Poll Status Data:', statusData);
             // Valid MTN statuses: PENDING, SUCCESSFUL, FAILED
             if (statusData.status === 'SUCCESSFUL' || statusData.status === 'FAILED') {
                // We found a resolution! Process it synchronously here instead of via queue.
                const client = await adminPool.connect();
                try {
                  await client.query('BEGIN');
                  const updateRes = await client.query(`
                    UPDATE billing_history
                    SET status = $1, updated_at = NOW()
                    WHERE reference_id = $2 AND status = 'PENDING'
                    RETURNING *
                  `, [statusData.status, referenceId]);
                  
                  if (updateRes.rowCount > 0 && statusData.status === 'SUCCESSFUL') {
                    const billingRecord = updateRes.rows[0];
                    const tenantRes = await client.query(`SELECT subscription_end_date FROM tenants WHERE id = $1`, [billingRecord.tenant_id]);
                    if (tenantRes.rowCount && tenantRes.rowCount > 0) {
                      let newEndDate = new Date();
                      const currentEndDate = tenantRes.rows[0].subscription_end_date ? new Date(tenantRes.rows[0].subscription_end_date) : null;
                      if (currentEndDate && currentEndDate > newEndDate) newEndDate = currentEndDate;
                      newEndDate.setDate(newEndDate.getDate() + 30);
                      await client.query(`UPDATE tenants SET status = 'ACTIVE', subscription_end_date = $1, updated_at = NOW() WHERE id = $2`, [newEndDate, billingRecord.tenant_id]);
                    }
                  }
                  await client.query('COMMIT');
                } catch (dbError) {
                  await client.query('ROLLBACK');
                  console.error('Fallback DB Error:', dbError);
                } finally {
                  client.release();
                }
                
                return NextResponse.json({ status: statusData.status });
             }
          }
       }
    }

    return NextResponse.json({ status: 'PENDING' });

  } catch (error: any) {
    console.error('MTN Status Poll Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
