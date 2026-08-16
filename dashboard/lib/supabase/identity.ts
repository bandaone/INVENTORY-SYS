import { createHmac } from 'node:crypto'
import { createAdminClient } from './admin'

const MIN_PEPPER_BYTES = 32

function pinPepper() {
  const value = process.env.SUPABASE_PIN_PEPPER
  if (!value || Buffer.byteLength(value, 'utf8') < MIN_PEPPER_BYTES) {
    throw new Error(`SUPABASE_PIN_PEPPER must contain at least ${MIN_PEPPER_BYTES} bytes`)
  }
  return value
}

export function deriveSupabasePassword(_email: string, pin: string) {
  const digest = createHmac('sha256', pinPepper())
    .update(`retail-os-pin\u0000${pin}`)
    .digest('base64url')
  return `Ros1!${digest}`
}

export async function createSupabaseIdentity(email: string, pin: string) {
  const admin = createAdminClient()
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: deriveSupabasePassword(email, pin),
    email_confirm: true,
  })
  if (error || !data.user) throw error || new Error('Supabase did not create the user')
  return data.user
}

export async function deleteSupabaseIdentity(userId: string) {
  const { error } = await createAdminClient().auth.admin.deleteUser(userId)
  if (error) throw error
}

export async function updateSupabaseIdentity(
  userId: string,
  input: { email: string; pin?: string },
) {
  const attributes: { email?: string; password?: string; email_confirm?: boolean } = {}
  if (input.email) {
    attributes.email = input.email
    attributes.email_confirm = true
  }
  if (input.pin) attributes.password = deriveSupabasePassword(input.email, input.pin)
  const { data, error } = await createAdminClient().auth.admin.updateUserById(userId, attributes)
  if (error || !data.user) throw error || new Error('Supabase did not update the user')
  return data.user
}
