-- ROLLBACK for 20270113000000_outreach_bridge_handoffs_person_erasure_set_null.sql
--
-- ─── ORDER ─────────────────────────────────────────────────────────────────
-- FIRST of the erasure-family rollbacks (highest version). Then, if the erasure
-- migrations are applied, their rollbacks in reverse version order:
--   20270113000000 (this file) → 20270112000005 → 20270112000004 →
--   20270112000003 → 20270112000002 → 20270112000001 → 20270112000000.
-- 20270112000000's rollback refuses while this migration's guard (which calls
-- pi_erasure_authorization_held) is still installed. Nothing depends on this
-- migration, so it has no ordering precondition of its own.
--
-- ─── WHAT IT RESTORES (exact 20261229000000_pi_outreach_bridge state) ──────
--   * public.outreach_bridge_handoffs_guard() — the 20261229000000 body,
--     verbatim (UPDATE is refused unconditionally; SECURITY INVOKER;
--     SET search_path = public, pg_temp). Owner and ACL were not changed by the
--     forward migration (CREATE OR REPLACE keeps them) and are not touched here.
--     Trigger trg_outreach_bridge_handoffs_guard was never changed.
--   * outreach_bridge_handoffs_person_fk — FOREIGN KEY (person_id) REFERENCES
--     public.unified_persons (id) ON DELETE NO ACTION, with no comment (it had none).
--   * outreach_bridge_handoffs.person_id NOT NULL, with no column comment (it had none).
-- Order inside the transaction: refuse-check, NOT NULL, FK, guard, comments —
-- so the column is never without both guarantees.
--
-- ─── IT REFUSES WHEN ANY HANDOFF'S PERSON WAS ERASED ───────────────────────
-- After an erasure the handoff keeps its row with person_id NULL. NOT NULL
-- cannot be restored over it; re-pointing it at a person would be
-- re-identification and deleting it would destroy the attribution record.
-- None of those is a rollback's decision, so it refuses. MEASURE FIRST:
--
--   SELECT count(*) FROM public.outreach_bridge_handoffs WHERE person_id IS NULL;
--
-- If non-zero, stay on this migration. (The forward migration says the same:
-- "only valid while no handoff has person_id NULL".)
--
-- ─── RE-RUN NOTE ───────────────────────────────────────────────────────────
-- After this rollback, deleting a person who has handoffs fails again with
-- 23503 (NO ACTION) — for erasure as well as merge: bridged persons are
-- unerasable again until the forward migration is re-applied.

BEGIN;

DO $rollback_guard$
DECLARE
  v_nulls bigint;
BEGIN
  IF to_regclass('public.outreach_bridge_handoffs') IS NULL
     OR to_regprocedure('public.outreach_bridge_handoffs_guard()') IS NULL THEN
    RAISE EXCEPTION '20270113000000 rollback refused: outreach_bridge_handoffs or its guard is missing';
  END IF;
  -- Block concurrent erasures (the FK action) until COMMIT, then measure.
  LOCK TABLE public.outreach_bridge_handoffs IN SHARE ROW EXCLUSIVE MODE;
  SELECT count(*) INTO v_nulls FROM public.outreach_bridge_handoffs WHERE person_id IS NULL;
  IF v_nulls > 0 THEN
    RAISE EXCEPTION
      '20270113000000 rollback refused: % handoff(s) lost their person to an erasure (person_id NULL). '
      'NOT NULL cannot be restored without re-identifying or deleting attribution records. '
      'Stay on the migration (see this file''s header).', v_nulls;
  END IF;
END
$rollback_guard$;

ALTER TABLE public.outreach_bridge_handoffs
  ALTER COLUMN person_id SET NOT NULL;
ALTER TABLE public.outreach_bridge_handoffs
  DROP CONSTRAINT outreach_bridge_handoffs_person_fk;
ALTER TABLE public.outreach_bridge_handoffs
  ADD CONSTRAINT outreach_bridge_handoffs_person_fk
  FOREIGN KEY (person_id) REFERENCES public.unified_persons (id) ON DELETE NO ACTION;

-- 20261229000000_pi_outreach_bridge.sql, verbatim.
CREATE OR REPLACE FUNCTION public.outreach_bridge_handoffs_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_legacy_company uuid;
  v_task record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION
      'outreach_bridge_handoffs: handoff % is an immutable historical record', OLD.id;
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

COMMENT ON COLUMN public.outreach_bridge_handoffs.person_id IS NULL;

DO $verify$
DECLARE
  v_def text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'outreach_bridge_handoffs_person_fk' AND contype = 'f'
                    AND conrelid = 'public.outreach_bridge_handoffs'::regclass
                    AND confrelid = 'public.unified_persons'::regclass
                    AND confdeltype = 'a' AND convalidated) THEN
    RAISE EXCEPTION '20270113000000 rollback postcondition: outreach_bridge_handoffs_person_fk must be ON DELETE NO ACTION';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'outreach_bridge_handoffs'
                    AND column_name = 'person_id' AND is_nullable = 'NO') THEN
    RAISE EXCEPTION '20270113000000 rollback postcondition: person_id must be NOT NULL';
  END IF;
  SELECT pg_get_functiondef('public.outreach_bridge_handoffs_guard()'::regprocedure) INTO v_def;
  IF position('pg_trigger_depth()' IN v_def) > 0
     OR position('pi_erasure_authorization_held' IN v_def) > 0
     OR position('is an immutable historical record' IN v_def) = 0 THEN
    RAISE EXCEPTION '20270113000000 rollback postcondition: the guard body is not the 20261229000000 version';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                  WHERE t.tgrelid = 'public.outreach_bridge_handoffs'::regclass
                    AND t.tgname = 'trg_outreach_bridge_handoffs_guard'
                    AND t.tgfoid = 'public.outreach_bridge_handoffs_guard()'::regprocedure
                    AND t.tgenabled <> 'D') THEN
    RAISE EXCEPTION '20270113000000 rollback postcondition: trg_outreach_bridge_handoffs_guard missing or disabled';
  END IF;
END
$verify$;

COMMIT;
