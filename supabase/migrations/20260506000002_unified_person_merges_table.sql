-- Identity spine enforcement — Phase 2B / file 2 of 6
-- FIX C: merge log structure for future runtime collisions.
-- When two unified_persons rows turn out to represent the same person
-- (e.g. cross-source ingestion writes the same identity under two keys),
-- the loser is merged into the winner and a row is appended here.
-- The loser_person_id is intentionally NOT a foreign key because the loser
-- record is deleted after the merge — the audit row outlives the row.

CREATE TABLE IF NOT EXISTS public.unified_person_merges (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  winner_person_id  UUID NOT NULL REFERENCES public.unified_persons(id) ON DELETE CASCADE,
  loser_person_id   UUID NOT NULL,
  reason            TEXT,
  merged_by         UUID REFERENCES public.users(id) ON DELETE SET NULL,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_unified_person_merges_winner
  ON public.unified_person_merges(winner_person_id);

CREATE INDEX IF NOT EXISTS idx_unified_person_merges_company_created
  ON public.unified_person_merges(company_id, created_at DESC);

COMMENT ON TABLE public.unified_person_merges IS
  'Audit log for identity merges. winner_person_id wins; loser_person_id was deleted. Used by identityResolutionService when collapsing duplicates introduced by multi-source ingestion.';

-- =====================================================================
-- merge_unified_persons procedure (canonical merge entry point)
-- Atomically re-points every unified_person_id FK from loser to winner,
-- inserts an audit row, then deletes the loser. Caller responsibility:
-- ensure winner_id and loser_id share the same company_id.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.merge_unified_persons(
  winner_id    UUID,
  loser_id     UUID,
  merge_reason TEXT,
  actor        TEXT
) RETURNS VOID AS $$
DECLARE
  winner_company_id UUID;
BEGIN
  IF winner_id = loser_id THEN
    RAISE EXCEPTION 'merge_unified_persons: winner and loser cannot be the same id';
  END IF;

  SELECT company_id INTO winner_company_id
  FROM public.unified_persons WHERE id = winner_id;

  IF winner_company_id IS NULL THEN
    RAISE EXCEPTION 'merge_unified_persons: winner % not found', winner_id;
  END IF;

  -- Re-point all FK columns from loser to winner
  UPDATE public.users
     SET unified_person_id = winner_id WHERE unified_person_id = loser_id;
  UPDATE public.leads
     SET unified_person_id = winner_id WHERE unified_person_id = loser_id;
  UPDATE public.canonical_users
     SET unified_person_id = winner_id WHERE unified_person_id = loser_id;
  UPDATE public.canonical_leads
     SET unified_person_id = winner_id WHERE unified_person_id = loser_id;
  UPDATE public.canonical_revenue_events
     SET unified_person_id = winner_id WHERE unified_person_id = loser_id;
  UPDATE public.contacts
     SET unified_person_id = winner_id WHERE unified_person_id = loser_id;
  UPDATE public.engagement_threads
     SET unified_person_id = winner_id WHERE unified_person_id = loser_id;

  -- Audit row (actor stored in metadata since merged_by is UUID and actor is TEXT)
  INSERT INTO public.unified_person_merges (
    company_id, winner_person_id, loser_person_id, reason, metadata
  ) VALUES (
    winner_company_id,
    winner_id,
    loser_id,
    merge_reason,
    jsonb_build_object('actor', actor)
  );

  -- Delete the loser unified_persons row
  DELETE FROM public.unified_persons WHERE id = loser_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.merge_unified_persons(UUID, UUID, TEXT, TEXT) IS
  'Atomic merge of two unified_persons rows. Re-points FKs, writes audit, deletes loser.';
