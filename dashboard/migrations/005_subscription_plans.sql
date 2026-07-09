-- Migration: Create subscription_plans table

CREATE TABLE IF NOT EXISTS subscription_plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(50) UNIQUE NOT NULL,
    price_zmw DECIMAL(10, 2) NOT NULL,
    max_locations INT NOT NULL,
    max_users INT NOT NULL,
    features JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Seed the initial plans
INSERT INTO subscription_plans (name, price_zmw, max_locations, max_users, features)
VALUES 
('Starter', 500.00, 1, 3, '["1 Store Location", "Up to 3 Staff Members", "Basic Inventory Tracking", "Standard ZRA Integration", "Email Support"]'),
('Professional', 850.00, 3, 10, '["Up to 3 Store Locations", "Up to 10 Staff Members", "Advanced Analytics", "Priority ZRA Sync", "Phone & Email Support"]'),
('Enterprise', 2500.00, 999, 999, '["Unlimited Locations", "Unlimited Staff", "Custom API Access", "Dedicated Account Manager", "White-glove Onboarding"]')
ON CONFLICT (name) DO UPDATE 
SET price_zmw = EXCLUDED.price_zmw, 
    max_locations = EXCLUDED.max_locations, 
    max_users = EXCLUDED.max_users, 
    features = EXCLUDED.features;
