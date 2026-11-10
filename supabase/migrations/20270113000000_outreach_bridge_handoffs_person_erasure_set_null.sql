-- A6-10 (owner decision D-2, OPTION B — recommended, UNSIGNED at authoring time)
-- outreach_bridge_handoffs.person_id: nullable + ON DELETE SET NULL, so erasing a
-- person keeps each handoff as a NON-IDENTIFYING attribution record.
--
-- Derived unchanged in substance from the gate-22 proposal A6-10-option-B.sql
-- (renumbered: 20270110000000 is taken by other branches).
--
-- REBASE ORDERING (explicit assumption). This is a FORWARD migration on the
-- candidate stack (rebase/orch-adapters-09a2cf49 @ 2414866a). It depends ONLY on
-- 20261229000000_pi_outreach_bridge (outreach_bridge_handoffs, its guard and
-- outreach_bridge_handoffs_person_fk). Its version sorts after every migration
-- on the candidate stack (latest 20270106000000), after main b20278de's latest
-- (20270109000003) and after privacy/erasure-remediation's 20270112000000..03,
-- so after the authorized rebase it still applies last of these, with no
-- reordering. It neither requires nor is required by the main-side erasure
-- ledger: without it, finalize names outreach_bridge_handoffs_person_fk as the
-- delete blocker and rolls back; with it, the handoffs are nulled in the delete.
-- RE-RUN HAZARD: re-executing 20261229000000 after this migration would restore
-- the old guard body and fail its own "person_id is not mandatory" postcondition
-- (it re-runs CREATE OR REPLACE of the guard). Do not re-run 20261229000000
-- out of order; re-run this file after it if that is ever done.
--
-- OPTION B — keep the handoff as a NON-IDENTIFYING audit row: when the person
-- is deleted, outreach_bridge_handoffs.person_id is nulled by the foreign key,
-- in the same statement as the delete. This is the house rule for outreach
-- history: outreach_tasks_person_tenant_fk (20261011000000) is
-- ON DELETE SET NULL (person_id) "so the audit row and its tenant survive"
-- ("CASCADE would destroy the record of who authorised contact").
--
-- What the surviving row contains (20261229000000:90-186): tenant, execution
-- task / legacy task / campaign / workflow / version / instance / plan / step
-- ids (internal surrogate keys, no personal data), subject_kind + subject_id
-- (the same lead/prospect key that execution_instances / execution_tasks /
-- outreach_tasks.lead_id already retain — see SUBJECT-ID-DECISION.md),
-- execution_mode, workflow_requires_approval, policy_source, created_at. No
-- name, address, handle or free text. After this change: no person id either.
--
-- Three changes, all required:
--   1. person_id DROP NOT NULL (only so the FK action can null it);
--   2. the FK becomes ON DELETE SET NULL;
--   3. the immutability guard admits EXACTLY ONE update: person_id
--      non-null -> NULL, every other column unchanged, nested
--      (pg_trigger_depth() > 1, i.e. the FK action rather than a client
--      statement), and only when the person no longer exists. A caller cannot
--      use (3) to detach a LIVE person. At INSERT, person_id stays mandatory
--      (the guard now enforces what NOT NULL enforced; bridge_execution_task
--      also refuses a NULL person).
-- Column set, indexes, RLS, grants, trigger name/table/function and the guard's
-- SECURITY INVOKER: unchanged, so the ORCH-STACK verifier manifest needs no edit.
--
-- J1 A6-1 (edited in place on privacy/a6-10-bridge-fixes; this migration is
-- unapplied everywhere). "Nested + person already gone" is true for EVERY delete
-- of the person, not only an erasure: merge_unified_persons() (20260506000002)
-- re-points seven tables and then DELETEs the loser, and with the admission
-- above it silently detached every handoff of the loser from a human who still
-- exists as the winner (before A6-10 the NO ACTION FK made that merge fail).
-- The admission therefore ALSO requires the erasure flow's explicit signal:
-- public.pi_erasure_authorization_held('bridge_handoffs', tenant, person)
-- (privacy/erasure-remediation 20270112000000; pi_person_erasure_finalize
-- authorizes that scope around its DELETE). Fail closed: if that function is
-- absent, or the invoking role cannot execute it, nothing is admitted. Any other
-- delete of a person with handoffs - a merge, operator SQL - fails as it did
-- before A6-10 (SQLSTATE 23503, foreign_key_violation), naming the handoff.
-- Merging a loser that has handoffs is deliberately NOT re-pointed: a handoff
-- is an immutable attribution record, and re-pointing it would need its own
-- authorized path (an owner decision). Recommended: re-point or erase first.
--
-- DEPENDENCY (J1): this migration lands only AFTER (1) the authorized rebase of
-- the candidate stack onto main and (2) privacy/erasure-remediation(-fixes).
-- Applied without 20270112000000 it is still safe (fail closed), but no bridged
-- person is erasable until the erasure ledger exists.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.outreach_bridge_handoffs') IS NULL THEN
    RAISE EXCEPTION 'A6-10/B preflight: apply 20261229000000_pi_outreach_bridge first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'outreach_bridge_handoffs_person_fk'
                    AND conrelid = 'public.outreach_bridge_handoffs'::regclass) THEN
    RAISE EXCEPTION 'A6-10/B preflight: outreach_bridge_handoffs_person_fk is missing';
  END IF;
  IF to_regprocedure('public.outreach_bridge_handoffs_guard()') IS NULL THEN
    RAISE EXCEPTION 'A6-10/B preflight: outreach_bridge_handoffs_guard() is missing';
  END IF;
END
$preflight$;

-- 3 first: the guard must admit the FK action before the action can exist.
CREATE OR REPLACE FUNCTION public.outreach_bridge_handoffs_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_legacy_company uuid;
  v_task record;
  v_erasure boolean := false;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- A6-10: the ONE permitted change is the erasure of the person link by
    -- outreach_bridge_handoffs_person_fk (ON DELETE SET NULL). Everything else
    -- about a handoff stays an immutable historical record. Same admission
    -- rule as main's opportunity_dispositions guard (20270109000003): nested
    -- (pg_trigger_depth() > 1, i.e. the FK action, not a client statement),
    -- non-NULL -> NULL, the referenced row already gone, nothing else changed.
    IF pg_trigger_depth() > 1
       AND OLD.person_id IS NOT NULL
       AND NEW.person_id IS NULL
       AND (to_jsonb(NEW) - 'person_id') = (to_jsonb(OLD) - 'person_id')
       AND NOT EXISTS (SELECT 1 FROM public.unified_persons p WHERE p.id = OLD.person_id) THEN
      -- J1 A6-1: ...and only when the PERSON-ERASURE flow authorized it for this
      -- tenant and person in this transaction. Fail closed when the erasure
      -- ledger is absent (42883) or the invoker may not ask (42501).
      BEGIN
        v_erasure := public.pi_erasure_authorization_held('bridge_handoffs', OLD.organization_id, OLD.person_id);
      EXCEPTION WHEN undefined_function OR insufficient_privilege THEN
        v_erasure := false;
      END;
      IF v_erasure IS TRUE THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION
        'outreach_bridge_handoffs: handoff % references a person that is being deleted outside the person-erasure flow (e.g. merge_unified_persons); only an erasure may clear a handoff''s person', OLD.id
        USING ERRCODE = '23503';
    END IF;
    RAISE EXCEPTION
      'outreach_bridge_handoffs: handoff % is an immutable historical record', OLD.id;
  END IF;

  -- A handoff is always written for a resolved person (20261229000000 kept this
  -- as NOT NULL; it is now enforced here so that only erasure can clear it).
  IF NEW.person_id IS NULL THEN
    RAISE EXCEPTION 'outreach_bridge_handoffs: a handoff requires a resolved person (person_id)'
      USING ERRCODE = '23502';
  END IF;

  -- The legacy task must belong to the same tenant. `outreach_tasks.company_id`
  -- is text, so this is a comparison rather than a foreign key.
  SELECT company_id INTO v_legacy_company
    FROM public.outreach_tasks WHERE id = NEW.outreach_task_id;
  IF v_legacy_company IS NULL THEN
    RAISE EXCEPTION 'outreach_bridge_handoffs: legacy task % does not exist',
      NEW.outreach_task_id;
  END IF;
  IF v_legacy_company IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION
      'outreach_bridge_handoffs: legacy task % belongs to another tenant — a handoff may never cross organizations',
      NEW.outreach_task_id;
  END IF;

  -- The recorded chain must be the execution task's ACTUAL chain, not a claim.
  SELECT t.execution_instance_id, t.plan_step_id, t.subject_kind, t.subject_id,
         s.plan_id, p.workflow_version_id, i.campaign_id, i.workflow_id
    INTO v_task
    FROM public.execution_tasks t
    JOIN public.execution_plan_steps s
      ON s.id = t.plan_step_id AND s.organization_id = t.organization_id
    JOIN public.execution_plans p
      ON p.id = s.plan_id AND p.organization_id = s.organization_id
    JOIN public.execution_instances i
      ON i.id = t.execution_instance_id AND i.organization_id = t.organization_id
   WHERE t.id = NEW.execution_task_id AND t.organization_id = NEW.organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'outreach_bridge_handoffs: execution task % is not resolvable in this tenant',
      NEW.execution_task_id;
  END IF;

  IF NEW.execution_instance_id  IS DISTINCT FROM v_task.execution_instance_id
  OR NEW.execution_plan_step_id IS DISTINCT FROM v_task.plan_step_id
  OR NEW.execution_plan_id      IS DISTINCT FROM v_task.plan_id
  OR NEW.workflow_version_id    IS DISTINCT FROM v_task.workflow_version_id
  OR NEW.campaign_id            IS DISTINCT FROM v_task.campaign_id
  OR NEW.workflow_id            IS DISTINCT FROM v_task.workflow_id
  OR NEW.subject_kind           IS DISTINCT FROM v_task.subject_kind
  OR NEW.subject_id             IS DISTINCT FROM v_task.subject_id THEN
    RAISE EXCEPTION
      'outreach_bridge_handoffs: the recorded chain disagrees with execution task % — attribution must be the task''s own',
      NEW.execution_task_id;
  END IF;

  RETURN NEW;
END $$;

-- 1 + 2.
ALTER TABLE public.outreach_bridge_handoffs
  ALTER COLUMN person_id DROP NOT NULL;
ALTER TABLE public.outreach_bridge_handoffs
  DROP CONSTRAINT outreach_bridge_handoffs_person_fk;
ALTER TABLE public.outreach_bridge_handoffs
  ADD CONSTRAINT outreach_bridge_handoffs_person_fk
  FOREIGN KEY (person_id) REFERENCES public.unified_persons (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.outreach_bridge_handoffs.person_id IS
  'The resolved canonical person at handoff. Mandatory at INSERT (guard). NULL only after the '
  'person was erased: outreach_bridge_handoffs_person_fk is ON DELETE SET NULL, and the guard '
  'admits no other update (A6-10 option B).';
COMMENT ON CONSTRAINT outreach_bridge_handoffs_person_fk ON public.outreach_bridge_handoffs IS
  'A6-10 option B: ON DELETE SET NULL. Erasing a person keeps the handoff as a non-identifying '
  'attribution record, matching outreach_tasks_person_tenant_fk.';

DO $verify$
DECLARE
  v_def text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'outreach_bridge_handoffs_person_fk' AND contype = 'f'
                    AND conrelid = 'public.outreach_bridge_handoffs'::regclass
                    AND confrelid = 'public.unified_persons'::regclass
                    AND confdeltype = 'n') THEN
    RAISE EXCEPTION 'A6-10/B postcondition: outreach_bridge_handoffs_person_fk must be ON DELETE SET NULL';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'outreach_bridge_handoffs'
                    AND column_name = 'person_id' AND is_nullable = 'YES') THEN
    RAISE EXCEPTION 'A6-10/B postcondition: person_id must be nullable';
  END IF;
  SELECT pg_get_functiondef('public.outreach_bridge_handoffs_guard()'::regprocedure) INTO v_def;
  IF position('to_jsonb(NEW) - ''person_id''' IN v_def) = 0
     OR position('pg_trigger_depth() > 1' IN v_def) = 0
     OR position('a handoff requires a resolved person' IN v_def) = 0
     OR position('is an immutable historical record' IN v_def) = 0
     OR position('pi_erasure_authorization_held(''bridge_handoffs''' IN v_def) = 0 THEN
    RAISE EXCEPTION 'A6-10/B postcondition: the guard body is not the A6-10 version';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
                  WHERE t.tgrelid = 'public.outreach_bridge_handoffs'::regclass
                    AND t.tgname = 'trg_outreach_bridge_handoffs_guard'
                    AND p.proname = 'outreach_bridge_handoffs_guard'
                    AND t.tgenabled <> 'D') THEN
    RAISE EXCEPTION 'A6-10/B postcondition: trg_outreach_bridge_handoffs_guard missing or disabled';
  END IF;
  IF to_regprocedure('public.pi_erasure_authorization_held(text, uuid, uuid)') IS NULL THEN
    RAISE NOTICE 'A6-10/B: pi_erasure_authorization_held is absent (privacy/erasure-remediation not applied): every delete of a person with handoffs is refused until it is (fail closed)';
  END IF;
END
$verify$;

COMMIT;

-- Rollback (only valid while no handoff has person_id NULL; afterwards SET NOT NULL fails, by design):
--   restore the 20261229000000 guard body, then
--   ALTER TABLE public.outreach_bridge_handoffs DROP CONSTRAINT outreach_bridge_handoffs_person_fk;
--   ALTER TABLE public.outreach_bridge_handoffs ADD CONSTRAINT outreach_bridge_handoffs_person_fk
--     FOREIGN KEY (person_id) REFERENCES public.unified_persons (id) ON DELETE NO ACTION;
--   ALTER TABLE public.outreach_bridge_handoffs ALTER COLUMN person_id SET NOT NULL;
