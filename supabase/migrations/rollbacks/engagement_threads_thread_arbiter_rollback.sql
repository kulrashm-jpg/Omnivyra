-- ROLLBACK — W0.1: engagement_threads upsert arbiter reconciliation.
-- Reverses supabase/migrations/20260918000000_engagement_threads_thread_arbiter.sql
--
-- SAFETY
-- ------
-- This restores the PARTIAL unique index and drops the full one, returning the
-- table to its pre-W0.1 definition. Because the two definitions are equivalent
-- under NULLS DISTINCT (see the forward migration), no row can exist that the
-- partial index would reject — the rebuild cannot fail on existing data, and no
-- data is lost either way. Only the arbiter-inference property changes.
--
-- WHAT ROLLING BACK COSTS
-- -----------------------
-- It re-breaks WhatsApp inbound persistence: the processor's upsert returns to
-- failing 42P10 and no WhatsApp thread can be written. Roll back ONLY if the
-- replacement index itself caused a worse problem. There is no scenario where
-- rolling this back improves correctness — the partial index was never doing
-- anything the full one does not.
--
-- ORDERING
-- --------
-- Mirror of the forward migration: the partial index is created BEFORE the
-- full one is dropped, so uniqueness is never unenforced. One transaction.
--
-- NOTE: rollback files are deliberately non-idempotent and are exempt from the
-- migration quality gate (scripts/check-migration-quality.js).

DO $$
BEGIN
  -- Rebuild the original partial definition under a temporary name.
  CREATE UNIQUE INDEX idx_engagement_threads_platform_thread_org_partial
    ON public.engagement_threads (platform, platform_thread_id, organization_id)
    WHERE organization_id IS NOT NULL;

  -- Drop the full replacement.
  DROP INDEX IF EXISTS public.idx_engagement_threads_platform_thread_org;

  -- Restore the canonical name.
  ALTER INDEX public.idx_engagement_threads_platform_thread_org_partial
    RENAME TO idx_engagement_threads_platform_thread_org;
END $$;
