export const dynamic = 'force-dynamic'

import { ensureTenantInvoice } from '@/lib/billing'
import { adminPool } from '@/lib/db'
import { sendTrialReminderEmail } from '@/lib/email'
import { timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'

function authorized(req: Request) {
  const configured = process.env.CRON_SECRET || ''
  const provided = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!configured || !provided) return false
  const expected = Buffer.from(configured)
  const actual = Buffer.from(provided)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const startedAt = Date.now()
  try {
    const [trialSuspensions, subscriptionSuspensions, overdueInvoices, reminders, renewalCandidates] = await Promise.all([
      adminPool.query(`
        UPDATE tenants AS tenant
        SET status = 'SUSPENDED', updated_at = NOW()
        FROM onboarding_sessions AS onboarding
        WHERE onboarding.tenant_id = tenant.id
          AND tenant.status = 'TRIAL'
          AND onboarding.trial_end_date < NOW()
        RETURNING tenant.id, tenant.name
      `),
      adminPool.query(`
        UPDATE tenants
        SET status = 'SUSPENDED', updated_at = NOW()
        WHERE status = 'ACTIVE'
          AND subscription_end_date IS NOT NULL
          AND subscription_end_date < NOW()
        RETURNING id, name
      `),
      adminPool.query(`
        UPDATE subscription_invoices
        SET status = 'OVERDUE', updated_at = NOW()
        WHERE status IN ('OPEN', 'PARTIALLY_PAID') AND due_at < NOW()
        RETURNING id
      `),
      adminPool.query(`
        SELECT
          tenant.id,
          tenant.name,
          settings.owner_email,
          greatest(ceil(extract(epoch from (onboarding.trial_end_date - NOW())) / 86400), 0)::integer AS days_left
        FROM tenants AS tenant
        JOIN onboarding_sessions AS onboarding ON onboarding.tenant_id = tenant.id
        LEFT JOIN tenant_settings AS settings ON settings.tenant_id = tenant.id
        WHERE tenant.status = 'TRIAL'
          AND settings.owner_email IS NOT NULL
          AND onboarding.trial_end_date > NOW()
          AND (
            onboarding.trial_end_date::date = (NOW() + INTERVAL '2 days')::date
            OR onboarding.trial_end_date::date = NOW()::date
          )
      `),
      adminPool.query(`
        SELECT id
        FROM tenants
        WHERE status = 'ACTIVE'
          AND subscription_end_date IS NOT NULL
          AND subscription_end_date <= NOW() + INTERVAL '7 days'
      `),
    ])

    let renewalInvoicesEnsured = 0
    for (const tenant of renewalCandidates.rows) {
      await ensureTenantInvoice(tenant.id)
      renewalInvoicesEnsured += 1
    }

    await Promise.allSettled(reminders.rows.map((tenant) =>
      sendTrialReminderEmail(tenant.owner_email, tenant.name, Number(tenant.days_left)),
    ))

    const summary = {
      trialSuspended: trialSuspensions.rowCount || 0,
      subscriptionSuspended: subscriptionSuspensions.rowCount || 0,
      overdueInvoices: overdueInvoices.rowCount || 0,
      reminders: reminders.rowCount || 0,
      renewalInvoices: renewalInvoicesEnsured,
      durationMs: Date.now() - startedAt,
    }
    console.log(JSON.stringify({
      level: 'info',
      message: 'Subscription lifecycle cron completed',
      route: '/api/cron/trial-check',
      ...summary,
    }))
    return NextResponse.json({ ok: true, ...summary })
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      message: 'Subscription lifecycle cron failed',
      route: '/api/cron/trial-check',
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    }))
    return NextResponse.json({ error: 'Cron job failed' }, { status: 500 })
  }
}
