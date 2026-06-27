export const dynamic = "force-dynamic";
import { fetchTenantQuery } from '@/lib/db';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

function getTenantId() {
  const t = cookies().get('tenant_id')?.value;
  if (!t) throw new Error('Unauthorized');
  return t;
}

// GET: list real sync conflicts for this tenant
export async function GET() {
  try {
    const tenantId = getTenantId();
    const conflicts = await fetchTenantQuery(tenantId, `
      SELECT 
        sc.id,
        sc.garment_serial,
        sc.conflict_type,
        sc.action_a::text AS local_value,
        COALESCE(sc.action_b::text, sc.resolution, sc.notes, '') AS server_value,
        (sc.resolution IS NOT NULL) AS resolved,
        sc.created_at,
        s.name as resolved_by_name
      FROM sync_conflicts sc
      LEFT JOIN staff s ON sc.resolved_by = s.id
      ORDER BY (sc.resolution IS NOT NULL) ASC, sc.created_at DESC
    `);
    return NextResponse.json(conflicts);
  } catch (err: any) {
    if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('[Conflicts GET Error]', err);
    return NextResponse.json({ error: 'Failed to load conflicts' }, { status: 500 });
  }
}

// PATCH: resolve a conflict
export async function PATCH(req: Request) {
  try {
    const tenantId = getTenantId();
    const staffId = cookies().get('staff_id')?.value;
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: 'Conflict ID required' }, { status: 400 });

    await fetchTenantQuery(tenantId, `
      UPDATE sync_conflicts
      SET resolution = COALESCE(resolution, 'MANUAL_RESOLVED'),
          resolved_by = $1,
          resolved_at = NOW()
      WHERE id = $2 AND tenant_id = '${tenantId}'
    `, [staffId || null, id]);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('[Conflicts PATCH Error]', err);
    return NextResponse.json({ error: 'Failed to resolve conflict' }, { status: 500 });
  }
}
