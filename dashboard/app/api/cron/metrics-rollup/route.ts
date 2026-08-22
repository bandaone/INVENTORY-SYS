export const dynamic = 'force-dynamic'

import { adminPool } from '@/lib/db'
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
  const client = await adminPool.connect()
  try {
    await client.query('BEGIN')
    const rollups = await client.query(`
      WITH tenant_days AS (
        SELECT
          tenant.id AS tenant_id,
          ((NOW() AT TIME ZONE tenant.business_timezone)::date - 1) AS rollup_date,
          (((NOW() AT TIME ZONE tenant.business_timezone)::date - 1)::timestamp
            AT TIME ZONE tenant.business_timezone) AS period_start,
          ((NOW() AT TIME ZONE tenant.business_timezone)::date::timestamp
            AT TIME ZONE tenant.business_timezone) AS period_end
        FROM tenants AS tenant
      )
      INSERT INTO tenant_daily_rollups (
        tenant_id, rollup_date, active_users, logins, sales_count, sales_value,
        receiving_count, stocktake_count, returns_count, conflicts_count
      )
      SELECT
        day.tenant_id,
        day.rollup_date,
        (SELECT count(*)::integer FROM staff WHERE tenant_id = day.tenant_id AND is_active),
        (SELECT count(*)::integer FROM platform_access_events
         WHERE tenant_id = day.tenant_id AND event_type = 'LOGIN'
           AND created_at >= day.period_start AND created_at < day.period_end),
        (SELECT count(*)::integer FROM transactions
         WHERE tenant_id = day.tenant_id
           AND created_at >= day.period_start AND created_at < day.period_end),
        (SELECT coalesce(sum(total), 0) FROM transactions
         WHERE tenant_id = day.tenant_id
           AND created_at >= day.period_start AND created_at < day.period_end),
        (SELECT count(*)::integer FROM stock_movements
         WHERE tenant_id = day.tenant_id AND movement_type = 'INGESTION'
           AND created_at >= day.period_start AND created_at < day.period_end),
        (SELECT count(*)::integer FROM stocktake_sessions
         WHERE tenant_id = day.tenant_id
           AND completed_at >= day.period_start AND completed_at < day.period_end),
        (SELECT count(*)::integer FROM sales_returns
         WHERE tenant_id = day.tenant_id
           AND created_at >= day.period_start AND created_at < day.period_end),
        (SELECT count(*)::integer FROM sync_conflicts
         WHERE tenant_id = day.tenant_id
           AND created_at >= day.period_start AND created_at < day.period_end)
      FROM tenant_days AS day
      ON CONFLICT (tenant_id, rollup_date) DO UPDATE SET
        active_users = excluded.active_users,
        logins = excluded.logins,
        sales_count = excluded.sales_count,
        sales_value = excluded.sales_value,
        receiving_count = excluded.receiving_count,
        stocktake_count = excluded.stocktake_count,
        returns_count = excluded.returns_count,
        conflicts_count = excluded.conflicts_count
      RETURNING tenant_id, rollup_date
    `)

    const health = await client.query(`
      INSERT INTO platform_health_snapshots (
        api_uptime_pct, error_rate_pct, sync_backlog, failed_jobs,
        webhook_failures, database_health, notes
      )
      SELECT
        NULL,
        NULL,
        (SELECT count(*) FROM sync_queue WHERE synced_at IS NULL)
          + (SELECT count(*) FROM zra_sync_queue WHERE lower(status) = 'pending'),
        (SELECT count(*) FROM sync_queue WHERE sync_error IS NOT NULL)
          + (SELECT count(*) FROM zra_sync_queue WHERE lower(status) = 'failed'),
        (SELECT count(*) FROM private.payment_provider_events
         WHERE processing_status = 'FAILED' AND received_at >= NOW() - INTERVAL '24 hours'),
        'HEALTHY',
        'Database reachability and queue health measured. API uptime requires an external availability monitor.'
      RETURNING id, captured_at
    `)
    await client.query('COMMIT')

    const summary = {
      rollups: rollups.rowCount || 0,
      healthSnapshotId: health.rows[0]?.id || null,
      durationMs: Date.now() - startedAt,
    }
    console.log(JSON.stringify({
      level: 'info',
      message: 'Daily platform metrics rollup completed',
      route: '/api/cron/metrics-rollup',
      ...summary,
    }))
    return NextResponse.json({ ok: true, ...summary })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    console.error(JSON.stringify({
      level: 'error',
      message: 'Daily platform metrics rollup failed',
      route: '/api/cron/metrics-rollup',
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    }))
    return NextResponse.json({ error: 'Metrics rollup failed' }, { status: 500 })
  } finally {
    client.release()
  }
}
