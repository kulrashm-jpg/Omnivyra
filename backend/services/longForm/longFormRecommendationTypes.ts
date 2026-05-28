/**
 * Long-form recommendation types — single source of truth for engine,
 * validator, API, and frontend cards.
 *
 * Phases covered:
 *   1. Content alignment modes
 *   4. Alignment scoring dimensions
 *   5. Recommendation card output structure
 *   7. Observability / traces
 */

import type { LongFormContentType } from '../../../lib/content/longFormContentTypeConfig';
import type { CompanyContextFoundation } from './companyContextFoundation';

// ────────────────────────────────────────────────────────────────────────────
// Phase 1 — Content alignment modes
// ────────────────────────────────────────────────────────────────────────────

export type ContentAlignmentMode =
  | 'company_context_led'
  | 'hybrid_editorial'
  | 'independent_editorial';

export const CONTENT_ALIGNMENT_MODES: readonly ContentAlignmentMode[] = [
  'company_context_led',
  'hybrid_editorial',
  'independent_editorial',
];

export interface ContentAlignmentModeRule {
  mode: ContentAlignmentMode;
  /** Weight 0..1 multiplied against companyAlignmentScore during ranking. */
  companyWeight: number;
  /** Minimum companyAlignmentScore the validator will accept for this mode. */
  minCompanyAlignment: number;
  /** Whether validator allows operationalDepthScore < 60. */
  allowsLowOperationalDepth: boolean;
  /** Whether strategicNarrative is required on every recommendation. */
  requiresStrategicNarrative: boolean;
}

export const ALIGNMENT_MODE_RULES: Record<ContentAlignmentMode, ContentAlignmentModeRule> = {
  company_context_led: {
    mode: 'company_context_led',
    companyWeight: 1.0,
    minCompanyAlignment: 75,
    allowsLowOperationalDepth: false,
    requiresStrategicNarrative: true,
  },
  hybrid_editorial: {
    mode: 'hybrid_editorial',
    companyWeight: 0.65,
    minCompanyAlignment: 55,
    allowsLowOperationalDepth: false,
    requiresStrategicNarrative: true,
  },
  independent_editorial: {
    mode: 'independent_editorial',
    companyWeight: 0.35,
    minCompanyAlignment: 35,
    allowsLowOperationalDepth: true,
    requiresStrategicNarrative: false,
  },
};

// ────────────────────────────────────────────────────────────────────────────
// Phase 4 — Alignment scoring dimensions
// ────────────────────────────────────────────────────────────────────────────

export interface RecommendationScoreBreakdown {
  /** Relation to company capability, strategic relevance, positioning alignment. */
  companyAlignmentScore: number;
  /** Buyer-stage usefulness, ICP relevance, conversion-assist potential. */
  commercialRelevanceScore: number;
  /** Expertise signaling, differentiation depth, thought leadership value. */
  authorityBuildingScore: number;
  /** Workflow realism, execution specificity, operational applicability. */
  operationalDepthScore: number;
  /** Discoverability, search demand, topical coverage. */
  seoOpportunityScore: number;
  /** Weighted aggregate (priority order: company → authority → commercial → operational → seo). */
  overallRecommendationStrength: number;
}

/**
 * Priority order is enforced via these weights. Company alignment dominates;
 * SEO is intentionally last. Validators may demote a recommendation that has
 * a high seoOpportunityScore but low companyAlignmentScore.
 */
export const SCORE_PRIORITY_WEIGHTS = {
  companyAlignmentScore: 0.32,
  authorityBuildingScore: 0.22,
  commercialRelevanceScore: 0.20,
  operationalDepthScore: 0.16,
  seoOpportunityScore: 0.10,
} as const;

export type TargetBuyerStage =
  | 'awareness'
  | 'consideration'
  | 'evaluation'
  | 'decision'
  | 'expansion';

// ────────────────────────────────────────────────────────────────────────────
// Phase 5 — Recommendation card output structure
// ────────────────────────────────────────────────────────────────────────────

export interface LongFormRecommendation {
  recommendationId: string;
  recommendationTitle: string;
  editorialAngle: string;
  contentAlignmentMode: ContentAlignmentMode;
  recommendedContentType: LongFormContentType;

  companyAlignmentScore: number;
  commercialRelevanceScore: number;
  authorityBuildingScore: number;
  operationalDepthScore: number;
  seoOpportunityScore: number;
  overallRecommendationStrength: number;

  whyThisFitsCompany: {
    summary: string;
    icpProblemMapping: string;
    capabilityConnection: string;
    businessContextOrigin: string;
  };

  targetBuyerStage: TargetBuyerStage;
  strategicNarrative: string;
  recommendedContentDirection: {
    primaryAngle: string;
    operationalProof: string[];
    avoidPatterns: string[];
  };

  /** Source signals that produced this recommendation (set by engine). */
  originTrace?: RecommendationOriginTrace;
  /** Per-recommendation alignment trace (set by engine). */
  alignmentDecisionTrace?: AlignmentDecisionTrace;
  /** Genericity risk after drift detection. */
  genericityRiskLevel?: GenericityRiskLevel;

  // ─── Phase 1 — family clustering ─────────────────────────────────────
  familyClusterId?: string;
  familyClusterLabel?: string;
  narrativeArchetype?: NarrativeArchetype;
  /** Where this recommendation sits in cluster ranking (1 = strongest member). */
  clusterRank?: number;

  // ─── Phase 3 — memory / novelty ──────────────────────────────────────
  /** 0–100. Lower = more similar to recent recommendations for this company. */
  recommendationNoveltyScore?: number;

  // ─── Phase 7 — narrative shape uniqueness ────────────────────────────
  narrativeShape?: NarrativeShape;
  /** 0–100. Lower = shape repeats within batch. */
  narrativeShapeUniquenessScore?: number;

  // ─── Finalization phase additions ────────────────────────────────────
  confidence?: RecommendationConfidence;
  suitability?: RecommendationSuitability;
  explanation?: RecommendationExplanation;
  lifecycleState?: RecommendationLifecycleState;
  lineageMetadata?: RecommendationLineageMetadata;
}

// ────────────────────────────────────────────────────────────────────────────
// Finalization — Phase 4 (confidence)
// ────────────────────────────────────────────────────────────────────────────

export type ConfidenceBand = 'low' | 'medium' | 'high' | 'exceptional';

export interface RecommendationConfidence {
  recommendationConfidenceScore: number;
  confidenceBand: ConfidenceBand;
  /** Each contributor 0–100. Useful for debugging why confidence is what it is. */
  contributorBreakdown: {
    companyContextRichness: number;
    recommendationUniqueness: number;
    validationStability: number;
    retryVolatility: number;
    clusterStability: number;
    archetypeConfidence: number;
    noveltyConfidence: number;
    operationalSpecificity: number;
    strategicConsistency: number;
    continuityStability: number;
  };
  /** Reason strings to display in UI ("Why this confidence?"). */
  reasoning: string[];
}

// ────────────────────────────────────────────────────────────────────────────
// Finalization — Phase 5 (suitability)
// ────────────────────────────────────────────────────────────────────────────

export type LongFormPrimaryUse =
  | 'long_form_educational'
  | 'authority_building'
  | 'seo_led_discoverability'
  | 'strategic_positioning'
  | 'conversion_assist'
  | 'thought_leadership'
  | 'operational_deep_dive';

export const LONG_FORM_PRIMARY_USES: readonly LongFormPrimaryUse[] = [
  'long_form_educational',
  'authority_building',
  'seo_led_discoverability',
  'strategic_positioning',
  'conversion_assist',
  'thought_leadership',
  'operational_deep_dive',
];

export interface RecommendationSuitability {
  recommendedPrimaryUse: LongFormPrimaryUse;
  recommendedSecondaryUses: LongFormPrimaryUse[];
  unsuitableFor: LongFormPrimaryUse[];
  useFitScores: Record<LongFormPrimaryUse, number>;
  /** One short sentence summarizing why the primary use was picked. */
  primaryUseRationale: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Finalization — Phase 7 (explanation composer)
// ────────────────────────────────────────────────────────────────────────────

export interface RecommendationExplanation {
  whyThisMatters: string;
  whyThisCompany: string;
  whyThisIcp: string;
  whyThisNow: string;
  whyThisDiffers: string;
  whyThisRanksHighly: string;
  whyThisIsOperationallyValuable: string;
  /** Stable hash of the canonical source used by the composer. Same source → same hash. */
  reasoningSourceHash: string;
  /** Internal contradictions detected during composition (empty when consistent). */
  contradictions: string[];
}

// ────────────────────────────────────────────────────────────────────────────
// Finalization — Phase 8 (lifecycle)
// ────────────────────────────────────────────────────────────────────────────

export type RecommendationLifecycleState =
  | 'generated'
  | 'validated'
  | 'selected'
  | 'handed_off'
  | 'planner_validated'
  | 'planner_drifted'
  | 'generation_ready'
  | 'generation_rejected'
  // Phase 7 — orchestration-layer additions:
  | 'planner_ready'
  | 'generation_validated'
  | 'generation_blocked'
  | 'generation_recovered'
  | 'generation_in_progress'
  | 'generation_completed'
  | 'generation_failed'
  // Phase 9 — execution-layer additions:
  | 'section_generating'
  | 'section_validated'
  | 'section_recovered'
  | 'section_failed'
  | 'article_assembling'
  | 'article_validated'
  | 'article_recovered'
  | 'article_completed'
  | 'article_failed'
  | 'archived';

export interface RecommendationLineageMetadata {
  recommendationId: string;
  companyId: string;
  foundationSignature: string;
  generationTimestamp: string;
  ageInSeconds: number;
  lifecycleStateHistory: Array<{
    state: RecommendationLifecycleState;
    timestamp: string;
    detail?: string;
  }>;
  inheritanceHistory: Array<{
    timestamp: string;
    inheritanceCompletenessScore: number;
    continuityScore: number;
    semanticContinuityScore: number;
  }>;
  /** Aggregate degradation (max 100) — sum of small drift events seen across handoffs. */
  cumulativeDegradationPoints: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Finalization — Phase 6 (entropy stabilization)
// ────────────────────────────────────────────────────────────────────────────

export interface EntropyStabilization {
  batchCoherenceScore: number;
  batchEntropyStabilityScore: number;
  warnings: string[];
  /** Diagnostic — input diversity (before stabilization) vs final diversity. */
  diversityShift: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Finalization — Phase 2 (planner inheritance contract)
// ────────────────────────────────────────────────────────────────────────────

export type InheritanceElement =
  | 'strategic_narrative'
  | 'editorial_angle'
  | 'operational_framing'
  | 'icp_framing'
  | 'capability_emphasis'
  | 'narrative_family'
  | 'avoid_patterns'
  | 'terminology_emphasis'
  | 'content_mode_intent';

export const INHERITANCE_ELEMENTS: readonly InheritanceElement[] = [
  'strategic_narrative',
  'editorial_angle',
  'operational_framing',
  'icp_framing',
  'capability_emphasis',
  'narrative_family',
  'avoid_patterns',
  'terminology_emphasis',
  'content_mode_intent',
];

export interface PlannerInheritanceContractResult {
  inheritanceCompletenessScore: number;
  /** Per-element preservation, 0 = stripped, 100 = fully present. */
  elementStatus: Record<InheritanceElement, {
    score: number;
    preserved: boolean;
    detail: string;
  }>;
  /** When score < threshold, contract says caller should warn or reject. */
  passed: boolean;
  /** Free-form strings describing how the inheritance contract was breached. */
  breaches: string[];
}

// ────────────────────────────────────────────────────────────────────────────
// Finalization — Phase 3 (semantic continuity refinement)
// ────────────────────────────────────────────────────────────────────────────

export interface SemanticContinuityResult {
  semanticContinuityScore: number;
  strategicIntegrityScore: number;
  operationalIntegrityScore: number;
  signals: {
    bigramOverlap: number;
    structuralAlignment: number;
    operationalVerbPreservation: number;
    icpEntityPreservation: number;
    narrativeToneAlignment: number;
    capabilityConceptDensity: number;
  };
  /** Specific drift signals the analyzer detected. */
  driftDetections: Array<{
    type:
      | 'SUPERFICIAL_TOKEN_PRESERVATION'
      | 'HIDDEN_NARRATIVE_DRIFT'
      | 'OPERATIONAL_SIMPLIFICATION'
      | 'STRATEGIC_DILUTION'
      | 'ICP_EROSION';
    detail: string;
    severity: 'low' | 'medium' | 'high';
  }>;
}

// ────────────────────────────────────────────────────────────────────────────
// Finalization — Phase 10 (lifecycle diagnostics)
// ────────────────────────────────────────────────────────────────────────────

export interface RecommendationLifecycleDiagnostics {
  confidenceDistribution: Record<ConfidenceBand, number>;
  continuityDegradationCount: number;
  plannerInheritanceLossCount: number;
  semanticDriftFrequency: number;
  entropyStabilizationEffectiveness: number;
  suitabilityDistribution: Record<LongFormPrimaryUse, number>;
  lifecycleStateCounts: Record<RecommendationLifecycleState, number>;
  oldestRecommendationAgeSeconds: number;
  averageRecommendationAgeSeconds: number;
  /** Active registry size at the time of diagnostics emission. */
  activeRegistrySize: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Orchestration phase — types
// ────────────────────────────────────────────────────────────────────────────

// Phase 1 — orchestration contract
export interface GenerationOrchestrationContract {
  generationContractId: string;
  generationLineageId: string;
  recommendationId: string;
  companyId: string;
  contentAlignmentMode: ContentAlignmentMode;
  /** Forward-declared so we can carry the planner output through without circular imports. */
  recommendedContentType: string;
  targetBuyerStage: TargetBuyerStage;
  narrativeArchetype: NarrativeArchetype | null;
  familyClusterId: string | null;
  familyClusterLabel: string | null;
  /** Snapshot of upstream scores for downstream observability. */
  upstreamScoreSnapshot: {
    overallRecommendationStrength: number;
    inheritanceCompletenessScore: number;
    continuityScore: number;
    semanticContinuityScore: number;
    recommendationConfidenceScore: number;
    operationalDepthScore: number;
    companyAlignmentScore: number;
    authorityBuildingScore: number;
  };
  recommendedPrimaryUse: LongFormPrimaryUse | null;
  hardRules: string[];
  avoidPatterns: string[];
  terminologyEmphasis: {
    domainVocabulary: string[];
    strategicTerminology: string[];
  };
  /** Truncated planner-output digest the generator should honor. */
  plannerDigest: {
    title: string;
    excerpt: string;
    sectionCount: number;
    sectionTitles: string[];
    frameworkName: string;
    frameworkComponents: string[];
    keyInsightCount: number;
    faqCount: number;
    evidencePlanCount: number;
  };
  createdAt: string;
}

// Phase 2 — readiness
export type GenerationReadinessBand = 'blocked' | 'weak' | 'acceptable' | 'strong' | 'exceptional';

export interface GenerationReadinessAssessment {
  generationReadinessScore: number;
  readinessBand: GenerationReadinessBand;
  dimensionScores: {
    continuityIntegrity: number;
    semanticPreservation: number;
    strategicIntegrity: number;
    operationalSpecificity: number;
    icpPreservation: number;
    capabilityPreservation: number;
    narrativeFamilyPreservation: number;
    terminologyPreservation: number;
    inheritanceCompleteness: number;
    plannerCoherence: number;
  };
  failingDimensions: Array<{
    dimension: keyof GenerationReadinessAssessment['dimensionScores'];
    score: number;
    minimumRequired: number;
  }>;
}

// Phase 3 — gating
export type ExecutionGateThreshold = 'strict' | 'balanced' | 'exploratory';

export interface GenerationGateDecision {
  thresholdMode: ExecutionGateThreshold;
  passed: boolean;
  decision: 'execute' | 'warn' | 'block';
  generationBlockReasons: Array<{ dimension: string; reason: string; severity: 'critical' | 'major' | 'minor' }>;
  generationWarnings: string[];
  /** Per-mode floors used during the evaluation. */
  appliedThresholds: {
    readinessFloor: number;
    minDimensionFloor: number;
    blockOnAnyCritical: boolean;
  };
}

// Phase 4 — planner→generation continuity
export type PlannerContinuityDetectionType =
  | 'PLANNER_SIMPLIFICATION'
  | 'NARRATIVE_FLATTENING'
  | 'STRATEGIC_DILUTION'
  | 'OPERATIONAL_ABSTRACTION'
  | 'CAPABILITY_SUPPRESSION';

export interface PlannerGenerationContinuityResult {
  plannerGenerationContinuityScore: number;
  preserved: {
    strategicSequencing: number;
    editorialIntent: number;
    operationalLogic: number;
    terminologyIntegrity: number;
    capabilityEmphasis: number;
    buyerStageContinuity: number;
  };
  detections: Array<{
    type: PlannerContinuityDetectionType;
    detail: string;
    severity: 'low' | 'medium' | 'high';
  }>;
}

// Phase 5 — recovery
export type RecoveryStrategy =
  | 'planner_regeneration'
  | 'recommendation_rehydration'
  | 'terminology_reinforcement'
  | 'strategic_narrative_restoration'
  | 'operational_proof_restoration'
  | 'icp_re_anchoring'
  | 'capability_emphasis_restoration';

export interface RecoveryRecommendationItem {
  strategy: RecoveryStrategy;
  targetDimensions: string[];
  reason: string;
  estimatedLikelihoodOfSuccess: 'low' | 'medium' | 'high';
  estimatedCost: 'low' | 'medium' | 'high';
}

export interface RecoveryAttemptStep {
  order: number;
  strategy: RecoveryStrategy;
  expectedDimensionsRecovered: string[];
  skipIfConditionsMet: string[];
}

export interface RecoveryAttemptPlan {
  attempts: RecoveryAttemptStep[];
  totalEstimatedCost: 'low' | 'medium' | 'high';
  fallbackToFullPipeline: boolean;
}

// Phase 6 — explanation
export interface GenerationPreparationExplanation {
  whyApproved: string | null;
  whyBlocked: string | null;
  whatContinuitySurvived: string;
  whatDegraded: string;
  whatStrategicIntentRemains: string;
  whatOperationalDepthRemains: string;
  recoveryGuidance: string;
  reasoningSourceHash: string;
}

// Phase 9 — diagnostics
export type DiagnosticTrend = 'improving' | 'stable' | 'degrading' | 'unknown';

export interface GenerationPreparationDiagnostics {
  readinessDistribution: Record<GenerationReadinessBand, number>;
  gatingFrequency: {
    executed: number;
    warned: number;
    blocked: number;
  };
  recoverySuccessLikelihood: { low: number; medium: number; high: number };
  continuityDegradationTrend: DiagnosticTrend;
  plannerDriftFrequency: number;
  strategicIntegrityTrend: DiagnosticTrend;
  operationalIntegrityTrend: DiagnosticTrend;
  executionRiskProfile: 'low' | 'medium' | 'high';
  sampleSize: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Execution phase — types
// ────────────────────────────────────────────────────────────────────────────

// Phase 1 — section contract
export interface SectionGenerationContract {
  sectionContractId: string;
  sectionLineageId: string;
  parentGenerationLineageId: string;
  generationContractId: string;
  recommendationId: string;

  sectionIndex: number;
  sectionTitle: string;
  sectionGoal: string;
  uniqueAngle: string;
  keyPoints: string[];
  contentType: string;
  depthRequirement: string;
  wordTarget: number;
  requiresDirectAnswer: boolean;
  requiresOpinionatedInsight: boolean;
  frameworkRole: 'introduce' | 'apply' | 'none';
  targetEntities: string[];
  frameworkName: string;
  frameworkComponents: string[];

  // Inherited from generation contract
  contentAlignmentMode: ContentAlignmentMode;
  targetBuyerStage: TargetBuyerStage;
  narrativeArchetype: NarrativeArchetype | null;
  strategicNarrative: string;
  editorialAngle: string;
  icpFraming: {
    market: string | null;
    icps: string[];
    painPoints: string[];
    icpProblemMapping: string;
  };
  capabilityEmphasis: {
    primaryCapability: string;
    workflowCategory: string | null;
  };
  terminologyEmphasis: {
    domainVocabulary: string[];
    strategicTerminology: string[];
  };
  avoidPatterns: string[];
  hardRules: string[];

  // Cross-section context
  priorSectionSummaries: Array<{ title: string; summary: string }>;

  // Thresholds
  continuityThresholds: {
    sectionContinuityFloor: number;
    strategicIntegrityFloor: number;
    operationalIntegrityFloor: number;
    genericityCeiling: number;
  };

  // Phase 8 — evidence-aware constraints
  evidenceRequirements: EvidenceRequirements;

  // Phase 7 (grounded phase) — grounded generation constraints
  groundedConstraints: GroundedGenerationConstraints;

  // ── Phase 3 additions (planned-engine hardening) ──────────────────────────
  /**
   * Phase 3.2 — Canonical CompanyIdentity for prompt-level enforcement.
   * When present, the section generator prepends `buildIdentityLock(...)`
   * + `buildAntiGenericRules(...)` to its system prompt. The same shape
   * is consumed by the compatibility-core path so behavior matches across
   * engines.
   *
   * Typed as `unknown` here to avoid a backend ↔ frontend type-graph
   * import that would broaden this module's surface area; the section
   * generator casts to `CompanyIdentity` at the boundary.
   */
  companyIdentity?: unknown | null;

  /**
   * Phase 3.5 — Section-level strategic assignment carried into the
   * section prompt and validated post-generation via
   * `validateStrategicAssignmentConsumption`.
   */
  strategicAssignment?: {
    section_id: number;
    section_role: 'introduction' | 'body' | 'closing';
    required_context: string[];
    required_positioning: string[];
    required_pain_points: string[];
    required_differentiators: string[];
  } | null;
}

// Phase 2 — section continuity governance
export type SectionContinuityDetectionType =
  | 'SECTION_GENERIC_COLLAPSE'
  | 'OPERATIONAL_FLATTENING'
  | 'SEO_OVERFITTING'
  | 'TERMINOLOGY_DRIFT'
  | 'ICP_EROSION_SECTION'
  | 'CAPABILITY_DISAPPEARANCE'
  | 'NARRATIVE_SIMPLIFICATION';

export interface SectionContinuityResult {
  sectionContinuityScore: number;
  sectionStrategicIntegrityScore: number;
  sectionOperationalIntegrityScore: number;
  signals: {
    strategicSequencing: number;
    operationalSpecificity: number;
    editorialIntent: number;
    terminologyIntegrity: number;
    capabilityContinuity: number;
    icpContinuity: number;
    narrativeContinuity: number;
  };
  detections: Array<{
    type: SectionContinuityDetectionType;
    detail: string;
    severity: 'low' | 'medium' | 'high';
  }>;
}

// Phase 4 — generic suppression
export type GenericWritingDetectionType =
  | 'GENERIC_FILLER'
  | 'EMPTY_BEST_PRACTICES'
  | 'GENERIC_INTRO_HOOK'
  | 'ULTIMATE_GUIDE'
  | 'LEVERAGING_AI'
  | 'BUSINESSES_TODAY'
  | 'SHALLOW_TRANSITION'
  | 'SEO_FLUFF'
  | 'GENERIC_CTA'
  | 'REPEATED_RHETORIC';

export interface GenericWritingDetection {
  type: GenericWritingDetectionType;
  span: string;
  positionPercent: number;
  severity: 'low' | 'medium' | 'high';
}

export interface GenericWritingSuppressionResult {
  genericityPressureScore: number;
  hardBlocked: boolean;
  detections: GenericWritingDetection[];
}

// Phase 5 — section recovery
export type SectionRecoveryAction =
  | 'regenerate_section'
  | 'reinforce_terminology'
  | 'restore_operational_proof'
  | 'restore_icp_specificity'
  | 'restore_capability_emphasis'
  | 'restore_strategic_narrative'
  | 'restore_sequencing_continuity';

export interface SectionRecoveryStep {
  order: number;
  action: SectionRecoveryAction;
  targets: string[];
  reason: string;
}

export interface SectionRecoveryPlan {
  steps: SectionRecoveryStep[];
  estimatedCost: 'low' | 'medium' | 'high';
}

export interface SectionRecoveryHistoryEntry {
  sectionIndex: number;
  sectionContractId: string;
  attemptNumber: number;
  action: SectionRecoveryAction;
  beforeScores: { continuity: number; strategic: number; operational: number; genericity: number };
  afterScores: { continuity: number; strategic: number; operational: number; genericity: number };
  improved: boolean;
  timestamp: string;
}

// Phase 7 — post-generation integrity
export type IntegrityBand = 'failed' | 'weak' | 'acceptable' | 'strong' | 'exceptional';

export interface PostGenerationIntegrityResult {
  postGenerationIntegrityScore: number;
  integrityBand: IntegrityBand;
  dimensionScores: {
    strategicContinuity: number;
    operationalContinuity: number;
    icpPreservation: number;
    capabilityPreservation: number;
    terminologyPreservation: number;
    narrativeContinuity: number;
    editorialSequencing: number;
    genericityPressure: number;
    sectionCoherence: number;
    authorityPreservation: number;
  };
  integrityFailures: Array<{
    dimension: keyof PostGenerationIntegrityResult['dimensionScores'];
    score: number;
    minimumRequired: number;
    severity: 'critical' | 'major' | 'minor';
  }>;
  integrityWarnings: string[];
}

// Phase 8 — integrity explanation
export interface GenerationIntegrityExplanation {
  whyPassed: string | null;
  whyFailed: string | null;
  whatStrategicContinuitySurvived: string;
  whatOperationalDepthSurvived: string;
  whereDegradationOccurred: string;
  whichSectionsWeakened: string;
  recoveryActionsUsed: string;
  remainingIntegrityRisk: string;
  reasoningSourceHash: string;
}

// Phase 6 — execution diagnostics (per-run, live during generation)
export interface GenerationExecutionDiagnostics {
  sectionsGenerated: number;
  sectionsValidated: number;
  sectionsRecovered: number;
  sectionsFailed: number;
  regenerationCount: number;
  averageContinuity: number;
  averageStrategic: number;
  averageOperational: number;
  averageTerminologyPreservation: number;
  averageGenericityPressure: number;
  /** trend of continuity over the section sequence (improving / stable / degrading) */
  continuityDegradationTrend: DiagnosticTrend;
  operationalDepthTrend: DiagnosticTrend;
  terminologyPreservationTrend: DiagnosticTrend;
  /** rising = worse */
  genericityPressureTrend: 'rising' | 'stable' | 'falling' | 'unknown';
  sectionCoherenceTrend: DiagnosticTrend;
  recoveryFrequency: number;
  regenerationFrequency: number;
  generationExecutionRiskProfile: 'low' | 'medium' | 'high';
}

// ────────────────────────────────────────────────────────────────────────────
// Factual integrity phase — types
// ────────────────────────────────────────────────────────────────────────────

// Phase 1 — claim extraction
export type ClaimType =
  | 'factual_claim'
  | 'statistic'
  | 'benchmark_comparison'
  | 'operational_assertion'
  | 'market_statement'
  | 'historical_statement'
  | 'product_capability_claim'
  | 'strategic_recommendation'
  | 'speculative_statement'
  | 'opinionated_interpretation';

export type EvidenceRequirementLevel = 'none' | 'recommended' | 'required' | 'critical';

export interface ExtractedClaim {
  claimId: string;
  claimType: ClaimType;
  sourceSectionId: string;
  claimText: string;
  positionInSection: number;
  confidenceHint: 'low' | 'medium' | 'high';
  evidenceRequirementLevel: EvidenceRequirementLevel;
}

// Phase 2 — evidence classification
export type EvidenceClassification =
  | 'requires_verification'
  | 'should_be_qualified'
  | 'safe_opinion'
  | 'operational_inference'
  | 'unverifiable_assertion_risk'
  | 'high_risk_factual_claim';

export type VerificationNecessity = 'optional' | 'recommended' | 'required' | 'critical';

export interface ClaimEvidenceProfile {
  claimId: string;
  classification: EvidenceClassification;
  evidenceRiskScore: number;
  verificationNecessity: VerificationNecessity;
  hallucinationRiskScore: number;
  reasonFlags: string[];
}

// Phase 3 — hallucination
export type HallucinationPatternType =
  | 'INVENTED_STATISTIC'
  | 'UNSUPPORTED_AUTHORITY'
  | 'FAKE_RESEARCH_REFERENCE'
  | 'FABRICATED_OPERATIONAL_CERTAINTY'
  | 'UNVERIFIABLE_FACT_AS_TRUTH'
  | 'FAKE_CUSTOMER_EXAMPLE'
  | 'FAKE_BENCHMARK'
  | 'FAKE_INDUSTRY_STANDARD';

export interface HallucinationDetection {
  type: HallucinationPatternType;
  span: string;
  positionPercent: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  claimId?: string;
}

export interface HallucinationSuppressionResult {
  hallucinationDetections: HallucinationDetection[];
  hallucinationSeverity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  hallucinationPressureScore: number;
  hardBlocked: boolean;
}

// Phase 4 — speculative language
export type SpeculativeLanguagePolicy = 'permissive' | 'balanced' | 'strict';

export interface SpeculativeLanguageResult {
  overconfidentClaims: Array<{
    claimId: string;
    claimText: string;
    detectedIssue: string;
    suggestedHedge: string;
  }>;
  speculativeComplianceScore: number;
  policyApplied: SpeculativeLanguagePolicy;
}

// Phase 5 — operational proof realism
export type OperationalRealityIssueType =
  | 'IMPOSSIBLE_WORKFLOW'
  | 'CONTRADICTORY_EXECUTION'
  | 'FABRICATED_OPERATIONAL_MATURITY'
  | 'FAKE_SYSTEM_OR_PROCESS';

export interface OperationalProofValidationResult {
  realismScore: number;
  issues: Array<{
    type: OperationalRealityIssueType;
    detail: string;
    severity: 'low' | 'medium' | 'high';
    claimId?: string;
  }>;
}

// Phase 6 — authority inflation
export type AuthorityInflationType =
  | 'EXAGGERATED_CERTAINTY'
  | 'PSEUDO_EXPERT_LANGUAGE'
  | 'FAKE_STRATEGIC_AUTHORITY'
  | 'UNSUPPORTED_INDUSTRY_CONSENSUS'
  | 'INFLATED_TRANSFORMATION_PROMISE'
  | 'UNREALISTIC_ROI'
  | 'MANIPULATIVE_CERTAINTY_FRAMING';

export interface AuthorityInflationDetection {
  type: AuthorityInflationType;
  span: string;
  severity: 'low' | 'medium' | 'high';
  positionPercent: number;
}

export interface AuthorityInflationResult {
  authorityInflationScore: number;
  detections: AuthorityInflationDetection[];
}

// Phase 7 — trust calibration
export interface TrustCalibrationResult {
  trustworthinessScore: number;
  confidenceCalibrationScore: number;
  realismScore: number;
  signals: {
    authority: number;
    confidence: number;
    humility: number;
    uncertainty: number;
    operationalRealism: number;
  };
  warnings: string[];
}

// Phase 8 — evidence-aware section contract
export type AllowedEvidenceType =
  | 'realistic_example'
  | 'named_workflow'
  | 'attributed_quote'
  | 'verifiable_metric'
  | 'no_evidence_needed';

export type ClaimSensitivityProfile = 'low_sensitivity' | 'standard' | 'high_sensitivity';

export interface EvidenceRequirements {
  allowedEvidenceTypes: AllowedEvidenceType[];
  forbiddenClaimPatterns: string[];
  speculativeLanguagePolicy: SpeculativeLanguagePolicy;
  claimSensitivityProfile: ClaimSensitivityProfile;
}

// Phase 9 — post-generation factual integrity
export type HallucinationRiskBand = 'minimal' | 'low' | 'moderate' | 'high' | 'critical';

export type UnsupportedClaimAction = 'soften' | 'remove' | 'rewrite' | 'cite';

export interface UnsupportedClaim {
  claimId: string;
  claimText: string;
  reason: string;
  recommendedAction: UnsupportedClaimAction;
}

export interface PostGenerationFactualResult {
  factualIntegrityScore: number;
  hallucinationRiskBand: HallucinationRiskBand;
  dimensionScores: {
    unsupportedFactualDensity: number;
    hallucinationDensity: number;
    evidenceCoverage: number;
    speculativeLanguageCompliance: number;
    authorityCalibration: number;
    operationalRealism: number;
    unverifiableAssertionPressure: number;
  };
  unsupportedClaims: UnsupportedClaim[];
  evidenceWarnings: string[];
  trustCalibrationWarnings: string[];
}

// Phase 10 — factual recovery
export type FactualRecoveryAction =
  | 'soften_certainty'
  | 'remove_fabricated_statistic'
  | 'rewrite_unsupported_claim'
  | 'convert_to_inference_framing'
  | 'remove_fake_benchmark'
  | 'reduce_authority_inflation'
  | 'restore_operational_realism';

export interface FactualRecoveryStep {
  order: number;
  action: FactualRecoveryAction;
  targets: string[];
  reason: string;
  affectedClaimIds: string[];
}

export interface FactualRecoveryPlan {
  steps: FactualRecoveryStep[];
  estimatedCost: 'low' | 'medium' | 'high';
}

// Phase 11 — factual integrity explanation
export interface FactualIntegrityExplanation {
  whyPassed: string | null;
  whyFailed: string | null;
  whereUnsupportedClaimsExisted: string;
  whereConfidenceWasSoftened: string;
  whereEvidenceRisksRemain: string;
  whereHallucinationPressureWasReduced: string;
  reasoningSourceHash: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Grounded knowledge / source governance — types
// ────────────────────────────────────────────────────────────────────────────

// Phase 1 — knowledge source registry
export type SourceType =
  | 'company_context'
  | 'uploaded_document'
  | 'approved_url'
  | 'internal_knowledge_block'
  | 'research_reference'
  | 'planner_derived_evidence'
  | 'verified_citation'
  | 'retrieved_web_evidence';

export type SourceTrustLevel = 'authoritative' | 'high' | 'moderate' | 'low' | 'untrusted';
export type SourceVerificationStatus = 'verified' | 'reviewed' | 'unverified' | 'rejected';
export type CitationEligibility = 'eligible' | 'eligible_with_attribution' | 'restricted' | 'forbidden';

export interface SourceFreshnessMetadata {
  publishedAt?: string;
  retrievedAt?: string;
  ageInDays?: number;
  staleAfterDays?: number;
  isStale: boolean;
}

export interface KnowledgeSourceFragment {
  fragmentId: string;
  text: string;
  topicHint?: string;
  /** Optional numeric "claim" that this fragment supports — used by conflict detection. */
  numericClaim?: { metric: string; value: number; unit: string };
}

export interface KnowledgeSource {
  sourceId: string;
  sourceType: SourceType;
  sourceOrigin: string;
  title?: string;
  excerpt?: string;
  trustLevel: SourceTrustLevel;
  freshnessMetadata: SourceFreshnessMetadata;
  verificationStatus: SourceVerificationStatus;
  evidenceStrength: number;
  citationEligibility: CitationEligibility;
  authorOrPublisher?: string;
  tags?: string[];
  contentFragments: KnowledgeSourceFragment[];
}

// Phase 2 — source trust calibration
export type SourceReliabilityBand = 'unreliable' | 'low' | 'moderate' | 'high' | 'exceptional';

export interface SourceTrustResult {
  sourceId: string;
  sourceTrustScore: number;
  sourceReliabilityBand: SourceReliabilityBand;
  citationConfidence: number;
  signals: {
    freshness: number;
    verification: number;
    attributionCompleteness: number;
    sourceAuthority: number;
    evidenceSpecificity: number;
    provenanceQuality: number;
    contradictionRisk: number;
    ambiguityRisk: number;
  };
  warnings: string[];
}

// Phase 3 — retrieval grounding
export interface FactualAnchor {
  anchorId: string;
  text: string;
  sourceIds: string[];
  topicHint?: string;
}

export interface RetrievalGroundingProfile {
  retrievalProfileId: string;
  recommendationId: string;
  approvedSources: KnowledgeSource[];
  approvedTerminology: string[];
  factualAnchors: FactualAnchor[];
  strategicReferences: Array<{ text: string; sourceIds: string[] }>;
  operationalContext: Array<{ text: string; sourceIds: string[] }>;
  /** Sources grouped by reliability band for prioritization. */
  sourcePriorityIndex: Record<SourceReliabilityBand, string[]>;
}

// Phase 4 — claim ↔ source traceability
export type OrphanReason =
  | 'no_matching_source'
  | 'low_match_score'
  | 'no_eligible_citations'
  | 'no_grounding_profile';

export interface ClaimSupportingFragment {
  fragmentId: string;
  text: string;
  sourceId: string;
  matchScore: number;
}

export interface ClaimTraceability {
  claimId: string;
  supportingSourceIds: string[];
  supportingEvidenceFragments: ClaimSupportingFragment[];
  evidenceConfidence: number;
  sourceLineage: Array<{ sourceId: string; trustBand: SourceReliabilityBand }>;
  claimTraceabilityScore: number;
  isOrphan: boolean;
  orphanReason?: OrphanReason;
}

// Phase 5 — citation orchestration
export interface CitationPlanItem {
  citationId: string;
  claimId: string;
  sourceId: string;
  attributionText: string;
  placementHint: 'inline_after_claim' | 'footnote' | 'sidebar';
  priority: number;
}

export interface CitationOrchestrationResult {
  citationPlan: CitationPlanItem[];
  dedupedSourceCount: number;
  rejectedFakeCitations: number;
  weakSourceOveruseWarnings: string[];
}

// Phase 6 — source conflict
export type SourceConflictType =
  | 'CONTRADICTORY_EVIDENCE'
  | 'STALE_REFERENCE'
  | 'CONFLICTING_STATISTICS'
  | 'CONFLICTING_STRATEGIC_RECOMMENDATIONS'
  | 'INCOMPATIBLE_OPERATIONAL_ASSUMPTIONS';

export interface SourceConflict {
  conflictType: SourceConflictType;
  involvedSourceIds: string[];
  detail: string;
  severity: 'low' | 'medium' | 'high';
}

export type ConflictResolutionAction =
  | 'prefer_higher_trust'
  | 'prefer_newer'
  | 'remove_lower_trust'
  | 'flag_for_human_review'
  | 'merge_with_caveat';

export interface SourceConflictResult {
  conflicts: SourceConflict[];
  sourceConflictSeverity: 'none' | 'low' | 'medium' | 'high';
  conflictResolutionRecommendations: Array<{
    conflictIndex: number;
    action: ConflictResolutionAction;
    reason: string;
  }>;
}

// Phase 7 — section contract extension
export type CitationRequirementMode = 'optional' | 'preferred' | 'required';
export type UnsupportedClaimEscalationPolicy = 'allow' | 'soften' | 'remove' | 'reject_section';

export interface GroundedGenerationConstraints {
  allowedSourceIds: string[];
  mandatoryEvidenceAnchors: string[];
  citationRequirements: CitationRequirementMode;
  sourceTrustThresholds: {
    minimumTrustScoreForCitation: number;
    minimumTrustScoreForFactualClaim: number;
  };
  unsupportedClaimEscalationPolicy: UnsupportedClaimEscalationPolicy;
}

// Phase 8 — post-generation source integrity
export type SourceIntegrityBand = 'failed' | 'weak' | 'acceptable' | 'strong' | 'exceptional';

export interface PostGenerationSourceIntegrityResult {
  sourceIntegrityScore: number;
  integrityBand: SourceIntegrityBand;
  groundingCoverageScore: number;
  dimensionScores: {
    claimTraceability: number;
    citationValidity: number;
    unsupportedSourceDensity: number;
    weakSourceOverreliance: number;
    staleSourceDensity: number;
    attributionCompleteness: number;
    evidenceGroundingQuality: number;
  };
  citationIntegrityWarnings: string[];
  orphanClaims: Array<{ claimId: string; claimText: string; reason: string }>;
  weakEvidenceAreas: Array<{ topic: string; sourceIds: string[]; reason: string }>;
}

// Phase 9 — grounded recovery
export type GroundedRecoveryAction =
  | 'replace_weak_source'
  | 'remove_unsupported_claim'
  | 'strengthen_attribution'
  | 'insert_evidence_anchor'
  | 'downgrade_certainty'
  | 'remove_stale_reference'
  | 'resolve_source_conflict';

export interface GroundedRecoveryStep {
  order: number;
  action: GroundedRecoveryAction;
  targets: string[];
  reason: string;
  affectedClaimIds: string[];
}

export interface GroundedRecoveryPlan {
  steps: GroundedRecoveryStep[];
  estimatedCost: 'low' | 'medium' | 'high';
}

// Phase 10 — grounded integrity explanation
export interface GroundedIntegrityExplanation {
  whyClaimsAreTrusted: string;
  whichEvidenceSupportedGeneration: string;
  whereGroundingWasWeak: string;
  whereCitationsWereInserted: string;
  whereConflictsExisted: string;
  whereTrustWasDowngraded: string;
  reasoningSourceHash: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Revision governance — types
// ────────────────────────────────────────────────────────────────────────────

// Phase 1 — revision lineage
export type RevisionOrigin = 'ai_generation' | 'human_edit' | 'recovery_pass' | 'approval_revision';
export type EditorIdentityType = 'system' | 'reviewer' | 'strategist' | 'compliance';

export interface RevisionSectionEdit {
  sectionId: string;
  beforeHtml: string;
  afterHtml: string;
}

export interface Revision {
  revisionId: string;
  branchId: string;
  parentRevisionId: string | null;
  revisionOrigin: RevisionOrigin;
  editorIdentityType: EditorIdentityType;
  editorId?: string;
  affectedSections: RevisionSectionEdit[];
  editSummary: string;
  revisionTimestamp: string;
}

export interface RevisionBranch {
  branchId: string;
  articleId: string;
  baselineRevisionId: string;
  currentRevisionId: string;
  revisionTree: Record<string, Revision>;
}

// Phase 2 — diff intelligence
export type EditRiskType =
  | 'strategic_narrative_drift'
  | 'factual_degradation'
  | 'terminology_removal'
  | 'citation_removal'
  | 'operational_simplification'
  | 'icp_erosion'
  | 'capability_suppression'
  | 'tone_mutation'
  | 'unsupported_addition';

export interface EditRiskDetection {
  type: EditRiskType;
  severity: 'low' | 'medium' | 'high';
  detail: string;
  evidenceSpan?: string;
}

export interface EditorialDiffAnalysis {
  revisionId: string;
  sectionId: string;
  editRiskScore: number;
  continuityImpactScore: number;
  factualRiskDelta: number;
  groundingRiskDelta: number;
  detectedRisks: EditRiskDetection[];
}

// Phase 3 — human/AI drift
export type HumanDriftIndicatorType =
  | 'WEAKENED_INTEGRITY'
  | 'INTRODUCED_HALLUCINATION'
  | 'DILUTED_STRATEGY'
  | 'COLLABORATIVE_CONTRADICTION';

export type AIDriftIndicatorType =
  | 'WEAKENED_NUANCE'
  | 'OVERFIT_RECOVERY'
  | 'CONTRADICTED_EDIT';

export interface HumanDriftIndicator {
  type: HumanDriftIndicatorType;
  detail: string;
  severity: 'low' | 'medium' | 'high';
  revisionId: string;
}

export interface AIDriftIndicator {
  type: AIDriftIndicatorType;
  detail: string;
  severity: 'low' | 'medium' | 'high';
  revisionId: string;
}

export interface HumanAIDriftResult {
  humanDriftIndicators: HumanDriftIndicator[];
  aiDriftIndicators: AIDriftIndicator[];
  humanDriftFrequencyPercent: number;
  aiDriftFrequencyPercent: number;
}

// Phase 4 — editorial intent preservation
export type IntentDimension =
  | 'strategic_narrative'
  | 'editorial_angle'
  | 'buyer_stage_alignment'
  | 'operational_sequencing'
  | 'capability_emphasis'
  | 'terminology_emphasis'
  | 'evidence_grounding'
  | 'citation_lineage';

export interface IntentDimensionResult {
  dimension: IntentDimension;
  preservationScore: number;
  drifted: boolean;
  detail: string;
}

export interface EditorialIntentPreservationResult {
  overallPreservationScore: number;
  dimensions: IntentDimensionResult[];
  fragmentationDetected: boolean;
  divergenceDetected: boolean;
  sectionLevelContradictions: Array<{ sectionId: string; detail: string }>;
}

// Phase 5 — revision-aware validation
export type AffectedGovernanceZone =
  | 'continuity'
  | 'factual'
  | 'grounded'
  | 'hallucination'
  | 'citation'
  | 'operational_realism';

export interface SelectiveRevalidationOutcome {
  zone: AffectedGovernanceZone;
  sectionId: string;
  delta: number;
  passed: boolean;
  detail: string;
}

export interface RevisionAwareValidationResult {
  revisionId: string;
  affectedSectionIds: string[];
  affectedGovernanceZones: AffectedGovernanceZone[];
  selectiveRevalidationOutcomes: SelectiveRevalidationOutcome[];
  overallRevisionIntegrityScore: number;
}

// Phase 6 — approval
export type ApprovalState = 'not_requested' | 'pending' | 'approved' | 'conditionally_approved' | 'blocked';
export type ReviewerRole = 'reviewer' | 'strategist' | 'compliance';

export type ApprovalBlockerType =
  | 'INTEGRITY_BELOW_FLOOR'
  | 'UNRESOLVED_CONFLICT'
  | 'ORPHAN_CLAIMS'
  | 'WEAK_GROUNDING'
  | 'UNRESOLVED_DRIFT'
  | 'MISSING_REQUIRED_REVIEW';

export interface ApprovalBlocker {
  blockerType: ApprovalBlockerType;
  detail: string;
  severity: 'critical' | 'major' | 'minor';
}

export interface ApprovalReadinessResult {
  approvalReadinessScore: number;
  approvalState: ApprovalState;
  approvalBlockers: ApprovalBlocker[];
  recommendedReviewers: ReviewerRole[];
  perReviewerState: Record<ReviewerRole, 'not_requested' | 'pending' | 'approved' | 'blocked'>;
}

// Phase 7 — revision recovery
export type RevisionRecoveryAction =
  | 'restore_removed_citations'
  | 'restore_terminology_continuity'
  | 'restore_strategic_framing'
  | 'restore_operational_realism'
  | 'revert_unsupported_edits'
  | 'reconcile_conflicting_revisions'
  | 'regenerate_damaged_section_portions';

export interface RevisionRecoveryStep {
  order: number;
  action: RevisionRecoveryAction;
  targets: string[];
  reason: string;
  affectedSectionIds: string[];
}

export interface RevisionRecoveryPlan {
  steps: RevisionRecoveryStep[];
  estimatedCost: 'low' | 'medium' | 'high';
}

// Phase 8 — collaborative conflict
export type CollaborativeConflictType =
  | 'CONTRADICTORY_REVIEWER_EDITS'
  | 'CONFLICTING_STRATEGIC_EDITS'
  | 'CONFLICTING_FACTUAL_EDITS'
  | 'CONFLICTING_TERMINOLOGY_CHANGES'
  | 'APPROVAL_DEADLOCK';

export interface CollaborativeConflict {
  type: CollaborativeConflictType;
  involvedRevisionIds: string[];
  sectionId?: string;
  detail: string;
  severity: 'low' | 'medium' | 'high';
}

export interface CollaborativeConflictResult {
  conflicts: CollaborativeConflict[];
  conflictSeverity: 'none' | 'low' | 'medium' | 'high';
  resolutionRecommendations: Array<{ conflictIndex: number; action: string; reason: string }>;
}

// Phase 9 — explanation
export interface RevisionGovernanceExplanation {
  whatChanged: string;
  whichRisksIncreased: string;
  whichProtectionsWeakened: string;
  whichContinuitySurvived: string;
  whichReviewersAreRequired: string;
  whatRecoveryIsRecommended: string;
  reasoningSourceHash: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Portfolio governance — types
// ────────────────────────────────────────────────────────────────────────────

// Phase 1 — portfolio registry
export type PortfolioPublicationStatus = 'draft' | 'in_review' | 'approved' | 'published' | 'archived';
export type PortfolioRevisionMaturity = 'fresh' | 'edited' | 'mature' | 'stale';

export interface ContentPortfolioAsset {
  articleId: string;
  recommendationId?: string;
  strategicNarrative: string;
  editorialAngle: string;
  icpFocus: string[];
  funnelStage: TargetBuyerStage;
  capabilityEmphasis: string[];
  authorityThemes: string[];
  terminologyClusters: string[];
  narrativeArchetype: NarrativeArchetype | null;
  contentMode: ContentAlignmentMode;
  publicationStatus: PortfolioPublicationStatus;
  revisionMaturity: PortfolioRevisionMaturity;
  strategicIntentTags: string[];
  publishedAt?: string;
  lastUpdatedAt: string;
  title: string;
}

// Phase 2 — authority map
export type AuthorityNodeType =
  | 'theme'
  | 'operational_domain'
  | 'icp_pain'
  | 'strategic_narrative'
  | 'workflow_category'
  | 'capability_cluster';

export interface AuthorityNode {
  nodeId: string;
  nodeType: AuthorityNodeType;
  label: string;
  coverageWeight: number;
  contributingArticleIds: string[];
}

export interface AuthorityMap {
  nodes: AuthorityNode[];
  totalCoverage: number;
  authorityGapAreas: Array<{ nodeId: string; label: string; nodeType: AuthorityNodeType; gapSeverity: 'low' | 'medium' | 'high' }>;
  oversaturatedAreas: Array<{ nodeId: string; label: string; nodeType: AuthorityNodeType; coverageWeight: number; articleCount: number }>;
  weakNarrativeZones: Array<{ archetype: NarrativeArchetype | 'uncategorized'; coverageWeight: number }>;
}

// Phase 3 — cannibalization
export type CannibalizationTriggerType =
  | 'TOPIC_OVERLAP'
  | 'STRATEGIC_OVERLAP'
  | 'NARRATIVE_DUPLICATION'
  | 'ICP_DUPLICATION'
  | 'SEO_CANNIBALIZATION'
  | 'WORKFLOW_REDUNDANCY'
  | 'REPETITIVE_FRAMING'
  | 'AUTHORITY_SATURATION';

export interface DuplicationCluster {
  duplicationClusterId: string;
  articleIds: string[];
  sharedThemes: string[];
  sharedICPs: string[];
  sharedWorkflows: string[];
  cannibalizationRiskScore: number;
  triggers: Array<{ type: CannibalizationTriggerType; detail: string }>;
}

export interface CannibalizationAnalysisResult {
  clusters: DuplicationCluster[];
  totalCannibalizationRiskScore: number;
  highRiskPairs: Array<{ articleAId: string; articleBId: string; riskScore: number; sharedAxes: string[] }>;
}

// Phase 4 — strategic sequencing
export type SequencingTarget =
  | 'authority_gap'
  | 'funnel_balance'
  | 'icp_expansion'
  | 'narrative_evolution'
  | 'capability_depth';

export interface SequencingRecommendation {
  recommendationOrder: number;
  target: SequencingTarget;
  rationale: string;
  suggestedFocus: {
    narrativeArchetype?: NarrativeArchetype;
    icp?: string;
    funnelStage?: TargetBuyerStage;
    workflowCategory?: string;
  };
  priority: 'low' | 'medium' | 'high';
}

export interface NextContentSequencingResult {
  nextRecommendations: SequencingRecommendation[];
  ecosystemBalanceScore: number;
}

// Phase 5 — editorial memory
export interface EditorialNoveltyResult {
  editorialNoveltyScore: number;
  strategicFreshnessScore: number;
  repeatedPatterns: Array<{ pattern: string; occurrences: number; lastUsedAt: string }>;
  fatiguedTerminology: Array<{ term: string; occurrences: number }>;
  positioningDrift: { detected: boolean; detail: string };
}

// Phase 6 — portfolio continuity
export type PortfolioContinuityIssueType =
  | 'ECOSYSTEM_DRIFT'
  | 'STRATEGIC_INCONSISTENCY'
  | 'PORTFOLIO_FRAGMENTATION'
  | 'AUTHORITY_DILUTION';

export interface PortfolioContinuityResult {
  ecosystemCoherenceScore: number;
  detectedIssues: Array<{
    type: PortfolioContinuityIssueType;
    severity: 'low' | 'medium' | 'high';
    detail: string;
    affectedArticleIds: string[];
  }>;
}

// Phase 7 — funnel coverage
export interface FunnelCoverageResult {
  tofuCount: number;
  mofuCount: number;
  bofuCount: number;
  tofuShare: number;
  mofuShare: number;
  bofuShare: number;
  authorityDepthByStage: Record<'tofu' | 'mofu' | 'bofu', number>;
  icpProgressionGaps: Array<{ icp: string; missingStages: Array<'tofu' | 'mofu' | 'bofu'> }>;
  imbalanceDetected: boolean;
  weakConversionBridges: string[];
  missingEducationalProgression: string[];
}

// Phase 8 — recommendation ↔ portfolio intelligence
export interface PortfolioAwareRecommendationContext {
  recommendation: LongFormRecommendation;
  cannibalizationRiskScore: number;
  ecosystemContributionScore: number;
  fillsAuthorityGap: boolean;
  ecosystemAdjustedStrength: number;
  matchedClusterId?: string;
}

// Phase 9 — portfolio recovery
export type PortfolioRecoveryAction =
  | 'deprioritize_redundant_recommendation'
  | 'rebalance_funnel_stages'
  | 'diversify_narratives'
  | 'expand_weak_authority_zones'
  | 'reduce_saturation'
  | 'resolve_positioning_conflicts'
  | 'restore_ecosystem_coherence';

export interface PortfolioRecoveryStep {
  order: number;
  action: PortfolioRecoveryAction;
  targets: string[];
  reason: string;
  affectedArticleIds: string[];
}

export interface PortfolioRecoveryPlan {
  steps: PortfolioRecoveryStep[];
  estimatedCost: 'low' | 'medium' | 'high';
}

// Phase 10 — explanation
export interface PortfolioIntelligenceExplanation {
  howRecommendationStrengthensEcosystem: string;
  whatAuthorityGapItFills: string;
  whyCannibalizationRiskExists: string;
  howFunnelCoverageEvolves: string;
  wherePortfolioWeaknessesRemain: string;
  reasoningSourceHash: string;
}

// Phase 12 — diagnostics
export interface PortfolioGovernanceDiagnostics {
  authorityCoverageTrend: DiagnosticTrend;
  saturationTrend: DiagnosticTrend;
  cannibalizationFrequencyPercent: number;
  portfolioFreshnessTrend: DiagnosticTrend;
  funnelCoverageEvolutionTrend: DiagnosticTrend;
  ecosystemCoherenceTrend: DiagnosticTrend;
  narrativeFatigueTrend: DiagnosticTrend;
  sampleSize: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Adaptive learning — types
// ────────────────────────────────────────────────────────────────────────────

// Phase 1 — feedback events
export type FeedbackEventType =
  | 'recommendation_accepted'
  | 'recommendation_rejected'
  | 'planner_approved'
  | 'planner_rejected'
  | 'generation_blocked'
  | 'generation_recovered'
  | 'factual_correction'
  | 'human_edit_pattern'
  | 'approval_bottleneck'
  | 'portfolio_recovery'
  | 'revision_rollback'
  | 'cannibalization_recurrence'
  | 'strategic_sequencing_adopted'
  | 'strategic_sequencing_ignored'
  | 'recovery_action_outcome';

export interface FeedbackEvent {
  eventId: string;
  companyId: string;
  eventType: FeedbackEventType;
  timestamp: string;
  recommendationId?: string;
  articleId?: string;
  revisionId?: string;
  sectionContractId?: string;
  reviewerId?: string;
  detail?: string;
  scoreContext?: Record<string, number>;
  tags?: string[];
  /** Outcome flag for `recovery_action_outcome` events. */
  recoveryOutcome?: { action: string; succeeded: boolean; costBand: 'low' | 'medium' | 'high' };
}

// Phase 2 — recommendation learning
export type LearningPreferenceAxis = 'archetype' | 'icp' | 'funnel_stage' | 'content_mode';

export interface RecommendationLearningOutputs {
  recommendationPreferenceAdjustments: Array<{ axis: LearningPreferenceAxis; key: string; adjustment: number; rationale: string }>;
  narrativeFatigueAdjustments: Array<{ archetype: string; fatigueIncrement: number; rationale: string }>;
  icpPriorityAdjustments: Array<{ icp: string; priorityDelta: number; rationale: string }>;
  authorityGapPriorityAdjustments: Array<{ nodeLabel: string; priorityDelta: number; rationale: string }>;
}

// Phase 3 — governance calibration
export type ApprovalStrictnessLevel = 'permissive' | 'balanced' | 'strict';

export interface CalibratedThresholds {
  continuityFloor: number;
  hallucinationCeiling: number;
  cannibalizationCeiling: number;
  noveltyFloor: number;
  authoritySaturationCeiling: number;
  approvalStrictness: ApprovalStrictnessLevel;
}

export interface CalibrationResult {
  thresholds: CalibratedThresholds;
  calibrationConfidenceScore: number;
  adjustmentReasons: string[];
  baselineThresholds: CalibratedThresholds;
}

// Phase 4 — performance signals
export interface PerformanceSignalAggregation {
  strategicHealthIndicators: {
    recommendationAcceptanceRatePercent: number;
    portfolioCoherenceTrend: DiagnosticTrend;
    noveltyDecayTrend: DiagnosticTrend;
  };
  governancePressureIndicators: {
    recoveryFrequencyPercent: number;
    blockingFrequencyPercent: number;
    approvalBottleneckPercent: number;
    revisionConflictPercent: number;
  };
  ecosystemEvolutionIndicators: {
    cannibalizationRecurrencePercent: number;
    sequencingAdoptionRatePercent: number;
    portfolioSaturationTrend: DiagnosticTrend;
  };
  sampleSize: number;
}

// Phase 5 — adaptive portfolio
export interface AdaptivePortfolioAdjustments {
  sequencingPriorityAdjustments: Array<{ target: SequencingTarget; weightDelta: number; rationale: string }>;
  gapSeverityAdjustments: Array<{ nodeLabel: string; newSeverity: 'low' | 'medium' | 'high'; rationale: string }>;
  saturationSensitivityDelta: number;
  noveltyWeightingDelta: number;
  rationale: string;
}

// Phase 6 — revision learning
export type EditPattern = 'frequent_term_removal' | 'frequent_certainty_softening' | 'recurring_factual_corrections' | 'reviewer_specific_friction';

export interface RevisionLearningOutputs {
  highRiskEditPatterns: Array<{ pattern: EditPattern; frequencyPercent: number; detail: string }>;
  reviewerSpecificGovernancePressure: Array<{ reviewerId: string; pressureScore: number; topConcerns: string[] }>;
  recurringIntegrityWeaknesses: Array<{ dimension: string; degradationCount: number; recommendedFocus: string }>;
}

// Phase 7 — recovery optimization
export type RecoveryStrategyMode = 'cheapest_first' | 'success_weighted' | 'integrity_weighted';

export interface RecoveryOptimizationOutputs {
  optimizedActionOrdering: Array<{ action: string; previousAvgCost: 'low' | 'medium' | 'high'; recommendedPriority: number; successRatePercent: number; sampleSize: number }>;
  regenerationAvoidanceRatePercent: number;
  averageRecoveryCostBand: 'low' | 'medium' | 'high';
  recommendedStrategy: RecoveryStrategyMode;
}

// Phase 8 — strategic evolution memory
export interface EvolutionSnapshot {
  snapshotId: string;
  companyId: string;
  takenAt: string;
  positioning: string[];
  authorityTopThemes: string[];
  topICPs: string[];
  topTerminology: string[];
  topArchetypes: string[];
  portfolioSize: number;
  averageNovelty: number;
}

export type StrategicEvolutionFinding =
  | 'long_term_drift'
  | 'strategic_stagnation'
  | 'authority_plateau'
  | 'ecosystem_rigidity';

export interface StrategicEvolutionResult {
  snapshots: EvolutionSnapshot[];
  findings: Array<{ finding: StrategicEvolutionFinding; severity: 'low' | 'medium' | 'high'; detail: string }>;
  evolutionTrajectoryScore: number;
}

// Phase 9 — adaptive explanation
export interface AdaptiveLearningExplanation {
  whatTheSystemLearned: string;
  whatThresholdsAdapted: string;
  whyRecommendationPrioritiesChanged: string;
  whyGovernanceStrictnessEvolved: string;
  whatStrategicPatternsEmerged: string;
  reasoningSourceHash: string;
}

// Phase 11 — adaptive diagnostics
export interface AdaptiveLearningDiagnostics {
  thresholdEvolutionTrend: DiagnosticTrend;
  governancePressureTrend: DiagnosticTrend;
  recommendationEvolutionTrend: DiagnosticTrend;
  strategicMaturityTrend: DiagnosticTrend;
  recoveryOptimizationTrend: DiagnosticTrend;
  portfolioEvolutionTrend: DiagnosticTrend;
  adaptationStabilityScore: number;
  sampleSize: number;
}

// Phase 11 — diagnostics
export interface RevisionGovernanceDiagnostics {
  revisionRiskTrend: DiagnosticTrend;
  approvalBottleneckCount: number;
  driftFrequencyHumanPercent: number;
  driftFrequencyAiPercent: number;
  rollbackFrequencyPercent: number;
  reviewerConflictTrend: DiagnosticTrend;
  editRiskDistribution: Record<EditRiskType, number>;
  integrityDegradationAfterEditsPercent: number;
  sampleSize: number;
}

// Phase 12 — diagnostics
export interface GroundedGenerationDiagnostics {
  sourceTrustDistribution: Record<SourceReliabilityBand, number>;
  orphanClaimDensity: number;
  citationIntegrityTrend: DiagnosticTrend;
  sourceConflictFrequencyPercent: number;
  staleSourceUsageTrend: DiagnosticTrend;
  groundingCoverageTrend: DiagnosticTrend;
  evidenceQualityTrend: DiagnosticTrend;
  sampleSize: number;
}

// Phase 13 — diagnostics
export interface FactualGovernanceDiagnostics {
  hallucinationFrequencyPercent: number;
  unsupportedClaimDensity: number;
  certaintySofteningFrequencyPercent: number;
  evidenceCoverageTrend: DiagnosticTrend;
  authorityInflationTrend: DiagnosticTrend;
  trustCalibrationTrend: DiagnosticTrend;
  factualRecoveryEffectivenessPercent: number;
  sampleSize: number;
}

// Phase 11 — fleet-level observability (across many runs)
export interface GenerationExecutionObservability {
  sectionIntegrityDistribution: { failed: number; weak: number; acceptable: number; strong: number; exceptional: number };
  recoveryEffectiveness: { successful: number; total: number; ratio: number };
  regenerationRatePercent: number;
  genericitySuppressionRatePercent: number;
  operationalContinuityTrend: DiagnosticTrend;
  terminologyPreservationTrend: DiagnosticTrend;
  sectionDriftFrequencyPercent: number;
  articleIntegrityTrend: DiagnosticTrend;
  executionStabilityProfile: 'low' | 'medium' | 'high';
  sampleSize: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 1 — Family clustering
// ────────────────────────────────────────────────────────────────────────────

export type NarrativeArchetype =
  | 'operational_efficiency'
  | 'workflow_fragmentation'
  | 'observability'
  | 'scaling_bottleneck'
  | 'evaluation_maturity'
  | 'governance'
  | 'orchestration'
  | 'ai_adoption_risk'
  | 'transformation_path'
  | 'authority_positioning'
  | 'comparative_decision'
  | 'category_definition'
  | 'uncategorized';

export const NARRATIVE_ARCHETYPES: readonly NarrativeArchetype[] = [
  'operational_efficiency',
  'workflow_fragmentation',
  'observability',
  'scaling_bottleneck',
  'evaluation_maturity',
  'governance',
  'orchestration',
  'ai_adoption_risk',
  'transformation_path',
  'authority_positioning',
  'comparative_decision',
  'category_definition',
];

export interface RecommendationFamilyCluster {
  familyClusterId: string;
  familyClusterLabel: string;
  narrativeArchetype: NarrativeArchetype;
  operationalTheme: string;
  icpProblemFamily: string;
  capabilityFamily: string;
  editorialIntentFamily: string;
  /** Recommendation IDs that belong to this cluster, ordered by overallStrength. */
  memberRecommendationIds: string[];
  /** Number of candidates suppressed because they collapsed into this cluster. */
  suppressedDuplicateCount: number;
}

export interface ClusterDiversityReport {
  clusterCount: number;
  totalCandidates: number;
  /** clusterCount / accepted recommendations, scaled to 0–100. */
  clusterDiversityScore: number;
  suppressedDuplicateCount: number;
  clusters: RecommendationFamilyCluster[];
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 2 — Set-level coverage
// ────────────────────────────────────────────────────────────────────────────

export interface CoverageDimension {
  unique: number;
  total: number;
  ratio: number;
}

export interface RecommendationSetCoverage {
  icpCoverage: CoverageDimension;
  capabilityCoverage: CoverageDimension;
  narrativeCoverage: CoverageDimension;
  maturityCoverage: CoverageDimension;
  funnelStageCoverage: CoverageDimension;
  /** Weighted average of the five dimensions, scaled 0–100. */
  overallDiversityScore: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 3 — Recommendation memory
// ────────────────────────────────────────────────────────────────────────────

export interface HistoricalRecommendationFingerprint {
  fingerprintId: string;
  companyId: string;
  narrativeStructure: string;
  editorialAngleHash: string;
  capabilityFocus: string;
  icpProblem: string;
  titleSemanticsTokens: string[];
  strategicNarrativeShape: string;
  narrativeArchetype: NarrativeArchetype;
  createdAt: string;
}

export interface RecommendationMemoryProvider {
  readonly name: string;
  recordBatch(companyId: string, fingerprints: HistoricalRecommendationFingerprint[]): Promise<void>;
  recentFingerprints(companyId: string, limit?: number): Promise<HistoricalRecommendationFingerprint[]>;
  clear?(companyId?: string): Promise<void>;
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 5 — Generation continuity validation
// ────────────────────────────────────────────────────────────────────────────

export type ContinuityBreakReason =
  | 'EDITORIAL_ANGLE_DRIFT'
  | 'STRATEGIC_NARRATIVE_DROPPED'
  | 'ICP_MAPPING_LOST'
  | 'CAPABILITY_EMPHASIS_LOST'
  | 'MODE_MISMATCH'
  | 'NARRATIVE_FAMILY_CHANGED'
  | 'OPERATIONAL_PROOF_STRIPPED'
  | 'AVOID_PATTERNS_DROPPED';

export interface GenerationContinuityValidation {
  continuityScore: number;
  passed: boolean;
  continuityBreakReasons: Array<{ reason: ContinuityBreakReason; detail: string }>;
  /** When strictness === 'strict' && !passed, callers should refuse the input. */
  recommendedAction: 'accept' | 'regenerate' | 'reject';
}

export type ContinuityValidatorStrictness = 'warn' | 'strict' | 'regenerate';

// ────────────────────────────────────────────────────────────────────────────
// Phase 7 — Narrative shape guard
// ────────────────────────────────────────────────────────────────────────────

export type NarrativeShape =
  | 'how_to'
  | 'why_x_matters'
  | 'ultimate_guide'
  | 'best_practices'
  | 'how_to_scale'
  | 'future_of'
  | 'what_is'
  | 'comparison'
  | 'framework_first'
  | 'case_proof'
  | 'opinion_take'
  | 'other';

export interface NarrativeShapeAudit {
  shape: NarrativeShape;
  /** Count within the current batch. */
  countInBatch: number;
  /** Penalty applied to overallStrength when this shape repeats. */
  penaltyApplied: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 9 — Batch diagnostics
// ────────────────────────────────────────────────────────────────────────────

export interface RecommendationBatchDiagnostics {
  rejectedClusterCount: number;
  diversitySuppressionCount: number;
  retryEffectiveness: {
    roundsUsed: number;
    candidatesPerRound: number[];
    acceptedPerRound: number[];
    /** ratio of accepted in last round vs first round; -1 if no first round. */
    acceptanceImprovement: number;
  };
  noveltyDistribution: { low: number; medium: number; high: number };
  /** Number of distinct clusters / recommendations returned, scaled 0–100. */
  clusterSpread: number;
  /** Average narrativeShapeUniquenessScore across returned recommendations. */
  narrativeShapeEntropy: number;
  /** Shannon entropy over archetype distribution, normalized 0–100. */
  recommendationEntropyScore: number;
  /** When the engine ran a planner continuity validation step, the average score. */
  continuityPreservationScore: number | null;
  /** Per-shape counts after balancing. */
  shapeDistribution: Record<NarrativeShape, number>;
  /** Per-archetype counts after balancing. */
  archetypeDistribution: Record<NarrativeArchetype, number>;
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 7 — Observability / traces
// ────────────────────────────────────────────────────────────────────────────

export interface RecommendationOriginTrace {
  companySignalsUsed: Array<{
    section: keyof CompanyContextFoundation | 'foundation';
    signal: string;
    influence: 'primary' | 'supporting' | 'context';
  }>;
  icpPainInfluences: string[];
  capabilityClustersContributed: string[];
  selectionReason: string;
}

export interface AlignmentDecisionTrace {
  selectedMode: ContentAlignmentMode;
  selectedModeReason: string;
  caseStudyOverride: boolean;
  scoringPassed: boolean;
  scoringSummary: string;
  retriedFrom?: ContentAlignmentMode;
}

export type GenericityRiskLevel = 'low' | 'medium' | 'high';

export interface DriftDetectionResult {
  riskLevel: GenericityRiskLevel;
  textSimilarityToStripped: number;
  /** True when a stripped-context regeneration produces ~the same recommendation. */
  isGenericDrift: boolean;
  reason: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Engine request / response
// ────────────────────────────────────────────────────────────────────────────

export interface GenerateLongFormRecommendationsRequest {
  companyId: string;
  /** Mode requested by caller; case-study is internally forced to company_context_led. */
  requestedMode: ContentAlignmentMode;
  /** Content types under consideration; engine recommends per-card. */
  contentTypes?: LongFormContentType[];
  /** Number of recommendations to return (after validation pruning). */
  limit?: number;
  /** Optional seed topics from external trend signals; engine will reframe. */
  seedTopics?: string[];
  /** Optional cache version for downstream gateway cache. */
  cacheVersion?: string;
}

export interface GenerateLongFormRecommendationsResponse {
  recommendations: LongFormRecommendation[];
  rejected: Array<{
    candidateTitle: string;
    reason: string;
    mode: ContentAlignmentMode;
  }>;
  foundationSignature: string;
  foundationCompletion: number;
  /** True when the engine had to retry because validation rejected initial batch. */
  retryUsed: boolean;
  /** Sum of LLM refinement calls used (cost observability). */
  llmRefinementCalls: number;

  // ─── Hardening phase additions ───────────────────────────────────────
  clusterDiversityReport: ClusterDiversityReport;
  setCoverage: RecommendationSetCoverage;
  batchDiagnostics: RecommendationBatchDiagnostics;

  // ─── Finalization phase additions ────────────────────────────────────
  entropyStabilization: EntropyStabilization;
  lifecycleDiagnostics: RecommendationLifecycleDiagnostics;
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 11 — Cross-modal content intelligence types
// ────────────────────────────────────────────────────────────────────────────

export type CrossModalFormat =
  | 'long_form'
  | 'thread'
  | 'post'
  | 'newsletter'
  | 'guide'
  | 'story'
  | 'whitepaper'
  | 'case_study';

export const CROSS_MODAL_FORMATS: CrossModalFormat[] = [
  'long_form', 'thread', 'post', 'newsletter', 'guide', 'story', 'whitepaper', 'case_study',
];

export type CrossModalTransformationType =
  | 'decomposition'   // long-form → thread / post (split)
  | 'expansion'       // thread / post → long-form (deepen)
  | 'adaptation'      // long-form → newsletter (re-format for audience cadence)
  | 'extraction'      // long-form → post (single insight pull-out)
  | 'repurposing'     // guide → story (recast tone/structure)
  | 'derivation';     // whitepaper → educational sequence

export type EcosystemRole =
  | 'pillar'      // foundational long-form/whitepaper
  | 'amplifier'   // threads/newsletters that broadcast pillar lessons
  | 'derivative'  // posts pulled from pillars
  | 'extension'   // new long-form expanded from short-form
  | 'satellite';  // standalone tangent (low compounding value)

// Phase 1 — Cross-modal asset (lightweight; richer than a portfolio asset)
export interface CrossModalAsset {
  assetId: string;
  companyId: string;
  format: CrossModalFormat;
  title: string;
  strategicNarrative: string;
  authorityThemes: string[];
  icpFocus: string[];
  terminologyClusters: string[];
  narrativeArchetype: NarrativeArchetype | null;
  publishedAt: string;
  /** word count proxy for narrative density */
  approximateWordCount: number;
  /** caller-supplied authority claim coverage 0..100 */
  authorityClaimCoverage: number;
  /** caller-supplied factual evidence density 0..100 */
  evidenceDensity: number;
  ecosystemRole?: EcosystemRole;
}

// Phase 1 — Transformation lineage record
export interface TransformationLineage {
  lineageId: string;
  companyId: string;
  sourceAssetId: string;
  derivedAssetId: string;
  sourceFormat: CrossModalFormat;
  targetFormat: CrossModalFormat;
  transformationType: CrossModalTransformationType;
  /** ordered chain of ancestors (oldest → newest) */
  narrativeLineage: string[];
  /** sum of authority retained relative to source (0..100) */
  authorityContribution: number;
  ecosystemRole: EcosystemRole;
  createdAt: string;
}

// Phase 2 — Transformation suitability
export interface TransformationSuitabilityResult {
  transformationType: CrossModalTransformationType;
  sourceFormat: CrossModalFormat;
  targetFormat: CrossModalFormat;
  transformationSuitabilityScore: number;     // 0..100
  narrativeRetentionScore: number;            // 0..100
  authorityRetentionScore: number;            // 0..100
  audienceFitScore: number;                   // 0..100
  rationale: string;
  blockingConcerns: string[];
}

// Phase 3 — Cross-modal continuity
export type CrossModalContinuityIssueType =
  | 'STRATEGIC_NARRATIVE_DRIFT'
  | 'TERMINOLOGY_LOSS'
  | 'ICP_MISALIGNMENT'
  | 'AUTHORITY_LOSS'
  | 'FACTUAL_GROUNDING_LOSS'
  | 'EDITORIAL_INTENT_DISTORTION'
  | 'OVERSIMPLIFICATION'
  | 'CONTEXT_COLLAPSE';

export interface CrossModalContinuityIssue {
  type: CrossModalContinuityIssueType;
  severity: 'low' | 'medium' | 'high';
  detail: string;
}

export interface CrossModalContinuityResult {
  continuityScore: number;  // 0..100
  detectedIssues: CrossModalContinuityIssue[];
  preservedAxes: string[];
}

// Phase 4 — Narrative transformation analyzer
export interface DecompositionCandidate {
  sourceAssetId: string;
  targetFormat: CrossModalFormat;
  candidateTitle: string;
  density: number;        // 0..100 — how much narrative material exists
  authorityValue: number; // 0..100 — authority potential of this fragment
  rationale: string;
}

export interface ExpansionCandidate {
  sourceAssetId: string;
  targetFormat: CrossModalFormat;
  candidateTitle: string;
  authorityGapFilled: string;
  expansionStrength: number; // 0..100
  rationale: string;
}

export interface NarrativeTransformationMap {
  decompositions: DecompositionCandidate[];
  expansions: ExpansionCandidate[];
  insightExtractions: Array<{ sourceAssetId: string; insight: string; targetFormat: CrossModalFormat }>;
  averageNarrativeDensity: number;
}

// Phase 5 — Cross-modal cannibalization
export interface CrossModalCannibalizationCluster {
  clusterId: string;
  themeSignature: string;
  formats: CrossModalFormat[];
  assetIds: string[];
  redundancySeverity: 'low' | 'medium' | 'high';
  rationale: string;
}

export interface CrossModalCannibalizationResult {
  clusters: CrossModalCannibalizationCluster[];
  ecosystemRedundancyPercent: number; // 0..100
  saturatedFormatPairs: Array<{ a: CrossModalFormat; b: CrossModalFormat; assetCount: number }>;
}

// Phase 6 — Authority compounding
export interface AuthorityCompoundingResult {
  ecosystemAuthorityScore: number;       // 0..100
  narrativeCompoundingScore: number;     // 0..100
  crossFormatSynergyScore: number;       // 0..100
  /** per-archetype compounding strength */
  archetypeCompounding: Array<{ archetype: string; coverageFormats: CrossModalFormat[]; compoundingStrength: number }>;
  /** funnel progression paths discovered (e.g. post→thread→long_form for ICP X) */
  funnelProgressionPaths: Array<{ icp: string; orderedFormats: CrossModalFormat[]; pathStrength: number }>;
}

// Phase 7 — Multi-format editorial memory
export interface CrossModalEditorialMemoryResult {
  repeatedTransformationPaths: Array<{ pathSignature: string; occurrences: number; lastUsedAt: string }>;
  exhaustedNarratives: Array<{ archetype: string; formats: CrossModalFormat[]; occurrences: number }>;
  expansionFatigue: Array<{ sourceFormat: CrossModalFormat; targetFormat: CrossModalFormat; occurrences: number }>;
  repetitiveEducationalJourneys: Array<{ icp: string; journeySignature: string; occurrences: number }>;
  crossModalNoveltyScore: number; // 0..100
}

// Phase 8 — Transformation recovery
export type CrossModalRecoveryAction =
  | 'diversify_transformation_path'
  | 'restore_narrative_depth'
  | 'restore_authority_continuity'
  | 'rebalance_educational_sequencing'
  | 'prevent_repetitive_decomposition'
  | 'expand_weak_transformation_chains'
  // ── Phase 12 — hardening additions ────────────────────────────────────
  | 'chain_level_recovery'
  | 'restore_narrative_across_descendants'
  | 'lineage_rollback'
  | 'ecosystem_rebalance'
  | 'fatigue_mitigation';

export interface CrossModalRecoveryStep {
  action: CrossModalRecoveryAction;
  severity: 'low' | 'medium' | 'high';
  rationale: string;
  targetFormats: CrossModalFormat[];
}

export interface TransformationRecoveryPlan {
  steps: CrossModalRecoveryStep[];
  overallRiskScore: number; // 0..100 — sum of issues
}

// Phase 9 — Cross-modal explanation
export interface CrossModalIntelligenceExplanation {
  whyTransformationIsValuable: string;
  whatAuthorityItCompounds: string;
  whatContinuitySurvives: string;
  whereCannibalizationRiskExists: string;
  howFormatsReinforceEachOther: string;
  reasoningSourceHash: string;
  // ── Phase 12 — hardening additions (optional, present when hardened
  //    governance inputs are supplied to the composer) ──────────────────
  chainContinuityRationale?: string;
  ecosystemAuthorityRationale?: string;
  fatigueRationale?: string;
  sequencingRationale?: string;
  adaptiveScoringRationale?: string;
  // ── Phase 13 — operationalization additions (optional) ───────────────
  adaptationRationale?: string;
  chainHealthRationale?: string;
  semanticConfidenceRationale?: string;
  stabilizationRationale?: string;
  lineageSafetyRationale?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 12 — Cross-modal hardening types
// ────────────────────────────────────────────────────────────────────────────

// Phase 1 (hardening) — Multi-hop transformation governance
export type MultiHopDriftAxis = 'narrative' | 'terminology' | 'authority' | 'icp' | 'evidence';

export interface MultiHopContinuityResult {
  chainId: string;
  chainLength: number;
  chainContinuityScore: number;            // 0..100
  cumulativeAuthorityRetention: number;    // 0..100 (last vs root)
  cumulativeNarrativeRetention: number;    // 0..100
  cumulativeICPAlignment: number;          // 0..100
  cumulativeTerminologyRetention: number;  // 0..100
  cumulativeEvidenceRetention: number;     // 0..100
  chainDriftSeverity: 'low' | 'medium' | 'high';
  driftAxes: Array<{ axis: MultiHopDriftAxis; cumulativeLoss: number; rationale: string }>;
  perHopContinuity: Array<{ hopIndex: number; fromAssetId: string; toAssetId: string; continuityScore: number }>;
}

// Phase 2 (hardening) — Semantic transformation matching
export interface SemanticSimilarityResult {
  semanticTransformationSimilarityScore: number; // 0..100
  themeEquivalences: string[];                   // canonical theme tokens shared
  narrativeSimilarity: number;                   // 0..100
  icpSemanticOverlap: number;                    // 0..100
  terminologyRelationshipsScore: number;         // 0..100
  matchedSynonymPairs: Array<{ source: string; target: string; equivalenceClass: string }>;
}

// Phase 3 (hardening) — Transformation fatigue governance
export type TransformationFatiguePatternType =
  | 'decomposition_path'
  | 'expansion_strategy'
  | 'educational_journey'
  | 'funnel_transition'
  | 'authority_reinforcement_loop';

export interface TransformationFatiguePattern {
  patternType: TransformationFatiguePatternType;
  signature: string;
  occurrences: number;
  scope: { icp?: string; archetype?: string; formatPair?: string; journey?: string };
  fatigueSeverity: 'low' | 'medium' | 'high';
}

export interface TransformationFatigueResult {
  transformationFatigueScore: number;             // 0..100 — higher = more fatigued
  exhaustedTransformationPatterns: TransformationFatiguePattern[];
  fatigueByIcp: Array<{ icp: string; score: number }>;
  fatigueByArchetype: Array<{ archetype: string; score: number }>;
  fatigueByFormatPair: Array<{ pair: string; score: number }>;
}

// Phase 4 (hardening) — Adaptive transformation intelligence
export interface AdaptiveTransformationProfile {
  /** multiplier applied to baseCompatibility score (0.6..1.4) */
  compatibilityWeightMultiplier: number;
  /** shifts retention thresholds for what counts as "low" (±15) */
  retentionThresholdShift: number;
  /** sensitivity for the OVERSIMPLIFICATION continuity issue (±20) */
  oversimplificationSensitivityDelta: number;
  /** how aggressively we recommend decomposition (-20..+20) */
  decompositionAggressivenessDelta: number;
  adaptiveTransformationConfidence: number;       // 0..100
  rationaleNotes: string[];
}

// Phase 5 (hardening) — Ecosystem-wide narrative governance
export type EcosystemNarrativeIssueType =
  | 'NARRATIVE_FRAGMENTATION'
  | 'POSITIONING_CONTRADICTION'
  | 'AUTHORITY_INCOHERENCE'
  | 'EDUCATIONAL_DISORIENTATION'
  | 'STRATEGIC_DIVERGENCE';

export interface EcosystemNarrativeIssue {
  type: EcosystemNarrativeIssueType;
  severity: 'low' | 'medium' | 'high';
  formats: CrossModalFormat[];
  detail: string;
}

export interface EcosystemNarrativeResult {
  ecosystemCoherenceScore: number;                // 0..100
  detectedIssues: EcosystemNarrativeIssue[];
  perFormatNarrativeSignatures: Array<{ format: CrossModalFormat; signature: string; tokens: number }>;
  dominantSignature: string | null;
}

// Phase 6 (hardening) — Cross-modal strategic sequencer
export interface StrategicSequenceStep {
  fromFormat: CrossModalFormat;
  toFormat: CrossModalFormat;
  transformationType: CrossModalTransformationType;
  rationale: string;
  ecosystemContributionForecast: number;          // 0..100
}

export interface StrategicSequencingResult {
  recommendedTransformationSequence: StrategicSequenceStep[];
  sequencingConfidence: number;                   // 0..100
  topRecommendation: StrategicSequenceStep | null;
}

// Phase 10 (hardening) — Cross-modal evolution diagnostics
export interface CrossModalEvolutionDiagnostics {
  chainDriftTrend: DiagnosticTrend;
  semanticDuplicationTrend: DiagnosticTrend;
  fatigueEvolutionTrend: DiagnosticTrend;
  ecosystemCoherenceTrend: DiagnosticTrend;
  transformationSequenceQualityTrend: DiagnosticTrend;
  adaptiveScoringEvolutionTrend: DiagnosticTrend;
  multiHopDegradationTrend: DiagnosticTrend;
  sampleSize: number;
}

// Phase 11 — Cross-modal diagnostics
export interface CrossModalGovernanceDiagnostics {
  transformationQualityTrend: DiagnosticTrend;
  authorityCompoundingTrend: DiagnosticTrend;
  crossFormatSaturationTrend: DiagnosticTrend;
  narrativeRetentionTrend: DiagnosticTrend;
  transformationDriftTrend: DiagnosticTrend;
  crossModalNoveltyTrend: DiagnosticTrend;
  sampleSize: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 13 — Operationalization types
// ────────────────────────────────────────────────────────────────────────────

// Phase 1 — Auto-adaptive transformation application
export interface EffectiveTransformationProfile {
  /** smoothed compatibilityWeightMultiplier (0.6..1.4) */
  effectiveCompatibilityWeightMultiplier: number;
  effectiveRetentionThresholdShift: number;            // −15..+15
  effectiveOversimplificationSensitivityDelta: number; // −20..+20
  effectiveDecompositionAggressivenessDelta: number;   // −20..+20
  /** confidence reported by the most-recent adaptive profile */
  sourceAdaptiveConfidence: number;                    // 0..100
  /** governance band the application layer is operating in */
  applicationMode: 'idle' | 'damped' | 'partial' | 'full';
  /** stability score from the smoother (0..100) — higher is more stable */
  adaptationStabilityScore: number;
  /** how many adaptive samples this effective profile blends */
  smoothingWindow: number;
  rationaleNotes: string[];
}

// Phase 2 — Chain health governance
export type ChainStabilityBand = 'healthy' | 'watch' | 'unstable' | 'critical';

export interface ChainHealthSnapshot {
  takenAt: string;
  chainContinuityScore: number;
  chainDriftSeverity: 'low' | 'medium' | 'high';
  cumulativeAuthorityRetention: number;
}

export interface ChainHealthResult {
  chainId: string;
  chainHealthScore: number;             // 0..100 (current)
  chainStabilityBand: ChainStabilityBand;
  branchRecoveryRisk: number;           // 0..100 — higher = less likely to recover
  authorityDecayTrend: DiagnosticTrend;
  volatilityScore: number;              // std-dev proxy across recent snapshots (0..100)
  cumulativeFatigueScore: number;       // 0..100
  recoveryLoopDetected: boolean;
  irreversibleAuthorityCollapseDetected: boolean;
  history: ChainHealthSnapshot[];
}

// Phase 3 — Semantic hardening
export interface SemanticClassWeightOverride {
  className: string;
  weight: number; // 0..2 (1.0 = default)
}

export interface EquivalenceAmbiguityWarning {
  token: string;
  candidateClasses: string[];
  reason: string;
}

export interface SemanticConfidenceResult {
  semanticConfidenceScore: number;          // 0..100
  equivalenceAmbiguityWarnings: EquivalenceAmbiguityWarning[];
  contextualEquivalenceScore: number;       // 0..100 — same-archetype boost
  terminologyConfidenceWeight: number;      // 0..1 — weighting applied to terminology
  domainsTouched: string[];
}

// Phase 4 — Persistent transformation snapshot model
export interface PersistedTransformationSnapshot {
  snapshotId: string;
  companyId: string;
  takenAt: string;
  schemaVersion: number;
  payloads: {
    assets: number;
    lineages: number;
    feedbackEvents: number;
    fatiguePatterns: number;
    chainHealthRecords: number;
    adaptiveSamples: number;
  };
  /** opaque serialized blob (caller persistence is responsible for transport) */
  blob: string;
  integrityHash: string;
}

export interface SnapshotIntegrityResult {
  snapshotIntegrityScore: number;  // 0..100
  schemaOk: boolean;
  payloadCountsMatch: boolean;
  hashVerified: boolean;
  warnings: string[];
}

// Phase 5 — Real-time ecosystem coherence monitor
export type EcosystemInvalidationScope =
  | 'narrative'
  | 'authority'
  | 'positioning'
  | 'education'
  | 'transformation'
  | 'all';

export interface EcosystemCoherenceTickResult {
  computedAtMs: number;
  scopesInvalidated: EcosystemInvalidationScope[];
  scopesRecomputed: EcosystemInvalidationScope[];
  narrativeCoherenceScore: number;
  authorityCoherenceScore: number;
  positioningConsistencyScore: number;
  educationalContinuityScore: number;
  transformationStabilityScore: number;
  overallCoherenceScore: number;
  /** false when this tick performed no recomputation (incremental skip) */
  recomputed: boolean;
}

// Phase 6 — Governance stabilization engine
export interface StabilizationWarning {
  source: 'adaptive' | 'recovery' | 'sequencing' | 'fatigue' | 'rollback';
  type: 'oscillation' | 'over_recovery' | 'cooldown_violation' | 'overcorrection' | 'thrashing';
  detail: string;
  severity: 'low' | 'medium' | 'high';
}

export interface GovernanceStabilityResult {
  governanceStabilityScore: number;        // 0..100 (higher = more stable)
  stabilizationWarnings: StabilizationWarning[];
  /** whether stabilizer is currently suppressing further action */
  cooldownActive: boolean;
  cooldownRemainingMs: number;
}

// Phase 7 — Cross-modal safety guards
export type SafetyDetectionType =
  | 'recursive_transformation'
  | 'infinite_decomposition'
  | 'authority_amplification_loop'
  | 'circular_lineage'
  | 'excessive_derivative_nesting'
  | 'branch_explosion';

export interface RecursiveTransformationDetection {
  type: SafetyDetectionType;
  involvedAssetIds: string[];
  detail: string;
  severity: 'low' | 'medium' | 'high';
}

export interface CrossModalSafetyResult {
  lineageDepthLimit: number;
  derivativeBranchLimit: number;
  observedMaxDepth: number;
  observedMaxBranching: number;
  recursiveTransformationDetections: RecursiveTransformationDetection[];
  safe: boolean;
}

// Phase 10 — Operational diagnostics
export interface CrossModalOperationalDiagnostics {
  chainHealthEvolutionTrend: DiagnosticTrend;
  adaptationStabilityTrend: DiagnosticTrend;
  semanticConfidenceTrend: DiagnosticTrend;
  recoveryCooldownFrequencyPercent: number;       // % of ticks where cooldown was active
  lineageReplayIntegrityScore: number;             // 0..100 avg over window
  branchExplosionSuppressionCount: number;
  ecosystemRecomputationCostMsAvg: number;
  sampleSize: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

export const DEFAULT_RECOMMENDATION_LIMIT = 6;
export const MAX_RECOMMENDATION_LIMIT = 12;
export const MAX_RETRY_ROUNDS = 2;
/** Case studies always run in company_context_led regardless of caller mode. */
export const CASE_STUDY_FORCED_MODE: ContentAlignmentMode = 'company_context_led';
