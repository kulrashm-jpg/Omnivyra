-- Outreach: provider evidence reconciliation (owner ruling 2026-11-04, Checkpoint 1 item 7; step D2)
--
-- A complaint or a permanent bounce is a deterministic governance event: its
-- restriction is written whether or not the delivery evidence could be saved
-- (sesProviderEventIngestion, D7). The webhook answers 503 when a write fails,
-- so SNS retries, but SNS retries are bounded. Once they ran out, nothing
-- recorded that durable evidence (or a restriction) was missing.
--
-- This table records that debt, one row per provider event, so it can be
-- recovered and audited:
--   * tenant, provider event and message ids, event type, signal, channel;
--   * the task and attempt the event resolved to;
--   * the ids of the governance (restriction) records in force, which
--     identify the recipient WITHOUT copying the address here;
--   * which persistence operations failed, and a failure code.
--
-- It is NOT a suppression or consent store. Nothing reads it to decide whether
-- a recipient may be contacted; the restriction lives only in
-- contact_governance_records, and reconciliation never revokes or weakens it.
-- The evidence column holds the address-free normalized evidence summary used
-- to replay the idempotent evidence write; a CHECK refuses address or content
-- keys.
--
-- company_id is text, as on every outreach_* table. task_id and attempt_id
-- carry no foreign key on purpose: the debt must be recordable exactly when
-- the task could not be read, and a reference check would add a failure mode
-- to the write that records a failure.
--
-- Writer: backend/services/providerEvents/sesEvidenceReconciliation.ts
-- (service_role). Rows are never deleted; `open` -> `resolved` only.
-- Local only: tested on a disposable database. Not applied to any real
-- environment.
--
-- ROLLBACK: supabase/migrations/rollbacks/outreach_provider_evidence_reconciliation_rollback.sql

CREATE TABLE IF NOT EXISTS public.outreach_provider_evidence_reconciliation (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             text NOT NULL,
  provider               text NOT NULL,
  provider_event_id      text NOT NULL,
  provider_message_id    text NOT NULL,
  event_type             text NOT NULL,
  signal                 text NOT NULL,
  occurred_at            timestamptz NOT NULL,
  channel                text NOT NULL,
  task_id                uuid NULL,
  attempt_id             uuid NULL,
  governance_type        text NULL,
  governance_record_ids  uuid[] NOT NULL DEFAULT '{}',
  failed_operations      text[] NOT NULL,
  failure_reason         text NOT NULL,
  evidence               jsonb NOT NULL DEFAULT '{}'::jsonb,
  status                 text NOT NULL DEFAULT 'open',
  first_failed_at        timestamptz NOT NULL DEFAULT now(),
  last_failed_at         timestamptz NOT NULL DEFAULT now(),
  reconcile_attempts     integer NOT NULL DEFAULT 0,
  last_reconcile_at      timestamptz NULL,
  last_reconcile_reason  text NULL,
  resolved_at            timestamptz NULL,
  resolution             text NULL,
  CONSTRAINT opevr_company_not_blank      CHECK (length(btrim(company_id)) > 0),
  CONSTRAINT opevr_provider_event_unique  UNIQUE (provider, provider_event_id),
  CONSTRAINT opevr_status_valid           CHECK (status IN ('open', 'resolved')),
  CONSTRAINT opevr_governance_type_valid  CHECK (governance_type IS NULL OR governance_type IN ('bounce_hard', 'complaint')),
  CONSTRAINT opevr_failed_operations_valid
    CHECK (cardinality(failed_operations) > 0
           AND failed_operations <@ ARRAY['task_read', 'delivery_evidence', 'restriction']::text[]),
  CONSTRAINT opevr_failure_reason_code    CHECK (failure_reason ~ '^[a-z0-9_]{1,64}$'),
  CONSTRAINT opevr_reconcile_reason_code  CHECK (last_reconcile_reason IS NULL OR last_reconcile_reason ~ '^[a-z0-9_]{1,64}$'),
  CONSTRAINT opevr_resolution_valid       CHECK (resolution IS NULL OR resolution IN ('replayed', 'provider_retry')),
  CONSTRAINT opevr_resolved_consistent
    CHECK ((status = 'resolved') = (resolved_at IS NOT NULL AND resolution IS NOT NULL)),
  CONSTRAINT opevr_evidence_summary
    CHECK (jsonb_typeof(evidence) = 'object'
           AND NOT (evidence ?| ARRAY['recipient', 'email', 'destination', 'address', 'to', 'body', 'content', 'subject', 'headers'])),
  CONSTRAINT opevr_reconcile_attempts_nonneg CHECK (reconcile_attempts >= 0)
);

CREATE INDEX IF NOT EXISTS idx_opevr_open
  ON public.outreach_provider_evidence_reconciliation (company_id, first_failed_at)
  WHERE status = 'open';

-- A resolved row is final: it is never reopened, and its resolution, the
-- event identity and the tenant never change.
CREATE OR REPLACE FUNCTION public.outreach_provider_evidence_reconciliation_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.provider_event_id IS DISTINCT FROM OLD.provider_event_id
     OR NEW.first_failed_at IS DISTINCT FROM OLD.first_failed_at THEN
    RAISE EXCEPTION 'outreach_provider_evidence_reconciliation %: tenant, event identity and first failure time are immutable', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'resolved' AND ROW(NEW.*) IS DISTINCT FROM ROW(OLD.*) THEN
    RAISE EXCEPTION 'outreach_provider_evidence_reconciliation %: a resolved row is final', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

REVOKE EXECUTE ON FUNCTION public.outreach_provider_evidence_reconciliation_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS outreach_provider_evidence_reconciliation_guard ON public.outreach_provider_evidence_reconciliation;
CREATE TRIGGER outreach_provider_evidence_reconciliation_guard
  BEFORE UPDATE ON public.outreach_provider_evidence_reconciliation
  FOR EACH ROW EXECUTE FUNCTION public.outreach_provider_evidence_reconciliation_guard();

ALTER TABLE public.outreach_provider_evidence_reconciliation ENABLE ROW LEVEL SECURITY;

DO $opevr_rls$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'outreach_provider_evidence_reconciliation'
       AND policyname = 'outreach_provider_evidence_reconciliation_service_role'
  ) THEN
    CREATE POLICY outreach_provider_evidence_reconciliation_service_role
      ON public.outreach_provider_evidence_reconciliation
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END
$opevr_rls$;

-- Own grants, not the platform defaults: the governed build does not
-- reproduce them, and a later class-wide REVOKE would not list this table.
-- No DELETE for anyone: rows are never deleted.
REVOKE ALL ON TABLE public.outreach_provider_evidence_reconciliation FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.outreach_provider_evidence_reconciliation TO service_role;

COMMENT ON TABLE public.outreach_provider_evidence_reconciliation IS
  'Provider events (SES) whose durable delivery evidence, task read or restriction write failed. '
  'One row per (provider, provider_event_id); open -> resolved only; never deleted. '
  'Not a suppression or consent store: the restriction lives only in '
  'contact_governance_records and is never weakened here. Address-free: the '
  'recipient is identified by governance_record_ids. Writer: '
  'sesEvidenceReconciliation.ts (service_role SELECT+INSERT+UPDATE).';
