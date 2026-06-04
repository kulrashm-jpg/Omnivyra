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

      const startedAt = Date.now();
      try {
        const request = this.buildRequest({ apiKey, query });
        const envelope = await withRetry(this.id, () =>
          fetchProduction(this.id, request.url, request.init, this.config.timeoutMs),
        );
        const json = await envelope.json();
        // Phase 8G-B — platform cost capture (no customer org; fire-and-forget).
        void import('../probeCostCapture').then((m) => m.captureProbeCost({ providerId: this.id, json })).catch(() => {});
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
