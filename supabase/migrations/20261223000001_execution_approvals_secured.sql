-- ============================================================================
-- execution_approvals — SECURED (supersedes 20260727040000 for deployment)
--
-- WHAT THIS ADDS
--   The server-owned approval store for the execution bridge (identical definition to
--   20260727040000_execution_approvals.sql: table, unique binding, partial lookup index,
--   RLS, service-role policy) PLUS what that file lacked: no table privileges for
--   anon / authenticated, and asserted postconditions.
--
-- WHY (which code paths write/read it)
--   writes  backend/services/execution/executionApprovalService.ts recordApproval (upsert on
--           (company_id, campaign_id, version)) and revokeApproval (update), called only by
--           pages/api/lead-intelligence/execution.ts (actions approve / revoke_approval,
--           gated by the campaign.approve capability for the requested company).
--   reads   getApprovalDecision, consulted by backend/services/execution/executionBridge.ts;
--           fail-closed on any error.
--   All through ownedDbTable (service-role client). Nothing reads it from the browser.
--
-- WHAT FAILS IF ABSENT
--   recordApproval / revokeApproval now raise ApprovalPersistenceError (HTTP 500 with a
--   stable code) instead of reporting success; every dispatch is refused (fail-closed).
--
-- WHY NOT 20260727040000 AS WRITTEN
--   It enables RLS and a service-role policy but leaves the default table grants to
--   authenticated in place, so RLS is the only barrier. This file removes those grants
--   (the 20261026000000 model). It is safe whether or not 20260727040000 was applied.
--
-- APPLICATION
--   *** DO NOT RUN `supabase db push`. *** Apply by hand per docs/migration-discipline.md.
--   Applying this does NOT enable execution: execution stays default-OFF
--   (executionControlService). Record the ledger row only as a separate, approved step.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.execution_approvals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     text NOT NULL,
  campaign_id    text NOT NULL,
  version        text NOT NULL DEFAULT 'default',  -- message/version binding (matches connector idempotency messageId)
  approved_by    text NOT NULL,                     -- approver identity (must hold campaign.approve at record time)
  approved_at    timestamptz NOT NULL DEFAULT now(),
  active         boolean NOT NULL DEFAULT true,
  revoked_at     timestamptz,                       -- non-null = revoked (respected by the bridge)
  revoked_by     text,
  reason         text,
  correlation_id text,
  metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT execution_approvals_approver_not_blank CHECK (length(btrim(approved_by)) > 0),
  CONSTRAINT uq_execution_approval UNIQUE (company_id, campaign_id, version)
);

-- Shape guard: the service writes these columns and upserts ON CONFLICT (company_id, campaign_id, version).
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(c, ', ') INTO missing
    FROM unnest(ARRAY['id','company_id','campaign_id','version','approved_by','approved_at','active',
                      'revoked_at','revoked_by','reason','correlation_id','metadata','created_at']) AS c
   WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_schema = 'public' AND table_name = 'execution_approvals' AND column_name = c);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'execution_approvals exists with an unexpected shape; missing columns: %', missing;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
     WHERE i.indrelid = 'public.execution_approvals'::regclass AND i.indisunique AND i.indisvalid AND i.indpred IS NULL
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
              FROM unnest(i.indkey) k JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k)
           = ARRAY['campaign_id','company_id','version']
  ) THEN
    RAISE EXCEPTION 'execution_approvals has no non-partial unique key on (company_id, campaign_id, version); recordApproval''s upsert would fail';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_execution_approvals_lookup
  ON public.execution_approvals (company_id, campaign_id, version) WHERE active;

ALTER TABLE public.execution_approvals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS execution_service_role ON public.execution_approvals;
CREATE POLICY execution_service_role ON public.execution_approvals
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- No client-role access at all (default privileges grant authenticated ALL on new tables).
REVOKE ALL ON TABLE public.execution_approvals FROM PUBLIC, anon, authenticated;
-- recordApproval: INSERT … ON CONFLICT DO UPDATE … RETURNING; revokeApproval: UPDATE; bridge: SELECT.
GRANT SELECT, INSERT, UPDATE ON TABLE public.execution_approvals TO service_role;

COMMENT ON TABLE public.execution_approvals IS
  'ES-101 — server-owned approval authority; the execution bridge trusts ONLY this (never client-asserted approval). Active + non-revoked + non-expired + version-bound required to dispatch. Service-role only.';

-- Postconditions: the transaction commits only in the intended end state.
DO $$
DECLARE
  rel oid := 'public.execution_approvals'::regclass;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = rel) THEN
    RAISE EXCEPTION 'postcondition: RLS is not enabled on execution_approvals';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = rel AND polname = 'execution_service_role') THEN
    RAISE EXCEPTION 'postcondition: service-role policy missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = rel
              AND EXISTS (SELECT 1 FROM unnest(p.polroles) r WHERE r = 0 OR r IN ('anon'::regrole, 'authenticated'::regrole))) THEN
    RAISE EXCEPTION 'postcondition: a policy applies to PUBLIC/anon/authenticated';
  END IF;
  IF has_table_privilege('anon', rel, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_table_privilege('authenticated', rel, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
    RAISE EXCEPTION 'postcondition: anon/authenticated still hold a privilege on execution_approvals';
  END IF;
  IF NOT (has_table_privilege('service_role', rel, 'SELECT') AND has_table_privilege('service_role', rel, 'INSERT')
          AND has_table_privilege('service_role', rel, 'UPDATE')) THEN
    RAISE EXCEPTION 'postcondition: service_role lacks SELECT/INSERT/UPDATE on execution_approvals';
  END IF;
END $$;

COMMIT;
