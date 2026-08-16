-- Initialize PostgreSQL for Retail OS
-- Enable Row-Level Security and create helper functions

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Local-development RLS role. Production must provision its own password and
-- APP_DATABASE_URL outside source control.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'retail_os_app') THEN
    CREATE ROLE retail_os_app LOGIN PASSWORD 'retail_os_app_password'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT NOBYPASSRLS;
  END IF;
END $$;

-- Re-assert every restricted attribute even when a persistent Docker volume
-- already contains the role from an older initialization.
ALTER ROLE retail_os_app LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;
ALTER ROLE retail_os_app SET row_security = on;

-- Create helper function for tenant context
CREATE OR REPLACE FUNCTION set_tenant_context(tenant_uuid UUID)
RETURNS VOID AS $$
BEGIN
  PERFORM set_config('app.current_tenant', tenant_uuid::text, true);
END;
$$ LANGUAGE plpgsql;

-- Create helper function for timestamp updates
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE retail_os_dev TO retail_os;

-- Log initialization
DO $$
BEGIN
  RAISE NOTICE 'Retail OS database initialized successfully';
END $$;
