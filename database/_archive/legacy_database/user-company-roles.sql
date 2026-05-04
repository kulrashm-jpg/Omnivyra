CREATE TABLE IF NOT EXISTS user_company_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  company_id UUID NOT NULL,
  role TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT now(),
  name TEXT,
  status TEXT DEFAULT 'invited',
  invited_at TIMESTAMP,
  accepted_at TIMESTAMP,
  deactivated_at TIMESTAMP,
  updated_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_company_roles_user_company
  ON user_company_roles(user_id, company_id);

ALTER TABLE user_company_roles
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'invited';
ALTER TABLE user_company_roles
  ADD COLUMN IF NOT EXISTS invited_at TIMESTAMP;
ALTER TABLE user_company_roles
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMP;
ALTER TABLE user_company_roles
  ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMP;
ALTER TABLE user_company_roles
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP;
ALTER TABLE user_company_roles
  ADD COLUMN IF NOT EXISTS name TEXT;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_company_roles_status_check'
  ) THEN
    ALTER TABLE user_company_roles
      ADD CONSTRAINT user_company_roles_status_check
      CHECK (status IN ('invited', 'active', 'inactive', 'expired'));
  END IF;
END $$;
