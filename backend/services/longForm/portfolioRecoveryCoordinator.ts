/**
 * Phase 9 — Portfolio recovery coordinator.
 *
 * Aggregates portfolio-level signals into a cheapest-first recovery plan.
 *
 * 7 actions, mapped from:
 *   - cannibalization clusters         → deprioritize_redundant_recommendation
 *   - funnel imbalance                 → rebalance_funnel_stages
 *   - oversaturated narrative archetypes → diversify_narratives
 *   - authority gaps                   → expand_weak_authority_zones
 *   - oversaturated theme nodes        → reduce_saturation
 *   - strategic_inconsistency issues   → resolve_positioning_conflicts
 *   - ecosystem_drift / fragmentation  → restore_ecosystem_coherence
 */

import type {
  AuthorityMap,
  CannibalizationAnalysisResult,
  FunnelCoverageResult,
  PortfolioContinuityResult,
  PortfolioRecoveryAction,
  PortfolioRecoveryPlan,
  PortfolioRecoveryStep,
} from './longFormRecommendationTypes';

const ACTION_ORDER: PortfolioRecoveryAction[] = [
  'deprioritize_redundant_recommendation',
  'rebalance_funnel_stages',
  'diversify_narratives',
  'expand_weak_authority_zones',
  'reduce_saturation',
  'resolve_positioning_conflicts',
  'restore_ecosystem_coherence',
];

interface ActionMeta {
  cost: 'low' | 'medium' | 'high';
  reason: string;
}

const ACTION_META: Record<PortfolioRecoveryAction, ActionMeta> = {
  deprioritize_redundant_recommendation: { cost: 'low', reason: 'Drop or down-rank recommendation candidates that overlap an existing duplication cluster.' },
  rebalance_funnel_stages: { cost: 'low', reason: 'Steer next recommendations toward the under-represented funnel bucket.' },
  diversify_narratives: { cost: 'low', reason: 'Promote weakly-covered narrative archetypes; demote oversaturated ones.' },
  expand_weak_authority_zones: { cost: 'medium', reason: 'Generate content that targets high-severity authority gap nodes.' },
  reduce_saturation: { cost: 'medium', reason: 'Pause recommendations for oversaturated themes; archive the weakest articles in the cluster.' },
  resolve_positioning_conflicts: { cost: 'medium', reason: 'Reconcile articles with opposing strategic positioning on overlapping ICPs.' },
  restore_ecosystem_coherence: { cost: 'high', reason: 'Rewrite or unify articles whose narrative arc has drifted away from the portfolio.' },
};

export interface BuildPortfolioRecoveryPlanInput {
  cannibalization: CannibalizationAnalysisResult;
  funnelCoverage: FunnelCoverageResult;
  authorityMap: AuthorityMap;
  continuity: PortfolioContinuityResult;
}

export function buildPortfolioRecoveryPlan(input: BuildPortfolioRecoveryPlanInput): PortfolioRecoveryPlan {
  const candidates = new Map<PortfolioRecoveryAction, { targets: Set<string>; articles: Set<string> }>();
  function add(action: PortfolioRecoveryAction, target: string, articles: string[] = []) {
    let entry = candidates.get(action);
    if (!entry) { entry = { targets: new Set(), articles: new Set() }; candidates.set(action, entry); }
    entry.targets.add(target);
    for (const a of articles) entry.articles.add(a);
  }

  // 1. cannibalization → deprioritize.
  for (const cluster of input.cannibalization.clusters) {
    add('deprioritize_redundant_recommendation', `cluster:${cluster.duplicationClusterId}`, cluster.articleIds);
    if (cluster.cannibalizationRiskScore >= 75) {
      add('reduce_saturation', `cluster:${cluster.duplicationClusterId}`, cluster.articleIds);
    }
  }

  // 2. funnel imbalance.
  if (input.funnelCoverage.imbalanceDetected) {
    const weakBuckets = (['tofu', 'mofu', 'bofu'] as const).filter((b) => {
      const share = b === 'tofu' ? input.funnelCoverage.tofuShare
        : b === 'mofu' ? input.funnelCoverage.mofuShare
        : input.funnelCoverage.bofuShare;
      return share < 0.20;
    });
    for (const b of weakBuckets) {
      add('rebalance_funnel_stages', `weak_bucket:${b}`);
    }
    if (input.funnelCoverage.missingEducationalProgression.length > 0) {
      add('rebalance_funnel_stages', 'missing_educational_progression');
    }
  }

  // 3. oversaturated narratives.
  if (input.authorityMap.oversaturatedAreas.length > 0) {
    for (const o of input.authorityMap.oversaturatedAreas) {
      add('reduce_saturation', `node:${o.nodeId}`);
    }
  }
  if (input.authorityMap.weakNarrativeZones.length > 0) {
    for (const w of input.authorityMap.weakNarrativeZones) {
      add('diversify_narratives', `weak_archetype:${w.archetype}`);
    }
  }

  // 4. authority gaps.
  for (const gap of input.authorityMap.authorityGapAreas) {
    if (gap.gapSeverity === 'high' || gap.gapSeverity === 'medium') {
      add('expand_weak_authority_zones', `gap:${gap.nodeType}:${gap.label}`);
    }
  }

  // 5. continuity issues.
  for (const issue of input.continuity.detectedIssues) {
    if (issue.type === 'STRATEGIC_INCONSISTENCY') {
      add('resolve_positioning_conflicts', `inconsistency:${issue.detail.slice(0, 50)}`, issue.affectedArticleIds);
    } else if (issue.type === 'ECOSYSTEM_DRIFT' || issue.type === 'PORTFOLIO_FRAGMENTATION' || issue.type === 'AUTHORITY_DILUTION') {
      add('restore_ecosystem_coherence', issue.type, issue.affectedArticleIds);
    }
  }

  // Emit in cheap-first order.
  const steps: PortfolioRecoveryStep[] = [];
  let order = 1;
  for (const action of ACTION_ORDER) {
    const entry = candidates.get(action);
    if (!entry) continue;
    steps.push({
      order: order++,
      action,
      targets: Array.from(entry.targets),
      reason: ACTION_META[action].reason,
      affectedArticleIds: Array.from(entry.articles),
    });
  }

  const totalCost: PortfolioRecoveryPlan['estimatedCost'] = steps.some((s) => ACTION_META[s.action].cost === 'high')
    ? 'high'
    : steps.some((s) => ACTION_META[s.action].cost === 'medium')
      ? 'medium'
      : 'low';

  return { steps, estimatedCost: totalCost };
}
