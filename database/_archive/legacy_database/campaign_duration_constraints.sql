-- Modular Campaign Duration Constraint Framework
-- Adds duration_locked, duration_weeks, blueprint_status to campaigns.
-- Allowed blueprint_status: ACTIVE, INVALIDATED, REGENERATING

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS duration_locked BOOLEAN DEFAULT false;

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS duration_weeks INTEGER;

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS blueprint_status VARCHAR(20) DEFAULT 'ACTIVE';

-- Application enforces blueprint_status IN ('ACTIVE','INVALIDATED','REGENERATING')
