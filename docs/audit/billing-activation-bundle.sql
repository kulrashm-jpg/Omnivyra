-- =====================================================================
-- BILLING ACTIVATION BUNDLE  (minimal, idempotent)  — generated 2026-05-16
-- Target: production Supabase klkiseupptzbecbxwrky
--
-- WHAT THIS IS
--   The minimal set required to make billing operational in production
--   WITHOUT the unsafe full ledger push (see
--   docs/audit/migration-ledger-reconciliation-plan.md).
--
--   PRELUDE    run docs/audit/billing-schema-alignment-prelude.sql FIRST
--              (additive ADD COLUMN IF NOT EXISTS on pre-existing tables).
--   SECTION 1  prerequisite objects extracted verbatim from
--              20260625_monetization_invariant_hardening.sql
--   SECTION 2  20260663_ledger_immutability_and_governance.sql  (verbatim)
--   SECTION 3  20260664_phase2_governance_and_payment_foundation.sql (verbatim)
--   SECTION 4  20260665_phase3_fx_engine_and_contracts.sql       (verbatim)
--   SECTION 5  PostgREST schema-cache reload
--
-- IDEMPOTENT & NON-DESTRUCTIVE. Verified end-to-end via a transactional
-- dry-run against production (scripts/audit/dryrun-billing-bundle.ts).
--
-- HOW TO RUN  (operator, maintenance window, AFTER a backup)
--   0. run billing-schema-alignment-prelude.sql
--   1..5 run each SECTION in order, checking for errors between each.
--   Each section is internally idempotent and safe to re-run.
-- =====================================================================

-- =====================================================================
-- SECTION 1 — PREREQUISITE (verbatim from 20260625 lines 39-56, 58-100)
-- =====================================================================
CREATE TABLE IF NOT EXISTS payment_provider_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  purchase_id uuid REFERENCES credit_purchases(id),
  organization_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  processing_status text NOT NULL DEFAULT 'recorded'
    CHECK (processing_status IN ('recorded', 'processed', 'duplicate', 'failed')),
  error_message text,
  UNIQUE (provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_provider_events_purchase
  ON payment_provider_events(purchase_id, received_at DESC);

CREATE OR REPLACE FUNCTION record_payment_provider_event(
  p_provider text,
  p_provider_event_id text,
  p_event_type text,
  p_purchase_id uuid DEFAULT NULL,
  p_organization_id uuid DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_event payment_provider_events%ROWTYPE;
BEGIN
  IF p_provider IS NULL OR btrim(p_provider) = '' THEN
    RAISE EXCEPTION 'payment provider is required';
  END IF;
  IF p_provider_event_id IS NULL OR btrim(p_provider_event_id) = '' THEN
    RAISE EXCEPTION 'provider_event_id is required';
  END IF;

  INSERT INTO payment_provider_events (
    provider,
    provider_event_id,
    event_type,
    purchase_id,
    organization_id,
    payload
  )
  VALUES (
    p_provider,
    p_provider_event_id,
    p_event_type,
    p_purchase_id,
    p_organization_id,
    COALESCE(p_payload, '{}'::jsonb)
  )
  ON CONFLICT (provider, provider_event_id) DO UPDATE
    SET processing_status = payment_provider_events.processing_status
  RETURNING * INTO v_event;

  RETURN row_to_json(v_event)::jsonb;
END;
$$;

-- =====================================================================
-- SECTION 2 — 20260663_ledger_immutability_and_governance.sql (verbatim)
-- =====================================================================
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_caa_client_request_unique
  ON public.credit_action_approvals(client_request_id)
  WHERE client_request_id IS NOT NULL;

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

-- =====================================================================
-- SECTION 3 — 20260664_phase2_governance_and_payment_foundation.sql (verbatim)
-- =====================================================================
-- Enterprise Phase 2 — governance hardening + payment foundation
--
-- Sections:
--   §1  RBAC roles for finance segregation (Phase D)
--   §2  Org control extensions: emergency freeze + billing lock (Phase D)
--   §3  Adjustment cancellation tracking (Phase D)
--   §4  Payment foundation tables (Phase E) — provider-agnostic shape only
--   §5  Usage→ledger reconciliation index (Phase F)
--   §6  Indexes for the dashboard views (Phase G)

------------------------------------------------------------------------------
-- §1  FINANCE RBAC ROLES
------------------------------------------------------------------------------
-- Role values are strings in user_company_roles.role; no enum constraint
-- exists at the DB level, so this is purely a documentation + helper view.
-- Application code (rbacService) enforces the allowed set. Adding the values
-- to a comment lets downstream tools (Supabase dashboard, sql linters) see
-- the canonical list.

COMMENT ON TABLE public.user_company_roles IS
  'Per-(user, company) role assignment. Roles include: SUPER_ADMIN, ADMIN, COMPANY_ADMIN, '
  'CONTENT_MANAGER, CONTENT_REVIEWER, CONTENT_PUBLISHER, CONTENT_PLANNER, CONTENT_CREATOR, '
  'CONTENT_ENGAGER, VIEWER, VIEW_ONLY, FINANCE_ADMIN, FINANCE_APPROVER, FINANCE_AUDITOR. '
  'Finance roles are platform-tier (company_id may be the platform sentinel).';

-- View: who currently holds the new finance roles (for ops UI).
CREATE OR REPLACE VIEW public.v_finance_role_holders AS
SELECT user_id, company_id, role, status, created_at
  FROM public.user_company_roles
 WHERE role IN ('FINANCE_ADMIN', 'FINANCE_APPROVER', 'FINANCE_AUDITOR')
   AND status = 'active';

------------------------------------------------------------------------------
-- §2  ORG CONTROL EXTENSIONS
------------------------------------------------------------------------------

ALTER TABLE public.org_controls
  ADD COLUMN IF NOT EXISTS emergency_freeze       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS emergency_freeze_reason text,
  ADD COLUMN IF NOT EXISTS emergency_freeze_at    timestamptz,
  ADD COLUMN IF NOT EXISTS emergency_freeze_by    uuid,
  ADD COLUMN IF NOT EXISTS billing_lock           boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS billing_lock_reason    text,
  ADD COLUMN IF NOT EXISTS billing_lock_at        timestamptz,
  ADD COLUMN IF NOT EXISTS billing_lock_by        uuid;

CREATE INDEX IF NOT EXISTS idx_org_controls_emergency_freeze
  ON public.org_controls(emergency_freeze) WHERE emergency_freeze = true;
CREATE INDEX IF NOT EXISTS idx_org_controls_billing_lock
  ON public.org_controls(billing_lock) WHERE billing_lock = true;

------------------------------------------------------------------------------
-- §3  ADJUSTMENT CANCELLATION FLOW
------------------------------------------------------------------------------
-- A super-admin can cancel a PENDING approval. The row remains in the table
-- (immutable history) but transitions to 'cancelled'. The DB function below
-- enforces invariants the application can't.

CREATE OR REPLACE FUNCTION public.cancel_credit_action_approval(
  p_approval_id uuid,
  p_actor uuid,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_row public.credit_action_approvals%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.credit_action_approvals
    WHERE id = p_approval_id FOR UPDATE;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'APPROVAL_NOT_FOUND: %', p_approval_id;
  END IF;
  IF v_row.executed_at IS NOT NULL THEN
    RAISE EXCEPTION 'APPROVAL_ALREADY_EXECUTED: cannot cancel after execute';
  END IF;
  IF v_row.status <> 'pending' THEN
    RAISE EXCEPTION 'APPROVAL_NOT_PENDING: status=%', v_row.status;
  END IF;
  IF v_row.proposed_by <> p_actor THEN
    -- only the proposer (or a future cancellation-capable role) can cancel
    RAISE EXCEPTION 'APPROVAL_CANCEL_NOT_ALLOWED: only proposer may cancel';
  END IF;

  UPDATE public.credit_action_approvals
    SET status           = 'cancelled',
        rejection_reason = p_reason,
        rejected_at      = now(),
        rejected_by      = p_actor
    WHERE id = p_approval_id
    RETURNING * INTO v_row;

  RETURN jsonb_build_object('id', v_row.id, 'status', v_row.status);
END;
$$;

------------------------------------------------------------------------------
-- §4  PAYMENT FOUNDATION TABLES (PROVIDER-AGNOSTIC SHAPE)
------------------------------------------------------------------------------
-- These are scaffolding only: actual Stripe/Razorpay live integration is
-- Sprint 4+ work. The tables are designed so a future adapter plugs in
-- without changing core ledger logic.

CREATE TABLE IF NOT EXISTS public.company_billing_profiles (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL UNIQUE,
  billing_email            text NOT NULL,
  billing_name             text,
  billing_address          jsonb NOT NULL DEFAULT '{}'::jsonb,
  tax_id                   text,
  tax_id_type              text,         -- 'EU_VAT'|'IN_GST'|'US_EIN'|'AU_ABN'|...
  currency_preference      text NOT NULL DEFAULT 'USD',
  default_payment_provider text,         -- 'stripe'|'razorpay'|null
  is_business              boolean NOT NULL DEFAULT true,
  metadata                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_cbp_touch ON public.company_billing_profiles;
CREATE TRIGGER trg_cbp_touch
  BEFORE UPDATE ON public.company_billing_profiles
  FOR EACH ROW EXECUTE FUNCTION public.omnivyra_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.payment_transactions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL,
  provider                 text NOT NULL,
  provider_transaction_id  text NOT NULL,
  provider_payment_method_id text,
  amount                   numeric(14,2) NOT NULL,
  currency                 text NOT NULL DEFAULT 'USD',
  fee_amount               numeric(14,2) NOT NULL DEFAULT 0,
  net_amount               numeric(14,2) NOT NULL,
  tax_amount               numeric(14,2) NOT NULL DEFAULT 0,
  tax_currency             text,
  status                   text NOT NULL
    CHECK (status IN ('pending','succeeded','failed','refunded','partially_refunded','disputed')),
  failure_code             text,
  failure_message          text,
  refunded_amount          numeric(14,2) NOT NULL DEFAULT 0,
  credit_purchase_id       uuid REFERENCES public.credit_purchases(id) ON DELETE SET NULL,
  invoice_id               uuid,
  metadata                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at              timestamptz NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_tx_org_occurred ON public.payment_transactions(organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_tx_status      ON public.payment_transactions(status, occurred_at DESC);

-- Payment transactions are financial-evidential — immutable at update/delete.
DROP TRIGGER IF EXISTS payment_transactions_immutable_update ON public.payment_transactions;
CREATE TRIGGER payment_transactions_immutable_update
  BEFORE UPDATE ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();

DROP TRIGGER IF EXISTS payment_transactions_immutable_delete ON public.payment_transactions;
CREATE TRIGGER payment_transactions_immutable_delete
  BEFORE DELETE ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();

CREATE TABLE IF NOT EXISTS public.billing_subscriptions (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           uuid NOT NULL,
  provider                  text,           -- nullable while no provider linkage
  provider_subscription_id  text,
  plan_id                   uuid REFERENCES public.pricing_plans(id),
  status                    text NOT NULL
    CHECK (status IN ('trialing','active','past_due','paused','canceled','expired')),
  current_period_start      timestamptz NOT NULL,
  current_period_end        timestamptz NOT NULL,
  trial_ends_at             timestamptz,
  cancel_at_period_end      boolean NOT NULL DEFAULT false,
  auto_renew                boolean NOT NULL DEFAULT true,
  metadata                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_subscription_id)
);

CREATE INDEX IF NOT EXISTS idx_subs_org_status ON public.billing_subscriptions(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_subs_period_end ON public.billing_subscriptions(current_period_end) WHERE status IN ('active','past_due');

DROP TRIGGER IF EXISTS trg_subs_touch ON public.billing_subscriptions;
CREATE TRIGGER trg_subs_touch
  BEFORE UPDATE ON public.billing_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.omnivyra_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.invoices (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL,
  invoice_number    text NOT NULL UNIQUE,
  period_start      date NOT NULL,
  period_end        date NOT NULL,
  currency          text NOT NULL DEFAULT 'USD',
  subtotal_amount   numeric(14,2) NOT NULL DEFAULT 0,
  tax_amount        numeric(14,2) NOT NULL DEFAULT 0,
  total_amount      numeric(14,2) NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','issued','paid','past_due','voided','refunded')),
  due_date          date,
  issued_at         timestamptz,
  paid_at           timestamptz,
  voided_at         timestamptz,
  pdf_url           text,
  payment_transaction_id uuid REFERENCES public.payment_transactions(id) ON DELETE SET NULL,
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoices_org_period ON public.invoices(organization_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_invoices_status     ON public.invoices(status, due_date);

DROP TRIGGER IF EXISTS trg_invoices_touch ON public.invoices;
CREATE TRIGGER trg_invoices_touch
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.omnivyra_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.invoice_line_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id         uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  description        text NOT NULL,
  quantity           numeric(20,6) NOT NULL DEFAULT 1,
  unit_price         numeric(20,6) NOT NULL,
  currency           text NOT NULL DEFAULT 'USD',
  subtotal           numeric(20,6) NOT NULL,
  tax_amount         numeric(20,6) NOT NULL DEFAULT 0,
  tax_rate           numeric(10,6),
  tax_jurisdiction   text,
  reference_type     text,
  reference_id       text,
  metadata           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inv_line_invoice ON public.invoice_line_items(invoice_id);

-- Line items are immutable once the invoice is issued. We mark them frozen by
-- triggering on invoice status — modeled here via a check on the parent.
CREATE OR REPLACE FUNCTION public.guard_invoice_line_items_frozen()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM public.invoices WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF v_status IS NOT NULL AND v_status <> 'draft' THEN
    RAISE EXCEPTION 'INVOICE_LINE_ITEM_FROZEN: invoice status=% prevents line-item % on row %',
      v_status, TG_OP, COALESCE(OLD.id, NEW.id)
      USING ERRCODE = 'P0001';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS ili_freeze_on_issued ON public.invoice_line_items;
CREATE TRIGGER ili_freeze_on_issued
  BEFORE UPDATE OR DELETE ON public.invoice_line_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_invoice_line_items_frozen();

CREATE TABLE IF NOT EXISTS public.usage_billing_snapshots (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL,
  period_start        timestamptz NOT NULL,
  period_end          timestamptz NOT NULL,
  total_credits       integer NOT NULL DEFAULT 0,
  total_usd_equivalent numeric(14,6) NOT NULL DEFAULT 0,
  llm_input_tokens    bigint NOT NULL DEFAULT 0,
  llm_output_tokens   bigint NOT NULL DEFAULT 0,
  by_action           jsonb NOT NULL DEFAULT '{}'::jsonb,   -- { action_key: { credits, usd, count } }
  invoice_id          uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  taken_at            timestamptz NOT NULL DEFAULT now(),
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (organization_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_ubs_org_period ON public.usage_billing_snapshots(organization_id, period_end DESC);

-- Snapshots are append-only (the source-of-truth is credit_transactions).
DROP TRIGGER IF EXISTS ubs_immutable_update ON public.usage_billing_snapshots;
CREATE TRIGGER ubs_immutable_update
  BEFORE UPDATE ON public.usage_billing_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();

------------------------------------------------------------------------------
-- §5  USAGE → LEDGER RECONCILIATION INDEX
------------------------------------------------------------------------------
-- The `usage_events` table records every aiGateway call (cost telemetry).
-- We want to find usage events that lack a CONFIRM in credit_transactions.
-- Add a partial index on usage_events.created_at so the orphan scan is cheap.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema='public' AND table_name='usage_events'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_usage_events_recent ' ||
            'ON public.usage_events(organization_id, created_at DESC)';
  END IF;
END$$;

------------------------------------------------------------------------------
-- §6  DASHBOARD VIEWS
------------------------------------------------------------------------------

-- billing_operations_health: orchestrator coverage + duplicate detection
CREATE OR REPLACE VIEW public.v_billing_operations_health AS
SELECT
  organization_id,
  count(*) AS total_ops_24h,
  count(*) FILTER (WHERE status = 'confirmed')      AS confirmed_24h,
  count(*) FILTER (WHERE status = 'released')       AS released_24h,
  count(*) FILTER (WHERE status = 'insufficient')   AS insufficient_24h,
  count(*) FILTER (WHERE status = 'error')          AS errored_24h,
  count(*) FILTER (WHERE status = 'duplicate')      AS duplicate_24h,
  max(started_at)                                   AS last_op_at
FROM public.billing_operations
WHERE started_at >= now() - interval '24 hours'
GROUP BY organization_id;

-- approval_health: pending counts + SLA aging
CREATE OR REPLACE VIEW public.v_approval_health AS
SELECT
  organization_id,
  count(*) FILTER (WHERE status = 'pending')        AS pending_count,
  count(*) FILTER (WHERE status = 'approved')       AS approved_count,
  count(*) FILTER (WHERE status = 'rejected')       AS rejected_count,
  count(*) FILTER (WHERE status = 'executed')       AS executed_count,
  count(*) FILTER (WHERE status = 'expired')        AS expired_count,
  max(EXTRACT(epoch FROM (now() - proposed_at))) FILTER (WHERE status = 'pending') AS oldest_pending_age_s
FROM public.credit_action_approvals
WHERE proposed_at >= now() - interval '30 days'
GROUP BY organization_id;

-- reservation_health: open HOLDs aging
CREATE OR REPLACE VIEW public.v_reservation_health AS
SELECT
  h.organization_id,
  count(*)                                          AS open_holds,
  count(*) FILTER (WHERE h.created_at < now() - interval '1 hour')  AS holds_older_1h,
  count(*) FILTER (WHERE h.created_at < now() - interval '6 hour')  AS holds_older_6h,
  count(*) FILTER (WHERE h.created_at < now() - interval '24 hour') AS holds_older_24h,
  sum(abs(h.free_delta + h.incentive_delta + h.paid_delta))         AS total_reserved
FROM public.credit_transactions h
LEFT JOIN public.credit_transactions c ON c.parent_transaction_id = h.id AND c.execution_phase = 'confirm'
LEFT JOIN public.credit_transactions r ON r.parent_transaction_id = h.id AND r.execution_phase = 'release'
WHERE h.execution_phase = 'hold'
  AND c.id IS NULL
  AND r.id IS NULL
GROUP BY h.organization_id;

-- =====================================================================
-- SECTION 4 — 20260665_phase3_fx_engine_and_contracts.sql (verbatim)
-- =====================================================================
-- Enterprise Phase 3 — FX engine + enterprise contracts + audit manifests
--
-- Sections:
--   §1  Currency exchange rates table + lookup function (FX engine)
--   §2  Enterprise contracts + purchase orders (Phase F)
--   §3  Audit export manifests (Phase C)
--   §4  Indexes / views for operational tooling (Phase G)

------------------------------------------------------------------------------
-- §1  FX ENGINE
------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.currency_exchange_rates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_currency   text NOT NULL,
  target_currency   text NOT NULL,
  rate              numeric(24,12) NOT NULL CHECK (rate > 0),
  provider          text NOT NULL,           -- 'ECB' | 'openexchangerates' | 'manual' | 'static'
  snapshot_id       text,                    -- provider's snapshot id when available
  effective_at      timestamptz NOT NULL,
  valid_until       timestamptz,             -- NULL = current
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_currency, target_currency, effective_at, provider)
);

CREATE INDEX IF NOT EXISTS idx_fx_lookup
  ON public.currency_exchange_rates(source_currency, target_currency, effective_at DESC);

-- FX rates are financial-evidential — immutable.
DROP TRIGGER IF EXISTS fx_immutable_update ON public.currency_exchange_rates;
CREATE TRIGGER fx_immutable_update
  BEFORE UPDATE ON public.currency_exchange_rates
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();

DROP TRIGGER IF EXISTS fx_immutable_delete ON public.currency_exchange_rates;
CREATE TRIGGER fx_immutable_delete
  BEFORE DELETE ON public.currency_exchange_rates
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();

-- Lookup function: returns the most recent rate for (source, target) at or
-- before `as_of`. Returns NULL if no rate is on file.
CREATE OR REPLACE FUNCTION public.lookup_fx_rate(
  p_source text,
  p_target text,
  p_as_of  timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_row public.currency_exchange_rates%ROWTYPE;
BEGIN
  IF upper(p_source) = upper(p_target) THEN
    RETURN jsonb_build_object('rate', 1.0, 'provider', 'identity', 'effective_at', p_as_of);
  END IF;

  SELECT * INTO v_row FROM public.currency_exchange_rates
   WHERE source_currency = upper(p_source)
     AND target_currency = upper(p_target)
     AND effective_at <= p_as_of
   ORDER BY effective_at DESC
   LIMIT 1;

  IF v_row.id IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'id',             v_row.id,
    'rate',           v_row.rate,
    'provider',       v_row.provider,
    'snapshot_id',    v_row.snapshot_id,
    'effective_at',   v_row.effective_at
  );
END;
$$;

-- Seed identity rates so callers don't have to special-case USD→USD etc.
-- We use a single sentinel row per major currency to prevent NULL returns
-- in environments where the FX cron hasn't yet populated rates.
INSERT INTO public.currency_exchange_rates
  (source_currency, target_currency, rate, provider, effective_at, metadata)
SELECT s, t, 1.0, 'identity', '1970-01-01T00:00:00Z', jsonb_build_object('seed', true)
FROM (VALUES ('USD'), ('INR'), ('EUR'), ('GBP'), ('JPY'), ('AUD'), ('CAD')) AS a(s),
     (VALUES ('USD'), ('INR'), ('EUR'), ('GBP'), ('JPY'), ('AUD'), ('CAD')) AS b(t)
WHERE s = t
ON CONFLICT DO NOTHING;

------------------------------------------------------------------------------
-- §2  ENTERPRISE CONTRACTS
------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.enterprise_contracts (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             uuid NOT NULL,
  contract_number             text NOT NULL UNIQUE,
  start_date                  date NOT NULL,
  end_date                    date NOT NULL,
  currency                    text NOT NULL DEFAULT 'USD',
  total_contract_value        numeric(14,2) NOT NULL CHECK (total_contract_value >= 0),
  payment_terms               text NOT NULL
    CHECK (payment_terms IN ('NET15','NET30','NET45','NET60','ANNUAL_UPFRONT','QUARTERLY','MONTHLY')),
  total_credit_allotment      integer NOT NULL DEFAULT 0,
  credit_overage_rate_usd     numeric(20,10),
  custom_action_pricing       jsonb NOT NULL DEFAULT '{}'::jsonb,
  signed_contract_url         text,
  signed_by_org_name          text,
  signed_by_virality          uuid,
  status                      text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','pending_signature','active','expired','terminated','renewed')),
  parent_contract_id          uuid REFERENCES public.enterprise_contracts(id),
  notes                       text,
  metadata                    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ec_org_status
  ON public.enterprise_contracts(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_ec_active_period
  ON public.enterprise_contracts(start_date, end_date) WHERE status = 'active';

DROP TRIGGER IF EXISTS trg_ec_touch ON public.enterprise_contracts;
CREATE TRIGGER trg_ec_touch
  BEFORE UPDATE ON public.enterprise_contracts
  FOR EACH ROW EXECUTE FUNCTION public.omnivyra_touch_updated_at();

-- Once a contract is `active`, signed_by_* and total_contract_value should
-- never change. Enforce via trigger.
CREATE OR REPLACE FUNCTION public.guard_contract_immutable_after_active()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('active', 'expired', 'terminated', 'renewed') THEN
    IF NEW.signed_by_virality IS DISTINCT FROM OLD.signed_by_virality
       OR NEW.signed_by_org_name IS DISTINCT FROM OLD.signed_by_org_name
       OR NEW.total_contract_value IS DISTINCT FROM OLD.total_contract_value
       OR NEW.signed_contract_url IS DISTINCT FROM OLD.signed_contract_url
       OR NEW.start_date IS DISTINCT FROM OLD.start_date
       OR NEW.end_date   IS DISTINCT FROM OLD.end_date THEN
      RAISE EXCEPTION 'CONTRACT_FROZEN: signed-and-active contract % is immutable on financial fields', OLD.id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_ec_freeze ON public.enterprise_contracts;
CREATE TRIGGER guard_ec_freeze
  BEFORE UPDATE ON public.enterprise_contracts
  FOR EACH ROW EXECUTE FUNCTION public.guard_contract_immutable_after_active();

CREATE TABLE IF NOT EXISTS public.enterprise_purchase_orders (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id        uuid NOT NULL REFERENCES public.enterprise_contracts(id) ON DELETE RESTRICT,
  po_number          text NOT NULL,
  amount             numeric(14,2) NOT NULL CHECK (amount > 0),
  currency           text NOT NULL,
  issued_at          date NOT NULL,
  due_date           date,
  invoice_id         uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  paid_at            timestamptz,
  metadata           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_id, po_number)
);

CREATE INDEX IF NOT EXISTS idx_epo_contract ON public.enterprise_purchase_orders(contract_id);
CREATE INDEX IF NOT EXISTS idx_epo_unpaid   ON public.enterprise_purchase_orders(paid_at) WHERE paid_at IS NULL;

-- POs are financial-evidential — immutable at update/delete.
DROP TRIGGER IF EXISTS epo_immutable_update ON public.enterprise_purchase_orders;
CREATE TRIGGER epo_immutable_update
  BEFORE UPDATE ON public.enterprise_purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();

DROP TRIGGER IF EXISTS epo_immutable_delete ON public.enterprise_purchase_orders;
CREATE TRIGGER epo_immutable_delete
  BEFORE DELETE ON public.enterprise_purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();

------------------------------------------------------------------------------
-- §3  AUDIT EXPORT MANIFESTS
------------------------------------------------------------------------------
-- Every export produced by the finance team gets a row here. The manifest
-- records what was exported, by whom, the row count, and a content checksum
-- — so finance can later prove an export was not tampered with.

CREATE TABLE IF NOT EXISTS public.billing_export_manifests (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  export_type          text NOT NULL
    CHECK (export_type IN (
      'ledger',
      'company_usage',
      'admin_adjustments',
      'reservation_lifecycle',
      'billing_anomalies',
      'approval_chain'
    )),
  organization_id      uuid,                  -- null = portfolio-wide
  requested_by         uuid NOT NULL,
  requested_at         timestamptz NOT NULL DEFAULT now(),
  period_start         timestamptz,
  period_end           timestamptz,
  filters              jsonb NOT NULL DEFAULT '{}'::jsonb,
  row_count            integer NOT NULL DEFAULT 0,
  content_sha256       text NOT NULL,         -- SHA-256 of the serialized export body
  byte_size            integer NOT NULL DEFAULT 0,
  format               text NOT NULL CHECK (format IN ('csv', 'json', 'ndjson')),
  download_url         text,                  -- nullable; populated when stored externally
  retention_until      timestamptz,
  metadata             jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_bem_org_type
  ON public.billing_export_manifests(organization_id, export_type, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_bem_requester
  ON public.billing_export_manifests(requested_by, requested_at DESC);

-- Export manifests are immutable — once written, the checksum proves the
-- export's integrity at retrieval time.
DROP TRIGGER IF EXISTS bem_immutable_update ON public.billing_export_manifests;
CREATE TRIGGER bem_immutable_update
  BEFORE UPDATE ON public.billing_export_manifests
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();

DROP TRIGGER IF EXISTS bem_immutable_delete ON public.billing_export_manifests;
CREATE TRIGGER bem_immutable_delete
  BEFORE DELETE ON public.billing_export_manifests
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();

------------------------------------------------------------------------------
-- §4  OPERATIONAL TOOLING VIEWS
------------------------------------------------------------------------------

-- Company financial timeline — composite read-only view joining ledger,
-- approvals, payments, audit events. Powers the operations tooling endpoint.
CREATE OR REPLACE VIEW public.v_company_financial_timeline AS
SELECT
  organization_id,
  created_at AS event_at,
  'ledger'         AS event_kind,
  jsonb_build_object(
    'transaction_id',   id,
    'execution_phase',  execution_phase,
    'credits_delta',    credits_delta,
    'reference_type',   reference_type,
    'reference_id',     reference_id,
    'idempotency_key',  idempotency_key,
    'usd_equivalent',   usd_equivalent
  ) AS payload
FROM public.credit_transactions
UNION ALL
SELECT
  organization_id,
  created_at AS event_at,
  'admin_audit'    AS event_kind,
  jsonb_build_object(
    'audit_id',     id,
    'action_type',  action_type,
    'amount',       amount_credits,
    'reason',       reason,
    'approval_id',  approval_id,
    'actor',        actor_user_id
  ) AS payload
FROM public.admin_financial_audit_events
UNION ALL
SELECT
  organization_id,
  proposed_at AS event_at,
  'approval'       AS event_kind,
  jsonb_build_object(
    'approval_id',  id,
    'status',       status,
    'action_type',  action_type,
    'proposed_by',  proposed_by,
    'amount',       (payload->>'amountCredits')::numeric
  ) AS payload
FROM public.credit_action_approvals
UNION ALL
SELECT
  organization_id,
  occurred_at AS event_at,
  'payment'        AS event_kind,
  jsonb_build_object(
    'payment_id',  id,
    'provider',    provider,
    'amount',      amount,
    'currency',    currency,
    'status',      status
  ) AS payload
FROM public.payment_transactions;

-- =====================================================================
-- SECTION 5 — reload PostgREST schema cache (run after 1-4 succeed)
-- =====================================================================
NOTIFY pgrst, 'reload schema';
