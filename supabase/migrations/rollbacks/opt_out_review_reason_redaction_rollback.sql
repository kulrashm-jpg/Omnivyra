-- ROLLBACK — Orchestration (G-11): "Wipe it", a decided review's reason redacted at erasure.
-- Reverses supabase/migrations/20270127000006_opt_out_review_reason_redaction.sql
--
-- NOT APPLIED ANYWHERE; test database only, like the forward migration.
--
-- WHAT IT GIVES UP. The guard returns to its 20270127000003 text (verbatim below): a decided review's
-- free-text reason is no longer redacted when its person is erased. Reasons already redacted stay
-- redacted (no data is restored). The tombstone rewrite is unchanged.
--
-- One transaction: a failure at any step leaves the forward state intact.

BEGIN;

-- The guard as 20270127000003 wrote it.
CREATE OR REPLACE FUNCTION public.contact_opt_out_reviews_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tomb     boolean := false;
  v_reanchor boolean := coalesce(current_setting('g11.reanchor', true), '') = 'on';
  v_move     boolean := false;
BEGIN
  IF OLD.anchor_kind = 'person' AND OLD.person_id IS NOT NULL AND NEW.person_id IS NULL
     AND NEW.anchor_kind = 'person' AND NEW.anchor_value IS NOT DISTINCT FROM OLD.anchor_value THEN
    -- Erasure: the FK's SET NULL. The review's own id, never the person's (20270127000001).
    NEW.anchor_value := 'erased:' || NEW.id::text;
    v_tomb := true;
  ELSIF v_reanchor AND OLD.state = 'pending' AND OLD.anchor_kind = 'person'
        AND NEW.anchor_kind = 'target' AND NEW.person_id IS NULL THEN
    -- Re-anchor (g11_reanchor_pending_opt_out_reviews only): person → canonical target.
    v_move := true;
  ELSIF NEW.person_id IS DISTINCT FROM OLD.person_id THEN
    RAISE EXCEPTION 'contact_opt_out_reviews: review % keeps its person; only erasure clears it', OLD.id
      USING ERRCODE = '23514';
  ELSIF NEW.anchor_value IS DISTINCT FROM OLD.anchor_value THEN
    RAISE EXCEPTION 'contact_opt_out_reviews: review % keeps its tenant, anchor and opening', OLD.id
      USING ERRCODE = '23514';
  END IF;
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.opened_at IS DISTINCT FROM OLD.opened_at
     OR (NOT v_move AND (NEW.anchor_kind IS DISTINCT FROM OLD.anchor_kind
                         OR NEW.anchor_channel IS DISTINCT FROM OLD.anchor_channel)) THEN
    RAISE EXCEPTION 'contact_opt_out_reviews: review % keeps its tenant, anchor and opening', OLD.id
      USING ERRCODE = '23514';
  END IF;
  -- merged is terminal: the only change it accepts is the erasure tombstone.
  IF OLD.state = 'merged' AND NOT v_tomb THEN
    RAISE EXCEPTION 'contact_opt_out_reviews: review % was merged into %; it is terminal', OLD.id, OLD.merged_into
      USING ERRCODE = '23514';
  END IF;
  IF NEW.state = 'merged' AND OLD.state <> 'merged' AND NOT (v_reanchor AND OLD.state = 'pending') THEN
    RAISE EXCEPTION 'contact_opt_out_reviews: review % may become merged only through the re-anchor function', OLD.id
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

COMMIT;
