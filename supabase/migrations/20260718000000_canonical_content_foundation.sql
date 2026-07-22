-- 2026-07-18 — WRITER-EXEC-002 Wave 1: Canonical Content Foundation.
--
-- ONE canonical persisted Content entity for Writer Content, so every downstream
-- consumer has a single source of truth (draft → approved → edited → variants →
-- asset refs → publishing state). Scope (Wave 1, per WRITER-EXEC-002 decisions):
--   * NEW SPINE for Posts + Threads (which had NO server persistence before).
--   * Blogs/Articles/Stories keep their existing tables and are exposed through
--     the canonical read/lifecycle via a service-layer ADAPTER (source_ref
--     points back at the owning row). No backfill / no data migration this wave.
--   * Existing status models are MAPPED onto the canonical lifecycle in code;
--     their tables are left intact. Only the inert client FSM is retired.
--
-- Additive + backward compatible: four NEW tables, ZERO changes to existing
-- tables. Denormalized company_id on child tables so RLS is a simple per-row
-- company check. Idempotent (safe to re-run). creator_assets is referenced by
-- SOFT id (no hard FK) to avoid coupling the asset library to this spine.
--
-- APPLY: cert/beta env via BETA_DB_URL (scripts/beta). Production apply is
-- authored here but must be run via the controlled pooler-DDL process (the
-- migration ledger is desynced; do NOT db:push). This file is the record.

-- ── content — the canonical Content object ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.content (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL,
  content_type     text NOT NULL CHECK (content_type IN ('post','thread','blog','article','story')),
  lifecycle_status text NOT NULL DEFAULT 'draft'
                     CHECK (lifecycle_status IN ('draft','generated','edited','approved','adapted','scheduled','published','archived')),
  title            text,
  body             text,
  topic            text,
  objective        text,
  audience         text,
  tone             text,
  brief            jsonb,               -- canonical brief / context snapshot at generation time
  source_metadata  jsonb,               -- generation trace, master_content, decision_trace, etc.
  source_ref       jsonb,               -- adapter link for blog/article/story: {"table": "...", "id": "..."}
  current_revision integer NOT NULL DEFAULT 1,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  archived_at      timestamptz
);

CREATE INDEX IF NOT EXISTS content_company_updated_idx
  ON public.content (company_id, updated_at DESC)
  WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS content_company_type_status_idx
  ON public.content (company_id, content_type, lifecycle_status);
-- One canonical row per adapter-backed source row (blog/article/story), so the
-- adapter upserts idempotently instead of creating duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS content_source_ref_uidx
  ON public.content ((source_ref->>'table'), (source_ref->>'id'))
  WHERE source_ref IS NOT NULL;

-- ── content_variant — platform variants as CHILD records ────────────────────
-- A variant NEVER overwrites the parent. It records how the parent was adapted
-- for one platform, keeps the user's edits separate, and tracks its own approval.
CREATE TABLE IF NOT EXISTS public.content_variant (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id          uuid NOT NULL REFERENCES public.content(id) ON DELETE CASCADE,
  company_id          uuid NOT NULL,               -- denormalized for RLS
  platform            text NOT NULL,
  source_version      integer NOT NULL DEFAULT 1,  -- parent revision this variant derived from
  generated_content   text,                        -- AI-adapted copy
  edited_content      text,                        -- user edits (kept separate from generated)
  adaptation_metadata jsonb,
  approval_state      text NOT NULL DEFAULT 'draft'
                        CHECK (approval_state IN ('draft','approved','rejected')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
-- One current variant per (content, platform); re-adapting updates in place.
CREATE UNIQUE INDEX IF NOT EXISTS content_variant_content_platform_uidx
  ON public.content_variant (content_id, platform);
CREATE INDEX IF NOT EXISTS content_variant_company_idx
  ON public.content_variant (company_id);

-- ── content_asset — asset association (assets stay in creator_assets) ────────
-- Association-only join with version history; the asset bytes/library remain in
-- creator_assets. asset_id is a SOFT ref (no hard FK).
CREATE TABLE IF NOT EXISTS public.content_asset (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id  uuid NOT NULL REFERENCES public.content(id) ON DELETE CASCADE,
  variant_id  uuid REFERENCES public.content_variant(id) ON DELETE SET NULL,
  company_id  uuid NOT NULL,               -- denormalized for RLS
  asset_id    uuid NOT NULL,               -- soft ref → creator_assets.id
  role        text NOT NULL DEFAULT 'primary',
  version     integer NOT NULL DEFAULT 1,
  metadata    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS content_asset_content_idx ON public.content_asset (content_id);
CREATE INDEX IF NOT EXISTS content_asset_company_idx ON public.content_asset (company_id);
CREATE UNIQUE INDEX IF NOT EXISTS content_asset_unique_link_uidx
  ON public.content_asset (content_id, asset_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid), version);

-- ── content_revision — autosave / undo / draft recovery snapshots ───────────
CREATE TABLE IF NOT EXISTS public.content_revision (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id    uuid NOT NULL REFERENCES public.content(id) ON DELETE CASCADE,
  company_id    uuid NOT NULL,             -- denormalized for RLS
  revision      integer NOT NULL,          -- monotonic per content
  revision_type text NOT NULL CHECK (revision_type IN ('generated','autosave','manual','pre_adapt','pre_publish')),
  snapshot      jsonb NOT NULL,            -- {title, body, topic, objective, audience, tone, ...}
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS content_revision_content_rev_uidx
  ON public.content_revision (content_id, revision);
CREATE INDEX IF NOT EXISTS content_revision_content_recent_idx
  ON public.content_revision (content_id, revision DESC);

-- ── updated_at trigger (shared) ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_content_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS content_set_updated_at ON public.content;
CREATE TRIGGER content_set_updated_at BEFORE UPDATE ON public.content
  FOR EACH ROW EXECUTE FUNCTION public.set_content_updated_at();
DROP TRIGGER IF EXISTS content_variant_set_updated_at ON public.content_variant;
CREATE TRIGGER content_variant_set_updated_at BEFORE UPDATE ON public.content_variant
  FOR EACH ROW EXECUTE FUNCTION public.set_content_updated_at();

-- ── RLS — company-scoped, mirrors the existing per-company pattern ──────────
ALTER TABLE public.content          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_variant  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_asset    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_revision ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS; these policies scope authenticated per-company
-- access via user_company_roles (prod membership table; active members only). Guarded so a
-- re-run does not error on existing policies.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='content' AND policyname='content_company_rw') THEN
    CREATE POLICY content_company_rw ON public.content
      USING (company_id IN (SELECT company_id FROM public.user_company_roles WHERE user_id = auth.uid() AND status = 'active'))
      WITH CHECK (company_id IN (SELECT company_id FROM public.user_company_roles WHERE user_id = auth.uid() AND status = 'active'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='content_variant' AND policyname='content_variant_company_rw') THEN
    CREATE POLICY content_variant_company_rw ON public.content_variant
      USING (company_id IN (SELECT company_id FROM public.user_company_roles WHERE user_id = auth.uid() AND status = 'active'))
      WITH CHECK (company_id IN (SELECT company_id FROM public.user_company_roles WHERE user_id = auth.uid() AND status = 'active'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='content_asset' AND policyname='content_asset_company_rw') THEN
    CREATE POLICY content_asset_company_rw ON public.content_asset
      USING (company_id IN (SELECT company_id FROM public.user_company_roles WHERE user_id = auth.uid() AND status = 'active'))
      WITH CHECK (company_id IN (SELECT company_id FROM public.user_company_roles WHERE user_id = auth.uid() AND status = 'active'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='content_revision' AND policyname='content_revision_company_rw') THEN
    CREATE POLICY content_revision_company_rw ON public.content_revision
      USING (company_id IN (SELECT company_id FROM public.user_company_roles WHERE user_id = auth.uid() AND status = 'active'))
      WITH CHECK (company_id IN (SELECT company_id FROM public.user_company_roles WHERE user_id = auth.uid() AND status = 'active'));
  END IF;
END $$;
