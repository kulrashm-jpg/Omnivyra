-- Domain-level free credit enforcement — Step 2 hardening
--
-- Adds a denormalized `domain` column to free_credit_claims so that
-- uniqueness can be enforced with a plain UNIQUE index — no cross-table JOINs
-- needed at query time, and no triggers required.
--
-- Design rationale:
--   companies.admin_email_domain is the source of truth for domain ownership,
--   but it cannot be referenced inside an index predicate or a UNIQUE constraint
--   directly. Denormalizing the domain into the claim row makes the UNIQUE index
--   straightforward and keeps enforcement entirely inside PostgreSQL.
--
--   NULL domains (free email providers like gmail.com) are excluded from the
--   unique constraint — the application-layer eligibility check handles those.
--
-- Also drops the org-level partial index from the previous migration in favour
-- of the stricter domain-level index. One domain ⟹ one org (enforced by
-- companies.admin_email_domain UNIQUE), so domain-level uniqueness implies
-- org-level uniqueness for non-NULL domains.

-- ── 1. Add denormalized domain column ────────────────────────────────────────

ALTER TABLE free_credit_claims
  ADD COLUMN IF NOT EXISTS domain TEXT NULL;

-- ── 2. Backfill existing 'initial' rows from companies ────────────────────────
-- Only the 'initial' category needs the domain; other categories can stay NULL.
-- Guarded by a column-existence check so this migration is safe to apply even
-- if 20260321_company_email_domain.sql has not yet run in this environment.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE  table_name  = 'companies'
      AND  column_name = 'admin_email_domain'
  ) THEN
    UPDATE free_credit_claims fc
    SET    domain = c.admin_email_domain
    FROM   companies c
    WHERE  fc.organization_id    = c.id
      AND  fc.category           = 'initial'
      AND  fc.domain             IS NULL
      AND  c.admin_email_domain  IS NOT NULL;
  END IF;
END $$;

-- ── 3. Drop the org-level partial index (superseded) ─────────────────────────

DROP INDEX IF EXISTS idx_free_credit_claims_initial_per_org;

-- ── 4. Create UNIQUE index on domain for 'initial' category ──────────────────
-- Partial index: only rows where category='initial' and domain is not NULL.
-- This means:
--   • One initial credit grant allowed per non-null domain — enforced by DB.
--   • Free-email-provider users (domain=NULL) fall through to application checks.

CREATE UNIQUE INDEX IF NOT EXISTS idx_free_credit_claims_initial_domain
  ON free_credit_claims(domain)
  WHERE category = 'initial' AND domain IS NOT NULL;

-- ── 5. Index on domain for fast lookup (covering the WHERE above) ─────────────

CREATE INDEX IF NOT EXISTS idx_free_credit_claims_domain
  ON free_credit_claims(domain)
  WHERE domain IS NOT NULL;
