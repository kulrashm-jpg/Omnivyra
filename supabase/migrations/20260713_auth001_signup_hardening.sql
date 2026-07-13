-- ═══════════════════════════════════════════════════════════════════════════════
-- AUTH-001 §8 — signup database hardening
--
--   1. signup_intents: at most ONE pending intent per email.
--      The application does check-then-insert (pages/api/auth/signup.ts §5);
--      without a unique index, concurrent submits could create duplicate
--      pending rows that later break `.maybeSingle()` reads. Older duplicate
--      pending intents are retired to status='expired' (an existing enum
--      value that was previously never written) — NO rows are deleted.
--
--   2. companies.website_domain: one company per website domain, matching the
--      existing DB guarantee on admin_email_domain
--      (idx_companies_admin_email_domain_unique, 20260322_domain_credit_hardening.sql).
--      Previously app-checked only; a historical duplicate had to be merged
--      by hand (20260325_fix_duplicate_company_website_domain.sql).
--      SAFE-GUARDED: if live duplicates exist the index is NOT created and a
--      WARNING is raised naming the count — the migration never fails and
--      never mutates company rows. Merge duplicates, then re-run.
--
-- Both statements are idempotent (IF NOT EXISTS / re-runnable UPDATE).
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. signup_intents: retire duplicate pending intents, newest wins ──────────
UPDATE signup_intents si
SET status = 'expired'
WHERE si.status = 'pending'
  AND EXISTS (
    SELECT 1
    FROM signup_intents newer
    WHERE newer.email  = si.email
      AND newer.status = 'pending'
      AND (newer.created_at > si.created_at
           OR (newer.created_at = si.created_at AND newer.id > si.id))
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_signup_intents_email_pending_unique
  ON signup_intents (email)
  WHERE status = 'pending';

COMMENT ON INDEX idx_signup_intents_email_pending_unique IS
  'AUTH-001 §8: one pending signup intent per email — DB backstop for the check-then-insert in /api/auth/signup.';

-- ── 2. companies.website_domain: one company per website domain ───────────────
DO $$
DECLARE
  dup_count integer;
BEGIN
  SELECT count(*) INTO dup_count
  FROM (
    SELECT website_domain
    FROM companies
    WHERE website_domain IS NOT NULL
    GROUP BY website_domain
    HAVING count(*) > 1
  ) dups;

  IF dup_count > 0 THEN
    RAISE WARNING
      'AUTH-001 §8: % website_domain value(s) are duplicated across companies — unique index NOT created. Merge duplicates (pattern: 20260325_fix_duplicate_company_website_domain.sql), then re-run this migration.',
      dup_count;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_website_domain_unique
      ON companies (website_domain)
      WHERE website_domain IS NOT NULL;
  END IF;
END $$;

-- Note: the plain partial index idx_companies_website_domain
-- (20260321_company_website_domain.sql) is left in place; it remains valid
-- for lookups and its removal is an optional follow-up once the unique index
-- exists everywhere.
