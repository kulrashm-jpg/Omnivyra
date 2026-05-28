/**
 * Phase 1 — Cross-modal content registry.
 *
 * In-memory per-process store of cross-modal assets and the transformation
 * lineages connecting them. Per-company bucketing. Capacity-bounded.
 *
 * Purpose: single source-of-truth for "which asset came from which" so
 * downstream cross-modal engines can reason about transformation chains
 * without each one re-discovering relationships.
 */

import type {
  CrossModalAsset,
  CrossModalFormat,
  CrossModalTransformationType,
  EcosystemRole,
  TransformationLineage,
} from './longFormRecommendationTypes';

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface RegisterAssetInput extends Omit<CrossModalAsset, 'assetId'> {
  assetId?: string;
}

export interface RegisterLineageInput {
  companyId: string;
  sourceAssetId: string;
  derivedAssetId: string;
  transformationType: CrossModalTransformationType;
  ecosystemRole: EcosystemRole;
  /** caller may override the auto-derived authority contribution */
  authorityContributionOverride?: number;
}

export interface CrossModalContentRegistry {
  registerAsset(input: RegisterAssetInput): CrossModalAsset;
  registerLineage(input: RegisterLineageInput): TransformationLineage;
  getAsset(companyId: string, assetId: string): CrossModalAsset | undefined;
  listAssets(companyId?: string, options?: { format?: CrossModalFormat }): CrossModalAsset[];
  listLineages(companyId?: string, options?: { sourceAssetId?: string; derivedAssetId?: string }): TransformationLineage[];
  /** Walk the ancestor chain for an asset (oldest → newest, exclusive of asset itself). */
  ancestorsOf(companyId: string, assetId: string): string[];
  /** Direct descendants for an asset (lineages where it is the source). */
  descendantsOf(companyId: string, assetId: string): TransformationLineage[];
  clear(companyId?: string): void;
  size(companyId?: string): { assets: number; lineages: number };
}

export function createCrossModalContentRegistry(options?: {
  maxAssetsPerCompany?: number;
  maxLineagesPerCompany?: number;
}): CrossModalContentRegistry {
  const assetCapacity = Math.max(50, options?.maxAssetsPerCompany ?? 5000);
  const lineageCapacity = Math.max(50, options?.maxLineagesPerCompany ?? 10000);
  const assetBuckets = new Map<string, CrossModalAsset[]>();
  const lineageBuckets = new Map<string, TransformationLineage[]>();

  function assets(companyId: string): CrossModalAsset[] {
    let b = assetBuckets.get(companyId);
    if (!b) { b = []; assetBuckets.set(companyId, b); }
    return b;
  }
  function lineages(companyId: string): TransformationLineage[] {
    let b = lineageBuckets.get(companyId);
    if (!b) { b = []; lineageBuckets.set(companyId, b); }
    return b;
  }

  function ancestors(companyId: string, assetId: string, visited = new Set<string>()): string[] {
    if (visited.has(assetId)) return []; // cycle guard
    visited.add(assetId);
    const direct = lineages(companyId).filter((l) => l.derivedAssetId === assetId);
    const chain: string[] = [];
    for (const l of direct) {
      const upstream = ancestors(companyId, l.sourceAssetId, visited);
      chain.push(...upstream, l.sourceAssetId);
    }
    // de-dup while preserving order
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of chain) {
      if (!seen.has(id)) { seen.add(id); out.push(id); }
    }
    return out;
  }

  return {
    registerAsset(input) {
      const asset: CrossModalAsset = {
        assetId: input.assetId ?? newId('cma'),
        companyId: input.companyId,
        format: input.format,
        title: input.title,
        strategicNarrative: input.strategicNarrative,
        authorityThemes: input.authorityThemes,
        icpFocus: input.icpFocus,
        terminologyClusters: input.terminologyClusters,
        narrativeArchetype: input.narrativeArchetype,
        publishedAt: input.publishedAt,
        approximateWordCount: input.approximateWordCount,
        authorityClaimCoverage: Math.max(0, Math.min(100, input.authorityClaimCoverage)),
        evidenceDensity: Math.max(0, Math.min(100, input.evidenceDensity)),
        ecosystemRole: input.ecosystemRole,
      };
      const bucket = assets(asset.companyId);
      bucket.push(asset);
      while (bucket.length > assetCapacity) bucket.shift();
      return asset;
    },
    registerLineage(input) {
      const src = this.getAsset(input.companyId, input.sourceAssetId);
      const dst = this.getAsset(input.companyId, input.derivedAssetId);
      if (!src || !dst) {
        throw new Error(`registerLineage: source or derived asset not found (src=${input.sourceAssetId} dst=${input.derivedAssetId})`);
      }
      // Authority contribution: caller override OR derived-vs-source claim coverage ratio.
      const authorityContribution = Math.max(0, Math.min(100, Math.round(
        input.authorityContributionOverride ?? (dst.authorityClaimCoverage / Math.max(1, src.authorityClaimCoverage)) * 100,
      )));
      const upstream = ancestors(input.companyId, src.assetId);
      const lineage: TransformationLineage = {
        lineageId: newId('lin'),
        companyId: input.companyId,
        sourceAssetId: src.assetId,
        derivedAssetId: dst.assetId,
        sourceFormat: src.format,
        targetFormat: dst.format,
        transformationType: input.transformationType,
        narrativeLineage: [...upstream, src.assetId, dst.assetId],
        authorityContribution,
        ecosystemRole: input.ecosystemRole,
        createdAt: new Date().toISOString(),
      };
      // Sync ecosystemRole onto the asset if not already set.
      if (!dst.ecosystemRole) dst.ecosystemRole = input.ecosystemRole;
      const bucket = lineages(input.companyId);
      bucket.push(lineage);
      while (bucket.length > lineageCapacity) bucket.shift();
      return lineage;
    },
    getAsset(companyId, assetId) {
      return assets(companyId).find((a) => a.assetId === assetId);
    },
    listAssets(companyId, options) {
      const all = companyId
        ? [...(assetBuckets.get(companyId) ?? [])]
        : (() => { const out: CrossModalAsset[] = []; assetBuckets.forEach((b) => out.push(...b)); return out; })();
      if (options?.format) return all.filter((a) => a.format === options.format);
      return all;
    },
    listLineages(companyId, options) {
      const all = companyId
        ? [...(lineageBuckets.get(companyId) ?? [])]
        : (() => { const out: TransformationLineage[] = []; lineageBuckets.forEach((b) => out.push(...b)); return out; })();
      let filtered = all;
      if (options?.sourceAssetId) filtered = filtered.filter((l) => l.sourceAssetId === options.sourceAssetId);
      if (options?.derivedAssetId) filtered = filtered.filter((l) => l.derivedAssetId === options.derivedAssetId);
      return filtered;
    },
    ancestorsOf(companyId, assetId) {
      return ancestors(companyId, assetId);
    },
    descendantsOf(companyId, assetId) {
      return lineages(companyId).filter((l) => l.sourceAssetId === assetId);
    },
    clear(companyId) {
      if (!companyId) { assetBuckets.clear(); lineageBuckets.clear(); return; }
      assetBuckets.delete(companyId);
      lineageBuckets.delete(companyId);
    },
    size(companyId) {
      if (companyId) {
        return {
          assets: assetBuckets.get(companyId)?.length ?? 0,
          lineages: lineageBuckets.get(companyId)?.length ?? 0,
        };
      }
      let a = 0, l = 0;
      assetBuckets.forEach((b) => { a += b.length; });
      lineageBuckets.forEach((b) => { l += b.length; });
      return { assets: a, lineages: l };
    },
  };
}

let _defaultRegistry: CrossModalContentRegistry | null = null;

export function getDefaultCrossModalContentRegistry(): CrossModalContentRegistry {
  if (!_defaultRegistry) _defaultRegistry = createCrossModalContentRegistry();
  return _defaultRegistry;
}

export function setDefaultCrossModalContentRegistry(reg: CrossModalContentRegistry): void {
  _defaultRegistry = reg;
}
