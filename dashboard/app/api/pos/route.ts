export const dynamic = "force-dynamic";
import { fetchTenantQuery, pool } from '@/lib/db';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

interface CartItem {
  variant_id: string;
  name: string;
  price: number;
  quantity: number;
  discount_percent?: number;
  serial?: string | null;
}

export async function POST(req: Request) {
  try {
    const cookieStore = cookies();
    const tenantId = cookieStore.get('tenant_id')?.value;
    const staffId = cookieStore.get('staff_id')?.value;
    if (!tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { cart, method, location_id, customer_email } = await req.json();

    if (!cart || cart.length === 0) {
      return NextResponse.json({ error: 'Cart is empty' }, { status: 400 });
    }

    // Resolve location: use provided, or first active location for this tenant
    let locationId = location_id;
    if (!locationId) {
      const loc = await fetchTenantQuery(tenantId, `SELECT id FROM locations WHERE is_active = true LIMIT 1`);
      if (!loc.length) return NextResponse.json({ error: 'No active location found for this tenant' }, { status: 400 });
      locationId = loc[0].id;
    }

    // Resolve cashier: use session cookie or first active staff
    let cashierId = staffId;
    if (cashierId) {
      const cashier = await fetchTenantQuery(tenantId, `
        SELECT id FROM staff
        WHERE id = $1 AND is_active = true
        LIMIT 1
      `, [cashierId]);
      if (!cashier.length) cashierId = '';
    }

    if (!cashierId) {
      const staff = await fetchTenantQuery(tenantId, `SELECT id FROM staff WHERE is_active = true LIMIT 1`);
      if (staff.length) cashierId = staff[0].id;
    }

    if (!cashierId) {
      return NextResponse.json({ error: 'No active cashier found for this tenant' }, { status: 400 });
    }

    // Calculate totals using the tenant's configured tax rate (Inclusive Tax Calculation)
    const settings = await fetchTenantQuery(tenantId, `SELECT tax_rate, receipt_footer, receipt_logo_data_url, business_name, owner_phone, zra_tpin, zra_enabled, currency FROM tenant_settings WHERE tenant_id = '${tenantId}'`).catch(() => []);
    const taxRate = settings[0]?.tax_rate ? Number(settings[0].tax_rate) / 100 : 0.16;
    const taxRatePercent = settings[0]?.tax_rate ? Number(settings[0].tax_rate) : 16;
    const receiptFooter = settings[0]?.receipt_footer || 'Thank you for your business!';
    const receiptLogoDataUrl = settings[0]?.receipt_logo_data_url || null;
    const businessName = settings[0]?.business_name || 'RETAIL STORE';
    const businessPhone = settings[0]?.owner_phone || '';
    const zraTpin = settings[0]?.zra_tpin || '';
    const zraEnabled = settings[0]?.zra_enabled || false;

    const variantIds = Array.from(new Set((cart as CartItem[]).map(item => item.variant_id).filter(Boolean)));
    if (variantIds.length !== (cart as CartItem[]).length) {
      return NextResponse.json({
        error: 'One or more cart items are missing a product identity. Refresh POS and add the items again.',
      }, { status: 400 });
    }

    const catalogRows = variantIds.length
      ? await fetchTenantQuery(tenantId, `
        SELECT id, name, retail_price, discount_percent, category, subtype, color, size, metadata, search_text
        FROM variants
        WHERE id = ANY($1)
      `, [variantIds])
      : [];
    const variantsById = new Map(catalogRows.map((row: any) => [row.id, row]));

    const missingVariants = variantIds.filter((id) => !variantsById.has(id));
    if (missingVariants.length) {
      return NextResponse.json({
        error: 'One or more cart items no longer exist in the catalog. Refresh POS and add the items again.',
      }, { status: 400 });
    }

    const cartPricing = (cart as CartItem[]).map((item) => {
      const variant = variantsById.get(item.variant_id);
      const basePrice = Number(variant?.retail_price ?? item.price ?? 0);
      const autoDiscount = Number(variant?.discount_percent ?? 0);
      const manualDiscount = Number.isFinite(Number(item.discount_percent)) ? Math.max(0, Math.min(100, Number(item.discount_percent))) : 0;
      const discountPercent = Math.max(autoDiscount, manualDiscount);
      const discountAmount = basePrice * (discountPercent / 100);
      const unitPrice = basePrice - discountAmount;
      const lineTotal = unitPrice * item.quantity;
      return {
        ...item,
        basePrice,
        discountPercent,
        discountAmount,
        unitPrice,
        lineTotal,
      };
    });

    const grossTotal = cartPricing.reduce((s, i) => s + (i.basePrice * i.quantity), 0);
    const discountTotal = cartPricing.reduce((s, i) => s + (i.discountAmount * i.quantity), 0);
    const total = cartPricing.reduce((s, i) => s + i.lineTotal, 0);
    const tax = total - (total / (1 + taxRate));
    const subtotal = total - tax;

    // STRICT INVENTORY VALIDATION & TRANSACTION LOCKING
    const client = await pool.connect();
    let txId = '';
    const receiptNum = `RCP-${Date.now().toString(36).toUpperCase()}`;

    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_tenant = '${tenantId}'`);

      for (const item of cartPricing) {
        if (item.serial) {
          const stock = await client.query(`
            SELECT serial, variant_id, status, location_id
            FROM garments
            WHERE serial = $1 AND status = 'in_stock' AND location_id = $2
            FOR UPDATE
            LIMIT 1
          `, [item.serial, locationId]);

          if (!stock.rows.length) {
            throw new Error(`The selected item ${item.name} is no longer available.`);
          }
          continue;
        }

        const stock = await client.query(`
          SELECT serial FROM garments 
          WHERE variant_id = $1 AND status = 'in_stock' AND location_id = $2
          FOR UPDATE SKIP LOCKED
          LIMIT $3
        `, [item.variant_id, locationId, item.quantity]);
        
        if (stock.rows.length < item.quantity) {
          throw new Error(`Insufficient stock for ${item.name}. You tried to sell ${item.quantity}, but only ${stock.rows.length} are available.`);
        }
      }

      // Insert transaction record
      const txResult = await client.query(`
        INSERT INTO transactions (tenant_id, receipt_number, location_id, cashier_id, payment_method, subtotal, tax, total)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, receipt_number
      `, [tenantId, receiptNum, locationId, cashierId || null, method, subtotal, tax, total]);

      txId = txResult.rows[0].id;

      // For each cart item: find garments to mark as sold and insert line items
      for (const item of cartPricing) {
        const garmentsToSell = [];

        if (item.serial) {
           garmentsToSell.push(item.serial);
        } else {
           const lockedStock = await client.query(`
             SELECT serial FROM garments
             WHERE variant_id = $1 AND status = 'in_stock' AND location_id = $2
             FOR UPDATE SKIP LOCKED
             LIMIT $3
           `, [item.variant_id, locationId, item.quantity]);
           garmentsToSell.push(...lockedStock.rows.map(r => r.serial));
        }

        let qCount = 0;
        for (const serial of garmentsToSell) {
          // Mark garment sold
          await client.query(`
            UPDATE garments SET status = 'sold', updated_at = NOW() WHERE serial = $1
          `, [serial]);
          // Record transaction item
          await client.query(`
            INSERT INTO transaction_items (transaction_id, garment_serial, variant_id, unit_price, discount_percent, discount_amount, total_price, quantity)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 1)
          `, [txId, serial, item.variant_id, item.unitPrice, item.discountPercent, item.discountAmount, item.lineTotal / item.quantity]);
          qCount++;
        }

        while (qCount < item.quantity) {
          // Fallback: If no physical stock exists but cashier sold it anyway
          await client.query(`
            INSERT INTO transaction_items (transaction_id, description, variant_id, unit_price, discount_percent, discount_amount, total_price, quantity)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 1)
          `, [txId, 'Manual/Missing Stock: ' + item.name, item.variant_id, item.unitPrice, item.discountPercent, item.discountAmount, item.lineTotal / item.quantity]);
          qCount++;
        }
      }

      // Insert audit log
      const staffRole = cookieStore.get('staff_role')?.value || 'cashier';
      await client.query(`
        INSERT INTO audit_trail (tenant_id, action_type, actor_id, actor_role, resource_type, resource_id, changes)
        VALUES ($1, 'SALE_COMPLETED', $2, $3, 'transaction', $4, $5)
      `, [tenantId, cashierId || null, staffRole, txId, JSON.stringify({ receipt_number: receiptNum, gross_total: grossTotal, discount_total: discountTotal, total, method })]);

      await client.query('COMMIT');
    } catch (e: any) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: e.message || 'Transaction failed' }, { status: 400 });
    } finally {
      client.release();
    }

    if (customer_email) {
      try {
        const { sendDigitalReceiptEmail } = await import('@/lib/email');
        const emailResult = await sendDigitalReceiptEmail(customer_email, {
          receiptNum: receiptNum,
          total,
          method,
          receiptFooter,
          businessName,
          items: cartPricing
        });
        if (!emailResult.success) {
          console.error("Resend API rejected the email:", emailResult.error);
        }
      } catch (e) {
        console.error("Receipt email failed critically:", e);
      }
    }

    return NextResponse.json({ 
      success: true, 
      receipt: receiptNum, 
      transactionId: txId, 
      total,
      subtotal,
      tax,
      taxRatePercent,
      discountTotal,
      receiptFooter,
      receiptLogoDataUrl,
      businessName,
      businessPhone,
      zraTpin,
      zraEnabled
    });
  } catch (error) {
    console.error('[POS Checkout Error]', error);
    return NextResponse.json({ error: 'Failed to process sale' }, { status: 500 });
  }
}
