/**
 * Long-form recommendation types — LEARNING & OUTPUT (archetypes, cross-modal, traces, limits).
 * Split from longFormRecommendationTypes.ts (barrel preserved — importers unchanged).
 */
import type { LongFormContentType } from '../../../lib/content/longFormContentTypeConfig';
import type { CompanyContextFoundation } from './companyContextFoundation';
import type { ContentAlignmentMode, DiagnosticTrend, EntropyStabilization, LongFormRecommendation, RecommendationLifecycleDiagnostics } from './longFormRecommendationTypesCore';
import type { EditRiskType, SequencingTarget, SourceReliabilityBand } from './longFormRecommendationTypesEvidence';

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
