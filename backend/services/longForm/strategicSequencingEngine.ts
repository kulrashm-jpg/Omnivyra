/**
 * Phase 4 — Strategic sequencing engine.
 *
 * Given a company's portfolio + the authority map, recommend the next 3–8
 * content moves that strengthen the ecosystem the most. Each recommendation
 * carries a target type, suggested focus, and priority.
 *
 * Sequencing targets:
 *   - authority_gap        — fill an under-covered authority node
 *   - funnel_balance       — bring imbalanced funnel stage into alignment
 *   - icp_expansion        — extend coverage into an underserved ICP
 *   - narrative_evolution  — evolve an over-archived narrative into the next stage
 *   - capability_depth     — go deeper on a capability that has shallow articles
 *
 * Pure; no LLM.
 */

import type {
  AuthorityMap,
  ContentPortfolioAsset,
  FunnelCoverageResult,
  NarrativeArchetype,
  SequencingRecommendation,
  SequencingTarget,
  NextContentSequencingResult,
  TargetBuyerStage,
} from './longFormRecommendationTypes';
import { FUNNEL_STAGE_TO_BUCKET } from './contentPortfolioRegistry';

function clamp100(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

export interface SequenceNextContentInput {
  assets: ContentPortfolioAsset[];
  authorityMap: AuthorityMap;
  funnelCoverage: FunnelCoverageResult;
  maxRecommendations?: number;
}

export function sequenceNextContent(input: SequenceNextContentInput): NextContentSequencingResult {
  const limit = Math.max(3, Math.min(input.maxRecommendations ?? 6, 8));
  const recs: SequencingRecommendation[] = [];
  let order = 1;

  function push(rec: Omit<SequencingRecommendation, 'recommendationOrder'>) {
    recs.push({ recommendationOrder: order++, ...rec });
  }

  // 1. authority_gap — for each gap area with high severity, recommend a fill.
  const highGaps = input.authorityMap.authorityGapAreas.filter((g) => g.gapSeverity === 'high');
  for (const gap of highGaps.slice(0, 3)) {
    push({
      target: 'authority_gap',
      rationale: `${gap.nodeType} "${gap.label}" has no / minimal coverage — high-severity authority gap.`,
      suggestedFocus: gap.nodeType === 'icp_pain' ? { icp: gap.label }
        : gap.nodeType === 'workflow_category' ? { workflowCategory: gap.label }
        : {},
      priority: 'high',
    });
  }

  // 2. funnel_balance — TOFU/MOFU/BOFU shares should be roughly 35% / 40% / 25% as a heuristic baseline.
  const expected: Record<'tofu' | 'mofu' | 'bofu', number> = { tofu: 0.35, mofu: 0.40, bofu: 0.25 };
  const actual: Record<'tofu' | 'mofu' | 'bofu', number> = {
    tofu: input.funnelCoverage.tofuShare,
    mofu: input.funnelCoverage.mofuShare,
    bofu: input.funnelCoverage.bofuShare,
  };
  const stageGap: Array<{ bucket: 'tofu' | 'mofu' | 'bofu'; gap: number }> = (['tofu','mofu','bofu'] as const)
    .map((b) => ({ bucket: b, gap: expected[b] - actual[b] }))
    .sort((a, b) => b.gap - a.gap);
  for (const sg of stageGap) {
    if (sg.gap >= 0.10 && recs.length < limit) {
      const targetStage: TargetBuyerStage =
        sg.bucket === 'tofu' ? 'awareness'
        : sg.bucket === 'mofu' ? 'consideration'
        : 'decision';
      push({
        target: 'funnel_balance',
        rationale: `${sg.bucket.toUpperCase()} share ${(actual[sg.bucket] * 100).toFixed(0)}% is ${Math.round(sg.gap * 100)}pp below the expected ${(expected[sg.bucket] * 100).toFixed(0)}%.`,
        suggestedFocus: { funnelStage: targetStage },
        priority: sg.gap >= 0.20 ? 'high' : 'medium',
      });
    }
  }

  // 3. icp_expansion — ICPs with progression gaps (missing TOFU/MOFU/BOFU).
  for (const gap of input.funnelCoverage.icpProgressionGaps.slice(0, 3)) {
    if (recs.length >= limit) break;
    const targetStage: TargetBuyerStage =
      gap.missingStages.includes('mofu') ? 'consideration'
      : gap.missingStages.includes('bofu') ? 'decision'
      : 'awareness';
    push({
      target: 'icp_expansion',
      rationale: `ICP "${gap.icp}" has missing stages: ${gap.missingStages.join(', ').toUpperCase()}.`,
      suggestedFocus: { icp: gap.icp, funnelStage: targetStage },
      priority: 'medium',
    });
  }

  // 4. narrative_evolution — promote weakly-covered archetypes; demote oversaturated ones.
  for (const weak of input.authorityMap.weakNarrativeZones.slice(0, 2)) {
    if (recs.length >= limit) break;
    if (weak.archetype === 'uncategorized') continue;
    push({
      target: 'narrative_evolution',
      rationale: `Narrative archetype "${weak.archetype}" has weak coverage (${weak.coverageWeight}/100). Evolving into this space diversifies the portfolio.`,
      suggestedFocus: { narrativeArchetype: weak.archetype as NarrativeArchetype },
      priority: 'medium',
    });
  }

  // 5. capability_depth — capability_cluster nodes with article count == 1.
  const shallowCaps = input.authorityMap.nodes
    .filter((n) => n.nodeType === 'capability_cluster' && n.contributingArticleIds.length === 1)
    .slice(0, 3);
  for (const cap of shallowCaps) {
    if (recs.length >= limit) break;
    push({
      target: 'capability_depth',
      rationale: `Capability "${cap.label}" appears in only one article — depth/expansion would strengthen authority.`,
      suggestedFocus: { workflowCategory: cap.label },
      priority: 'low',
    });
  }

  // ecosystemBalanceScore: how close the portfolio is to balanced.
  // 100 = perfect; subtract for each detected imbalance + each high gap.
  const totalAssetCount = input.assets.length;
  const highGapPenalty = Math.min(40, highGaps.length * 10);
  const funnelPenalty = stageGap.reduce((sum, sg) => sum + (sg.gap >= 0.20 ? 15 : sg.gap >= 0.10 ? 8 : 0), 0);
  const oversaturationPenalty = Math.min(20, input.authorityMap.oversaturatedAreas.length * 6);
  const baseScore = totalAssetCount === 0 ? 50 : 90;
  const ecosystemBalanceScore = clamp100(baseScore - highGapPenalty - funnelPenalty - oversaturationPenalty);

  return {
    nextRecommendations: recs.slice(0, limit),
    ecosystemBalanceScore,
  };
}

export type { SequencingTarget };
