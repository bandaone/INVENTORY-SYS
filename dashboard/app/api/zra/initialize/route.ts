export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { fetchTenantQuery } from '@/lib/db';
import { initializeDevice, validateVsdcUrl } from '@/lib/zra';
import { requireTenantSession, SessionError } from '@/lib/session';

/**
 * POST /api/zra/initialize
 * Called from the Owner Dashboard settings page when a store owner
 * enters their ZRA credentials and clicks "Initialize & Test Connection".
 *
 * Body: { tpin, bhfId, dvcSrlNo, vsdcUrl }
 */
export async function POST(req: Request) {
  try {
    const { tenantId } = await requireTenantSession(['owner']);

    const { tpin, bhfId, dvcSrlNo, vsdcUrl } = await req.json();

    if (!tpin || !dvcSrlNo || !vsdcUrl) {
      return NextResponse.json({ error: 'tpin, dvcSrlNo and vsdcUrl are required' }, { status: 400 });
    }

    // Validate TPIN format (10 digits)
    if (!/^\d{10}$/.test(tpin)) {
      return NextResponse.json({ error: 'TPIN must be exactly 10 digits' }, { status: 400 });
    }

    const safeVsdcUrl = validateVsdcUrl(vsdcUrl);

    // Save credentials first so we can read them in the ZRA service
    await fetchTenantQuery(tenantId, `
      UPDATE tenant_settings
      SET zra_tpin     = $1,
          zra_bhf_id   = $2,
          zra_dvc_srl_no = $3,
          zra_vsdc_url = $4,
          zra_enabled  = false
      WHERE tenant_id  = $5
    `, [tpin, bhfId || '000', dvcSrlNo, safeVsdcUrl, tenantId]);

    // Attempt initialization with the VSDC
    const result = await initializeDevice({ tpin, bhfId: bhfId || '000', dvcSrlNo, vsdcUrl: safeVsdcUrl, lastInvcNo: 0 });

    if (!result.success) {
      return NextResponse.json({
        error: result.error || 'ZRA initialization failed',
        hint: 'Ensure your VSDC server is running and reachable at the URL you entered.',
      }, { status: 502 });
    }

    // Mark as successfully initialized
    await fetchTenantQuery(tenantId, `
      UPDATE tenant_settings
      SET zra_enabled        = true,
          zra_initialized_at = NOW(),
          zra_last_invc_no   = 0
      WHERE tenant_id = $1
    `, [tenantId]);

    return NextResponse.json({ success: true, message: 'ZRA Smart Invoice successfully activated!' });
  } catch (err: any) {
    if (err instanceof SessionError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[ZRA Initialize Error]', err);
    return NextResponse.json({ error: 'Initialization failed: ' + err.message }, { status: 500 });
  }
}

/**
 * GET /api/zra/initialize
 * Returns current ZRA configuration status for the tenant.
 */
export async function GET() {
  try {
    const { tenantId } = await requireTenantSession(['owner']);

    const rows = await fetchTenantQuery(tenantId, `
      SELECT zra_enabled, zra_tpin, zra_bhf_id, zra_vsdc_url,
             zra_dvc_srl_no, zra_initialized_at, zra_last_invc_no
      FROM tenant_settings WHERE tenant_id = $1
    `, [tenantId]);

    if (!rows.length) return NextResponse.json({ error: 'Settings not found' }, { status: 404 });

    const s = rows[0];
    return NextResponse.json({
      enabled:       s.zra_enabled,
      tpin:          s.zra_tpin,
      bhfId:         s.zra_bhf_id,
      vsdcUrl:       s.zra_vsdc_url,
      dvcSrlNo:      s.zra_dvc_srl_no,
      initializedAt: s.zra_initialized_at,
      lastInvcNo:    s.zra_last_invc_no,
    });
  } catch (err: any) {
    if (err instanceof SessionError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
