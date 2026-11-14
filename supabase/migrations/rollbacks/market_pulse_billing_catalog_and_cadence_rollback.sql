-- Rollback of 20270217000055_market_pulse_billing_catalog_and_cadence.sql (e1). Restores the daily-only cadence CHECK
-- and default, and deletes ONLY the catalog row 055 wrote (description marker). REFUSES (rather than rewriting data)
-- when a 'weekly' row exists: converting a company's chosen cadence is a product decision, not a rollback side effect.
DO $m055_rb$
BEGIN
  IF EXISTS (SELECT 1 FROM public.market_pulse_automation_settings WHERE cadence = 'weekly') THEN
    RAISE EXCEPTION '055 rollback refused: weekly cadence rows exist; decide their cadence first';
  END IF;
END
$m055_rb$;
ALTER TABLE public.market_pulse_automation_settings DROP CONSTRAINT market_pulse_automation_settings_cadence_check;
ALTER TABLE public.market_pulse_automation_settings
  ADD CONSTRAINT market_pulse_automation_settings_cadence_check CHECK (cadence = 'daily');
ALTER TABLE public.market_pulse_automation_settings ALTER COLUMN cadence SET DEFAULT 'daily';
DELETE FROM public.credit_cost_config
 WHERE action_type = 'market_pulse' AND description = 'Market Pulse, per AI region (20270217000055)';
