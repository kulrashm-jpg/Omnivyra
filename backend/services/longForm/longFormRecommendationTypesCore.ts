/**
 * Long-form recommendation types — CORE (alignment modes, scoring, recommendation card).
 * Split from longFormRecommendationTypes.ts (barrel preserved — importers unchanged).
 */
import type { LongFormContentType } from '../../../lib/content/longFormContentTypeConfig';
import type { CompanyContextFoundation } from './companyContextFoundation';
import type { EvidenceRequirements, GroundedGenerationConstraints } from './longFormRecommendationTypesEvidence';
import type { AlignmentDecisionTrace, GenericityRiskLevel, NarrativeArchetype, NarrativeShape, RecommendationOriginTrace } from './longFormRecommendationTypesLearning';

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
