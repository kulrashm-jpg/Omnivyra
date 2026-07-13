/**
 * capabilityRegistry.ts — the ONE canonical capability registry (AIC-001 §2).
 *
 * Every AI capability is defined HERE — identifier, description, required
 * knowledge, required tools, permissions, execution strategy, validation
 * strategy, output contract, supported models, config. No scattered capability
 * definitions. Pure frozen registry; new capabilities are added as configuration,
 * not new runtimes.
 */

import type { KnowledgeDomainId } from '../knowledge/companyKnowledgeModel';
import type { KnowledgeConsumerId, KnowledgeContextMode } from '../knowledgeConsumption/knowledgeContextContracts';
import type { CapabilityId } from './capabilityContracts';

export type ExecutionStrategy = 'single_pass' | 'plan_then_execute';

export interface CapabilityKnowledgeSpec {
  /** The CKC-001 consumer identity this capability requests knowledge as. */
  consumer: KnowledgeConsumerId;
  domains: KnowledgeDomainId[];
  minConfidence?: number;
  maxAgeMs?: number;
  mode?: KnowledgeContextMode;
}

export interface CapabilityValidationSpec {
  schema: boolean;
  business: boolean;
  grounding: boolean;
  hallucination: boolean;
  policy: boolean;
  /** Minimum acceptable output confidence (0–100). */
  confidenceThreshold: number;
}

export interface CapabilityDefinition {
  id: CapabilityId;
  description: string;
  knowledge: CapabilityKnowledgeSpec;
  /** Tool ids this capability may use (resolved against the tool registry). */
  tools: string[];
  /** Permissions the caller must hold (advisory — enforced by the caller/guard). */
  permissions: string[];
  executionStrategy: ExecutionStrategy;
  validation: CapabilityValidationSpec;
  /** Output-contract id (required top-level keys of the result object). */
  outputContract: string;
  supportedModels: string[];
  config: {
    defaultModel: string;
    temperature: number;
    maxOutputTokens: number;
    maxRetries: number;
    timeoutMs: number;
    partialAllowed: boolean;
    /** Optional fallback model used by recovery. */
    fallbackModel?: string;
  };
}

const MODELS = ['claude-sonnet-5', 'claude-opus-4-8', 'claude-haiku-4-5-20251001'];

function def(
  id: CapabilityId, description: string, consumer: KnowledgeConsumerId, domains: KnowledgeDomainId[],
  tools: string[], strategy: ExecutionStrategy, outputContract: string,
  overrides: Partial<CapabilityValidationSpec> = {}, config: Partial<CapabilityDefinition['config']> = {},
): CapabilityDefinition {
  return {
    id, description,
    knowledge: { consumer, domains, mode: 'summary' },
    tools, permissions: ['ai.execute'], executionStrategy: strategy,
    validation: { schema: true, business: false, grounding: true, hallucination: true, policy: true, confidenceThreshold: 40, ...overrides },
    outputContract,
    supportedModels: MODELS,
    config: { defaultModel: 'claude-sonnet-5', temperature: 0.4, maxOutputTokens: 2000, maxRetries: 2, timeoutMs: 60_000, partialAllowed: false, fallbackModel: 'claude-haiku-4-5-20251001', ...config },
  };
}

const REGISTRY_INTERNAL: Record<string, CapabilityDefinition> = {
  CONTENT_WRITER:          def('CONTENT_WRITER', 'Long/short-form copy generation.', 'CONTENT_WRITER', ['IDENTITY', 'BRAND', 'AUDIENCE', 'POSITIONING', 'MARKETING', 'PRODUCTS', 'SERVICES'], [], 'single_pass', 'content', { business: true }),
  CONTENT_CREATOR:         def('CONTENT_CREATOR', 'Visual/creator asset briefs.', 'CONTENT_CREATOR', ['IDENTITY', 'BRAND', 'AUDIENCE', 'PRODUCTS', 'SERVICES', 'SOCIAL'], [], 'single_pass', 'content'),
  CAMPAIGN_PLANNER:        def('CAMPAIGN_PLANNER', 'Campaign strategy + schedule planning.', 'CAMPAIGN_PLANNER', ['IDENTITY', 'AUDIENCE', 'POSITIONING', 'MARKETING', 'INDUSTRY', 'COMPETITORS', 'PRODUCTS', 'SERVICES'], [], 'plan_then_execute', 'plan', { business: true, confidenceThreshold: 50 }, { maxOutputTokens: 4000, partialAllowed: true }),
  STRATEGIC_MIX:           def('STRATEGIC_MIX', 'Channel/format mix optimization.', 'STRATEGIC_MIX', ['MARKETING', 'AUDIENCE', 'POSITIONING', 'INDUSTRY', 'SOCIAL'], [], 'single_pass', 'plan', { confidenceThreshold: 50 }),
  SEO_INTELLIGENCE:        def('SEO_INTELLIGENCE', 'SEO analysis + keyword intelligence.', 'SEO', ['IDENTITY', 'WEBSITE', 'SEO', 'INDUSTRY', 'PRODUCTS', 'SERVICES'], ['website_snapshot'], 'single_pass', 'analysis'),
  GROWTH_INTELLIGENCE:     def('GROWTH_INTELLIGENCE', 'Growth signal synthesis.', 'GROWTH_INTELLIGENCE', ['IDENTITY', 'AUDIENCE', 'MARKETING', 'INDUSTRY', 'COMPANY_INTELLIGENCE', 'COMPETITORS'], [], 'single_pass', 'analysis'),
  RECOMMENDATION_ENGINE:   def('RECOMMENDATION_ENGINE', 'Next-best-action recommendations.', 'RECOMMENDATION_ENGINE', ['IDENTITY', 'AUDIENCE', 'POSITIONING', 'MARKETING', 'PRODUCTS', 'SERVICES', 'COMPANY_INTELLIGENCE'], [], 'single_pass', 'recommendations', { business: true }),
  COMPETITOR_INTELLIGENCE: def('COMPETITOR_INTELLIGENCE', 'Competitor analysis.', 'COMPETITOR_INTELLIGENCE', ['IDENTITY', 'INDUSTRY', 'POSITIONING', 'COMPETITORS', 'PRODUCTS', 'SERVICES'], ['website_snapshot'], 'single_pass', 'analysis'),
  WEBSITE_INTELLIGENCE:    def('WEBSITE_INTELLIGENCE', 'Website intelligence synthesis.', 'WEBSITE_INTELLIGENCE', ['IDENTITY', 'WEBSITE', 'BRAND', 'SEO', 'METADATA'], ['website_snapshot'], 'single_pass', 'analysis'),
};
// WEBSITE_INTELLIGENCE consumes the full knowledge object (not summarized).
REGISTRY_INTERNAL.WEBSITE_INTELLIGENCE.knowledge.mode = 'full';

// PMF-001 — the migrated workspace Content Writer (platform-native written variants).
// Prompt + model + output parser are injected at call time (see backend/services/
// contentWriter) so generation behavior matches the legacy path. Validation is
// intentionally lenient (no confidence floor, no grounding gate) so the migrated
// path never rejects an output the legacy path would have returned.
REGISTRY_INTERNAL.CONTENT_WRITER_WORKSPACE = def(
  'CONTENT_WRITER_WORKSPACE', 'Generate platform-native written content variants.',
  'CONTENT_WRITER', ['IDENTITY', 'INDUSTRY', 'POSITIONING', 'BRAND', 'AUDIENCE', 'MARKETING', 'PRODUCTS', 'SERVICES'],
  [], 'single_pass', 'platform_variants',
  { grounding: false, business: false, policy: false, confidenceThreshold: 0 },
);
REGISTRY_INTERNAL.CONTENT_WRITER_WORKSPACE.supportedModels = ['gpt-4o-mini'];
REGISTRY_INTERNAL.CONTENT_WRITER_WORKSPACE.config.defaultModel = 'gpt-4o-mini';
REGISTRY_INTERNAL.CONTENT_WRITER_WORKSPACE.config.temperature = 0.72;
REGISTRY_INTERNAL.CONTENT_WRITER_WORKSPACE.config.maxOutputTokens = 4000;
REGISTRY_INTERNAL.CONTENT_WRITER_WORKSPACE.config.maxRetries = 1;
delete REGISTRY_INTERNAL.CONTENT_WRITER_WORKSPACE.config.fallbackModel; // no model fallback (parity)

// PMF-003 — the Long-form Content capability. Inference is performed by the EXISTING
// engine inside an injected model runner (zero prompt/quality change); AIC provides
// the pipeline (CKC knowledge, validation, telemetry, recovery, output contract).
// Validation is lenient and recovery is disabled so AIC never rejects or re-runs an
// engine result the legacy path would have returned (the engine owns its own repair).
REGISTRY_INTERNAL.LONG_FORM_CONTENT = def(
  'LONG_FORM_CONTENT', 'Generate long-form content (blog/article/guide/… via the long-form engine).',
  'CONTENT_WRITER', ['IDENTITY', 'INDUSTRY', 'POSITIONING', 'BRAND', 'AUDIENCE', 'MARKETING', 'PRODUCTS', 'SERVICES'],
  [], 'single_pass', 'long_form',
  { grounding: false, business: false, policy: false, hallucination: false, confidenceThreshold: 0 },
);
REGISTRY_INTERNAL.LONG_FORM_CONTENT.supportedModels = ['gpt-4o-mini'];
REGISTRY_INTERNAL.LONG_FORM_CONTENT.config.defaultModel = 'gpt-4o-mini';
REGISTRY_INTERNAL.LONG_FORM_CONTENT.config.maxRetries = 0;       // engine owns retries/repair
REGISTRY_INTERNAL.LONG_FORM_CONTENT.config.maxOutputTokens = 16384;
REGISTRY_INTERNAL.LONG_FORM_CONTENT.config.partialAllowed = true;
delete REGISTRY_INTERNAL.LONG_FORM_CONTENT.config.fallbackModel;

// PMF-004 — the Content Creator asset capability. Generation (LLM layout + render +
// storage) is performed by the EXISTING asset pipeline inside an injected model
// runner (zero prompt/quality change); AIC provides the pipeline (CKC knowledge,
// validation, telemetry, recovery, output contract). Validation is lenient and
// recovery is disabled so AIC never rejects or re-runs an asset the legacy path
// would have returned (the pipeline owns its own governance/diagnostics).
REGISTRY_INTERNAL.CREATOR_ASSET = def(
  'CREATOR_ASSET', 'Generate a Content Creator visual asset (image/carousel/… via the asset pipeline).',
  'CONTENT_CREATOR', ['IDENTITY', 'BRAND', 'AUDIENCE', 'PRODUCTS', 'SERVICES', 'SOCIAL'],
  [], 'single_pass', 'creator_asset',
  { grounding: false, business: false, policy: false, hallucination: false, confidenceThreshold: 0 },
);
REGISTRY_INTERNAL.CREATOR_ASSET.supportedModels = ['gpt-4o-mini'];
REGISTRY_INTERNAL.CREATOR_ASSET.config.defaultModel = 'gpt-4o-mini';
REGISTRY_INTERNAL.CREATOR_ASSET.config.maxRetries = 0;       // pipeline owns retries/governance
REGISTRY_INTERNAL.CREATOR_ASSET.config.partialAllowed = true;
delete REGISTRY_INTERNAL.CREATOR_ASSET.config.fallbackModel;

// PMF-005 — the Campaign Planner capability (the execution capability the Campaign
// Planner AIA agent runs each graph node through). Definitive plan generation is
// performed by the EXISTING planner engine inside an injected model runner (zero
// prompt/quality change); AIC provides the pipeline (CKC knowledge, validation,
// telemetry, recovery, output contract). Lenient + recovery off — the engine owns
// planner-contract enforcement, capacity, and retries.
REGISTRY_INTERNAL.CAMPAIGN_PLAN = def(
  'CAMPAIGN_PLAN', 'Execute a Campaign Planner capability-graph node (plan via the planner engine).',
  'CAMPAIGN_PLANNER', ['IDENTITY', 'AUDIENCE', 'POSITIONING', 'MARKETING', 'INDUSTRY', 'COMPETITORS', 'PRODUCTS', 'SERVICES'],
  [], 'plan_then_execute', 'campaign_plan',
  { grounding: false, business: false, policy: false, hallucination: false, confidenceThreshold: 0 },
);
REGISTRY_INTERNAL.CAMPAIGN_PLAN.supportedModels = ['gpt-4o-mini'];
REGISTRY_INTERNAL.CAMPAIGN_PLAN.config.defaultModel = 'gpt-4o-mini';
REGISTRY_INTERNAL.CAMPAIGN_PLAN.config.maxRetries = 0;       // engine owns retries/contract
REGISTRY_INTERNAL.CAMPAIGN_PLAN.config.partialAllowed = true;
delete REGISTRY_INTERNAL.CAMPAIGN_PLAN.config.fallbackModel;

// PMF-006 — the Strategic Mix capability (the execution capability the Strategic Mix
// AIA agent runs each Decision Graph node through). The definitive mix is produced by
// the EXISTING strategic-mix engine inside an injected model runner (zero strategy/
// recommendation change); AIC provides the pipeline (CKC knowledge, validation,
// telemetry, recovery, output contract). Lenient + recovery off — the engine owns its
// platform-authority / format-binding / distribution-floor rules and retries.
REGISTRY_INTERNAL.STRATEGIC_MIX_DECISION = def(
  'STRATEGIC_MIX_DECISION', 'Execute a Strategic Mix Decision Graph node (mix via the strategic-mix engine).',
  'STRATEGIC_MIX', ['MARKETING', 'AUDIENCE', 'POSITIONING', 'INDUSTRY', 'SOCIAL'],
  [], 'single_pass', 'strategic_mix',
  { grounding: false, business: false, policy: false, hallucination: false, confidenceThreshold: 0 },
);
REGISTRY_INTERNAL.STRATEGIC_MIX_DECISION.supportedModels = ['gpt-4o-mini'];
REGISTRY_INTERNAL.STRATEGIC_MIX_DECISION.config.defaultModel = 'gpt-4o-mini';
REGISTRY_INTERNAL.STRATEGIC_MIX_DECISION.config.maxRetries = 0;       // engine owns retries/rules
REGISTRY_INTERNAL.STRATEGIC_MIX_DECISION.config.partialAllowed = true;
delete REGISTRY_INTERNAL.STRATEGIC_MIX_DECISION.config.fallbackModel;

// PMF-007 — the Recommendation capability (the execution capability the Recommendation
// Engine AIA agent runs each graph node through). The definitive recommendations are
// produced by the EXISTING recommendation engine inside an injected model runner (zero
// recommendation change); AIC provides the pipeline (CKC knowledge, validation,
// telemetry, recovery, output contract). Lenient + recovery off — the engine owns its
// ranking / dedup / thresholds and retries.
REGISTRY_INTERNAL.RECOMMENDATION_DECISION = def(
  'RECOMMENDATION_DECISION', 'Execute a Recommendation Graph node (recommendations via the recommendation engine).',
  'RECOMMENDATION_ENGINE', ['IDENTITY', 'AUDIENCE', 'POSITIONING', 'MARKETING', 'PRODUCTS', 'SERVICES', 'COMPANY_INTELLIGENCE'],
  [], 'single_pass', 'recommendation_node',
  { grounding: false, business: false, policy: false, hallucination: false, confidenceThreshold: 0 },
);
REGISTRY_INTERNAL.RECOMMENDATION_DECISION.supportedModels = ['gpt-4o-mini'];
REGISTRY_INTERNAL.RECOMMENDATION_DECISION.config.defaultModel = 'gpt-4o-mini';
REGISTRY_INTERNAL.RECOMMENDATION_DECISION.config.maxRetries = 0;       // engine owns retries/ranking
REGISTRY_INTERNAL.RECOMMENDATION_DECISION.config.partialAllowed = true;
delete REGISTRY_INTERNAL.RECOMMENDATION_DECISION.config.fallbackModel;

export const CAPABILITY_REGISTRY: Readonly<Record<string, CapabilityDefinition>> = REGISTRY_INTERNAL;
export const REGISTERED_CAPABILITIES: ReadonlyArray<string> = Object.keys(REGISTRY_INTERNAL);

/** Resolve a capability definition, or null if unregistered. */
export function resolveCapability(id: CapabilityId): CapabilityDefinition | null {
  return REGISTRY_INTERNAL[id] ?? null;
}

/** True when the model is supported by the capability. */
export function isModelSupported(def: CapabilityDefinition, model: string): boolean {
  return def.supportedModels.includes(model);
}
