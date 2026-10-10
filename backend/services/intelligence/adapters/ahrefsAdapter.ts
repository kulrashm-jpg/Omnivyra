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
// BETA-PHASE1-EXEC-001: canonical cost governance — gate the paid call + record usage against the active scan budget.
import { withinBudget, recordUsage } from '../costGovernance';
import { getActiveScanId } from '../scanBudgetContext';

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

/**
 * AUTH-G-002 — the metrics that genuinely ARRIVED in the provider response.
 *
 * `null` means the field was absent, which is categorically different from the field being
 * present and zero. A domain with no referring domains is a real measurement of 0; a response
 * that never mentioned referring domains measured nothing. The whole correction below rests on
 * keeping those two apart, so absence is carried as `null` and never collapsed with `?? 0`.
 */
export type AhrefsPresentMetrics = {
  readonly referring_domains: number | null;
  readonly total_backlinks: number | null;
  readonly domain_authority: number | null;
  readonly trust_flow: number | null;
};

/**
 * AUTH-G-002 — A MISSING COMPONENT IS NOT A ZERO COMPONENT.
 *
 * THE DEFECT. This was `da * 0.5 + refLog * 0.3 + tf * 0.2` over `profile.domain_authority ?? 0`
 * and `profile.trust_flow ?? 0`. Ahrefs' `metrics-extended` response carries no trust-flow field
 * at all, so `trust_flow` is ALWAYS null here and 20% of the composite was permanently zero: no
 * domain could score above 80 however strong its real backlink profile, and a response missing
 * Domain Rating lost another 50% the same way. A weight whose input is unavailable was being
 * spent as a weight whose input is bad.
 *
 * THE CONTRACT. The composite is taken over the components that genuinely arrived, renormalized
 * to their own weights, so an unavailable component neither helps nor hurts. The relative weights
 * are unchanged (50 / 30 / 20) — this is not a reweighting, it is a denominator that matches the
 * evidence. When NOTHING arrived the result is `null`, because there is no composite to state;
 * the caller turns that into an `unavailable` result rather than a measured 0.
 */
export function scoreFromPresentMetrics(metrics: AhrefsPresentMetrics): number | null {
  const parts: Array<{ weight: number; value: number }> = [];
  if (metrics.domain_authority !== null) {
    parts.push({ weight: 0.5, value: metrics.domain_authority });
  }
  if (metrics.referring_domains !== null) {
    parts.push({
      weight: 0.3,
      value: metrics.referring_domains > 0 ? Math.min(100, Math.log10(metrics.referring_domains + 1) * 25) : 0,
    });
  }
  if (metrics.trust_flow !== null) {
    parts.push({ weight: 0.2, value: metrics.trust_flow });
  }
  if (parts.length === 0) return null;
  const totalWeight = parts.reduce((sum, part) => sum + part.weight, 0);
  const weighted = parts.reduce((sum, part) => sum + part.value * part.weight, 0);
  return Math.round(Math.max(0, Math.min(100, weighted / totalWeight)));
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

    // BETA-PHASE1-EXEC-001: canonical budget gate before the paid call. No scan budget ⇒ no gating (prior behaviour).
    const scanId = getActiveScanId();
    if (scanId) {
      const gate = withinBudget(scanId, { requests: 1, cost_usd: null });
      if (!gate.ok) {
        const reason = gate.reason ?? `budget_exceeded:${this.id}`;
        logProviderCall({ providerId: this.id, operation: 'lookup', status: 'unavailable', reason });
        return {
          state: 'unavailable',
          profile: null,
          score: null,
          evidence: unavailableEvidence(reason),
          reason_unavailable: 'Scan budget exhausted for this report.',
        };
      }
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
      // BETA-PHASE1-EXEC-001: record the paid call against the canonical scan budget (cost null — Ahrefs
      // pricing is not derivable from the response; the ledger enforces the request ceiling).
      if (scanId) {
        recordUsage(scanId, {
          provider_id: this.id,
          operation: 'lookup',
          request_count: 1,
          cost_usd: null,
          cache_hit: false,
          observed_at: new Date().toISOString(),
        });
      }
      const observedAt = new Date().toISOString();
      // ─── AUTH-G-002 — ABSENT IS NOT ZERO ──────────────────────────────────────
      //
      // THE DEFECT. `refdomains ?? 0` and `backlinks ?? 0` turned a field the response never
      // carried into the number 0, and the result was then stamped `state: 'measured'`. A
      // response with no metrics object at all — a domain Ahrefs has not indexed, a plan whose
      // entitlements omit these fields, a shape change — therefore published "this domain has 0
      // referring domains and 0 backlinks, measured". `mergeAuthorityInflowDimension` admits any
      // `measured` result with a non-null score, and `0 != null`, so that fabricated zero became
      // the Authority Inflow dimension and entered the Authority pillar as a real measurement.
      //
      // THE CONTRACT. A present-and-zero metric is a genuine measurement and is kept as one; an
      // ABSENT metric is carried as `null` and excluded from the score, the evidence count and
      // the observations. When no metric arrived at all there is nothing to report, so the result
      // is `unavailable` with the reason — the same posture the no-key, rate-limited, budget and
      // request-failure branches above already take.
      const present: AhrefsPresentMetrics = {
        referring_domains: typeof json.metrics?.refdomains === 'number' ? json.metrics.refdomains : null,
        total_backlinks: typeof json.metrics?.backlinks === 'number' ? json.metrics.backlinks : null,
        domain_authority: typeof json.metrics?.domain_rating === 'number' ? json.metrics.domain_rating : null,
        // Ahrefs `metrics-extended` carries no trust-flow field; it is structurally unavailable
        // here rather than measured at zero. See `scoreFromPresentMetrics`.
        trust_flow: null,
      };
      const score = scoreFromPresentMetrics(present);
      if (score === null) {
        const reason =
          'Ahrefs returned no backlink metrics for this domain, so inbound authority could not be established. This is missing provider data, not a measurement of zero backlinks.';
        logProviderCall({
          providerId: this.id,
          operation: 'lookup',
          status: 'unavailable',
          reason: 'empty_metrics',
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
      const profile: BacklinkProfile = {
        // `BacklinkProfile` types these two as non-nullable (owned elsewhere, not widened here).
        // The `?? 0` survives ONLY to satisfy that type; the absent/zero distinction that matters
        // is held in `present` and is what the score, count and observations are derived from, so
        // no absent field reaches a published number or claim.
        referring_domains: present.referring_domains ?? 0,
        total_backlinks: present.total_backlinks ?? 0,
        domain_authority: present.domain_authority,
        topical_authority: null,
        trust_flow: present.trust_flow,
        spam_score: null,
        freshness: freshnessFromTimestamp(observedAt),
      };
      const observations = [
        present.domain_authority !== null
          ? { signal: `ahrefs:domain_rating:${present.domain_authority}`, source: 'backlink_api' as const, observed_at: observedAt }
          : null,
        present.referring_domains !== null
          ? { signal: `ahrefs:refdomains:${present.referring_domains}`, source: 'backlink_api' as const, observed_at: observedAt }
          : null,
        present.total_backlinks !== null
          ? { signal: `ahrefs:backlinks:${present.total_backlinks}`, source: 'backlink_api' as const, observed_at: observedAt }
          : null,
      ].filter((observation): observation is NonNullable<typeof observation> => observation !== null);
      const evidence: EvidenceTrace = {
        // Confidence is earned per metric that actually arrived, not from a flat 3-or-1 that a
        // fabricated zero could satisfy.
        count: observations.length,
        sources: ['backlink_api'],
        freshness: freshnessFromTimestamp(observedAt),
        observations,
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
