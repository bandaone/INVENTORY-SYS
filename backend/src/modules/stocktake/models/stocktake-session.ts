import { model } from "@medusajs/framework/utils"

const StocktakeSession = model.define("stocktake_session", {
  id: model.id().primaryKey(),
  tenant_id: model.text().searchable(),
  location_id: model.text().searchable(),
  area: model.text().nullable(),
  status: model.enum(["ACTIVE", "COMPLETED", "CANCELLED"]).default("ACTIVE"),
  initiated_by: model.text().searchable(),
  committed_at: model.dateTime().nullable(),
  
  // Computed fields
  matched_count: model.number().default(0),
  missing_count: model.number().default(0),
  unexpected_count: model.number().default(0),
  shrinkage_value: model.bigNumber().nullable(),
})
  .indexes([
    {
      on: ["tenant_id", "status"],
    },
    {
      on: ["location_id", "created_at"],
    },
  ])

export default StocktakeSession
