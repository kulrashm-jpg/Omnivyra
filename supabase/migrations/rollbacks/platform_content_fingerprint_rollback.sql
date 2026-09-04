-- ============================================================================
-- ROLLBACK — B5 platform_content_fingerprint
--   for supabase/migrations/20260919000000_platform_content_fingerprint.sql
-- ============================================================================
--
-- The forward migration is purely additive (ONE new table plus its own indexes,
-- trigger and RLS flag), so the rollback is a single DROP. Nothing else was
-- created or altered, and therefore nothing else is restored.
--
-- SAFE TO RUN because the table holds no tenant-owned data: every row is a
-- derived, non-reversible fingerprint with no company_id, campaign_id,
-- content_id, user_id or content text. Dropping it destroys no customer record
-- and breaks no foreign key pointing INTO it (nothing references this table).
-- The only consequence is that the platform tier loses its corpus — and the
-- tier is advisory and fail-open, so generation continues returning band
-- 'novel' exactly as it does when the store is unreachable.
--
-- The FK this table holds ON public.content_type is an outbound reference and
-- disappears with the table; content_type itself is untouched.
--
-- Indexes and the trigger are dropped implicitly with the table; they are named
-- here only so a reviewer can confirm the forward migration created no other
-- object:
--   platform_fp_dedup_uidx, platform_fp_simhash_idx, platform_fp_shape_idx,
--   platform_fp_embedding_idx, platform_fp_last_seen_idx,
--   platform_content_fingerprint_touch_updated_at
--
-- The `vector` extension is deliberately NOT dropped: content_memory.embedding
-- depends on it and predates this migration.
-- ============================================================================

BEGIN;

DROP TABLE IF EXISTS public.platform_content_fingerprint;

COMMIT;
