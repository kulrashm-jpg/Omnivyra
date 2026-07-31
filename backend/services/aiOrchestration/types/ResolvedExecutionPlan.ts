/**
 * ResolvedExecutionPlan.ts — the resolver's OUTPUT plan (AI-ORCH 2A-2).
 *
 * INTERNAL ONLY. The fully-resolved execution configuration the ConfigurationResolver
 * produces for a (capability, org, operation). In shadow mode this is COMPUTED then
 * DISCARDED — it never drives execution, is never persisted. Legacy execution stays
 * authoritative.
 *
 * This is a type contract (one of the three allowed 2A-2 abstractions:
 * ConfigurationResolver, ResolvedExecutionPlan, ResolverComparator). Imported by the
 * resolver + comparator + their tests only.
 */
import type { ResolutionSource } from './ResolutionTrace';

export interface ResolvedProviderSelection {
  /** Resolved provider name (e.g. 'openai'). */
  provider?: string | null;
  /** Resolved model key (e.g. 'gpt-4o-mini'). */
  model?: string | null;
  /** Pinned model version tag, or null = provider default. */
  modelVersion?: string | null;
  /** Provider deployment id (Azure/self-host), or null. */
  deploymentId?: string | null;
}

export interface ResolvedExecutionParams {
  temperature?: number | null;
  topP?: number | null;
  maxOutputTokens?: number | null;
  reasoningLevel?: string | null;
  seedPolicy?: string | null;
  streaming?: boolean | null;
  structuredOutput?: boolean | null;
  responseFormat?: string | null;
  vision?: boolean | null;
  toolCalling?: boolean | null;
}

export interface ResolvedReliability {
  timeoutMs?: number | null;
  maxRetries?: number | null;
  retryPolicy?: string | null;
  partialAllowed?: boolean | null;
}

export interface ResolvedLimits {
  maxCostUsdPerCall?: number | null;
  tokenCeiling?: number | null;
}

export interface ResolvedCaching {
  cacheable?: boolean | null;
  ttlSeconds?: number | null;
}

export interface ResolvedExecutionPlan {
  // Identity of the resolution
  capabilityId: string;
  operation?: string | null;
  orgId?: string | null;

  // Profile
  profileId?: string | null;
  profileKey?: string | null;
  profileVersion?: number | null;

  // Provider / model / version / deployment
  model: ResolvedProviderSelection;

  // Execution configuration
  params: ResolvedExecutionParams;
  reliability: ResolvedReliability;
  limits: ResolvedLimits;
  caching: ResolvedCaching;

  // Routing + safety (references resolved from the frozen schema; content-only)
  routingPolicyId?: string | null;
  routingPolicyKey?: string | null;
  safety?: Record<string, unknown> | null;

  // Provenance + reproducibility
  configFingerprint?: string | null;
  /** Which precedence layer won. */
  source: ResolutionSource;
}
