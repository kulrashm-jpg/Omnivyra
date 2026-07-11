-- 2026-07-11 — Strategic Mix P2: evolve creator_assets into the canonical
-- server-backed Asset Library (SPEC-001 §1 Asset entity; AUDIT-004 §13).
--
-- ONE model, evolved (no second asset table):
--   library       — the versioned asset envelope (the exact client
--                   CreatorAsset shape: versions[], currentVersion,
--                   selectedVariant, discovery metadata). The client library
--                   logic (register/version/duplicate/restore) is pure over a
--                   storage backend; this column makes the SERVER that
--                   backend. Flat columns stay in sync with the current
--                   version so every existing reader is unchanged.
--   archived_at   — archive (hidden from default library views, restorable).
--   deleted_at    — soft delete (hidden everywhere; hard cleanup is manual).
--   usage_count / last_used_at — usage tracking (incremented on attach-usage).
--
-- Idempotent. NOTE: applied to production via
-- scripts/ops/creator-assets-library-ddl-20260711.js (pooler DDL — the
-- migration ledger is desynced; do NOT db:push). This file is the record.

ALTER TABLE public.creator_assets ADD COLUMN IF NOT EXISTS library jsonb;
ALTER TABLE public.creator_assets ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.creator_assets ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.creator_assets ADD COLUMN IF NOT EXISTS usage_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.creator_assets ADD COLUMN IF NOT EXISTS last_used_at timestamptz;

CREATE INDEX IF NOT EXISTS creator_assets_library_list_idx
  ON public.creator_assets (company_id, updated_at DESC)
  WHERE deleted_at IS NULL;
