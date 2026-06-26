import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"

const StartStocktakeSchema = z.object({
  location_id: z.string(),
  area: z.string().optional(),
})

const ScanBatchSchema = z.object({
  session_id: z.string(),
  serial_numbers: z.array(z.string()),
})

const CommitStocktakeSchema = z.object({
  session_id: z.string(),
})

/**
 * POST /stocktake/start
 * Start a new stocktake session
 */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
) {
  try {
    const body = StartStocktakeSchema.parse(req.body)
    const tenant_id = (req as any).tenant_id

    if (!tenant_id) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const stocktakeService = req.scope.resolve("stocktake") as any
    const session = await stocktakeService.startSession({
      tenant_id,
      location_id: body.location_id,
      area: body.area,
      initiated_by: (req as any).auth_context?.actor_id || (req as any).user?.id,
    })

    res.status(201).json({ session })
  } catch (error) {
    console.error("Start stocktake error:", error)
    res.status(500).json({
      error: "Failed to start stocktake",
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * GET /stocktake/:id
 * Get stocktake session details
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
) {
  try {
    const session_id = req.params.id

    const stocktakeService = req.scope.resolve("stocktake") as any
    const details = await stocktakeService.getSessionDetails(session_id)

    res.json(details)
  } catch (error) {
    console.error("Get stocktake error:", error)
    res.status(500).json({
      error: "Failed to get stocktake details",
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
