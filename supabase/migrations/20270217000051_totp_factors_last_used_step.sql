-- 20270217000051 - M3: TOTP replay protection (e1; owner-assigned; spec virality-05 C:/tmp/pi-specs/M1-M5-AND-MONEY-SPEC.md;
-- version reserved by virality-83 in f8a34dded; review: virality-05).
--
-- otplib's +/-1-step window does not track used tokens, so a code could verify twice inside its window. The verify path
-- (fix/totp-replay-m3-20261113) now CONSUMES the matched time step with ONE conditional UPDATE:
--   UPDATE totp_factors SET last_used_step = :step, last_used_at = now()
--    WHERE id = :factor AND last_used_step < :step RETURNING id
-- 0 rows = a replay (or an older step) -> refused. This column is that persisted, restart-proof state.
--
-- ADDITIVE ONLY: bigint NOT NULL DEFAULT 0 (05: no NULL branch, so the predicate is one structural `<`; step 0 is 1970,
-- which no real code can match; existing rows take the default), no index (the UPDATE is by primary key), no grant change (totp_factors is service-role only; posture
-- asserted below). The code must ship WITH or AFTER this migration - before it, the UPDATE names a missing column and
-- every TOTP verification fails CLOSED (VERIFICATION_UNAVAILABLE), never open.

DO $preflight$
BEGIN
  IF to_regclass('public.totp_factors') IS NULL THEN
    RAISE EXCEPTION '051 preflight: public.totp_factors does not exist';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'totp_factors' AND column_name = 'last_used_step'
                AND (data_type <> 'bigint' OR is_nullable <> 'NO')) THEN
    RAISE EXCEPTION '051 preflight: totp_factors.last_used_step exists but is not bigint NOT NULL';
  END IF;
END
$preflight$;

ALTER TABLE public.totp_factors ADD COLUMN IF NOT EXISTS last_used_step bigint NOT NULL DEFAULT 0;

-- Posture restated (owner rule #23 schema-wide revoke, applied 2026-11-10): MFA secrets metadata is service-role only.
REVOKE ALL ON TABLE public.totp_factors FROM anon, authenticated;

COMMENT ON COLUMN public.totp_factors.last_used_step IS
  'M3: the last TOTP time step consumed by a successful verification; a code whose step is <= this is a replay (20270217000051).';

DO $verify$
DECLARE
  r text;
  p text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'totp_factors' AND column_name = 'last_used_step'
                    AND data_type = 'bigint' AND is_nullable = 'NO' AND column_default = '0') THEN
    RAISE EXCEPTION '051 postcondition: totp_factors.last_used_step bigint NOT NULL DEFAULT 0 is missing';
  END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
      IF has_table_privilege(r, 'public.totp_factors', p) THEN
        RAISE EXCEPTION '051 postcondition: % holds % on totp_factors (it must stay service-role only)', r, p;
      END IF;
    END LOOP;
    IF has_column_privilege(r, 'public.totp_factors', 'last_used_step', 'SELECT')
       OR has_column_privilege(r, 'public.totp_factors', 'last_used_step', 'UPDATE') THEN
      RAISE EXCEPTION '051 postcondition: % holds a column privilege on totp_factors.last_used_step', r;
    END IF;
  END LOOP;
END
$verify$;
