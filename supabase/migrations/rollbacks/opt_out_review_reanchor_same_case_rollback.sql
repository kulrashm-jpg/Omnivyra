-- ROLLBACK — Orchestration (G-11): the re-anchor consolidates only the same governance case.
-- Reverses supabase/migrations/20270127000005_opt_out_review_reanchor_same_case.sql
--
-- NOT APPLIED ANYWHERE; test database only, like the forward migration.
--
-- WHAT IT GIVES UP. The function returns to its 20270127000003 text (verbatim below), which JOINS
-- a person review into ANY pending review on the same address: two people sharing an address are
-- merged at erasure again, against the owner's conditions. Roll back only together with
-- 20270127000003. The ledger's 'kept_distinct' disposition cannot be expressed afterwards, so this
-- REFUSES while any such row exists (they disappear with their person at erasure).
--
-- One transaction: a failure at any step leaves the forward state intact.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.contact_opt_out_review_reanchors WHERE disposition = 'kept_distinct') THEN
    RAISE EXCEPTION 'G-11 rollback: kept_distinct ledger rows exist; the disposition cannot be removed under them';
  END IF;
END
$$;

ALTER TABLE public.contact_opt_out_review_reanchors DROP CONSTRAINT IF EXISTS contact_opt_out_review_reanchors_disposition_valid;
ALTER TABLE public.contact_opt_out_review_reanchors ADD CONSTRAINT contact_opt_out_review_reanchors_disposition_valid
  CHECK ((disposition = 're_anchored' AND onto_review_id IS NULL)
      OR (disposition = 'merged' AND onto_review_id IS NOT NULL));

-- The function as 20270127000003 wrote it.
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
  r          public.contact_opt_out_reviews%ROWTYPE;
  t          public.contact_opt_out_reviews%ROWTYPE;
  v_rank     int;
  v_best     int := 99;
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

  -- The first applicable target: email, then phone, then whatsapp; within a channel, the first listed.
  FOR v_target IN SELECT value FROM jsonb_array_elements(p_targets) LOOP
    IF jsonb_typeof(v_target) <> 'object' OR jsonb_typeof(v_target->'channel') <> 'string' OR jsonb_typeof(v_target->'value') <> 'string'
       OR (v_target->>'channel') NOT IN ('email', 'phone', 'whatsapp')
       OR length(btrim(v_target->>'value')) = 0 OR (v_target->>'value') LIKE 'erased:%' THEN
      RAISE EXCEPTION 'g11_reanchor: each target is {"channel": "email"|"phone"|"whatsapp", "value": "<canonical>"}' USING ERRCODE = '22023';
    END IF;
    v_rank := array_position(ARRAY['email', 'phone', 'whatsapp'], v_target->>'channel');
    IF v_rank < v_best THEN
      v_best := v_rank; v_channel := v_target->>'channel'; v_value := v_target->>'value';
    END IF;
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
     ORDER BY c.opened_at, c.id
     FOR UPDATE
  LOOP
    IF EXISTS (SELECT 1 FROM unnest(r.source_refs) s WHERE position(p_person_id::text IN s) > 0) THEN
      RAISE EXCEPTION 'g11_reanchor: review % carries the person in a source ref; refusing to move it onto a surviving row', r.id
        USING ERRCODE = '23514';
    END IF;

    IF v_value IS NULL THEN
      -- No target: the FK tombstone at the person delete keeps it closed. Nothing is written.
      review_id := r.id; disposition := 'no_target'; onto_review_id := NULL;
      RETURN NEXT;
      CONTINUE;
    END IF;

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
        CONTINUE;
      EXCEPTION WHEN unique_violation THEN
        -- A pending review took that target meanwhile: join it instead (below).
        SELECT * INTO t FROM public.contact_opt_out_reviews c
         WHERE c.organization_id = p_organization_id AND c.anchor_kind = 'target'
           AND c.anchor_value = v_value AND c.state = 'pending'
         FOR UPDATE;
      END;
    END IF;

    -- JOIN: union into the pending target review; the person review becomes merged.
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
  END LOOP;

  PERFORM set_config('g11.reanchor', 'off', true);
  RETURN;
END $$;

REVOKE ALL ON FUNCTION public.g11_reanchor_pending_opt_out_reviews(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.g11_reanchor_pending_opt_out_reviews(uuid, uuid, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.g11_reanchor_pending_opt_out_reviews(uuid, uuid, jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.g11_reanchor_pending_opt_out_reviews(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.g11_reanchor_pending_opt_out_reviews(uuid, uuid, jsonb) TO service_role;

COMMIT;
