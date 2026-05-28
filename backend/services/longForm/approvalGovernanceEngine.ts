/**
 * Phase 6 — Approval governance engine.
 *
 * State machine across three reviewer roles (reviewer, strategist, compliance).
 * Approval state aggregates per-reviewer states with integrity-driven blockers.
 *
 * Inputs:
 *   - article-level integrity snapshots (factual, source, continuity)
 *   - aggregated edit risk + drift indicators
 *   - per-reviewer existing approval state (caller-supplied)
 *
 * Outputs:
 *   - approvalReadinessScore (0–100)
 *   - approvalState ∈ {not_requested, pending, approved, conditionally_approved, blocked}
 *   - approvalBlockers[] (with severity)
 *   - recommendedReviewers[] (based on edit risk types)
 *   - perReviewerState
 *
 * No automatic transitions are performed — this engine recommends. Caller
 * persists the actual approval decisions.
 */

import type {
  ApprovalBlocker,
  ApprovalBlockerType,
  ApprovalReadinessResult,
  ApprovalState,
  EditRiskType,
  EditorialDiffAnalysis,
  HumanAIDriftResult,
  PostGenerationFactualResult,
  PostGenerationIntegrityResult,
  PostGenerationSourceIntegrityResult,
  ReviewerRole,
} from './longFormRecommendationTypes';

const RISK_TO_REVIEWERS: Record<EditRiskType, ReviewerRole[]> = {
  strategic_narrative_drift: ['strategist'],
  factual_degradation: ['compliance', 'reviewer'],
  terminology_removal: ['strategist'],
  citation_removal: ['compliance'],
  operational_simplification: ['reviewer'],
  icp_erosion: ['strategist'],
  capability_suppression: ['strategist'],
  tone_mutation: ['reviewer'],
  unsupported_addition: ['compliance'],
};

function clamp100(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

export interface EvaluateApprovalReadinessInput {
  contentIntegrity?: PostGenerationIntegrityResult;
  factualIntegrity?: PostGenerationFactualResult;
  sourceIntegrity?: PostGenerationSourceIntegrityResult;
  diffAnalyses: EditorialDiffAnalysis[];
  drift?: HumanAIDriftResult;
  /** Existing per-reviewer state (defaults to 'not_requested' for all). */
  perReviewerState?: Partial<Record<ReviewerRole, 'not_requested' | 'pending' | 'approved' | 'blocked'>>;
  /** Whether a reviewer role has an open conflict (collaborative conflict analyzer output). */
  conflictPresent?: boolean;
  /** Reviewer roles that contributed revisions to the branch. Forces them into recommendedReviewers. */
  editorRolesInvolved?: ReviewerRole[];
}

export function evaluateApprovalReadiness(input: EvaluateApprovalReadinessInput): ApprovalReadinessResult {
  const blockers: ApprovalBlocker[] = [];

  function push(blockerType: ApprovalBlockerType, detail: string, severity: ApprovalBlocker['severity']): void {
    blockers.push({ blockerType, detail, severity });
  }

  // 1. Integrity floors.
  if (input.contentIntegrity && input.contentIntegrity.integrityBand === 'failed') {
    push('INTEGRITY_BELOW_FLOOR',
      `Content integrity band is "failed" (score=${input.contentIntegrity.postGenerationIntegrityScore}).`,
      'critical');
  } else if (input.contentIntegrity && input.contentIntegrity.integrityBand === 'weak') {
    push('INTEGRITY_BELOW_FLOOR',
      `Content integrity band is "weak" (score=${input.contentIntegrity.postGenerationIntegrityScore}).`,
      'major');
  }

  if (input.factualIntegrity && input.factualIntegrity.hallucinationRiskBand === 'critical') {
    push('UNRESOLVED_DRIFT',
      `Factual hallucination risk is critical (score=${input.factualIntegrity.factualIntegrityScore}).`,
      'critical');
  } else if (input.factualIntegrity && input.factualIntegrity.hallucinationRiskBand === 'high') {
    push('UNRESOLVED_DRIFT',
      `Factual hallucination risk is high (score=${input.factualIntegrity.factualIntegrityScore}).`,
      'major');
  }

  if (input.sourceIntegrity) {
    if (input.sourceIntegrity.integrityBand === 'failed') {
      push('WEAK_GROUNDING',
        `Source integrity band is "failed" (score=${input.sourceIntegrity.sourceIntegrityScore}).`,
        'critical');
    } else if (input.sourceIntegrity.integrityBand === 'weak') {
      push('WEAK_GROUNDING',
        `Source integrity band is "weak" (score=${input.sourceIntegrity.sourceIntegrityScore}).`,
        'major');
    }
    if (input.sourceIntegrity.orphanClaims.length >= 5) {
      push('ORPHAN_CLAIMS',
        `${input.sourceIntegrity.orphanClaims.length} orphan claim(s) unresolved.`,
        'major');
    } else if (input.sourceIntegrity.orphanClaims.length >= 1) {
      push('ORPHAN_CLAIMS',
        `${input.sourceIntegrity.orphanClaims.length} orphan claim(s) unresolved.`,
        'minor');
    }
  }

  if (input.conflictPresent) {
    push('UNRESOLVED_CONFLICT', 'Collaborative conflict analyzer flagged ≥1 unresolved conflict.', 'major');
  }

  if (input.drift) {
    const driftCount = input.drift.humanDriftIndicators.length + input.drift.aiDriftIndicators.length;
    const highSev = [...input.drift.humanDriftIndicators, ...input.drift.aiDriftIndicators]
      .filter((d) => d.severity === 'high').length;
    if (highSev >= 1) {
      push('UNRESOLVED_DRIFT', `${highSev} high-severity drift indicator(s) across human + AI revisions.`, 'major');
    } else if (driftCount >= 4) {
      push('UNRESOLVED_DRIFT', `${driftCount} drift indicators detected.`, 'minor');
    }
  }

  // 2. Determine recommended reviewers based on the risk types observed.
  const recommendedReviewersSet = new Set<ReviewerRole>();
  for (const diff of input.diffAnalyses) {
    for (const risk of diff.detectedRisks) {
      const reviewers = RISK_TO_REVIEWERS[risk.type] ?? [];
      for (const r of reviewers) recommendedReviewersSet.add(r);
    }
  }
  if (input.factualIntegrity && (input.factualIntegrity.hallucinationRiskBand === 'high' || input.factualIntegrity.hallucinationRiskBand === 'critical')) {
    recommendedReviewersSet.add('compliance');
  }
  if (input.sourceIntegrity && (input.sourceIntegrity.integrityBand === 'failed' || input.sourceIntegrity.integrityBand === 'weak')) {
    recommendedReviewersSet.add('compliance');
  }
  // Always require at least the editorial reviewer.
  recommendedReviewersSet.add('reviewer');
  // Any role that contributed an edit is required to formally review (their
  // own changes need approval).
  for (const role of input.editorRolesInvolved ?? []) recommendedReviewersSet.add(role);
  const recommendedReviewers = Array.from(recommendedReviewersSet);

  // 3. Per-reviewer state.
  const perReviewerState: Record<ReviewerRole, 'not_requested' | 'pending' | 'approved' | 'blocked'> = {
    reviewer: input.perReviewerState?.reviewer ?? 'not_requested',
    strategist: input.perReviewerState?.strategist ?? 'not_requested',
    compliance: input.perReviewerState?.compliance ?? 'not_requested',
  };

  // Auto-block reviewers for whom critical blockers exist.
  if (blockers.some((b) => b.blockerType === 'WEAK_GROUNDING' && b.severity === 'critical')) {
    perReviewerState.compliance = 'blocked';
  }
  if (blockers.some((b) => b.blockerType === 'INTEGRITY_BELOW_FLOOR' && b.severity === 'critical')) {
    perReviewerState.reviewer = 'blocked';
  }

  // 4. Mark MISSING_REQUIRED_REVIEW.
  for (const role of recommendedReviewers) {
    if (perReviewerState[role] === 'not_requested' || perReviewerState[role] === 'pending') {
      push('MISSING_REQUIRED_REVIEW', `${role} role required but state is ${perReviewerState[role]}.`, 'minor');
    }
  }

  // 5. Approval readiness score.
  const criticalCount = blockers.filter((b) => b.severity === 'critical').length;
  const majorCount = blockers.filter((b) => b.severity === 'major').length;
  const minorCount = blockers.filter((b) => b.severity === 'minor').length;
  let baseScore = 100;
  baseScore -= criticalCount * 40;
  baseScore -= majorCount * 18;
  baseScore -= minorCount * 6;
  // Penalize for missing reviewer approvals.
  const approvedCount = recommendedReviewers.filter((r) => perReviewerState[r] === 'approved').length;
  const requiredCount = recommendedReviewers.length;
  baseScore -= (requiredCount - approvedCount) * 12;
  const approvalReadinessScore = clamp100(baseScore);

  // 6. Aggregate approval state.
  const blockedReviewerCount = Object.values(perReviewerState).filter((s) => s === 'blocked').length;
  const approvalState: ApprovalState = ((): ApprovalState => {
    if (criticalCount > 0) return 'blocked';
    // ≥ 2 reviewer roles blocked = deadlock — surface as 'blocked' state so
    // the caller knows the approval cannot proceed without intervention.
    if (blockedReviewerCount >= 2) return 'blocked';
    if (recommendedReviewers.every((r) => perReviewerState[r] === 'approved') && majorCount === 0) return 'approved';
    if (recommendedReviewers.every((r) => perReviewerState[r] === 'approved') && majorCount > 0) return 'conditionally_approved';
    if (Object.values(perReviewerState).some((s) => s === 'pending' || s === 'blocked')) return 'pending';
    return 'not_requested';
  })();

  return {
    approvalReadinessScore,
    approvalState,
    approvalBlockers: blockers,
    recommendedReviewers,
    perReviewerState,
  };
}
