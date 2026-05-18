/**
 * orchestrationContextResolver — THE unified context resolution engine.
 * Phase-2 Step-6.
 *
 * resolveUnifiedCampaignContext() is what generation (weekly/daily/AI/theme/
 * finalize) should read instead of fragmented raw sources. Read-only,
 * never throws, supports BOTH strategy-first and skeleton-first (neither
 * mandatory).
 *
 * Resolution order (deterministic):
 *   1. canonical strategy            (Step-5)
 *   2. canonical execution feed      (Step-1 adapter)
 *   3. planner snapshot              (campaign_versions.planning_context)
 *   4. skeleton snapshot             (unified blueprint weeks)
 *   5. campaign_versions snapshot    (fallback hydration)
 *   6. legacy planner state          (planning_context fields)
 *
 * Merge priority: canonical persisted > execution-enriched > planner
 * session > legacy snapshots. Builders never blank higher-quality data.
 */

import { getCampaignStrategy, getStrategyReadiness } from '../../strategy';
import { loadPlanningContextSnapshot } from '../../strategy/strategyPersistence';
import { getExecutionItems } from '../canonicalExecutionAdapter';
import { getExecutionReadinessSummary } from '../synchronization';
import { getUnifiedCampaignBlueprint } from '../../campaignBlueprintService';
import {
  buildExecutionContext,
  buildOrchestrationStateContext,
  buildOwnedContentContext,
  buildPlatformContext,
  buildSkeletonContext,
  buildStrategyContext,
} from './orchestrationContextBuilder';
import { contextDiagnostics } from './orchestrationContextDiagnostics';
import type {
  UnifiedCampaignOrchestrationContext,
  UnifiedCampaignReadiness,
} from './orchestrationContextTypes';

export async function resolveUnifiedCampaignContext(
  campaignId: string,
): Promise<UnifiedCampaignOrchestrationContext> {
  const generated_at = new Date().toISOString();
  const resolution_source: string[] = [];
  const hydrated_from: string[] = [];

  const strategy = await getCampaignStrategy(campaignId).catch(() => null);
  if (strategy) { resolution_source.push('canonical_strategy'); hydrated_from.push('canonical_strategy'); }

  const items = await getExecutionItems(campaignId).catch(() => []);
  if (items.length) { resolution_source.push('canonical_execution_feed'); hydrated_from.push('canonical_execution_feed'); }

  const planningCtx = await loadPlanningContextSnapshot(campaignId).catch(() => null);
  if (planningCtx) { resolution_source.push('campaign_versions_snapshot'); hydrated_from.push('planner_snapshot'); }

  let blueprint: { weeks?: unknown[] } | null = null;
  try {
    blueprint = (await getUnifiedCampaignBlueprint(campaignId)) as { weeks?: unknown[] } | null;
  } catch { blueprint = null; }
  if (blueprint?.weeks?.length) { resolution_source.push('skeleton_snapshot'); }

  const rollup = await getExecutionReadinessSummary(campaignId).catch(() => null);

  const strategy_context = buildStrategyContext(strategy, planningCtx);
  const skeleton_context = buildSkeletonContext(blueprint, items, planningCtx);
  const execution_context = buildExecutionContext(items, strategy);
  const owned_content_context = buildOwnedContentContext(strategy);
  const platform_context = buildPlatformContext(strategy, skeleton_context);

  const blockers: string[] = [];
  if (rollup) for (const [k, n] of Object.entries(rollup.blocking_reasons)) blockers.push(`${k}:${n}`);
  const orchestration_state = buildOrchestrationStateContext(
    rollup ? { average_readiness: rollup.average_readiness, ready: rollup.ready, blocked: rollup.blocked } : null,
    blockers,
    rollup,
  );

  const strategy_presence = Boolean(
    strategy || (strategy_context.themes && (strategy_context.themes as unknown[]).length) || strategy_context.objective,
  );
  const skeleton_presence = Boolean(
    (skeleton_context.weeks && (skeleton_context.weeks as unknown[]).length) || items.length,
  );
  const flow_shape =
    strategy_presence && skeleton_presence ? 'converged'
    : strategy_presence ? 'strategy-first'
    : skeleton_presence ? 'skeleton-first'
    : 'empty';

  const owned_content_count =
    (owned_content_context.reusable_assets?.length ?? 0) +
    (owned_content_context.external_sources?.length ?? 0) +
    (owned_content_context.upload_sources?.length ?? 0);

  if (resolution_source.length === 0) {
    contextDiagnostics.fallback({ campaign_id: campaignId, fallback_reason: 'no_sources_present' });
  }
  contextDiagnostics.hydrate({ campaign_id: campaignId, hydrated_from });
  contextDiagnostics.merge({
    campaign_id: campaignId,
    merge_priority: ['canonical_strategy', 'canonical_execution_feed', 'planner_snapshot', 'skeleton_snapshot', 'legacy_snapshot'],
  });
  contextDiagnostics.resolve({
    campaign_id: campaignId,
    resolution_sources: resolution_source,
    owned_content_count,
    strategy_presence,
    skeleton_presence,
    flow_shape,
  });

  return {
    campaign_id: campaignId,
    strategy_context,
    skeleton_context,
    execution_context,
    owned_content_context,
    platform_context,
    orchestration_state,
    metadata: {
      resolution_source,
      hydrated_from,
      generated_at,
      strategy_presence,
      skeleton_presence,
      owned_content_count,
      flow_shape,
    },
  };
}

/** Convenience for generation entrypoints: resolve + log [GENERATION_CONTEXT]. */
export async function resolveGenerationContext(
  campaignId: string,
  entrypoint: string,
): Promise<UnifiedCampaignOrchestrationContext | null> {
  if (!campaignId) return null;
  try {
    const ctx = await resolveUnifiedCampaignContext(campaignId);
    contextDiagnostics.generation({
      campaign_id: campaignId,
      entrypoint,
      resolution_sources: ctx.metadata.resolution_source,
      flow_shape: ctx.metadata.flow_shape,
      strategy_presence: ctx.metadata.strategy_presence,
      skeleton_presence: ctx.metadata.skeleton_presence,
      owned_content_count: ctx.metadata.owned_content_count,
    });
    return ctx;
  } catch {
    return null;
  }
}

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export async function getUnifiedCampaignReadiness(
  campaignId: string,
): Promise<UnifiedCampaignReadiness> {
  const generated_at = new Date().toISOString();
  const strat = await getStrategyReadiness(campaignId).catch(() => ({ ready: false, readiness_score: 0, blocking_reasons: ['NO_STRATEGY'] }));
  const rollup = await getExecutionReadinessSummary(campaignId).catch(() => null);
  const ctx = await resolveUnifiedCampaignContext(campaignId).catch(() => null);

  const execScore = rollup ? rollup.average_readiness : 0;
  const execBlockers = rollup && rollup.blocked > 0 ? [`EXECUTION_BLOCKED:${rollup.blocked}`] : [];

  const scheduledRatio = rollup && rollup.total > 0 ? rollup.scheduled / rollup.total : 0;
  const schedScore = clampScore(scheduledRatio * 100);
  const schedBlockers = rollup && rollup.failed > 0 ? [`SCHEDULING_FAILED:${rollup.failed}`] : [];

  const oc = ctx?.owned_content_context;
  const ocCount = (oc?.reusable_assets?.length ?? 0) + (oc?.external_sources?.length ?? 0) + (oc?.upload_sources?.length ?? 0);
  const ocScore = ocCount > 0 ? 100 : 100; // owned content is optional → non-blocking
  const ocBlockers: string[] = [];

  const enabled = ctx?.platform_context?.enabled_platforms?.length ?? 0;
  const platScore = enabled > 0 ? 100 : 0;
  const platBlockers = enabled > 0 ? [] : ['NO_ENABLED_PLATFORMS'];

  const components = {
    strategy: { score: clampScore(strat.readiness_score), blockers: strat.blocking_reasons ?? [] },
    execution: { score: clampScore(execScore), blockers: execBlockers },
    scheduling: { score: schedScore, blockers: schedBlockers },
    owned_content: { score: ocScore, blockers: ocBlockers },
    platform: { score: platScore, blockers: platBlockers },
  };
  const readiness_score = clampScore(
    (components.strategy.score + components.execution.score + components.scheduling.score +
      components.owned_content.score + components.platform.score) / 5,
  );
  const blocking_reasons = [
    ...components.strategy.blockers,
    ...components.execution.blockers,
    ...components.scheduling.blockers,
    ...components.platform.blockers,
  ];
  return {
    ready: blocking_reasons.length === 0,
    readiness_score,
    components,
    blocking_reasons,
    generated_at,
  };
}

export const orchestrationContextResolver = {
  resolveUnifiedCampaignContext,
  resolveGenerationContext,
  getUnifiedCampaignReadiness,
};
