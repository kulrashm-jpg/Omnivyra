-- WS-3 Milestone-1 — Lead Outreach Execution durable storage (ADDITIVE ONLY).
--
-- Creates the persistence layer for the WS-3 Lead Outreach Execution Runtime.
-- NOTHING in this migration executes, dispatches, queues or contacts anyone —
-- it defines where execution state will live, and enforces the immutability the
-- frozen architecture requires. See docs/WS3-ARCHITECTURE.md.
--
-- Modifies NOTHING existing. Does not touch lead_intelligence_profiles,
-- outreach_plans (a separate opportunity-scoped artifact WS-3 must not write),
-- or the decommissioned legacy lead_outreach_plans.
--
-- WHY DATABASE-ENFORCED IMMUTABILITY. The architecture calls the version fields
-- and the audit trail immutable. Convention alone cannot deliver that: an audit
-- record that a later bug can silently rewrite is not an audit record. The
-- triggers below make mutation impossible rather than merely discouraged, which
-- matters because these tables answer "who authorised contacting this person,
-- under which rules" — a question that must survive the code that wrote it.
--
-- Tenant isolation mirrors the existing service-role RLS pattern; every table is
-- company-scoped via company_id.
--
-- WHY ON DELETE RESTRICT, NOT CASCADE. A cascade would attempt a DELETE on the
-- child audit rows, which the append-only trigger correctly refuses — so a
-- declared cascade is unachievable and silently defeated. RESTRICT states the
-- real, intended rule instead: a task that has accumulated audit history cannot
-- be deleted, because deleting it would destroy the record of who authorised
-- contacting someone. Retention-driven removal (required before M5 per the
-- architecture) needs a deliberate, privileged path that disables the guards
-- explicitly — never an incidental cascade.

-- ── shared guards ───────────────────────────────────────────────────────────

-- Rejects ANY update or delete. Used on the five append-only audit tables.
CREATE OR REPLACE FUNCTION ws3_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ws3_append_only: % is append-only; % is not permitted',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

-- Rejects updates that would alter the immutable materialisation contract.
-- Everything else on outreach_tasks (status, delivery_status, updated_at) stays
-- mutable — the task's CURRENT state changes; the record of how it came to
-- exist does not.
CREATE OR REPLACE FUNCTION ws3_protect_task_provenance() RETURNS trigger AS $$
BEGIN
  IF NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.lead_id IS DISTINCT FROM OLD.lead_id
     OR NEW.plan_task_id IS DISTINCT FROM OLD.plan_task_id
     OR NEW.planner_version IS DISTINCT FROM OLD.planner_version
     OR NEW.translation_version IS DISTINCT FROM OLD.translation_version
     OR NEW.governance_version IS DISTINCT FROM OLD.governance_version
     OR NEW.execution_runtime_version IS DISTINCT FROM OLD.execution_runtime_version
     OR NEW.materialized_at IS DISTINCT FROM OLD.materialized_at THEN
    RAISE EXCEPTION 'ws3_immutable_provenance: identity and version fields are immutable after materialisation'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── 1. outreach_tasks — the canonical execution unit ────────────────────────
--
-- The ONLY table in this milestone with mutable columns: a task's status moves
-- as it progresses. Its identity and provenance never do.

CREATE TABLE IF NOT EXISTS outreach_tasks (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                text NOT NULL,
  lead_id                   text NOT NULL,

  -- Idempotency anchor. `plan_task_id` is the planner's deterministic
  -- `task-<order>-<slug>`; because plans regenerate deterministically, the same
  -- logical task yields the same key across regenerations. This unique
  -- constraint is what stops a regenerated plan re-sending completed work.
  plan_task_id              text NOT NULL,

  -- Materialised shape of the WS-2 AutomationTask. Mirrored, never referenced:
  -- the plan is disposable and regenerated, so a task must stand alone.
  task_order                integer,
  kind                      text,
  action                    text,
  channel                   text,
  depends_on_plan_task_id   text,
  estimated_delay_hours     numeric,
  confidence                numeric,
  explanation               text,

  -- Lifecycle. Storage + validation only in M1; no transition executes.
  status                    text NOT NULL DEFAULT 'pending',
  -- Delivery axis, orthogonal to business outcomes (which live in their own
  -- table). NULL until a dispatch attempt exists.
  delivery_status           text,
  requires_approval         boolean NOT NULL DEFAULT false,

  -- Immutable provenance, captured once at materialisation. Descriptive, NOT
  -- dispatch-controlling: governance is evaluated at dispatch against current
  -- rules, and each attempt separately records the version in force then.
  planner_version           text NOT NULL,
  translation_version       text NOT NULL,
  governance_version        text NOT NULL,
  execution_runtime_version text NOT NULL,
  materialized_at           timestamptz NOT NULL,

  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT outreach_tasks_identity_unique UNIQUE (company_id, lead_id, plan_task_id),
  CONSTRAINT outreach_tasks_company_not_blank CHECK (length(btrim(company_id)) > 0),
  CONSTRAINT outreach_tasks_lead_not_blank CHECK (length(btrim(lead_id)) > 0),
  CONSTRAINT outreach_tasks_plan_task_not_blank CHECK (length(btrim(plan_task_id)) > 0),
  CONSTRAINT outreach_tasks_status_valid CHECK (status IN (
    'pending', 'awaiting_approval', 'approved', 'rejected', 'queued',
    'dispatching', 'sent', 'delivered', 'completed', 'failed', 'retried',
    'paused', 'resumed', 'escalated', 'reassigned', 'cancelled', 'expired'
  )),
  CONSTRAINT outreach_tasks_delivery_status_valid CHECK (delivery_status IS NULL OR delivery_status IN (
    'queued', 'dispatched', 'confirmed', 'sent_unverified', 'delivered',
    'bounced', 'failed', 'suppressed', 'expired'
  ))
);

CREATE INDEX IF NOT EXISTS idx_outreach_tasks_company_status
  ON outreach_tasks (company_id, status);
CREATE INDEX IF NOT EXISTS idx_outreach_tasks_company_lead
  ON outreach_tasks (company_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_outreach_tasks_awaiting_approval
  ON outreach_tasks (company_id, materialized_at)
  WHERE status = 'awaiting_approval';

DO $$ BEGIN
  CREATE TRIGGER outreach_tasks_protect_provenance
    BEFORE UPDATE ON outreach_tasks
    FOR EACH ROW EXECUTE FUNCTION ws3_protect_task_provenance();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. outreach_approvals — append-only ─────────────────────────────────────
-- Who authorised contact, when, and on what basis. Never rewritten.

CREATE TABLE IF NOT EXISTS outreach_approvals (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           text NOT NULL,
  task_id              uuid NOT NULL REFERENCES outreach_tasks(id) ON DELETE RESTRICT,
  decision             text NOT NULL,
  approver_user_id     text,
  reason               text,
  -- Snapshot of HumanReviewAssessment.missingInformation at decision time.
  missing_information  jsonb NOT NULL DEFAULT '[]'::jsonb,
  decided_at           timestamptz NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outreach_approvals_decision_valid CHECK (decision IN ('approved', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_outreach_approvals_task ON outreach_approvals (company_id, task_id, decided_at DESC);

-- ── 3. outreach_attempts — append-only ──────────────────────────────────────
-- One row per dispatch attempt. `governance_version` here is the version in
-- force AT THIS ATTEMPT, deliberately separate from the task's materialisation
-- version: without the distinction, tightening a rule would appear
-- retroactively to have governed earlier sends.

CREATE TABLE IF NOT EXISTS outreach_attempts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          text NOT NULL,
  task_id             uuid NOT NULL REFERENCES outreach_tasks(id) ON DELETE RESTRICT,
  attempt_number      integer NOT NULL,
  channel             text,
  transport           text,
  governance_version  text,
  outcome             text,
  error               text,
  started_at          timestamptz NOT NULL,
  completed_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outreach_attempts_number_positive CHECK (attempt_number >= 1),
  CONSTRAINT outreach_attempts_unique UNIQUE (company_id, task_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_outreach_attempts_task ON outreach_attempts (company_id, task_id, attempt_number);

-- ── 4. outreach_delivery_evidence — append-only ─────────────────────────────
-- What the transport told us. `confirmed` ≡ the community runtime's `executed`
-- (platform-confirmed write); `sent_unverified` carries the same meaning in
-- both runtimes. Recorded as a mapping so the two stay interpretable together.

CREATE TABLE IF NOT EXISTS outreach_delivery_evidence (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         text NOT NULL,
  task_id            uuid NOT NULL REFERENCES outreach_tasks(id) ON DELETE RESTRICT,
  attempt_id         uuid REFERENCES outreach_attempts(id) ON DELETE RESTRICT,
  delivery_status    text NOT NULL,
  transport_response jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed_at        timestamptz NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outreach_delivery_status_valid CHECK (delivery_status IN (
    'queued', 'dispatched', 'confirmed', 'sent_unverified', 'delivered',
    'bounced', 'failed', 'suppressed', 'expired'
  ))
);

CREATE INDEX IF NOT EXISTS idx_outreach_delivery_task ON outreach_delivery_evidence (company_id, task_id, observed_at DESC);

-- ── 5. outreach_outcomes — append-only (business axis) ──────────────────────
-- Recipient behaviour. Orthogonal to delivery: a task can be `confirmed` on
-- delivery and `no_response` here at the same time, which is the most
-- operationally meaningful combination in outreach — hence a separate table
-- rather than a second column.
--
-- `derived` marks outcomes asserted by an elapsed-window rule rather than
-- observed. `no_response` is always derived. `opened`, `clicked` and
-- `meeting_booked` are defined but NOT observable on any transport this
-- platform has today; they exist so the model need not change when
-- instrumentation arrives.
--
-- The unique constraint is the architecture's feedback idempotency key, so an
-- at-least-once emission cannot record the same outcome twice.

CREATE TABLE IF NOT EXISTS outreach_outcomes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   text NOT NULL,
  task_id      uuid NOT NULL REFERENCES outreach_tasks(id) ON DELETE RESTRICT,
  outcome_type text NOT NULL,
  derived      boolean NOT NULL DEFAULT false,
  evidence     jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at  timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outreach_outcomes_type_valid CHECK (outcome_type IN (
    'opened', 'clicked', 'replied', 'meeting_booked', 'rejected', 'no_response'
  )),
  CONSTRAINT outreach_outcomes_idempotent UNIQUE (company_id, task_id, outcome_type, occurred_at)
);

CREATE INDEX IF NOT EXISTS idx_outreach_outcomes_task ON outreach_outcomes (company_id, task_id, occurred_at DESC);

-- ── 6. outreach_decisions — append-only (execution decision log) ────────────
-- Every governance decision, allowed or denied. A denial that leaves no record
-- is indistinguishable from a task nobody tried to send.
--
-- `gate` mirrors the frozen dispatch ordering: kill_switch → suppression →
-- region → approval → rate_limit → transport. `limiter_layer` records which
-- layer of the durable two-layer limiter answered, matching the pattern already
-- proven by whatsappRateLimiter.

CREATE TABLE IF NOT EXISTS outreach_decisions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         text NOT NULL,
  task_id            uuid REFERENCES outreach_tasks(id) ON DELETE RESTRICT,
  gate               text NOT NULL,
  decision           text NOT NULL,
  reason             text,
  scope              text,
  limiter_layer      text,
  governance_version text,
  decided_at         timestamptz NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outreach_decisions_decision_valid CHECK (decision IN ('allowed', 'denied')),
  CONSTRAINT outreach_decisions_gate_valid CHECK (gate IN (
    'kill_switch', 'suppression', 'region', 'approval', 'rate_limit', 'transport'
  )),
  CONSTRAINT outreach_decisions_limiter_layer_valid CHECK (limiter_layer IS NULL OR limiter_layer IN ('redis', 'db'))
);

CREATE INDEX IF NOT EXISTS idx_outreach_decisions_task ON outreach_decisions (company_id, task_id, decided_at DESC);
CREATE INDEX IF NOT EXISTS idx_outreach_decisions_denied ON outreach_decisions (company_id, gate, decided_at DESC)
  WHERE decision = 'denied';

-- ── append-only enforcement ─────────────────────────────────────────────────

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'outreach_approvals', 'outreach_attempts', 'outreach_delivery_evidence',
    'outreach_outcomes', 'outreach_decisions'
  ] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS %I ON %I', t || '_append_only', t
    );
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION ws3_reject_mutation()',
      t || '_append_only', t
    );
  END LOOP;
END $$;

-- ── row level security ──────────────────────────────────────────────────────
-- Mirrors the existing service-role pattern used by lead_intelligence_profiles.
-- Application-layer tenant isolation remains the primary control (the service
-- role bypasses RLS); this is defence in depth, not the only guard.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'outreach_tasks', 'outreach_approvals', 'outreach_attempts',
    'outreach_delivery_evidence', 'outreach_outcomes', 'outreach_decisions'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    BEGIN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')',
        t || '_service_role', t
      );
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END LOOP;
END $$;
