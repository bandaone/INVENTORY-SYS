import { model } from "@medusajs/framework/utils"

const SyncConflict = model.define("sync_conflict", {
  id: model.id().primaryKey(),
  tenant_id: model.text().searchable(),
  serial_number: model.text().searchable(),
  conflict_type: model.enum([
    "SALE_BEFORE_STOCKTAKE",
    "TRANSFER_VS_SALE",
    "DUPLICATE_SALE",
    "INVALID_STATUS_TRANSITION"
  ]),
  device_a_id: model.text(),
  device_b_id: model.text().nullable(),
  entry_a: model.json(),
  entry_b: model.json().nullable(),
  resolution: model.enum([
    "AUTO_PREFER_SALE",
    "AUTO_PREFER_TRANSFER",
    "MANUAL_REQUIRED",
    "RESOLVED"
  ]).nullable(),
  resolved_by: model.text().nullable(),
  resolved_at: model.dateTime().nullable(),
  notes: model.text().nullable(),
})
  .indexes([
    {
      on: ["tenant_id", "resolution"],
      where: "resolution IS NULL OR resolution = 'MANUAL_REQUIRED'",
    },
    {
      on: ["serial_number"],
    },
  ])

export default SyncConflict
