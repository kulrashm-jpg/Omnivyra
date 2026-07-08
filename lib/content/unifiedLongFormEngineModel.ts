/** Part 1/2 of unifiedLongFormEngine.ts — verbatim split (barrel preserved; importers unchanged). */
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
import {
  buildOrganizationPerspective,
  type OrganizationPerspective,
} from '../../backend/services/longForm/organizationPerspectiveEngine';
import {
  evaluateThoughtLeadershipQuality,
  ThoughtLeadershipQualityGateError,
  type ThoughtLeadershipQualityReport,
} from '../../backend/services/longForm/thoughtLeadershipQualityGate';


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
  organizationPerspective?: OrganizationPerspective;
  thoughtLeadershipQuality?: ThoughtLeadershipQualityReport;
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

export function resolveStrictMode(
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
