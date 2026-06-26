import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import crypto from "crypto"

/**
 * POST /webhooks/airtel
 * Handle Airtel Money payment webhooks
 */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
) {
  try {
    // Validate webhook signature
    const signature = req.headers["x-airtel-signature"] as string
    
    if (!signature || !validateAirtelSignature(req.body, signature)) {
      return res.status(401).json({
        error: "Invalid webhook signature",
      })
    }

    // Get payment provider
    const paymentProviderService = req.scope.resolve("paymentProviderService") as any
    const provider = await paymentProviderService.retrieve("airtel-money")

    // Process webhook
    const webhookData = await provider.getWebhookActionAndData(req.body)

    // Handle webhook action
    if (webhookData.action === "authorized") {
      // Payment successful - update order
      console.log("Airtel Money payment authorized:", webhookData.data)
    } else if (webhookData.action === "failed") {
      // Payment failed
      console.log("Airtel Money payment failed:", webhookData.data)
    }

    res.status(200).json({ status: "processed" })
  } catch (error) {
    console.error("Airtel Money webhook error:", error)
    res.status(500).json({
      error: "Webhook processing failed",
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

function validateAirtelSignature(payload: any, signature: string): boolean {
  // Implement Airtel Money signature validation
  // This is a placeholder - actual implementation depends on Airtel's signature scheme
  const secret = process.env.AIRTEL_WEBHOOK_SECRET || ""
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(JSON.stringify(payload))
    .digest("hex")
  
  return signature === expectedSignature
}
