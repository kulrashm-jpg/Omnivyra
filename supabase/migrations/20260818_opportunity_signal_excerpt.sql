-- ============================================================
-- PR-OPA-1 — Opportunity signal_excerpt
-- ============================================================
-- Adds a nullable `signal_excerpt` text column to
-- opportunity_feed_items. Populated by recordOpportunityFromSignal
-- with the first 300 characters of the underlying lead-signal
-- content. Surfaced in the Active Leads "Opportunity Queue" UI as a
-- verbatim "What was said" block under the explanation so users can
-- understand why an opportunity exists without opening the source
-- platform.
--
-- Storage rule (enforced in application code):
--   - Truncated to <= 300 characters at write time, ellipsis-suffixed
--     when truncated.
--   - NULL preserved for legacy rows; readers must handle null.
--
-- SAFETY:
--   - Purely additive (ADD COLUMN IF NOT EXISTS, nullable).
--   - No backfill — existing rows stay null. New rows from the
--     pipeline populate the column going forward.
--   - No index needed (column is display-only, never queried/joined).
-- ============================================================

ALTER TABLE IF EXISTS opportunity_feed_items
  ADD COLUMN IF NOT EXISTS signal_excerpt TEXT NULL;

COMMENT ON COLUMN opportunity_feed_items.signal_excerpt IS
  'PR-OPA-1: verbatim excerpt of the source post/comment/discussion that triggered the opportunity. Max 300 chars, ellipsis-truncated. Nullable for legacy rows.';
