export const dynamic = "force-dynamic";
import { adminPool } from '@/lib/db';
import { NextResponse } from 'next/server';

// This route is called by Vercel Cron daily at midnight
// vercel.json config: { "crons": [{ "path": "/api/cron/trial-check", "schedule": "0 0 * * *" }] }

export async function GET(req: Request) {
  // Secure the cron endpoint from public access
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // 1. Suspend tenants whose trial has expired and are still in TRIAL status
    const suspendResult = await adminPool.query(`
      UPDATE tenants
      SET status = 'SUSPENDED', updated_at = NOW()
      WHERE status = 'TRIAL'
        AND trial_ends_at IS NOT NULL
        AND trial_ends_at < NOW()
      RETURNING id, name, trial_ends_at
    `);

    const suspended = suspendResult.rows;

    // 2. Find tenants entering Day 3 of trial — send reminder (Day 5 - 2 days)
    const day3Tenants = await adminPool.query(`
      SELECT t.id, t.name, ts.owner_email
      FROM tenants t
      LEFT JOIN tenant_settings ts ON ts.tenant_id = t.id
      WHERE t.status = 'TRIAL'
        AND t.trial_ends_at IS NOT NULL
        AND t.trial_ends_at BETWEEN NOW() + interval '1 day 23 hours' AND NOW() + interval '2 days 1 hour'
    `);

    // 3. Find tenants entering final Day 5 — send urgent nudge
    const day5Tenants = await adminPool.query(`
      SELECT t.id, t.name, ts.owner_email
      FROM tenants t
      LEFT JOIN tenant_settings ts ON ts.tenant_id = t.id
      WHERE t.status = 'TRIAL'
        AND t.trial_ends_at IS NOT NULL
        AND t.trial_ends_at BETWEEN NOW() - interval '1 hour' AND NOW() + interval '23 hours'
    `);

    // Trigger emails asynchronously
    import('@/lib/email').then(({ sendTrialReminderEmail }) => {
      day3Tenants.rows.forEach(tenant => {
        if (tenant.owner_email) sendTrialReminderEmail(tenant.owner_email, tenant.name, 2).catch(console.error);
      });
      day5Tenants.rows.forEach(tenant => {
        if (tenant.owner_email) sendTrialReminderEmail(tenant.owner_email, tenant.name, 0).catch(console.error);
      });
    });

    // 4. Generate monthly invoices for ACTIVE tenants on the 1st of the month
    const today = new Date();
    let invoicesGenerated = 0;
    if (today.getDate() === 1) {
      // Get all active tenants and their active location counts
      const activeTenantsResult = await adminPool.query(`
        SELECT t.id as tenant_id, t.name, COUNT(l.id) as location_count
        FROM tenants t
        JOIN locations l ON l.tenant_id = t.id AND l.is_active = true
        WHERE t.status = 'ACTIVE'
        GROUP BY t.id, t.name
      `);

      for (const tenant of activeTenantsResult.rows) {
        const locationCount = Number(tenant.location_count);
        const ratePerLocation = getVolumeRate(locationCount);
        const amount = locationCount * ratePerLocation;

        // Only generate if no PENDING invoice exists for this month
        const existingInvoice = await adminPool.query(`
          SELECT id FROM billing_events
          WHERE tenant_id = $1
            AND event_type = 'PAYMENT_RECEIVED'
            AND status = 'PENDING'
            AND created_at >= date_trunc('month', NOW())
          LIMIT 1
        `, [tenant.tenant_id]);

        if (existingInvoice.rows.length === 0) {
          await adminPool.query(`
            INSERT INTO billing_events (tenant_id, event_type, amount, currency, status, due_at, metadata)
            VALUES ($1, 'PAYMENT_RECEIVED', $2, 'ZMW', 'PENDING', NOW() + interval '7 days', $3)
          `, [
            tenant.tenant_id,
            amount,
            JSON.stringify({ location_count: locationCount, rate_per_location: ratePerLocation })
          ]);
          invoicesGenerated++;
        }
      }
    }

    console.log(`[Cron] Suspended: ${suspended.length}, Day3 reminders: ${day3Tenants.rows.length}, Day5 final: ${day5Tenants.rows.length}, Invoices: ${invoicesGenerated}`);

    return NextResponse.json({
      ok: true,
      suspended: suspended.map(r => r.name),
      day3_reminders: day3Tenants.rows.length,
      day5_final: day5Tenants.rows.length,
      invoices_generated: invoicesGenerated,
    });

  } catch (err) {
    console.error('[Cron trial-check Error]', err);
    return NextResponse.json({ error: 'Cron job failed' }, { status: 500 });
  }
}

// Volume pricing tiers — matches the business strategy
function getVolumeRate(locationCount: number): number {
  if (locationCount >= 10) return 1500;
  if (locationCount >= 5)  return 1750;
  if (locationCount >= 3)  return 2000;
  if (locationCount >= 2)  return 2200;
  return 2500; // 1 location
}
