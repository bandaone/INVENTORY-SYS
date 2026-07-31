import { NextResponse } from 'next/server';
import { adminPool, fetchTenantQuery } from '@/lib/db';
import { requireTenantSession, SessionError } from '@/lib/session';

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const { tenantId } = await requireTenantSession(['owner'], { allowSuspended: true });
    const transactionId = params.id;
    if (!transactionId) return new NextResponse('Missing transaction ID', { status: 400 });

    // Fetch billing record, ensuring it belongs to the authenticated tenant
    const res = await adminPool.query(`
      SELECT * FROM billing_history 
      WHERE id = $1 AND tenant_id = $2
    `, [transactionId, tenantId]);

    if (res.rowCount === 0) {
      return new NextResponse('Receipt not found', { status: 404 });
    }

    const record = res.rows[0];

    // Get tenant details for the receipt
    const settingsRes = await fetchTenantQuery(tenantId, `SELECT business_name FROM tenant_settings WHERE tenant_id = $1`, [tenantId]);
    const businessName = settingsRes[0]?.business_name || 'Retail OS Business';

    const dateStr = new Date(record.created_at).toLocaleString('en-ZM', { 
        dateStyle: 'long', 
        timeStyle: 'short' 
    });

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Receipt - ${record.reference_id}</title>
        <style>
            body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; padding: 40px; color: #333; max-width: 800px; margin: 0 auto; }
            .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #eee; padding-bottom: 20px; margin-bottom: 40px; }
            .logo { font-size: 24px; font-weight: bold; color: #2563eb; }
            .title { font-size: 28px; color: #111; margin: 0; text-transform: uppercase; letter-spacing: 2px; }
            .row { display: flex; justify-content: space-between; margin-bottom: 15px; }
            .label { color: #666; font-weight: 500; }
            .value { font-weight: 600; text-align: right; }
            .total-row { border-top: 2px solid #eee; padding-top: 20px; margin-top: 20px; font-size: 20px; }
            .footer { margin-top: 60px; text-align: center; color: #888; font-size: 14px; }
            .status { display: inline-block; padding: 6px 12px; border-radius: 4px; background: #dcfce7; color: #166534; font-weight: bold; font-size: 14px; }
        </style>
    </head>
    <body onload="window.print()">
        <div class="header">
            <div>
                <div class="logo">Retail OS</div>
                <div style="color: #666; margin-top: 5px;">Subscription Billing</div>
            </div>
            <div style="text-align: right;">
                <h1 class="title">Receipt</h1>
                <div style="color: #666; margin-top: 5px;">#${record.reference_id.substring(0, 8).toUpperCase()}</div>
            </div>
        </div>

        <div style="margin-bottom: 40px;">
            <div class="row">
                <span class="label">Billed To:</span>
                <span class="value">${businessName}</span>
            </div>
            <div class="row">
                <span class="label">Date Paid:</span>
                <span class="value">${dateStr}</span>
            </div>
            <div class="row">
                <span class="label">Payment Method:</span>
                <span class="value">MTN Mobile Money</span>
            </div>
            <div class="row">
                <span class="label">Paying Mobile Number:</span>
                <span class="value">${record.payer_msisdn || 'N/A'}</span>
            </div>
            <div class="row">
                <span class="label">Status:</span>
                <span class="value"><span class="status">${record.status}</span></span>
            </div>
        </div>

        <table style="width: 100%; border-collapse: collapse; margin-bottom: 40px;">
            <tr style="border-bottom: 2px solid #eee; text-align: left;">
                <th style="padding: 10px 0; color: #666;">Description</th>
                <th style="padding: 10px 0; text-align: right; color: #666;">Amount</th>
            </tr>
            <tr>
                <td style="padding: 20px 0; font-weight: 500;">Retail OS Subscription - ${record.event_type.replace(/_/g, ' ')}</td>
                <td style="padding: 20px 0; text-align: right; font-weight: 500;">${record.currency} ${Number(record.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
            </tr>
        </table>

        <div class="row total-row">
            <span class="label" style="color: #111;">Total Paid</span>
            <span class="value">${record.currency} ${Number(record.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
        </div>

        <div class="footer">
            Thank you for your business.<br>
            If you have any questions regarding this receipt, please contact support@retailos.com.
        </div>
    </body>
    </html>
    `;

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html',
        // Optional: uncomment below to force download instead of opening in browser
        // 'Content-Disposition': \`attachment; filename="receipt-${record.reference_id.substring(0, 8)}.html"\`
      },
    });

  } catch (error) {
    if (error instanceof SessionError) {
      return new NextResponse(error.message, { status: error.status });
    }
    console.error('Receipt Generation Error:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
