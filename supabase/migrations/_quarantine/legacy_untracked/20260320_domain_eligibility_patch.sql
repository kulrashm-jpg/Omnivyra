-- ─────────────────────────────────────────────────────────────────────────────
-- Domain Eligibility Schema Patch
-- Adds columns expected by domainEligibilityService.ts and the API routes.
-- Run this AFTER 20260320_domain_eligibility.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- ── access_requests: add missing columns ─────────────────────────────────────

ALTER TABLE access_requests
  ADD COLUMN IF NOT EXISTS job_title       text,
  ADD COLUMN IF NOT EXISTS website_url     text,
  ADD COLUMN IF NOT EXISTS domain_status   text,      -- e.g. 'public_provider', 'forwarding_domain'
  ADD COLUMN IF NOT EXISTS organization_id uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at     timestamptz,
  ADD COLUMN IF NOT EXISTS admin_note      text,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS credits_granted_amount int; -- numeric credits (separate from boolean)

-- Rename 'website' → keep as-is but populate website_url from it for consistency
-- (service code uses website_url; existing column is 'website')
-- Rather than drop 'website', just ensure website_url is used going forward.
-- If 'website' already has data you want to keep:
-- UPDATE access_requests SET website_url = website WHERE website IS NOT NULL;

-- ── domain_eligibility_cache: add checked_at alias ───────────────────────────
-- Service code writes 'checked_at'; DB has 'cached_at'. Add checked_at column.

ALTER TABLE domain_eligibility_cache
  ADD COLUMN IF NOT EXISTS checked_at timestamptz NOT NULL DEFAULT now();

-- ── domain_whitelist: add 'added_by' alias for 'approved_by' ─────────────────
-- Service code uses 'added_by'; DB has 'approved_by'. Add added_by column.

ALTER TABLE domain_whitelist
  ADD COLUMN IF NOT EXISTS added_by  uuid,
  ADD COLUMN IF NOT EXISTS reason    text;

-- ── user_override: add is_eligible boolean ────────────────────────────────────
-- Service code checks 'is_eligible'; DB only has 'credits_granted'.

ALTER TABLE user_override
  ADD COLUMN IF NOT EXISTS is_eligible boolean NOT NULL DEFAULT true;

-- ─────────────────────────────────────────────────────────────────────────────
-- Also required: the leverage_mode tables (if not yet created)
-- Run 20260320_leverage_mode.sql separately if you haven't already.
-- ─────────────────────────────────────────────────────────────────────────────
