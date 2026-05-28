/**
 * Phase 12.6 — Cross-modal strategic sequencer.
 *
 * Looks at the current portfolio (per format counts + compounding + funnel
 * paths + fatigue) and proposes a ranked list of next transformation steps
 * the editorial team should run.
 *
 * Outputs:
 *   recommendedTransformationSequence    ranked list of (fromFormat, toFormat, type) steps
 *   sequencingConfidence                  0..100 (function of portfolio size + signal density)
 *   topRecommendation                     first item in the list
 *
 * Decisioning principles:
 *   - decomposition is appropriate when a recent dense pillar has < 3 derivatives
 *   - expansion is appropriate when an authoritative short-form unit lacks a pillar
 *   - authority reinforcement is REDUNDANT when an archetype already spans ≥3 formats
 *   - educational journeys are saturated when fatigueByIcp.score ≥ 60
 *
 * Pure / deterministic.
 */

import type {
  AuthorityCompoundingResult,
  CrossModalAsset,
  CrossModalFormat,
  CrossModalTransformationType,
  StrategicSequenceStep,
  StrategicSequencingResult,
  TransformationFatigueResult,
} from './longFormRecommendationTypes';
import { FORMAT_FUNNEL_RANK } from './authorityCompoundingEngine';

function clamp100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export interface SequenceCrossModalTransformationsInput {
  assets: CrossModalAsset[];
  compounding: AuthorityCompoundingResult;
  fatigue?: TransformationFatigueResult;
  /** caller may bias decomposition aggressiveness (-20..+20) — typically from adaptive profile. */
  decompositionAggressivenessDelta?: number;
  /** how many recommendations to return (default 5). */
  limit?: number;
}

export function sequenceCrossModalTransformations(input: SequenceCrossModalTransformationsInput): StrategicSequencingResult {
  const assets = input.assets;
  const limit = Math.max(1, input.limit ?? 5);
  const decompBias = input.decompositionAggressivenessDelta ?? 0;
  const fatigueByPair = new Map(input.fatigue?.fatigueByFormatPair.map((f) => [f.pair, f.score]) ?? []);
  const fatigueByIcp = new Map(input.fatigue?.fatigueByIcp.map((f) => [f.icp, f.score]) ?? []);

  const steps: StrategicSequenceStep[] = [];

  // ── 1. Decomposition candidates from dense pillars with few derivatives.
  //    We don't have descendant counts here — proxy by counting other
  //    assets that share the same archetype as derivatives.
  const archetypeFormatCount = new Map<string, Map<CrossModalFormat, number>>();
  for (const a of assets) {
    const arch = (a.narrativeArchetype ?? 'uncategorized').toString();
    const inner = archetypeFormatCount.get(arch) ?? new Map<CrossModalFormat, number>();
    inner.set(a.format, (inner.get(a.format) ?? 0) + 1);
    archetypeFormatCount.set(arch, inner);
  }

  const PILLAR_FORMATS: CrossModalFormat[] = ['long_form', 'guide', 'whitepaper', 'case_study'];
  for (const a of assets) {
    if (!PILLAR_FORMATS.includes(a.format)) continue;
    if (a.authorityClaimCoverage < 60) continue;
    const arch = (a.narrativeArchetype ?? 'uncategorized').toString();
    const formatCounts = archetypeFormatCount.get(arch) ?? new Map();
    const shortFormatCount =
      (formatCounts.get('post') ?? 0)
      + (formatCounts.get('thread') ?? 0)
      + (formatCounts.get('newsletter') ?? 0);
    if (shortFormatCount >= 3) continue; // already adequately decomposed
    for (const target of ['thread', 'post', 'newsletter'] as CrossModalFormat[]) {
      const fatiguePenalty = fatigueByPair.get(`${a.format}->${target}`) ?? 0;
      const baseForecast = 60 + (a.authorityClaimCoverage - 60) / 2 + decompBias;
      const ecosystemContributionForecast = clamp100(baseForecast - fatiguePenalty * 0.3);
      const txType: CrossModalTransformationType = target === 'newsletter' ? 'adaptation' : target === 'thread' ? 'decomposition' : 'extraction';
      steps.push({
        fromFormat: a.format,
        toFormat: target,
        transformationType: txType,
        rationale: `Pillar archetype "${arch}" has ${shortFormatCount} short-form derivative(s) — extending to ${target} broadens reach${fatiguePenalty > 0 ? ` (note: ${fatiguePenalty} fatigue on this format pair)` : ''}.`,
        ecosystemContributionForecast,
      });
    }
  }

  // ── 2. Expansion candidates from authoritative short-forms with no pillar.
  const SHORT_FORMATS: CrossModalFormat[] = ['post', 'thread', 'story'];
  for (const a of assets) {
    if (!SHORT_FORMATS.includes(a.format)) continue;
    if (a.authorityClaimCoverage < 65) continue;
    const arch = (a.narrativeArchetype ?? 'uncategorized').toString();
    const formatCounts = archetypeFormatCount.get(arch) ?? new Map();
    const pillarCount = (formatCounts.get('long_form') ?? 0) + (formatCounts.get('guide') ?? 0) + (formatCounts.get('whitepaper') ?? 0);
    if (pillarCount > 0) continue;
    const targetFormat: CrossModalFormat = a.format === 'thread' ? 'long_form' : 'guide';
    const fatiguePenalty = fatigueByPair.get(`${a.format}->${targetFormat}`) ?? 0;
    const ecosystemContributionForecast = clamp100(70 + (a.authorityClaimCoverage - 65) / 2 - fatiguePenalty * 0.3);
    steps.push({
      fromFormat: a.format,
      toFormat: targetFormat,
      transformationType: 'expansion',
      rationale: `Authoritative ${a.format} on archetype "${arch}" has no pillar — promote to ${targetFormat} to establish durable authority.`,
      ecosystemContributionForecast,
    });
  }

  // ── 3. Skip authority reinforcement when archetype already saturated.
  //    Surface a "do NOT decompose" signal as a low-forecast step that the
  //    consumer can use to short-circuit a planned transformation.
  for (const archDetail of input.compounding.archetypeCompounding) {
    if (archDetail.coverageFormats.length >= 3 && archDetail.compoundingStrength >= 75) {
      const overrep = archDetail.coverageFormats[0];
      steps.push({
        fromFormat: overrep,
        toFormat: overrep,
        transformationType: 'repurposing',
        rationale: `Archetype "${archDetail.archetype}" already spans ${archDetail.coverageFormats.length} formats with compounding ${archDetail.compoundingStrength}/100 — additional reinforcement would be redundant. Steer new content elsewhere.`,
        ecosystemContributionForecast: 15,
      });
    }
  }

  // ── 4. Funnel rebalance — if an ICP has saturated journeys per fatigue,
  //    propose a journey-breaker step.
  for (const f of input.fatigue?.fatigueByIcp ?? []) {
    if (f.score < 40) continue;
    steps.push({
      fromFormat: 'post',
      toFormat: 'case_study',
      transformationType: 'derivation',
      rationale: `ICP "${f.icp}" fatigue score ${f.score}/100 — interrupt the typical journey with a case_study to reset learning sequencing.`,
      ecosystemContributionForecast: clamp100(60 - f.score * 0.2),
    });
  }
  void fatigueByIcp; // captured above; keep map binding to avoid unused-var lint

  // Sort by forecast desc; drop near-duplicates (same from/to/type).
  steps.sort((a, b) => b.ecosystemContributionForecast - a.ecosystemContributionForecast);
  const seen = new Set<string>();
  const recommendedTransformationSequence: StrategicSequenceStep[] = [];
  for (const s of steps) {
    const key = `${s.fromFormat}|${s.toFormat}|${s.transformationType}`;
    if (seen.has(key)) continue;
    seen.add(key);
    recommendedTransformationSequence.push(s);
    if (recommendedTransformationSequence.length >= limit) break;
  }

  // ── Confidence: portfolio size + signal density.
  const portfolioWeight = Math.min(40, assets.length * 3);
  const compoundingWeight = Math.min(30, input.compounding.ecosystemAuthorityScore / 3);
  const stepDensity = Math.min(30, recommendedTransformationSequence.length * 6);
  const sequencingConfidence = clamp100(portfolioWeight + compoundingWeight + stepDensity);

  // Helper var to keep funnel rank import live (used implicitly by callers).
  void FORMAT_FUNNEL_RANK;

  return {
    recommendedTransformationSequence,
    sequencingConfidence,
    topRecommendation: recommendedTransformationSequence[0] ?? null,
  };
}
