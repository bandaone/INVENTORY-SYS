export const SESSION_ROLES = [
  'superadmin',
  'owner',
  'store_manager',
  'cashier',
  'stock_clerk',
] as const

export type SessionRole = (typeof SESSION_ROLES)[number]

export type SessionClaims = {
  version: 1
  issuer: 'retail-os'
  audience: 'dashboard'
  type: 'tenant' | 'platform'
  sessionId: string
  staffId: string
  role: SessionRole
  tenantId: string | null
  locationId: string | null
  shiftId: string | null
  authVersion: number
  issuedAt: number
  expiresAt: number
}

export type NewSessionClaims = Omit<
  SessionClaims,
  'version' | 'issuer' | 'audience' | 'type' | 'sessionId' | 'issuedAt' | 'expiresAt'
> & {
  maxAgeSeconds?: number
}

const encoder = new TextEncoder()
const DEFAULT_MAX_AGE_SECONDS = 60 * 60 * 12
const SUPERADMIN_MAX_AGE_SECONDS = 60 * 60 * 2
const MAX_TOKEN_LENGTH = 4096
const MAX_PAYLOAD_LENGTH = 3072
// PostgreSQL accepts canonical UUID text regardless of RFC version/variant.
// Legacy Retail OS seed/import data includes such values, so validate syntax
// rather than rejecting otherwise valid database identifiers.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function decodeSigningSecret(value: string, variableName: string) {
  const bytes = fromBase64Url(value)
  if (bytes.length < 32) throw new Error(`${variableName} must contain at least 32 random bytes encoded as base64url`)
  return bytes
}

function getSessionSecrets() {
  const configured = process.env.SESSION_SIGNING_KEY
  if (configured) {
    const current = decodeSigningSecret(configured, 'SESSION_SIGNING_KEY')
    const previous = process.env.SESSION_SIGNING_KEY_PREVIOUS
      ? decodeSigningSecret(process.env.SESSION_SIGNING_KEY_PREVIOUS, 'SESSION_SIGNING_KEY_PREVIOUS')
      : null
    return { current, previous }
  }
  throw new Error('SESSION_SIGNING_KEY is required and must be a base64url-encoded random secret')
}

function toBase64Url(bytes: Uint8Array) {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = atob(padded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

async function signingKey(secret: Uint8Array) {
  // Copy into a plain ArrayBuffer. TypeScript's DOM definitions reject a
  // Uint8Array backed by a possible SharedArrayBuffer as Web Crypto key data.
  const keyData = new Uint8Array(secret.byteLength)
  keyData.set(secret)
  return crypto.subtle.importKey(
    'raw',
    keyData.buffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

function validUuidOrNull(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && UUID_PATTERN.test(value))
}

function isSessionClaims(value: unknown): value is SessionClaims {
  if (!value || typeof value !== 'object') return false
  const claims = value as Partial<SessionClaims>
  if (claims.version !== 1) return false
  if (claims.issuer !== 'retail-os' || claims.audience !== 'dashboard') return false
  if (claims.type !== 'tenant' && claims.type !== 'platform') return false
  if (typeof claims.sessionId !== 'string' || !UUID_PATTERN.test(claims.sessionId)) return false
  if (typeof claims.staffId !== 'string' || !UUID_PATTERN.test(claims.staffId)) return false
  if (!SESSION_ROLES.includes(claims.role as SessionRole)) return false
  if (!validUuidOrNull(claims.tenantId)) return false
  if (!validUuidOrNull(claims.locationId)) return false
  if (!validUuidOrNull(claims.shiftId)) return false
  if (!Number.isInteger(claims.authVersion) || Number(claims.authVersion) < 0) return false
  if (typeof claims.issuedAt !== 'number' || typeof claims.expiresAt !== 'number') return false
  if (!Number.isInteger(claims.issuedAt) || !Number.isInteger(claims.expiresAt)) return false
  if (claims.expiresAt <= Math.floor(Date.now() / 1000)) return false
  if (claims.issuedAt > Math.floor(Date.now() / 1000) + 60) return false
  const maxAge = claims.role === 'superadmin' ? SUPERADMIN_MAX_AGE_SECONDS : DEFAULT_MAX_AGE_SECONDS
  if (claims.expiresAt - claims.issuedAt <= 0 || claims.expiresAt - claims.issuedAt > maxAge) return false
  if (claims.type === 'platform' && (
    claims.role !== 'superadmin'
    || claims.tenantId !== null
    || claims.locationId !== null
    || claims.shiftId !== null
  )) return false
  if (claims.type === 'tenant' && (claims.role === 'superadmin' || claims.tenantId === null)) return false
  return true
}

export async function createSessionToken(input: NewSessionClaims) {
  const issuedAt = Math.floor(Date.now() / 1000)
  const roleMaxAge = input.role === 'superadmin' ? SUPERADMIN_MAX_AGE_SECONDS : DEFAULT_MAX_AGE_SECONDS
  const maxAgeSeconds = Math.min(input.maxAgeSeconds ?? roleMaxAge, roleMaxAge)
  const claims: SessionClaims = {
    version: 1,
    issuer: 'retail-os',
    audience: 'dashboard',
    type: input.role === 'superadmin' ? 'platform' : 'tenant',
    sessionId: crypto.randomUUID(),
    staffId: input.staffId,
    role: input.role,
    tenantId: input.tenantId,
    locationId: input.locationId,
    shiftId: input.shiftId,
    authVersion: input.authVersion,
    issuedAt,
    expiresAt: issuedAt + maxAgeSeconds,
  }

  if (!isSessionClaims(claims)) throw new Error('Invalid session claims')

  const payload = toBase64Url(encoder.encode(JSON.stringify(claims)))
  const signedValue = `v1.${payload}`
  const signature = await crypto.subtle.sign(
    'HMAC',
    await signingKey(getSessionSecrets().current),
    encoder.encode(signedValue),
  )
  return `${signedValue}.${toBase64Url(new Uint8Array(signature))}`
}

export async function verifySessionToken(token?: string | null): Promise<SessionClaims | null> {
  if (!token || token.length > MAX_TOKEN_LENGTH) return null
  const pieces = token.split('.')
  if (pieces.length !== 3 || pieces[0] !== 'v1' || !pieces[1] || !pieces[2]) return null
  if (pieces[1].length > MAX_PAYLOAD_LENGTH) return null

  try {
    const secrets = getSessionSecrets()
    const signedValue = `${pieces[0]}.${pieces[1]}`
    const signature = fromBase64Url(pieces[2])
    const validCurrent = await crypto.subtle.verify(
      'HMAC', await signingKey(secrets.current), signature, encoder.encode(signedValue),
    )
    const validPrevious = !validCurrent && secrets.previous
      ? await crypto.subtle.verify(
        'HMAC', await signingKey(secrets.previous), signature, encoder.encode(signedValue),
      )
      : false
    const valid = validCurrent || validPrevious
    if (!valid) return null

    const decoded = new TextDecoder().decode(fromBase64Url(pieces[1]))
    const claims: unknown = JSON.parse(decoded)
    return isSessionClaims(claims) ? claims : null
  } catch {
    return null
  }
}

export function sessionMaxAge(claims: SessionClaims) {
  return Math.max(0, claims.expiresAt - Math.floor(Date.now() / 1000))
}

export function sessionCookieName() {
  return process.env.NODE_ENV === 'production' ? '__Host-retail_os_session' : 'retail_os_session'
}

export function assertSessionConfiguration() {
  getSessionSecrets()
}
