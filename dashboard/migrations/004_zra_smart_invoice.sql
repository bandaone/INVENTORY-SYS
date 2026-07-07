-- ============================================================
-- Migration: ZRA Smart Invoice (VSDC) Support
-- Run this in: Supabase SQL Editor → paste & click Run
-- ============================================================

-- 1. Extend tenant_settings with ZRA VSDC credentials
ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS zra_vsdc_url       TEXT,
  ADD COLUMN IF NOT EXISTS zra_bhf_id         VARCHAR(3) DEFAULT '000',
  ADD COLUMN IF NOT EXISTS zra_dvc_srl_no     TEXT,
  ADD COLUMN IF NOT EXISTS zra_initialized_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS zra_last_invc_no   INTEGER DEFAULT 0;

-- 2. Add ZRA receipt data to completed transactions
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS zra_rcpt_no    TEXT,
  ADD COLUMN IF NOT EXISTS zra_intrl_data TEXT,
  ADD COLUMN IF NOT EXISTS zra_mrc_no     TEXT,
  ADD COLUMN IF NOT EXISTS zra_vsd_status TEXT DEFAULT 'not_required';

-- 3. Add ZRA tax classification to product variants
ALTER TABLE variants
  ADD COLUMN IF NOT EXISTS zra_item_cd     TEXT,
  ADD COLUMN IF NOT EXISTS zra_item_cls_cd TEXT DEFAULT '57102001',
  ADD COLUMN IF NOT EXISTS zra_tax_ty_cd   TEXT DEFAULT 'A';

-- 4. Offline sync queue for when VSDC is temporarily unreachable
CREATE TABLE IF NOT EXISTS zra_sync_queue (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      TEXT        NOT NULL,
  transaction_id UUID        REFERENCES transactions(id) ON DELETE CASCADE,
  payload        JSONB       NOT NULL,
  status         TEXT        DEFAULT 'pending',
  attempts       INTEGER     DEFAULT 0,
  last_error     TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  synced_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_zra_queue_status  ON zra_sync_queue(status);
CREATE INDEX IF NOT EXISTS idx_zra_queue_tenant  ON zra_sync_queue(tenant_id);
CREATE INDEX IF NOT EXISTS idx_zra_queue_created ON zra_sync_queue(created_at);
