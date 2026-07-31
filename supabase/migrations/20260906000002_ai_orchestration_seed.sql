-- =============================================================================
-- AI-ORCH-2B.1 — Seed data for the AI Orchestration foundation.
--
-- Seeds the MINIMUM inert reference data:
--   1. Execution Profiles (+ immutable v1 versions) mirroring today's documented
--      defaults (platformDefault + CAPABILITY_REGISTRY). NO new execution behavior.
--   2. Capability → Profile bindings (capability_default scope) for every
--      CAPABILITY_REGISTRY capability + a platform_default binding.
--   3. Operation → Capability map for the known gateway operation names.
--   4. Model families + versions backfilled from the existing llm_models rows.
--   5. The initial ai_config_versions row (version 1).
--   6. A config_change_logs audit entry recording this seed.
--
-- INERT: no resolver reads any of this in Phase 2B.1 (all AI_* flags OFF). These
-- seed values are a starting baseline; exact parity vs the legacy path is proven
-- later in the resolver SHADOW phase (2A-2), which compares plan-vs-legacy.
--
-- Idempotent: every INSERT uses ON CONFLICT DO NOTHING / guarded WHERE NOT EXISTS.
-- Depends on the foundation + extensions migrations (earlier timestamps).
--
-- NOT applied by this change — controlled migration process only.
-- =============================================================================

-- ── 1a. Execution Profiles ────────────────────────────────────────────────────
INSERT INTO public.ai_execution_profiles (key, name, description, is_platform_default, requires_approval)
SELECT v.key, v.name, v.description, v.is_platform_default, v.requires_approval
FROM (VALUES
  ('HIGH_QUALITY',      'High Quality',      'Best output, cost-tolerant. Frontier tier, low temperature, large token budget.',        false, true),
  ('BALANCED',          'Balanced',          'Platform default. Mid tier, moderate temperature. Mirrors today''s general default.',    true,  false),
  ('ECONOMY',           'Economy',           'Cheap/fast bulk work. Mini tier, tight tokens, aggressive caching.',                     false, false),
  ('JSON_EXTRACTION',   'JSON Extraction',   'Deterministic structured output. Temp 0, structured/JSON response mode.',                false, false),
  ('DEEP_REASONING',    'Deep Reasoning',    'Multi-step analysis/planning. Frontier tier, high reasoning, long timeout.',             false, false),
  ('CREATIVE_WRITING',  'Creative Writing',  'Long/short-form copy. Higher temperature, large max tokens, streaming.',                 false, false),
  ('GROUNDED_RESEARCH', 'Grounded Research', 'Web-cited answers. Search-capable provider, citations on.',                              false, false),
  ('VISION_ANALYSIS',   'Vision Analysis',   'Image-input analysis. Vision-capable provider/model.',                                   false, false),
  ('IMAGE_GENERATION',  'Image Generation',  'Image output (sibling seam). Image-capable provider/model with size/quality params.',    false, false),
  ('MODERATION',        'Moderation',        'Safety classification. Temp 0, tiny tokens, cheap tier, structured output.',             false, false)
) AS v(key, name, description, is_platform_default, requires_approval)
ON CONFLICT (key) DO NOTHING;

-- ── 1b. Immutable v1 profile versions (params mirror today's documented defaults) ─
INSERT INTO public.ai_execution_profile_versions
  (profile_id, version, mode, quality_tier, capability_requirements, params, modality, reliability, limits, caching, safety, status)
SELECT p.id, 1, v.mode, v.quality_tier,
       v.capability_requirements::jsonb, v.params::jsonb, v.modality::jsonb,
       v.reliability::jsonb, v.limits::jsonb, v.caching::jsonb, v.safety::jsonb, 'active'
FROM public.ai_execution_profiles p
JOIN (VALUES
  ('HIGH_QUALITY',     'tier', 'frontier',
     '{}', '{"temperature":0.4,"max_output_tokens":4000,"seed_policy":"none"}',
     '{"streaming":false,"structured_output":false}',
     '{"timeout_ms":120000,"max_retries":2,"partial_allowed":false}', '{}', '{"cacheable":true}',
     '{"moderation":"off","prompt_injection_guard":false}'),
  ('BALANCED',         'tier', 'balanced',
     '{}', '{"temperature":0.4,"max_output_tokens":2000,"seed_policy":"none"}',
     '{"streaming":false,"structured_output":false}',
     '{"timeout_ms":60000,"max_retries":2,"partial_allowed":false}', '{}', '{"cacheable":true}',
     '{"moderation":"off","prompt_injection_guard":false}'),
  ('ECONOMY',          'tier', 'economy',
     '{}', '{"temperature":0.3,"max_output_tokens":1500,"seed_policy":"none"}',
     '{"streaming":false,"structured_output":false}',
     '{"timeout_ms":30000,"max_retries":1,"partial_allowed":false}', '{}', '{"cacheable":true}',
     '{"moderation":"off","prompt_injection_guard":false}'),
  ('JSON_EXTRACTION',  'tier', 'balanced',
     '{"needs_structured":true}', '{"temperature":0,"max_output_tokens":2000,"seed_policy":"none"}',
     '{"streaming":false,"structured_output":true,"response_format":"json_object"}',
     '{"timeout_ms":60000,"max_retries":2,"partial_allowed":false}', '{}', '{"cacheable":true}',
     '{"moderation":"off","prompt_injection_guard":false}'),
  ('DEEP_REASONING',   'tier', 'frontier',
     '{}', '{"temperature":0.2,"max_output_tokens":4000,"reasoning_level":"high","seed_policy":"none"}',
     '{"streaming":false,"structured_output":false}',
     '{"timeout_ms":240000,"max_retries":2,"partial_allowed":true}', '{}', '{"cacheable":false}',
     '{"moderation":"off","prompt_injection_guard":false}'),
  ('CREATIVE_WRITING', 'tier', 'high',
     '{}', '{"temperature":0.7,"max_output_tokens":4000,"seed_policy":"none"}',
     '{"streaming":true,"structured_output":false}',
     '{"timeout_ms":240000,"max_retries":1,"partial_allowed":true}', '{}', '{"cacheable":false}',
     '{"moderation":"off","prompt_injection_guard":false}'),
  ('GROUNDED_RESEARCH','tier', 'balanced',
     '{"needs_search":true}', '{"temperature":0.2,"max_output_tokens":2000,"seed_policy":"none"}',
     '{"streaming":false,"structured_output":false}',
     '{"timeout_ms":60000,"max_retries":2,"partial_allowed":false}', '{}', '{"cacheable":true}',
     '{"moderation":"off","prompt_injection_guard":false}'),
  ('VISION_ANALYSIS',  'tier', 'high',
     '{"needs_vision":true}', '{"temperature":0,"max_output_tokens":2000,"seed_policy":"none"}',
     '{"streaming":false,"structured_output":false,"vision":true}',
     '{"timeout_ms":120000,"max_retries":2,"partial_allowed":false}', '{}', '{"cacheable":false}',
     '{"moderation":"off","prompt_injection_guard":false}'),
  ('IMAGE_GENERATION', 'tier', NULL,
     '{"needs_image_generation":true}', '{"seed_policy":"none"}',
     '{"image_params":{"size":"1024x1024","quality":"standard","n":1}}',
     '{"timeout_ms":120000,"max_retries":1,"partial_allowed":false}', '{}', '{"cacheable":false}',
     '{"moderation":"off","prompt_injection_guard":false}'),
  ('MODERATION',       'tier', 'economy',
     '{"needs_structured":true}', '{"temperature":0,"max_output_tokens":256,"seed_policy":"none"}',
     '{"streaming":false,"structured_output":true,"response_format":"json_object"}',
     '{"timeout_ms":30000,"max_retries":1,"partial_allowed":false}', '{}', '{"cacheable":false}',
     '{"moderation":"off","prompt_injection_guard":false}')
) AS v(key, mode, quality_tier, capability_requirements, params, modality, reliability, limits, caching, safety)
  ON v.key = p.key
ON CONFLICT (profile_id, version) DO NOTHING;

-- ── 1c. Repoint each profile at its active v1 version (resolves the circular ptr) ─
UPDATE public.ai_execution_profiles p
SET active_version_id = ver.id, updated_at = now()
FROM public.ai_execution_profile_versions ver
WHERE ver.profile_id = p.id AND ver.version = 1 AND p.active_version_id IS NULL;

-- ── 2a. Platform default binding → BALANCED ───────────────────────────────────
INSERT INTO public.ai_capability_profile_bindings (capability_id, org_id, profile_id, scope, priority)
SELECT NULL, NULL, p.id, 'platform_default', 0
FROM public.ai_execution_profiles p
WHERE p.key = 'BALANCED'
  AND NOT EXISTS (
    SELECT 1 FROM public.ai_capability_profile_bindings b
    WHERE b.scope = 'platform_default' AND b.org_id IS NULL AND b.capability_id IS NULL
  );

-- ── 2b. Capability default bindings (org_id NULL) from CAPABILITY_REGISTRY ─────
INSERT INTO public.ai_capability_profile_bindings (capability_id, org_id, profile_id, scope, priority)
SELECT m.capability_id, NULL, p.id, 'capability_default', 10
FROM (VALUES
  ('CONTENT_WRITER',           'CREATIVE_WRITING'),
  ('CONTENT_CREATOR',          'CREATIVE_WRITING'),
  ('CONTENT_WRITER_WORKSPACE', 'CREATIVE_WRITING'),
  ('LONG_FORM_CONTENT',        'CREATIVE_WRITING'),
  ('CREATOR_ASSET',            'CREATIVE_WRITING'),
  ('CAMPAIGN_PLANNER',         'DEEP_REASONING'),
  ('CAMPAIGN_PLAN',            'DEEP_REASONING'),
  ('STRATEGIC_MIX',            'BALANCED'),
  ('STRATEGIC_MIX_DECISION',   'BALANCED'),
  ('SEO_INTELLIGENCE',         'BALANCED'),
  ('GROWTH_INTELLIGENCE',      'BALANCED'),
  ('RECOMMENDATION_ENGINE',    'BALANCED'),
  ('RECOMMENDATION_DECISION',  'BALANCED'),
  ('WEBSITE_INTELLIGENCE',     'BALANCED'),
  ('COMPETITOR_INTELLIGENCE',  'GROUNDED_RESEARCH'),
  ('GENERIC_COMPLETION',       'BALANCED')
) AS m(capability_id, profile_key)
JOIN public.ai_execution_profiles p ON p.key = m.profile_key
ON CONFLICT DO NOTHING;

-- ── 3. Operation → Capability map (representative; unmapped → GENERIC_COMPLETION
--       at resolve time per design §5.3) ───────────────────────────────────────
INSERT INTO public.ai_operation_capability_map (operation, capability_id, notes)
VALUES
  ('generateRecommendation',           'RECOMMENDATION_ENGINE',   'seed'),
  ('generateCampaignRecommendations',  'RECOMMENDATION_ENGINE',   'seed'),
  ('generateLongFormRecommendations',  'RECOMMENDATION_ENGINE',   'seed'),
  ('generateAdditionalStrategicThemes','STRATEGIC_MIX',           'seed'),
  ('generateCampaignPlan',             'CAMPAIGN_PLANNER',        'seed'),
  ('parsePlanToWeeks',                 'CAMPAIGN_PLANNER',        'seed'),
  ('optimizeWeek',                     'CAMPAIGN_PLANNER',        'seed'),
  ('previewStrategy',                  'CAMPAIGN_PLANNER',        'seed'),
  ('prePlanningExplanation',           'CAMPAIGN_PLANNER',        'seed'),
  ('suggestDuration',                  'CAMPAIGN_PLANNER',        'seed'),
  ('refineCampaignIdea',               'CAMPAIGN_PLANNER',        'seed'),
  ('generateDailyPlan',                'CAMPAIGN_PLANNER',        'seed'),
  ('generateDailyDistributionPlan',    'CAMPAIGN_PLANNER',        'seed'),
  ('parseRefinedDay',                  'CAMPAIGN_PLANNER',        'seed'),
  ('generateMasterContent',            'CONTENT_WRITER',          'seed'),
  ('generateContentForDay',            'CONTENT_WRITER',          'seed'),
  ('regenerateContent',                'CONTENT_WRITER',          'seed'),
  ('generateContentBlueprint',         'CONTENT_WRITER',          'seed'),
  ('generatePlatformVariants',         'CONTENT_WRITER',          'seed'),
  ('generateContentVariant',           'CONTENT_WRITER',          'seed'),
  ('refineVariant',                    'CONTENT_WRITER',          'seed'),
  ('generateContentAngles',            'CONTENT_WRITER',          'seed'),
  ('parsePlatformCustomization',       'CONTENT_WRITER',          'seed'),
  ('contentSuggestions',               'CONTENT_WRITER',          'seed'),
  ('generateLongFormSection',          'LONG_FORM_CONTENT',       'seed'),
  ('campaignContentAssist',            'CONTENT_WRITER',          'seed'),
  ('blogGeneration',                   'LONG_FORM_CONTENT',       'seed'),
  ('blogOptimization',                 'LONG_FORM_CONTENT',       'seed'),
  ('blogRepurpose',                    'LONG_FORM_CONTENT',       'seed'),
  ('blockEnrich',                      'LONG_FORM_CONTENT',       'seed'),
  ('newsletterGeneration',             'LONG_FORM_CONTENT',       'seed'),
  ('newsletterOptimization',           'LONG_FORM_CONTENT',       'seed'),
  ('blogAnalyticsInsight',             'GENERIC_COMPLETION',      'seed'),
  ('refineProblemTransformation',      'GENERIC_COMPLETION',      'seed'),
  ('profileEnrichment',                'GENERIC_COMPLETION',      'seed'),
  ('profileExtraction',                'GENERIC_COMPLETION',      'seed'),
  ('suggestCompetitors',               'COMPETITOR_INTELLIGENCE', 'seed'),
  ('suggestCompetitorsUnderstanding',  'COMPETITOR_INTELLIGENCE', 'seed'),
  ('chatModeration',                   'GENERIC_COMPLETION',      'seed'),
  ('extractPlannerCommands',           'GENERIC_COMPLETION',      'seed'),
  ('plannerSuggestUpdate',             'GENERIC_COMPLETION',      'seed'),
  ('conversationTriage',               'GENERIC_COMPLETION',      'seed'),
  ('conversationMemorySummary',        'GENERIC_COMPLETION',      'seed'),
  ('responseGeneration',               'CONTENT_WRITER',          'seed'),
  ('replyGeneration',                  'CONTENT_WRITER',          'seed'),
  ('engagement_reply_suggestions',     'CONTENT_WRITER',          'seed'),
  ('sentimentClassification',          'GENERIC_COMPLETION',      'seed'),
  ('generateContentIdeas',             'CONTENT_WRITER',          'seed'),
  ('creator.infographic.copy',         'CONTENT_CREATOR',         'seed'),
  ('creatorChatBrief',                 'CONTENT_CREATOR',         'seed'),
  ('creatorFieldAssist',               'CONTENT_CREATOR',         'seed'),
  ('creator_intake_ai_content',        'CONTENT_CREATOR',         'seed'),
  ('creator_marketing_packaging',      'CONTENT_CREATOR',         'seed'),
  ('creator_template_intent',          'CONTENT_CREATOR',         'seed')
ON CONFLICT (operation) DO NOTHING;

-- ── 4a. Model families backfilled from existing providers ─────────────────────
INSERT INTO public.ai_model_families (provider_id, family_key, display_name)
SELECT p.id, f.family_key, f.display_name
FROM public.llm_providers p
JOIN (VALUES ('openai', 'gpt-4o', 'GPT-4o family')) AS f(provider_name, family_key, display_name)
  ON p.name = f.provider_name
ON CONFLICT (provider_id, family_key) DO NOTHING;

-- ── 4b. One default model version per existing model (tag = model_key baseline) ─
INSERT INTO public.ai_model_versions (model_id, version_tag, is_default, status)
SELECT m.id, m.model_key, true, 'active'
FROM public.llm_models m
ON CONFLICT (model_id, version_tag) DO NOTHING;

-- ── 4c. Link openai models to the gpt-4o family (best-effort; nullable) ───────
UPDATE public.llm_models m
SET model_family_id = fam.id
FROM public.ai_model_families fam
JOIN public.llm_providers p ON p.id = fam.provider_id AND p.name = 'openai'
WHERE fam.family_key = 'gpt-4o'
  AND m.provider_id = p.id
  AND m.model_family_id IS NULL;

-- ── 5. Initial config version ─────────────────────────────────────────────────
INSERT INTO public.ai_config_versions (version, changed_table, changed_by, note)
SELECT 1, 'seed', 'system', 'AI-ORCH-2B.1 initial config version'
WHERE NOT EXISTS (SELECT 1 FROM public.ai_config_versions);

-- ── 6. Audit entry for the seed (config_change_logs integration) ──────────────
INSERT INTO public.config_change_logs (config_type, changed_by, before_json, after_json, note)
SELECT 'ai_orchestration_seed', 'system', NULL,
       jsonb_build_object(
         'profiles',    (SELECT count(*) FROM public.ai_execution_profiles),
         'bindings',    (SELECT count(*) FROM public.ai_capability_profile_bindings),
         'operations',  (SELECT count(*) FROM public.ai_operation_capability_map),
         'model_versions', (SELECT count(*) FROM public.ai_model_versions)
       ),
       'AI-ORCH-2B.1 seed applied (inert; no runtime consumer while flags OFF)'
WHERE NOT EXISTS (
  SELECT 1 FROM public.config_change_logs WHERE config_type = 'ai_orchestration_seed'
);
