-- LI-3B — canonical contact governance records.
--
-- WHY. The platform can already prove who a person is (W1–W5), what they are
-- (LI-1) and what a provider said about them (LI-2). It cannot record that they
-- asked not to be contacted. The LI-3 audit found two suppression tables, both
-- empty, neither linked to the canonical person, both using a `text` tenant
-- column with no foreign key — and one of them, `suppression_entries`, was
-- proven to let a `__global__` row suppress every tenant at once.
--
-- This table is the canonical replacement, decided in
-- OMNIVYRA_LI3_CONTACT_GOVERNANCE_ADR.md. It implements that ADR and decides
-- nothing on its own.
--
-- ─── D-1: TENANT-ONLY. NO GLOBAL SCOPE. ───────────────────────────────────
-- `organization_id` is a uuid with a REAL foreign key to companies. There is no
-- `__global__` sentinel, no `scope` column, and no code path by which one
-- tenant's record can affect another. A platform-wide compliance register, if
-- one is ever authorised, is a SEPARATE table with a separate owner — sharing
-- this one is how a tenant preference silently becomes a platform block.
--
-- ─── D-3: A DNC OUTLIVES THE PERSON RECORD ────────────────────────────────
-- `ON DELETE SET NULL (person_id)` — the pattern LI-2 already proves. Deleting
-- a person nulls the link and preserves the tenant and the target, so a
-- re-import of the same address still matches. Cascading instead would mean:
-- person deleted -> DNC deleted -> lead re-imported -> contact resumes, which
-- is the single outcome a DNC exists to prevent.
--
-- ─── WHAT THIS IS NOT ─────────────────────────────────────────────────────
-- No parser, no opt-out detection, no quiet hours, no contact fatigue, no
-- change to either existing governance stack, no provider, no send path. The
-- table ships EMPTY and the evaluator that reads it is called by nothing.
--
-- Rollback: supabase/migrations/rollbacks/li3_contact_governance_rollback.sql

BEGIN;

-- ---------------------------------------------------------------------------
-- Preflight. Fail closed if the spine this table hangs off is not present or
-- not tenant-safe.
-- ---------------------------------------------------------------------------
DO $preflight$
BEGIN
  IF to_regclass('public.companies') IS NULL
     OR to_regclass('public.unified_persons') IS NULL
     OR to_regclass('public.source_records') IS NULL THEN
    RAISE EXCEPTION 'LI-3B preflight: companies, unified_persons or source_records is missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname='public' AND indexname='uq_unified_persons_id_company') THEN
    RAISE EXCEPTION 'LI-3B preflight: uq_unified_persons_id_company missing — no tenant-safe person reference';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname='public' AND indexname='uq_source_records_id_org') THEN
    RAISE EXCEPTION 'LI-3B preflight: uq_source_records_id_org missing — LI-2 evidence layer absent';
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------------
-- contact_governance_records
--
-- One row per standing instruction. This table holds STATE with duration; the
-- verdict of any single evaluation belongs in `outreach_decisions`, which is an
-- instantaneous log and cannot express `effective_until`.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contact_governance_records (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- TENANT. uuid + real FK. The whole point of D-1.
  organization_id     uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,

  -- Canonical anchor. Nullable: a webhook carries an address, not a person id,
  -- and parking unresolved governance is a supported state — the same posture
  -- LI-2 takes with unresolved evidence.
  person_id           uuid,

  -- The address or number, normalised by the EXISTING normalisers
  -- (normalizeEmail / normalizePhone). `target_raw` is kept beside it because
  -- discarding the raw form makes a normalisation bug unauditable — the LI-2
  -- precedent.
  target_normalized   text,
  target_raw          text,

  -- 'email' | 'phone' | 'whatsapp' | '*'. Free text, so a future channel needs
  -- no migration. '*' means every channel INCLUDING ones that do not exist yet:
  -- "never contact me again" is not an enumeration of transports.
  channel             text NOT NULL,

  -- Closed vocabulary. Deliberately NOT a boolean: `bounce_hard` is a broken
  -- address a correction fixes, `unsubscribe` is a wish that survives any
  -- correction, and `deferred` is an invitation. Collapsing them destroys the
  -- distinction that makes the record actionable.
  governance_type     text NOT NULL,

  -- Provenance. Provider-neutral free text, like source_records.provider.
  source              text NOT NULL,
  source_record_id    uuid,
  -- SUMMARY ONLY — matched phrase, confidence, detector version. Never a
  -- transcript, email body or provider payload; those live in source_records.
  evidence            jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- When the instruction takes effect, which is not necessarily when we heard
  -- it. NULL `effective_until` means permanent — except for `deferred`, where
  -- it means an undated "contact me later" (see the CHECK below).
  effective_from      timestamptz NOT NULL DEFAULT now(),
  effective_until     timestamptz,

  -- Append-only. A governance record is never deleted; it is revoked.
  revoked_at          timestamptz,
  revoked_reason      text,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT contact_governance_type_valid CHECK (governance_type IN (
    'dnc_permanent', 'dnc_channel', 'unsubscribe', 'consent_withdrawn',
    'invalid_contact', 'bounce_hard', 'complaint', 'deferred', 'campaign_exclusion')),

  CONSTRAINT contact_governance_channel_not_blank
    CHECK (length(btrim(channel)) > 0),

  -- A record anchored to nothing can never be matched, so it is never valid.
  CONSTRAINT contact_governance_has_anchor
    CHECK (person_id IS NOT NULL OR (target_normalized IS NOT NULL AND length(btrim(target_normalized)) > 0)),

  -- ADR §10: a permanent DNC is channel-independent and is recorded as '*'.
  -- Permitting it with a specific channel would create two spellings of the
  -- state that `dnc_channel` already expresses.
  CONSTRAINT contact_governance_permanent_is_all_channels
    CHECK (governance_type <> 'dnc_permanent' OR channel = '*'),

  -- ...and a channel-scoped DNC must actually name a channel.
  CONSTRAINT contact_governance_channel_dnc_is_specific
    CHECK (governance_type <> 'dnc_channel' OR channel <> '*'),

  -- ADR §8: only a deferment carries an end date. Everything else is either in
  -- force or revoked.
  CONSTRAINT contact_governance_until_only_deferred
    CHECK (effective_until IS NULL OR governance_type = 'deferred'),

  CONSTRAINT contact_governance_period_ordered
    CHECK (effective_until IS NULL OR effective_until > effective_from),

  -- A revocation without a reason is an unusable audit record.
  CONSTRAINT contact_governance_revocation_coherent
    CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL)),

  CONSTRAINT contact_governance_source_not_blank
    CHECK (length(btrim(source)) > 0),

  CONSTRAINT contact_governance_evidence_object
    CHECK (jsonb_typeof(evidence) = 'object'),

  CONSTRAINT contact_governance_target_not_blank
    CHECK (target_normalized IS NULL OR length(btrim(target_normalized)) > 0)
);

-- IDEMPOTENCY (ADR §13). Including `governance_type` in the key is the
-- load-bearing choice: a second identical unsubscribe collides and is a no-op,
-- while `deferred` -> `dnc_permanent` are different types and both rows survive,
-- so a legitimate transition stays representable.
--
-- The index is PARTIAL (`revoked_at IS NULL`) so that revoking and re-recording
-- is possible. That also means ON CONFLICT CANNOT INFER IT — the 42P10 trap
-- W0.1, W0.2 and W3 each hit. Persistence must INSERT and catch 23505.
CREATE UNIQUE INDEX IF NOT EXISTS uq_contact_governance_identity
  ON public.contact_governance_records (
    organization_id, channel, governance_type,
    coalesce(person_id::text, target_normalized))
  WHERE revoked_at IS NULL;

-- Lookup paths the evaluator uses: by person, and by target when the person is
-- unresolved or has since been deleted (D-3).
CREATE INDEX IF NOT EXISTS idx_contact_governance_org_person
  ON public.contact_governance_records (organization_id, person_id)
  WHERE person_id IS NOT NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_contact_governance_org_target
  ON public.contact_governance_records (organization_id, target_normalized)
  WHERE target_normalized IS NOT NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_contact_governance_org_channel_type
  ON public.contact_governance_records (organization_id, channel, governance_type)
  WHERE revoked_at IS NULL;

-- Tenant-safe references, following the W5 composite pattern. The column-list
-- SET NULL preserves the tenant on a surviving row: a governance record must
-- outlive both the person it described and the evidence that produced it.
DO $fks$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='contact_governance_person_tenant_fk') THEN
    ALTER TABLE public.contact_governance_records
      ADD CONSTRAINT contact_governance_person_tenant_fk
      FOREIGN KEY (person_id, organization_id)
      REFERENCES public.unified_persons (id, company_id) ON DELETE SET NULL (person_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='contact_governance_source_tenant_fk') THEN
    ALTER TABLE public.contact_governance_records
      ADD CONSTRAINT contact_governance_source_tenant_fk
      FOREIGN KEY (source_record_id, organization_id)
      REFERENCES public.source_records (id, organization_id) ON DELETE SET NULL (source_record_id);
  END IF;
END
$fks$;

-- RLS matching the convention on identity_claims / prospect_accounts /
-- source_records: the runtime uses the service-role client, so the policy is
-- parity and the real guarantee is the application plus the composite keys.
ALTER TABLE public.contact_governance_records ENABLE ROW LEVEL SECURITY;

DO $rls$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                  AND tablename='contact_governance_records'
                  AND policyname='contact_governance_records_service_role') THEN
    CREATE POLICY contact_governance_records_service_role ON public.contact_governance_records
      FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
END
$rls$;

-- ---------------------------------------------------------------------------
-- Postconditions.
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  v_fk  INT;
  v_chk INT;
  v_idx INT;
BEGIN
  IF to_regclass('public.contact_governance_records') IS NULL THEN
    RAISE EXCEPTION 'LI-3B postcondition: table missing';
  END IF;

  SELECT count(*) INTO v_fk FROM pg_constraint con
   JOIN pg_class s ON s.oid = con.conrelid
   WHERE con.contype='f' AND s.relname='contact_governance_records'
     AND array_length(con.conkey,1) = 2;
  IF v_fk <> 2 THEN
    RAISE EXCEPTION 'LI-3B postcondition: expected 2 composite tenant FKs, found %', v_fk;
  END IF;

  SELECT count(*) INTO v_chk FROM pg_constraint con
   JOIN pg_class s ON s.oid = con.conrelid
   WHERE con.contype='c' AND s.relname='contact_governance_records';
  IF v_chk < 11 THEN
    RAISE EXCEPTION 'LI-3B postcondition: expected at least 11 CHECK constraints, found %', v_chk;
  END IF;

  SELECT count(*) INTO v_idx FROM pg_indexes
   WHERE schemaname='public' AND indexname='uq_contact_governance_identity';
  IF v_idx <> 1 THEN
    RAISE EXCEPTION 'LI-3B postcondition: idempotency index missing';
  END IF;

  IF (SELECT count(*) FROM public.contact_governance_records) <> 0 THEN
    RAISE EXCEPTION 'LI-3B postcondition: table must be empty on arrival';
  END IF;

  RAISE NOTICE 'LI-3B: contact_governance_records created, 2 composite tenant FKs, % CHECKs, 0 rows.', v_chk;
END
$verify$;

COMMIT;
