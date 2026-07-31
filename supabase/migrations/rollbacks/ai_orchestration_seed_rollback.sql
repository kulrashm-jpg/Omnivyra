-- =============================================================================
-- AI-ORCH-2B.1 — ROLLBACK of the AI Orchestration seed data.
--
-- Removes only the rows this seed inserted. Safe because the seed is inert
-- reference data with no runtime consumer in Phase 2B.1. Ordered to respect FKs.
-- (Dropping the tables via the foundation rollback also removes this data; this
--  file exists for a data-only reversal that keeps the empty schema in place.)
--
-- The llm_models.model_family_id linkage set by the seed is cleared for openai
-- rows before the families are removed.
--
-- NOT applied by this change — controlled migration process only.
-- =============================================================================

-- Audit + config version
DELETE FROM public.config_change_logs WHERE config_type = 'ai_orchestration_seed';
DELETE FROM public.ai_config_versions WHERE changed_table = 'seed' AND version = 1;

-- Operation map + bindings (seed-tagged / all, since 2B.1 created them all)
DELETE FROM public.ai_operation_capability_map WHERE notes = 'seed';
DELETE FROM public.ai_capability_profile_bindings
  WHERE scope IN ('platform_default','capability_default');

-- Unlink seeded model_family linkage, then remove versions + families.
UPDATE public.llm_models m
SET model_family_id = NULL
FROM public.ai_model_families fam
WHERE m.model_family_id = fam.id AND fam.family_key = 'gpt-4o';

DELETE FROM public.ai_model_versions ver
  USING public.llm_models m
  WHERE ver.model_id = m.id AND ver.version_tag = m.model_key;

DELETE FROM public.ai_model_families WHERE family_key = 'gpt-4o';

-- Profiles: clear the active-version pointer, drop versions, then profiles.
UPDATE public.ai_execution_profiles SET active_version_id = NULL
  WHERE key IN ('HIGH_QUALITY','BALANCED','ECONOMY','JSON_EXTRACTION','DEEP_REASONING',
                'CREATIVE_WRITING','GROUNDED_RESEARCH','VISION_ANALYSIS','IMAGE_GENERATION','MODERATION');

DELETE FROM public.ai_execution_profile_versions ver
  USING public.ai_execution_profiles p
  WHERE ver.profile_id = p.id
    AND p.key IN ('HIGH_QUALITY','BALANCED','ECONOMY','JSON_EXTRACTION','DEEP_REASONING',
                  'CREATIVE_WRITING','GROUNDED_RESEARCH','VISION_ANALYSIS','IMAGE_GENERATION','MODERATION');

DELETE FROM public.ai_execution_profiles
  WHERE key IN ('HIGH_QUALITY','BALANCED','ECONOMY','JSON_EXTRACTION','DEEP_REASONING',
                'CREATIVE_WRITING','GROUNDED_RESEARCH','VISION_ANALYSIS','IMAGE_GENERATION','MODERATION');
