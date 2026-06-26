import { Module } from "@medusajs/framework/utils"
import ZraInvoiceService from "./service"

export const ZRA_INVOICE_MODULE = "zra_invoice"

export default Module(ZRA_INVOICE_MODULE, {
  service: ZraInvoiceService,
})
