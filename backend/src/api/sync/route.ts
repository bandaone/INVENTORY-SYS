import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"

const SyncQueueEntrySchema = z.object({
  sequence_number: z.number(),
  device_id: z.string(),
  tenant_id: z.string(),
  action_type: z.enum(["SALE", "INGESTION", "STOCKTAKE", "TRANSFER"]),
  payload: z.any(),
  created_at: z.string().datetime().optional(),
})

const SyncBatchSchema = z.object({
  device_id: z.string(),
  entries: z.array(SyncQueueEntrySchema),
})

/**
 * POST /sync/push
 * Accept sync queue entries from offline devices
 */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
) {
  try {
    // Validate request body
    const body = SyncBatchSchema.parse(req.body)

    // Get sync engine service
    const syncEngineService = req.scope.resolve("sync_engine") as any

    // Process batch using job queue for async processing
    const result = await syncEngineService.processSyncBatch(body.entries)

    res.json({
      status: "success",
      processed: result.processed,
      conflicts: result.conflicts.map((c: any) => ({
        id: c.id,
        conflict_type: c.conflict_type,
        serial_number: c.serial_number,
        resolution: c.resolution,
      })),
      errors: result.errors,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: "Validation error",
        details: error.errors,
      })
    }

    console.error("Sync push error:", error)
    res.status(500).json({
      error: "Failed to process sync batch",
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * GET /sync/conflicts
 * Get pending conflicts for manual resolution
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
) {
  try {
    const tenant_id = (req as any).tenant_id

    if (!tenant_id) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Tenant context required",
      })
    }

    const syncEngineService = req.scope.resolve("sync_engine") as any
    const conflicts = await syncEngineService.getPendingConflicts(tenant_id)

    res.json({
      conflicts,
    })
  } catch (error) {
    console.error("Get conflicts error:", error)
    res.status(500).json({
      error: "Failed to retrieve conflicts",
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
