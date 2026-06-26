import { MedusaService } from "@medusajs/framework/utils"
import crypto from "crypto"

type ZraCertificate = {
  tpin: string
  private_key: string
  certificate: string
  encrypted: boolean
}

type InvoiceData = {
  receipt_number: string
  total_amount: number
  tax_amount: number
  timestamp: Date
  tenant_tin: string
  items: Array<{
    description: string
    quantity: number
    unit_price: number
    tax_amount: number
  }>
}

export default class ZraInvoiceService extends MedusaService({}) {
  private readonly gatewayUrl: string
  private readonly timeout: number

  constructor(container: any) {
    super(container)
    
    this.gatewayUrl = process.env.ZRA_GATEWAY_URL || "https://sandbox.zra.org.zm/api/v1"
    this.timeout = parseInt(process.env.ZRA_TIMEOUT_MS || "30000")
  }

  /**
   * Subscribe to order.placed event
   */
  async onOrderPlaced(data: { order: any }) {
    const { order } = data

    try {
      // Get tenant settings to retrieve ZRA certificate
      const certificate = await this.getTenantZraCertificate(order.tenant_id)

      if (!certificate) {
        console.warn(`No ZRA certificate found for tenant ${order.tenant_id}`)
        return
      }

      // Generate invoice
      const invoice = await this.generateInvoice(order, certificate)

      // Store signature on order (this would be done via order module)
      console.log("ZRA invoice generated:", invoice.signature)

      // Queue for transmission to ZRA gateway
      await this.queueInvoiceTransmission(invoice, order.id)

    } catch (error) {
      console.error("Failed to process ZRA invoice for order:", order.id, error)
      
      // Write to audit trail
      const auditTrailService = (this as any).container.resolve("audit_trail")
      await auditTrailService.logEvent({
        tenant_id: order.tenant_id,
        event_type: "ZRA_INVOICE_ERROR",
        actor_id: order.created_by,
        resource_type: "order",
        resource_id: order.id,
        payload: {
          error: error instanceof Error ? error.message : String(error),
        },
      })
    }
  }

  /**
   * Generate ZRA invoice with signature
   */
  async generateInvoice(order: any, certificate: ZraCertificate) {
    const invoiceData: InvoiceData = {
      receipt_number: order.display_id || order.id,
      total_amount: order.total,
      tax_amount: order.tax_total || 0,
      timestamp: new Date(order.created_at),
      tenant_tin: certificate.tpin,
      items: order.items.map((item: any) => ({
        description: item.title,
        quantity: item.quantity,
        unit_price: item.unit_price,
        tax_amount: item.tax_total || 0,
      })),
    }

    // Generate SHA-256 hash of invoice data
    const dataToSign = this.createSignatureData(invoiceData)
    const hash = crypto.createHash("sha256").update(dataToSign).digest()

    // Decrypt private key if encrypted
    const privateKey = certificate.encrypted
      ? this.decryptPrivateKey(certificate.private_key)
      : certificate.private_key

    // Sign with RSA private key
    const sign = crypto.createSign("RSA-SHA256")
    sign.update(hash)
    const signature = sign.sign(privateKey, "base64")

    // Generate QR code data
    const qrCodeData = this.generateQrCode(signature, invoiceData.receipt_number)

    return {
      ...invoiceData,
      signature,
      qrCodeData,
      signed_at: new Date(),
    }
  }

  /**
   * Queue invoice for transmission to ZRA gateway
   */
  private async queueInvoiceTransmission(invoice: any, order_id: string) {
    // Use Medusa's job queue to send invoice to ZRA.
    // This ensures retry logic if the gateway is unavailable.
    const jobSchedulerService = (this as any).container.resolve("jobSchedulerService")
    
    await jobSchedulerService.create("zra-invoice-transmission", {
      invoice,
      order_id,
    })
  }

  /**
   * Transmit invoice to ZRA gateway
   */
  async transmitInvoice(invoice: any, order_id: string) {
    try {
      const response = await fetch(`${this.gatewayUrl}/invoices`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tpin: invoice.tenant_tin,
          receipt_number: invoice.receipt_number,
          total_amount: invoice.total_amount,
          tax_amount: invoice.tax_amount,
          timestamp: invoice.timestamp,
          signature: invoice.signature,
          items: invoice.items,
        }),
        signal: AbortSignal.timeout(this.timeout),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(`ZRA gateway rejected invoice: ${JSON.stringify(error)}`)
      }

      const result = await response.json()
      console.log("ZRA invoice transmitted successfully:", result)

      return result

    } catch (error) {
      console.error("Failed to transmit invoice to ZRA gateway:", error)

      // Write rejection to audit trail
      const auditTrailService = (this as any).container.resolve("audit_trail")
      await auditTrailService.logEvent({
        tenant_id: invoice.tenant_id,
        event_type: "ZRA_INVOICE_REJECTION",
        resource_type: "order",
        resource_id: order_id,
        payload: {
          invoice_number: invoice.receipt_number,
          error: error instanceof Error ? error.message : String(error),
        },
      })

      // Emit notification event for Owner Dashboard
      const eventBusService = (this as any).container.resolve("eventBusService")
      await eventBusService.emit("zra.invoice.rejected", {
        order_id,
        invoice_number: invoice.receipt_number,
        error: error instanceof Error ? error.message : String(error),
      })

      throw error
    }
  }

  /**
   * Get tenant's ZRA certificate from encrypted storage
   */
  private async getTenantZraCertificate(tenant_id: string): Promise<ZraCertificate | null> {
    // This would retrieve from tenant settings table
    // For now, return mock data
    return {
      tpin: "1234567890",
      private_key: "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----",
      certificate: "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----",
      encrypted: true,
    }
  }

  /**
   * Create data string for signing
   */
  private createSignatureData(invoice: InvoiceData): string {
    return [
      invoice.receipt_number,
      invoice.total_amount.toFixed(2),
      invoice.tax_amount.toFixed(2),
      invoice.timestamp.toISOString(),
      invoice.tenant_tin,
    ].join("|")
  }

  /**
   * Decrypt private key
   */
  private decryptPrivateKey(encrypted: string): string {
    // Implement decryption logic
    // This is a placeholder
    return encrypted
  }

  /**
   * Generate QR code data
   */
  private generateQrCode(signature: string, receipt_number: string): string {
    return `ZRA|${receipt_number}|${signature.substring(0, 50)}`
  }
}
