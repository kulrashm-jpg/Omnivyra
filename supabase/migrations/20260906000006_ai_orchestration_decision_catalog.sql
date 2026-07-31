-- =============================================================================
-- AI-ORCH-2B.1B — Resolution Decision Catalog (persistence ONLY).
--
-- The Resolution REASON catalog (2B.1A) explains WHY a configuration was chosen.
-- This catalog explains WHAT decision was made (select profile, select model,
-- downgrade model, enable streaming, fallback provider, …). Same shape as the
-- reason catalog: { code, category, message_template, description }.
--
-- SCOPE: PERSISTENCE + CATALOG ONLY. No resolver, no runtime writer/reader. The
-- codes are NOT hardcoded in application logic — they live here, queryable. The
-- future resolver/observability phases reference these codes when emitting a
-- ResolutionTrace (see backend/services/aiOrchestration/types/ResolutionTrace.ts).
--
-- Additive, idempotent, reversible. Byte-identical runtime behavior. The 2B.1A
-- reason catalog is NOT touched (rule 13).
--
-- NOT applied by this change — controlled migration process only.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.ai_resolution_decision_codes (
  code             TEXT        PRIMARY KEY,          -- e.g. 'SELECT_MODEL'
  category         TEXT        NOT NULL,             -- e.g. 'ModelSelection'
  message_template TEXT        NOT NULL,             -- human-readable, may contain {placeholders}
  description      TEXT        NULL,
  is_active        BOOLEAN     NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_resolution_decision_category
  ON public.ai_resolution_decision_codes(category);

-- Category is plain TEXT (no enum/CHECK) so new decisions require no schema change.
INSERT INTO public.ai_resolution_decision_codes (code, category, message_template, description)
VALUES
  ('SELECT_PROFILE',           'ProfileSelection',  'Selected execution profile {profile}',               'The resolver chose an execution profile for the capability.'),
  ('SELECT_PROVIDER',          'ProviderSelection', 'Selected provider {provider}',                       'The resolver chose the serving provider.'),
  ('SELECT_MODEL',             'ModelSelection',    'Selected model {model}',                             'The resolver chose the model.'),
  ('SELECT_MODEL_VERSION',     'VersionSelection',  'Selected model version {version}',                   'The resolver pinned/selected a model version.'),
  ('USE_PLATFORM_DEFAULT',     'ScopeSelection',    'Used platform default binding',                      'No more specific binding matched.'),
  ('USE_ORG_DEFAULT',          'ScopeSelection',    'Used organization default binding',                  'The org-wide default binding matched.'),
  ('USE_CAPABILITY_DEFAULT',   'ScopeSelection',    'Used capability default binding',                    'The platform capability_default binding matched.'),
  ('USE_OVERRIDE',             'ScopeSelection',    'Used capability override binding',                    'An org+capability override binding matched (most specific).'),
  ('DOWNGRADE_MODEL',          'ModelAdjustment',   'Downgraded model to {model}',                        'Governance (plan/budget) downgraded the model.'),
  ('UPGRADE_MODEL',            'ModelAdjustment',   'Upgraded model to {model}',                          'The plan/tier allowed a higher-capability model.'),
  ('SELECT_ROUTING_POLICY',    'Routing',           'Selected routing policy {policy}',                   'The resolver attached a provider routing policy.'),
  ('ENABLE_STREAMING',         'Modality',          'Enabled streaming',                                  'The profile/hint enabled streaming.'),
  ('DISABLE_STREAMING',        'Modality',          'Disabled streaming',                                 'The profile/provider disabled streaming.'),
  ('ENABLE_STRUCTURED_OUTPUT', 'Modality',          'Enabled structured output',                          'The profile/hint required structured/JSON output.'),
  ('ENABLE_VISION',            'Modality',          'Enabled vision',                                     'The profile/hint required a vision-capable model.'),
  ('ENABLE_REASONING',         'Reasoning',         'Enabled reasoning ({level})',                        'The profile requested a reasoning level.'),
  ('FALLBACK_PROVIDER',        'Fallback',          'Fell back to provider {provider}',                   'The primary provider failed; the routing chain advanced.'),
  ('LEGACY_SELECTION',         'Legacy',            'Legacy hardcoded selection used',                    'The resolver was unavailable/disabled; legacy default used.')
ON CONFLICT (code) DO NOTHING;

-- RLS (matches the admin-config convention)
ALTER TABLE public.ai_resolution_decision_codes ENABLE ROW LEVEL SECURITY;
