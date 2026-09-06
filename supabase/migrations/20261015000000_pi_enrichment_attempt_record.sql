-- A4A — the enrichment attempt & outcome record.
--
-- Every PI enrichment execution opportunity, recorded durably and tenant-scoped,
-- so that A4 maintenance can later reason about retry, cooldown and bounded
-- tenant-funded provider usage from evidence rather than from guesswork.
--
-- ─── WHY A DEDICATED TABLE ────────────────────────────────────────────────
-- Four existing "attempt" tables were examined and all four rejected:
--   • outreach_attempts        — the right SHAPE, and the conventions below are
--                                copied from it, but it is outreach: `task_id`
--                                REFERENCES outreach_tasks and channel/transport
--                                are delivery vocabulary. Enrichment has no task
--                                and no channel; reusing it would mean writing
--                                NULLs into a foreign key and lies into two
--                                columns.
--   • orchestration_attempts   — too thin: no entity, no provider, no attempt
--                                number, no start/finish. It cannot answer
--                                "which provider did we try for this account,
--                                and when", which is A4's entire question.
--   • company_context_enrichment_runs — a different domain. That is enrichment
--                                of the TENANT'S OWN company profile, not of a
--                                prospect, and it carries input_profile /
--                                quality_payload / suggestions_count.
--   • reconciliation_attempts / publishing_attempts — job-scoped, other domains.
--
-- ─── WHY TWO NULLABLE ENTITY COLUMNS AND NOT ONE POLYMORPHIC ID ───────────
-- An enrichment is about a person OR an account. A single `entity_id` with an
-- `entity_type` discriminator would buy generality by giving up referential
-- integrity on the column that says WHICH PROSPECT we spent the tenant's money
-- on — the same trade A3N refused for credential ownership. So both columns
-- carry a real foreign key, and a CHECK admits exactly one. This also mirrors
-- LI-2's own `ProviderSourceRecord`, which already models the subject as
-- nullable `personId` / `accountId`.
--
-- ─── ATTEMPT IDENTITY IS NOT OBSERVATION IDENTITY ─────────────────────────
-- A3's 30-day `duplicate_suppressed` window is about whether an OBSERVATION is
-- still fresh enough to reuse. This table is about whether an EXECUTION was
-- attempted. They are different questions and must not share a key: a
-- suppressed duplicate is a real attempt with a real outcome and belongs here,
-- while a retry days later is a NEW attempt of the same (tenant, entity,
-- provider). Hence `attempt_number` in the uniqueness key — it makes a retry
-- expressible without overwriting the failure that caused it.
--
-- Uniqueness is expressed as two PARTIAL indexes rather than one constraint
-- over nullable columns: in Postgres a UNIQUE constraint treats NULLs as
-- distinct by default, so a single index across both entity columns would
-- silently permit duplicates (the W1 `NULLS NOT DISTINCT` lesson).
--
-- ─── APPEND-ONLY, AND NO SECRETS ──────────────────────────────────────────
-- Attempts are history: nothing here is updated in place except the completion
-- of the row that opened it, and no attempt is ever deleted. `detail` carries a
-- short diagnostic classification only — never a credential, an authorization
-- header, or a raw provider payload. Evidence lives where it already lives:
-- `source_record_id` REFERENCES the source_records row LI-2 produced.
--
-- ─── RLS ──────────────────────────────────────────────────────────────────
-- Service-role only, matching every other PI table. No anon/authenticated
-- policy: the credential and evidence surfaces are reachable only through
-- server routes that prove tenancy themselves (A3L §19).

CREATE TABLE IF NOT EXISTS public.prospect_enrichment_attempts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tenant. uuid to match prospect_accounts.organization_id / unified_persons.company_id.
  organization_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  -- Exactly one of these. See the CHECK below.
  person_id           uuid REFERENCES public.unified_persons(id) ON DELETE CASCADE,
  account_id          uuid REFERENCES public.prospect_accounts(id) ON DELETE CASCADE,

  -- Which provider was selected, by its canonical A3C source id (e.g. 'clearbit').
  provider_key        text NOT NULL,

  -- The operation: the canonical attributes this attempt asked for.
  requested_attributes text[] NOT NULL DEFAULT '{}',

  attempt_number      integer NOT NULL,

  -- Existing tracing, reused rather than replaced.
  correlation_id      text NOT NULL,

  -- A3 ENRICHMENT_OUTCOMES. NULL only while an attempt is in flight.
  outcome             text,

  -- Whether the provider was actually contacted. A refusal before egress
  -- (credential_missing, cost_denied, duplicate_suppressed) is FALSE, which is
  -- what makes "how many paid calls did we make" answerable.
  provider_called     boolean NOT NULL DEFAULT false,

  -- Evidence produced, by reference. Never a copy.
  source_record_id    uuid REFERENCES public.source_records(id) ON DELETE SET NULL,
  attributes_returned text[],

  -- Short, safe diagnostic classification. Never a secret.
  detail              text,
  executor_version    text,

  started_at          timestamptz NOT NULL,
  completed_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT prospect_enrichment_attempts_number_positive
    CHECK (attempt_number >= 1),

  -- Exactly one subject. A row about neither, or about both, is meaningless.
  CONSTRAINT prospect_enrichment_attempts_one_subject CHECK (
    (person_id IS NOT NULL AND account_id IS NULL)
 OR (person_id IS NULL     AND account_id IS NOT NULL)
  ),

  CONSTRAINT prospect_enrichment_attempts_provider_not_blank
    CHECK (length(btrim(provider_key)) > 0),

  CONSTRAINT prospect_enrichment_attempts_correlation_not_blank
    CHECK (length(btrim(correlation_id)) > 0)
);

-- One attempt number per (tenant, entity, provider). Partial, because a UNIQUE
-- constraint spanning both nullable entity columns would treat NULLs as
-- distinct and enforce nothing.
CREATE UNIQUE INDEX IF NOT EXISTS prospect_enrichment_attempts_person_unique
  ON public.prospect_enrichment_attempts (organization_id, person_id, provider_key, attempt_number)
  WHERE person_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS prospect_enrichment_attempts_account_unique
  ON public.prospect_enrichment_attempts (organization_id, account_id, provider_key, attempt_number)
  WHERE account_id IS NOT NULL;

-- The read A4 maintenance will actually perform: "what has this tenant tried
-- recently, and how did it end?"
CREATE INDEX IF NOT EXISTS idx_prospect_enrichment_attempts_tenant_recent
  ON public.prospect_enrichment_attempts (organization_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_prospect_enrichment_attempts_outcome
  ON public.prospect_enrichment_attempts (organization_id, provider_key, outcome);

ALTER TABLE public.prospect_enrichment_attempts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'prospect_enrichment_attempts'
      AND policyname = 'service_role_full_access'
  ) THEN
    CREATE POLICY service_role_full_access
      ON public.prospect_enrichment_attempts
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
