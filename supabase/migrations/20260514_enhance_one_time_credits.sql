-- =============================================================================
-- One-Time Credit Model — Enhancements
--
-- Builds on 20260513_simplify_free_credit_model.sql. Adds:
--   1. companies.free_credit_granted_at — authoritative "org is credited" flag.
--      Presence = true, absence = false. Backfilled from free_credit_claims so
--      legacy orgs show the correct state.
--   2. credit_admin_grants.reason_type — structured enum (text + CHECK) for
--      categorizing manual admin grants. Free-text reason stays for the note.
--   3. credit_admin_grants.expires_at — standardizes expiry with initial
--      grants (both default 14 days, overridable per-grant).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. companies.free_credit_granted_at
--    Set when the initial free credit is granted to the org. The partial
--    UNIQUE index on free_credit_claims is still the authoritative race-
--    winner; this column is a denormalized mirror for fast querying and UX.
-- ---------------------------------------------------------------------------
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS free_credit_granted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_companies_free_credit_granted
  ON companies(free_credit_granted_at)
  WHERE free_credit_granted_at IS NOT NULL;

-- Backfill: use the earliest 'initial' or 'initial_free_credit' claim per org.
-- Covers both the legacy pre-rename rows and the post-rename rows. Skips orgs
-- already stamped (idempotent re-run).
UPDATE companies c
SET free_credit_granted_at = sub.first_claimed_at
FROM (
  SELECT organization_id,
         MIN(claimed_at) AS first_claimed_at
    FROM free_credit_claims
   WHERE category IN ('initial', 'initial_free_credit')
   GROUP BY organization_id
) sub
WHERE c.id = sub.organization_id
  AND c.free_credit_granted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. credit_admin_grants.reason_type — structured categorisation.
--    Enforced with a CHECK constraint (text + CHECK rather than a PG enum
--    so we can add values without an ALTER TYPE migration).
-- ---------------------------------------------------------------------------
ALTER TABLE credit_admin_grants
  ADD COLUMN IF NOT EXISTS reason_type text NOT NULL DEFAULT 'other';

-- Separate DDL so ADD-COLUMN-IF-NOT-EXISTS doesn't silently skip the CHECK
-- when re-run: add the constraint only when absent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'cag_reason_type_valid'
       AND conrelid = 'credit_admin_grants'::regclass
  ) THEN
    ALTER TABLE credit_admin_grants
      ADD CONSTRAINT cag_reason_type_valid
      CHECK (reason_type IN (
        'customer_support',
        'goodwill',
        'promotional',
        'beta_feedback',
        'compensation',
        'correction',
        'other'
      ));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_cag_reason_type ON credit_admin_grants(reason_type);

-- ---------------------------------------------------------------------------
-- 3. credit_admin_grants.expires_at — explicit expiry parity with initial.
--    Nullable to allow "no expiry" grants for exceptional cases. When set,
--    consumption logic should treat the grant as expired past this timestamp.
-- ---------------------------------------------------------------------------
ALTER TABLE credit_admin_grants
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_cag_expires_at
  ON credit_admin_grants(expires_at)
  WHERE expires_at IS NOT NULL;
