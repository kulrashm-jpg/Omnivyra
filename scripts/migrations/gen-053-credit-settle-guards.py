#!/usr/bin/env python3
"""
Generator for supabase/migrations/20270217000053_credit_settle_guards_reauthor.sql (e1, 2026-11-14).

WHY A GENERATOR: 053 must be authored on the LIVE prod bodies (C100 extraction, committed under
backend/tests/fixtures/live-credit-functions-20261113, md5 = prod md5(prosrc)) so nothing that runs in prod today is
lost. Every guard is applied as an ANCHORED edit to the live text - each anchor must occur exactly once or generation
aborts - so the diff between prod and 053 is exactly the guards, reviewable hunk by hunk. The migration's postcondition
pins md5(prosrc) of the bodies this script emits.

Run from the repo root:  python scripts/migrations/gen-053-credit-settle-guards.py
It rewrites the migration and its rollback; commit both with this script.
"""
import hashlib
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
FIX = ROOT / 'backend/tests/fixtures/live-credit-functions-20261113'
OUT = ROOT / 'supabase/migrations/20270217000053_credit_settle_guards_reauthor.sql'
RB = ROOT / 'supabase/migrations/rollbacks/credit_settle_guards_reauthor_rollback.sql'

LIVE_RES = (FIX / 'LIVE-apply_credit_reservation.prosrc.sql').read_text(encoding='utf-8')
LIVE_PC = (FIX / 'LIVE-apply_credit_partial_confirm.prosrc.sql').read_text(encoding='utf-8')
LIVE_EXP = (FIX / 'LIVE-expire_org_free_credits.prosrc.sql').read_text(encoding='utf-8')
MD5 = lambda s: hashlib.md5(s.encode('utf-8')).hexdigest()
assert MD5(LIVE_RES) == 'ad5383bf6ccf24a2c8ddee70db3b1297', 'fixture is not the prod apply_credit_reservation body'
assert MD5(LIVE_PC) == 'ff208f60617a7a272305a804037bf47d', 'fixture is not the prod apply_credit_partial_confirm body'
assert MD5(LIVE_EXP) == 'ae410c7ab297eebe2890a7f925d95f04', 'fixture is not the prod expire_org_free_credits body'

# The unique constraints/indexes that ARE the idempotency key on credit_transactions (C100). A unique_violation on any
# other constraint is a real error and is re-raised; a key collision with no row behind it is raised too, never {id:null}.
KEY_CONSTRAINTS = "'credit_transactions_idempotency_key_key', 'credit_transactions_idempotency_key_lockdown_unique', 'idx_credit_txn_idempotency'"


def edit(text, anchor, replacement, label):
    n = text.count(anchor)
    if n != 1:
        raise SystemExit(f'anchor for "{label}" occurs {n} times (expected exactly 1)')
    return text.replace(anchor, replacement)


HANDLER_OLD = """EXCEPTION
  WHEN unique_violation THEN
    SELECT * INTO v_tx_row
      FROM credit_transactions
     WHERE idempotency_key = p_idempotency_key
     LIMIT 1;
    RETURN row_to_json(v_tx_row)::jsonb;
END;"""
HANDLER_NEW = f"""EXCEPTION
  WHEN unique_violation THEN
    -- 053: only a collision on the IDEMPOTENCY KEY is a replay; any other unique rule is a real error. A key
    -- collision with no row behind it is raised too - never a success-shaped {{id:null}}.
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint IS NULL OR v_constraint NOT IN ({KEY_CONSTRAINTS}) THEN
      RAISE;
    END IF;
    SELECT * INTO v_tx_row
      FROM credit_transactions
     WHERE idempotency_key = p_idempotency_key
     LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'CREDIT_IDEMPOTENCY_COLLISION_WITHOUT_ROW: %', p_idempotency_key USING ERRCODE = 'P0001';
    END IF;
    RETURN row_to_json(v_tx_row)::jsonb;
END;"""

# ── apply_credit_reservation ─────────────────────────────────────────────────────────────────────────────────────
res = LIVE_RES
res = edit(res, """  v_paid_delta      int := 0;
BEGIN""", """  v_paid_delta      int := 0;
  v_hold            credit_transactions%ROWTYPE;
  v_settled_id      uuid;
  v_constraint      text;
BEGIN
  -- ── 053 guard: amounts and key (20260625 intent; refusals, never silent clamps) ─────────────────────────────
  IF p_free_amount IS NULL OR p_incentive_amount IS NULL OR p_paid_amount IS NULL THEN
    RAISE EXCEPTION 'CREDIT_AMOUNT_NULL: phase=%', p_phase USING ERRCODE = 'P0001';
  END IF;
  IF p_free_amount < 0 OR p_incentive_amount < 0 OR p_paid_amount < 0 THEN
    RAISE EXCEPTION 'CREDIT_AMOUNT_NEGATIVE: phase=% free=% incentive=% paid=%',
      p_phase, p_free_amount, p_incentive_amount, p_paid_amount USING ERRCODE = 'P0001';
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'CREDIT_IDEMPOTENCY_KEY_REQUIRED: phase=%', p_phase USING ERRCODE = 'P0001';
  END IF;
""", 'reservation: declare + amount/key guards')

res = edit(res, """  -- ── Phase dispatch ──────────────────────────────────────────────────────────""",
"""  -- ── 053 guard: settle integrity (runs AFTER the wallet lock, which serialises every credit write of this org) ──
  IF p_phase IN ('confirm', 'release') THEN
    IF p_parent_id IS NULL THEN
      RAISE EXCEPTION 'SETTLE_REQUIRES_PARENT_HOLD: phase=%', p_phase USING ERRCODE = 'P0001';
    END IF;
    SELECT * INTO v_hold FROM credit_transactions WHERE id = p_parent_id;
    IF NOT FOUND OR v_hold.organization_id IS DISTINCT FROM p_org_id OR v_hold.execution_phase IS DISTINCT FROM 'hold' THEN
      RAISE EXCEPTION 'SETTLE_PARENT_NOT_A_HOLD: parent=% org=%', p_parent_id, p_org_id USING ERRCODE = 'P0001';
    END IF;
    SELECT id INTO v_settled_id FROM credit_transactions
     WHERE parent_transaction_id = p_parent_id AND execution_phase IN ('confirm', 'confirm_partial', 'release')
     LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'HOLD_ALREADY_SETTLED: hold=% by transaction %', p_parent_id, v_settled_id USING ERRCODE = 'P0001';
    END IF;
    IF p_free_amount      > ABS(COALESCE(v_hold.free_delta, 0))
       OR p_incentive_amount > ABS(COALESCE(v_hold.incentive_delta, 0))
       OR p_paid_amount      > ABS(COALESCE(v_hold.paid_delta, 0)) THEN
      RAISE EXCEPTION 'SETTLE_EXCEEDS_HOLD: hold=%', p_parent_id USING ERRCODE = 'P0001';
    END IF;
    IF p_free_amount      > v_wallet.reserved_free
       OR p_incentive_amount > v_wallet.reserved_incentive
       OR p_paid_amount      > v_wallet.reserved_paid THEN
      RAISE EXCEPTION 'SETTLE_EXCEEDS_RESERVED: hold=%', p_parent_id USING ERRCODE = 'P0001';
    END IF;
  ELSIF p_parent_id IS NOT NULL THEN
    RAISE EXCEPTION 'PARENT_ONLY_FOR_SETTLE: phase=%', p_phase USING ERRCODE = 'P0001';
  END IF;

  -- ── Phase dispatch ──────────────────────────────────────────────────────────""", 'reservation: settle guards')

res = edit(res, """    v_avail_free      := GREATEST(0, v_wallet.free_balance      - v_wallet.reserved_free);
    v_avail_incentive := GREATEST(0, v_wallet.incentive_balance - v_wallet.reserved_incentive);
    v_avail_paid      := GREATEST(0, v_wallet.paid_balance      - v_wallet.reserved_paid);""",
"""    -- 053: a HOLD moves credits OUT of *_balance INTO reserved_* (see the UPDATE below), so *_balance already excludes
    -- every open hold. The live body subtracted reserved_* AGAIN, counting each open hold twice and refusing customers
    -- who had spendable credits. Availability is the balance itself (same definition as creditPriorityService).
    v_avail_free      := GREATEST(0, v_wallet.free_balance);
    v_avail_incentive := GREATEST(0, v_wallet.incentive_balance);
    v_avail_paid      := GREATEST(0, v_wallet.paid_balance);""", 'reservation: availability double-subtract')

res = edit(res, HANDLER_OLD, HANDLER_NEW, 'reservation: unique_violation handler')

# ── apply_credit_partial_confirm ─────────────────────────────────────────────────────────────────────────────────
pc = LIVE_PC
pc = edit(pc, """  v_released_total  int;
BEGIN""", """  v_released_total  int;
  v_settled_id      uuid;
  v_constraint      text;
BEGIN
  -- ── 053 guard: amounts and key ─────────────────────────────────────────────────────────────────────────────
  IF p_actual_free IS NULL OR p_actual_incentive IS NULL OR p_actual_paid IS NULL THEN
    RAISE EXCEPTION 'CREDIT_AMOUNT_NULL: partial confirm of hold %', p_hold_txn_id USING ERRCODE = 'P0001';
  END IF;
  IF p_actual_free < 0 OR p_actual_incentive < 0 OR p_actual_paid < 0 THEN
    RAISE EXCEPTION 'CREDIT_AMOUNT_NEGATIVE: partial confirm of hold %', p_hold_txn_id USING ERRCODE = 'P0001';
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'CREDIT_IDEMPOTENCY_KEY_REQUIRED: partial confirm of hold %', p_hold_txn_id USING ERRCODE = 'P0001';
  END IF;
""", 'partial: declare + amount/key guards')

pc = edit(pc, """  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_credit_account: org %', p_org_id;
  END IF;
""", """  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_credit_account: org %', p_org_id;
  END IF;

  -- ── 053 guard: a hold settles ONCE (after the wallet lock, which serialises every credit write of this org) ──
  SELECT id INTO v_settled_id FROM credit_transactions
   WHERE parent_transaction_id = p_hold_txn_id AND execution_phase IN ('confirm', 'confirm_partial', 'release')
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'HOLD_ALREADY_SETTLED: hold=% by transaction %', p_hold_txn_id, v_settled_id USING ERRCODE = 'P0001';
  END IF;
""", 'partial: already-settled guard')

pc = edit(pc, HANDLER_OLD, HANDLER_NEW, 'partial: unique_violation handler')

RES_SIG = """public.apply_credit_reservation(
  p_org_id           uuid,
  p_phase            text,
  p_free_amount      int  DEFAULT 0,
  p_incentive_amount int  DEFAULT 0,
  p_paid_amount      int  DEFAULT 0,
  p_idempotency_key  text DEFAULT NULL,
  p_reference_type   text DEFAULT NULL,
  p_reference_id     text DEFAULT NULL,
  p_note             text DEFAULT NULL,
  p_performed_by     uuid DEFAULT NULL,
  p_parent_id        uuid DEFAULT NULL,
  p_category         text DEFAULT 'paid'
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public"""
PC_SIG = """public.apply_credit_partial_confirm(
  p_org_id uuid,
  p_hold_txn_id uuid,
  p_actual_free int DEFAULT 0,
  p_actual_incentive int DEFAULT 0,
  p_actual_paid int DEFAULT 0,
  p_idempotency_key text DEFAULT NULL,
  p_reference_type text DEFAULT NULL,
  p_reference_id text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_performed_by uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, extensions"""
EXP_SIG = """public.expire_org_free_credits(
  p_org_id uuid,
  p_amount int,
  p_note   text DEFAULT 'free credit expiry'
) RETURNS int
LANGUAGE plpgsql
SET search_path = pg_catalog, public"""
RES_REG = 'public.apply_credit_reservation(uuid,text,integer,integer,integer,text,text,text,text,uuid,uuid,text)'
PC_REG = 'public.apply_credit_partial_confirm(uuid,uuid,integer,integer,integer,text,text,text,text,uuid)'
EXP_REG = 'public.expire_org_free_credits(uuid,integer,text)'

for body in (res, pc):
    assert '$fn$' not in body

HEADER = f"""-- 20270217000053 - credit settle guards, RE-AUTHORED ON THE LIVE BODIES (e1; e9-ruled BLOCKING for the enforcement flip
-- and the pricing release; version reserved by virality-83; review: virality-05). GENERATED by
-- scripts/migrations/gen-053-credit-settle-guards.py from backend/tests/fixtures/live-credit-functions-20261113 (the C100
-- extraction, md5 = prod md5(prosrc)). Do not hand-edit the function bodies: change the generator and re-run it.
--
-- WHAT IS LIVE (C98/C99/C100, 2026-11-13):
--   apply_credit_reservation     = 20260322_expiry_category_guard (md5 ad5383bf6ccf24a2c8ddee70db3b1297)
--   apply_credit_partial_confirm = a hand-applied body matching NO repo file (md5 ff208f60617a7a272305a804037bf47d)
--   expire_org_free_credits      = 20260323_remove_balance_credits (md5 ae410c7ab297eebe2890a7f925d95f04)
--
-- NOT A REPLAY (05). THREE divergent replacements of apply_credit_reservation exist in the repo, NONE live:
--   20260322_wallet_reservation (never ran - a version collision), 20260323_remove_balance_credits (has a ledger row,
--   its body is not live), 20260625_monetization_invariant_hardening (never ran). 053 does not re-run any of them: it
--   reconciles their INTENT - chiefly 20260625's settle guards - against the live bodies, carrying over only guards.
--
-- GUARDS ADDED (each a money defect on the live body; 05/e9 review 2026-11-13):
--   both functions:
--     - NULL or negative amounts refused (a negative HOLD raised the balance);
--     - the idempotency key is REQUIRED (a keyless retry applied twice);
--     - a hold settles ONCE: a confirm / confirm_partial / release child already present -> HOLD_ALREADY_SETTLED
--       (release-after-confirm refunded consumed credits; double release refunded twice). The check runs after the
--       org's wallet row lock, which both functions take first, so it is race-free per org;
--     - unique_violation: only a collision on the idempotency KEY ({KEY_CONSTRAINTS})
--       is a replay; anything else re-raises; a key collision with no row raises (no success-shaped {{id:null}}).
--   apply_credit_reservation only:
--     - confirm/release REQUIRE p_parent_id naming this org's 'hold' row; other phases refuse a parent;
--     - a settle may not exceed the hold's own split nor the wallet's reserved_* (the live GREATEST(0, ...) clamp hid it);
--     - HOLD AVAILABILITY no longer subtracts reserved_* a second time (e9 BLOCKING-launch: every open hold was counted
--       twice, refusing customers with spendable credits). Paired TS change: creditPriorityService.computeAvailable.
-- KEPT AS LIVE (losing nothing): every phase's wallet arithmetic, the expire / expire_incentive clamp semantics, the
-- partial-confirm consume/release/excess/underfunded logic, both search_paths, invoker rights, service_role-only EXECUTE.
-- DROPPED: expire_org_free_credits (20260625 intended it; no caller in code, SQL bodies, triggers or pg_cron - the
-- preflight ABORTS if any reference exists, so the drop never strands a caller).
-- SPLIT OUT (e9 allowed): the expiry leak on RELEASE (held free credits escaping their grant's expiry) needs per-grant
-- lot tracking - a follow-up version, not 053.
--
-- PRE-REQUISITE AT APPLY: the preflight accepts exactly the known bodies (prod md5, or the 20260625 repo body a CI
-- replay produces) and refuses anything else - an unknown body means prod moved and 053 must be re-generated.
"""

PREFLIGHT = f"""
DO $preflight$
DECLARE
  v_res text;
  v_pc  text;
  v_refs int;
BEGIN
  SELECT prosrc INTO v_res FROM pg_proc WHERE oid = to_regprocedure('{RES_REG}');
  SELECT prosrc INTO v_pc  FROM pg_proc WHERE oid = to_regprocedure('{PC_REG}');
  IF v_res IS NULL OR v_pc IS NULL THEN
    RAISE EXCEPTION '053 preflight: apply_credit_reservation / apply_credit_partial_confirm (exact signatures) missing';
  END IF;
  IF NOT (md5(v_res) = 'ad5383bf6ccf24a2c8ddee70db3b1297' OR position('already settled by' IN v_res) > 0
          OR md5(v_res) = '{MD5(res)}') THEN
    RAISE EXCEPTION '053 preflight: apply_credit_reservation body is unknown (md5 %) - prod moved; re-generate 053', md5(v_res);
  END IF;
  IF NOT (md5(v_pc) = 'ff208f60617a7a272305a804037bf47d' OR position('already settled by' IN v_pc) > 0
          OR md5(v_pc) = '{MD5(pc)}') THEN
    RAISE EXCEPTION '053 preflight: apply_credit_partial_confirm body is unknown (md5 %) - prod moved; re-generate 053', md5(v_pc);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'credit_transactions'
                  AND column_name = 'parent_transaction_id') THEN
    RAISE EXCEPTION '053 preflight: credit_transactions.parent_transaction_id is missing';
  END IF;
  -- expire_org_free_credits may be dropped only if NOTHING references it.
  IF to_regprocedure('{EXP_REG}') IS NOT NULL THEN
    SELECT count(*) INTO v_refs FROM pg_proc
     WHERE prosrc ILIKE '%expire_org_free_credits%' AND oid <> to_regprocedure('{EXP_REG}');
    IF v_refs > 0 THEN
      RAISE EXCEPTION '053 preflight: % function body(ies) reference expire_org_free_credits - it cannot be dropped', v_refs;
    END IF;
    IF to_regclass('cron.job') IS NOT NULL THEN
      EXECUTE 'SELECT count(*) FROM cron.job WHERE command ILIKE ''%expire_org_free_credits%''' INTO v_refs;
      IF v_refs > 0 THEN
        RAISE EXCEPTION '053 preflight: % pg_cron job(s) call expire_org_free_credits - it cannot be dropped', v_refs;
      END IF;
    END IF;
  END IF;
END
$preflight$;
"""

POST = f"""
DO $verify$
DECLARE
  r text;
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('{RES_REG}')) IS DISTINCT FROM '{MD5(res)}' THEN
    RAISE EXCEPTION '053 postcondition: apply_credit_reservation body is not the generated one';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('{PC_REG}')) IS DISTINCT FROM '{MD5(pc)}' THEN
    RAISE EXCEPTION '053 postcondition: apply_credit_partial_confirm body is not the generated one';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('{RES_REG}'))
     OR (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('{PC_REG}')) THEN
    RAISE EXCEPTION '053 postcondition: a credit function became SECURITY DEFINER (live: invoker rights)';
  END IF;
  IF NOT (SELECT proconfig @> ARRAY['search_path=pg_catalog, public'] FROM pg_proc WHERE oid = to_regprocedure('{RES_REG}'))
     OR NOT (SELECT proconfig @> ARRAY['search_path=public, extensions'] FROM pg_proc WHERE oid = to_regprocedure('{PC_REG}')) THEN
    RAISE EXCEPTION '053 postcondition: a credit function lost its live search_path';
  END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_function_privilege(r, '{RES_REG}', 'EXECUTE') OR has_function_privilege(r, '{PC_REG}', 'EXECUTE') THEN
      RAISE EXCEPTION '053 postcondition: % can execute a credit settle function', r;
    END IF;
  END LOOP;
  IF to_regprocedure('{EXP_REG}') IS NOT NULL THEN
    RAISE EXCEPTION '053 postcondition: expire_org_free_credits still exists';
  END IF;
END
$verify$;
"""

mig = (HEADER + PREFLIGHT
       + f"\nCREATE OR REPLACE FUNCTION {RES_SIG}\nAS $fn${res}$fn$;\n"
       + f"REVOKE ALL ON FUNCTION {RES_REG} FROM PUBLIC, anon, authenticated;\nGRANT EXECUTE ON FUNCTION {RES_REG} TO service_role;\n"
       + f"\nCREATE OR REPLACE FUNCTION {PC_SIG}\nAS $fn${pc}$fn$;\n"
       + f"REVOKE ALL ON FUNCTION {PC_REG} FROM PUBLIC, anon, authenticated;\nGRANT EXECUTE ON FUNCTION {PC_REG} TO service_role;\n"
       + f"\nDROP FUNCTION IF EXISTS {EXP_REG};\n"
       + POST
       + "\n-- ROLLBACK: supabase/migrations/rollbacks/credit_settle_guards_reauthor_rollback.sql (restores the three LIVE bodies byte-for-byte)\n")

rb = (f"""-- Rollback of 20270217000053_credit_settle_guards_reauthor.sql (e1). GENERATED by
-- scripts/migrations/gen-053-credit-settle-guards.py: restores the three LIVE bodies byte-for-byte from the C100 fixtures
-- (md5 asserted below), with their live search_path, invoker rights and service_role-only EXECUTE.
CREATE OR REPLACE FUNCTION {RES_SIG}
AS $fn${LIVE_RES}$fn$;
REVOKE ALL ON FUNCTION {RES_REG} FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION {RES_REG} TO service_role;

CREATE OR REPLACE FUNCTION {PC_SIG}
AS $fn${LIVE_PC}$fn$;
REVOKE ALL ON FUNCTION {PC_REG} FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION {PC_REG} TO service_role;

CREATE OR REPLACE FUNCTION {EXP_SIG}
AS $fn${LIVE_EXP}$fn$;
REVOKE ALL ON FUNCTION {EXP_REG} FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION {EXP_REG} TO service_role;

DO $verify$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('{RES_REG}')) <> 'ad5383bf6ccf24a2c8ddee70db3b1297'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('{PC_REG}')) <> 'ff208f60617a7a272305a804037bf47d'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('{EXP_REG}')) <> 'ae410c7ab297eebe2890a7f925d95f04' THEN
    RAISE EXCEPTION '053 rollback: a restored body is not the live one';
  END IF;
END
$verify$;
""")

OUT.write_text(mig, encoding='utf-8', newline='\n')
RB.write_text(rb, encoding='utf-8', newline='\n')
print('apply_credit_reservation md5 ', MD5(res))
print('apply_credit_partial_confirm md5', MD5(pc))
print('wrote', OUT.relative_to(ROOT), 'and', RB.relative_to(ROOT))
