// Real OpenAI / ChatGPT adapter.
//
// Activates when OPENAI_API_KEY is set. Uses Chat Completions (gpt-4o-mini by
// default — overridable with OPENAI_PROBE_MODEL). Wraps every HTTP call with
// the production primitives (rate limiter + timeout + retry + cache).
//
// Phase 4 contract: when the env key is missing OR a request fails, the adapter
// returns AIVisibilityProbeResult with state='unavailable' and the actual
// reason. No synthesized citation rates ever.

import type {
  AIProviderId,
  AIVisibilityProbe,
  AIVisibilityProbeResult,
  CitationMention,
  LLMVisibilityProvider,
} from '../providerInterfaces';
import { unavailableEvidence } from '../providerInterfaces';
import {
  TtlCache,
  fetchProduction,
  freshnessFromTimestamp,
  getRateLimiter,
  logProviderCall,
  reasonFromError,
  withRetry,
} from '../productionPrimitives';
import { extractCitation } from '../citationExtractor';
import { formatQueryForProvider } from '../queryOrchestrator';
import type { EvidenceTrace } from '../../canonicalReport/canonicalReportTypes';
// BETA-PHASE1-EXEC-001: canonical cost governance — gate paid calls + record usage against the active scan budget.
import { withinBudget, recordUsage, estimateCost } from '../costGovernance';
import { getActiveScanId } from '../scanBudgetContext';
import { extractProbeTokenUsage } from '../probeCostCapture';
// PA-003: consume the canonical Platform gateway dispatcher (Zone P) for LLM
// transport. The adapter keeps ALL business logic (prompt build, citation
// extraction, scoring, budget); only the raw HTTP transport moves to the gateway.
import { dispatchTransport, type GatewayDispatchParams } from '../../aiGatewayDispatcher';
import type { NormalizedCompletion } from '../../aiGatewayCore';
// PB-007: consume the canonical PB-006 provider-identity layer (Zone P, read-only).
// Product→Platform id translation is performed by the PLATFORM, never hand-written here.
import { toPlatformProviderId } from '../../aiGatewayProviderIdentity';

/**
 * @deprecated PA-003 — direct-transport endpoint. Retained as the flag-OFF
 * fallback; removed in PA-008 once the gateway path is default and every
 * visibility adapter has migrated.
 */
const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4o-mini';
const TIMEOUT_MS = 25_000;
const CACHE_TTL_SECONDS = 60 * 60 * 12; // 12h — keeps within free re-runs the same window
// 60 requests per minute per process — conservative default; overridable.
const RATE_CAPACITY = 60;
const RATE_REFILL_PER_SEC = 1;

// ── PB-007 · Canonical provider identity ──────────────────────────────────────
//
// This adapter's PRODUCT id, declared ONCE, and the PLATFORM id DERIVED from it via
// the canonical PB-006 mapping. Before PB-007 the platform literal `'openai'` was
// hand-written at the `dispatchTransport` call site; it was correct, but only because
// the author remembered that 'chatgpt' ≠ 'openai'. Deriving it makes that correctness
// STRUCTURAL — the Platform owns the mapping, not author memory.

/** PB-007 — the PRODUCT id this adapter is. Single source of truth for the file. */
const PRODUCT_PROVIDER_ID = 'chatgpt' satisfies AIProviderId;

/**
 * PB-007 — the PLATFORM id this adapter transacts with, derived canonically.
 *
 * BEHAVIOR PARITY IS COMPILE-CHECKED. The explicit `'openai'` annotation is the
 * previously hard-coded literal: `toPlatformProviderId` is overloaded so a statically
 * known product id yields a statically known platform id, so if the canonical mapping
 * ever produced anything other than `'openai'` for `'chatgpt'` this line would not
 * compile. The value handed to the dispatcher is therefore provably byte-identical to
 * the literal it replaces.
 *
 * NO NEW THROW PATH. `toPlatformProviderId` throws only for an id outside the product
 * union; the argument here is the compile-time literal `'chatgpt'`, and the canonical
 * map is `satisfies Record<ProductProviderId, PlatformProviderId>` (total over that
 * union), so the failing branch is statically unreachable. It is additionally
 * evaluated ONCE at module initialization — input-independent and request-independent
 * — so no per-request code path that could not throw before can throw now.
 */
const PLATFORM_PROVIDER_ID: 'openai' = toPlatformProviderId(PRODUCT_PROVIDER_ID);

type OpenAIChatResponse = {
  choices?: Array<{
    message?: { content?: string };
  }>;
};

/** The probe-consumed OpenAI response shape (answer + usage + model). */
type OpenAIProbeResponse = OpenAIChatResponse & {
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  model?: string;
};

/**
 * PA-003 — adapter-owned feature flag. When enabled, OpenAI probe transport routes
 * through the canonical Platform gateway dispatcher instead of the adapter's direct
 * HTTP. Default OFF → byte-identical legacy path preserved as the fallback.
 */
export function openaiGatewayTransportEnabled(): boolean {
  return /^(1|true|on|yes)$/i.test(process.env.OPENAI_ADAPTER_GATEWAY_TRANSPORT ?? '');
}

/**
 * PA-003 — re-shape a gateway `NormalizedCompletion` into the OpenAI chat-response
 * shape the probe path already consumes, so answer extraction and cost/usage
 * capture (`extractProbeTokenUsage` / `captureProbeCost`) stay byte-identical
 * across both transports. Pure.
 */
export function reshapeCompletionToOpenAiResponse(
  completion: NormalizedCompletion,
  model: string,
): OpenAIProbeResponse {
  return {
    choices: [{ message: { content: completion.content } }],
    model,
    ...(completion.usage
      ? {
          usage: {
            prompt_tokens: completion.usage.prompt_tokens,
            completion_tokens: completion.usage.completion_tokens,
            total_tokens: completion.usage.total_tokens,
          },
        }
      : {}),
  };
}

export class OpenAIChatGPTAdapter implements LLMVisibilityProvider {
  public readonly id: AIProviderId = PRODUCT_PROVIDER_ID;
  private readonly cache = new TtlCache<CitationMention>(CACHE_TTL_SECONDS);
  private readonly limiter = getRateLimiter(this.id, RATE_CAPACITY, RATE_REFILL_PER_SEC);

  async isAvailable(): Promise<boolean> {
    return Boolean(process.env.OPENAI_API_KEY);
  }

  /**
   * PA-003 — the transport seam. Business logic (prompt build, parsing, scoring,
   * budget, caching, rate-limit, retry) stays in `probe`; this method owns ONLY
   * how the raw completion is fetched. Retry (`withRetry`) is the adapter's
   * reliability policy and wraps BOTH paths identically. Flag ON → canonical
   * gateway dispatcher (transport owned by Platform); flag OFF → legacy direct
   * HTTP. Both return the same OpenAI response shape so downstream is unchanged.
   */
  private async fetchProbeChat(
    apiKey: string,
    messages: Array<{ role: string; content: string }>,
  ): Promise<OpenAIProbeResponse> {
    const model = process.env.OPENAI_PROBE_MODEL ?? DEFAULT_MODEL;
    if (openaiGatewayTransportEnabled()) {
      const completion = await withRetry(this.id, () =>
        // PB-007: the platform id is DERIVED from this adapter's product id, not typed
        // by hand. Identical value ('openai'), enforced by the Platform.
        dispatchTransport(PLATFORM_PROVIDER_ID, {
          apiKey,
          model,
          temperature: 0,
          max_tokens: 600,
          messages: messages as GatewayDispatchParams['messages'],
          operation: 'visibility.probe.chatgpt',
        }),
      );
      return reshapeCompletionToOpenAiResponse(completion, model);
    }
    // @deprecated PA-003 — legacy direct transport; removed in PA-008.
    const envelope = await withRetry(this.id, () =>
      fetchProduction(
        this.id,
        OPENAI_CHAT_URL,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ model, messages, temperature: 0, max_tokens: 600 }),
        },
        TIMEOUT_MS,
      ),
    );
    return (await envelope.json()) as OpenAIProbeResponse;
  }

  async probe(probe: AIVisibilityProbe): Promise<AIVisibilityProbeResult> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      logProviderCall({ providerId: this.id, operation: 'probe', status: 'unavailable', reason: 'no_api_key' });
      return {
        provider: this.id,
        query_class: probe.query_class,
        state: 'unavailable',
        citation_rate: null,
        mean_prominence: null,
        mentions: [],
        evidence: unavailableEvidence(`OPENAI_API_KEY not configured`),
        reason_unavailable: 'OPENAI_API_KEY not configured.',
      };
    }

    if (probe.queries.length === 0) {
      return {
        provider: this.id,
        query_class: probe.query_class,
        state: 'unavailable',
        citation_rate: null,
        mean_prominence: null,
        mentions: [],
        evidence: unavailableEvidence(`No queries derived for ${probe.query_class}`),
        reason_unavailable: `No queries derived for ${probe.query_class}.`,
      };
    }

    const brandName = (probe as AIVisibilityProbe & { brandName?: string }).brandName ?? '';
    const domain = (probe as AIVisibilityProbe & { domain?: string | null }).domain ?? null;

    const mentions: CitationMention[] = [];
    let firstFailureReason: string | null = null;
    // BETA-PHASE1-EXEC-001: the active scan budget (null outside a scan-budget context → no gating, prior behaviour).
    const scanId = getActiveScanId();

    for (const query of probe.queries) {
      const cacheKey = `${probe.query_class}|${query}`;
      const cached = this.cache.get(cacheKey);
      if (cached) {
        mentions.push(cached.value);
        logProviderCall({
          providerId: this.id,
          operation: 'probe',
          status: 'cache_hit',
          cache_age_ms: Date.now() - new Date(cached.cached_at).getTime(),
        });
        continue;
      }

      if (!this.limiter.tryAcquire()) {
        firstFailureReason = firstFailureReason ?? `rate_limited:${this.id}`;
        continue;
      }

      // Canonical budget gate: never exceed the scan's request/cost ceiling. Abort remaining paid calls
      // safely when exhausted (cost unknown pre-call → request-count enforcement). No budget ⇒ no gating.
      if (scanId) {
        const gate = withinBudget(scanId, { requests: 1, cost_usd: null });
        if (!gate.ok) {
          firstFailureReason = firstFailureReason ?? gate.reason ?? `budget_exceeded:${this.id}`;
          break;
        }
      }

      const startedAt = Date.now();
      try {
        const formatted = formatQueryForProvider(query, this.id);
        const messages = [
          ...(formatted.system ? [{ role: 'system', content: formatted.system }] : []),
          { role: 'user', content: formatted.user },
        ];
        // PA-003: transport via the flag-gated seam (gateway dispatcher or legacy).
        const json = await this.fetchProbeChat(apiKey, messages);
        // Phase 8G-B — platform cost capture (no customer org; fire-and-forget). Separate billing ledger.
        void import('../probeCostCapture').then((m) => m.captureProbeCost({ providerId: this.id, json })).catch(() => {});
        // BETA-PHASE1-EXEC-001: record the paid call against the canonical scan budget (sole writer to the
        // scan ledger — no duplicate accounting; cost null when pricing is unknown).
        if (scanId) {
          const usage = extractProbeTokenUsage(this.id, json);
          recordUsage(scanId, {
            provider_id: this.id,
            operation: 'probe',
            request_count: 1,
            prompt_tokens: usage.inputTokens,
            completion_tokens: usage.outputTokens,
            cost_usd: estimateCost({ providerId: this.id, promptTokens: usage.inputTokens, completionTokens: usage.outputTokens }),
            cache_hit: false,
            observed_at: new Date().toISOString(),
          });
        }
        const answer = json.choices?.[0]?.message?.content ?? '';
        const observedAt = new Date().toISOString();
        const mention = extractCitation({
          provider: this.id,
          query,
          query_class: probe.query_class,
          answer,
          brandName,
          domain,
          observedAt,
        });
        mentions.push(mention);
        this.cache.set(cacheKey, mention);
        logProviderCall({
          providerId: this.id,
          operation: 'probe',
          status: 'ok',
          duration_ms: Date.now() - startedAt,
        });
      } catch (error) {
        const reason = reasonFromError(this.id, error);
        firstFailureReason = firstFailureReason ?? reason;
        logProviderCall({
          providerId: this.id,
          operation: 'probe',
          status: 'unavailable',
          reason,
          duration_ms: Date.now() - startedAt,
        });
      }
    }

    if (mentions.length === 0) {
      return {
        provider: this.id,
        query_class: probe.query_class,
        state: 'unavailable',
        citation_rate: null,
        mean_prominence: null,
        mentions: [],
        evidence: unavailableEvidence(firstFailureReason ?? `OpenAI probe returned no observations.`),
        reason_unavailable: firstFailureReason ?? 'OpenAI probe returned no observations.',
      };
    }

    const appeared = mentions.filter((m) => m.appeared);
    const citationRate = mentions.length === 0 ? null : appeared.length / mentions.length;
    const meanProminence =
      appeared.length === 0
        ? 0
        : appeared.reduce((sum, m) => sum + m.prominence, 0) / appeared.length;

    const observedAt = mentions[mentions.length - 1].observed_at;
    const evidence: EvidenceTrace = {
      count: mentions.length,
      sources: ['llm_probe'],
      freshness: freshnessFromTimestamp(observedAt),
      observations: mentions.map((m) => ({
        signal: `openai:${probe.query_class}:${m.appeared ? 'cited' : 'absent'}`,
        source: 'llm_probe',
        observed_at: m.observed_at,
      })),
    };

    return {
      provider: this.id,
      query_class: probe.query_class,
      state: 'measured',
      citation_rate: Number(citationRate?.toFixed(3) ?? '0'),
      mean_prominence: Number(meanProminence.toFixed(3)),
      mentions,
      evidence,
      reason_unavailable: null,
    };
  }
}
