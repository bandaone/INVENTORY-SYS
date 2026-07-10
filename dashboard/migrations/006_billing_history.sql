-- Migration 006: Create billing_history table
-- Used by MoMo and Flutterwave payment APIs to track subscription payments

CREATE TABLE IF NOT EXISTS billing_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  event_type    VARCHAR(100) NOT NULL DEFAULT 'subscription_payment',
  amount        DECIMAL(12, 2) NOT NULL,
  currency      VARCHAR(10) NOT NULL DEFAULT 'ZMW',
  status        VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  reference_id  VARCHAR(255),
  metadata      JSONB,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for fast per-tenant lookups (used by settings & subscription pages)
CREATE INDEX IF NOT EXISTS idx_billing_history_tenant
  ON billing_history (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_billing_history_status
  ON billing_history (status);

CREATE INDEX IF NOT EXISTS idx_billing_history_reference
  ON billing_history (reference_id);

-- Allow the restricted app role to read/write this table
GRANT SELECT, INSERT, UPDATE ON billing_history TO retail_os_app;
