-- =============================================================================
-- AI-ORCH-2B.1A — Resolution Reason (persistence model ONLY).
--
-- Phase 2B.1 records WHERE a configuration came from (usage_events.resolution_source
-- ∈ platform_default | org_default | capability_default | capability_override |
-- legacy_hardcoded). This migration adds the richer WHY: a reusable Resolution
-- Reason model that explains the selection.
--
-- The model is a { category, code, message, metadata } tuple:
--   - a queryable CATALOG of known reason codes (ai_resolution_reason_codes), and
--   - three nullable usage_events columns to RECORD the chosen reason at resolve
--     time in a LATER phase (resolution_reason_category / _code / _detail jsonb).
-- The free-form jsonb `detail` makes the model generic — future explanations need
-- NO schema change, only a new catalog row.
--
-- SCOPE: PERSISTENCE + CATALOG ONLY. No resolver, no runtime writer/reader. The
-- usage_events columns are INERT (nothing populates them in 2B.1A). Additive,
-- idempotent, reversible. Byte-identical runtime behavior.
--
-- NOT applied by this change — controlled migration process only.
-- =============================================================================

-- ── Catalog of known resolution reason codes ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_resolution_reason_codes (
  code             TEXT        PRIMARY KEY,          -- e.g. 'ORG_PINNED_MODEL'
  category         TEXT        NOT NULL,             -- e.g. 'OrganizationOverride'
  message_template TEXT        NOT NULL,             -- human-readable, may contain {placeholders}
  description      TEXT        NULL,
  is_active        BOOLEAN     NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_resolution_reason_category
  ON public.ai_resolution_reason_codes(category);

-- Category is intentionally a plain TEXT vocabulary (not a CHECK/enum) so future
-- categories require no schema redesign. Canonical categories today:
--   PlatformDefault · OrganizationOverride · OrganizationDefault ·
--   CapabilityDefault · CapabilityOverride · Governance · RequestHint · Legacy
INSERT INTO public.ai_resolution_reason_codes (code, category, message_template, description)
VALUES
  ('PLATFORM_DEFAULT_APPLIED',    'PlatformDefault',      'Platform default profile applied',                        'No more specific binding matched; the platform default was used.'),
  ('NO_ORG_OVERRIDE',             'PlatformDefault',      'No organization override found',                           'Fell through the org layer because the org has no binding.'),
  ('ORG_DEFAULT_APPLIED',         'OrganizationDefault',  'Organization default profile applied',                     'The org-wide default binding matched.'),
  ('ORG_PINNED_MODEL',            'OrganizationOverride', 'Organization has pinned {provider}/{model}',               'The org pinned an explicit provider/model via company_llm_configs.'),
  ('CAP_DEFAULT_APPLIED',         'CapabilityDefault',    'Capability default binding applied',                       'The platform capability_default binding matched.'),
  ('CAP_OVERRIDE_APPLIED',        'CapabilityOverride',   'Capability override applied for {capability}',             'An org+capability override binding matched (most specific).'),
  ('CAP_OVERRIDE_STRUCTURED',     'CapabilityOverride',   'Structured output required',                               'A capability required structured/JSON output, selecting a structured-capable profile.'),
  ('CAP_DEEP_REASONING',          'CapabilityOverride',   'Deep Reasoning capability selected',                       'A capability required deep reasoning, selecting the reasoning profile.'),
  ('PLAN_LIMIT_DOWNGRADE',        'Governance',           'Economy profile selected due to plan limits',              'Plan-tier governance downgraded the selection to an economy profile.'),
  ('BUDGET_DOWNGRADE',            'Governance',           'Model downgraded due to usage budget',                     'Usage-budget governance downgraded the model (aiModelRouter).'),
  ('HINT_STRUCTURED_REQUIRED',    'RequestHint',          'Request hint required structured output',                  'A caller hint tightened the plan to require structured output.'),
  ('HINT_VISION_REQUIRED',        'RequestHint',          'Request hint required vision',                             'A caller hint tightened the plan to require a vision-capable model.'),
  ('LEGACY_RESOLVER_UNAVAILABLE', 'Legacy',               'Resolver unavailable; legacy hardcoded default used',      'The resolver failed or was disabled; the legacy hardcoded default was used (fail-safe).'),
  ('LEGACY_UNMAPPED_OPERATION',   'Legacy',               'Operation not mapped; generic completion used',            'The operation had no capability mapping; GENERIC_COMPLETION was used.')
ON CONFLICT (code) DO NOTHING;

-- ── usage_events — record the chosen resolution reason (INERT until later) ────
-- Nullable, no default → fast catalog-only change. `resolution_source` from 2B.1
-- stays; these AUGMENT it with the WHY. `_detail` is a free-form bag for the
-- template's placeholder values (e.g. { "provider":"openai","model":"gpt-4o" }).
ALTER TABLE public.usage_events ADD COLUMN IF NOT EXISTS resolution_reason_code     TEXT  NULL;
ALTER TABLE public.usage_events ADD COLUMN IF NOT EXISTS resolution_reason_category TEXT  NULL;
ALTER TABLE public.usage_events ADD COLUMN IF NOT EXISTS resolution_reason_detail   JSONB NULL;

-- ── RLS (matches the admin-config convention) ────────────────────────────────
ALTER TABLE public.ai_resolution_reason_codes ENABLE ROW LEVEL SECURITY;
