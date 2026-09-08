-- A7P-C9 — `source_records.ingestion_run_id` becomes text.
--
-- WHY. The first real pilot ingestion failed with
--
--   22P02: invalid input syntax for type uuid: "pi-pilot-001"
--
-- after it had already created a person, an identity claim, an account and a
-- canonical lead. Nothing about the request was wrong: the API accepts
-- `ingestionRunId` as an arbitrary string, no layer between the route and this
-- column validates or generates a UUID, and the column alone imposed a format
-- the rest of the system never agreed to.
--
-- The original LI-2 migration is explicit that this is NOT an identifier:
--
--   "ingestion_run_id carries NO foreign key. `ingestion_runs` is an analytics
--    ETL tracker ... Coupling prospect ingestion to it would be the wrong
--    reuse ... It is a soft correlation id until LI-7 decides which run
--    mechanism its adapters use."
--
-- A soft correlation id with deliberately no referent has no reason to be a
-- uuid. Typing it as one was the defect; the loose contract above it was the
-- intent, and it is the intent every live writer already follows:
--
--   manual/csv/crm routes    whatever string the operator submitted
--   crmIngestionService.ts   the CRM sync pipeline's own run id
--   extensionBridge.ts       a platform URN, e.g. `urn:li:comment:7234`
--   consumeEnrichmentWork.ts `a7e-<entityId>-<timestamp>`
--
-- THE ALTERNATIVE WAS REJECTED. Forcing callers to manufacture UUIDs would
-- narrow a field whose whole purpose is to carry a correlation value that came
-- from somewhere else — a LinkedIn URN is not expressible as a uuid, and
-- hashing one into a uuid would destroy the correlation it exists to preserve.
-- It would also silently break the two enrichment paths above AFTER a billed
-- provider call, which is the worst possible place to discover a type error.
--
-- WHAT THIS DOES NOT CHANGE. Every real identifier on this table stays uuid:
-- `id`, `organization_id`, `person_id`, `account_id`, and
-- `source_assertions.source_record_id` which references `id`. The provider's
-- own record key `source_record_id` was already text and is untouched, as is
-- the source identity index built on it. This migration changes exactly one
-- column, and that column participates in no index, no constraint, no default,
-- no generated column, no view and no foreign key — verified against
-- production before it was written.
--
-- SAFE TO APPLY. `uuid -> text` is widening and lossless: every uuid has a
-- canonical text form and the USING cast produces it. Nullability is preserved
-- explicitly. The table holds zero rows in production, so the rewrite is
-- instantaneous, but the conversion is written to be correct with data present
-- rather than relying on that.
--
-- IDEMPOTENT. Guarded on the column's current type so replaying it onto an
-- already-converted schema is a no-op, which the real-schema harness requires.
--
-- Rollback: supabase/migrations/rollbacks/pi_source_record_run_correlation_text_rollback.sql
--           (DESTRUCTIVE — it fails if any non-uuid correlation id has been stored)

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.source_records') IS NULL THEN
    RAISE EXCEPTION 'A7P-C9 preflight: public.source_records is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.source_records'::regclass
       AND attname = 'ingestion_run_id'
       AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'A7P-C9 preflight: source_records.ingestion_run_id is missing';
  END IF;
END
$preflight$;

DO $convert$
DECLARE
  current_type text;
BEGIN
  SELECT format_type(atttypid, atttypmod) INTO current_type
    FROM pg_attribute
   WHERE attrelid = 'public.source_records'::regclass
     AND attname = 'ingestion_run_id'
     AND NOT attisdropped;

  IF current_type = 'uuid' THEN
    -- The minimal safe conversion. uuid -> text has no assignment cast, so the
    -- USING expression is required rather than stylistic; `::text` yields the
    -- canonical lower-case hyphenated form, so any correlation id already
    -- stored reads back identically.
    ALTER TABLE public.source_records
      ALTER COLUMN ingestion_run_id TYPE text
      USING ingestion_run_id::text;
  ELSIF current_type <> 'text' THEN
    RAISE EXCEPTION
      'A7P-C9: source_records.ingestion_run_id has unexpected type %, refusing to convert',
      current_type;
  END IF;
END
$convert$;

-- Stated explicitly rather than assumed. The column was nullable before and an
-- omitted correlation id must stay legal: it is metadata, not identity.
ALTER TABLE public.source_records
  ALTER COLUMN ingestion_run_id DROP NOT NULL;

COMMENT ON COLUMN public.source_records.ingestion_run_id IS
  'A7P-C9: soft correlation id, text and deliberately unconstrained. Carries '
  'whatever the caller used to group a batch or an observation — an operator '
  'batch label, a platform URN, a UUID, or nothing at all. It has no foreign '
  'key, is in no index and is part of no identity: source identity is '
  '(organization_id, provider, source_entity_type, source_record_id). Never '
  'validate it as a UUID — production writers already supply values that are '
  'not one.';

COMMIT;
