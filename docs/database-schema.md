# Database Schema

Complete PostgreSQL database schema for Retail OS with multi-tenant isolation.

## Schema Overview

The database uses PostgreSQL 15+ with Row-Level Security (RLS) for multi-tenant isolation. All tables include a `tenant_id` column and RLS policies to ensure complete data separation.

## Core Principles

1. **Multi-Tenant Isolation**: Every table includes `tenant_id` with RLS policies
2. **Immutable Audit Trail**: Append-only tables with no DELETE/UPDATE operations
3. **Serial Lifecycle**: Garments transition through defined statuses
4. **Sequence-Based Sync**: Monotonic sequence numbers for conflict resolution

## Entity Relationship Diagram

```
Tenant
  ├──► Location
  ├──► Staff
  ├──► Variant
  │     └──► Garment
  │           ├──► Transaction
  │           └──► StockMovement
  └──► AuditTrail
```

## Tables

### tenants

Represents a single retail business subscribing to the platform.

```sql
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  subscription_tier VARCHAR(50) NOT NULL
    CHECK (subscription_tier IN ('boutique_starter', 'growth', 'enterprise_fleet')),
  active_locations_count INTEGER DEFAULT 0
    CHECK (active_locations_count >= 0),
  active_devices_count INTEGER DEFAULT 0
    CHECK (active_devices_count >= 0),
  max_locations INTEGER NOT NULL,
  features JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_tenants_tier ON tenants(subscription_tier);
```

**Features JSONB structure**:
```json
{
  "zraEnabled": true,
  "rfidEnabled": false,
  "transfersEnabled": true,
  "maxLocations": 3
}
```

### locations

Physical stores or warehouses within a tenant.

```sql
CREATE TABLE locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  address TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT unique_tenant_location_name UNIQUE (tenant_id, name)
);

-- Multi-tenant RLS
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON locations
  USING (tenant_id = current_setting('app.current_tenant')::UUID);

CREATE INDEX idx_locations_tenant ON locations(tenant_id);
CREATE INDEX idx_locations_active ON locations(tenant_id, is_active);
```

### staff

User accounts for owners, managers, cashiers, and stock clerks.

```sql
CREATE TABLE staff (
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

CREATE POLICY tenant_isolation ON staff
  USING (tenant_id = current_setting('app.current_tenant')::UUID);

CREATE INDEX idx_staff_tenant ON staff(tenant_id);
CREATE INDEX idx_staff_location ON staff(location_id);
CREATE INDEX idx_staff_role ON staff(role);
CREATE INDEX idx_staff_email ON staff(email);
```

### variants

Product definitions combining name, color, and size.

```sql
CREATE TABLE variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(100),
  color VARCHAR(50),
  size VARCHAR(20),
  cost_price DECIMAL(10,2) NOT NULL CHECK (cost_price >= 0),
  retail_price DECIMAL(10,2) NOT NULL CHECK (retail_price >= 0),
  reorder_threshold INTEGER DEFAULT 10 CHECK (reorder_threshold >= 0),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT unique_variant UNIQUE (tenant_id, name, color, size)
);

ALTER TABLE variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON variants
  USING (tenant_id = current_setting('app.current_tenant')::UUID);

CREATE INDEX idx_variants_tenant ON variants(tenant_id);
CREATE INDEX idx_variants_category ON variants(tenant_id, category);
CREATE INDEX idx_variants_search ON variants USING gin(to_tsvector('english', name));
```

### garments

Individual physical items with unique serial numbers.

```sql
CREATE TABLE garments (
  serial VARCHAR(255) PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES variants(id),
  location_id UUID NOT NULL REFERENCES locations(id),
  status VARCHAR(50) NOT NULL
    CHECK (status IN ('in_stock', 'sold', 'missing', 'transferred')),
  cost_price DECIMAL(10,2) NOT NULL,
  retail_price DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE garments ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON garments
  USING (tenant_id = current_setting('app.current_tenant')::UUID);

-- Critical index for POS serial lookup (< 300ms target)
CREATE INDEX idx_garments_serial ON garments(serial)
  INCLUDE (variant_id, status, retail_price, location_id);

CREATE INDEX idx_garments_tenant ON garments(tenant_id);
CREATE INDEX idx_garments_variant ON garments(variant_id);
CREATE INDEX idx_garments_location_status ON garments(location_id, status);
CREATE INDEX idx_garments_status ON garments(status);
```

### transactions

Completed sales with payment information.

```sql
CREATE TABLE transactions (
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

CREATE POLICY tenant_isolation ON transactions
  USING (tenant_id = current_setting('app.current_tenant')::UUID);

CREATE INDEX idx_transactions_tenant ON transactions(tenant_id);
CREATE INDEX idx_transactions_location ON transactions(location_id);
CREATE INDEX idx_transactions_cashier ON transactions(cashier_id);
CREATE INDEX idx_transactions_date ON transactions(tenant_id, created_at DESC);
CREATE INDEX idx_transactions_receipt ON transactions(receipt_number);
```

### transaction_items

Line items within a transaction.

```sql
CREATE TABLE transaction_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  garment_serial VARCHAR(255) REFERENCES garments(serial),
  variant_id UUID REFERENCES variants(id),
  description TEXT,
  quantity INTEGER DEFAULT 1,
  unit_price DECIMAL(10,2) NOT NULL,
  total_price DECIMAL(10,2) NOT NULL,
  
  CONSTRAINT serial_or_manual CHECK (
    (garment_serial IS NOT NULL AND variant_id IS NOT NULL) OR
    (garment_serial IS NULL AND description IS NOT NULL)
  )
);

CREATE INDEX idx_transaction_items_txn ON transaction_items(transaction_id);
CREATE INDEX idx_transaction_items_serial ON transaction_items(garment_serial);
```

### stock_movements

Immutable log of all inventory status changes.

```sql
CREATE TABLE stock_movements (
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

CREATE POLICY tenant_isolation ON stock_movements
  USING (tenant_id = current_setting('app.current_tenant')::UUID);

CREATE INDEX idx_stock_movements_tenant ON stock_movements(tenant_id);
CREATE INDEX idx_stock_movements_serial ON stock_movements(garment_serial);
CREATE INDEX idx_stock_movements_type ON stock_movements(movement_type);
CREATE INDEX idx_stock_movements_date ON stock_movements(tenant_id, created_at DESC);
CREATE INDEX idx_stock_movements_sequence ON stock_movements(device_id, sequence_number);
```

### stocktake_sessions

Inventory counting sessions.

```sql
CREATE TABLE stocktake_sessions (
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

CREATE POLICY tenant_isolation ON stocktake_sessions
  USING (tenant_id = current_setting('app.current_tenant')::UUID);

CREATE INDEX idx_stocktake_sessions_location ON stocktake_sessions(location_id);
CREATE INDEX idx_stocktake_sessions_status ON stocktake_sessions(status);
CREATE INDEX idx_stocktake_sessions_date ON stocktake_sessions(tenant_id, started_at DESC);
```

### stocktake_scans

Individual scan events within a stocktake session.

```sql
CREATE TABLE stocktake_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES stocktake_sessions(id) ON DELETE CASCADE,
  garment_serial VARCHAR(255) NOT NULL,
  category VARCHAR(50) NOT NULL
    CHECK (category IN ('matched', 'missing', 'unexpected')),
  scanned_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_stocktake_scans_session ON stocktake_scans(session_id);
CREATE INDEX idx_stocktake_scans_serial ON stocktake_scans(garment_serial);
```

### sync_queue

Offline actions awaiting synchronization to cloud.

```sql
CREATE TABLE sync_queue (
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

CREATE POLICY tenant_isolation ON sync_queue
  USING (tenant_id = current_setting('app.current_tenant')::UUID);

CREATE INDEX idx_sync_queue_pending ON sync_queue(device_id, sequence_number)
  WHERE synced_at IS NULL;
CREATE INDEX idx_sync_queue_tenant ON sync_queue(tenant_id);
```

### sync_conflicts

Detected conflicts requiring manual resolution.

```sql
CREATE TABLE sync_conflicts (
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

CREATE POLICY tenant_isolation ON sync_conflicts
  USING (tenant_id = current_setting('app.current_tenant')::UUID);

CREATE INDEX idx_sync_conflicts_pending ON sync_conflicts(tenant_id)
  WHERE resolution IS NULL;
CREATE INDEX idx_sync_conflicts_serial ON sync_conflicts(garment_serial);
```

### audit_trail

Comprehensive immutable log of all system actions.

```sql
CREATE TABLE audit_trail (
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

CREATE POLICY tenant_isolation ON audit_trail
  USING (tenant_id = current_setting('app.current_tenant')::UUID);

CREATE INDEX idx_audit_trail_tenant_date ON audit_trail(tenant_id, created_at DESC);
CREATE INDEX idx_audit_trail_actor ON audit_trail(actor_id);
CREATE INDEX idx_audit_trail_action ON audit_trail(action_type);
CREATE INDEX idx_audit_trail_resource ON audit_trail(resource_type, resource_id);
```

### cash_drawers

Cash reconciliation records for cashier shifts.

```sql
CREATE TABLE cash_drawers (
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

CREATE POLICY tenant_isolation ON cash_drawers
  USING (tenant_id = current_setting('app.current_tenant')::UUID);

CREATE INDEX idx_cash_drawers_cashier ON cash_drawers(cashier_id);
CREATE INDEX idx_cash_drawers_date ON cash_drawers(tenant_id, opened_at DESC);
```

## Views

### active_stock_summary

Aggregated stock counts by location and variant.

```sql
CREATE VIEW active_stock_summary AS
SELECT 
  g.tenant_id,
  g.location_id,
  l.name AS location_name,
  g.variant_id,
  v.name AS variant_name,
  v.color,
  v.size,
  v.reorder_threshold,
  COUNT(*) AS quantity,
  SUM(g.retail_price) AS total_value
FROM garments g
JOIN locations l ON g.location_id = l.id
JOIN variants v ON g.variant_id = v.id
WHERE g.status = 'in_stock'
GROUP BY g.tenant_id, g.location_id, l.name, g.variant_id, v.name, v.color, v.size, v.reorder_threshold;
```

### monthly_shrinkage

Shrinkage value by location and month.

```sql
CREATE VIEW monthly_shrinkage AS
SELECT 
  sm.tenant_id,
  sm.to_location_id AS location_id,
  DATE_TRUNC('month', sm.created_at) AS month,
  COUNT(*) AS missing_count,
  SUM(g.retail_price) AS shrinkage_value
FROM stock_movements sm
JOIN garments g ON sm.garment_serial = g.serial
WHERE sm.movement_type = 'STOCKTAKE' AND sm.to_status = 'missing'
GROUP BY sm.tenant_id, sm.to_location_id, DATE_TRUNC('month', sm.created_at);
```

## Materialized Views

### dashboard_metrics

Pre-aggregated metrics for dashboard performance.

```sql
CREATE MATERIALIZED VIEW dashboard_metrics AS
SELECT 
  t.tenant_id,
  t.location_id,
  DATE(t.created_at) AS date,
  COUNT(*) AS transaction_count,
  SUM(t.total) AS daily_revenue,
  SUM(CASE WHEN t.payment_method = 'CASH' THEN t.total ELSE 0 END) AS cash_revenue,
  SUM(CASE WHEN t.payment_method = 'MOBILE_MONEY' THEN t.total ELSE 0 END) AS mobile_money_revenue
FROM transactions t
GROUP BY t.tenant_id, t.location_id, DATE(t.created_at);

CREATE UNIQUE INDEX idx_dashboard_metrics_unique 
  ON dashboard_metrics(tenant_id, location_id, date);

-- Refresh hourly via cron job or trigger
REFRESH MATERIALIZED VIEW CONCURRENTLY dashboard_metrics;
```

## Functions

### set_tenant_context

Set tenant context for RLS policies.

```sql
CREATE OR REPLACE FUNCTION set_tenant_context(tenant_uuid UUID)
RETURNS VOID AS $$
BEGIN
  PERFORM set_config('app.current_tenant', tenant_uuid::text, false);
END;
$$ LANGUAGE plpgsql;
```

### generate_serial

Generate unique garment serial number.

```sql
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
```

## Triggers

### update_updated_at

Automatically update `updated_at` timestamp.

```sql
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables with updated_at
CREATE TRIGGER update_tenants_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_locations_updated_at
  BEFORE UPDATE ON locations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Apply to other tables...
```

## Indexes Summary

Critical indexes for performance:

| Index | Table | Purpose | Target |
|-------|-------|---------|--------|
| `idx_garments_serial` | garments | Serial lookup | < 300ms |
| `idx_sync_queue_pending` | sync_queue | Pending sync items | < 100ms |
| `idx_transactions_date` | transactions | Recent transactions | < 500ms |
| `idx_audit_trail_tenant_date` | audit_trail | Audit queries | < 1s |

## Partitioning Strategy

For high-volume tables, consider partitioning:

```sql
-- Partition audit_trail by month
CREATE TABLE audit_trail (
  -- columns
) PARTITION BY RANGE (created_at);

CREATE TABLE audit_trail_2026_06 
  PARTITION OF audit_trail 
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

CREATE TABLE audit_trail_2026_07 
  PARTITION OF audit_trail 
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
```

## Backup Strategy

1. **Automated RDS snapshots**: Daily, 30-day retention
2. **Point-in-time recovery**: 5-minute granularity
3. **Manual snapshots**: Before major changes
4. **Cross-region replication**: For disaster recovery

## Further Reading

- [Architecture Guide](architecture.md)
- [API Reference](api-reference.md)
- [Deployment Guide](deployment.md)
