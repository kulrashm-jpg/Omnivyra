-- Orchestration, Follow-up D-2 — atomic per-person frequency protection at the engine claim, and
-- an immutable queue timestamp on the engine request ledger.
--
-- WHY. Owner decisions (2026-11-09):
--   * "Count queued WhatsApp and community requests as possible contact from the moment they are
--     queued" — and "preserve the original queued timestamp ... even if it later becomes
--     uncertain or is reconciled".
--   * "Use an Orchestration-owned database function providing atomic per-tenant, per-person
--     frequency protection." Two journeys of one person must not both pass the frequency check
--     and both claim outbound work. A migration is authorized for this scope; production
--     application is NOT.
--
-- WHERE THE ATOMIC POINT IS. Outbound WhatsApp and community work is claimed in exactly one place
-- per engine: the request ledger's compare-and-set `requested -> submitting`
-- (whatsappEngineAdapter, communityEngineAdapter), reached only from the progression sweeper.
-- The manual progression route never dispatches. public.orch_claim_engine_request makes that
-- claim, in ONE transaction:
--   1. a transaction-scoped advisory lock on (tenant, subject kind, subject id) — released by
--      COMMIT or ROLLBACK, so an error can never leave it held; one key per call, so no lock
--      ordering exists to deadlock on; bounded by lock_timeout (55P03 to the caller);
--   2. the person's contact history: completed contact steps, and engine requests that are
--      possible contact (submitting, submitted, uncertain) by their immutable queued_at;
--   3. the frequency gap (when the step's policy has one);
--   4. the claim itself (the same compare-and-set as before).
-- It reuses the run-level lock (advance_execution_plan) and the request's own claim; it adds no
-- execution lock beside them — the advisory key only orders claims of ONE person. Unrelated
-- people and tenants hash to different keys (a rare hash collision only serializes, never
-- refuses).
--
-- QUEUED_AT. Set by trigger, for EVERY writer, the first time a request enters submitting,
-- submitted or uncertain; immutable after (a retry that releases and re-claims keeps the first
-- time; reconciliation and settlement never move it). It is the moment the request became a
-- possible contact, never a send or delivery time. Existing rows in those states are backfilled
-- from updated_at, explicitly, below; a counted row with no queued_at afterwards is a
-- contradiction and FAILS CLOSED (no claim).
--
-- NOT HERE: email (WS-3) dispatch is Outreach's claim and is not gated by this lock (an Outreach
-- contract dependency). Forward only; rollback in rollbacks/engine_request_frequency_claim_rollback.sql.

ALTER TABLE public.execution_engine_requests
  ADD COLUMN IF NOT EXISTS queued_at timestamptz;

COMMENT ON COLUMN public.execution_engine_requests.queued_at IS
  'When the request first became a possible contact (submitting, submitted or uncertain). Set once, by trigger; never a send or delivery time.';

-- ── queued_at: set once, by the database, for every writer ──────────────────────
CREATE OR REPLACE FUNCTION public.execution_engine_requests_queued_at()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.queued_at IS NOT NULL AND NEW.queued_at IS DISTINCT FROM OLD.queued_at THEN
    RAISE EXCEPTION 'execution_engine_requests: queued_at is set once' USING ERRCODE = '23514';
  END IF;
  IF NEW.queued_at IS NULL AND NEW.state IN ('submitting', 'submitted', 'uncertain') THEN
    NEW.queued_at := now();
  END IF;
  RETURN NEW;
END
$$;

-- Backfill BEFORE the trigger exists and with the identity guard paused, so no historical
-- updated_at is rewritten: an in-flight or uncertain row's last movement is its best known
-- possible-contact time (submitted: the queue acceptance; uncertain: no earlier than that).
ALTER TABLE public.execution_engine_requests DISABLE TRIGGER trg_execution_engine_requests_guard;
UPDATE public.execution_engine_requests
   SET queued_at = updated_at
 WHERE queued_at IS NULL
   AND state IN ('submitting', 'submitted', 'uncertain');
ALTER TABLE public.execution_engine_requests ENABLE TRIGGER trg_execution_engine_requests_guard;

DROP TRIGGER IF EXISTS trg_execution_engine_requests_queued_at ON public.execution_engine_requests;
CREATE TRIGGER trg_execution_engine_requests_queued_at
  BEFORE INSERT OR UPDATE ON public.execution_engine_requests
  FOR EACH ROW EXECUTE FUNCTION public.execution_engine_requests_queued_at();

-- The claim's history read: one person's possible-contact requests, newest first.
CREATE INDEX IF NOT EXISTS ix_execution_engine_requests_possible_contact
  ON public.execution_engine_requests (organization_id, execution_task_id, queued_at)
  WHERE state IN ('submitting', 'submitted', 'uncertain');

-- ── the atomic claim ─────────────────────────────────────────────────────────────
-- outcome:
--   claimed          the request moved requested -> submitting (queued_at recorded by trigger)
--   not_claimed      it was not `requested` (another caller holds or settled it)
--   deferred         the person had a counted contact less than p_min_gap_hours before p_now
--   invalid_history  a counted request of the person has no queued_at: fail closed, nothing claimed
--   task_not_found   no such task in this tenant
CREATE OR REPLACE FUNCTION public.orch_claim_engine_request(
  p_organization_id      uuid,
  p_execution_task_id    uuid,
  p_external_ref         text,
  p_min_gap_hours        numeric,
  p_now                  timestamptz,
  p_non_contact_channels text[],
  p_lock_timeout_ms      integer DEFAULT 5000
) RETURNS TABLE (outcome text, last_contact_at timestamptz, basis text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_kind      text;
  v_subject   text;
  v_completed timestamptz;
  v_possible  timestamptz;
  v_last      timestamptz;
  v_basis     text;
  v_moved     integer;
BEGIN
  IF p_organization_id IS NULL OR p_execution_task_id IS NULL OR p_now IS NULL THEN
    RAISE EXCEPTION 'orch_claim_engine_request: organization, task and now are required' USING ERRCODE = '22023';
  END IF;

  SELECT t.subject_kind, t.subject_id INTO v_kind, v_subject
    FROM public.execution_tasks t
   WHERE t.organization_id = p_organization_id          -- TENANT FIRST
     AND t.id = p_execution_task_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'task_not_found'::text, NULL::timestamptz, NULL::text;
    RETURN;
  END IF;

  -- 1. One person, one claim at a time. Every claim takes it (with or without a gap), so a
  --    gated claim always sees every committed claim of the same person.
  PERFORM set_config('lock_timeout', GREATEST(COALESCE(p_lock_timeout_ms, 5000), 1)::text || 'ms', true);
  PERFORM pg_advisory_xact_lock(
    hashtextextended('orch.frequency:' || p_organization_id::text || ':' || v_kind || ':' || v_subject, 0));

  IF p_min_gap_hours IS NOT NULL AND p_min_gap_hours > 0 THEN
    -- 2a. A counted request with no queue time is a contradiction: refuse, never guess.
    IF EXISTS (
      SELECT 1
        FROM public.execution_engine_requests q
        JOIN public.execution_tasks t
          ON t.id = q.execution_task_id AND t.organization_id = q.organization_id
       WHERE q.organization_id = p_organization_id
         AND t.subject_kind = v_kind AND t.subject_id = v_subject
         AND NOT (t.channel = ANY (COALESCE(p_non_contact_channels, ARRAY[]::text[])))
         AND q.execution_task_id <> p_execution_task_id
         AND q.state IN ('submitting', 'submitted', 'uncertain')
         AND q.queued_at IS NULL
    ) THEN
      RETURN QUERY SELECT 'invalid_history'::text, NULL::timestamptz, NULL::text;
      RETURN;
    END IF;

    -- 2b. The latest possible contact (another task's request) and the latest completed contact step.
    SELECT max(q.queued_at) INTO v_possible
      FROM public.execution_engine_requests q
      JOIN public.execution_tasks t
        ON t.id = q.execution_task_id AND t.organization_id = q.organization_id
     WHERE q.organization_id = p_organization_id
       AND t.subject_kind = v_kind AND t.subject_id = v_subject
       AND NOT (t.channel = ANY (COALESCE(p_non_contact_channels, ARRAY[]::text[])))
       AND q.execution_task_id <> p_execution_task_id
       AND q.state IN ('submitting', 'submitted', 'uncertain');

    SELECT max(s.completed_at) INTO v_completed
      FROM public.execution_plan_steps s
      JOIN public.execution_tasks t
        ON t.plan_step_id = s.id AND t.organization_id = s.organization_id
     WHERE s.organization_id = p_organization_id
       AND t.subject_kind = v_kind AND t.subject_id = v_subject
       AND NOT (t.channel = ANY (COALESCE(p_non_contact_channels, ARRAY[]::text[])))
       AND s.completed_at IS NOT NULL;

    -- The later one; a tie reads as the confirmed (completed) contact.
    IF v_possible IS NOT NULL AND (v_completed IS NULL OR v_possible > v_completed) THEN
      v_last := v_possible;  v_basis := 'possible_contact';
    ELSIF v_completed IS NOT NULL THEN
      v_last := v_completed; v_basis := 'completed';
    END IF;

    -- 3. Strictly inside the gap defers; exactly at the gap proceeds.
    IF v_last IS NOT NULL AND (p_now - v_last) < make_interval(secs => p_min_gap_hours * 3600) THEN
      RETURN QUERY SELECT 'deferred'::text, v_last, v_basis;
      RETURN;
    END IF;
  END IF;

  -- 4. The claim: the same compare-and-set the adapters made, now under the person's lock.
  UPDATE public.execution_engine_requests
     SET state = 'submitting',
         external_ref = COALESCE(p_external_ref, external_ref)
   WHERE organization_id = p_organization_id
     AND execution_task_id = p_execution_task_id
     AND state = 'requested';
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  RETURN QUERY SELECT CASE WHEN v_moved = 1 THEN 'claimed' ELSE 'not_claimed' END::text, v_last, v_basis;
END
$$;

REVOKE ALL ON FUNCTION public.orch_claim_engine_request(uuid, uuid, text, numeric, timestamptz, text[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.orch_claim_engine_request(uuid, uuid, text, numeric, timestamptz, text[], integer) TO service_role;
REVOKE ALL ON FUNCTION public.execution_engine_requests_queued_at() FROM PUBLIC, anon, authenticated;

-- Postconditions.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'execution_engine_requests' AND column_name = 'queued_at') THEN
    RAISE EXCEPTION 'D-2 postcondition: execution_engine_requests.queued_at is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_execution_engine_requests_queued_at' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'D-2 postcondition: the queued_at trigger is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_execution_engine_requests_guard' AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'D-2 postcondition: the request identity guard is not enabled';
  END IF;
  IF EXISTS (SELECT 1 FROM public.execution_engine_requests
              WHERE state IN ('submitting', 'submitted', 'uncertain') AND queued_at IS NULL) THEN
    RAISE EXCEPTION 'D-2 postcondition: a possible-contact request has no queued_at after the backfill';
  END IF;
  IF has_function_privilege('anon', 'public.orch_claim_engine_request(uuid, uuid, text, numeric, timestamptz, text[], integer)', 'EXECUTE')
  OR has_function_privilege('authenticated', 'public.orch_claim_engine_request(uuid, uuid, text, numeric, timestamptz, text[], integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'D-2 postcondition: a client role can claim engine requests';
  END IF;
END
$$;
