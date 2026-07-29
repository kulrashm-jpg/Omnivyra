-- EXECUTION-SAFETY-001 / ES-101 — Server-owned approval authority (INFRASTRUCTURE ONLY).
--
-- ADDITIVE + idempotent. The ONE authoritative approval store the execution bridge consults.
-- Client-supplied approval is never trusted; a live send requires an ACTIVE, non-revoked,
-- non-expired approval row created by an approver, bound to (company, campaign, version).
-- Enables NOTHING (execution stays default-OFF). RLS = service-role. Controlled apply only
-- (never `db push`, per the repo migration-ledger policy).

CREATE TABLE IF NOT EXISTS public.execution_approvals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    text NOT NULL,
  campaign_id   text NOT NULL,
  version       text NOT NULL DEFAULT 'default',  -- message/version binding (matches connector idempotency messageId)
  approved_by   text NOT NULL,                     -- approver identity (must hold campaign.approve at record time)
  approved_at   timestamptz NOT NULL DEFAULT now(),
  active        boolean NOT NULL DEFAULT true,
  revoked_at    timestamptz,                       -- non-null = revoked (respected by the bridge)
  revoked_by    text,
  reason        text,
  correlation_id text,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT execution_approvals_approver_not_blank CHECK (length(btrim(approved_by)) > 0),
  CONSTRAINT uq_execution_approval UNIQUE (company_id, campaign_id, version)
);
CREATE INDEX IF NOT EXISTS idx_execution_approvals_lookup
  ON public.execution_approvals (company_id, campaign_id, version) WHERE active;

ALTER TABLE public.execution_approvals ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='execution_approvals' AND policyname='execution_service_role') THEN
    DROP POLICY execution_service_role ON public.execution_approvals;
  END IF;
  CREATE POLICY execution_service_role ON public.execution_approvals FOR ALL TO service_role USING (true) WITH CHECK (true);
END $$;

COMMENT ON TABLE public.execution_approvals IS 'ES-101 — server-owned approval authority; the execution bridge trusts ONLY this (never client-asserted approval). Active + non-revoked + non-expired + version-bound required to dispatch.';
