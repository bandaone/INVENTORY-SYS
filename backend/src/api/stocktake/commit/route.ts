import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"

const CommitStocktakeSchema = z.object({
  session_id: z.string(),
})

/**
 * POST /stocktake/commit
 * Commit a stocktake session
 */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
) {
  try {
    const body = CommitStocktakeSchema.parse(req.body)

    const stocktakeService = req.scope.resolve("stocktake") as any
    const result = await stocktakeService.commitSession(body.session_id)

    res.json(result)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: "Validation error",
        details: error.errors,
      })
    }

    console.error("Commit stocktake error:", error)
    res.status(500).json({
      error: "Failed to commit stocktake",
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
