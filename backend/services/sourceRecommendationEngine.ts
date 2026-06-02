/**
 * Active Leads — Source Recommendation Engine (PR-CAR-2).
 *
 * Given a CompanyContext (PR-CAR-1) and a set of sources (either
 * candidates from discovery OR connected listening_sources for the
 * audit flow), score each source along SIX opportunity-discovery
 * dimensions, derive an overall tier, and identify the top types
 * the source is best for.
 *
 * Pure function. No DB writes. No new tables. Reuses the existing
 * seed dataset (communityDiscoverySeeds) — opportunity priors fall
 * back to derivation from signal_quality / intent_density /
 * decision_maker / noise when seeds do not yet have explicit
 * opportunity_priors (PR-CAR-5 will populate them explicitly).
 *
 * Scoring contract:
 *   1) For each opportunity type, start with the seed's prior (or
 *      a derived prior, or a source-type default).
 *   2) Apply company-context boosts (industry match, products match,
 *      competitor match, etc.) per type.
 *   3) Clamp to 0..1.
 *   4) Overall score = strategic_relevance * 0.6 + max(potentials) * 0.4
 *   5) Tier from overall score: >=0.7 highly_recommended,
 *      >=0.4 recommended, else low_relevance (PR-CAR-1 decision).
 *   6) best_for = potentials >= BEST_FOR_THRESHOLD, sorted desc, top 3.
 */

import type { CompanyContext } from './activeLeadsCompanyContext';
import {
  SUBREDDIT_SEEDS,
  KEYWORD_STREAM_SEEDS,
  type SubredditSeed,
  type KeywordStreamSeed,
  type OpportunityPriorsBySeed,
} from '../data/communityDiscoverySeeds';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OpportunityType =
  | 'buying_intent'
  | 'competitor_dissatisfaction'
  | 'migration_signal'
  | 'hiring_signal'
  | 'growth_signal'
  | 'integration_need';

export const SCORED_OPPORTUNITY_TYPES: readonly OpportunityType[] = [
  'buying_intent',
  'competitor_dissatisfaction',
  'migration_signal',
  'hiring_signal',
  'growth_signal',
  'integration_need',
] as const;

export type SourceTier = 'highly_recommended' | 'recommended' | 'low_relevance';

/**
 * Recommendation strength — a finer-grained label that supplements
 * (does not replace) SourceTier. Derived from the same overall_score
 * the tier uses, so the two are always consistent:
 *
 *   tier: highly_recommended (>=0.70) — strength may be Very Strong, Strong
 *   tier: recommended        (>=0.40) — strength may be Strong, Moderate, Weak
 *   tier: low_relevance      (<0.40)  — strength is always Weak
 *
 * UI typically renders both: "Highly Recommended · Very Strong".
 */
export type RecommendationStrength = 'very_strong' | 'strong' | 'moderate' | 'weak';

export type OpportunityPotential = {
  type: OpportunityType;
  score: number;
  rationale: string;
};

/**
 * Minimal source shape the engine accepts. Discovery candidates and
 * already-connected listening_sources both reduce to this. Optional
 * fields are filled in by the engine when missing (seed lookup +
 * source-type defaults).
 */
export type AbstractSource = {
  source_type: string;
  source_identifier: string;
  display_name?: string | null;
  /** From the existing discovery engine when present; otherwise computed. */
  strategic_relevance?: number;
  matched_verticals?: string[];
  matched_keywords?: string[];
  matched_competitors?: string[];
  /** Overrides for sources that bring their own priors (rare). */
  persona_tags?: string[];
  opportunity_priors?: OpportunityPriorsBySeed;
  /** From DiscoveryCandidate when present; otherwise derived. 0..1. */
  estimated_signal_quality?: number;
  /** From DiscoveryCandidate when present; otherwise derived. Raw count. */
  estimated_volume?: number;
};

export type YieldRating = 'high' | 'medium' | 'low';

/**
 * Source yield model. Four ratings + the underlying 0..1 scores so the
 * UI can show both bucket labels and the numeric driver. All four are
 * derived from existing inputs (estimated_signal_quality,
 * estimated_volume, strategic_relevance, opportunity_potentials) — no
 * new persistence, per spec.
 */
export type SourceYield = {
  lead_potential: YieldRating;
  signal_volume: YieldRating;
  signal_quality: YieldRating;
  discovery_efficiency: YieldRating;
  scores: {
    lead_potential: number;
    signal_volume: number;
    signal_quality: number;
    discovery_efficiency: number;
  };
};

export type ScoredSource = {
  source_type: string;
  source_identifier: string;
  display_name: string;
  overall_score: number;
  tier: SourceTier;
  /** PR-CAR-2.2: finer-grained label supplementing tier. */
  strength: RecommendationStrength;
  best_for: OpportunityType[];
  opportunity_potentials: OpportunityPotential[];
  persona_tags: string[];
  context_match: {
    strategic_relevance: number;
    matched_verticals: string[];
    matched_keywords: string[];
    matched_competitors: string[];
  };
  /** Top-line "why" string for the UI card header. */
  rationale: string;
  /** 4-dimension yield model (PR-CAR-2.1). */
  yield: SourceYield;
};

// ---------------------------------------------------------------------------
// Tier + best-for thresholds (single source of truth; deliberately small).
// ---------------------------------------------------------------------------

export const TIER_THRESHOLDS = {
  highly_recommended: 0.7,
  recommended: 0.4,
} as const;

/**
 * Recommendation-strength thresholds. Spec PR-CAR-2.2:
 *   >=0.85 Very Strong, >=0.70 Strong, >=0.55 Moderate, else Weak.
 */
export const STRENGTH_THRESHOLDS = {
  very_strong: 0.85,
  strong: 0.70,
  moderate: 0.55,
} as const;

export const STRENGTH_LABELS: Record<RecommendationStrength, string> = {
  very_strong: 'Very Strong',
  strong: 'Strong',
  moderate: 'Moderate',
  weak: 'Weak',
};

export const BEST_FOR_THRESHOLD = 0.55;
export const BEST_FOR_MAX = 3;

/**
 * Yield bucket thresholds. Apply to each of the four yield scores (0..1).
 * High >= 0.65, Medium >= 0.35, else Low. Chosen so the spec's example
 * pair (Reddit "High/Medium/High/High", X "Medium/High/Low/Medium")
 * lands cleanly given the default source-type yield priors below.
 */
export const YIELD_THRESHOLDS = {
  high: 0.65,
  medium: 0.35,
} as const;

/**
 * Volume normalization range. estimated_volume is a raw count; the
 * engine maps it onto 0..1 over this range. The bounds match the
 * order of magnitude the existing discovery service produces (50–250).
 */
const VOLUME_RANGE = { floor: 30, ceiling: 250 } as const;

// ---------------------------------------------------------------------------
// Source-type defaults (used when no seed match)
// ---------------------------------------------------------------------------

const SOURCE_TYPE_DEFAULT_PRIORS: Record<string, Required<OpportunityPriorsBySeed>> = {
  subreddit: {
    buying_intent: 0.45,
    competitor_dissatisfaction: 0.40,
    migration_signal: 0.40,
    hiring_signal: 0.20,
    growth_signal: 0.25,
    integration_need: 0.35,
  },
  keyword_stream: {
    buying_intent: 0.60,
    competitor_dissatisfaction: 0.45,
    migration_signal: 0.55,
    hiring_signal: 0.25,
    growth_signal: 0.30,
    integration_need: 0.50,
  },
  competitor_domain: {
    buying_intent: 0.45,
    competitor_dissatisfaction: 0.70,
    migration_signal: 0.60,
    hiring_signal: 0.20,
    growth_signal: 0.25,
    integration_need: 0.30,
  },
  linkedin_topic: {
    buying_intent: 0.35,
    competitor_dissatisfaction: 0.25,
    migration_signal: 0.30,
    hiring_signal: 0.70,
    growth_signal: 0.65,
    integration_need: 0.25,
  },
  x_list: {
    buying_intent: 0.40,
    competitor_dissatisfaction: 0.40,
    migration_signal: 0.35,
    hiring_signal: 0.30,
    growth_signal: 0.55,
    integration_need: 0.30,
  },
  github_repo: {
    buying_intent: 0.30,
    competitor_dissatisfaction: 0.30,
    migration_signal: 0.45,
    hiring_signal: 0.15,
    growth_signal: 0.20,
    integration_need: 0.70,
  },
  hackernews: {
    buying_intent: 0.50,
    competitor_dissatisfaction: 0.45,
    migration_signal: 0.45,
    hiring_signal: 0.35,
    growth_signal: 0.55,
    integration_need: 0.65,
  },
  youtube_channel: {
    buying_intent: 0.25,
    competitor_dissatisfaction: 0.20,
    migration_signal: 0.25,
    hiring_signal: 0.15,
    growth_signal: 0.25,
    integration_need: 0.25,
  },
  rss_feed: {
    buying_intent: 0.30,
    competitor_dissatisfaction: 0.30,
    migration_signal: 0.30,
    hiring_signal: 0.25,
    growth_signal: 0.30,
    integration_need: 0.30,
  },
  telegram_group: {
    buying_intent: 0.45,
    competitor_dissatisfaction: 0.30,
    migration_signal: 0.35,
    hiring_signal: 0.25,
    growth_signal: 0.30,
    integration_need: 0.45,
  },
  discord_server: {
    buying_intent: 0.45,
    competitor_dissatisfaction: 0.30,
    migration_signal: 0.40,
    hiring_signal: 0.20,
    growth_signal: 0.25,
    integration_need: 0.55,
  },
  custom: {
    buying_intent: 0.30,
    competitor_dissatisfaction: 0.30,
    migration_signal: 0.30,
    hiring_signal: 0.25,
    growth_signal: 0.25,
    integration_need: 0.30,
  },
};

const FALLBACK_DEFAULT_PRIORS = SOURCE_TYPE_DEFAULT_PRIORS.custom;

/**
 * Source-type yield defaults — per-platform priors for signal quality
 * (0..1) and raw volume (count). Used when the per-source values
 * aren't supplied (e.g. a connected listening_source has no
 * estimated_volume yet, or a recommended source has no seed match).
 *
 * Values reflect the spec's worked examples:
 *   - subreddit:     mid quality, mid volume     → balanced
 *   - x_list:        low quality, high volume    → "Medium / High / Low / Medium" in spec
 *   - linkedin_topic: mid quality, mid volume    → hiring/growth tilt comes from priors
 *   - github_repo:   high quality, low volume    → integration-need rich
 */
const SOURCE_TYPE_DEFAULT_YIELD: Record<string, { signal_quality: number; volume: number }> = {
  subreddit:         { signal_quality: 0.55, volume: 150 },
  keyword_stream:    { signal_quality: 0.50, volume: 150 },
  competitor_domain: { signal_quality: 0.65, volume: 80  },
  linkedin_topic:    { signal_quality: 0.55, volume: 120 },
  x_list:            { signal_quality: 0.30, volume: 240 },
  github_repo:       { signal_quality: 0.65, volume: 50  },
  hackernews:        { signal_quality: 0.70, volume: 180 },
  youtube_channel:   { signal_quality: 0.40, volume: 80  },
  rss_feed:          { signal_quality: 0.50, volume: 100 },
  telegram_group:    { signal_quality: 0.45, volume: 120 },
  discord_server:    { signal_quality: 0.50, volume: 120 },
  custom:            { signal_quality: 0.45, volume: 100 },
};

const FALLBACK_DEFAULT_YIELD = SOURCE_TYPE_DEFAULT_YIELD.custom;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function intersectLower(a: string[] = [], b: string[] = []): string[] {
  if (a.length === 0 || b.length === 0) return [];
  const setB = new Set(b.map((x) => x.toLowerCase()));
  return [...new Set(a.map((x) => x.toLowerCase()))].filter((x) => setB.has(x));
}

function findSubredditSeed(identifier: string): SubredditSeed | undefined {
  const lower = identifier.toLowerCase();
  return SUBREDDIT_SEEDS.find((seed) => seed.source_identifier.toLowerCase() === lower);
}

function findKeywordStreamSeed(identifier: string): KeywordStreamSeed | undefined {
  const lower = identifier.toLowerCase();
  return KEYWORD_STREAM_SEEDS.find((seed) => seed.source_identifier.toLowerCase() === lower);
}

/**
 * Derive opportunity priors from existing subreddit-seed signal fields
 * when explicit priors aren't supplied. Until PR-CAR-5 populates the
 * full seed dataset, this is the graceful-fallback rule.
 *
 * Heuristics:
 *   buying_intent          ~ intent_density + 0.3 * decision_maker - 0.3 * noise
 *   competitor_dissat.     ~ intent_density * 0.7 + decision_maker * 0.3 - noise * 0.2
 *   migration_signal       ~ intent_density * 0.8 + decision_maker * 0.2 - noise * 0.3
 *   hiring_signal          ~ decision_maker * 0.6 - noise * 0.2
 *   growth_signal          ~ decision_maker * 0.4 + signal_quality * 0.2 - noise * 0.2
 *   integration_need       ~ signal_quality * 0.5 + intent_density * 0.3 - noise * 0.2
 */
function deriveSubredditPriors(seed: SubredditSeed): Required<OpportunityPriorsBySeed> {
  const { signal_quality: sq, intent_density: id, decision_maker: dm, noise: n } = seed;
  return {
    buying_intent: clamp01(id + 0.3 * dm - 0.3 * n),
    competitor_dissatisfaction: clamp01(id * 0.7 + dm * 0.3 - n * 0.2),
    migration_signal: clamp01(id * 0.8 + dm * 0.2 - n * 0.3),
    hiring_signal: clamp01(dm * 0.6 - n * 0.2),
    growth_signal: clamp01(dm * 0.4 + sq * 0.2 - n * 0.2),
    integration_need: clamp01(sq * 0.5 + id * 0.3 - n * 0.2),
  };
}

/**
 * Resolve the final per-source priors. Order of precedence:
 *   1) Source overrides (rare)
 *   2) Seed-level explicit opportunity_priors (PR-CAR-5)
 *   3) Derivation from existing seed fields (subreddit only)
 *   4) Source-type default
 *   5) Generic fallback
 */
function resolvePriors(source: AbstractSource): Required<OpportunityPriorsBySeed> {
  const sourceDefaults = SOURCE_TYPE_DEFAULT_PRIORS[source.source_type] ?? FALLBACK_DEFAULT_PRIORS;
  let basis: Required<OpportunityPriorsBySeed> = { ...sourceDefaults };

  if (source.source_type === 'subreddit') {
    const seed = findSubredditSeed(source.source_identifier);
    if (seed) {
      const derived = deriveSubredditPriors(seed);
      basis = { ...basis, ...derived };
      if (seed.opportunity_priors) {
        basis = { ...basis, ...seed.opportunity_priors } as Required<OpportunityPriorsBySeed>;
      }
    }
  } else if (source.source_type === 'keyword_stream') {
    const seed = findKeywordStreamSeed(source.source_identifier);
    if (seed?.opportunity_priors) {
      basis = { ...basis, ...seed.opportunity_priors } as Required<OpportunityPriorsBySeed>;
    }
  }

  if (source.opportunity_priors) {
    basis = { ...basis, ...source.opportunity_priors } as Required<OpportunityPriorsBySeed>;
  }

  // Clamp every value defensively.
  for (const type of SCORED_OPPORTUNITY_TYPES) {
    basis[type] = clamp01(basis[type]);
  }
  return basis;
}

/**
 * Resolve persona tags. Order of precedence:
 *   1) Source overrides
 *   2) Seed-level persona_tags
 *   3) Empty array (engine surfaces "personas not yet mapped" upstream)
 */
function resolvePersonaTags(source: AbstractSource): string[] {
  if (source.persona_tags && source.persona_tags.length > 0) return [...source.persona_tags];
  if (source.source_type === 'subreddit') {
    const seed = findSubredditSeed(source.source_identifier);
    if (seed?.persona_tags?.length) return [...seed.persona_tags];
  }
  if (source.source_type === 'keyword_stream') {
    const seed = findKeywordStreamSeed(source.source_identifier);
    if (seed?.persona_tags?.length) return [...seed.persona_tags];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Context boosts
// ---------------------------------------------------------------------------

type ContextMatch = {
  industryMatched: boolean;
  productsMatched: boolean;
  servicesMatched: boolean;
  competitorMatched: boolean;
  geographyMatched: boolean;
  growthStageHinted: boolean;
  matchedVerticals: string[];
  matchedKeywords: string[];
  matchedCompetitors: string[];
};

function evaluateContextMatch(
  context: CompanyContext,
  source: AbstractSource,
): ContextMatch {
  // Prefer pre-computed matches from the discovery engine; fall back to
  // intersecting against seed verticals/keywords when not provided.
  let matchedVerticals = source.matched_verticals ?? [];
  let matchedKeywords = source.matched_keywords ?? [];
  let matchedCompetitors = source.matched_competitors ?? [];

  if (source.source_type === 'subreddit' && (matchedVerticals.length === 0 && matchedKeywords.length === 0)) {
    const seed = findSubredditSeed(source.source_identifier);
    if (seed) {
      matchedVerticals = intersectLower(seed.verticals, context.industry.values);
      matchedKeywords = intersectLower(seed.keywords, [
        ...context.products.values,
        ...context.services.values,
      ]);
    }
  } else if (source.source_type === 'keyword_stream' && matchedVerticals.length === 0) {
    const seed = findKeywordStreamSeed(source.source_identifier);
    if (seed) {
      matchedVerticals = intersectLower(seed.verticals, context.industry.values);
      matchedKeywords = intersectLower(seed.keywords, [
        ...context.products.values,
        ...context.services.values,
      ]);
    }
  } else if (source.source_type === 'competitor_domain' && matchedCompetitors.length === 0) {
    const identifierLower = source.source_identifier.toLowerCase();
    if (context.competitors.values.includes(identifierLower)) {
      matchedCompetitors = [source.source_identifier];
    }
  }

  // Growth-stage hint: revenue stage present and signals "early"/"growth"/"scale-up"/etc.
  const revenueStageRaw = context.revenueStage.values.join(' ');
  const growthStageHinted = /(seed|pre[-\s]?seed|series\s?[ab]|early|growth|scale|expansion)/i.test(revenueStageRaw);

  const productOverlap = intersectLower(matchedKeywords, context.products.values);
  const serviceOverlap = intersectLower(matchedKeywords, context.services.values);

  return {
    industryMatched: matchedVerticals.length > 0,
    productsMatched: productOverlap.length > 0,
    servicesMatched: serviceOverlap.length > 0,
    competitorMatched: matchedCompetitors.length > 0,
    geographyMatched: context.geography.present,
    growthStageHinted,
    matchedVerticals,
    matchedKeywords,
    matchedCompetitors,
  };
}

function boostFor(
  type: OpportunityType,
  base: number,
  match: ContextMatch,
): number {
  let score = base;
  switch (type) {
    case 'buying_intent':
      if (match.industryMatched) score += 0.10;
      if (match.productsMatched) score += 0.05;
      break;
    case 'competitor_dissatisfaction':
      if (match.competitorMatched) score += 0.25;
      else if (match.industryMatched) score += 0.05;
      break;
    case 'migration_signal':
      if (match.productsMatched) score += 0.10;
      if (match.competitorMatched) score += 0.10;
      break;
    case 'hiring_signal':
      if (match.industryMatched) score += 0.10;
      if (match.growthStageHinted) score += 0.10;
      break;
    case 'growth_signal':
      if (match.industryMatched) score += 0.10;
      if (match.growthStageHinted) score += 0.10;
      if (match.geographyMatched) score += 0.05;
      break;
    case 'integration_need':
      if (match.productsMatched) score += 0.10;
      if (match.servicesMatched) score += 0.05;
      break;
  }
  return clamp01(score);
}

// ---------------------------------------------------------------------------
// Per-opportunity rationale
// ---------------------------------------------------------------------------

const OPPORTUNITY_BASE_RATIONALE: Record<OpportunityType, string> = {
  buying_intent:
    'Buyer-intent posts ("looking for", "recommend a", "alternatives to") surface frequently.',
  competitor_dissatisfaction:
    'Users vent about competitor shortcomings here, which often precedes switching.',
  migration_signal:
    '"Switched from", "moving off", and tool-replacement discussions are common.',
  hiring_signal:
    'Role posts, team growth announcements, and recruiter chatter are well represented.',
  growth_signal:
    'Scaling, expansion, and funding/traction chatter is regular.',
  integration_need:
    'Integration questions ("how do I connect X to Y", "API for") appear often.',
};

function buildPerTypeRationale(
  type: OpportunityType,
  match: ContextMatch,
): string {
  const base = OPPORTUNITY_BASE_RATIONALE[type];
  const facets: string[] = [];
  if (type === 'competitor_dissatisfaction' && match.matchedCompetitors.length > 0) {
    facets.push(`directly tracks your competitors (${match.matchedCompetitors.slice(0, 2).join(', ')})`);
  }
  if (match.industryMatched && match.matchedVerticals.length > 0) {
    facets.push(`your industry (${match.matchedVerticals.slice(0, 2).join(', ')}) is well represented`);
  }
  if ((type === 'hiring_signal' || type === 'growth_signal') && match.growthStageHinted) {
    facets.push('your revenue stage aligns with growth-chatter volume here');
  }
  if (facets.length === 0) return base;
  return `${base} For your company, ${facets.join(' and ')}.`;
}

// ---------------------------------------------------------------------------
// Tier + composite
// ---------------------------------------------------------------------------

function deriveTier(overall: number): SourceTier {
  if (overall >= TIER_THRESHOLDS.highly_recommended) return 'highly_recommended';
  if (overall >= TIER_THRESHOLDS.recommended) return 'recommended';
  return 'low_relevance';
}

function deriveStrength(overall: number): RecommendationStrength {
  if (overall >= STRENGTH_THRESHOLDS.very_strong) return 'very_strong';
  if (overall >= STRENGTH_THRESHOLDS.strong) return 'strong';
  if (overall >= STRENGTH_THRESHOLDS.moderate) return 'moderate';
  return 'weak';
}

// ---------------------------------------------------------------------------
// Source yield (PR-CAR-2.1)
// ---------------------------------------------------------------------------

function bucketYield(score: number): YieldRating {
  if (score >= YIELD_THRESHOLDS.high) return 'high';
  if (score >= YIELD_THRESHOLDS.medium) return 'medium';
  return 'low';
}

function normalizeVolume(rawVolume: number): number {
  const { floor, ceiling } = VOLUME_RANGE;
  if (rawVolume <= floor) return 0;
  if (rawVolume >= ceiling) return 1;
  return (rawVolume - floor) / (ceiling - floor);
}

function resolveSignalQuality(source: AbstractSource): number {
  if (typeof source.estimated_signal_quality === 'number') {
    return clamp01(source.estimated_signal_quality);
  }
  if (source.source_type === 'subreddit') {
    const seed = findSubredditSeed(source.source_identifier);
    if (seed) return clamp01(seed.signal_quality);
  }
  const defaults = SOURCE_TYPE_DEFAULT_YIELD[source.source_type] ?? FALLBACK_DEFAULT_YIELD;
  return clamp01(defaults.signal_quality);
}

function resolveRawVolume(source: AbstractSource): number {
  if (typeof source.estimated_volume === 'number' && Number.isFinite(source.estimated_volume)) {
    return Math.max(0, source.estimated_volume);
  }
  const defaults = SOURCE_TYPE_DEFAULT_YIELD[source.source_type] ?? FALLBACK_DEFAULT_YIELD;
  return defaults.volume;
}

/**
 * Yield model.
 *
 *   signal_quality_score      = source.estimated_signal_quality (or seed/default)
 *   signal_volume_score       = normalize(volume) over [30, 250]
 *   lead_potential_score      = strategic_relevance * 0.4
 *                             + max(opportunity_potentials) * 0.4
 *                             + signal_quality * 0.2
 *   discovery_efficiency      = signal_quality * 0.7 + signal_volume * 0.3
 *
 * Each score is bucketed to High / Medium / Low via YIELD_THRESHOLDS.
 *
 * Discovery-efficiency formula is volume-light so high-quality + low-volume
 * sources (e.g. competitor domains, GitHub) still surface as High, while
 * high-volume + low-quality sources (e.g. X lists) can drag up to Medium.
 * This reproduces the spec's Reddit/X examples without bespoke per-source
 * curves.
 */
function computeSourceYield(
  signalQuality: number,
  rawVolume: number,
  strategicRelevance: number,
  maxPotential: number,
): SourceYield {
  const signal_quality = clamp01(signalQuality);
  const signal_volume = clamp01(normalizeVolume(rawVolume));
  const lead_potential = clamp01(
    strategicRelevance * 0.4 + maxPotential * 0.4 + signal_quality * 0.2,
  );
  const discovery_efficiency = clamp01(signal_quality * 0.7 + signal_volume * 0.3);

  return {
    lead_potential: bucketYield(lead_potential),
    signal_volume: bucketYield(signal_volume),
    signal_quality: bucketYield(signal_quality),
    discovery_efficiency: bucketYield(discovery_efficiency),
    scores: {
      lead_potential: Number(lead_potential.toFixed(3)),
      signal_volume: Number(signal_volume.toFixed(3)),
      signal_quality: Number(signal_quality.toFixed(3)),
      discovery_efficiency: Number(discovery_efficiency.toFixed(3)),
    },
  };
}

function buildTopLineRationale(
  source: AbstractSource,
  match: ContextMatch,
  bestFor: OpportunityType[],
  tier: SourceTier,
): string {
  const tierLabel =
    tier === 'highly_recommended' ? 'Highly recommended' :
    tier === 'recommended' ? 'Recommended' :
    'Lower relevance';
  if (bestFor.length === 0) {
    if (match.industryMatched) {
      return `${tierLabel}. Industry alignment (${match.matchedVerticals.slice(0, 2).join(', ')}) but no opportunity type stands out.`;
    }
    return `${tierLabel}. No strong opportunity-type signals detected for your company context.`;
  }
  const opportunityLabels = bestFor.map((t) => OPPORTUNITY_LABELS[t]).join(' and ');
  const reasons: string[] = [`strongest for ${opportunityLabels}`];
  if (match.competitorMatched) reasons.push(`tracks your competitors (${match.matchedCompetitors.slice(0, 2).join(', ')})`);
  else if (match.industryMatched) reasons.push(`matches your industry (${match.matchedVerticals.slice(0, 2).join(', ')})`);
  return `${tierLabel}. ${reasons.join('; ')}.`;
}

export const OPPORTUNITY_LABELS: Record<OpportunityType, string> = {
  buying_intent: 'Buying Intent',
  competitor_dissatisfaction: 'Competitor Dissatisfaction',
  migration_signal: 'Migration Signals',
  hiring_signal: 'Hiring Signals',
  growth_signal: 'Growth Signals',
  integration_need: 'Integration Needs',
};

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function scoreSourcesForOpportunities(
  context: CompanyContext,
  sources: AbstractSource[],
): ScoredSource[] {
  return sources.map((source) => scoreOneSource(context, source));
}

export function scoreOneSource(context: CompanyContext, source: AbstractSource): ScoredSource {
  const priors = resolvePriors(source);
  const personaTags = resolvePersonaTags(source);
  const match = evaluateContextMatch(context, source);

  const potentials: OpportunityPotential[] = SCORED_OPPORTUNITY_TYPES.map((type) => {
    const score = boostFor(type, priors[type], match);
    return {
      type,
      score: Number(score.toFixed(3)),
      rationale: buildPerTypeRationale(type, match),
    };
  }).sort((a, b) => b.score - a.score);

  const maxPotential = potentials[0]?.score ?? 0;

  // strategic_relevance is either supplied (discovery candidates) or
  // synthesized from the max potential.
  const strategicRelevance = clamp01(
    source.strategic_relevance ?? (maxPotential * 0.6 + (match.industryMatched ? 0.2 : 0) + (match.competitorMatched ? 0.1 : 0)),
  );

  const overallScore = clamp01(strategicRelevance * 0.6 + maxPotential * 0.4);
  const tier = deriveTier(overallScore);
  const strength = deriveStrength(overallScore);

  const bestFor = potentials
    .filter((p) => p.score >= BEST_FOR_THRESHOLD)
    .slice(0, BEST_FOR_MAX)
    .map((p) => p.type);

  const signalQuality = resolveSignalQuality(source);
  const rawVolume = resolveRawVolume(source);
  const yieldModel = computeSourceYield(
    signalQuality,
    rawVolume,
    strategicRelevance,
    maxPotential,
  );

  return {
    source_type: source.source_type,
    source_identifier: source.source_identifier,
    display_name: source.display_name || source.source_identifier,
    overall_score: Number(overallScore.toFixed(3)),
    tier,
    strength,
    best_for: bestFor,
    yield: yieldModel,
    opportunity_potentials: potentials,
    persona_tags: personaTags,
    context_match: {
      strategic_relevance: Number(strategicRelevance.toFixed(3)),
      matched_verticals: match.matchedVerticals,
      matched_keywords: match.matchedKeywords,
      matched_competitors: match.matchedCompetitors,
    },
    rationale: buildTopLineRationale(source, match, bestFor, tier),
  };
}

/**
 * Convenience: group scored sources by tier for UI rendering.
 */
export function groupScoredSourcesByTier(
  scored: ScoredSource[],
): Record<SourceTier, ScoredSource[]> {
  const groups: Record<SourceTier, ScoredSource[]> = {
    highly_recommended: [],
    recommended: [],
    low_relevance: [],
  };
  for (const item of scored) groups[item.tier].push(item);
  for (const tier of Object.keys(groups) as SourceTier[]) {
    groups[tier].sort((a, b) => b.overall_score - a.overall_score);
  }
  return groups;
}
