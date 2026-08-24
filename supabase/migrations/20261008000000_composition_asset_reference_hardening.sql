-- Phase 2A — foundation reconciliation for the canonical asset relationship.
--
-- WHY THIS EXISTS
-- ---------------
-- 20261006000000 established WHAT a file is (canonical_media_assets) and
-- 20261007000000 established HOW it is used (composition_asset_references).
-- The Phase 2 wiring audit found two things that must be settled BEFORE the
-- first production write, because both are far cheaper now than later:
--
--   1. The reference row has no escape hatch. Every future per-use attribute
--      (focal point, crop, opacity, provider hints) would otherwise need its
--      own migration. One `metadata jsonb` removes that whole class of churn.
--
--   2. The purpose vocabulary is missing exactly one value the product
--      requirement names: `supporting`. The other seven required roles
--      (subject, product, background, logo, overlay, composition_reference,
--      style_reference) are already present, so this is a one-value gap.
--
-- `transform` is deliberately NOT added. The current contract has no transform
-- concept anywhere — no type, no consumer, no renderer input — so a column for
-- it would be speculative. When a real crop/scale/focal-point requirement
-- lands it can live in `metadata` first and be promoted to its own column once
-- its shape is known from use rather than guessed.
--
-- ADDITIVE AND NON-DESTRUCTIVE. No column is dropped, no type changed, no data
-- rewritten. Both tables are empty everywhere (verified: neither is applied to
-- production as of this migration), so there is nothing to back-fill.
--
-- IDEMPOTENT AND ORDER-TOLERANT. Every statement is guarded on the table
-- existing. The repository's migration ledger is desynced from production
-- (migrations are applied by hand via the SQL editor), so this must be safe to
-- run against a database where 20261007000000 has not yet been applied: in that
-- case every block is skipped and the base migration carries the final shape.

-- ── 1. metadata escape hatch ────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'composition_asset_references'
  ) THEN
    ALTER TABLE public.composition_asset_references
      ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
  END IF;
END $$;

-- ── 2. `supporting` joins the purpose vocabulary ────────────────────────────
-- The CHECK in 20261007000000 is inline and therefore auto-named. Rather than
-- assume that name, drop whichever CHECK on this table governs `purpose` and
-- re-create it explicitly named, so every later migration can target it by name.
DO $$
DECLARE
  con_name text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'composition_asset_references'
  ) THEN
    RETURN;
  END IF;

  SELECT c.conname INTO con_name
  FROM pg_constraint c
  WHERE c.conrelid = 'public.composition_asset_references'::regclass
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%purpose%'
  LIMIT 1;

  IF con_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.composition_asset_references DROP CONSTRAINT %I', con_name);
  END IF;

  -- The canonical persisted vocabulary: the eight provider ReferenceImagePurpose
  -- values, plus the five roles a user chooses for their own upload. Mirrors
  -- COMPOSITION_ASSET_PURPOSES in lib/content/compositionAssetReference.ts,
  -- which a compile-time guard keeps in step with the provider union.
  ALTER TABLE public.composition_asset_references
    ADD CONSTRAINT composition_asset_references_purpose_check
    CHECK (purpose IN (
      'logo', 'favicon', 'dashboard', 'ui_surface',
      'product_screenshot', 'style_reference',
      'composition_reference', 'realism_reference',
      'subject', 'background', 'overlay', 'product', 'supporting'
    ));
END $$;

-- ── 3. Record the decisions on the objects themselves ───────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'composition_asset_references'
  ) THEN
    COMMENT ON COLUMN public.composition_asset_references.metadata IS
      'Per-USE attributes of this asset in this composition (focal point, crop, opacity, provider hints). Trace and presentation only. Never authorization, never identity, and never a second home for purpose/mode — those are columns precisely so they stay constrained.';

    COMMENT ON COLUMN public.composition_asset_references.purpose IS
      'One vocabulary: the eight provider ReferenceImagePurpose values plus the five user-chosen composition roles (subject, background, overlay, product, supporting). product (a photograph) is distinct from product_screenshot (UI).';
  END IF;

  -- The canonical asset->composition relationship is composition_asset_references.
  -- content_asset predates it and is NOT retired here: it is reachable through
  -- POST /api/content/:id/assets and gated by CANONICAL_PERSISTENCE_ENABLED, so
  -- it stays exactly as it is for backward compatibility. This comment records
  -- the boundary at the schema level, where a future reader will actually look.
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'content_asset'
  ) THEN
    COMMENT ON TABLE public.content_asset IS
      'LEGACY content->asset link (Phase A). Superseded for NEW writes by composition_asset_references, which carries a constrained purpose/mode vocabulary, an ordinal, and a composite (company_id, asset_id) foreign key that makes cross-tenant reference structurally impossible. Existing rows and readers remain supported; no new asset->composition write path should target this table.';
  END IF;
END $$;
