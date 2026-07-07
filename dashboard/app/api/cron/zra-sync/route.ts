export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { fetchTenantQuery, pool } from '@/lib/db';
import { submitSale, getNextInvoiceNo } from '@/lib/zra';

/**
 * POST /api/cron/zra-sync
 * Retries all pending ZRA queue entries across all tenants.
 * Triggered by Vercel Cron (every 15 minutes) or manually.
 *
 * Add to vercel.json:
 * { "crons": [{ "path": "/api/cron/zra-sync", "schedule": "0,15,30,45 * * * *" }] }
 */
export async function POST(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const client = await pool.connect();
  let synced = 0, failed = 0;

  try {
    // Fetch all pending entries, max 50 per run, max 5 attempts
    const pending = await client.query(`
      SELECT q.id, q.tenant_id, q.transaction_id, q.payload, q.attempts
      FROM zra_sync_queue q
      WHERE q.status = 'pending' AND q.attempts < 5
      ORDER BY q.created_at ASC
      LIMIT 50
    `);

    for (const row of pending.rows) {
      try {
        // Get tenant's current VSDC config
        const settings = await client.query(`
          SELECT zra_tpin, zra_bhf_id, zra_vsdc_url, zra_dvc_srl_no, zra_last_invc_no
          FROM tenant_settings WHERE tenant_id = $1
        `, [row.tenant_id]);

        if (!settings.rows.length || !settings.rows[0].zra_vsdc_url) {
          await client.query(
            `UPDATE zra_sync_queue SET status='failed', last_error='No VSDC configured', attempts=attempts+1 WHERE id=$1`,
            [row.id]
          );
          failed++;
          continue;
        }

        const s = settings.rows[0];
        const config = {
          tpin:      s.zra_tpin,
          bhfId:     s.zra_bhf_id || '000',
          vsdcUrl:   s.zra_vsdc_url,
          dvcSrlNo:  s.zra_dvc_srl_no,
          lastInvcNo: s.zra_last_invc_no,
        };

        // Re-attempt submission using the original payload
        const payload = row.payload;
        const res = await fetch(`${config.vsdcUrl.replace(/\/$/, '')}/sales/saveSales`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(8000),
        });

        const data = await res.json().catch(() => ({}));

        if (data?.resultCd === '000') {
          // Success — update queue + transaction
          await client.query(
            `UPDATE zra_sync_queue SET status='synced', synced_at=NOW(), attempts=attempts+1 WHERE id=$1`,
            [row.id]
          );
          await client.query(
            `UPDATE transactions SET zra_rcpt_no=$1, zra_intrl_data=$2, zra_mrc_no=$3, zra_vsd_status='synced' WHERE id=$4`,
            [data.data?.rcptNo, data.data?.intrlData, data.data?.mrcNo, row.transaction_id]
          );
          synced++;
        } else {
          const errMsg = data?.resultMsg || `HTTP ${res.status}`;
          const newAttempts = row.attempts + 1;
          const newStatus = newAttempts >= 5 ? 'failed' : 'pending';
          await client.query(
            `UPDATE zra_sync_queue SET status=$1, last_error=$2, attempts=$3 WHERE id=$4`,
            [newStatus, errMsg, newAttempts, row.id]
          );
          if (newStatus === 'failed') {
            await client.query(
              `UPDATE transactions SET zra_vsd_status='failed' WHERE id=$1`,
              [row.transaction_id]
            );
          }
          failed++;
        }
      } catch (itemErr: any) {
        const newAttempts = row.attempts + 1;
        const newStatus = newAttempts >= 5 ? 'failed' : 'pending';
        await client.query(
          `UPDATE zra_sync_queue SET status=$1, last_error=$2, attempts=$3 WHERE id=$4`,
          [newStatus, itemErr.message, newAttempts, row.id]
        );
        failed++;
      }
    }

    return NextResponse.json({
      success: true,
      processed: pending.rows.length,
      synced,
      failed,
    });
  } catch (err: any) {
    console.error('[ZRA Cron Sync Error]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  } finally {
    client.release();
  }
}

// Allow Vercel Cron GET pings too
export async function GET(req: Request) {
  return POST(req);
}
