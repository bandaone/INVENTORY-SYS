import { MedusaService } from "@medusajs/framework/utils"
import SerialItem from "./models/serial-item"
import StockMovement from "./models/stock-movement"

type GenerateSerialsInput = {
  tenant_id: string
  inventory_item_id: string
  location_id: string
  quantity: number
  cost_price: number
  retail_price: number
  actor_id: string
  device_id?: string
  sequence_number?: number
}

type UpdateStatusInput = {
  serial_number: string
  new_status: "IN_STOCK" | "SOLD" | "MISSING" | "TRANSFERRED"
  actor_id: string
  movement_type: "INGESTION" | "SALE" | "TRANSFER" | "STOCKTAKE" | "ADJUSTMENT"
  from_location_id?: string
  to_location_id?: string
  device_id?: string
  sequence_number?: number
  order_id?: string
  notes?: string
}

export default class SerialTrackingService extends MedusaService({
  SerialItem,
  StockMovement,
}) {
  /**
   * Generate unique serial numbers for a batch of items
   */
  async generateSerialsForBatch(input: GenerateSerialsInput) {
    const {
      tenant_id,
      inventory_item_id,
      location_id,
      quantity,
      cost_price,
      retail_price,
      actor_id,
      device_id,
      sequence_number,
    } = input

    const batch_date = new Date()
    const serials: any[] = []

    // Generate unique serial numbers
    for (let i = 0; i < quantity; i++) {
      const serial_number = this.generateSerialNumber()

      const serialItem = await this.createSerialItems({
        tenant_id,
        inventory_item_id,
        location_id,
        serial_number,
        status: "IN_STOCK",
        cost_price,
        retail_price,
        batch_date,
      } as any) as any
      const serialRecord = Array.isArray(serialItem) ? serialItem[0] : serialItem

      // Create stock movement record
      await this.createStockMovements({
        tenant_id,
        serial_item_id: serialRecord.id,
        serial_number,
        movement_type: "INGESTION",
        to_location_id: location_id,
        to_status: "IN_STOCK",
        actor_id,
        device_id,
        sequence_number,
      } as any)

      serials.push(serialRecord)
    }

    return serials
  }

  /**
   * Get serial item by serial number
   */
  async getBySerial(serial_number: string) {
    const [serialItem] = await this.listSerialItems(
      { serial_number },
      { take: 1 }
    )
    return serialItem
  }

  /**
   * Update status of a serial item and log stock movement
   */
  async updateStatus(input: UpdateStatusInput) {
    const serialItem = await this.getBySerial(input.serial_number)

    if (!serialItem) {
      throw new Error(`Serial ${input.serial_number} not found`)
    }

    const old_status = serialItem.status
    const old_location_id = serialItem.location_id

    // Update serial item
    const updated = await this.updateSerialItems({
      id: serialItem.id,
      status: input.new_status,
      location_id: input.to_location_id || serialItem.location_id,
      last_scanned_at: new Date(),
    } as any)

    // Create stock movement record
    await this.createStockMovements({
      tenant_id: serialItem.tenant_id,
      serial_item_id: serialItem.id,
      serial_number: input.serial_number,
      movement_type: input.movement_type,
      from_location_id: input.from_location_id || old_location_id,
      to_location_id: input.to_location_id || serialItem.location_id,
      from_status: old_status,
      to_status: input.new_status,
      actor_id: input.actor_id,
      device_id: input.device_id,
      sequence_number: input.sequence_number,
      order_id: input.order_id,
      notes: input.notes,
    } as any)

    return updated
  }

  /**
   * Get stock movements for a serial
   */
  async getMovementHistory(serial_number: string) {
    return await this.listStockMovements(
      { serial_number },
      { 
        order: { created_at: "DESC" },
      }
    )
  }

  /**
   * Generate a unique serial number
   */
  private generateSerialNumber(): string {
    const prefix = "RTL"
    const year = new Date().getFullYear()
    const random = Math.random().toString(36).substring(2, 10).toUpperCase()
    return `${prefix}-${year}-${random}`
  }

  /**
   * Get stock levels by location
   */
  async getStockLevelsByLocation(tenant_id: string, location_id?: string) {
    const filters: any = { 
      tenant_id,
      status: "IN_STOCK",
    }
    
    if (location_id) {
      filters.location_id = location_id
    }

    const items = await this.listSerialItems(filters)

    // Group by inventory_item_id
    const grouped = items.reduce((acc, item) => {
      if (!acc[item.inventory_item_id]) {
        acc[item.inventory_item_id] = {
          inventory_item_id: item.inventory_item_id,
          location_id: item.location_id,
          quantity: 0,
          total_value: 0,
        }
      }
      acc[item.inventory_item_id].quantity++
      acc[item.inventory_item_id].total_value += Number(item.retail_price)
      return acc
    }, {} as Record<string, any>)

    return Object.values(grouped)
  }

  /**
   * Calculate shrinkage for a time period
   */
  async calculateShrinkage(
    tenant_id: string,
    location_id: string,
    start_date: Date,
    end_date: Date
  ) {
    const movements = await this.listStockMovements({
      tenant_id,
      to_location_id: location_id,
      movement_type: "STOCKTAKE",
      to_status: "MISSING",
      created_at: {
        $gte: start_date,
        $lte: end_date,
      },
    })

    const serials = await this.listSerialItems({
      serial_number: {
        $in: movements.map(m => m.serial_number),
      },
    })

    const shrinkage_value = serials.reduce(
      (sum, item) => sum + Number(item.retail_price),
      0
    )

    return {
      missing_count: movements.length,
      shrinkage_value,
      movements,
    }
  }
}
