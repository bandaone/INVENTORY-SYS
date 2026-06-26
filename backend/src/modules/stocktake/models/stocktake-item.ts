import { model } from "@medusajs/framework/utils"

const StocktakeItem = model.define("stocktake_item", {
  id: model.id().primaryKey(),
  session_id: model.text().searchable(),
  serial_number: model.text().searchable(),
  result: model.enum(["MATCHED", "MISSING", "UNEXPECTED"]),
  scanned_at: model.dateTime().default((() => new Date()) as any),
})
  .indexes([
    {
      on: ["session_id", "result"],
    },
    {
      on: ["serial_number"],
    },
  ])

export default StocktakeItem
