-- Add compliance fields to tenants
ALTER TABLE tenants 
ADD COLUMN IF NOT EXISTS zra_configured BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS zra_cert_expiry TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS hardware_lease_active BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS hardware_arrears numeric(12,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'ACTIVE';

CREATE TABLE IF NOT EXISTS onboarding_sessions (
    tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    current_step INTEGER DEFAULT 1,
    steps_completed TEXT[] DEFAULT '{}',
    trial_start_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    trial_end_date TIMESTAMP WITH TIME ZONE,
    grace_period_end_date TIMESTAMP WITH TIME ZONE,
    onboarding_type VARCHAR(50) DEFAULT 'SELF_SERVICE',
    assigned_agent_id UUID,
    hardware_paired BOOLEAN DEFAULT false,
    first_sale_completed BOOLEAN DEFAULT false,
    converted_to_paid BOOLEAN DEFAULT false,
    conversion_date TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS onboarding_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    event_type VARCHAR(100) NOT NULL,
    step_number INTEGER,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
