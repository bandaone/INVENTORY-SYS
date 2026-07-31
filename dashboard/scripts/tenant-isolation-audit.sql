-- Retail OS tenant-isolation audit
--
-- Run with psql as a database role that can inspect every application table:
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 \
--     -f dashboard/scripts/tenant-isolation-audit.sql
--
-- This script is deliberately read-only. It creates no tables or functions,
-- changes no rows, and ends with ROLLBACK. Some checks use psql meta-commands,
-- so execute the file with psql rather than through a generic migration runner.

\set ON_ERROR_STOP on
\pset pager off

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';

\echo '=== Audit context ==='
SELECT
  current_database() AS database_name,
  current_user AS audit_role,
  pg_is_in_recovery() AS database_is_replica,
  current_setting('server_version') AS postgres_version,
  transaction_isolation,
  transaction_read_only
FROM (
  SELECT
    current_setting('transaction_isolation') AS transaction_isolation,
    current_setting('transaction_read_only') AS transaction_read_only
) AS transaction_settings;

\echo '=== Security properties of known database roles ==='
SELECT
  rolname,
  rolcanlogin,
  rolinherit,
  rolcreatedb,
  rolcreaterole,
  rolsuper,
  rolreplication,
  rolbypassrls
FROM pg_roles
WHERE rolname IN ('retail_os', 'retail_os_app')
ORDER BY rolname;

\echo '=== Roles granted to retail_os_app ==='
SELECT
  granted_role.rolname AS granted_role,
  granted_role.rolsuper,
  granted_role.rolbypassrls,
  membership.admin_option
FROM pg_auth_members AS membership
JOIN pg_roles AS member_role ON member_role.oid = membership.member
JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
WHERE member_role.rolname = 'retail_os_app'
ORDER BY granted_role.rolname;

\echo '=== Effective public-schema privileges ==='
SELECT
  nspname AS schema_name,
  pg_get_userbyid(nspowner) AS schema_owner,
  nspacl AS explicit_acl
FROM pg_namespace
WHERE nspname = 'public';

SELECT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = 'retail_os_app'
) AS has_retail_os_app_role
\gset
\if :has_retail_os_app_role
SELECT
  'retail_os_app' AS role_name,
  has_schema_privilege('retail_os_app', 'public', 'USAGE') AS can_use_public_schema,
  has_schema_privilege('retail_os_app', 'public', 'CREATE') AS can_create_in_public_schema;
\else
\echo 'retail_os_app does not exist; skipping effective role privilege check.'
\endif

\echo '=== Public tables, ownership, tenant columns, and RLS state ==='
WITH public_tables AS (
  SELECT
    c.oid,
    n.nspname,
    c.relname,
    c.relowner,
    c.relrowsecurity,
    c.relforcerowsecurity
  FROM pg_class AS c
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
)
SELECT
  p.relname AS table_name,
  pg_get_userbyid(p.relowner) AS table_owner,
  EXISTS (
    SELECT 1
    FROM pg_attribute AS a
    WHERE a.attrelid = p.oid
      AND a.attname = 'tenant_id'
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) AS has_tenant_id,
  p.relrowsecurity AS rls_enabled,
  p.relforcerowsecurity AS rls_forced,
  COALESCE(
    (
      SELECT string_agg(policy.policyname, ', ' ORDER BY policy.policyname)
      FROM pg_policies AS policy
      WHERE policy.schemaname = p.nspname
        AND policy.tablename = p.relname
    ),
    ''
  ) AS policies
FROM public_tables AS p
ORDER BY p.relname;

\echo '=== Expected isolation-relevant table presence ==='
WITH expected(table_name, tenancy_kind) AS (
  VALUES
    ('tenants'::text, 'tenant registry'::text),
    ('locations', 'direct tenant_id'),
    ('staff', 'direct tenant_id'),
    ('variants', 'direct tenant_id'),
    ('garments', 'direct tenant_id'),
    ('import_profiles', 'direct tenant_id'),
    ('transactions', 'direct tenant_id'),
    ('transaction_items', 'parent-derived'),
    ('onboarding_sessions', 'direct tenant_id'),
    ('onboarding_events', 'direct tenant_id'),
    ('tenant_settings', 'direct tenant_id'),
    ('stock_movements', 'direct tenant_id'),
    ('stocktake_sessions', 'direct tenant_id'),
    ('stocktake_scans', 'parent-derived'),
    ('sync_queue', 'direct tenant_id'),
    ('sync_conflicts', 'direct tenant_id'),
    ('audit_trail', 'direct tenant_id'),
    ('cash_drawers', 'direct tenant_id'),
    ('shifts', 'direct tenant_id'),
    ('sales_returns', 'direct tenant_id'),
    ('sales_return_items', 'parent-derived'),
    ('shift_closing_reports', 'direct tenant_id'),
    ('billing_events', 'direct tenant_id'),
    ('platform_access_events', 'direct tenant_id'),
    ('support_tickets', 'direct tenant_id'),
    ('tenant_daily_rollups', 'direct tenant_id'),
    ('billing_history', 'direct tenant_id'),
    ('zra_sync_queue', 'direct tenant_id stored as text'),
    ('platform_admins', 'platform-global'),
    ('platform_health_snapshots', 'platform-global'),
    ('subscription_plans', 'platform-global read-only')
)
SELECT
  expected.table_name,
  expected.tenancy_kind,
  to_regclass(format('public.%I', expected.table_name)) IS NOT NULL AS table_exists
FROM expected
ORDER BY expected.table_name;

\echo '=== Known parent-derived tables that require their own RLS ==='
WITH expected(table_name) AS (
  VALUES
    ('transaction_items'::text),
    ('stocktake_scans'::text),
    ('sales_return_items'::text)
)
SELECT
  expected.table_name,
  c.oid IS NOT NULL AS table_exists,
  COALESCE(c.relrowsecurity, false) AS rls_enabled,
  COALESCE(c.relforcerowsecurity, false) AS rls_forced,
  COALESCE(
    (
      SELECT string_agg(policy.policyname, ', ' ORDER BY policy.policyname)
      FROM pg_policies AS policy
      WHERE policy.schemaname = 'public'
        AND policy.tablename = expected.table_name
    ),
    ''
  ) AS policies
FROM expected
LEFT JOIN pg_class AS c
  ON c.oid = to_regclass(format('public.%I', expected.table_name))
ORDER BY expected.table_name;

\echo '=== RLS policies in public ==='
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

\echo '=== Explicit PUBLIC and retail_os_app table grants ==='
SELECT
  grantee,
  table_name,
  privilege_type,
  is_grantable
FROM information_schema.table_privileges
WHERE table_schema = 'public'
  AND grantee IN ('PUBLIC', 'retail_os_app')
ORDER BY table_name, grantee, privilege_type;

\echo '=== Explicit column ACLs (table grants are reported above) ==='
SELECT
  relation.relname AS table_name,
  attribute.attname AS column_name,
  attribute.attacl AS explicit_column_acl
FROM pg_attribute AS attribute
JOIN pg_class AS relation ON relation.oid = attribute.attrelid
JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
WHERE namespace.nspname = 'public'
  AND relation.relkind IN ('r', 'p')
  AND attribute.attnum > 0
  AND NOT attribute.attisdropped
  AND attribute.attacl IS NOT NULL
ORDER BY relation.relname, attribute.attname;

\echo '=== Tables accessible to retail_os_app while RLS is disabled ==='
SELECT DISTINCT
  privilege.table_name,
  privilege.privilege_type,
  c.relrowsecurity AS rls_enabled
FROM information_schema.table_privileges AS privilege
JOIN pg_class AS c
  ON c.oid = to_regclass(format('public.%I', privilege.table_name))
WHERE privilege.table_schema = 'public'
  AND privilege.grantee = 'retail_os_app'
  AND privilege.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  AND NOT c.relrowsecurity
ORDER BY privilege.table_name, privilege.privilege_type;

\echo '=== Foreign keys that are not yet validated ==='
SELECT
  constraint_row.conrelid::regclass AS child_table,
  constraint_row.conname AS constraint_name,
  constraint_row.confrelid::regclass AS parent_table,
  pg_get_constraintdef(constraint_row.oid, true) AS definition
FROM pg_constraint AS constraint_row
WHERE constraint_row.contype = 'f'
  AND NOT constraint_row.convalidated
ORDER BY constraint_row.conrelid::regclass::text, constraint_row.conname;

\echo '=== Tenant-bearing child-to-parent foreign keys lacking tenant_id in the key ==='
WITH foreign_keys AS (
  SELECT
    constraint_row.oid,
    constraint_row.conrelid,
    constraint_row.confrelid,
    constraint_row.conname,
    constraint_row.conkey,
    constraint_row.confkey
  FROM pg_constraint AS constraint_row
  WHERE constraint_row.contype = 'f'
),
tenant_foreign_keys AS (
  SELECT foreign_key.*
  FROM foreign_keys AS foreign_key
  WHERE EXISTS (
    SELECT 1
    FROM pg_attribute AS child_tenant
    WHERE child_tenant.attrelid = foreign_key.conrelid
      AND child_tenant.attname = 'tenant_id'
      AND child_tenant.attnum > 0
      AND NOT child_tenant.attisdropped
  )
    AND EXISTS (
      SELECT 1
      FROM pg_attribute AS parent_tenant
      WHERE parent_tenant.attrelid = foreign_key.confrelid
        AND parent_tenant.attname = 'tenant_id'
        AND parent_tenant.attnum > 0
        AND NOT parent_tenant.attisdropped
    )
)
SELECT
  tenant_foreign_key.conrelid::regclass AS child_table,
  tenant_foreign_key.conname AS constraint_name,
  tenant_foreign_key.confrelid::regclass AS parent_table,
  pg_get_constraintdef(tenant_foreign_key.oid, true) AS definition
FROM tenant_foreign_keys AS tenant_foreign_key
WHERE NOT EXISTS (
  SELECT 1
  FROM unnest(tenant_foreign_key.conkey) AS child_key(attnum)
  JOIN pg_attribute AS child_column
    ON child_column.attrelid = tenant_foreign_key.conrelid
   AND child_column.attnum = child_key.attnum
  WHERE child_column.attname = 'tenant_id'
)
ORDER BY tenant_foreign_key.conrelid::regclass::text, tenant_foreign_key.conname;

\echo '=== Ambiguous normalized active staff emails ==='
WITH normalized_staff AS (
  SELECT
    id,
    tenant_id,
    name,
    role,
    lower(btrim(email)) AS normalized_email
  FROM staff
  WHERE is_active
    AND NULLIF(btrim(email), '') IS NOT NULL
)
SELECT
  normalized_email,
  count(*) AS staff_record_count,
  count(DISTINCT tenant_id) AS tenant_count,
  jsonb_agg(
    jsonb_build_object(
      'staff_id', id,
      'tenant_id', tenant_id,
      'name', name,
      'role', role
    )
    ORDER BY tenant_id, id
  ) AS matching_records
FROM normalized_staff
GROUP BY normalized_email
HAVING count(*) > 1
ORDER BY tenant_count DESC, normalized_email;

\echo '=== Emails shared by active staff and platform administrators ==='
SELECT
  lower(btrim(staff_member.email)) AS normalized_email,
  count(DISTINCT staff_member.id) AS staff_records,
  count(DISTINCT staff_member.tenant_id) AS tenant_count,
  count(DISTINCT platform_admin.id) AS platform_admin_records
FROM staff AS staff_member
JOIN platform_admins AS platform_admin
  ON lower(btrim(platform_admin.email)) = lower(btrim(staff_member.email))
WHERE staff_member.is_active
  AND platform_admin.is_active
  AND NULLIF(btrim(staff_member.email), '') IS NOT NULL
GROUP BY lower(btrim(staff_member.email))
ORDER BY normalized_email;

\echo '=== Active operational staff without a store assignment ==='
SELECT id AS staff_id, tenant_id, name, email, role
FROM staff
WHERE is_active
  AND role IN ('store_manager', 'cashier', 'stock_clerk')
  AND location_id IS NULL
ORDER BY tenant_id, role, id;

\echo '=== Ambiguous normalized active owner emails ==='
WITH normalized_owners AS (
  SELECT
    id,
    tenant_id,
    name,
    lower(btrim(email)) AS normalized_email
  FROM staff
  WHERE role = 'owner'
    AND is_active
    AND NULLIF(btrim(email), '') IS NOT NULL
)
SELECT
  normalized_email,
  count(*) AS owner_record_count,
  count(DISTINCT tenant_id) AS tenant_count,
  jsonb_agg(
    jsonb_build_object(
      'staff_id', id,
      'tenant_id', tenant_id,
      'name', name
    )
    ORDER BY tenant_id, id
  ) AS matching_records
FROM normalized_owners
GROUP BY normalized_email
HAVING count(*) > 1
ORDER BY tenant_count DESC, normalized_email;

\echo '=== Tenants without exactly one active owner ==='
SELECT
  tenant.id AS tenant_id,
  tenant.name AS tenant_name,
  count(staff_member.id) FILTER (
    WHERE staff_member.role = 'owner' AND staff_member.is_active
  ) AS active_owner_count,
  jsonb_agg(
    jsonb_build_object(
      'staff_id', staff_member.id,
      'name', staff_member.name,
      'email', staff_member.email,
      'active', staff_member.is_active
    )
    ORDER BY staff_member.created_at, staff_member.id
  ) FILTER (WHERE staff_member.role = 'owner') AS owner_records
FROM tenants AS tenant
LEFT JOIN staff AS staff_member ON staff_member.tenant_id = tenant.id
GROUP BY tenant.id, tenant.name
HAVING count(staff_member.id) FILTER (
  WHERE staff_member.role = 'owner' AND staff_member.is_active
) <> 1
ORDER BY active_owner_count DESC, tenant.name, tenant.id;

\echo '=== Tenant settings whose owner_email does not match an active owner ==='
SELECT
  settings.tenant_id,
  settings.business_name,
  settings.owner_email,
  settings.updated_at
FROM tenant_settings AS settings
WHERE NULLIF(btrim(settings.owner_email), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM staff AS owner_staff
    WHERE owner_staff.tenant_id = settings.tenant_id
      AND owner_staff.role = 'owner'
      AND owner_staff.is_active
      AND lower(btrim(owner_staff.email)) = lower(btrim(settings.owner_email))
  )
ORDER BY settings.tenant_id;

\echo '=== Legacy plaintext/default PIN indicators (PIN values are not displayed) ==='
SELECT
  'staff'::text AS identity_source,
  staff_member.id::text AS identity_id,
  staff_member.tenant_id::text AS tenant_id,
  staff_member.email,
  staff_member.role,
  CASE
    WHEN staff_member.pin_hash = '1234' THEN 'known default 1234'
    WHEN staff_member.pin_hash ~ '^[0-9]{4}$' THEN 'legacy four-digit plaintext'
    ELSE 'unrecognized non-hash credential'
  END AS credential_problem
FROM staff AS staff_member
WHERE staff_member.pin_hash IS NOT NULL
  AND (
    staff_member.pin_hash ~ '^[0-9]{4}$'
    OR staff_member.pin_hash !~ '^(scrypt\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+|\$(2[aby]|argon2(id|i|d))\$)'
  )

UNION ALL

SELECT
  'platform_admins',
  platform_admin.id::text,
  NULL::text,
  platform_admin.email,
  'platform_admin',
  CASE
    WHEN platform_admin.pin_hash = '1234' THEN 'known default 1234'
    WHEN platform_admin.pin_hash ~ '^[0-9]{4}$' THEN 'legacy four-digit plaintext'
    ELSE 'unrecognized non-hash credential'
  END
FROM platform_admins AS platform_admin
WHERE platform_admin.pin_hash IS NOT NULL
  AND (
    platform_admin.pin_hash ~ '^[0-9]{4}$'
    OR platform_admin.pin_hash !~ '^(scrypt\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+|\$(2[aby]|argon2(id|i|d))\$)'
  )
ORDER BY identity_source, tenant_id, identity_id;

\echo '=== Tenant/store/staff summary for manual ownership review ==='
SELECT
  tenant.id AS tenant_id,
  tenant.name AS tenant_name,
  tenant.created_at AS tenant_created_at,
  settings.business_name AS settings_business_name,
  settings.owner_email AS settings_owner_email,
  count(DISTINCT location.id) AS location_count,
  count(DISTINCT staff_member.id) AS staff_count,
  count(DISTINCT staff_member.id) FILTER (
    WHERE staff_member.role = 'owner' AND staff_member.is_active
  ) AS active_owner_count,
  min(location.created_at) AS first_location_created_at,
  max(location.created_at) AS last_location_created_at,
  min(staff_member.created_at) AS first_staff_created_at,
  max(staff_member.created_at) AS last_staff_created_at
FROM tenants AS tenant
LEFT JOIN tenant_settings AS settings ON settings.tenant_id = tenant.id
LEFT JOIN locations AS location ON location.tenant_id = tenant.id
LEFT JOIN staff AS staff_member ON staff_member.tenant_id = tenant.id
GROUP BY
  tenant.id,
  tenant.name,
  tenant.created_at,
  settings.business_name,
  settings.owner_email
ORDER BY tenant.created_at, tenant.id;

\echo '=== UUID tenant_id values with no tenant parent ==='
-- Generate one SELECT per UUID tenant_id column. This is still read-only and
-- avoids hard-coding every optional migration table.
SELECT format(
  'SELECT %L AS table_name, count(*) AS orphan_count FROM %I.%I AS child LEFT JOIN public.tenants AS tenant ON tenant.id = child.tenant_id WHERE child.tenant_id IS NOT NULL AND tenant.id IS NULL HAVING count(*) > 0;',
  c.relname,
  n.nspname,
  c.relname
)
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
JOIN pg_attribute AS a
  ON a.attrelid = c.oid
 AND a.attname = 'tenant_id'
 AND a.attnum > 0
 AND NOT a.attisdropped
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')
  AND c.relname <> 'tenants'
  AND a.atttypid = 'uuid'::regtype
ORDER BY c.relname
\gexec

\echo '=== Cross-tenant direct and parent-derived relationships ==='
WITH violations AS (
  SELECT 'staff.location_id'::text AS relationship,
         staff_member.id::text AS row_id,
         staff_member.tenant_id AS row_tenant,
         location.id::text AS referenced_id,
         location.tenant_id AS referenced_tenant
  FROM staff AS staff_member
  JOIN locations AS location ON location.id = staff_member.location_id
  WHERE staff_member.tenant_id IS DISTINCT FROM location.tenant_id

  UNION ALL
  SELECT 'garments.variant_id', garment.serial, garment.tenant_id,
         variant.id::text, variant.tenant_id
  FROM garments AS garment
  JOIN variants AS variant ON variant.id = garment.variant_id
  WHERE garment.tenant_id IS DISTINCT FROM variant.tenant_id

  UNION ALL
  SELECT 'garments.location_id', garment.serial, garment.tenant_id,
         location.id::text, location.tenant_id
  FROM garments AS garment
  JOIN locations AS location ON location.id = garment.location_id
  WHERE garment.tenant_id IS DISTINCT FROM location.tenant_id

  UNION ALL
  SELECT 'transactions.location_id', sale.id::text, sale.tenant_id,
         location.id::text, location.tenant_id
  FROM transactions AS sale
  JOIN locations AS location ON location.id = sale.location_id
  WHERE sale.tenant_id IS DISTINCT FROM location.tenant_id

  UNION ALL
  SELECT 'transactions.cashier_id', sale.id::text, sale.tenant_id,
         cashier.id::text, cashier.tenant_id
  FROM transactions AS sale
  JOIN staff AS cashier ON cashier.id = sale.cashier_id
  WHERE sale.tenant_id IS DISTINCT FROM cashier.tenant_id

  UNION ALL
  SELECT 'transaction_items.garment_serial', item.id::text, sale.tenant_id,
         garment.serial, garment.tenant_id
  FROM transaction_items AS item
  JOIN transactions AS sale ON sale.id = item.transaction_id
  JOIN garments AS garment ON garment.serial = item.garment_serial
  WHERE sale.tenant_id IS DISTINCT FROM garment.tenant_id

  UNION ALL
  SELECT 'transaction_items.variant_id', item.id::text, sale.tenant_id,
         variant.id::text, variant.tenant_id
  FROM transaction_items AS item
  JOIN transactions AS sale ON sale.id = item.transaction_id
  JOIN variants AS variant ON variant.id = item.variant_id
  WHERE sale.tenant_id IS DISTINCT FROM variant.tenant_id

  UNION ALL
  SELECT 'stock_movements.garment_serial', movement.id::text, movement.tenant_id,
         garment.serial, garment.tenant_id
  FROM stock_movements AS movement
  JOIN garments AS garment ON garment.serial = movement.garment_serial
  WHERE movement.tenant_id IS DISTINCT FROM garment.tenant_id

  UNION ALL
  SELECT 'stock_movements.from_location_id', movement.id::text, movement.tenant_id,
         location.id::text, location.tenant_id
  FROM stock_movements AS movement
  JOIN locations AS location ON location.id = movement.from_location_id
  WHERE movement.tenant_id IS DISTINCT FROM location.tenant_id

  UNION ALL
  SELECT 'stock_movements.to_location_id', movement.id::text, movement.tenant_id,
         location.id::text, location.tenant_id
  FROM stock_movements AS movement
  JOIN locations AS location ON location.id = movement.to_location_id
  WHERE movement.tenant_id IS DISTINCT FROM location.tenant_id

  UNION ALL
  SELECT 'stock_movements.actor_id', movement.id::text, movement.tenant_id,
         actor.id::text, actor.tenant_id
  FROM stock_movements AS movement
  JOIN staff AS actor ON actor.id = movement.actor_id
  WHERE movement.tenant_id IS DISTINCT FROM actor.tenant_id

  UNION ALL
  SELECT 'stock_movements.transaction_id', movement.id::text, movement.tenant_id,
         sale.id::text, sale.tenant_id
  FROM stock_movements AS movement
  JOIN transactions AS sale ON sale.id = movement.transaction_id
  WHERE movement.tenant_id IS DISTINCT FROM sale.tenant_id

  UNION ALL
  SELECT 'stocktake_sessions.location_id', stocktake.id::text, stocktake.tenant_id,
         location.id::text, location.tenant_id
  FROM stocktake_sessions AS stocktake
  JOIN locations AS location ON location.id = stocktake.location_id
  WHERE stocktake.tenant_id IS DISTINCT FROM location.tenant_id

  UNION ALL
  SELECT 'stocktake_sessions.clerk_id', stocktake.id::text, stocktake.tenant_id,
         clerk.id::text, clerk.tenant_id
  FROM stocktake_sessions AS stocktake
  JOIN staff AS clerk ON clerk.id = stocktake.clerk_id
  WHERE stocktake.tenant_id IS DISTINCT FROM clerk.tenant_id

  UNION ALL
  SELECT 'stocktake_scans.garment_serial', scan.id::text, stocktake.tenant_id,
         garment.serial, garment.tenant_id
  FROM stocktake_scans AS scan
  JOIN stocktake_sessions AS stocktake ON stocktake.id = scan.session_id
  JOIN garments AS garment ON garment.serial = scan.garment_serial
  WHERE stocktake.tenant_id IS DISTINCT FROM garment.tenant_id

  UNION ALL
  SELECT 'sync_conflicts.resolved_by', conflict.id::text, conflict.tenant_id,
         resolver.id::text, resolver.tenant_id
  FROM sync_conflicts AS conflict
  JOIN staff AS resolver ON resolver.id = conflict.resolved_by
  WHERE conflict.tenant_id IS DISTINCT FROM resolver.tenant_id

  UNION ALL
  SELECT 'sync_conflicts.garment_serial', conflict.id::text, conflict.tenant_id,
         garment.serial, garment.tenant_id
  FROM sync_conflicts AS conflict
  JOIN garments AS garment ON garment.serial = conflict.garment_serial
  WHERE conflict.tenant_id IS DISTINCT FROM garment.tenant_id

  UNION ALL
  SELECT 'audit_trail.actor_id', audit_event.id::text, audit_event.tenant_id,
         actor.id::text, actor.tenant_id
  FROM audit_trail AS audit_event
  JOIN staff AS actor ON actor.id = audit_event.actor_id
  WHERE audit_event.tenant_id IS DISTINCT FROM actor.tenant_id

  UNION ALL
  SELECT 'cash_drawers.location_id', drawer.id::text, drawer.tenant_id,
         location.id::text, location.tenant_id
  FROM cash_drawers AS drawer
  JOIN locations AS location ON location.id = drawer.location_id
  WHERE drawer.tenant_id IS DISTINCT FROM location.tenant_id

  UNION ALL
  SELECT 'cash_drawers.cashier_id', drawer.id::text, drawer.tenant_id,
         cashier.id::text, cashier.tenant_id
  FROM cash_drawers AS drawer
  JOIN staff AS cashier ON cashier.id = drawer.cashier_id
  WHERE drawer.tenant_id IS DISTINCT FROM cashier.tenant_id

  UNION ALL
  SELECT 'shifts.staff_id', shift_row.id::text, shift_row.tenant_id,
         staff_member.id::text, staff_member.tenant_id
  FROM shifts AS shift_row
  JOIN staff AS staff_member ON staff_member.id = shift_row.staff_id
  WHERE shift_row.tenant_id IS DISTINCT FROM staff_member.tenant_id

  UNION ALL
  SELECT 'shifts.location_id', shift_row.id::text, shift_row.tenant_id,
         location.id::text, location.tenant_id
  FROM shifts AS shift_row
  JOIN locations AS location ON location.id = shift_row.location_id
  WHERE shift_row.tenant_id IS DISTINCT FROM location.tenant_id

  UNION ALL
  SELECT 'sales_returns.shift_id', return_row.id::text, return_row.tenant_id,
         shift_row.id::text, shift_row.tenant_id
  FROM sales_returns AS return_row
  JOIN shifts AS shift_row ON shift_row.id = return_row.shift_id
  WHERE return_row.tenant_id IS DISTINCT FROM shift_row.tenant_id

  UNION ALL
  SELECT 'sales_returns.transaction_id', return_row.id::text, return_row.tenant_id,
         sale.id::text, sale.tenant_id
  FROM sales_returns AS return_row
  JOIN transactions AS sale ON sale.id = return_row.transaction_id
  WHERE return_row.tenant_id IS DISTINCT FROM sale.tenant_id

  UNION ALL
  SELECT 'sales_returns.cashier_id', return_row.id::text, return_row.tenant_id,
         cashier.id::text, cashier.tenant_id
  FROM sales_returns AS return_row
  JOIN staff AS cashier ON cashier.id = return_row.cashier_id
  WHERE return_row.tenant_id IS DISTINCT FROM cashier.tenant_id

  UNION ALL
  SELECT 'sales_returns.location_id', return_row.id::text, return_row.tenant_id,
         location.id::text, location.tenant_id
  FROM sales_returns AS return_row
  JOIN locations AS location ON location.id = return_row.location_id
  WHERE return_row.tenant_id IS DISTINCT FROM location.tenant_id

  UNION ALL
  SELECT 'sales_return_items.transaction_item_id', return_item.id::text,
         return_row.tenant_id, sale_item.id::text, sale.tenant_id
  FROM sales_return_items AS return_item
  JOIN sales_returns AS return_row ON return_row.id = return_item.return_id
  JOIN transaction_items AS sale_item ON sale_item.id = return_item.transaction_item_id
  JOIN transactions AS sale ON sale.id = sale_item.transaction_id
  WHERE return_row.tenant_id IS DISTINCT FROM sale.tenant_id

  UNION ALL
  SELECT 'sales_return_items.garment_serial', return_item.id::text,
         return_row.tenant_id, garment.serial, garment.tenant_id
  FROM sales_return_items AS return_item
  JOIN sales_returns AS return_row ON return_row.id = return_item.return_id
  JOIN garments AS garment ON garment.serial = return_item.garment_serial
  WHERE return_row.tenant_id IS DISTINCT FROM garment.tenant_id

  UNION ALL
  SELECT 'shift_closing_reports.shift_id', report.id::text, report.tenant_id,
         shift_row.id::text, shift_row.tenant_id
  FROM shift_closing_reports AS report
  JOIN shifts AS shift_row ON shift_row.id = report.shift_id
  WHERE report.tenant_id IS DISTINCT FROM shift_row.tenant_id

  UNION ALL
  SELECT 'shift_closing_reports.cashier_id', report.id::text, report.tenant_id,
         cashier.id::text, cashier.tenant_id
  FROM shift_closing_reports AS report
  JOIN staff AS cashier ON cashier.id = report.cashier_id
  WHERE report.tenant_id IS DISTINCT FROM cashier.tenant_id

  UNION ALL
  SELECT 'shift_closing_reports.location_id', report.id::text, report.tenant_id,
         location.id::text, location.tenant_id
  FROM shift_closing_reports AS report
  JOIN locations AS location ON location.id = report.location_id
  WHERE report.tenant_id IS DISTINCT FROM location.tenant_id

  UNION ALL
  SELECT 'platform_access_events.staff_id', access_event.id::text,
         access_event.tenant_id, staff_member.id::text, staff_member.tenant_id
  FROM platform_access_events AS access_event
  JOIN staff AS staff_member ON staff_member.id = access_event.staff_id
  WHERE access_event.tenant_id IS DISTINCT FROM staff_member.tenant_id
)
SELECT
  relationship,
  row_id,
  row_tenant,
  referenced_id,
  referenced_tenant
FROM violations
ORDER BY relationship, row_tenant, row_id;

\echo '=== Duplicate stocktake scans in one session ==='
SELECT
  stocktake.tenant_id,
  scan.session_id,
  scan.garment_serial,
  count(*) AS scan_count
FROM stocktake_scans AS scan
JOIN stocktake_sessions AS stocktake ON stocktake.id = scan.session_id
GROUP BY stocktake.tenant_id, scan.session_id, scan.garment_serial
HAVING count(*) > 1
ORDER BY scan_count DESC, stocktake.tenant_id, scan.session_id, scan.garment_serial;

\echo '=== Parent-derived records whose required parent is missing ==='
-- Most missing parents are already prevented by FKs. These checks cover the
-- intentionally unenforced garment references.
SELECT
  'stocktake_scans.garment_serial' AS relationship,
  scan.id::text AS row_id,
  scan.garment_serial AS missing_reference
FROM stocktake_scans AS scan
LEFT JOIN garments AS garment ON garment.serial = scan.garment_serial
WHERE scan.category <> 'unexpected'
  AND garment.serial IS NULL

UNION ALL

SELECT
  'sync_conflicts.garment_serial',
  conflict.id::text,
  conflict.garment_serial
FROM sync_conflicts AS conflict
LEFT JOIN garments AS garment ON garment.serial = conflict.garment_serial
WHERE garment.serial IS NULL
ORDER BY relationship, row_id;

\echo '=== Optional billing_history orphan tenant rows ==='
SELECT (to_regclass('public.billing_history') IS NOT NULL) AS has_billing_history
\gset
\if :has_billing_history
SELECT
  billing.id,
  billing.tenant_id,
  billing.reference_id,
  billing.status,
  billing.created_at
FROM billing_history AS billing
LEFT JOIN tenants AS tenant ON tenant.id = billing.tenant_id
WHERE tenant.id IS NULL
ORDER BY billing.created_at, billing.id;
\else
\echo 'billing_history does not exist; skipping data check.'
\endif

\echo '=== Optional zra_sync_queue invalid/orphan/cross-tenant rows ==='
SELECT (to_regclass('public.zra_sync_queue') IS NOT NULL) AS has_zra_sync_queue
\gset
\if :has_zra_sync_queue
WITH parsed_queue AS (
  SELECT
    queue.*,
    CASE
      WHEN queue.tenant_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN queue.tenant_id::uuid
      ELSE NULL::uuid
    END AS parsed_tenant_id
  FROM zra_sync_queue AS queue
)
SELECT
  parsed_queue.id,
  parsed_queue.tenant_id,
  parsed_queue.transaction_id,
  CASE
    WHEN parsed_queue.parsed_tenant_id IS NULL THEN 'invalid tenant UUID text'
    WHEN tenant.id IS NULL THEN 'orphan tenant'
    WHEN sale.id IS NOT NULL
      AND sale.tenant_id IS DISTINCT FROM parsed_queue.parsed_tenant_id
      THEN 'transaction belongs to another tenant'
    ELSE 'unknown'
  END AS problem
FROM parsed_queue
LEFT JOIN tenants AS tenant ON tenant.id = parsed_queue.parsed_tenant_id
LEFT JOIN transactions AS sale ON sale.id = parsed_queue.transaction_id
WHERE parsed_queue.parsed_tenant_id IS NULL
   OR tenant.id IS NULL
   OR (
     sale.id IS NOT NULL
     AND sale.tenant_id IS DISTINCT FROM parsed_queue.parsed_tenant_id
   )
ORDER BY parsed_queue.created_at, parsed_queue.id;
\else
\echo 'zra_sync_queue does not exist; skipping data check.'
\endif

\echo '=== Audit complete: rolling back read-only transaction ==='
ROLLBACK;
