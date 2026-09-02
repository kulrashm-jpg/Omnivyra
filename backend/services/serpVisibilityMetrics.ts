/**
 * Search visibility from SERP observations (Phase 3).
 *
 * Derives Report 1's search-visibility reading from ACTUAL observed rankings, under the
 * Phase 2 evidence contract. Two rules are structural rather than advisory:
 *
 *  1. A SERP observation is a POSITION, never traffic. Nothing in this module produces an
 *     impression, click, session or share-of-traffic figure, and no ranking is multiplied by
 *     a CTR curve. `estimated_lost_clicks` elsewhere in the report is derived from measured
 *     Search Console impressions/clicks — a different, connected source — and is deliberately
 *     not reachable from here.
 *  2. Below the minimum query coverage the score ABSTAINS. A handful of rankings is not a
 *     visibility assessment, and publishing a number from three queries would be exactly the
 *     false precision Phase 2 removed.
 */
import {
  type ConfidenceBand,
  type ScoreEnvelope,
  bandFromEvidence,
  emptyEnvelope,
} from './snapshotReport/canonicalScoreState';
import type { QueryClass, QueryIntent } from './serpQueryUniverse';

/** One observed ranking for one query. The unit of SERP evidence. */
export interface SerpObservation {
  query: string;
  queryClass: QueryClass;
  intent: QueryIntent;
  /** 1-based rank of the company's own domain, or null when it did not appear. */
  position: number | null;
  resultUrl: string | null;
  resultTitle: string | null;
  /** Competitor domains observed on this query, in rank order. */
  competitorDomains: string[];
  engine: string;
  provider: string;
  geography: string | null;
  device: string | null;
  observedAt: string;
}

/**
 * MINIMUM QUERY COVERAGE before a visibility score may be published.
 *
 * Set to 5. The report's own confidence model (`CONFIDENCE_EVIDENCE`) treats 4 signals as the
 * threshold for high confidence; a visibility score aggregates ACROSS queries, so it needs at
 * least that many independent observations before an average position or a coverage ratio
 * describes anything stable. Five is the smallest count that clears the platform's own
 * high-confidence bar with one observation to spare, and it keeps a single lucky or unlucky
 * ranking from moving the headline.
 */
export const MIN_QUERY_COVERAGE = 5;

/** Position bands. Standard search-industry buckets; no derived traffic. */
export const POSITION_BANDS = { top3: 3, top10: 10, top20: 20 } as const;

export interface VisibilityBreakdown {
  queriesObserved: number;
  queriesRanked: number;
  /** Share of observed queries where the domain appeared at all, 0..1. */
  coverageRate: number | null;
  top3: number;
  top10: number;
  top20: number;
  /** Mean position across queries where the domain ranked. Null when it never ranked. */
  averagePosition: number | null;
  bestPosition: number | null;
}

export interface CompetitorVisibility {
  domain: string;
  /** Queries (of those observed) where this domain appeared. */
  queriesAppeared: number;
  appearanceRate: number;
  averagePosition: number | null;
  bestPosition: number | null;
  /** Queries where the competitor ranked and the company did not — the actionable gap. */
  gapQueries: string[];
}

export interface SearchVisibilityResult {
  /** Overall visibility envelope. Abstains below MIN_QUERY_COVERAGE. */
  score: ScoreEnvelope;
  overall: VisibilityBreakdown;
  byIntent: Record<QueryIntent, VisibilityBreakdown>;
  competitors: CompetitorVisibility[];
  /** Non-null only when the score abstained; states exactly what is missing. */
  abstainReason: string | null;
  /** Explicit, machine-checkable assertion that no traffic figure was derived. */
  trafficDerived: false;
}

function emptyBreakdown(): VisibilityBreakdown {
  return {
    queriesObserved: 0, queriesRanked: 0, coverageRate: null,
    top3: 0, top10: 0, top20: 0, averagePosition: null, bestPosition: null,
  };
}

function breakdown(observations: readonly SerpObservation[]): VisibilityBreakdown {
  const observed = observations.length;
  if (observed === 0) return emptyBreakdown();
  const ranked = observations.filter((o) => typeof o.position === 'number' && o.position > 0);
  const positions = ranked.map((o) => o.position as number);
  return {
    queriesObserved: observed,
    queriesRanked: ranked.length,
    coverageRate: Number((ranked.length / observed).toFixed(4)),
    top3: positions.filter((p) => p <= POSITION_BANDS.top3).length,
    top10: positions.filter((p) => p <= POSITION_BANDS.top10).length,
    top20: positions.filter((p) => p <= POSITION_BANDS.top20).length,
    averagePosition: positions.length
      ? Number((positions.reduce((a, b) => a + b, 0) / positions.length).toFixed(2))
      : null,
    bestPosition: positions.length ? Math.min(...positions) : null,
  };
}

/**
 * Visibility score, 0..100, from coverage and position only.
 *
 * Formula: `coverageRate × positionQuality × 100`, where positionQuality maps average
 * position onto 0..1 as `(21 - avgPosition) / 20` clamped — position 1 → 1.0, position 20 → 0.05,
 * unranked → excluded from the average rather than scored as zero. Both inputs are direct
 * observations. There is deliberately NO benchmark term: no peer distribution is loaded (the
 * benchmark dataset remains unconfigured), so the score is stated as an absolute coverage
 * reading and its envelope carries the evidence count that produced it.
 */
function visibilityValue(overall: VisibilityBreakdown): number | null {
  if (overall.coverageRate === null || overall.averagePosition === null) return null;
  const positionQuality = Math.max(0, Math.min(1, (21 - overall.averagePosition) / 20));
  return Math.round(overall.coverageRate * positionQuality * 100);
}

/**
 * Build the search-visibility reading from observations. Pure and deterministic.
 * Never throws; an empty observation set abstains.
 */
export function buildSearchVisibility(params: {
  observations: readonly SerpObservation[];
  ownDomain: string;
}): SearchVisibilityResult {
  const observations = params.observations ?? [];
  const overall = breakdown(observations);

  const byIntent = {
    branded: breakdown(observations.filter((o) => o.intent === 'branded')),
    commercial: breakdown(observations.filter((o) => o.intent === 'commercial')),
    informational: breakdown(observations.filter((o) => o.intent === 'informational')),
  } as Record<QueryIntent, VisibilityBreakdown>;

  // Competitor visibility over the SAME query universe — the only apples-to-apples comparison
  // available from SERP alone.
  const byCompetitor = new Map<string, { positions: number[]; queries: Set<string>; gaps: string[] }>();
  for (const observation of observations) {
    const companyRanked = typeof observation.position === 'number';
    observation.competitorDomains.forEach((domain, index) => {
      if (!domain || domain === params.ownDomain) return;
      const entry = byCompetitor.get(domain) ?? { positions: [], queries: new Set<string>(), gaps: [] };
      entry.positions.push(index + 1);
      entry.queries.add(observation.query);
      if (!companyRanked) entry.gaps.push(observation.query);
      byCompetitor.set(domain, entry);
    });
  }

  const competitors: CompetitorVisibility[] = [...byCompetitor.entries()]
    .map(([domain, entry]) => ({
      domain,
      queriesAppeared: entry.queries.size,
      appearanceRate: observations.length
        ? Number((entry.queries.size / observations.length).toFixed(4))
        : 0,
      averagePosition: entry.positions.length
        ? Number((entry.positions.reduce((a, b) => a + b, 0) / entry.positions.length).toFixed(2))
        : null,
      bestPosition: entry.positions.length ? Math.min(...entry.positions) : null,
      gapQueries: [...new Set(entry.gaps)],
    }))
    .sort((left, right) => right.queriesAppeared - left.queriesAppeared);

  // ── Evidence gate ───────────────────────────────────────────────────────────
  if (observations.length < MIN_QUERY_COVERAGE) {
    return {
      score: {
        ...emptyEnvelope(observations.length === 0 ? 'unavailable' : 'insufficient_signal'),
        evidence_count: observations.length,
        evidence_sources: observations.length ? ['serp'] : [],
      },
      overall,
      byIntent,
      competitors,
      abstainReason: observations.length === 0
        ? 'No SERP observations are available for this domain, so search visibility cannot be measured.'
        : `Only ${observations.length} SERP observation${observations.length === 1 ? '' : 's'} — below the ${MIN_QUERY_COVERAGE}-query minimum required to publish a visibility score.`,
      trafficDerived: false,
    };
  }

  const value = visibilityValue(overall);
  const confidence: ConfidenceBand = bandFromEvidence(observations.length, true);

  return {
    score: value === null
      ? {
        ...emptyEnvelope('insufficient_signal'),
        evidence_count: observations.length,
        evidence_sources: ['serp'],
      }
      : {
        value,
        state: 'measured',
        confidence,
        evidence_count: observations.length,
        evidence_sources: ['serp'],
        freshness: {
          last_observed_at: observations.map((o) => o.observedAt).sort().reverse()[0] ?? null,
          age_hours: null,
        },
      },
    overall,
    byIntent,
    competitors,
    abstainReason: value === null
      ? 'The domain did not rank for any observed query, so an average position cannot be computed.'
      : null,
    trafficDerived: false,
  };
}
