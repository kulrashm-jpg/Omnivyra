/** AI gateway — provider retry/fallback, error classification — split from aiGatewayProviders.ts (barrel preserved; importers unchanged). */
/** TEMP — split from aiGateway.ts (barrel preserved; importers unchanged). */
import OpenAI from 'openai';
import { randomUUID } from 'crypto';
import { config as appConfig } from '@/config';
import { getOrCreateCircuitBreaker } from '../../lib/resilience/circuitBreaker';
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
// WAVE-1D-001 §C1: canonical retry policy + error normalization (deterministic).
import { classifyProviderError, computeBackoffMs } from './ai/safety';
import { recordRawCounter, recordRawHistogram } from '../observability';
import { getCompanyLlmConfig, resolveCompanyApiKey, getActiveProviders, getModelsByProvider } from './llmProviderService';
import { incrementUsageMeter } from './usageMeterService';
import { checkUsageBeforeExecution } from './usageEnforcementService';
import { getCachedCompletion, setCachedCompletion, buildNormalizedKey } from './aiResponseCache';
import { resolveEffectiveModel } from './aiModelRouter';
import { recordGptCall, recordGptLatency, recordGptFailure } from './metricsCollector';
import { evaluateJobCost } from './jobCostEstimator';
import { trackLlmTokens } from '../../lib/redis/usageProtection';
import { ownedDbTable } from '../db/writeOwner';

import { UNKNOWN_ORG, FEATURE_AREA_MAP, type GatewayMetadata, type GatewayResponse, type GatewayRequest, GatewayAbortError, isAbortError, _inFlight, sleep, resolveProviderTimeoutMs, _pools, acquireSlot, releaseSlot, resolveLlmConfig, type NormalizedCompletion, callOpenAi, callAnthropic } from './aiGatewayCore';


type GatewayErrorLike = Error & { status?: number; statusCode?: number; code?: string; response?: { status?: number }; __retry_attempt?: number };

function asGatewayError(err: unknown): Partial<GatewayErrorLike> {
  return err && typeof err === 'object' ? err as Partial<GatewayErrorLike> : {};
}

function isRateLimitError(err: unknown): boolean {
  const record = asGatewayError(err);
  const status = record.status ?? record.response?.status ?? record.statusCode;
  // 429 = rate limit (OpenAI + Anthropic), 529 = Anthropic overloaded
  return status === 429 || status === 529;
}

function isNetworkError(err: unknown): boolean {
  const record = asGatewayError(err);
  const message = err instanceof Error ? err.message : '';
  return (
    record.code === 'ECONNREFUSED' ||
    record.code === 'ENOTFOUND' ||
    record.code === 'ETIMEDOUT' ||
    message.includes('fetch failed') ||
    message.includes('network')
  );
}

function isFallbackEligible(err: unknown): boolean {
  return isRateLimitError(err) || isNetworkError(err);
}

/** Returns the fallback provider name + a safe model for that provider. */
async function getFallbackConfig(
  currentProvider: 'openai' | 'anthropic',
  currentModel: string,
): Promise<{ provider: 'openai' | 'anthropic'; model: string; apiKey: string } | null> {
  try {
    const providers = await getActiveProviders();
    const fallbackProvider = providers.find((p) => p.name !== currentProvider);
    if (!fallbackProvider) return null;

    const name = fallbackProvider.name as 'openai' | 'anthropic';

    // Use same model name if it exists on the fallback provider, else use platform default for that provider
    const fallbackModels = await getModelsByProvider(name);
    const sameModel = fallbackModels.find((m) => m.model_key === currentModel);
    // Fallback model resolution order:
    //   1. Same model name on the fallback provider (rare).
    //   2. First model registered for the fallback provider in DB.
    //   3. Hardcoded default — MUST exist in llm_model_pricing, otherwise the
    //      fallback trips assertModelPricingExists and errors instead of helping.
    const model = sameModel
      ? currentModel
      : fallbackModels[0]?.model_key ?? (name === 'anthropic' ? 'claude-3-5-sonnet' : 'gpt-4o-mini');

    // Platform key for fallback provider (BYOK not applied to fallback)
    const envMap: Record<string, string | undefined> = {
      openai:    appConfig.OPENAI_API_KEY,
      anthropic: appConfig.ANTHROPIC_API_KEY,
    };
    const apiKey = envMap[name] ?? '';

    return { provider: name, model, apiKey };
  } catch (err) {
    console.warn('[ai-gateway] getFallbackConfig failed:', (err as Error)?.message);
    return null;
  }
}

/**
 * Tracking context passed into the retry loop so each failed intermediate
 * attempt can emit its own usage_events row. The final attempt (success or
 * terminal error) is logged by the outer runCompletion with final_attempt=true.
 */
/**
 * WS1-E6-T004 — per-provider AI circuit breaker.
 *
 * Reuses the platform breaker registry (lib/resilience/circuitBreaker) — the
 * same one safeFetch uses for outbound HTTP — rather than introducing a second
 * breaker for AI. NOTE: this is deliberately NOT
 * backend/services/intelligence/circuitBreaker.ts, which is keyed by
 * intelligence-data `provider_id` and read by the provider-health dashboard;
 * writing AI model providers into it would corrupt that view (see RF-07).
 *
 * `minimumRequestsBeforeTrigger` keeps low-volume operations from ever opening
 * the circuit, so behaviour is unchanged until a provider is genuinely failing
 * at volume.
 */
function aiProviderBreakerFor(provider: 'openai' | 'anthropic') {
  return getOrCreateCircuitBreaker(`ai-provider:${provider}`, {
    failureThreshold: 5,
    timeout: 30_000,
    minimumRequestsBeforeTrigger: 20,
  });
}

export type RetryTrackingContext = {
  companyId:   string | null;
  campaignId:  string | null;
  referenceType: string | null;
  referenceId:   string | null;
  parentActivityId: string | null;
  operation:   string;
  featureArea: string | null;
  startedAt:   number;
};

function logIntermediateAttempt(
  ctx: RetryTrackingContext | undefined,
  attempt: number,
  provider: 'openai' | 'anthropic',
  model: string,
  err: unknown,
): void {
  if (!ctx) return;
  void logUsageEvent({
    organization_id: ctx.companyId ?? UNKNOWN_ORG,
    campaign_id:     ctx.campaignId ?? null,
    source_type:     'llm',
    provider_name:   provider,
    model_name:      model,
    source_name:     `${provider}:${model}`,
    process_type:    ctx.operation,
    feature_area:    ctx.featureArea,
    reference_type:  ctx.referenceType ?? null,
    reference_id:    ctx.referenceId ?? null,
    metadata:        ctx.parentActivityId ? { parent_activity_id: ctx.parentActivityId } : undefined,
    latency_ms:      Date.now() - ctx.startedAt,
    error_flag:      true,
    error_type:      asGatewayError(err).status?.toString() ?? asGatewayError(err).code ?? (err instanceof Error ? err.message.slice(0, 200) : 'unknown'),
    retry_attempt:   attempt,
    final_attempt:   false,
  });
}

export async function callProviderWithRetry(
  provider: 'openai' | 'anthropic',
  params: Parameters<typeof callOpenAi>[0],
): Promise<NormalizedCompletion & { usedFallback: false; retry_attempt: number; queueWaitMs: number; executionMs: number; totalMs: number; concurrencySlot: number }>;
export async function callProviderWithRetry(
  provider: 'openai' | 'anthropic',
  params: Parameters<typeof callOpenAi>[0],
  allowFallback: true,
  tracking?: RetryTrackingContext,
): Promise<NormalizedCompletion & { usedFallback: boolean; fallbackProvider?: string; fallbackModel?: string; retry_attempt: number; queueWaitMs: number; executionMs: number; totalMs: number; concurrencySlot: number }>;
export async function callProviderWithRetry(
  provider: 'openai' | 'anthropic',
  params: Parameters<typeof callOpenAi>[0],
  allowFallback = false,
  tracking?: RetryTrackingContext,
): Promise<NormalizedCompletion & { usedFallback: boolean; fallbackProvider?: string; fallbackModel?: string; retry_attempt: number; queueWaitMs: number; executionMs: number; totalMs: number; concurrencySlot: number }> {
  // WS1-E6-T004: per-PROVIDER circuit breaker. Wrapped here, at the single
  // dispatch arrow, so it covers every attempt path — primary, retry, and
  // cross-provider fallback — without touching the retry/fallback logic
  // itself. An open breaker on one provider still lets the existing fallback
  // reach the other, which is precisely the behaviour the breaker is for.
  const dispatch = (p: 'openai' | 'anthropic', ps: typeof params) =>
    aiProviderBreakerFor(p).call(() =>
      p === 'anthropic' ? callAnthropic(ps) : callOpenAi(ps),
    );

  // ── Concurrency gate ───────────────────────────────────────────────────────
  // Three layers, in order:
  //   1. Provider token bucket — protects upstream OpenAI/Anthropic from
  //      cluster-wide QPS spikes that would otherwise hit 429.
  //   2. Distributed semaphore — cluster-wide per-pool slot via Redis Lua.
  //      Falls back to local-only when Redis is unavailable.
  //   3. Local pool semaphore — per-process backstop preserving prior behavior.
  //
  // All three release in `finally`. Token refund only fires for the
  // not-yet-dispatched abort case.
  const totalStartedAt = Date.now();

  // (1a) Distributed provider token bucket (cluster-wide). Falls through
  // when DISTRIBUTED_PROVIDER_BUCKET_ENABLED=false or Redis is unhealthy.
  let distProviderReceipt: DistributedTokenReceipt | null = null;
  try {
    distProviderReceipt = await acquireDistProviderToken(provider as ProviderName, {
      signal: params.signal,
      maxWaitMs: 5_000,
    });
    if (distProviderReceipt.fellThrough) distProviderReceipt = null;
  } catch (err) {
    // Cluster bucket exhaustion is a soft 429 — re-throw so the outer retry
    // / fallback layer can handle it consistently with provider-side 429s.
    throw err;
  }
  // (1b) Per-process token bucket (local backstop, also legacy default)
  let providerReceipt: TokenReceipt | null = null;
  try {
    providerReceipt = await providerTokenAcquire(provider as ProviderName, {
      signal: params.signal,
      maxWaitMs: 5_000,
    });
  } catch (err) {
    if (distProviderReceipt) await refundDistProviderToken(distProviderReceipt);
    throw err;
  }

  // (2) Distributed semaphore (Redis-backed)
  // Per-call lease: pick a generous TTL covering long-form (240s) + buffer.
  const leaseTtlMs = Math.max(60_000, resolveProviderTimeoutMs(params.max_tokens, params.operation) + 30_000);
  let distLease: SemaphoreLease | null = null;
  try {
    distLease = await distSemaphoreAcquire((params.pool ?? 'default') as DistPoolName, {
      signal: params.signal,
      leaseTtlMs,
      maxWaitMs: 30_000,
    });
  } catch (err) {
    // If we already consumed a provider token, refund it because we never
    // actually dispatched to the provider.
    if (providerReceipt) refundProviderToken(providerReceipt);
    throw err;
  }

  // (3) Local pool semaphore (legacy behavior preserved as per-process backstop)
  const { waitMs, pool: acquiredPool, slotNumber } = await acquireSlot(
    params.model,
    params.signal,
    params.pool,
  );
  const executionStartedAt = Date.now();
  const concurrencySlot = slotNumber;
  const poolState = _pools[acquiredPool];
  if (process.env.NODE_ENV !== 'test') {
    console.info('[ai-gateway] slot-acquired', {
      provider,
      model:       params.model,
      pool:        acquiredPool,
      activeCalls: poolState.activeCalls,
      maxAllowed:  poolState.maxAllowed,
      waitMs,
    });
  }

  try {

  let attempt = 1;
  const finalizeTiming = (extra: Record<string, unknown> = {}) => {
    const executionMs = Date.now() - executionStartedAt;
    const totalMs = Date.now() - totalStartedAt;
    try {
      logger.info('gateway_call_timing', {
        request_id: getRequestContext().requestId,
        operation: params.operation ?? null,
        provider,
        model: params.model,
        pool: acquiredPool,
        queue_wait_ms: waitMs,
        execution_ms: executionMs,
        total_ms: totalMs,
        concurrency_slot: concurrencySlot,
        max_concurrency: poolState.maxAllowed,
        ...extra,
      });
    } catch { /* never let logging break the call */ }
    // Telemetry: emit the latency histograms + wait-time histograms so
    // dashboards can compute p95/p99 without log scraping.
    try {
      const { histogramMs } = require('./plannerTelemetry') as typeof import('./plannerTelemetry');
      histogramMs('planner_provider_latency_ms', executionMs, { provider, op: params.operation ?? 'unknown' });
      histogramMs('planner_semaphore_acquisition_latency_ms', waitMs, { pool: acquiredPool });
    } catch { /* telemetry must not break the call */ }
    return { queueWaitMs: waitMs, executionMs, totalMs, concurrencySlot };
  };

  // Helper: dispatch under a `client` kind span so OTLP/Jaeger/Datadog APM
  // get one span per provider attempt with the operation, model, attempt,
  // and queue-wait attached. The span propagates the active trace context
  // so a planner request → gateway call chain stays connected end-to-end.
  const dispatchWithSpan = async (p: 'openai' | 'anthropic', ps: typeof params) => {
    try {
      const { withSpan } = require('./plannerTracing') as typeof import('./plannerTracing');
      return await withSpan(`provider/${p}/${ps.operation ?? 'unknown'}`, async (span) => {
        span.setAttribute('llm.provider', p);
        span.setAttribute('llm.model', ps.model);
        span.setAttribute('llm.operation', ps.operation ?? 'unknown');
        span.setAttribute('llm.pool', acquiredPool);
        span.setAttribute('llm.attempt', attempt);
        span.setAttribute('llm.stream', !!ps.stream);
        const r = await dispatch(p, ps);
        if (r.usage?.total_tokens) span.setAttribute('llm.tokens', r.usage.total_tokens);
        return r;
      }, { kind: 'client' });
    } catch {
      // Tracing failure must not affect the call — fall through to raw dispatch.
      return dispatch(p, ps);
    }
  };

  // ── Step 1: primary attempt ────────────────────────────────────────────────
  let primaryErr: unknown;
  try {
    if (providerReceipt) markProviderTokenStarted(providerReceipt);
    if (distProviderReceipt) markDistProviderTokenStarted(distProviderReceipt);
    const result = await dispatchWithSpan(provider, params);
    const t = finalizeTiming({ success: true, attempts: attempt });
    return { ...result, usedFallback: false, retry_attempt: attempt, ...t };
  } catch (err) {
    primaryErr = err;
  }

  // Caller-initiated abort short-circuits all retry / fallback logic so the
  // semaphore is freed and the orphan call is not silently re-tried.
  if (isAbortError(primaryErr) || params.signal?.aborted) {
    logger.warn('gateway_request_aborted', {
      request_id: getRequestContext().requestId,
      operation: params.operation ?? null,
      provider,
      model: params.model,
      duration_ms: Date.now() - executionStartedAt,
    });
    finalizeTiming({ success: false, attempts: attempt, aborted: true });
    asGatewayError(primaryErr).__retry_attempt = attempt;
    if (!(primaryErr instanceof GatewayAbortError)) {
      throw new GatewayAbortError(params.operation || provider);
    }
    throw primaryErr;
  }

  // ── Step 2: same-provider retry ───────────────────────────────────────────
  // WAVE-1D-001: deterministic, bounded, policy-driven. Rate-limit/overload
  // (429/529) is always retried (legacy behavior preserved). Transient failures
  // (5xx / timeout / network) become retry-eligible when AI_GATEWAY_RETRY_TRANSIENT
  // is enabled (default OFF → behavior unchanged). NEVER retries auth/validation/
  // abort/permanent errors. Backoff is exponential + equal jitter (was fixed 2s).
  const __cls = classifyProviderError(primaryErr);
  // WS1-E6-T005: per-provider outcome metrics.
  //
  // `ai.gateway.retry` below only fires when the error is actually RETRIED
  // (rate-limit, or transient with AI_GATEWAY_RETRY_TRANSIENT=1 — off by
  // default). classifyProviderError marks timeouts `retryable: true,
  // rateLimit: false`, so a provider TIMEOUT never incremented any counter:
  // the timeout was enforced (resolveProviderTimeoutMs / transport abort) but
  // invisible to operators.
  //
  // Emitted at the single classification point — once per provider attempt,
  // reusing the existing classifier rather than adding a second one. The
  // dedicated timeout counter is kept alongside the general one so a timeout
  // can be alerted on without needing a label filter.
  try {
    recordRawCounter('ai.gateway.provider_error', 1, { provider, class: __cls.class });
    if (__cls.class === 'timeout') {
      recordRawCounter('ai.gateway.timeout', 1, { provider });
    }
  } catch { /* fail-safe: metrics must never break a provider call */ }
  const __transientEnabled = /^(1|true|yes|on)$/i.test(String(process.env.AI_GATEWAY_RETRY_TRANSIENT ?? ''));
  const __shouldRetrySameProvider = __cls.rateLimit || (__transientEnabled && __cls.retryable);
  if (__shouldRetrySameProvider) {
    logIntermediateAttempt(tracking, attempt, provider, params.model, primaryErr);
    attempt += 1;
    const __backoff = computeBackoffMs(attempt - 1);
    try { recordRawCounter('ai.gateway.retry', 1, { provider, class: __cls.class }); } catch { /* fail-safe */ }
    console.warn('[ai-gateway] transient error, retrying same provider', {
      provider,
      status: asGatewayError(primaryErr).status,
      errorClass: __cls.class,
      backoffMs: __backoff,
    });
    try {
      await sleep(__backoff);
      if (params.signal?.aborted) throw new GatewayAbortError(params.operation || provider);
      if (providerReceipt) markProviderTokenStarted(providerReceipt);
      if (distProviderReceipt) markDistProviderTokenStarted(distProviderReceipt);
      const result = await dispatchWithSpan(provider, params);
      const t = finalizeTiming({ success: true, attempts: attempt });
      return { ...result, usedFallback: false, retry_attempt: attempt, ...t };
    } catch (retryErr) {
      if (isAbortError(retryErr) || params.signal?.aborted) {
        logger.warn('gateway_request_aborted', {
          request_id: getRequestContext().requestId,
          operation: params.operation ?? null,
          provider,
          model: params.model,
          duration_ms: Date.now() - executionStartedAt,
        });
        finalizeTiming({ success: false, attempts: attempt, aborted: true });
        throw new GatewayAbortError(params.operation || provider);
      }
      primaryErr = retryErr; // carry latest error to fallback check
    }
  }

  // ── Step 3: fallback provider (only for rate-limit / overload / network) ──
  if (allowFallback && isFallbackEligible(primaryErr)) {
    const fallback = await getFallbackConfig(provider, params.model);
    if (fallback) {
      logIntermediateAttempt(tracking, attempt, provider, params.model, primaryErr);
      attempt += 1;
      console.warn('[ai-gateway] falling back to alternate provider', {
        primaryProvider:  provider,
        fallbackProvider: fallback.provider,
        primaryModel:     params.model,
        fallbackModel:    fallback.model,
        reason:           asGatewayError(primaryErr).status ?? asGatewayError(primaryErr).code ?? (primaryErr instanceof Error ? primaryErr.message : undefined),
      });
      try {
        if (params.signal?.aborted) throw new GatewayAbortError(params.operation || provider);
        const fallbackParams = { ...params, model: fallback.model, apiKey: fallback.apiKey };
        const result = await dispatchWithSpan(fallback.provider, fallbackParams);
        console.info('[ai-gateway] fallback succeeded', {
          fallbackProvider: fallback.provider,
          fallbackModel:    fallback.model,
        });
        const t = finalizeTiming({ success: true, attempts: attempt, used_fallback: true });
        return {
          ...result,
          usedFallback:     true,
          fallbackProvider: fallback.provider,
          fallbackModel:    fallback.model,
          retry_attempt:    attempt,
          ...t,
        };
      } catch (fallbackErr: unknown) {
        if (isAbortError(fallbackErr) || params.signal?.aborted) {
          logger.warn('gateway_request_aborted', {
            request_id: getRequestContext().requestId,
            operation: params.operation ?? null,
            provider: fallback.provider,
            model: fallback.model,
            duration_ms: Date.now() - executionStartedAt,
          });
          finalizeTiming({ success: false, attempts: attempt, aborted: true, used_fallback: true });
          throw new GatewayAbortError(params.operation || provider);
        }
        console.error('[ai-gateway] fallback also failed', {
          fallbackProvider: fallback.provider,
          fallbackModel:    fallback.model,
          error: asGatewayError(fallbackErr).status ?? (fallbackErr instanceof Error ? fallbackErr.message : undefined),
        });
        // Attach attempt counter to the primary error so the outer log can
        // report which attempt was the last; then throw the primary.
        asGatewayError(primaryErr).__retry_attempt = attempt;
        finalizeTiming({ success: false, attempts: attempt, used_fallback: true });
        throw primaryErr;
      }
    }
  }

  asGatewayError(primaryErr).__retry_attempt = attempt;
  finalizeTiming({ success: false, attempts: attempt });
  throw primaryErr;

  } finally {
    // Release order matches inverse acquire order: local → distributed →
    // token bucket. Distributed release is async but we fire-and-forget so
    // the synchronous finally completes promptly; the lease will auto-expire
    // even if release() never reaches Redis.
    releaseSlot(acquiredPool);
    if (distLease) {
      void distSemaphoreRelease(distLease).catch(() => { /* logged inside */ });
    }
    // Token buckets: refund if the request never actually dispatched. Both
    // success and dispatched-failure paths set `_started`, so refund here is
    // a no-op for those cases. Only abort-before-dispatch reaches this with
    // _started still false. Distributed refund is async; fire-and-forget.
    if (providerReceipt) refundProviderToken(providerReceipt);
    if (distProviderReceipt) void refundDistProviderToken(distProviderReceipt);
  }
}

// ── Metadata builder ──────────────────────────────────────────────────────────

export const buildMetadata = (
  provider: 'openai' | 'anthropic',
  model: string,
  usage: NormalizedCompletion['usage'],
): GatewayMetadata => {
  // Phase 10C — propagate actual provider tokens to any active usage-collection
  // scope (no-op when none). Read-only; touches no billing/ledger/settlement.
  if (usage) recordProviderUsage(usage.prompt_tokens, usage.completion_tokens);
  return {
    provider: provider === 'anthropic' ? 'direct-anthropic' : 'direct-openai',
    model,
    token_usage: usage
      ? {
          prompt_tokens:    usage.prompt_tokens,
          completion_tokens: usage.completion_tokens,
          total_tokens:     usage.total_tokens,
        }
      : null,
    reasoning_trace_id: randomUUID(),
  };
};

