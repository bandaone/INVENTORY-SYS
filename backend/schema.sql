CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  subscription_tier VARCHAR(50) NOT NULL
    CHECK (subscription_tier IN ('boutique_starter', 'growth', 'enterprise_fleet')),
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  zra_configured BOOLEAN DEFAULT FALSE,
  zra_cert_expiry TIMESTAMP WITH TIME ZONE,
  active_locations_count INTEGER DEFAULT 0
    CHECK (active_locations_count >= 0),
  active_devices_count INTEGER DEFAULT 0
    CHECK (active_devices_count >= 0),
  max_locations INTEGER NOT NULL,
  features JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tenants_tier ON tenants(subscription_tier);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);
CREATE INDEX IF NOT EXISTS idx_tenants_status_tier ON tenants(status, subscription_tier);

CREATE TABLE IF NOT EXISTS locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  address TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT unique_tenant_location_name UNIQUE (tenant_id, name)
);
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON locations;
CREATE POLICY tenant_isolation ON locations
  USING (tenant_id = current_setting('app.current_tenant')::UUID);
CREATE INDEX IF NOT EXISTS idx_locations_tenant ON locations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_locations_active ON locations(tenant_id, is_active);

CREATE TABLE IF NOT EXISTS staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email VARCHAR(255),
  name VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL
    CHECK (role IN ('owner', 'store_manager', 'cashier', 'stock_clerk')),
  location_id UUID REFERENCES locations(id),
  pin_hash VARCHAR(255),
  is_active BOOLEAN DEFAULT TRUE,
  failed_login_attempts INTEGER DEFAULT 0,
  lockout_until TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT email_or_pin CHECK (email IS NOT NULL OR pin_hash IS NOT NULL),
  CONSTRAINT unique_tenant_email UNIQUE (tenant_id, email)
);
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON staff;
CREATE POLICY tenant_isolation ON staff
  USING (tenant_id = current_setting('app.current_tenant')::UUID);
CREATE INDEX IF NOT EXISTS idx_staff_tenant ON staff(tenant_id);

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

CREATE TABLE IF NOT EXISTS variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(100),
  subtype VARCHAR(100),
  color VARCHAR(50),
  size VARCHAR(20),
  cost_price DECIMAL(10,2) NOT NULL CHECK (cost_price >= 0),
  retail_price DECIMAL(10,2) NOT NULL CHECK (retail_price >= 0),
  discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0 CHECK (discount_percent >= 0 AND discount_percent <= 100),
  reorder_threshold INTEGER DEFAULT 10 CHECK (reorder_threshold >= 0),
  barcode_token VARCHAR(255),
  barcode_payload JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  missing_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  detail_status VARCHAR(20) NOT NULL DEFAULT 'complete'
    CHECK (detail_status IN ('complete', 'needs_review')),
  search_text TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT unique_variant UNIQUE (tenant_id, name, color, size)
);
ALTER TABLE variants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON variants;
CREATE POLICY tenant_isolation ON variants
  USING (tenant_id = current_setting('app.current_tenant')::UUID);
CREATE INDEX IF NOT EXISTS idx_variants_tenant ON variants(tenant_id);

CREATE TABLE IF NOT EXISTS garments (
  serial VARCHAR(255) PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES variants(id),
  location_id UUID NOT NULL REFERENCES locations(id),
  status VARCHAR(50) NOT NULL
    CHECK (status IN ('in_stock', 'sold', 'missing', 'transferred')),
  cost_price DECIMAL(10,2) NOT NULL,
  retail_price DECIMAL(10,2) NOT NULL,
  barcode_token VARCHAR(255),
  barcode_payload JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  missing_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  detail_status VARCHAR(20) NOT NULL DEFAULT 'complete'
    CHECK (detail_status IN ('complete', 'needs_review')),
  search_text TEXT,
  source_code VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
ALTER TABLE garments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON garments;
CREATE POLICY tenant_isolation ON garments
  USING (tenant_id = current_setting('app.current_tenant')::UUID);
CREATE INDEX IF NOT EXISTS idx_garments_serial ON garments(serial)
  INCLUDE (variant_id, status, retail_price, location_id);

CREATE TABLE IF NOT EXISTS import_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_signature VARCHAR(255) NOT NULL,
  profile_name VARCHAR(255),
  mapping JSONB NOT NULL,
  sample_headers JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT unique_import_profile UNIQUE (tenant_id, source_signature)
);
ALTER TABLE import_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON import_profiles;
CREATE POLICY tenant_isolation ON import_profiles
  USING (tenant_id = current_setting('app.current_tenant')::UUID);
CREATE INDEX IF NOT EXISTS idx_import_profiles_tenant_signature ON import_profiles(tenant_id, source_signature);

CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  receipt_number VARCHAR(100) NOT NULL,
  location_id UUID NOT NULL REFERENCES locations(id),
  cashier_id UUID NOT NULL REFERENCES staff(id),
  payment_method VARCHAR(50) NOT NULL
    CHECK (payment_method IN ('CASH', 'MOBILE_MONEY', 'SPLIT')),
  subtotal DECIMAL(10,2) NOT NULL,
  tax DECIMAL(10,2) NOT NULL,
  total DECIMAL(10,2) NOT NULL,
  cash_tendered DECIMAL(10,2),
  change_amount DECIMAL(10,2),
  mobile_money_transaction_id VARCHAR(255),
  zra_invoice_code VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT unique_receipt_number UNIQUE (tenant_id, receipt_number)
);
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON transactions;
CREATE POLICY tenant_isolation ON transactions
  USING (tenant_id = current_setting('app.current_tenant')::UUID);

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
  USING (tenant_id = current_setting('app.current_tenant')::UUID);

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
  USING (tenant_id = current_setting('app.current_tenant')::UUID);
CREATE INDEX IF NOT EXISTS idx_onboarding_events_tenant_created ON onboarding_events(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tenant_settings (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  business_name VARCHAR(255),
  owner_email VARCHAR(255),
  owner_phone VARCHAR(255),
  currency VARCHAR(10) NOT NULL DEFAULT 'ZMW',
  tax_rate DECIMAL(5,2) NOT NULL DEFAULT 16,
  receipt_footer TEXT,
  receipt_logo_data_url TEXT,
  mtn_momo_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  mtn_momo_number VARCHAR(100),
  airtel_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  airtel_number VARCHAR(100),
  zra_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  zra_tpin VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
ALTER TABLE tenant_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenant_settings;
CREATE POLICY tenant_isolation ON tenant_settings
  USING (tenant_id = current_setting('app.current_tenant')::UUID);

CREATE TABLE IF NOT EXISTS transaction_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  garment_serial VARCHAR(255) REFERENCES garments(serial),
  variant_id UUID REFERENCES variants(id),
  description TEXT,
  quantity INTEGER DEFAULT 1,
  unit_price DECIMAL(10,2) NOT NULL,
  discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0 CHECK (discount_percent >= 0 AND discount_percent <= 100),
  discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  total_price DECIMAL(10,2) NOT NULL,
  CONSTRAINT serial_or_manual CHECK (
    (garment_serial IS NOT NULL AND variant_id IS NOT NULL) OR
    (garment_serial IS NULL AND description IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  garment_serial VARCHAR(255) NOT NULL REFERENCES garments(serial),
  movement_type VARCHAR(50) NOT NULL
    CHECK (movement_type IN ('INGESTION', 'SALE', 'TRANSFER', 'STOCKTAKE', 'ADJUSTMENT')),
  from_location_id UUID REFERENCES locations(id),
  to_location_id UUID REFERENCES locations(id),
  from_status VARCHAR(50),
  to_status VARCHAR(50),
  actor_id UUID NOT NULL REFERENCES staff(id),
  device_id VARCHAR(100),
  sequence_number BIGINT,
  transaction_id UUID REFERENCES transactions(id),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT movement_locations CHECK (
    (movement_type = 'TRANSFER' AND from_location_id IS NOT NULL AND to_location_id IS NOT NULL) OR
    (movement_type != 'TRANSFER')
  )
);
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON stock_movements;
CREATE POLICY tenant_isolation ON stock_movements
  USING (tenant_id = current_setting('app.current_tenant')::UUID);

CREATE TABLE IF NOT EXISTS stocktake_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES locations(id),
  clerk_id UUID NOT NULL REFERENCES staff(id),
  area VARCHAR(255),
  status VARCHAR(50) NOT NULL
    CHECK (status IN ('active', 'completed', 'cancelled')),
  expected_count INTEGER,
  scanned_count INTEGER DEFAULT 0,
  matched_count INTEGER DEFAULT 0,
  missing_count INTEGER DEFAULT 0,
  unexpected_count INTEGER DEFAULT 0,
  shrinkage_value DECIMAL(10,2),
  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);
ALTER TABLE stocktake_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON stocktake_sessions;
CREATE POLICY tenant_isolation ON stocktake_sessions
  USING (tenant_id = current_setting('app.current_tenant')::UUID);

CREATE TABLE IF NOT EXISTS stocktake_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES stocktake_sessions(id) ON DELETE CASCADE,
  garment_serial VARCHAR(255) NOT NULL,
  category VARCHAR(50) NOT NULL
    CHECK (category IN ('matched', 'missing', 'unexpected')),
  scanned_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sync_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id VARCHAR(100) NOT NULL,
  sequence_number BIGINT NOT NULL,
  action VARCHAR(50) NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  synced_at TIMESTAMP,
  sync_error TEXT,
  CONSTRAINT unique_device_sequence UNIQUE (device_id, sequence_number)
);
ALTER TABLE sync_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sync_queue;
CREATE POLICY tenant_isolation ON sync_queue
  USING (tenant_id = current_setting('app.current_tenant')::UUID);

CREATE TABLE IF NOT EXISTS sync_conflicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  garment_serial VARCHAR(255) NOT NULL,
  conflict_type VARCHAR(50) NOT NULL,
  device_a_id VARCHAR(100) NOT NULL,
  device_b_id VARCHAR(100),
  action_a JSONB NOT NULL,
  action_b JSONB,
  resolution VARCHAR(50),
  resolved_by UUID REFERENCES staff(id),
  resolved_at TIMESTAMP,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
ALTER TABLE sync_conflicts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sync_conflicts;
CREATE POLICY tenant_isolation ON sync_conflicts
  USING (tenant_id = current_setting('app.current_tenant')::UUID);

CREATE TABLE IF NOT EXISTS audit_trail (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  action_type VARCHAR(100) NOT NULL,
  actor_id UUID REFERENCES staff(id),
  actor_role VARCHAR(50),
  device_id VARCHAR(100),
  resource_type VARCHAR(100),
  resource_id VARCHAR(255),
  changes JSONB,
  metadata JSONB,
  ip_address INET,
  created_at TIMESTAMP DEFAULT NOW()
);
ALTER TABLE audit_trail ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON audit_trail;
CREATE POLICY tenant_isolation ON audit_trail
  USING (tenant_id = current_setting('app.current_tenant')::UUID);

CREATE TABLE IF NOT EXISTS cash_drawers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES locations(id),
  cashier_id UUID NOT NULL REFERENCES staff(id),
  opening_float DECIMAL(10,2) NOT NULL,
  cash_sales DECIMAL(10,2) DEFAULT 0,
  expected_total DECIMAL(10,2) NOT NULL,
  actual_count DECIMAL(10,2),
  discrepancy DECIMAL(10,2),
  opened_at TIMESTAMP DEFAULT NOW(),
  closed_at TIMESTAMP
);
ALTER TABLE cash_drawers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON cash_drawers;
CREATE POLICY tenant_isolation ON cash_drawers
  USING (tenant_id = current_setting('app.current_tenant')::UUID);

CREATE TABLE IF NOT EXISTS shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES staff(id),
  location_id UUID REFERENCES locations(id),
  started_at TIMESTAMP DEFAULT NOW(),
  ended_at TIMESTAMP,
  transactions_count INTEGER NOT NULL DEFAULT 0,
  total_sales DECIMAL(10,2) NOT NULL DEFAULT 0,
  discount_total DECIMAL(10,2) NOT NULL DEFAULT 0,
  returns_count INTEGER NOT NULL DEFAULT 0,
  returns_total DECIMAL(10,2) NOT NULL DEFAULT 0,
  closing_report_id UUID,
  summary JSONB
);
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON shifts;
CREATE POLICY tenant_isolation ON shifts
  USING (tenant_id = current_setting('app.current_tenant')::UUID);

CREATE TABLE IF NOT EXISTS sales_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  shift_id UUID REFERENCES shifts(id),
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  cashier_id UUID REFERENCES staff(id),
  location_id UUID REFERENCES locations(id),
  refund_method VARCHAR(50) NOT NULL CHECK (refund_method IN ('CASH', 'MOBILE_MONEY', 'STORE_CREDIT', 'VOID')),
  reason TEXT,
  refund_total DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (refund_total >= 0),
  created_at TIMESTAMP DEFAULT NOW()
);
ALTER TABLE sales_returns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sales_returns;
CREATE POLICY tenant_isolation ON sales_returns
  USING (tenant_id = current_setting('app.current_tenant')::UUID);

CREATE TABLE IF NOT EXISTS sales_return_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id UUID NOT NULL REFERENCES sales_returns(id) ON DELETE CASCADE,
  transaction_item_id UUID NOT NULL REFERENCES transaction_items(id),
  garment_serial VARCHAR(255) REFERENCES garments(serial),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price DECIMAL(10,2) NOT NULL,
  refund_amount DECIMAL(10,2) NOT NULL,
  restocked BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS shift_closing_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  cashier_id UUID NOT NULL REFERENCES staff(id),
  location_id UUID REFERENCES locations(id),
  report_date DATE NOT NULL DEFAULT CURRENT_DATE,
  transactions_count INTEGER NOT NULL DEFAULT 0,
  gross_sales DECIMAL(10,2) NOT NULL DEFAULT 0,
  discount_total DECIMAL(10,2) NOT NULL DEFAULT 0,
  returns_count INTEGER NOT NULL DEFAULT 0,
  returns_total DECIMAL(10,2) NOT NULL DEFAULT 0,
  net_sales DECIMAL(10,2) NOT NULL DEFAULT 0,
  opened_at TIMESTAMP,
  closed_at TIMESTAMP DEFAULT NOW(),
  summary JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
ALTER TABLE shift_closing_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON shift_closing_reports;
CREATE POLICY tenant_isolation ON shift_closing_reports
  USING (tenant_id = current_setting('app.current_tenant')::UUID);

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
  USING (tenant_id = current_setting('app.current_tenant')::UUID);
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
  USING (tenant_id = current_setting('app.current_tenant')::UUID);
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
  USING (tenant_id = current_setting('app.current_tenant')::UUID);
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
  USING (tenant_id = current_setting('app.current_tenant')::UUID);
CREATE INDEX IF NOT EXISTS idx_tenant_daily_rollups_date ON tenant_daily_rollups(rollup_date DESC);
CREATE INDEX IF NOT EXISTS idx_tenant_daily_rollups_tenant_date ON tenant_daily_rollups(tenant_id, rollup_date DESC);

CREATE OR REPLACE FUNCTION set_tenant_context(tenant_uuid text)
RETURNS VOID AS $$
BEGIN
  PERFORM set_config('app.current_tenant', tenant_uuid, true);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION generate_serial()
RETURNS VARCHAR(255) AS $$
DECLARE
  prefix VARCHAR := 'RTL';
  year VARCHAR := TO_CHAR(NOW(), 'YYYY');
  random_part VARCHAR := UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 8));
BEGIN
  RETURN prefix || '-' || year || '-' || random_part;
END;
$$ LANGUAGE plpgsql;
