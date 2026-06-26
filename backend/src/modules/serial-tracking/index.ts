import { Module } from "@medusajs/framework/utils"
import SerialTrackingService from "./service"

export const SERIAL_TRACKING_MODULE = "serial_tracking"

export default Module(SERIAL_TRACKING_MODULE, {
  service: SerialTrackingService,
})
