-- PI/WS-3D — the recording actor keeps its constraint and loses its foreign key.
--
-- WHAT CHANGES. Exactly one foreign key on
-- `prospect_problem_observations`:
--
--     prospect_problem_observations_recorded_by_user_id_fkey
--       BEFORE  FOREIGN KEY (recorded_by_user_id)
--                 REFERENCES public.users (id) ON DELETE SET NULL
--       AFTER   (absent)
--
-- Nothing else. No column, no type, no nullability, no CHECK, no other foreign
-- key, no referential action, no index, no trigger, no policy, no grant, no
-- row, no default. `ppo_origin_actor` is kept EXACTLY as it is, and this file
-- proves it: the apply block captures the constraint's definition and its oid
-- before the drop and refuses unless both are identical afterwards.
--
-- ─── WHY: DEFECT-008 ──────────────────────────────────────────────────────
-- 20270105000000 declared the actor column with a nullifying referential
-- action (`:155`) and, twelve lines later, a CHECK forbidding the null
-- (`:207-211`):
--
--     recorded_by_user_id uuid REFERENCES public.users (id) ON DELETE SET NULL
--     CONSTRAINT ppo_origin_actor CHECK (
--       (origin = 'human'    AND recorded_by_user_id IS NOT NULL)
--       OR (origin = 'provider' AND recorded_by_user_id IS NULL))
--
-- Deleting a recording user makes PostgreSQL perform the referential action as
-- a real UPDATE on this row. An UPDATE re-evaluates EVERY table CHECK on the
-- updated row, not only the columns it touched. `ppo_origin_actor` then reads
-- (origin = 'human' AND NULL IS NOT NULL), both branches are false, and the
-- constraint fails with 23514 — which propagates out of the referential action
-- and ABORTS THE PARENT DELETE. The user becomes undeletable, and the error
-- names a relation the operator was never touching.
--
-- MEASURED, not reasoned. On PostgreSQL 17.10, against this repository's own
-- schema in a disposable database, with one legal human-origin observation:
--
--     DELETE FROM public.users WHERE id = $1;
--     -- 23514, constraint "ppo_origin_actor"; the users row SURVIVES
--
-- and, isolating the mechanism from the delete, the referential action's own
-- statement is refused in the same way:
--
--     UPDATE public.prospect_problem_observations
--        SET recorded_by_user_id = NULL WHERE id = $1;   -- 23514
--
-- The defect requires BOTH halves: a nullifying action AND a constraint that
-- forbids the null. Removing the action disarms it and keeps the guarantee.
--
-- The sibling migration 20270106000000 named this instance already
-- (`:44-51`), declined to create a fourth, and gave `attested_by_user_id` a
-- mandatory actor with NO foreign key for exactly this reason. This file
-- brings `prospect_problem_observations` onto that ratified pattern — the same
-- one `identity_verification_attestations.attested_by` has carried since
-- 20261231000007 (`:92`), and the one `20260507_identity_security_tables.sql`
-- states as policy (`:240-242`): keys into an audit relation are denormalized
-- for retention safety.
--
-- ─── WHY NOT THE OTHER REPAIRS ────────────────────────────────────────────
-- RELAX `ppo_origin_actor` so a nulled actor is admitted. That keeps the
-- delete by dropping the guarantee: a human-origin statement with no recorder
-- becomes legal storage, and "an attested statement is never anonymous" stops
-- being an invariant. It also contradicts a live assertion —
-- backend/tests/realschema/pi_ws3d_problem_observations.test.ts:396-414
-- refuses `origin='human'` with no recorder.
--
-- ON DELETE CASCADE. A user deletion would silently erase prospect statements
-- from an append-only evidence relation, for a reason that has nothing to do
-- with the prospect. That is a retention decision, not a referential one.
--
-- ON DELETE RESTRICT / NO ACTION. This is the current behaviour made explicit:
-- a legible 23503 instead of a baffling 23514. Honest, but it still leaves the
-- user undeletable, and nothing chose that policy.
--
-- ─── WHAT A READER LOSES ──────────────────────────────────────────────────
-- `recorded_by_user_id` is no longer guaranteed to resolve to a live
-- `public.users` row. Nothing reads it that way: `prospectIntelligenceRead`
-- surfaces no recording user (pages/api/prospects/[id]/problems.ts:36) and the
-- panel renders a constant string chosen from `origin`, never the uuid
-- (components/prospects/ProblemObservationsPanel.tsx:471-473). No query in the
-- repository joins `users` on this column. The product SOFT-deletes
-- application users (20260323_user_soft_delete.sql; the super-admin route
-- UPDATEs `is_deleted`), so in normal operation the referent does not go away
-- at all — and when a hard delete does happen, the recorded id now SURVIVES
-- instead of being erased, which is the correct behaviour for an append-only
-- attestation.
--
-- ─── WHAT THIS DOES NOT DO ────────────────────────────────────────────────
-- It does not touch `source_assertions.asserted_by_user_id` or
-- `prospect_lifecycle_transitions.actor_user_id`, which carry the identical
-- pair and remain armed. It does not change the API contract: the route
-- already derives the recorder from the authenticated principal and refuses
-- `recordedByUserId` in a request body by name. It does not alter
-- 20270105000000 or 20270106000000. It reads and writes no row.
--
-- SAFE TO APPLY. One constraint dropped, under a preflight that refuses any
-- catalog state other than the one this file was written against. Idempotent:
-- a re-run finds no foreign key into `public.users` and returns.
--
-- ─── ONE DELIBERATE TRIP-WIRE ─────────────────────────────────────────────
-- The last postcondition requires this table to carry exactly NINE CHECK
-- constraints — the nine 20270105000000 declares. A later migration that adds
-- a tenth will therefore fail THIS file on replay rather than its own. That is
-- intended: `ppo_origin_actor` is only safe to keep because no referential
-- action can null the column it guards, and a new CHECK on this table is a
-- reason to re-read DEFECT-008 before it ships. Raise the number here, in the
-- same commit, once that reading is done.
--
-- Rollback: supabase/migrations/rollbacks/pi_prospect_problem_actor_fk_removal_rollback.sql

BEGIN;

-- ---------------------------------------------------------------------------
-- Preflight. Fail closed unless the catalog is the one this migration was
-- reasoned about. Every refusal prints a census of the foreign keys into
-- `public.users`, because the constraint being dropped is named by PostgreSQL
-- and not by this repository, so an operator cannot look it up in the source.
-- ---------------------------------------------------------------------------
DO $preflight$
DECLARE
  r_ppo      regclass := 'public.prospect_problem_observations'::regclass;
  r_users    regclass := 'public.users'::regclass;
  n_users_fk INT;
  n_actor_fk INT;
  v_census   TEXT;
  v_chk      TEXT;
BEGIN
  -- Every foreign key from this table into public.users, whatever its shape.
  SELECT count(*) INTO n_users_fk
    FROM pg_constraint con
   WHERE con.conrelid = r_ppo AND con.contype = 'f' AND con.confrelid = r_users;

  -- Of those, the ones that are a SINGLE-column mapping onto the actor column.
  SELECT count(*) INTO n_actor_fk
    FROM pg_constraint con
   WHERE con.conrelid = r_ppo AND con.contype = 'f' AND con.confrelid = r_users
     AND array_length(con.conkey, 1) = 1
     AND EXISTS (
           SELECT 1 FROM pg_attribute a
            WHERE a.attrelid = con.conrelid
              AND a.attnum = con.conkey[1]
              AND NOT a.attisdropped
              AND a.attname = 'recorded_by_user_id');

  SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid),
                             ' | ' ORDER BY con.conname), '(none)')
    INTO v_census
    FROM pg_constraint con
   WHERE con.conrelid = r_ppo AND con.contype = 'f' AND con.confrelid = r_users;

  -- Something references public.users that is NOT the single-column actor key.
  -- Refuse BEFORE any DDL rather than let the postcondition fail after it.
  IF n_users_fk <> n_actor_fk THEN
    RAISE EXCEPTION
      'PI/WS-3D preflight: prospect_problem_observations has % foreign key(s) into public.users, of which % is the expected single-column mapping onto recorded_by_user_id. This migration will not drop a key it does not recognise. Foreign keys into public.users: %. Resolve manually.',
      n_users_fk, n_actor_fk, v_census;
  END IF;

  -- Two identically shaped keys are legal in PostgreSQL and would make the
  -- drop arbitrary.
  IF n_actor_fk > 1 THEN
    RAISE EXCEPTION
      'PI/WS-3D preflight: % single-column foreign keys run from recorded_by_user_id to public.users. Ambiguous — this migration drops exactly one. Foreign keys into public.users: %. Resolve manually.',
      n_actor_fk, v_census;
  END IF;

  -- The guarantee this migration promises to keep must actually be there. If
  -- `ppo_origin_actor` were already absent, dropping the foreign key would be
  -- a change to something other than DEFECT-008 and a human must re-read it.
  SELECT pg_get_constraintdef(oid) INTO v_chk
    FROM pg_constraint
   WHERE conrelid = r_ppo AND conname = 'ppo_origin_actor';

  IF v_chk IS NULL THEN
    RAISE EXCEPTION 'PI/WS-3D preflight: ppo_origin_actor is absent — this migration''s premise no longer holds; it exists to keep that constraint while removing the referential action that collides with it';
  END IF;
  IF v_chk !~ 'recorded_by_user_id IS NOT NULL' OR v_chk !~ 'recorded_by_user_id IS NULL' THEN
    RAISE EXCEPTION 'PI/WS-3D preflight: ppo_origin_actor no longer binds both origin legs, found: %', v_chk;
  END IF;

  IF n_users_fk = 0 THEN
    RAISE NOTICE 'PI/WS-3D: prospect_problem_observations already carries no foreign key into public.users; nothing to drop.';
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------------
-- The change. The constraint name is resolved from the catalog, never
-- predicted: 20270105000000 declared this key inline and unnamed, so the name
-- is whatever PostgreSQL generated (in practice
-- `prospect_problem_observations_recorded_by_user_id_fkey`, 54 characters, so
-- not truncated — but the code does not depend on that).
--
-- `ppo_origin_actor` is captured before the drop and compared afterwards, by
-- definition AND by oid. Comparing the capture to itself is deliberate: the
-- rendering of `pg_get_constraintdef` is server-version dependent, so an
-- expected literal baked into this file would be a version lock rather than a
-- guarantee. Comparing the oid proves the constraint was not dropped and
-- recreated into something that merely renders the same.
-- ---------------------------------------------------------------------------
DO $apply$
DECLARE
  r_ppo        regclass := 'public.prospect_problem_observations'::regclass;
  r_users      regclass := 'public.users'::regclass;
  v_name       TEXT;
  v_def        TEXT;
  v_deltype    "char";
  v_updtype    "char";
  v_matchtype  "char";
  v_validated  BOOLEAN;
  v_deferrable BOOLEAN;
  v_deferred   BOOLEAN;
  v_confkey    smallint[];
  a_users_id   smallint[];
  v_chk_oid_before OID;
  v_chk_def_before TEXT;
  v_chk_oid_after  OID;
  v_chk_def_after  TEXT;
BEGIN
  SELECT con.oid, pg_get_constraintdef(con.oid)
    INTO v_chk_oid_before, v_chk_def_before
    FROM pg_constraint con
   WHERE con.conrelid = r_ppo AND con.conname = 'ppo_origin_actor';

  SELECT con.conname, pg_get_constraintdef(con.oid), con.confdeltype, con.confupdtype,
         con.confmatchtype, con.convalidated, con.condeferrable, con.condeferred, con.confkey
    INTO v_name, v_def, v_deltype, v_updtype,
         v_matchtype, v_validated, v_deferrable, v_deferred, v_confkey
    FROM pg_constraint con
   WHERE con.conrelid = r_ppo AND con.contype = 'f' AND con.confrelid = r_users
     AND array_length(con.conkey, 1) = 1
     AND EXISTS (
           SELECT 1 FROM pg_attribute a
            WHERE a.attrelid = con.conrelid
              AND a.attnum = con.conkey[1]
              AND NOT a.attisdropped
              AND a.attname = 'recorded_by_user_id');

  IF v_name IS NULL THEN
    RETURN;   -- idempotent replay; the preflight has already said so
  END IF;

  -- The key must reference users.id, not some other unique column of users.
  SELECT array_agg(a.attnum ORDER BY a.attnum) INTO a_users_id
    FROM pg_attribute a
   WHERE a.attrelid = r_users AND a.attname = 'id' AND a.attnum > 0 AND NOT a.attisdropped;

  IF v_confkey IS DISTINCT FROM a_users_id THEN
    RAISE EXCEPTION
      'PI/WS-3D: % references column(s) % of public.users rather than its id (%). Definition: %. Refusing; resolve manually.',
      v_name, v_confkey::TEXT, COALESCE(a_users_id::TEXT, 'NULL'), v_def;
  END IF;

  -- ...and it must be the key this migration was reasoned about. If a later
  -- wave already changed the referential action, DEFECT-008 is not present in
  -- this shape and the reasoning in the header does not apply.
  IF v_deltype <> 'n' OR v_updtype <> 'a' OR v_matchtype <> 's'
     OR NOT v_validated OR v_deferrable OR v_deferred THEN
    RAISE EXCEPTION
      'PI/WS-3D: % is not the key this migration was written against: on_delete=% (expected n, SET NULL), on_update=% (expected a), match=% (expected s), validated=% (expected true), deferrable=%, deferred=% (both expected false). Definition: %. Refusing; resolve manually.',
      v_name, v_deltype, v_updtype, v_matchtype, v_validated, v_deferrable, v_deferred, v_def;
  END IF;

  EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r_ppo::TEXT, v_name);
  RAISE NOTICE 'PI/WS-3D: dropped % on prospect_problem_observations. Dropped definition was: %', v_name, v_def;

  -- The guarantee survived the drop, unchanged and not recreated.
  SELECT con.oid, pg_get_constraintdef(con.oid)
    INTO v_chk_oid_after, v_chk_def_after
    FROM pg_constraint con
   WHERE con.conrelid = r_ppo AND con.conname = 'ppo_origin_actor';

  IF v_chk_def_after IS NULL THEN
    RAISE EXCEPTION 'PI/WS-3D: ppo_origin_actor disappeared during the drop — the guarantee was removed, not the foreign key';
  END IF;
  IF v_chk_oid_after <> v_chk_oid_before THEN
    RAISE EXCEPTION 'PI/WS-3D: ppo_origin_actor was replaced (oid % -> %), not preserved', v_chk_oid_before, v_chk_oid_after;
  END IF;
  IF v_chk_def_after <> v_chk_def_before THEN
    RAISE EXCEPTION 'PI/WS-3D: ppo_origin_actor changed definition. Before: %. After: %.', v_chk_def_before, v_chk_def_after;
  END IF;
  RAISE NOTICE 'PI/WS-3D: ppo_origin_actor preserved byte-for-byte (oid %): %', v_chk_oid_after, v_chk_def_after;
END
$apply$;

COMMENT ON COLUMN public.prospect_problem_observations.recorded_by_user_id IS
  'The authenticated principal who recorded a HUMAN-origin observation; NULL for provider origin, as ppo_origin_actor requires both ways. A RECORDED uuid with NO foreign key into public.users, deliberately: a users reference with ON DELETE SET NULL fires a referential UPDATE that ppo_origin_actor refuses, which aborts the parent DELETE and makes the recording user undeletable (DEFECT-008, named in 20270106000000). The same reason attested_engagement_identities.attested_by_user_id and identity_verification_attestations.attested_by carry no key. The id may therefore outlive the user row it names, which is the correct behaviour for an append-only attestation.';

-- ---------------------------------------------------------------------------
-- Postconditions. The defect is gone, nothing else moved, and a later
-- migration that re-adds the actor key fails HERE on replay rather than
-- silently re-arming DEFECT-008.
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  r_ppo       regclass := 'public.prospect_problem_observations'::regclass;
  r_users     regclass := 'public.users'::regclass;
  v_user_fk   INT;
  v_fk_total  INT;
  v_composite INT;
  v_chk_total INT;
  v_def       TEXT;
  v_validated BOOLEAN;
  v_type      TEXT;
  v_notnull   BOOLEAN;
  v_census    TEXT;
BEGIN
  -- 1. THE DEFECT IS GONE. No foreign key from this table reaches
  --    public.users, so no referential action on this table can ever
  --    re-evaluate one of its CHECKs again.
  SELECT count(*) INTO v_user_fk
    FROM pg_constraint
   WHERE conrelid = r_ppo AND contype = 'f' AND confrelid = r_users;
  IF v_user_fk <> 0 THEN
    SELECT string_agg(conname || ' => ' || pg_get_constraintdef(oid), ' | ' ORDER BY conname)
      INTO v_census
      FROM pg_constraint
     WHERE conrelid = r_ppo AND contype = 'f' AND confrelid = r_users;
    RAISE EXCEPTION 'PI/WS-3D postcondition: % foreign key(s) still reference public.users — DEFECT-008 is armed: %', v_user_fk, v_census;
  END IF;

  -- 2. ...and nothing else was dropped with it. FOUR foreign keys remain.
  --    Note that one of them is legitimately single-column (the tenant key to
  --    companies), so "no single-column foreign keys" would be the wrong
  --    assertion and is deliberately not made.
  SELECT count(*) INTO v_fk_total
    FROM pg_constraint WHERE conrelid = r_ppo AND contype = 'f';
  IF v_fk_total <> 4 THEN
    RAISE EXCEPTION 'PI/WS-3D postcondition: expected exactly 4 foreign keys after the drop, found %', v_fk_total;
  END IF;

  SELECT count(*) INTO v_composite
    FROM pg_constraint
   WHERE conrelid = r_ppo AND contype = 'f' AND array_length(conkey, 1) = 2;
  IF v_composite <> 3 THEN
    RAISE EXCEPTION 'PI/WS-3D postcondition: expected 3 composite tenant foreign keys, found % — this is also 20270105000000''s own count, which must keep passing', v_composite;
  END IF;

  -- 3. The three tenant keys by name, with their declared referential actions,
  --    plus the tenant key to companies. These are the keys the drop must not
  --    have touched.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = r_ppo AND conname = 'ppo_person_tenant_fk' AND confdeltype = 'c') THEN
    RAISE EXCEPTION 'PI/WS-3D postcondition: ppo_person_tenant_fk is missing or no longer ON DELETE CASCADE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = r_ppo AND conname = 'ppo_account_tenant_fk' AND confdeltype = 'c') THEN
    RAISE EXCEPTION 'PI/WS-3D postcondition: ppo_account_tenant_fk is missing or no longer ON DELETE CASCADE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = r_ppo AND conname = 'ppo_source_record_tenant_fk' AND confdeltype = 'r') THEN
    RAISE EXCEPTION 'PI/WS-3D postcondition: ppo_source_record_tenant_fk is missing or no longer ON DELETE RESTRICT';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint con
                  WHERE con.conrelid = r_ppo AND con.contype = 'f'
                    AND con.confrelid = 'public.companies'::regclass
                    AND con.confdeltype = 'c'
                    AND array_length(con.conkey, 1) = 1
                    AND EXISTS (SELECT 1 FROM pg_attribute a
                                 WHERE a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
                                   AND a.attname = 'organization_id')) THEN
    RAISE EXCEPTION 'PI/WS-3D postcondition: the single-column tenant foreign key organization_id -> companies(id) ON DELETE CASCADE is missing';
  END IF;

  -- 4. THE GUARANTEE IS INTACT. An attested statement is still never
  --    anonymous. The byte-for-byte comparison happened in $apply$ against the
  --    pre-drop capture; these are the version-stable backstops.
  SELECT pg_get_constraintdef(oid), convalidated INTO v_def, v_validated
    FROM pg_constraint WHERE conrelid = r_ppo AND conname = 'ppo_origin_actor';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'PI/WS-3D postcondition: ppo_origin_actor is absent — the foreign key was dropped AND the guarantee lost';
  END IF;
  IF v_def !~ 'recorded_by_user_id IS NOT NULL' OR v_def !~ 'recorded_by_user_id IS NULL' THEN
    RAISE EXCEPTION 'PI/WS-3D postcondition: ppo_origin_actor no longer binds both origin legs, found: %', v_def;
  END IF;
  IF NOT v_validated THEN
    RAISE EXCEPTION 'PI/WS-3D postcondition: ppo_origin_actor is no longer validated';
  END IF;

  -- 5. No CHECK was removed. 20270105000000 declares nine; its own
  --    postcondition counts an enumerated subset of seven, so this counts the
  --    total the catalog actually carries.
  SELECT count(*) INTO v_chk_total
    FROM pg_constraint WHERE conrelid = r_ppo AND contype = 'c';
  IF v_chk_total <> 9 THEN
    RAISE EXCEPTION 'PI/WS-3D postcondition: expected 9 CHECK constraints, found %', v_chk_total;
  END IF;

  -- 6. The column is unchanged: still a nullable uuid. Provider origin needs
  --    the NULL, so making it NOT NULL would break the other leg.
  SELECT format_type(a.atttypid, a.atttypmod), a.attnotnull INTO v_type, v_notnull
    FROM pg_attribute a
   WHERE a.attrelid = r_ppo AND a.attname = 'recorded_by_user_id' AND NOT a.attisdropped;
  IF v_type IS DISTINCT FROM 'uuid' OR v_notnull THEN
    RAISE EXCEPTION 'PI/WS-3D postcondition: recorded_by_user_id should be a nullable uuid, found % notnull=%', COALESCE(v_type, '<absent>'), v_notnull;
  END IF;

  RAISE NOTICE 'PI/WS-3D: recorded_by_user_id carries no foreign key into public.users; 4 FKs remain (3 composite tenant keys + organization_id -> companies); 9 CHECKs present with ppo_origin_actor validated and binding both legs; the column is still a nullable uuid. DEFECT-008 is disarmed on this table.';
END
$verify$;

COMMIT;
