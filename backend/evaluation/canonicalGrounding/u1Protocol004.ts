/**
 * DT-C4B — U1 PROTOCOL REVISION `u1-004` (PRE-REGISTERED, FROZEN).
 *
 * Binds the frozen 12-company Raina-originated corpus to the U1 protocol.
 *
 * WHY A NEW VERSION: u1-002 and u1-003 are permanently bound to the agent-
 * authored synthetic v2 corpus. DT-C4B §14 requires a new immutable version
 * rather than rewriting an earlier one. u1-001, u1-002 and u1-003 are untouched.
 *
 * WHAT CHANGED — dataset binding only:
 *   • dataset: canonicalGrounding.u1Dataset.v2 → .raina12
 *   • companies: 22 (synthetic) → 12 (real, externally sourced)
 *   • pairs: 286 → 156
 *   • provenance: agent-authored → externally sourced, independently prepared
 *
 * WHAT DID NOT CHANGE: every U1 acceptance criterion. As in u1-002/u1-003 the
 * criteria are IMPORTED from u1Protocol.ts — the same frozen objects, not
 * copies — so "nothing was weakened for the new corpus" is machine-verifiable.
 *
 * ⚠️ TWO LIMITATIONS THIS PROTOCOL MUST CARRY FORWARD:
 *   1. COUNT — 12 companies does NOT satisfy the original ≥20 internal target.
 *      The reduction is intentional: provenance integrity was preferred over
 *      post-hoc expansion. It must never be claimed as meeting the target.
 *   2. GROUNDING SPARSITY — this corpus is a PROSPECT list. It supplies only
 *      name, industry and a growth signal. Twelve of the fifteen grounding
 *      fields the U1 workloads consume are absent entirely. The grounded arm
 *      would therefore inject very little, which materially weakens the
 *      instrument's power to detect a grounding effect.
 *
 * NO RESULTS ARE STORED HERE.
 */

import {
  METRICS, PRIMARY_METRIC, MIN_RELATIVE_REDUCTION, MIN_VALID_PAIR_RATIO,
  MIN_INTER_RATER_ALPHA, MIN_RATERS, ACCEPTANCE_RULES, EXCLUSION_RULES,
  HUMAN_RATING_PROTOCOL, ARM_GROUNDED, ARM_UNGROUNDED,
} from './u1Protocol';
import {
  RAINA12_DATASET_ID, RAINA12_DATASET_VERSION, RAINA12_PROVENANCE_CLASS,
  RAINA12_COMPANY_COUNT, EXCLUDED_APPENDED_COMPANIES, GROUNDING_FIELDS_NOT_SUPPLIED,
} from './u1DatasetRaina12';

export const PROTOCOL_ID_V4 = 'DEEPTECH-U1' as const;
export const PROTOCOL_VERSION_V4 = 'u1-004' as const;
export const PROTOCOL_SUPERSEDES_V4 = 'u1-003' as const;
export const PROTOCOL_REPO_SHA_V4 = '82754497e8f9b64a893319e863941ad2994fd9b7' as const;
export const PROTOCOL_REGISTERED_ON_V4 = '2026-09-10' as const;

export const DATASET_ID_V4 = RAINA12_DATASET_ID;
export const DATASET_VERSION_V4 = RAINA12_DATASET_VERSION;
export const DATASET_PROVENANCE_V4 = RAINA12_PROVENANCE_CLASS;
/** SHA-256 of the deterministically serialised frozen corpus. */
export const DATASET_SHA256_V4 = '1521c379d5b1818a11befc1dabe56e37c44d11048407af12a56a610fd94ef8cd' as const;
export const DATASET_COMPANY_COUNT_V4 = RAINA12_COMPANY_COUNT;
export const DATASET_WORKLOAD_COUNT_V4 = 13;
export const DATASET_PAIR_COUNT_V4 = DATASET_COMPANY_COUNT_V4 * DATASET_WORKLOAD_COUNT_V4; // 156

/** Criteria re-exported by identity — unchanged from u1-001. */
export {
  METRICS, PRIMARY_METRIC, MIN_RELATIVE_REDUCTION, MIN_VALID_PAIR_RATIO,
  MIN_INTER_RATER_ALPHA, MIN_RATERS, ACCEPTANCE_RULES, EXCLUSION_RULES,
  HUMAN_RATING_PROTOCOL, ARM_GROUNDED, ARM_UNGROUNDED, EXCLUDED_APPENDED_COMPANIES,
};

/** DT-C4B §10 — the mandatory count disclosure. */
export const COUNT_DISCLOSURE =
  'This 12-company corpus is an independently sourced candidate ground-truth corpus but contains ' +
  'fewer companies than the original internal target of >=20. The reduced size is intentional and ' +
  'reflects preservation of provenance and experimental integrity rather than dataset expansion.';

/** The instrument-strength limitation discovered during the freeze. */
export const GROUNDING_SPARSITY_DISCLOSURE = Object.freeze({
  fieldsSupplied: ['name', 'industry', 'growth signal'],
  fieldsAbsent: GROUNDING_FIELDS_NOT_SUPPLIED,
  consequence:
    'The grounded arm can inject only company name, industry and a growth signal. Twelve of the ' +
    'fifteen grounding fields the U1 workloads consume are absent, so the difference between the ' +
    'grounded and ungrounded arms is far smaller here than on the v2 corpus. This REDUCES the ' +
    "instrument's power to detect a grounding effect and raises the risk of an INCONCLUSIVE result.",
  doNotRemedy:
    'These fields must NOT be filled in by the agent, by inference, or by new research. Doing so ' +
    'would destroy the independence that makes this corpus valuable.',
});

export const STATISTICAL_TREATMENT_V4 = Object.freeze({
  observationalUnit: `(workload, company) pair — 13 x 12 = ${DATASET_PAIR_COUNT_V4} pairs.`,
  independence:
    `VIOLATED, and more severely than on the v2 corpus. ${DATASET_PAIR_COUNT_V4} pairs derive from only ` +
    `${DATASET_COMPANY_COUNT_V4} companies x ${DATASET_WORKLOAD_COUNT_V4} workloads. Twelve clusters is fewer than v2's 22.`,
  aggregate: `Median paired difference and median per-arm value, plus IQR. Per-company (n=${DATASET_COMPANY_COUNT_V4}) cluster medians reported alongside.`,
  confidenceInterval: 'NOT REPORTED. Twelve clusters is far too few to justify interval estimates over clustered data.',
  significanceTest: 'NOT USED AS AN ACCEPTANCE BASIS. A Wilcoxon signed-rank statistic MAY be reported descriptively, clearly labelled as descriptive.',
  nonNormality: 'Assumed. All summaries rank/median-based, never mean-based.',
  ties: 'Reported explicitly as a tie count; never redistributed and never counted as success.',
  multipleMetrics: 'ONE primary endpoint. Secondary metrics are descriptive context and may NOT be substituted if the primary fails.',
  status: 'EXPLORATORY, NOT CONFIRMATORY.',
  generalisation:
    'NONE. Twelve companies, concentrated in Indian SMB/startup segments across IT services, EdTech, ' +
    'health and D2C. No population-level or sector-general claim may be made.',
});

/** FNV-1a 32-bit over the canonical criteria + dataset binding. */
export function protocolFingerprintV4(): string {
  const canonical = JSON.stringify({
    id: PROTOCOL_ID_V4, version: PROTOCOL_VERSION_V4, supersedes: PROTOCOL_SUPERSEDES_V4,
    datasetId: DATASET_ID_V4, datasetVersion: DATASET_VERSION_V4, datasetSha256: DATASET_SHA256_V4,
    provenance: DATASET_PROVENANCE_V4,
    companies: DATASET_COMPANY_COUNT_V4, workloads: DATASET_WORKLOAD_COUNT_V4, pairs: DATASET_PAIR_COUNT_V4,
    excluded: EXCLUDED_APPENDED_COMPANIES,
    arms: [ARM_GROUNDED, ARM_UNGROUNDED], primary: PRIMARY_METRIC,
    minRelativeReduction: MIN_RELATIVE_REDUCTION, minValidPairRatio: MIN_VALID_PAIR_RATIO,
    minInterRaterAlpha: MIN_INTER_RATER_ALPHA, minRaters: MIN_RATERS,
    metrics: METRICS.map((m) => [m.id, m.direction, m.evaluator, m.role, m.calculation]),
    acceptance: ACCEPTANCE_RULES, exclusions: EXCLUSION_RULES,
    statistics: STATISTICAL_TREATMENT_V4, humanProtocol: HUMAN_RATING_PROTOCOL,
    countDisclosure: COUNT_DISCLOSURE, sparsity: GROUNDING_SPARSITY_DISCLOSURE,
  });
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) { h ^= canonical.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/** DT-C4B §11 — the rung must not be upgraded merely because a corpus was frozen. */
export function evidenceCeilingV4(): { currentRung: number; ceiling: number; rationale: string } {
  return {
    currentRung: 1,
    ceiling: 4,
    rationale:
      'U1 remains at Rung 1 (engineering proof): no experiment has been run. Freezing a corpus is not ' +
      'execution. The attainable ceiling rises above the v2 corpus\'s Rung 2 because this ground truth ' +
      'is externally sourced and independently prepared — but it stops short of Rung 6 (held-out ' +
      'validation) while three companies carry unresolved pre-freeze re-verification requests, no ' +
      'signed nine-point independence certification has been supplied, and semantic distinctness is ' +
      'uncertified by the source author.',
  };
}
