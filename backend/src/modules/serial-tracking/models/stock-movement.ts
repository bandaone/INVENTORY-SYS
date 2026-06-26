import { model } from "@medusajs/framework/utils"

const StockMovement = model.define("stock_movement", {
  id: model.id().primaryKey(),
  tenant_id: model.text().searchable(),
  serial_item_id: model.text().searchable(),
  serial_number: model.text().searchable(),
  movement_type: model.enum([
    "INGESTION",
    "SALE",
    "TRANSFER",
    "STOCKTAKE",
    "ADJUSTMENT"
  ]),
  from_location_id: model.text().nullable(),
  to_location_id: model.text().nullable(),
  from_status: model.text().nullable(),
  to_status: model.text(),
  actor_id: model.text().searchable(),
  device_id: model.text().nullable(),
  sequence_number: model.bigNumber().nullable(),
  order_id: model.text().nullable(),
  notes: model.text().nullable(),
})
  .indexes([
    {
      on: ["tenant_id", "created_at"],
    },
    {
      on: ["serial_number"],
    },
    {
      on: ["device_id", "sequence_number"],
    },
    {
      on: ["movement_type"],
    },
  ])

export default StockMovement
