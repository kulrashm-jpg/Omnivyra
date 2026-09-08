-- ROLLBACK for 20261022000000_pi_source_record_run_correlation_text.sql
--
-- ############################################################################
-- #  DESTRUCTIVE WHEN ANY NON-UUID CORRELATION ID HAS BEEN STORED            #
-- ############################################################################
--
-- The forward migration widened `source_records.ingestion_run_id` from uuid to
-- text because three production writers legitimately supply values that are not
-- UUIDs — an operator batch label, a platform URN such as
-- `urn:li:comment:7234`, and the A7E worker's `a7e-<entityId>-<timestamp>`.
--
-- Narrowing it back therefore cannot be lossless in general. This script
-- REFUSES rather than discarding, because a silent `SET NULL` would erase the
-- correlation that lets an observation be traced back to the batch or capture
-- that produced it, and there is nowhere else to recover it from.
--
-- BEFORE RUNNING, measure what would be refused:
--
--   SELECT count(*) FROM public.source_records
--    WHERE ingestion_run_id IS NOT NULL
--      AND ingestion_run_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
--
-- If that count is non-zero, decide explicitly what those rows should become
-- and do it as its own deliberate statement. Do not edit that decision into
-- this file.
--
-- The rest of the table is untouched: no other column, index, constraint,
-- foreign key or policy is involved, and no row is deleted.

BEGIN;

DO $guard$
DECLARE
  offending bigint;
BEGIN
  IF (SELECT format_type(atttypid, atttypmod)
        FROM pg_attribute
       WHERE attrelid = 'public.source_records'::regclass
         AND attname = 'ingestion_run_id'
         AND NOT attisdropped) <> 'text' THEN
    RAISE NOTICE 'ingestion_run_id is not text — nothing to roll back';
    RETURN;
  END IF;

  SELECT count(*) INTO offending
    FROM public.source_records
   WHERE ingestion_run_id IS NOT NULL
     AND ingestion_run_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

  IF offending > 0 THEN
    RAISE EXCEPTION
      'refusing to narrow ingestion_run_id to uuid: % row(s) hold a correlation id that is not a UUID and would be destroyed',
      offending;
  END IF;

  ALTER TABLE public.source_records
    ALTER COLUMN ingestion_run_id TYPE uuid
    USING ingestion_run_id::uuid;

  COMMENT ON COLUMN public.source_records.ingestion_run_id IS NULL;
END
$guard$;

COMMIT;
