/**
 * Variant Operational Diagnostics (Phases 2-6 + 9 — production hardening).
 *
 * READ-ONLY surface that aggregates state from the existing in-memory
 * trackers and recorders into structured diagnostic payloads:
 *
 *   - getVariantDiagnostics(scope) — Phase 2: per-strategy diagnostic
 *     dump for troubleshooting (strategy id, variants, recent winner,
 *     active experiment refs).
 *
 *   - getExperimentHealth(scope) — Phase 3: active / completed /
 *     stalled / failed counts derived from the in-memory tracker.
 *
 *   - getAnalyticsHealth(scope) — Phase 4: lightweight liveness probe
 *     per analytics subsystem (recorder buffer non-empty,
 *     aggregator returns ≥ 1 strategy, winner engine returns ≥ 1
 *     decision, etc.).
 *
 *   - traceAssetAttribution(scope, scheduledPostId) — Phase 5:
 *     walks asset → strategy → variant → experiment chain for one
 *     scheduled_post.
 *
 *   - getOrphanReport(scope) — Phase 6: detects experiments without
 *     assets, variants without analytics, etc. REPORT-ONLY — does
 *     NOT mutate state.
 *
 *   - getCreatorPlatformHealth(scope) — Phase 9: combined health
 *     summary across generation, analytics, experiments, publishing,
 *     tracking.
 *
 * Pure read functions. No I/O outside the existing in-memory stores
 * + the existing attribution resolver. No new endpoints baked in
 * here — the HTTP layer just renders these payloads.
 */

import {
  type StrategyAnalyticsEvent,
  getStrategyEventsForScope,
  strategyAnalyticsRecorderStats,
} from './strategyAnalyticsRecorder';
import {
  aggregateStrategyPerformance,
  aggregateVariantPerformance,
  buildStrategyLeaderboard,
  type StrategyAggregationScope,
} from './strategyPerformanceAggregator';
import { detectVariantWinnersForAllStrategies } from './variantWinnerEngine';
import {
  experimentTrackerStats,
  listExperiments,
  type ExperimentLifecycleState,
  type ExperimentRecord,
} from './variantExperimentTracker';
import { listAllVariants } from './variantRegistry';
import {
  listAllStrategyAnalyticsDimensions,
} from './strategyAnalyticsRegistry';
import { resolveStrategyAttributionForScheduledPost } from './strategyAttributionResolver';
import { strategyAnalyticsRuntimeStats } from './strategyAnalyticsRuntime';
import { summarizeAllCategories, type CategorySummary } from './variantPerformanceTelemetry';
import { variantDiagnosticsPersistenceStatus } from './variantDiagnosticsRedisPersistence';

/* ── Phase 2: per-strategy diagnostics ─────────────────────────── */

export type VariantStrategyDiagnostic = {
  strategy_id: string;
  strategy_family: string;
  content_type: string;
  declared_variants: Array<{ variant_id: string; variant_family: string }>;
  observed_variant_ids: string[];
  sample_size: number;
  active_experiment_ids: string[];
  declared_winner_variant_id: string | null;
  declared_winner_delta: number | null;
  declared_winner_confidence: string | null;
};

export function getVariantDiagnostics(scope: {
  companyId: string;
  window?: '7d' | '30d' | '90d' | 'all_time';
}): VariantStrategyDiagnostic[] {
  const w = scope.window ?? '30d';
  const dims = listAllStrategyAnalyticsDimensions();
  const allVariants = listAllVariants();
  const allVariantPerf = aggregateVariantPerformance({ companyId: scope.companyId, window: w });
  const allStrategyPerf = aggregateStrategyPerformance({ companyId: scope.companyId, window: w });
  const winners = detectVariantWinnersForAllStrategies({ companyId: scope.companyId, window: w });
  const winnerByStrategy = new Map(winners.map((w) => [w.strategy_id, w]));
  const activeExperiments = listExperiments({ companyId: scope.companyId, state: 'active' });
  return dims.map((dim) => {
    const declared = allVariants.filter((v) => v.strategy_id === dim.strategy_id);
    const observed = allVariantPerf
      .filter((v) => v.strategy_id === dim.strategy_id)
      .map((v) => v.variant_id);
    const sample = allStrategyPerf.find((p) => p.strategy_id === dim.strategy_id)?.metrics.sampleSize ?? 0;
    const expsForStrategy = activeExperiments
      .filter((e) => e.strategy_id === dim.strategy_id)
      .map((e) => e.experiment_id);
    const winner = winnerByStrategy.get(dim.strategy_id) ?? null;
    return {
      strategy_id: dim.strategy_id,
      strategy_family: dim.strategy_family,
      content_type: dim.content_type,
      declared_variants: declared.map((v) => ({ variant_id: v.variant_id, variant_family: v.variant_family })),
      observed_variant_ids: observed,
      sample_size: sample,
      active_experiment_ids: expsForStrategy,
      declared_winner_variant_id: winner && !winner.insufficientData ? winner.winner?.variant_id ?? null : null,
      declared_winner_delta: winner && !winner.insufficientData ? winner.delta : null,
      declared_winner_confidence: winner && !winner.insufficientData ? winner.confidence : null,
    };
  });
}

/* ── Phase 3: experiment health ───────────────────────────────── */

export type ExperimentHealthSummary = {
  active: number;
  completed: number;
  stalled: number;
  failed: number;
  totalCreatedInScope: number;
  byState: Record<ExperimentLifecycleState, number>;
  /** Experiments whose state hasn't advanced in over the stall
   *  threshold AND aren't 'completed'. */
  stalledIds: string[];
};

/**
 * Stall threshold — an experiment that hasn't seen an `updatedAt`
 * advance for this many ms while remaining non-completed is flagged
 * as stalled. 24 hours by default.
 */
const STALL_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export function getExperimentHealth(scope: { companyId: string }): ExperimentHealthSummary {
  const all = listExperiments({ companyId: scope.companyId, state: 'all' });
  const byState: Record<ExperimentLifecycleState, number> = {
    created: 0, generated: 0, published: 0, engaged: 0, completed: 0,
  };
  let stalled = 0;
  const stalledIds: string[] = [];
  let failed = 0;
  const now = Date.now();
  for (const exp of all) {
    byState[exp.state] = (byState[exp.state] ?? 0) + 1;
    if (exp.state !== 'completed') {
      const updated = Date.parse(exp.updatedAt);
      if (Number.isFinite(updated) && now - updated > STALL_THRESHOLD_MS) {
        stalled += 1;
        stalledIds.push(exp.experiment_id);
      }
    }
    // Failed = every asset is in 'created' state, the experiment is
    // older than the stall threshold (otherwise it's still in-flight),
    // and the entry isn't a lightweight 'tracking' bookkeeping record.
    // Final Corrective Pass — P2-3 / P2-4: ageing + tracking-type guard
    // prevents fresh entries + lightweight records being misclassified.
    if (
      exp.state === 'created'
      && exp.assets.length > 0
      && exp.assets.every((a) => a.state === 'created')
      && exp.tracking_type !== 'tracking'
    ) {
      const createdAt = Date.parse(exp.createdAt);
      const ageMs = Number.isFinite(createdAt) ? now - createdAt : 0;
      if (ageMs > STALL_THRESHOLD_MS) {
        failed += 1;
      }
    }
  }
  const active = all.filter((e) => e.state !== 'completed').length;
  const completed = byState.completed;
  return {
    active,
    completed,
    stalled,
    failed,
    totalCreatedInScope: all.length,
    byState,
    stalledIds,
  };
}

/* ── Phase 4: analytics health ─────────────────────────────────── */

export type AnalyticsSubsystemStatus =
  | { name: string; status: 'ok'; detail?: string }
  | { name: string; status: 'degraded'; detail: string }
  | { name: string; status: 'inert'; detail: string };

export type AnalyticsHealth = {
  subsystems: AnalyticsSubsystemStatus[];
  recorder_stats: ReturnType<typeof strategyAnalyticsRecorderStats>;
  runtime_stats: ReturnType<typeof strategyAnalyticsRuntimeStats>;
};

export function getAnalyticsHealth(scope: { companyId: string }): AnalyticsHealth {
  const recorderStats = strategyAnalyticsRecorderStats();
  const runtimeStats = strategyAnalyticsRuntimeStats();
  const eventsInScope = scope.companyId
    ? getStrategyEventsForScope({ companyId: scope.companyId }).length
    : 0;
  const strategyAgg = scope.companyId
    ? aggregateStrategyPerformance({ companyId: scope.companyId, window: '30d' })
    : [];
  const variantAgg = scope.companyId
    ? aggregateVariantPerformance({ companyId: scope.companyId, window: '30d' })
    : [];
  const winners = scope.companyId
    ? detectVariantWinnersForAllStrategies({ companyId: scope.companyId, window: '30d' })
    : [];
  const subsystems: AnalyticsSubsystemStatus[] = [
    {
      name: 'strategy_analytics_recorder',
      status: recorderStats.orgCount > 0 ? 'ok' : 'inert',
      detail: `${recorderStats.orgCount} org buffer(s) · ${recorderStats.totalEvents} events`,
    },
    {
      name: 'event_ingestion_runtime',
      status: runtimeStats.dedupSize > 0 ? 'ok' : 'inert',
      detail: `${runtimeStats.dedupSize} dedup entries`,
    },
    {
      name: 'strategy_aggregation',
      status: scope.companyId
        ? (strategyAgg.length > 0 ? 'ok' : 'inert')
        : 'inert',
      detail: scope.companyId
        ? `${strategyAgg.length} strategies aggregated (${eventsInScope} events in scope)`
        : 'no companyId supplied',
    },
    {
      name: 'variant_aggregation',
      status: scope.companyId
        ? (variantAgg.length > 0 ? 'ok' : 'inert')
        : 'inert',
      detail: scope.companyId
        ? `${variantAgg.length} variants aggregated`
        : 'no companyId supplied',
    },
    {
      name: 'winner_engine',
      status: scope.companyId
        ? (winners.filter((w) => !w.insufficientData).length > 0 ? 'ok' : 'inert')
        : 'inert',
      detail: scope.companyId
        ? `${winners.filter((w) => !w.insufficientData).length} of ${winners.length} strategies have a declared winner`
        : 'no companyId supplied',
    },
  ];
  return { subsystems, recorder_stats: recorderStats, runtime_stats: runtimeStats };
}

/* ── Phase 5: attribution trace ────────────────────────────────── */

export type AttributionTrace = {
  scheduled_post_id: string;
  resolved: boolean;
  attribution: {
    strategy_id: string | null;
    strategy_family: string | null;
    content_type: string | null;
    variant_id: string | null;
    variant_family: string | null;
    company_id: string | null;
    campaign_id: string | null;
  };
  experiments_referenced: Array<{
    experiment_id: string;
    strategy_id: string;
    variant_id: string;
    asset_state: ExperimentLifecycleState;
  }>;
  recent_events_in_scope: number;
  leaderboard_rank: number | null;
};

export async function traceAssetAttribution(input: {
  scheduledPostId: string;
}): Promise<AttributionTrace> {
  const attribution = await resolveStrategyAttributionForScheduledPost(input.scheduledPostId);
  if (!attribution) {
    return {
      scheduled_post_id: input.scheduledPostId,
      resolved: false,
      attribution: {
        strategy_id: null, strategy_family: null, content_type: null,
        variant_id: null, variant_family: null,
        company_id: null, campaign_id: null,
      },
      experiments_referenced: [],
      recent_events_in_scope: 0,
      leaderboard_rank: null,
    };
  }
  const expsForCompany = attribution.companyId
    ? listExperiments({ companyId: attribution.companyId, state: 'all' })
    : [];
  const referenced = expsForCompany
    .map((exp): { experiment_id: string; strategy_id: string; variant_id: string; asset_state: ExperimentLifecycleState } | null => {
      const asset = exp.assets.find((a) => a.variant_id === attribution.variantId);
      return asset
        ? {
            experiment_id: exp.experiment_id,
            strategy_id: exp.strategy_id,
            variant_id: attribution.variantId!,
            asset_state: asset.state,
          }
        : null;
    })
    .filter((x): x is { experiment_id: string; strategy_id: string; variant_id: string; asset_state: ExperimentLifecycleState } => x !== null);
  const events: ReadonlyArray<StrategyAnalyticsEvent> = attribution.companyId
    ? getStrategyEventsForScope({
        companyId: attribution.companyId,
        contentType: attribution.dimensions.content_type,
      })
    : [];
  let leaderboardRank: number | null = null;
  if (attribution.companyId && attribution.dimensions.content_type) {
    const leaderboard = buildStrategyLeaderboard({
      companyId: attribution.companyId,
      contentType: attribution.dimensions.content_type,
      window: '30d',
    });
    const found = leaderboard.find((entry) => entry.strategy_id === attribution.dimensions.strategy_id);
    leaderboardRank = found?.rank ?? null;
  }
  return {
    scheduled_post_id: input.scheduledPostId,
    resolved: true,
    attribution: {
      strategy_id: attribution.dimensions.strategy_id,
      strategy_family: attribution.dimensions.strategy_family,
      content_type: attribution.dimensions.content_type,
      variant_id: attribution.variantId,
      variant_family: attribution.variantFamily,
      company_id: attribution.companyId,
      campaign_id: attribution.campaignId,
    },
    experiments_referenced: referenced,
    recent_events_in_scope: events.length,
    leaderboard_rank: leaderboardRank,
  };
}

/* ── Phase 6: orphan detection ────────────────────────────────── */

export type OrphanReport = {
  experiments_without_assets: Array<{ experiment_id: string; strategy_id: string }>;
  assets_without_strategy_metadata: Array<{ experiment_id: string; variant_id: string }>;
  variants_without_analytics: string[];
  analytics_without_known_strategy: string[];
  /** Final Corrective Pass — P2-3. Threshold applied (ms) to suppress
   *  noise from freshly-registered experiments that haven't completed
   *  generation yet. Configurable via VARIANT_ORPHAN_THRESHOLD_MS env. */
  applied_threshold_ms: number;
};

/**
 * Orphan threshold. Assets / experiments newer than this are NOT
 * reported as orphaned — they likely just haven't completed
 * generation yet. Default 15 minutes; override with
 * VARIANT_ORPHAN_THRESHOLD_MS env (clamped to [60_000, 24h]).
 */
const ORPHAN_THRESHOLD_DEFAULT_MS = 15 * 60 * 1000;
const ORPHAN_THRESHOLD_MIN_MS = 60_000;
const ORPHAN_THRESHOLD_MAX_MS = 24 * 60 * 60 * 1000;

function resolveOrphanThresholdMs(): number {
  const raw = process.env.VARIANT_ORPHAN_THRESHOLD_MS;
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) {
      return Math.max(ORPHAN_THRESHOLD_MIN_MS, Math.min(ORPHAN_THRESHOLD_MAX_MS, n));
    }
  }
  return ORPHAN_THRESHOLD_DEFAULT_MS;
}

export function getOrphanReport(scope: { companyId: string; thresholdMs?: number }): OrphanReport {
  const exps = listExperiments({ companyId: scope.companyId, state: 'all' });
  const variantPerf = aggregateVariantPerformance({ companyId: scope.companyId, window: 'all_time' });
  const knownStrategyIds = new Set(listAllStrategyAnalyticsDimensions().map((d) => d.strategy_id));
  const observedVariantIds = new Set(variantPerf.map((v) => v.variant_id));

  // Final Corrective Pass — P2-3. Apply threshold so freshly-registered
  // experiments aren't flagged as orphaned until their assets have had
  // time to land. Default 15 min; can be overridden per-call (testing).
  const thresholdMs = typeof scope.thresholdMs === 'number' && scope.thresholdMs >= 0
    ? Math.max(ORPHAN_THRESHOLD_MIN_MS, Math.min(ORPHAN_THRESHOLD_MAX_MS, scope.thresholdMs))
    : resolveOrphanThresholdMs();
  const now = Date.now();

  const experimentsWithoutAssets: Array<{ experiment_id: string; strategy_id: string }> = [];
  const assetsWithoutStrategyMetadata: Array<{ experiment_id: string; variant_id: string }> = [];
  for (const exp of exps) {
    const createdAt = Date.parse(exp.createdAt);
    const ageMs = Number.isFinite(createdAt) ? now - createdAt : Infinity;
    if (exp.assets.length === 0) {
      if (ageMs > thresholdMs) {
        experimentsWithoutAssets.push({ experiment_id: exp.experiment_id, strategy_id: exp.strategy_id });
      }
      continue;
    }
    for (const a of exp.assets) {
      // An asset is "without strategy metadata" when its tracker
      // entry never advanced past 'created' AND no asset_id was set —
      // AND it is older than the orphan threshold. The age guard
      // suppresses noise from in-flight generations.
      if (a.state === 'created' && a.asset_id === null && ageMs > thresholdMs) {
        assetsWithoutStrategyMetadata.push({ experiment_id: exp.experiment_id, variant_id: a.variant_id });
      }
    }
  }
  const declaredVariants = listAllVariants();
  const variantsWithoutAnalytics = declaredVariants
    .filter((v) => !observedVariantIds.has(v.variant_id))
    .map((v) => v.variant_id);
  // Analytics events whose variant id isn't in the declared registry —
  // happens when a future variant was sent through the recorder before
  // the registry was updated. None expected in steady-state.
  const analyticsStrategies = new Set(
    aggregateStrategyPerformance({ companyId: scope.companyId, window: 'all_time' })
      .map((p) => p.strategy_id),
  );
  const analyticsWithoutKnownStrategy = [...analyticsStrategies].filter((id) => !knownStrategyIds.has(id));
  return {
    experiments_without_assets: experimentsWithoutAssets,
    assets_without_strategy_metadata: assetsWithoutStrategyMetadata,
    variants_without_analytics: variantsWithoutAnalytics,
    analytics_without_known_strategy: analyticsWithoutKnownStrategy,
    applied_threshold_ms: thresholdMs,
  };
}

/* ── Phase 9: combined platform health ─────────────────────────── */

export type CreatorPlatformHealth = {
  generation: { status: 'ok' | 'inert'; detail: string; samples: CategorySummary };
  analytics: { status: 'ok' | 'degraded' | 'inert'; subsystems: AnalyticsSubsystemStatus[] };
  experiments: { status: 'ok' | 'attention' | 'inert'; summary: ExperimentHealthSummary };
  publishing: { status: 'ok' | 'inert'; samples: CategorySummary };
  tracking: { status: 'ok' | 'inert'; recorded_events: number };
  telemetry: { categories: CategorySummary[] };
  /** Final Corrective Pass — P2-5. Cross-replica diagnostic
   *  persistence status. Read-only — surfaced so operators can verify
   *  the Redis mirror is healthy. */
  diagnostics_persistence: ReturnType<typeof variantDiagnosticsPersistenceStatus>;
};

export function getCreatorPlatformHealth(scope: { companyId: string }): CreatorPlatformHealth {
  const telemetry = summarizeAllCategories();
  const generation = telemetry.find((t) => t.category === 'generation')!;
  const fanOut = telemetry.find((t) => t.category === 'fan_out')!;
  const analytics = getAnalyticsHealth(scope);
  const experimentHealth = getExperimentHealth(scope);
  const recorder = strategyAnalyticsRecorderStats();
  const anySubsystemDegraded = analytics.subsystems.some((s) => s.status === 'degraded');
  const noSubsystemOk = analytics.subsystems.every((s) => s.status !== 'ok');
  return {
    generation: {
      status: generation.sampleCount > 0 ? 'ok' : 'inert',
      detail: generation.sampleCount > 0
        ? `${generation.sampleCount} samples · p50 ${generation.p50Ms?.toFixed(0) ?? '—'}ms`
        : 'no generation activity yet',
      samples: generation,
    },
    analytics: {
      status: anySubsystemDegraded ? 'degraded' : (noSubsystemOk ? 'inert' : 'ok'),
      subsystems: analytics.subsystems,
    },
    experiments: {
      status: experimentHealth.stalled > 0
        ? 'attention'
        : (experimentHealth.totalCreatedInScope === 0 ? 'inert' : 'ok'),
      summary: experimentHealth,
    },
    publishing: {
      status: fanOut.sampleCount > 0 ? 'ok' : 'inert',
      samples: fanOut,
    },
    tracking: {
      status: recorder.totalEvents > 0 ? 'ok' : 'inert',
      recorded_events: recorder.totalEvents,
    },
    telemetry: { categories: telemetry },
    diagnostics_persistence: variantDiagnosticsPersistenceStatus(),
  };
}

/* ── Re-exports for the HTTP layer ─────────────────────────────── */

export {
  experimentTrackerStats,
  type ExperimentRecord,
  type ExperimentLifecycleState,
  type StrategyAggregationScope,
};
