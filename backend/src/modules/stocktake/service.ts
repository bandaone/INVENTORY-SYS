import { MedusaService } from "@medusajs/framework/utils"
import StocktakeSession from "./models/stocktake-session"
import StocktakeItem from "./models/stocktake-item"

type StartStocktakeInput = {
  tenant_id: string
  location_id: string
  area?: string
  initiated_by: string
}

type ScanBatchInput = {
  session_id: string
  serial_numbers: string[]
}

export default class StocktakeService extends MedusaService({
  StocktakeSession,
  StocktakeItem,
}) {
  /**
   * Start a new stocktake session
   */
  async startSession(input: StartStocktakeInput) {
    const { tenant_id, location_id, area, initiated_by } = input

    const session = await this.createStocktakeSessions({
      tenant_id,
      location_id,
      area,
      status: "ACTIVE",
      initiated_by,
    } as any)

    return session
  }

  /**
   * Scan a batch of serial numbers
   */
  async scanBatch(input: ScanBatchInput) {
    const { session_id, serial_numbers } = input

    const session = await this.retrieveStocktakeSession(session_id)

    if (!session) {
      throw new Error("Stocktake session not found")
    }

    if (session.status !== "ACTIVE") {
      throw new Error("Stocktake session is not active")
    }

    // Get serial tracking service
    const serialTrackingService = (this as any).container.resolve("serial_tracking")

    const results: Array<{
      serial_number: string
      result: "MATCHED" | "MISSING" | "UNEXPECTED"
      variant_name?: string
    }> = []

    for (const serial_number of serial_numbers) {
      // Check if serial exists
      const serialItem = await serialTrackingService.getBySerial(serial_number)

      let result: "MATCHED" | "MISSING" | "UNEXPECTED"

      if (!serialItem) {
        result = "UNEXPECTED"
      } else if (
        serialItem.location_id === session.location_id &&
        serialItem.status === "IN_STOCK"
      ) {
        result = "MATCHED"
      } else {
        result = "UNEXPECTED"
      }

      // Record scan
      await this.createStocktakeItems({
        session_id,
        serial_number,
        result,
        scanned_at: new Date(),
      } as any)

      results.push({
        serial_number,
        result,
        variant_name: serialItem?.inventory_item_id,
      })
    }

    return results
  }

  /**
   * Commit stocktake session
   */
  async commitSession(session_id: string) {
    const session = await this.retrieveStocktakeSession(session_id)

    if (!session) {
      throw new Error("Stocktake session not found")
    }

    if (session.status !== "ACTIVE") {
      throw new Error("Stocktake session is not active")
    }

    // Get all items for this session
    const items = await this.listStocktakeItems({ session_id })

    // Count results
    const matched = items.filter((i: any) => i.result === "MATCHED")
    const unexpected = items.filter((i: any) => i.result === "UNEXPECTED")

    // Get expected items that weren't scanned (MISSING)
    const serialTrackingService = (this as any).container.resolve("serial_tracking")
    const expectedItems = await serialTrackingService.listSerialItems({
      tenant_id: session.tenant_id,
      location_id: session.location_id,
      status: "IN_STOCK",
    })

    const scannedSerials = new Set(items.map((i) => i.serial_number))
    const missingItems = expectedItems.filter(
      (item: any) => !scannedSerials.has(item.serial_number)
    )

    // Update status for all missing serials
    for (const item of missingItems) {
      await serialTrackingService.updateStatus({
        serial_number: item.serial_number,
        new_status: "MISSING",
        actor_id: session.initiated_by,
        movement_type: "STOCKTAKE",
        notes: `Stocktake session: ${session_id}`,
      })
    }

    // Calculate shrinkage value
    const shrinkage_value = missingItems.reduce(
      (sum: number, item: any) => sum + Number(item.retail_price),
      0
    )

    // Update session
    const updated = await this.updateStocktakeSessions({
      id: session_id,
      status: "COMPLETED",
      committed_at: new Date(),
      matched_count: matched.length,
      missing_count: missingItems.length,
      unexpected_count: unexpected.length,
      shrinkage_value,
    } as any)

    // Emit event for audit trail
    const eventBusService = (this as any).container.resolve("eventBusService")
    await eventBusService.emit("stocktake.committed", {
      session_id,
      tenant_id: session.tenant_id,
      location_id: session.location_id,
      matched_count: matched.length,
      missing_count: missingItems.length,
      unexpected_count: unexpected.length,
      shrinkage_value,
    })

    return {
      session: updated,
      summary: {
        matched: matched.length,
        missing: missingItems.length,
        unexpected: unexpected.length,
        shrinkage_value,
      },
      missing_serials: missingItems.map((i: any) => i.serial_number),
    }
  }

  /**
   * Cancel stocktake session
   */
  async cancelSession(session_id: string) {
    const session = await this.retrieveStocktakeSession(session_id)

    if (!session) {
      throw new Error("Stocktake session not found")
    }

    return await this.updateStocktakeSessions({
      id: session_id,
      status: "CANCELLED",
    } as any)
  }

  /**
   * Get session details with items
   */
  async getSessionDetails(session_id: string) {
    const session = await this.retrieveStocktakeSession(session_id)

    if (!session) {
      throw new Error("Stocktake session not found")
    }

    const items = await this.listStocktakeItems({ session_id })

    const grouped = {
      matched: items.filter((i) => i.result === "MATCHED"),
      missing: items.filter((i) => i.result === "MISSING"),
      unexpected: items.filter((i) => i.result === "UNEXPECTED"),
    }

    return {
      session,
      items: grouped,
      counts: {
        matched: grouped.matched.length,
        missing: grouped.missing.length,
        unexpected: grouped.unexpected.length,
      },
    }
  }
}
