/**
 * Phase 4 — Community discovery engine.
 *
 * Pure function: given an org profile, return a ranked list of community
 * recommendations from the curated seed dataset. NEVER queries an external
 * search API, NEVER asks an LLM to invent communities, NEVER paginates
 * outside the seed file.
 *
 * Each returned candidate has:
 *   • A deterministic relevance score (industry + keyword overlap).
 *   • A short, human-readable rationale composed from the seed's prior +
 *     the org-profile match — the "WHY" the recommendation engine spec
 *     requires.
 *   • Estimated signal quality / volume / cost / strategic relevance.
 *
 * Tenant-safe by construction: the org profile is the only input. No
 * cross-tenant data flows through this service.
 */

import { estimateCredits } from './creditEstimationService';
import { inferIndustryVolatility } from './industryGuidanceService';
import {
  SUBREDDIT_SEEDS,
  KEYWORD_STREAM_SEEDS,
  deriveCompetitorDomainSeeds,
  type SubredditSeed,
  type KeywordStreamSeed,
} from '../data/communityDiscoverySeeds';
import type { RecommendationCategory } from '../types/communityRecommendation';

export type DiscoveryProfile = {
  organizationId: string;
  industryCategory: string | null;
  description: string | null;
  /** ICP / persona description if available. */
  icp: string | null;
  /** Free-form keywords the user supplied (or that we extracted earlier). */
  keywords: string[];
  /** Competitor brand names if known. */
  competitors: string[];
  /** Whether reddit is listening-enabled for the org. Influences subreddit ranking. */
  redditListeningReady: boolean;
};

export type DiscoveryCandidate = {
  source_type: 'subreddit' | 'keyword_stream' | 'competitor_domain';
  source_identifier: string;
  display_name: string;
  recommendation_reason: string;
  recommendation_category: RecommendationCategory;
  confidence_score: number;
  estimated_signal_quality: number;
  estimated_volume: number;
  estimated_cost: number;
  strategic_relevance: number;
  related_keywords: string[];
  related_competitors: string[];
  source_metadata: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tokenise(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s+#./-]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
}

function intersect(a: string[], b: string[]): string[] {
  const setB = new Set(b.map((x) => x.toLowerCase()));
  return [...new Set(a.map((x) => x.toLowerCase()))].filter((x) => setB.has(x));
}

function uniq(values: string[]): string[] {
  return [...new Set(values.map((v) => v.toLowerCase()))];
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

// ---------------------------------------------------------------------------
// Subreddit scoring
// ---------------------------------------------------------------------------

function scoreSubredditSeed(seed: SubredditSeed, profile: DiscoveryProfile): {
  relevance: number;
  matchedVerticals: string[];
  matchedKeywords: string[];
} {
  const profileTokens = uniq([
    ...tokenise(profile.industryCategory),
    ...tokenise(profile.description),
    ...tokenise(profile.icp),
    ...(profile.keywords ?? []).map((k) => k.toLowerCase()),
  ]);
  const matchedVerticals = intersect(seed.verticals, profileTokens);
  const matchedKeywords = intersect(seed.keywords, profileTokens);

  // Relevance = weighted blend of vertical and keyword overlap, capped at 1.
  // A direct vertical match dominates a keyword-only match.
  const verticalScore = Math.min(1, matchedVerticals.length * 0.4);
  const keywordScore = Math.min(1, matchedKeywords.length * 0.2);
  const baseline = matchedVerticals.length === 0 && matchedKeywords.length === 0 ? 0 : 0.15;
  const relevance = clamp01(baseline + verticalScore + keywordScore);

  return { relevance, matchedVerticals, matchedKeywords };
}

function buildSubredditRationale(seed: SubredditSeed, match: { matchedVerticals: string[]; matchedKeywords: string[] }): string {
  const parts: string[] = [];
  if (match.matchedVerticals.length > 0) {
    parts.push(`industry match (${match.matchedVerticals.slice(0, 3).join(', ')})`);
  }
  if (match.matchedKeywords.length > 0) {
    parts.push(`keyword overlap (${match.matchedKeywords.slice(0, 3).join(', ')})`);
  }
  const lead = parts.length > 0 ? `Recommended because of ${parts.join(' and ')}.` : 'Surfaced as a general-purpose community for buyer-intent discovery.';
  return `${lead} ${seed.rationale}`;
}

function classifySubredditCategory(seed: SubredditSeed, match: { matchedVerticals: string[]; matchedKeywords: string[] }): RecommendationCategory {
  if (seed.intent_density > 0.5 && seed.decision_maker > 0.55) return 'buyer_intent_hotspot';
  if (match.matchedVerticals.length > 0) return 'industry_match';
  if (match.matchedKeywords.length > 0) return 'keyword_density';
  return 'industry_match';
}

// ---------------------------------------------------------------------------
// Discovery entry point
// ---------------------------------------------------------------------------

const SUBREDDIT_TOP_N = 12;
const KEYWORD_STREAM_TOP_N = 5;

export type DiscoveryResult = {
  organization_id: string;
  generated_at: string;
  candidates: DiscoveryCandidate[];
};

export function discoverCommunityCandidates(profile: DiscoveryProfile): DiscoveryResult {
  const generatedAt = new Date().toISOString();
  const volatility = inferIndustryVolatility(profile.industryCategory);
  const candidates: DiscoveryCandidate[] = [];

  // ---- Subreddits ----
  const scoredSubreddits = SUBREDDIT_SEEDS
    .map((seed) => ({ seed, ...scoreSubredditSeed(seed, profile) }))
    .filter((entry) => entry.relevance > 0.1)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, SUBREDDIT_TOP_N);

  for (const entry of scoredSubreddits) {
    const seed = entry.seed;
    // Estimated cost: assume the same Reddit cost model used elsewhere.
    const estimate = estimateCredits({
      mode: 'alternate_days',
      platforms: ['reddit'],
      keywordCount: Math.max(profile.keywords.length, 5),
      industryVolatility: volatility,
    });
    const confidence = clamp01(entry.relevance * 0.7 + seed.signal_quality * 0.3);
    const strategic = clamp01(
      seed.signal_quality * 0.45
      + seed.intent_density * 0.35
      + seed.decision_maker * 0.2
      - seed.noise * 0.2,
    );
    candidates.push({
      source_type: 'subreddit',
      source_identifier: seed.source_identifier,
      display_name: seed.display_name,
      recommendation_reason: buildSubredditRationale(seed, entry),
      recommendation_category: classifySubredditCategory(seed, entry),
      confidence_score: Number(confidence.toFixed(3)),
      estimated_signal_quality: Number(seed.signal_quality.toFixed(3)),
      estimated_volume: Math.round(50 + (1 - seed.noise) * 200),
      estimated_cost: estimate.monthly_expected,
      strategic_relevance: Number(strategic.toFixed(3)),
      related_keywords: uniq([...seed.keywords, ...profile.keywords]).slice(0, 10),
      related_competitors: profile.competitors.slice(0, 5),
      source_metadata: {
        platform: 'reddit',
        seed_priors: {
          signal_quality: seed.signal_quality,
          intent_density: seed.intent_density,
          noise: seed.noise,
          decision_maker: seed.decision_maker,
        },
        matched_verticals: entry.matchedVerticals,
        matched_keywords: entry.matchedKeywords,
        listening_ready: profile.redditListeningReady,
      },
    });
  }

  // ---- Keyword streams ----
  const profileTokens = uniq([
    ...tokenise(profile.industryCategory),
    ...tokenise(profile.description),
    ...tokenise(profile.icp),
    ...(profile.keywords ?? []).map((k) => k.toLowerCase()),
  ]);
  const scoredStreams = KEYWORD_STREAM_SEEDS
    .map((seed: KeywordStreamSeed) => {
      const verticalMatch = intersect(seed.verticals, profileTokens);
      const relevance = clamp01(0.3 + verticalMatch.length * 0.25);
      return { seed, relevance, verticalMatch };
    })
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, KEYWORD_STREAM_TOP_N);

  for (const entry of scoredStreams) {
    candidates.push({
      source_type: 'keyword_stream',
      source_identifier: entry.seed.source_identifier,
      display_name: entry.seed.display_name,
      recommendation_reason: `${entry.seed.rationale}${entry.verticalMatch.length > 0 ? ` Matches your industry tags (${entry.verticalMatch.slice(0, 3).join(', ')}).` : ''}`,
      recommendation_category: 'keyword_density',
      confidence_score: Number(entry.relevance.toFixed(3)),
      estimated_signal_quality: 0.6,
      estimated_volume: 100,
      // Phase 4 keyword streams are not yet executable — cost is zero until a
      // Phase 5 connector consumes them. UI surfaces this explicitly via the
      // metadata flag below.
      estimated_cost: 0,
      strategic_relevance: Number(entry.relevance.toFixed(3)),
      related_keywords: uniq([...entry.seed.keywords, ...profile.keywords]).slice(0, 10),
      related_competitors: profile.competitors.slice(0, 5),
      source_metadata: {
        platform: 'cross_platform',
        execution_supported: false,
        execution_supported_phase: 5,
      },
    });
  }

  // ---- Competitor domains ----
  // Phase 4 only emits these when the user has supplied competitors; we
  // never invent competitor names.
  const competitorSeeds = deriveCompetitorDomainSeeds(profile.competitors);
  for (const seed of competitorSeeds) {
    candidates.push({
      source_type: 'competitor_domain',
      source_identifier: seed.source_identifier,
      display_name: seed.display_name,
      recommendation_reason: seed.rationale,
      recommendation_category: 'competitor_adjacent',
      confidence_score: 0.7,
      estimated_signal_quality: 0.65,
      estimated_volume: 80,
      estimated_cost: 0, // Phase 4 — competitor monitoring is configuration only.
      strategic_relevance: 0.75,
      related_keywords: profile.keywords.slice(0, 10),
      related_competitors: [seed.display_name],
      source_metadata: {
        platform: 'cross_platform',
        execution_supported: false,
        execution_supported_phase: 5,
      },
    });
  }

  return {
    organization_id: profile.organizationId,
    generated_at: generatedAt,
    candidates,
  };
}
