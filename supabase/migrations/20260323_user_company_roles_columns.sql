-- ─────────────────────────────────────────────────────────────────────────────
-- Add lifecycle-tracking columns to user_company_roles.
--
-- These columns were used in application code before their migration existed,
-- causing PGRST204 errors. This migration makes them permanent with safe defaults.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE user_company_roles
  ADD COLUMN IF NOT EXISTS invited_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS accepted_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;

-- Back-fill invited_at for existing rows that have status = 'invited' but no timestamp
UPDATE user_company_roles
SET    invited_at = created_at
WHERE  invited_at IS NULL
  AND  status = 'invited'
  AND  created_at IS NOT NULL;
