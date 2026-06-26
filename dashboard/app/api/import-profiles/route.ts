import { fetchQuery } from '@/lib/db';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

function getTenantId() {
  const tenantId = cookies().get('tenant_id')?.value;
  if (!tenantId) throw new Error('Unauthorized');
  return tenantId;
}

export async function GET(req: Request) {
  try {
    const tenantId = getTenantId();
    const { searchParams } = new URL(req.url);
    const sourceSignature = searchParams.get('source_signature');
    if (!sourceSignature) {
      return NextResponse.json({ error: 'source_signature is required' }, { status: 400 });
    }

    const rows = await fetchQuery(`
      SELECT id, source_signature, profile_name, mapping, sample_headers, created_at, updated_at
      FROM import_profiles
      WHERE tenant_id = $1 AND source_signature = $2
      LIMIT 1
    `, [tenantId, sourceSignature]);

    return NextResponse.json({ profile: rows[0] || null });
  } catch (err: any) {
    if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('[Import Profiles GET]', err);
    return NextResponse.json({ error: 'Failed to load import profile' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const tenantId = getTenantId();
    const body = await req.json();
    const sourceSignature = String(body?.source_signature || '').trim();
    const profileName = String(body?.profile_name || '').trim() || null;
    const mapping = body?.mapping || {};
    const sampleHeaders = Array.isArray(body?.sample_headers) ? body.sample_headers : [];

    if (!sourceSignature) {
      return NextResponse.json({ error: 'source_signature is required' }, { status: 400 });
    }

    const rows = await fetchQuery(`
      INSERT INTO import_profiles (tenant_id, source_signature, profile_name, mapping, sample_headers)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (tenant_id, source_signature)
      DO UPDATE SET
        profile_name = EXCLUDED.profile_name,
        mapping = EXCLUDED.mapping,
        sample_headers = EXCLUDED.sample_headers,
        updated_at = NOW()
      RETURNING id, source_signature, profile_name, mapping, sample_headers, created_at, updated_at
    `, [tenantId, sourceSignature, profileName, JSON.stringify(mapping), JSON.stringify(sampleHeaders)]);

    return NextResponse.json({ success: true, profile: rows[0] });
  } catch (err: any) {
    if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('[Import Profiles POST]', err);
    return NextResponse.json({ error: 'Failed to save import profile' }, { status: 500 });
  }
}
