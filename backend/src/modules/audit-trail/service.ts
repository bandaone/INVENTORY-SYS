import { MedusaService } from "@medusajs/framework/utils"
import AuditEvent from "./models/audit-event"

type LogEventInput = {
  tenant_id: string
  event_type: string
  actor_id?: string
  actor_role?: string
  device_id?: string
  sequence_number?: number
  resource_type?: string
  resource_id?: string
  payload: any
  metadata?: any
  ip_address?: string
}

export default class AuditTrailService extends MedusaService({
  AuditEvent,
}) {
  /**
   * Log an event to the audit trail
   */
  async logEvent(input: LogEventInput) {
    const event = await this.createAuditEvents({
      ...input,
    } as any)

    return event
  }

  /**
   * Query audit trail with filters
   */
  async queryEvents(filters: {
    tenant_id: string
    event_type?: string | string[]
    actor_id?: string
    resource_type?: string
    resource_id?: string
    start_date?: Date
    end_date?: Date
    limit?: number
    offset?: number
  }) {
    const where: any = {
      tenant_id: filters.tenant_id,
    }

    if (filters.event_type) {
      where.event_type = Array.isArray(filters.event_type)
        ? { $in: filters.event_type }
        : filters.event_type
    }

    if (filters.actor_id) {
      where.actor_id = filters.actor_id
    }

    if (filters.resource_type) {
      where.resource_type = filters.resource_type
    }

    if (filters.resource_id) {
      where.resource_id = filters.resource_id
    }

    if (filters.start_date || filters.end_date) {
      where.created_at = {}
      if (filters.start_date) {
        where.created_at.$gte = filters.start_date
      }
      if (filters.end_date) {
        where.created_at.$lte = filters.end_date
      }
    }

    const events = await this.listAuditEvents(where, {
      take: filters.limit || 100,
      skip: filters.offset || 0,
      order: { created_at: "DESC" },
    })

    return events
  }

  /**
   * Subscribe to order events
   */
  async onOrderEvent(eventData: any) {
    await this.logEvent({
      tenant_id: eventData.tenant_id || eventData.order?.tenant_id,
      event_type: eventData.name || "order.event",
      actor_id: eventData.metadata?.actor_id,
      resource_type: "order",
      resource_id: eventData.order?.id,
      payload: eventData,
    })
  }

  /**
   * Subscribe to inventory events
   */
  async onInventoryEvent(eventData: any) {
    await this.logEvent({
      tenant_id: eventData.tenant_id,
      event_type: eventData.name || "inventory.event",
      actor_id: eventData.metadata?.actor_id,
      resource_type: "inventory",
      resource_id: eventData.inventory_item_id,
      payload: eventData,
    })
  }

  /**
   * Subscribe to serial tracking events
   */
  async onSerialTrackingEvent(eventData: any) {
    await this.logEvent({
      tenant_id: eventData.tenant_id,
      event_type: eventData.name || "serial_tracking.event",
      actor_id: eventData.actor_id,
      device_id: eventData.device_id,
      sequence_number: eventData.sequence_number,
      resource_type: "serial_item",
      resource_id: eventData.serial_number,
      payload: eventData,
    })
  }

  /**
   * Subscribe to stocktake events
   */
  async onStocktakeEvent(eventData: any) {
    await this.logEvent({
      tenant_id: eventData.tenant_id,
      event_type: eventData.name || "stocktake.event",
      actor_id: eventData.initiated_by,
      resource_type: "stocktake_session",
      resource_id: eventData.session_id,
      payload: eventData,
    })
  }

  /**
   * Subscribe to sync events
   */
  async onSyncEvent(eventData: any) {
    await this.logEvent({
      tenant_id: eventData.tenant_id,
      event_type: eventData.name || "sync.event",
      device_id: eventData.device_id,
      sequence_number: eventData.sequence_number,
      resource_type: "sync",
      resource_id: eventData.conflict_id,
      payload: eventData,
    })
  }

  /**
   * Subscribe to transfer events
   */
  async onTransferEvent(eventData: any) {
    await this.logEvent({
      tenant_id: eventData.tenant_id,
      event_type: eventData.name || "transfer.event",
      actor_id: eventData.actor_id,
      resource_type: "transfer",
      resource_id: eventData.transfer_id,
      payload: eventData,
    })
  }
}
