import { adminPool } from './db'

export const MAX_FAILED_LOGINS = 5
export const LOGIN_LOCK_MINUTES = 15

export async function recordStaffLoginFailure(normalizedEmail: string) {
  await adminPool.query(
    `UPDATE staff
     SET failed_login_attempts = COALESCE(failed_login_attempts, 0) + 1,
         lockout_until = CASE
           WHEN COALESCE(failed_login_attempts, 0) + 1 >= $2
             THEN NOW() + ($3::text || ' minutes')::interval
           ELSE lockout_until
         END,
         updated_at = NOW()
     WHERE LOWER(BTRIM(email)) = $1
       AND is_active = true
       AND (lockout_until IS NULL OR lockout_until <= NOW())`,
    [normalizedEmail, MAX_FAILED_LOGINS, LOGIN_LOCK_MINUTES]
  )
}

export async function recordPlatformLoginFailure(id: string) {
  await adminPool.query(
    `UPDATE platform_admins
     SET failed_login_attempts = COALESCE(failed_login_attempts, 0) + 1,
         lockout_until = CASE
           WHEN COALESCE(failed_login_attempts, 0) + 1 >= $2
             THEN NOW() + ($3::text || ' minutes')::interval
           ELSE lockout_until
         END,
         updated_at = NOW()
     WHERE id = $1 AND is_active = true
       AND (lockout_until IS NULL OR lockout_until <= NOW())`,
    [id, MAX_FAILED_LOGINS, LOGIN_LOCK_MINUTES]
  )
}

export async function clearStaffLoginFailures(staffId: string, tenantId: string) {
  await adminPool.query(
    `UPDATE staff
     SET failed_login_attempts = 0, lockout_until = NULL, updated_at = NOW()
     WHERE id = $1 AND tenant_id = $2`,
    [staffId, tenantId]
  )
}

export async function clearPlatformLoginFailures(id: string) {
  await adminPool.query(
    `UPDATE platform_admins
     SET failed_login_attempts = 0, lockout_until = NULL, updated_at = NOW()
     WHERE id = $1`,
    [id]
  )
}
