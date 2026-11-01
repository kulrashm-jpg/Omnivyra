-- Orchestration — the durable journey decision record.
--
-- WHY A NEW TABLE. The sweeper decides per person and per step (executed, skipped
-- by a condition, deferred by frequency, waiting on an engine, needs a human,
-- exited on a response) and until now that decision lived only in the sweep's
-- return value. Nothing existing can hold it:
--   execution_plan_steps       the resulting state only, with no reason, and most
--                              decisions (waiting, deferred, needs_human) move no state
--   execution_engine_requests  non-WS-3 engines only, one row per task, and only
--                              once an engine was asked; a skip never reaches it
--   capability_audit_log       the security audit stream: no run or step key to
--                              read a journey back by
--
-- WHAT A ROW MEANS. "This decision was first reached for this step (or run) at
-- this time." `decision_key` is unique per run, so a sweep repeating the same
-- decision every cycle writes nothing and a CHANGED decision is a new row. The
-- table is append-only: a decision is a historical record.
--
-- NO PERSONAL DATA. `reasons` holds codes and condition descriptions, never a fact
-- value, an address or message content (journeyPolicy.ts `ConditionVerdict`), so
-- person erasure has nothing to redact here.
--
-- ORDERING. Sorts after the orchestration stack (20261226..20261231) and after the
-- release-candidate and in-flight PI migrations (through 20270116). Forward only;
-- rollback in rollbacks/orchestration_journey_decisions_rollback.sql.

CREATE TABLE IF NOT EXISTS public.execution_journey_decisions (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid        NOT NULL,
  execution_instance_id  uuid        NOT NULL,
  -- NULL only for a run-level decision (`exited`).
  plan_step_id           uuid,
  step_key               text,
  channel                text,
  engine                 text,
  decision               text        NOT NULL,
  -- The engine's own word, or the response that ended the journey.
  outcome                text,
  reasons                jsonb       NOT NULL DEFAULT '[]'::jsonb,
  decision_key           text        NOT NULL,
  decided_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT execution_journey_decisions_decision_valid
    CHECK (decision IN ('executed', 'skipped', 'deferred', 'waiting', 'needs_human', 'unsupported', 'exited')),
  CONSTRAINT execution_journey_decisions_reasons_array
    CHECK (jsonb_typeof(reasons) = 'array'),
  CONSTRAINT execution_journey_decisions_key_not_blank
    CHECK (length(btrim(decision_key)) > 0),
  CONSTRAINT execution_journey_decisions_step_or_exit
    CHECK ((plan_step_id IS NULL) = (decision = 'exited')),

  -- The idempotency guarantee: a repeated decision converges on one row.
  CONSTRAINT execution_journey_decisions_key_unique
    UNIQUE (organization_id, execution_instance_id, decision_key),

  CONSTRAINT execution_journey_decisions_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT execution_journey_decisions_instance_fk
    FOREIGN KEY (execution_instance_id) REFERENCES public.execution_instances (id) ON DELETE NO ACTION,
  CONSTRAINT execution_journey_decisions_step_fk
    FOREIGN KEY (plan_step_id, organization_id)
    REFERENCES public.execution_plan_steps (id, organization_id) ON DELETE NO ACTION
);

CREATE INDEX IF NOT EXISTS ix_execution_journey_decisions_instance
  ON public.execution_journey_decisions (organization_id, execution_instance_id, decided_at);

CREATE INDEX IF NOT EXISTS ix_execution_journey_decisions_needs_human
  ON public.execution_journey_decisions (organization_id, decided_at)
  WHERE decision = 'needs_human';

CREATE OR REPLACE FUNCTION public.execution_journey_decisions_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'execution_journey_decisions: a decision is a historical record and does not change'
    USING ERRCODE = '23514';
END
$$;

REVOKE ALL ON FUNCTION public.execution_journey_decisions_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.execution_journey_decisions_guard() FROM anon;
REVOKE ALL ON FUNCTION public.execution_journey_decisions_guard() FROM authenticated;

DROP TRIGGER IF EXISTS trg_execution_journey_decisions_guard ON public.execution_journey_decisions;
CREATE TRIGGER trg_execution_journey_decisions_guard
  BEFORE UPDATE ON public.execution_journey_decisions
  FOR EACH ROW EXECUTE FUNCTION public.execution_journey_decisions_guard();

ALTER TABLE public.execution_journey_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS execution_journey_decisions_service_role ON public.execution_journey_decisions;
CREATE POLICY execution_journey_decisions_service_role ON public.execution_journey_decisions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.execution_journey_decisions FROM anon, authenticated;
GRANT SELECT, INSERT ON public.execution_journey_decisions TO service_role;

COMMENT ON TABLE public.execution_journey_decisions IS
  'Orchestration: each decision first reached for a journey step or run. Append-only. Codes and condition descriptions only; no address, fact value or content.';

-- Postconditions.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = 'public.execution_journey_decisions'::regclass AND contype = 'f';
  IF n <> 3 THEN
    RAISE EXCEPTION 'orchestration postcondition: % foreign keys on execution_journey_decisions, expected 3', n;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.execution_journey_decisions'::regclass
       AND conname = 'execution_journey_decisions_key_unique' AND contype = 'u'
  ) THEN
    RAISE EXCEPTION 'orchestration postcondition: decision idempotency is unenforced';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.execution_journey_decisions'::regclass
       AND tgname = 'trg_execution_journey_decisions_guard'
  ) THEN
    RAISE EXCEPTION 'orchestration postcondition: the append-only guard is missing';
  END IF;
END
$$;
