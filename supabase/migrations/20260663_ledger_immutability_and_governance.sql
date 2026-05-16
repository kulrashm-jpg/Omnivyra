-- Enterprise credit ledger Phase 1 — C-3 (immutability) + C-4 (governance) + C-1 (queue registry)
--
-- This migration is the foundation for the audit's CRITICAL gap closures.
-- It is intentionally pure SQL — application code is migrated in subsequent
-- patches and is kept backward-compatible via feature flags.
--
-- Sections:
--   §1  Immutability triggers on financial ledger tables (C-3)
--   §2  Mutable operational fields offloaded to side tables (C-3)
--   §3  Approval workflow tables + thresholds + signatures (C-4)
--   §4  Job execution registry for queue exactly-once billing (C-1)
--   §5  Admin financial audit events (C-4 / governance hardening)
--   §6  Billing operation tracking (Phase A orchestrator)
--
-- All tables use the existing trg_*_updated_at convention where mutable.
-- All immutability triggers raise EXCEPTION on UPDATE/DELETE with a clear
-- billing-incident message — service code must use compensating inserts.

------------------------------------------------------------------------------
-- §1  IMMUTABILITY GUARDS
------------------------------------------------------------------------------

-- A single shared trigger function — table name is included so incidents can
-- be routed to the correct runbook. Service code that legitimately needs to
-- alter operational state must use the side tables introduced in §2.

CREATE OR REPLACE FUNCTION public.raise_ledger_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'LEDGER_IMMUTABLE: row in % is append-only and cannot be % (id=%, audit-violation)',
    TG_TABLE_NAME, TG_OP, COALESCE(OLD.id::text, '<unknown>')
    USING ERRCODE = 'P0001';
END;
$$;

-- credit_transactions — the canonical append-only financial ledger.
DROP TRIGGER IF EXISTS credit_transactions_immutable_update ON public.credit_transactions;
CREATE TRIGGER credit_transactions_immutable_update
  BEFORE UPDATE ON public.credit_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.raise_ledger_immutable();

DROP TRIGGER IF EXISTS credit_transactions_immutable_delete ON public.credit_transactions;
CREATE TRIGGER credit_transactions_immutable_delete
  BEFORE DELETE ON public.credit_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.raise_ledger_immutable();

-- credit_admin_grants — operator grant audit row.
DROP TRIGGER IF EXISTS credit_admin_grants_immutable_update ON public.credit_admin_grants;
CREATE TRIGGER credit_admin_grants_immutable_update
  BEFORE UPDATE ON public.credit_admin_grants
  FOR EACH ROW
  EXECUTE FUNCTION public.raise_ledger_immutable();

DROP TRIGGER IF EXISTS credit_admin_grants_immutable_delete ON public.credit_admin_grants;
CREATE TRIGGER credit_admin_grants_immutable_delete
  BEFORE DELETE ON public.credit_admin_grants
  FOR EACH ROW
  EXECUTE FUNCTION public.raise_ledger_immutable();

-- super_admin_audit_logs — cross-cutting admin action audit.
DROP TRIGGER IF EXISTS super_admin_audit_logs_immutable_update ON public.super_admin_audit_logs;
CREATE TRIGGER super_admin_audit_logs_immutable_update
  BEFORE UPDATE ON public.super_admin_audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.raise_ledger_immutable();

DROP TRIGGER IF EXISTS super_admin_audit_logs_immutable_delete ON public.super_admin_audit_logs;
CREATE TRIGGER super_admin_audit_logs_immutable_delete
  BEFORE DELETE ON public.super_admin_audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.raise_ledger_immutable();

-- payment_provider_events — webhook dedup + processing audit (financial-evidential).
DROP TRIGGER IF EXISTS payment_provider_events_immutable_delete ON public.payment_provider_events;
CREATE TRIGGER payment_provider_events_immutable_delete
  BEFORE DELETE ON public.payment_provider_events
  FOR EACH ROW
  EXECUTE FUNCTION public.raise_ledger_immutable();

-- payment_provider_events has legitimately mutable fields (processing_status,
-- processed_at, error_message) — we move those off to a side table in §2 and
-- block all UPDATEs on the parent row.
DROP TRIGGER IF EXISTS payment_provider_events_immutable_update ON public.payment_provider_events;
CREATE TRIGGER payment_provider_events_immutable_update
  BEFORE UPDATE ON public.payment_provider_events
  FOR EACH ROW
  EXECUTE FUNCTION public.raise_ledger_immutable();

------------------------------------------------------------------------------
-- §2  OPERATIONAL SIDE TABLES (1:1 with parent ledger rows)
------------------------------------------------------------------------------
-- Pattern: the financial row is immutable; status/processing state lives in a
-- sibling table that is freely UPDATEable. Reconciliation joins these to
-- present a single logical view.

-- For payment_provider_events: status / processed_at / error_message
CREATE TABLE IF NOT EXISTS public.payment_provider_event_state (
  provider_event_pk   uuid PRIMARY KEY REFERENCES public.payment_provider_events(id) ON DELETE RESTRICT,
  processing_status   text NOT NULL DEFAULT 'recorded'
    CHECK (processing_status IN ('recorded', 'processed', 'duplicate', 'failed', 'requeued')),
  processed_at        timestamptz,
  error_message       text,
  retry_count         integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ppe_state_status
  ON public.payment_provider_event_state(processing_status, updated_at DESC);

DROP TRIGGER IF EXISTS trg_ppe_state_touch ON public.payment_provider_event_state;
CREATE TRIGGER trg_ppe_state_touch
  BEFORE UPDATE ON public.payment_provider_event_state
  FOR EACH ROW
  EXECUTE FUNCTION public.omnivyra_touch_updated_at();

-- Backfill any existing rows so the side table is in sync with the parent.
-- NOTE: rows already in payment_provider_events keep their inline columns for
-- backward compatibility; new writes should still populate them via the RPC,
-- but service code should READ from the side table. The immutability trigger
-- above means future writes must go via record_payment_provider_event() (which
-- is an INSERT, not an UPDATE) and via the new advance_payment_provider_event_state RPC.
INSERT INTO public.payment_provider_event_state (
  provider_event_pk, processing_status, processed_at, error_message
)
SELECT id, processing_status, processed_at, error_message
FROM public.payment_provider_events
ON CONFLICT (provider_event_pk) DO NOTHING;

CREATE OR REPLACE FUNCTION public.advance_payment_provider_event_state(
  p_event_id uuid,
  p_status text,
  p_error text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_state public.payment_provider_event_state%ROWTYPE;
BEGIN
  IF p_event_id IS NULL THEN
    RAISE EXCEPTION 'event_id is required';
  END IF;
  IF p_status NOT IN ('recorded', 'processed', 'duplicate', 'failed', 'requeued') THEN
    RAISE EXCEPTION 'invalid status %', p_status;
  END IF;

  INSERT INTO public.payment_provider_event_state (provider_event_pk, processing_status, processed_at, error_message)
  VALUES (p_event_id, p_status, CASE WHEN p_status IN ('processed','duplicate') THEN now() ELSE NULL END, p_error)
  ON CONFLICT (provider_event_pk) DO UPDATE
    SET processing_status = EXCLUDED.processing_status,
        processed_at      = COALESCE(EXCLUDED.processed_at, public.payment_provider_event_state.processed_at),
        error_message     = EXCLUDED.error_message,
        retry_count       = public.payment_provider_event_state.retry_count + 1,
        updated_at        = now()
    RETURNING * INTO v_state;

  RETURN jsonb_build_object(
    'provider_event_pk', v_state.provider_event_pk,
    'processing_status', v_state.processing_status,
    'processed_at',      v_state.processed_at,
    'retry_count',       v_state.retry_count
  );
END;
$$;

------------------------------------------------------------------------------
-- §3  APPROVAL WORKFLOW (C-4)
------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.credit_action_approval_thresholds (
  action_type             text NOT NULL,
  amount_threshold_credits integer,
  required_approvals      integer NOT NULL CHECK (required_approvals >= 1),
  is_active               boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (action_type, amount_threshold_credits)
);

DROP TRIGGER IF EXISTS trg_catt_touch ON public.credit_action_approval_thresholds;
CREATE TRIGGER trg_catt_touch
  BEFORE UPDATE ON public.credit_action_approval_thresholds
  FOR EACH ROW
  EXECUTE FUNCTION public.omnivyra_touch_updated_at();

-- Seed conservative defaults. These can be tightened via super-admin UI later.
-- For each action, the FIRST matching threshold (ordered by amount ASC) where
-- amount_threshold_credits <= requested amount determines required_approvals.
INSERT INTO public.credit_action_approval_thresholds (action_type, amount_threshold_credits, required_approvals)
VALUES
  ('admin_grant',  0,       1),   -- any grant: 1 approver = the actor themselves (auto-approves below threshold)
  ('admin_grant',  5000,    2),   -- 5K+ credits: 2 approvers required
  ('admin_grant',  50000,   3),   -- 50K+ credits: 3 approvers
  ('admin_adjust', 0,       1),
  ('admin_adjust', 5000,    2),
  ('admin_adjust', 50000,   3),
  ('admin_refund', 0,       2),   -- refunds always require 2 (segregation of duties)
  ('admin_refund', 50000,   3),
  ('admin_rate_change', 0, 2)     -- USD rate changes always require 2
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.credit_action_approvals (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type              text NOT NULL,
  organization_id          uuid NOT NULL,
  proposed_by              uuid NOT NULL,
  proposed_at              timestamptz NOT NULL DEFAULT now(),
  approval_threshold_met_at timestamptz,
  executed_at              timestamptz,
  executed_idempotency_key text,
  payload                  jsonb NOT NULL,
  status                   text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'executed', 'expired', 'cancelled')),
  required_approvals       integer NOT NULL CHECK (required_approvals >= 1),
  approvals_received       integer NOT NULL DEFAULT 0 CHECK (approvals_received >= 0),
  rejected_at              timestamptz,
  rejected_by              uuid,
  rejection_reason         text,
  expires_at               timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  client_request_id        text,  -- idempotency for proposal creation
  metadata                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- Non-partial unique index: the proposal-idempotency upsert in
-- creditApprovalService does `ON CONFLICT (client_request_id)` with no
-- predicate, which Postgres can only arbitrate against a NON-partial
-- unique index. (NULLs are distinct in a unique index, so unlimited
-- null-client_request_id rows are still allowed — semantically identical
-- to the old `WHERE client_request_id IS NOT NULL` partial index here.)
CREATE UNIQUE INDEX IF NOT EXISTS idx_caa_client_request_unique
  ON public.credit_action_approvals(client_request_id);

CREATE INDEX IF NOT EXISTS idx_caa_status_expires
  ON public.credit_action_approvals(status, expires_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_caa_org_proposer
  ON public.credit_action_approvals(organization_id, proposed_by, proposed_at DESC);

DROP TRIGGER IF EXISTS trg_caa_touch ON public.credit_action_approvals;
CREATE TRIGGER trg_caa_touch
  BEFORE UPDATE ON public.credit_action_approvals
  FOR EACH ROW
  EXECUTE FUNCTION public.omnivyra_touch_updated_at();

-- Once executed_at is set, the approval row is itself frozen.
CREATE OR REPLACE FUNCTION public.guard_approval_post_execute()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.executed_at IS NOT NULL THEN
    RAISE EXCEPTION 'APPROVAL_FROZEN: approval % is executed and immutable', OLD.id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_caa_post_execute ON public.credit_action_approvals;
CREATE TRIGGER guard_caa_post_execute
  BEFORE UPDATE ON public.credit_action_approvals
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_approval_post_execute();

CREATE TABLE IF NOT EXISTS public.credit_action_approval_signatures (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_id  uuid NOT NULL REFERENCES public.credit_action_approvals(id) ON DELETE RESTRICT,
  approver_id  uuid NOT NULL,
  decision     text NOT NULL CHECK (decision IN ('approve', 'reject')),
  comment      text,
  signed_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (approval_id, approver_id)
);

CREATE INDEX IF NOT EXISTS idx_caas_approval ON public.credit_action_approval_signatures(approval_id);

DROP TRIGGER IF EXISTS caas_immutable_update ON public.credit_action_approval_signatures;
CREATE TRIGGER caas_immutable_update
  BEFORE UPDATE ON public.credit_action_approval_signatures
  FOR EACH ROW
  EXECUTE FUNCTION public.raise_ledger_immutable();

DROP TRIGGER IF EXISTS caas_immutable_delete ON public.credit_action_approval_signatures;
CREATE TRIGGER caas_immutable_delete
  BEFORE DELETE ON public.credit_action_approval_signatures
  FOR EACH ROW
  EXECUTE FUNCTION public.raise_ledger_immutable();

-- Sign + recount + auto-advance status all in one RPC.
CREATE OR REPLACE FUNCTION public.sign_credit_action_approval(
  p_approval_id uuid,
  p_approver_id uuid,
  p_decision text,
  p_comment text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_approval     public.credit_action_approvals%ROWTYPE;
  v_approve_count integer;
  v_reject_count integer;
BEGIN
  IF p_decision NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'invalid decision %', p_decision;
  END IF;

  SELECT * INTO v_approval FROM public.credit_action_approvals
    WHERE id = p_approval_id
    FOR UPDATE;

  IF v_approval.id IS NULL THEN
    RAISE EXCEPTION 'APPROVAL_NOT_FOUND: %', p_approval_id;
  END IF;
  IF v_approval.status NOT IN ('pending', 'approved') THEN
    RAISE EXCEPTION 'APPROVAL_NOT_ACTIONABLE: status=%', v_approval.status;
  END IF;
  IF v_approval.executed_at IS NOT NULL THEN
    RAISE EXCEPTION 'APPROVAL_ALREADY_EXECUTED';
  END IF;
  IF v_approval.expires_at < now() THEN
    UPDATE public.credit_action_approvals SET status = 'expired' WHERE id = p_approval_id;
    RAISE EXCEPTION 'APPROVAL_EXPIRED';
  END IF;
  IF v_approval.proposed_by = p_approver_id THEN
    -- Proposer cannot self-approve (segregation of duties)
    RAISE EXCEPTION 'APPROVAL_SELF_NOT_ALLOWED: proposer cannot sign their own request';
  END IF;

  INSERT INTO public.credit_action_approval_signatures (approval_id, approver_id, decision, comment)
  VALUES (p_approval_id, p_approver_id, p_decision, p_comment);

  SELECT
    count(*) FILTER (WHERE decision = 'approve'),
    count(*) FILTER (WHERE decision = 'reject')
  INTO v_approve_count, v_reject_count
  FROM public.credit_action_approval_signatures
  WHERE approval_id = p_approval_id;

  IF v_reject_count >= 1 THEN
    UPDATE public.credit_action_approvals
      SET status = 'rejected', rejected_at = now(), rejected_by = p_approver_id, rejection_reason = p_comment
      WHERE id = p_approval_id
      RETURNING * INTO v_approval;
  ELSIF v_approve_count >= v_approval.required_approvals THEN
    UPDATE public.credit_action_approvals
      SET status = 'approved', approval_threshold_met_at = now(), approvals_received = v_approve_count
      WHERE id = p_approval_id
      RETURNING * INTO v_approval;
  ELSE
    UPDATE public.credit_action_approvals
      SET approvals_received = v_approve_count
      WHERE id = p_approval_id
      RETURNING * INTO v_approval;
  END IF;

  RETURN jsonb_build_object(
    'id',                 v_approval.id,
    'status',             v_approval.status,
    'approvals_received', v_approval.approvals_received,
    'required_approvals', v_approval.required_approvals,
    'approve_count',      v_approve_count,
    'reject_count',       v_reject_count
  );
END;
$$;

-- Look up the required approval count for an (action_type, amount) pair.
CREATE OR REPLACE FUNCTION public.required_approvals_for_action(
  p_action_type text,
  p_amount integer
) RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (SELECT required_approvals
       FROM public.credit_action_approval_thresholds
      WHERE action_type = p_action_type
        AND is_active = true
        AND amount_threshold_credits <= COALESCE(p_amount, 0)
      ORDER BY amount_threshold_credits DESC
      LIMIT 1),
    1
  );
$$;

------------------------------------------------------------------------------
-- §4  JOB EXECUTION REGISTRY (C-1)
------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.job_execution_registry (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id              text NOT NULL,                  -- queue-system job id
  queue_name          text NOT NULL,
  organization_id     uuid,                           -- optional; many jobs are org-scoped
  execution_hash      text NOT NULL,                  -- sha256(job_id, payload_fingerprint)
  correlation_id      text NOT NULL,                  -- propagated request lineage
  billing_operation_id uuid,                          -- nullable: not all jobs bill
  idempotency_key     text NOT NULL,                  -- for the bound credit reservation
  status              text NOT NULL DEFAULT 'reserved'
    CHECK (status IN (
      'reserved',          -- HOLD placed, work not yet started
      'in_progress',       -- worker picked up and is executing
      'completed',         -- work finished, CONFIRM emitted
      'released',          -- work failed, RELEASE emitted
      'orphan_reaped',     -- reaper found stale HOLD and released it
      'duplicate_blocked'  -- replay attempt blocked by registry
    )),
  retry_count         integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  first_seen_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz,
  error_message       text,
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (execution_hash)
);

CREATE INDEX IF NOT EXISTS idx_jer_status_first_seen
  ON public.job_execution_registry(status, first_seen_at);

CREATE INDEX IF NOT EXISTS idx_jer_job
  ON public.job_execution_registry(job_id, queue_name);

CREATE INDEX IF NOT EXISTS idx_jer_org
  ON public.job_execution_registry(organization_id, status, first_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_jer_billing_op
  ON public.job_execution_registry(billing_operation_id) WHERE billing_operation_id IS NOT NULL;

-- The registry row itself is mutable (last_seen_at, status, retry_count),
-- but a terminal status (completed | released | orphan_reaped | duplicate_blocked)
-- must never regress. Enforced below.
CREATE OR REPLACE FUNCTION public.guard_jer_status_monotonic()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_terminal_old boolean;
  v_terminal_new boolean;
BEGIN
  v_terminal_old := OLD.status IN ('completed', 'released', 'orphan_reaped', 'duplicate_blocked');
  v_terminal_new := NEW.status IN ('completed', 'released', 'orphan_reaped', 'duplicate_blocked');
  IF v_terminal_old AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'JER_STATUS_FROZEN: % is terminal, cannot transition to %', OLD.status, NEW.status
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_jer_status_monotonic ON public.job_execution_registry;
CREATE TRIGGER guard_jer_status_monotonic
  BEFORE UPDATE ON public.job_execution_registry
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_jer_status_monotonic();

-- Atomic "claim or block" RPC: returns existing row on replay, inserts on first sight.
CREATE OR REPLACE FUNCTION public.claim_job_execution(
  p_job_id text,
  p_queue_name text,
  p_execution_hash text,
  p_correlation_id text,
  p_idempotency_key text,
  p_organization_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_row public.job_execution_registry%ROWTYPE;
  v_existing public.job_execution_registry%ROWTYPE;
BEGIN
  IF p_execution_hash IS NULL OR btrim(p_execution_hash) = '' THEN
    RAISE EXCEPTION 'execution_hash is required';
  END IF;

  SELECT * INTO v_existing FROM public.job_execution_registry
    WHERE execution_hash = p_execution_hash
    FOR UPDATE;

  IF v_existing.id IS NOT NULL THEN
    -- Replay path. Bump retry counter; do not regress terminal status.
    UPDATE public.job_execution_registry
      SET retry_count = v_existing.retry_count + 1,
          last_seen_at = now()
      WHERE id = v_existing.id
      RETURNING * INTO v_row;
    RETURN jsonb_build_object(
      'id',           v_row.id,
      'status',       v_row.status,
      'first_seen',   false,
      'retry_count',  v_row.retry_count,
      'is_terminal',  v_row.status IN ('completed','released','orphan_reaped','duplicate_blocked')
    );
  END IF;

  INSERT INTO public.job_execution_registry (
    job_id, queue_name, organization_id, execution_hash, correlation_id,
    idempotency_key, status, metadata
  ) VALUES (
    p_job_id, p_queue_name, p_organization_id, p_execution_hash, p_correlation_id,
    p_idempotency_key, 'reserved', COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'id',           v_row.id,
    'status',       v_row.status,
    'first_seen',   true,
    'retry_count',  0,
    'is_terminal',  false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.advance_job_execution(
  p_execution_hash text,
  p_status text,
  p_billing_operation_id uuid DEFAULT NULL,
  p_error text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_row public.job_execution_registry%ROWTYPE;
BEGIN
  UPDATE public.job_execution_registry
    SET status = p_status,
        billing_operation_id = COALESCE(p_billing_operation_id, billing_operation_id),
        error_message = p_error,
        completed_at = CASE WHEN p_status IN ('completed','released','orphan_reaped','duplicate_blocked')
                            THEN COALESCE(completed_at, now())
                            ELSE completed_at END,
        last_seen_at = now()
    WHERE execution_hash = p_execution_hash
    RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'JER_NOT_FOUND: execution_hash=%', p_execution_hash;
  END IF;

  RETURN jsonb_build_object('id', v_row.id, 'status', v_row.status);
END;
$$;

------------------------------------------------------------------------------
-- §5  ADMIN FINANCIAL AUDIT EVENTS (Phase E)
------------------------------------------------------------------------------
-- Distinct from super_admin_audit_logs:
--   super_admin_audit_logs  = generic action log (any admin operation)
--   admin_financial_audit   = financial-only, with structured fields the
--                             finance team queries (amount, currency, approval link, etc.)
-- This makes ledger reconciliation cheaper because financial events don't
-- require parsing free-form JSONB metadata.

CREATE TABLE IF NOT EXISTS public.admin_financial_audit_events (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id        uuid NOT NULL,
  action_type          text NOT NULL,            -- 'admin_grant'|'admin_adjust'|'admin_refund'|'admin_rate_change'
  organization_id      uuid NOT NULL,
  amount_credits       integer,                  -- signed; negative = clawback/refund
  usd_equivalent       numeric(14,6),
  currency             text NOT NULL DEFAULT 'USD',
  reason_type          text,
  reason               text,
  approval_id          uuid REFERENCES public.credit_action_approvals(id) ON DELETE RESTRICT,
  ledger_idempotency_key text,                   -- joins to credit_transactions.idempotency_key
  correlation_id       text,
  metadata             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_afae_actor ON public.admin_financial_audit_events(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_afae_org   ON public.admin_financial_audit_events(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_afae_action ON public.admin_financial_audit_events(action_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_afae_approval ON public.admin_financial_audit_events(approval_id) WHERE approval_id IS NOT NULL;

DROP TRIGGER IF EXISTS afae_immutable_update ON public.admin_financial_audit_events;
CREATE TRIGGER afae_immutable_update
  BEFORE UPDATE ON public.admin_financial_audit_events
  FOR EACH ROW
  EXECUTE FUNCTION public.raise_ledger_immutable();

DROP TRIGGER IF EXISTS afae_immutable_delete ON public.admin_financial_audit_events;
CREATE TRIGGER afae_immutable_delete
  BEFORE DELETE ON public.admin_financial_audit_events
  FOR EACH ROW
  EXECUTE FUNCTION public.raise_ledger_immutable();

------------------------------------------------------------------------------
-- §6  BILLING OPERATIONS (Phase A orchestrator tracking)
------------------------------------------------------------------------------
-- Every call into the enterprise billing orchestrator gets one row, regardless
-- of HOLD outcome. The credit_transactions rows it produces are linked via the
-- shared idempotency_key. Useful for tracing "did this orchestrator call
-- actually deduct?" and for ops dashboards.

CREATE TABLE IF NOT EXISTS public.billing_operations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id      text NOT NULL,
  module              text NOT NULL,                 -- 'queue:contentGen' | 'http:reports' | 'ai_gateway:refine_variant'
  action              text NOT NULL,                 -- credit action name
  organization_id     uuid NOT NULL,
  actor_user_id       uuid,
  idempotency_key     text NOT NULL,                 -- root key; phase suffixes used by reservation
  amount_estimated    integer,                       -- HOLD ceiling
  amount_charged      integer,                       -- final CONFIRM amount
  reservation_txn_id  uuid,                          -- HOLD credit_transactions.id
  confirm_txn_id      uuid,                          -- CONFIRM credit_transactions.id
  release_txn_id      uuid,                          -- RELEASE if work failed
  status              text NOT NULL DEFAULT 'initiated'
    CHECK (status IN (
      'initiated',          -- service called, HOLD not yet attempted
      'held',               -- HOLD succeeded
      'executed',           -- work completed
      'confirmed',          -- CONFIRM emitted
      'released',           -- RELEASE emitted (work failed or no-charge)
      'insufficient',       -- HOLD denied
      'duplicate',          -- caught by idempotency / registry
      'error'               -- unexpected error
    )),
  failure_reason      text,
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at          timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz,
  UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_bo_org_status
  ON public.billing_operations(organization_id, status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_bo_module_status
  ON public.billing_operations(module, status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_bo_correlation
  ON public.billing_operations(correlation_id);
CREATE INDEX IF NOT EXISTS idx_bo_open
  ON public.billing_operations(status, started_at)
  WHERE status IN ('initiated','held','executed');

-- billing_operations is operational state; the financial truth is in
-- credit_transactions. So this table is freely mutable (no immutability trigger),
-- but rows must never be DELETEd by application code — that's an audit incident.
CREATE OR REPLACE FUNCTION public.guard_bo_no_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'BILLING_OP_NO_DELETE: row % is operational history and cannot be deleted', OLD.id
    USING ERRCODE = 'P0001';
END;
$$;

DROP TRIGGER IF EXISTS bo_no_delete ON public.billing_operations;
CREATE TRIGGER bo_no_delete
  BEFORE DELETE ON public.billing_operations
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_bo_no_delete();

------------------------------------------------------------------------------
-- §7  CREDIT UNTRACKED ACTIONS — explicit allowlist for non-billed AI calls
------------------------------------------------------------------------------
-- aiGateway will (post-flag rollout) require either a credit handle OR an
-- entry in this allowlist with a justification. This eliminates the silent
-- "no credit wrapper" gap.

CREATE TABLE IF NOT EXISTS public.credit_untracked_actions (
  action_key       text PRIMARY KEY,
  reason           text NOT NULL,
  approved_by      uuid NOT NULL,
  expires_at       timestamptz,
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS cua_immutable_update ON public.credit_untracked_actions;
CREATE TRIGGER cua_immutable_update
  BEFORE UPDATE ON public.credit_untracked_actions
  FOR EACH ROW
  EXECUTE FUNCTION public.raise_ledger_immutable();

------------------------------------------------------------------------------
-- §8  PRICING CATALOG VIEW — derived, read-only convenience
------------------------------------------------------------------------------
-- The audit prompt asks for a pricing_catalog. We compose it from existing
-- canonical sources rather than duplicating storage. Anything that needs a
-- single-table lookup can read from this view.

CREATE OR REPLACE VIEW public.v_pricing_catalog AS
SELECT
  apc.action_key,
  apc.credit_cost,
  apc.cost_multiplier,
  apc.minimum_charge_usd,
  apc.ceiling_usd,
  apc.is_active,
  apc.effective_from,
  COALESCE(ccc.smart_dedup_seconds, 0) AS smart_dedup_seconds,
  apc.updated_at
FROM public.action_pricing_config apc
LEFT JOIN public.credit_cost_config ccc ON ccc.action_type = apc.action_key
WHERE apc.is_active = true;
