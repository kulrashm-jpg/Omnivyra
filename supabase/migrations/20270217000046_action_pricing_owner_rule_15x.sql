-- 20270217000046 - AI action pricing to the OWNER RULE (e1; owner ruling 2026-11-13 via e9; version from virality-83;
-- review: virality-05).
--
-- THE RULE. Every AI action is priced at ACTUAL provider consumption x 15 (15x is the MINIMUM margin over real cost),
-- held before the call and settled on completion (hold -> confirm_partial -> release). One credit = USD 0.007
-- (credit_rate_usd, equalised by the separate rate D-step), so 300 free credits cover a basic month: one BOLT Text OR
-- BOLT Creator campaign + 4 blogs + 30 posts (C82/C83 real costs: Creator month USD 0.135 x15 = 289 credits, Text 167).
-- Pack prices stay USD 0.10-0.12 per credit (owner ruling A).
--
-- WHAT EACH COLUMN MEANS HERE (pricingService.ts):
--   cost_multiplier    15 for every AI (source_type 'llm') key below.
--   minimum_charge_usd 0.007 = 1 credit: it only stops a call from costing 0; the price is actual x 15.
--   ceiling_usd        a CAP on the SETTLED price (a runaway guard), NOT the hold: estimateLlmHoldCredits computes the hold
--                      from the caller's maxInput/maxOutputTokens with applyCeiling:false (pricingService.ts:510). So the
--                      ceiling covers a whole billed UNIT (a multi-call workflow settles the SUM of its calls): observed
--                      per-call max x calls-per-unit x 15 x 1.5 headroom (campaign_generation 3 calls, insight_generation
--                      5 = one virality assessment, content_basic 7 = the longest blog template). With fewer than 30
--                      observed calls, or none, the ceiling is never below the previously prescribed credits at 0.007.
--
-- NOT TOUCHED (rows left exactly as they are): website_audit, deep_analysis, full_strategy (report pipelines stay
-- fixed-hold for launch; itemised settle = POST-LAUNCH PL-05), auto_post, voice_per_minute, external_api (source_type
-- 'fixed'), embedding (platform spend, per-embedding). credit_cost_config is NOT changed: fixed-credit workflows price via
-- getCreditCost (creditDeductionService.ts:148), which reads it directly, so token rows here change no fixed charge.
--
-- HOW. action_pricing_config allows ONE active row per action_key (partial unique index WHERE is_active). For each key
-- below the current active row is DEACTIVATED (kept as history) and a new active row is INSERTED with effective_from
-- 2026-11-14 00:00:00+00 (fixed, so a re-run recognises its own rows). Explicit UPDATE + INSERT - NOT ON CONFLICT DO NOTHING
-- (20261024000002 used that, so on a fresh replay the 20260422 1.0/0/NULL rows win). Idempotent: a key whose active row
-- already equals the target tuple is skipped.
--
-- 45 keys: 24 existing llm keys re-priced + 21 that had only a credit_cost_config row (lead_qualification,
-- lead_predictive_scoring and 19 catalogue-only keys) gain a token price. Per-key basis (C82, all history):
--   ai_reply                         ceiling 0.1118  observed max 0.004965 x1 calls x15 x1.5 (438 calls)
--   async_campaign_planning          ceiling 0.3500  no observed calls; prior prescribed 50 credits at 0.007
--   blogAnalyticsInsight             ceiling 0.0560  no observed calls; prior prescribed 8 credits at 0.007
--   blog_brief_suggestions           ceiling 0.0070  no observed calls; prior prescribed 1 credits at 0.007
--   blog_generation                  ceiling 0.4200  no observed calls; prior prescribed 60 credits at 0.007
--   blog_rewrite_hook                ceiling 0.0210  no observed calls; prior prescribed 3 credits at 0.007
--   campaign_chat                    ceiling 0.0070  no observed calls; prior prescribed 1 credits at 0.007
--   campaign_creation                ceiling 0.2800  no observed calls; prior prescribed 40 credits at 0.007
--   campaign_generation              ceiling 0.3284  observed max 0.004864 x3 calls x15 x1.5 (170 calls)
--   campaign_optimization            ceiling 0.2100  no observed calls; prior prescribed 30 credits at 0.007
--   campaign_preplanning             ceiling 0.0070  no observed calls; prior prescribed 1 credits at 0.007
--   campaign_suggest_duration        ceiling 0.0070  no observed calls; prior prescribed 1 credits at 0.007
--   campaign_suggest_update          ceiling 0.0070  no observed calls; prior prescribed 1 credits at 0.007
--   chat_theme_refine                ceiling 0.0070  no observed calls; prior prescribed 1 credits at 0.007
--   competitor_signals               ceiling 0.0560  no observed calls; prior prescribed 8 credits at 0.007
--   content_basic                    ceiling 1.7741  observed max 0.011264 x7 calls x15 x1.5 (177 calls)
--   content_generation               ceiling 0.0296  observed max 0.001315 x1 calls x15 x1.5 (377 calls)
--   content_repurpose                ceiling 0.0350  no observed calls; prior prescribed 5 credits at 0.007
--   content_rewrite                  ceiling 0.0637  observed max 0.002829 x1 calls x15 x1.5 (307 calls)
--   content_suggestions              ceiling 0.0210  no observed calls; prior prescribed 3 credits at 0.007
--   creator_content                  ceiling 0.0350  no observed calls; prior prescribed 5 credits at 0.007
--   daily_insight_scan               ceiling 0.1400  no observed calls; prior prescribed 20 credits at 0.007
--   engagement_refine                ceiling 0.0070  no observed calls; prior prescribed 1 credits at 0.007
--   insight_generation               ceiling 2.1581  observed max 0.019183 x5 calls x15 x1.5 (210 calls)
--   lead_detection                   ceiling 0.1050  no observed calls; prior prescribed 15 credits at 0.007
--   lead_predictive_scoring          ceiling 0.0700  no observed calls; prior prescribed 10 credits at 0.007
--   lead_qualification               ceiling 0.0560  no observed calls; prior prescribed 8 credits at 0.007
--   market_insight_manual            ceiling 0.2100  no observed calls; prior prescribed 30 credits at 0.007
--   market_positioning               ceiling 0.0700  no observed calls; prior prescribed 10 credits at 0.007
--   optimization_loop                ceiling 0.1050  no observed calls; prior prescribed 15 credits at 0.007
--   pattern_detection                ceiling 0.0840  no observed calls; prior prescribed 12 credits at 0.007
--   portfolio_decision               ceiling 0.1400  no observed calls; prior prescribed 20 credits at 0.007
--   prediction                       ceiling 0.0700  no observed calls; prior prescribed 10 credits at 0.007
--   profile_enrichment               ceiling 0.1032  observed max 0.004586 x1 calls x15 x1.5 (66 calls)
--   profile_extraction               ceiling 0.2441  observed max 0.010847 x1 calls x15 x1.5 (82 calls)
--   quick_platform_adapt             ceiling 0.0210  no observed calls; prior prescribed 3 credits at 0.007
--   recommendations_generate         ceiling 0.0560  no observed calls; prior prescribed 8 credits at 0.007
--   recommendations_group_preview    ceiling 0.0070  no observed calls; prior prescribed 1 credits at 0.007
--   recommendations_opportunities    ceiling 0.0560  no observed calls; prior prescribed 8 credits at 0.007
--   recommendations_preview_strategy ceiling 0.0070  no observed calls; prior prescribed 1 credits at 0.007
--   reply_generation                 ceiling 0.0140  no observed calls; prior prescribed 2 credits at 0.007
--   skeleton_command                 ceiling 0.0350  no observed calls; prior prescribed 5 credits at 0.007
--   strategy_evolution               ceiling 0.1050  observed max 0.000315 x1 calls x15 x1.5; thin sample (12 calls) -> not below prior 15 cr
--   system                           ceiling 0.0070  no observed calls; prior prescribed 1 credits at 0.007
--   trend_analysis                   ceiling 0.1750  no observed calls; prior prescribed 25 credits at 0.007
--
-- ROLLBACK: rollbacks/action_pricing_owner_rule_15x_rollback.sql.

DO $preflight$
DECLARE
  v_multi text;
BEGIN
  IF to_regclass('public.action_pricing_config') IS NULL THEN
    RAISE EXCEPTION '046 preflight: public.action_pricing_config does not exist';
  END IF;
  IF to_regclass('public.action_pricing_config_active_uniq') IS NULL AND to_regclass('public.uq_action_pricing_config_active') IS NULL THEN
    RAISE EXCEPTION '046 preflight: the one-active-row-per-key unique index is missing - refusing (two active rows would make the price ambiguous)';
  END IF;
  SELECT string_agg(action_key, ', ') INTO v_multi FROM (
    SELECT action_key FROM public.action_pricing_config WHERE is_active GROUP BY action_key HAVING count(*) > 1) m;
  IF v_multi IS NOT NULL THEN
    RAISE EXCEPTION '046 preflight: keys with more than one active row: %', v_multi;
  END IF;
END
$preflight$;

-- Temp tables are dropped EXPLICITLY (not ON COMMIT DROP): the file must work whether the runner wraps it in one
-- transaction or runs each statement in autocommit (psql replay), where ON COMMIT DROP would drop them at once.
DROP TABLE IF EXISTS pg_temp.m046_target;
DROP TABLE IF EXISTS pg_temp.m046_untouched;
CREATE TEMP TABLE m046_target (action_key text PRIMARY KEY, ceiling_usd numeric NOT NULL);
INSERT INTO m046_target (action_key, ceiling_usd) VALUES
  ('ai_reply', 0.1118),
  ('async_campaign_planning', 0.3500),
  ('blogAnalyticsInsight', 0.0560),
  ('blog_brief_suggestions', 0.0070),
  ('blog_generation', 0.4200),
  ('blog_rewrite_hook', 0.0210),
  ('campaign_chat', 0.0070),
  ('campaign_creation', 0.2800),
  ('campaign_generation', 0.3284),
  ('campaign_optimization', 0.2100),
  ('campaign_preplanning', 0.0070),
  ('campaign_suggest_duration', 0.0070),
  ('campaign_suggest_update', 0.0070),
  ('chat_theme_refine', 0.0070),
  ('competitor_signals', 0.0560),
  ('content_basic', 1.7741),
  ('content_generation', 0.0296),
  ('content_repurpose', 0.0350),
  ('content_rewrite', 0.0637),
  ('content_suggestions', 0.0210),
  ('creator_content', 0.0350),
  ('daily_insight_scan', 0.1400),
  ('engagement_refine', 0.0070),
  ('insight_generation', 2.1581),
  ('lead_detection', 0.1050),
  ('lead_predictive_scoring', 0.0700),
  ('lead_qualification', 0.0560),
  ('market_insight_manual', 0.2100),
  ('market_positioning', 0.0700),
  ('optimization_loop', 0.1050),
  ('pattern_detection', 0.0840),
  ('portfolio_decision', 0.1400),
  ('prediction', 0.0700),
  ('profile_enrichment', 0.1032),
  ('profile_extraction', 0.2441),
  ('quick_platform_adapt', 0.0210),
  ('recommendations_generate', 0.0560),
  ('recommendations_group_preview', 0.0070),
  ('recommendations_opportunities', 0.0560),
  ('recommendations_preview_strategy', 0.0070),
  ('reply_generation', 0.0140),
  ('skeleton_command', 0.0350),
  ('strategy_evolution', 0.1050),
  ('system', 0.0070),
  ('trend_analysis', 0.1750);

-- Snapshot of the rows this migration must NOT touch (compared in the postcondition).
CREATE TEMP TABLE m046_untouched AS
  SELECT id, action_key, source_type, cost_multiplier, minimum_charge_usd, ceiling_usd, is_active
    FROM public.action_pricing_config
   WHERE action_key NOT IN (SELECT action_key FROM m046_target);

-- ONE DO block = ONE statement = atomic under any runner (a wrapping transaction or psql autocommit): the deactivation,
-- the insertion, the posture and every postcondition succeed together or not at all. Pricing readers never see a key
-- with no active row (the UPDATE and INSERT are not separate commits), and a failed check leaves the old prices.
DO $apply$
DECLARE
  v_bad text;
  v_n int;
  r text;
  p text;
BEGIN
  -- Deactivate each target key's current active row unless it already IS the target row.
  UPDATE public.action_pricing_config a
     SET is_active = false
    FROM m046_target t
   WHERE a.action_key = t.action_key
     AND a.is_active
     AND NOT (a.source_type = 'llm' AND a.cost_multiplier = 15 AND a.minimum_charge_usd = 0.007
              AND a.ceiling_usd = t.ceiling_usd AND a.effective_from = '2026-11-14 00:00:00+00');

  -- Insert the target row for every key that now has no active row.
  INSERT INTO public.action_pricing_config
    (action_key, source_type, cost_multiplier, minimum_charge_usd, ceiling_usd, is_active, effective_from, notes)
  SELECT t.action_key, 'llm', 15, 0.007, t.ceiling_usd, true, '2026-11-14 00:00:00+00',
         'owner rule 2026-11-13: actual x15 (minimum margin), floor 1 credit at 0.007, ceiling = settle cap (20270217000046)'
    FROM m046_target t
   WHERE NOT EXISTS (SELECT 1 FROM public.action_pricing_config a WHERE a.action_key = t.action_key AND a.is_active);

  -- Posture restated (service-role only; RLS policy action_pricing_config_service_all).
  REVOKE ALL ON TABLE public.action_pricing_config FROM anon, authenticated;

  -- ── Postconditions (a RAISE here rolls back everything above) ──
  SELECT string_agg(t.action_key, ', ') INTO v_bad
    FROM m046_target t
   WHERE (SELECT count(*) FROM public.action_pricing_config a
           WHERE a.action_key = t.action_key AND a.is_active AND a.source_type = 'llm' AND a.cost_multiplier = 15
             AND a.minimum_charge_usd = 0.007 AND a.ceiling_usd = t.ceiling_usd
             AND a.effective_from = '2026-11-14 00:00:00+00') <> 1
      OR (SELECT count(*) FROM public.action_pricing_config a WHERE a.action_key = t.action_key AND a.is_active) <> 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '046 postcondition: target keys without exactly one correct active row: %', v_bad;
  END IF;
  SELECT count(*) INTO v_n FROM m046_target;
  IF v_n <> 45 THEN
    RAISE EXCEPTION '046 postcondition: expected 45 target keys, found %', v_n;
  END IF;
  IF EXISTS (
       (SELECT id, action_key, source_type, cost_multiplier, minimum_charge_usd, ceiling_usd, is_active FROM m046_untouched
        EXCEPT
        SELECT id, action_key, source_type, cost_multiplier, minimum_charge_usd, ceiling_usd, is_active
          FROM public.action_pricing_config WHERE action_key NOT IN (SELECT action_key FROM m046_target))
       UNION ALL
       (SELECT id, action_key, source_type, cost_multiplier, minimum_charge_usd, ceiling_usd, is_active
          FROM public.action_pricing_config WHERE action_key NOT IN (SELECT action_key FROM m046_target)
        EXCEPT
        SELECT id, action_key, source_type, cost_multiplier, minimum_charge_usd, ceiling_usd, is_active FROM m046_untouched)) THEN
    RAISE EXCEPTION '046 postcondition: a row outside the 45 target keys changed';
  END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF has_table_privilege(r, 'public.action_pricing_config', p) THEN
        RAISE EXCEPTION '046 postcondition: % holds % on action_pricing_config', r, p;
      END IF;
    END LOOP;
    FOREACH p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] LOOP
      IF has_any_column_privilege(r, 'public.action_pricing_config', p) THEN
        RAISE EXCEPTION '046 postcondition: % holds a column-level % on action_pricing_config', r, p;
      END IF;
    END LOOP;
  END LOOP;
END
$apply$;

DROP TABLE IF EXISTS pg_temp.m046_target;
DROP TABLE IF EXISTS pg_temp.m046_untouched;
