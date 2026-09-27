-- PI-SCORE-PROVENANCE-001 — the durable, attributable scoring evaluation.
--
-- The scoring machinery was already correct, tenant-specific and explainable.
-- It was simply never written down: `prospectIntelligenceRead` recomputes on
-- every request and performs zero writes, so ratifying a new ICP version
-- silently changed every number a tenant had already been shown, with no record
-- that it had ever differed. "This prospect scored 82 under ICP v1" and "this
-- prospect currently scores 82" were the same sentence.
--
-- This table is the difference between those two sentences. It stores what the
-- canonical evaluator produced, and NOTHING it did not.
--
-- ─── IT IS A RECORD, NOT A SCORER ─────────────────────────────────────────
-- No weight, threshold, normalisation or default lives here. The five
-- dimensions and the overall score are stored exactly as the combiner emitted
-- them, including their nulls. If this table and the scoring engine ever
-- disagree, the engine is right and this row is stale — never the reverse.
--
-- ─── WHY NOT `lead_understanding_shadow` ──────────────────────────────────
-- That table has existed as a migration since 20260728000000 and has never
-- existed as a table: its version sorts BELOW the baseline's ledger position,
-- so canonical replay skips it, and it is absent from the production schema
-- dump. A persistence target that survives neither production nor a canonical
-- rebuild is not a persistence target. This migration sorts above the ledger
-- floor precisely so it cannot repeat that.
--
-- ─── NULL IS A SCORE-SHAPED HOLE, NOT A ZERO ──────────────────────────────
-- Every dimension is nullable because the combiner ABSTAINS. A dimension with
-- no evidence emits null, and the platform's whole posture is that an
-- abstention is not a zero: a prospect is not a worse lead because we never
-- enriched them. Storing 0 for an abstention would fabricate a verdict the
-- evaluator refused to give, so the column carries the refusal through.
--
-- `double precision` rather than `numeric` is deliberate: the evaluator works in
-- IEEE-754 doubles, and this column must round-trip them exactly so a stored
-- score can be compared for EQUALITY with a recomputed one. `numeric` would
-- convert, and a provenance table that cannot prove parity is pointless.

CREATE TABLE IF NOT EXISTS public.prospect_score_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- TENANT. uuid with a real foreign key, never the legacy `company_id text`.
  organization_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,

  -- SUBJECT. Every reference below is a TENANT-SAFE COMPOSITE foreign key: the
  -- tenant column travels INTO the constraint, so a row cannot cite another
  -- tenant's prospect, person, account or ICP even if the id were guessed. The
  -- companion unique indexes these depend on already exist
  -- (`idx_canonical_leads_id_company`, `uq_unified_persons_id_company`,
  -- `uq_prospect_accounts_id_org`, `uq_prospect_icps_id_org`).
  prospect_id uuid NOT NULL,
  person_id   uuid,
  account_id  uuid,

  -- ICP PROVENANCE. Null when the evaluator ABSTAINED because the tenant has no
  -- ratified ICP — which is a real, reportable outcome and must not be confused
  -- with a score of zero. The CHECK below keeps id and version coherent so a row
  -- can never claim a version without naming the profile it belongs to.
  icp_id      uuid,
  icp_version integer,

  -- RULES PROVENANCE. Which scoring rules produced this. Governed by
  -- `scripts/ci/scoring-surface-digest.js`, which fails CI if any of the 14
  -- score-producing files changes without this version changing.
  rules_version text NOT NULL,

  -- TIME. `scored_at` is the evaluator's own `asOf` — the instant the facts were
  -- judged, injected by the caller. `evaluated_at` is when the row was written.
  -- They are different questions and a replay makes them differ, so neither is
  -- derived from the other and there is no second clock.
  scored_at    timestamptz NOT NULL,
  evaluated_at timestamptz NOT NULL DEFAULT now(),

  -- THE RESULT. Five dimensions plus the blended overall, exactly as emitted.
  score_intent      double precision,
  score_icp         double precision,
  score_urgency     double precision,
  score_opportunity double precision,
  score_priority    double precision,
  score_overall     double precision,
  confidence        double precision NOT NULL,

  -- THE EXPLANATION. The evaluator's own structures, stored verbatim. No second
  -- explanation model: re-shaping them here would make the stored reason differ
  -- from the returned reason, which is the one thing a provenance row may not do.
  contributions jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence      jsonb NOT NULL DEFAULT '[]'::jsonb,
  reasoning     jsonb NOT NULL DEFAULT '[]'::jsonb,
  facets        jsonb NOT NULL DEFAULT '{}'::jsonb,
  context_gaps  jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- IDEMPOTENCY. A digest of the evaluation INPUTS (subject facts + ICP version
  -- + rules version). Re-running the job over an unchanged prospect produces the
  -- same digest and inserts nothing, so retries, overlapping ticks and a
  -- re-enqueued backlog cannot accumulate duplicate history. Changed facts, a
  -- new ICP version or new rules all move the digest, which is exactly when a
  -- NEW historical row is the correct outcome.
  input_digest text NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT prospect_score_evaluations_rules_version_not_blank
    CHECK (length(btrim(rules_version)) > 0),
  CONSTRAINT prospect_score_evaluations_input_digest_not_blank
    CHECK (length(btrim(input_digest)) > 0),
  -- An ICP version without an ICP id (or the reverse) would be unattributable.
  CONSTRAINT prospect_score_evaluations_icp_coherent
    CHECK ((icp_id IS NULL) = (icp_version IS NULL)),
  CONSTRAINT prospect_score_evaluations_icp_version_positive
    CHECK (icp_version IS NULL OR icp_version > 0),
  -- Scores are 0..1 or ABSENT. Nothing else is a score this platform produces.
  CONSTRAINT prospect_score_evaluations_ranges CHECK (
    (score_intent      IS NULL OR (score_intent      >= 0 AND score_intent      <= 1)) AND
    (score_icp         IS NULL OR (score_icp         >= 0 AND score_icp         <= 1)) AND
    (score_urgency     IS NULL OR (score_urgency     >= 0 AND score_urgency     <= 1)) AND
    (score_opportunity IS NULL OR (score_opportunity >= 0 AND score_opportunity <= 1)) AND
    (score_priority    IS NULL OR (score_priority    >= 0 AND score_priority    <= 1)) AND
    (score_overall     IS NULL OR (score_overall     >= 0 AND score_overall     <= 1)) AND
    (confidence >= 0 AND confidence <= 1)
  )
);

-- Tenant-safe composite foreign keys. Added separately so the table creates
-- cleanly even where a referenced companion index is introduced by an earlier
-- migration in the same replay.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prospect_score_evaluations_prospect_tenant_fk') THEN
    ALTER TABLE public.prospect_score_evaluations
      ADD CONSTRAINT prospect_score_evaluations_prospect_tenant_fk
      FOREIGN KEY (prospect_id, organization_id)
      REFERENCES public.canonical_leads (id, company_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prospect_score_evaluations_person_tenant_fk') THEN
    ALTER TABLE public.prospect_score_evaluations
      ADD CONSTRAINT prospect_score_evaluations_person_tenant_fk
      FOREIGN KEY (person_id, organization_id)
      REFERENCES public.unified_persons (id, company_id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prospect_score_evaluations_account_tenant_fk') THEN
    ALTER TABLE public.prospect_score_evaluations
      ADD CONSTRAINT prospect_score_evaluations_account_tenant_fk
      FOREIGN KEY (account_id, organization_id)
      REFERENCES public.prospect_accounts (id, organization_id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prospect_score_evaluations_icp_tenant_fk') THEN
    ALTER TABLE public.prospect_score_evaluations
      ADD CONSTRAINT prospect_score_evaluations_icp_tenant_fk
      FOREIGN KEY (icp_id, organization_id)
      REFERENCES public.prospect_icps (id, organization_id) ON DELETE RESTRICT;
  END IF;
END
$$;

-- Companion unique so a FUTURE table can reference an evaluation through a
-- tenant-safe composite key, the same way this table references its own
-- subjects. `id` is already unique; this pairs it with the tenant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_prospect_score_evaluations_id_org
  ON public.prospect_score_evaluations (id, organization_id);

-- IDEMPOTENCY KEY. One evaluation per (tenant, prospect, ICP version, rules
-- version, inputs). `icp_version` is nullable and NULLS NOT DISTINCT makes an
-- abstained evaluation collide with itself rather than duplicating on every
-- tick — without it, a tenant with no ratified ICP would accumulate a row per
-- run forever, which is the noisiest possible way to record "we do not know".
CREATE UNIQUE INDEX IF NOT EXISTS uq_prospect_score_evaluations_identity
  ON public.prospect_score_evaluations
  (organization_id, prospect_id, icp_version, rules_version, input_digest)
  NULLS NOT DISTINCT;

-- The read this table exists to serve: the latest evaluation for one prospect.
CREATE INDEX IF NOT EXISTS idx_prospect_score_evaluations_latest
  ON public.prospect_score_evaluations (organization_id, prospect_id, scored_at DESC);

-- History by ICP version, so "what did this tenant's prospects score under v1"
-- is one index scan rather than a table scan.
CREATE INDEX IF NOT EXISTS idx_prospect_score_evaluations_icp_version
  ON public.prospect_score_evaluations (organization_id, icp_id, icp_version)
  WHERE icp_id IS NOT NULL;

-- ─── IMMUTABILITY ───────────────────────────────────────────────────────────
-- A historical evaluation is an append-only fact. Ratifying ICP v2 must not
-- reach back and change what v1 produced, and a rules bump must not rewrite the
-- scores the old rules gave. Without this the table would record only the
-- present, which is the condition it was built to end. A correction is a NEW
-- row under a new digest, never an edit to an old one.
CREATE OR REPLACE FUNCTION public.prospect_score_evaluations_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION
    'prospect_score_evaluations is append-only: evaluation % may not be modified (record a new evaluation instead)', OLD.id
    USING ERRCODE = '23514';
END
$$;

DROP TRIGGER IF EXISTS trg_prospect_score_evaluations_immutable ON public.prospect_score_evaluations;
CREATE TRIGGER trg_prospect_score_evaluations_immutable
  BEFORE UPDATE ON public.prospect_score_evaluations
  FOR EACH ROW EXECUTE FUNCTION public.prospect_score_evaluations_immutable();

-- ─── TENANT ISOLATION ───────────────────────────────────────────────────────
-- Service-role only, matching the established model. The application reaches
-- this table exclusively through the service-role client; anon and authenticated
-- are granted nothing, so the deny-by-default posture that
-- 20261026000000_close_anon_rls_exposure established is preserved rather than
-- quietly reopened for one new table.
ALTER TABLE public.prospect_score_evaluations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'prospect_score_evaluations'
      AND policyname = 'prospect_score_evaluations_service_role'
  ) THEN
    CREATE POLICY prospect_score_evaluations_service_role
      ON public.prospect_score_evaluations
      FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
END
$$;

REVOKE ALL ON TABLE public.prospect_score_evaluations FROM anon, authenticated;
