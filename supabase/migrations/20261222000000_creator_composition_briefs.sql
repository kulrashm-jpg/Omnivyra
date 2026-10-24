-- ============================================================================
-- Creator composition brief — the writer content a Creator draft is built FROM
--
-- Owner decision (2026-10-24): the writer content drives every template field,
-- overlay line, carousel slide and infographic section, and its MAIN MESSAGE is
-- the key. Until now that content lived only in the browser tab:
--   * the Unified Workspace brief in sessionStorage['marketing-brief'];
--   * a Writer launch in the CreatorAttachmentSession (also sessionStorage).
-- A reload kept it, but a new tab, a second device or an expired session lost
-- it, and the editor silently fell back to generic copy.
--
-- This table holds ONE resolved brief per Creator draft, keyed the same way
-- composition_asset_references keys its owner — (composition_type,
-- composition_id) — because there is still no canonical composition table.
-- composition_asset_references cannot hold it (every row must name a canonical
-- asset through a composite FK); no other existing table is tenant-scoped,
-- keyed by composition and carries free-form jsonb.
--
-- TENANCY: company_id is the anchor; the API proves membership with
-- enforceCompanyAccess before any read or write, every query filters on
-- company_id, and RLS repeats the same membership predicate the composition
-- tables use. The uniqueness key includes company_id, so two tenants that
-- happened to mint the same draft id can never read or overwrite each other.
--
-- ADDITIVE AND INERT until the API writes it. Nothing else reads it.
--
-- APPLY via the controlled process (Supabase SQL editor / single targeted
-- migration) — NOT `supabase db push` (prod ledger is hand-managed).
-- Rollback: supabase/migrations/rollbacks/creator_composition_briefs_rollback.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.creator_composition_briefs (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid        NOT NULL,
  composition_type  text        NOT NULL,
  composition_id    text        NOT NULL CHECK (char_length(composition_id) BETWEEN 1 AND 160),
  -- The sanitised CreatorBrief: { mainMessage, body, audience, tone, cta,
  -- offer, objective, source }. Shape-validated by the API (sanitizeCreatorBrief).
  brief             jsonb       NOT NULL,
  source            text        NOT NULL CHECK (source IN ('writer', 'workspace')),
  updated_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT creator_composition_briefs_unique
    UNIQUE (company_id, composition_type, composition_id)
);

ALTER TABLE public.creator_composition_briefs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'creator_composition_briefs'
      AND policyname = 'creator_composition_briefs_company_members'
  ) THEN
    CREATE POLICY creator_composition_briefs_company_members
      ON public.creator_composition_briefs
      USING (
        EXISTS (
          SELECT 1 FROM public.user_company_roles ucr
          WHERE ucr.company_id = creator_composition_briefs.company_id
            AND ucr.user_id = auth.uid()
            AND ucr.status = 'active'
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.user_company_roles ucr
          WHERE ucr.company_id = creator_composition_briefs.company_id
            AND ucr.user_id = auth.uid()
            AND ucr.status = 'active'
        )
      );
  END IF;
END $$;

COMMENT ON TABLE public.creator_composition_briefs IS
  'One resolved writer-content brief (main message, body, audience, tone, CTA, offer, objective) per Creator draft, keyed by (company_id, composition_type, composition_id). Lets a reload / new tab refill the template from the same content.';
