-- Orchestration (G-11) — the re-anchor consolidates ONLY the SAME governance case.
--
-- WHY. 20270127000003's g11_reanchor_pending_opt_out_reviews joined a person review into ANY
-- pending review on the same address. Persons A and B sharing info@acme.com were therefore merged
-- at erasure. Owner conditions (verbatim):
--   "Matching an email or phone number alone must not merge distinct people's reviews."
--   "Only genuinely duplicate reviews belonging to the same governance case may be consolidated."
--   "Two people erased in the same tenant must retain distinct review/tombstone identities and
--    audit histories."
--   "Preserve the regression test covering two people erased in one tenant, both reviews
--    surviving with distinct tombstones."
--
-- THE SAME-CASE RULE. The person review R of person P is consolidated into the pending target
-- review T ONLY IF:
--   (a) T and R share a source_ref (the same trigger event: a run+reply key, a Meta message id,
--       'attempt:<id>' — each stable per trigger), OR
--   (b) T and R both reference (as adopted, pre-existing or trigger) a governance row whose
--       contact_governance_records.person_id = P, checked here, BEFORE the person delete.
-- A shared row with person_id NULL (target-only) NEVER counts: writeOptOutHolds writes the
-- address and number holds target-only and the governance key excludes source, so A's and B's
-- holds on one address are ONE row (A adopts it, B lists it pre-existing); an unsubscribe's
-- permanent 'email' record is target-keyed the same way.
--
-- THE SAME PERSON, A DIFFERENT TRIGGER (ruling (i), 2026-11-07). A pending TARGET review on the
-- person's address opened by a DIFFERENT trigger, sharing no source_ref and no person-keyed
-- governance row, is a DIFFERENT governance case: kept_distinct (or the next free target) is
-- correct. This is the documented "two reviews per human" limit. Two pending PERSON-anchored
-- reviews for one person cannot coexist (the pending unique index allows one per person).
--
-- OTHERWISE NO MERGE. The next target in order (email, phone, whatsapp; within a channel the
-- first listed) is tried, and the review is re-anchored onto the first FREE one. If every target
-- is held by a DIFFERENT case, the review stays person-anchored and the FK tombstone gives it its
-- own 'erased:<review id>' at the person delete: disposition 'kept_distinct' (recorded in the
-- ledger, so the call stays idempotent). With no targets: 'no_target', as before.
--
-- DECIDABLE AFTER ERASURE. A kept-distinct review is still decided by an admin: decide collects
-- its anchors from its own adopted and pre-existing holds (a tombstoned review contributes no
-- person anchor), closes on them, and revokes only its own live adopted holds. No anchor is
-- invented. Everything else of 20270127000003 stands (raises, idempotency until the person
-- delete, no residual person key, merged terminal). Forward only; rollback in
-- rollbacks/opt_out_review_reanchor_same_case_rollback.sql.

ALTER TABLE public.contact_opt_out_review_reanchors DROP CONSTRAINT IF EXISTS contact_opt_out_review_reanchors_disposition_valid;
ALTER TABLE public.contact_opt_out_review_reanchors ADD CONSTRAINT contact_opt_out_review_reanchors_disposition_valid
  CHECK ((disposition = 're_anchored' AND onto_review_id IS NULL)
      OR (disposition = 'merged' AND onto_review_id IS NOT NULL)
      OR (disposition = 'kept_distinct' AND onto_review_id IS NULL));

CREATE OR REPLACE FUNCTION public.g11_reanchor_pending_opt_out_reviews(
  p_organization_id uuid,
  p_person_id uuid,
  p_targets jsonb
) RETURNS TABLE (review_id uuid, disposition text, onto_review_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_target   jsonb;
  v_channel  text;
  v_value    text;
  v_any      boolean := false;
  v_done     boolean;
  v_same     boolean;
  r          public.contact_opt_out_reviews%ROWTYPE;
  t          public.contact_opt_out_reviews%ROWTYPE;
BEGIN
  IF p_organization_id IS NULL OR p_person_id IS NULL THEN
    RAISE EXCEPTION 'g11_reanchor: organization and person are required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.unified_persons up WHERE up.id = p_person_id AND up.company_id = p_organization_id) THEN
    RAISE EXCEPTION 'g11_reanchor: person % is not in organization %', p_person_id, p_organization_id USING ERRCODE = '22023';
  END IF;
  IF p_targets IS NULL OR jsonb_typeof(p_targets) <> 'array' THEN
    RAISE EXCEPTION 'g11_reanchor: p_targets must be a JSON array' USING ERRCODE = '22023';
  END IF;
  FOR v_target IN SELECT value FROM jsonb_array_elements(p_targets) LOOP
    IF jsonb_typeof(v_target) <> 'object' OR jsonb_typeof(v_target->'channel') <> 'string' OR jsonb_typeof(v_target->'value') <> 'string'
       OR (v_target->>'channel') NOT IN ('email', 'phone', 'whatsapp')
       OR length(btrim(v_target->>'value')) = 0 OR (v_target->>'value') LIKE 'erased:%' THEN
      RAISE EXCEPTION 'g11_reanchor: each target is {"channel": "email"|"phone"|"whatsapp", "value": "<canonical>"}' USING ERRCODE = '22023';
    END IF;
    v_any := true;
  END LOOP;

  PERFORM set_config('g11.reanchor', 'on', true);

  -- IDEMPOTENT: what an earlier call already did for this person is returned, not redone.
  RETURN QUERY
    SELECT l.review_id, l.disposition, l.onto_review_id
      FROM public.contact_opt_out_review_reanchors l
     WHERE l.organization_id = p_organization_id AND l.person_id = p_person_id
     ORDER BY l.recorded_at, l.review_id;

  FOR r IN
    SELECT * FROM public.contact_opt_out_reviews c
     WHERE c.organization_id = p_organization_id AND c.anchor_kind = 'person'
       AND c.person_id = p_person_id AND c.state = 'pending'
       AND NOT EXISTS (SELECT 1 FROM public.contact_opt_out_review_reanchors l
                        WHERE l.person_id = p_person_id AND l.review_id = c.id)
     ORDER BY c.opened_at, c.id
     FOR UPDATE
  LOOP
    IF EXISTS (SELECT 1 FROM unnest(r.source_refs) s WHERE position(p_person_id::text IN s) > 0) THEN
      RAISE EXCEPTION 'g11_reanchor: review % carries the person in a source ref; refusing to move it onto a surviving row', r.id
        USING ERRCODE = '23514';
    END IF;

    IF NOT v_any THEN
      review_id := r.id; disposition := 'no_target'; onto_review_id := NULL;
      RETURN NEXT;
      CONTINUE;
    END IF;

    v_done := false;
    FOR v_target IN
      SELECT e.value FROM jsonb_array_elements(p_targets) WITH ORDINALITY e(value, i)
       ORDER BY array_position(ARRAY['email', 'phone', 'whatsapp'], e.value->>'channel'), e.i
    LOOP
      v_channel := v_target->>'channel';
      v_value := v_target->>'value';

      SELECT * INTO t FROM public.contact_opt_out_reviews c
       WHERE c.organization_id = p_organization_id AND c.anchor_kind = 'target'
         AND c.anchor_value = v_value AND c.state = 'pending'
       FOR UPDATE;

      IF NOT FOUND THEN
        BEGIN
          UPDATE public.contact_opt_out_reviews
             SET anchor_kind = 'target', anchor_channel = v_channel, anchor_value = v_value,
                 person_id = NULL, revision = revision + 1
           WHERE id = r.id;
          INSERT INTO public.contact_opt_out_review_reanchors (organization_id, person_id, review_id, disposition, onto_review_id)
            VALUES (p_organization_id, p_person_id, r.id, 're_anchored', NULL);
          review_id := r.id; disposition := 're_anchored'; onto_review_id := NULL;
          RETURN NEXT;
          v_done := true;
        EXCEPTION WHEN unique_violation THEN
          -- A pending review took that target meanwhile: judge it as a holder (below).
          SELECT * INTO t FROM public.contact_opt_out_reviews c
           WHERE c.organization_id = p_organization_id AND c.anchor_kind = 'target'
             AND c.anchor_value = v_value AND c.state = 'pending'
           FOR UPDATE;
          IF NOT FOUND THEN CONTINUE; END IF;
        END;
        IF v_done THEN EXIT; END IF;
      END IF;

      -- THE SAME-CASE RULE (header): a shared trigger event, or a shared PERSON-keyed row of P.
      -- SAFE ONLY because source_refs is NOT NULL with cardinality > 0 (20270127000001,
      -- contact_opt_out_reviews_source_refs_present): a NULL here would make v_same NULL, and
      -- `IF NOT v_same` would then fall through into the merge.
      v_same := (r.source_refs && t.source_refs)
        OR EXISTS (
          SELECT 1 FROM public.contact_governance_records g
           WHERE g.organization_id = p_organization_id
             AND g.person_id = p_person_id
             AND g.id = ANY (t.adopted_hold_ids || t.pre_existing_hold_ids || t.trigger_record_ids)
             AND g.id = ANY (r.adopted_hold_ids || r.pre_existing_hold_ids || r.trigger_record_ids));
      IF NOT v_same THEN
        CONTINUE;                                 -- a different case holds this target: try the next
      END IF;

      UPDATE public.contact_opt_out_reviews
         SET triggers              = ARRAY(SELECT DISTINCT unnest(t.triggers || r.triggers) ORDER BY 1),
             locked_channels       = ARRAY(SELECT DISTINCT unnest(t.locked_channels || r.locked_channels) ORDER BY 1),
             adopted_hold_ids      = ARRAY(SELECT DISTINCT unnest(t.adopted_hold_ids || r.adopted_hold_ids)),
             pre_existing_hold_ids = ARRAY(SELECT DISTINCT x FROM unnest(t.pre_existing_hold_ids || r.pre_existing_hold_ids) x
                                            WHERE NOT x = ANY (t.adopted_hold_ids || r.adopted_hold_ids)
                                               OR x = ANY (t.pre_existing_hold_ids)),
             trigger_record_ids    = ARRAY(SELECT DISTINCT unnest(t.trigger_record_ids || r.trigger_record_ids)),
             source_refs           = ARRAY(SELECT DISTINCT unnest(t.source_refs || r.source_refs) ORDER BY 1),
             revision              = t.revision + 1
       WHERE id = t.id;
      UPDATE public.contact_opt_out_reviews
         SET state = 'merged', merged_into = t.id, merged_at = now(), revision = revision + 1
       WHERE id = r.id;
      INSERT INTO public.contact_opt_out_review_reanchors (organization_id, person_id, review_id, disposition, onto_review_id)
        VALUES (p_organization_id, p_person_id, r.id, 'merged', t.id);
      review_id := r.id; disposition := 'merged'; onto_review_id := t.id;
      RETURN NEXT;
      v_done := true;
      EXIT;
    END LOOP;

    IF NOT v_done THEN
      -- Every target is held by a DIFFERENT case: stay person-anchored; the FK tombstone gives it
      -- its own 'erased:<review id>'. Recorded so a second call returns it, unchanged.
      INSERT INTO public.contact_opt_out_review_reanchors (organization_id, person_id, review_id, disposition, onto_review_id)
        VALUES (p_organization_id, p_person_id, r.id, 'kept_distinct', NULL);
      review_id := r.id; disposition := 'kept_distinct'; onto_review_id := NULL;
      RETURN NEXT;
    END IF;
  END LOOP;

  PERFORM set_config('g11.reanchor', 'off', true);
  RETURN;
END $$;

REVOKE ALL ON FUNCTION public.g11_reanchor_pending_opt_out_reviews(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.g11_reanchor_pending_opt_out_reviews(uuid, uuid, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.g11_reanchor_pending_opt_out_reviews(uuid, uuid, jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.g11_reanchor_pending_opt_out_reviews(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.g11_reanchor_pending_opt_out_reviews(uuid, uuid, jsonb) TO service_role;

-- Postconditions.
DO $$
BEGIN
  IF position('kept_distinct' IN pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'contact_opt_out_review_reanchors_disposition_valid'))) = 0 THEN
    RAISE EXCEPTION 'G-11 postcondition: the ledger does not admit kept_distinct';
  END IF;
  -- Needles unique to THIS function (the 20270127000003 body contains neither): the (a) half of
  -- the same-case rule, and the no-merge outcome. Proven to raise against the 0003 body.
  -- These needles must stay literal inside the function body (pg_get_functiondef returns the body
  -- only; a needle moved into a variable or helper silently tests nothing); '&&' is the primary check.
  IF position('source_refs && t.source_refs' IN pg_get_functiondef('public.g11_reanchor_pending_opt_out_reviews(uuid, uuid, jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'G-11 postcondition: the re-anchor does not apply the same-case rule (shared source_ref)';
  END IF;
  IF position('kept_distinct' IN pg_get_functiondef('public.g11_reanchor_pending_opt_out_reviews(uuid, uuid, jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'G-11 postcondition: the re-anchor has no kept_distinct outcome';
  END IF;
  IF has_function_privilege('anon', 'public.g11_reanchor_pending_opt_out_reviews(uuid, uuid, jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.g11_reanchor_pending_opt_out_reviews(uuid, uuid, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'G-11 postcondition: a client role can run the re-anchor';
  END IF;
END
$$;
