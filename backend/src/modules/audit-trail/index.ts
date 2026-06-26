import { Module } from "@medusajs/framework/utils"
import AuditTrailService from "./service"

export const AUDIT_TRAIL_MODULE = "audit_trail"

export default Module(AUDIT_TRAIL_MODULE, {
  service: AuditTrailService,
})
