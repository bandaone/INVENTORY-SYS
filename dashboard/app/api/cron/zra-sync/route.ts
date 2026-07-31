export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { adminPool } from '@/lib/db';
import { validateVsdcUrl } from '@/lib/zra';

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
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const client = await adminPool.connect();
  let synced = 0, failed = 0;
  let transactionOpen = false;

  try {
    // Claim a bounded batch atomically. A crashed worker's claim becomes
    // eligible again after ten minutes; concurrent workers skip locked rows.
    await client.query('BEGIN');
    transactionOpen = true;
    const pending = await client.query(`
      WITH candidates AS (
        SELECT q.id
        FROM zra_sync_queue q
        WHERE q.attempts < 5
          AND (
            q.status = 'pending'
            OR (
              q.status = 'processing'
              AND (q.claimed_at IS NULL OR q.claimed_at < NOW() - INTERVAL '10 minutes')
            )
          )
        ORDER BY q.created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 50
      ), claimed AS (
        UPDATE zra_sync_queue q
        SET status = 'processing', claimed_at = NOW(), attempts = q.attempts + 1
        FROM candidates
        WHERE q.id = candidates.id
        RETURNING q.id, q.tenant_id, q.transaction_id, q.payload,
                  q.attempts, q.claimed_at, q.created_at
      )
      SELECT * FROM claimed ORDER BY created_at ASC
    `);
    await client.query('COMMIT');
    transactionOpen = false;

    for (const row of pending.rows) {
      try {
        // Get tenant's current VSDC config
        const settings = await client.query(`
          SELECT zra_tpin, zra_bhf_id, zra_vsdc_url, zra_dvc_srl_no, zra_last_invc_no
          FROM tenant_settings WHERE tenant_id = $1
        `, [row.tenant_id]);

        if (!settings.rows.length || !settings.rows[0].zra_vsdc_url) {
          await client.query(
            `UPDATE zra_sync_queue
             SET status='failed', last_error='No VSDC configured', claimed_at=NULL
             WHERE id=$1 AND tenant_id=$2 AND status='processing' AND claimed_at=$3`,
            [row.id, row.tenant_id, row.claimed_at]
          );
          failed++;
          continue;
        }

        const s = settings.rows[0];
        const config = {
          tpin:      s.zra_tpin,
          bhfId:     s.zra_bhf_id || '000',
          vsdcUrl:   validateVsdcUrl(s.zra_vsdc_url),
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
          // Keep the queue transition and receipt update atomic.
          await client.query('BEGIN');
          transactionOpen = true;
          const claimed = await client.query(
            `UPDATE zra_sync_queue
             SET status='synced', synced_at=NOW(), last_error=NULL, claimed_at=NULL
             WHERE id=$1 AND tenant_id=$2 AND status='processing' AND claimed_at=$3
             RETURNING id`,
            [row.id, row.tenant_id, row.claimed_at]
          );
          if (claimed.rowCount !== 1) {
            throw new Error('ZRA queue claim was lost before completion');
          }
          await client.query(
            `UPDATE transactions SET zra_rcpt_no=$1, zra_intrl_data=$2, zra_mrc_no=$3, zra_vsd_status='synced'
             WHERE id=$4 AND tenant_id=$5`,
            [data.data?.rcptNo, data.data?.intrlData, data.data?.mrcNo, row.transaction_id, row.tenant_id]
          );
          await client.query('COMMIT');
          transactionOpen = false;
          synced++;
        } else {
          const errMsg = data?.resultMsg || `HTTP ${res.status}`;
          const newStatus = row.attempts >= 5 ? 'failed' : 'pending';
          await client.query(
            `UPDATE zra_sync_queue SET status=$1, last_error=$2, claimed_at=NULL
             WHERE id=$3 AND tenant_id=$4 AND status='processing' AND claimed_at=$5`,
            [newStatus, errMsg, row.id, row.tenant_id, row.claimed_at]
          );
          if (newStatus === 'failed') {
            await client.query(
              `UPDATE transactions SET zra_vsd_status='failed' WHERE id=$1 AND tenant_id=$2`,
              [row.transaction_id, row.tenant_id]
            );
          }
          failed++;
        }
      } catch (itemErr: any) {
        if (transactionOpen) {
          await client.query('ROLLBACK');
          transactionOpen = false;
        }
        const newStatus = row.attempts >= 5 ? 'failed' : 'pending';
        await client.query(
          `UPDATE zra_sync_queue SET status=$1, last_error=$2, claimed_at=NULL
           WHERE id=$3 AND tenant_id=$4 AND status='processing' AND claimed_at=$5`,
          [newStatus, itemErr.message, row.id, row.tenant_id, row.claimed_at]
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
    if (transactionOpen) {
      await client.query('ROLLBACK').catch(() => undefined);
      transactionOpen = false;
    }
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
