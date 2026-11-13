-- 20270217000049 - voice_per_minute to the OWNER RULE (15x minimum margin) (e1; owner ruling 2026-11-13 via e9;
-- version reserved by virality-83 in 9aa68c784; review: virality-05). Ships with 046 + 047, before the D8 rate step.
--
-- WHY. Voice transcription costs USD 0.006/min (Whisper) / 0.0062 (AssemblyAI) - the route's own captured rates. At the
-- equalised credit rate (USD 0.007, 047 + D8) the old price of 10 credits/min = USD 0.07/min = 11.7x actual, BELOW the
-- 15x minimum. 15x needs >= USD 0.093/min = 13.3 credits -> 14 credits/min (USD 0.098, 15.8x).
--
-- WHAT (three rows, kept OUT of 046 so 046 keeps its reviewed contract - credit_cost_config and fixed rows untouched):
--   (i)   credit_cost_config voice_per_minute.credits 10 -> 14   (getCreditCost reads this: the price that is charged)
--   (ii)  action_pricing_config voice_per_minute: the active 'fixed' row's minimum_charge_usd / ceiling_usd 0.10 -> 0.098
--         (14 x 0.007). Same mechanics as 046: the current active row is DEACTIVATED (kept as history) and a new active
--         row inserted with effective_from 2026-11-14 00:49:00+00 - distinct from 046's 00:00:00 so each migration's rows are identifiable as its own (046's suite asserts it left voice_per_minute alone); fixed, so a re-run recognises its own row.
--   (iii) activity_class_economics VOICE maximum_credits 60 -> 75 - a REFERENCE copy (no code reads this table; the
--         operative value is activityEconomyCatalog.ts, raised in fix/profile-refine-billing-20261113 @ 65143c27f):
--         a 5:00 recording (the recorder's limit, enforced server-side) at 14 credits/min = 70, plus 1 minute headroom.
-- Idempotent: each step skips a row already at its target. ONE DO block = atomic under any runner.

DO $preflight$
DECLARE
  v_n int;
BEGIN
  IF to_regclass('public.credit_cost_config') IS NULL OR to_regclass('public.action_pricing_config') IS NULL
     OR to_regclass('public.activity_class_economics') IS NULL THEN
    RAISE EXCEPTION '049 preflight: credit_cost_config, action_pricing_config and activity_class_economics must exist';
  END IF;
  SELECT count(*) INTO v_n FROM public.credit_cost_config WHERE action_type = 'voice_per_minute';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '049 preflight: expected exactly 1 credit_cost_config voice_per_minute row, found %', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.action_pricing_config WHERE action_key = 'voice_per_minute' AND is_active;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '049 preflight: expected exactly 1 active action_pricing_config voice_per_minute row, found %', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.activity_class_economics WHERE activity_class = 'VOICE';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '049 preflight: expected exactly 1 activity_class_economics VOICE row, found %', v_n;
  END IF;
END
$preflight$;

DO $apply$
DECLARE
  v_n int;
  v_credits int;
  v_max int;
BEGIN
  -- (i) the charged price
  UPDATE public.credit_cost_config
     SET credits = 14, updated_at = now()
   WHERE action_type = 'voice_per_minute' AND credits <> 14;

  -- (ii) the fixed pricing row: deactivate the current active row unless it already IS the target, then insert
  UPDATE public.action_pricing_config
     SET is_active = false
   WHERE action_key = 'voice_per_minute' AND is_active
     AND NOT (source_type = 'fixed' AND minimum_charge_usd = 0.098 AND ceiling_usd = 0.098
              AND effective_from = '2026-11-14 00:49:00+00');
  INSERT INTO public.action_pricing_config
    (action_key, source_type, cost_multiplier, minimum_charge_usd, ceiling_usd, is_active, effective_from, notes)
  SELECT 'voice_per_minute', 'fixed', 1.0, 0.098, 0.098, true, '2026-11-14 00:49:00+00',
         'owner rule 2026-11-13: 14 credits/min at 0.007 = 15.8x actual (Whisper 0.006/min) (20270217000049)'
   WHERE NOT EXISTS (SELECT 1 FROM public.action_pricing_config WHERE action_key = 'voice_per_minute' AND is_active);

  -- (iii) the reference copy of the VOICE class maximum
  UPDATE public.activity_class_economics
     SET maximum_credits = 75, updated_at = now()
   WHERE activity_class = 'VOICE' AND maximum_credits <> 75;

  -- ── Postconditions (a RAISE rolls back everything above) ──
  SELECT count(*) INTO v_n FROM public.action_pricing_config
   WHERE action_key = 'voice_per_minute' AND is_active;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '049 postcondition: expected exactly 1 active voice_per_minute row, found %', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.action_pricing_config
   WHERE action_key = 'voice_per_minute' AND is_active AND source_type = 'fixed'
     AND minimum_charge_usd = 0.098 AND ceiling_usd = 0.098;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '049 postcondition: the active voice_per_minute row is not fixed 0.098 / 0.098';
  END IF;
  SELECT credits INTO v_credits FROM public.credit_cost_config WHERE action_type = 'voice_per_minute';
  IF v_credits IS DISTINCT FROM 14 THEN
    RAISE EXCEPTION '049 postcondition: credit_cost_config voice_per_minute = %, expected 14', v_credits;
  END IF;
  SELECT maximum_credits INTO v_max FROM public.activity_class_economics WHERE activity_class = 'VOICE';
  IF v_max IS DISTINCT FROM 75 THEN
    RAISE EXCEPTION '049 postcondition: activity_class_economics VOICE maximum_credits = %, expected 75', v_max;
  END IF;
END
$apply$;

-- ROLLBACK: supabase/migrations/rollbacks/voice_per_minute_owner_rule_15x_rollback.sql
