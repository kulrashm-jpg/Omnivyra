-- Orchestration, Follow-up E: the durable record that an operator SAW a possible prior send.
--
-- WHAT A ROW MEANS. "This authenticated person acknowledged, at this time, that these
-- unresolved uncertain communications may already have reached the person, before this
-- operation (ending a run, or enrolling the person again)." Nothing more:
--   - it is NOT an approval: it authorizes no send and bypasses no check. Consent,
--     suppression, opt-out, approval, frequency, tenant policy and the engine claim stay
--     mandatory for every later step;
--   - it does NOT resolve anything: the ledger row stays `uncertain` (that is the
--     20261230000000 guard, unchanged), and nothing is marked sent or delivered;
--   - it is NOT reusable: `acknowledgement_key` binds the tenant, the operation, the run it
--     anchors on, the person who acknowledged and the exact set of communications. A later
--     operation, another operator or a changed set computes another key.
--
-- WHY A NEW TABLE. Nothing existing can hold it without changing what it means:
--   execution_journey_decisions  its `decision` CHECK and `step_or_exit` rule have no
--                                acknowledgement, and the sweeper, the journey report, the
--                                events feed and the approval preview all read it
--   execution_engine_requests    acknowledging must never move a request (no new column)
--   capability_audit_log         the security stream: it never fails its caller and has no
--                                idempotency key, so it could not gate an operation
--   execution_approvals          an approval store; an acknowledgement must not be one
--
-- IDEMPOTENT. UNIQUE (organization_id, acknowledgement_key): a retried or concurrent
-- request converges on one row. APPEND-ONLY: an UPDATE is refused, and service_role is
-- granted SELECT and INSERT only (hosted Supabase grants ALL on a new table, so this
-- migration revokes first and asserts the result).
--
-- NO PERSONAL DATA. `communications` holds ledger ids, engines, channels, queue times and
-- the engine's own reference (a broadcast or community action id). No address, name or
-- content. The person is reached only through `execution_instance_id`, as every other
-- Orchestration record does.
--
-- ORDERING. Orchestration block 20270129000000-09 (version-reservations.json); after D-2's
-- 20270129000001. It references only tables that sort before it. Forward only; rollback in
-- rollbacks/uncertain_communication_acknowledgements_rollback.sql.

CREATE TABLE IF NOT EXISTS public.execution_uncertain_acknowledgements (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid        NOT NULL,
  operation              text        NOT NULL,
  -- end_run: the run being ended. reenrol: the person's latest run when they were warned.
  execution_instance_id  uuid        NOT NULL,
  -- reenrol only: where the new run would start.
  campaign_id            uuid,
  workflow_id            uuid,
  actor_user_id          uuid        NOT NULL,
  -- [{ requestId, executionTaskId, executionInstanceId, engine, channel, queuedAt, reference }]
  communications         jsonb       NOT NULL,
  -- True when the history could not be read and the operator acknowledged THAT instead.
  history_unreadable     boolean     NOT NULL DEFAULT false,
  acknowledgement_key    text        NOT NULL,
  acknowledged_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT execution_uncertain_acks_operation_valid
    CHECK (operation IN ('end_run', 'reenrol')),
  CONSTRAINT execution_uncertain_acks_reenrol_target
    CHECK ((operation = 'reenrol') = (campaign_id IS NOT NULL AND workflow_id IS NOT NULL)),
  CONSTRAINT execution_uncertain_acks_communications_array
    CHECK (jsonb_typeof(communications) = 'array'),
  CONSTRAINT execution_uncertain_acks_something_acknowledged
    CHECK (history_unreadable OR jsonb_array_length(communications) > 0),
  CONSTRAINT execution_uncertain_acks_key_shape
    CHECK (acknowledgement_key ~ '^[0-9a-f]{64}$'),

  CONSTRAINT execution_uncertain_acks_key_unique
    UNIQUE (organization_id, acknowledgement_key),

  CONSTRAINT execution_uncertain_acks_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT execution_uncertain_acks_instance_fk
    FOREIGN KEY (execution_instance_id) REFERENCES public.execution_instances (id) ON DELETE NO ACTION
);

CREATE INDEX IF NOT EXISTS ix_execution_uncertain_acks_instance
  ON public.execution_uncertain_acknowledgements (organization_id, execution_instance_id, acknowledged_at);

CREATE OR REPLACE FUNCTION public.execution_uncertain_acknowledgements_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'execution_uncertain_acknowledgements: an acknowledgement is a historical record and does not change'
    USING ERRCODE = '23514';
END
$$;

REVOKE ALL ON FUNCTION public.execution_uncertain_acknowledgements_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.execution_uncertain_acknowledgements_guard() FROM anon;
REVOKE ALL ON FUNCTION public.execution_uncertain_acknowledgements_guard() FROM authenticated;

DROP TRIGGER IF EXISTS trg_execution_uncertain_acknowledgements_guard ON public.execution_uncertain_acknowledgements;
CREATE TRIGGER trg_execution_uncertain_acknowledgements_guard
  BEFORE UPDATE ON public.execution_uncertain_acknowledgements
  FOR EACH ROW EXECUTE FUNCTION public.execution_uncertain_acknowledgements_guard();

ALTER TABLE public.execution_uncertain_acknowledgements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS execution_uncertain_acknowledgements_service_role ON public.execution_uncertain_acknowledgements;
CREATE POLICY execution_uncertain_acknowledgements_service_role ON public.execution_uncertain_acknowledgements
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Revoke first: hosted Supabase grants ALL on a new table to anon, authenticated and service_role.
REVOKE ALL ON public.execution_uncertain_acknowledgements FROM PUBLIC;
REVOKE ALL ON public.execution_uncertain_acknowledgements FROM anon, authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'REVOKE ALL ON public.execution_uncertain_acknowledgements FROM service_role';
    EXECUTE 'GRANT SELECT, INSERT ON public.execution_uncertain_acknowledgements TO service_role';
  END IF;
END
$$;

COMMENT ON TABLE public.execution_uncertain_acknowledgements IS
  'Orchestration Follow-up E: an operator acknowledged a possible prior send before ending a run or enrolling the person again. Append-only. Not an approval; resolves nothing. Ids, engines, channels and times only.';

-- Postconditions.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = 'public.execution_uncertain_acknowledgements'::regclass AND contype = 'f';
  IF n <> 2 THEN
    RAISE EXCEPTION 'orchestration postcondition: % foreign keys on execution_uncertain_acknowledgements, expected 2', n;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.execution_uncertain_acknowledgements'::regclass
       AND conname = 'execution_uncertain_acks_key_unique' AND contype = 'u'
  ) THEN
    RAISE EXCEPTION 'orchestration postcondition: acknowledgement idempotency is unenforced';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.execution_uncertain_acknowledgements'::regclass
       AND tgname = 'trg_execution_uncertain_acknowledgements_guard'
  ) THEN
    RAISE EXCEPTION 'orchestration postcondition: the append-only guard is missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND has_table_privilege('anon', 'public.execution_uncertain_acknowledgements', 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'orchestration postcondition: anon can reach execution_uncertain_acknowledgements';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
     AND has_table_privilege('authenticated', 'public.execution_uncertain_acknowledgements', 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'orchestration postcondition: authenticated can reach execution_uncertain_acknowledgements';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')
     AND has_table_privilege('service_role', 'public.execution_uncertain_acknowledgements', 'UPDATE,DELETE,TRUNCATE') THEN
    RAISE EXCEPTION 'orchestration postcondition: service_role can change or remove an acknowledgement';
  END IF;
END
$$;
