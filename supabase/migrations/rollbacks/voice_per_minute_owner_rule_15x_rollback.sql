-- Rollback of 20270217000049_voice_per_minute_owner_rule_15x.sql (e1).
-- Restores voice_per_minute to 10 credits/min, re-activates its most recent row EARLIER than the 049 row
-- (effective_from 2026-11-14 00:49:00+00), and the VOICE reference maximum to 60.
DO $rb$
DECLARE
  v_prev uuid;
BEGIN
  UPDATE public.credit_cost_config SET credits = 10, updated_at = now() WHERE action_type = 'voice_per_minute';
  UPDATE public.action_pricing_config SET is_active = false
   WHERE action_key = 'voice_per_minute' AND is_active AND effective_from = '2026-11-14 00:49:00+00';
  SELECT id INTO v_prev FROM public.action_pricing_config
   WHERE action_key = 'voice_per_minute' AND effective_from < '2026-11-14 00:49:00+00'
   ORDER BY effective_from DESC, created_at DESC LIMIT 1;
  IF v_prev IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.action_pricing_config WHERE action_key = 'voice_per_minute' AND is_active) THEN
    UPDATE public.action_pricing_config SET is_active = true WHERE id = v_prev;
  END IF;
  UPDATE public.activity_class_economics SET maximum_credits = 60, updated_at = now() WHERE activity_class = 'VOICE';
  IF EXISTS (SELECT 1 FROM public.action_pricing_config WHERE action_key = 'voice_per_minute' AND is_active
               AND effective_from = '2026-11-14 00:49:00+00') THEN
    RAISE EXCEPTION '049 rollback: the 049 row is still active';
  END IF;
END
$rb$;
