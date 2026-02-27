/**
 * Strategic Feedback Intelligence.
 * Read-only analysis layer. No ranking, scoring, or filtering changes.
 */

import { buildCompanyStrategyDNA, type CompanyStrategyDNA } from './companyStrategyDNAService';
import {
  buildWeightedAlignmentTokens,
  computeAlignmentScore,
  computeStrategyModifier,
} from './recommendationEngineService';
import type { TrendSignalNormalized } from './trendProcessingService';

export type AuthorityStrength = 'weak' | 'medium' | 'strong';
export type ProblemClarity = 'weak' | 'medium' | 'strong';

export type StrategyFeedback = {
  authority_strength: AuthorityStrength;
  problem_clarity: ProblemClarity;
  strategic_alignment_health: number;
  dominant_diamond_type: string | null;
  strategy_warning: string | null;
  strategic_recommendations: string[];
};

const tokenize = (value: string): string[] =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((t) => t.trim())
    .filter((t) => t.length > 2);

function pctToStrength(pct: number): AuthorityStrength | ProblemClarity {
  if (pct >= 60) return 'strong';
  if (pct >= 30) return 'medium';
  return 'weak';
}

function getDiamondType(rec: Record<string, unknown>): string | null {
  const flags = rec.polish_flags as
    | { authority_elevated?: boolean; diamond_candidate?: boolean; is_generic_reframed?: boolean }
    | undefined;
  if (!flags) return null;
  if (flags.authority_elevated) return 'authority_elevated';
  if (flags.diamond_candidate) return 'diamond_candidate';
  if (flags.is_generic_reframed) return 'generic_reframed';
  return null;
}

/**
 * Analyzes recommendations to reveal strategy strengths/weaknesses.
 * Read-only. Does not affect ranking, scoring, or filtering.
 */
export function analyzeStrategySignals(
  recommendations: Array<Record<string, unknown> & { topic: string }>,
  strategyDNA: CompanyStrategyDNA | null | undefined,
  profile: any
): StrategyFeedback {
  if (!recommendations || recommendations.length === 0) {
    return {
      authority_strength: 'weak',
      problem_clarity: 'weak',
      strategic_alignment_health: 0,
      dominant_diamond_type: null,
      strategy_warning: 'Company strategy signals are too broad or under-defined.',
      strategic_recommendations: [
        'Add or refine authority_domains in profile.',
        'Clarify core_problem_statement and pain_symptoms.',
        'Narrow campaign_focus or growth_priorities.',
        'Define underserved transformation angle.',
      ],
    };
  }

  const authTokens = new Set(
    (Array.isArray(profile?.authority_domains) ? profile.authority_domains : [])
      .flatMap((s: string) => tokenize(s))
      .filter((t) => t.length > 2)
  );
  const problemTokens = new Set([
    ...(profile?.core_problem_statement ? tokenize(String(profile.core_problem_statement)) : []),
    ...(Array.isArray(profile?.pain_symptoms)
      ? profile.pain_symptoms.flatMap((s: string) => tokenize(s))
      : []),
  ].filter((t) => t.length > 2));

  let authorityOverlapCount = 0;
  let problemOverlapCount = 0;
  const diamondTypeCounts: Record<string, number> = {};
  const weightedTokens = buildWeightedAlignmentTokens(profile);
  const volumes = recommendations.map((r) => Number((r as any).volume ?? 0) || 0);
  const volumeMax = Math.max(...volumes, 1);
  const volumeMedian =
    volumes.length > 0
      ? (() => {
          const sorted = [...volumes].sort((a, b) => a - b);
          const mid = Math.floor(sorted.length / 2);
          return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        })()
      : 0;

  let alignmentSum = 0;

  for (const rec of recommendations) {
    const topic = String(rec.topic || '').trim();
    const topicTokens = new Set(tokenize(topic));

    if (authTokens.size > 0 && [...topicTokens].some((t) => authTokens.has(t))) {
      authorityOverlapCount++;
    }
    if (problemTokens.size > 0 && [...topicTokens].some((t) => problemTokens.has(t))) {
      problemOverlapCount++;
    }

    const dt = getDiamondType(rec);
    if (dt) {
      diamondTypeCounts[dt] = (diamondTypeCounts[dt] ?? 0) + 1;
    }

    const alignmentScore = weightedTokens.size > 0 ? computeAlignmentScore(topic, weightedTokens) : 0.5;
    const modifier = computeStrategyModifier(strategyDNA ?? null, rec as TrendSignalNormalized, profile, {
      alignmentScore,
      volumeMax,
      volumeMedian,
    });
    alignmentSum += alignmentScore * modifier;
  }

  const n = recommendations.length;
  const authorityPct = authTokens.size > 0 ? (authorityOverlapCount / n) * 100 : 0;
  const problemPct = problemTokens.size > 0 ? (problemOverlapCount / n) * 100 : 0;

  const avgFinalAlignment = n > 0 ? alignmentSum / n : 0;
  const strategic_alignment_health = Math.round(Math.min(100, (avgFinalAlignment / 1.25) * 100));

  const diamondEntries = Object.entries(diamondTypeCounts);
  const dominant_diamond_type =
    diamondEntries.length > 0
      ? diamondEntries.reduce((a, b) => (b[1] > a[1] ? b : a))[0]
      : null;

  const strategy_warning =
    strategic_alignment_health < 40 || pctToStrength(authorityPct) === 'weak'
      ? 'Company strategy signals are too broad or under-defined.'
      : null;

  const authorityStrength = pctToStrength(authorityPct);
  const problemClarity = pctToStrength(problemPct);

  const strategic_recommendations: string[] = [];
  if (authorityStrength === 'weak') {
    strategic_recommendations.push('Add or refine authority_domains in profile.');
  }
  if (problemClarity === 'weak') {
    strategic_recommendations.push('Clarify core_problem_statement and pain_symptoms.');
  }
  if (strategic_alignment_health < 40) {
    strategic_recommendations.push('Narrow campaign_focus or growth_priorities.');
  }
  if (dominant_diamond_type === null) {
    strategic_recommendations.push('Define underserved transformation angle.');
  }

  return {
    authority_strength: authorityStrength,
    problem_clarity: problemClarity,
    strategic_alignment_health,
    dominant_diamond_type,
    strategy_warning,
    strategic_recommendations,
  };
}
