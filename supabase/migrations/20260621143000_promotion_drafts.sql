-- =============================================================================
-- Promotion drafts — durable, DB-backed promotional post drafts (BLOG-PROMOTION
-- hardening). Replaces the localStorage client store so drafts survive refresh,
-- logout/login, browser crash, and are available cross-device.
--
-- DEDICATED table. Does NOT reuse scheduled_posts / campaign_plans /
-- content_assets (those model different lifecycles). Minimum schema only.
--
-- ACCESS: RLS enabled with NO public policies — the table is reachable ONLY via
-- the service-role API route (/api/promotion-drafts), which enforces org access
-- (enforceCompanyAccess) and scopes every query by organization_id. This is the
-- single access path; clients never touch the table directly.
--
-- APPLY via the controlled process (Supabase SQL editor / single targeted
-- migration) — NOT `supabase db push` (prod ledger is hand-managed; see memory).
-- Every statement is IF NOT EXISTS / idempotent.
-- =============================================================================

CREATE TABLE IF NOT EXISTS promotion_drafts (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   text        NOT NULL,
  user_id           text        NOT NULL,
  content_id        text        NOT NULL,
  content_type      text        NOT NULL,
  platform          text        NOT NULL,
  promotional_text  text        NOT NULL DEFAULT '',
  canonical_url     text        NOT NULL DEFAULT '',
  status            text        NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'scheduled', 'posted', 'failed')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- One draft per (org, content, platform) — the upsert conflict target.
CREATE UNIQUE INDEX IF NOT EXISTS uq_promotion_drafts_owner_content_platform
  ON promotion_drafts (organization_id, content_type, content_id, platform);

-- Load-by-content lookup (the workspace fetches all platforms for a piece).
CREATE INDEX IF NOT EXISTS idx_promotion_drafts_content
  ON promotion_drafts (organization_id, content_type, content_id);

-- RLS on, no public policies → service-role API only. The API enforces org
-- access and filters by organization_id on every read/write/delete.
ALTER TABLE promotion_drafts ENABLE ROW LEVEL SECURITY;
