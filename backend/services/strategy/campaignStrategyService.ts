/**
 * campaignStrategyService — canonical server-side strategy orchestration.
 * Phase-2 Step-5. Additive, compatibility-first, never throws/blocks.
 */

import {
  loadActiveStrategy,
  loadPlanningContextSnapshot,
  saveStrategySnapshot,
  countStrategyVersions,
} from './strategyPersistence';
import { mapToCampaignStrategy, type StrategyHydrationInputs } from './strategyMapper';
import { strategyDiagnostics } from './strategyDiagnostics';
import { getExecutionItems } from '../orchestration';
import type { CampaignStrategy, ExecutionStrategyLink } from '../../types/strategy/CampaignStrategy';

export interface GetOrCreateArgs {
  campaignId: string;
  source?: CampaignStrategy['orchestration_metadata']['source'];
  inputs?: StrategyHydrationInputs;
}

/**
 * Hydrate the active canonical strategy or progressively create one.
 * Resolution order: active canonical → provided planner inputs →
 * campaign_versions planning_context snapshot. Persist is best-effort.
 */
export async function getOrCreateCampaignStrategy(
  args: GetOrCreateArgs,
): Promise<CampaignStrategy | null> {
  const { campaignId } = args;
  if (!campaignId) return null;

  const existing = await loadActiveStrategy(campaignId);
  if (existing) {
    strategyDiagnostics.hydrated({
      campaign_id: campaignId,
      strategy_id: existing.strategy_id,
      version: existing.version,
      source: existing.orchestration_metadata?.source,
      hydrated_from: 'canonical',
      linkage_count: existing.campaign_themes?.length ?? 0,
      owned_content_count: existing.owned_content_sources?.length ?? 0,
    });
    return existing;
  }

  let inputs = args.inputs;
  let hydratedFrom: 'planner_handoff' | 'campaign_versions_snapshot' = 'planner_handoff';
  if (!inputs || Object.keys(inputs).length === 0) {
    const pc = await loadPlanningContextSnapshot(campaignId);
    if (pc) {
      hydratedFrom = 'campaign_versions_snapshot';
      inputs = {
        idea_spine: (pc.idea_spine as Record<string, unknown>) ?? null,
        strategy_context: (pc.strategy_context as Record<string, unknown>) ?? null,
        strategic_themes: Array.isArray(pc.strategic_themes) ? (pc.strategic_themes as Array<Record<string, unknown>>) : null,
        strategic_card: (pc.strategic_card as Record<string, unknown>) ?? null,
      };
    }
  }
  if (!inputs) inputs = {};

  const priorVersions = await countStrategyVersions(campaignId);
  const strategy = mapToCampaignStrategy(
    campaignId,
    priorVersions + 1,
    args.source ?? 'hydrated',
    inputs,
  );

  const persist = await saveStrategySnapshot(campaignId, strategy);
  strategyDiagnostics.created({
    campaign_id: campaignId,
    strategy_id: strategy.strategy_id,
    version: strategy.version,
    source: strategy.orchestration_metadata.source,
    linkage_count: strategy.campaign_themes.length,
    owned_content_count: strategy.owned_content_sources.length,
  });
  strategyDiagnostics.versioned({
    campaign_id: campaignId,
    strategy_id: strategy.strategy_id,
    version: strategy.version,
    source: persist.persisted ? 'persisted' : `not_persisted:${persist.reason ?? 'unknown'}`,
  });
  strategyDiagnostics.hydrated({
    campaign_id: campaignId,
    strategy_id: strategy.strategy_id,
    version: strategy.version,
    hydrated_from: hydratedFrom,
  });
  return strategy;
}

export async function getCampaignStrategy(campaignId: string): Promise<CampaignStrategy | null> {
  return loadActiveStrategy(campaignId);
}

export interface StrategyExecutionContext {
  strategy: CampaignStrategy | null;
  links: Array<{ execution_id: string; link: ExecutionStrategyLink }>;
  summary: { linkage_count: number; themes: number; owned_content: number };
}

/**
 * Strategy ↔ execution linkage, read-derived: join canonical execution
 * items to strategy themes by week. Provides downstream orchestration
 * visibility without mutating execution writes (write-time stamping
 * deferred — the optional CanonicalExecutionItem.strategy_link field exists
 * for that future step).
 */
export async function getStrategyExecutionContext(
  campaignId: string,
): Promise<StrategyExecutionContext> {
  const strategy = await loadActiveStrategy(campaignId);
  if (!strategy) {
    return { strategy: null, links: [], summary: { linkage_count: 0, themes: 0, owned_content: 0 } };
  }
  const themeByWeek = new Map<number, (typeof strategy.campaign_themes)[number]>();
  for (const t of strategy.campaign_themes) if (typeof t.week === 'number') themeByWeek.set(t.week, t);

  const items = await getExecutionItems(campaignId);
  const links: Array<{ execution_id: string; link: ExecutionStrategyLink }> = [];
  for (const it of items) {
    const wk = Number(String(it.week_id).replace(/^wk/, '')) || 0;
    const theme = themeByWeek.get(wk);
    links.push({
      execution_id: it.execution_id,
      link: {
        strategy_id: strategy.strategy_id,
        strategy_version: strategy.version,
        theme_id: theme?.id ?? null,
        theme_title: theme?.title ?? it.theme ?? null,
        messaging_pillar_id: theme?.messaging_pillar_id ?? null,
        content_pillar_id: theme?.content_pillar_id ?? null,
      },
    });
  }
  strategyDiagnostics.linked({
    campaign_id: campaignId,
    strategy_id: strategy.strategy_id,
    version: strategy.version,
    linkage_count: links.length,
  });
  strategyDiagnostics.contextSync({
    campaign_id: campaignId,
    strategy_id: strategy.strategy_id,
    version: strategy.version,
    linkage_count: links.length,
    owned_content_count: strategy.owned_content_sources.length,
  });
  return {
    strategy,
    links,
    summary: {
      linkage_count: links.length,
      themes: strategy.campaign_themes.length,
      owned_content: strategy.owned_content_sources.length,
    },
  };
}

export interface StrategyReadiness {
  ready: boolean;
  readiness_score: number;
  blocking_reasons: string[];
}

/** Deterministic strategy completeness readiness. */
export async function getStrategyReadiness(campaignId: string): Promise<StrategyReadiness> {
  const s = await loadActiveStrategy(campaignId);
  if (!s) return { ready: false, readiness_score: 0, blocking_reasons: ['NO_STRATEGY'] };
  const blocking: string[] = [];
  if (!s.objective?.trim()) blocking.push('MISSING_OBJECTIVE');
  if (!s.target_audience?.primary?.trim()) blocking.push('MISSING_AUDIENCE');
  if ((s.campaign_themes?.length ?? 0) === 0) blocking.push('MISSING_THEMES');
  if ((s.key_messaging?.length ?? 0) === 0) blocking.push('MISSING_MESSAGING');
  if ((s.platform_strategy?.length ?? 0) === 0) blocking.push('MISSING_PLATFORM_STRATEGY');
  const score = Math.max(0, 100 - blocking.length * 20);
  return { ready: blocking.length === 0, readiness_score: score, blocking_reasons: blocking };
}

export const campaignStrategyService = {
  getOrCreateCampaignStrategy,
  getCampaignStrategy,
  getStrategyExecutionContext,
  getStrategyReadiness,
};
