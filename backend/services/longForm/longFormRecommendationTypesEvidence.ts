/**
 * Long-form recommendation types — EVIDENCE (claims, verification, grounding, sequencing).
 * Split from longFormRecommendationTypes.ts (barrel preserved — importers unchanged).
 */
import type { LongFormContentType } from '../../../lib/content/longFormContentTypeConfig';
import type { CompanyContextFoundation } from './companyContextFoundation';
import type { ContentAlignmentMode, DiagnosticTrend, LongFormRecommendation, TargetBuyerStage } from './longFormRecommendationTypesCore';
import type { NarrativeArchetype } from './longFormRecommendationTypesLearning';

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
