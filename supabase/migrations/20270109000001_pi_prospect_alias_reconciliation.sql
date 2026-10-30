-- PI / Prospect provenance — closure-B: prospect ALIASES (identity ordering reconciliation).
--
-- WHAT THIS STORES. One row per canonical prospect that was ABSORBED into
-- another because a VERIFIED identity proved they are the same person:
-- `alias_lead_id` → `survivor_lead_id`. Typical case: community evidence by an
-- unverified author created a person-less, handle-anchored prospect; PI
-- discovery created the person's prospect; the handle was later verified to
-- that person (one active, linked identity_claims external_id row — the
-- existing rule in backend/services/prospectProvenance/bridge/verifiedIdentity.ts).
-- The only writer is backend/services/prospectProvenance/prospectAliasStore.ts,
-- driven by identityReconciliation.ts; the survivor rule is documented there.
--
-- NOTHING IS MOVED OR REWRITTEN. The absorbed prospect keeps its row, its key,
-- its source and every prospect_source_contributions row (append-only ledger).
-- Readers resolve an alias onto its survivor (lib/prospectProvenance/
-- prospectAliases.ts; the unified lead reader; the operations overlay).
--
-- ─── INVARIANTS (enforced here, not only in code) ─────────────────────────
--   tenant     alias and survivor are leads of organization_id: two COMPOSITE
--              FKs onto canonical_leads (id, company_id). A lead of another
--              tenant is rejected with 23503 by PostgreSQL itself.
--   one        UNIQUE (organization_id, alias_lead_id): an alias has exactly one
--              survivor and is never re-pointed (no UPDATE privilege; an UPDATE
--              by the owner is refused by trigger).
--   no self    CHECK alias_lead_id <> survivor_lead_id.
--   flat       BEFORE INSERT trigger: the survivor must not itself be an alias
--              (pa_survivor_is_terminal) and the alias must not already be a
--              survivor of other aliases (pa_alias_has_no_aliases). Every alias
--              therefore points at a TERMINAL survivor and no cycle can form.
--              The trigger takes a per-tenant transaction advisory lock, so two
--              concurrent inserts cannot each pass the check and build a chain.
--
-- ─── ON DELETE ───────────────────────────────────────────────────────────
--   companies        CASCADE  tenant offboarding removes everything it owns.
--   canonical_leads  CASCADE  (both FKs) an alias has no meaning without both
--                             leads; erasing a prospect must not be blocked by
--                             an alias. If the survivor is deleted, the absorbed
--                             prospect is simply its own lead again.
--
-- Re-runnable throughout: every object is created IF NOT EXISTS, guarded by
-- name or CREATE OR REPLACE, and the postcondition block re-proves the end state.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.companies') IS NULL THEN
    RAISE EXCEPTION 'PA preflight: public.companies is missing — there is no tenant to own an alias';
  END IF;

  IF to_regclass('public.canonical_leads') IS NULL THEN
    RAISE EXCEPTION 'PA preflight: public.canonical_leads is missing — there is no prospect to alias';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname = 'public' AND indexname = 'idx_canonical_leads_id_company') THEN
    RAISE EXCEPTION 'PA preflight: idx_canonical_leads_id_company missing — cannot build a tenant-safe lead reference';
  END IF;

  IF to_regprocedure('auth.role()') IS NULL THEN
    RAISE EXCEPTION 'PA preflight: auth.role() is missing — the house service_role policy cannot be expressed';
  END IF;
END
$preflight$;

-- ── 1. The alias table ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.prospect_aliases (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id   uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  alias_lead_id     uuid NOT NULL,
  survivor_lead_id  uuid NOT NULL,

  reason            text NOT NULL,
  rule_version      text NOT NULL,
  evidence          jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pa_not_self
    CHECK (alias_lead_id <> survivor_lead_id),
  CONSTRAINT pa_reason_valid
    CHECK (reason IN ('verified_identity')),
  CONSTRAINT pa_rule_version_present
    CHECK (length(btrim(rule_version)) > 0),
  CONSTRAINT pa_evidence_is_object
    CHECK (jsonb_typeof(evidence) = 'object'),

  CONSTRAINT uq_prospect_alias_org_alias
    UNIQUE (organization_id, alias_lead_id)
);

-- Survivor lookups (reader: "everything absorbed into S") and the survivor FK's
-- referential-action support.
CREATE INDEX IF NOT EXISTS idx_pa_org_survivor
  ON public.prospect_aliases (organization_id, survivor_lead_id);

DO $pa_fks$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pa_alias_lead_tenant_fk') THEN
    ALTER TABLE public.prospect_aliases
      ADD CONSTRAINT pa_alias_lead_tenant_fk
      FOREIGN KEY (alias_lead_id, organization_id)
      REFERENCES public.canonical_leads (id, company_id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pa_survivor_lead_tenant_fk') THEN
    ALTER TABLE public.prospect_aliases
      ADD CONSTRAINT pa_survivor_lead_tenant_fk
      FOREIGN KEY (survivor_lead_id, organization_id)
      REFERENCES public.canonical_leads (id, company_id) ON DELETE CASCADE;
  END IF;
END
$pa_fks$;

-- ── 2. Flat, acyclic, append-only: guard triggers ────────────────────────
-- Not SECURITY DEFINER: it runs as the inserting role (service_role holds
-- SELECT on the table, which is all the check reads).

CREATE OR REPLACE FUNCTION public.pi_prospect_alias_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'pa_append_only: prospect_aliases rows are never updated (an alias is never re-pointed)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'pa_append_only';
  END IF;

  -- Serialise alias writes per tenant so the two checks below cannot race.
  PERFORM pg_advisory_xact_lock(hashtextextended('pi_prospect_alias:' || NEW.organization_id::text, 0));

  IF EXISTS (SELECT 1 FROM public.prospect_aliases a
              WHERE a.organization_id = NEW.organization_id
                AND a.alias_lead_id = NEW.survivor_lead_id) THEN
    RAISE EXCEPTION 'pa_survivor_is_terminal: the survivor is itself an alias — point at its terminal survivor'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'pa_survivor_is_terminal';
  END IF;

  IF EXISTS (SELECT 1 FROM public.prospect_aliases a
              WHERE a.organization_id = NEW.organization_id
                AND a.survivor_lead_id = NEW.alias_lead_id) THEN
    RAISE EXCEPTION 'pa_alias_has_no_aliases: the prospect already absorbed others and cannot become an alias'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'pa_alias_has_no_aliases';
  END IF;

  RETURN NEW;
END
$fn$;

REVOKE ALL ON FUNCTION public.pi_prospect_alias_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_pa_guard_insert ON public.prospect_aliases;
CREATE TRIGGER trg_pa_guard_insert
  BEFORE INSERT ON public.prospect_aliases
  FOR EACH ROW EXECUTE FUNCTION public.pi_prospect_alias_guard();

DROP TRIGGER IF EXISTS trg_pa_guard_update ON public.prospect_aliases;
CREATE TRIGGER trg_pa_guard_update
  BEFORE UPDATE ON public.prospect_aliases
  FOR EACH ROW EXECUTE FUNCTION public.pi_prospect_alias_guard();

-- ── 3. Exposure: RLS, one service_role policy, SELECT + INSERT only ───────

ALTER TABLE public.prospect_aliases ENABLE ROW LEVEL SECURITY;

DO $pa_rls$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'prospect_aliases'
       AND policyname = 'prospect_aliases_service_role'
       AND roles::text[] <> ARRAY['service_role']
  ) THEN
    DROP POLICY prospect_aliases_service_role ON public.prospect_aliases;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'prospect_aliases'
       AND policyname = 'prospect_aliases_service_role'
  ) THEN
    CREATE POLICY prospect_aliases_service_role
      ON public.prospect_aliases
      FOR ALL
      TO service_role
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END
$pa_rls$;

REVOKE ALL ON TABLE public.prospect_aliases
  FROM PUBLIC, anon, authenticated, authenticator, service_role;
GRANT SELECT, INSERT ON TABLE public.prospect_aliases TO service_role;

COMMENT ON TABLE public.prospect_aliases IS
  'PI provenance closure-B: canonical prospect ALIASES. alias_lead_id was absorbed into '
  'survivor_lead_id because a verified identity (identity_claims rule) proved them the '
  'same person. Append-only (service_role SELECT+INSERT only), tenant-scoped (composite '
  'FKs), flat (survivor is terminal; trigger-enforced). Nothing is moved: readers resolve '
  'an alias onto its survivor. Writer: backend/services/prospectProvenance/prospectAliasStore.ts.';
COMMENT ON COLUMN public.prospect_aliases.reason IS
  'Why the alias exists. verified_identity = the reconciliation rule cb.reconcile.* '
  '(backend/services/prospectProvenance/identityReconciliation.ts).';
COMMENT ON COLUMN public.prospect_aliases.evidence IS
  'Audit: verification rule, platform, normalised handle and person id the merge rested on.';

-- ── 4. Postconditions ─────────────────────────────────────────────────────

DO $verify$
DECLARE
  v_n           INT;
  v_rls         BOOLEAN;
  v_force       BOOLEAN;
  v_pol_roles   text[];
  v_priv        text[];
  v_leaked      text[];
  v_cfg         text[];
BEGIN
  IF to_regclass('public.prospect_aliases') IS NULL THEN
    RAISE EXCEPTION 'PA postcondition: the table is missing';
  END IF;

  -- Two composite tenant FKs onto canonical_leads, both ON DELETE CASCADE.
  SELECT count(*) INTO v_n
    FROM pg_constraint
   WHERE conrelid = 'public.prospect_aliases'::regclass
     AND contype = 'f' AND array_length(conkey, 1) = 2
     AND confrelid = 'public.canonical_leads'::regclass
     AND confdeltype = 'c'
     AND conname IN ('pa_alias_lead_tenant_fk', 'pa_survivor_lead_tenant_fk');
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'PA postcondition: expected 2 composite canonical_leads (id, company_id) FKs ON DELETE CASCADE, found %', v_n;
  END IF;

  IF pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'pa_alias_lead_tenant_fk'
                             AND conrelid = 'public.prospect_aliases'::regclass))
     NOT LIKE 'FOREIGN KEY (alias_lead_id, organization_id) REFERENCES canonical_leads(id, company_id)%' THEN
    RAISE EXCEPTION 'PA postcondition: pa_alias_lead_tenant_fk must be (alias_lead_id, organization_id) -> canonical_leads(id, company_id)';
  END IF;
  IF pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'pa_survivor_lead_tenant_fk'
                             AND conrelid = 'public.prospect_aliases'::regclass))
     NOT LIKE 'FOREIGN KEY (survivor_lead_id, organization_id) REFERENCES canonical_leads(id, company_id)%' THEN
    RAISE EXCEPTION 'PA postcondition: pa_survivor_lead_tenant_fk must be (survivor_lead_id, organization_id) -> canonical_leads(id, company_id)';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.prospect_aliases'::regclass
                    AND contype = 'f' AND confrelid = 'public.companies'::regclass
                    AND confdeltype = 'c') THEN
    RAISE EXCEPTION 'PA postcondition: organization_id must reference companies ON DELETE CASCADE';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'uq_prospect_alias_org_alias' AND contype = 'u'
                    AND conrelid = 'public.prospect_aliases'::regclass
                    AND pg_get_constraintdef(oid) = 'UNIQUE (organization_id, alias_lead_id)') THEN
    RAISE EXCEPTION 'PA postcondition: uq_prospect_alias_org_alias must be UNIQUE (organization_id, alias_lead_id)';
  END IF;

  SELECT count(*) INTO v_n FROM pg_constraint
   WHERE conrelid = 'public.prospect_aliases'::regclass AND contype = 'c'
     AND conname IN ('pa_not_self', 'pa_reason_valid', 'pa_rule_version_present', 'pa_evidence_is_object');
  IF v_n <> 4 THEN
    RAISE EXCEPTION 'PA postcondition: expected 4 named CHECK constraints, found %', v_n;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname = 'public' AND tablename = 'prospect_aliases'
                    AND indexname = 'idx_pa_org_survivor') THEN
    RAISE EXCEPTION 'PA postcondition: idx_pa_org_survivor is missing';
  END IF;

  -- Guard triggers, enabled, on the right events.
  SELECT count(*) INTO v_n FROM pg_trigger t
   WHERE t.tgrelid = 'public.prospect_aliases'::regclass AND NOT t.tgisinternal
     AND t.tgenabled <> 'D'
     AND t.tgfoid = 'public.pi_prospect_alias_guard()'::regprocedure
     AND t.tgname IN ('trg_pa_guard_insert', 'trg_pa_guard_update');
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'PA postcondition: expected 2 enabled guard triggers (insert, update), found %', v_n;
  END IF;

  SELECT p.proconfig INTO v_cfg FROM pg_proc p WHERE p.oid = 'public.pi_prospect_alias_guard()'::regprocedure;
  IF v_cfg IS NULL OR NOT (v_cfg @> ARRAY['search_path=public, pg_temp']) THEN
    RAISE EXCEPTION 'PA postcondition: pi_prospect_alias_guard must pin search_path, found %', v_cfg;
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.pi_prospect_alias_guard()'::regprocedure) THEN
    RAISE EXCEPTION 'PA postcondition: pi_prospect_alias_guard must NOT be SECURITY DEFINER';
  END IF;
  IF has_function_privilege('anon', 'public.pi_prospect_alias_guard()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.pi_prospect_alias_guard()', 'EXECUTE') THEN
    RAISE EXCEPTION 'PA postcondition: anon/authenticated must not hold EXECUTE on pi_prospect_alias_guard';
  END IF;

  -- RLS and privileges.
  SELECT c.relrowsecurity, c.relforcerowsecurity INTO v_rls, v_force
    FROM pg_class c WHERE c.oid = 'public.prospect_aliases'::regclass;
  IF NOT v_rls THEN
    RAISE EXCEPTION 'PA postcondition: row level security must be ENABLED';
  END IF;
  IF v_force THEN
    RAISE EXCEPTION 'PA postcondition: row level security must NOT be FORCED — FORCE would subject the owner and break referential actions';
  END IF;

  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'prospect_aliases';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'PA postcondition: expected exactly 1 policy, found %', v_n;
  END IF;
  SELECT roles::text[] INTO v_pol_roles FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'prospect_aliases'
     AND policyname = 'prospect_aliases_service_role';
  IF v_pol_roles IS DISTINCT FROM ARRAY['service_role'] THEN
    RAISE EXCEPTION 'PA postcondition: the policy must apply to exactly {service_role}, found %', v_pol_roles;
  END IF;

  SELECT array_agg(DISTINCT a.privilege_type ORDER BY a.privilege_type) INTO v_priv
    FROM pg_class c
    CROSS JOIN LATERAL aclexplode(c.relacl) a
    JOIN pg_roles r2 ON r2.oid = a.grantee
   WHERE c.oid = 'public.prospect_aliases'::regclass
     AND r2.rolname = 'service_role';
  IF v_priv IS DISTINCT FROM ARRAY['INSERT', 'SELECT'] THEN
    RAISE EXCEPTION 'PA postcondition: service_role must hold exactly {INSERT,SELECT} (append-only), found %',
      coalesce(v_priv::text, '{}');
  END IF;

  SELECT array_agg(DISTINCT r2.rolname || ':' || a.privilege_type) INTO v_leaked
    FROM pg_class c
    CROSS JOIN LATERAL aclexplode(c.relacl) a
    JOIN pg_roles r2 ON r2.oid = a.grantee
   WHERE c.oid = 'public.prospect_aliases'::regclass
     AND r2.rolname IN ('anon', 'authenticated', 'authenticator');
  IF v_leaked IS NOT NULL THEN
    RAISE EXCEPTION 'PA postcondition: anon, authenticated and authenticator must hold nothing, found %', v_leaked;
  END IF;

  SELECT count(*) INTO v_n
    FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
   WHERE c.oid = 'public.prospect_aliases'::regclass AND a.grantee = 0;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'PA postcondition: PUBLIC must hold no privilege, found % grant(s)', v_n;
  END IF;

  RAISE NOTICE 'PA: prospect_aliases verified — 2 composite canonical_leads tenant FKs (CASCADE), companies FK, uq_prospect_alias_org_alias, 4 CHECKs, idx_pa_org_survivor, 2 guard triggers (terminal survivor, no alias of an alias, no update; search_path pinned, not SECURITY DEFINER); RLS enabled, not forced, 1 service_role policy; service_role SELECT+INSERT only.';
END
$verify$;

COMMIT;
