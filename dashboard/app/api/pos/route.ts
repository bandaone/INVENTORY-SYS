export const dynamic = 'force-dynamic'

import { createHash, randomUUID } from 'node:crypto'
import { connectTenantClient, fetchTenantQuery } from '@/lib/db'
import { SessionError } from '@/lib/session'
import { requirePosTerminalSession } from '@/lib/pos-terminal'
import { NextResponse } from 'next/server'

const POS_ROLES = ['owner', 'store_manager', 'cashier'] as const
type PosRole = (typeof POS_ROLES)[number]
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DEVICE_PATTERN = /^[a-zA-Z0-9._:-]{1,100}$/

class PosError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'PosError'
    this.status = status
  }
}

interface CartItem {
  variant_id: string
  name: string
  price: number
  quantity: number
  discount_percent?: number
  serial?: string | null
}

type TenantSettings = {
  tax_rate?: number | string | null
  receipt_footer?: string | null
  receipt_logo_data_url?: string | null
  business_name?: string | null
  owner_phone?: string | null
  zra_tpin?: string | null
  zra_enabled?: boolean | null
  zra_vsdc_url?: string | null
  zra_bhf_id?: string | null
  zra_dvc_srl_no?: string | null
  currency?: string | null
}

async function requireActivePosSession(request: Request) {
  const session = await requirePosTerminalSession(request, POS_ROLES)
  const staffRows = await fetchTenantQuery(session.tenantId, `
    SELECT id, role, location_id
    FROM staff
    WHERE id = $1
      AND tenant_id = $2
      AND is_active = true
    LIMIT 1
  `, [session.staffId, session.tenantId])
  const staff = staffRows[0]

  if (!staff || staff.role !== session.role) {
    throw new SessionError('Session is no longer valid')
  }

  const currentLocationId = staff.location_id || null
  if (currentLocationId !== session.locationId) {
    throw new SessionError('Session location has changed. Please sign in again.')
  }

  if (!session.shiftId) {
    throw new SessionError('An active shift is required to process a sale.', 403)
  }
  const shifts = await fetchTenantQuery(session.tenantId, `
    SELECT id
    FROM shifts
    WHERE id = $1
      AND tenant_id = $2
      AND staff_id = $3
      AND location_id IS NOT DISTINCT FROM $4::uuid
      AND ended_at IS NULL
    LIMIT 1
  `, [session.shiftId, session.tenantId, session.staffId, session.locationId])
  if (!shifts.length) {
    throw new SessionError('Your shift is no longer active. Please sign in again.')
  }

  return { ...session, role: session.role as PosRole, shiftId: session.shiftId }
}

async function resolveSaleLocation(
  tenantId: string,
  role: PosRole,
  sessionLocationId: string | null,
  suppliedLocationId: unknown,
) {
  const requestedLocationId = typeof suppliedLocationId === 'string' ? suppliedLocationId.trim() : ''
  if (requestedLocationId && !UUID_PATTERN.test(requestedLocationId)) {
    throw new PosError('Invalid sale location.')
  }

  if (role !== 'owner') {
    if (!sessionLocationId) {
      throw new SessionError('Your account has no store location assigned.', 403)
    }
    if (requestedLocationId && requestedLocationId !== sessionLocationId) {
      throw new SessionError('You can only sell from your assigned location.', 403)
    }
  }

  const locationId = role !== 'owner'
    ? sessionLocationId
    : requestedLocationId || sessionLocationId
  if (!locationId) throw new PosError('Select a sale location.')

  const locations = await fetchTenantQuery(tenantId, `
    SELECT id
    FROM locations
    WHERE id = $1
      AND tenant_id = $2
      AND is_active = true
    LIMIT 1
  `, [locationId, tenantId])
  if (!locations.length) throw new PosError('The selected sale location is not available.', 403)

  return locationId
}

async function loadTenantSettings(tenantId: string): Promise<TenantSettings> {
  const rows = await fetchTenantQuery(tenantId, `
    SELECT tax_rate, receipt_footer, receipt_logo_data_url, business_name, owner_phone,
           zra_tpin, zra_enabled, zra_vsdc_url, zra_bhf_id, zra_dvc_srl_no, currency
    FROM tenant_settings
    WHERE tenant_id = $1
    LIMIT 1
  `, [tenantId]).catch(() => [])
  return rows[0] || {}
}

function taxRatePercent(settings: TenantSettings) {
  if (settings.tax_rate == null || settings.tax_rate === '') return 16
  const configured = Number(settings.tax_rate)
  return Number.isFinite(configured) && configured >= 0 ? configured : 16
}

function receiptNumber(idempotencyKey: string) {
  return `RCP-${idempotencyKey.replaceAll('-', '').toUpperCase()}`
}

function requestFingerprint(locationId: string, method: string, cart: CartItem[]) {
  const immutableIntent = {
    location_id: locationId,
    method,
    items: cart
      .map((item) => ({
        variant_id: item.variant_id,
        quantity: Number(item.quantity),
        serial: item.serial?.trim() || null,
      }))
      .sort((left, right) => (
        left.variant_id.localeCompare(right.variant_id)
        || String(left.serial || '').localeCompare(String(right.serial || ''))
      )),
  }
  return createHash('sha256').update(JSON.stringify(immutableIntent)).digest('hex')
}

function saleResponse(transaction: any, settings: TenantSettings, extras: Record<string, unknown> = {}) {
  const percent = taxRatePercent(settings)
  return {
    success: true,
    receipt: transaction.receipt_number,
    transactionId: transaction.id,
    total: Number(transaction.total),
    subtotal: Number(transaction.subtotal),
    tax: Number(transaction.tax),
    taxRatePercent: percent,
    discountTotal: Number(transaction.discount_total || 0),
    receiptFooter: settings.receipt_footer || 'Thank you for your business!',
    receiptLogoDataUrl: settings.receipt_logo_data_url || null,
    businessName: settings.business_name || 'RETAIL STORE',
    businessPhone: settings.owner_phone || '',
    zraTpin: settings.zra_tpin || '',
    zraEnabled: Boolean(settings.zra_enabled),
    zraRcptNo: transaction.zra_rcpt_no || '',
    zraIntrlData: transaction.zra_intrl_data || '',
    zraMrcNo: transaction.zra_mrc_no || '',
    zraQueued: transaction.zra_vsd_status === 'pending',
    ...extras,
  }
}

export async function POST(req: Request) {
  const startedAt = Date.now()
  let requestId = ''

  try {
    const session = await requireActivePosSession(req)
    const tenantId = session.tenantId
    const staffId = session.staffId

    let body: any
    try {
      body = await req.json()
    } catch {
      throw new PosError('The sale request is not valid JSON.')
    }

    const cart = body.cart as CartItem[]
    const method = body.method
    const customerEmail = typeof body.customer_email === 'string' ? body.customer_email.trim() : ''
    const providedRequestId = typeof body.idempotency_key === 'string' ? body.idempotency_key.trim() : ''
    requestId = providedRequestId || randomUUID()

    if (providedRequestId && !UUID_PATTERN.test(providedRequestId)) {
      throw new PosError('Invalid sale idempotency key.')
    }
    if (!Array.isArray(cart) || cart.length === 0) throw new PosError('Cart is empty')
    if (cart.length > 200) throw new PosError('A sale cannot contain more than 200 product lines.')
    if (cart.some((item) => (
      !item
      || typeof item.variant_id !== 'string'
      || !UUID_PATTERN.test(item.variant_id)
      || !Number.isInteger(Number(item.quantity))
      || Number(item.quantity) < 1
      || Number(item.quantity) > 500
      || (item.serial != null && typeof item.serial !== 'string')
      || (item.serial != null && Number(item.quantity) !== 1)
    ))) {
      throw new PosError('One or more cart items are invalid.')
    }
    if (!['CASH', 'MOBILE_MONEY', 'SPLIT'].includes(method)) {
      throw new PosError('Invalid payment method.')
    }
    if (customerEmail.length > 320) throw new PosError('Receipt email is too long.')

    const clientCreatedAt = typeof body.client_created_at === 'string'
      && Number.isFinite(Date.parse(body.client_created_at))
      ? new Date(body.client_created_at)
      : new Date()
    if (clientCreatedAt.getTime() > Date.now() + 5 * 60 * 1000) {
      throw new PosError('The POS device clock is ahead. Correct its time before completing the sale.')
    }
    if (clientCreatedAt.getTime() < Date.now() - 30 * 24 * 60 * 60 * 1000) {
      throw new PosError('This offline sale is more than 30 days old and needs manager review.', 409)
    }

    const sourceDeviceId = typeof body.device_id === 'string' && DEVICE_PATTERN.test(body.device_id)
      ? body.device_id
      : null
    const locationId = await resolveSaleLocation(tenantId, session.role, session.locationId, body.location_id)
    const fingerprint = requestFingerprint(locationId, method, cart)

    const existingRows = await fetchTenantQuery(tenantId, `
      SELECT id, receipt_number, location_id, cashier_id, client_request_fingerprint,
             subtotal, tax, total, zra_rcpt_no, zra_intrl_data, zra_mrc_no, zra_vsd_status,
             COALESCE((
               SELECT SUM(item.discount_amount * item.quantity)
               FROM transaction_items item
               WHERE item.transaction_id = transactions.id
             ), 0) AS discount_total
      FROM transactions
      WHERE tenant_id = $1 AND client_request_id = $2
      LIMIT 1
    `, [tenantId, requestId])
    if (existingRows.length) {
      const existing = existingRows[0]
      if (
        existing.client_request_fingerprint !== fingerprint
        || existing.cashier_id !== staffId
        || existing.location_id !== locationId
      ) {
        throw new PosError('This sale reference was already used for a different transaction.', 409)
      }
      const settings = await loadTenantSettings(tenantId)
      console.info('[POS Sale]', JSON.stringify({
        requestId,
        transactionId: existing.id,
        tenantId,
        locationId,
        replayed: true,
        durationMs: Date.now() - startedAt,
      }))
      return NextResponse.json(saleResponse(existing, settings, { replayed: true }))
    }

    const [settings, catalogRows] = await Promise.all([
      loadTenantSettings(tenantId),
      fetchTenantQuery(tenantId, `
        SELECT id, name, retail_price, discount_percent, category, subtype, color, size,
               metadata, search_text, zra_item_cd, zra_tax_ty_cd
        FROM variants
        WHERE id = ANY($1::uuid[])
          AND tenant_id = $2
      `, [Array.from(new Set(cart.map((item) => item.variant_id))), tenantId]),
    ])

    const variantIds = Array.from(new Set(cart.map((item) => item.variant_id)))
    if (variantIds.length !== cart.length) {
      throw new PosError('Combine duplicate product lines before checkout.')
    }
    const variantsById = new Map(catalogRows.map((row: any) => [row.id, row]))
    if (variantIds.some((id) => !variantsById.has(id))) {
      throw new PosError('One or more cart items no longer exist in the catalog. Refresh POS and add them again.')
    }

    const cartPricing = cart.map((item) => {
      const variant: any = variantsById.get(item.variant_id)
      const basePrice = Number(variant.retail_price)
      const autoDiscount = Number(variant.discount_percent || 0)
      const discountPercent = Math.max(0, Math.min(100, autoDiscount))
      const discountAmount = basePrice * (discountPercent / 100)
      const unitPrice = basePrice - discountAmount
      return {
        ...item,
        name: variant.name,
        quantity: Number(item.quantity),
        serial: item.serial?.trim() || null,
        basePrice,
        discountPercent,
        discountAmount,
        unitPrice,
        lineTotal: unitPrice * Number(item.quantity),
      }
    })

    const grossTotal = cartPricing.reduce((sum, item) => sum + item.basePrice * item.quantity, 0)
    const discountTotal = cartPricing.reduce((sum, item) => sum + item.discountAmount * item.quantity, 0)
    const total = cartPricing.reduce((sum, item) => sum + item.lineTotal, 0)
    const percent = taxRatePercent(settings)
    const taxRate = percent / 100
    const tax = taxRate > 0 ? total - total / (1 + taxRate) : 0
    const subtotal = total - tax

    const client = await connectTenantClient()
    let transaction: any = null
    let replayed = false

    try {
      await client.query('BEGIN')
      await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId])
      await client.query(`SET LOCAL lock_timeout = '4s'`)
      await client.query(`SET LOCAL statement_timeout = '20s'`)

      const activeShift = await client.query(`
        SELECT id
        FROM shifts
        WHERE id = $1
          AND tenant_id = $2
          AND staff_id = $3
          AND location_id IS NOT DISTINCT FROM $4::uuid
          AND ended_at IS NULL
        FOR UPDATE
      `, [session.shiftId, tenantId, staffId, locationId])
      if (!activeShift.rows.length) {
        throw new SessionError('Your shift ended before this sale could be recorded. Sign in and review pending sales.', 409)
      }

      const inserted = await client.query(`
        INSERT INTO transactions (
          tenant_id, receipt_number, location_id, cashier_id, shift_id, payment_method,
          subtotal, tax, total, client_request_id, client_request_fingerprint,
          client_created_at, source_device_id
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT (tenant_id, client_request_id)
          WHERE client_request_id IS NOT NULL
          DO NOTHING
        RETURNING id, receipt_number, subtotal, tax, total,
                  zra_rcpt_no, zra_intrl_data, zra_mrc_no, zra_vsd_status
      `, [
        tenantId,
        receiptNumber(requestId),
        locationId,
        staffId,
        session.shiftId,
        method,
        subtotal,
        tax,
        total,
        requestId,
        fingerprint,
        clientCreatedAt.toISOString(),
        sourceDeviceId,
      ])

      if (!inserted.rows.length) {
        const duplicate = await client.query(`
          SELECT id, receipt_number, location_id, cashier_id, client_request_fingerprint,
                 subtotal, tax, total, zra_rcpt_no, zra_intrl_data, zra_mrc_no, zra_vsd_status,
                 COALESCE((
                   SELECT SUM(item.discount_amount * item.quantity)
                   FROM transaction_items item
                   WHERE item.transaction_id = transactions.id
                 ), 0) AS discount_total
          FROM transactions
          WHERE tenant_id = $1 AND client_request_id = $2
          LIMIT 1
        `, [tenantId, requestId])
        transaction = duplicate.rows[0]
        if (
          !transaction
          || transaction.client_request_fingerprint !== fingerprint
          || transaction.cashier_id !== staffId
          || transaction.location_id !== locationId
        ) {
          throw new PosError('This sale reference was already used for a different transaction.', 409)
        }
        replayed = true
      } else {
        transaction = { ...inserted.rows[0], discount_total: discountTotal }
        const orderedItems = [...cartPricing].sort((left, right) => (
          left.variant_id.localeCompare(right.variant_id)
          || String(left.serial || '').localeCompare(String(right.serial || ''))
        ))

        for (const item of orderedItems) {
          const lockedStock = item.serial
            ? await client.query(`
                SELECT serial
                FROM garments
                WHERE tenant_id = $1
                  AND serial = $2
                  AND variant_id = $3
                  AND status = 'in_stock'
                  AND location_id = $4
                FOR UPDATE SKIP LOCKED
              `, [tenantId, item.serial, item.variant_id, locationId])
            : await client.query(`
                SELECT serial
                FROM garments
                WHERE tenant_id = $1
                  AND variant_id = $2
                  AND status = 'in_stock'
                  AND location_id = $3
                ORDER BY serial
                FOR UPDATE SKIP LOCKED
                LIMIT $4
              `, [tenantId, item.variant_id, locationId, item.quantity])

          if (lockedStock.rows.length !== item.quantity) {
            throw new PosError(
              `Insufficient available stock for ${item.name}. Requested ${item.quantity}; available now ${lockedStock.rows.length}.`,
              409,
            )
          }

          for (const stock of lockedStock.rows) {
            const updated = await client.query(`
              UPDATE garments
              SET status = 'sold', updated_at = NOW()
              WHERE tenant_id = $1
                AND serial = $2
                AND variant_id = $3
                AND location_id = $4
                AND status = 'in_stock'
            `, [tenantId, stock.serial, item.variant_id, locationId])
            if (updated.rowCount !== 1) {
              throw new PosError(`The selected item ${item.name} is no longer available.`, 409)
            }

            await client.query(`
              INSERT INTO transaction_items (
                transaction_id, garment_serial, variant_id, description, unit_price,
                discount_percent, discount_amount, total_price, quantity
              )
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1)
            `, [
              transaction.id,
              stock.serial,
              item.variant_id,
              item.name,
              item.unitPrice,
              item.discountPercent,
              item.discountAmount,
              item.unitPrice,
            ])

            await client.query(`
              INSERT INTO stock_movements (
                tenant_id, garment_serial, movement_type, from_location_id, to_location_id,
                from_status, to_status, actor_id, device_id, transaction_id, notes
              )
              VALUES ($1,$2,'SALE',$3,NULL,'in_stock','sold',$4,$5,$6,$7)
              ON CONFLICT DO NOTHING
            `, [
              tenantId,
              stock.serial,
              locationId,
              staffId,
              sourceDeviceId,
              transaction.id,
              `POS sale ${transaction.receipt_number}`,
            ])
          }
        }

        const shiftUpdated = await client.query(`
          UPDATE shifts
          SET transactions_count = transactions_count + 1,
              total_sales = total_sales + $1,
              discount_total = discount_total + $2
          WHERE id = $3 AND tenant_id = $4 AND staff_id = $5 AND ended_at IS NULL
        `, [total, discountTotal, session.shiftId, tenantId, staffId])
        if (shiftUpdated.rowCount !== 1) {
          throw new SessionError('Your shift ended before this sale could be recorded.', 409)
        }

        await client.query(`
          INSERT INTO audit_trail (
            tenant_id, action_type, actor_id, actor_role, resource_type, resource_id, changes
          )
          VALUES ($1, 'SALE_COMPLETED', $2, $3, 'transaction', $4, $5)
        `, [tenantId, staffId, session.role, transaction.id, JSON.stringify({
          receipt_number: transaction.receipt_number,
          gross_total: grossTotal,
          discount_total: discountTotal,
          total,
          method,
          shift_id: session.shiftId,
          client_request_id: requestId,
          client_created_at: clientCreatedAt.toISOString(),
          source_device_id: sourceDeviceId,
        })])
      }

      await client.query('COMMIT')
    } catch (error: any) {
      await client.query('ROLLBACK').catch(() => undefined)
      if (error instanceof PosError || error instanceof SessionError) throw error
      if (error?.code === '55P03' || error?.code === '40P01') {
        throw new PosError('Inventory is busy with another sale. This sale is safe to retry.', 409)
      }
      console.error('[POS Database Transaction]', {
        requestId,
        code: error?.code,
        message: error?.message,
      })
      throw new PosError('The sale could not be committed. It is safe to retry.', 500)
    } finally {
      client.release()
    }

    if (replayed) {
      console.info('[POS Sale]', JSON.stringify({
        requestId,
        transactionId: transaction.id,
        tenantId,
        locationId,
        replayed: true,
        durationMs: Date.now() - startedAt,
      }))
      return NextResponse.json(saleResponse(transaction, settings, { replayed: true }))
    }

    let zraRcptNo = ''
    let zraIntrlData = ''
    let zraMrcNo = ''
    let zraQueued = false

    if (settings.zra_enabled && settings.zra_vsdc_url && settings.zra_tpin) {
      try {
        const { submitSale, getNextInvoiceNo } = await import('@/lib/zra')
        const invcNo = await getNextInvoiceNo(tenantId)
        const salesDt = new Date().toISOString().slice(0, 10).replace(/-/g, '')
        const zraItems = cartPricing.map((item) => {
          const variant: any = variantsById.get(item.variant_id)
          return {
            itemCd: variant?.zra_item_cd || '',
            itemNm: item.name,
            qty: item.quantity,
            prc: item.unitPrice,
            taxTyCd: (variant?.zra_tax_ty_cd || 'A') as 'A' | 'B' | 'E',
            dcRt: item.discountPercent,
            dcAmt: item.discountAmount * item.quantity,
          }
        })

        const zraResult = await submitSale(
          {
            tpin: settings.zra_tpin,
            bhfId: settings.zra_bhf_id || '000',
            vsdcUrl: settings.zra_vsdc_url,
            dvcSrlNo: settings.zra_dvc_srl_no || '',
            lastInvcNo: 0,
          },
          tenantId,
          transaction.id,
          { invcNo, paymentMethod: method, salesDt, items: zraItems },
        )

        if (zraResult.success) {
          zraRcptNo = zraResult.rcptNo || ''
          zraIntrlData = zraResult.intrlData || ''
          zraMrcNo = zraResult.mrcNo || ''
        } else {
          zraQueued = Boolean(zraResult.queued)
          console.warn('[ZRA] Submission failed/queued:', zraResult.error)
        }
      } catch (error: any) {
        console.error('[ZRA] Fatal error during submission:', error.message)
        zraQueued = true
      }
    }

    if (customerEmail) {
      try {
        const { sendDigitalReceiptEmail } = await import('@/lib/email')
        const emailResult = await sendDigitalReceiptEmail(customerEmail, {
          receiptNum: transaction.receipt_number,
          total,
          method,
          receiptFooter: settings.receipt_footer || 'Thank you for your business!',
          businessName: settings.business_name || 'RETAIL STORE',
          items: cartPricing,
        })
        if (!emailResult.success) console.error('Email delivery error:', emailResult.error)
      } catch (error) {
        console.error('Receipt email failed critically:', error)
      }
    }

    console.info('[POS Sale]', JSON.stringify({
      requestId,
      transactionId: transaction.id,
      tenantId,
      locationId,
      units: cartPricing.reduce((sum, item) => sum + item.quantity, 0),
      replayed: false,
      durationMs: Date.now() - startedAt,
    }))

    return NextResponse.json(saleResponse({
      ...transaction,
      zra_rcpt_no: zraRcptNo,
      zra_intrl_data: zraIntrlData,
      zra_mrc_no: zraMrcNo,
      zra_vsd_status: zraQueued ? 'pending' : transaction.zra_vsd_status,
    }, settings, { zraQueued }))
  } catch (error) {
    if (error instanceof SessionError || error instanceof PosError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('[POS Checkout Error]', { requestId, error })
    return NextResponse.json({ error: 'Failed to process sale' }, { status: 500 })
  }
}
