import { model } from "@medusajs/framework/utils"

const AuditEvent = model.define("audit_event", {
  id: model.id().primaryKey(),
  tenant_id: model.text().searchable(),
  event_type: model.text().searchable(),
  actor_id: model.text().nullable(),
  actor_role: model.text().nullable(),
  device_id: model.text().nullable(),
  sequence_number: model.bigNumber().nullable(),
  resource_type: model.text().nullable(),
  resource_id: model.text().nullable(),
  payload: model.json(),
  metadata: model.json().nullable(),
  ip_address: model.text().nullable(),
})
  .indexes([
    {
      on: ["tenant_id", "created_at"],
    },
    {
      on: ["event_type"],
    },
    {
      on: ["actor_id"],
    },
    {
      on: ["resource_type", "resource_id"],
    },
  ])

export default AuditEvent
