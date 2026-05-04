-- Phase C fix migration — creates governance_audit_runs.
--
-- This table is referenced by backend/services/GovernanceAuditService.ts:94 with a
-- "Run database/governance_audit_runs.sql" fallback warning. The table was
-- MISSING from prod (audits silently skipped) and from canonical migrations.
-- This migration brings both into alignment by creating the table.

CREATE TABLE IF NOT EXISTS public.governance_audit_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  campaigns_scanned integer NOT NULL,
  drifted_campaigns integer NOT NULL,
  policy_upgrade_campaigns integer NOT NULL,
  average_replay_coverage double precision NOT NULL,
  integrity_risk_score integer NOT NULL,
  audit_status varchar(20) NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='governance_audit_runs_audit_status_check') THEN
    ALTER TABLE public.governance_audit_runs
      ADD CONSTRAINT governance_audit_runs_audit_status_check
      CHECK (audit_status IN ('OK', 'WARNING', 'CRITICAL'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_governance_audit_company
  ON public.governance_audit_runs (company_id);

CREATE INDEX IF NOT EXISTS idx_governance_audit_created
  ON public.governance_audit_runs (created_at DESC);
