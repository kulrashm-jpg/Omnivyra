/**
 * Phase 3 — Long-form generation orchestrator.
 *
 * Section-by-section governed generation. The actual prose generation is
 * supplied via an injectable SectionGenerator so this module stays pure and
 * deterministic to test. Production wires the aiGateway-backed adapter
 * (`aiGatewaySectionGenerator.ts`); tests use deterministic synthetic
 * generators.
 *
 * Flow per section:
 *   1. Build SectionGenerationContract from upstream orchestration contract + plan.
 *   2. Call generator.generate(contract) → section HTML.
 *   3. governSectionContinuity → 7-signal continuity result.
 *   4. suppressGenericWriting → genericity pressure + detections.
 *   5. If sectionPassesGovernance → accept; else
 *      6. buildSectionRecoveryPlan → take first step → regenerate with hint.
 *      7. Re-validate. Up to MAX_RECOVERY_ATTEMPTS per section.
 *   8. Record SectionRecoveryHistoryEntry per attempt.
 *
 * After all sections: assemble article, run PostGenerationIntegrityValidator,
 * compose explanation, build live diagnostics, decide final lifecycle state.
 *
 * NOTE: This module does NOT mutate the lifecycle registry directly — the
 * caller (API route or background job) owns lifecycle transitions so the
 * orchestrator stays callable from contexts without a registry.
 */

import type { ContentPlan } from '../../../lib/content/longFormPlanningEngine';
import type {
  AuthorityInflationResult,
  ClaimEvidenceProfile,
  EvidenceRequirements,
  ExtractedClaim,
  FactualIntegrityExplanation,
  FactualRecoveryAction,
  FactualRecoveryStep,
  GenerationExecutionDiagnostics,
  GenerationIntegrityExplanation,
  GenerationOrchestrationContract,
  HallucinationSuppressionResult,
  LongFormRecommendation,
  OperationalProofValidationResult,
  PostGenerationFactualResult,
  PostGenerationIntegrityResult,
  RecommendationLifecycleState,
  SectionContinuityResult,
  SectionGenerationContract,
  SectionRecoveryAction,
  SectionRecoveryHistoryEntry,
  SpeculativeLanguageResult,
  TrustCalibrationResult,
} from './longFormRecommendationTypes';
import type { PlanningInputPartial } from './longFormPlanningAdapter';
import { buildSectionGenerationContract } from './sectionGenerationContract';
import { governSectionContinuity } from './sectionContinuityGovernor';
import { suppressGenericWriting } from './genericWritingSuppressionLayer';
import { buildSectionRecoveryPlan, sectionPassesGovernance } from './sectionRecoveryCoordinator';
import { validatePostGenerationIntegrity } from './postGenerationIntegrityValidator';
import { composeGenerationIntegrityExplanation } from './generationIntegrityExplanationComposer';
import { buildLiveExecutionDiagnostics } from './generationExecutionDiagnostics';
import { extractClaims } from './claimExtractionEngine';
import { classifyClaimEvidence } from './evidenceClassificationLayer';
import { suppressHallucinations } from './hallucinationSuppressionGovernor';
import { enforceSpeculativeLanguage } from './speculativeLanguageEnforcer';
import { validateOperationalProof } from './operationalProofValidator';
import { detectAuthorityInflation } from './authorityInflationDetector';
import { calibrateTrust } from './trustCalibrationEngine';
import { validatePostGenerationFactualIntegrity, type SectionFactualSnapshot } from './postGenerationFactualIntegrityValidator';
import { buildFactualRecoveryPlan } from './factualRecoveryCoordinator';
import { composeFactualIntegrityExplanation } from './factualIntegrityExplanationComposer';
import type {
  CitationOrchestrationResult,
  ClaimTraceability,
  GroundedIntegrityExplanation,
  GroundedRecoveryPlan,
  PostGenerationSourceIntegrityResult,
  RetrievalGroundingProfile,
  SourceConflictResult,
} from './longFormRecommendationTypes';
import { traceClaimsToSources } from './claimSourceTraceabilityEngine';
import { orchestrateCitations } from './citationOrchestrationLayer';
import { analyzeSourceConflicts } from './sourceConflictAnalyzer';
import { validatePostGenerationSourceIntegrity } from './postGenerationSourceIntegrityValidator';
import { buildGroundedRecoveryPlan } from './groundedRecoveryCoordinator';
import { composeGroundedIntegrityExplanation } from './groundedIntegrityExplanationComposer';
// ── Phase 3 additions ──────────────────────────────────────────────────────
import {
  validateSectionCompanyAlignment,
  buildAlignmentRecoveryTargets,
  type SectionCompanyAlignmentResult,
} from './sectionCompanyAlignmentValidator';
import {
  validateStrategicAssignmentConsumption,
  type StrategicAssignmentConsumptionResult,
} from './strategicAssignmentConsumptionValidator';
import {
  emitSectionGovernance,
  emitSectionRetry,
  type LongFormGovernanceFailureReason,
} from './plannedEngineStabilityTelemetry';
import type { CompanyIdentity } from '../../../lib/content/companyContextBlock';
import type { SectionStrategicAssignment } from '../../../lib/content/sectionStrategicAssignments';
// ── Phase 4 additions ─────────────────────────────────────────────────────
import {
  SectionLifecycleManager,
  SectionLifecycleState,
  classifyFailureToLifecycleState,
  type SectionLifecycleHistoryEntry,
} from './sectionLifecycleManager';
import {
  validateGroundedClaims,
  type GroundedClaimValidationResult,
} from './groundedClaimValidator';
import {
  buildPlannedEngineRecoveryPlan,
  summarizeSectionFailure,
  type RecoveryPlan as PlannedRecoveryPlan,
  type SectionFailureSummary,
} from './plannedEngineRecoveryCoordinator';
import {
  computeAdaptiveRecoveryBudget,
  type AdaptiveRecoveryBudget,
} from './adaptiveRecoveryBudget';
import { chooseSectionExecutionStrategy } from './sectionExecutionStrategy';
// ── Phase 5 additions ─────────────────────────────────────────────────────
import {
  encodeGroundingProfile,
  aggregateSemanticGrounding,
  type AggregateSemanticGroundingResult,
} from './semanticGroundingEngine';
import {
  evaluateArticleConvergence,
  type ArticleConvergenceResult,
} from './articleConvergence';
// Phase 9.3 — In-process convergence aggregator.
import { recordConvergence as recordConvergenceSample } from './convergenceTelemetry';
import {
  recordRecoveryCost,
  type SectionRecoveryCostRecord,
  type RecoveryCostReport,
} from './recoveryCostTelemetry';
import {
  buildBenchmark,
  recordBenchmark,
  type LongFormQualityBenchmark,
} from './qualityBenchmarkSuite';
// Phase 6.5 — Durable persistence (fire-and-forget; in-memory default
// unless an external provider was registered).
import {
  persistBenchmark,
  persistRecoveryCost,
  persistConvergence,
} from './benchmarkPersistence';
// Phase 6.8 — Operational explainability.
import {
  buildOperationalExplanation,
  type OperationalExplanation,
} from './operationalExplainability';
// Phase 7.1 — Canonical recovery graph as the execution decision owner.
import {
  UnifiedRecoveryGraph,
  buildFailureSummary,
} from './unifiedRecoveryGraph';
// Phase 7.2 — Per-article fragment cache.
import {
  getOrCreateArticleCache,
  releaseArticleCache,
  accumulateArticleMetrics,
} from './runtimeEfficiencyOptimizer';
// Phase 7.6 — CompressionEvent type for explainability threading.
import type { CompressionEvent } from './promptCompressionEngine';

// ────────────────────────────────────────────────────────────────────────────
// Generator interface
// ────────────────────────────────────────────────────────────────────────────

export interface SectionGenerationHint {
  recoveryAction: SectionRecoveryAction;
  recoveryTargets: string[];
  previousAttemptHtml?: string;
  attemptNumber: number;
}

export interface SectionGenerator {
  /** Generate HTML for a section. Honor the contract + optional recovery hint. */
  generate(input: {
    contract: SectionGenerationContract;
    hint?: SectionGenerationHint;
    /**
     * Phase 4.5 — Execution strategy directives (compact retry, emergency
     * reduction, minimal recovery). Generated by the orchestrator from the
     * section's retry + timeout history. When omitted, the generator picks
     * NORMAL.
     */
    executionDirectives?: import('./sectionExecutionStrategy').SectionExecutionDirectives;
    /**
     * Phase 7.2 — Per-article fragment cache. When supplied, the generator
     * uses it to skip identity-lock + anti-generic + assignment rendering
     * for sections in the same article. Optional — generators without a
     * cache fall back to per-section rendering.
     */
    fragmentCache?: import('./runtimeEfficiencyOptimizer').GenerationFragmentCache;
  }): Promise<{
    html: string;
    /** Strategy actually used — surfaced for diagnostics. */
    executionStrategy?: import('./sectionExecutionStrategy').SectionExecutionStrategy;
    /**
     * Phase 7.6 — Compression event captured during this generation
     * (when compression ran). Orchestrator collects these to populate
     * operationalExplainability.compressionReasoning.
     */
    compressionEvent?: import('./promptCompressionEngine').CompressionEvent;
  }>;
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

const MAX_RECOVERY_ATTEMPTS_DEFAULT = 2;

export interface OrchestratorSectionOutcome {
  contract: SectionGenerationContract;
  finalHtml: string;
  attempts: number;
  finalContinuity: SectionContinuityResult;
  finalGenericity: ReturnType<typeof suppressGenericWriting>;
  finalFactual: SectionFactualSnapshot;
  passed: boolean;
  /** Phase 3.1 — final company-alignment gate result (null if no companyIdentity). */
  finalAlignment?: SectionCompanyAlignmentResult | null;
}

export interface OrchestratorResult {
  assembledArticle: {
    title: string;
    excerpt: string;
    html: string;
    sections: Array<{ title: string; html: string; passed: boolean }>;
  };
  sectionOutcomes: OrchestratorSectionOutcome[];
  recoveryHistory: SectionRecoveryHistoryEntry[];
  /** Phase 3.5 — article-level strategic-assignment consumption report. */
  strategicAssignmentConsumption?: StrategicAssignmentConsumptionResult;

  // ── Phase 4 additions ─────────────────────────────────────────────────
  /** Phase 4.2 — Section lifecycle history (state transitions per section). */
  sectionLifecycleHistory?: SectionLifecycleHistoryEntry[];
  /** Phase 4.4 — Per-section grounded-claim validation snapshots. */
  groundedClaimResults?: Array<{ sectionIndex: number; result: GroundedClaimValidationResult }>;
  /** Phase 4.6 — Global recovery plan emitted after the section loop. */
  recoveryPlan?: PlannedRecoveryPlan;
  /** Phase 4.1 — Adaptive recovery budget computed for this article. */
  recoveryBudget?: AdaptiveRecoveryBudget;
  /** Phase 4.8 — UI-facing per-section diagnostics payload. */
  section_diagnostics?: Array<{
    section_id: number;
    section_title: string;
    lifecycle_state: SectionLifecycleState;
    retries: number;
    governance_scores: Record<string, number | undefined>;
    repetition_flags: string[];
    assignment_consumption: { totalAssignments: number; consumedAssignments: number; consumptionRatio: number } | null;
    grounding_coverage: { evidenceCoverage: number; hallucinationRisk: number; fabricatedSpecificityRisk: number } | null;
    timeout_events: number;
    recovery_actions: string[];
    final_acceptance_reason?: string;
    final_abandonment_reason?: string;
  }>;

  // ── Phase 5 additions ──────────────────────────────────────────────────
  /** Phase 5.2 — Article-level semantic grounding result (when groundingProfile supplied). */
  semanticGrounding?: AggregateSemanticGroundingResult;
  /** Phase 5.5 — Final article convergence verdict. */
  articleConvergence?: ArticleConvergenceResult;
  /** Phase 5.7 — Quality benchmark snapshot captured for this run. */
  qualityBenchmark?: LongFormQualityBenchmark;
  /** Phase 5.8 — Recovery cost report (token-domain). */
  recoveryCost?: RecoveryCostReport;
  /** Phase 6.8 — Human-readable operational explanation for admins/support. */
  operationalExplanation?: OperationalExplanation;
  /** Phase 7.2 — Per-article fragment cache metrics. */
  promptFragmentReuseReport?: {
    reusedFragments: number;
    avoidedRecomputations: number;
    savedPromptTokens: number;
    savedLatencyMs: number;
    cacheHitRate: number;
  };
  /** Phase 7.1 — Canonical recovery execution snapshot at article end. */
  recoveryExecutionSnapshot?: import('./unifiedRecoveryGraph').RecoveryExecutionSnapshot;
  /** Phase 5.9 — Grounding visualization payload (editorial UI). */
  grounding_visualization?: {
    sectionCoverage: Array<{
      section_id: number;
      section_title: string;
      groundingStrength: number;
      groundedClaimCount: number;
      unsupportedClaimCount: number;
    }>;
    unsupportedClaims: Array<{ section_id: number; claimId: string; text: string }>;
    groundedClaims: Array<{ section_id: number; claimId: string; text: string; sourceIds: string[]; matchScore: number }>;
    evidenceDensity: number;            // 0..100
    contradictionWarnings: Array<{ section_id: number; text: string; reason: 'numeric_divergence' | 'polarity_conflict' }>;
  };
  integrity: PostGenerationIntegrityResult;
  factualIntegrity: PostGenerationFactualResult;
  factualRecoveryActionsApplied: FactualRecoveryStep[];
  factualExplanation: FactualIntegrityExplanation;
  /** Per-claim traceability across the whole article (empty when no grounding profile was supplied). */
  claimTraceability: ClaimTraceability[];
  citationResult: CitationOrchestrationResult;
  sourceConflicts: SourceConflictResult;
  sourceIntegrity: PostGenerationSourceIntegrityResult;
  groundedRecoveryPlan: GroundedRecoveryPlan;
  groundedExplanation: GroundedIntegrityExplanation;
  diagnostics: GenerationExecutionDiagnostics;
  explanation: GenerationIntegrityExplanation;
  finalLifecycleState: Extract<RecommendationLifecycleState,
    'article_completed' | 'article_recovered' | 'article_failed'>;
}

export interface OrchestratorInput {
  generationContract: GenerationOrchestrationContract;
  recommendation: LongFormRecommendation;
  planningInput: PlanningInputPartial;
  contentPlan: ContentPlan;
  sectionGenerator: SectionGenerator;
  maxRecoveryAttemptsPerSection?: number;
  /**
   * Optional retrieval grounding profile. When supplied, claim ↔ source
   * traceability, citation orchestration, source-conflict analysis, and
   * grounded recovery all run. When omitted, those layers return permissive
   * neutral results (all claims marked orphan with `no_grounding_profile`).
   */
  groundingProfile?: RetrievalGroundingProfile;
  /**
   * Phase 3.2 — Canonical CompanyIdentity. When provided, the section
   * generator prepends `buildIdentityLock` + `buildAntiGenericRules` and
   * the orchestrator runs the per-section company-alignment gate.
   */
  companyIdentity?: CompanyIdentity | null;
  /**
   * Phase 3.5 — Per-section strategic assignments (from Phase 2.7
   * `buildSectionStrategicAssignments`). Surfaces in section prompts and
   * is validated post-generation via
   * `validateStrategicAssignmentConsumption`.
   */
  strategicAssignments?: SectionStrategicAssignment[];
  /** Optional company id propagated to telemetry events. */
  companyId?: string | null;
  /** Optional content type label propagated to telemetry events. */
  contentType?: string;
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function summarizeForCrossSection(title: string, html: string): { title: string; summary: string } {
  return { title, summary: stripHtml(html).slice(0, 220) };
}

function sensitivityFactorFor(evidence: EvidenceRequirements): number {
  switch (evidence.claimSensitivityProfile) {
    case 'low_sensitivity': return 0.7;
    case 'high_sensitivity': return 1.25;
    default: return 1.0;
  }
}

/**
 * Run the full per-section factual governance pipeline.
 * Pure function; no LLM calls.
 */
function runSectionFactualPass(contract: SectionGenerationContract, html: string): SectionFactualSnapshot {
  const claims: ExtractedClaim[] = extractClaims({ sourceSectionId: contract.sectionContractId, sectionText: html });
  const profiles: ClaimEvidenceProfile[] = classifyClaimEvidence({ claims, contract });
  const hallucination: HallucinationSuppressionResult = suppressHallucinations({
    sectionText: html,
    sensitivityFactor: sensitivityFactorFor(contract.evidenceRequirements),
  });
  const authority: AuthorityInflationResult = detectAuthorityInflation({ sectionText: html });
  const operational: OperationalProofValidationResult = validateOperationalProof({
    sectionText: html,
    contract,
    claims,
  });
  const speculative: SpeculativeLanguageResult = enforceSpeculativeLanguage({
    claims,
    profiles,
    policy: contract.evidenceRequirements.speculativeLanguagePolicy,
  });
  const trust: TrustCalibrationResult = calibrateTrust({
    sectionText: html,
    claims,
    profiles,
    hallucination,
    authority,
    operational,
  });
  return {
    sourceSectionId: contract.sectionContractId,
    claims,
    profiles,
    hallucination,
    authority,
    operational,
    speculative,
    trust,
  };
}

/**
 * Compose a section-level pass decision incorporating BOTH continuity/generic
 * governance AND factual governance.
 */
function sectionFactuallyPasses(snapshot: SectionFactualSnapshot): boolean {
  if (snapshot.hallucination.hardBlocked) return false;
  if (snapshot.hallucination.hallucinationDetections.some((d) => d.severity === 'critical')) return false;
  if (snapshot.operational.realismScore < 50) return false;
  if (snapshot.authority.authorityInflationScore > 55) return false;
  return true;
}

/**
 * Translate a FactualRecoveryAction → SectionRecoveryAction for the hint
 * mechanism. The synthetic section generator handles the hint via its
 * `recoveryAction` + `recoveryTargets` strings.
 */
function factualToSectionAction(action: FactualRecoveryAction): SectionRecoveryAction {
  switch (action) {
    case 'soften_certainty': return 'restore_strategic_narrative';
    case 'reduce_authority_inflation': return 'restore_strategic_narrative';
    case 'convert_to_inference_framing': return 'restore_strategic_narrative';
    case 'restore_operational_realism': return 'restore_operational_proof';
    case 'remove_fabricated_statistic': return 'regenerate_section';
    case 'remove_fake_benchmark': return 'regenerate_section';
    case 'rewrite_unsupported_claim': return 'regenerate_section';
  }
}

export async function runLongFormGenerationOrchestrator(input: OrchestratorInput): Promise<OrchestratorResult> {
  const maxAttempts = input.maxRecoveryAttemptsPerSection ?? MAX_RECOVERY_ATTEMPTS_DEFAULT;
  const sectionOutcomes: OrchestratorSectionOutcome[] = [];
  const recoveryHistory: SectionRecoveryHistoryEntry[] = [];
  const priorSummaries: Array<{ title: string; summary: string }> = [];

  // ── Phase 4.2 — Section lifecycle manager ────────────────────────────
  const lifecycle = new SectionLifecycleManager();

  // ── Phase 7.1 — Canonical recovery graph (single source of truth) ────
  // Every section_started/generated/validating/passed/failed/retrying/
  // abandoned event MUST be dispatched through this. Per-section
  // decisions (retry / soften / abandon) call `graph.executeRecoveryCycle`
  // so the orchestrator and planner share one execution owner.
  const recoveryGraph = new UnifiedRecoveryGraph({
    contentType: input.contentType ?? 'unknown',
    totalSections: input.contentPlan.sections.length,
  });

  // ── Phase 7.2 — Per-article fragment cache.
  // Identity-lock + anti-generic blocks rendered once per article; reused
  // across all sections AND retries.
  const articleId = input.generationContract?.generationContractId ?? `article_${Date.now().toString(36)}`;
  const fragmentCache = getOrCreateArticleCache(articleId);

  // ── Phase 7.6 — Compression events collected across all section
  // generations; passed to operationalExplainability at the end.
  const compressionEvents: Array<{
    sectionIndex: number;
    mode: string;
    finalTokens: number;
    originalTokens: number;
    droppedSegmentLabels: string[];
  }> = [];
  function recordCompressionEvent(ev: CompressionEvent | undefined): void {
    if (!ev || ev.sectionIndex == null) return;
    compressionEvents.push({
      sectionIndex: ev.sectionIndex,
      mode: ev.mode,
      finalTokens: ev.finalTokens,
      originalTokens: ev.originalTokens,
      droppedSegmentLabels: ev.droppedSegmentLabels,
    });
  }

  // ── Phase 4.4 — Per-section grounded-claim results (carried into diagnostics). ─
  const groundedClaimResults: Array<{ sectionIndex: number; result: GroundedClaimValidationResult }> = [];

  // ── Phase 4.5 — Per-section timeout counters. Drives the execution
  //    strategy choice on retries. NOTE: graph.getTimeoutCount(i) is now
  //    canonical; this local map is a per-attempt scratchpad kept in
  //    sync with the graph via the executeRecoveryCycle path.
  const sectionTimeoutCounts = new Map<number, number>();

  // ── Phase 4.6 — Failure summaries for the recovery coordinator. ──────
  const sectionFailureSummaries: SectionFailureSummary[] = [];

  // Track orchestrator start so we can pass elapsed time to the
  // adaptive-recovery-budget computation later.
  const orchestratorStartMs = Date.now();

  // Phase 7.3 — Running totals used to thread cost-aware inputs into
  // graph.executeRecoveryCycle.
  let cumulativeTokensBurned = 0;
  const tokenBudgetCeiling = Math.max(20_000, sectionOutcomes.length * 5000) + 30_000;
  let firstAttemptTokenSpend = 0;

  for (let sectionIndex = 0; sectionIndex < input.contentPlan.sections.length; sectionIndex += 1) {
    let attempt = 1;
    let currentHtml = '';
    let currentContinuity: SectionContinuityResult | null = null;
    let currentGenericity: ReturnType<typeof suppressGenericWriting> | null = null;
    let currentGroundedClaim: GroundedClaimValidationResult | null = null;
    let sectionTimeoutFlag = false;

    // Phase 4.2 — Start section lifecycle tracking.
    const planSectionTitle = input.contentPlan.sections[sectionIndex]?.section_title ?? `Section ${sectionIndex + 1}`;
    lifecycle.startSection(sectionIndex, planSectionTitle);

    // Phase 3.5 — Look up this section's strategic assignment (if any).
    const strategicAssignmentForSection = input.strategicAssignments?.find(
      (a) => a.section_id === sectionIndex + 1 || a.section_id === sectionIndex,
    ) ?? null;

    let currentContract = buildSectionGenerationContract({
      generationContract: input.generationContract,
      recommendation: input.recommendation,
      planningInput: input.planningInput,
      contentPlan: input.contentPlan,
      sectionIndex,
      priorSectionSummaries: priorSummaries,
      attemptNumber: attempt,
      // Phase 3.2 + 3.5 — propagate canonical identity + per-section assignment.
      companyIdentity: input.companyIdentity ?? null,
      strategicAssignment: strategicAssignmentForSection,
    });

    let hint: SectionGenerationHint | undefined = undefined;

    let currentFactual: SectionFactualSnapshot | null = null;
    let currentAlignment: SectionCompanyAlignmentResult | null = null;

    while (attempt <= maxAttempts + 1) {
      const beforeScores = currentContinuity && currentGenericity ? {
        continuity: currentContinuity.sectionContinuityScore,
        strategic: currentContinuity.sectionStrategicIntegrityScore,
        operational: currentContinuity.sectionOperationalIntegrityScore,
        genericity: currentGenericity.genericityPressureScore,
      } : { continuity: 0, strategic: 0, operational: 0, genericity: 0 };

      // Phase 4.5 — Choose execution strategy for this attempt based on
      // accumulated timeout history.
      const directives = chooseSectionExecutionStrategy({
        contract: currentContract,
        attempt,
        timeoutFailureCount: sectionTimeoutCounts.get(sectionIndex) ?? 0,
        previousAttemptTimedOut: sectionTimeoutFlag,
        sectionElapsedMs: Date.now() - orchestratorStartMs,
      });

      try {
        const generationOutput = await input.sectionGenerator.generate({
          contract: currentContract,
          hint,
          executionDirectives: directives,
          // Phase 7.2 — Pass the per-article fragment cache so identity +
          // anti-generic + compressed-prompt fragments are reused across
          // sections AND retries.
          fragmentCache,
        });
        currentHtml = generationOutput.html;
        sectionTimeoutFlag = false;
        // Phase 7.6 — Collect compression event for explainability.
        recordCompressionEvent(generationOutput.compressionEvent);
        // Phase 7.3 — Track token spend for cost-aware overlay.
        const attemptTokenSpend = (directives.maxTokens ?? 0) + Math.ceil((currentContract.wordTarget ?? 0) * 3);
        cumulativeTokensBurned += attemptTokenSpend;
        if (attempt === 1 && firstAttemptTokenSpend === 0) {
          firstAttemptTokenSpend = attemptTokenSpend;
        }
        // Phase 4.2 — PLANNED → GENERATED → VALIDATING
        if (attempt === 1) {
          lifecycle.transition(sectionIndex, SectionLifecycleState.GENERATED, {
            attempt,
            reason: 'first-attempt generation completed',
          });
        }
        lifecycle.transition(sectionIndex, SectionLifecycleState.VALIDATING, {
          attempt,
          reason: 'entering validation pass',
        });
      } catch (genErr) {
        // Phase 4.5 — Timeout-aware failure handling.
        const message = genErr instanceof Error ? genErr.message : String(genErr);
        const isTimeout = /timeout|timed out|abort|deadline/i.test(message);
        if (isTimeout) {
          sectionTimeoutCounts.set(sectionIndex, (sectionTimeoutCounts.get(sectionIndex) ?? 0) + 1);
          sectionTimeoutFlag = true;
          lifecycle.transition(sectionIndex, SectionLifecycleState.FAILED_TIMEOUT, {
            attempt,
            reason: `generation timeout (${message})`,
            failureCategory: 'timeout',
          });
        } else {
          // Non-timeout generator error — treat like a continuity failure
          // so we exit the loop with diagnostic context rather than
          // crashing.
          lifecycle.transition(sectionIndex, SectionLifecycleState.FAILED_CONTINUITY, {
            attempt,
            reason: `generator error: ${message}`,
            failureCategory: 'unknown',
          });
        }
        // Skip validation for this attempt — the empty `currentHtml`
        // would cascade-fail every gate. Continue to retry logic with a
        // synthetic failure verdict.
        currentHtml = currentHtml || '';
      }

      currentContinuity = governSectionContinuity({ contract: currentContract, sectionText: currentHtml });
      currentGenericity = suppressGenericWriting({
        sectionText: currentHtml,
        genericityCeiling: currentContract.continuityThresholds.genericityCeiling,
      });
      currentFactual = runSectionFactualPass(currentContract, currentHtml);

      // Phase 3.1 — Per-section company alignment gate.
      // Runs only when canonical companyIdentity is present; legacy callers
      // without identity get a neutral pass.
      currentAlignment = input.companyIdentity
        ? validateSectionCompanyAlignment({
            sectionText: currentHtml,
            contract: currentContract,
            companyIdentity: input.companyIdentity,
          })
        : null;

      // Phase 4.4 — Grounded claim validation. Runs WITH the grounding
      // profile when supplied; without one, only fabrication-pattern
      // detection is active.
      currentGroundedClaim = validateGroundedClaims({
        sectionText: currentHtml,
        sectionContractId: currentContract.sectionContractId,
        claims: currentFactual.claims,
        groundingProfile: input.groundingProfile ?? null,
      });

      const continuityGenericPasses = sectionPassesGovernance(currentContinuity, currentGenericity, currentContract.continuityThresholds);
      const factualPasses = sectionFactuallyPasses(currentFactual);
      const alignmentPasses = !currentAlignment || currentAlignment.verdict === 'pass';
      const groundedPasses = currentGroundedClaim.verdict === 'pass' || currentGroundedClaim.verdict === 'soften';
      const passes = continuityGenericPasses && factualPasses && alignmentPasses && groundedPasses;

      // Phase 3.7 — Emit LONGFORM_SECTION_GOVERNANCE per attempt.
      const failureReasons: LongFormGovernanceFailureReason[] = [];
      if (!continuityGenericPasses) {
        if (currentGenericity && currentGenericity.genericityPressureScore > currentContract.continuityThresholds.genericityCeiling) {
          failureReasons.push('genericity');
        } else {
          failureReasons.push('continuity');
        }
      }
      if (!factualPasses) failureReasons.push('factual');
      if (!alignmentPasses) failureReasons.push('company_alignment');
      if (!groundedPasses) failureReasons.push('factual'); // grounded-claim failures map to factual cluster

      // Phase 4.2 — Record lifecycle outcome for this attempt.
      if (passes) {
        lifecycle.transition(sectionIndex, SectionLifecycleState.ACCEPTED, {
          attempt,
          reason: attempt === 1 ? 'first-pass clean' : 'recovered after retry',
          scoreSnapshot: {
            continuity: currentContinuity.sectionContinuityScore,
            strategic_integrity: currentContinuity.sectionStrategicIntegrityScore,
            operational_integrity: currentContinuity.sectionOperationalIntegrityScore,
            genericity_pressure: currentGenericity.genericityPressureScore,
            alignment: currentAlignment?.alignmentScore,
            grounded_evidence_coverage: currentGroundedClaim.evidenceCoverage,
            hallucination_risk: currentGroundedClaim.hallucinationRisk,
          },
        });
      } else {
        const lifecycleFailState = classifyFailureToLifecycleState(failureReasons);
        if (lifecycleFailState) {
          lifecycle.transition(sectionIndex, lifecycleFailState, {
            attempt,
            reason: `governance failed: ${failureReasons.join(', ')}`,
            failureCategory: failureReasons.includes('company_alignment') ? 'alignment'
              : failureReasons.includes('factual') ? 'factual'
              : failureReasons.includes('genericity') ? 'genericity'
              : 'continuity',
            scoreSnapshot: {
              continuity: currentContinuity.sectionContinuityScore,
              strategic_integrity: currentContinuity.sectionStrategicIntegrityScore,
              operational_integrity: currentContinuity.sectionOperationalIntegrityScore,
              genericity_pressure: currentGenericity.genericityPressureScore,
              alignment: currentAlignment?.alignmentScore,
              grounded_evidence_coverage: currentGroundedClaim.evidenceCoverage,
              hallucination_risk: currentGroundedClaim.hallucinationRisk,
            },
          });
        }
      }

      emitSectionGovernance({
        company_id: input.companyId ?? null,
        content_type: input.contentType ?? currentContract.contentType,
        section_index: sectionIndex,
        section_title: currentContract.sectionTitle,
        attempt_number: attempt,
        passes,
        failure_reasons: failureReasons,
        scores: {
          continuity: currentContinuity.sectionContinuityScore,
          strategic_integrity: currentContinuity.sectionStrategicIntegrityScore,
          operational_integrity: currentContinuity.sectionOperationalIntegrityScore,
          genericity_pressure: currentGenericity.genericityPressureScore,
          alignment: currentAlignment?.alignmentScore,
          differentiation_strength: currentAlignment?.differentiationStrength,
          strategic_presence: currentAlignment?.strategicPresence,
          factual_authority_inflation: currentFactual.authority.authorityInflationScore,
          factual_operational_realism: currentFactual.operational.realismScore,
        },
      });

      if (attempt > 1) {
        // Record recovery attempt outcome.
        const afterScores = {
          continuity: currentContinuity.sectionContinuityScore,
          strategic: currentContinuity.sectionStrategicIntegrityScore,
          operational: currentContinuity.sectionOperationalIntegrityScore,
          genericity: currentGenericity.genericityPressureScore,
        };
        const improved =
          afterScores.continuity > beforeScores.continuity
          || afterScores.strategic > beforeScores.strategic
          || afterScores.operational > beforeScores.operational
          || afterScores.genericity < beforeScores.genericity;
        recoveryHistory.push({
          sectionIndex,
          sectionContractId: currentContract.sectionContractId,
          attemptNumber: attempt,
          action: hint?.recoveryAction ?? 'regenerate_section',
          beforeScores,
          afterScores,
          improved,
          timestamp: new Date().toISOString(),
        });
      }

      if (passes) break;
      if (attempt > maxAttempts) {
        // Phase 4.2 — Lifecycle: budget exhausted on this section.
        lifecycle.abandon(sectionIndex, attempt, 'retry_budget_exhausted',
          `section retry budget exhausted after ${attempt} attempts`);
        break;
      }

      // Build combined recovery plan: section recovery first, then factual on top.
      const sectionRecovery = continuityGenericPasses
        ? { steps: [] as ReturnType<typeof buildSectionRecoveryPlan>['steps'], estimatedCost: 'low' as const }
        : buildSectionRecoveryPlan({ continuity: currentContinuity, generic: currentGenericity });

      // Prefer section recovery when the section is structurally weak;
      // otherwise drive next attempt from the factual recovery plan.
      const factualRecovery = factualPasses
        ? null
        : buildFactualRecoveryPlan({
            claims: currentFactual.claims,
            profiles: currentFactual.profiles,
            hallucination: currentFactual.hallucination,
            speculative: currentFactual.speculative,
            authority: currentFactual.authority,
            operational: currentFactual.operational,
          });

      let nextAction: SectionRecoveryAction | undefined;
      let nextTargets: string[] = [];
      let drivingFailure: LongFormGovernanceFailureReason = 'unknown';
      if (sectionRecovery.steps.length > 0) {
        nextAction = sectionRecovery.steps[0].action;
        nextTargets = sectionRecovery.steps[0].targets;
        drivingFailure = continuityGenericPasses ? 'genericity' : 'continuity';
      } else if (factualRecovery && factualRecovery.steps.length > 0) {
        nextAction = factualToSectionAction(factualRecovery.steps[0].action);
        nextTargets = [
          `FACTUAL:${factualRecovery.steps[0].action}`,
          ...factualRecovery.steps[0].targets,
        ];
        drivingFailure = 'factual';
      } else if (currentAlignment && currentAlignment.verdict !== 'pass' && currentAlignment.suggestedRecoveryAction) {
        // Phase 3.1 — Alignment-driven recovery. If continuity/generic/factual
        // all passed but alignment failed, drive the next attempt from the
        // alignment validator's suggestion.
        nextAction = currentAlignment.suggestedRecoveryAction;
        nextTargets = buildAlignmentRecoveryTargets(currentAlignment, input.companyIdentity);
        drivingFailure = 'company_alignment';
      }

      // ── Phase 7.1 + 7.3 — Canonical retry decision via the unified graph.
      //
      // The graph mirrors the local nextAction decision and overlays the
      // cost-aware policy when convergence + budget data are available.
      // We dispatch failure + retry transitions through the graph so it
      // owns canonical lifecycle state.
      recoveryGraph.dispatch({
        kind: 'section_started',
        sectionIndex,
        sectionTitle: currentContract.sectionTitle,
      });
      const articleDecisionForGraph = recoveryGraph.computeArticleDecision({
        issueCategoriesObserved: failureReasons,
        sectionFailureSummaries: sectionFailureSummaries.length > 0 ? sectionFailureSummaries : [
          // Provide a synthetic summary for the current failed section so
          // the coordinator has data to work with on the first failure of
          // this article.
          ...(failureReasons.length > 0
            ? [buildFailureSummary({
                graph: recoveryGraph,
                sectionIndex,
                failureCategories: failureReasons,
                attempts: attempt,
                recentRetryImproved: false,
              })].filter((s): s is SectionFailureSummary => s !== null)
            : []),
        ],
        failedSectionCount: sectionFailureSummaries.length + (failureReasons.length > 0 ? 1 : 0),
        severity: failureReasons.length >= 3 ? 'severe' : failureReasons.length >= 1 ? 'moderate' : 'low',
      });
      const retryAmplification = firstAttemptTokenSpend > 0
        ? Number((cumulativeTokensBurned / firstAttemptTokenSpend).toFixed(3))
        : 1;
      const proposedStepTokens = (directives.maxTokens ?? 0) + Math.ceil((currentContract.wordTarget ?? 0) * 3);
      recoveryGraph.executeRecoveryCycle({
        sectionIndex,
        sectionTitle: currentContract.sectionTitle,
        attempt,
        failureCategories: failureReasons,
        timeoutOccurred: sectionTimeoutFlag,
        // Phase 7.3 — Full cost-aware inputs threaded.
        sectionValue: 0.5 + (sectionIndex === 0 || sectionIndex === input.contentPlan.sections.length - 1 ? 0.25 : 0),
        tokensBurnedSoFar: cumulativeTokensBurned,
        tokenBudgetCeiling,
        retryAmplificationFactor: retryAmplification,
        proposedStepTokens,
        articleDecision: articleDecisionForGraph,
      });

      if (!nextAction) break;

      // Phase 3.7 — Emit LONGFORM_SECTION_RETRY for each retry trigger.
      const beforeRetryScore = currentContinuity?.sectionContinuityScore ?? 0;
      const afterRetryWillBeImproved = beforeRetryScore > 0; // we'll know after the next attempt
      emitSectionRetry({
        company_id: input.companyId ?? null,
        content_type: input.contentType ?? currentContract.contentType,
        section_index: sectionIndex,
        attempt_number: attempt + 1,
        recovery_action: nextAction,
        driving_failure: drivingFailure,
        improved_from_previous: afterRetryWillBeImproved,
      });

      hint = {
        recoveryAction: nextAction,
        recoveryTargets: nextTargets,
        previousAttemptHtml: currentHtml,
        attemptNumber: attempt + 1,
      };
      // Phase 4.2 — Lifecycle: enter RETRYING before bumping attempt.
      lifecycle.transition(sectionIndex, SectionLifecycleState.RETRYING, {
        attempt: attempt + 1,
        reason: `retry with action: ${nextAction}`,
        recoveryAction: nextAction,
      });
      attempt += 1;
      currentContract = buildSectionGenerationContract({
        generationContract: input.generationContract,
        recommendation: input.recommendation,
        planningInput: input.planningInput,
        contentPlan: input.contentPlan,
        sectionIndex,
        priorSectionSummaries: priorSummaries,
        attemptNumber: attempt,
        // Phase 3.2 + 3.5 — identity + assignment travel with every retry.
        companyIdentity: input.companyIdentity ?? null,
        strategicAssignment: strategicAssignmentForSection,
      });
    }

    // currentContinuity / currentGenericity / currentFactual are non-null after at least one iteration.
    const finalContinuityGenericPasses = sectionPassesGovernance(
      currentContinuity!,
      currentGenericity!,
      currentContract.continuityThresholds,
    );
    const finalFactualPasses = currentFactual ? sectionFactuallyPasses(currentFactual) : false;
    const finalPassed = finalContinuityGenericPasses && finalFactualPasses;

    sectionOutcomes.push({
      contract: currentContract,
      finalHtml: currentHtml,
      attempts: attempt,
      finalContinuity: currentContinuity!,
      finalGenericity: currentGenericity!,
      finalFactual: currentFactual!,
      passed: finalPassed,
      finalAlignment: currentAlignment,
    });
    priorSummaries.push(summarizeForCrossSection(currentContract.sectionTitle, currentHtml));

    // Phase 4.4 — Capture grounded-claim result for this section.
    if (currentGroundedClaim) {
      groundedClaimResults.push({ sectionIndex, result: currentGroundedClaim });
    }

    // Phase 4.2 — Finalize lifecycle. If the section currently sits in a
    // FAILED_* state, we accept it best-effort (the article will ship with
    // warnings); the abandon path was already taken when budget exhausted.
    const lifeEntry = lifecycle.getSection(sectionIndex);
    if (lifeEntry
        && lifeEntry.finalState !== SectionLifecycleState.ACCEPTED
        && lifeEntry.finalState !== SectionLifecycleState.ABANDONED) {
      if (finalPassed) {
        lifecycle.accept(sectionIndex, attempt, attempt === 1 ? 'first_pass_clean' : 'recovered_after_retry');
      } else {
        lifecycle.accept(sectionIndex, attempt, 'shipped_despite_warnings');
      }
    }

    // Phase 4.6 — Build a section failure summary for the recovery
    // coordinator. Only failed sections get summarized.
    if (!finalPassed && lifeEntry) {
      const failureCategories: LongFormGovernanceFailureReason[] = [];
      if (currentContinuity && (
        currentContinuity.sectionContinuityScore < currentContract.continuityThresholds.sectionContinuityFloor
        || currentContinuity.sectionStrategicIntegrityScore < currentContract.continuityThresholds.strategicIntegrityFloor
        || currentContinuity.sectionOperationalIntegrityScore < currentContract.continuityThresholds.operationalIntegrityFloor
      )) failureCategories.push('continuity');
      if (currentGenericity && currentGenericity.genericityPressureScore > currentContract.continuityThresholds.genericityCeiling) {
        failureCategories.push('genericity');
      }
      if (currentFactual && !sectionFactuallyPasses(currentFactual)) failureCategories.push('factual');
      if (currentAlignment && currentAlignment.verdict !== 'pass') failureCategories.push('company_alignment');
      if (currentGroundedClaim && currentGroundedClaim.verdict !== 'pass' && currentGroundedClaim.verdict !== 'soften') {
        failureCategories.push('factual');
      }
      const timeoutCount = sectionTimeoutCounts.get(sectionIndex) ?? 0;
      if (timeoutCount > 0) failureCategories.push('timeout');

      const recentRetryEntry = recoveryHistory.findLast((h) => h.sectionIndex === sectionIndex);
      sectionFailureSummaries.push(summarizeSectionFailure({
        lifecycle: lifeEntry,
        failureCategories,
        attempts: attempt,
        recentRetryImproved: recentRetryEntry?.improved ?? false,
        timeoutCount,
      }));
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // Assemble article + post-generation integrity validation.
  // ────────────────────────────────────────────────────────────────────
  const html = sectionOutcomes.map((s) => s.finalHtml).join('\n\n');
  const assembledArticle = {
    title: input.contentPlan.title,
    excerpt: input.contentPlan.excerpt,
    html,
    sections: sectionOutcomes.map((s) => ({
      title: s.contract.sectionTitle,
      html: s.finalHtml,
      passed: s.passed,
    })),
  };

  const sectionContinuityResults = sectionOutcomes.map((s) => s.finalContinuity);
  const sectionGenericityScores = sectionOutcomes.map((s) => s.finalGenericity.genericityPressureScore);
  const sectionsFailed = sectionOutcomes.filter((s) => !s.passed).length;

  const integrity = validatePostGenerationIntegrity({
    generationContract: input.generationContract,
    recommendation: input.recommendation,
    assembledArticle: html,
    sectionContinuityResults,
    sectionGenericityScores,
  });

  // Phase 3.5 — Strategic-assignment consumption (post-generation report).
  const strategicAssignmentConsumption: StrategicAssignmentConsumptionResult | undefined =
    input.strategicAssignments && input.strategicAssignments.length > 0
      ? validateStrategicAssignmentConsumption({
          sections: sectionOutcomes.map((s, idx) => ({ index: idx, html: s.finalHtml })),
          assignments: input.strategicAssignments,
        })
      : undefined;

  // ── Factual integrity (Phase 9) ──────────────────────────────────────
  const factualSnapshots = sectionOutcomes.map((s) => s.finalFactual);
  const factualIntegrity = validatePostGenerationFactualIntegrity({
    sectionSnapshots: factualSnapshots,
  });

  // Build the article-level factual recovery plan from the aggregated
  // claims / hallucination / authority / operational / speculative state.
  const aggregateFactualRecovery = (() => {
    const allClaims = factualSnapshots.flatMap((s) => s.claims);
    const allProfiles = factualSnapshots.flatMap((s) => s.profiles);
    // Combine hallucination detections across sections into a synthesized
    // result whose hardBlocked flag reflects ANY section blocking.
    const combinedHallucination = {
      hallucinationDetections: factualSnapshots.flatMap((s) => s.hallucination.hallucinationDetections),
      hallucinationSeverity: factualSnapshots.some((s) => s.hallucination.hallucinationSeverity === 'critical')
        ? 'critical' as const
        : factualSnapshots.some((s) => s.hallucination.hallucinationSeverity === 'high')
          ? 'high' as const
          : 'medium' as const,
      hallucinationPressureScore: Math.round(
        factualSnapshots.reduce((sum, s) => sum + s.hallucination.hallucinationPressureScore, 0)
        / Math.max(factualSnapshots.length, 1),
      ),
      hardBlocked: factualSnapshots.some((s) => s.hallucination.hardBlocked),
    };
    const combinedSpeculative = {
      overconfidentClaims: factualSnapshots.flatMap((s) => s.speculative.overconfidentClaims),
      speculativeComplianceScore: Math.round(
        factualSnapshots.reduce((sum, s) => sum + s.speculative.speculativeComplianceScore, 0)
        / Math.max(factualSnapshots.length, 1),
      ),
      policyApplied: factualSnapshots[0]?.speculative.policyApplied ?? 'balanced' as const,
    };
    const combinedAuthority = {
      authorityInflationScore: Math.round(
        factualSnapshots.reduce((sum, s) => sum + s.authority.authorityInflationScore, 0)
        / Math.max(factualSnapshots.length, 1),
      ),
      detections: factualSnapshots.flatMap((s) => s.authority.detections),
    };
    const combinedOperational = {
      realismScore: Math.round(
        factualSnapshots.reduce((sum, s) => sum + s.operational.realismScore, 0)
        / Math.max(factualSnapshots.length, 1),
      ),
      issues: factualSnapshots.flatMap((s) => s.operational.issues),
    };
    return buildFactualRecoveryPlan({
      claims: allClaims,
      profiles: allProfiles,
      hallucination: combinedHallucination,
      speculative: combinedSpeculative,
      authority: combinedAuthority,
      operational: combinedOperational,
    });
  })();

  // Count how many recovery hints were actually issued under each factual category.
  const softenedClaimsCount = recoveryHistory.filter(
    (h) => h.action === 'restore_strategic_narrative' || h.action === 'restore_sequencing_continuity',
  ).length;
  const removedFabricationsCount = recoveryHistory.filter(
    (h) => h.action === 'regenerate_section',
  ).length;

  const factualExplanation = composeFactualIntegrityExplanation({
    factual: factualIntegrity,
    recoveryActionsApplied: aggregateFactualRecovery.steps,
    softenedClaimsCount,
    removedFabricationsCount,
  });
  // ──────────────────────────────────────────────────────────────────────

  // ── Grounded knowledge / source integrity (Phase 4, 5, 6, 8, 9, 10) ──
  const allClaims = factualSnapshots.flatMap((s) => s.claims);
  const claimTraceability = traceClaimsToSources({
    claims: allClaims,
    profile: input.groundingProfile ?? null,
  });
  const citationResult: CitationOrchestrationResult = input.groundingProfile
    ? orchestrateCitations({
        claims: allClaims,
        traceability: claimTraceability,
        profile: input.groundingProfile,
      })
    : { citationPlan: [], dedupedSourceCount: 0, rejectedFakeCitations: 0, weakSourceOveruseWarnings: [] };
  const sourceConflicts: SourceConflictResult = input.groundingProfile
    ? analyzeSourceConflicts({ profile: input.groundingProfile })
    : { conflicts: [], sourceConflictSeverity: 'none', conflictResolutionRecommendations: [] };
  const sourceIntegrity = validatePostGenerationSourceIntegrity({
    claims: allClaims,
    traceability: claimTraceability,
    citationResult,
    conflicts: sourceConflicts,
    approvedSources: input.groundingProfile?.approvedSources ?? [],
  });
  const groundedRecoveryPlan = input.groundingProfile
    ? buildGroundedRecoveryPlan({
        claims: allClaims,
        traceability: claimTraceability,
        citationResult,
        conflicts: sourceConflicts,
        integrity: sourceIntegrity,
        profile: input.groundingProfile,
      })
    : { steps: [], estimatedCost: 'low' as const };
  const groundedExplanation = composeGroundedIntegrityExplanation({
    profile: input.groundingProfile ?? {
      retrievalProfileId: 'none',
      recommendationId: input.recommendation.recommendationId,
      approvedSources: [],
      approvedTerminology: [],
      factualAnchors: [],
      strategicReferences: [],
      operationalContext: [],
      sourcePriorityIndex: { unreliable: [], low: [], moderate: [], high: [], exceptional: [] },
    },
    traceability: claimTraceability,
    citationResult,
    conflicts: sourceConflicts,
    integrity: sourceIntegrity,
    recoveryPlan: groundedRecoveryPlan,
  });
  // ──────────────────────────────────────────────────────────────────────

  const diagnostics = buildLiveExecutionDiagnostics({
    sectionResults: sectionContinuityResults,
    sectionGenericityScores,
    recoveryHistory,
    sectionsFailed,
  });

  const explanation = composeGenerationIntegrityExplanation({
    contract: input.generationContract,
    integrity,
    sectionResults: sectionContinuityResults,
    recoveryHistory,
  });

  // Final lifecycle decision (purely informational — caller transitions registry).
  // article_recovered fires only when something MATERIAL was wrong: actual
  // recovery attempts ran, or factual governance flagged a meaningful volume
  // of unsupported claims, or the hallucination risk band was high+. A handful
  // of declarative-without-citation claims in an otherwise strong article is
  // expected and should not demote it to "recovered".
  const finalLifecycleState: OrchestratorResult['finalLifecycleState'] = (() => {
    // Source integrity only contributes to lifecycle when a grounding profile
    // was supplied. Without a profile, all claims register as orphans by
    // design, which would unfairly fail downstream callers that haven't
    // opted into source governance yet.
    const sourceFailed = Boolean(input.groundingProfile) && sourceIntegrity.integrityBand === 'failed';
    if (integrity.integrityBand === 'failed'
        || factualIntegrity.hallucinationRiskBand === 'critical'
        || sourceFailed
        || sectionsFailed > Math.floor(sectionOutcomes.length / 2)) {
      return 'article_failed';
    }
    // Only material factual concerns demote to article_recovered. Healthy
    // articles routinely contain declarative statements without inline
    // citations — those are tracked in unsupportedClaims but should not by
    // themselves block the article from completing cleanly. When a grounding
    // profile IS supplied, source-integrity failures also count as material.
    const materialFactualConcern =
      factualIntegrity.hallucinationRiskBand === 'high'
      || factualIntegrity.factualIntegrityScore < 55;
    const materialGroundingConcern = input.groundingProfile
      ? sourceIntegrity.integrityBand === 'weak'
        || groundedRecoveryPlan.steps.length >= 3
        || sourceConflicts.sourceConflictSeverity === 'high'
      : false;
    if ((recoveryHistory.length > 0 || materialFactualConcern || materialGroundingConcern)
        && integrity.integrityBand !== 'exceptional') {
      return 'article_recovered';
    }
    return 'article_completed';
  })();

  // ── Phase 4.1 + 4.6 — Adaptive budget + recovery plan. ─────────────
  const adaptiveBudget = computeAdaptiveRecoveryBudget({
    total_sections: sectionOutcomes.length,
    failed_sections: sectionsFailed,
    severity_distribution: { moderate: sectionsFailed },
    issue_categories: sectionFailureSummaries.reduce<Partial<Record<import('./adaptiveRecoveryBudget').IssueCategory, number>>>(
      (acc, s) => {
        for (const cat of s.failureCategories) {
          const k = (cat === 'company_alignment' ? 'alignment'
            : cat === 'semantic_repetition' ? 'repetition'
            : cat === 'strategic_assignment_consumption' ? 'assignment'
            : cat === 'timeout' ? 'unknown' /* timeouts don't map cleanly; tracked separately */
            : cat === 'genericity' ? 'genericity'
            : cat === 'factual' ? 'factual'
            : 'continuity') as import('./adaptiveRecoveryBudget').IssueCategory;
          acc[k] = (acc[k] ?? 0) + 1;
        }
        return acc;
      }, {}),
    content_type: input.contentType ?? 'unknown',
    generation_duration_ms: Date.now() - orchestratorStartMs,
  });
  const recoveryPlan = sectionFailureSummaries.length > 0
    ? buildPlannedEngineRecoveryPlan({
        budget: adaptiveBudget,
        sectionFailures: sectionFailureSummaries,
        totalSections: sectionOutcomes.length,
      })
    : undefined;

  // ── Phase 4.8 — Section diagnostics UI payload. ─────────────────────
  const lifecycleHistory = lifecycle.getHistory();
  const section_diagnostics = sectionOutcomes.map((outcome, idx) => {
    const lifecycleEntry = lifecycleHistory.find((h) => h.sectionIndex === idx);
    const groundedFor = groundedClaimResults.find((g) => g.sectionIndex === idx)?.result;
    const consumptionFor = strategicAssignmentConsumption?.perSection.find((c) => c.sectionIndex === idx + 1 || c.sectionIndex === idx);
    const repetitionFlags: string[] = [];
    for (const det of outcome.finalGenericity.detections ?? []) {
      if (det.type) repetitionFlags.push(String(det.type));
    }
    return {
      section_id: idx,
      section_title: outcome.contract.sectionTitle,
      lifecycle_state: lifecycleEntry?.finalState ?? SectionLifecycleState.ACCEPTED,
      retries: Math.max(0, outcome.attempts - 1),
      governance_scores: {
        continuity: outcome.finalContinuity.sectionContinuityScore,
        strategic_integrity: outcome.finalContinuity.sectionStrategicIntegrityScore,
        operational_integrity: outcome.finalContinuity.sectionOperationalIntegrityScore,
        genericity_pressure: outcome.finalGenericity.genericityPressureScore,
        alignment: outcome.finalAlignment?.alignmentScore,
        differentiation_strength: outcome.finalAlignment?.differentiationStrength,
        strategic_presence: outcome.finalAlignment?.strategicPresence,
        authority_inflation: outcome.finalFactual.authority.authorityInflationScore,
        operational_realism: outcome.finalFactual.operational.realismScore,
      } as Record<string, number | undefined>,
      repetition_flags: repetitionFlags,
      assignment_consumption: consumptionFor
        ? {
            totalAssignments: consumptionFor.totalAssignments,
            consumedAssignments: consumptionFor.consumedAssignments,
            consumptionRatio: consumptionFor.consumptionRatio,
          }
        : null,
      grounding_coverage: groundedFor
        ? {
            evidenceCoverage: groundedFor.evidenceCoverage,
            hallucinationRisk: groundedFor.hallucinationRisk,
            fabricatedSpecificityRisk: groundedFor.fabricatedSpecificityRisk,
          }
        : null,
      timeout_events: sectionTimeoutCounts.get(idx) ?? 0,
      recovery_actions: lifecycleEntry?.recoveryActionsApplied ?? [],
      final_acceptance_reason: lifecycleEntry?.acceptanceReason,
      final_abandonment_reason: lifecycleEntry?.abandonmentReason,
    };
  });

  // ── Phase 5.2 — Article-level semantic grounding (when profile supplied) ─
  let semanticGrounding: AggregateSemanticGroundingResult | undefined;
  if (input.groundingProfile && input.groundingProfile.approvedSources.length > 0) {
    const encodedFragments = encodeGroundingProfile(input.groundingProfile);
    const claims = factualSnapshots.flatMap((s) => s.claims.map((c) => ({
      claimId: c.claimId,
      claimText: c.claimText,
      isHighRisk: c.evidenceRequirementLevel === 'critical' || c.evidenceRequirementLevel === 'required',
    })));
    semanticGrounding = aggregateSemanticGrounding({
      claims,
      fragments: encodedFragments,
    });
  }

  // ── Phase 5.9 — Grounding visualization payload (editorial UI) ──────────
  const grounding_visualization = (() => {
    const sectionCoverage: NonNullable<OrchestratorResult['grounding_visualization']>['sectionCoverage'] = [];
    const groundedFlat: NonNullable<OrchestratorResult['grounding_visualization']>['groundedClaims'] = [];
    const unsupportedFlat: NonNullable<OrchestratorResult['grounding_visualization']>['unsupportedClaims'] = [];
    const contradictions: NonNullable<OrchestratorResult['grounding_visualization']>['contradictionWarnings'] = [];

    for (let idx = 0; idx < sectionOutcomes.length; idx += 1) {
      const outcome = sectionOutcomes[idx];
      const groundedFor = groundedClaimResults.find((g) => g.sectionIndex === idx)?.result;
      if (groundedFor) {
        sectionCoverage.push({
          section_id: idx,
          section_title: outcome.contract.sectionTitle,
          groundingStrength: 100 - groundedFor.hallucinationRisk,
          groundedClaimCount: groundedFor.groundedClaims.length,
          unsupportedClaimCount: groundedFor.unsupportedClaims.length,
        });
        for (const gc of groundedFor.groundedClaims) {
          groundedFlat.push({
            section_id: idx,
            claimId: gc.claimId,
            text: gc.text.slice(0, 240),
            sourceIds: gc.supportingSourceIds,
            matchScore: gc.matchScore,
          });
        }
        for (const uc of groundedFor.unsupportedClaims) {
          unsupportedFlat.push({
            section_id: idx,
            claimId: uc.claimId,
            text: uc.text.slice(0, 240),
          });
        }
      }
    }
    if (semanticGrounding) {
      for (const c of semanticGrounding.contradictoryFragments) {
        contradictions.push({
          section_id: -1, // article-level; section attribution would require per-section semantic runs
          text: c.fragment.text.slice(0, 240),
          reason: c.numericDivergence ? 'numeric_divergence' : 'polarity_conflict',
        });
      }
    }
    const evidenceDensity = semanticGrounding?.semanticCoverage ?? 0;
    return { sectionCoverage, unsupportedClaims: unsupportedFlat, groundedClaims: groundedFlat, evidenceDensity, contradictionWarnings: contradictions };
  })();

  // ── Phase 5.5 — Article convergence (final ship/repair/abort gate) ─────
  const acceptedSections = sectionOutcomes
    .map((s, idx) => ({ outcome: s, idx }))
    .filter(({ outcome }) => outcome.passed)
    .map(({ outcome, idx }) => ({
      sectionIndex: idx,
      alignmentScore: outcome.finalAlignment?.alignmentScore,
      continuityScore: outcome.finalContinuity.sectionContinuityScore,
      groundingEvidenceCoverage: groundedClaimResults.find((g) => g.sectionIndex === idx)?.result.evidenceCoverage,
      consumptionRatio: strategicAssignmentConsumption?.perSection.find((c) => c.sectionIndex === idx + 1 || c.sectionIndex === idx)?.consumptionRatio,
    }));
  const softeningTargets = groundedClaimResults.flatMap((g) =>
    g.result.softeningTargets.map((t) => ({ sectionIndex: g.sectionIndex, reason: t.action })),
  );
  const articleConvergence = evaluateArticleConvergence({
    acceptedSections,
    abandonedSections: (recoveryPlan?.abandonedSections ?? []).map((a) => ({ sectionIndex: a.sectionIndex, reason: a.reason })),
    totalSections: sectionOutcomes.length,
    groundingCoverage: semanticGrounding?.semanticCoverage,
    repetitionScoreRaw: integrity.postGenerationIntegrityScore < 70 ? 45 : 20, // proxy: integrity score inverse
    assignmentCoverageRatio: strategicAssignmentConsumption?.overallConsumptionRatio,
    narrativeContinuity: integrity.postGenerationIntegrityScore,
    lifecycleHistory,
    softeningTargets,
  });

  // ── Phase 5.7 — Quality benchmark snapshot ─────────────────────────────
  const totalRetries = sectionOutcomes.reduce((s, o) => s + Math.max(0, o.attempts - 1), 0);
  const alignmentSamples = sectionOutcomes
    .map((o) => o.finalAlignment?.alignmentScore)
    .filter((v): v is number => typeof v === 'number');
  const alignmentAverage = alignmentSamples.length === 0
    ? 0
    : Math.round(alignmentSamples.reduce((a, b) => a + b, 0) / alignmentSamples.length);
  const strategicSamples = sectionOutcomes
    .map((o) => o.finalAlignment?.strategicPresence)
    .filter((v): v is number => typeof v === 'number');
  const strategicDensity = strategicSamples.length === 0
    ? 0
    : Math.round(strategicSamples.reduce((a, b) => a + b, 0) / strategicSamples.length);
  const continuityAvg = sectionOutcomes.length === 0
    ? 0
    : Math.round(sectionOutcomes.reduce((s, o) => s + o.finalContinuity.sectionContinuityScore, 0) / sectionOutcomes.length);
  const narrativeFlowProxy = integrity.postGenerationIntegrityScore;
  const timeoutSectionCount = Array.from(sectionTimeoutCounts.values()).filter((n) => n > 0).length;
  const qualityBenchmark = buildBenchmark({
    engine: 'planned-sectionwise-v1',
    content_type: input.contentType ?? 'unknown',
    topic: input.contentPlan.title ?? 'unknown',
    duration_ms: Date.now() - orchestratorStartMs,
    sectionCount: sectionOutcomes.length,
    sectionsPassed: sectionOutcomes.filter((o) => o.passed).length,
    retriesUsed: totalRetries,
    fallbackTriggered: false,
    alignmentAverage,
    groundingCoverage: semanticGrounding?.semanticCoverage ?? 0,
    repetitionScoreRaw: 100 - continuityAvg,
    continuity: continuityAvg,
    strategicDensity,
    narrativeFlow: narrativeFlowProxy,
    timeoutSectionCount,
  });
  recordBenchmark(qualityBenchmark);

  // Phase 6.5 — Durable persistence (fire-and-forget; default in-memory).
  persistBenchmark({
    engine: 'planned-sectionwise-v1',
    content_type: input.contentType ?? 'unknown',
    topic: input.contentPlan.title || 'unknown',
    company_id: input.companyId ?? null,
    benchmark: qualityBenchmark,
  });
  persistConvergence({
    engine: 'planned-sectionwise-v1',
    content_type: input.contentType ?? 'unknown',
    topic: input.contentPlan.title || 'unknown',
    company_id: input.companyId ?? null,
    result: articleConvergence,
  });
  // Phase 9.3 — Feed the in-process convergence aggregator so the
  // retirement governance snapshot reports a real `convergenceRate`.
  recordConvergenceSample({
    content_type: input.contentType ?? 'unknown',
    topic: input.contentPlan.title || 'unknown',
    company_id: input.companyId ?? null,
    result: articleConvergence,
  });


  // ── Phase 5.8 — Recovery cost report (token-domain) ────────────────────
  const costSections: SectionRecoveryCostRecord[] = sectionOutcomes.map((o, idx) => {
    const wordTarget = o.contract.wordTarget ?? 350;
    const tokensPerAttempt = Math.round(wordTarget * 2.8 + 1500); // ~prompt + completion proxy
    const timeoutEvents = sectionTimeoutCounts.get(idx) ?? 0;
    const productiveRetries = Math.max(0, o.attempts - 1 - timeoutEvents);
    return {
      sectionIndex: idx,
      attempts: o.attempts,
      firstAttemptTokens: tokensPerAttempt,
      retryProductiveTokens: productiveRetries * tokensPerAttempt,
      timeoutWasteTokens: timeoutEvents * tokensPerAttempt,
      // Compression savings/grounding overhead aren't fully threaded into this
      // path yet; surface 0 for now and let the downstream recordRecoveryCost
      // pick them up when the planning engine wires them through.
      compressionSavingsTokens: 0,
      groundingOverheadTokens: input.groundingProfile ? 600 : 0,
      minimalRecoveryUsed: lifecycleHistory.find((h) => h.sectionIndex === idx)?.recoveryActionsApplied.includes('minimal_recovery') ?? false,
    };
  });
  const recoveryCost = recordRecoveryCost({
    company_id: input.companyId ?? null,
    engine: 'planned-sectionwise-v1',
    content_type: input.contentType ?? 'unknown',
    topic: input.contentPlan.title || 'unknown',
    duration_ms: Date.now() - orchestratorStartMs,
    sections: costSections,
  });
  // Phase 6.5 — Persist recovery cost.
  persistRecoveryCost({
    engine: 'planned-sectionwise-v1',
    content_type: input.contentType ?? 'unknown',
    topic: input.contentPlan.title || 'unknown',
    company_id: input.companyId ?? null,
    report: recoveryCost,
  });

  // Phase 6.8 — Build human-readable operational explanation.
  // Phase 7.6 — Include compression events so the compressionReasoning
  // stream is populated.
  const operationalExplanation = buildOperationalExplanation({
    lifecycleHistory,
    recoveryPlan,
    convergence: articleConvergence,
    groundedClaimResults,
    compressionEvents,
  });

  // Phase 7.2 — Release the per-article cache and accumulate metrics.
  const cacheMetrics = releaseArticleCache(articleId);
  if (cacheMetrics) {
    accumulateArticleMetrics(cacheMetrics, cumulativeTokensBurned);
  }

  return {
    assembledArticle,
    sectionOutcomes,
    recoveryHistory,
    strategicAssignmentConsumption,
    integrity,
    factualIntegrity,
    factualRecoveryActionsApplied: aggregateFactualRecovery.steps,
    factualExplanation,
    claimTraceability,
    citationResult,
    sourceConflicts,
    sourceIntegrity,
    groundedRecoveryPlan,
    groundedExplanation,
    diagnostics,
    explanation,
    finalLifecycleState,
    // Phase 4 additions
    sectionLifecycleHistory: lifecycleHistory,
    groundedClaimResults,
    recoveryPlan,
    recoveryBudget: adaptiveBudget,
    section_diagnostics,
    // Phase 5 additions
    semanticGrounding,
    articleConvergence,
    qualityBenchmark,
    recoveryCost,
    grounding_visualization,
    // Phase 6 additions
    operationalExplanation,
    // Phase 7 additions
    promptFragmentReuseReport: cacheMetrics ? {
      reusedFragments: cacheMetrics.cacheHits,
      avoidedRecomputations: cacheMetrics.cacheHits + cacheMetrics.retriesDeduplicated,
      savedPromptTokens: cacheMetrics.savedTokens,
      savedLatencyMs: cacheMetrics.savedDurationMs,
      cacheHitRate: cacheMetrics.cacheHitRate,
    } : undefined,
    recoveryExecutionSnapshot: recoveryGraph.snapshot(
      recoveryGraph.computeArticleDecision({
        issueCategoriesObserved: [],
        sectionFailureSummaries,
        failedSectionCount: sectionFailureSummaries.length,
        severity: sectionFailureSummaries.length >= 3 ? 'severe' : sectionFailureSummaries.length >= 1 ? 'moderate' : 'low',
      }),
      articleConvergence,
    ),
  };
}
