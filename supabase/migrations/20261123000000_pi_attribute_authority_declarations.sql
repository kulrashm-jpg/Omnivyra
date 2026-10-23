-- ---------------------------------------------------------------------------
-- B1b — ATTRIBUTE AUTHORITY DECLARATIONS.
--
-- D22-B1a decision D-3 ratified that authority is "tenant-scoped data keyed by
-- (entity_type, attribute)". The TYPE for that data has existed since b1b.1;
-- the STORAGE has not, so `resolveAttributeAuthority` returned an empty
-- declaration for every tenant and arbitration always fell through to D-1
-- recency. The consequence was concrete: a human correction lost to any newer
-- provider assertion, because there was no way for a tenant to say otherwise.
--
-- This migration is that storage, and nothing else. It is governance
-- configuration, not evidence: it records which SOURCES a tenant has declared
-- authoritative, never a value, never a decision, never a provider fact about
-- the codebase.
--
-- ─── WHY NOT REUSE `unified_persons.source_priority` ───────────────────────
-- That JSONB column is the defect O-3 names: zero readers, zero writers,
-- reading as though precedence were configured. It is also the wrong SHAPE —
-- it hangs off one person row, so it could only ever express "this person's
-- precedence", whereas D-3 requires (tenant, entity_type, attribute). Reusing
-- it would make authority per-prospect and unauditable. It is left untouched.
--
-- ─── WHY A TABLE IS NOW CORRECT WHEN IT WAS NOT BEFORE ────────────────────
-- b1b.1 deliberately refused to create this table, on the grounds that "a
-- table to hold zero rows would reproduce exactly the defect O-3 names". That
-- reasoning held while O-7 deferred every declaration. It no longer holds: this
-- table has a real reader (`resolveAttributeAuthority`) and a real writer
-- (`attributeAuthorityStore`), both exercised by tests, so it cannot read as
-- configured-but-inert.
--
-- ─── WHAT IS STILL NOT DONE HERE ──────────────────────────────────────────
-- NO ROW IS SEEDED. O-1 ("do not seed an operative Sales Navigator authority
-- declaration") stands, and so does the substance of O-7: nothing is declared
-- universally authoritative, least of all human assertions. A tenant that
-- declares nothing keeps exactly today's behaviour. Human precedence becomes
-- POSSIBLE, not automatic.
--
-- Migration 422 -> 423.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. PRECONDITIONS. The things this migration assumes, asserted rather than
--    hoped for.
-- ---------------------------------------------------------------------------
DO $pre$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(t, ', ') INTO v_missing FROM (
    SELECT t FROM (VALUES ('companies'), ('users'), ('source_assertions')) AS x(t)
     WHERE NOT EXISTS (
       SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = x.t)
  ) m;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'AUTHORITY preflight: missing prerequisite table(s): %', v_missing;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'omnivyra_touch_updated_at') THEN
    RAISE EXCEPTION 'AUTHORITY preflight: omnivyra_touch_updated_at() is absent';
  END IF;

  RAISE NOTICE 'AUTHORITY preflight: prerequisites present, table_exists=%',
    (SELECT count(*) FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'attribute_authority_declarations');
END
$pre$;

-- ---------------------------------------------------------------------------
-- 2. THE ELEMENT PREDICATE.
--
-- A CHECK cannot contain a subquery, and every useful statement about the
-- ELEMENTS of a text[] needs unnest. PostgreSQL does allow an IMMUTABLE
-- function in a CHECK, and the repository already does exactly this
-- (`is_valid_creator_daily_content_payload`), so the guarantee lives here
-- rather than being left to whichever writer happened to run.
--
-- It is a predicate, not a registry: it names no provider and consults no
-- table. It asserts only that each key is usable, already normalised, and
-- stated once.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pi_authority_providers_ok(p text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT p IS NULL
      OR (
           -- no NULL and no blank element
           array_position(p, NULL) IS NULL
           AND NOT EXISTS (SELECT 1 FROM unnest(p) AS k WHERE length(btrim(k)) = 0)
           -- already trimmed and lower-cased
           AND NOT EXISTS (SELECT 1 FROM unnest(p) AS k WHERE k <> lower(btrim(k)))
           -- each key stated once
           AND cardinality(p) = (SELECT count(DISTINCT k) FROM unnest(p) AS k)
         );
$fn$;

COMMENT ON FUNCTION public.pi_authority_providers_ok(text[]) IS
  'CHECK predicate for attribute_authority_declarations.authoritative_providers: '
  'every element non-blank, already trimmed and lower-cased, and distinct. '
  'Names no provider and reads no table.';

-- ---------------------------------------------------------------------------
-- 3. THE DECLARATION TABLE.
--
-- Named for the B1b family (`canonical_attribute_decisions` is its sibling):
-- DECISIONS record what arbitration chose, DECLARATIONS record the tenant
-- configuration arbitration consults. One row is one answer to one question:
-- "for this tenant, this entity type and this attribute, which sources are
-- authoritative?"
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attribute_authority_declarations (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- TENANT. There is no global declaration and no nullable tenant: authority
  -- that could be global is the single most dangerous shape this table could
  -- have, because one row would then silently re-rank every tenant's evidence.
  organization_id          uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,

  -- The SCOPE. 'relationship' is here because employment attributes are facts
  -- about an employment, so a tenant must be able to declare authority over
  -- `job_title` at one employer without touching the other.
  entity_type              text NOT NULL,

  -- The canonical column this declaration is about, e.g. 'job_title'.
  attribute                text NOT NULL,

  -- The declared sources, as NORMALISED provider keys (trimmed, lower-cased by
  -- the writer). text[] rather than a join table because a declaration is a
  -- small closed list read as a whole and never joined against; and rather than
  -- JSONB because an array has a shape the database can actually constrain.
  --
  -- `source_assertions.provider` is free TEXT by LI-2's design ("a new provider
  -- must never need a migration"), so this column REFERENCES NO REGISTRY and
  -- names no provider here. An empty array is legal and meaningful: it is an
  -- explicit "considered, nothing declared authoritative", which resolves
  -- source-neutral exactly like an absent row.
  authoritative_providers  text[] NOT NULL DEFAULT '{}',

  -- WHO declared it. Governance configuration is attributable or it is not
  -- governance. ON DELETE SET NULL so removing a user cannot delete policy.
  declared_by_user_id      uuid REFERENCES public.users (id) ON DELETE SET NULL,

  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  -- Exactly the three scopes B1b can arbitrate. A fourth would be a new
  -- ontology, not a new declaration.
  CONSTRAINT aad_entity_type_valid
    CHECK (entity_type IN ('person', 'account', 'relationship')),

  CONSTRAINT aad_attribute_not_blank
    CHECK (length(btrim(attribute)) > 0),

  -- Every element usable, already normalised, stated once. Without this a
  -- declaration could hold '' or ' Apollo ' and silently match nothing while
  -- reading as though it had taken effect — the exact failure mode b1b.1's
  -- `buildAttributeAuthority` rejects in TypeScript, enforced here too so the
  -- guarantee does not depend on which writer was used.
  CONSTRAINT aad_providers_usable
    CHECK (public.pi_authority_providers_ok(authoritative_providers))
);

-- ---------------------------------------------------------------------------
-- 4. IDENTITY.
--
-- The D-3 key, enforced. One declaration per (tenant, entity type, attribute)
-- is what makes "replace" and "clear" deterministic and makes a concurrent
-- second declaration a database error rather than a silent duplicate that
-- arbitration would resolve by row order.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_aad_tenant_entity_attribute
  ON public.attribute_authority_declarations (organization_id, entity_type, attribute);

-- The resolver's only read: every declaration for one tenant and scope.
CREATE INDEX IF NOT EXISTS idx_aad_tenant_entity
  ON public.attribute_authority_declarations (organization_id, entity_type);

-- ---------------------------------------------------------------------------
-- 5. TOUCH TRIGGER. Reuses the existing shared function; no new one.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_aad_updated_at ON public.attribute_authority_declarations;
CREATE TRIGGER trg_aad_updated_at
  BEFORE UPDATE ON public.attribute_authority_declarations
  FOR EACH ROW EXECUTE FUNCTION public.omnivyra_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 6. RLS. Parity with the rest of the PI surface: the application and the
--    tenant-keyed reads are the guarantee, the policy is defence in depth.
-- ---------------------------------------------------------------------------
ALTER TABLE public.attribute_authority_declarations ENABLE ROW LEVEL SECURITY;

DO $rls$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                  AND tablename = 'attribute_authority_declarations'
                  AND policyname = 'aad_service_role') THEN
    CREATE POLICY aad_service_role ON public.attribute_authority_declarations
      FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
END
$rls$;

-- ---------------------------------------------------------------------------
-- 7. DOCUMENTATION.
-- ---------------------------------------------------------------------------
COMMENT ON TABLE public.attribute_authority_declarations IS
  'B1b D-3 authority, as tenant-scoped data. One row per (organization_id, '
  'entity_type, attribute) naming the provider keys that tenant has declared '
  'authoritative. Consulted by resolveAttributeAuthority and written only by '
  'attributeAuthorityStore. Holds no value, no decision and no provider fact: '
  'an absent row and an empty array both mean source-neutral, so arbitration '
  'falls through to D-1 recency and the D-2 confidence tie-break. There is '
  'deliberately NO expiry column — D-5 ratified that authority has no TTL.';

COMMENT ON COLUMN public.attribute_authority_declarations.authoritative_providers IS
  'Normalised provider keys (trimmed, lower-case), compared against '
  'source_assertions.provider. Empty means source-neutral, NOT "no candidate '
  'may win". Authority narrows the candidate field; it never widens it, and '
  'recency still decides among several declared sources.';

COMMENT ON COLUMN public.attribute_authority_declarations.entity_type IS
  'person | account | relationship. A relationship declaration addresses one '
  'employment, so authority over job_title at company A cannot affect the same '
  'person''s title at company B.';

-- ---------------------------------------------------------------------------
-- 8. POSTCONDITIONS. The migration verifies itself or refuses to have run.
-- ---------------------------------------------------------------------------
DO $post$
DECLARE
  v_rows      bigint;
  v_global    bigint;
  v_ttl       bigint;
  v_unique    bigint;
BEGIN
  -- Nothing is seeded. If this is ever non-zero straight after the migration,
  -- someone has declared authority inside a migration, which is precisely the
  -- O-1 failure mode.
  SELECT count(*) INTO v_rows FROM public.attribute_authority_declarations;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'AUTHORITY postcondition: % declaration(s) seeded by the migration; authority is an operator act', v_rows;
  END IF;

  -- Authority can never be global.
  SELECT count(*) INTO v_global
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'attribute_authority_declarations'
     AND column_name = 'organization_id' AND is_nullable = 'NO';
  IF v_global <> 1 THEN
    RAISE EXCEPTION 'AUTHORITY postcondition: organization_id must exist and be NOT NULL';
  END IF;

  -- D-5: no TTL, ever. A column named like an expiry is the whole violation.
  SELECT count(*) INTO v_ttl
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'attribute_authority_declarations'
     AND (column_name LIKE '%expire%' OR column_name LIKE '%expiry%'
          OR column_name LIKE '%ttl%' OR column_name LIKE '%valid_until%'
          OR column_name LIKE '%effective_until%');
  IF v_ttl <> 0 THEN
    RAISE EXCEPTION 'AUTHORITY postcondition: D-5 forbids a TTL; found % expiry-like column(s)', v_ttl;
  END IF;

  -- The D-3 key is enforced, not merely intended.
  SELECT count(*) INTO v_unique
    FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'uq_aad_tenant_entity_attribute'
     AND indexdef LIKE '%UNIQUE%'
     AND indexdef LIKE '%organization_id, entity_type, attribute%';
  IF v_unique <> 1 THEN
    RAISE EXCEPTION 'AUTHORITY postcondition: the (tenant, entity_type, attribute) unique key is missing';
  END IF;

  RAISE NOTICE 'AUTHORITY: declarations table ready, 0 rows seeded, no TTL, tenant key enforced';
END
$post$;
