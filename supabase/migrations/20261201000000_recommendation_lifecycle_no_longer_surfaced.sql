-- REPORT 1 — RECOMMENDATION LIFECYCLE: absence is not resolution.
--
-- WHY. `report_recommendation_history.status` allowed four values, and the writer
-- recorded 'resolved' for any action that stopped appearing in a run. Set
-- membership was the whole basis, so the table asserted that a customer had
-- COMPLETED work whenever an action identifier changed, a surface went
-- unmeasured, or the scan profile narrowed. No completion evidence exists to
-- support that: the only per-action signal is a dismissal (suppression), and the
-- collaboration status table that carries a 'completed' value has no production
-- writer. This adds the honest value the writer now uses instead.
--
-- WHAT 'no_longer_surfaced' MEANS. The action IDENTIFIER stopped appearing. It is
-- NOT a claim that the underlying finding is fixed or gone. Action ids are built
-- from title text, so an identifier change is the common cause.
--
-- ADDITIVE AND BACKWARD COMPATIBLE. The four existing values stay permitted, so
-- an older application version -- which writes only those four -- remains valid
-- against this schema. The incompatibility runs one way only: a NEW application
-- version writing 'no_longer_surfaced' against an UNMIGRATED database is
-- rejected (23514). `SupabaseHistoryStore.writeSnapshot` writes the snapshot
-- bundle as serial awaited inserts and throws on the first error, with
-- `report_recommendation_history` fourth of five, and its retries are not
-- idempotent (`id` is the primary key and (company_id, observed_at) is UNIQUE).
-- A rejection therefore leaves a partially written snapshot that a retry cannot
-- repair. THIS MIGRATION MUST BE APPLIED BEFORE THE CODE THAT WRITES THE NEW
-- VALUE IS RELEASED.
--
-- HISTORICAL ROWS ARE UNTOUCHED. No row is updated, deleted or reclassified.
-- Existing 'resolved' rows keep their value; their provenance is unknown and the
-- system cannot distinguish a genuine completion from a disappearance, so they
-- are preserved exactly as stored and are not reinterpreted.
--
-- CONSTRAINT NAME. `report_recommendation_history_status_check` is PostgreSQL's
-- generated name for the inline CHECK created by
-- `20260601000000_canonical_intelligence_platform.sql`, and it is corroborated by
-- `supabase/_schema/baseline.sql`. IT HAS NOT BEEN VERIFIED AGAINST ANY LIVE
-- DATABASE -- that remains an OPERATOR RESPONSIBILITY before this is applied. A
-- mismatched name makes the DROP fail, which blocks the migration rather than
-- corrupting anything.
--
-- ROLLBACK IS NOT SYMMETRIC. Re-adding the four-value constraint FAILS once any
-- 'no_longer_surfaced' row exists, because ADD CONSTRAINT validates existing
-- rows. The only rollback that preserves history is to re-add it NOT VALID,
-- which blocks new violating writes while tolerating rows already present:
--
--   ALTER TABLE report_recommendation_history
--     ADD CONSTRAINT report_recommendation_history_status_check
--     CHECK (status IN ('first_seen', 'persistent', 'resolved', 'regressed')) NOT VALID;
--
-- Deleting the rows is NOT an acceptable rollback: that is rewriting history.

BEGIN;

ALTER TABLE report_recommendation_history
  DROP CONSTRAINT IF EXISTS report_recommendation_history_status_check;

ALTER TABLE report_recommendation_history
  ADD CONSTRAINT report_recommendation_history_status_check
  CHECK (status IN ('first_seen', 'persistent', 'resolved', 'regressed', 'no_longer_surfaced'));

COMMENT ON COLUMN report_recommendation_history.status IS
  'Lifecycle position of this row. no_longer_surfaced = the action identifier stopped appearing, NOT proof the finding was fixed. resolved is legacy-only and is no longer written: historical rows carry it with unknown provenance and are never rewritten.';

COMMIT;
