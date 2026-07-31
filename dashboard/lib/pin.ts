import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)
const KEY_LENGTH = 64
const PREFIX = 'scrypt'

export function validPin(pin: unknown): pin is string {
  return typeof pin === 'string' && /^\d{4}$/.test(pin)
}

export async function hashPin(pin: string) {
  if (!validPin(pin)) throw new Error('PIN must be exactly 4 digits')
  const salt = randomBytes(16)
  const derived = (await scrypt(pin, salt, KEY_LENGTH)) as Buffer
  return `${PREFIX}$${salt.toString('base64url')}$${derived.toString('base64url')}`
}

export async function verifyPin(pin: string, stored: string | null | undefined) {
  if (!validPin(pin) || !stored) return false

  if (!stored.startsWith(`${PREFIX}$`)) {
    const supplied = Buffer.from(pin)
    const legacy = Buffer.from(stored)
    return supplied.length === legacy.length && timingSafeEqual(supplied, legacy)
  }

  const [, saltValue, hashValue] = stored.split('$')
  if (!saltValue || !hashValue) return false

  try {
    const expected = Buffer.from(hashValue, 'base64url')
    const actual = (await scrypt(pin, Buffer.from(saltValue, 'base64url'), expected.length)) as Buffer
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

export function needsPinUpgrade(stored: string | null | undefined) {
  return Boolean(stored && !stored.startsWith(`${PREFIX}$`))
}
