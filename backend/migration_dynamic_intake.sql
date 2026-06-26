ALTER TABLE variants
  ADD COLUMN IF NOT EXISTS subtype VARCHAR(100),
  ADD COLUMN IF NOT EXISTS barcode_token VARCHAR(255),
  ADD COLUMN IF NOT EXISTS barcode_payload JSONB,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS missing_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS detail_status VARCHAR(20) NOT NULL DEFAULT 'complete',
  ADD COLUMN IF NOT EXISTS search_text TEXT;

ALTER TABLE garments
  ADD COLUMN IF NOT EXISTS barcode_token VARCHAR(255),
  ADD COLUMN IF NOT EXISTS barcode_payload JSONB,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS missing_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS detail_status VARCHAR(20) NOT NULL DEFAULT 'complete',
  ADD COLUMN IF NOT EXISTS search_text TEXT,
  ADD COLUMN IF NOT EXISTS source_code VARCHAR(255);

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

CREATE INDEX IF NOT EXISTS idx_import_profiles_tenant_signature
  ON import_profiles(tenant_id, source_signature);

GRANT SELECT, INSERT, UPDATE, DELETE ON import_profiles TO retail_os_app;
