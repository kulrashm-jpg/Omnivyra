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
