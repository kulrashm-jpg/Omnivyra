// Shared LLM-adapter base. The OpenAI adapter ships its own implementation
// because Chat Completions has a fixed payload shape; this base exists for
// the per-provider variants whose body shape varies (Claude messages API,
// Gemini generateContent, Perplexity sonar, Copilot Bing wrapper).
//
// Every concrete subclass overrides `buildRequest()` and `extractAnswer()`.

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
import type { EvidenceTrace } from '../../canonicalReport/canonicalReportTypes';
// BETA-PHASE1-EXEC-001: canonical cost governance — gate paid calls + record usage against the active scan budget.
import { withinBudget, recordUsage, estimateCost } from '../costGovernance';
import { getActiveScanId } from '../scanBudgetContext';
import { extractProbeTokenUsage } from '../probeCostCapture';

export type LLMAdapterConfig = {
  id: AIProviderId;
  envKey: string;
  cacheTtlSeconds: number;
  rateCapacity: number;
  rateRefillPerSec: number;
  timeoutMs: number;
};

export type LLMRequest = {
  url: string;
  init: RequestInit;
};

export abstract class LLMAdapterBase implements LLMVisibilityProvider {
  abstract readonly id: AIProviderId;
  protected abstract readonly config: LLMAdapterConfig;

  private cacheStore: TtlCache<CitationMention> | null = null;

  protected get cache(): TtlCache<CitationMention> {
    if (!this.cacheStore) this.cacheStore = new TtlCache<CitationMention>(this.config.cacheTtlSeconds);
    return this.cacheStore;
  }

  protected get limiter() {
    return getRateLimiter(this.config.id, this.config.rateCapacity, this.config.rateRefillPerSec);
  }

  protected getCredential(): string | null {
    return process.env[this.config.envKey] ?? null;
  }

  /** Subclasses build the provider-specific HTTP request from a query. */
  protected abstract buildRequest(params: { apiKey: string; query: string }): LLMRequest;

  /** Subclasses pull the answer text out of the parsed JSON response. */
  protected abstract extractAnswer(response: unknown): string;

  /**
   * Transport seam (PA-004). Default = the legacy direct-HTTP path
   * (buildRequest → production fetch → parsed JSON). A subclass MAY override this
   * to route transport through the canonical Platform gateway dispatcher while
   * keeping ALL probe business logic here in the base. Default-preserving: any
   * subclass that does not override gets byte-identical legacy behaviour.
   */
  protected async fetchCompletionJson(apiKey: string, query: string): Promise<unknown> {
    const request = this.buildRequest({ apiKey, query });
    const envelope = await withRetry(this.id, () =>
      fetchProduction(this.id, request.url, request.init, this.config.timeoutMs),
    );
    return envelope.json();
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.getCredential());
  }

  async probe(probe: AIVisibilityProbe): Promise<AIVisibilityProbeResult> {
    const apiKey = this.getCredential();
    if (!apiKey) {
      logProviderCall({
        providerId: this.id,
        operation: 'probe',
        status: 'unavailable',
        reason: 'no_api_key',
      });
      return {
        provider: this.id,
        query_class: probe.query_class,
        state: 'unavailable',
        citation_rate: null,
        mean_prominence: null,
        mentions: [],
        evidence: unavailableEvidence(`${this.config.envKey} not configured`),
        reason_unavailable: `${this.config.envKey} not configured.`,
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
        // PA-004: transport via the overridable seam (legacy by default; a
        // subclass may route through the Platform gateway dispatcher).
        const json = await this.fetchCompletionJson(apiKey, query);
        // Phase 8G-B — platform cost capture (no customer org; fire-and-forget). Separate billing ledger.
        void import('../probeCostCapture').then((m) => m.captureProbeCost({ providerId: this.id, json })).catch(() => {});
        // BETA-PHASE1-EXEC-001: record the paid call against the canonical scan budget (the only writer to
        // the scan ledger — no duplicate accounting; cost is null when the provider's pricing is unknown).
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
        const answer = this.extractAnswer(json);
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
        evidence: unavailableEvidence(firstFailureReason ?? `${this.id} probe returned no observations.`),
        reason_unavailable: firstFailureReason ?? `${this.id} probe returned no observations.`,
      };
    }

    const appeared = mentions.filter((m) => m.appeared);
    const citationRate = mentions.length === 0 ? null : appeared.length / mentions.length;
    const meanProminence =
      appeared.length === 0 ? 0 : appeared.reduce((sum, m) => sum + m.prominence, 0) / appeared.length;

    const observedAt = mentions[mentions.length - 1].observed_at;
    const evidence: EvidenceTrace = {
      count: mentions.length,
      sources: ['llm_probe'],
      freshness: freshnessFromTimestamp(observedAt),
      observations: mentions.map((m) => ({
        signal: `${this.id}:${probe.query_class}:${m.appeared ? 'cited' : 'absent'}`,
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
