-- DG-001 — widen `analytics_serp_results` to hold the SERP features the
-- acquisition layer can now observe. EXPAND-ONLY.
--
-- ⚠ WRITTEN AND DELIBERATELY NOT APPLIED. DG-001's scope is the acquisition
-- primitive. This file records the EXACT change persistence would need, so the
-- decision to apply it is a separate, deliberate act with the withheld-count
-- evidence in hand (see `ingestSerpSnapshot`'s `withheld_unpersistable`).
-- Nothing in the application requires it: the writer persists only rows the
-- pre-existing schema accepts, and withholds (and counts) the rest.
--
-- ─── WHY A MIGRATION IS GENUINELY REQUIRED ─────────────────────────────────
-- Migration 20260660 created the table with:
--
--   result_type text NOT NULL DEFAULT 'organic'
--   CONSTRAINT analytics_serp_results_type_valid
--     CHECK (result_type IN ('organic','featured_snippet','paid','other'))
--   url    text NOT NULL
--   domain text NOT NULL
--   position integer NOT NULL CHECK (position > 0 AND position <= 100)
--   CONSTRAINT analytics_serp_results_unique UNIQUE (snapshot_id, position, domain, url)
--
-- Three of those block the new evidence, and none can be worked around in code
-- without storing something untrue:
--
--   1. the CHECK rejects every new type — an INSERT raises 23514;
--   2. `url`/`domain` NOT NULL rejects a People Also Ask entry or a knowledge
--      panel, which legitimately link nowhere;
--   3. `position` NOT NULL would force a rank onto a block that has none.
--
-- Relabelling a People Also Ask entry as 'other' so it fits would satisfy the
-- constraint and put a wrong value in an evidence table. The acquisition layer
-- therefore WITHHOLDS what it cannot persist and counts it, rather than
-- degrading it.
--
-- ─── WHY EXPAND-ONLY: THE WRITER'S CONFLICT TARGET ─────────────────────────
-- The first draft of this migration DROPPED `analytics_serp_results_unique` and
-- replaced it with a six-column identity index. That would have broken the only
-- writer of this table:
--
--   externalCompetitiveIntelligenceService.ingestSerpSnapshot
--     .upsert(rows, { onConflict: 'snapshot_id,position,domain,url' })
--
-- PostgreSQL infers an ON CONFLICT arbiter only from a unique index or
-- constraint whose key columns are EXACTLY the conflict target. With the
-- four-column constraint gone, no arbiter matches, and every SERP ingest raises
-- 42P10 — under the current code AND under any rolled-back code, since both use
-- the same writer. It is the defect class real-schema CI exists for (W0.1,
-- W0.2, W3 were all 42P10 in production).
--
-- So this migration ADDS and never REMOVES. `analytics_serp_results_unique` is
-- kept, untouched, as the writer's arbiter.
--
-- ─── WHAT THIS DOES ────────────────────────────────────────────────────────
-- Widens the vocabulary, relaxes the two NOT NULLs that features legitimately
-- lack, and ADDS an identity index alongside the existing constraint.
-- Every existing row remains valid, every existing query keeps working, and the
-- existing writer's conflict target keeps its arbiter.
--
-- The added index cannot be violated by anything the existing writer does. The
-- writer persists only rows with a non-null position, url and domain, and the new
-- key is a superset of the old one: two rows equal on all six columns are equal
-- on the original four, which the retained constraint already makes unique — so
-- any collision reaches the writer's arbiter first and resolves as an update.
-- Existing rows are unique on the four columns and therefore on the six, so the
-- index builds without failing.
--
-- ─── NULLS NOT DISTINCT ────────────────────────────────────────────────────
-- Applies to the added index, whose nullable key columns are position, domain,
-- url and title. By default NULLs are distinct in a unique index, so an unranked,
-- unlinked feature (a People Also Ask entry: position, domain and url all NULL)
-- would never collide with its own re-ingestion, and every re-read of a snapshot
-- would duplicate it. NULLS NOT DISTINCT makes absence comparable, which is the
-- whole reason this index exists. It is therefore required, not stylistic.
--
-- Requires PostgreSQL 15+. That is already an established prerequisite of this
-- platform, not a new one: the schema-only production snapshot
-- supabase/_schema/baseline.sql (pg_dump of database version 17.6) contains the
-- live index `uq_identity_claims_tenant_identity ... NULLS NOT DISTINCT`, which a
-- pre-15 server could not hold, and four earlier governed migrations use it.
--
-- ─── THE LATER CONTRACT STEP (NOT THIS FILE) ───────────────────────────────
-- Retiring `analytics_serp_results_unique` is a SEPARATE contract migration, and
-- is only safe AFTER the writer's conflict target has moved to the identity
-- columns and that code is the only code that can run. Until then the retained
-- constraint also treats two different result types sharing one
-- (position, domain, url) in a snapshot as the same row; that matters only once
-- features are persisted, and is exactly what the contract step resolves.
--
-- ─── ROLLBACK ──────────────────────────────────────────────────────────────
-- Code rollback needs no schema rollback: the writer's arbiter is unchanged.
-- Reverting the schema itself means dropping `analytics_serp_results_identity`,
-- restoring the original CHECKs, and re-applying the NOT NULLs — which requires
-- deleting any rows whose type is one of the new ones. That is why applying this
-- is a deliberate act rather than a default.

-- 1. the vocabulary
ALTER TABLE public.analytics_serp_results
  DROP CONSTRAINT IF EXISTS analytics_serp_results_type_valid;

ALTER TABLE public.analytics_serp_results
  ADD CONSTRAINT analytics_serp_results_type_valid
  CHECK (result_type IN (
    'organic', 'featured_snippet', 'paid', 'other',
    'people_also_ask', 'knowledge_panel', 'sitelink',
    'local', 'image', 'video', 'news', 'shopping'
  ));

-- 2. the fields a feature may legitimately lack
ALTER TABLE public.analytics_serp_results ALTER COLUMN url      DROP NOT NULL;
ALTER TABLE public.analytics_serp_results ALTER COLUMN domain   DROP NOT NULL;
ALTER TABLE public.analytics_serp_results ALTER COLUMN position DROP NOT NULL;

-- The rank bounds still apply WHEN a rank is present; NULL means "no meaningful
-- rank", which is different from "rank zero" and must not be stored as one.
ALTER TABLE public.analytics_serp_results
  DROP CONSTRAINT IF EXISTS analytics_serp_results_position_valid;

ALTER TABLE public.analytics_serp_results
  ADD CONSTRAINT analytics_serp_results_position_valid
  CHECK (position IS NULL OR (position > 0 AND position <= 100));

-- 3. identity — ADDED ALONGSIDE the existing constraint, which is NOT dropped.
-- `analytics_serp_results_unique` (snapshot_id, position, domain, url) remains
-- the arbiter for the writer's ON CONFLICT target. Do not drop it here.
CREATE UNIQUE INDEX IF NOT EXISTS analytics_serp_results_identity
  ON public.analytics_serp_results (snapshot_id, result_type, position, domain, url, title)
  NULLS NOT DISTINCT;

COMMENT ON CONSTRAINT analytics_serp_results_type_valid ON public.analytics_serp_results IS
  'DG-001: the canonical SERP result vocabulary. Mirrors SERP_RESULT_TYPES in '
  'backend/services/serp/serpResultTypes.ts — the two must be changed together.';
