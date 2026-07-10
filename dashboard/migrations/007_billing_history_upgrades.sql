-- Migration 007: Upgrade billing_history for idempotency and audit trails

-- 1. Add the phone number that actually made the payment (Audit trail)
ALTER TABLE billing_history 
  ADD COLUMN IF NOT EXISTS payer_msisdn VARCHAR(20);

-- 2. Prevent duplicate ghost payments by enforcing unique reference_id (Idempotency)
-- First, ensure there are no existing duplicates before adding the constraint (cleanup)
DELETE FROM billing_history a USING billing_history b 
  WHERE a.id < b.id AND a.reference_id = b.reference_id;

-- Now add the constraint safely
ALTER TABLE billing_history
  DROP CONSTRAINT IF EXISTS billing_history_reference_id_unique;

ALTER TABLE billing_history
  ADD CONSTRAINT billing_history_reference_id_unique UNIQUE (reference_id);
