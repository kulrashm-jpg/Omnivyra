/**
 * Phase 4 — Narrative transformation analyzer.
 *
 * Given a portfolio of cross-modal assets, surfaces:
 *   decompositions    — what long-form sections could become threads/posts
 *   expansions        — what short-form units deserve to be promoted into long-form
 *   insightExtractions — individual quotable insights extractable from dense assets
 *   averageNarrativeDensity — portfolio-wide narrative material per asset
 *
 * Heuristics (pure):
 *   - density = f(wordCount, authorityClaimCoverage, evidenceDensity, terminologyClusters.length)
 *   - decomposition candidates: dense assets in long_form / guide / whitepaper
 *     that don't already have N derivatives.
 *   - expansion candidates: short_form units (post / thread / story) with
 *     high authority claim coverage but low word count → can become long_form / guide.
 *   - insight extraction: very high evidence density + at least one terminology
 *     cluster → potential post-sized quote.
 */

import type {
  CrossModalAsset,
  CrossModalFormat,
  DecompositionCandidate,
  ExpansionCandidate,
  NarrativeTransformationMap,
} from './longFormRecommendationTypes';
import type { CrossModalContentRegistry } from './crossModalContentRegistry';

const PILLAR_FORMATS: CrossModalFormat[] = ['long_form', 'guide', 'whitepaper', 'case_study'];
const SHORT_FORMATS: CrossModalFormat[] = ['post', 'thread', 'story'];

function clamp100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function narrativeDensity(asset: CrossModalAsset): number {
  // High word count + high authority coverage + several terminology clusters → high density.
  const wordPart = Math.min(50, asset.approximateWordCount / 100);          // up to 50pt for >=5000 words
  const authPart = asset.authorityClaimCoverage * 0.25;                      // up to 25pt
  const evidPart = asset.evidenceDensity * 0.15;                             // up to 15pt
  const termPart = Math.min(10, asset.terminologyClusters.length * 2);       // up to 10pt
  return clamp100(wordPart + authPart + evidPart + termPart);
}

function authorityValue(asset: CrossModalAsset): number {
  // Authority value = the headline authority that a derived fragment can carry forward.
  return clamp100(asset.authorityClaimCoverage * 0.7 + asset.evidenceDensity * 0.3);
}

export interface AnalyzeNarrativeTransformationInput {
  registry: CrossModalContentRegistry;
  companyId: string;
  /** decomposition emits no candidate if source already has >= this many derived assets */
  maxDerivativesPerPillar?: number;
  /** expansion: source must have at least this authority claim coverage to be promotable */
  expansionAuthorityFloor?: number;
}

export function analyzeNarrativeTransformation(input: AnalyzeNarrativeTransformationInput): NarrativeTransformationMap {
  const assets = input.registry.listAssets(input.companyId);
  const maxDerivatives = Math.max(1, input.maxDerivativesPerPillar ?? 4);
  const expansionAuthorityFloor = Math.max(20, input.expansionAuthorityFloor ?? 60);

  const densities = assets.map(narrativeDensity);
  const averageNarrativeDensity = densities.length === 0
    ? 0
    : Math.round(densities.reduce((s, v) => s + v, 0) / densities.length);

  const decompositions: DecompositionCandidate[] = [];
  const expansions: ExpansionCandidate[] = [];
  const insightExtractions: NarrativeTransformationMap['insightExtractions'] = [];

  for (const a of assets) {
    const density = narrativeDensity(a);
    const authVal = authorityValue(a);
    const existingDerivatives = input.registry.descendantsOf(input.companyId, a.assetId).length;

    // ── Decomposition (pillar → short)
    if (PILLAR_FORMATS.includes(a.format) && density >= 60 && existingDerivatives < maxDerivatives) {
      // Each dense pillar yields multiple decomposition candidates.
      for (const target of ['thread', 'post', 'newsletter'] as CrossModalFormat[]) {
        decompositions.push({
          sourceAssetId: a.assetId,
          targetFormat: target,
          candidateTitle: `${target === 'newsletter' ? 'Newsletter recap of' : target === 'thread' ? 'Thread distilling' : 'Post pulled from'}: ${a.title}`,
          density,
          authorityValue: authVal,
          rationale: `Asset density ${density}/100, authority ${authVal}/100 — strong material for ${target}.`,
        });
      }
    }

    // ── Expansion (short → pillar)
    if (SHORT_FORMATS.includes(a.format) && a.authorityClaimCoverage >= expansionAuthorityFloor) {
      // gap label = first authority theme
      const gapLabel = a.authorityThemes[0] ?? 'undefined gap';
      const targetFormat: CrossModalFormat = a.format === 'thread' ? 'long_form' : 'guide';
      expansions.push({
        sourceAssetId: a.assetId,
        targetFormat,
        candidateTitle: `Expand "${a.title}" into a ${targetFormat}`,
        authorityGapFilled: gapLabel,
        expansionStrength: clamp100(a.authorityClaimCoverage * 0.6 + a.evidenceDensity * 0.4),
        rationale: `Short-form unit shows strong authority signal (${a.authorityClaimCoverage}/100) — promote to ${targetFormat} to fill "${gapLabel}".`,
      });
    }

    // ── Insight extraction (any dense asset with evidence + terminology)
    if (a.evidenceDensity >= 70 && a.terminologyClusters.length > 0) {
      insightExtractions.push({
        sourceAssetId: a.assetId,
        insight: `${a.terminologyClusters[0]} — evidence-dense angle from "${a.title}"`,
        targetFormat: 'post',
      });
    }
  }

  // Sort outputs by descending strength so callers can take top-N.
  decompositions.sort((a, b) => (b.density + b.authorityValue) - (a.density + a.authorityValue));
  expansions.sort((a, b) => b.expansionStrength - a.expansionStrength);

  return {
    decompositions,
    expansions,
    insightExtractions,
    averageNarrativeDensity,
  };
}

export { narrativeDensity, authorityValue };
