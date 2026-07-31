import { adminPool } from './db'
import type { PoolClient } from 'pg'

export class IdentityConflictError extends Error {
  constructor() {
    super('That email is already linked to an account')
    this.name = 'IdentityConflictError'
  }
}

type IdentityLockOptions = {
  excludeStaffId?: string | null
  allowExistingInTenantId?: string | null
}

// All code paths that create or change login emails use the same PostgreSQL
// advisory lock. This closes the check-then-insert race across tenants and
// across the staff/platform identity tables.
export async function withIdentityEmailLock<T>(
  normalizedEmail: string | null,
  options: IdentityLockOptions,
  work: (client: PoolClient) => Promise<T>,
) {
  if (!normalizedEmail) {
    const client = await adminPool.connect()
    try {
      return await work(client)
    } finally {
      client.release()
    }
  }

  const client = await adminPool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [normalizedEmail])
    const existing = await client.query(`
      SELECT identity_type, staff_id, tenant_id
      FROM (
        SELECT 'staff'::text AS identity_type, id AS staff_id, tenant_id
        FROM staff
        WHERE LOWER(BTRIM(email)) = $1
        UNION ALL
        SELECT 'platform_admin'::text, id, NULL::uuid
        FROM platform_admins
        WHERE LOWER(BTRIM(email)) = $1
      ) identities
      WHERE ($2::uuid IS NULL OR staff_id <> $2::uuid)
        AND ($3::uuid IS NULL OR tenant_id IS DISTINCT FROM $3::uuid)
      LIMIT 1
    `, [normalizedEmail, options.excludeStaffId || null, options.allowExistingInTenantId || null])

    if ((existing.rowCount ?? 0) > 0) throw new IdentityConflictError()
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}
