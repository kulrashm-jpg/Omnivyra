/**
 * Phase 1 — Content portfolio registry.
 *
 * In-memory store of long-form assets per company. Caller-populated when an
 * article reaches a state worth tracking (typically `approved` or
 * `published`). Tests use a fresh registry per scenario.
 */

import type { ContentPortfolioAsset, TargetBuyerStage } from './longFormRecommendationTypes';

export interface ContentPortfolioRegistry {
  register(companyId: string, asset: ContentPortfolioAsset): void;
  registerMany(companyId: string, assets: ContentPortfolioAsset[]): void;
  get(companyId: string, articleId: string): ContentPortfolioAsset | null;
  list(companyId: string): ContentPortfolioAsset[];
  /** Filter by funnel stage bucket (TOFU / MOFU / BOFU). */
  listByFunnelBucket(companyId: string, bucket: 'tofu' | 'mofu' | 'bofu'): ContentPortfolioAsset[];
  /** Filter by archetype label. */
  listByArchetype(companyId: string, archetype: ContentPortfolioAsset['narrativeArchetype']): ContentPortfolioAsset[];
  /** Filter by tag. */
  listByTag(companyId: string, tag: string): ContentPortfolioAsset[];
  update(companyId: string, articleId: string, patch: Partial<ContentPortfolioAsset>): ContentPortfolioAsset | null;
  remove(companyId: string, articleId: string): boolean;
  clear(companyId?: string): void;
  size(companyId?: string): number;
}

export const FUNNEL_STAGE_TO_BUCKET: Record<TargetBuyerStage, 'tofu' | 'mofu' | 'bofu'> = {
  awareness: 'tofu',
  consideration: 'mofu',
  evaluation: 'mofu',
  decision: 'bofu',
  expansion: 'bofu',
};

export function createContentPortfolioRegistry(): ContentPortfolioRegistry {
  const buckets = new Map<string, Map<string, ContentPortfolioAsset>>();

  function getBucket(companyId: string): Map<string, ContentPortfolioAsset> {
    let b = buckets.get(companyId);
    if (!b) { b = new Map(); buckets.set(companyId, b); }
    return b;
  }

  return {
    register(companyId, asset) {
      getBucket(companyId).set(asset.articleId, asset);
    },
    registerMany(companyId, assets) {
      const b = getBucket(companyId);
      for (const a of assets) b.set(a.articleId, a);
    },
    get(companyId, articleId) {
      return buckets.get(companyId)?.get(articleId) ?? null;
    },
    list(companyId) {
      return Array.from(buckets.get(companyId)?.values() ?? []);
    },
    listByFunnelBucket(companyId, bucket) {
      return this.list(companyId).filter((a) => FUNNEL_STAGE_TO_BUCKET[a.funnelStage] === bucket);
    },
    listByArchetype(companyId, archetype) {
      return this.list(companyId).filter((a) => a.narrativeArchetype === archetype);
    },
    listByTag(companyId, tag) {
      const lower = tag.toLowerCase();
      return this.list(companyId).filter((a) =>
        a.strategicIntentTags.some((t) => t.toLowerCase() === lower)
        || a.authorityThemes.some((t) => t.toLowerCase() === lower),
      );
    },
    update(companyId, articleId, patch) {
      const existing = buckets.get(companyId)?.get(articleId);
      if (!existing) return null;
      const updated: ContentPortfolioAsset = {
        ...existing,
        ...patch,
        lastUpdatedAt: new Date().toISOString(),
      };
      buckets.get(companyId)!.set(articleId, updated);
      return updated;
    },
    remove(companyId, articleId) {
      return buckets.get(companyId)?.delete(articleId) ?? false;
    },
    clear(companyId) {
      if (!companyId) { buckets.clear(); return; }
      buckets.delete(companyId);
    },
    size(companyId) {
      if (companyId) return buckets.get(companyId)?.size ?? 0;
      let total = 0;
      buckets.forEach((b) => { total += b.size; });
      return total;
    },
  };
}

let _defaultRegistry: ContentPortfolioRegistry | null = null;

export function getDefaultContentPortfolioRegistry(): ContentPortfolioRegistry {
  if (!_defaultRegistry) _defaultRegistry = createContentPortfolioRegistry();
  return _defaultRegistry;
}

export function setDefaultContentPortfolioRegistry(reg: ContentPortfolioRegistry): void {
  _defaultRegistry = reg;
}
