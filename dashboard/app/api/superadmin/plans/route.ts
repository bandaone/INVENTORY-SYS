export const dynamic = "force-dynamic";
import { adminPool } from '@/lib/db';
import { NextResponse } from 'next/server';
import { requirePlatformSession, SessionError } from '@/lib/session';

export async function GET() {
  try {
    await requirePlatformSession();
    const result = await adminPool.query(`
      SELECT * FROM subscription_plans 
      ORDER BY price_zmw ASC
    `);
    return NextResponse.json(result.rows);
  } catch (error) {
    if (error instanceof SessionError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error fetching plans:', error);
    return NextResponse.json({ error: 'Failed to fetch plans' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    await requirePlatformSession();
    const { id, price_zmw, max_locations, max_users, features } = await req.json();

    const price = Number(price_zmw);
    const locationLimit = Number(max_locations);
    const userLimit = Number(max_users);
    if (!/^[0-9a-f-]{36}$/i.test(String(id || '')) || !Number.isFinite(price) || price < 0) {
      return NextResponse.json({ error: 'Invalid plan or price' }, { status: 400 });
    }
    if (!Number.isInteger(locationLimit) || locationLimit < 1 || !Number.isInteger(userLimit) || userLimit < 1) {
      return NextResponse.json({ error: 'Plan limits must be positive whole numbers' }, { status: 400 });
    }
    if (!Array.isArray(features) || features.length > 30 || features.some((feature) => typeof feature !== 'string' || !feature.trim() || feature.length > 160)) {
      return NextResponse.json({ error: 'Invalid feature list' }, { status: 400 });
    }

    const result = await adminPool.query(`
      UPDATE subscription_plans 
      SET price_zmw = $1, 
          max_locations = $2, 
          max_users = $3, 
          features = $4,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $5
      RETURNING id, code, name, price_zmw, max_locations, max_users, features, entitlements, version
    `, [price, locationLimit, userLimit, JSON.stringify(features.map((feature) => feature.trim())), id]);
    if (result.rowCount !== 1) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
    
    return NextResponse.json({ success: true, plan: result.rows[0] });
  } catch (error) {
    if (error instanceof SessionError) return NextResponse.json({ error: error.message }, { status: error.status });
    if ((error as { code?: string }).code === '23514') {
      return NextResponse.json({ error: (error as Error).message }, { status: 409 });
    }
    console.error('Error updating plan:', error);
    return NextResponse.json({ error: 'Failed to update plan' }, { status: 500 });
  }
}
