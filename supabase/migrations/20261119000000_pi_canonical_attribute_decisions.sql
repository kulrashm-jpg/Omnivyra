-- B1b — the canonical attribute DECISION log, append-only.
--
-- WHY. D22-B1a ratified D-4: the canonical value stops being latched by whoever
-- wrote first and becomes a DERIVED projection of the live assertion set, which
-- means it can legitimately change more than once. The existing provenance pair
-- cannot record that.
--
--   source_assertions.applied_to_canonical_at  timestamptz
--   source_assertions.applied_reason           text
--   CHECK ((applied_to_canonical_at IS NULL) = (applied_reason IS NULL))
--
-- The CHECK ties them together, so clearing one clears both and destroys the
-- record that an assertion was ever canonical. They are therefore never cleared
-- and never overwritten. But a single timestamptz has room for exactly one
-- event, so a value that wins, loses to a newer observation, and then wins again
-- leaves only two possibilities, both of them lies:
--
--   overwrite the first stamp  -> a step of history is gone
--   keep the first stamp       -> the LATEST stamp names a value that is no
--                                 longer canonical
--
-- This table is the third option. One append-only row per decision, ordered by
-- `decided_at`: the newest row for an attribute is what we believe now, and the
-- rows behind it are why. The assertion stamp keeps its original meaning — "this
-- assertion was canonical, first at this time" — and is written only onto an
-- assertion that does not already carry one.
--
-- WHAT THIS IS NOT. No arbitration policy lives here. No provider is named, no
-- precedence is encoded, and no source is privileged: `reason` records WHICH
-- ratified rule fired, and the rules themselves are in
-- backend/services/prospectIdentity/ingestionBoundary.ts with the authority
-- declaration in ./attributeAuthority.ts. This table is empty on arrival and
-- fills only as arbitration runs.
--
-- ─── TENANT MODEL (unchanged from W5 / LI-1 / LI-2) ────────────────────────
--   organization_id = TENANT (FK -> companies)
--   person_id    -> unified_persons    via composite (person_id, organization_id)
--   account_id   -> prospect_accounts  via composite (account_id, organization_id)
--   assertion_id -> source_assertions  via composite (assertion_id, organization_id)
-- A decision can never reference another tenant's person, account or evidence,
-- and that is a database guarantee rather than an application convention.
--
-- `uq_source_assertions_id_org` is created here because LI-2 did not need it:
-- nothing referenced an assertion before. It is the parent key that makes the
-- tenant-safe composite reference to source_assertions possible, and it follows
-- the established `uq_source_records_id_org` / `uq_unified_persons_id_company`
-- pattern exactly.
--
-- IDEMPOTENT. Every object is guarded, so replaying this onto an already-migrated
-- schema is a no-op, which the real-schema harness requires.
--
-- Rollback: dropping this table destroys the only record of WHY each canonical
-- value won. It is not written, deliberately: the data is unrecoverable and the
-- table is additive, so leaving it in place costs nothing.

BEGIN;

-- ---------------------------------------------------------------------------
-- Preflight. This table hangs off the canonical spine and the evidence layer;
-- if either is absent or not tenant-safe, neither is this.
-- ---------------------------------------------------------------------------
DO $preflight$
BEGIN
  IF to_regclass('public.source_assertions') IS NULL THEN
    RAISE EXCEPTION 'B1b preflight: public.source_assertions is missing — LI-2 has not been applied';
  END IF;

  IF to_regclass('public.unified_persons') IS NULL OR to_regclass('public.prospect_accounts') IS NULL THEN
    RAISE EXCEPTION 'B1b preflight: the canonical spine is missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname='public' AND indexname='uq_unified_persons_id_company') THEN
    RAISE EXCEPTION 'B1b preflight: uq_unified_persons_id_company missing — cannot build a tenant-safe person reference';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname='public' AND indexname='uq_prospect_accounts_id_org') THEN
    RAISE EXCEPTION 'B1b preflight: uq_prospect_accounts_id_org missing — cannot build a tenant-safe account reference';
  END IF;

  -- The arbitration inputs D-1/D-2/D-3 read. LI-2 recorded all three and the
  -- decision function read none of them; if any were absent the ratified rules
  -- would silently degrade to source-neutral fill-only, so this fails loudly.
  IF NOT EXISTS (SELECT 1 FROM pg_attribute
                  WHERE attrelid='public.source_assertions'::regclass
                    AND attname='observed_at' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'B1b preflight: source_assertions.observed_at is missing — D-1 cannot be implemented';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute
                  WHERE attrelid='public.source_assertions'::regclass
                    AND attname='recorded_at' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'B1b preflight: source_assertions.recorded_at is missing — D-1 has no fallback timestamp';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute
                  WHERE attrelid='public.source_assertions'::regclass
                    AND attname='superseded_at' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'B1b preflight: source_assertions.superseded_at is missing — liveness cannot be reconciled';
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------------
-- The parent key for a tenant-safe reference to an assertion. LI-2 created
-- uq_source_records_id_org for exactly this reason on the other table.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_source_assertions_id_org
  ON public.source_assertions (id, organization_id);

-- ---------------------------------------------------------------------------
-- canonical_attribute_decisions — APPEND-ONLY.
--
-- One row per canonical write. `value` is carried denormalised on purpose: the
-- question "what did we believe, and when" must be answerable without joining to
-- evidence that may since have been superseded or revived.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.canonical_attribute_decisions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- TENANT. Every decision belongs to exactly one tenant, always.
  organization_id  uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  entity_type      text NOT NULL,
  -- Both nullable, and not because a decision may lack a subject: the composite
  -- foreign keys below use ON DELETE SET NULL (column_list), so a decision
  -- OUTLIVES the person or account it described. Requiring one to be non-null
  -- would make deleting a prospect fail against its own audit trail.
  person_id        uuid,
  account_id       uuid,
  -- The canonical column this decision is about, e.g. 'job_title'.
  attribute        text NOT NULL,
  -- The assertion that won, and the value it carried.
  assertion_id     uuid NOT NULL,
  value            text NOT NULL,
  -- WHICH ratified rule fired. Not a policy, a record of one.
  reason           text NOT NULL,
  -- When arbitration decided. Supplied by the caller, never defaulted: PI never
  -- derives a decision time from ambient clock state.
  decided_at       timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT canonical_decisions_entity_type_valid
    CHECK (entity_type IN ('person', 'account')),
  -- An account-shaped decision must never name a person. Mirrors LI-2's
  -- source_assertions_entity_coherent exactly.
  CONSTRAINT canonical_decisions_entity_coherent
    CHECK (entity_type <> 'account' OR person_id IS NULL),
  CONSTRAINT canonical_decisions_attribute_not_blank
    CHECK (length(btrim(attribute)) > 0),
  CONSTRAINT canonical_decisions_value_not_blank
    CHECK (length(btrim(value)) > 0),
  -- The closed vocabulary of the ratified rules. Widening it is a migration, on
  -- purpose: a new reason is a new arbitration rule and must not arrive silently.
  CONSTRAINT canonical_decisions_reason_valid
    CHECK (reason IN (
      'single_uncontested_assertion',
      'authoritative_source',
      'newest_observation',
      'newest_then_highest_confidence'
    ))
);

-- "What is the decision history for this attribute, newest first?" — the read
-- that makes the table worth having.
CREATE INDEX IF NOT EXISTS idx_canonical_decisions_person_attr
  ON public.canonical_attribute_decisions (organization_id, person_id, attribute, decided_at DESC)
  WHERE person_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_canonical_decisions_account_attr
  ON public.canonical_attribute_decisions (organization_id, account_id, attribute, decided_at DESC)
  WHERE account_id IS NOT NULL;
-- "Which canonical values did this piece of evidence produce?"
CREATE INDEX IF NOT EXISTS idx_canonical_decisions_assertion
  ON public.canonical_attribute_decisions (organization_id, assertion_id);

DO $decision_fks$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='canonical_decisions_assertion_tenant_fk') THEN
    ALTER TABLE public.canonical_attribute_decisions
      ADD CONSTRAINT canonical_decisions_assertion_tenant_fk
      FOREIGN KEY (assertion_id, organization_id)
      REFERENCES public.source_assertions (id, organization_id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='canonical_decisions_person_tenant_fk') THEN
    ALTER TABLE public.canonical_attribute_decisions
      ADD CONSTRAINT canonical_decisions_person_tenant_fk
      FOREIGN KEY (person_id, organization_id)
      REFERENCES public.unified_persons (id, company_id) ON DELETE SET NULL (person_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='canonical_decisions_account_tenant_fk') THEN
    ALTER TABLE public.canonical_attribute_decisions
      ADD CONSTRAINT canonical_decisions_account_tenant_fk
      FOREIGN KEY (account_id, organization_id)
      REFERENCES public.prospect_accounts (id, organization_id) ON DELETE SET NULL (account_id);
  END IF;
END
$decision_fks$;

-- ---------------------------------------------------------------------------
-- APPEND-ONLY, enforced by the database rather than by convention.
--
-- The whole value of this table is that a past decision cannot be edited away.
-- A trigger is used rather than a revoked privilege because the runtime connects
-- as the service role, which would bypass any grant-based rule.
--
-- The ON DELETE SET NULL legs above are UPDATEs issued by the foreign keys
-- themselves, so the trigger must not refuse those: it allows an update that
-- changes ONLY person_id or account_id to NULL, and refuses everything else.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.canonical_decisions_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'canonical_attribute_decisions is append-only: a decision may never be deleted (attribute=%, decided_at=%)',
      OLD.attribute, OLD.decided_at;
  END IF;

  -- The only legal UPDATE is a foreign key detaching a deleted subject.
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.entity_type IS DISTINCT FROM OLD.entity_type
     OR NEW.attribute IS DISTINCT FROM OLD.attribute
     OR NEW.assertion_id IS DISTINCT FROM OLD.assertion_id
     OR NEW.value IS DISTINCT FROM OLD.value
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.decided_at IS DISTINCT FROM OLD.decided_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (NEW.person_id IS DISTINCT FROM OLD.person_id AND NEW.person_id IS NOT NULL)
     OR (NEW.account_id IS DISTINCT FROM OLD.account_id AND NEW.account_id IS NOT NULL)
  THEN
    RAISE EXCEPTION 'canonical_attribute_decisions is append-only: a recorded decision may never be modified (attribute=%)',
      OLD.attribute;
  END IF;

  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS canonical_decisions_append_only ON public.canonical_attribute_decisions;
CREATE TRIGGER canonical_decisions_append_only
  BEFORE UPDATE OR DELETE ON public.canonical_attribute_decisions
  FOR EACH ROW EXECUTE FUNCTION public.canonical_decisions_append_only();

-- ---------------------------------------------------------------------------
-- RLS, matching the convention on source_records / source_assertions: the
-- runtime uses the service-role client and tenant isolation is enforced by the
-- application plus the composite keys above. The policy is parity, not the
-- guarantee.
-- ---------------------------------------------------------------------------
ALTER TABLE public.canonical_attribute_decisions ENABLE ROW LEVEL SECURITY;

DO $rls$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                  AND tablename='canonical_attribute_decisions'
                  AND policyname='canonical_decisions_service_role') THEN
    CREATE POLICY canonical_decisions_service_role ON public.canonical_attribute_decisions
      FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
END
$rls$;

COMMENT ON TABLE public.canonical_attribute_decisions IS
  'B1b: append-only history of canonical attribute arbitration. One row per '
  'canonical write, newest decided_at per (entity, attribute) being current. '
  'Records WHICH ratified rule chose a value; encodes no policy and names no '
  'provider. Never updated, never deleted — enforced by a trigger.';

-- ---------------------------------------------------------------------------
-- Postconditions.
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  v_fk  INT;
  v_trg INT;
  v_idx INT;
BEGIN
  IF to_regclass('public.canonical_attribute_decisions') IS NULL THEN
    RAISE EXCEPTION 'B1b postcondition: canonical_attribute_decisions is missing';
  END IF;

  -- Three composite tenant-safe foreign keys: assertion, person, account.
  SELECT count(*) INTO v_fk
    FROM pg_constraint con
    JOIN pg_class s ON s.oid = con.conrelid
   WHERE con.contype='f' AND s.relname='canonical_attribute_decisions'
     AND array_length(con.conkey, 1) = 2;
  IF v_fk <> 3 THEN
    RAISE EXCEPTION 'B1b postcondition: expected 3 composite tenant FKs, found %', v_fk;
  END IF;

  -- Every composite FK must carry the tenant as its second leg.
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
      JOIN pg_class s ON s.oid = con.conrelid
     WHERE con.contype='f' AND s.relname='canonical_attribute_decisions'
       AND array_length(con.conkey, 1) = 2
       AND pg_get_constraintdef(con.oid) NOT LIKE '%, organization_id)%'
  ) THEN
    RAISE EXCEPTION 'B1b postcondition: a composite FK does not carry organization_id as its second leg';
  END IF;

  SELECT count(*) INTO v_trg FROM pg_trigger
   WHERE tgname='canonical_decisions_append_only' AND NOT tgisinternal;
  IF v_trg <> 1 THEN
    RAISE EXCEPTION 'B1b postcondition: the append-only trigger is missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname='public' AND indexname='uq_source_assertions_id_org') THEN
    RAISE EXCEPTION 'B1b postcondition: uq_source_assertions_id_org missing';
  END IF;

  SELECT count(*) INTO v_idx FROM pg_indexes
   WHERE schemaname='public'
     AND indexname IN ('idx_canonical_decisions_person_attr',
                       'idx_canonical_decisions_account_attr',
                       'idx_canonical_decisions_assertion');
  IF v_idx <> 3 THEN
    RAISE EXCEPTION 'B1b postcondition: expected 3 decision indexes, found %', v_idx;
  END IF;

  -- B1b creates no data.
  IF (SELECT count(*) FROM public.canonical_attribute_decisions) <> 0 THEN
    RAISE EXCEPTION 'B1b postcondition: the decision log must be empty on arrival';
  END IF;

  RAISE NOTICE 'B1b: canonical_attribute_decisions created, append-only, 3 composite tenant FKs, 0 rows.';
END
$verify$;

COMMIT;
