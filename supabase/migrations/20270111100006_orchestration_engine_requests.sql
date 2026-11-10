-- Orchestration — the engine request ledger for engines OTHER than WS-3.
--
-- WHAT THIS ADDS
--   ONE table, `execution_engine_requests`: the durable record of the single
--   request the orchestrator made of an engine for ONE execution task, and that
--   request's result. WS-3 work keeps its own, existing record
--   (`outreach_bridge_handoffs` → `outreach_tasks`); this ledger exists because an
--   engine with no such bridge (WhatsApp broadcast today) would otherwise give the
--   orchestrator nowhere to make a request idempotent.
--
-- ─── WHY IT IS NEEDED ─────────────────────────────────────────────────────
--   A sweep can crash between asking an engine to act and recording that it did,
--   and two sweeps can race for the same ready step. Without a per-task unique
--   request row, either case could create a second engine request — a second
--   WhatsApp message to the same person. `UNIQUE (organization_id,
--   execution_task_id)` makes the request itself the claim: exactly one row, and
--   its `external_ref` (the engine's own id, e.g. the broadcast) is set once.
--
-- ─── WHAT IT IS NOT ───────────────────────────────────────────────────────
--   Not a communication ledger: no recipient, address, content or provider
--   payload is stored here (the engine keeps its own, already-governed records).
--   Not a queue, not a scheduler, not an outcome store: outcomes stay in the
--   engines' canonical tables; `state` only says whether the request is still in
--   flight and how the journey step was settled.
--
-- Additive only. No existing table, constraint, index, trigger or policy is
-- altered.

DO $$
BEGIN
  IF to_regclass('public.execution_tasks') IS NULL THEN
    RAISE EXCEPTION 'orchestration: execution_tasks is absent — 20261228000001 must be applied first';
  END IF;
  IF to_regclass('public.uq_execution_tasks_id_org') IS NULL THEN
    RAISE EXCEPTION 'orchestration: uq_execution_tasks_id_org is missing — 20261229000000 must be applied first';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.execution_engine_requests (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid        NOT NULL,
  execution_task_id  uuid        NOT NULL,
  engine             text        NOT NULL,
  state              text        NOT NULL DEFAULT 'requested',
  -- The engine's own identifier for the work (e.g. whatsapp_broadcasts.id), set
  -- exactly once by the request's single owner.
  external_ref       text,
  -- A code-level summary of why the request ended as it did. Never personal data.
  detail             text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT execution_engine_requests_engine_valid
    CHECK (engine IN ('whatsapp')),
  CONSTRAINT execution_engine_requests_state_valid
    CHECK (state IN ('requested', 'submitting', 'submitted', 'completed', 'skipped', 'failed', 'uncertain')),
  CONSTRAINT execution_engine_requests_detail_length
    CHECK (detail IS NULL OR length(detail) <= 500),
  CONSTRAINT execution_engine_requests_submitted_has_ref
    CHECK (state NOT IN ('submitted', 'completed') OR external_ref IS NOT NULL),

  -- ONE request per execution task, per tenant: the idempotency guarantee.
  CONSTRAINT execution_engine_requests_task_unique
    UNIQUE (organization_id, execution_task_id),

  CONSTRAINT execution_engine_requests_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT execution_engine_requests_task_tenant_fk
    FOREIGN KEY (execution_task_id, organization_id)
    REFERENCES public.execution_tasks (id, organization_id) ON DELETE NO ACTION
);

CREATE INDEX IF NOT EXISTS ix_execution_engine_requests_open
  ON public.execution_engine_requests (organization_id, state)
  WHERE state IN ('requested', 'submitting', 'submitted');

-- The ledger's identity never moves: a request cannot be re-pointed at another
-- task, tenant or engine, and an external reference, once set, is permanent.
CREATE OR REPLACE FUNCTION public.execution_engine_requests_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id   IS DISTINCT FROM OLD.organization_id
  OR NEW.execution_task_id IS DISTINCT FROM OLD.execution_task_id
  OR NEW.engine            IS DISTINCT FROM OLD.engine THEN
    RAISE EXCEPTION 'execution_engine_requests: identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.external_ref IS NOT NULL AND NEW.external_ref IS DISTINCT FROM OLD.external_ref THEN
    RAISE EXCEPTION 'execution_engine_requests: external_ref is set once' USING ERRCODE = '23514';
  END IF;
  IF OLD.state IN ('completed', 'skipped', 'failed', 'uncertain') AND NEW.state IS DISTINCT FROM OLD.state THEN
    RAISE EXCEPTION 'execution_engine_requests: a settled request does not move' USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_execution_engine_requests_guard ON public.execution_engine_requests;
CREATE TRIGGER trg_execution_engine_requests_guard
  BEFORE UPDATE ON public.execution_engine_requests
  FOR EACH ROW EXECUTE FUNCTION public.execution_engine_requests_guard();

ALTER TABLE public.execution_engine_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS execution_engine_requests_service_role ON public.execution_engine_requests;
CREATE POLICY execution_engine_requests_service_role ON public.execution_engine_requests
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.execution_engine_requests FROM anon, authenticated;

COMMENT ON TABLE public.execution_engine_requests IS
  'Orchestration: the one request made of a non-WS-3 engine per execution task, and how it settled. No recipient, address or content.';

-- Postconditions.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = 'public.execution_engine_requests'::regclass AND contype = 'f';
  IF n <> 2 THEN
    RAISE EXCEPTION 'orchestration postcondition: % foreign keys on execution_engine_requests, expected 2', n;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.execution_engine_requests'::regclass
       AND conname = 'execution_engine_requests_task_unique' AND contype = 'u'
  ) THEN
    RAISE EXCEPTION 'orchestration postcondition: the per-task uniqueness is missing — requests would not be idempotent';
  END IF;
END
$$;
