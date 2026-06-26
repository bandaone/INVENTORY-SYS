import { MedusaService } from "@medusajs/framework/utils"
import SyncConflict from "./models/sync-conflict"

type SyncQueueEntry = {
  sequence_number: number
  device_id: string
  tenant_id: string
  action_type: "SALE" | "INGESTION" | "STOCKTAKE" | "TRANSFER"
  payload: any
  created_at?: Date
}

type ConflictDetectionResult = {
  hasConflict: boolean
  conflictType?: string
  resolution?: string
  existingEntry?: SyncQueueEntry
}

export default class SyncEngineService extends MedusaService({
  SyncConflict,
}) {
  /**
   * Process a batch of sync entries from a device
   */
  async processSyncBatch(entries: SyncQueueEntry[]) {
    // Sort by sequence number
    const sortedEntries = [...entries].sort(
      (a, b) => a.sequence_number - b.sequence_number
    )

    const results = {
      processed: 0,
      conflicts: [] as any[],
      errors: [] as any[],
    }

    for (const entry of sortedEntries) {
      try {
        // Check for conflicts
        const conflict = await this.detectConflict(entry)

        if (conflict.hasConflict) {
          // Log conflict
          const syncConflict = await this.createSyncConflicts({
            tenant_id: entry.tenant_id,
            serial_number: entry.payload.serial_number,
            conflict_type: conflict.conflictType!,
            device_a_id: conflict.existingEntry!.device_id,
            device_b_id: entry.device_id,
            entry_a: conflict.existingEntry,
            entry_b: entry,
            resolution: conflict.resolution || "MANUAL_REQUIRED",
          } as any)

          results.conflicts.push(syncConflict)

          // Auto-resolve if possible
          if (conflict.resolution === "AUTO_PREFER_SALE") {
            await this.applyEntry(entry)
            results.processed++
          } else if (conflict.resolution === "MANUAL_REQUIRED") {
            // Skip, wait for manual resolution
            continue
          }
        } else {
          // No conflict, apply entry
          await this.applyEntry(entry)
          results.processed++
        }
      } catch (error) {
        results.errors.push({
          entry,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    return results
  }

  /**
   * Detect conflicts with existing entries or current state
   */
  private async detectConflict(
    entry: SyncQueueEntry
  ): Promise<ConflictDetectionResult> {
    const { action_type, payload, tenant_id } = entry

    // Get serial tracking service
    const serialTrackingService = (this as any).container.resolve("serial_tracking")
    const serialItem = await serialTrackingService.getBySerial(
      payload.serial_number
    )

    if (!serialItem) {
      return { hasConflict: false }
    }

    // Rule 1: SALE beats STOCKTAKE_ADJUSTMENT
    if (action_type === "STOCKTAKE" && payload.result === "MISSING") {
      // Check if there's a more recent sale
      const movements = await serialTrackingService.getMovementHistory(
        payload.serial_number
      )

      const recentSale = movements.find(
        (m: any) => m.movement_type === "SALE" &&
               m.sequence_number > entry.sequence_number
      )

      if (recentSale) {
        return {
          hasConflict: true,
          conflictType: "SALE_BEFORE_STOCKTAKE",
          resolution: "AUTO_PREFER_SALE",
          existingEntry: recentSale as any,
        }
      }
    }

    // Rule 2: TRANSFER vs SALE from different locations requires manual review
    if (action_type === "SALE") {
      const movements = await serialTrackingService.getMovementHistory(
        payload.serial_number
      )

      const concurrentTransfer = movements.find(
        (m: any) =>
          m.movement_type === "TRANSFER" &&
          Math.abs(m.sequence_number - entry.sequence_number) < 10 &&
          m.device_id !== entry.device_id
      )

      if (concurrentTransfer) {
        return {
          hasConflict: true,
          conflictType: "TRANSFER_VS_SALE",
          resolution: "MANUAL_REQUIRED",
          existingEntry: concurrentTransfer as any,
        }
      }
    }

    // Rule 3: Duplicate sale detection
    if (action_type === "SALE" && serialItem.status === "SOLD") {
      return {
        hasConflict: true,
        conflictType: "DUPLICATE_SALE",
        resolution: "MANUAL_REQUIRED",
      }
    }

    return { hasConflict: false }
  }

  /**
   * Apply a sync entry to the system
   */
  private async applyEntry(entry: SyncQueueEntry) {
    const { action_type, payload, tenant_id } = entry
    const serialTrackingService = (this as any).container.resolve("serial_tracking")

    switch (action_type) {
      case "SALE":
        await serialTrackingService.updateStatus({
          serial_number: payload.serial_number,
          new_status: "SOLD",
          actor_id: payload.actor_id,
          movement_type: "SALE",
          device_id: entry.device_id,
          sequence_number: entry.sequence_number,
          order_id: payload.order_id,
        })
        break

      case "INGESTION":
        // Already handled by serial generation
        break

      case "STOCKTAKE":
        if (payload.result === "MISSING") {
          await serialTrackingService.updateStatus({
            serial_number: payload.serial_number,
            new_status: "MISSING",
            actor_id: payload.actor_id,
            movement_type: "STOCKTAKE",
            device_id: entry.device_id,
            sequence_number: entry.sequence_number,
            notes: `Stocktake session: ${payload.session_id}`,
          })
        }
        break

      case "TRANSFER":
        await serialTrackingService.updateStatus({
          serial_number: payload.serial_number,
          new_status: "IN_STOCK",
          actor_id: payload.actor_id,
          movement_type: "TRANSFER",
          from_location_id: payload.from_location_id,
          to_location_id: payload.to_location_id,
          device_id: entry.device_id,
          sequence_number: entry.sequence_number,
        })
        break
    }
  }

  /**
   * Get pending conflicts for manual resolution
   */
  async getPendingConflicts(tenant_id: string) {
    return await this.listSyncConflicts({
      tenant_id,
      resolution: ["MANUAL_REQUIRED", null],
    }, {
      order: { created_at: "DESC" },
    })
  }

  /**
   * Resolve a conflict manually
   */
  async resolveConflict(
    conflict_id: string,
    resolution_entry: SyncQueueEntry,
    resolved_by: string,
    notes?: string
  ) {
    const conflict = await this.retrieveSyncConflict(conflict_id)

    if (!conflict) {
      throw new Error("Conflict not found")
    }

    // Apply the chosen resolution
    await this.applyEntry(resolution_entry)

    // Mark conflict as resolved
    await this.updateSyncConflicts({
      id: conflict_id,
      resolution: "RESOLVED",
      resolved_by,
      resolved_at: new Date(),
      notes: notes || "Manually resolved by admin",
    } as any)

    return conflict
  }
}
