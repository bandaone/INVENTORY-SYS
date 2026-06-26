import { Module } from "@medusajs/framework/utils"
import StocktakeService from "./service"

export const STOCKTAKE_MODULE = "stocktake"

export default Module(STOCKTAKE_MODULE, {
  service: StocktakeService,
})
