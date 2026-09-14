/**
 * DT-C4 — U1 PROTOCOL REVISION `u1-003` (PRE-REGISTERED, FROZEN).
 *
 * Machine-readable twin of DEEPTECH_U1_PREREGISTRATION_003.md.
 *
 * WHAT u1-003 IS
 * --------------
 * u1-003 does NOT introduce a new dataset. It binds to the SAME dataset as
 * u1-002 (`canonicalGrounding.u1Dataset.v2`, identical hash), because DT-C4
 * produced no new ground truth — an independent human author was not available,
 * and the implementation agent is forbidden from authoring facts.
 *
 * What u1-003 adds is the FROZEN INDEPENDENCE CONTRACT: the exact certification
 * a qualifying independent party must supply, and the machine gate that enforces
 * it. Its certification slots are currently UNFILLED.
 *
 * ⚠️ u1-003 RECORDS A BLOCKER, NOT PROGRESS. Issuing it does not advance U1's
 * evidence rung. `independenceStatus()` derives NOT_VERIFIED from the absence of
 * a certification record — the status is COMPUTED, never asserted, so it cannot
 * drift away from reality.
 *
 * UNCHANGED: every U1 acceptance criterion. As in u1-002, the criteria are
 * IMPORTED from u1Protocol.ts — the same frozen objects, not copies — so
 * "nothing was weakened" is machine-verifiable. u1-001 and u1-002 are untouched.
 *
 * NO RESULTS ARE STORED HERE.
 */

import {
  METRICS, PRIMARY_METRIC, MIN_RELATIVE_REDUCTION, MIN_VALID_PAIR_RATIO,
  MIN_INTER_RATER_ALPHA, MIN_RATERS, ACCEPTANCE_RULES, EXCLUSION_RULES,
  HUMAN_RATING_PROTOCOL, ARM_GROUNDED, ARM_UNGROUNDED,
} from './u1Protocol';
import {
  DATASET_ID_V2, DATASET_SHA256_V2, DATASET_COMPANY_COUNT_V2,
  DATASET_WORKLOAD_COUNT_V2, DATASET_PAIR_COUNT_V2, STATISTICAL_TREATMENT_V2,
} from './u1Protocol002';
import {
  CURRENT_CERTIFICATION, evaluateIndependence, describeIndependence,
  type IndependenceAssessment,
} from './u1Certification';

export const PROTOCOL_ID_V3 = 'DEEPTECH-U1' as const;
export const PROTOCOL_VERSION_V3 = 'u1-003' as const;
export const PROTOCOL_SUPERSEDES_V3 = 'u1-002' as const;
export const PROTOCOL_REPO_SHA_V3 = '82754497e8f9b64a893319e863941ad2994fd9b7' as const;
export const PROTOCOL_REGISTERED_ON_V3 = '2026-09-10' as const;

/** Same dataset as u1-002 — DT-C4 created no new ground truth. */
export const DATASET_ID_V3 = DATASET_ID_V2;
export const DATASET_SHA256_V3 = DATASET_SHA256_V2;

/** Criteria re-exported by identity — unchanged from u1-001 and u1-002. */
export {
  METRICS, PRIMARY_METRIC, MIN_RELATIVE_REDUCTION, MIN_VALID_PAIR_RATIO,
  MIN_INTER_RATER_ALPHA, MIN_RATERS, ACCEPTANCE_RULES, EXCLUSION_RULES,
  HUMAN_RATING_PROTOCOL, ARM_GROUNDED, ARM_UNGROUNDED, STATISTICAL_TREATMENT_V2,
  DATASET_COMPANY_COUNT_V2, DATASET_WORKLOAD_COUNT_V2, DATASET_PAIR_COUNT_V2,
};

/**
 * THE FROZEN INDEPENDENCE CONTRACT — what a qualifying certification must assert.
 * Enforced by `sealWithCertification()`, which has no bypass.
 */
export const INDEPENDENCE_CONTRACT = Object.freeze({
  hardRequirements: [
    'The certification is bound to the exact dataset SHA-256 under evaluation.',
    'The author did not implement the system under test.',
    'The author did not implement the DT-C1/DT-C2 evaluation infrastructure.',
    'The author was not merely a nominal approver of AI-generated facts.',
    'The author independently authored, or independently verified, the facts.',
    'The author saw no grounded U1 outputs.',
    'The author saw no ungrounded U1 outputs.',
    'The author saw no scorer results.',
    'The author saw no success/failure results.',
    'No model output influenced the dataset.',
  ],
  completenessRequirements: [
    'Human semantic-distinctness certification is complete, explicitly acknowledging that machine string comparison proves non-duplication and NOT semantic uniqueness.',
    'The dataset was approved before first U1 execution, with per-company provenance reviewed.',
  ],
  verdictRule:
    'Any hard failure ⇒ NOT_VERIFIED. All hard satisfied but a completeness gap ⇒ PARTIALLY_VERIFIED. Only a full pass ⇒ VERIFIED.',
  sealingRule:
    'sealWithCertification() THROWS unless the verdict is VERIFIED. There is no force flag, no override and no bypass.',
  tamperRule:
    'A certification is bound to exact dataset bytes. Any edit to the dataset invalidates it automatically, making post-certification tampering detectable rather than merely prohibited.',
  prohibition:
    'A verdict of VERIFIED must NEVER be recorded merely because a human reviewed AI-generated material.',
});

/** Derived, never asserted — reflects the real certification state at call time. */
export function independenceStatus(): IndependenceAssessment {
  return evaluateIndependence(CURRENT_CERTIFICATION, {
    datasetId: DATASET_ID_V3,
    datasetSha256: DATASET_SHA256_V3,
  });
}

export function independenceStatusLine(): string {
  return describeIndependence(independenceStatus());
}

/**
 * The evidence ceiling implied by the current independence state. Kept as a
 * function so it can never fall out of step with the certification record.
 */
export function evidenceCeiling(): { rung: number; label: string; rationale: string } {
  const v = independenceStatus().verdict;
  if (v === 'VERIFIED') {
    return {
      rung: 6, label: 'Held-out validation attainable',
      rationale: 'Ground truth is independently authored/verified and sealed before execution.',
    };
  }
  return {
    rung: 2, label: 'Controlled experiment at most',
    rationale:
      'Ground truth was authored by the implementation agent. A SUCCESS outcome would be a result on a self-authored engineering fixture and cannot support an external-defensibility claim.',
  };
}

/** FNV-1a 32-bit over the canonical criteria + independence contract. */
export function protocolFingerprintV3(): string {
  const canonical = JSON.stringify({
    id: PROTOCOL_ID_V3,
    version: PROTOCOL_VERSION_V3,
    supersedes: PROTOCOL_SUPERSEDES_V3,
    datasetId: DATASET_ID_V3,
    datasetSha256: DATASET_SHA256_V3,
    companies: DATASET_COMPANY_COUNT_V2,
    workloads: DATASET_WORKLOAD_COUNT_V2,
    pairs: DATASET_PAIR_COUNT_V2,
    arms: [ARM_GROUNDED, ARM_UNGROUNDED],
    primary: PRIMARY_METRIC,
    minRelativeReduction: MIN_RELATIVE_REDUCTION,
    minValidPairRatio: MIN_VALID_PAIR_RATIO,
    minInterRaterAlpha: MIN_INTER_RATER_ALPHA,
    minRaters: MIN_RATERS,
    metrics: METRICS.map((m) => [m.id, m.direction, m.evaluator, m.role, m.calculation]),
    acceptance: ACCEPTANCE_RULES,
    exclusions: EXCLUSION_RULES,
    statistics: STATISTICAL_TREATMENT_V2,
    humanProtocol: HUMAN_RATING_PROTOCOL,
    independenceContract: INDEPENDENCE_CONTRACT,
  });
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
