/**
 * Phase 2 — Industry-aware listening guidance.
 *
 * Lightweight, deterministic heuristics. Given an industry hint + platform
 * mix + source readiness, this service returns a recommendation
 * ("daily recommended", "weekly likely sufficient", etc.) and a one-line
 * rationale the UI can display under the mode selector.
 *
 * Strictly heuristic. No predictive ML, no fake precision. The keyword
 * tables below are intentionally narrow — false positives are worse than
 * missing matches, because a misleading recommendation could nudge a user
 * to spend more credits than necessary.
 */

import type {
  IndustryVolatility,
  ListeningMode,
} from '../types/listeningConfiguration';

const HIGH_VOLATILITY_KEYWORDS = [
  'crypto',
  'blockchain',
  'web3',
  'ai',
  'gaming',
  'streaming',
  'consumer tech',
  'media',
  'news',
  'gen z',
  'fashion',
  'beauty',
  'social media',
  'creator',
  'meme',
  'esports',
];

const MODERATE_VOLATILITY_KEYWORDS = [
  'saas',
  'software',
  'b2b',
  'marketing',
  'advertising',
  'martech',
  'devtools',
  'e-commerce',
  'ecommerce',
  'travel',
  'hospitality',
  'fintech',
  'edtech',
  'healthtech',
  'real estate',
];

const LOW_VOLATILITY_KEYWORDS = [
  'manufacturing',
  'logistics',
  'industrial',
  'agriculture',
  'energy',
  'utilities',
  'mining',
  'construction',
  'legal',
  'accounting',
  'government',
  'public sector',
  'insurance',
  'banking',
];

export function inferIndustryVolatility(category: string | null | undefined): IndustryVolatility {
  if (!category) return 'moderate';
  const text = category.toLowerCase();
  if (HIGH_VOLATILITY_KEYWORDS.some((k) => text.includes(k))) return 'high';
  if (LOW_VOLATILITY_KEYWORDS.some((k) => text.includes(k))) return 'low';
  if (MODERATE_VOLATILITY_KEYWORDS.some((k) => text.includes(k))) return 'moderate';
  return 'moderate';
}

export type SourceReadinessLevel = 'none' | 'low' | 'moderate' | 'strong';

export type GuidanceInput = {
  industryCategory: string | null;
  industryVolatility?: IndustryVolatility | null;
  platformCount: number;
  sourceReadiness: SourceReadinessLevel;
};

export type GuidanceOutput = {
  recommended_mode: ListeningMode;
  signal_density_expectation: 'low' | 'moderate' | 'high';
  rationale: string;
  industry_volatility: IndustryVolatility;
  warnings: string[];
};

/**
 * Deterministic recommendation. Identical inputs always produce identical
 * outputs. UI surfaces this beneath the mode selector so the user can see
 * why a frequency is recommended before they confirm.
 */
export function getListeningGuidance(input: GuidanceInput): GuidanceOutput {
  const volatility = input.industryVolatility
    ?? inferIndustryVolatility(input.industryCategory);

  const warnings: string[] = [];

  if (input.sourceReadiness === 'none') {
    warnings.push('No listening-ready sources yet — monitoring would block on activation.');
  } else if (input.sourceReadiness === 'low') {
    warnings.push('Few ready sources — expect sparse signal volume even at daily cadence.');
  }

  if (input.platformCount === 0) {
    warnings.push('No platforms selected — monitoring cannot run without at least one platform.');
  }

  let recommended_mode: ListeningMode;
  let signal_density_expectation: GuidanceOutput['signal_density_expectation'];
  let rationale: string;

  if (input.sourceReadiness === 'none' || input.platformCount === 0) {
    recommended_mode = 'manual_only';
    signal_density_expectation = 'low';
    rationale = 'Resolve readiness blockers before scheduling automatic runs.';
  } else if (volatility === 'high') {
    recommended_mode = 'daily';
    signal_density_expectation = 'high';
    rationale = 'High-velocity industry — daily monitoring catches market shifts quickly.';
  } else if (volatility === 'moderate') {
    recommended_mode = 'alternate_days';
    signal_density_expectation = 'moderate';
    rationale = 'Moderate-tempo industry — every other day balances signal coverage and credit burn.';
  } else {
    recommended_mode = 'weekly';
    signal_density_expectation = 'low';
    rationale = 'Slow-moving industry — weekly cadence typically surfaces all worthwhile signals.';
  }

  // Downgrade recommendation when readiness is weak even if volatility says
  // otherwise — there's no point recommending daily if there's nothing to
  // listen to.
  if (input.sourceReadiness === 'low' && recommended_mode === 'daily') {
    recommended_mode = 'alternate_days';
    rationale += ' Recommendation softened — current source readiness is low.';
  }

  return {
    recommended_mode,
    signal_density_expectation,
    rationale,
    industry_volatility: volatility,
    warnings,
  };
}
