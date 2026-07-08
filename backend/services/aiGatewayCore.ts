/** AI gateway — config, limits, operation labels, request shaping — split from aiGateway.ts (barrel preserved; importers unchanged). */
import OpenAI from 'openai';
import { randomUUID } from 'crypto';
import { config as appConfig } from '@/config';
import { supabase } from '../db/supabaseClient';
import { logger } from './logger';
import { getRequestContext } from './requestContext';
import { isBetaTextMockMode, createBetaMockCompletion } from './betaMockTextProvider';
import {
  acquire as distSemaphoreAcquire,
  release as distSemaphoreRelease,
  reloadPoolSizes as reloadDistPoolSizes,
  type PoolName as DistPoolName,
  type SemaphoreLease,
} from './distributedSemaphore';
import {
  acquire as providerTokenAcquire,
  markRequestStarted as markProviderTokenStarted,
  refund as refundProviderToken,
  type TokenReceipt,
  type ProviderName,
} from './providerTokenBucket';
import {
  acquireDistributed as acquireDistProviderToken,
  markDistributedRequestStarted as markDistProviderTokenStarted,
  refundDistributed as refundDistProviderToken,
  type DistributedTokenReceipt,
} from './distributedProviderTokenBucket';

import { logUsageEvent, resolveLlmCost } from './usageLedgerService';
import { recordProviderUsage } from './aiUsageCollector';
import { getCompanyLlmConfig, resolveCompanyApiKey, getActiveProviders, getModelsByProvider } from './llmProviderService';
import { incrementUsageMeter } from './usageMeterService';
import { checkUsageBeforeExecution } from './usageEnforcementService';
import { getCachedCompletion, setCachedCompletion, buildNormalizedKey } from './aiResponseCache';
import { resolveEffectiveModel } from './aiModelRouter';
import { recordGptCall, recordGptLatency, recordGptFailure } from './metricsCollector';
import { evaluateJobCost } from './jobCostEstimator';
import { trackLlmTokens } from '../../lib/redis/usageProtection';
import { ownedDbTable } from '../db/writeOwner';


export const UNKNOWN_ORG = '00000000-0000-0000-0000-000000000000';

/**
 * Maps every operation name to a user-facing product area label.
 * This is written to usage_events.feature_area on every LLM call so that
 * company admins and super admins can see cost broken down by feature.
 */
export const FEATURE_AREA_MAP: Record<string, string> = {
  // Company Profile
  refineProblemTransformation:       'Company Profile',
  profileEnrichment:                 'Company Profile',
  profileExtraction:                 'Company Profile',

  // Recommendations
  generateRecommendation:            'Recommendations',
  generateCampaignRecommendations:   'Recommendations',
  generateLongFormRecommendations:   'Recommendations',

  // Strategic Theme Cards
  generateAdditionalStrategicThemes: 'Strategic Theme Cards',

  // Campaign Planning (Week Plan)
  generateCampaignPlan:              'Campaign Planning',
  parsePlanToWeeks:                  'Campaign Planning',
  optimizeWeek:                      'Campaign Planning',
  previewStrategy:                   'Campaign Planning',
  prePlanningExplanation:            'Campaign Planning',
  suggestDuration:                   'Campaign Planning',
  refineCampaignIdea:                'Campaign Planning',

  // Daily Plan
  generateDailyPlan:                 'Daily Plan',
  generateDailyDistributionPlan:     'Daily Plan',
  parseRefinedDay:                   'Daily Plan',

  // Activity Workspace (content generation)
  generateLongFormSection:           'Activity Workspace',
  generateContentForDay:             'Activity Workspace',
  regenerateContent:                 'Activity Workspace',
  generateContentBlueprint:          'Activity Workspace',
  generatePlatformVariants:          'Activity Workspace',
  parsePlatformCustomization:        'Activity Workspace',
  contentSuggestions:                'Activity Workspace',

  // AI Chat / Planner Assistant
  chatModeration:                    'AI Chat',
  extractPlannerCommands:            'AI Chat',
  plannerSuggestUpdate:              'AI Chat',

  // Engagement
  conversationTriage:                'Engagement',
  conversationMemorySummary:         'Engagement',
  responseGeneration:                'Engagement',
  // User-initiated reply suggestions in the engagement inbox right-rail.
  // Lets the per-feature token-consumption report attribute these calls
  // correctly instead of dumping them in 'Other'.
  engagement_reply_suggestions:      'Engagement',

  // Insights
  generateContentIdeas:              'Insights',

  // Blog Repurposing
  blogRepurpose:                     'Blog Repurposing',

  // Blog Analytics AI
  blogAnalyticsInsight:              'Blog Analytics',

  // Blog Generation
  blogGeneration:                    'Blog Generation',

  // Blog Optimization (Regeneration Engine)
  blogOptimization:                  'Blog Generation',

  // Block-level AI Enrichment
  blockEnrich:                       'Blog Generation',
};

export type GatewayMetadata = {
  provider: 'direct-openai' | 'direct-anthropic';
  model: string;
  token_usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  } | null;
  reasoning_trace_id: string;
};

export type GatewayResponse<T> = {
  output: T;
  metadata: GatewayMetadata;
};

export type GatewayRequest = {
  companyId?: string | null;
  campaignId?: string | null;
  /**
   * Activity-consumption correlation envelope (correlation ONLY — never a
   * billing/credit/action key). `referenceType` is the SEMANTIC activity type
   * (e.g. 'bolt_run', 'campaign_plan', 'blog_generation'); `referenceId` is the
   * activity identifier (run_id/campaign_id/job_id/…); `parentActivityId` is an
   * optional run-grain parent for nested activities. Written through to
   * unified_transactions.reference_type / reference_id (+ metadata.parent_activity_id)
   * so all consumption for one activity is aggregatable by a single id.
   */
  referenceType?: string | null;
  referenceId?: string | null;
  parentActivityId?: string | null;
  model: string;
  temperature: number;
  response_format?: { type: 'json_object' };
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  /** Maximum output tokens. If unset, uses model default. */
  max_tokens?: number;
  /** Variant-scoped observability metadata supplied by adapters. */
  variantMetadata?: Record<string, unknown>;
  /** For prompt change tracking and token debugging. */
  prompt_template_name?: string | null;
  prompt_template_version?: string | null;
  prompt_template_hash?: string | null;
  /**
   * GAP 5: Cache version tag. Pass campaign.updated_at or profile.updated_at
   * to bust stale cache entries when inputs change without rewriting prompts.
   */
  cache_version?: string | null;
  /**
   * Caller-provided AbortSignal. When the signal aborts, the in-flight
   * provider request is cancelled, the concurrency slot is released
   * immediately, and `callProviderWithRetry` skips all retries / fallbacks.
   * Signal-bearing requests bypass the in-flight coalescing map so a single
   * caller's abort never affects others sharing the same prompt.
   */
  signal?: AbortSignal;
  /**
   * Optional pool hint for concurrency isolation. The planner sets this to
   * `'drafting' | 'alignment' | 'refinement' | 'repair'` so a long drafting
   * call cannot starve a fast alignment call. When unset, calls use the
   * `'default'` pool which keeps the legacy global behavior.
   */
  pool?: LlmPoolName;
  /**
   * If true, request streaming response from the provider. The full text is
   * still returned in `output` once complete, but `onChunk` is invoked for
   * every delta so callers can do progressive parsing / salvage. When abort
   * fires mid-stream, the accumulated text up to the abort point is exposed
   * via the `__partial_stream_output` property of the thrown error.
   *
   * STREAMING IS OPT-IN: this preserves the legacy non-streaming code path
   * for every caller that doesn't ask for streaming. The planner's drafting
   * phase is the primary consumer.
   */
  stream?: boolean;
  /**
   * Called on every streamed chunk with the delta and the accumulated text.
   * Throwing here does NOT cancel the stream — wrap your own try/catch.
   * Only invoked when `stream === true`.
   */
  onChunk?: (delta: string, accumulated: string) => void;
};

/**
 * Error subclass thrown when a streamed call is cancelled mid-flight. The
 * accumulated partial output is attached so the caller's salvage logic can
 * still use what was produced before the abort fired.
 */
export class GatewayPartialStreamError extends Error {
  code = 'PROVIDER_PARTIAL_STREAM' as const;
  status = 499;
  partialOutput: string;
  constructor(label: string, partialOutput: string) {
    super(`${label} aborted with ${partialOutput.length} chars buffered`);
    this.name = 'GatewayPartialStreamError';
    this.partialOutput = partialOutput;
  }
}

/**
 * Sentinel error thrown when a gateway call is aborted via its `signal`.
 * Carries `code: 'PROVIDER_ABORTED'` so retry / fallback layers can identify
 * cancellation without misclassifying it as a network or rate-limit error.
 */
export class GatewayAbortError extends Error {
  code = 'PROVIDER_ABORTED' as const;
  status = 499;
  constructor(label: string) {
    super(`${label} aborted by caller`);
    this.name = 'GatewayAbortError';
  }
}

export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: string }).code;
  const name = (err as { name?: string }).name;
  return code === 'PROVIDER_ABORTED' || name === 'AbortError' || name === 'GatewayAbortError';
}

// Singleton OpenAI client using platform default key — reuses HTTP pool.
// BYOK calls create ephemeral clients so they never share the singleton.
let _openAiClient: OpenAI | null = null;

// GAP 4: In-flight request coalescing map
// Key: normalized cache key → Promise<GatewayResponse<string>>
// Multiple callers with the same prompt within the same process share one API call.
export const _inFlight = new Map<string, Promise<GatewayResponse<string>>>();

// ── Shared timing helper (used by semaphore + retry) ─────────────────────────
export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
// Base timeout for short-form generation (post/tweet, small max_tokens). Long-form
// generation requests far larger max_tokens and cannot complete in 30s — see
// resolveProviderTimeoutMs below. This constant remains the floor/default.
const LLM_PROVIDER_TIMEOUT_MS = 30_000;

/**
 * Long-form-capable operations. These generate full articles / blogs /
 * newsletters / blueprints and routinely take 40–180s on gpt-4o(-mini).
 * CRITICAL: the content-creator path (generateMasterContent /
 * generateContentBlueprint) calls the gateway WITHOUT max_tokens, so a
 * token-based heuristic alone never widens their budget — they must be
 * recognised by operation name or they keep timing out at 30s. This was the
 * root cause of "can't create long-format content".
 */
const LONG_FORM_OPERATIONS = new Set<string>([
  'generateMasterContent',
  'generateContentBlueprint',
  'blogGeneration',
  'blogOptimization',
  'newsletterGeneration',
  // Phase 6C-4B: the campaign-plan call (aiPlanningService → generateCampaignPlan)
  // passes NO max_tokens, so the token heuristic alone never widened its budget —
  // it was getting the 30s short-form cap and timing out on large (8–12 week)
  // plans, then silently falling back to the deterministic placeholder plan.
  // Recognising it by operation name gives it the 240s long-form window (same
  // pattern as generateMasterContent). Token budget = provider default (uncapped),
  // sufficient for 12-week plans just as it is for full blogs/newsletters.
  'generateCampaignPlan',
]);

/**
 * The provider timeout must scale with the work. A 30s cap kills any long-form
 * (article/blog/newsletter/whitepaper) generation. Short-form (post/tweet and
 * small helper calls) keeps the original 30s budget so latency-sensitive paths
 * are unchanged.
 *
 * Resolution order:
 *   1. Known long-form operation        → 240s (covers no-max_tokens callers)
 *   2. max_tokens > 8192                → 240s
 *   3. max_tokens > 4096                → 120s
 *   4. otherwise                        → 30s (unchanged short-form default)
 */
export function resolveProviderTimeoutMs(maxTokens?: number, operation?: string): number {
  if (operation && LONG_FORM_OPERATIONS.has(operation)) return 240_000;
  if (maxTokens && maxTokens > 8192) return 240_000;
  if (maxTokens && maxTokens > 4096) return 120_000;
  return LLM_PROVIDER_TIMEOUT_MS;
}

function timeoutError(label: string, timeoutMs: number): Error & { code?: string; status?: number } {
  const error = new Error(`${label} timed out after ${timeoutMs}ms`) as Error & { code?: string; status?: number };
  error.code = 'PROVIDER_TIMEOUT';
  error.status = 504;
  return error;
}

// ── Concurrency semaphores (per-pool) ──────────────────────────────────────
// Prior to pool isolation, all LLM calls shared one global counter, so a slow
// drafting call would starve fast alignment-scoring calls. The pool-isolated
// model assigns each planner phase its own counter so long calls in one pool
// do not block calls in another.
//
// Pools are isolated by COUNTER only — they still share the same OpenAI /
// Anthropic API quota, fetch agent, and rate-limit headroom. The pool sizing
// must be tuned so the sum of all pool maxes does not exceed the provider
// QPS budget you actually have. Defaults are conservative and total to
// roughly the legacy `MAX_LLM_CONCURRENCY` when summed.
//
// Per-process. Cross-instance coordination is out of scope.

export type LlmPoolName =
  | 'drafting'
  | 'alignment'
  | 'refinement'
  | 'repair'
  | 'default';

type LlmPoolState = {
  name: LlmPoolName;
  maxAllowed: number;
  activeCalls: number;
  pendingAcquires: number;
  recentWaitMsSamples: number[];
};

const RECENT_WAIT_SAMPLE_LIMIT = 32;

const LEGACY_MAX_LLM = Math.max(1, appConfig.MAX_LLM_CONCURRENCY || 5);

// Per-pool size envs. Each falls back to the legacy global if unset so a
// rollout without any env-var change keeps today's total capacity.
function poolEnvMax(envName: string, fallback: number): number {
  const raw = process.env[envName];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

export const _pools: Record<LlmPoolName, LlmPoolState> = {
  drafting: {
    name: 'drafting',
    maxAllowed: poolEnvMax('MAX_DRAFTING_CONCURRENCY', LEGACY_MAX_LLM),
    activeCalls: 0,
    pendingAcquires: 0,
    recentWaitMsSamples: [],
  },
  alignment: {
    name: 'alignment',
    maxAllowed: poolEnvMax('MAX_ALIGNMENT_CONCURRENCY', LEGACY_MAX_LLM),
    activeCalls: 0,
    pendingAcquires: 0,
    recentWaitMsSamples: [],
  },
  refinement: {
    name: 'refinement',
    maxAllowed: poolEnvMax('MAX_REFINEMENT_CONCURRENCY', LEGACY_MAX_LLM),
    activeCalls: 0,
    pendingAcquires: 0,
    recentWaitMsSamples: [],
  },
  repair: {
    name: 'repair',
    maxAllowed: poolEnvMax('MAX_REPAIR_CONCURRENCY', LEGACY_MAX_LLM),
    activeCalls: 0,
    pendingAcquires: 0,
    recentWaitMsSamples: [],
  },
  default: {
    name: 'default',
    maxAllowed: LEGACY_MAX_LLM,
    activeCalls: 0,
    pendingAcquires: 0,
    recentWaitMsSamples: [],
  },
};

// Re-evaluate pool sizes from env. Useful for tests that set envs after import.
// Returns the new sizes so callers can assert against them.
// Reloads BOTH the local per-process pool AND the distributed semaphore's
// view of pool sizes so a hot env-change takes effect across the cluster
// (for new acquisitions; in-flight leases keep their original size).
export function reloadLlmPoolSizes(): Record<LlmPoolName, number> {
  _pools.drafting.maxAllowed   = poolEnvMax('MAX_DRAFTING_CONCURRENCY', LEGACY_MAX_LLM);
  _pools.alignment.maxAllowed  = poolEnvMax('MAX_ALIGNMENT_CONCURRENCY', LEGACY_MAX_LLM);
  _pools.refinement.maxAllowed = poolEnvMax('MAX_REFINEMENT_CONCURRENCY', LEGACY_MAX_LLM);
  _pools.repair.maxAllowed     = poolEnvMax('MAX_REPAIR_CONCURRENCY', LEGACY_MAX_LLM);
  // `default` stays on the legacy env so non-planner callers are unchanged.
  try { reloadDistPoolSizes(); } catch { /* distributed module may not be ready in tests */ }
  return {
    drafting:   _pools.drafting.maxAllowed,
    alignment:  _pools.alignment.maxAllowed,
    refinement: _pools.refinement.maxAllowed,
    repair:     _pools.repair.maxAllowed,
    default:    _pools.default.maxAllowed,
  };
}

function recordWaitSample(pool: LlmPoolState, waitMs: number): void {
  pool.recentWaitMsSamples.push(waitMs);
  if (pool.recentWaitMsSamples.length > RECENT_WAIT_SAMPLE_LIMIT) {
    pool.recentWaitMsSamples.shift();
  }
}

function poolAvgWaitMs(pool: LlmPoolState): number {
  if (!pool.recentWaitMsSamples.length) return 0;
  return Math.round(
    pool.recentWaitMsSamples.reduce((a, b) => a + b, 0) /
      pool.recentWaitMsSamples.length,
  );
}

/**
 * Snapshot of current LLM-pool pressure for the planner's overload mode.
 *
 * Without args: aggregates across every pool. With `poolName`: returns the
 * single pool's state. Cheap O(1) reads, no I/O.
 */
export function getLlmPoolPressure(poolName?: LlmPoolName): {
  pool: LlmPoolName | 'all';
  activeCalls: number;
  pendingAcquires: number;
  maxAllowed: number;
  recentAvgWaitMs: number;
} {
  if (poolName) {
    const p = _pools[poolName];
    return {
      pool: poolName,
      activeCalls: p.activeCalls,
      pendingAcquires: p.pendingAcquires,
      maxAllowed: p.maxAllowed,
      recentAvgWaitMs: poolAvgWaitMs(p),
    };
  }
  const all = Object.values(_pools);
  const activeCalls     = all.reduce((sum, p) => sum + p.activeCalls, 0);
  const pendingAcquires = all.reduce((sum, p) => sum + p.pendingAcquires, 0);
  const maxAllowed      = all.reduce((sum, p) => sum + p.maxAllowed, 0);
  const samples = all.flatMap((p) => p.recentWaitMsSamples);
  const recentAvgWaitMs = samples.length
    ? Math.round(samples.reduce((a, b) => a + b, 0) / samples.length)
    : 0;
  return {
    pool: 'all',
    activeCalls,
    pendingAcquires,
    maxAllowed,
    recentAvgWaitMs,
  };
}

function resolvePool(name?: LlmPoolName): LlmPoolState {
  if (!name || !_pools[name]) return _pools.default;
  return _pools[name];
}

export async function acquireSlot(
  operation: string,
  signal?: AbortSignal,
  poolName?: LlmPoolName,
): Promise<{ waitMs: number; pool: LlmPoolName; slotNumber: number }> {
  const pool = resolvePool(poolName);
  const waitStart = Date.now();
  if (signal?.aborted) throw new GatewayAbortError(operation);
  pool.pendingAcquires++;
  try {
    while (pool.activeCalls >= pool.maxAllowed) {
      if (signal?.aborted) throw new GatewayAbortError(operation);
      await sleep(50);
    }
    pool.activeCalls++;
  } finally {
    pool.pendingAcquires = Math.max(0, pool.pendingAcquires - 1);
  }
  const waitMs = Date.now() - waitStart;
  recordWaitSample(pool, waitMs);
  if (waitMs > 0 && process.env.NODE_ENV !== 'test') {
    console.info('[ai-gateway] concurrency-wait', {
      operation,
      pool: pool.name,
      waitMs,
      activeCalls: pool.activeCalls,
      maxAllowed: pool.maxAllowed,
      pendingAcquires: pool.pendingAcquires,
    });
  }
  return { waitMs, pool: pool.name, slotNumber: pool.activeCalls };
}

export function releaseSlot(poolName?: LlmPoolName): void {
  const pool = resolvePool(poolName);
  pool.activeCalls = Math.max(0, pool.activeCalls - 1);
}

const getOpenAiClient = (apiKey?: string): OpenAI => {
  // BYOK: create an ephemeral client so it never pollutes the singleton.
  if (apiKey && apiKey !== appConfig.OPENAI_API_KEY) {
    return new OpenAI({ apiKey });
  }
  if (!_openAiClient) {
    const key = appConfig.OPENAI_API_KEY;
    if (!key) throw new Error('Missing OPENAI_API_KEY');
    _openAiClient = new OpenAI({ apiKey: key });
  }
  return _openAiClient;
};

// ── Dynamic LLM config resolution ────────────────────────────────────────────

type ResolvedLlmConfig = {
  provider: 'openai' | 'anthropic';
  model: string;
  apiKey: string;
  /** true = company supplied their own key; false = platform env key */
  isByok: boolean;
  /** true = company has an explicit config row; false = platform default */
  isCompanyConfig: boolean;
};

function platformDefault(): ResolvedLlmConfig {
  return {
    provider: 'openai',
    model: appConfig.OPENAI_MODEL,
    apiKey: appConfig.OPENAI_API_KEY || '',
    isByok: false,
    isCompanyConfig: false,
  };
}

export async function resolveLlmConfig(
  companyId: string | null | undefined,
): Promise<ResolvedLlmConfig> {
  if (!companyId || companyId === UNKNOWN_ORG) return platformDefault();
  try {
    const config = await getCompanyLlmConfig(companyId);
    if (!config || !config.is_active) return platformDefault();

    const { key, source } = await resolveCompanyApiKey(companyId, config.provider_name);
    const provider = config.provider_name as 'openai' | 'anthropic';
    return {
      provider,
      model: config.model_key,
      apiKey: key,
      isByok: source === 'company',
      isCompanyConfig: true,
    };
  } catch (err) {
    console.warn('[ai-gateway] resolveLlmConfig failed, using platform default:', (err as Error)?.message);
    return platformDefault();
  }
}

// ── Provider-specific callers ─────────────────────────────────────────────────

export type NormalizedCompletion = {
  content: string;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null;
};

export async function callOpenAi(params: {
  apiKey: string;
  model: string;
  temperature: number;
  messages: GatewayRequest['messages'];
  response_format?: GatewayRequest['response_format'];
  max_tokens?: number;
  operation?: string;
  signal?: AbortSignal;
  pool?: LlmPoolName;
  stream?: boolean;
  onChunk?: (delta: string, accumulated: string) => void;
}): Promise<NormalizedCompletion> {
  const client = getOpenAiClient(params.apiKey);
  const timeoutMs = resolveProviderTimeoutMs(params.max_tokens, params.operation);
  if (params.signal?.aborted) throw new GatewayAbortError(params.operation || 'openai');

  // ── Streaming path (opt-in) ─────────────────────────────────────────────
  // Used by the planner's drafting phase so partial output is available to
  // salvage even if the abort fires mid-generation. Throws a
  // GatewayPartialStreamError on abort, carrying the accumulated text.
  if (params.stream) {
    let accumulated = '';
    let finishReason: string | null = null;
    let usage: NormalizedCompletion['usage'] = null;
    try {
      const stream = await client.chat.completions.create(
        {
          model: params.model,
          temperature: params.temperature,
          response_format: params.response_format,
          messages: params.messages,
          stream: true,
          stream_options: { include_usage: true },
          ...(params.max_tokens ? { max_tokens: params.max_tokens } : {}),
        },
        { timeout: timeoutMs, signal: params.signal },
      );
      for await (const part of stream as AsyncIterable<{ choices: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }>; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }>) {
        // Abort check inside the loop so we tear down promptly.
        if (params.signal?.aborted) {
          throw new GatewayPartialStreamError(params.operation || 'openai', accumulated);
        }
        const choice = part.choices?.[0];
        const delta = choice?.delta?.content ?? '';
        if (delta) {
          accumulated += delta;
          if (params.onChunk) {
            try { params.onChunk(delta, accumulated); } catch { /* observer errors swallowed */ }
          }
        }
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        if (part.usage) {
          usage = {
            prompt_tokens:    part.usage.prompt_tokens ?? 0,
            completion_tokens: part.usage.completion_tokens ?? 0,
            total_tokens:     part.usage.total_tokens ?? 0,
          };
        }
      }
    } catch (err: unknown) {
      if (
        params.signal?.aborted ||
        (err as { name?: string })?.name === 'AbortError' ||
        (err as { type?: string })?.type === 'aborted'
      ) {
        // Preserve any partial output for the salvage layer.
        if (accumulated.length > 0) {
          throw new GatewayPartialStreamError(params.operation || 'openai', accumulated);
        }
        throw new GatewayAbortError(params.operation || 'openai');
      }
      throw err;
    }
    if (finishReason === 'length' && process.env.NODE_ENV !== 'test') {
      console.warn('[ai-gateway] output-truncated', {
        provider: 'openai',
        model: params.model,
        max_tokens: params.max_tokens,
        stream: true,
        reason: 'finish_reason=length — output hit max_tokens cap and was truncated',
      });
    }
    return { content: accumulated.trim(), usage };
  }

  // ── Non-streaming path (legacy default) ─────────────────────────────────
  let completion: Awaited<ReturnType<typeof client.chat.completions.create>>;
  try {
    completion = await client.chat.completions.create(
      {
        model: params.model,
        temperature: params.temperature,
        response_format: params.response_format,
        messages: params.messages,
        ...(params.max_tokens ? { max_tokens: params.max_tokens } : {}),
      },
      { timeout: timeoutMs, signal: params.signal },
    );
  } catch (err: unknown) {
    // Normalize SDK abort errors so the upstream retry/fallback layer can
    // identify cancellation deterministically and skip retries.
    if (
      params.signal?.aborted ||
      (err as { name?: string })?.name === 'AbortError' ||
      (err as { type?: string })?.type === 'aborted'
    ) {
      throw new GatewayAbortError(params.operation || 'openai');
    }
    throw err;
  }
  const content = completion.choices?.[0]?.message?.content?.trim() || '';
  const u = completion.usage;
  // Truncation detection: a response that stopped because it hit the token
  // budget ships incomplete long-form content silently. Surface it so callers
  // (and ops logs) can see why an article looks cut off.
  const finishReason = completion.choices?.[0]?.finish_reason;
  if (finishReason === 'length' && process.env.NODE_ENV !== 'test') {
    console.warn('[ai-gateway] output-truncated', {
      provider: 'openai',
      model: params.model,
      max_tokens: params.max_tokens,
      completion_tokens: u?.completion_tokens ?? null,
      reason: 'finish_reason=length — output hit max_tokens cap and was truncated',
    });
  }
  return {
    content,
    usage: u
      ? { prompt_tokens: u.prompt_tokens, completion_tokens: u.completion_tokens, total_tokens: u.total_tokens }
      : null,
  };
}

/**
 * SSE streaming variant for Anthropic. Parses `event: <type>\ndata: <json>\n\n`
 * blocks, accumulates text deltas, and surfaces:
 *   - GatewayPartialStreamError on caller abort, carrying the accumulated text
 *   - GatewayPartialStreamError on local timeout (same shape so the salvage
 *     layer doesn't have to branch on provider)
 *   - the final NormalizedCompletion on `message_stop` event
 *
 * Behavior parity with `callOpenAi` streaming:
 *   - heartbeat-compatible (the loop awaits each chunk read)
 *   - cancellation-aware (signal abort check on every iteration)
 *   - partial accumulation (every text delta appended)
 *   - usage extraction (from `message_delta.usage`)
 */
async function callAnthropicStream(params: {
  apiKey: string;
  model: string;
  temperature: number;
  max_tokens?: number;
  operation?: string;
  signal?: AbortSignal;
  onChunk?: (delta: string, accumulated: string) => void;
  systemMsg: GatewayRequest['messages'][number] | undefined;
  userMessages: GatewayRequest['messages'];
}): Promise<NormalizedCompletion> {
  const op = params.operation || 'anthropic';
  const controller = new AbortController();
  const timeoutMs = resolveProviderTimeoutMs(params.max_tokens, params.operation);
  const timeout = setTimeout(
    () => controller.abort(timeoutError('Anthropic stream', timeoutMs)),
    timeoutMs,
  );
  const onCallerAbort = (): void => {
    try { controller.abort(); } catch { /* already aborted */ }
  };
  if (params.signal) {
    params.signal.addEventListener('abort', onCallerAbort, { once: true });
  }

  let accumulated = '';
  let finishReason: string | null = null;
  let usage: NormalizedCompletion['usage'] = null;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'x-api-key': params.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model: params.model,
        max_tokens: params.max_tokens ?? 4096,
        temperature: params.temperature,
        stream: true,
        ...(params.systemMsg ? { system: params.systemMsg.content } : {}),
        messages: params.userMessages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const err = new Error(`Anthropic API error ${response.status}: ${body}`) as Error & { status?: number };
      err.status = response.status;
      throw err;
    }
    if (!response.body) {
      throw new Error('Anthropic stream returned no body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      if (params.signal?.aborted) {
        try { reader.cancel(); } catch { /* noop */ }
        throw new GatewayPartialStreamError(op, accumulated);
      }
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE events are separated by `\n\n`. Process every complete event in
      // the buffer; keep any trailing partial for the next read.
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const eventBlock = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        // Each block has lines like `event: content_block_delta` and
        // `data: { ... }`. We only need the data payload.
        const lines = eventBlock.split('\n');
        let eventType = '';
        let dataLine = '';
        for (const line of lines) {
          if (line.startsWith('event:')) eventType = line.slice('event:'.length).trim();
          else if (line.startsWith('data:')) dataLine = line.slice('data:'.length).trim();
        }
        if (!dataLine || dataLine === '[DONE]') continue;
        let parsed: any;
        try { parsed = JSON.parse(dataLine); } catch { continue; }
        switch (eventType || parsed?.type) {
          case 'content_block_delta': {
            const delta = parsed?.delta?.text ?? '';
            if (delta) {
              accumulated += delta;
              if (params.onChunk) {
                try { params.onChunk(delta, accumulated); } catch { /* swallow observer errors */ }
              }
            }
            break;
          }
          case 'message_delta': {
            if (parsed?.delta?.stop_reason) {
              finishReason = parsed.delta.stop_reason;
            }
            if (parsed?.usage) {
              usage = {
                prompt_tokens:    parsed.usage.input_tokens  ?? usage?.prompt_tokens ?? 0,
                completion_tokens: parsed.usage.output_tokens ?? usage?.completion_tokens ?? 0,
                total_tokens:     (parsed.usage.input_tokens ?? 0) + (parsed.usage.output_tokens ?? 0),
              };
            }
            break;
          }
          case 'message_start': {
            if (parsed?.message?.usage) {
              usage = {
                prompt_tokens:    parsed.message.usage.input_tokens ?? 0,
                completion_tokens: parsed.message.usage.output_tokens ?? 0,
                total_tokens:     (parsed.message.usage.input_tokens ?? 0) + (parsed.message.usage.output_tokens ?? 0),
              };
            }
            break;
          }
          case 'error': {
            throw new Error(`Anthropic stream error: ${parsed?.error?.message ?? 'unknown'}`);
          }
          // message_stop / content_block_start / content_block_stop / ping:
          // no action needed.
          default:
            break;
        }
      }
    }

    if (finishReason === 'max_tokens' && process.env.NODE_ENV !== 'test') {
      console.warn('[ai-gateway] output-truncated', {
        provider: 'anthropic',
        model: params.model,
        max_tokens: params.max_tokens,
        stream: true,
        reason: 'stop_reason=max_tokens — stream hit max_tokens cap',
      });
    }

    return { content: accumulated.trim(), usage };
  } catch (err: unknown) {
    // Caller abort + local timeout collapse to a partial-stream error so the
    // salvage layer can use what we accumulated. Real errors (non-abort) are
    // re-thrown unchanged so the retry/fallback layer can react.
    if (params.signal?.aborted) {
      if (accumulated.length > 0) {
        throw new GatewayPartialStreamError(op, accumulated);
      }
      throw new GatewayAbortError(op);
    }
    if ((err as Error)?.name === 'AbortError') {
      if (accumulated.length > 0) {
        throw new GatewayPartialStreamError(op, accumulated);
      }
      throw timeoutError('Anthropic stream', timeoutMs);
    }
    if (err instanceof GatewayPartialStreamError) throw err;
    throw err;
  } finally {
    clearTimeout(timeout);
    if (params.signal) {
      params.signal.removeEventListener('abort', onCallerAbort);
    }
  }
}

export async function callAnthropic(params: {
  apiKey: string;
  model: string;
  temperature: number;
  messages: GatewayRequest['messages'];
  max_tokens?: number;
  operation?: string;
  signal?: AbortSignal;
  pool?: LlmPoolName;
  stream?: boolean;
  onChunk?: (delta: string, accumulated: string) => void;
}): Promise<NormalizedCompletion> {
  // Separate system message (Anthropic requires it top-level)
  const systemMsg = params.messages.find((m) => m.role === 'system');
  const userMessages = params.messages.filter((m) => m.role !== 'system');

  if (params.signal?.aborted) throw new GatewayAbortError(params.operation || 'anthropic');

  // ── Streaming path (parity with OpenAI streaming) ──────────────────────
  // Anthropic exposes SSE: each event is `event: <type>\ndata: <json>\n\n`.
  // Event types we care about: `content_block_delta` (text chunks) and
  // `message_delta` (final stop_reason + usage). On caller abort we throw
  // GatewayPartialStreamError carrying the accumulated text so the salvage
  // layer can use the partial output.
  if (params.stream) {
    return callAnthropicStream({
      ...params,
      systemMsg,
      userMessages,
    });
  }

  const controller = new AbortController();
  const timeoutMs = resolveProviderTimeoutMs(params.max_tokens, params.operation);
  const timeout = setTimeout(() => controller.abort(timeoutError('Anthropic request', timeoutMs)), timeoutMs);
  // Forward caller cancellation: if the outer signal aborts, propagate to our
  // local controller so the in-flight fetch is cancelled at the network layer.
  // We register the listener once and detach it in `finally` to avoid leaking
  // a reference to the outer signal after the call completes.
  const onCallerAbort = (): void => {
    try { controller.abort(); } catch { /* already aborted */ }
  };
  if (params.signal) {
    params.signal.addEventListener('abort', onCallerAbort, { once: true });
  }
  let response: Response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'x-api-key': params.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: params.model,
        max_tokens: params.max_tokens ?? 4096,
        temperature: params.temperature,
        ...(systemMsg ? { system: systemMsg.content } : {}),
        messages: userMessages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });
  } catch (error) {
    // Caller-initiated abort takes priority over the local timeout: we
    // throw GatewayAbortError so retry / fallback skip this call.
    if (params.signal?.aborted) throw new GatewayAbortError(params.operation || 'anthropic');
    if ((error as Error).name === 'AbortError') throw timeoutError('Anthropic request', timeoutMs);
    throw error;
  } finally {
    clearTimeout(timeout);
    if (params.signal) {
      params.signal.removeEventListener('abort', onCallerAbort);
    }
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const err = new Error(`Anthropic API error ${response.status}: ${body}`) as Error & { status?: number };
    err.status = response.status;
    throw err;
  }

  const data = await response.json();
  const content = (data.content?.[0]?.text ?? '').trim();
  const u = data.usage;
  if (data.stop_reason === 'max_tokens' && process.env.NODE_ENV !== 'test') {
    console.warn('[ai-gateway] output-truncated', {
      provider: 'anthropic',
      model: params.model,
      max_tokens: params.max_tokens,
      completion_tokens: u?.output_tokens ?? null,
      reason: 'stop_reason=max_tokens — output hit max_tokens cap and was truncated',
    });
  }
  return {
    content,
    usage: u
      ? {
          prompt_tokens:    u.input_tokens  ?? 0,
          completion_tokens: u.output_tokens ?? 0,
          total_tokens:     (u.input_tokens ?? 0) + (u.output_tokens ?? 0),
        }
      : null,
  };
}

// ── Retry helpers ─────────────────────────────────────────────────────────────

