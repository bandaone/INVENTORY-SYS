-- One-time sync for existing databases running older schema versions.
-- This brings the live DB in line with the app code that now expects
-- discounts, tenant settings, returns, and shift close reports.

ALTER TABLE IF EXISTS variants
  ADD COLUMN IF NOT EXISTS discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS transaction_items
  ADD COLUMN IF NOT EXISTS discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0;

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
  USING (
    current_setting('app.current_tenant'::text, true) IS NOT NULL
    AND current_setting('app.current_tenant'::text, true) <> ''
    AND tenant_id = current_setting('app.current_tenant'::text, true)::uuid
  );
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_settings TO retail_os_app;

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
  USING (
    current_setting('app.current_tenant'::text, true) IS NOT NULL
    AND current_setting('app.current_tenant'::text, true) <> ''
    AND tenant_id = current_setting('app.current_tenant'::text, true)::uuid
  );
GRANT SELECT, INSERT, UPDATE, DELETE ON shifts TO retail_os_app;

CREATE TABLE IF NOT EXISTS sales_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  shift_id UUID REFERENCES shifts(id),
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  cashier_id UUID REFERENCES staff(id),
  location_id UUID REFERENCES locations(id),
  refund_method VARCHAR(50) NOT NULL CHECK (refund_method IN ('CASH', 'MOBILE_MONEY', 'STORE_CREDIT', 'VOID')),
  reason TEXT,
  refund_total DECIMAL(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);
ALTER TABLE sales_returns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sales_returns;
CREATE POLICY tenant_isolation ON sales_returns
  USING (
    current_setting('app.current_tenant'::text, true) IS NOT NULL
    AND current_setting('app.current_tenant'::text, true) <> ''
    AND tenant_id = current_setting('app.current_tenant'::text, true)::uuid
  );
GRANT SELECT, INSERT, UPDATE, DELETE ON sales_returns TO retail_os_app;

CREATE TABLE IF NOT EXISTS sales_return_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id UUID NOT NULL REFERENCES sales_returns(id) ON DELETE CASCADE,
  transaction_item_id UUID NOT NULL REFERENCES transaction_items(id),
  garment_serial VARCHAR(255) REFERENCES garments(serial),
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price DECIMAL(10,2) NOT NULL,
  refund_amount DECIMAL(10,2) NOT NULL,
  restocked BOOLEAN NOT NULL DEFAULT FALSE
);
GRANT SELECT, INSERT, UPDATE, DELETE ON sales_return_items TO retail_os_app;

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
  USING (
    current_setting('app.current_tenant'::text, true) IS NOT NULL
    AND current_setting('app.current_tenant'::text, true) <> ''
    AND tenant_id = current_setting('app.current_tenant'::text, true)::uuid
  );
GRANT SELECT, INSERT, UPDATE, DELETE ON shift_closing_reports TO retail_os_app;
