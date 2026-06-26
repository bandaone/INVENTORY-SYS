import { MedusaRequest, MedusaResponse, MedusaNextFunction } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

/**
 * Middleware to set tenant context for Row Level Security.
 * Extracts tenant_id from JWT and sets it on the database connection.
 */
export async function tenantContextMiddleware(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  try {
    // Extract tenant_id from authenticated user context
    const tenantId = (req as any).auth_context?.tenant_id || (req as any).user?.tenant_id

    if (!tenantId) {
      // Allow unauthenticated requests to pass through
      // (authentication will be handled by route-specific middleware)
      return next()
    }

    // Set tenant context on database connection for RLS
    const manager = req.scope.resolve("manager") as any
    
    if (manager && manager.query) {
      await manager.query(
        `SELECT set_config('app.current_tenant', $1, true)`,
        [tenantId]
      )
    }

    // Store tenant_id on request for easy access
    req.tenant_id = tenantId

    next()
  } catch (error) {
    next(
      new MedusaError(
        MedusaError.Types.UNAUTHORIZED,
        "Failed to set tenant context"
      )
    )
  }
}

// Extend MedusaRequest type
declare module "@medusajs/framework/http" {
  interface MedusaRequest {
    tenant_id?: string
  }
}
