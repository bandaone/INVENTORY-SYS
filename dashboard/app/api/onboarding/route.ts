export const dynamic = "force-dynamic";
import { adminPool, fetchTenantQuery } from '@/lib/db';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const STEP_FIELDS: Record<string, { field: string; step: number; event: string }> = {
  business: { field: 'business_profile_completed', step: 2, event: 'BUSINESS_PROFILE_COMPLETED' },
  location: { field: 'location_created', step: 3, event: 'LOCATION_CONFIRMED' },
  team: { field: 'staff_created', step: 4, event: 'STAFF_SETUP_COMPLETED' },
  catalog: { field: 'products_loaded', step: 5, event: 'PRODUCTS_LOADED' },
  payments: { field: 'hardware_paired', step: 6, event: 'PAYMENTS_PREPARED' },
  tax: { field: 'first_stock_received', step: 7, event: 'TAX_SETUP_REVIEWED' },
  launch: { field: 'go_live_approved', step: 8, event: 'GO_LIVE_APPROVED' },
};

function getTenantContext() {
  const cookieStore = cookies();
  const tenantId = cookieStore.get('tenant_id')?.value;
  const staffId = cookieStore.get('staff_id')?.value;
  const staffRole = cookieStore.get('staff_role')?.value || '';
  if (!tenantId || staffRole !== 'owner') throw new Error('Unauthorized');
  return { tenantId, staffId };
}

async function markStep(tenantId: string, stepKey: string) {
  const step = STEP_FIELDS[stepKey];
  if (!step) throw new Error('Invalid step');

  await fetchTenantQuery(tenantId, `
    UPDATE onboarding_sessions
    SET ${step.field} = true,
        current_step = GREATEST(COALESCE(current_step, 1), $1),
        steps_completed = CASE
          WHEN $2 = ANY(COALESCE(steps_completed, '{}'::text[])) THEN steps_completed
          ELSE array_append(COALESCE(steps_completed, '{}'::text[]), $2)
        END,
        go_live_approved_at = CASE WHEN $2 = 'launch' THEN NOW() ELSE go_live_approved_at END,
        updated_at = NOW()
    WHERE tenant_id = $3
  `, [step.step, stepKey, tenantId]);

  await fetchTenantQuery(tenantId, `
    INSERT INTO onboarding_events (tenant_id, event_type, step_number)
    VALUES ($1, $2, $3)
  `, [tenantId, step.event, step.step]);
}

export async function GET() {
  try {
    const { tenantId } = getTenantContext();
    const [sessionRows, tenantRows, settingsRows, locationRows, staffRows, productRows, stockRows] = await Promise.all([
      fetchTenantQuery(tenantId, `SELECT * FROM onboarding_sessions WHERE tenant_id = $1 LIMIT 1`, [tenantId]),
      adminPool.query(`SELECT id, name, subscription_tier, status, zra_configured, created_at FROM tenants WHERE id = $1`, [tenantId]),
      fetchTenantQuery(tenantId, `SELECT * FROM tenant_settings WHERE tenant_id = $1 LIMIT 1`, [tenantId]).catch(() => []),
      fetchTenantQuery(tenantId, `SELECT id, name, address FROM locations WHERE tenant_id = $1 ORDER BY created_at ASC LIMIT 1`, [tenantId]),
      fetchTenantQuery(tenantId, `SELECT id, name, email, role, is_active FROM staff WHERE tenant_id = $1 ORDER BY created_at ASC`, [tenantId]),
      fetchTenantQuery(tenantId, `SELECT COUNT(*)::int AS count FROM variants WHERE tenant_id = $1`, [tenantId]),
      fetchTenantQuery(tenantId, `SELECT COUNT(*)::int AS count FROM garments WHERE tenant_id = $1 AND status = 'in_stock'`, [tenantId]),
    ]);

    return NextResponse.json({
      session: sessionRows[0] || null,
      tenant: tenantRows.rows[0] || null,
      settings: settingsRows[0] || null,
      location: locationRows[0] || null,
      staff: staffRows,
      counts: {
        products: Number(productRows[0]?.count || 0),
        stock: Number(stockRows[0]?.count || 0),
      },
    });
  } catch (err: any) {
    if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('[Onboarding GET]', err);
    return NextResponse.json({ error: 'Failed to load onboarding' }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const { tenantId } = getTenantContext();
    const body = await req.json();
    const step = String(body.step || '');
    const payload = body.payload || {};

    if (!STEP_FIELDS[step]) return NextResponse.json({ error: 'Invalid onboarding step' }, { status: 400 });

    if (step === 'business') {
      await fetchTenantQuery(tenantId, `
        INSERT INTO tenant_settings (tenant_id, business_name, owner_email, owner_phone, currency, tax_rate, receipt_footer, updated_at)
        VALUES ($1, $2, $3, $4, 'ZMW', 16, $5, NOW())
        ON CONFLICT (tenant_id) DO UPDATE SET
          business_name = EXCLUDED.business_name,
          owner_email = EXCLUDED.owner_email,
          owner_phone = EXCLUDED.owner_phone,
          receipt_footer = EXCLUDED.receipt_footer,
          updated_at = NOW()
      `, [
        tenantId,
        String(payload.business_name || '').trim(),
        String(payload.owner_email || '').trim(),
        String(payload.owner_phone || '').trim(),
        String(payload.receipt_footer || 'Thank you for shopping with us.').trim(),
      ]);

      if (payload.business_name) {
        await adminPool.query(`UPDATE tenants SET name = $1, updated_at = NOW() WHERE id = $2`, [payload.business_name, tenantId]);
      }
    }

    if (step === 'location') {
      const existing = await fetchTenantQuery(tenantId, `SELECT id FROM locations WHERE tenant_id = $1 ORDER BY created_at ASC LIMIT 1`, [tenantId]);
      if (existing[0]?.id) {
        await fetchTenantQuery(tenantId, `UPDATE locations SET name = $1, address = $2, updated_at = NOW() WHERE id = $3`, [
          String(payload.name || 'Main Store').trim(),
          String(payload.address || '').trim(),
          existing[0].id,
        ]);
      } else {
        await fetchTenantQuery(tenantId, `INSERT INTO locations (tenant_id, name, address) VALUES ($1, $2, $3)`, [
          tenantId,
          String(payload.name || 'Main Store').trim(),
          String(payload.address || '').trim(),
        ]);
      }
    }

    if (step === 'team' && payload.name && payload.pin) {
      if (!/^\d{4}$/.test(String(payload.pin))) return NextResponse.json({ error: 'PIN must be exactly 4 digits' }, { status: 400 });
      const locationRows = await fetchTenantQuery(tenantId, `SELECT id FROM locations WHERE tenant_id = $1 ORDER BY created_at ASC LIMIT 1`, [tenantId]);
      await fetchTenantQuery(tenantId, `
        INSERT INTO staff (tenant_id, name, email, role, pin_hash, location_id, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, true)
        ON CONFLICT (tenant_id, email) DO UPDATE SET
          name = EXCLUDED.name,
          role = EXCLUDED.role,
          pin_hash = EXCLUDED.pin_hash,
          location_id = EXCLUDED.location_id,
          is_active = true,
          updated_at = NOW()
      `, [
        tenantId,
        String(payload.name).trim(),
        payload.email ? String(payload.email).trim() : null,
        ['cashier', 'stock_clerk', 'store_manager'].includes(payload.role) ? payload.role : 'cashier',
        String(payload.pin),
        locationRows[0]?.id || null,
      ]);
    }

    if (step === 'catalog' && payload.product_name) {
      await fetchTenantQuery(tenantId, `
        INSERT INTO variants (tenant_id, name, category, color, size, cost_price, retail_price)
        VALUES ($1, $2, $3, $4, $5, 0, $6)
        ON CONFLICT ON CONSTRAINT unique_variant DO UPDATE SET
          category = EXCLUDED.category,
          retail_price = EXCLUDED.retail_price,
          updated_at = NOW()
      `, [
        tenantId,
        String(payload.product_name).trim(),
        String(payload.category || 'General').trim(),
        String(payload.color || '').trim() || null,
        String(payload.size || '').trim() || null,
        Number(payload.retail_price || 0),
      ]);
    }

    if (step === 'payments') {
      await fetchTenantQuery(tenantId, `
        INSERT INTO tenant_settings (
          tenant_id, business_name, currency, tax_rate, mtn_momo_enabled, mtn_momo_number, airtel_enabled, airtel_number, updated_at
        )
        VALUES ($1, NULL, 'ZMW', 16, $2, $3, $4, $5, NOW())
        ON CONFLICT (tenant_id) DO UPDATE SET
          mtn_momo_enabled = $2,
          mtn_momo_number = $3,
          airtel_enabled = $4,
          airtel_number = $5,
          updated_at = NOW()
      `, [
        tenantId,
        Boolean(payload.mtn_momo_enabled),
        String(payload.mtn_momo_number || '').trim() || null,
        Boolean(payload.airtel_enabled),
        String(payload.airtel_number || '').trim() || null,
      ]);
    }

    if (step === 'tax') {
      await fetchTenantQuery(tenantId, `
        INSERT INTO tenant_settings (
          tenant_id, business_name, currency, tax_rate, zra_enabled, zra_tpin, updated_at
        )
        VALUES ($1, NULL, 'ZMW', 16, $2, $3, NOW())
        ON CONFLICT (tenant_id) DO UPDATE SET
          zra_enabled = $2,
          zra_tpin = $3,
          updated_at = NOW()
      `, [tenantId, Boolean(payload.zra_enabled), String(payload.zra_tpin || '').trim() || null]);
      await adminPool.query(`UPDATE tenants SET zra_configured = $1, updated_at = NOW() WHERE id = $2`, [Boolean(payload.zra_enabled), tenantId]);
    }

    if (step === 'launch') {
      await adminPool.query(`UPDATE tenants SET updated_at = NOW() WHERE id = $1`, [tenantId]);
    }

    await markStep(tenantId, step);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (err.code === '23505') return NextResponse.json({ error: 'A record with those details already exists' }, { status: 409 });
    console.error('[Onboarding PATCH]', err);
    return NextResponse.json({ error: 'Failed to save onboarding step' }, { status: 500 });
  }
}
