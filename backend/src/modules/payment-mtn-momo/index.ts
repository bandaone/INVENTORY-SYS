// @ts-nocheck
import { Module } from "@medusajs/framework/utils"
import MtnMomoPaymentProvider from "./provider"

export default Module("payment_mtn_momo", {
  providers: [MtnMomoPaymentProvider],
})
