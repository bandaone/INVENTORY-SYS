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
    
    await adminPool.query(`
      UPDATE subscription_plans 
      SET price_zmw = $1, 
          max_locations = $2, 
          max_users = $3, 
          features = $4,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $5
    `, [price_zmw, max_locations, max_users, JSON.stringify(features), id]);
    
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof SessionError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error updating plan:', error);
    return NextResponse.json({ error: 'Failed to update plan' }, { status: 500 });
  }
}
