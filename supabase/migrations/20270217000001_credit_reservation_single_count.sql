-- 20270217000001_credit_reservation_single_count
--
-- MONEY (e9 ruling 2026-11-12, option B). apply_credit_reservation counts an
-- open HOLD twice: the hold phase moves credits out of the balance AND into
-- reserved (free_balance -= n; reserved_free += n), yet the availability check
-- is balance - reserved. A second concurrent hold is refused, the displayed
-- balance is low and admission is refused; no overcharge. The balance column
-- ALREADY excludes held credits, so the available amount is the balance.
--
-- SCOPE: formulas only. NO balance rebuild or backfill. Only the hold-phase
-- availability expressions change; every other line of the live body is kept
-- byte for byte.
--
-- WHICH BODY: prod's live body is NOT the repo's latest definition (83/C17:
-- md5(prosrc) ad5383bf6ccf24a2c8ddee70db3b1297 is the pre-20260625 body; the
-- 20260625_monetization_invariant_hardening guards are NOT live in prod - a
-- separate pre-launch unit). Environments that replay every migration carry the
-- 20260625 body (md5 c62d8dde5e3ad20a22ad6fd8ccc77154). This migration patches
-- WHICHEVER of those two is live, refuses any other body (unknown md5 = RAISE,
-- nothing changed), and verifies the result's md5.
--
-- LINE ENDINGS (83/C20, 05): prod bodies were applied from Windows checkouts
-- and may be stored CRLF; CI replays LF. md5(prosrc) is line-ending-sensitive,
-- so EACH known body is accepted in BOTH forms and maps to its OWN expected
-- patched md5 (the patch preserves the body's line endings - replace() runs on
-- the live prosrc and it is re-EXECUTEd verbatim):
--   prod pre-20260625:  LF ad5383bf -> 03d616e6 ; CRLF 1db00c4d -> 90bcbfb5
--   20260625 as written: LF c62d8dde -> 7799ec27 ; CRLF 6e9ef990 -> 7ee214ad
-- PROD MEASURED (83, C17 + C20 re-measure, 2026-11-12): md5(prosrc) = ad5383bf
-- from the live catalog, saved with 0 CR -> prod is LF, so prod takes the
-- ad5383bf -> 03d616e6 branch. The other three branches are for other
-- environments: a full-history replay (CI, fresh sandbox) applies 20260625
-- first and lands on 7799ec27 / 7ee214ad. The live md5 therefore differs BY
-- ENVIRONMENT until the guarded function supersedes both (05).
-- (83's saved C17 pre-image is the LF form - 0 CR bytes.) The CRLF constants are
-- COMPUTED (LF text with \n -> \r\n), not measured: they assume a Windows
-- checkout applied the body unchanged; if not, the md5 misses and the migration
-- RAISES (fail closed). Line endings are PER FUNCTION, not per database (05).
-- Every needle below is
-- a SINGLE-LINE fragment, so CRLF cannot break a match or a count; a future
-- multi-line needle must normalise first or match \r?\n.
-- Signature, argument list (names + defaults), SECURITY INVOKER, search_path
-- and grants are taken from / re-asserted on the live function.
-- DEPLOY ORDER (05): either order is fail-closed. DB-first (preferred, quiet):
-- the DB then permits MORE than the app offers (the app's old double-subtract
-- refuses operations the DB would allow). App-first: the app offers more than
-- the old DB allows and the DB raises 'insufficient ...' - safe but visible.
-- Rollback: rollbacks/credit_reservation_single_count_rollback.sql
-- restores the VERBATIM pre-image (never an inverse replace).
-- GOV-SECURITY: virality-83; review: virality-05.

DO $migration$
DECLARE
  v_oid        oid;
  v_src        text;
  v_md5        text;
  v_args       text;
  v_new        text;
  v_expect     text;
  v_definer    boolean;
BEGIN
  SELECT p.oid, p.prosrc, md5(p.prosrc), pg_get_function_arguments(p.oid), p.prosecdef
    INTO v_oid, v_src, v_md5, v_args, v_definer
    FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.apply_credit_reservation(uuid,text,integer,integer,integer,text,text,text,text,uuid,uuid,text)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'single_count: public.apply_credit_reservation with the expected signature not found - nothing changed';
  END IF;
  IF v_definer THEN
    RAISE EXCEPTION 'single_count: apply_credit_reservation is SECURITY DEFINER (expected INVOKER) - refusing, nothing changed';
  END IF;

  IF v_md5 IN ('ad5383bf6ccf24a2c8ddee70db3b1297', '1db00c4d06a4a16c84ed419c4cc47bf6') THEN
    -- prod body (pre-20260625): three GREATEST(0, balance - reserved) lines.
    IF (length(v_src) - length(replace(v_src, 'GREATEST(0, v_wallet.free_balance      - v_wallet.reserved_free)', ''))) / length('GREATEST(0, v_wallet.free_balance      - v_wallet.reserved_free)') <> 1
       OR (length(v_src) - length(replace(v_src, 'GREATEST(0, v_wallet.incentive_balance - v_wallet.reserved_incentive)', ''))) / length('GREATEST(0, v_wallet.incentive_balance - v_wallet.reserved_incentive)') <> 1
       OR (length(v_src) - length(replace(v_src, 'GREATEST(0, v_wallet.paid_balance      - v_wallet.reserved_paid)', ''))) / length('GREATEST(0, v_wallet.paid_balance      - v_wallet.reserved_paid)') <> 1 THEN
      RAISE EXCEPTION 'single_count: prod body does not contain each availability expression exactly once - nothing changed';
    END IF;
    v_new := replace(v_src, 'GREATEST(0, v_wallet.free_balance      - v_wallet.reserved_free)', 'GREATEST(0, v_wallet.free_balance)');
    v_new := replace(v_new, 'GREATEST(0, v_wallet.incentive_balance - v_wallet.reserved_incentive)', 'GREATEST(0, v_wallet.incentive_balance)');
    v_new := replace(v_new, 'GREATEST(0, v_wallet.paid_balance      - v_wallet.reserved_paid)', 'GREATEST(0, v_wallet.paid_balance)');
    v_expect := CASE v_md5 WHEN 'ad5383bf6ccf24a2c8ddee70db3b1297' THEN '03d616e692cdfb9fefc25eb81e8e4595' ELSE '90bcbfb5e9eb2eedf1a0b7a8266554bf' END;
  ELSIF v_md5 IN ('c62d8dde5e3ad20a22ad6fd8ccc77154', '6e9ef99095e506a3c70fb2dde9686de9') THEN
    -- 20260625 body: (balance - reserved) appears twice per category, both in
    -- the hold branch (the check and its error message).
    IF (length(v_src) - length(replace(v_src, '(v_wallet.free_balance - v_wallet.reserved_free)', ''))) / length('(v_wallet.free_balance - v_wallet.reserved_free)') <> 2
       OR (length(v_src) - length(replace(v_src, '(v_wallet.incentive_balance - v_wallet.reserved_incentive)', ''))) / length('(v_wallet.incentive_balance - v_wallet.reserved_incentive)') <> 2
       OR (length(v_src) - length(replace(v_src, '(v_wallet.paid_balance - v_wallet.reserved_paid)', ''))) / length('(v_wallet.paid_balance - v_wallet.reserved_paid)') <> 2 THEN
      RAISE EXCEPTION 'single_count: 20260625 body does not contain each availability expression exactly twice - nothing changed';
    END IF;
    v_new := replace(v_src, '(v_wallet.free_balance - v_wallet.reserved_free)', 'v_wallet.free_balance');
    v_new := replace(v_new, '(v_wallet.incentive_balance - v_wallet.reserved_incentive)', 'v_wallet.incentive_balance');
    v_new := replace(v_new, '(v_wallet.paid_balance - v_wallet.reserved_paid)', 'v_wallet.paid_balance');
    v_expect := CASE v_md5 WHEN 'c62d8dde5e3ad20a22ad6fd8ccc77154' THEN '7799ec2755c49c952bacd529916acc9c' ELSE '7ee214ad28938b36d57f63eb68a9b9cd' END;
  ELSIF v_md5 IN ('03d616e692cdfb9fefc25eb81e8e4595', '90bcbfb5e9eb2eedf1a0b7a8266554bf',
                  '7799ec2755c49c952bacd529916acc9c', '7ee214ad28938b36d57f63eb68a9b9cd') THEN
    RAISE NOTICE 'single_count: already applied (md5 %) - no change', v_md5;
    RETURN;
  ELSE
    RAISE EXCEPTION 'single_count: UNKNOWN apply_credit_reservation body (md5 %) - refusing; nothing changed', v_md5;
  END IF;

  IF md5(v_new) <> v_expect THEN
    RAISE EXCEPTION 'single_count: patched body md5 % <> expected % - nothing changed', md5(v_new), v_expect;
  END IF;

  EXECUTE format(
    'CREATE OR REPLACE FUNCTION public.apply_credit_reservation(%s) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS %L',
    v_args, v_new);

  -- Postcondition: the live body is exactly the expected one.
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.oid = v_oid;
  IF v_md5 IS DISTINCT FROM v_expect THEN
    RAISE EXCEPTION 'single_count: postcondition failed - live md5 % <> expected %', v_md5, v_expect;
  END IF;
END
$migration$;

-- Re-assert search_path and grants (CREATE OR REPLACE keeps the ACL; this makes
-- the intended state explicit and verifiable).
ALTER FUNCTION public.apply_credit_reservation(uuid,text,integer,integer,integer,text,text,text,text,uuid,uuid,text) SET search_path = pg_catalog, public;
REVOKE ALL ON FUNCTION public.apply_credit_reservation(uuid,text,integer,integer,integer,text,text,text,text,uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_credit_reservation(uuid,text,integer,integer,integer,text,text,text,text,uuid,uuid,text) TO service_role;

DO $verify$
DECLARE
  v_cfg text[];
  v_definer boolean;
BEGIN
  SELECT p.proconfig, p.prosecdef INTO v_cfg, v_definer
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'apply_credit_reservation'
     AND p.oid = 'public.apply_credit_reservation(uuid,text,integer,integer,integer,text,text,text,text,uuid,uuid,text)'::regprocedure;
  IF v_cfg IS DISTINCT FROM ARRAY['search_path=pg_catalog, public'] THEN
    RAISE EXCEPTION 'single_count verify: proconfig is % (expected {search_path=pg_catalog, public})', v_cfg;
  END IF;
  IF v_definer THEN
    RAISE EXCEPTION 'single_count verify: function is SECURITY DEFINER';
  END IF;
  IF has_function_privilege('anon', 'public.apply_credit_reservation(uuid,text,integer,integer,integer,text,text,text,text,uuid,uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.apply_credit_reservation(uuid,text,integer,integer,integer,text,text,text,text,uuid,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'single_count verify: a client role can EXECUTE apply_credit_reservation';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.apply_credit_reservation(uuid,text,integer,integer,integer,text,text,text,text,uuid,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'single_count verify: service_role cannot EXECUTE apply_credit_reservation';
  END IF;
END
$verify$;
