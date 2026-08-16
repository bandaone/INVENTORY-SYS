export const dynamic = "force-dynamic";
import { fetchTenantQuery, adminPool } from '@/lib/db';
import { getTenantBillingOverview } from '@/lib/billing';
import { requireTenantSession, SessionError } from '@/lib/session';
import { NextResponse } from 'next/server';

// GET: load settings for this tenant
export async function GET() {
  try {
    const { tenantId } = await requireTenantSession(['owner'], { allowSuspended: true });

    const [settingsRows, billing] = await Promise.all([
      fetchTenantQuery(tenantId, `
        SELECT * FROM tenant_settings WHERE tenant_id = $1
      `, [tenantId]).catch(() => []),
      getTenantBillingOverview(tenantId),
    ]);

    const settings = settingsRows[0] || {};
    const tenant = {
      id: billing.subscription.tenant_id,
      name: billing.subscription.tenant_name,
      status: billing.subscription.tenant_status,
      subscription_tier: billing.subscription.plan.code,
      subscription_end_date: billing.subscription.subscription_end_date,
      max_locations: billing.subscription.plan.max_locations,
      max_users: billing.subscription.plan.max_users,
      active_locations: billing.subscription.active_locations,
      active_users: billing.subscription.active_users,
    };
    // Compatibility adapter for the existing settings view. New billing
    // surfaces consume the canonical `billing` object below.
    const billing_history = billing.payments.map((payment) => ({
      id: payment.id,
      event_type: 'subscription_payment',
      amount: Number(payment.amount),
      currency: payment.currency,
      status: payment.status,
      due_at: payment.created_at,
      effective_at: payment.succeeded_at || payment.created_at,
    }));

    return NextResponse.json({ settings, tenant, billing_history, billing });
  } catch (err: any) {
    if (err instanceof SessionError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[Settings GET Error]', err);
    return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 });
  }
}

// PUT: save settings for this tenant
export async function PUT(req: Request) {
  try {
    const { tenantId } = await requireTenantSession(['owner']);
    const body = await req.json();
    const {
      business_name, owner_email, owner_phone,
      currency, tax_rate, receipt_footer, receipt_logo_data_url,
      mtn_momo_enabled, mtn_momo_number, airtel_enabled, airtel_number, zra_enabled
    } = body;

    const businessName = typeof business_name === 'string' ? business_name.trim() : '';
    const ownerEmail = typeof owner_email === 'string' ? owner_email.trim().toLocaleLowerCase() : '';
    const ownerPhone = typeof owner_phone === 'string' ? owner_phone.trim() : '';
    const safeCurrency = String(currency || 'ZMW').toUpperCase();
    const taxRate = Number(tax_rate);
    const receiptFooter = typeof receipt_footer === 'string' ? receipt_footer.trim() : '';
    const logo = typeof receipt_logo_data_url === 'string' ? receipt_logo_data_url.trim() : '';
    if (!businessName || businessName.length > 160) {
      return NextResponse.json({ error: 'Business name is required and must be 160 characters or fewer' }, { status: 400 });
    }
    if (ownerEmail && (ownerEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail))) {
      return NextResponse.json({ error: 'Enter a valid billing email' }, { status: 400 });
    }
    if (!/^[A-Z]{3}$/.test(safeCurrency) || !Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
      return NextResponse.json({ error: 'Currency or tax rate is invalid' }, { status: 400 });
    }
    if (receiptFooter.length > 500 || ownerPhone.length > 40) {
      return NextResponse.json({ error: 'Receipt footer or phone number is too long' }, { status: 400 });
    }
    if (logo && (logo.length > 1_500_000 || !/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(logo))) {
      return NextResponse.json({ error: 'Receipt logo must be a PNG, JPEG, or WEBP image under 1 MB' }, { status: 400 });
    }

    await fetchTenantQuery(tenantId, `
      INSERT INTO tenant_settings 
        (tenant_id, business_name, owner_email, owner_phone, currency, tax_rate, receipt_footer, receipt_logo_data_url, mtn_momo_enabled, mtn_momo_number, airtel_enabled, airtel_number, zra_enabled, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,FALSE,NOW())
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
        zra_enabled = CASE WHEN $13::boolean = FALSE THEN FALSE ELSE tenant_settings.zra_enabled END,
        updated_at = NOW()
    `, [
      tenantId, businessName, ownerEmail || null, ownerPhone || null, safeCurrency, taxRate, receiptFooter || null, logo || null,
      mtn_momo_enabled === true, typeof mtn_momo_number === 'string' ? mtn_momo_number.trim() || null : null,
      airtel_enabled === true, typeof airtel_number === 'string' ? airtel_number.trim() || null : null,
      zra_enabled === true,
    ]);

    // Also update the tenant name in the tenants table if changed
    await adminPool.query(`UPDATE tenants SET name = $1, updated_at = NOW() WHERE id = $2`, [businessName, tenantId]);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    if (err instanceof SessionError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[Settings PUT Error]', err);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}
