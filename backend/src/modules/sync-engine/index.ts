import { Module } from "@medusajs/framework/utils"
import SyncEngineService from "./service"

export const SYNC_ENGINE_MODULE = "sync_engine"

export default Module(SYNC_ENGINE_MODULE, {
  service: SyncEngineService,
})
