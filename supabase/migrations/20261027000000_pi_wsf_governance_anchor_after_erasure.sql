-- PI/WS-F — the anchor invariant, stated for the rows it was written about.
--
-- WHAT CHANGES. Exactly one CHECK constraint on
-- `contact_governance_records`:
--
--     contact_governance_has_anchor
--       BEFORE  person_id IS NOT NULL
--               OR (target_normalized IS NOT NULL AND length(btrim(...)) > 0)
--       AFTER   ... OR revoked_at IS NOT NULL
--
-- Nothing else. No column, no index, no foreign key, no referential action, no
-- row, no default, no policy.
--
-- ─── WHY ──────────────────────────────────────────────────────────────────
-- The constraint's own comment in 20261003000000 states its purpose exactly:
--
--     "A record anchored to nothing can never be matched, so it is never
--      valid."
--
-- That reasoning is about records that are STILL MATCHED. A revoked record is
-- never matched by anything:
--
--   * `contactGovernanceRepository.loadGovernanceRecords` filters
--     `.is('revoked_at', null)` before a row can reach the evaluator;
--   * `contactGovernance.isInForce` returns false for `revokedAt !== null`
--     even if one did;
--   * `uq_contact_governance_identity`, `idx_contact_governance_org_person`,
--     `idx_contact_governance_org_target` and
--     `idx_contact_governance_org_channel_type` are all partial on
--     `revoked_at IS NULL`, so a revoked row is not in any of them.
--
-- So for a revoked row, "can never be matched" is already true by three
-- independent mechanisms, and the anchor requirement adds no guarantee. For a
-- LIVE row the requirement is unchanged and still absolute. This widens nothing
-- that the evaluator can see.
--
-- ─── WHAT IT UNBLOCKS: DEFECT-008 ─────────────────────────────────────────
-- `contact_governance_person_tenant_fk` is `ON DELETE SET NULL (person_id)`
-- (D-3, deliberate: a DNC outlives the person). A referential action is an
-- UPDATE, and PostgreSQL evaluates every table CHECK on the updated row. A
-- PERSON-ONLY record — `person_id` set, `target_normalized` NULL — therefore
-- fails `contact_governance_has_anchor` on that UPDATE and aborts the DELETE
-- with 23514. The person is undeletable.
--
-- Person-only records are a DESIGNED capability ("never contact this human at
-- any address") with end-to-end test evidence at
-- backend/tests/unit/li3eGovernanceChain.test.ts:175. Forbidding the shape was
-- attempted and withdrawn — see PI-CONTRACT-001 §A3. The shape stays.
--
-- `backend/services/prospectIdentity/personErasure.ts` resolves a LIVE
-- person-only record before the delete: it re-anchors the instruction onto the
-- person's contact points as new target-anchored records, then revokes the
-- person-anchored original. Revocation is the append-only close-out the ADR
-- already prescribes (§16) — the record is never deleted.
--
-- But revoking leaves the row person-only AND revoked, and the SET NULL still
-- fires. Hence this constraint.
--
-- ─── THE DECISIVE CASE: HISTORY THAT NO PROCEDURE MAY TOUCH ───────────────
-- A record revoked BEFORE the erasure — an ordinary, expected outcome of an
-- append-only table — is equally fatal, and an erasure procedure cannot repair
-- it. ADR §16 is literal: on revocation "revoked_at/revoked_reason are set on
-- the existing row; no other field is ever updated." Writing today's address
-- onto a record that was in force two years ago would fabricate history to
-- satisfy a constraint. There is no application-layer fix for an already
-- revoked person-only record. Only the schema can say what it already means.
--
-- ─── WHY NOT THE OTHER REPAIRS ────────────────────────────────────────────
--   Change the action to CASCADE   deletes compliance history. Forbidden.
--   Change it to RESTRICT          precedent rejects it
--                                  (20261011000000:90-94): `unified_persons`
--                                  CASCADEs from `companies`, so a tenant with
--                                  one governance record becomes undeletable.
--   Change it to NO ACTION         defensible, and it is the LI-4C.1 remedy
--                                  for the identical 23514 shape
--                                  (20261004000000:24-41). Not taken here: it
--                                  reverses D-3, under which the record's
--                                  survival is a database guarantee rather
--                                  than an application obligation, and
--                                  backend/tests/realschema/li3_contact_governance.test.ts:311
--                                  asserts that guarantee. Reopening D-3 is
--                                  the ADR owner's call, not this migration's.
--   A sentinel target string       satisfies the CHECK by writing a non-address
--                                  into `target_normalized`, whose whole
--                                  contract is "normalised by normalizeEmail /
--                                  normalizePhone". It also pollutes
--                                  idx_contact_governance_org_target. A lie in
--                                  a compliance column to avoid a one-line
--                                  migration is a bad trade.
--
-- ─── WHAT THIS DOES NOT DO ────────────────────────────────────────────────
-- It does not weaken suppression: a live record must still be anchored, and
-- `contact_governance_revocation_coherent` still requires every revoked row to
-- carry a `revoked_reason`, so an unanchored row always states why it stopped.
-- It does not permit deleting governance. It does not touch DEFECT-010, which
-- needs no schema change — see personErasure.ts.
--
-- Rollback: supabase/migrations/rollbacks/pi_wsf_governance_anchor_after_erasure_rollback.sql

BEGIN;

-- ---------------------------------------------------------------------------
-- Preflight. Fail closed if the table or the constraint this migration is
-- written against is not the one present.
-- ---------------------------------------------------------------------------
DO $preflight$
DECLARE
  v_def TEXT;
BEGIN
  IF to_regclass('public.contact_governance_records') IS NULL THEN
    RAISE EXCEPTION 'PI/WS-F preflight: contact_governance_records is missing';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'public.contact_governance_records'::regclass
     AND conname  = 'contact_governance_has_anchor';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'PI/WS-F preflight: contact_governance_has_anchor is absent — refusing to invent it';
  END IF;

  -- Already applied: nothing to do, and a re-run must be a no-op.
  IF v_def ~ 'revoked_at' THEN
    RAISE NOTICE 'PI/WS-F: contact_governance_has_anchor already admits revoked rows; skipping.';
  END IF;

  -- The FK this migration exists for must still be SET NULL (person_id). If a
  -- later wave changed it, the reasoning above no longer applies and a human
  -- must re-read it.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.contact_governance_records'::regclass
       AND conname  = 'contact_governance_person_tenant_fk'
       AND pg_get_constraintdef(oid) ~ 'SET NULL \(person_id\)'
  ) THEN
    RAISE EXCEPTION 'PI/WS-F preflight: contact_governance_person_tenant_fk is not ON DELETE SET NULL (person_id) — this migration''s premise no longer holds';
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------------
-- The change.
-- ---------------------------------------------------------------------------
DO $apply$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'public.contact_governance_records'::regclass
     AND conname  = 'contact_governance_has_anchor';

  IF v_def ~ 'revoked_at' THEN
    RETURN;   -- idempotent replay
  END IF;

  ALTER TABLE public.contact_governance_records
    DROP CONSTRAINT contact_governance_has_anchor;

  ALTER TABLE public.contact_governance_records
    ADD CONSTRAINT contact_governance_has_anchor
    CHECK (
      person_id IS NOT NULL
      OR (target_normalized IS NOT NULL AND length(btrim(target_normalized)) > 0)
      -- A revoked record is history. It is filtered out of every read, excluded
      -- from every index, and rejected by the evaluator, so it is unmatchable
      -- with or without an anchor — and the SET NULL that erasure performs must
      -- be able to land on it.
      OR revoked_at IS NOT NULL
    );
END
$apply$;

COMMENT ON CONSTRAINT contact_governance_has_anchor ON public.contact_governance_records IS
  'PI/WS-F: a LIVE record must be matchable, so it must name a person or a target. A REVOKED record is history: it is filtered out of loadGovernanceRecords, rejected by isInForce and absent from every partial index, so requiring an anchor on it guarantees nothing and makes a person with person-only governance undeletable (DEFECT-008). Live-row semantics are unchanged.';

-- ---------------------------------------------------------------------------
-- Postconditions.
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  v_def TEXT;
  v_chk INT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'public.contact_governance_records'::regclass
     AND conname  = 'contact_governance_has_anchor';

  IF v_def IS NULL OR v_def !~ 'revoked_at' THEN
    RAISE EXCEPTION 'PI/WS-F postcondition: the anchor CHECK was not widened, found: %', coalesce(v_def, '<absent>');
  END IF;
  IF v_def !~ 'person_id IS NOT NULL' OR v_def !~ 'target_normalized IS NOT NULL' THEN
    RAISE EXCEPTION 'PI/WS-F postcondition: the live-row anchor requirement was lost, found: %', v_def;
  END IF;

  -- LI-3B's own postcondition floor must still hold: this migration replaces a
  -- CHECK, it does not remove one.
  SELECT count(*) INTO v_chk FROM pg_constraint con
   JOIN pg_class s ON s.oid = con.conrelid
   WHERE con.contype = 'c' AND s.relname = 'contact_governance_records';
  IF v_chk < 11 THEN
    RAISE EXCEPTION 'PI/WS-F postcondition: expected at least 11 CHECK constraints, found %', v_chk;
  END IF;

  -- Revocation must still be coherent, or an unanchored row could exist with no
  -- stated reason.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.contact_governance_records'::regclass
       AND conname  = 'contact_governance_revocation_coherent'
  ) THEN
    RAISE EXCEPTION 'PI/WS-F postcondition: contact_governance_revocation_coherent is missing — an unanchored row could carry no reason';
  END IF;

  RAISE NOTICE 'PI/WS-F: contact_governance_has_anchor now scoped to live rows; % CHECKs present.', v_chk;
END
$verify$;

COMMIT;
