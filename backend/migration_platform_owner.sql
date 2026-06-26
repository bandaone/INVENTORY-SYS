-- Platform-owner SaaS control plane schema additions.
-- Adds lifecycle, billing, support, health, and rollup tables needed
-- for the SaaS operator dashboard.

ALTER TABLE IF EXISTS tenants
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE IF EXISTS tenants
  ADD COLUMN IF NOT EXISTS zra_configured BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS zra_cert_expiry TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);
CREATE INDEX IF NOT EXISTS idx_tenants_status_tier ON tenants(status, subscription_tier);

CREATE TABLE IF NOT EXISTS platform_admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  pin_hash VARCHAR(255) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_platform_admins_email ON platform_admins(email);

ALTER TABLE IF EXISTS onboarding_sessions
  ADD COLUMN IF NOT EXISTS business_profile_completed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS location_created BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS staff_created BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS products_loaded BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS first_stock_received BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS hardware_paired BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS first_sale_completed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS converted_to_paid BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS go_live_approved BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS go_live_approved_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS conversion_date TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS onboarding_sessions (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  current_step INTEGER DEFAULT 1,
  steps_completed TEXT[] DEFAULT '{}'::text[],
  trial_start_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  trial_end_date TIMESTAMP WITH TIME ZONE,
  grace_period_end_date TIMESTAMP WITH TIME ZONE,
  onboarding_type VARCHAR(50) DEFAULT 'SELF_SERVICE',
  assigned_agent_id UUID,
  business_profile_completed BOOLEAN NOT NULL DEFAULT FALSE,
  location_created BOOLEAN NOT NULL DEFAULT FALSE,
  staff_created BOOLEAN NOT NULL DEFAULT FALSE,
  products_loaded BOOLEAN NOT NULL DEFAULT FALSE,
  first_stock_received BOOLEAN NOT NULL DEFAULT FALSE,
  hardware_paired BOOLEAN NOT NULL DEFAULT FALSE,
  first_sale_completed BOOLEAN NOT NULL DEFAULT FALSE,
  converted_to_paid BOOLEAN NOT NULL DEFAULT FALSE,
  go_live_approved BOOLEAN NOT NULL DEFAULT FALSE,
  go_live_approved_at TIMESTAMP WITH TIME ZONE,
  conversion_date TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE onboarding_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON onboarding_sessions;
CREATE POLICY tenant_isolation ON onboarding_sessions
  USING (tenant_id = current_setting('app.current_tenant'::text, true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON onboarding_sessions TO retail_os_app;

CREATE TABLE IF NOT EXISTS onboarding_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  event_type VARCHAR(100) NOT NULL,
  step_number INTEGER,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE onboarding_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON onboarding_events;
CREATE POLICY tenant_isolation ON onboarding_events
  USING (tenant_id = current_setting('app.current_tenant'::text, true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON onboarding_events TO retail_os_app;
CREATE INDEX IF NOT EXISTS idx_onboarding_events_tenant_created ON onboarding_events(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS billing_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL
    CHECK (event_type IN ('TRIAL_STARTED', 'TRIAL_CONVERTED', 'UPGRADED', 'DOWNGRADED', 'CANCELLED', 'REACTIVATED', 'PAYMENT_FAILED', 'PAYMENT_RECEIVED')),
  old_tier VARCHAR(50),
  new_tier VARCHAR(50),
  amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  currency VARCHAR(10) NOT NULL DEFAULT 'ZMW',
  status VARCHAR(20) NOT NULL DEFAULT 'POSTED'
    CHECK (status IN ('PENDING', 'POSTED', 'OVERDUE', 'FAILED', 'VOID')),
  due_at TIMESTAMP WITH TIME ZONE,
  effective_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON billing_events;
CREATE POLICY tenant_isolation ON billing_events
  USING (tenant_id = current_setting('app.current_tenant'::text, true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON billing_events TO retail_os_app;
CREATE INDEX IF NOT EXISTS idx_billing_events_tenant ON billing_events(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_events_status ON billing_events(status);
CREATE INDEX IF NOT EXISTS idx_billing_events_due_status ON billing_events(status, due_at);

CREATE TABLE IF NOT EXISTS platform_access_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  staff_id UUID REFERENCES staff(id),
  event_type VARCHAR(20) NOT NULL
    CHECK (event_type IN ('LOGIN', 'LOGOUT', 'FAILED_LOGIN')),
  source VARCHAR(20) NOT NULL DEFAULT 'DASHBOARD'
    CHECK (source IN ('DASHBOARD', 'POS', 'OPERATIONS', 'PUBLIC_PORTAL')),
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE platform_access_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON platform_access_events;
CREATE POLICY tenant_isolation ON platform_access_events
  USING (tenant_id = current_setting('app.current_tenant'::text, true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_access_events TO retail_os_app;
CREATE INDEX IF NOT EXISTS idx_platform_access_events_tenant_created ON platform_access_events(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_access_events_type_created ON platform_access_events(event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  category VARCHAR(50) NOT NULL
    CHECK (category IN ('ONBOARDING', 'BILLING', 'SYNC', 'COMPLIANCE', 'ACCESS', 'BUG', 'OTHER')),
  priority VARCHAR(20) NOT NULL DEFAULT 'MEDIUM'
    CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'IN_PROGRESS', 'WAITING_ON_CLIENT', 'RESOLVED', 'CLOSED')),
  description TEXT,
  reporter_name VARCHAR(255),
  assignee_name VARCHAR(255),
  due_at TIMESTAMP WITH TIME ZONE,
  resolved_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON support_tickets;
CREATE POLICY tenant_isolation ON support_tickets
  USING (tenant_id = current_setting('app.current_tenant'::text, true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON support_tickets TO retail_os_app;
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_priority ON support_tickets(priority);
CREATE INDEX IF NOT EXISTS idx_support_tickets_tenant_status ON support_tickets(tenant_id, status);

CREATE TABLE IF NOT EXISTS platform_health_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  captured_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  api_uptime_pct DECIMAL(5,2) NOT NULL DEFAULT 99.99,
  error_rate_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
  sync_backlog INTEGER NOT NULL DEFAULT 0,
  failed_jobs INTEGER NOT NULL DEFAULT 0,
  webhook_failures INTEGER NOT NULL DEFAULT 0,
  database_health VARCHAR(20) NOT NULL DEFAULT 'HEALTHY',
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_platform_health_snapshots_captured_at ON platform_health_snapshots(captured_at DESC);

CREATE TABLE IF NOT EXISTS tenant_daily_rollups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rollup_date DATE NOT NULL,
  active_users INTEGER NOT NULL DEFAULT 0,
  logins INTEGER NOT NULL DEFAULT 0,
  sales_count INTEGER NOT NULL DEFAULT 0,
  sales_value DECIMAL(12,2) NOT NULL DEFAULT 0,
  receiving_count INTEGER NOT NULL DEFAULT 0,
  stocktake_count INTEGER NOT NULL DEFAULT 0,
  returns_count INTEGER NOT NULL DEFAULT 0,
  conflicts_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_tenant_rollup_date UNIQUE (tenant_id, rollup_date)
);
ALTER TABLE tenant_daily_rollups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenant_daily_rollups;
CREATE POLICY tenant_isolation ON tenant_daily_rollups
  USING (tenant_id = current_setting('app.current_tenant'::text, true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_daily_rollups TO retail_os_app;
CREATE INDEX IF NOT EXISTS idx_tenant_daily_rollups_date ON tenant_daily_rollups(rollup_date DESC);
CREATE INDEX IF NOT EXISTS idx_tenant_daily_rollups_tenant_date ON tenant_daily_rollups(tenant_id, rollup_date DESC);
