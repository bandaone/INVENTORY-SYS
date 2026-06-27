import { Pool } from 'pg';

// IMPORTANT: The app uses the RESTRICTED role (retail_os_app), NOT the table owner (retail_os).
// PostgreSQL bypasses RLS for the table owner by default. Using retail_os_app ensures
// RLS policies are enforced for every query, providing true tenant isolation.
const appConnectionString =
  process.env.APP_DATABASE_URL ||
  'postgresql://retail_os_app:retail_os_app_password@postgres:5432/retail_os_dev';

// Admin pool (table owner) — ONLY for super-admin operations and cross-tenant queries
const adminConnectionString =
  process.env.DATABASE_URL ||
  'postgresql://retail_os:retail_os_dev_password@postgres:5432/retail_os_dev';

// Tenant-scoped pool — uses restricted user, RLS applies
export const pool = new Pool({ 
  connectionString: appConnectionString,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined
});

// Admin pool — bypasses RLS, only for super-admin pages
export const adminPool = new Pool({ 
  connectionString: adminConnectionString,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined
});

export function requireTenantId(tenantId?: string | null): string {
  if (!tenantId) throw new Error('Tenant context required');
  return tenantId;
}

// Super Admin queries — uses owner connection, RLS NOT enforced (intentional)
export async function fetchQuery(text: string, params?: any[]) {
  const client = await adminPool.connect();
  try {
    const res = await client.query(text, params);
    return res.rows;
  } catch (err) {
    console.error('[DB ADMIN ERROR]:', err);
    throw new Error('A database error occurred.');
  } finally {
    client.release();
  }
}

// Tenant-scoped queries — uses restricted connection, RLS IS enforced
export async function fetchTenantQuery(tenantId: string, text: string, params?: any[]) {
  requireTenantId(tenantId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Use SET LOCAL so the setting is ONLY active within this transaction
    // and is automatically cleared when the transaction ends.
    // This prevents connection pool contamination between tenants.
    await client.query(`SET LOCAL app.current_tenant = '${tenantId}'`);
    const res = await client.query(text, params);
    await client.query('COMMIT');
    return res.rows;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[RLS TENANT ERROR] tenantId:', tenantId, 'error:', err);
    throw new Error('A database error occurred.');
  } finally {
    client.release();
  }
}
