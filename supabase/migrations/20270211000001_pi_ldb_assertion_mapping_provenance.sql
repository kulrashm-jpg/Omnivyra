-- PI-LDB-2 — field-level mapping provenance on source_assertions.
--
-- ─── VERSION AND APPLIED STATUS ─────────────────────────────────────────────
-- Renumbered from 20270201000001 (virality-83 ruling, 2026-11-11; never applied
-- anywhere, per C6). Edited before first apply:
--   * PLATFORM profiles: a tenant's assertion may be mapped by a platform
--     (vendor) profile, which has no organization_id, so it cannot satisfy the
--     tenant composite FK. It is referenced separately, via
--     platform_mapping_profile_id + platform_mapping_profile_scope with a
--     composite FK to (id, scope); the two references are mutually exclusive.
--   * The tenant FK's ON DELETE SET NULL now names its column. A bare SET NULL
--     on (mapping_profile_id, organization_id) would null organization_id too
--     (NOT NULL here), so a profile delete would FAIL instead of detaching.
--   * Every new CHECK/FK on this live, growing table is added NOT VALID, so
--     this transaction (ACCESS EXCLUSIVE from ADD COLUMN, held to COMMIT) scans
--     no rows. New rows are enforced immediately; the VALIDATE runs in a
--     separate migration under SHARE UPDATE EXCLUSIVE.
--
-- ─── THE GAP THIS CLOSES ────────────────────────────────────────────────────
-- `source_assertions` already records, per field, what a provider said
-- (`raw_value`), what our normalisers made of it (`normalized_value`), which
-- canonical column it is about (`attribute`), and why it won (`applied_reason`).
-- One thing is missing, and it is the one thing a semantic mapping layer makes
-- essential: WHICH SOURCE FIELD the value came from.
--
-- Without it, `attribute = 'job_title'` records that a job title was asserted
-- but not that it arrived in a column the tenant's file called `Designation`,
-- nor which mapping decision sent it there. A mis-mapping would therefore be
-- undetectable after the fact — the wrong value would look like a correct
-- assertion about the right attribute. That is the audit hole this closes.
--
-- ─── WHY ADDITIVE AND NULLABLE ──────────────────────────────────────────────
-- `source_assertions` is a live, append-only provenance table. Every column
-- here is nullable with no default and every CHECK is NULL-tolerant, so no
-- existing row is rewritten, no existing writer breaks, and the table keeps
-- its append-only character. Rows written before this migration honestly
-- report "mapping provenance unknown" by holding NULL, which is the truth: the
-- mapping layer did not exist when they were written.
--
-- No existing column, constraint, index, policy or row is modified. The
-- existing dedupe key (organization_id, source_record_id, attribute,
-- value_hash) is untouched, so re-ingestion behaviour is unchanged.

BEGIN;

-- ---------------------------------------------------------------------------
-- The columns.
-- ---------------------------------------------------------------------------
ALTER TABLE public.source_assertions
  -- The source's OWN field name, verbatim: `Designation`, `Annual Turnover`.
  -- Verbatim rather than normalised, because an audit that cannot quote the
  -- tenant's own column heading cannot be checked against their file.
  ADD COLUMN IF NOT EXISTS source_field       text,
  -- The exact mapping profile VERSION that decided this field. Points at a
  -- version, not at "the current profile", so a historical mapping stays
  -- reconstructable after the tenant changes their mind.
  ADD COLUMN IF NOT EXISTS mapping_profile_id uuid,
  -- How the destination was chosen for this particular assertion.
  ADD COLUMN IF NOT EXISTS mapping_method     text,
  -- What deterministic validation made of the value on the way in.
  ADD COLUMN IF NOT EXISTS validation_state   text,
  -- Who approved the mapping, when a human did. Distinct from
  -- `source_mapping_profile_entries.approved_by`, which records the approval of
  -- the PROFILE; this records the approval in force for THIS assertion.
  -- GOV-H actor: no FK into users; writer-validated.
  ADD COLUMN IF NOT EXISTS approved_by        uuid,
  ADD COLUMN IF NOT EXISTS approved_at        timestamptz,
  -- A PLATFORM (vendor) profile version that decided this field. Exclusive
  -- with mapping_profile_id (a tenant profile).
  ADD COLUMN IF NOT EXISTS platform_mapping_profile_id    uuid,
  -- Always 'platform' when the id is set, NULL otherwise. Exists so the FK can
  -- bind the referenced profile's scope.
  ADD COLUMN IF NOT EXISTS platform_mapping_profile_scope text;

-- ---------------------------------------------------------------------------
-- Value constraints. All NULL-tolerant: see the header.
-- ---------------------------------------------------------------------------
DO $checks$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'source_assertions_platform_profile_scope') THEN
    ALTER TABLE public.source_assertions
      ADD CONSTRAINT source_assertions_platform_profile_scope
      -- set-null-ok: the FK's SET NULL nulls BOTH columns together, and the first branch admits (NULL, NULL), so a profile delete always leaves a valid row.
      CHECK ((platform_mapping_profile_id IS NULL AND platform_mapping_profile_scope IS NULL)
          OR (platform_mapping_profile_id IS NOT NULL AND platform_mapping_profile_scope = 'platform')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'source_assertions_one_mapping_profile') THEN
    ALTER TABLE public.source_assertions
      ADD CONSTRAINT source_assertions_one_mapping_profile
      CHECK (mapping_profile_id IS NULL OR platform_mapping_profile_id IS NULL) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'source_assertions_source_field_not_blank') THEN
    ALTER TABLE public.source_assertions
      ADD CONSTRAINT source_assertions_source_field_not_blank
      CHECK (source_field IS NULL OR length(btrim(source_field)) > 0) NOT VALID;
  END IF;

  -- Mirrors `MappingStatus` in the engine's contract. Listed rather than free
  -- text because a reader has to be able to distinguish "a human confirmed
  -- this" from "the engine decided and nobody looked", and a typo in a free
  -- text column would silently create a third, unreadable category.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'source_assertions_mapping_method_valid') THEN
    ALTER TABLE public.source_assertions
      ADD CONSTRAINT source_assertions_mapping_method_valid
      CHECK (mapping_method IS NULL OR mapping_method IN (
        'approved_profile_match',
        'high_confidence_suggestion',
        'tenant_confirmed',
        'tenant_override',
        -- A value that arrived through a path with no mapping layer at all.
        -- Named explicitly so that "no mapping" is a recorded fact rather than
        -- an absent column that could equally mean "we forgot to write it".
        'no_mapping_layer'
      )) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'source_assertions_validation_state_valid') THEN
    ALTER TABLE public.source_assertions
      ADD CONSTRAINT source_assertions_validation_state_valid
      CHECK (validation_state IS NULL OR validation_state IN (
        -- Accepted as written.
        'valid',
        -- Accepted after a declared, deterministic transformation.
        'coerced',
        -- Kept as raw provenance; NOT applied to the canonical column.
        'invalid',
        -- The column was empty for this record.
        'empty'
      )) NOT VALID;
  END IF;

  -- An approval with no timestamp cannot be audited, and a timestamp with no
  -- actor names nobody. Either both or neither.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'source_assertions_approval_coherent') THEN
    ALTER TABLE public.source_assertions
      ADD CONSTRAINT source_assertions_approval_coherent
      CHECK ((approved_by IS NULL) = (approved_at IS NULL)) NOT VALID;
  END IF;

  -- An `invalid` value must never have been applied to a canonical column.
  -- This is the constraint that makes "validation gates the write" a database
  -- property rather than an application convention.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'source_assertions_invalid_not_applied') THEN
    ALTER TABLE public.source_assertions
      ADD CONSTRAINT source_assertions_invalid_not_applied
      CHECK (validation_state IS DISTINCT FROM 'invalid'
             OR applied_to_canonical_at IS NULL) NOT VALID;
  END IF;
END
$checks$;

-- ---------------------------------------------------------------------------
-- Tenant-safe composite foreign key to the mapping profile version.
--
-- Composite, like the five LI-2 keys on this table: referencing the profile by
-- `id` alone would let one tenant's assertion cite another tenant's mapping
-- decision. ON DELETE SET NULL rather than CASCADE — deleting a profile must
-- never delete provenance history, and the assertion remains true even when
-- the mapping that produced it is gone.
--
-- Note on arming: the SET NULL above is safe, but NOT for the reason originally
-- written here. The original note said `source_assertions` "carries no trigger
-- that refuses UPDATE". On `origin/main` it does: `source_assertions_relationship_guard`,
-- BEFORE INSERT OR UPDATE, from 20261125000000 — one of the 50 migrations the
-- sprint base never saw. The conclusion survives, because that guard refuses only
-- re-pointing a non-NULL `relationship_id`, which setting `mapping_profile_id` to
-- NULL never does. The premise is corrected here rather than left to be relied
-- on: this FK is unarmed because of what that specific guard checks, not because
-- no guard exists. Add a trigger that refuses UPDATE generally and this FK
-- becomes armed, making a profile row undeletable — the failure mode the
-- governance review found on 19 tables.
-- ---------------------------------------------------------------------------
DO $fk$
BEGIN
  IF to_regclass('public.source_mapping_profiles') IS NULL THEN
    RAISE EXCEPTION 'PI-LDB-2 precondition: source_mapping_profiles is missing. Apply 20270211000000 first.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'source_assertions_mapping_profile_tenant_fk') THEN
    ALTER TABLE public.source_assertions
      ADD CONSTRAINT source_assertions_mapping_profile_tenant_fk
      FOREIGN KEY (mapping_profile_id, organization_id)
      REFERENCES public.source_mapping_profiles (id, organization_id)
      ON DELETE SET NULL (mapping_profile_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'source_assertions_platform_mapping_profile_fk') THEN
    ALTER TABLE public.source_assertions
      ADD CONSTRAINT source_assertions_platform_mapping_profile_fk
      FOREIGN KEY (platform_mapping_profile_id, platform_mapping_profile_scope)
      REFERENCES public.source_mapping_profiles (id, scope)
      ON DELETE SET NULL (platform_mapping_profile_id, platform_mapping_profile_scope) NOT VALID;
  END IF;
END
$fk$;

-- ---------------------------------------------------------------------------
-- Indexes. Partial, so they cost nothing for the rows that predate the mapping
-- layer and carry NULL.
-- ---------------------------------------------------------------------------

-- "Which of my columns fed this attribute?" — the mapping-audit query.
-- idx_source_assertions_source_field: built CONCURRENTLY in 20270211000007 (live table; a plain build blocks writes).

-- "What did this profile version decide?" — the drift and correction query.
-- idx_source_assertions_mapping_profile: built CONCURRENTLY in 20270211000007 (live table; a plain build blocks writes).

-- "What arrived with no mapping layer, or failed validation?" — the honesty
-- query behind any claim that a channel is operational.
-- idx_source_assertions_unmapped: built CONCURRENTLY in 20270211000007 (live table; a plain build blocks writes).

COMMENT ON COLUMN public.source_assertions.source_field IS
  'The source field name verbatim, e.g. Designation. Without it, a mis-mapping is undetectable after the fact.';
COMMENT ON COLUMN public.source_assertions.mapping_profile_id IS
  'The exact source_mapping_profiles VERSION that decided this field. Tenant-safe composite FK; SET NULL so provenance outlives the profile.';
COMMENT ON COLUMN public.source_assertions.validation_state IS
  'Deterministic validation outcome. An invalid value is retained as raw provenance and is refused the canonical column by source_assertions_invalid_not_applied.';

-- ---------------------------------------------------------------------------
-- Postconditions.
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  v_cols INT;
  v_chk  INT;
  v_fk   INT;
BEGIN
  SELECT count(*) INTO v_cols FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'source_assertions'
     AND column_name IN ('source_field', 'mapping_profile_id', 'mapping_method',
                         'validation_state', 'approved_by', 'approved_at',
                         'platform_mapping_profile_id', 'platform_mapping_profile_scope');
  IF v_cols <> 8 THEN
    RAISE EXCEPTION 'PI-LDB-2 postcondition: expected 8 mapping provenance columns, found %', v_cols;
  END IF;

  -- Every one of these columns must be NULLABLE. A NOT NULL here would have
  -- broken every existing writer, and asserting it is cheaper than trusting it.
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'source_assertions'
                AND column_name IN ('source_field', 'mapping_profile_id', 'mapping_method',
                                    'validation_state', 'approved_by', 'approved_at',
                                    'platform_mapping_profile_id', 'platform_mapping_profile_scope')
                AND is_nullable = 'NO') THEN
    RAISE EXCEPTION 'PI-LDB-2 postcondition: a mapping provenance column is NOT NULL; it must be additive and nullable';
  END IF;

  -- Existence only: the checks are NOT VALID here and validated by the
  -- follow-on VALIDATE migration, whose postcondition checks convalidated.
  SELECT count(*) INTO v_chk FROM pg_constraint
   WHERE conrelid = 'public.source_assertions'::regclass
     AND conname IN ('source_assertions_source_field_not_blank',
                     'source_assertions_mapping_method_valid',
                     'source_assertions_validation_state_valid',
                     'source_assertions_approval_coherent',
                     'source_assertions_invalid_not_applied',
                     'source_assertions_platform_profile_scope',
                     'source_assertions_one_mapping_profile');
  IF v_chk <> 7 THEN
    RAISE EXCEPTION 'PI-LDB-2 postcondition: expected 7 named checks, found %', v_chk;
  END IF;

  SELECT count(*) INTO v_fk FROM pg_constraint
   WHERE conrelid = 'public.source_assertions'::regclass
     AND conname IN ('source_assertions_mapping_profile_tenant_fk', 'source_assertions_platform_mapping_profile_fk')
     AND contype = 'f' AND array_length(conkey, 1) = 2;
  IF v_fk <> 2 THEN
    RAISE EXCEPTION 'PI-LDB-2 postcondition: the tenant or platform mapping profile FK is missing or not composite';
  END IF;
  -- SET NULL must name only the profile column(s), never organization_id.
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'public.source_assertions'::regclass
                AND conname = 'source_assertions_mapping_profile_tenant_fk'
                AND (confdelsetcols IS NULL OR array_length(confdelsetcols, 1) <> 1)) THEN
    RAISE EXCEPTION 'PI-LDB-2 postcondition: source_assertions_mapping_profile_tenant_fk uses a plain ON DELETE SET NULL (it must be SET NULL (mapping_profile_id)); the plain form nulls organization_id (NOT NULL) and makes every profile delete fail';
  END IF;
  -- GOV-H: approved_by carries no FK.
  IF EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
              WHERE c.contype = 'f' AND c.conrelid = 'public.source_assertions'::regclass AND a.attname = 'approved_by') THEN
    RAISE EXCEPTION 'PI-LDB-2 postcondition: source_assertions.approved_by carries a foreign key (GOV-H)';
  END IF;

  -- The LI-2 dedupe key must be exactly as it was. This migration must not have
  -- changed re-ingestion behaviour.
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname = 'public'
                    AND indexname = 'uq_source_assertions_dedupe') THEN
    RAISE EXCEPTION 'PI-LDB-2 postcondition: the LI-2 dedupe index is missing';
  END IF;

  RAISE NOTICE 'PI-LDB-2: 8 nullable mapping provenance columns, 7 checks + tenant/platform FKs (NOT VALID, validated separately), dedupe key intact.';
END
$verify$;

COMMIT;
