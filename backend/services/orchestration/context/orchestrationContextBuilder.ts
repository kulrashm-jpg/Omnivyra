/**
 * orchestrationContextBuilder — pure sub-context builders (Phase-2 Step-6).
 * No I/O. The resolver owns fetching and passes raw sources in.
 */

import type { CampaignStrategy } from '../../../types/strategy/CampaignStrategy';
import type { CanonicalExecutionItem } from '../../../types/orchestration/CanonicalExecutionItem';
import type {
  UnifiedExecutionContext,
  UnifiedOrchestrationStateContext,
  UnifiedOwnedContentContext,
  UnifiedPlatformContext,
  UnifiedSkeletonContext,
  UnifiedStrategyContext,
} from './orchestrationContextTypes';

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export function buildStrategyContext(
  strategy: CampaignStrategy | null,
  planningCtx: Record<string, unknown> | null,
): UnifiedStrategyContext {
  if (strategy) {
    return {
      strategy_id: strategy.strategy_id,
      objective: strategy.objective,
      audiences: [strategy.target_audience, ...(strategy.audience_segments ?? [])],
      messaging: strategy.key_messaging ?? [],
      themes: strategy.campaign_themes ?? [],
      pillars: strategy.content_pillars ?? [],
      owned_content: strategy.owned_content_sources ?? [],
    };
  }
  const pc = obj(planningCtx);
  const sc = obj(pc.strategy_context);
  const spine = obj(pc.idea_spine);
  return {
    strategy_id: undefined,
    objective:
      String(sc.campaign_goal ?? spine.refined_title ?? spine.title ?? '') || undefined,
    audiences: sc.target_audience ? [sc.target_audience] : [],
    messaging: sc.key_message ? [{ message: sc.key_message }] : [],
    themes: arr(pc.strategic_themes),
    pillars: [],
    owned_content: [],
  };
}

export function buildSkeletonContext(
  blueprint: { weeks?: unknown[] } | null,
  items: CanonicalExecutionItem[],
  planningCtx: Record<string, unknown> | null,
): UnifiedSkeletonContext {
  const pc = obj(planningCtx);
  const sc = obj(pc.strategy_context);
  const weeks = arr(blueprint?.weeks);
  const platformsFromItems = [...new Set(items.map((i) => i.platform).filter(Boolean))];
  const platforms = platformsFromItems.length
    ? platformsFromItems
    : arr(sc.platforms);
  const contentMix =
    (arr(sc.content_formats).length ? arr(sc.content_formats) : arr(sc.content_mix));
  return {
    weeks: weeks.length ? weeks : undefined,
    frequency: (sc.posting_frequency as Record<string, unknown>) ?? null,
    platforms,
    content_mix: contentMix.length ? contentMix : undefined,
    slot_distribution: items.length
      ? items.reduce<Record<string, number>>((acc, i) => {
          acc[i.week_id] = (acc[i.week_id] ?? 0) + 1;
          return acc;
        }, {})
      : undefined,
  };
}

export function buildExecutionContext(
  items: CanonicalExecutionItem[],
  strategy: CampaignStrategy | null,
): UnifiedExecutionContext {
  return {
    routing_defaults: null,
    execution_preferences: strategy?.ai_generation_preferences ?? null,
    scheduling_preferences: { posting_philosophy: strategy?.posting_philosophy ?? null },
    item_count: items.length,
  };
}

export function buildOwnedContentContext(
  strategy: CampaignStrategy | null,
): UnifiedOwnedContentContext {
  const sources = strategy?.owned_content_sources ?? [];
  const reusable = sources.filter((s) => s.reusable);
  const external = sources.filter((s) =>
    ['BLOG_URL', 'VIDEO_URL', 'DRIVE_LINK', 'EMBEDDED_ASSET'].includes(s.source_type),
  );
  const uploads = sources.filter((s) =>
    ['PDF', 'IMAGE', 'DOCUMENT', 'UPLOADED_ASSET'].includes(s.source_type),
  );
  return { reusable_assets: reusable, external_sources: external, upload_sources: uploads };
}

export function buildPlatformContext(
  strategy: CampaignStrategy | null,
  skeleton: UnifiedSkeletonContext,
): UnifiedPlatformContext {
  const fromStrategy = (strategy?.platform_strategy ?? []).map((p) => p.platform);
  const enabled = fromStrategy.length ? fromStrategy : (skeleton.platforms ?? []);
  return {
    enabled_platforms: enabled,
    platform_rules: strategy?.platform_strategy ?? [],
    publishing_constraints: [],
  };
}

export function buildOrchestrationStateContext(
  readiness: unknown,
  blockers: string[],
  executionSummary: unknown,
): UnifiedOrchestrationStateContext {
  return { readiness, blockers, execution_summary: executionSummary };
}
