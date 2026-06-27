/**
 * Design System Strategist Service — recommends Collections for a campaign.
 *
 * Assembles a StrategyContext from EXISTING canonical sources (company context +
 * brand voice via resolveCreatorCopyContext, plus campaign-strategy params the
 * caller already has), then runs the pure deterministic strategist over the
 * company's collections. No AI explanations, no duplicate context model, no
 * duplicate recommendation engine.
 */

import type { TemplateAssetFamily } from '../../../lib/creator-templates';
import {
  type StrategyContext,
  type ScoredCollection,
  recommendCollections,
} from '../../../lib/creator-templates/designSystemStrategist';
import type { TemplateCollection } from '../../../lib/creator-templates/collection';
import { listCollections, buildResolver } from './collectionService';

export interface StrategyParams {
  objective?: string;
  campaignType?: string;
  audience?: string;
  platformMix?: string[];
  industry?: string;
  visualStyle?: string;
  requiredFamilies?: TemplateAssetFamily[];
}

export interface DesignSystemRecommendation extends ScoredCollection {
  collection: TemplateCollection;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** Map company context + brand voice + campaign params → StrategyContext. */
async function assembleContext(companyId: string, params: StrategyParams): Promise<StrategyContext> {
  let company: Record<string, unknown> = {};
  let brand: Record<string, unknown> = {};
  try {
    const { resolveCreatorCopyContext } = await import('./creatorCopyContextResolver');
    const ctx = await resolveCreatorCopyContext(companyId);
    company = (ctx.company ?? {}) as Record<string, unknown>;
    brand = (ctx.brandVoice ?? {}) as Record<string, unknown>;
  } catch { /* best-effort — params still drive scoring */ }

  // Provided params win; otherwise derive from canonical sources.
  return {
    objective: params.objective,
    campaignType: params.campaignType,
    audience: params.audience ?? str(company.target_audience) ?? str(company.audience),
    platformMix: params.platformMix?.length ? params.platformMix : undefined,
    industry: params.industry ?? str(company.industry) ?? str(company.sector),
    companyMaturity: str(company.maturity) ?? str(company.stage) ?? str(company.size),
    visualStyle: params.visualStyle ?? str(brand.visual_style) ?? str(brand.style),
    requiredFamilies: params.requiredFamilies,
  };
}

export async function recommendDesignSystems(input: { companyId: string; strategy: StrategyParams; limit?: number }): Promise<DesignSystemRecommendation[]> {
  const collections = await listCollections({ companyId: input.companyId });
  if (!collections.length) return [];

  const allIds = Array.from(new Set(collections.flatMap((c) => c.templateIds)));
  const resolve = await buildResolver(allIds);
  const context = await assembleContext(input.companyId, input.strategy);

  // REAL historical compatibility + measured reasons from published-asset
  // analytics (best-effort; empty when no data) — replaces the placeholder.
  try {
    const { getStrategistPerformanceSignals } = await import('./designPerformanceService');
    const signals = await getStrategistPerformanceSignals(input.companyId);
    context.historicalCompatibility = signals.historicalCompatibility;
    context.performanceReasons = signals.performanceReasons;
  } catch { /* best-effort — strategy params still drive scoring */ }

  const scored = recommendCollections(collections, context, resolve, input.limit ?? 0);
  const byId = new Map(collections.map((c) => [c.id, c]));
  return scored
    .map((s) => { const collection = byId.get(s.collectionId); return collection ? { ...s, collection } : null; })
    .filter((x): x is DesignSystemRecommendation => x !== null);
}
