import { adminPool } from './db'

export type PublicSubscriptionPlan = {
  code: string
  name: string
  description: string
  priceZmw: number
  billingIntervalDays: number
  maxLocations: number
  maxUsers: number
  features: string[]
}

export const REGISTRATION_TRIAL_DAYS = 7

export async function getPublicRegistrationPlans(): Promise<PublicSubscriptionPlan[]> {
  const result = await adminPool.query(`
    SELECT code, name, description, price_zmw, billing_interval_days,
           max_locations, max_users, features
    FROM subscription_plans
    WHERE is_active = TRUE
    ORDER BY price_zmw ASC, name ASC
  `)

  return result.rows.map((row) => ({
    code: String(row.code),
    name: String(row.name),
    description: String(row.description || ''),
    priceZmw: Number(row.price_zmw),
    billingIntervalDays: Number(row.billing_interval_days),
    maxLocations: Number(row.max_locations),
    maxUsers: Number(row.max_users),
    features: Array.isArray(row.features)
      ? row.features.filter((feature: unknown): feature is string => typeof feature === 'string')
      : [],
  }))
}
