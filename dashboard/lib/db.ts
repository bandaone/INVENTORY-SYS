import { Pool, type PoolClient } from 'pg';

// IMPORTANT: The app uses the RESTRICTED role (retail_os_app), NOT the table owner (retail_os).
// PostgreSQL bypasses RLS for the table owner by default. Using retail_os_app ensures
// RLS policies are enforced for every query, providing true tenant isolation.
const LOCAL_ADMIN_DATABASE_URL =
  'postgresql://retail_os:retail_os_dev_password@postgres:5432/retail_os_dev';
const LOCAL_APP_DATABASE_URL =
  'postgresql://retail_os_app:retail_os_app_password@postgres:5432/retail_os_dev';

function connectionString(variableName: 'DATABASE_URL' | 'APP_DATABASE_URL', localFallback: string) {
  const configured = process.env[variableName];
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${variableName} is required in production`);
  }
  return localFallback;
}

// These identities are intentionally separate. Tenant queries must never fall
// back to the owner connection because PostgreSQL table owners bypass RLS.
const adminConnectionString = connectionString('DATABASE_URL', LOCAL_ADMIN_DATABASE_URL);
const appConnectionString = connectionString('APP_DATABASE_URL', LOCAL_APP_DATABASE_URL);

const databaseSsl = process.env.NODE_ENV === 'production'
  ? {
      rejectUnauthorized: true,
      ...(process.env.DATABASE_CA_CERT
        ? { ca: process.env.DATABASE_CA_CERT.replace(/\\n/g, '\n') }
        : {}),
    }
  : undefined;

// Tenant-scoped pool — uses restricted user, RLS applies
const tenantPool = new Pool({
  connectionString: appConnectionString,
  ssl: databaseSsl,
});

// Admin pool — bypasses RLS, only for super-admin pages
export const adminPool = new Pool({ 
  connectionString: adminConnectionString,
  ssl: databaseSsl,
});

const verifiedTenantClients = new WeakSet<object>();

// A separate URL is not enough: an operator could accidentally point it at the
// owner account. Verify the effective PostgreSQL identity before tenant SQL is
// allowed to run, and cache that result for the lifetime of the connection.
export async function connectTenantClient(): Promise<PoolClient> {
  const client = await tenantPool.connect();
  try {
    if (!verifiedTenantClients.has(client)) {
      const identity = await client.query(`
        SELECT
          current_user AS current_role,
          session_user AS session_role,
          role.rolsuper,
          role.rolcreatedb,
          role.rolcreaterole,
          role.rolreplication,
          role.rolinherit,
          role.rolbypassrls,
          current_setting('row_security') AS row_security,
          to_regprocedure('public.current_tenant_id()') IS NOT NULL AS isolation_function_installed,
          EXISTS (
            SELECT 1
            FROM pg_class relation
            JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
            WHERE namespace.nspname = 'public'
              AND relation.relkind IN ('r', 'p')
              AND relation.relowner = role.oid
          ) AS owns_public_tables,
          EXISTS (
            SELECT 1 FROM pg_auth_members membership WHERE membership.member = role.oid
          ) AS has_role_memberships
        FROM pg_roles role
        WHERE role.rolname = current_user
      `);
      const role = identity.rows[0];
      const unsafe = !role
        || role.current_role !== 'retail_os_app'
        || role.session_role !== 'retail_os_app'
        || role.rolsuper
        || role.rolcreatedb
        || role.rolcreaterole
        || role.rolreplication
        || role.rolinherit
        || role.rolbypassrls
        || role.row_security !== 'on'
        || !role.isolation_function_installed
        || role.owns_public_tables
        || role.has_role_memberships;
      if (unsafe) {
        throw new Error('APP_DATABASE_URL is not connected as the restricted retail_os_app role');
      }
      verifiedTenantClients.add(client);
    }
    return client;
  } catch (error) {
    client.release();
    throw error;
  }
}

export function requireTenantId(tenantId?: string | null): string {
  if (!tenantId) throw new Error('Tenant context required');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) {
    throw new Error('Invalid tenant context');
  }
  return tenantId;
}

// Super Admin queries — uses owner connection, RLS NOT enforced (intentional)
export async function fetchQuery(text: string, params?: any[]) {
  const client = await adminPool.connect();
  try {
    const res = await client.query(text, params);
    return res.rows;
  } catch (err: any) {
    console.error('[DB ADMIN ERROR]:', err);
    throw new Error('A database error occurred: ' + err.message);
  } finally {
    client.release();
  }
}

// Tenant-scoped queries — uses restricted connection, RLS IS enforced
export async function fetchTenantQuery(tenantId: string, text: string, params?: any[]) {
  requireTenantId(tenantId);
  const client = await connectTenantClient();
  try {
    await client.query('BEGIN');
    // Use SET LOCAL so the setting is ONLY active within this transaction
    // and is automatically cleared when the transaction ends.
    // This prevents connection pool contamination between tenants.
    await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const res = await client.query(text, params);
    await client.query('COMMIT');
    return res.rows;
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('[RLS TENANT ERROR] tenantId:', tenantId, 'error:', err);
    throw new Error('A database error occurred: ' + err.message);
  } finally {
    client.release();
  }
}
