export const dynamic = 'force-dynamic'

import { fetchTenantQuery } from '@/lib/db'
import { SessionError } from '@/lib/session'
import { requirePosTerminalSession } from '@/lib/pos-terminal'
import { NextResponse } from 'next/server'

const POS_ROLES = ['owner', 'store_manager', 'cashier'] as const

export async function GET(request: Request) {
  try {
    const session = await requirePosTerminalSession(request, POS_ROLES)
    const rows = await fetchTenantQuery(session.tenantId, `
      SELECT tax_rate, receipt_footer, receipt_logo_data_url, business_name,
             owner_phone, zra_tpin, zra_enabled
      FROM tenant_settings
      WHERE tenant_id = $1
      LIMIT 1
    `, [session.tenantId])
    const settings = rows[0] || {}
    const configuredTaxRate = settings.tax_rate == null || settings.tax_rate === ''
      ? 16
      : Number(settings.tax_rate)

    return NextResponse.json({
      taxRatePercent: Number.isFinite(configuredTaxRate) ? configuredTaxRate : 16,
      receiptFooter: settings.receipt_footer || 'Thank you for your business!',
      receiptLogoDataUrl: settings.receipt_logo_data_url || null,
      businessName: settings.business_name || 'RETAIL STORE',
      businessPhone: settings.owner_phone || '',
      zraTpin: settings.zra_tpin || '',
      zraEnabled: Boolean(settings.zra_enabled),
    })
  } catch (error) {
    if (error instanceof SessionError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('[POS Config Error]', error)
    return NextResponse.json({ error: 'Failed to fetch POS configuration' }, { status: 500 })
  }
}
