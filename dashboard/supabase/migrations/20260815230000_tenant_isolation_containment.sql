-- Migration 008: tenant-isolation containment
--
-- Goals:
--   * fail closed when tenant context is absent or malformed;
--   * protect tenant tables and parent-derived child tables with RLS;
--   * prevent new cross-tenant foreign-key relationships where the current
--     schema can express that rule;
--   * explicitly restrict the dashboard's retail_os_app database role; and
--   * add non-destructive platform-admin lockout fields.
--
-- This migration never reassigns or deletes application data. Foreign keys and
-- checks are added NOT VALID: existing anomalies remain available for review,
-- while new inserts/updates must satisfy the constraints. Run the read-only
-- tenant-isolation-audit.sql before and after this migration, repair approved
-- records explicitly, and only then VALIDATE the constraints.
--
-- Operational caveats:
--   * Provision retail_os_app outside this migration using a privileged role.
--     It must be LOGIN, NOINHERIT, NOSUPERUSER, NOCREATEDB, NOCREATEROLE,
--     NOREPLICATION and NOBYPASSRLS, own no public tables, and inherit no roles.
--   * Run this file as the owner of every affected application table.
--   * RLS is deliberately not forced because the current control-plane pool
--     uses the table owner. Tenant traffic must use retail_os_app; the table
--     owner must never be a fallback for tenant requests.
--   * Direct retail_os_app UPDATE access to tenants is revoked. Subscription
--     activation and other lifecycle changes must use the trusted admin path.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';
SET LOCAL search_path = pg_catalog, public;

-- Role attributes such as SUPERUSER/BYPASSRLS cannot be safely removed by an
-- ordinary managed-database migration role. Fail clearly instead of attempting
-- a partially privileged ALTER ROLE and rolling back halfway through rollout.
DO $role_preflight$
DECLARE
  app_role record;
BEGIN
  SELECT * INTO app_role FROM pg_roles WHERE rolname = 'retail_os_app';
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'retail_os_app must be provisioned as a restricted login role before migration 008';
  END IF;

  IF NOT app_role.rolcanlogin
     OR app_role.rolinherit
     OR app_role.rolsuper
     OR app_role.rolcreatedb
     OR app_role.rolcreaterole
     OR app_role.rolreplication
     OR app_role.rolbypassrls
     OR COALESCE(app_role.rolconfig, ARRAY[]::text[]) @> ARRAY['row_security=off'] THEN
    RAISE EXCEPTION
      'retail_os_app has unsafe role attributes; provision LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS with row_security=on';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_auth_members WHERE member = app_role.oid
  ) THEN
    RAISE EXCEPTION 'retail_os_app must not inherit or be able to SET ROLE into another database role';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
      AND relation.relowner = app_role.oid
  ) THEN
    RAISE EXCEPTION 'retail_os_app must not own application tables because owners bypass ordinary RLS';
  END IF;

  IF NOT has_database_privilege('retail_os_app', current_database(), 'CONNECT') THEN
    RAISE EXCEPTION 'retail_os_app needs CONNECT on database %', current_database();
  END IF;
END
$role_preflight$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM retail_os_app;
GRANT USAGE ON SCHEMA public TO retail_os_app;

-- One fail-closed source of tenant context for every policy. Invalid or missing
-- values become NULL, which makes equality checks deny access without throwing.
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = pg_catalog
AS $current_tenant_function$
  SELECT CASE
    WHEN current_setting('app.current_tenant', true)
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN current_setting('app.current_tenant', true)::uuid
    ELSE NULL::uuid
  END
$current_tenant_function$;

REVOKE ALL ON FUNCTION public.current_tenant_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO retail_os_app;

-- The legacy UUID overload stores context for the whole database session. Do
-- not expose either helper to the restricted role; the application uses
-- transaction-local set_config(..., true) directly.
DO $legacy_tenant_helpers$
BEGIN
  IF to_regprocedure('public.set_tenant_context(uuid)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.set_tenant_context(uuid) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.set_tenant_context(uuid) FROM retail_os_app;
  END IF;

  IF to_regprocedure('public.set_tenant_context(text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.set_tenant_context(text) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.set_tenant_context(text) FROM retail_os_app;
  END IF;
END
$legacy_tenant_helpers$;

-- Non-destructive brute-force and credential-revocation fields.
ALTER TABLE IF EXISTS public.staff
  ADD COLUMN IF NOT EXISTS auth_version INTEGER NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS public.platform_admins
  ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lockout_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS auth_version INTEGER NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS public.tenants
  ADD COLUMN IF NOT EXISTS subscription_end_date TIMESTAMPTZ;

-- Retry workers claim queue entries before making external calls. The column
-- is nullable so existing queue records remain untouched and recoverable.
ALTER TABLE IF EXISTS public.zra_sync_queue
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

DO $platform_admin_lockout_check$
BEGIN
  IF to_regclass('public.platform_admins') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_constraint
       WHERE conrelid = to_regclass('public.platform_admins')
         AND conname = 'platform_admins_failed_login_attempts_nonnegative'
     ) THEN
    ALTER TABLE public.platform_admins
      ADD CONSTRAINT platform_admins_failed_login_attempts_nonnegative
      CHECK (failed_login_attempts >= 0) NOT VALID;
  END IF;
END
$platform_admin_lockout_check$;

DO $identity_auth_version_checks$
BEGIN
  IF to_regclass('public.staff') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conrelid = to_regclass('public.staff')
         AND conname = 'staff_auth_version_nonnegative'
     ) THEN
    ALTER TABLE public.staff
      ADD CONSTRAINT staff_auth_version_nonnegative CHECK (auth_version >= 0) NOT VALID;
  END IF;

  IF to_regclass('public.platform_admins') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conrelid = to_regclass('public.platform_admins')
         AND conname = 'platform_admins_auth_version_nonnegative'
     ) THEN
    ALTER TABLE public.platform_admins
      ADD CONSTRAINT platform_admins_auth_version_nonnegative CHECK (auth_version >= 0) NOT VALID;
  END IF;
END
$identity_auth_version_checks$;

DO $staff_location_assignment_check$
BEGIN
  IF to_regclass('public.staff') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conrelid = to_regclass('public.staff')
         AND conname = 'staff_operational_roles_require_location'
     ) THEN
    ALTER TABLE public.staff
      ADD CONSTRAINT staff_operational_roles_require_location
      CHECK (role = 'owner' OR location_id IS NOT NULL) NOT VALID;
  END IF;
END
$staff_location_assignment_check$;

-- The tenant registry is tenant-scoped by its primary key. Registration and
-- platform administration continue through the owner/admin connection, which
-- bypasses RLS until database ownership is separated in a later migration.
DO $tenant_registry_policy$
BEGIN
  IF to_regclass('public.tenants') IS NOT NULL THEN
    ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS tenant_isolation ON public.tenants;
    DROP POLICY IF EXISTS tenant_isolation_app ON public.tenants;
    DROP POLICY IF EXISTS tenant_isolation_guard ON public.tenants;

    CREATE POLICY tenant_isolation_app
      ON public.tenants
      AS PERMISSIVE
      FOR ALL
      TO retail_os_app
      USING (id = public.current_tenant_id())
      WITH CHECK (id = public.current_tenant_id());

    -- A restrictive guard prevents a later permissive policy from accidentally
    -- widening access for retail_os_app.
    CREATE POLICY tenant_isolation_guard
      ON public.tenants
      AS RESTRICTIVE
      FOR ALL
      TO retail_os_app
      USING (id = public.current_tenant_id())
      WITH CHECK (id = public.current_tenant_id());
  END IF;
END
$tenant_registry_policy$;

-- Apply consistent policies to every known table that owns a tenant_id. Text
-- tenant IDs are supported temporarily for zra_sync_queue; the audit identifies
-- invalid values before that column is converted to UUID in a later migration.
DO $direct_tenant_policies$
DECLARE
  tenant_table record;
  tenant_predicate text;
BEGIN
  FOR tenant_table IN
    SELECT
      namespace.nspname AS schema_name,
      relation.relname AS table_name,
      tenant_column.atttypid AS tenant_type
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    JOIN pg_attribute AS tenant_column
      ON tenant_column.attrelid = relation.oid
     AND tenant_column.attname = 'tenant_id'
     AND tenant_column.attnum > 0
     AND NOT tenant_column.attisdropped
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
      AND relation.relname = ANY (ARRAY[
        'locations',
        'staff',
        'variants',
        'garments',
        'import_profiles',
        'transactions',
        'onboarding_sessions',
        'onboarding_events',
        'tenant_settings',
        'stock_movements',
        'stocktake_sessions',
        'sync_queue',
        'sync_conflicts',
        'audit_trail',
        'cash_drawers',
        'shifts',
        'sales_returns',
        'shift_closing_reports',
        'billing_events',
        'platform_access_events',
        'support_tickets',
        'tenant_daily_rollups',
        'billing_history',
        'zra_sync_queue'
      ]::name[])
    ORDER BY relation.relname
  LOOP
    IF tenant_table.tenant_type = 'uuid'::regtype THEN
      tenant_predicate := 'tenant_id = public.current_tenant_id()';
    ELSIF tenant_table.tenant_type IN (
      'text'::regtype,
      'character varying'::regtype,
      'character'::regtype
    ) THEN
      tenant_predicate := 'tenant_id = public.current_tenant_id()::text';
    ELSE
      RAISE WARNING
        'Skipping RLS policy for %.%: unsupported tenant_id type %',
        tenant_table.schema_name,
        tenant_table.table_name,
        tenant_table.tenant_type::regtype;
      CONTINUE;
    END IF;

    EXECUTE format(
      'ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',
      tenant_table.schema_name,
      tenant_table.table_name
    );
    EXECUTE format(
      'DROP POLICY IF EXISTS tenant_isolation ON %I.%I',
      tenant_table.schema_name,
      tenant_table.table_name
    );
    EXECUTE format(
      'DROP POLICY IF EXISTS tenant_isolation_app ON %I.%I',
      tenant_table.schema_name,
      tenant_table.table_name
    );
    EXECUTE format(
      'DROP POLICY IF EXISTS tenant_isolation_guard ON %I.%I',
      tenant_table.schema_name,
      tenant_table.table_name
    );
    EXECUTE format(
      'CREATE POLICY tenant_isolation_app ON %I.%I AS PERMISSIVE FOR ALL TO retail_os_app USING (%s) WITH CHECK (%s)',
      tenant_table.schema_name,
      tenant_table.table_name,
      tenant_predicate,
      tenant_predicate
    );
    EXECUTE format(
      'CREATE POLICY tenant_isolation_guard ON %I.%I AS RESTRICTIVE FOR ALL TO retail_os_app USING (%s) WITH CHECK (%s)',
      tenant_table.schema_name,
      tenant_table.table_name,
      tenant_predicate,
      tenant_predicate
    );
  END LOOP;
END
$direct_tenant_policies$;

-- zra_sync_queue also has to bind a referenced transaction to the same tenant.
DO $zra_queue_policy$
BEGIN
  IF to_regclass('public.zra_sync_queue') IS NOT NULL
     AND to_regclass('public.transactions') IS NOT NULL THEN
    DROP POLICY IF EXISTS tenant_isolation_app ON public.zra_sync_queue;
    DROP POLICY IF EXISTS tenant_isolation_guard ON public.zra_sync_queue;

    CREATE POLICY tenant_isolation_app
      ON public.zra_sync_queue
      AS PERMISSIVE
      FOR ALL
      TO retail_os_app
      USING (
        tenant_id = public.current_tenant_id()::text
        AND (
          transaction_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM public.transactions AS scoped_transaction
            WHERE scoped_transaction.id = zra_sync_queue.transaction_id
              AND scoped_transaction.tenant_id = public.current_tenant_id()
          )
        )
      )
      WITH CHECK (
        tenant_id = public.current_tenant_id()::text
        AND (
          transaction_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM public.transactions AS scoped_transaction
            WHERE scoped_transaction.id = zra_sync_queue.transaction_id
              AND scoped_transaction.tenant_id = public.current_tenant_id()
          )
        )
      );

    CREATE POLICY tenant_isolation_guard
      ON public.zra_sync_queue
      AS RESTRICTIVE
      FOR ALL
      TO retail_os_app
      USING (
        tenant_id = public.current_tenant_id()::text
        AND (
          transaction_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM public.transactions AS scoped_transaction
            WHERE scoped_transaction.id = zra_sync_queue.transaction_id
              AND scoped_transaction.tenant_id = public.current_tenant_id()
          )
        )
      )
      WITH CHECK (
        tenant_id = public.current_tenant_id()::text
        AND (
          transaction_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM public.transactions AS scoped_transaction
            WHERE scoped_transaction.id = zra_sync_queue.transaction_id
              AND scoped_transaction.tenant_id = public.current_tenant_id()
          )
        )
      );
  END IF;
END
$zra_queue_policy$;

-- transaction_items inherits its tenant from transactions. Garment and variant
-- references, when present, must resolve inside the same current tenant.
DO $transaction_item_policy$
BEGIN
  IF to_regclass('public.transaction_items') IS NOT NULL THEN
    ALTER TABLE public.transaction_items ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation ON public.transaction_items;
    DROP POLICY IF EXISTS tenant_isolation_app ON public.transaction_items;
    DROP POLICY IF EXISTS tenant_isolation_guard ON public.transaction_items;

    IF to_regclass('public.transactions') IS NOT NULL
       AND to_regclass('public.garments') IS NOT NULL
       AND to_regclass('public.variants') IS NOT NULL THEN
      CREATE POLICY tenant_isolation_app
        ON public.transaction_items
        AS PERMISSIVE
        FOR ALL
        TO retail_os_app
        USING (
          EXISTS (
            SELECT 1
            FROM public.transactions AS scoped_transaction
            WHERE scoped_transaction.id = transaction_items.transaction_id
              AND scoped_transaction.tenant_id = public.current_tenant_id()
          )
          AND (
            garment_serial IS NULL
            OR EXISTS (
              SELECT 1
              FROM public.garments AS scoped_garment
              WHERE scoped_garment.serial = transaction_items.garment_serial
                AND scoped_garment.tenant_id = public.current_tenant_id()
            )
          )
          AND (
            variant_id IS NULL
            OR EXISTS (
              SELECT 1
              FROM public.variants AS scoped_variant
              WHERE scoped_variant.id = transaction_items.variant_id
                AND scoped_variant.tenant_id = public.current_tenant_id()
            )
          )
        )
        WITH CHECK (
          EXISTS (
            SELECT 1
            FROM public.transactions AS scoped_transaction
            WHERE scoped_transaction.id = transaction_items.transaction_id
              AND scoped_transaction.tenant_id = public.current_tenant_id()
          )
          AND (
            garment_serial IS NULL
            OR EXISTS (
              SELECT 1
              FROM public.garments AS scoped_garment
              WHERE scoped_garment.serial = transaction_items.garment_serial
                AND scoped_garment.tenant_id = public.current_tenant_id()
            )
          )
          AND (
            variant_id IS NULL
            OR EXISTS (
              SELECT 1
              FROM public.variants AS scoped_variant
              WHERE scoped_variant.id = transaction_items.variant_id
                AND scoped_variant.tenant_id = public.current_tenant_id()
            )
          )
        );

      CREATE POLICY tenant_isolation_guard
        ON public.transaction_items
        AS RESTRICTIVE
        FOR ALL
        TO retail_os_app
        USING (
          EXISTS (
            SELECT 1
            FROM public.transactions AS scoped_transaction
            WHERE scoped_transaction.id = transaction_items.transaction_id
              AND scoped_transaction.tenant_id = public.current_tenant_id()
          )
          AND (
            garment_serial IS NULL
            OR EXISTS (
              SELECT 1
              FROM public.garments AS scoped_garment
              WHERE scoped_garment.serial = transaction_items.garment_serial
                AND scoped_garment.tenant_id = public.current_tenant_id()
            )
          )
          AND (
            variant_id IS NULL
            OR EXISTS (
              SELECT 1
              FROM public.variants AS scoped_variant
              WHERE scoped_variant.id = transaction_items.variant_id
                AND scoped_variant.tenant_id = public.current_tenant_id()
            )
          )
        )
        WITH CHECK (
          EXISTS (
            SELECT 1
            FROM public.transactions AS scoped_transaction
            WHERE scoped_transaction.id = transaction_items.transaction_id
              AND scoped_transaction.tenant_id = public.current_tenant_id()
          )
          AND (
            garment_serial IS NULL
            OR EXISTS (
              SELECT 1
              FROM public.garments AS scoped_garment
              WHERE scoped_garment.serial = transaction_items.garment_serial
                AND scoped_garment.tenant_id = public.current_tenant_id()
            )
          )
          AND (
            variant_id IS NULL
            OR EXISTS (
              SELECT 1
              FROM public.variants AS scoped_variant
              WHERE scoped_variant.id = transaction_items.variant_id
                AND scoped_variant.tenant_id = public.current_tenant_id()
            )
          )
        );
    END IF;
  END IF;
END
$transaction_item_policy$;

-- Stocktake scans inherit tenancy from their session. Known/missing garments
-- must belong to that tenant; an "unexpected" scan may intentionally have no
-- garment row yet.
DO $stocktake_scan_policy$
BEGIN
  IF to_regclass('public.stocktake_scans') IS NOT NULL THEN
    ALTER TABLE public.stocktake_scans ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation ON public.stocktake_scans;
    DROP POLICY IF EXISTS tenant_isolation_app ON public.stocktake_scans;
    DROP POLICY IF EXISTS tenant_isolation_guard ON public.stocktake_scans;

    IF to_regclass('public.stocktake_sessions') IS NOT NULL
       AND to_regclass('public.garments') IS NOT NULL THEN
      CREATE POLICY tenant_isolation_app
        ON public.stocktake_scans
        AS PERMISSIVE
        FOR ALL
        TO retail_os_app
        USING (
          EXISTS (
            SELECT 1
            FROM public.stocktake_sessions AS scoped_session
            WHERE scoped_session.id = stocktake_scans.session_id
              AND scoped_session.tenant_id = public.current_tenant_id()
          )
          AND (
            category = 'unexpected'
            OR EXISTS (
              SELECT 1
              FROM public.garments AS scoped_garment
              WHERE scoped_garment.serial = stocktake_scans.garment_serial
                AND scoped_garment.tenant_id = public.current_tenant_id()
            )
          )
        )
        WITH CHECK (
          EXISTS (
            SELECT 1
            FROM public.stocktake_sessions AS scoped_session
            WHERE scoped_session.id = stocktake_scans.session_id
              AND scoped_session.tenant_id = public.current_tenant_id()
          )
          AND (
            category = 'unexpected'
            OR EXISTS (
              SELECT 1
              FROM public.garments AS scoped_garment
              WHERE scoped_garment.serial = stocktake_scans.garment_serial
                AND scoped_garment.tenant_id = public.current_tenant_id()
            )
          )
        );

      CREATE POLICY tenant_isolation_guard
        ON public.stocktake_scans
        AS RESTRICTIVE
        FOR ALL
        TO retail_os_app
        USING (
          EXISTS (
            SELECT 1
            FROM public.stocktake_sessions AS scoped_session
            WHERE scoped_session.id = stocktake_scans.session_id
              AND scoped_session.tenant_id = public.current_tenant_id()
          )
          AND (
            category = 'unexpected'
            OR EXISTS (
              SELECT 1
              FROM public.garments AS scoped_garment
              WHERE scoped_garment.serial = stocktake_scans.garment_serial
                AND scoped_garment.tenant_id = public.current_tenant_id()
            )
          )
        )
        WITH CHECK (
          EXISTS (
            SELECT 1
            FROM public.stocktake_sessions AS scoped_session
            WHERE scoped_session.id = stocktake_scans.session_id
              AND scoped_session.tenant_id = public.current_tenant_id()
          )
          AND (
            category = 'unexpected'
            OR EXISTS (
              SELECT 1
              FROM public.garments AS scoped_garment
              WHERE scoped_garment.serial = stocktake_scans.garment_serial
                AND scoped_garment.tenant_id = public.current_tenant_id()
            )
          )
        );
    END IF;
  END IF;
END
$stocktake_scan_policy$;

-- Return items inherit tenancy from sales_returns. They may only point to an
-- item from the returned transaction and to a garment in the current tenant.
DO $sales_return_item_policy$
BEGIN
  IF to_regclass('public.sales_return_items') IS NOT NULL THEN
    ALTER TABLE public.sales_return_items ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation ON public.sales_return_items;
    DROP POLICY IF EXISTS tenant_isolation_app ON public.sales_return_items;
    DROP POLICY IF EXISTS tenant_isolation_guard ON public.sales_return_items;

    IF to_regclass('public.sales_returns') IS NOT NULL
       AND to_regclass('public.transaction_items') IS NOT NULL
       AND to_regclass('public.transactions') IS NOT NULL
       AND to_regclass('public.garments') IS NOT NULL THEN
      CREATE POLICY tenant_isolation_app
        ON public.sales_return_items
        AS PERMISSIVE
        FOR ALL
        TO retail_os_app
        USING (
          EXISTS (
            SELECT 1
            FROM public.sales_returns AS scoped_return
            JOIN public.transaction_items AS scoped_item
              ON scoped_item.id = sales_return_items.transaction_item_id
            JOIN public.transactions AS scoped_transaction
              ON scoped_transaction.id = scoped_item.transaction_id
            WHERE scoped_return.id = sales_return_items.return_id
              AND scoped_return.tenant_id = public.current_tenant_id()
              AND scoped_transaction.id = scoped_return.transaction_id
              AND scoped_transaction.tenant_id = public.current_tenant_id()
          )
          AND (
            garment_serial IS NULL
            OR EXISTS (
              SELECT 1
              FROM public.garments AS scoped_garment
              WHERE scoped_garment.serial = sales_return_items.garment_serial
                AND scoped_garment.tenant_id = public.current_tenant_id()
            )
          )
        )
        WITH CHECK (
          EXISTS (
            SELECT 1
            FROM public.sales_returns AS scoped_return
            JOIN public.transaction_items AS scoped_item
              ON scoped_item.id = sales_return_items.transaction_item_id
            JOIN public.transactions AS scoped_transaction
              ON scoped_transaction.id = scoped_item.transaction_id
            WHERE scoped_return.id = sales_return_items.return_id
              AND scoped_return.tenant_id = public.current_tenant_id()
              AND scoped_transaction.id = scoped_return.transaction_id
              AND scoped_transaction.tenant_id = public.current_tenant_id()
          )
          AND (
            garment_serial IS NULL
            OR EXISTS (
              SELECT 1
              FROM public.garments AS scoped_garment
              WHERE scoped_garment.serial = sales_return_items.garment_serial
                AND scoped_garment.tenant_id = public.current_tenant_id()
            )
          )
        );

      CREATE POLICY tenant_isolation_guard
        ON public.sales_return_items
        AS RESTRICTIVE
        FOR ALL
        TO retail_os_app
        USING (
          EXISTS (
            SELECT 1
            FROM public.sales_returns AS scoped_return
            JOIN public.transaction_items AS scoped_item
              ON scoped_item.id = sales_return_items.transaction_item_id
            JOIN public.transactions AS scoped_transaction
              ON scoped_transaction.id = scoped_item.transaction_id
            WHERE scoped_return.id = sales_return_items.return_id
              AND scoped_return.tenant_id = public.current_tenant_id()
              AND scoped_transaction.id = scoped_return.transaction_id
              AND scoped_transaction.tenant_id = public.current_tenant_id()
          )
          AND (
            garment_serial IS NULL
            OR EXISTS (
              SELECT 1
              FROM public.garments AS scoped_garment
              WHERE scoped_garment.serial = sales_return_items.garment_serial
                AND scoped_garment.tenant_id = public.current_tenant_id()
            )
          )
        )
        WITH CHECK (
          EXISTS (
            SELECT 1
            FROM public.sales_returns AS scoped_return
            JOIN public.transaction_items AS scoped_item
              ON scoped_item.id = sales_return_items.transaction_item_id
            JOIN public.transactions AS scoped_transaction
              ON scoped_transaction.id = scoped_item.transaction_id
            WHERE scoped_return.id = sales_return_items.return_id
              AND scoped_return.tenant_id = public.current_tenant_id()
              AND scoped_transaction.id = scoped_return.transaction_id
              AND scoped_transaction.tenant_id = public.current_tenant_id()
          )
          AND (
            garment_serial IS NULL
            OR EXISTS (
              SELECT 1
              FROM public.garments AS scoped_garment
              WHERE scoped_garment.serial = sales_return_items.garment_serial
                AND scoped_garment.tenant_id = public.current_tenant_id()
            )
          )
        );
    END IF;
  END IF;
END
$sales_return_item_policy$;

-- Remove broad privileges from every table managed by this migration, then
-- grant only the operations currently required by tenant application paths.
DO $tenant_table_privileges$
DECLARE
  table_name text;
  data_api_role text;
  column_grant record;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'tenants',
    'locations',
    'staff',
    'variants',
    'garments',
    'import_profiles',
    'transactions',
    'transaction_items',
    'onboarding_sessions',
    'onboarding_events',
    'tenant_settings',
    'stock_movements',
    'stocktake_sessions',
    'stocktake_scans',
    'sync_queue',
    'sync_conflicts',
    'audit_trail',
    'cash_drawers',
    'shifts',
    'sales_returns',
    'sales_return_items',
    'shift_closing_reports',
    'billing_events',
    'platform_access_events',
    'support_tickets',
    'tenant_daily_rollups',
    'billing_history',
    'zra_sync_queue',
    'subscription_plans',
    'platform_admins',
    'platform_health_snapshots'
  ]
  LOOP
    IF to_regclass(format('%I.%I', 'public', table_name)) IS NOT NULL THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM retail_os_app',
        table_name
      );
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC',
        table_name
      );
      -- Supabase exposes the public schema through its Data API roles. Remove
      -- any inherited/default grants so browser tokens cannot bypass the
      -- application session and tenant-context boundary.
      FOREACH data_api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
      LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = data_api_role) THEN
          EXECUTE format(
            'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I',
            table_name,
            data_api_role
          );
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  -- Table-level REVOKE does not remove grants made directly on columns.
  -- Clear those paths before applying the explicit table grants below.
  FOR column_grant IN
    SELECT
      privilege.grantee,
      privilege.table_name,
      string_agg(format('%I', privilege.column_name), ', ' ORDER BY privilege.column_name) AS column_names
    FROM information_schema.column_privileges AS privilege
    WHERE privilege.table_schema = 'public'
      AND privilege.grantee IN ('PUBLIC', 'retail_os_app', 'anon', 'authenticated', 'service_role')
    GROUP BY privilege.grantee, privilege.table_name
  LOOP
    EXECUTE format(
      'REVOKE ALL PRIVILEGES (%s) ON TABLE public.%I FROM %s',
      column_grant.column_names,
      column_grant.table_name,
      CASE
        WHEN column_grant.grantee = 'PUBLIC' THEN 'PUBLIC'
        ELSE format('%I', column_grant.grantee)
      END
    );
  END LOOP;

  FOREACH table_name IN ARRAY ARRAY[
    'locations',
    'staff',
    'variants',
    'garments',
    'import_profiles',
    'transactions',
    'transaction_items',
    'onboarding_sessions',
    'tenant_settings',
    'stock_movements',
    'stocktake_sessions',
    'stocktake_scans',
    'sync_queue',
    'sync_conflicts',
    'cash_drawers',
    'shifts',
    'sales_returns',
    'sales_return_items',
    'shift_closing_reports',
    'support_tickets',
    'zra_sync_queue'
  ]
  LOOP
    IF to_regclass(format('%I.%I', 'public', table_name)) IS NOT NULL THEN
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO retail_os_app',
        table_name
      );
    END IF;
  END LOOP;

  FOREACH table_name IN ARRAY ARRAY[
    'onboarding_events',
    'audit_trail',
    'platform_access_events'
  ]
  LOOP
    IF to_regclass(format('%I.%I', 'public', table_name)) IS NOT NULL THEN
      EXECUTE format(
        'GRANT SELECT, INSERT ON TABLE public.%I TO retail_os_app',
        table_name
      );
    END IF;
  END LOOP;

  FOREACH table_name IN ARRAY ARRAY[
    'billing_history'
  ]
  LOOP
    IF to_regclass(format('%I.%I', 'public', table_name)) IS NOT NULL THEN
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE ON TABLE public.%I TO retail_os_app',
        table_name
      );
    END IF;
  END LOOP;

  FOREACH table_name IN ARRAY ARRAY[
    'tenants',
    'billing_events',
    'tenant_daily_rollups',
    'subscription_plans'
  ]
  LOOP
    IF to_regclass(format('%I.%I', 'public', table_name)) IS NOT NULL THEN
      EXECUTE format(
        'GRANT SELECT ON TABLE public.%I TO retail_os_app',
        table_name
      );
    END IF;
  END LOOP;
END
$tenant_table_privileges$;

-- Redundant unique indexes make (tenant_id, object_id) valid composite FK
-- targets. The object IDs are already globally unique, so these indexes do not
-- impose a new data assumption.
DO $tenant_parent_indexes$
DECLARE
  parent_index record;
BEGIN
  FOR parent_index IN
    SELECT *
    FROM (VALUES
      ('locations', 'id', 'ux_isolation_locations_tenant_id'),
      ('staff', 'id', 'ux_isolation_staff_tenant_id'),
      ('variants', 'id', 'ux_isolation_variants_tenant_id'),
      ('garments', 'serial', 'ux_isolation_garments_tenant_serial'),
      ('transactions', 'id', 'ux_isolation_transactions_tenant_id'),
      ('stocktake_sessions', 'id', 'ux_isolation_stocktake_sessions_tenant_id'),
      ('shifts', 'id', 'ux_isolation_shifts_tenant_id'),
      ('sales_returns', 'id', 'ux_isolation_sales_returns_tenant_id')
    ) AS configured_parent(table_name, key_column, index_name)
  LOOP
    IF to_regclass(format('%I.%I', 'public', parent_index.table_name)) IS NOT NULL
       AND EXISTS (
         SELECT 1
         FROM pg_attribute
         WHERE attrelid = to_regclass(format('%I.%I', 'public', parent_index.table_name))
           AND attname = 'tenant_id'
           AND attnum > 0
           AND NOT attisdropped
       )
       AND EXISTS (
         SELECT 1
         FROM pg_attribute
         WHERE attrelid = to_regclass(format('%I.%I', 'public', parent_index.table_name))
           AND attname = parent_index.key_column
           AND attnum > 0
           AND NOT attisdropped
       ) THEN
      EXECUTE format(
        'CREATE UNIQUE INDEX IF NOT EXISTS %I ON public.%I (tenant_id, %I)',
        parent_index.index_name,
        parent_index.table_name,
        parent_index.key_column
      );
    END IF;
  END LOOP;
END
$tenant_parent_indexes$;

-- Composite NOT VALID foreign keys reject new links to another tenant without
-- scanning, moving, or deleting existing rows.
DO $same_tenant_foreign_keys$
DECLARE
  configured_fk record;
BEGIN
  FOR configured_fk IN
    SELECT *
    FROM (VALUES
      ('fk_staff_location_same_tenant', 'staff', 'location_id', 'locations', 'id'),
      ('fk_garments_variant_same_tenant', 'garments', 'variant_id', 'variants', 'id'),
      ('fk_garments_location_same_tenant', 'garments', 'location_id', 'locations', 'id'),
      ('fk_transactions_location_same_tenant', 'transactions', 'location_id', 'locations', 'id'),
      ('fk_transactions_cashier_same_tenant', 'transactions', 'cashier_id', 'staff', 'id'),
      ('fk_stock_movements_garment_same_tenant', 'stock_movements', 'garment_serial', 'garments', 'serial'),
      ('fk_stock_movements_from_location_same_tenant', 'stock_movements', 'from_location_id', 'locations', 'id'),
      ('fk_stock_movements_to_location_same_tenant', 'stock_movements', 'to_location_id', 'locations', 'id'),
      ('fk_stock_movements_actor_same_tenant', 'stock_movements', 'actor_id', 'staff', 'id'),
      ('fk_stock_movements_transaction_same_tenant', 'stock_movements', 'transaction_id', 'transactions', 'id'),
      ('fk_stocktake_sessions_location_same_tenant', 'stocktake_sessions', 'location_id', 'locations', 'id'),
      ('fk_stocktake_sessions_clerk_same_tenant', 'stocktake_sessions', 'clerk_id', 'staff', 'id'),
      ('fk_sync_conflicts_resolver_same_tenant', 'sync_conflicts', 'resolved_by', 'staff', 'id'),
      ('fk_audit_trail_actor_same_tenant', 'audit_trail', 'actor_id', 'staff', 'id'),
      ('fk_cash_drawers_location_same_tenant', 'cash_drawers', 'location_id', 'locations', 'id'),
      ('fk_cash_drawers_cashier_same_tenant', 'cash_drawers', 'cashier_id', 'staff', 'id'),
      ('fk_shifts_staff_same_tenant', 'shifts', 'staff_id', 'staff', 'id'),
      ('fk_shifts_location_same_tenant', 'shifts', 'location_id', 'locations', 'id'),
      ('fk_sales_returns_shift_same_tenant', 'sales_returns', 'shift_id', 'shifts', 'id'),
      ('fk_sales_returns_transaction_same_tenant', 'sales_returns', 'transaction_id', 'transactions', 'id'),
      ('fk_sales_returns_cashier_same_tenant', 'sales_returns', 'cashier_id', 'staff', 'id'),
      ('fk_sales_returns_location_same_tenant', 'sales_returns', 'location_id', 'locations', 'id'),
      ('fk_shift_reports_shift_same_tenant', 'shift_closing_reports', 'shift_id', 'shifts', 'id'),
      ('fk_shift_reports_cashier_same_tenant', 'shift_closing_reports', 'cashier_id', 'staff', 'id'),
      ('fk_shift_reports_location_same_tenant', 'shift_closing_reports', 'location_id', 'locations', 'id'),
      ('fk_platform_access_staff_same_tenant', 'platform_access_events', 'staff_id', 'staff', 'id')
    ) AS fk_definition(
      constraint_name,
      child_table,
      child_key,
      parent_table,
      parent_key
    )
  LOOP
    IF to_regclass(format('%I.%I', 'public', configured_fk.child_table)) IS NOT NULL
       AND to_regclass(format('%I.%I', 'public', configured_fk.parent_table)) IS NOT NULL
       AND EXISTS (
         SELECT 1
         FROM pg_attribute
         WHERE attrelid = to_regclass(format('%I.%I', 'public', configured_fk.child_table))
           AND attname = 'tenant_id'
           AND attnum > 0
           AND NOT attisdropped
       )
       AND EXISTS (
         SELECT 1
         FROM pg_attribute
         WHERE attrelid = to_regclass(format('%I.%I', 'public', configured_fk.child_table))
           AND attname = configured_fk.child_key
           AND attnum > 0
           AND NOT attisdropped
       )
       AND EXISTS (
         SELECT 1
         FROM pg_attribute
         WHERE attrelid = to_regclass(format('%I.%I', 'public', configured_fk.parent_table))
           AND attname = 'tenant_id'
           AND attnum > 0
           AND NOT attisdropped
       )
       AND EXISTS (
         SELECT 1
         FROM pg_attribute
         WHERE attrelid = to_regclass(format('%I.%I', 'public', configured_fk.parent_table))
           AND attname = configured_fk.parent_key
           AND attnum > 0
           AND NOT attisdropped
       )
       AND EXISTS (
         SELECT 1
         FROM pg_attribute AS child_tenant_column
         JOIN pg_attribute AS parent_tenant_column
           ON parent_tenant_column.attrelid = to_regclass(
                format('%I.%I', 'public', configured_fk.parent_table)
              )
          AND parent_tenant_column.attname = 'tenant_id'
          AND parent_tenant_column.attnum > 0
          AND NOT parent_tenant_column.attisdropped
          AND parent_tenant_column.atttypid = child_tenant_column.atttypid
         JOIN pg_attribute AS child_key_column
           ON child_key_column.attrelid = child_tenant_column.attrelid
          AND child_key_column.attname = configured_fk.child_key
          AND child_key_column.attnum > 0
          AND NOT child_key_column.attisdropped
         JOIN pg_attribute AS parent_key_column
           ON parent_key_column.attrelid = parent_tenant_column.attrelid
          AND parent_key_column.attname = configured_fk.parent_key
          AND parent_key_column.attnum > 0
          AND NOT parent_key_column.attisdropped
          AND parent_key_column.atttypid = child_key_column.atttypid
         WHERE child_tenant_column.attrelid = to_regclass(
                 format('%I.%I', 'public', configured_fk.child_table)
               )
           AND child_tenant_column.attname = 'tenant_id'
           AND child_tenant_column.attnum > 0
           AND NOT child_tenant_column.attisdropped
       )
       AND NOT EXISTS (
         SELECT 1
         FROM pg_constraint
         WHERE conrelid = to_regclass(format('%I.%I', 'public', configured_fk.child_table))
           AND conname = configured_fk.constraint_name
       ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (tenant_id, %I) REFERENCES public.%I (tenant_id, %I) NOT VALID',
        configured_fk.child_table,
        configured_fk.constraint_name,
        configured_fk.child_key,
        configured_fk.parent_table,
        configured_fk.parent_key
      );
    END IF;
  END LOOP;
END
$same_tenant_foreign_keys$;

-- billing_history originally had no tenant FK. NOT VALID preserves any orphan
-- rows for investigation while blocking new orphan records.
DO $billing_history_tenant_fk$
BEGIN
  IF to_regclass('public.billing_history') IS NOT NULL
     AND to_regclass('public.tenants') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM pg_attribute
       WHERE attrelid = to_regclass('public.billing_history')
         AND attname = 'tenant_id'
         AND atttypid = 'uuid'::regtype
         AND attnum > 0
         AND NOT attisdropped
     )
     AND NOT EXISTS (
       SELECT 1
       FROM pg_constraint
       WHERE conrelid = to_regclass('public.billing_history')
         AND conname = 'fk_billing_history_tenant'
     ) THEN
    ALTER TABLE public.billing_history
      ADD CONSTRAINT fk_billing_history_tenant
      FOREIGN KEY (tenant_id)
      REFERENCES public.tenants(id)
      ON DELETE CASCADE
      NOT VALID;
  END IF;
END
$billing_history_tenant_fk$;

-- zra_sync_queue still stores tenant IDs as text. This NOT VALID check blocks
-- new malformed identifiers without rewriting historic rows.
DO $zra_queue_tenant_format$
BEGIN
  IF to_regclass('public.zra_sync_queue') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_constraint
       WHERE conrelid = to_regclass('public.zra_sync_queue')
         AND conname = 'zra_sync_queue_tenant_uuid_format'
     ) THEN
    ALTER TABLE public.zra_sync_queue
      ADD CONSTRAINT zra_sync_queue_tenant_uuid_format
      CHECK (
        tenant_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      ) NOT VALID;
  END IF;
END
$zra_queue_tenant_format$;

COMMIT;
