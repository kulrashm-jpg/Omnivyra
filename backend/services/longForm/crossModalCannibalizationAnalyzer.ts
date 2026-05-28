/**
 * Phase 5 — Cross-modal cannibalization analyzer.
 *
 * Detects when the same narrative is being told over and over across many
 * formats — i.e. every format is repeating the same lesson, the same
 * educational framing, the same authority claim.
 *
 * Pure / deterministic.
 *
 * Mechanism:
 *   1. Build a theme signature per asset = sorted authority themes + archetype + dominant terminology.
 *   2. Group assets by signature. A cluster forms when ≥2 assets share a
 *      signature AND span ≥2 different formats (single-format clusters are
 *      handled by the existing in-format cannibalization analyzer).
 *   3. Saturated format pairs: pairs where ≥3 assets each contribute to
 *      overlapping signatures.
 *   4. ecosystemRedundancyPercent = (cluster-covered assets) / (total assets) × 100.
 */

import type {
  CrossModalAsset,
  CrossModalCannibalizationCluster,
  CrossModalCannibalizationResult,
  CrossModalFormat,
} from './longFormRecommendationTypes';

function stableHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h) ^ text.charCodeAt(i);
  return (h >>> 0).toString(16);
}

function themeSignatureOf(asset: CrossModalAsset): string {
  const themes = [...asset.authorityThemes].map((t) => t.toLowerCase()).sort();
  const terms = [...asset.terminologyClusters].map((t) => t.toLowerCase()).sort().slice(0, 3);
  const archetype = asset.narrativeArchetype ?? 'uncategorized';
  return [archetype, ...themes, ...terms].join('|');
}

export interface AnalyzeCrossModalCannibalizationInput {
  assets: CrossModalAsset[];
  /** minimum cluster size (default 2) */
  minClusterSize?: number;
}

export function analyzeCrossModalCannibalization(input: AnalyzeCrossModalCannibalizationInput): CrossModalCannibalizationResult {
  const minClusterSize = Math.max(2, input.minClusterSize ?? 2);

  // 1. Group by theme signature.
  const grouped = new Map<string, CrossModalAsset[]>();
  for (const a of input.assets) {
    const sig = themeSignatureOf(a);
    const arr = grouped.get(sig) ?? [];
    arr.push(a);
    grouped.set(sig, arr);
  }

  // 2. Form clusters (≥ minClusterSize AND ≥ 2 distinct formats).
  const clusters: CrossModalCannibalizationCluster[] = [];
  const clusterCoveredAssetIds = new Set<string>();
  for (const [sig, group] of grouped) {
    if (group.length < minClusterSize) continue;
    const formats = Array.from(new Set(group.map((a) => a.format))) as CrossModalFormat[];
    if (formats.length < 2) continue;
    const severity: 'low' | 'medium' | 'high' =
      group.length >= 5 || formats.length >= 4 ? 'high'
      : group.length >= 3 || formats.length === 3 ? 'medium'
      : 'low';
    clusters.push({
      clusterId: `xcl_${stableHash(sig).slice(0, 10)}`,
      themeSignature: sig,
      formats,
      assetIds: group.map((a) => a.assetId),
      redundancySeverity: severity,
      rationale: `${group.length} assets across ${formats.length} format(s) [${formats.join(', ')}] share narrative signature.`,
    });
    for (const a of group) clusterCoveredAssetIds.add(a.assetId);
  }

  // 3. Saturated format pairs.
  const pairCounts = new Map<string, number>();
  for (const cluster of clusters) {
    for (let i = 0; i < cluster.formats.length; i += 1) {
      for (let j = i + 1; j < cluster.formats.length; j += 1) {
        const a = cluster.formats[i];
        const b = cluster.formats[j];
        const key = [a, b].sort().join('|');
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + cluster.assetIds.length);
      }
    }
  }
  const saturatedFormatPairs: CrossModalCannibalizationResult['saturatedFormatPairs'] = [];
  for (const [key, count] of pairCounts) {
    if (count >= 3) {
      const [a, b] = key.split('|') as [CrossModalFormat, CrossModalFormat];
      saturatedFormatPairs.push({ a, b, assetCount: count });
    }
  }
  saturatedFormatPairs.sort((x, y) => y.assetCount - x.assetCount);

  const total = input.assets.length;
  const ecosystemRedundancyPercent = total === 0 ? 0 : Math.round((clusterCoveredAssetIds.size / total) * 100);

  // Sort clusters by severity then size.
  const sevRank = { low: 0, medium: 1, high: 2 } as const;
  clusters.sort((a, b) => {
    if (sevRank[b.redundancySeverity] !== sevRank[a.redundancySeverity]) return sevRank[b.redundancySeverity] - sevRank[a.redundancySeverity];
    return b.assetIds.length - a.assetIds.length;
  });

  return {
    clusters,
    ecosystemRedundancyPercent,
    saturatedFormatPairs,
  };
}

export { themeSignatureOf };
