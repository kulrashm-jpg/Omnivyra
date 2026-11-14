-- 20270217000055 - Market Pulse billing catalog row + weekly cadence (e1; OWNER ruling 2026-11-14 via e9, design
-- D1(a) + D2(a); version from virality-83; review: virality-05).
--
-- 1. credit_cost_config 'market_pulse' = 8 credits: the owner's price PER AI REGION. The run's HOLD is 8 x regions
--    (amountOverride) and it settles at 8 x regions COMPLETED, capped at the hold (marketPulseBilling.ts). The row is
--    the catalog/preview source (fixed-fee path of resolveActivityCreditRange) and getCreditCost's answer for one region.
--    Deliberately NO action_pricing_config row: resolveActivityCreditRange treats any active apc row as token-priced at
--    the org's credit rate (the F3 preview defect), and Market Pulse is a fixed per-region price. The postcondition pins
--    that absence. (Like 054, the key is therefore absent from public.v_pricing_catalog - expected; do not "fix" it
--    with an apc row.)
-- 2. market_pulse_automation_settings.cadence: the CHECK allowed only 'daily' and the automation route forced 'daily';
--    the owner's default is WEEKLY. Preflight the existing CHECK BY NAME and the current values, then widen it to
--    ('daily','weekly') and default new rows to 'weekly'. Existing rows keep their value (C102: 0 active rows in prod).
--
-- No table is created; no GRANT changes (existing tables keep their posture).
-- Rollback: supabase/migrations/rollbacks/market_pulse_billing_catalog_and_cadence_rollback.sql

DO $m055_pre$
DECLARE
  v_def text;
  v_bad text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c
   WHERE c.conrelid = 'public.market_pulse_automation_settings'::regclass
     AND c.conname = 'market_pulse_automation_settings_cadence_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '055 preflight: market_pulse_automation_settings_cadence_check not found - the schema is not what this migration was written against';
  END IF;
  IF v_def NOT LIKE '%daily%' THEN
    RAISE EXCEPTION '055 preflight: unexpected cadence CHECK definition: %', v_def;
  END IF;
  SELECT string_agg(DISTINCT cadence, ', ') INTO v_bad
    FROM public.market_pulse_automation_settings
   WHERE cadence NOT IN ('daily', 'weekly');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '055 preflight: cadence values outside (daily, weekly): %', v_bad;
  END IF;
END
$m055_pre$;

ALTER TABLE public.market_pulse_automation_settings
  DROP CONSTRAINT market_pulse_automation_settings_cadence_check;
ALTER TABLE public.market_pulse_automation_settings
  ADD CONSTRAINT market_pulse_automation_settings_cadence_check CHECK (cadence IN ('daily', 'weekly'));
ALTER TABLE public.market_pulse_automation_settings
  ALTER COLUMN cadence SET DEFAULT 'weekly';

INSERT INTO public.credit_cost_config (action_type, credits, category, description, smart_dedup_seconds, activity_class)
VALUES ('market_pulse', 8, 'medium', 'Market Pulse, per AI region (20270217000055)', 0, 'INTELLIGENCE_SCAN')
ON CONFLICT (action_type) DO NOTHING;

DO $m055_post$
BEGIN
  IF (SELECT count(*) FROM public.credit_cost_config
       WHERE action_type = 'market_pulse' AND credits = 8 AND category = 'medium' AND smart_dedup_seconds = 0
         AND activity_class = 'INTELLIGENCE_SCAN' AND description = 'Market Pulse, per AI region (20270217000055)') <> 1 THEN
    RAISE EXCEPTION '055 postcondition: credit_cost_config market_pulse is not exactly the ruled row (8 per region)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.action_pricing_config WHERE action_key = 'market_pulse' AND is_active) THEN
    RAISE EXCEPTION '055 postcondition: an active action_pricing_config row for market_pulse would make the preview token-priced';
  END IF;
  IF (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
       WHERE c.conrelid = 'public.market_pulse_automation_settings'::regclass
         AND c.conname = 'market_pulse_automation_settings_cadence_check') NOT LIKE '%weekly%' THEN
    RAISE EXCEPTION '055 postcondition: cadence CHECK does not admit weekly';
  END IF;
  IF (SELECT column_default FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'market_pulse_automation_settings' AND column_name = 'cadence')
     NOT LIKE '''weekly''%' THEN
    RAISE EXCEPTION '055 postcondition: cadence default is not weekly';
  END IF;
END
$m055_post$;
