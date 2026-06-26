import { model } from "@medusajs/framework/utils"

const SerialItem = model.define("serial_item", {
  id: model.id().primaryKey(),
  tenant_id: model.text().searchable(),
  inventory_item_id: model.text().searchable(),
  location_id: model.text().searchable(),
  serial_number: model.text().unique().searchable(),
  status: model.enum([
    "IN_STOCK",
    "SOLD",
    "MISSING",
    "TRANSFERRED"
  ]).default("IN_STOCK"),
  cost_price: model.bigNumber(),
  retail_price: model.bigNumber(),
  batch_date: model.dateTime(),
  last_scanned_at: model.dateTime().nullable(),
})
  .indexes([
    {
      on: ["tenant_id", "serial_number"],
      unique: true,
    },
    {
      on: ["location_id", "status"],
    },
    {
      on: ["inventory_item_id"],
    },
  ])

export default SerialItem
