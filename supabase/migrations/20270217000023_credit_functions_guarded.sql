-- 20270217000023_credit_functions_guarded
--
-- MONEY (e9 option C, approved 2026-11-12; version reserved by 83, registry
-- 9233dbb2b). Two NEW functions; nothing applied is edited and the old pair
-- (apply_credit_reservation / apply_credit_partial_confirm) stays live and
-- unchanged until every caller has moved. The revoke of their service_role
-- EXECUTE is a SEPARATE later migration (pre-reserved 20270217000024).
--
-- WHY: prod's live settlement functions do not refuse a second settlement of a
-- HOLD (the 20260625 "already settled" guard was never installed - 83/C17), do
-- not require the parent HOLD for confirm / release, and the live partial
-- confirm (83/C21, md5 ff208f60) takes no lock on the hold. The app-side
-- settle-once guard is not atomic. These functions make the guard atomic.
--
-- (1) public.apply_credit_reservation_guarded - same 12 arguments (names and
--     the repo definitions' defaults, so callers that omit p_category keep
--     working) as the live apply_credit_reservation. For confirm / release:
--       - p_parent_id and p_idempotency_key are REQUIRED;
--       - per-hold serialisation: pg_advisory_xact_lock on the hold id (every
--         guarded settlement takes it FIRST, then the delegated body locks the
--         wallet - one lock order);
--       - the parent must be a 'hold' row of the SAME organisation;
--       - a repeat of the SAME key returns the existing row (idempotent), and a
--         key already used for a DIFFERENT org / hold / phase is refused;
--       - a second settlement of the hold under ANY other key is refused
--         (HOLD_ALREADY_SETTLED; settlement phases: confirm, release,
--         confirm_partial);
--       - the settled amount may not exceed the hold's split per category
--         (the live body clamps reserved_* at 0, which would silently drain
--         ANOTHER hold's reservation).
--     It then DELEGATES to the live apply_credit_reservation, so no money math
--     is duplicated. Other phases (hold, grant, expire, expire_incentive) pass
--     straight through.
-- (2) public.apply_credit_partial_confirm_guarded - same 10 arguments as the
--     live apply_credit_partial_confirm; the same lock / parent / idempotency /
--     settled guard, then the settlement math of the LIVE body (83/C21 md5
--     ff208f60617a7a272305a804037bf47d, saved in closure-r28/C21-drift-bodies)
--     with the owner's over-confirm rulings (e9, 2026-11-12) as EXPLICIT
--     behaviour changes from prod:
--       - consume up to the held amount per category; the unused hold is
--         released;
--       - the EXCESS over the hold draws ACROSS categories in the spending
--         order free -> incentive -> paid, never more than the total available
--         (prod today draws each category's excess from that category only);
--       - an uncovered shortfall is RECORDED (is_underfunded + note), never
--         refused; no balance goes negative;
--       - the released remainder gets its OWN ledger row (execution_phase
--         'release', parent = the hold, key <confirm key>:remainder) for audit
--         truth; prod folds it into the confirm row.
--     It does not read or call the old partial confirm, so its behaviour does
--     not depend on which body an environment carries.
--
-- ORDER (e9): applies AFTER 20270217000001. (1) delegates to the live
-- apply_credit_reservation body, so the precondition REFUSES unless that body
-- is one of 000001's POST-fix forms (LF/CRLF): prod 03d616e6 / 90bcbfb5,
-- full-replay 7799ec27 / 7ee214ad.
--
-- SCOPE OF THE LOCK (e9): the advisory lock serialises GUARDED settlements
-- only. A settlement written through the legacy apply_credit_reservation /
-- apply_credit_partial_confirm takes no such lock and is unserialised against
-- these until every caller has moved and 20270217000024 revokes the legacy
-- pair's EXECUTE (app code calls only the guarded names - pinned by
-- creditLegacyRpcNotCalled.test.ts).
-- LOCKING NOTE: the hold row is NOT locked FOR UPDATE. SELECT ... FOR UPDATE
-- needs UPDATE privilege on credit_transactions (an append-only ledger whose
-- grants differ between hosted and replayed builds); the advisory lock gives
-- the same serialisation among guarded settlements, and the old functions
-- never lock the hold row either.
--
-- PROVENANCE: the precondition proves each guarded function is ABSENT, or is
-- byte-for-byte this migration's own body (a re-run). The rollback therefore
-- drops exactly these two signatures and nothing else (no CASCADE).
-- Rollback: rollbacks/credit_functions_guarded_rollback.sql
-- GOV-SECURITY: virality-83; review: virality-05.

DO $pre$
DECLARE
  v_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5
    FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.apply_credit_reservation(uuid,text,integer,integer,integer,text,text,text,text,uuid,uuid,text)');
  IF v_md5 IS NULL THEN
    RAISE EXCEPTION 'credit_guarded: public.apply_credit_reservation with the expected signature not found - nothing changed';
  END IF;
  IF v_md5 NOT IN ('03d616e692cdfb9fefc25eb81e8e4595', '90bcbfb5e9eb2eedf1a0b7a8266554bf',
                   '7799ec2755c49c952bacd529916acc9c', '7ee214ad28938b36d57f63eb68a9b9cd') THEN
    RAISE EXCEPTION 'credit_guarded: apply_credit_reservation is not a 20270217000001 post-fix body (md5 %) - apply 20270217000001 first; nothing changed', v_md5;
  END IF;

  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.apply_credit_reservation_guarded(uuid,text,integer,integer,integer,text,text,text,text,uuid,uuid,text)');
  IF v_md5 IS NOT NULL AND v_md5 NOT IN ('d48341eac02fe4482c132ed0c5215a41', 'ceb593fd52a7438aea55ed0d939b6ac2') THEN
    RAISE EXCEPTION 'credit_guarded: apply_credit_reservation_guarded already exists with a FOREIGN body (md5 %) - nothing changed', v_md5;
  END IF;
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.apply_credit_partial_confirm_guarded(uuid,uuid,integer,integer,integer,text,text,text,text,uuid)');
  IF v_md5 IS NOT NULL AND v_md5 NOT IN ('cce149fbd1c7a1ffa41b59e9cf59ffe6', '764384d45f4ef841117ffb46d537d4c3') THEN
    RAISE EXCEPTION 'credit_guarded: apply_credit_partial_confirm_guarded already exists with a FOREIGN body (md5 %) - nothing changed', v_md5;
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION public.apply_credit_reservation_guarded(
  p_org_id           uuid,
  p_phase            text,
  p_free_amount      integer DEFAULT 0,
  p_incentive_amount integer DEFAULT 0,
  p_paid_amount      integer DEFAULT 0,
  p_idempotency_key  text    DEFAULT NULL,
  p_reference_type   text    DEFAULT NULL,
  p_reference_id     text    DEFAULT NULL,
  p_note             text    DEFAULT NULL,
  p_performed_by     uuid    DEFAULT NULL,
  p_parent_id        uuid    DEFAULT NULL,
  p_category         text    DEFAULT 'paid'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_hold     public.credit_transactions%ROWTYPE;
  v_existing public.credit_transactions%ROWTYPE;
BEGIN
  IF p_phase IN ('confirm', 'release') THEN
    IF p_parent_id IS NULL THEN
      RAISE EXCEPTION 'SETTLEMENT_PARENT_REQUIRED: % requires the parent HOLD id', p_phase;
    END IF;
    IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED: % requires an idempotency key', p_phase;
    END IF;
    IF COALESCE(p_free_amount, 0) < 0 OR COALESCE(p_incentive_amount, 0) < 0 OR COALESCE(p_paid_amount, 0) < 0 THEN
      RAISE EXCEPTION 'NEGATIVE_AMOUNT: % amounts must be non-negative', p_phase;
    END IF;

    -- One settlement of a hold at a time (all guarded settlements lock here first).
    PERFORM pg_advisory_xact_lock(hashtextextended('credit_hold_settlement:' || p_parent_id::text, 0));

    SELECT * INTO v_hold FROM public.credit_transactions WHERE id = p_parent_id;
    IF NOT FOUND OR v_hold.organization_id IS DISTINCT FROM p_org_id OR v_hold.execution_phase IS DISTINCT FROM 'hold' THEN
      RAISE EXCEPTION 'SETTLEMENT_PARENT_INVALID: % parent % is not a HOLD of org %', p_phase, p_parent_id, p_org_id;
    END IF;

    SELECT * INTO v_existing FROM public.credit_transactions WHERE idempotency_key = p_idempotency_key LIMIT 1;
    IF FOUND THEN
      IF v_existing.organization_id IS DISTINCT FROM p_org_id
         OR v_existing.parent_transaction_id IS DISTINCT FROM p_parent_id
         OR v_existing.execution_phase IS DISTINCT FROM p_phase THEN
        RAISE EXCEPTION 'IDEMPOTENCY_KEY_CONFLICT: key % already belongs to transaction % (a different org, hold or phase)', p_idempotency_key, v_existing.id;
      END IF;
      RETURN row_to_json(v_existing)::jsonb;
    END IF;

    SELECT * INTO v_existing FROM public.credit_transactions
     WHERE parent_transaction_id = p_parent_id
       AND execution_phase IN ('confirm', 'release', 'confirm_partial')
     LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'HOLD_ALREADY_SETTLED: hold % already settled by % transaction %', p_parent_id, v_existing.execution_phase, v_existing.id;
    END IF;

    IF COALESCE(p_free_amount, 0)      > abs(COALESCE(v_hold.free_delta, 0))
       OR COALESCE(p_incentive_amount, 0) > abs(COALESCE(v_hold.incentive_delta, 0))
       OR COALESCE(p_paid_amount, 0)      > abs(COALESCE(v_hold.paid_delta, 0)) THEN
      RAISE EXCEPTION 'SETTLEMENT_EXCEEDS_HOLD: % amount exceeds the split of hold %', p_phase, p_parent_id;
    END IF;
  END IF;

  RETURN public.apply_credit_reservation(
    p_org_id, p_phase, p_free_amount, p_incentive_amount, p_paid_amount,
    p_idempotency_key, p_reference_type, p_reference_id, p_note, p_performed_by,
    p_parent_id, p_category);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.apply_credit_partial_confirm_guarded(
  p_org_id           uuid,
  p_hold_txn_id      uuid,
  p_actual_free      integer DEFAULT 0,
  p_actual_incentive integer DEFAULT 0,
  p_actual_paid      integer DEFAULT 0,
  p_idempotency_key  text    DEFAULT NULL,
  p_reference_type   text    DEFAULT NULL,
  p_reference_id     text    DEFAULT NULL,
  p_note             text    DEFAULT NULL,
  p_performed_by     uuid    DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_tx_row       public.credit_transactions%ROWTYPE;
  v_release_row  public.credit_transactions%ROWTYPE;
  v_hold         public.credit_transactions%ROWTYPE;
  v_existing     public.credit_transactions%ROWTYPE;
  v_wallet       public.organization_credits%ROWTYPE;

  v_actual_free      int := COALESCE(p_actual_free, 0);
  v_actual_incentive int := COALESCE(p_actual_incentive, 0);
  v_actual_paid      int := COALESCE(p_actual_paid, 0);

  v_held_free       int;
  v_held_incentive  int;
  v_held_paid       int;

  v_consume_free      int;
  v_consume_incentive int;
  v_consume_paid      int;

  v_release_free      int;
  v_release_incentive int;
  v_release_paid      int;

  v_excess_total    int;
  v_left            int;
  v_extra_free      int := 0;
  v_extra_incentive int := 0;
  v_extra_paid      int := 0;
  v_shortfall       int := 0;
  v_is_underfunded  boolean := false;

  v_consumed_total  int;
  v_released_total  int;
  v_remainder_key   text;
BEGIN
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED: partial confirm requires an idempotency key';
  END IF;
  IF p_hold_txn_id IS NULL THEN
    RAISE EXCEPTION 'SETTLEMENT_PARENT_REQUIRED: partial confirm requires the parent HOLD id';
  END IF;
  IF v_actual_free < 0 OR v_actual_incentive < 0 OR v_actual_paid < 0 THEN
    RAISE EXCEPTION 'NEGATIVE_AMOUNT: partial confirm amounts must be non-negative';
  END IF;
  v_remainder_key := p_idempotency_key || ':remainder';

  -- One settlement of a hold at a time (same lock as apply_credit_reservation_guarded).
  PERFORM pg_advisory_xact_lock(hashtextextended('credit_hold_settlement:' || p_hold_txn_id::text, 0));

  SELECT * INTO v_hold FROM public.credit_transactions WHERE id = p_hold_txn_id;
  IF NOT FOUND OR v_hold.organization_id IS DISTINCT FROM p_org_id OR v_hold.execution_phase IS DISTINCT FROM 'hold' THEN
    RAISE EXCEPTION 'SETTLEMENT_PARENT_INVALID: partial confirm parent % is not a HOLD of org %', p_hold_txn_id, p_org_id;
  END IF;

  -- Idempotent repeat of the SAME key: report the settlement already made.
  SELECT * INTO v_existing FROM public.credit_transactions WHERE idempotency_key = p_idempotency_key LIMIT 1;
  IF FOUND THEN
    IF v_existing.organization_id IS DISTINCT FROM p_org_id
       OR v_existing.parent_transaction_id IS DISTINCT FROM p_hold_txn_id
       OR v_existing.execution_phase IS DISTINCT FROM 'confirm_partial' THEN
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_CONFLICT: key % already belongs to transaction % (a different org, hold or phase)', p_idempotency_key, v_existing.id;
    END IF;
    SELECT * INTO v_release_row FROM public.credit_transactions WHERE idempotency_key = v_remainder_key LIMIT 1;
    RETURN jsonb_build_object(
      'id',                 v_existing.id,
      'idempotent',         true,
      'total_consumed',     -COALESCE(v_existing.credits_delta, 0),
      'total_released',     CASE WHEN v_release_row.id IS NULL THEN 0 ELSE COALESCE(v_release_row.credits_delta, 0) END,
      'release_txn_id',     v_release_row.id,
      'is_underfunded',     COALESCE(v_existing.is_underfunded, false)
    );
  END IF;

  SELECT * INTO v_existing FROM public.credit_transactions
   WHERE parent_transaction_id = p_hold_txn_id
     AND execution_phase IN ('confirm', 'release', 'confirm_partial')
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'HOLD_ALREADY_SETTLED: hold % already settled by % transaction %', p_hold_txn_id, v_existing.execution_phase, v_existing.id;
  END IF;

  -- HOLD deltas are stored NEGATIVE (outflow); flip sign to get held amounts.
  v_held_free      := abs(COALESCE(v_hold.free_delta, 0));
  v_held_incentive := abs(COALESCE(v_hold.incentive_delta, 0));
  v_held_paid      := abs(COALESCE(v_hold.paid_delta, 0));

  v_consume_free      := LEAST(v_actual_free,      v_held_free);
  v_consume_incentive := LEAST(v_actual_incentive, v_held_incentive);
  v_consume_paid      := LEAST(v_actual_paid,      v_held_paid);

  v_release_free      := v_held_free      - v_consume_free;
  v_release_incentive := v_held_incentive - v_consume_incentive;
  v_release_paid      := v_held_paid      - v_consume_paid;

  v_excess_total := GREATEST(v_actual_free      - v_held_free,      0)
                  + GREATEST(v_actual_incentive - v_held_incentive, 0)
                  + GREATEST(v_actual_paid      - v_held_paid,      0);

  SELECT * INTO v_wallet FROM public.organization_credits WHERE organization_id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_credit_account: org %', p_org_id;
  END IF;

  -- (1) consume from reserved + (2) release the unused hold back to the balance.
  UPDATE public.organization_credits SET
    reserved_free      = GREATEST(0, reserved_free      - v_consume_free      - v_release_free),
    reserved_incentive = GREATEST(0, reserved_incentive - v_consume_incentive - v_release_incentive),
    reserved_paid      = GREATEST(0, reserved_paid      - v_consume_paid      - v_release_paid),
    free_balance       = free_balance      + v_release_free,
    incentive_balance  = incentive_balance + v_release_incentive,
    paid_balance       = paid_balance      + v_release_paid,
    lifetime_consumed  = lifetime_consumed + v_consume_free + v_consume_incentive + v_consume_paid,
    updated_at         = NOW()
  WHERE organization_id = p_org_id
  RETURNING * INTO v_wallet;

  v_released_total := v_release_free + v_release_incentive + v_release_paid;

  -- The released remainder: its OWN ledger row (owner ruling: audit truth).
  IF v_released_total > 0 THEN
    INSERT INTO public.credit_transactions (
      organization_id, transaction_type, credits_delta, balance_after,
      reference_type, reference_id, note, performed_by, idempotency_key,
      execution_phase, parent_transaction_id, category,
      free_delta, paid_delta, incentive_delta, created_at
    ) VALUES (
      p_org_id, 'refund', v_released_total,
      v_wallet.free_balance + v_wallet.paid_balance + v_wallet.incentive_balance,
      p_reference_type, p_reference_id::uuid,
      COALESCE(p_note, 'confirm_partial') || ' [remainder released]',
      p_performed_by, v_remainder_key,
      'release', p_hold_txn_id, v_hold.category,
      v_release_free, v_release_paid, v_release_incentive, NOW()
    )
    RETURNING * INTO v_release_row;
  END IF;

  -- (3) the excess over the hold draws ACROSS categories: free -> incentive -> paid.
  v_left := v_excess_total;
  v_extra_free      := LEAST(v_left, GREATEST(v_wallet.free_balance, 0));      v_left := v_left - v_extra_free;
  v_extra_incentive := LEAST(v_left, GREATEST(v_wallet.incentive_balance, 0)); v_left := v_left - v_extra_incentive;
  v_extra_paid      := LEAST(v_left, GREATEST(v_wallet.paid_balance, 0));      v_left := v_left - v_extra_paid;
  v_shortfall := v_left;

  IF (v_extra_free + v_extra_incentive + v_extra_paid) > 0 THEN
    UPDATE public.organization_credits SET
      free_balance      = free_balance      - v_extra_free,
      incentive_balance = incentive_balance - v_extra_incentive,
      paid_balance      = paid_balance      - v_extra_paid,
      lifetime_consumed = lifetime_consumed + v_extra_free + v_extra_incentive + v_extra_paid,
      updated_at        = NOW()
    WHERE organization_id = p_org_id;
  END IF;

  v_is_underfunded := v_shortfall > 0;
  v_consumed_total := v_consume_free + v_consume_incentive + v_consume_paid
                    + v_extra_free   + v_extra_incentive   + v_extra_paid;

  INSERT INTO public.credit_transactions (
    organization_id, transaction_type, credits_delta, balance_after,
    reference_type, reference_id, note, performed_by, idempotency_key,
    execution_phase, parent_transaction_id, category,
    free_delta, paid_delta, incentive_delta, is_underfunded, created_at
  ) VALUES (
    p_org_id, 'deduction', -v_consumed_total,
    (v_wallet.free_balance + v_wallet.paid_balance + v_wallet.incentive_balance)
      - v_extra_free - v_extra_incentive - v_extra_paid,
    p_reference_type, p_reference_id::uuid,
    COALESCE(p_note, 'confirm_partial') ||
      CASE WHEN v_is_underfunded THEN ' [UNDERFUNDED shortfall_total=' || v_shortfall || ']' ELSE '' END,
    p_performed_by, p_idempotency_key,
    'confirm_partial', p_hold_txn_id, 'paid',
    -(v_consume_free      + v_extra_free),
    -(v_consume_paid      + v_extra_paid),
    -(v_consume_incentive + v_extra_incentive),
    v_is_underfunded, NOW()
  )
  RETURNING * INTO v_tx_row;

  RETURN jsonb_build_object(
    'id',                 v_tx_row.id,
    'release_txn_id',     v_release_row.id,
    'consumed_free',      v_consume_free      + v_extra_free,
    'consumed_incentive', v_consume_incentive + v_extra_incentive,
    'consumed_paid',      v_consume_paid      + v_extra_paid,
    'released_free',      v_release_free,
    'released_incentive', v_release_incentive,
    'released_paid',      v_release_paid,
    'shortfall_total',    v_shortfall,
    'is_underfunded',     v_is_underfunded,
    'total_consumed',     v_consumed_total,
    'total_released',     v_released_total
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.apply_credit_reservation_guarded(uuid,text,integer,integer,integer,text,text,text,text,uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_credit_reservation_guarded(uuid,text,integer,integer,integer,text,text,text,text,uuid,uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.apply_credit_partial_confirm_guarded(uuid,uuid,integer,integer,integer,text,text,text,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_credit_partial_confirm_guarded(uuid,uuid,integer,integer,integer,text,text,text,text,uuid) TO service_role;

DO $verify$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.prosecdef, p.proconfig, md5(p.prosrc) AS m,
           CASE WHEN p.proname = 'apply_credit_reservation_guarded' THEN ARRAY['d48341eac02fe4482c132ed0c5215a41', 'ceb593fd52a7438aea55ed0d939b6ac2']
                ELSE ARRAY['cce149fbd1c7a1ffa41b59e9cf59ffe6', '764384d45f4ef841117ffb46d537d4c3'] END AS expect
      FROM pg_proc p
     WHERE p.oid IN (to_regprocedure('public.apply_credit_reservation_guarded(uuid,text,integer,integer,integer,text,text,text,text,uuid,uuid,text)'),
                     to_regprocedure('public.apply_credit_partial_confirm_guarded(uuid,uuid,integer,integer,integer,text,text,text,text,uuid)'))
  LOOP
    IF r.prosecdef THEN
      RAISE EXCEPTION 'credit_guarded verify: % is SECURITY DEFINER (must be INVOKER)', r.sig;
    END IF;
    IF r.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public'] THEN
      RAISE EXCEPTION 'credit_guarded verify: % proconfig is % (expected {search_path=pg_catalog, public})', r.sig, r.proconfig;
    END IF;
    IF NOT (r.m = ANY (r.expect)) THEN
      RAISE EXCEPTION 'credit_guarded verify: % body md5 % is not this migration''s', r.sig, r.m;
    END IF;
    IF has_function_privilege('anon', r.sig, 'EXECUTE') OR has_function_privilege('authenticated', r.sig, 'EXECUTE')
       OR has_function_privilege('public', r.sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'credit_guarded verify: a client role can EXECUTE %', r.sig;
    END IF;
    IF NOT has_function_privilege('service_role', r.sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'credit_guarded verify: service_role cannot EXECUTE %', r.sig;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc
       WHERE oid IN (to_regprocedure('public.apply_credit_reservation_guarded(uuid,text,integer,integer,integer,text,text,text,text,uuid,uuid,text)'),
                     to_regprocedure('public.apply_credit_partial_confirm_guarded(uuid,uuid,integer,integer,integer,text,text,text,text,uuid)'))) <> 2 THEN
    RAISE EXCEPTION 'credit_guarded verify: expected both guarded functions to exist';
  END IF;
END
$verify$;
