-- Access Request Approval — schema hardening
--
-- Ensures access_requests has all columns needed by the approval flow:
--   name         — requester's name or brand (used as company name on approval)
--   organization_id — FK to companies row created by admin at approval time
--
-- Adds a partial index to make the onboarding lookup fast:
--   SELECT * FROM access_requests WHERE email=$email AND status='approved'
--   (called on every public-domain user entering onboarding)

-- ── 1. Ensure required columns exist (idempotent) ─────────────────────────────

ALTER TABLE access_requests
  ADD COLUMN IF NOT EXISTS name            TEXT,
  ADD COLUMN IF NOT EXISTS website_url     TEXT,
  ADD COLUMN IF NOT EXISTS job_title       TEXT,
  ADD COLUMN IF NOT EXISTS domain          TEXT,
  ADD COLUMN IF NOT EXISTS domain_status   TEXT,
  ADD COLUMN IF NOT EXISTS organization_id UUID,
  ADD COLUMN IF NOT EXISTS reviewed_by     UUID,
  ADD COLUMN IF NOT EXISTS reviewed_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS admin_note      TEXT;

-- ── 2. Fast lookup: onboarding checks approved requests by email ──────────────

CREATE INDEX IF NOT EXISTS idx_access_requests_email_approved
  ON access_requests(email)
  WHERE status = 'approved';

-- ── 3. Prevent duplicate pending requests for the same email ──────────────────

CREATE UNIQUE INDEX IF NOT EXISTS idx_access_requests_email_pending
  ON access_requests(email)
  WHERE status = 'pending';

-- ── 4. Enforce one approved organization per email ────────────────────────────
-- Prevents two approved rows for the same email from ever pointing at different
-- organization_ids. The application layer deduplicates at approval time; this
-- constraint is the DB-level backstop.
--
-- Partial (WHERE status='approved') so rejected/pending rows are unaffected.

CREATE UNIQUE INDEX IF NOT EXISTS idx_access_requests_email_approved_unique
  ON access_requests(email)
  WHERE status = 'approved';
