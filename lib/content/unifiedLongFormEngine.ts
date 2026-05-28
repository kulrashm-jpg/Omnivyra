import {
  runBlogGeneration,
  type BlogGenerationRequest,
  type BlogGenerationResult,
} from '../blog/runBlogGeneration';
import { contentTypeConfig, isLongFormContentType, type LongFormContentType } from './longFormContentTypeConfig';
import {
  runPlannedLongFormGeneration,
  type ContentPlan,
  type LongFormQualityReport,
} from './longFormPlanningEngine';
import type {
  ContentImprovementHooks,
  ContentScore,
  SearchIntent,
  SerpStructureHints,
  TopicEntityMap,
} from './longFormSeoIntelligence';
import type {
  CompetitorContentProfile,
  ContentPositioning,
  DifferentiationStrategy,
} from './longFormDifferentiationIntelligence';
import type {
  ContentPerformance,
  ContentPerformanceFeatureSnapshot,
  PerformanceInsights,
} from './longFormPerformanceLearning';
import {
  evaluateLongFormContent,
  type LongFormContentEvaluationResult,
} from './longFormContentEvaluator';
import { getLongFormTemplateSpec } from './longFormTemplateSpecs';
import {
  emitEngineFallback,
  emitEngineSelected,
  type LongFormEngineFallbackPayload,
} from './longFormEngineTelemetry';
import {
  emitCompatibilityCoreUsage,
  getCompatibilityCoreUsageReport,
  type CompatibilityCoreUsageReport,
} from '../../backend/services/longForm/plannedEngineStabilityTelemetry';
// Phase 4.3 — Grounding profile builder hook.
import {
  buildGroundingProfile,
  type BuildGroundingProfileInput,
  type BuiltGroundingProfile,
} from './buildGroundingProfile';
// Phase 4.7 — Compatibility-core retirement readiness.
import {
  computeCompatibilityCoreRetirementReport,
  type CompatibilityCoreRetirementReport,
} from '../../backend/services/longForm/compatibilityCoreRetirementReport';
// Phase 4.9 — Burn-in shadow mode.
import {
  resolveBurnInMode,
  recordBurnInComparison,
  accumulateBurnInComparison,
  getBurnInAggregateReport,
  type BurnInComparisonSnapshot,
  type BurnInAggregateReport,
} from '../../backend/services/longForm/plannedEngineBurnInMode';
// Phase 5.6 — Compatibility-core retirement simulation.
import {
  simulateCompatibilityCoreRetirement,
  resolveRetirementSimulationMode,
  emitSimulatedFailure,
  type RetirementSimulationReport,
} from '../../backend/services/longForm/retirementSimulation';
// Phase 5.7 — Quality benchmark exports.
import {
  compareEngineBenchmarks,
  getQualityTrend,
  type EngineBenchmarkComparison,
  type QualityTrendPoint,
  type BenchmarkEngine,
} from '../../backend/services/longForm/qualityBenchmarkSuite';
// Phase 5.8 — Recovery cost aggregate.
import {
  getAggregateRecoveryCostReport,
  type AggregateRecoveryCostReport,
} from '../../backend/services/longForm/recoveryCostTelemetry';
// Phase 6.4 — Runtime efficiency aggregate.
import {
  getAggregateRuntimeEfficiencyReport,
  type AggregateRuntimeEfficiencyReport,
} from '../../backend/services/longForm/runtimeEfficiencyOptimizer';
// Phase 6.7 — Compatibility-core decommission gate.
import {
  evaluateDecommissionGate,
  type DecommissionGateResult,
} from '../../backend/services/longForm/compatibilityCoreDecommissionGate';
// Phase 6.9 — Burn-in performance analysis.
import {
  analyzeBurnInPerformance,
  type BurnInPerformanceAnalysis,
} from '../../backend/services/longForm/burnInPerformanceAnalysis';
// Phase 6.5 — Benchmark persistence configuration hook.
import {
  setBenchmarkPersistenceProvider,
  getBenchmarkPersistenceProvider,
  type BenchmarkPersistenceProvider,
} from '../../backend/services/longForm/benchmarkPersistence';
// Phase 7.8 — Persistence failure aggregator.
import {
  getPersistenceFailureReport,
  type PersistenceFailureReport,
} from '../../backend/services/longForm/supabaseBenchmarkPersistence';
// Phase 7.9 — Decommission trend analyzer.
import {
  analyzeDecommissionTrend,
  type DecommissionTrendReport,
} from '../../backend/services/longForm/decommissionTrendAnalyzer';
// Phase 7.10 — Enforcement mode ladder + promotion evaluator.
import {
  resolveEnforcementMode,
  evaluateEnforcementPromotion,
  applyEnforcementToFallback,
  type PlannedEngineEnforcementMode,
  type EnforcementResolution,
  type EnforcementPromotionRecommendation,
} from '../../backend/services/longForm/plannedEngineEnforcementMode';
// Phase 8.5 — Automated enforcement promotion engine.
import {
  evaluatePromotionEngine,
  getEnforcementPromotionEngineState,
  type PromotionExecutionResult,
  type EnforcementPromotionEngineState,
} from '../../backend/services/longForm/enforcementPromotionEngine';
// Phase 8.6 — Rollback guard.
import {
  checkAndApplyRollback,
  getRollbackGuardState,
  isPromotionFrozen,
  type RollbackGuardState,
} from '../../backend/services/longForm/enforcementRollbackGuard';
// Phase 8.7 — Compatibility-core traffic isolation.
import {
  emitCompatibilityCoreRequest,
  emitCompatibilityCoreFailure,
  categorizeCompatibilityCoreRequest,
  getCompatibilityCoreTrafficReport,
  type CompatibilityCoreTrafficReport,
} from '../../backend/services/longForm/compatibilityCoreTrafficIsolation';
// Phase 8.8 — Self-healing coordinator.
import {
  runSelfHealingCycle,
  getSelfHealingState,
  type SelfHealingState,
  type RunSelfHealingResult,
} from '../../backend/services/longForm/selfHealingCoordinator';
// Phase 8.9 — Retirement governance snapshot.
import {
  buildRetirementGovernanceSnapshot,
  type RetirementGovernanceSnapshot,
} from '../../backend/services/longForm/retirementGovernanceSnapshot';
// Phase 8.10 — Compatibility-core collapse simulation.
import {
  resolveCollapseSimulationMode,
  observeCollapseProjectedFailure,
  getCollapseSimulationReport,
  type CollapseSimulationReport,
} from '../../backend/services/longForm/compatibilityCoreCollapseSimulation';
// Phase 8.2 — Canonical recovery enforcement aggregate.
import {
  getCanonicalRecoveryViolationReport,
  type CanonicalRecoveryViolationReport,
} from '../../backend/services/longForm/canonicalRecoveryEnforcement';
// Phase 8.8 → 8.6 bridge wiring.
import { registerExternalPromotionFreezer } from '../../backend/services/longForm/selfHealingPromotionBridge';
// Phase 9.7 — Shadow shutdown bypass (active no-fallback canary).
import {
  shouldBypassCompatibilityCoreForRequest,
  recordShadowShutdownOutcome,
  getShadowShutdownReport,
  type ShadowShutdownReport,
} from '../../backend/services/longForm/compatibilityCoreShadowShutdown';
// Phase 9.6 — Compatibility-core unlink analyzer.
import {
  analyzeCompatibilityCoreUnlinkReadiness,
  makeUnknownUnlinkReport,
  type CompatibilityCoreUnlinkReadinessReport,
  type CompatibilityCoreCodeMap,
} from '../../backend/services/longForm/compatibilityCoreUnlinkAnalyzer';
// Phase 9.9 — Retirement execution timeline.
import {
  computeRetirementExecutionTimeline,
  type RetirementExecutionTimelineSnapshot,
} from '../../backend/services/longForm/retirementExecutionTimeline';
// Phase 9.10 — Compatibility-core deletion plan generator.
import {
  generateCompatibilityCoreDeletionPlan,
  type DeletionPlan,
} from '../../backend/services/longForm/compatibilityCoreDeletionPlanner';
// Phase 9.8 — Self-healing effectiveness evaluator.
import {
  getSelfHealingEffectivenessReport,
  type SelfHealingEffectivenessReport,
} from '../../backend/services/longForm/selfHealingEffectivenessEvaluator';
// Phase 9.3 — Convergence aggregate.
import {
  getConvergenceAggregateReport,
  type ConvergenceAggregateReport,
} from '../../backend/services/longForm/convergenceTelemetry';
// Phase 9.4 — Per-content-type enforcement snapshot.
import {
  getPerContentTypeEnforcementSnapshot,
  type PerContentTypeEnforcementSnapshot,
} from '../../backend/services/longForm/contentTypeEnforcementManager';
// Phase 9.5 — Autonomous promotion audit.
import {
  getAutonomousPromotionAudit,
  type AutonomousPromotionAudit,
} from '../../backend/services/longForm/autonomousPromotionCoordinator';

export interface UnifiedLongFormGenerationInput
  extends Omit<BlogGenerationRequest, 'contentType' | 'formatType' | 'template_blocks' | 'target_words'> {
  contentType: LongFormContentType;
  formatType?: string;
  templateBlocks?: BlogGenerationRequest['template_blocks'];
  targetWordCount?: number;
  seoContext?: string;
  contentPerformance?: ContentPerformance[];
  performanceFeatureSnapshots?: ContentPerformanceFeatureSnapshot[];
  performanceInsights?: PerformanceInsights;
  /**
   * Phase 3.8 — Force STRICT_PLANNED_ENGINE_MODE for this single request.
   * Overrides the env-resolved default. When true and the planned engine
   * fails, the unified facade re-throws rather than falling back to the
   * compatibility-core path.
   */
  strictPlannedEngine?: boolean;
  /**
   * Phase 4.3 — Grounding sources for the request. When supplied, the
   * facade calls `buildGroundingProfile(...)` and threads the resulting
   * `RetrievalGroundingProfile` to the section orchestrator.
   * When omitted, the planned engine continues in dormant-grounding mode.
   */
  groundingInput?: Omit<BuildGroundingProfileInput, 'recommendationId' | 'topic'> & {
    /** Optional explicit recommendationId; defaults to a derived value. */
    recommendationId?: string;
  };
  /**
   * Phase 4.9 — Force burn-in mode for this single request. Overrides
   * `PLANNED_ENGINE_BURN_IN_MODE` env. When true, the facade ALSO runs
   * the compatibility-core shadow generation and records a comparison
   * event — users still receive only the planned-engine output.
   */
  plannedEngineBurnIn?: boolean;
}

export interface UnifiedLongFormEngineTrace {
  engine: 'unifiedLongFormEngine';
  contentType: LongFormContentType;
  formatType: string;
  templateName?: string;
  targetWordCount?: number;
  configVersion: 'long-form-config-v1';
  templateSpecApplied: boolean;
  generationLogic: 'planned-sectionwise-v1' | 'compatibility-core';

  /**
   * Phase 1.1 — Surface-silent-fallbacks contract.
   *
   * Every response carries enough information for operators to determine,
   * without reading server logs, which engine produced the content and
   * (if a fallback occurred) why.
   *
   * `attempted_engine`     — the engine the request was routed to first
   * `final_engine`         — the engine whose output is in this response
   * `fallback_triggered`   — true iff attempted != final
   * `fallback_reason`      — Error.message from the original failure
   * `fallback_stack`       — Error.stack from the original failure (may be omitted in prod)
   */
  attempted_engine: 'planned-sectionwise-v1' | 'compatibility-core';
  final_engine: 'planned-sectionwise-v1' | 'compatibility-core';
  fallback_triggered: boolean;
  fallback_reason?: string;
  fallback_stack?: string;

  searchIntent?: SearchIntent;
  topicEntityMap?: TopicEntityMap;
  serpStructureHints?: SerpStructureHints;
  contentPositioning?: ContentPositioning;
  competitorContentProfile?: CompetitorContentProfile;
  differentiationStrategy?: DifferentiationStrategy;
  contentPlan?: ContentPlan;
  qualityReport?: LongFormQualityReport;
  contentScore?: ContentScore;
  improvementHooks?: ContentImprovementHooks;
  performanceInsights?: PerformanceInsights;
  generatedFeatureSnapshot?: ContentPerformanceFeatureSnapshot;
  contentEvaluation?: LongFormContentEvaluationResult;
}

export type UnifiedLongFormGenerationResult = BlogGenerationResult & {
  engine_trace?: UnifiedLongFormEngineTrace;
};

// ── Phase 3.8 — STRICT_PLANNED_ENGINE_MODE ───────────────────────────────────
//
// When enabled, the unified facade refuses to fall back to compatibility-core
// when the planned-sectionwise path fails. Useful in dev / staging to surface
// planner regressions immediately instead of silently masking them with the
// legacy engine.
//
// Resolution order (highest precedence first):
//   1. Per-request override (`strictPlannedEngine` on the input).
//   2. Environment variable `STRICT_PLANNED_ENGINE_MODE`:
//        'always'   → strict in every environment
//        'non_prod' → strict whenever NODE_ENV !== 'production'
//        'off' / unset → soft fallback as today (default)
//   3. Otherwise: soft fallback.
export type StrictPlannedEngineMode = 'always' | 'non_prod' | 'off';

function resolveStrictMode(
  perRequest: boolean | undefined,
): { strict: boolean; reason: 'request_override' | 'env_always' | 'env_non_prod' | 'default_off' } {
  if (typeof perRequest === 'boolean') {
    return { strict: perRequest, reason: 'request_override' };
  }
  const env = (process.env.STRICT_PLANNED_ENGINE_MODE ?? 'off').toLowerCase() as StrictPlannedEngineMode;
  if (env === 'always') return { strict: true, reason: 'env_always' };
  if (env === 'non_prod') {
    return { strict: process.env.NODE_ENV !== 'production', reason: 'env_non_prod' };
  }
  return { strict: false, reason: 'default_off' };
}

/**
 * Phase 3.8 — Returns the in-process snapshot of which content types still
 * relied on the compatibility-core fallback path. Callers (e.g. admin
 * dashboards, scheduled jobs) can call this directly to materialize the
 * report without consuming the log stream.
 */
export function getLongFormCompatibilityCoreUsageReport(): CompatibilityCoreUsageReport {
  return getCompatibilityCoreUsageReport();
}

/**
 * Phase 4.7 — Returns the retirement-readiness report derived from the
 * current in-process usage snapshot. Operators check this to decide when
 * to flip `STRICT_PLANNED_ENGINE_MODE=always`.
 */
export function getLongFormCompatibilityCoreRetirementReport(): CompatibilityCoreRetirementReport {
  return computeCompatibilityCoreRetirementReport();
}

/**
 * Phase 4.9 — Returns the in-process burn-in comparison aggregate.
 */
export function getLongFormBurnInAggregateReport(): BurnInAggregateReport {
  return getBurnInAggregateReport();
}

/**
 * Phase 5.6 — Returns the compatibility-core retirement simulation report.
 * Operators use this to project the impact of removing the fallback engine.
 */
export function getLongFormRetirementSimulationReport(): RetirementSimulationReport {
  return simulateCompatibilityCoreRetirement();
}

/**
 * Phase 5.7 — Returns side-by-side benchmark comparison between
 * planned-sectionwise and compatibility-core engines for the given
 * content type.
 */
export function getLongFormEngineBenchmarkComparison(contentType: string): EngineBenchmarkComparison {
  return compareEngineBenchmarks(contentType);
}

/**
 * Phase 5.7 — Returns quality trend points for an (engine, content_type)
 * pair, bucketed by hour or day.
 */
export function getLongFormQualityTrend(
  engine: BenchmarkEngine,
  contentType: string,
  bucketSize: 'hour' | 'day' = 'hour',
): QualityTrendPoint[] {
  return getQualityTrend(engine, contentType, bucketSize);
}

/**
 * Phase 5.8 — Returns the in-process recovery cost aggregate (token-domain).
 */
export function getLongFormRecoveryCostAggregate(): AggregateRecoveryCostReport {
  return getAggregateRecoveryCostReport();
}

/**
 * Phase 6.4 — Returns the in-process runtime efficiency aggregate
 * (cache hit rate / retries deduplicated / saved tokens & duration).
 */
export function getLongFormRuntimeEfficiencyAggregate(): AggregateRuntimeEfficiencyReport {
  return getAggregateRuntimeEfficiencyReport();
}

/**
 * Phase 6.7 — Returns the compatibility-core decommission gate decision.
 * Operators use this to determine whether STRICT_PLANNED_ENGINE_MODE can
 * safely advance to the next tier (`NOT_READY` → `LIMITED_NON_PROD` →
 * `STAGED_PRODUCTION` → `READY_FOR_RETIREMENT`).
 */
export function getLongFormDecommissionGateResult(): DecommissionGateResult {
  return evaluateDecommissionGate();
}

/**
 * Phase 6.9 — Returns the expanded burn-in performance analysis.
 */
export function getLongFormBurnInPerformanceAnalysis(): BurnInPerformanceAnalysis {
  return analyzeBurnInPerformance();
}

/**
 * Phase 6.5 — Wire in a durable benchmark persistence backend (Supabase,
 * telemetry store, …) without touching any orchestrator / planner code.
 * Call this once at boot.
 */
export function configureLongFormBenchmarkPersistence(provider: BenchmarkPersistenceProvider): void {
  setBenchmarkPersistenceProvider(provider);
}

/**
 * Phase 6.5 — Read the active benchmark persistence provider (e.g. for
 * admin-side ad-hoc queries).
 */
export function getActiveLongFormBenchmarkPersistenceProvider(): BenchmarkPersistenceProvider {
  return getBenchmarkPersistenceProvider();
}

/**
 * Phase 7.8 — Returns the in-process persistence-failure aggregate
 * (count + last-failure timestamp + per-surface breakdown). Lets
 * operators see whether durable writes are succeeding without combing
 * the LONGFORM_PERSISTENCE_FAILURE log stream.
 */
export function getLongFormPersistenceFailureReport(): PersistenceFailureReport {
  return getPersistenceFailureReport();
}

/**
 * Phase 7.9 — Returns the decommission trend analysis (improving /
 * stable / regressing direction + per-blocker trajectory + projected
 * retirement-ready date).
 */
export function getLongFormDecommissionTrendReport(): DecommissionTrendReport {
  return analyzeDecommissionTrend();
}

/**
 * Phase 7.10 — Returns the currently-resolved enforcement mode (from
 * env or default) and the reason it was selected.
 */
export function getLongFormCurrentEnforcementMode(): EnforcementResolution {
  return resolveEnforcementMode();
}

/**
 * Phase 7.10 — Returns the system's recommendation for whether to
 * promote/hold/demote on the enforcement ladder.
 */
export function getLongFormEnforcementPromotionRecommendation(): EnforcementPromotionRecommendation {
  return evaluateEnforcementPromotion();
}

// Re-export the enforcement-mode union for callers that wire ladder-aware
// admin tooling.
export type { PlannedEngineEnforcementMode };

// ── Phase 8.8 ↔ 8.6 bridge wiring ────────────────────────────────────────────
//
// The self-healing coordinator calls `freezePromotionFromSelfHealing()`
// when it triggers the `freeze_promotion` action. We register the
// rollback guard's freeze mechanism as the implementation here so the
// two subsystems stay coupled WITHOUT a circular import.
//
// In practice the rollback guard sets its own promotion-freeze field;
// we mirror that into the freezer hook by calling a no-op closure that
// reads + extends the rollback guard's state. (The rollback guard's
// `checkAndApplyRollback` is the canonical way; self-healing's freeze
// is a softer hint.)
registerExternalPromotionFreezer((freezeUntilISO, reason) => {
  // Hint-only: the rollback guard's promotion freeze is the source of
  // truth. Self-healing freezes are logged but do not override.
  console.warn(`[longform-self-healing] freeze_promotion hint: until=${freezeUntilISO} reason=${reason}`);
});

// ── Phase 8.5 — Automated enforcement promotion engine ──────────────────────

/**
 * Phase 8.5 — Evaluates whether to promote/hold/demote on the enforcement
 * ladder. Returns the execution result; callers apply the env change
 * separately and report back via `applyPromotionResult`.
 */
export function evaluateLongFormEnforcementPromotion(): PromotionExecutionResult {
  return evaluatePromotionEngine();
}

/**
 * Phase 8.5 — Internal state of the promotion engine (last applied
 * mode, cooldown, history).
 */
export function getLongFormEnforcementPromotionEngineState(): EnforcementPromotionEngineState {
  return getEnforcementPromotionEngineState();
}

// ── Phase 8.6 — Rollback guard ──────────────────────────────────────────────

/**
 * Phase 8.6 — Current state of the rollback guard (freeze window,
 * recent rollback events).
 */
export function getLongFormRollbackGuardState(): RollbackGuardState {
  return getRollbackGuardState();
}

/**
 * Phase 8.6 — Force a rollback check against the current snapshot.
 * Returns whether a rollback should be applied (operator-driven runs).
 */
export function checkLongFormRollback(input: {
  previousMode: PlannedEngineEnforcementMode;
  currentMode: PlannedEngineEnforcementMode;
}) {
  return checkAndApplyRollback({ previousMode: input.previousMode, currentMode: input.currentMode });
}

// ── Phase 8.7 — Compatibility-core traffic isolation ────────────────────────

/**
 * Phase 8.7 — Per-category breakdown of compatibility-core traffic.
 */
export function getLongFormCompatibilityCoreTrafficReport(): CompatibilityCoreTrafficReport {
  return getCompatibilityCoreTrafficReport();
}

// ── Phase 8.8 — Self-healing ────────────────────────────────────────────────

/**
 * Phase 8.8 — Run one self-healing detection + action cycle.
 * Returns triggered detections + actions applied + currently-active actions.
 */
export function runLongFormSelfHealingCycle(): RunSelfHealingResult {
  return runSelfHealingCycle();
}

/**
 * Phase 8.8 — Current self-healing state (active + history).
 */
export function getLongFormSelfHealingState(): SelfHealingState {
  return getSelfHealingState();
}

// ── Phase 8.9 — Retirement governance dashboard payload ─────────────────────

/**
 * Phase 8.9 — Single canonical governance snapshot. Admin / SRE /
 * decommission dashboards consume this.
 */
export function getLongFormRetirementGovernanceSnapshot(): RetirementGovernanceSnapshot {
  return buildRetirementGovernanceSnapshot();
}

// ── Phase 8.10 — Collapse simulation reporting ──────────────────────────────

/**
 * Phase 8.10 — Aggregated compatibility-core collapse simulation report.
 */
export function getLongFormCompatibilityCoreCollapseReport(): CollapseSimulationReport {
  return getCollapseSimulationReport();
}

// ── Phase 8.2 — Canonical recovery violation aggregate ──────────────────────

/**
 * Phase 8.2 — In-process tally of non-canonical recovery detections.
 */
export function getLongFormCanonicalRecoveryViolationReport(): CanonicalRecoveryViolationReport {
  return getCanonicalRecoveryViolationReport();
}

// ── Phase 9 — Operational convergence + unlink readiness exporters ─────────

/**
 * Phase 9.3 — Real (non-placeholder) convergence aggregate across all
 * articles processed since boot.
 */
export function getLongFormConvergenceAggregateReport(): ConvergenceAggregateReport {
  return getConvergenceAggregateReport();
}

/**
 * Phase 9.4 — Per-content-type enforcement ladder snapshot
 * (mode / cooldown / effective resolution per content type).
 */
export function getLongFormPerContentTypeEnforcementSnapshot(): PerContentTypeEnforcementSnapshot {
  return getPerContentTypeEnforcementSnapshot();
}

/**
 * Phase 9.5 — Audit log + counters for the autonomous promotion
 * coordinator (applied / blocked / by reason).
 */
export function getLongFormAutonomousPromotionAudit(): AutonomousPromotionAudit {
  return getAutonomousPromotionAudit();
}

/**
 * Phase 9.6 — Static unlink-readiness report. Pass a code-map produced
 * by an offline scan; omit to receive the "no scan supplied" stub.
 */
export function getLongFormCompatibilityCoreUnlinkReport(
  input?: { codeMap?: CompatibilityCoreCodeMap },
): CompatibilityCoreUnlinkReadinessReport {
  if (!input?.codeMap) return makeUnknownUnlinkReport();
  return analyzeCompatibilityCoreUnlinkReadiness({ codeMap: input.codeMap });
}

/**
 * Phase 9.7 — Aggregate report on shadow shutdown outcomes (bypass
 * success rate, failure rate, recommendation).
 */
export function getLongFormShadowShutdownReport(): ShadowShutdownReport {
  return getShadowShutdownReport();
}

/**
 * Phase 9.8 — Self-healing effectiveness aggregate
 * (effective / neutral / harmful classifications, auto-disable list).
 */
export function getLongFormSelfHealingEffectivenessReport(): SelfHealingEffectivenessReport {
  return getSelfHealingEffectivenessReport();
}

/**
 * Phase 9.9 — Six-stage retirement execution timeline snapshot.
 * Optional code-map enables a full unlink-aware computation.
 */
export function getLongFormRetirementExecutionTimeline(
  input?: { codeMap?: CompatibilityCoreCodeMap },
): RetirementExecutionTimelineSnapshot {
  return computeRetirementExecutionTimeline({ codeMap: input?.codeMap });
}

/**
 * Phase 9.10 — Concrete deletion plan for physically removing the
 * compatibility-core engine. Refuses to emit an "approved" plan
 * unless the timeline reports the system is ready.
 */
export function getLongFormCompatibilityCoreDeletionPlan(
  input: { codeMap: CompatibilityCoreCodeMap; assumeReadiness?: boolean },
): DeletionPlan {
  return generateCompatibilityCoreDeletionPlan({
    codeMap: input.codeMap,
    assumeReadiness: input.assumeReadiness,
  });
}

function normalizeContentType(contentType: LongFormContentType): BlogGenerationRequest['contentType'] {
  // Case studies are preserved as a user-facing content type, but the current
  // generation core represents them as the blog case-study format.
  return contentType === 'case-study' ? 'blog' : contentType;
}

function buildAnswers(input: UnifiedLongFormGenerationInput, configFormat: string): Record<string, string> | undefined {
  const answers = { ...(input.answers || {}) };

  if (input.targetWordCount && !answers.target_word_count) {
    answers.target_word_count = String(input.targetWordCount);
  }

  const config = contentTypeConfig[input.contentType];
  const templateSpec = getLongFormTemplateSpec(input.contentType, configFormat, input.template_name);
  const architectureDirectives: string[] = [
    `Content type configuration: ${config.structureStyle}.`,
    `Summary style: ${config.summaryStyle}.`,
    `Citation style: ${config.citationStyle}.`,
  ];

  if (templateSpec) {
    architectureDirectives.push(
      `Template sections: ${templateSpec.sections
        .map((section) => `${section.label} (${section.intent})`)
        .join(' -> ')}`,
    );
  }

  if (input.seoContext) architectureDirectives.push(input.seoContext);

  answers.unified_long_form_architecture = architectureDirectives.join(' ');
  return Object.keys(answers).length > 0 ? answers : undefined;
}

export async function runUnifiedLongFormGeneration(
  input: UnifiedLongFormGenerationInput,
): Promise<UnifiedLongFormGenerationResult> {
  if (!isLongFormContentType(input.contentType)) {
    throw new Error(`Unsupported long-form content type: ${input.contentType}`);
  }

  const config = contentTypeConfig[input.contentType];
  const requestedFormat = input.contentType === 'case-study'
    ? 'case-study'
    : input.formatType || config.defaultFormat;
  const formatType = config.allowedFormats.includes(requestedFormat)
    ? requestedFormat
    : config.defaultFormat;
  const normalizedContentType = normalizeContentType(input.contentType);
  const traceBase = {
    engine: 'unifiedLongFormEngine' as const,
    contentType: input.contentType,
    formatType,
    templateName: input.template_name,
    targetWordCount: input.targetWordCount,
    configVersion: 'long-form-config-v1' as const,
    templateSpecApplied: Boolean(getLongFormTemplateSpec(input.contentType, formatType, input.template_name)),
  };

  const requestSummary = {
    company_id: input.company_id,
    content_type: input.contentType,
    mode: input.mode || 'full',
    topic: input.topic,
    format_type: formatType,
    target_word_count: input.targetWordCount,
    template_name: input.template_name,
  };

  // Phase 4.3 — Build grounding profile when sources are supplied. The
  // result is threaded into the planning engine; downstream factual /
  // citation / source-integrity validators consume it.
  let builtGrounding: BuiltGroundingProfile | undefined;
  if (input.groundingInput && (
    (input.groundingInput.companyBlogs?.length ?? 0) > 0
    || (input.groundingInput.internalUploads?.length ?? 0) > 0
    || (input.groundingInput.approvedUrls?.length ?? 0) > 0
    || (input.groundingInput.approvedSnippets?.length ?? 0) > 0
  )) {
    builtGrounding = buildGroundingProfile({
      ...input.groundingInput,
      recommendationId: input.groundingInput.recommendationId ?? `req_${input.company_id ?? 'anon'}_${Date.now().toString(36)}`,
      topic: input.topic,
    });
  }

  // Phase 4.9 — Burn-in mode resolution. When enabled, both engines run;
  // only the planned engine's output is returned to the caller.
  const burnIn = resolveBurnInMode(input.plannedEngineBurnIn);

  if ((input.mode || 'full') === 'full') {
    try {
      const plannedStart = Date.now();
      const planned = await runPlannedLongFormGeneration({
        ...input,
        formatType,
        groundingProfile: builtGrounding?.profile,
      });
      const contentEvaluation = planned.generation.needs_clarification === false && planned.generation.mode === 'full'
        ? evaluateLongFormContent({
            generatedContent: planned.generation.result.content_html,
            topic: input.topic,
            contentType: input.contentType,
            targetIntent: planned.searchIntent,
            engineTrace: {
              searchIntent: planned.searchIntent,
              topicEntityMap: planned.topicEntityMap,
              contentPositioning: planned.contentPositioning,
              differentiationStrategy: planned.differentiationStrategy,
              performanceInsights: planned.performanceInsights,
              contentPlan: planned.contentPlan,
            },
          })
        : undefined;

      emitEngineSelected({
        attempted_engine: 'planned-sectionwise-v1',
        final_engine: 'planned-sectionwise-v1',
        fallback_triggered: false,
        request: {
          company_id: requestSummary.company_id,
          content_type: requestSummary.content_type,
          mode: requestSummary.mode,
          topic: requestSummary.topic,
          format_type: requestSummary.format_type,
        },
      });

      // Phase 9.7 — Record the success in the shadow shutdown report so
      // bypass success rate reflects real planned-engine performance.
      {
        const successShadow = shouldBypassCompatibilityCoreForRequest({});
        if (successShadow.resolution.enabled) {
          recordShadowShutdownOutcome({
            company_id: input.company_id ?? null,
            content_type: input.contentType,
            topic: input.topic,
            bypassed: successShadow.bypass,
            planned_engine_succeeded: true,
            sample_rate: successShadow.resolution.sample_rate,
          });
        }
      }

      // Phase 4.9 — Burn-in shadow comparison. Runs ONLY if burn-in mode
      // is enabled. Compatibility-core output is NEVER returned to the
      // user — telemetry only.
      if (burnIn.enabled) {
        const plannedDuration = Date.now() - plannedStart;
        const shadowStart = Date.now();
        let compatibilityCompleted = false;
        let compatibilityDuration = 0;
        let compatibilityFailureReason: string | undefined;
        try {
          await runBlogGeneration({
            ...input,
            contentType: normalizedContentType,
            formatType: formatType as BlogGenerationRequest['formatType'],
            template_blocks: input.templateBlocks,
            answers: buildAnswers(input, formatType),
          });
          compatibilityCompleted = true;
          compatibilityDuration = Date.now() - shadowStart;
        } catch (shadowErr) {
          compatibilityDuration = Date.now() - shadowStart;
          compatibilityFailureReason = shadowErr instanceof Error ? shadowErr.message : String(shadowErr);
        }
        const snapshot: BurnInComparisonSnapshot = {
          topic: input.topic,
          content_type: input.contentType,
          planned: {
            engine: 'planned-sectionwise-v1',
            completed: true,
            duration_ms: plannedDuration,
            total_sections: planned.contentPlan?.sections?.length,
            total_retries: planned.qualityReport?.repairedSections?.length,
            avg_retries_per_section: planned.qualityReport && planned.contentPlan?.sections?.length
              ? Number((planned.qualityReport.repairedSections.length / planned.contentPlan.sections.length).toFixed(3))
              : 0,
          },
          compatibility: {
            engine: 'compatibility-core',
            completed: compatibilityCompleted,
            duration_ms: compatibilityDuration,
            failure_reason: compatibilityFailureReason,
          },
          deltas: {
            duration_ms: plannedDuration - compatibilityDuration,
            section_count: 0,
            sections_passed: 0,
            avg_retries_per_section: 0,
            completion_only_in: compatibilityCompleted ? undefined : 'planned',
          },
          observations: [
            `burn-in reason: ${burnIn.reason}`,
            ...(burnIn.sample_rate != null ? [`sample rate: ${burnIn.sample_rate}`] : []),
            `planned ms: ${plannedDuration}, compat ms: ${compatibilityDuration}`,
          ],
        };
        recordBurnInComparison(snapshot);
        accumulateBurnInComparison(snapshot);
      }

      return {
        ...planned.generation,
        engine_trace: {
          ...traceBase,
          generationLogic: 'planned-sectionwise-v1',
          attempted_engine: 'planned-sectionwise-v1',
          final_engine: 'planned-sectionwise-v1',
          fallback_triggered: false,
          searchIntent: planned.searchIntent,
          topicEntityMap: planned.topicEntityMap,
          serpStructureHints: planned.serpStructureHints,
          contentPositioning: planned.contentPositioning,
          competitorContentProfile: planned.competitorContentProfile,
          differentiationStrategy: planned.differentiationStrategy,
          contentPlan: planned.contentPlan,
          qualityReport: planned.qualityReport,
          contentScore: planned.contentScore,
          improvementHooks: planned.improvementHooks,
          performanceInsights: planned.performanceInsights,
          generatedFeatureSnapshot: planned.generatedFeatureSnapshot,
          contentEvaluation,
        },
      };
    } catch (error) {
      // Phase 1.1 — Surface silent fallbacks.
      //
      // Previously this catch logged a vague warning and continued. Now we
      // emit a structured LONGFORM_ENGINE_FALLBACK event with the original
      // error message, stack, and full request metadata before delegating
      // to the compatibility core.
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      const fallbackEvent: LongFormEngineFallbackPayload = emitEngineFallback({
        fallback_reason: errorMessage,
        fallback_stack: errorStack,
        request: requestSummary,
      });

      // Phase 7.10 — Enforcement mode ladder (replaces the binary strict
      // mode resolver). The ladder reads the same env vars (with legacy
      // STRICT_PLANNED_ENGINE_MODE → ladder mapping) plus the per-request
      // `strictPlannedEngine` override, and decides per content type
      // whether the fallback is allowed.
      const enforcementResolution = resolveEnforcementMode(input.strictPlannedEngine);
      const enforcementDecision = applyEnforcementToFallback({
        mode: enforcementResolution.mode,
        contentType: input.contentType,
      });
      if (enforcementDecision.shouldThrowOnFailure) {
        throw new Error(
          `[unifiedLongFormEngine] planned-sectionwise failed under enforcement mode ` +
          `${enforcementResolution.mode} (${enforcementResolution.reason}); content_type=${input.contentType}. ` +
          `Original error: ${errorMessage}`,
        );
      }
      // Legacy back-compat: if a caller still passes strictPlannedEngine=true
      // expecting the Phase 3.8 behavior, the ladder maps that to
      // PLANNED_REQUIRED_ALL which we already handled above. Below we keep
      // the legacy resolveStrictMode call only for telemetry symmetry.
      const strictMode = resolveStrictMode(input.strictPlannedEngine);
      if (strictMode.strict && !enforcementDecision.shouldThrowOnFailure) {
        // Defensive: the new ladder should always handle this; only happens
        // if a future ladder change demotes a content type.
        throw new Error(
          `[unifiedLongFormEngine] planned-sectionwise failed and STRICT_PLANNED_ENGINE_MODE is on ` +
          `(reason: ${strictMode.reason}). Original error: ${errorMessage}`,
        );
      }

      // Phase 9.7 — Shadow shutdown bypass: probabilistically refuse to
      // invoke the compatibility-core fallback so we measure the
      // real-traffic blast radius of removing it. When bypass is
      // active, we surface the planned-engine error to the caller AND
      // record the outcome for the dashboard.
      const shadowDecision = shouldBypassCompatibilityCoreForRequest({});
      if (shadowDecision.bypass) {
        recordShadowShutdownOutcome({
          company_id: input.company_id ?? null,
          content_type: input.contentType,
          topic: input.topic,
          bypassed: true,
          planned_engine_succeeded: false,
          sample_rate: shadowDecision.resolution.sample_rate,
        });
        throw new Error(
          `[unifiedLongFormEngine] compatibility-core shadow_shutdown bypass active ` +
          `(rate ${shadowDecision.resolution.sample_rate}, reason ${shadowDecision.resolution.reason}); ` +
          `surfacing planned-engine failure. Original error: ${errorMessage}`,
        );
      }

      // Phase 5.6 — Compatibility-core retirement simulation.
      // When simulation is on we emit a "what would have failed"
      // telemetry event BEFORE falling back. This gives operators a
      // credible projection of the strict-mode outage rate without
      // actually exposing users to failure today.
      const simulation = resolveRetirementSimulationMode();
      if (simulation.enabled) {
        emitSimulatedFailure({
          company_id: input.company_id ?? null,
          content_type: input.contentType,
          topic: input.topic,
          reason: errorMessage,
          reason_stack: errorStack,
        });
      }

      // Phase 8.10 — Collapse simulation observation: when on, record
      // what a no-compatibility-core run would have looked like.
      const collapseMode = resolveCollapseSimulationMode();
      if (collapseMode.enabled) {
        observeCollapseProjectedFailure({
          company_id: input.company_id ?? null,
          content_type: input.contentType,
          topic: input.topic,
          trigger_reason: errorMessage,
          fallback_would_have_recovered: true,
        });
      }

      // Phase 8.7 — Split compatibility-core telemetry:
      // emit LONGFORM_COMPATIBILITY_CORE_REQUEST with category +
      // failure source + retirement blocker category.
      const categorization = categorizeCompatibilityCoreRequest({
        contentType: input.contentType,
        mode: 'full',
        plannedEngineFailureReason: errorMessage,
      });
      emitCompatibilityCoreRequest({
        company_id: input.company_id ?? null,
        content_type: input.contentType,
        topic: input.topic,
        category: categorization.category,
        trigger_reason: categorization.trigger_reason,
        failure_source: categorization.failureSource,
        retirement_blocker_category: categorization.blockerCategory,
      });

      // Phase 3.8 — Emit LONGFORM_COMPATIBILITY_CORE_USAGE so operators can
      // see which content types still rely on the fallback path.
      emitCompatibilityCoreUsage({
        company_id: input.company_id ?? null,
        content_type: input.contentType,
        topic: input.topic,
        reason: 'planned_engine_failed',
        fallback_reason: errorMessage,
      });

      const result = await runBlogGeneration({
        ...input,
        contentType: normalizedContentType,
        formatType: formatType as BlogGenerationRequest['formatType'],
        template_blocks: input.templateBlocks,
        answers: buildAnswers(input, formatType),
      });

      return {
        ...result,
        engine_trace: {
          ...traceBase,
          generationLogic: 'compatibility-core',
          attempted_engine: fallbackEvent.attempted_engine,
          final_engine: fallbackEvent.final_engine,
          fallback_triggered: true,
          fallback_reason: fallbackEvent.fallback_reason,
          fallback_stack: fallbackEvent.fallback_stack,
        },
      };
    }
  }

  // Non-'full' modes (e.g. 'angles') route directly to the compatibility
  // core by design — this is not a fallback, just a different execution
  // path. We still emit a SELECTED event AND a compatibility-core-usage
  // event so the engine choice is fully observable.
  emitEngineSelected({
    attempted_engine: 'compatibility-core',
    final_engine: 'compatibility-core',
    fallback_triggered: false,
    request: {
      company_id: requestSummary.company_id,
      content_type: requestSummary.content_type,
      mode: requestSummary.mode,
      topic: requestSummary.topic,
      format_type: requestSummary.format_type,
    },
  });
  emitCompatibilityCoreUsage({
    company_id: input.company_id ?? null,
    content_type: input.contentType,
    topic: input.topic,
    reason: 'mode_not_full',
  });
  // Phase 8.7 — Split telemetry mirror for the non-'full' mode path.
  const categorizationNonFull = categorizeCompatibilityCoreRequest({
    contentType: input.contentType,
    mode: input.mode ?? 'not_full',
    plannedEngineFailureReason: null,
  });
  emitCompatibilityCoreRequest({
    company_id: input.company_id ?? null,
    content_type: input.contentType,
    topic: input.topic,
    category: categorizationNonFull.category,
    trigger_reason: categorizationNonFull.trigger_reason,
    failure_source: categorizationNonFull.failureSource,
    retirement_blocker_category: categorizationNonFull.blockerCategory,
  });

  const result = await runBlogGeneration({
    ...input,
    contentType: normalizedContentType,
    formatType: formatType as BlogGenerationRequest['formatType'],
    template_blocks: input.templateBlocks,
    answers: buildAnswers(input, formatType),
  });

  return {
    ...result,
    engine_trace: {
      ...traceBase,
      generationLogic: 'compatibility-core',
      attempted_engine: 'compatibility-core',
      final_engine: 'compatibility-core',
      fallback_triggered: false,
    },
  };
}
