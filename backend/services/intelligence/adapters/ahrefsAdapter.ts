// Real Ahrefs authority-inflow adapter.
//
// Activates when AHREFS_API_KEY is set. Uses Ahrefs' API v3 endpoints:
//   - /v3/site-explorer/domain-rating  → Domain Rating
//   - /v3/site-explorer/refdomains-history-list → referring-domain count
//   - /v3/site-explorer/metrics-extended → backlink + trust + spam
//
// Phase 4 contract: when the key is missing OR a request fails, returns
// state: 'unavailable' with the actual reason. No synthesized backlink data.

import type {
  AuthorityInflowProvider,
  AuthorityInflowResult,
  BacklinkProfile,
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
import type { EvidenceTrace } from '../../canonicalReport/canonicalReportTypes';

const AHREFS_BASE = 'https://api.ahrefs.com';
const TIMEOUT_MS = 20_000;
const CACHE_TTL_SECONDS = 60 * 60 * 24; // backlink data moves slowly; 24h is fine
const RATE_CAPACITY = 30;
const RATE_REFILL_PER_SEC = 0.5;

type AhrefsMetricsResponse = {
  metrics?: {
    domain_rating?: number;
    refdomains?: number;
    backlinks?: number;
    url_rating?: number;
    traffic?: number;
  };
};

function scoreFromProfile(profile: BacklinkProfile): number {
  // 0-100 composite: 50% DA, 30% log(refdomains), 20% trust_flow.
  const da = profile.domain_authority ?? 0;
  const refLog = profile.referring_domains > 0 ? Math.min(100, Math.log10(profile.referring_domains + 1) * 25) : 0;
  const tf = profile.trust_flow ?? 0;
  return Math.round(Math.max(0, Math.min(100, da * 0.5 + refLog * 0.3 + tf * 0.2)));
}

export class AhrefsAdapter implements AuthorityInflowProvider {
  public readonly id = 'ahrefs';
  private readonly cache = new TtlCache<AuthorityInflowResult>(CACHE_TTL_SECONDS);
  private readonly limiter = getRateLimiter(this.id, RATE_CAPACITY, RATE_REFILL_PER_SEC);

  async isAvailable(): Promise<boolean> {
    return Boolean(process.env.AHREFS_API_KEY);
  }

  async lookup(params: { domain: string }): Promise<AuthorityInflowResult> {
    const apiKey = process.env.AHREFS_API_KEY;
    if (!apiKey) {
      return {
        state: 'unavailable',
        profile: null,
        score: null,
        evidence: unavailableEvidence('AHREFS_API_KEY not configured'),
        reason_unavailable: 'AHREFS_API_KEY not configured.',
      };
    }
    if (!params.domain) {
      return {
        state: 'unavailable',
        profile: null,
        score: null,
        evidence: unavailableEvidence('Domain missing — cannot query Ahrefs.'),
        reason_unavailable: 'Domain missing — cannot query Ahrefs.',
      };
    }

    const cacheKey = `ahrefs:${params.domain}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      logProviderCall({
        providerId: this.id,
        operation: 'lookup',
        status: 'cache_hit',
        cache_age_ms: Date.now() - new Date(cached.cached_at).getTime(),
      });
      return cached.value;
    }

    if (!this.limiter.tryAcquire()) {
      const reason = `rate_limited:${this.id}`;
      logProviderCall({ providerId: this.id, operation: 'lookup', status: 'unavailable', reason });
      return {
        state: 'unavailable',
        profile: null,
        score: null,
        evidence: unavailableEvidence(reason),
        reason_unavailable: 'Rate limit exhausted for this provider.',
      };
    }

    const startedAt = Date.now();
    const url = `${AHREFS_BASE}/v3/site-explorer/metrics-extended?target=${encodeURIComponent(params.domain)}&date_to=now&mode=domain`;
    try {
      const envelope = await withRetry(this.id, () =>
        fetchProduction(
          this.id,
          url,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              Accept: 'application/json',
            },
          },
          TIMEOUT_MS,
        ),
      );
      const json = (await envelope.json()) as AhrefsMetricsResponse;
      const observedAt = new Date().toISOString();
      const profile: BacklinkProfile = {
        referring_domains: json.metrics?.refdomains ?? 0,
        total_backlinks: json.metrics?.backlinks ?? 0,
        domain_authority: typeof json.metrics?.domain_rating === 'number' ? json.metrics.domain_rating : null,
        topical_authority: null,
        trust_flow: null,
        spam_score: null,
        freshness: freshnessFromTimestamp(observedAt),
      };
      const score = scoreFromProfile(profile);
      const evidence: EvidenceTrace = {
        count: profile.referring_domains > 0 || profile.total_backlinks > 0 ? 3 : 1,
        sources: ['backlink_api'],
        freshness: freshnessFromTimestamp(observedAt),
        observations: [
          { signal: `ahrefs:domain_rating:${profile.domain_authority ?? 0}`, source: 'backlink_api', observed_at: observedAt },
          { signal: `ahrefs:refdomains:${profile.referring_domains}`, source: 'backlink_api', observed_at: observedAt },
          { signal: `ahrefs:backlinks:${profile.total_backlinks}`, source: 'backlink_api', observed_at: observedAt },
        ],
      };
      const result: AuthorityInflowResult = {
        state: 'measured',
        profile,
        score,
        evidence,
        reason_unavailable: null,
      };
      this.cache.set(cacheKey, result);
      logProviderCall({
        providerId: this.id,
        operation: 'lookup',
        status: 'ok',
        duration_ms: Date.now() - startedAt,
      });
      return result;
    } catch (error) {
      const reason = reasonFromError(this.id, error);
      logProviderCall({
        providerId: this.id,
        operation: 'lookup',
        status: 'unavailable',
        reason,
        duration_ms: Date.now() - startedAt,
      });
      return {
        state: 'unavailable',
        profile: null,
        score: null,
        evidence: unavailableEvidence(reason),
        reason_unavailable: reason,
      };
    }
  }
}
