/**
 * Phase 10 — Factual recovery coordinator.
 *
 * Maps factual detections + per-claim profiles to a cheapest-first recovery
 * plan. Each step targets a specific dimension or detection type. Caller
 * (orchestrator) consumes the plan via the SectionGenerationHint mechanism.
 */

import type {
  AuthorityInflationResult,
  ClaimEvidenceProfile,
  ExtractedClaim,
  FactualRecoveryAction,
  FactualRecoveryPlan,
  FactualRecoveryStep,
  HallucinationSuppressionResult,
  OperationalProofValidationResult,
  SpeculativeLanguageResult,
} from './longFormRecommendationTypes';

const ACTION_ORDER: FactualRecoveryAction[] = [
  'soften_certainty',
  'reduce_authority_inflation',
  'convert_to_inference_framing',
  'restore_operational_realism',
  'remove_fake_benchmark',
  'remove_fabricated_statistic',
  'rewrite_unsupported_claim',
];

interface ActionMeta {
  cost: 'low' | 'medium' | 'high';
  reason: string;
}

const ACTION_META: Record<FactualRecoveryAction, ActionMeta> = {
  soften_certainty: { cost: 'low', reason: 'Insert hedges into overconfident claims (typically, often, in our experience).' },
  reduce_authority_inflation: { cost: 'low', reason: 'Strip exaggerated certainty / pseudo-expert framing.' },
  convert_to_inference_framing: { cost: 'low', reason: 'Reframe declarative claims as inferences ("organizations often find").' },
  restore_operational_realism: { cost: 'medium', reason: 'Remove impossible workflows; reconcile contradictory execution claims.' },
  remove_fake_benchmark: { cost: 'low', reason: 'Strip competitor-benchmark numbers that lack a verifiable basis.' },
  remove_fabricated_statistic: { cost: 'low', reason: 'Strip percentages / dollar figures / multipliers without attribution.' },
  rewrite_unsupported_claim: { cost: 'medium', reason: 'Rewrite high-risk factual claims that cannot be cited or qualified.' },
};

export interface BuildFactualRecoveryInput {
  claims: ExtractedClaim[];
  profiles: ClaimEvidenceProfile[];
  hallucination: HallucinationSuppressionResult;
  speculative: SpeculativeLanguageResult;
  authority: AuthorityInflationResult;
  operational: OperationalProofValidationResult;
}

export function buildFactualRecoveryPlan(input: BuildFactualRecoveryInput): FactualRecoveryPlan {
  const candidates = new Map<FactualRecoveryAction, { targets: Set<string>; affectedClaimIds: Set<string> }>();

  function add(action: FactualRecoveryAction, target: string, claimId?: string) {
    let entry = candidates.get(action);
    if (!entry) { entry = { targets: new Set(), affectedClaimIds: new Set() }; candidates.set(action, entry); }
    entry.targets.add(target);
    if (claimId) entry.affectedClaimIds.add(claimId);
  }

  // From hallucination detections.
  for (const d of input.hallucination.hallucinationDetections) {
    switch (d.type) {
      case 'INVENTED_STATISTIC':
        add('remove_fabricated_statistic', d.type, d.claimId);
        break;
      case 'FAKE_BENCHMARK':
        add('remove_fake_benchmark', d.type, d.claimId);
        break;
      case 'FAKE_CUSTOMER_EXAMPLE':
      case 'FAKE_RESEARCH_REFERENCE':
      case 'FAKE_INDUSTRY_STANDARD':
        add('rewrite_unsupported_claim', d.type, d.claimId);
        break;
      case 'FABRICATED_OPERATIONAL_CERTAINTY':
        add('soften_certainty', d.type, d.claimId);
        add('restore_operational_realism', d.type, d.claimId);
        break;
      case 'UNSUPPORTED_AUTHORITY':
        add('convert_to_inference_framing', d.type, d.claimId);
        break;
      case 'UNVERIFIABLE_FACT_AS_TRUTH':
        add('soften_certainty', d.type, d.claimId);
        break;
    }
  }

  // From speculative-language enforcer.
  for (const oc of input.speculative.overconfidentClaims) {
    add('soften_certainty', oc.detectedIssue, oc.claimId);
  }

  // From authority inflation.
  for (const d of input.authority.detections) {
    if (d.severity === 'high' || d.severity === 'medium') {
      add('reduce_authority_inflation', d.type);
    }
  }

  // From operational realism.
  for (const issue of input.operational.issues) {
    if (issue.severity === 'high' || issue.severity === 'medium') {
      add('restore_operational_realism', issue.type, issue.claimId);
    }
  }

  // From profiles: any unverifiable_assertion_risk → rewrite_unsupported_claim.
  for (const profile of input.profiles) {
    if (profile.classification === 'unverifiable_assertion_risk') {
      add('rewrite_unsupported_claim', profile.classification, profile.claimId);
    } else if (profile.classification === 'high_risk_factual_claim'
               && !profile.reasonFlags.includes('has attribution marker')) {
      // High-risk + no attribution: either rewrite, cite, or convert to inference.
      add('convert_to_inference_framing', 'high_risk_no_attribution', profile.claimId);
    }
  }

  const steps: FactualRecoveryStep[] = [];
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

  const totalCost: FactualRecoveryPlan['estimatedCost'] = steps.some((s) => ACTION_META[s.action].cost === 'high')
    ? 'high'
    : steps.some((s) => ACTION_META[s.action].cost === 'medium')
      ? 'medium'
      : 'low';

  return { steps, estimatedCost: totalCost };
}
