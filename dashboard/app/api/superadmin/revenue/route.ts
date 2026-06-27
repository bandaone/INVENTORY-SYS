export const dynamic = "force-dynamic";
import { adminPool } from '@/lib/db';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

function checkSuperAdmin() {
  const role = cookies().get('staff_role')?.value;
  if (role !== 'superadmin') throw new Error('Unauthorized');
}

export async function GET() {
  try {
    checkSuperAdmin();

    // 1. Current MRR (Active locations * 350 ZMW)
    const mrrResult = await adminPool.query(`
      SELECT COUNT(l.id) as total_locations
      FROM locations l
      JOIN tenants t ON l.tenant_id = t.id
      WHERE t.status = 'ACTIVE' AND l.is_active = true
    `);

    // Base SaaS fee: 1,500 ZMW per active store location (Value-based pricing)
    const mrr = (Number(mrrResult.rows[0]?.total_locations) || 0) * 1500;

    // 2. Overdue Invoices
    const overdueResult = await adminPool.query(`
      SELECT b.id, b.amount, b.due_at, t.name as tenant_name, t.subscription_tier
      FROM billing_events b
      JOIN tenants t ON b.tenant_id = t.id
      WHERE b.status = 'OVERDUE' OR (b.status = 'PENDING' AND b.due_at < NOW())
      ORDER BY b.due_at ASC
    `);

    // 3. Recent Transactions / Billing Events
    const eventsResult = await adminPool.query(`
      SELECT b.*, t.name as tenant_name
      FROM billing_events b
      JOIN tenants t ON b.tenant_id = t.id
      ORDER BY b.created_at DESC
      LIMIT 50
    `);

    return NextResponse.json({
      mrr,
      overdue: overdueResult.rows,
      events: eventsResult.rows
    });
  } catch (err: any) {
    if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('[Revenue API GET]', err);
    return NextResponse.json({ error: 'Failed to load revenue data' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    checkSuperAdmin();
    const { action, eventId, tenantId, amount, tier } = await req.json();

    if (action === 'MARK_PAID') {
      await adminPool.query(`
        UPDATE billing_events 
        SET status = 'POSTED', effective_at = NOW() 
        WHERE id = $1
      `, [eventId]);
      return NextResponse.json({ success: true });
    }

    if (action === 'GENERATE_INVOICE') {
      // Create a manual pending invoice
      await adminPool.query(`
        INSERT INTO billing_events (tenant_id, event_type, amount, currency, status, due_at)
        VALUES ($1, 'UPGRADED', $2, 'ZMW', 'PENDING', NOW() + interval '7 days')
      `, [tenantId, amount]);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err: any) {
    if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('[Revenue API POST]', err);
    return NextResponse.json({ error: 'Failed to process revenue action' }, { status: 500 });
  }
}
