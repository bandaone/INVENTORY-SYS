// @ts-nocheck
import { Module } from "@medusajs/framework/utils"
import AirtelMoneyPaymentProvider from "./provider"

export default Module("payment_airtel_money", {
  providers: [AirtelMoneyPaymentProvider],
})
