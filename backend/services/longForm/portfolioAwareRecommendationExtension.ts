/**
 * Phase 8 — Recommendation ↔ portfolio intelligence extension.
 *
 * Given a `LongFormRecommendation` and a portfolio context (assets + maps),
 * compute:
 *   - cannibalizationRiskScore (does this recommendation overlap existing content?)
 *   - ecosystemContributionScore (does it strengthen the ecosystem?)
 *   - fillsAuthorityGap (does it touch an authority gap area?)
 *   - ecosystemAdjustedStrength (overall × portfolio fit multiplier)
 *
 * Caller can use this to re-rank candidate recommendations BEFORE generation
 * so that ecosystem-strengthening picks float to the top.
 */

import type {
  AuthorityMap,
  ContentPortfolioAsset,
  FunnelCoverageResult,
  LongFormRecommendation,
  PortfolioAwareRecommendationContext,
} from './longFormRecommendationTypes';
import { FUNNEL_STAGE_TO_BUCKET } from './contentPortfolioRegistry';

const STOPWORDS = new Set([
  'a','an','the','and','or','but','of','to','in','on','for','with','by','at','is','are',
  'be','as','from','that','this','these','those','it','its','can','should','would','will',
]);

function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const t of text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)) {
    if (t.length > 2 && !STOPWORDS.has(t)) out.add(t);
  }
  return out;
}

function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  a.forEach((t) => { if (b.has(t)) inter += 1; });
  return inter / (a.size + b.size - inter);
}

function clamp100(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

export interface ScorePortfolioContextInput {
  recommendation: LongFormRecommendation;
  assets: ContentPortfolioAsset[];
  authorityMap: AuthorityMap;
  funnelCoverage: FunnelCoverageResult;
}

export function scorePortfolioContext(input: ScorePortfolioContextInput): PortfolioAwareRecommendationContext {
  const rec = input.recommendation;
  const recTokens = tokens(
    [rec.recommendationTitle, rec.editorialAngle, rec.strategicNarrative,
     rec.whyThisFitsCompany.capabilityConnection, rec.whyThisFitsCompany.icpProblemMapping].join(' '),
  );

  // 1. cannibalizationRiskScore — max pairwise overlap with existing assets.
  let maxOverlap = 0;
  let matchedClusterId: string | undefined;
  for (const asset of input.assets) {
    const assetTokens = tokens(
      [asset.title, asset.editorialAngle, asset.strategicNarrative,
       ...asset.authorityThemes, ...asset.capabilityEmphasis].join(' '),
    );
    const overlap = jaccard(recTokens, assetTokens);
    // Bonus penalty when archetypes match AND funnel bucket matches.
    let pairScore = overlap * 100;
    if (asset.narrativeArchetype && asset.narrativeArchetype === rec.narrativeArchetype) pairScore += 12;
    if (FUNNEL_STAGE_TO_BUCKET[asset.funnelStage] === FUNNEL_STAGE_TO_BUCKET[rec.targetBuyerStage]) pairScore += 8;
    if (pairScore > maxOverlap) {
      maxOverlap = pairScore;
      matchedClusterId = asset.articleId;
    }
  }
  const cannibalizationRiskScore = clamp100(maxOverlap);

  // 2. fillsAuthorityGap — does the recommendation reference a labeled gap area?
  const gapLabels = new Set(input.authorityMap.authorityGapAreas
    .filter((g) => g.gapSeverity === 'high' || g.gapSeverity === 'medium')
    .map((g) => g.label.toLowerCase()));
  const recLower = [rec.recommendationTitle, rec.editorialAngle, rec.whyThisFitsCompany.icpProblemMapping, rec.whyThisFitsCompany.capabilityConnection]
    .join(' ').toLowerCase();
  const fillsAuthorityGap = Array.from(gapLabels).some((label) => recLower.includes(label));

  // 3. ecosystemContributionScore — composite:
  //    + fills authority gap                (+25)
  //    + targets weak funnel bucket          (+up to 20)
  //    + low cannibalization                 (+inversely proportional)
  //    + targets a weak narrative archetype  (+15)
  let contribution = 30;
  if (fillsAuthorityGap) contribution += 25;
  const recBucket = FUNNEL_STAGE_TO_BUCKET[rec.targetBuyerStage];
  const shareByBucket: Record<'tofu' | 'mofu' | 'bofu', number> = {
    tofu: input.funnelCoverage.tofuShare,
    mofu: input.funnelCoverage.mofuShare,
    bofu: input.funnelCoverage.bofuShare,
  };
  const recShare = shareByBucket[recBucket];
  if (recShare < 0.20) contribution += 20;
  else if (recShare < 0.30) contribution += 10;
  contribution += Math.max(0, Math.round((100 - cannibalizationRiskScore) * 0.15));
  if (rec.narrativeArchetype && input.authorityMap.weakNarrativeZones.some((z) => z.archetype === rec.narrativeArchetype)) {
    contribution += 15;
  }
  const ecosystemContributionScore = clamp100(contribution);

  // 4. ecosystemAdjustedStrength — overall × contribution multiplier.
  const cannibalPenalty = Math.max(0, (cannibalizationRiskScore - 50) * 0.6); // > 50 starts to bite
  const ecosystemAdjustedStrength = clamp100(
    rec.overallRecommendationStrength * (0.75 + (ecosystemContributionScore / 100) * 0.5) - cannibalPenalty,
  );

  return {
    recommendation: rec,
    cannibalizationRiskScore,
    ecosystemContributionScore,
    fillsAuthorityGap,
    ecosystemAdjustedStrength,
    matchedClusterId,
  };
}

export function rerankRecommendationsByPortfolio(input: {
  recommendations: LongFormRecommendation[];
  assets: ContentPortfolioAsset[];
  authorityMap: AuthorityMap;
  funnelCoverage: FunnelCoverageResult;
}): PortfolioAwareRecommendationContext[] {
  const scored = input.recommendations.map((rec) => scorePortfolioContext({
    recommendation: rec,
    assets: input.assets,
    authorityMap: input.authorityMap,
    funnelCoverage: input.funnelCoverage,
  }));
  scored.sort((a, b) => b.ecosystemAdjustedStrength - a.ecosystemAdjustedStrength);
  return scored;
}
