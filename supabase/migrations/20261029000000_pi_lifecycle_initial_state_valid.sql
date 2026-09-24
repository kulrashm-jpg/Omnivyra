-- PI-LIFECYCLE-002 — the database stops being a bypass for the initial state.
--
-- AUTHORED, NOT APPLIED. No database was touched to produce this file, and
-- nothing in this workstream applies or deploys it.
--
-- ─── WHAT WAS WRONG ────────────────────────────────────────────────────────
-- `prospect_lifecycle_transitions` constrained WHICH WORDS may appear in
-- `state` (prospect_lifecycle_state_valid) and the SHAPE of an initial row
-- (prospect_lifecycle_initial_shape: is_initial ⇒ previous_state IS NULL). It
-- never constrained WHICH state a ledger may OPEN in.
--
-- The chain trigger does not close that gap either — it short-circuits:
--
--     IF NEW.is_initial THEN ... RETURN NEW; END IF;
--
-- so an initial row never reaches the previous_state/current_state comparison.
-- The transition graph lives only in TypeScript (`PROSPECT_STATE_MODEL`), and
-- an initial row has no `from`, so there was no edge to check even there.
--
-- Demonstrated against real PostgreSQL 17 with the migrations replayed: an
-- INSERT of `state = 'meeting_scheduled', is_initial = true` was ACCEPTED, as
-- was every one of the seven states — including `closed_disqualified`, which
-- has no outgoing edges. Such a row is unrepairable by construction: UPDATE and
-- DELETE raise 42501 from the append-only trigger, and a second initial row
-- raises 23505 from `uq_prospect_lifecycle_initial`. A ledger could therefore
-- be born terminal and stay that way.
--
-- ─── WHAT THIS DOES ───────────────────────────────────────────────────────
-- One additive CHECK. A row that is not initial is unaffected; an initial row
-- must carry the state the model opens at.
--
-- The literal mirrors `PROSPECT_STATE_MODEL.initial` in
-- `backend/services/prospectLifecycle/stateModel.ts`, exactly as
-- `prospect_lifecycle_state_valid` mirrors `PROSPECT_STATES`. That duplication
-- is deliberate and is the established pattern here: the vocabulary belongs in
-- the database as well as in TypeScript, so a writer that never loads the
-- application code still cannot invent one. A parity test asserts the two agree,
-- so they cannot drift silently.
--
-- ─── WHY A CHECK AND NOT A TRIGGER ────────────────────────────────────────
-- The rule is a property of the row alone — no other row is consulted — so a
-- CHECK is sufficient, is evaluated before the append-only and chain triggers
-- matter, and cannot be defeated by a session variable. A trigger would be a
-- larger surface for a smaller guarantee.
--
-- ─── SAFETY ───────────────────────────────────────────────────────────────
-- Additive and idempotent. It changes no existing constraint, no index, no
-- trigger, no RLS policy and no column. It does not weaken append-only
-- protection or tenant isolation.
--
-- The production table is EMPTY (0 rows observed read-only on 2026-09-24), so
-- no existing row can violate this. The preflight below refuses to proceed if
-- that ever stops being true, rather than failing halfway through an ALTER.

BEGIN;

-- ─── PREFLIGHT: fail closed, before changing anything ─────────────────────
DO $$
DECLARE
  v_offenders bigint;
BEGIN
  IF to_regclass('public.prospect_lifecycle_transitions') IS NULL THEN
    RAISE EXCEPTION 'prospect_lifecycle_transitions does not exist — apply 20261028000000 first'
      USING ERRCODE = '42P01';
  END IF;

  SELECT count(*) INTO v_offenders
  FROM public.prospect_lifecycle_transitions
  WHERE is_initial AND state <> 'identified';

  IF v_offenders > 0 THEN
    RAISE EXCEPTION
      'refusing to add prospect_lifecycle_initial_state_valid: % existing initial row(s) are not in ''identified''. '
      'The table is append-only, so these cannot be repaired by UPDATE — decide what to do with them first.',
      v_offenders
      USING ERRCODE = '23514';
  END IF;
END $$;

-- ─── THE CONSTRAINT ───────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'prospect_lifecycle_initial_state_valid'
      AND conrelid = 'public.prospect_lifecycle_transitions'::regclass
  ) THEN
    ALTER TABLE public.prospect_lifecycle_transitions
      ADD CONSTRAINT prospect_lifecycle_initial_state_valid
      CHECK (NOT is_initial OR state = 'identified');
  END IF;
END $$;

COMMENT ON CONSTRAINT prospect_lifecycle_initial_state_valid
  ON public.prospect_lifecycle_transitions IS
  'A ledger opens at the state PROSPECT_STATE_MODEL.initial names. Mirrors stateModel.ts; parity is test-asserted. Closes the initial-row bypass (PI-LIFECYCLE-002).';

-- ─── POSTCONDITIONS: prove the intent, do not assume it ───────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'prospect_lifecycle_initial_state_valid'
      AND conrelid = 'public.prospect_lifecycle_transitions'::regclass
  ) THEN
    RAISE EXCEPTION 'postcondition failed: prospect_lifecycle_initial_state_valid was not created'
      USING ERRCODE = '23514';
  END IF;

  -- The constraints this one must NOT have disturbed.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'prospect_lifecycle_initial_shape'
                   AND conrelid = 'public.prospect_lifecycle_transitions'::regclass) THEN
    RAISE EXCEPTION 'postcondition failed: prospect_lifecycle_initial_shape is missing'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'prospect_lifecycle_state_valid'
                   AND conrelid = 'public.prospect_lifecycle_transitions'::regclass) THEN
    RAISE EXCEPTION 'postcondition failed: prospect_lifecycle_state_valid is missing'
      USING ERRCODE = '23514';
  END IF;

  -- All three triggers, by their real names. `trg_prospect_lifecycle_guard` is
  -- the FUNCTION the three share, not a trigger name.
  IF (SELECT count(*) FROM pg_trigger
      WHERE tgrelid = 'public.prospect_lifecycle_transitions'::regclass
        AND tgname IN ('prospect_lifecycle_block_update',
                       'prospect_lifecycle_block_delete',
                       'prospect_lifecycle_chain')) <> 3 THEN
    RAISE EXCEPTION 'postcondition failed: the append-only/chain triggers are not all present'
      USING ERRCODE = '23514';
  END IF;
END $$;

COMMIT;
