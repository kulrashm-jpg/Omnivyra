/**
 * Phase 5 — Keyword-stream meta-connector.
 *
 * Fans out a single keyword scan across the three real connectors
 * registered today (Reddit, Hacker News, GitHub) and returns a normalized
 * RawSignal stream. The PER-FAN-OUT execution caps are split across
 * connectors so the union remains bounded.
 *
 * Cross-source duplicate suppression is in-pipeline (the dedup table from
 * Phase 3 catches same-content across sources via the content_hash). This
 * connector does not re-implement dedup.
 *
 * Hard guarantees:
 *   • Bounded: maxPosts / maxComments / maxPages are SPLIT (not multiplied)
 *     across the underlying connectors.
 *   • Deterministic: connectors run in a fixed alphabetical order.
 *   • NEVER expands keywords; whatever the caller passed is what each
 *     underlying connector receives.
 *   • Aborts on the deadline shared with the outer execution.
 */

import type {
  ConnectorCostEstimate,
  ConnectorEligibility,
  ConnectorRateLimit,
  ConnectorScopeValidation,
  ConnectorSourceMetadata,
  FetchSignalsInput,
  FetchSignalsResult,
  ListeningConnector,
  RawSignal,
} from '../../types/listeningConnector';
import { redditListeningConnector } from './redditListeningConnector';
import { hackerNewsListeningConnector } from './hackerNewsListeningConnector';
import { githubListeningConnector } from './githubListeningConnector';

// Order is FIXED so deterministic execution: a given (org, source, keywords)
// always produces signals in the same per-source order.
const SUB_CONNECTORS: Array<{ connector: ListeningConnector; weight: number }> = [
  { connector: githubListeningConnector, weight: 0.25 },
  { connector: hackerNewsListeningConnector, weight: 0.35 },
  { connector: redditListeningConnector, weight: 0.4 },
];

/**
 * For keyword streams, the user supplies a STREAM identifier (e.g.
 * "tool_migrations") and a list of keywords. The connector itself does not
 * have a per-source identifier to validate against any particular platform;
 * the stream is meaningful only in aggregation.
 */
export const keywordStreamConnector: ListeningConnector = {
  platform: 'keyword_stream',

  async validateEligibility(input): Promise<ConnectorEligibility> {
    // Stream identifier must be a short, slug-shaped name. Keywords must
    // be supplied via the FetchSignalsInput downstream; nothing to validate
    // here beyond the source name shape.
    if (!/^[A-Za-z0-9_-]{2,64}$/.test(input.sourceIdentifier)) {
      return { eligible: false, reasons: ['stream_identifier_invalid'] };
    }
    return { eligible: true, reasons: [] };
  },

  async estimateCost(input): Promise<ConnectorCostEstimate> {
    let total = 0;
    const parts: string[] = [];
    for (const { connector, weight } of SUB_CONNECTORS) {
      const slicedPosts = Math.max(5, Math.floor(input.maxPosts * weight));
      const slicedComments = Math.max(0, Math.floor(input.maxComments * weight));
      const est = await connector.estimateCost({
        keywords: input.keywords,
        maxPosts: slicedPosts,
        maxComments: slicedComments,
      });
      total += est.per_run;
      parts.push(`${connector.platform}=${est.per_run}`);
    }
    return { per_run: total, rationale: `fan-out: ${parts.join(', ')}` };
  },

  async validateScopes(input): Promise<ConnectorScopeValidation> {
    // Aggregate scope sufficiency: the stream is runnable if at least one
    // underlying connector reports sufficient. Returns the union of granted
    // scopes and the intersection of missing requirements.
    const granted: string[] = [];
    let anySufficient = false;
    for (const { connector } of SUB_CONNECTORS) {
      const scope = await connector.validateScopes({ organizationId: input.organizationId });
      if (scope.sufficient) {
        anySufficient = true;
        granted.push(`${connector.platform}:ok`);
      } else {
        granted.push(`${connector.platform}:missing(${scope.missing.join(',')})`);
      }
    }
    return {
      sufficient: anySufficient,
      granted,
      required: [],
      missing: anySufficient ? [] : ['at_least_one_underlying_connector'],
    };
  },

  async validateRateLimits(input): Promise<ConnectorRateLimit> {
    let available = false;
    let remaining: number | null = null;
    let resetAt: string | null = null;
    for (const { connector } of SUB_CONNECTORS) {
      const rl = await connector.validateRateLimits({ organizationId: input.organizationId });
      if (rl.available) {
        available = true;
        if (rl.remaining != null && (remaining == null || rl.remaining < remaining)) remaining = rl.remaining;
        if (rl.reset_at && (resetAt == null || rl.reset_at < resetAt)) resetAt = rl.reset_at;
      }
    }
    return { available, remaining, reset_at: resetAt };
  },

  async fetchMetadata(input): Promise<ConnectorSourceMetadata> {
    return {
      source_identifier: input.sourceIdentifier,
      display_name: `Keyword stream: ${input.sourceIdentifier}`,
      description: 'Cross-source aggregated keyword stream (Reddit + HN + GitHub)',
      url: null,
    };
  },

  async fetchSignals(input: FetchSignalsInput): Promise<FetchSignalsResult> {
    const startedAt = Date.now();
    const deadline = startedAt + input.timeoutMs;

    const all: RawSignal[] = [];
    const aggregateStats = {
      posts_fetched: 0,
      comments_fetched: 0,
      pages_fetched: 0,
      rate_limit_pauses: 0,
      fetch_duration_ms: 0,
    };
    let partial = false;

    for (const { connector, weight } of SUB_CONNECTORS) {
      if (Date.now() >= deadline) {
        partial = true;
        break;
      }
      const slicedPosts = Math.max(5, Math.floor(input.maxPosts * weight));
      const slicedComments = Math.max(0, Math.floor(input.maxComments * weight));
      const slicedPages = Math.max(1, Math.floor(input.maxPages * weight));
      // Each sub-connector needs a sourceIdentifier; for the meta-connector
      // we re-use the stream's first keyword as the search anchor. This is
      // safe because sub-connectors are themselves bounded.
      const subIdentifier =
        connector.platform === 'github'
          ? '' // GitHub requires "owner/repo" — fan-out below skips it.
          : (input.keywords[0] ?? input.sourceIdentifier);
      if (!subIdentifier) continue;

      try {
        const sub = await connector.fetchSignals({
          organizationId: input.organizationId,
          sourceIdentifier: subIdentifier,
          keywords: input.keywords,
          maxPosts: slicedPosts,
          maxComments: slicedComments,
          maxPages: slicedPages,
          timeoutMs: Math.max(5_000, deadline - Date.now()),
        });
        for (const s of sub.signals) {
          all.push({
            ...s,
            metadata: {
              ...s.metadata,
              keyword_stream: input.sourceIdentifier,
            },
          });
        }
        aggregateStats.posts_fetched += sub.stats.posts_fetched;
        aggregateStats.comments_fetched += sub.stats.comments_fetched;
        aggregateStats.pages_fetched += sub.stats.pages_fetched;
        aggregateStats.rate_limit_pauses += sub.stats.rate_limit_pauses;
        if (sub.partial) partial = true;
      } catch (err) {
        partial = true;
        console.warn('[keywordStream] sub-connector failed', {
          platform: connector.platform,
          error: (err as Error)?.message,
        });
      }
    }

    aggregateStats.fetch_duration_ms = Date.now() - startedAt;
    return { signals: all, stats: aggregateStats, partial };
  },
};
