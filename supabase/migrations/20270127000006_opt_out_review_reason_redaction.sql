-- Orchestration (G-11) — "Wipe it": a DECIDED opt-out review's free-text reason is wiped when its
-- person row is deleted.
--
-- WHY. Owner ruling (2026-11-07), "Wipe it": when a person is erased, the free-text `reason` on their
-- DECIDED opt-out reviews is replaced with '[redacted: subject erased]'. PI agreed the mechanism
-- and the policy row (PROSPECT-PROVENANCE-ERASURE-POLICY.md, MAPPED).
--
-- WHAT THE CODE DOES. On ANY transition where a person-anchored review's person_id goes NULL (any
-- unified_persons delete, including a merge), the review is tombstoned and a decided reason is
-- wiped. contact_opt_out_reviews_guard() already rewrites a person anchor to its
-- 'erased:<review id>' tombstone in the FK's SET NULL of person_id (20270127000001, restated by
-- 20270127000003). That same branch now also sets the reason to the placeholder when
-- OLD.state = 'decided'. It is atomic with the person delete and needs no erasure call site; it
-- does NOT know whether the delete is an erasure. Everything else in the guard is byte-identical
-- in behaviour to 20270127000003.
--   * A PENDING row's reason is NULL by CHECK (decision_complete), and a MERGED row was pending:
--     neither is touched.
--   * The decision_complete CHECK still holds: a decided row keeps a non-blank reason.
--   * decided_by, decided_at, decision and the channels survive for audit.
--   * LIMIT: a DECIDED TARGET-anchored review keeps its reason. Attribution of the prose to one
--     subject is not determinable on a shared target, and redacting it could erase an unrelated
--     subject's audit record.
--   * LIMIT, merge: merge_unified_persons (20260506000002) DELETEs the losing person row. If it is
--     ever called, the loser's person-anchored reviews are tombstoned (they do NOT follow the
--     survivor) and a decided reason is wiped, for a person who was never erased. Today it has no
--     caller and only service_role (and the owner) may execute it (20270111000003).
--   * PLANNED: gate the wipe on an erasure marker set inside PI's pi_person_erasure_finalize (the
--     transaction that deletes the person). Awaiting PI's owner; not done here. A marker set by the
--     re-anchor call cannot work: personErasure.ts runs the re-anchor and finalize as separate
--     transactions.
--   * Text outside the database (server logs, backups taken before the delete) is not touched and
--     keeps the old reason until its own retention expires. The wipe is IRREVERSIBLE: the rollback
--     restores the previous guard, not the text.
--
-- Forward only; rollback in rollbacks/opt_out_review_reason_redaction_rollback.sql.

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
    -- "Wipe it" (owner, 2026-11-07): a DECIDED review's free-text reason is redacted with the
    -- person, in this same SET NULL. Gated on OLD.state. This branch is keyed on the TRANSITION
    -- (OLD.person_id IS NOT NULL -> NEW.person_id IS NULL), so it fires once and cannot re-enter;
    -- a rewrite keyed on NEW.person_id IS NULL alone would re-fire on every later update of the
    -- row and overwrite later values.
    IF OLD.state = 'decided' THEN
      NEW.reason := '[redacted: subject erased]';
    END IF;
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

-- Postconditions.
DO $$
BEGIN
  -- A needle unique to THIS change (the 20270127000003 guard body does not contain it). It must stay
  -- literal inside the function body: pg_get_functiondef returns the body only, and a needle moved
  -- into a variable or helper silently tests nothing. Proven to raise against the 0003 body.
  IF position('NEW.reason := ''[redacted: subject erased]''' IN pg_get_functiondef('public.contact_opt_out_reviews_guard()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'G-11 postcondition: the guard does not redact a decided review''s reason at erasure';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.contact_opt_out_reviews'::regclass
                  AND tgname = 'trg_contact_opt_out_reviews_guard') THEN
    RAISE EXCEPTION 'G-11 postcondition: the review guard is missing';
  END IF;
END
$$;
