-- ============================================================
-- Durable media reference layer (Round-4 item 3) — ADDITIVE ONLY
-- ------------------------------------------------------------
-- Problem (audit Round-1): scheduled_posts.media_urls holds Supabase
-- public / 7-day SIGNED URLs. A post scheduled far in the future can
-- publish with an already-expired signed URL → publish failure / silent
-- media loss.
--
-- Fix: persist a DURABLE storage reference (bucket + object path) so the
-- publisher can mint a FRESH signed URL at publish time. `media_urls`
-- stays untouched (backward compatible) — it remains the fallback when
-- no durable ref is present.
--
-- Non-destructive: single nullable JSONB column, IF NOT EXISTS, no
-- backfill, no data rewrite, no constraint. Safe to apply anytime; the
-- runtime is feature-flagged (DURABLE_MEDIA_REFS) and falls back to
-- media_urls when the column is absent or empty.
--
-- Shape: media_storage_refs = [{ "bucket": "media-uploads",
--                                "path": "company/abc/asset.png",
--                                "url": "<last-known-url>" }, ...]
-- ============================================================

ALTER TABLE scheduled_posts
  ADD COLUMN IF NOT EXISTS media_storage_refs JSONB;
