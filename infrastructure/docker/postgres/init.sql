-- Initialize PostgreSQL for Retail OS
-- Enable Row-Level Security and create helper functions

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create helper function for tenant context
CREATE OR REPLACE FUNCTION set_tenant_context(tenant_uuid UUID)
RETURNS VOID AS $$
BEGIN
  PERFORM set_config('app.current_tenant', tenant_uuid::text, false);
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
