import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { adminPool } from '@/lib/db';

export async function POST(req: Request) {
  try {
    const signature = req.headers.get('x-signature');
    const bodyText = await req.text(); // Need raw text for signature verification
    
    // In production, MTN sends an X-Signature header that we must verify to ensure
    // the callback is genuinely from them.
    const MOMO_API_KEY = process.env.MTN_MOMO_API_KEY || 'sandbox';
    const MOMO_ENV = process.env.MTN_MOMO_ENVIRONMENT || 'sandbox';

    if (MOMO_ENV !== 'sandbox' && signature) {
      // Calculate HMAC SHA256 of the body using the API Key
      const expectedSignature = crypto
        .createHmac('sha256', MOMO_API_KEY)
        .update(bodyText)
        .digest('base64');
        
      if (signature !== expectedSignature) {
        console.warn('MTN Webhook: Invalid signature detected. Ignoring request.');
        return new NextResponse('Invalid signature', { status: 401 });
      }
    }

    const data = JSON.parse(bodyText);
    const referenceId = data.referenceId;
    const status = data.status; // SUCCESSFUL, FAILED, PENDING

    if (!referenceId || !status) {
      return new NextResponse('Missing required fields', { status: 400 });
    }

    // Process synchronously for Serverless compatibility (Vercel)
    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');

      const updateRes = await client.query(`
        UPDATE billing_history
        SET status = $1, updated_at = NOW()
        WHERE reference_id = $2 AND status = 'PENDING'
        RETURNING *
      `, [status, referenceId]);

      // If no row was updated, it means the payment was already processed (idempotency)
      // or the referenceId doesn't exist. Safely acknowledge the webhook.
      if (updateRes.rowCount === 0) {
         await client.query('ROLLBACK');
         return new NextResponse('OK', { status: 200 }); 
      }

      const billingRecord = updateRes.rows[0];

      // If SUCCESSFUL, activate the tenant subscription
      if (status === 'SUCCESSFUL') {
        const tenantRes = await client.query(`
          SELECT subscription_end_date, owner_email 
          FROM tenants 
          WHERE id = $1
        `, [billingRecord.tenant_id]);

        if (tenantRes.rowCount && tenantRes.rowCount > 0) {
          let newEndDate = new Date();
          const currentEndDate = tenantRes.rows[0].subscription_end_date ? new Date(tenantRes.rows[0].subscription_end_date) : null;
          
          if (currentEndDate && currentEndDate > newEndDate) {
             newEndDate = currentEndDate;
          }
          newEndDate.setDate(newEndDate.getDate() + 30);

          await client.query(`
            UPDATE tenants
            SET status = 'ACTIVE', subscription_end_date = $1, updated_at = NOW()
            WHERE id = $2
          `, [newEndDate, billingRecord.tenant_id]);
          
          // Future: Trigger Email Receipt Delivery Here
          // await sendReceiptEmail(...)
        }
      }

      await client.query('COMMIT');
      return new NextResponse('OK', { status: 200 });

    } catch (dbError) {
      await client.query('ROLLBACK');
      throw dbError; // Caught by outer block, returns 500 to MTN for retry
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('MTN Callback Webhook Error:', error);
    // Return 500 so MTN will automatically retry the webhook later
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
