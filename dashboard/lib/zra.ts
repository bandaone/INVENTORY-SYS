/**
 * lib/zra.ts — ZRA Smart Invoice (VSDC) Service
 *
 * Handles all communication with the tenant's locally-deployed VSDC server.
 * The VSDC is a Java app running on the tenant's premises that bridges our
 * cloud POS to ZRA's central servers.
 *
 * Architecture:
 *   Retail OS Cloud ──► Tenant's VSDC (local) ──► ZRA Central Server
 *
 * If the VSDC is unreachable, transactions are queued in zra_sync_queue
 * for automatic retry by the cron job at /api/cron/zra-sync.
 */

import { pool } from '@/lib/db';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ZraTenantConfig {
  tpin: string;
  bhfId: string;          // Branch ID (e.g. "000")
  vsdcUrl: string;        // e.g. "http://192.168.1.10:8080"
  dvcSrlNo: string;       // Device serial number
  lastInvcNo: number;     // Auto-incremented invoice counter
}

export interface ZraCartItem {
  itemCd: string;         // ZRA item code
  itemNm: string;         // Product name
  qty: number;
  prc: number;            // Unit price (inclusive of tax)
  taxTyCd: 'A' | 'B' | 'E'; // A=16% VAT, B=Zero-rated, E=Exempt
  dcRt?: number;          // Discount rate %
  dcAmt?: number;         // Discount amount
}

export interface ZraSaleResult {
  success: boolean;
  rcptNo?: string;        // ZRA official receipt number
  intrlData?: string;     // QR code payload string
  mrcNo?: string;         // Machine receipt code
  error?: string;
  queued?: boolean;       // true if saved offline for later retry
}

// Payment type codes ZRA expects
const PAYMENT_TYPE_MAP: Record<string, string> = {
  CASH:         '01',
  MOBILE_MONEY: '02',
  CARD:         '03',
  CREDIT:       '04',
};

// ─── Tax Calculation Helpers ─────────────────────────────────────────────────

/**
 * Splits an inclusive (VAT-inclusive) total price into taxable and VAT components.
 * ZRA uses inclusive tax: total = taxable + VAT → taxable = total / 1.16
 */
export function splitVat(inclAmt: number, taxTyCd: 'A' | 'B' | 'E') {
  if (taxTyCd === 'A') {
    const taxblAmt = parseFloat((inclAmt / 1.16).toFixed(2));
    const vatAmt   = parseFloat((inclAmt - taxblAmt).toFixed(2));
    return { taxblAmt, vatAmt };
  }
  // B = zero-rated, E = exempt → no VAT
  return { taxblAmt: inclAmt, vatAmt: 0 };
}

// ─── Core API Calls ──────────────────────────────────────────────────────────

/**
 * POST to the tenant's local VSDC with a timeout.
 * Returns null if VSDC is unreachable (offline queuing triggers).
 */
async function vsdcPost(vsdcUrl: string, path: string, body: object): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000); // 8s timeout

  try {
    const res = await fetch(`${vsdcUrl.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`VSDC HTTP ${res.status}: ${errText}`);
    }
    return await res.json();
  } catch (err: any) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') throw new Error('VSDC server timed out (8s). Check network connection.');
    throw err;
  }
}

/**
 * Phase 1 (one-time): Initialize device with ZRA.
 * Call this from /api/zra/initialize when the tenant first activates Smart Invoice.
 * Fetches security keys + fiscal codes from ZRA via their local VSDC.
 */
export async function initializeDevice(config: ZraTenantConfig): Promise<{ success: boolean; error?: string; data?: any }> {
  try {
    const body = {
      tpin:     config.tpin,
      bhfId:    config.bhfId,
      dvcSrlNo: config.dvcSrlNo,
    };

    const result = await vsdcPost(config.vsdcUrl, '/initializer/selectInitInfo', body);

    if (result?.resultCd !== '000') {
      return { success: false, error: `ZRA rejected initialization: ${result?.resultMsg || 'Unknown error'}` };
    }

    return { success: true, data: result };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Phase 2 (on product create/update): Sync item to ZRA catalog.
 * Ensures ZRA has a record of every product variant sold through the system.
 */
export async function syncItem(config: ZraTenantConfig, item: {
  itemCd: string;
  itemNm: string;
  prc: number;
  taxTyCd: 'A' | 'B' | 'E';
  itemClsCd?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const body = {
      tpin:  config.tpin,
      bhfId: config.bhfId,
      items: [{
        itemCd:    item.itemCd,
        itemClsCd: item.itemClsCd || '57102001', // default: general merchandise
        itemNm:    item.itemNm,
        itemTyCd:  '2',       // 2 = finished product
        orgnNatCd: 'ZM',
        pkgUnitCd: 'NT',      // No packaging
        qtyUnitCd: 'U',       // Unit
        vatCatCd:  item.taxTyCd,
        taxTyCd:   item.taxTyCd,
        prc:       item.prc,
        useYn:     'Y',
      }],
    };

    const result = await vsdcPost(config.vsdcUrl, '/items/saveItems', body);

    if (result?.resultCd !== '000') {
      return { success: false, error: `ZRA item sync failed: ${result?.resultMsg}` };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Phase 3 (on every checkout): Submit sale to ZRA.
 * Returns the ZRA receipt number and QR code data to print on the receipt.
 * If the VSDC is offline, the transaction is queued in zra_sync_queue.
 */
export async function submitSale(
  config: ZraTenantConfig,
  tenantId: string,
  transactionId: string,
  params: {
    invcNo: number;
    paymentMethod: string;
    salesDt: string;        // YYYYMMDD
    items: ZraCartItem[];
  }
): Promise<ZraSaleResult> {
  // Build item list with VAT breakdown per line
  let itemSeq = 1;
  let totTaxblAmt = 0, totTaxAmt = 0, totAmt = 0;

  const itemList = params.items.map(item => {
    const lineTotal = item.prc * item.qty - (item.dcAmt || 0);
    const { taxblAmt, vatAmt } = splitVat(lineTotal, item.taxTyCd);

    totTaxblAmt += taxblAmt;
    totTaxAmt   += vatAmt;
    totAmt      += lineTotal;

    return {
      itemSeq:  itemSeq++,
      itemCd:   item.itemCd || '',
      itemNm:   item.itemNm,
      bcd:      '',
      qty:      item.qty,
      prc:      item.prc,
      splyAmt:  lineTotal,
      dcRt:     item.dcRt || 0,
      dcAmt:    item.dcAmt || 0,
      taxTyCd:  item.taxTyCd,
      taxblAmt: taxblAmt,
      taxAmt:   vatAmt,
      totAmt:   lineTotal,
      isrccCd:  '',
      isrccNm:  '',
      isrcRt:   0,
      isrcAmt:  0,
    };
  });

  const payload = {
    tpin:       config.tpin,
    bhfId:      config.bhfId,
    invcNo:     params.invcNo,
    orgInvcNo:  0,
    rcptTyCd:   'S',   // S = Sale
    pmtTyCd:    PAYMENT_TYPE_MAP[params.paymentMethod] || '01',
    salesDt:    params.salesDt,
    stockRlsDt: params.salesDt,
    cnclReqDt:  '',
    cnclDt:     '',
    rfdDt:      '',
    rfdRsnCd:   '',
    totItemCnt: itemList.length,
    taxblAmtA:  totTaxblAmt,
    taxblAmtB:  0,
    taxblAmtC:  0,
    taxblAmtD:  0,
    taxblAmtE:  0,
    taxRtA:     16,
    taxRtB:     0,
    taxRtC:     0,
    taxRtD:     0,
    taxRtE:     0,
    taxAmtA:    totTaxAmt,
    taxAmtB:    0,
    taxAmtC:    0,
    taxAmtD:    0,
    taxAmtE:    0,
    totTaxblAmt: parseFloat(totTaxblAmt.toFixed(2)),
    totTaxAmt:   parseFloat(totTaxAmt.toFixed(2)),
    totAmt:      parseFloat(totAmt.toFixed(2)),
    prchrAcptcYn: 'N',
    remark:       '',
    regrId:       tenantId,
    regrNm:       'RetailOS',
    modrId:       tenantId,
    modrNm:       'RetailOS',
    receipt:      { tradeNm: '', adrs: '', topMsg: '', btmMsg: '', prchrAcptcYn: 'N' },
    itemList,
  };

  try {
    const result = await vsdcPost(config.vsdcUrl, '/sales/saveSales', payload);

    if (result?.resultCd !== '000') {
      const errMsg = result?.resultMsg || 'ZRA rejected the sale';
      await queueForRetry(tenantId, transactionId, payload, errMsg);
      return { success: false, error: errMsg, queued: true };
    }

    const rcptNo    = result?.data?.rcptNo    || '';
    const intrlData = result?.data?.intrlData || '';
    const mrcNo     = result?.data?.mrcNo     || '';

    // Persist ZRA data on the transaction record
    await pool.query(
      `UPDATE transactions SET zra_rcpt_no=$1, zra_intrl_data=$2, zra_mrc_no=$3, zra_vsd_status='synced' WHERE id=$4`,
      [rcptNo, intrlData, mrcNo, transactionId]
    );

    return { success: true, rcptNo, intrlData, mrcNo };
  } catch (err: any) {
    console.error('[ZRA] VSDC unreachable — queuing for retry:', err.message);
    await queueForRetry(tenantId, transactionId, payload, err.message);
    return { success: false, error: err.message, queued: true };
  }
}

/**
 * Save a failed submission to zra_sync_queue for cron retry.
 */
async function queueForRetry(tenantId: string, transactionId: string, payload: object, error: string) {
  try {
    await pool.query(
      `INSERT INTO zra_sync_queue (tenant_id, transaction_id, payload, status, last_error)
       VALUES ($1, $2, $3, 'pending', $4)
       ON CONFLICT DO NOTHING`,
      [tenantId, transactionId, JSON.stringify(payload), error]
    );
    await pool.query(
      `UPDATE transactions SET zra_vsd_status='pending' WHERE id=$1`,
      [transactionId]
    );
  } catch (qErr) {
    console.error('[ZRA] Failed to queue for retry:', qErr);
  }
}

/**
 * Get the next sequential invoice number for a tenant (atomic increment).
 * ZRA requires each invoice to have a unique sequential number per device.
 */
export async function getNextInvoiceNo(tenantId: string): Promise<number> {
  const result = await pool.query(
    `UPDATE tenant_settings
     SET zra_last_invc_no = zra_last_invc_no + 1
     WHERE tenant_id = $1
     RETURNING zra_last_invc_no`,
    [tenantId]
  );
  return result.rows[0]?.zra_last_invc_no || 1;
}
