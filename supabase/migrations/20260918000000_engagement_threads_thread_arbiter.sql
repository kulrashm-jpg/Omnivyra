-- W0.1 — engagement_threads upsert arbiter reconciliation.
--
-- Makes the EXISTING WhatsApp inbound thread upsert able to infer its own
-- uniqueness index. No application code changes; no new uniqueness semantics.
--
-- ─── THE DEFECT ────────────────────────────────────────────────────────────
-- backend/queue/jobProcessors/whatsappWebhookProcessor.ts:112 upserts with
--     onConflict: 'platform,platform_thread_id,organization_id'
-- PostgREST renders that as a column-only inference clause:
--     ON CONFLICT (platform, platform_thread_id, organization_id)
-- The only unique index over those columns is PARTIAL:
--     ... WHERE (organization_id IS NOT NULL)
-- PostgreSQL will not use a partial index as an ON CONFLICT arbiter unless the
-- inference clause repeats the index predicate. PostgREST's `on_conflict`
-- accepts column names only and cannot emit a predicate, so the statement fails
-- 42P10 — "no unique or exclusion constraint matching the ON CONFLICT
-- specification" — and no WhatsApp thread can ever persist.
--
-- ─── WHY THE INDEX MOVES AND THE CODE DOES NOT ─────────────────────────────
-- The alternative was to change the persistence mechanism. Every variant is
-- worse:
--   • SELECT-then-INSERT is not atomic. Two concurrent webhooks for the same
--     conversation would both observe "no row" and both insert, producing the
--     duplicate threads the upsert exists to prevent. That trades a loud
--     failure for a silent one.
--   • A dedicated Postgres function could carry the predicate, but needs BOTH
--     a schema change and an application change, and introduces a second
--     persistence mechanism outside the ownedDbTable/PostgREST convention.
-- Moving the index is strictly smaller, and it makes the upsert atomic rather
-- than merely functional.
--
-- ─── WHY THE REPLACEMENT IS EQUIVALENT, NOT A LOOSENING ────────────────────
-- Dropping `WHERE organization_id IS NOT NULL` looks like it widens the
-- constraint to rows the partial index deliberately exempted. It does not.
-- PostgreSQL indexes are NULLS DISTINCT by default (confirmed on this server,
-- PG 17.6): two rows whose organization_id is NULL are never equal, so they
-- cannot conflict with each other under a full index either. Rows with a NULL
-- tenant remain exempt from uniqueness under both definitions — verified
-- empirically against this database before authoring:
--     full index admits two NULL-org rows sharing platform+platform_thread_id
--     full index rejects a same-tenant duplicate                       (23505)
--     full index admits the same platform_thread_id in a second tenant
--     column-only ON CONFLICT successfully infers the full index
--     the partial index reproduces 42P10 under the same statement
--
-- That NULL exemption is load-bearing, not incidental:
-- backend/services/engagementNormalizationService.ts:140-171 resolves threads
-- with `.is('organization_id', null)` and inserts `organization_id: orgId`
-- where orgId may be null. This migration leaves that path untouched, which is
-- why organization_id is NOT made NOT NULL here — that would be a separate
-- architectural decision, not a side effect of fixing an arbiter.
--
-- ─── TENANT SCOPE IS PRESERVED ─────────────────────────────────────────────
-- organization_id remains part of the key. The same external
-- platform_thread_id may still exist independently in different tenants; only
-- a repeat within ONE tenant conflicts. No platform-global uniqueness is
-- introduced, and none may be — see the Phase 0.5 ADR §3.3.
--
-- ─── ORDERING ──────────────────────────────────────────────────────────────
-- The replacement is created BEFORE the original is dropped, so uniqueness is
-- never unenforced for even one statement. The whole block is one transaction;
-- a failure at any step leaves the original index in place.
--
-- Scope: one index replaced. No column added, altered or dropped; no other
-- table, index or constraint touched; no row written. Idempotent — a second
-- run detects the reconciled state and returns.
--
-- Rollback: supabase/migrations/rollbacks/engagement_threads_thread_arbiter_rollback.sql

DO $$
BEGIN
  -- Already reconciled? Canonical name present, unique, and non-partial.
  IF EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'idx_engagement_threads_platform_thread_org'
      AND i.indisunique
      AND i.indpred IS NULL
  ) THEN
    RAISE NOTICE 'w0_1: arbiter already reconciled; nothing to do';
    RETURN;
  END IF;

  -- 1. Build the replacement alongside the original.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_engagement_threads_platform_thread_org_v2
    ON public.engagement_threads (platform, platform_thread_id, organization_id);

  -- 2. Retire the partial original, now that an equivalent is enforcing.
  DROP INDEX IF EXISTS public.idx_engagement_threads_platform_thread_org;

  -- 3. Adopt the canonical name, so callers and docs keep referring to one name.
  ALTER INDEX public.idx_engagement_threads_platform_thread_org_v2
    RENAME TO idx_engagement_threads_platform_thread_org;
END $$;

COMMENT ON INDEX public.idx_engagement_threads_platform_thread_org IS
  'Tenant-scoped thread identity: one thread per (platform, platform_thread_id, organization_id). Deliberately NOT partial — a column-only ON CONFLICT (as PostgREST emits) cannot infer a partial index (42P10). NULL-tenant rows stay exempt via NULLS DISTINCT, matching the previous partial definition.';
