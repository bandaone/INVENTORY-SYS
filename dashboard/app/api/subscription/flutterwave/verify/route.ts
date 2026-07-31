export const dynamic = 'force-dynamic'

import { adminPool } from '@/lib/db'
import { requireTenantSession, SessionError } from '@/lib/session'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  try {
    const { tenantId } = await requireTenantSession(['owner'], { allowSuspended: true })
    const { transaction_id } = await req.json()
    if (!transaction_id) {
      return NextResponse.json({ error: 'Missing transaction_id' }, { status: 400 })
    }

    const secret = process.env.FLUTTERWAVE_SECRET_KEY
    if (!secret) {
      return NextResponse.json({ error: 'Payment provider is not configured' }, { status: 503 })
    }

    const response = await fetch(`https://api.flutterwave.com/v3/transactions/${encodeURIComponent(String(transaction_id))}/verify`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return NextResponse.json({ error: 'Payment verification failed' }, { status: 400 })

    const verified = await response.json()
    if (verified?.status !== 'success' || verified?.data?.status !== 'successful') {
      return NextResponse.json({ error: 'Payment verification failed' }, { status: 400 })
    }

    const referenceId = String(verified.data.tx_ref || '')
    const client = await adminPool.connect()
    let newEndDate: Date
    try {
      await client.query('BEGIN')
      const pending = await client.query(`
        SELECT id, amount, currency
        FROM billing_history
        WHERE tenant_id = $1 AND reference_id = $2 AND status = 'PENDING'
        LIMIT 1
        FOR UPDATE
      `, [tenantId, referenceId])
      if ((pending.rowCount ?? 0) !== 1) {
        await client.query('ROLLBACK')
        return NextResponse.json({ error: 'No matching pending payment was found' }, { status: 409 })
      }

      const expectedAmount = Number(pending.rows[0].amount)
      const paidAmount = Number(verified.data.amount)
      const expectedCurrency = String(pending.rows[0].currency || '').toUpperCase()
      const paidCurrency = String(verified.data.currency || '').toUpperCase()
      if (!Number.isFinite(paidAmount) || paidAmount < expectedAmount || paidCurrency !== expectedCurrency) {
        await client.query('ROLLBACK')
        return NextResponse.json({ error: 'Verified payment does not match the pending invoice' }, { status: 409 })
      }

      const tenant = await client.query(`
        SELECT subscription_end_date FROM tenants WHERE id = $1 FOR UPDATE
      `, [tenantId])
      if ((tenant.rowCount ?? 0) !== 1) throw new Error('Tenant not found')

      newEndDate = new Date()
      const existingEndDate = tenant.rows[0].subscription_end_date
        ? new Date(tenant.rows[0].subscription_end_date)
        : null
      if (existingEndDate && existingEndDate > newEndDate) newEndDate = existingEndDate
      newEndDate.setDate(newEndDate.getDate() + 30)

      await client.query(`
        UPDATE billing_history
        SET status = 'SUCCESSFUL', metadata = $1, updated_at = NOW()
        WHERE id = $2 AND tenant_id = $3 AND status = 'PENDING'
      `, [JSON.stringify(verified.data), pending.rows[0].id, tenantId])
      await client.query(`
        UPDATE tenants
        SET status = 'ACTIVE', subscription_end_date = $1, updated_at = NOW()
        WHERE id = $2
      `, [newEndDate, tenantId])
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }

    return NextResponse.json({ success: true, newEndDate })
  } catch (error) {
    if (error instanceof SessionError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('[Flutterwave Verify Error]', error)
    return NextResponse.json({ error: 'Payment verification failed' }, { status: 500 })
  }
}
