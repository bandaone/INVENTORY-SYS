import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"

const ScanBatchSchema = z.object({
  session_id: z.string(),
  serial_numbers: z.array(z.string()).min(1).max(1000), // Max 1000 per batch for RFID
})

/**
 * POST /stocktake/scan
 * Scan a batch of serial numbers
 */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
) {
  try {
    const body = ScanBatchSchema.parse(req.body)

    const stocktakeService = req.scope.resolve("stocktake") as any
    const results = await stocktakeService.scanBatch(body)

    res.json({ results })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: "Validation error",
        details: error.errors,
      })
    }

    console.error("Scan batch error:", error)
    res.status(500).json({
      error: "Failed to scan batch",
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
