-- Contact governance: a restriction is never "not yet in force" because a provider's clock runs ahead.
--
-- RULING (virality-e9, 2026-11-11; PI/MIG-2R item 1; A2 batch, registry 056cf224f):
--   effective_from := LEAST(supplied effective_from, the database's now())
-- computed BY POSTGRES, so neither a provider clock nor an application clock can defeat it.
--
-- WHY. Since 20270202000000 every governance read is judged at its own database instant (read_at).
-- effective_from is an ENFORCEMENT boundary, but writers set it from a provider's EVIDENCE timestamp
-- (feedbackIngestion: occurredAt, unclamped; sesProviderEventIngestion: clamped only to the APP
-- clock). A provider timestamp ahead of the database made a fresh restriction "not yet in force"
-- until the database caught up, and contact was ALLOWED in that window. It reaches UNSUBSCRIBE via
-- provider webhooks, so it is a consent defect, not deliverability hygiene. The raw provider time
-- stays recorded as evidence (evidence.occurredAt), so clamping loses no information.
--
-- WHAT. One BEFORE INSERT OR UPDATE OF effective_from row trigger:
--   - a FUTURE effective_from (relative to the database) becomes now(): in force immediately;
--   - a PAST or present one is unchanged (LEAST), so backdated entries and the person-erasure
--     re-inserts that carry a preserved historical effective_from keep their exact values;
--   - an explicit NULL is NOT clamped: effective_from is NOT NULL (DEFAULT now() is applied before
--     BEFORE triggers), so a writer that computes NULL by mistake still fails loudly (23502). LEAST
--     alone would not preserve that (PostgreSQL's LEAST ignores NULLs), hence the explicit guard.
-- PREMISE (the assumption this trigger rests on): NO writer sets a FUTURE effective_from on purpose;
-- every future value is clock skew. Checked on A2 304ee0c7b: feedbackIngestion (provider occurredAt),
-- sesProviderEventIngestion (occurredAt, app-clamped), personErasure (preserved PAST values), and no
-- other writer passes effectiveFrom; the 'deferred' type expresses "later" through effective_until,
-- not a future effective_from. A future "block from next Monday" governance type would contradict
-- this premise and must change this trigger first.
-- UPDATE OF effective_from as well as INSERT, so a later statement cannot re-open the window
-- (no code updates effective_from today: revocation sets revoked_at/revoked_reason only, ADR §16).
-- The CHECK effective_until > effective_from can only get easier: the value only moves earlier.
-- now() inside one transaction is its start instant, the same instant read_at reports to a read
-- in that transaction, so a restriction written and read in one transaction is in force for it.
--
-- SECURITY. SECURITY INVOKER with a pinned search_path (#26); EXECUTE revoked from PUBLIC, anon
-- and authenticated (#23: a trigger function is never called directly). No grant changes on the table.
-- Rollback: rollbacks/contact_governance_records_clamp_effective_from_rollback.sql.

CREATE OR REPLACE FUNCTION public.contact_governance_records_clamp_effective_from()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.effective_from IS NOT NULL THEN
    NEW.effective_from := LEAST(NEW.effective_from, now());
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION public.contact_governance_records_clamp_effective_from() IS
  'Clamp effective_from to LEAST(supplied, now()) on insert and on any update of effective_from: a restriction is never not-yet-in-force because a provider or app clock runs ahead of the database (20270212000000).';

DROP TRIGGER IF EXISTS trg_contact_governance_records_clamp_effective_from ON public.contact_governance_records;
CREATE TRIGGER trg_contact_governance_records_clamp_effective_from
  BEFORE INSERT OR UPDATE OF effective_from ON public.contact_governance_records
  FOR EACH ROW
  EXECUTE FUNCTION public.contact_governance_records_clamp_effective_from();

REVOKE ALL ON FUNCTION public.contact_governance_records_clamp_effective_from() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contact_governance_records_clamp_effective_from() FROM anon;
REVOKE ALL ON FUNCTION public.contact_governance_records_clamp_effective_from() FROM authenticated;

-- Postcondition: the premise this migration exists for, asserted on the catalog, and RAISING
-- if any part of it is missing. tgtype bits: ROW = 1, BEFORE = 2, INSERT = 4, UPDATE = 16.
-- tgenabled must be O or A (fires on ordinary writes); R (replica-only) or D would leave the
-- window open while the trigger merely exists.
DO $post$
DECLARE
  fn oid := 'public.contact_governance_records_clamp_effective_from()'::regprocedure;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = 'public.contact_governance_records'::regclass
       AND t.tgname = 'trg_contact_governance_records_clamp_effective_from'
       AND NOT t.tgisinternal
       AND t.tgenabled IN ('O', 'A')
       AND (t.tgtype & 1) <> 0 AND (t.tgtype & 2) <> 0 AND (t.tgtype & 4) <> 0 AND (t.tgtype & 16) <> 0
       AND t.tgfoid = fn
       -- UPDATE OF effective_from and NO other column: tgattr (int2vector) renders as the column
       -- numbers separated by spaces, so exactly one column compares equal to that attnum's text.
       AND t.tgattr::text = (SELECT a.attnum::text FROM pg_attribute a
                              WHERE a.attrelid = 'public.contact_governance_records'::regclass
                                AND a.attname = 'effective_from' AND NOT a.attisdropped)
  ) THEN
    RAISE EXCEPTION 'governance clamp postcondition: trigger trg_contact_governance_records_clamp_effective_from is missing, not enabled for ordinary writes (O/A), not BEFORE ROW INSERT+UPDATE OF effective_from (and no other column), or not bound to public.contact_governance_records_clamp_effective_from()';
  END IF;
  IF position('NEW.effective_from := LEAST(NEW.effective_from, now())' IN pg_get_functiondef(fn)) = 0 THEN
    RAISE EXCEPTION 'governance clamp postcondition: public.contact_governance_records_clamp_effective_from() no longer clamps to LEAST(supplied, now())';
  END IF;
  IF (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = fn) THEN
    RAISE EXCEPTION 'governance clamp postcondition: the clamp function must stay SECURITY INVOKER';
  END IF;
  -- Intentionally LITERAL (down to the space after the comma): an equivalent re-spelling RAISES, fail-closed.
  IF (SELECT p.proconfig FROM pg_proc p WHERE p.oid = fn) IS DISTINCT FROM ARRAY['search_path=public, pg_temp'] THEN
    RAISE EXCEPTION 'governance clamp postcondition: the clamp function lost its search_path pin';
  END IF;
  IF has_function_privilege('anon', fn, 'EXECUTE') OR has_function_privilege('authenticated', fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'governance clamp postcondition: a client role may EXECUTE the clamp function';
  END IF;
END
$post$;
