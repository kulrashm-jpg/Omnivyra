-- ROLLBACK — Orchestration (G-11): re-anchor a PENDING person-anchored opt-out review at erasure.
-- Reverses supabase/migrations/20270127000003_opt_out_review_reanchor.sql
--
-- NOT APPLIED ANYWHERE; test database only, like the forward migration.
--
-- WHAT IT GIVES UP. The re-anchor function and its ledger go, the 'merged' state goes, and the
-- guard returns to its 20270127000001 text (verbatim below). A review already MERGED cannot be
-- expressed without that state, so this rollback REFUSES while any merged row exists: resolve
-- them first (their holds are in the review they were merged into). Re-anchored rows are ordinary
-- target-anchored reviews and stay. Roll the application back first. PI's erasure must stop
-- calling the function before this runs.
--
-- One transaction: a failure at any step leaves the forward state intact.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.contact_opt_out_reviews WHERE state = 'merged') THEN
    RAISE EXCEPTION 'G-11 rollback: merged reviews exist; the merged state cannot be removed under them';
  END IF;
END
$$;

DROP FUNCTION IF EXISTS public.g11_reanchor_pending_opt_out_reviews(uuid, uuid, jsonb);
DROP TABLE IF EXISTS public.contact_opt_out_review_reanchors;

ALTER TABLE public.contact_opt_out_reviews DROP CONSTRAINT IF EXISTS contact_opt_out_reviews_decision_complete;
ALTER TABLE public.contact_opt_out_reviews ADD CONSTRAINT contact_opt_out_reviews_decision_complete
  CHECK ((state = 'pending' AND decision IS NULL AND decided_by IS NULL AND decided_at IS NULL AND reason IS NULL
          AND cardinality(reopened_channels) = 0 AND cardinality(closed_channels) = 0)
      OR (state = 'decided' AND decision IS NOT NULL AND decided_by IS NOT NULL AND decided_at IS NOT NULL
          AND reason IS NOT NULL AND length(btrim(reason)) > 0));
ALTER TABLE public.contact_opt_out_reviews DROP CONSTRAINT IF EXISTS contact_opt_out_reviews_state_valid;
ALTER TABLE public.contact_opt_out_reviews ADD CONSTRAINT contact_opt_out_reviews_state_valid
  CHECK (state IN ('pending', 'decided'));
ALTER TABLE public.contact_opt_out_reviews DROP CONSTRAINT IF EXISTS contact_opt_out_reviews_merged_into_fk;
ALTER TABLE public.contact_opt_out_reviews DROP CONSTRAINT IF EXISTS contact_opt_out_reviews_id_org_unique;
ALTER TABLE public.contact_opt_out_reviews DROP COLUMN IF EXISTS merged_at;
ALTER TABLE public.contact_opt_out_reviews DROP COLUMN IF EXISTS merged_into;

-- The guard as 20270127000001 wrote it.
CREATE OR REPLACE FUNCTION public.contact_opt_out_reviews_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.anchor_kind = 'person' AND OLD.person_id IS NOT NULL AND NEW.person_id IS NULL
     AND NEW.anchor_value IS NOT DISTINCT FROM OLD.anchor_value THEN
    NEW.anchor_value := 'erased:' || NEW.id::text;
  ELSIF NEW.person_id IS DISTINCT FROM OLD.person_id THEN
    RAISE EXCEPTION 'contact_opt_out_reviews: review % keeps its person; only erasure clears it', OLD.id
      USING ERRCODE = '23514';
  ELSIF NEW.anchor_value IS DISTINCT FROM OLD.anchor_value THEN
    RAISE EXCEPTION 'contact_opt_out_reviews: review % keeps its tenant, anchor and opening', OLD.id
      USING ERRCODE = '23514';
  END IF;
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.anchor_kind IS DISTINCT FROM OLD.anchor_kind
     OR NEW.anchor_channel IS DISTINCT FROM OLD.anchor_channel
     OR NEW.opened_at IS DISTINCT FROM OLD.opened_at THEN
    RAISE EXCEPTION 'contact_opt_out_reviews: review % keeps its tenant, anchor and opening', OLD.id
      USING ERRCODE = '23514';
  END IF;
  IF OLD.state = 'decided' AND NEW.state <> 'decided' THEN
    RAISE EXCEPTION 'contact_opt_out_reviews: review % is decided; a new trigger opens a new review', OLD.id
      USING ERRCODE = '23514';
  END IF;
  -- An adopted, pre-existing, trigger or locked entry is never dropped.
  IF NOT (OLD.adopted_hold_ids <@ NEW.adopted_hold_ids
      AND OLD.pre_existing_hold_ids <@ NEW.pre_existing_hold_ids
      AND OLD.trigger_record_ids <@ NEW.trigger_record_ids
      AND OLD.locked_channels <@ NEW.locked_channels
      AND OLD.triggers <@ NEW.triggers
      AND OLD.source_refs <@ NEW.source_refs) THEN
    RAISE EXCEPTION 'contact_opt_out_reviews: review % only ever gains holds, triggers and locks', OLD.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.contact_opt_out_reviews_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contact_opt_out_reviews_guard() FROM anon;
REVOKE ALL ON FUNCTION public.contact_opt_out_reviews_guard() FROM authenticated;

DO $$
BEGIN
  IF to_regprocedure('public.g11_reanchor_pending_opt_out_reviews(uuid, uuid, jsonb)') IS NOT NULL
     OR to_regclass('public.contact_opt_out_review_reanchors') IS NOT NULL THEN
    RAISE EXCEPTION 'G-11 rollback postcondition: the re-anchor function or its ledger still exists';
  END IF;
END
$$;

COMMIT;
