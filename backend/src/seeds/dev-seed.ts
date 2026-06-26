import { MedusaContainer } from "@medusajs/framework/types"

export default async function devSeed({ container }: { container: MedusaContainer }) {
  console.log("Starting Dev Seed...")

  // We will expand this once migrations are run.
  console.log("Dev seed completed successfully.")
}
