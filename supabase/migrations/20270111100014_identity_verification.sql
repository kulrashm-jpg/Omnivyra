-- ===========================================================================
-- Identity verification — a tenant-scoped, audited OPERATOR ATTESTATION record
-- that can never verify anything, and an evidence guard on community links.
--
-- WHY (inspected 2026-10-28)
--   No code path proves that an external platform account belongs to a specific
--   PERSON (prospect). Every identity_claims writer records 'unverified'; every
--   platform OAuth flow is completed by a signed-in TENANT user and stores the
--   tenant's token — it proves the tenant owns an account, not a prospect. So:
--
--   1. identity_verification_attestations — an operator's statement that an
--      account is a person's, with who/when/how/what, step-up provenance and a
--      lifecycle (recorded → withdrawn). It is a RECORD, not a proof:
--        * it has no path to identity_claims (no FK from claims, no trigger that
--          writes claims, no function that sets verification_state);
--        * `confers_verification` is CHECKed false;
--        * `method` is a closed set holding only 'operator_attestation'.
--   2. trg_community_action_journey_links_identity_proof_guard — a link's claim
--      must carry an ACCEPTED person-level proof in `evidence` (today only
--      'subject_platform_oauth', which has no writer), consistent with the claim
--      (tenant, person, platform, provider id) and not stale (365 days) — the
--      database mirror of identityVerification/verificationContract.ts. A claim
--      marked verified on operator say-so never satisfies it.
--
-- Touches NO existing table's columns, constraints or status semantics
-- (identity_claims is read only; its CHECKs are untouched). Additive.
-- Contains no SECURITY DEFINER function. NOT applied anywhere yet.
-- ROLLBACK: supabase/migrations/rollbacks/identity_verification_rollback.sql
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. Preconditions.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.identity_claims') IS NULL THEN
    RAISE EXCEPTION 'identity verification: identity_claims (20260920000000) is missing';
  END IF;
  IF to_regclass('public.uq_unified_persons_id_company') IS NULL THEN
    RAISE EXCEPTION 'identity verification: uq_unified_persons_id_company is missing — no tenant-safe person reference';
  END IF;
  IF to_regclass('public.community_ai_discovered_users') IS NULL THEN
    RAISE EXCEPTION 'identity verification: community_ai_discovered_users is missing';
  END IF;
  IF to_regclass('public.community_action_journey_links') IS NULL THEN
    RAISE EXCEPTION 'identity verification: community_action_journey_links (20261231000003) is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE NOT tgisinternal AND tgname = 'trg_community_action_journey_links_identity_guard'
       AND tgrelid = 'public.community_action_journey_links'::regclass
  ) THEN
    RAISE EXCEPTION 'identity verification: the 20261231000006 identity guard is missing';
  END IF;
  IF to_regprocedure('public.community_identity_normalize_external_id(text)') IS NULL THEN
    RAISE EXCEPTION 'identity verification: community_identity_normalize_external_id (20261231000006) is missing';
  END IF;
  -- The two checks this design relies on must still be there, unchanged in kind.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.identity_claims'::regclass
                    AND conname = 'identity_claims_verified_coherent' AND contype = 'c') THEN
    RAISE EXCEPTION 'identity verification: identity_claims_verified_coherent is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.identity_claims'::regclass
                    AND conname = 'identity_claims_evidence_object' AND contype = 'c') THEN
    RAISE EXCEPTION 'identity verification: identity_claims_evidence_object is missing';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. The attestation record.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.identity_verification_attestations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  -- Subject person (composite tenant FK below) and the account, by its canonical key.
  person_id             uuid NOT NULL,
  platform              text NOT NULL,
  provider_user_id      text NOT NULL,       -- normalized as identity_claims.normalized_value
  identity_claim_id     uuid,                -- optional: the claim the attestation concerns (validated, not FK)
  discovered_user_id    uuid,                -- optional: the engine's account row (validated, not FK)

  -- What the operator states, and on what basis.
  method                text NOT NULL DEFAULT 'operator_attestation',
  basis                 text NOT NULL,
  statement             text NOT NULL,
  evidence              jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Who, with which authority.
  attested_by           uuid NOT NULL,
  step_up_session_id    text,
  step_up_factor        text,
  attested_at           timestamptz NOT NULL DEFAULT now(),

  -- Lifecycle. There is no 'verified' / 'approved' state, by construction.
  status                text NOT NULL DEFAULT 'recorded',
  withdrawn_at          timestamptz,
  withdrawn_by          uuid,
  withdrawn_reason      text,

  confers_verification  boolean NOT NULL DEFAULT false,

  created_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT identity_verification_attestations_never_verifies CHECK (confers_verification = false),
  CONSTRAINT identity_verification_attestations_method_valid CHECK (method IN ('operator_attestation')),
  CONSTRAINT identity_verification_attestations_basis_valid
    CHECK (basis IN ('public_profile_review', 'direct_communication', 'customer_provided', 'other')),
  CONSTRAINT identity_verification_attestations_status_valid CHECK (status IN ('recorded', 'withdrawn')),
  CONSTRAINT identity_verification_attestations_withdrawn_coherent CHECK (
    (status = 'withdrawn') = (withdrawn_at IS NOT NULL)
    AND (status = 'withdrawn') = (withdrawn_by IS NOT NULL)
    AND (status <> 'withdrawn' OR length(btrim(coalesce(withdrawn_reason, ''))) > 0)
  ),
  CONSTRAINT identity_verification_attestations_platform_rule
    CHECK (length(btrim(platform)) > 0 AND platform = lower(btrim(platform))),
  CONSTRAINT identity_verification_attestations_provider_rule
    CHECK (length(btrim(provider_user_id)) > 0 AND provider_user_id = lower(provider_user_id)),
  CONSTRAINT identity_verification_attestations_statement_rule
    CHECK (length(btrim(statement)) BETWEEN 10 AND 2000),
  CONSTRAINT identity_verification_attestations_evidence_object
    CHECK (jsonb_typeof(evidence) = 'object' AND octet_length(evidence::text) <= 16384)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.identity_verification_attestations'::regclass
                    AND conname = 'identity_verification_attestations_person_fk') THEN
    ALTER TABLE public.identity_verification_attestations
      ADD CONSTRAINT identity_verification_attestations_person_fk
      FOREIGN KEY (person_id, organization_id)
      REFERENCES public.unified_persons (id, company_id) ON DELETE CASCADE;
  END IF;
END $$;

-- One RECORDED attestation per account per tenant: two operators cannot attest
-- the same account to two people concurrently; the loser reads the winner.
CREATE UNIQUE INDEX IF NOT EXISTS uq_identity_verification_attestations_active_account
  ON public.identity_verification_attestations (organization_id, platform, provider_user_id)
  WHERE status = 'recorded';

CREATE INDEX IF NOT EXISTS ix_identity_verification_attestations_person
  ON public.identity_verification_attestations (organization_id, person_id, attested_at DESC);

-- ---------------------------------------------------------------------------
-- 2. The attestation guard: tenant-consistent references, and an append-only
--    lifecycle (the only UPDATE is recorded → withdrawn). DELETE is left to the
--    person cascade (erasure) and the service role.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.identity_verification_attestations_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_claim record;
  v_du    record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status <> 'recorded' OR NEW.status <> 'withdrawn'
       OR NEW.id IS DISTINCT FROM OLD.id
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.person_id IS DISTINCT FROM OLD.person_id
       OR NEW.platform IS DISTINCT FROM OLD.platform
       OR NEW.provider_user_id IS DISTINCT FROM OLD.provider_user_id
       OR NEW.identity_claim_id IS DISTINCT FROM OLD.identity_claim_id
       OR NEW.discovered_user_id IS DISTINCT FROM OLD.discovered_user_id
       OR NEW.method IS DISTINCT FROM OLD.method
       OR NEW.basis IS DISTINCT FROM OLD.basis
       OR NEW.statement IS DISTINCT FROM OLD.statement
       OR NEW.evidence IS DISTINCT FROM OLD.evidence
       OR NEW.attested_by IS DISTINCT FROM OLD.attested_by
       OR NEW.step_up_session_id IS DISTINCT FROM OLD.step_up_session_id
       OR NEW.step_up_factor IS DISTINCT FROM OLD.step_up_factor
       OR NEW.attested_at IS DISTINCT FROM OLD.attested_at
       OR NEW.confers_verification IS DISTINCT FROM OLD.confers_verification
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'iva:immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  -- INSERT
  IF NEW.status <> 'recorded' THEN
    RAISE EXCEPTION 'iva:status_invalid' USING ERRCODE = '23514';
  END IF;
  IF public.community_identity_normalize_external_id(NEW.provider_user_id) IS DISTINCT FROM NEW.provider_user_id THEN
    RAISE EXCEPTION 'iva:provider_user_id_not_normalized' USING ERRCODE = '23514';
  END IF;
  IF NEW.identity_claim_id IS NOT NULL THEN
    SELECT c.person_id, c.claim_type, c.platform, c.normalized_value, c.revoked_at
      INTO v_claim
      FROM public.identity_claims c
     WHERE c.id = NEW.identity_claim_id AND c.organization_id = NEW.organization_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'iva:claim_not_found' USING ERRCODE = '23514';
    END IF;
    IF v_claim.claim_type IS DISTINCT FROM 'external_id'
       OR v_claim.platform IS DISTINCT FROM NEW.platform
       OR v_claim.normalized_value IS DISTINCT FROM NEW.provider_user_id THEN
      RAISE EXCEPTION 'iva:claim_account_mismatch' USING ERRCODE = '23514';
    END IF;
    IF v_claim.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'iva:claim_revoked' USING ERRCODE = '23514';
    END IF;
    IF v_claim.person_id IS NOT NULL AND v_claim.person_id IS DISTINCT FROM NEW.person_id THEN
      RAISE EXCEPTION 'iva:claim_person_mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.discovered_user_id IS NOT NULL THEN
    SELECT d.tenant_id, d.platform, d.external_user_id
      INTO v_du
      FROM public.community_ai_discovered_users d
     WHERE d.id = NEW.discovered_user_id AND d.organization_id = NEW.organization_id;
    IF NOT FOUND OR v_du.tenant_id IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'iva:discovered_user_not_found' USING ERRCODE = '23514';
    END IF;
    IF lower(btrim(coalesce(v_du.platform, ''))) IS DISTINCT FROM NEW.platform
       OR public.community_identity_normalize_external_id(v_du.external_user_id) IS DISTINCT FROM NEW.provider_user_id THEN
      RAISE EXCEPTION 'iva:discovered_user_account_mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_identity_verification_attestations_guard ON public.identity_verification_attestations;
CREATE TRIGGER trg_identity_verification_attestations_guard
  BEFORE INSERT OR UPDATE ON public.identity_verification_attestations
  FOR EACH ROW EXECUTE FUNCTION public.identity_verification_attestations_guard();

-- ---------------------------------------------------------------------------
-- 3. Access: service role only. RLS on; nothing for anon / authenticated.
-- ---------------------------------------------------------------------------
ALTER TABLE public.identity_verification_attestations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY identity_verification_attestations_service_role ON public.identity_verification_attestations
    FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
REVOKE ALL ON public.identity_verification_attestations FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.identity_verification_attestations_guard() FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.identity_verification_attestations IS
  'Operator attestation that a platform account is a person''s. A RECORD, never a proof: confers_verification is CHECKed false and nothing here writes identity_claims. See backend/services/identityVerification/verificationContract.ts for what a future confirmation would need.';

-- ---------------------------------------------------------------------------
-- 4. Community link evidence guard — fires after the 20261231000006 identity
--    guard (trigger names fire alphabetically: ..._identity_guard <
--    ..._identity_proof_guard). Mirrors evaluateClaimEvidence.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.community_action_journey_links_identity_proof_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_claim record;
  v_ev    jsonb;
  v_at    timestamptz;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RETURN NEW;
  END IF;
  SELECT c.organization_id, c.person_id, c.platform, c.normalized_value,
         c.verification_state, c.verified_at, c.revoked_at, c.evidence
    INTO v_claim
    FROM public.identity_claims c
   WHERE c.id = NEW.identity_claim_id AND c.organization_id = NEW.organization_id;
  IF NOT FOUND OR v_claim.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'cajl:identity_unclaimed' USING ERRCODE = '23514';
  END IF;
  IF v_claim.verification_state IS DISTINCT FROM 'verified' OR v_claim.verified_at IS NULL THEN
    RAISE EXCEPTION 'cajl:identity_unverified' USING ERRCODE = '23514';
  END IF;

  v_ev := v_claim.evidence;
  IF v_ev IS NULL OR jsonb_typeof(v_ev) IS DISTINCT FROM 'object'
     -- The accepted-method allow-list. Operator attestation is not on it.
     OR (v_ev ->> 'method') IS DISTINCT FROM 'subject_platform_oauth'
     OR (v_ev ->> 'organization_id') IS DISTINCT FROM NEW.organization_id::text
     OR (v_ev ->> 'subject_person_id') IS DISTINCT FROM v_claim.person_id::text
     OR (v_ev ->> 'subject_person_id') IS DISTINCT FROM NEW.person_id::text
     OR lower(btrim(coalesce(v_ev ->> 'provider', ''))) IS DISTINCT FROM v_claim.platform
     OR public.community_identity_normalize_external_id(v_ev ->> 'provider_user_id') IS DISTINCT FROM v_claim.normalized_value
     OR length(btrim(coalesce(v_ev ->> 'flow_id', ''))) = 0 THEN
    RAISE EXCEPTION 'cajl:identity_evidence_insufficient' USING ERRCODE = '23514';
  END IF;
  BEGIN
    v_at := (v_ev ->> 'completed_at')::timestamptz;
  EXCEPTION WHEN others THEN
    v_at := NULL;
  END;
  IF v_at IS NULL OR v_at > now() + interval '5 minutes' OR v_at < now() - interval '365 days' THEN
    RAISE EXCEPTION 'cajl:identity_evidence_insufficient' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_community_action_journey_links_identity_proof_guard ON public.community_action_journey_links;
CREATE TRIGGER trg_community_action_journey_links_identity_proof_guard
  BEFORE INSERT ON public.community_action_journey_links
  FOR EACH ROW EXECUTE FUNCTION public.community_action_journey_links_identity_proof_guard();
REVOKE EXECUTE ON FUNCTION public.community_action_journey_links_identity_proof_guard() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Postconditions.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.identity_verification_attestations'::regclass) THEN
    RAISE EXCEPTION 'identity verification postcondition: RLS is off on identity_verification_attestations';
  END IF;
  IF has_table_privilege('anon', 'public.identity_verification_attestations', 'SELECT')
     OR has_table_privilege('authenticated', 'public.identity_verification_attestations', 'SELECT')
     OR has_table_privilege('authenticated', 'public.identity_verification_attestations', 'INSERT') THEN
    RAISE EXCEPTION 'identity verification postcondition: anon/authenticated still hold privileges';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.identity_verification_attestations'::regclass
                    AND conname = 'identity_verification_attestations_never_verifies' AND contype = 'c') THEN
    RAISE EXCEPTION 'identity verification postcondition: the never-verifies check is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.identity_verification_attestations'::regclass
                    AND conname = 'identity_verification_attestations_person_fk' AND contype = 'f') THEN
    RAISE EXCEPTION 'identity verification postcondition: the tenant-composite person FK is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE NOT tgisinternal AND tgname = 'trg_identity_verification_attestations_guard'
                    AND tgrelid = 'public.identity_verification_attestations'::regclass) THEN
    RAISE EXCEPTION 'identity verification postcondition: the attestation guard is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE NOT tgisinternal AND tgname = 'trg_community_action_journey_links_identity_proof_guard'
                    AND tgrelid = 'public.community_action_journey_links'::regclass) THEN
    RAISE EXCEPTION 'identity verification postcondition: the link evidence guard is missing';
  END IF;
  -- Nothing here may write identity_claims: no trigger of this migration sits on it.
  IF EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
              WHERE NOT t.tgisinternal AND t.tgrelid = 'public.identity_claims'::regclass
                AND p.proname IN ('identity_verification_attestations_guard',
                                  'community_action_journey_links_identity_proof_guard')) THEN
    RAISE EXCEPTION 'identity verification postcondition: a verification function is attached to identity_claims';
  END IF;
END $$;
