/**
 * Business Impact, Opportunity & ROI Model  (BETA-ENGINE-012, Phase 4)
 *
 * Canonical types for deterministic business-impact assessment. Turns an execution plan into a
 * commercially-prioritized initiative by quantifying impact/opportunity from validated evidence. NO AI, NO
 * probabilistic forecasting, NO invented revenue, NO fabricated ROI.
 *
 * ROI is classified into exactly three honest states and never a made-up number:
 *   • measured          — actual revenue/conversion-value evidence exists to compute real ROI.
 *   • estimated         — a deterministic opportunity quantity exists in the evidence's own units
 *                         (e.g. additional clicks from impressions × CTR-gap), NOT invented revenue.
 *   • not_determinable  — the evidence required to quantify ROI/opportunity is absent.
 */

export type ROIStatus = 'measured' | 'estimated' | 'not_determinable';

export interface ROIAssessment {
  status: ROIStatus;
  /** Why this ROI status was chosen (the deterministic basis) — never a hidden assumption. */
  basis: string;
  /** A deterministic opportunity quantity in NATIVE units (clicks, reviews, citations), or null. Never
   *  a fabricated revenue figure. Present only for `estimated`/`measured`. */
  quantified: { value: number; unit: string } | null;
}

export type BusinessPriorityBand = 'p0' | 'p1' | 'p2' | 'p3';

/** A canonical Business Impact artifact (Phase 4). Every dimension is 0..100 and deterministic. */
export interface BusinessImpact {
  impactId: string;
  ruleId: string;
  title: string;
  businessImpact: number;
  technicalImpact: number;
  customerImpact: number;
  opportunitySize: number; // 0..100 deterministic score
  executionCost: number;
  executionComplexity: number;
  riskReduction: number;
  dependencyUnlock: number;
  timeSensitivity: number;
  /** Deterministic executive priority (Phase 5). */
  businessPriority: number; // 0..100
  priorityBand: BusinessPriorityBand;
  roi: ROIAssessment;
  supportingEvidence: string[];
  supportingRootCauses: string[];
  supportingCorrelations: string[];
  supportingExecutionPlans: string[]; // recommendationIds
  confidence: number; // 0..1 (inherited from the plan/cause)
  reasonCodes: string[];
  explanation: string;
  validationStatus: 'validated';
  freshnessAt: string | null;
  decisionConsumers: string[];
}
