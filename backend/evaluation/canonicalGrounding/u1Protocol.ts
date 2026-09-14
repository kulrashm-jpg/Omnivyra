/**
 * DT-C2 — U1 EVALUATION PROTOCOL (PRE-REGISTERED, FROZEN).
 *
 * This module is the machine-readable twin of DEEPTECH_U1_PREREGISTRATION_001.md.
 * It defines WHAT will be measured, HOW, and WHAT RESULT WOULD COUNT AS SUCCESS,
 * FAILURE, OR FALSIFICATION — all fixed BEFORE any model output exists.
 *
 * IMMUTABILITY RULE
 * -----------------
 * `PROTOCOL_VERSION` + `protocolFingerprint()` identify this protocol. Once a U1
 * run has been executed against a version, that version is FROZEN. Any change to
 * a metric definition, endpoint, acceptance rule, effect size, or exclusion rule
 * REQUIRES A NEW VERSION (u1-002, …). The old version is never edited in place.
 * A results file must always carry the protocolVersion + fingerprint it was
 * scored under, so post-hoc criterion drift is detectable by comparison.
 *
 * This module is dependency-free by design: its fingerprint must depend on the
 * protocol alone, never on unrelated evaluation code.
 *
 * NO RESULTS ARE STORED HERE. This file contains criteria only.
 */

export const PROTOCOL_ID = 'DEEPTECH-U1' as const;
export const PROTOCOL_VERSION = 'u1-001' as const;
export const PROTOCOL_DATASET_ID = 'canonicalGrounding.goldenDataset.v1' as const;
export const PROTOCOL_REPO_SHA = '82754497e8f9b64a893319e863941ad2994fd9b7' as const;
export const PROTOCOL_REGISTERED_ON = '2026-09-10' as const;

/** Arm identities under comparison. Neither arm may be modified by the scorer. */
export const ARM_GROUNDED = 'canonical' as const;
export const ARM_UNGROUNDED = 'ungrounded' as const;

export type MetricId =
  | 'M-P1-unsupported-claim-rate'
  | 'M-S1-grounded-fact-utilisation'
  | 'M-S2-entity-identity-fidelity'
  | 'M-S3-output-validity'
  | 'M-H1-factual-correctness'
  | 'M-H2-relevance'
  | 'M-H3-completeness'
  | 'M-H4-brand-consistency'
  | 'M-H5-instruction-following'
  | 'M-H6-campaign-usefulness'
  | 'M-H7-content-quality';

export type Evaluator = 'machine' | 'human';
export type Direction = 'lower-is-better' | 'higher-is-better';
export type Role = 'primary' | 'secondary' | 'screening';

export interface MetricDef {
  id: MetricId;
  name: string;
  /** Which of the harness's original eight dimensions this operationalises, if any. */
  mapsToLegacyDimension: string | null;
  definition: string;
  inputFields: string[];
  calculation: string;
  direction: Direction;
  range: [number, number];
  missingValueTreatment: string;
  tieTreatment: string;
  evaluator: Evaluator;
  role: Role;
  limitations: string;
}

/**
 * THE METRIC REGISTRY.
 *
 * The harness's original eight dimensions are PRESERVED, not renamed. Those that
 * cannot be computed deterministically from free text are carried here with
 * evaluator: 'human' and are reported as PENDING until rated — never replaced by
 * a deterministic look-alike proxy.
 */
export const METRICS: readonly MetricDef[] = Object.freeze([
  {
    id: 'M-P1-unsupported-claim-rate',
    name: 'Unsupported Company-Claim Rate (UCCR)',
    mapsToLegacyDimension: 'hallucination',
    definition:
      'Of the company-specific factual assertions an output makes, the proportion NOT supported by the reference fixture for that dataset entry.',
    inputFields: ['output text', 'reference fixture (entry.profile)'],
    calculation: 'UCCR = unsupportedClaims / totalCompanySpecificClaims; undefined when totalCompanySpecificClaims = 0.',
    direction: 'lower-is-better',
    range: [0, 1],
    missingValueTreatment: "Missing/absent output → validity 'invalid', metric 'pending'. NEVER scored as 0.",
    tieTreatment: 'Equal rates → delta 0; contributes to the tie count, never to the success count.',
    evaluator: 'human',
    role: 'primary',
    limitations:
      'Requires blinded human raters. Identifying a "company-specific factual assertion" is a judgement call; the rater instruction fixes the unit but inter-rater variance is expected and must be reported.',
  },
  {
    id: 'M-S1-grounded-fact-utilisation',
    name: 'Grounded Fact Utilisation (GFU)',
    mapsToLegacyDimension: null,
    definition:
      'Proportion of the REFERENCE fixture facts (same reference for BOTH arms) that appear in the output.',
    inputFields: ['output text', 'reference fixture (entry.profile)', 'workload.fields'],
    calculation:
      'GFU = |{reference values present in normalised output}| / |{reference values}|; NOT_APPLICABLE when the reference has no checkable values.',
    direction: 'higher-is-better',
    range: [0, 1],
    missingValueTreatment: "Absent output → 'pending'. Empty reference → NOT_APPLICABLE, excluded from aggregation.",
    tieTreatment: 'Equal values → delta 0.',
    evaluator: 'machine',
    role: 'screening',
    limitations:
      'Surface string matching. A correct paraphrase scores as a miss; a coincidental substring scores as a hit. It measures evidence USE, not truthfulness — it is NOT a hallucination proxy and must never be reported as one.',
  },
  {
    id: 'M-S2-entity-identity-fidelity',
    name: 'Entity Identity Fidelity (EIF)',
    mapsToLegacyDimension: null,
    definition:
      'Whether an output that names a company names the CORRECT one, given the dataset entry under evaluation.',
    inputFields: ['output text', 'reference fixture name', 'all other entries\' names'],
    calculation:
      '1 when the correct name appears and no other entry name appears; 0 when a foreign entry name appears; NOT_APPLICABLE when no entry name appears at all.',
    direction: 'higher-is-better',
    range: [0, 1],
    missingValueTreatment: "Absent output → 'pending'.",
    tieTreatment: 'Equal values → delta 0.',
    evaluator: 'machine',
    role: 'screening',
    limitations:
      'Fixture names are synthetic (e.g. "MartechCo5"), so a model has no prior knowledge of them. This detects cross-entry leakage only; it cannot detect fabricated facts about the correct company.',
  },
  {
    id: 'M-S3-output-validity',
    name: 'Output Validity (VAL)',
    mapsToLegacyDimension: null,
    definition: 'Whether an output is present, non-empty and non-degenerate, and therefore eligible for scoring.',
    inputFields: ['output text'],
    calculation: '1 when text is a non-empty string with ≥1 non-whitespace character; else 0.',
    direction: 'higher-is-better',
    range: [0, 1],
    missingValueTreatment: 'Absent output → 0 (validity is precisely the metric that must record absence).',
    tieTreatment: 'Equal values → delta 0.',
    evaluator: 'machine',
    role: 'screening',
    limitations: 'A gating check only. It says nothing about content.',
  },
  // ── The remaining original dimensions: human-rated, PENDING until rated. ──
  { id: 'M-H1-factual-correctness', name: 'Factual Correctness', mapsToLegacyDimension: 'factualCorrectness',
    definition: 'Rater judgement of whether stated facts match the reference fixture.', inputFields: ['output text', 'reference fixture'],
    calculation: 'Mean blinded rater score on the 0–4 scale, normalised to 0–1.', direction: 'higher-is-better', range: [0, 1],
    missingValueTreatment: "Absent output or absent rating → 'pending'. Never 0.", tieTreatment: 'Equal means → delta 0.',
    evaluator: 'human', role: 'secondary', limitations: 'Subjective; requires ≥2 blinded raters and a reported agreement statistic.' },
  { id: 'M-H2-relevance', name: 'Relevance', mapsToLegacyDimension: 'relevance',
    definition: 'Rater judgement of whether the output addresses the workload task.', inputFields: ['output text', 'workload label'],
    calculation: 'Mean blinded rater score, 0–4 → 0–1.', direction: 'higher-is-better', range: [0, 1],
    missingValueTreatment: "Absent → 'pending'.", tieTreatment: 'Equal means → delta 0.',
    evaluator: 'human', role: 'secondary', limitations: 'Subjective.' },
  { id: 'M-H3-completeness', name: 'Completeness', mapsToLegacyDimension: 'completeness',
    definition: 'Rater judgement of task coverage.', inputFields: ['output text', 'workload label'],
    calculation: 'Mean blinded rater score, 0–4 → 0–1.', direction: 'higher-is-better', range: [0, 1],
    missingValueTreatment: "Absent → 'pending'.", tieTreatment: 'Equal means → delta 0.',
    evaluator: 'human', role: 'secondary', limitations: 'Subjective. Distinct from M-S1, which is surface matching.' },
  { id: 'M-H4-brand-consistency', name: 'Brand Consistency', mapsToLegacyDimension: 'brandConsistency',
    definition: 'Rater judgement of consistency with the reference brand voice/positioning.', inputFields: ['output text', 'reference fixture'],
    calculation: 'Mean blinded rater score, 0–4 → 0–1.', direction: 'higher-is-better', range: [0, 1],
    missingValueTreatment: "Absent → 'pending'.", tieTreatment: 'Equal means → delta 0.',
    evaluator: 'human', role: 'secondary', limitations: 'Subjective. Undefined for entries whose fixture has no brand fields.' },
  { id: 'M-H5-instruction-following', name: 'Instruction Following', mapsToLegacyDimension: 'instructionFollowing',
    definition: 'Rater judgement of adherence to the workload instruction.', inputFields: ['output text', 'prompt'],
    calculation: 'Mean blinded rater score, 0–4 → 0–1.', direction: 'higher-is-better', range: [0, 1],
    missingValueTreatment: "Absent → 'pending'.", tieTreatment: 'Equal means → delta 0.',
    evaluator: 'human', role: 'secondary', limitations: 'Subjective. Confounded: the grounded prompt is longer and carries more instruction surface.' },
  { id: 'M-H6-campaign-usefulness', name: 'Campaign Usefulness', mapsToLegacyDimension: 'campaignUsefulness',
    definition: 'Rater judgement of practical usefulness to a marketer.', inputFields: ['output text'],
    calculation: 'Mean blinded rater score, 0–4 → 0–1.', direction: 'higher-is-better', range: [0, 1],
    missingValueTreatment: "Absent → 'pending'.", tieTreatment: 'Equal means → delta 0.',
    evaluator: 'human', role: 'secondary', limitations: 'Highly subjective; the weakest of the secondary set. Reported, never used as an acceptance basis.' },
  { id: 'M-H7-content-quality', name: 'Content Quality', mapsToLegacyDimension: 'contentQuality',
    definition: 'Rater judgement of overall writing quality.', inputFields: ['output text'],
    calculation: 'Mean blinded rater score, 0–4 → 0–1.', direction: 'higher-is-better', range: [0, 1],
    missingValueTreatment: "Absent → 'pending'.", tieTreatment: 'Equal means → delta 0.',
    evaluator: 'human', role: 'secondary', limitations: 'Stylistic. Explicitly NOT part of the acceptance rule — U1 is about truthfulness, not style.' },
]);

export const PRIMARY_METRIC: MetricId = 'M-P1-unsupported-claim-rate';

/**
 * PRE-REGISTERED EFFECT SIZE.
 *
 * Minimum practically meaningful effect: a ≥50% RELATIVE reduction in UCCR
 * (grounded ≤ 0.5 × ungrounded).
 *
 * RATIONALE — and its honest status: this threshold is NORMATIVE, not empirical.
 * No prior UCCR measurement exists for this system, so no empirically-derived
 * threshold is available. 50% is chosen because grounding carries real assembly
 * latency, prompt-size and cost overhead; an intervention that removes fewer than
 * half of the unsupported claims would not justify that cost as a *core*
 * differentiator. The threshold is frozen: it may NOT be revised downward after
 * seeing results except by issuing a new protocol version.
 */
export const MIN_RELATIVE_REDUCTION = 0.5;

/** Minimum share of pairs that must be validly scored for a run to be conclusive. */
export const MIN_VALID_PAIR_RATIO = 0.9;
/** Minimum inter-rater agreement (Krippendorff's alpha) for human metrics. */
export const MIN_INTER_RATER_ALPHA = 0.67;
/** Minimum independent raters per output. */
export const MIN_RATERS = 2;

export type Outcome = 'SUCCESS' | 'FAILURE' | 'INCONCLUSIVE';

/** The frozen acceptance rules, in evaluation order. */
export const ACCEPTANCE_RULES = Object.freeze({
  inconclusive: [
    `Fewer than ${MIN_VALID_PAIR_RATIO * 100}% of pairs are validly scored on the primary metric.`,
    `Inter-rater agreement on the primary metric is below alpha = ${MIN_INTER_RATER_ALPHA}.`,
    `Fewer than ${MIN_RATERS} independent raters scored the primary metric.`,
    'Blinding was broken or arm identity was inferable by raters.',
    'Ungrounded UCCR is 0 across the corpus (no unsupported claims to remove — the instrument cannot detect an effect).',
  ],
  success: [
    `Median paired UCCR(grounded) <= ${MIN_RELATIVE_REDUCTION} x median UCCR(ungrounded).`,
    'The reduction holds in the same direction in a majority of the 9 per-company clusters.',
    'No secondary human metric shows a materially worse grounded result that the reduction does not offset.',
  ],
  failure: [
    'The success condition is not met while the run is conclusive.',
    'This includes a reduction that is real but smaller than the pre-registered minimum effect.',
  ],
  /** THE FALSIFICATION CONDITION — evidence AGAINST the grounding hypothesis. */
  falsification: [
    'Median UCCR(grounded) >= median UCCR(ungrounded) — grounding does not reduce unsupported claims, or increases them.',
    'This result would be evidence AGAINST the deterministic-grounding hypothesis and MUST be recorded and reported as such.',
    'It would require the grounding claim to be downgraded in DEEPTECH_BASELINE_001 and in all external material.',
  ],
});

/** Pre-registered exclusion rules. Excluded pairs are recorded, never deleted. */
export const EXCLUSION_RULES = Object.freeze([
  'A pair where either arm produced no output is EXCLUDED from primary aggregation and REPORTED in the exclusion table.',
  'A pair where the reference fixture has no checkable company facts (completeness = "none") is excluded from M-S1 only, and reported.',
  'No pair may be excluded for producing an unfavourable result.',
  'The exclusion list must be published with the results.',
]);

/** Statistical treatment — deliberately conservative. */
export const STATISTICAL_TREATMENT = Object.freeze({
  observationalUnit: '(workload, dataset entry) pair — 13 x 9 = 117 pairs.',
  independence:
    'VIOLATED BY DESIGN. The 117 pairs derive from only 9 companies x 13 workloads; observations are clustered on both axes. They are NOT 117 independent samples.',
  aggregate: 'Median paired difference and median per-arm value, plus the interquartile range. Per-company (n=9) cluster medians reported alongside.',
  confidenceInterval: 'NOT REPORTED. Interval estimates over clustered, non-independent data with 9 clusters would overstate precision.',
  significanceTest:
    'NOT USED AS AN ACCEPTANCE BASIS. With 9 clusters and a non-normal bounded metric, no significance test is defensible here. A Wilcoxon signed-rank statistic MAY be reported descriptively, clearly labelled as descriptive.',
  nonNormality: 'Assumed. All summaries are rank/median-based, never mean-based.',
  ties: 'Reported explicitly as a tie count; never redistributed and never counted as success.',
  multipleMetrics:
    'ONE primary endpoint. Secondary metrics are descriptive context and may NOT be substituted for the primary if the primary fails.',
  status: 'EXPLORATORY, NOT CONFIRMATORY.',
  generalisation:
    'NONE. Results apply to this 9-company synthetic fixture set only. No population-level or customer-level generalisation may be claimed.',
});

/** Blinded human-rating protocol. Not executed in DT-C2. */
export const HUMAN_RATING_PROTOCOL = Object.freeze({
  raterUnit: 'One (workload, entry, arm) output, presented in isolation.',
  scale: '0–4 integer ordinal, normalised to 0–1 at aggregation.',
  primaryQuestion:
    'Reference facts about this company are shown beside the output. Count (a) every company-specific factual assertion the output makes, and (b) how many of those are NOT supported by the reference facts. Do not judge writing quality.',
  blinding:
    'Arm identity MUST be hidden. Outputs are presented without prompt, without arm label, in randomised order. Because the grounded prompt is longer, output length may partially reveal the arm — this residual unblinding risk MUST be recorded with the results.',
  randomisation: 'Presentation order randomised per rater with a recorded seed.',
  minRaters: MIN_RATERS,
  disagreement: 'Adjudicated by a third rater; adjudicated values are flagged in the results.',
  aggregation: 'Median across raters per output.',
  reliability: `Krippendorff's alpha on ordinal data; run is INCONCLUSIVE below ${MIN_INTER_RATER_ALPHA}.`,
  missingRatings: "Recorded as 'pending'; never imputed and never treated as 0.",
});

/** Dependency-free FNV-1a 32-bit over the canonical protocol serialisation. */
export function protocolFingerprint(): string {
  const canonical = JSON.stringify({
    id: PROTOCOL_ID,
    version: PROTOCOL_VERSION,
    datasetId: PROTOCOL_DATASET_ID,
    arms: [ARM_GROUNDED, ARM_UNGROUNDED],
    primary: PRIMARY_METRIC,
    minRelativeReduction: MIN_RELATIVE_REDUCTION,
    minValidPairRatio: MIN_VALID_PAIR_RATIO,
    minInterRaterAlpha: MIN_INTER_RATER_ALPHA,
    minRaters: MIN_RATERS,
    metrics: METRICS.map((m) => [m.id, m.direction, m.evaluator, m.role, m.calculation]),
    acceptance: ACCEPTANCE_RULES,
    exclusions: EXCLUSION_RULES,
    statistics: STATISTICAL_TREATMENT,
    humanProtocol: HUMAN_RATING_PROTOCOL,
  });
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function getMetric(id: MetricId): MetricDef {
  const m = METRICS.find((x) => x.id === id);
  if (!m) throw new Error(`unknown metric: ${id}`);
  return m;
}
