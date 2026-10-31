-- ROLLBACK for 20270110000000_pi_prospect_problem_actor_fk_removal.sql
--
-- Restores the actor foreign key on `prospect_problem_observations` to its
-- 20270105000000 form:
--
--     FOREIGN KEY (recorded_by_user_id)
--       REFERENCES public.users (id) ON DELETE SET NULL
--
-- It restores the key under its original PostgreSQL-generated name,
-- `prospect_problem_observations_recorded_by_user_id_fkey`, so a schema rolled
-- back is indistinguishable from one that never moved.
--
-- ─── WHAT THIS COSTS ──────────────────────────────────────────────────────
-- It RE-ARMS DEFECT-008. `ppo_origin_actor` is still in place and still
-- requires a recorder on human origin, so as soon as this key exists again,
-- deleting a user named by any human-origin observation fires the referential
-- UPDATE, the CHECK refuses it with 23514, and the parent DELETE aborts. That
-- user becomes undeletable, and the error names a relation the operator was
-- not touching. Measured on PostgreSQL 17.10 before the forward migration:
-- `DELETE FROM public.users` → 23514 on `ppo_origin_actor`, user row intact.
--
-- The operational consequences come back with it: `tests/auth/
-- e2eIdentityCleanup.ts:127-133` hard-deletes `public.users` and will throw
-- `E2ECleanupError` on every run for that identity, while `scripts/beta/
-- reset-beta.mjs:51-53` will fail the same way and only `warn()`.
--
-- ─── IT CAN ALSO REFUSE, AND THAT IS THE POINT ────────────────────────────
-- `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY` VALIDATES existing rows.
-- The forward migration deliberately permits an actor id to outlive the user
-- row it names — that is the durability it buys. So if any user has been hard
-- deleted since it was applied, observations now carry a recorded uuid with no
-- matching `public.users.id`, and restoring the key would reject them with
-- 23503.
--
-- THIS FILE REFUSES in that case, with a count. It does NOT null, delete,
-- back-fill or otherwise rewrite a single observation to make itself succeed.
-- `prospect_problem_observations` is append-only evidence: the recorded actor
-- is part of the attestation, and erasing it to satisfy a schema rollback
-- would fabricate a statement nobody made. The answer to a refusal is to stay
-- on the forward migration.
--
-- MEASURE FIRST. If this returns a non-zero count, the rollback cannot
-- proceed without destroying provenance:
--
--   SELECT count(*) AS dangling_actors
--     FROM public.prospect_problem_observations o
--    WHERE o.recorded_by_user_id IS NOT NULL
--      AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = o.recorded_by_user_id);
--
-- To see which rows, and in which tenants:
--
--   SELECT o.id, o.organization_id, o.origin, o.recorded_by_user_id, o.recorded_at
--     FROM public.prospect_problem_observations o
--    WHERE o.recorded_by_user_id IS NOT NULL
--      AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = o.recorded_by_user_id)
--    ORDER BY o.recorded_at;
--
-- DO NOT "fix" that result by setting `recorded_by_user_id` to NULL. On a
-- human-origin row `ppo_origin_actor` forbids it, so the only way to force it
-- through would be to drop the guarantee as well — which is the repair this
-- programme rejected.

BEGIN;

DO $rollback$
DECLARE
  r_ppo      regclass := 'public.prospect_problem_observations'::regclass;
  r_users    regclass := 'public.users'::regclass;
  v_dangling BIGINT;
  v_existing TEXT;
  v_def        TEXT;
  v_deltype    "char";
  v_updtype    "char";
  v_matchtype  "char";
  v_validated  BOOLEAN;
  v_deferrable BOOLEAN;
  v_deferred   BOOLEAN;
BEGIN
  -- Already rolled back, or never applied: a key into public.users is present.
  SELECT string_agg(conname || ' => ' || pg_get_constraintdef(oid), ' | ' ORDER BY conname)
    INTO v_existing
    FROM pg_constraint
   WHERE conrelid = r_ppo AND contype = 'f' AND confrelid = r_users;

  IF v_existing IS NOT NULL THEN
    RAISE NOTICE 'PI/WS-3D rollback: a foreign key into public.users is already present; nothing to restore. Present: %', v_existing;
    RETURN;
  END IF;

  -- Refuse rather than rewrite. The count goes in the message so an operator
  -- can act on it without having to find the query in this header.
  SELECT count(*) INTO v_dangling
    FROM public.prospect_problem_observations o
   WHERE o.recorded_by_user_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = o.recorded_by_user_id);

  IF v_dangling > 0 THEN
    RAISE EXCEPTION
      'PI/WS-3D rollback refused: % observation(s) name a recording user that no longer exists. Restoring the foreign key would validate those rows and reject them with 23503, and the only way to force it would be to erase the recorded actor from append-only evidence. Run the SELECT in this file''s header and take the result to the owner; the correct outcome is usually to stay on 20270110000000.',
      v_dangling;
  END IF;

  ALTER TABLE public.prospect_problem_observations
    ADD CONSTRAINT prospect_problem_observations_recorded_by_user_id_fkey
    FOREIGN KEY (recorded_by_user_id) REFERENCES public.users (id) ON DELETE SET NULL;

  -- Prove the restored key is the original one, not merely a key by that name.
  -- All six properties, the same set the forward migration's preflight audits,
  -- so "indistinguishable from a schema that never moved" is demonstrated
  -- rather than argued.
  SELECT pg_get_constraintdef(con.oid), con.confdeltype, con.confupdtype,
         con.confmatchtype, con.convalidated, con.condeferrable, con.condeferred
    INTO v_def, v_deltype, v_updtype,
         v_matchtype, v_validated, v_deferrable, v_deferred
    FROM pg_constraint con
   WHERE con.conrelid = r_ppo
     AND con.conname = 'prospect_problem_observations_recorded_by_user_id_fkey';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'PI/WS-3D rollback: the foreign key was not created';
  END IF;
  IF v_deltype <> 'n' OR v_updtype <> 'a' OR v_matchtype <> 's'
     OR NOT v_validated OR v_deferrable OR v_deferred THEN
    RAISE EXCEPTION
      'PI/WS-3D rollback: restored key does not match the original: on_delete=% (expected n, SET NULL), on_update=% (expected a), match=% (expected s), validated=% (expected true), deferrable=%, deferred=% (both expected false). Definition: %',
      v_deltype, v_updtype, v_matchtype, v_validated, v_deferrable, v_deferred, v_def;
  END IF;
  IF v_def !~ 'FOREIGN KEY \(recorded_by_user_id\)' OR v_def !~ 'REFERENCES users\(id\)' THEN
    RAISE EXCEPTION 'PI/WS-3D rollback: restored key does not carry the original mapping. Definition: %', v_def;
  END IF;

  RAISE NOTICE 'PI/WS-3D rollback: restored % — DEFECT-008 is live again on this table.', v_def;
END
$rollback$;

COMMENT ON COLUMN public.prospect_problem_observations.recorded_by_user_id IS
  'The authenticated principal who recorded a HUMAN-origin observation; NULL for provider origin. Carries a foreign key to public.users with ON DELETE SET NULL, which together with ppo_origin_actor makes a recording user undeletable (DEFECT-008). Rolled back from 20270110000000.';

COMMIT;
