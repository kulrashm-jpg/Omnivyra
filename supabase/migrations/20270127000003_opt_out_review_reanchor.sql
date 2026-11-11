-- Orchestration (G-11) — re-anchor a PENDING person-anchored opt-out review at erasure.
--
-- WHY. Owner-approved (2026-11-07), interface designed by PI. When a person is erased, the FK's
-- SET NULL tombstones a person-anchored review ('erased:' || its own id): it keeps the contact
-- closed, but an admin could no longer reach it by anchor. Before the person delete, PI's
-- erasure (personErasure, PI's own files) calls
--   public.g11_reanchor_pending_opt_out_reviews(p_organization_id, p_person_id, p_targets)
-- with the person's CANONICAL targets, and each PENDING person review of that person moves onto
-- a target, so the admin can still decide it:
--   * onto the FIRST applicable target, in the order email, phone, whatsapp (within a channel,
--     the first listed): anchor_kind 'target', that channel, that canonical value, person_id
--     NULL → disposition 're_anchored';
--   * if a pending review already holds that target (uq_contact_opt_out_reviews_pending_anchor),
--     it JOINS it: triggers, locked_channels, adopted_hold_ids, pre_existing_hold_ids,
--     trigger_record_ids and source_refs are unioned into the target review (revision + 1), and
--     the person review becomes 'merged' with merged_into → disposition 'merged';
--   * with no targets the row is left for the FK tombstone → disposition 'no_target'. A target
--     is never invented.
-- Decided, tombstoned and merged rows are untouched.
--
-- THE STATE 'merged'. A third state: terminal, reached ONLY through this function, carrying
-- merged_into (a review of the same organization) and merged_at, and NO decision (it is not an
-- admin decision). Nothing returns to pending. The guard admits pending → merged and the
-- person → target move only while the function's transaction-local flag `g11.reanchor` is on;
-- the function sets it and clears it. (A session that set the flag itself could also move a row;
-- that is the service-role trust boundary, as for every service-role write.)
--
-- IDEMPOTENT without a residual person key. The function records what it did in
-- contact_opt_out_review_reanchors, keyed by the person with ON DELETE CASCADE from
-- unified_persons: a second (or third) call with the same inputs returns the recorded
-- dispositions, each review exactly once, and writes nothing.
-- THE BOUNDARY: idempotency holds UNTIL THE PERSON DELETE. A retried, failed erasure (the
-- person still exists) sees the ledger and gets the same answer; a successful erasure deletes the
-- person, the CASCADE removes the ledger rows with them (which is also why the ledger's person_id
-- is not a residual), and a call after that RAISES (the person is no longer in the organization).
-- A call that raises part-way leaves nothing behind (one statement, one transaction), so its
-- retry starts clean and returns each review exactly once.
-- One call moves at most ONE pending person review (one pending review per anchor), so its
-- result is that review plus what earlier calls for the same person recorded. The reviews
-- themselves never carry the person after the move (person_id NULL on a target anchor; a merged
-- person review is tombstoned by the FK like any person review). source_refs never hold a person
-- uuid by construction (a run and reply key, a Meta message id, 'attempt:<id>'); the function
-- RAISES if one ever did, rather than carry it onto a surviving row.
--
-- RAISES on any failure (no soft errors): a person outside the organization, malformed targets.
-- Forward only; rollback in rollbacks/opt_out_review_reanchor_rollback.sql.

-- ── the 'merged' state ────────────────────────────────────────────────────────────

ALTER TABLE public.contact_opt_out_reviews ADD COLUMN IF NOT EXISTS merged_into uuid;
ALTER TABLE public.contact_opt_out_reviews ADD COLUMN IF NOT EXISTS merged_at timestamptz;

DO $c$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contact_opt_out_reviews_id_org_unique') THEN
    ALTER TABLE public.contact_opt_out_reviews
      ADD CONSTRAINT contact_opt_out_reviews_id_org_unique UNIQUE (id, organization_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contact_opt_out_reviews_merged_into_fk') THEN
    -- Same organization by construction: the composite key cannot point across tenants.
    ALTER TABLE public.contact_opt_out_reviews
      ADD CONSTRAINT contact_opt_out_reviews_merged_into_fk
      FOREIGN KEY (merged_into, organization_id) REFERENCES public.contact_opt_out_reviews (id, organization_id);
  END IF;
END
$c$;

ALTER TABLE public.contact_opt_out_reviews DROP CONSTRAINT IF EXISTS contact_opt_out_reviews_state_valid;
ALTER TABLE public.contact_opt_out_reviews ADD CONSTRAINT contact_opt_out_reviews_state_valid
  CHECK (state IN ('pending', 'decided', 'merged'));

-- Pending carries no decision; decided carries all of it, with a reason; merged carries where it
-- went and when, and no decision (it is not an admin decision).
ALTER TABLE public.contact_opt_out_reviews DROP CONSTRAINT IF EXISTS contact_opt_out_reviews_decision_complete;
ALTER TABLE public.contact_opt_out_reviews ADD CONSTRAINT contact_opt_out_reviews_decision_complete
  CHECK ((state = 'pending' AND decision IS NULL AND decided_by IS NULL AND decided_at IS NULL AND reason IS NULL
          AND cardinality(reopened_channels) = 0 AND cardinality(closed_channels) = 0
          AND merged_into IS NULL AND merged_at IS NULL)
      OR (state = 'decided' AND decision IS NOT NULL AND decided_by IS NOT NULL AND decided_at IS NOT NULL
          AND reason IS NOT NULL AND length(btrim(reason)) > 0 AND merged_into IS NULL AND merged_at IS NULL)
      OR (state = 'merged' AND merged_into IS NOT NULL AND merged_at IS NOT NULL AND merged_into <> id
          AND decision IS NULL AND decided_by IS NULL AND decided_at IS NULL AND reason IS NULL
          AND cardinality(reopened_channels) = 0 AND cardinality(closed_channels) = 0));

-- The guard, re-stated from 20270127000001 with the re-anchor move and the merged state added.
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

-- ── the idempotency ledger (no residual: it goes with the person) ─────────────────

CREATE TABLE IF NOT EXISTS public.contact_opt_out_review_reanchors (
  organization_id  uuid        NOT NULL,
  person_id        uuid        NOT NULL,
  review_id        uuid        NOT NULL,
  disposition      text        NOT NULL,
  onto_review_id   uuid,
  recorded_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT contact_opt_out_review_reanchors_pkey PRIMARY KEY (person_id, review_id),
  CONSTRAINT contact_opt_out_review_reanchors_disposition_valid
    CHECK ((disposition = 're_anchored' AND onto_review_id IS NULL)
        OR (disposition = 'merged' AND onto_review_id IS NOT NULL)),
  -- The person key lives only here, and only while the person exists.
  CONSTRAINT contact_opt_out_review_reanchors_person_fk
    FOREIGN KEY (person_id, organization_id) REFERENCES public.unified_persons (id, company_id) ON DELETE CASCADE,
  CONSTRAINT contact_opt_out_review_reanchors_review_fk
    FOREIGN KEY (review_id, organization_id) REFERENCES public.contact_opt_out_reviews (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT contact_opt_out_review_reanchors_onto_fk
    FOREIGN KEY (onto_review_id, organization_id) REFERENCES public.contact_opt_out_reviews (id, organization_id) ON DELETE CASCADE
);

ALTER TABLE public.contact_opt_out_review_reanchors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contact_opt_out_review_reanchors_service_role ON public.contact_opt_out_review_reanchors;
CREATE POLICY contact_opt_out_review_reanchors_service_role ON public.contact_opt_out_review_reanchors
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.contact_opt_out_review_reanchors FROM PUBLIC;
REVOKE ALL ON public.contact_opt_out_review_reanchors FROM anon, authenticated;
-- Written only by the SECURITY DEFINER function; service_role may read it.
GRANT SELECT ON public.contact_opt_out_review_reanchors TO service_role;

-- ── the function ──────────────────────────────────────────────────────────────────

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

-- Postconditions.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.contact_opt_out_reviews'::regclass
                  AND conname = 'contact_opt_out_reviews_merged_into_fk' AND contype = 'f') THEN
    RAISE EXCEPTION 'G-11 postcondition: merged_into is not tied to a review of the same organization';
  END IF;
  IF position('merged' IN pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'contact_opt_out_reviews_state_valid'))) = 0 THEN
    RAISE EXCEPTION 'G-11 postcondition: the merged state is not admitted';
  END IF;
  IF has_function_privilege('anon', 'public.g11_reanchor_pending_opt_out_reviews(uuid, uuid, jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.g11_reanchor_pending_opt_out_reviews(uuid, uuid, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'G-11 postcondition: a client role can run the re-anchor';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.g11_reanchor_pending_opt_out_reviews(uuid, uuid, jsonb)'::regprocedure) THEN
    RAISE EXCEPTION 'G-11 postcondition: the re-anchor is not SECURITY DEFINER';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.contact_opt_out_review_reanchors'::regclass) THEN
    RAISE EXCEPTION 'G-11 postcondition: RLS is off on contact_opt_out_review_reanchors';
  END IF;
END
$$;
