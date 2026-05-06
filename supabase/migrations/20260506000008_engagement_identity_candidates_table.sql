-- Phase 2B.5 — engagement identity candidates table.
-- Staging layer for deterministic identity signals derived from engagement
-- payloads (LinkedIn URN, profile URL, actor IDs). Required by the backfill
-- in 20260506000009_engagement_identity_backfill.sql.
--
-- Already applied to prod via mcp__supabase__apply_migration; this file exists
-- so a fresh environment can reach the same state via `supabase db push`.

CREATE TABLE IF NOT EXISTS engagement_identity_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL,
  external_id TEXT NOT NULL,
  identity_type TEXT NOT NULL,
  unified_person_id UUID NULL REFERENCES unified_persons(id) ON DELETE SET NULL,
  confidence NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(platform, external_id)
);
