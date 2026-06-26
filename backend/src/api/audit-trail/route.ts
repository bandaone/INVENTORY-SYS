import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"

const QuerySchema = z.object({
  event_type: z.string().or(z.array(z.string())).optional(),
  actor_id: z.string().optional(),
  resource_type: z.string().optional(),
  resource_id: z.string().optional(),
  start_date: z.string().datetime().optional(),
  end_date: z.string().datetime().optional(),
  limit: z.coerce.number().min(1).max(1000).default(100),
  offset: z.coerce.number().min(0).default(0),
})

/**
 * GET /audit-trail
 * Query audit trail events
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

    // Parse query params
    const query = QuerySchema.parse(req.query)

    const auditTrailService = req.scope.resolve("audit_trail") as any
    const events = await auditTrailService.queryEvents({
      tenant_id,
      ...query,
      start_date: query.start_date ? new Date(query.start_date) : undefined,
      end_date: query.end_date ? new Date(query.end_date) : undefined,
    })

    res.json({
      events,
      pagination: {
        limit: query.limit,
        offset: query.offset,
        count: events.length,
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: "Validation error",
        details: error.errors,
      })
    }

    console.error("Audit trail query error:", error)
    res.status(500).json({
      error: "Failed to query audit trail",
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
