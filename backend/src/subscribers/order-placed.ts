import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"

export default async function orderPlacedHandler({
  event,
  container,
}: SubscriberArgs<{ order: any }>) {
  const { order } = event.data

  // Notify serial tracking service to mark items as sold
  const serialTrackingService = container.resolve("serial_tracking") as any
  
  // Process each item in the order
  for (const item of order.items) {
    // Check if item has serial number
    if (item.metadata?.serial_number) {
      await serialTrackingService.updateStatus({
        serial_number: item.metadata.serial_number,
        new_status: "SOLD",
        actor_id: order.customer_id,
        movement_type: "SALE",
        order_id: order.id,
      })
    }
  }

  // Log to audit trail
  const auditTrailService = container.resolve("audit_trail") as any
  await auditTrailService.onOrderEvent({
    name: "order.placed",
    tenant_id: order.tenant_id,
    order,
    metadata: {
      actor_id: order.customer_id,
    },
  })

  // Trigger ZRA invoice generation
  const zraInvoiceService = container.resolve("zra_invoice") as any
  await zraInvoiceService.onOrderPlaced({ order })
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
