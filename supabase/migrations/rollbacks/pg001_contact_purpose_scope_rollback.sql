-- ROLLBACK for 20261126000000_pg001_contact_purpose_scope.sql
--
-- Restores `uq_contact_governance_identity` to its LI-3B definition, drops the
-- two PG-001 CHECKs, and drops the column.
--
-- ─── LOSSLESS ONLY WHILE NOTHING IS SCOPED ────────────────────────────────
-- Dropping the column DISCARDS every stored `purpose_scope` value. Under the
-- ratified baseline that is a no-op, because DR-1 forbids writing a narrow
-- scope until LQ-1 is resolved, so every row holds NULL.
--
-- ONCE ANY ROW CARRIES A NARROW SCOPE THIS ROLLBACK IS DESTRUCTIVE: it would
-- silently WIDEN those restrictions to all purposes. Widening is the safe
-- direction for the recipient, but it is still a loss of a recorded decision,
-- so check for non-NULL values first and preserve them out-of-band if any
-- exist. The guard below refuses the rollback rather than discarding them.
--
-- ─── INDEX ORDER MATTERS ──────────────────────────────────────────────────
-- The index is rebuilt BEFORE the column is dropped. Dropping the column first
-- would drop the index with it (it is an expression index over that column),
-- leaving the table with NO identity key between the two statements — and the
-- recreate could then fail on duplicates that the key had been preventing.
--
-- NOT APPLIED.

BEGIN;

-- Refuse to discard recorded decisions. Comment this block out ONLY after the
-- non-NULL values have been preserved elsewhere.
DO $guard$
DECLARE
  scoped bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name = 'contact_governance_records'
                AND column_name = 'purpose_scope') THEN
    EXECUTE 'SELECT count(*) FROM public.contact_governance_records WHERE purpose_scope IS NOT NULL'
      INTO scoped;
    IF scoped > 0 THEN
      RAISE EXCEPTION 'PG-001 rollback refused: % row(s) carry a narrow purpose_scope. Preserve them before rolling back.', scoped;
    END IF;
  END IF;
END
$guard$;

-- 1. Restore the LI-3B identity key (anchor coalesce only, no purpose).
DROP INDEX IF EXISTS public.uq_contact_governance_identity;

CREATE UNIQUE INDEX IF NOT EXISTS uq_contact_governance_identity
  ON public.contact_governance_records (
    organization_id,
    channel,
    governance_type,
    coalesce(person_id::text, target_normalized))
  WHERE revoked_at IS NULL;

-- 2. Drop the PG-001 CHECKs.
ALTER TABLE public.contact_governance_records
  DROP CONSTRAINT IF EXISTS contact_governance_purpose_scope_scopeable_type;

ALTER TABLE public.contact_governance_records
  DROP CONSTRAINT IF EXISTS contact_governance_purpose_scope_valid;

-- 3. Drop the column.
ALTER TABLE public.contact_governance_records
  DROP COLUMN IF EXISTS purpose_scope;

COMMIT;
