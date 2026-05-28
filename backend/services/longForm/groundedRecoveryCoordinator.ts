/**
 * Phase 9 — Grounded recovery coordinator.
 *
 * Maps detected source/grounding issues to a cheapest-first action plan.
 */

import type {
  CitationOrchestrationResult,
  ClaimTraceability,
  ExtractedClaim,
  GroundedRecoveryAction,
  GroundedRecoveryPlan,
  GroundedRecoveryStep,
  PostGenerationSourceIntegrityResult,
  RetrievalGroundingProfile,
  SourceConflictResult,
} from './longFormRecommendationTypes';
import { calibrateManySources } from './sourceTrustCalibrationEngine';

const ACTION_ORDER: GroundedRecoveryAction[] = [
  'strengthen_attribution',
  'insert_evidence_anchor',
  'downgrade_certainty',
  'remove_stale_reference',
  'replace_weak_source',
  'resolve_source_conflict',
  'remove_unsupported_claim',
];

interface ActionMeta {
  cost: 'low' | 'medium' | 'high';
  reason: string;
}

const ACTION_META: Record<GroundedRecoveryAction, ActionMeta> = {
  strengthen_attribution: { cost: 'low', reason: 'Add title/author/published-at to citations that lack full attribution.' },
  insert_evidence_anchor: { cost: 'low', reason: 'Insert an explicit factual anchor for an under-supported claim.' },
  downgrade_certainty: { cost: 'low', reason: 'Soften unsupported assertions ("typically", "in our experience", "may").' },
  remove_stale_reference: { cost: 'low', reason: 'Drop stale sources where a fresh alternative covers the same topic.' },
  replace_weak_source: { cost: 'medium', reason: 'Swap low/unreliable citations for higher-trust alternatives in the profile.' },
  resolve_source_conflict: { cost: 'medium', reason: 'Apply the conflict resolver action (prefer higher trust / newer / merge with caveat).' },
  remove_unsupported_claim: { cost: 'medium', reason: 'Strip orphan claims that no eligible source supports.' },
};

export interface BuildGroundedRecoveryInput {
  claims: ExtractedClaim[];
  traceability: ClaimTraceability[];
  citationResult: CitationOrchestrationResult;
  conflicts: SourceConflictResult;
  integrity: PostGenerationSourceIntegrityResult;
  profile: RetrievalGroundingProfile;
}

export function buildGroundedRecoveryPlan(input: BuildGroundedRecoveryInput): GroundedRecoveryPlan {
  const candidates = new Map<GroundedRecoveryAction, { targets: Set<string>; affectedClaimIds: Set<string> }>();
  function add(action: GroundedRecoveryAction, target: string, claimId?: string) {
    let entry = candidates.get(action);
    if (!entry) { entry = { targets: new Set(), affectedClaimIds: new Set() }; candidates.set(action, entry); }
    entry.targets.add(target);
    if (claimId) entry.affectedClaimIds.add(claimId);
  }

  const trustBySource = calibrateManySources(input.profile.approvedSources);

  // 1. From orphan claims — downgrade certainty (cheap) OR remove (if high-risk and no support possible).
  const claimById = new Map(input.claims.map((c) => [c.claimId, c]));
  for (const orphan of input.integrity.orphanClaims) {
    const claim = claimById.get(orphan.claimId);
    if (!claim) continue;
    if (claim.claimType === 'statistic' || claim.claimType === 'benchmark_comparison') {
      add('remove_unsupported_claim', orphan.reason, orphan.claimId);
    } else if (claim.evidenceRequirementLevel === 'critical' || claim.evidenceRequirementLevel === 'required') {
      add('insert_evidence_anchor', orphan.reason, orphan.claimId);
    } else {
      add('downgrade_certainty', orphan.reason, orphan.claimId);
    }
  }

  // 2. From weak-source overuse warnings — swap low-trust sources.
  for (const w of input.citationResult.weakSourceOveruseWarnings) {
    add('replace_weak_source', w);
  }

  // 3. From conflicts — translate resolution recommendation into actions.
  for (let i = 0; i < input.conflicts.conflicts.length; i += 1) {
    const conflict = input.conflicts.conflicts[i];
    const rec = input.conflicts.conflictResolutionRecommendations[i];
    if (!rec) continue;
    if (conflict.conflictType === 'STALE_REFERENCE') {
      add('remove_stale_reference', conflict.detail);
    } else if (rec.action === 'remove_lower_trust' || rec.action === 'prefer_higher_trust') {
      add('replace_weak_source', conflict.detail);
    } else {
      add('resolve_source_conflict', conflict.detail);
    }
  }

  // 4. From attribution shortfall — strengthen attribution.
  if (input.integrity.dimensionScores.attributionCompleteness < 65) {
    add('strengthen_attribution', `attributionCompleteness=${input.integrity.dimensionScores.attributionCompleteness}`);
  }

  // 5. From stale-source density — drop stale.
  if (input.integrity.dimensionScores.staleSourceDensity < 70) {
    for (const src of input.profile.approvedSources) {
      if (src.freshnessMetadata.isStale) {
        add('remove_stale_reference', `${src.sourceId} stale`);
      }
    }
  }

  // 6. From citationValidity floor — strengthen via higher-trust sources.
  if (input.integrity.dimensionScores.citationValidity < 55) {
    add('strengthen_attribution', `citationValidity=${input.integrity.dimensionScores.citationValidity}`);
  }

  // Build the plan in cheap-first order.
  const steps: GroundedRecoveryStep[] = [];
  let order = 1;
  for (const action of ACTION_ORDER) {
    const entry = candidates.get(action);
    if (!entry) continue;
    steps.push({
      order: order++,
      action,
      targets: Array.from(entry.targets),
      reason: ACTION_META[action].reason,
      affectedClaimIds: Array.from(entry.affectedClaimIds),
    });
  }

  const totalCost: GroundedRecoveryPlan['estimatedCost'] = steps.some((s) => ACTION_META[s.action].cost === 'high')
    ? 'high'
    : steps.some((s) => ACTION_META[s.action].cost === 'medium')
      ? 'medium'
      : 'low';

  void trustBySource;
  return { steps, estimatedCost: totalCost };
}
