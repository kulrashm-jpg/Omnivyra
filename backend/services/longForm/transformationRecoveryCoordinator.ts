/**
 * Phase 8 — Transformation recovery coordinator.
 *
 * Reads outputs from upstream cross-modal engines:
 *   - continuity result            (per-transformation)
 *   - cannibalization result       (portfolio-wide)
 *   - editorial memory result      (portfolio-wide)
 *   - authority compounding result (portfolio-wide)
 * and emits an ordered set of recovery steps to undo the damage / harden the
 * ecosystem.
 *
 * Cheapest fixes first.
 *
 * Pure / deterministic.
 */

import type {
  AuthorityCompoundingResult,
  CrossModalCannibalizationResult,
  CrossModalContinuityResult,
  CrossModalEditorialMemoryResult,
  CrossModalFormat,
  CrossModalRecoveryAction,
  CrossModalRecoveryStep,
  EcosystemNarrativeResult,
  MultiHopContinuityResult,
  TransformationFatigueResult,
  TransformationRecoveryPlan,
} from './longFormRecommendationTypes';

const ACTION_COST: Record<CrossModalRecoveryAction, number> = {
  diversify_transformation_path:    1,
  prevent_repetitive_decomposition: 2,
  rebalance_educational_sequencing: 3,
  restore_authority_continuity:     4,
  restore_narrative_depth:          5,
  expand_weak_transformation_chains: 6,
  // ── Phase 12 — hardening actions ──────────────────────────────────────
  fatigue_mitigation:                   2,
  ecosystem_rebalance:                  4,
  chain_level_recovery:                 7,
  restore_narrative_across_descendants: 8,
  lineage_rollback:                     9,
};

const SEVERITY_RANK = { low: 0, medium: 1, high: 2 } as const;

function rankedSeverity(a: 'low' | 'medium' | 'high', b: 'low' | 'medium' | 'high'): 'low' | 'medium' | 'high' {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

export interface BuildTransformationRecoveryPlanInput {
  continuity?: CrossModalContinuityResult;
  cannibalization: CrossModalCannibalizationResult;
  editorialMemory: CrossModalEditorialMemoryResult;
  compounding: AuthorityCompoundingResult;
  // ── Phase 12 — hardening inputs (optional; trigger new actions when present) ──
  multiHop?: MultiHopContinuityResult;
  fatigue?: TransformationFatigueResult;
  ecosystemNarrative?: EcosystemNarrativeResult;
  /**
   * Asset IDs that derive (directly or transitively) from a recently-flagged
   * source — used to scope `restore_narrative_across_descendants`.
   */
  descendantAssetIds?: string[];
}

export function buildTransformationRecoveryPlan(input: BuildTransformationRecoveryPlanInput): TransformationRecoveryPlan {
  const steps: CrossModalRecoveryStep[] = [];

  // ── 1. diversify_transformation_path (cheapest) ─────────────────────
  if (input.editorialMemory.repeatedTransformationPaths.length > 0) {
    const top = input.editorialMemory.repeatedTransformationPaths[0];
    const sev: 'low' | 'medium' | 'high' = top.occurrences >= 6 ? 'high' : top.occurrences >= 4 ? 'medium' : 'low';
    steps.push({
      action: 'diversify_transformation_path',
      severity: sev,
      rationale: `Transformation path "${top.pathSignature}" used ${top.occurrences} times — shift to alternate target formats to keep ecosystem fresh.`,
      targetFormats: [],
    });
  }

  // ── 2. prevent_repetitive_decomposition ─────────────────────────────
  if (input.cannibalization.ecosystemRedundancyPercent >= 35) {
    const formats = Array.from(new Set(input.cannibalization.clusters.flatMap((c) => c.formats))) as CrossModalFormat[];
    const sev: 'low' | 'medium' | 'high' = input.cannibalization.ecosystemRedundancyPercent >= 60 ? 'high'
      : input.cannibalization.ecosystemRedundancyPercent >= 45 ? 'medium' : 'low';
    steps.push({
      action: 'prevent_repetitive_decomposition',
      severity: sev,
      rationale: `Ecosystem redundancy at ${input.cannibalization.ecosystemRedundancyPercent}% — pause new decomposition into already-saturated themes.`,
      targetFormats: formats,
    });
  }

  // ── 3. rebalance_educational_sequencing ─────────────────────────────
  if (input.editorialMemory.repetitiveEducationalJourneys.length > 0) {
    const top = input.editorialMemory.repetitiveEducationalJourneys[0];
    const sev: 'low' | 'medium' | 'high' = top.occurrences >= 4 ? 'high' : top.occurrences >= 2 ? 'medium' : 'low';
    steps.push({
      action: 'rebalance_educational_sequencing',
      severity: sev,
      rationale: `ICP "${top.icp}" sees journey "${top.journeySignature}" ${top.occurrences} times — break the pattern with a different ordering.`,
      targetFormats: [],
    });
  }

  // ── 4. restore_authority_continuity (per-transformation) ────────────
  if (input.continuity) {
    const authIssue = input.continuity.detectedIssues.find((i) => i.type === 'AUTHORITY_LOSS')
      ?? input.continuity.detectedIssues.find((i) => i.type === 'FACTUAL_GROUNDING_LOSS');
    if (authIssue) {
      steps.push({
        action: 'restore_authority_continuity',
        severity: authIssue.severity,
        rationale: `Continuity governor flagged ${authIssue.type}: ${authIssue.detail}`,
        targetFormats: [],
      });
    }
  }

  // ── 5. restore_narrative_depth ──────────────────────────────────────
  if (input.continuity) {
    const depthIssue = input.continuity.detectedIssues.find((i) => i.type === 'OVERSIMPLIFICATION'
      || i.type === 'CONTEXT_COLLAPSE'
      || i.type === 'STRATEGIC_NARRATIVE_DRIFT');
    if (depthIssue) {
      steps.push({
        action: 'restore_narrative_depth',
        severity: depthIssue.severity,
        rationale: `Continuity governor flagged ${depthIssue.type}: ${depthIssue.detail}`,
        targetFormats: [],
      });
    }
  }

  // ── 6. expand_weak_transformation_chains ────────────────────────────
  // Trigger when there are archetypes with single-format coverage AND
  // overall compounding is weak.
  const weakChains = input.compounding.archetypeCompounding.filter((a) => a.coverageFormats.length === 1 && a.compoundingStrength < 60);
  if (weakChains.length > 0 && input.compounding.narrativeCompoundingScore < 65) {
    const sev: 'low' | 'medium' | 'high' = weakChains.length >= 3 ? 'high' : weakChains.length >= 2 ? 'medium' : 'low';
    steps.push({
      action: 'expand_weak_transformation_chains',
      severity: sev,
      rationale: `${weakChains.length} archetype(s) live in only one format and compounding score is ${input.compounding.narrativeCompoundingScore}/100 — extend coverage to additional formats.`,
      targetFormats: [],
    });
  }

  // ── 7. (Phase 12) fatigue_mitigation ────────────────────────────────
  if (input.fatigue && input.fatigue.transformationFatigueScore >= 35) {
    const sev: 'low' | 'medium' | 'high' = input.fatigue.transformationFatigueScore >= 65 ? 'high'
      : input.fatigue.transformationFatigueScore >= 45 ? 'medium' : 'low';
    const topPattern = input.fatigue.exhaustedTransformationPatterns[0];
    steps.push({
      action: 'fatigue_mitigation',
      severity: sev,
      rationale: `Fatigue score ${input.fatigue.transformationFatigueScore}/100${topPattern ? ` (top pattern: ${topPattern.patternType} "${topPattern.signature}" ×${topPattern.occurrences})` : ''} — back off the saturated transformation paths.`,
      targetFormats: [],
    });
  }

  // ── 8. (Phase 12) ecosystem_rebalance ───────────────────────────────
  if (input.ecosystemNarrative && input.ecosystemNarrative.detectedIssues.length > 0) {
    const ecoHigh = input.ecosystemNarrative.detectedIssues.filter((i) => i.severity === 'high').length;
    const sev: 'low' | 'medium' | 'high' = ecoHigh >= 2 ? 'high' : ecoHigh >= 1 ? 'medium' : 'low';
    steps.push({
      action: 'ecosystem_rebalance',
      severity: sev,
      rationale: `Ecosystem narrative coherence at ${input.ecosystemNarrative.ecosystemCoherenceScore}/100 with ${input.ecosystemNarrative.detectedIssues.length} issue(s) — rebalance positioning across formats before publishing more derivatives.`,
      targetFormats: Array.from(new Set(input.ecosystemNarrative.detectedIssues.flatMap((i) => i.formats))) as CrossModalFormat[],
    });
  }

  // ── 9. (Phase 12) chain_level_recovery ──────────────────────────────
  if (input.multiHop && (input.multiHop.chainDriftSeverity !== 'low' || input.multiHop.chainContinuityScore < 65)) {
    steps.push({
      action: 'chain_level_recovery',
      severity: input.multiHop.chainDriftSeverity,
      rationale: `Chain ${input.multiHop.chainId} (length ${input.multiHop.chainLength}) continuity ${input.multiHop.chainContinuityScore}/100 — degraded axes: ${input.multiHop.driftAxes.map((a) => a.axis).join(', ') || '(none)'}.`,
      targetFormats: [],
    });
  }

  // ── 10. (Phase 12) restore_narrative_across_descendants ─────────────
  // Fired when narrative drift is detected AND we know about descendant assets.
  if (input.multiHop
      && input.multiHop.driftAxes.some((a) => a.axis === 'narrative')
      && (input.descendantAssetIds?.length ?? 0) > 0) {
    steps.push({
      action: 'restore_narrative_across_descendants',
      severity: input.multiHop.chainDriftSeverity,
      rationale: `Narrative drift propagated to ${input.descendantAssetIds!.length} descendant(s) — restore narrative depth across all derivatives, not just the flagged hop.`,
      targetFormats: [],
    });
  }

  // ── 11. (Phase 12) lineage_rollback ─────────────────────────────────
  // Last-resort: chain drift is high AND the chain is long enough that
  // partial fixes won't recover authority. Coordinator only RECOMMENDS;
  // doesn't actually mutate anything.
  if (input.multiHop
      && input.multiHop.chainDriftSeverity === 'high'
      && input.multiHop.chainLength >= 3
      && input.multiHop.cumulativeAuthorityRetention < 35) {
    steps.push({
      action: 'lineage_rollback',
      severity: 'high',
      rationale: `Chain ${input.multiHop.chainId} authority retention only ${input.multiHop.cumulativeAuthorityRetention}/100 over ${input.multiHop.chainLength} hops — recommend rolling lineage back to nearest healthy ancestor before deriving more assets.`,
      targetFormats: [],
    });
  }

  // Sort cheapest-first, but elevate severity≥high to the top of their cost band.
  steps.sort((a, b) => {
    const costDiff = ACTION_COST[a.action] - ACTION_COST[b.action];
    if (costDiff !== 0) return costDiff;
    return SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
  });

  const overallRiskScore = Math.min(100,
    steps.reduce((sum, s) => sum + (s.severity === 'high' ? 28 : s.severity === 'medium' ? 14 : 6), 0),
  );

  // Composite severity helper kept around in case callers need to bubble it.
  void rankedSeverity;

  return { steps, overallRiskScore };
}

export { ACTION_COST };
