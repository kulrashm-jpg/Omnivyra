-- 20270217000047 - organization_credits.credit_rate_usd DEFAULT 0.01 -> 0.007 (e1; owner pricing ruling 2026-11-13 via
-- e9; version from virality-83; review: virality-05).
--
-- WHY. One credit is worth USD 0.007 under the owner rule (20270217000046 prices every AI action against it). New
-- wallets take the column DEFAULT once the hard-coded 0.001 in initialFreeCreditService is removed (literal removal,
-- released after the D-RATE data step). Without this change that removal would make every new wallet 0.01 - a second
-- drift exactly like the one D-RATE corrects.
--
-- WHAT. Schema only: ALTER COLUMN ... SET DEFAULT. Existing rows are NOT changed (a DEFAULT applies to future INSERTs
-- only); the 30 existing non-Embrosales wallets are equalised by the separate guarded D-RATE step, and Embrosales
-- (73e5fa6f) is never touched. The postcondition therefore asserts the DEFAULT EXPRESSION, not row values.
--
-- ROLLBACK: rollbacks/organization_credits_credit_rate_default_0007_rollback.sql (DEFAULT back to 0.01).

DO $preflight$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_expr(d.adbin, d.adrelid) INTO v_def
    FROM pg_attrdef d
    JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
   WHERE d.adrelid = 'public.organization_credits'::regclass AND a.attname = 'credit_rate_usd' AND NOT a.attisdropped;
  IF v_def IS NULL THEN
    RAISE EXCEPTION '047 preflight: organization_credits.credit_rate_usd has no DEFAULT - refusing to guess its state';
  END IF;
  IF v_def NOT IN ('0.01', '0.007') THEN
    RAISE EXCEPTION '047 preflight: organization_credits.credit_rate_usd DEFAULT is % (expected 0.01, or 0.007 if re-run)', v_def;
  END IF;
END
$preflight$;

ALTER TABLE public.organization_credits ALTER COLUMN credit_rate_usd SET DEFAULT 0.007;

DO $verify$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_expr(d.adbin, d.adrelid) INTO v_def
    FROM pg_attrdef d
    JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
   WHERE d.adrelid = 'public.organization_credits'::regclass AND a.attname = 'credit_rate_usd' AND NOT a.attisdropped;
  IF v_def IS DISTINCT FROM '0.007' THEN
    RAISE EXCEPTION '047 postcondition: credit_rate_usd DEFAULT is %, expected 0.007', coalesce(v_def, '<none>');
  END IF;
END
$verify$;
