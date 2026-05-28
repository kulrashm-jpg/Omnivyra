/**
 * Phase 10 — Portfolio intelligence explanation composer.
 *
 * Canonical reasoning source → same hash for same state.
 */

import type {
  AuthorityMap,
  CannibalizationAnalysisResult,
  EditorialNoveltyResult,
  FunnelCoverageResult,
  PortfolioAwareRecommendationContext,
  PortfolioContinuityResult,
  PortfolioIntelligenceExplanation,
  PortfolioRecoveryPlan,
} from './longFormRecommendationTypes';

function stableHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h) ^ text.charCodeAt(i);
  return (h >>> 0).toString(16);
}

export interface ComposePortfolioExplanationInput {
  /** The candidate recommendation we're explaining (may be null when no candidate is supplied). */
  candidate: PortfolioAwareRecommendationContext | null;
  authorityMap: AuthorityMap;
  funnelCoverage: FunnelCoverageResult;
  cannibalization: CannibalizationAnalysisResult;
  continuity: PortfolioContinuityResult;
  memory: EditorialNoveltyResult;
  recoveryPlan: PortfolioRecoveryPlan;
}

export function composePortfolioIntelligenceExplanation(
  input: ComposePortfolioExplanationInput,
): PortfolioIntelligenceExplanation {
  const canonical = {
    candidate: input.candidate ? {
      recommendationId: input.candidate.recommendation.recommendationId,
      ecosystemContribution: input.candidate.ecosystemContributionScore,
      cannibalizationRisk: input.candidate.cannibalizationRiskScore,
      fillsGap: input.candidate.fillsAuthorityGap,
      adjustedStrength: input.candidate.ecosystemAdjustedStrength,
    } : null,
    gapCount: input.authorityMap.authorityGapAreas.length,
    highSeverityGaps: input.authorityMap.authorityGapAreas.filter((g) => g.gapSeverity === 'high').slice(0, 3).map((g) => `${g.nodeType}:${g.label}`),
    oversaturatedCount: input.authorityMap.oversaturatedAreas.length,
    weakNarrativeCount: input.authorityMap.weakNarrativeZones.length,
    funnelShares: { tofu: input.funnelCoverage.tofuShare, mofu: input.funnelCoverage.mofuShare, bofu: input.funnelCoverage.bofuShare },
    funnelImbalance: input.funnelCoverage.imbalanceDetected,
    progressionGapCount: input.funnelCoverage.icpProgressionGaps.length,
    duplicationClusterCount: input.cannibalization.clusters.length,
    continuityIssueCount: input.continuity.detectedIssues.length,
    ecosystemCoherence: input.continuity.ecosystemCoherenceScore,
    novelty: input.memory.editorialNoveltyScore,
    freshness: input.memory.strategicFreshnessScore,
    recoveryActions: input.recoveryPlan.steps.map((s) => s.action),
  };

  const howRecommendationStrengthensEcosystem = !canonical.candidate
    ? 'No candidate recommendation supplied — explanation is portfolio-only.'
    : canonical.candidate.fillsGap
      ? `Recommendation fills an authority gap and contributes ${canonical.candidate.ecosystemContribution}/100 to ecosystem balance; adjusted strength ${canonical.candidate.adjustedStrength}.`
      : `Recommendation contributes ${canonical.candidate.ecosystemContribution}/100 to ecosystem balance (no high-severity gap fill); adjusted strength ${canonical.candidate.adjustedStrength}.`;

  const whatAuthorityGapItFills = !canonical.candidate
    ? `${canonical.gapCount} authority gap(s) detected portfolio-wide${canonical.highSeverityGaps.length > 0 ? ` (high-severity: ${canonical.highSeverityGaps.join('; ')})` : ''}.`
    : canonical.candidate.fillsGap
      ? `Targets one of ${canonical.highSeverityGaps.length} high-severity gap(s): ${canonical.highSeverityGaps.join('; ')}.`
      : 'Does not directly fill a high-severity authority gap.';

  const whyCannibalizationRiskExists = canonical.candidate
    ? canonical.candidate.cannibalizationRisk >= 60
      ? `Cannibalization risk ${canonical.candidate.cannibalizationRisk}/100 — recommendation overlaps existing portfolio content${canonical.duplicationClusterCount > 0 ? ` (${canonical.duplicationClusterCount} duplication cluster(s) already detected)` : ''}.`
      : `Cannibalization risk ${canonical.candidate.cannibalizationRisk}/100 — within acceptable range.`
    : `Portfolio currently has ${canonical.duplicationClusterCount} duplication cluster(s).`;

  const howFunnelCoverageEvolves = canonical.funnelImbalance
    ? `Funnel imbalance detected — TOFU ${(canonical.funnelShares.tofu * 100).toFixed(0)}% / MOFU ${(canonical.funnelShares.mofu * 100).toFixed(0)}% / BOFU ${(canonical.funnelShares.bofu * 100).toFixed(0)}%. ${canonical.progressionGapCount} ICP progression gap(s).`
    : `Funnel balanced — TOFU ${(canonical.funnelShares.tofu * 100).toFixed(0)}% / MOFU ${(canonical.funnelShares.mofu * 100).toFixed(0)}% / BOFU ${(canonical.funnelShares.bofu * 100).toFixed(0)}%.`;

  const wherePortfolioWeaknessesRemain = (() => {
    const fragments: string[] = [];
    if (canonical.continuityIssueCount > 0) fragments.push(`${canonical.continuityIssueCount} continuity issue(s) (coherence ${canonical.ecosystemCoherence}/100)`);
    if (canonical.weakNarrativeCount > 0) fragments.push(`${canonical.weakNarrativeCount} weak narrative archetype(s)`);
    if (canonical.oversaturatedCount > 0) fragments.push(`${canonical.oversaturatedCount} oversaturated theme(s)`);
    if (canonical.novelty < 60) fragments.push(`editorial novelty low (${canonical.novelty}/100)`);
    if (canonical.freshness < 60) fragments.push(`strategic freshness low (${canonical.freshness}/100)`);
    if (canonical.recoveryActions.length > 0) fragments.push(`${canonical.recoveryActions.length} recovery action(s) recommended`);
    return fragments.length === 0 ? 'No major portfolio weaknesses outstanding.' : fragments.join('; ') + '.';
  })();

  return {
    howRecommendationStrengthensEcosystem,
    whatAuthorityGapItFills,
    whyCannibalizationRiskExists,
    howFunnelCoverageEvolves,
    wherePortfolioWeaknessesRemain,
    reasoningSourceHash: `pie_${stableHash(JSON.stringify(canonical))}`,
  };
}
