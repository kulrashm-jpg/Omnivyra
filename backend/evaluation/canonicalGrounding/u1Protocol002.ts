/**
 * DT-C3 — U1 PROTOCOL REVISION `u1-002` (PRE-REGISTERED, FROZEN).
 *
 * Machine-readable twin of DEEPTECH_U1_PREREGISTRATION_002.md.
 *
 * WHY A NEW VERSION EXISTS
 * ------------------------
 * `u1-001` is permanently bound to `canonicalGrounding.goldenDataset.v1`, whose
 * DT-C2 leakage assessment found two corpus defects (L-1 duplicated facts, L-2
 * internal contradiction). Per the u1-001 immutability rule, a dataset change
 * requires a NEW protocol version rather than an edit. `u1-001` is untouched.
 *
 * WHAT CHANGED — dataset only:
 *   • dataset identity + sealed hash
 *   • company count 9 → 22, pair count 117 → 286
 *   • per-company clusters 9 → 22
 *
 * WHAT DID NOT CHANGE — the acceptance criteria:
 *   The primary endpoint, minimum effect size, validity ratio, inter-rater floor,
 *   rater minimum, metric registry, exclusion rules, statistical treatment and
 *   human protocol are IMPORTED VERBATIM from u1Protocol.ts. They are the same
 *   objects, not copies — so "the criteria were not weakened for the new dataset"
 *   is machine-verifiable rather than a claim in prose. A test asserts identity.
 *
 * NO RESULTS ARE STORED HERE.
 */

import {
  METRICS, PRIMARY_METRIC, MIN_RELATIVE_REDUCTION, MIN_VALID_PAIR_RATIO,
  MIN_INTER_RATER_ALPHA, MIN_RATERS, ACCEPTANCE_RULES, EXCLUSION_RULES,
  HUMAN_RATING_PROTOCOL, ARM_GROUNDED, ARM_UNGROUNDED,
} from './u1Protocol';

export const PROTOCOL_ID_V2 = 'DEEPTECH-U1' as const;
export const PROTOCOL_VERSION_V2 = 'u1-002' as const;
export const PROTOCOL_SUPERSEDES = 'u1-001' as const;
export const PROTOCOL_REPO_SHA_V2 = '82754497e8f9b64a893319e863941ad2994fd9b7' as const;
export const PROTOCOL_REGISTERED_ON_V2 = '2026-09-10' as const;

/** Dataset identity — the ONLY substantive change from u1-001. */
export const DATASET_ID_V2 = 'canonicalGrounding.u1Dataset.v2' as const;
/** SHA-256 of the deterministically serialised sealed dataset. */
export const DATASET_SHA256_V2 = '369e2165568305a5e7ae7658c5b939d94957da369b995f837bf37e9efdfd7442' as const;
export const DATASET_COMPANY_COUNT_V2 = 22;
export const DATASET_WORKLOAD_COUNT_V2 = 13;
export const DATASET_PAIR_COUNT_V2 = DATASET_COMPANY_COUNT_V2 * DATASET_WORKLOAD_COUNT_V2; // 286

/** Re-exported unchanged criteria — identity, not duplication. */
export {
  METRICS, PRIMARY_METRIC, MIN_RELATIVE_REDUCTION, MIN_VALID_PAIR_RATIO,
  MIN_INTER_RATER_ALPHA, MIN_RATERS, ACCEPTANCE_RULES, EXCLUSION_RULES,
  HUMAN_RATING_PROTOCOL, ARM_GROUNDED, ARM_UNGROUNDED,
};

/**
 * The one mechanically-derived consequence of the larger corpus: the
 * cluster-majority success condition now ranges over 22 clusters, not 9. This is
 * a consequence of the dataset, NOT a relaxation — a majority of 22 is a strictly
 * harder bar than a majority of 9.
 */
export const CLUSTER_COUNT_V2 = DATASET_COMPANY_COUNT_V2;

export const STATISTICAL_TREATMENT_V2 = Object.freeze({
  observationalUnit: `(workload, dataset entry) pair — 13 x 22 = ${DATASET_PAIR_COUNT_V2} pairs.`,
  independence:
    `STILL VIOLATED, though less severely than in u1-001. ${DATASET_PAIR_COUNT_V2} pairs derive from ${CLUSTER_COUNT_V2} companies x ${DATASET_WORKLOAD_COUNT_V2} workloads; observations remain clustered on both axes and are NOT independent samples.`,
  aggregate: `Median paired difference and median per-arm value, plus IQR. Per-company (n=${CLUSTER_COUNT_V2}) cluster medians reported alongside.`,
  confidenceInterval:
    `NOT REPORTED. ${CLUSTER_COUNT_V2} clusters is better than 9 but still too few to justify interval estimates over clustered data without overstating precision.`,
  significanceTest:
    'NOT USED AS AN ACCEPTANCE BASIS. A Wilcoxon signed-rank statistic MAY be reported descriptively, clearly labelled as descriptive.',
  nonNormality: 'Assumed. All summaries rank/median-based, never mean-based.',
  ties: 'Reported explicitly as a tie count; never redistributed and never counted as success.',
  multipleMetrics: 'ONE primary endpoint. Secondary metrics are descriptive context and may NOT be substituted if the primary fails.',
  status: 'EXPLORATORY, NOT CONFIRMATORY.',
  generalisation:
    'NONE. The corpus is SYNTHETIC and NOT INDEPENDENTLY AUTHORED. No population-level, customer-level or real-company generalisation may be claimed.',
});

/**
 * INDEPENDENCE LIMITATIONS — the defect u1-002 does NOT close.
 * v2 fixes L-1 and L-2. It does not fix L-3.
 */
export const INDEPENDENCE_LIMITATIONS = Object.freeze({
  verdict: 'INDEPENDENCE NOT VERIFIED',
  authoredBy: 'The same AI coding agent that implemented DT-C1/DT-C2 evaluation infrastructure.',
  externallyValidated: false,
  syntheticCompanies: true,
  consequence:
    'The corpus remains an ENGINEERING FIXTURE. A SUCCESS outcome under u1-002 can reach Rung 2 (controlled experiment) at most — never Rung 6 (held-out validation).',
  requiredToClose:
    'Ground truth authored, or independently verified, by a party that did not implement the system, had no access to model outputs, and had no access to U1 results — sealed before first use.',
});

/** FNV-1a 32-bit over the canonical criteria serialisation. */
export function protocolFingerprintV2(): string {
  const canonical = JSON.stringify({
    id: PROTOCOL_ID_V2,
    version: PROTOCOL_VERSION_V2,
    supersedes: PROTOCOL_SUPERSEDES,
    datasetId: DATASET_ID_V2,
    datasetSha256: DATASET_SHA256_V2,
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
    independence: INDEPENDENCE_LIMITATIONS,
  });
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
