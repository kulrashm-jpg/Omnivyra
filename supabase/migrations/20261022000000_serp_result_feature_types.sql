-- DG-001 — widen `analytics_serp_results` to hold the SERP features the
-- acquisition layer can now observe.
--
-- ⚠ WRITTEN AND DELIBERATELY NOT APPLIED. DG-001's scope is the acquisition
-- primitive. This file records the EXACT change persistence would need, so the
-- decision to apply it is a separate, deliberate act with the withheld-count
-- evidence in hand (see `ingestSerpSnapshot`'s `withheld_unpersistable`).
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
--   UNIQUE (snapshot_id, position, domain, url)
--
-- Three of those block the new evidence, and none can be worked around in code
-- without storing something untrue:
--
--   1. the CHECK rejects every new type — an INSERT raises 23514;
--   2. `url`/`domain` NOT NULL rejects a People Also Ask entry or a knowledge
--      panel, which legitimately link nowhere;
--   3. `position` NOT NULL would force a rank onto a block that has none, and
--      the UNIQUE key uses position + url, so unranked rows would collide.
--
-- Relabelling a People Also Ask entry as 'other' so it fits would satisfy the
-- constraint and put a wrong value in an evidence table. The acquisition layer
-- therefore WITHHOLDS what it cannot persist and counts it, rather than
-- degrading it.
--
-- ─── WHAT THIS WOULD DO ────────────────────────────────────────────────────
-- Widen the vocabulary, relax the two NOT NULLs that features legitimately lack,
-- and rebuild the uniqueness key so unranked, unlinked observations are still
-- distinct. Additive: every existing row remains valid, and every existing
-- query keeps working because the old four values are still in the CHECK.
--
-- ─── ROLLBACK ──────────────────────────────────────────────────────────────
-- Restore the original CHECK and the original UNIQUE index, then re-apply the
-- NOT NULLs — which requires deleting rows whose type is one of the new ones.
-- That is why applying this is a deliberate act rather than a default.

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

-- 3. identity
-- The old UNIQUE (snapshot_id, position, domain, url) cannot separate two
-- unranked, unlinked features in one snapshot, and NULLs in a UNIQUE index are
-- distinct — so it would also stop de-duplicating them. Type and title join the
-- key, and NULLS NOT DISTINCT makes absence comparable rather than always-unique.
ALTER TABLE public.analytics_serp_results
  DROP CONSTRAINT IF EXISTS analytics_serp_results_unique;

CREATE UNIQUE INDEX IF NOT EXISTS analytics_serp_results_identity
  ON public.analytics_serp_results (snapshot_id, result_type, position, domain, url, title)
  NULLS NOT DISTINCT;

COMMENT ON CONSTRAINT analytics_serp_results_type_valid ON public.analytics_serp_results IS
  'DG-001: the canonical SERP result vocabulary. Mirrors SERP_RESULT_TYPES in '
  'backend/services/serp/serpResultTypes.ts — the two must be changed together.';
