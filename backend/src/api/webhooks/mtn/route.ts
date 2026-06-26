import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import crypto from "crypto"

/**
 * POST /webhooks/mtn
 * Handle MTN MoMo payment webhooks
 */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
) {
  try {
    // Validate webhook signature
    const signature = req.headers["x-mtn-signature"] as string
    
    if (!signature || !validateMtnSignature(req.body, signature)) {
      return res.status(401).json({
        error: "Invalid webhook signature",
      })
    }

    // Get payment provider
    const paymentProviderService = req.scope.resolve("paymentProviderService") as any
    const provider = await paymentProviderService.retrieve("mtn-momo")

    // Process webhook
    const webhookData = await provider.getWebhookActionAndData(req.body)

    // Handle webhook action
    if (webhookData.action === "authorized") {
      // Payment successful - update order
      // This will be handled by Medusa's order module
      console.log("MTN MoMo payment authorized:", webhookData.data)
    } else if (webhookData.action === "failed") {
      // Payment failed
      console.log("MTN MoMo payment failed:", webhookData.data)
    }

    res.status(200).json({ status: "processed" })
  } catch (error) {
    console.error("MTN MoMo webhook error:", error)
    res.status(500).json({
      error: "Webhook processing failed",
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

function validateMtnSignature(payload: any, signature: string): boolean {
  // Implement MTN MoMo signature validation
  // This is a placeholder - actual implementation depends on MTN's signature scheme
  const secret = process.env.MTN_MOMO_WEBHOOK_SECRET || ""
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(JSON.stringify(payload))
    .digest("hex")
  
  return signature === expectedSignature
}
