import { fetchTenantQuery, adminPool } from '@/lib/db';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

function getTenantId() {
  const t = cookies().get('tenant_id')?.value;
  if (!t) throw new Error('Unauthorized');
  return t;
}

// GET: load settings for this tenant
export async function GET() {
  try {
    const tenantId = getTenantId();

    const [settingsRows, tenantRows, billingRows] = await Promise.all([
      fetchTenantQuery(tenantId, `
        SELECT * FROM tenant_settings WHERE tenant_id = '${tenantId}'
      `).catch(() => []),
      adminPool.query(`SELECT name, subscription_tier, max_locations, status FROM tenants WHERE id = $1`, [tenantId]),
      fetchTenantQuery(tenantId, `
        SELECT id, event_type, amount, currency, status, due_at, effective_at 
        FROM billing_events 
        WHERE tenant_id = '${tenantId}' 
        ORDER BY created_at DESC LIMIT 10
      `).catch(() => [])
    ]);

    const settings = settingsRows[0] || {};
    const tenant = tenantRows.rows[0] || {};
    const billing_history = billingRows;

    return NextResponse.json({ settings, tenant, billing_history });
  } catch (err: any) {
    if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('[Settings GET Error]', err);
    return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 });
  }
}

// PUT: save settings for this tenant
export async function PUT(req: Request) {
  try {
    const tenantId = getTenantId();
    const body = await req.json();
    const {
      business_name, owner_email, owner_phone,
      currency, tax_rate, receipt_footer, receipt_logo_data_url,
      mtn_momo_enabled, mtn_momo_number, airtel_enabled, airtel_number, zra_enabled, zra_tpin
    } = body;

    await fetchTenantQuery(tenantId, `
      INSERT INTO tenant_settings 
        (tenant_id, business_name, owner_email, owner_phone, currency, tax_rate, receipt_footer, receipt_logo_data_url, mtn_momo_enabled, mtn_momo_number, airtel_enabled, airtel_number, zra_enabled, zra_tpin, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
      ON CONFLICT (tenant_id) DO UPDATE SET
        business_name = EXCLUDED.business_name,
        owner_email = EXCLUDED.owner_email,
        owner_phone = EXCLUDED.owner_phone,
        currency = EXCLUDED.currency,
        tax_rate = EXCLUDED.tax_rate,
        receipt_footer = EXCLUDED.receipt_footer,
        receipt_logo_data_url = EXCLUDED.receipt_logo_data_url,
        mtn_momo_enabled = EXCLUDED.mtn_momo_enabled,
        mtn_momo_number = EXCLUDED.mtn_momo_number,
        airtel_enabled = EXCLUDED.airtel_enabled,
        airtel_number = EXCLUDED.airtel_number,
        zra_enabled = EXCLUDED.zra_enabled,
        zra_tpin = EXCLUDED.zra_tpin,
        updated_at = NOW()
    `, [
      tenantId, business_name, owner_email, owner_phone, currency || 'ZMW', tax_rate || 16.00, receipt_footer, receipt_logo_data_url || null,
      mtn_momo_enabled || false, mtn_momo_number || null, airtel_enabled || false, airtel_number || null,
      zra_enabled || false, zra_tpin || null
    ]);

    // Also update the tenant name in the tenants table if changed
    if (business_name) {
      await adminPool.query(`UPDATE tenants SET name = $1, updated_at = NOW() WHERE id = $2`, [business_name, tenantId]);
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('[Settings PUT Error]', err);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}
