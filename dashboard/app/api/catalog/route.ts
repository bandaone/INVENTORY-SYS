export const dynamic = "force-dynamic";
import { fetchTenantQuery } from '@/lib/db';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET() {
  try {
    const tenantId = cookies().get('tenant_id')?.value;
    if (!tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const rows = await fetchTenantQuery(tenantId, `
      SELECT id, name, category, subtype, color, size, cost_price, retail_price, discount_percent, reorder_threshold,
             barcode_token, barcode_payload, metadata, missing_fields, detail_status, search_text
      FROM variants
      ORDER BY name ASC, color ASC, size ASC
    `);
    return NextResponse.json(rows);
  } catch (err) {
    console.error('[Catalog GET]', err);
    return NextResponse.json({ error: 'Failed to load catalog' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const tenantId = cookies().get('tenant_id')?.value;
    if (!tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const {
      name,
      category,
      subtype,
      color,
      size,
      cost_price,
      retail_price,
      discount_percent,
      barcode_token,
      barcode_payload,
      metadata,
      missing_fields,
      detail_status,
      search_text,
      zra_tax_ty_cd,
    } = await req.json();

    if (!name?.trim()) return NextResponse.json({ error: 'Product name is required' }, { status: 400 });
    if (cost_price === undefined && retail_price === undefined) {
      return NextResponse.json({ error: 'At least one price is required' }, { status: 400 });
    }

    const nextRetailPrice = retail_price ?? cost_price;
    const nextCostPrice = cost_price ?? nextRetailPrice;
    const nextDiscountPercent = Number.isFinite(Number(discount_percent)) ? Math.max(0, Math.min(100, Number(discount_percent))) : 0;

    const rows = await fetchTenantQuery(tenantId, `
      INSERT INTO variants (tenant_id, name, category, subtype, color, size, cost_price, retail_price, discount_percent, barcode_token, barcode_payload, metadata, missing_fields, detail_status, search_text, zra_tax_ty_cd)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *
    `, [
      tenantId, 
      name.trim(), 
      category?.trim() || null, 
      subtype?.trim() || null,
      color?.trim() || null, 
      size?.trim() || null, 
      nextCostPrice,
      nextRetailPrice,
      nextDiscountPercent,
      barcode_token?.trim() || null,
      barcode_payload ? JSON.stringify(barcode_payload) : null,
      metadata ? JSON.stringify(metadata) : '{}',
      JSON.stringify(missing_fields || []),
      detail_status || 'complete',
      search_text?.trim() || null,
      zra_tax_ty_cd || 'A'
    ]);

    const variant = rows[0];

    // Background: If ZRA is enabled, sync this new item to the VSDC
    fetchTenantQuery(tenantId, 'SELECT zra_enabled, zra_tpin, zra_bhf_id, zra_vsdc_url FROM tenant_settings WHERE tenant_id=$1', [tenantId])
      .then(async (settings) => {
        const s = settings[0];
        if (s?.zra_enabled && s?.zra_vsdc_url) {
          const { syncItem } = await import('@/lib/zra');
          await syncItem({ tpin: s.zra_tpin, bhfId: s.zra_bhf_id, vsdcUrl: s.zra_vsdc_url, dvcSrlNo: '', lastInvcNo: 0 }, {
            itemCd: variant.id,
            itemNm: variant.name + (variant.color ? ` ${variant.color}` : '') + (variant.size ? ` ${variant.size}` : ''),
            prc: variant.retail_price,
            taxTyCd: variant.zra_tax_ty_cd as any
          });
        }
      })
      .catch(e => console.error('[ZRA Catalog Sync Failed]', e));

    return NextResponse.json({ success: true, variant });
  } catch (err: any) {
    if (err.code === '23505') { // Postgres Unique violation code
      return NextResponse.json({ error: 'This exact product (name + color + size) already exists.' }, { status: 409 });
    }
    console.error('[Catalog POST]', err);
    return NextResponse.json({ error: 'Failed to create product' }, { status: 500 });
  }
}
