/**
 * Executive Explanation Model  (BETA-ENGINE-013, Phase 3)
 *
 * The canonical, auditable record of HOW an executive conclusion was reached — a single artifact that
 * composes the full deterministic chain: Evidence → Validation → Correlation → Root Cause → Recommendation
 * → Business Impact → Commercial Evidence → ROI → Decision. NO AI, NO narrative generation — it only
 * assembles references the platform already produced, so every conclusion is reproducible + independently
 * auditable (nothing terminates in a black box).
 */

/** One ordered stage of the decision path. */
export interface ExplanationStage {
  /** Canonical stage id, in chain order. */
  stage:
    | 'evidence'
    | 'validation'
    | 'correlation'
    | 'root_cause'
    | 'recommendation'
    | 'business_impact'
    | 'commercial_roi'
    | 'confidence'
    | 'decision';
  /** Whether this stage contributed to the conclusion (false = present-but-empty, e.g. no evidence). */
  present: boolean;
  /** The canonical references this stage rests on (evidence keys, rule ids, reason codes). */
  refs: string[];
  /** Deterministic, template-free description of what the stage did (no generated prose). */
  detail: string;
}

/** A canonical Explanation artifact (Phase 3). */
export interface Explanation {
  explanationId: string;
  decisionId: string;
  /** Ordered decision path — the reproducible chain from evidence to decision. */
  decisionPath: ExplanationStage[];
  evidenceUsed: string[];
  evidenceIgnored: string[]; // measured evidence rejected by validation (never influenced the decision)
  correlationRules: string[];
  rootCauses: string[];
  recommendationRules: string[];
  businessRules: string[];
  commercialEvidence: string[]; // commercial keys that upgraded ROI, when present
  roiStatuses: string[]; // measured / estimated / not_determinable per initiative
  confidenceBreakdown: Array<{ factor: string; value: number; weight: number; contribution: number }>;
  reasonCodes: string[];
  providerProvenance: string[]; // contributing provider engineIds/sources
  calculationProvenance: string[]; // the ordered stage ids that performed a calculation
  validationStatus: 'validated';
  freshnessAt: string | null;
}
