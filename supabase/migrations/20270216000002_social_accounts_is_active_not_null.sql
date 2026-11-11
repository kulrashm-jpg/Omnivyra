-- social_accounts.is_active becomes NOT NULL (version 20270216000002, reserved by virality-83 in
-- a5b9441c8; on S, with the WhatsApp disconnected-account guard).
--
-- WHY. The column is `boolean DEFAULT true` and NULLABLE (supabase/_schema/baseline.sql). The
-- WhatsApp send paths refuse a disconnected sender account with `is_active === false`, which
-- lets a NULL row send - deliberately, because NULL could only come from an explicit null insert
-- or a row older than the column, and refusing those would be a functional break, not a safety
-- gain (05). With NOT NULL that ambiguity is retired: `=== false` becomes exact, and every reader
-- that tests `is_active === true` (the inbound processor's live-account choice, the disconnect
-- route) agrees with every reader that tests `!== false`.
--
-- PRODUCTION FACT (C15, via e9/83, 2026-11-12): 0 NULL rows of 7. The precondition below RAISES
-- on any NULL rather than backfilling one: a NULL found at apply time is a fact to look at, not
-- something to overwrite silently. The column default (true) is unchanged.
--
-- LOCK. SET NOT NULL scans the table under ACCESS EXCLUSIVE; social_accounts is small.

BEGIN;

DO $preflight$
DECLARE
  v_nulls bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.social_accounts'::regclass AND attname = 'is_active' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'SAIA preflight: public.social_accounts.is_active does not exist';
  END IF;
  SELECT count(*) INTO v_nulls FROM public.social_accounts WHERE is_active IS NULL;
  IF v_nulls > 0 THEN
    RAISE EXCEPTION 'SAIA preflight: % social_accounts row(s) have is_active NULL - decide them (connected or not) before this migration; it does not guess', v_nulls;
  END IF;
END
$preflight$;

ALTER TABLE public.social_accounts ALTER COLUMN is_active SET NOT NULL;

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.social_accounts'::regclass AND attname = 'is_active'
       AND attnotnull AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'SAIA postcondition: public.social_accounts.is_active must be NOT NULL';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_attrdef d
      JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
     WHERE d.adrelid = 'public.social_accounts'::regclass AND a.attname = 'is_active'
       AND pg_get_expr(d.adbin, d.adrelid) = 'true'
  ) THEN
    RAISE EXCEPTION 'SAIA postcondition: public.social_accounts.is_active must keep DEFAULT true';
  END IF;
  RAISE NOTICE 'SAIA: social_accounts.is_active is NOT NULL DEFAULT true.';
END
$verify$;

COMMIT;
