/**
 * Phase 13.7 — Cross-modal safety guard.
 *
 * Validates the cross-modal registry for unsafe topology:
 *   - recursive_transformation        a lineage where source == derived OR a cycle of length 2-N
 *   - infinite_decomposition          a single source with > derivativeBranchLimit descendants
 *   - authority_amplification_loop    a derivative whose authority exceeds source's by > 20pts repeatedly
 *   - circular_lineage                A → B → C → A cycle in lineage graph
 *   - excessive_derivative_nesting    chain depth > lineageDepthLimit
 *   - branch_explosion                total descendants from a single root > overall limit
 *
 * Pure / deterministic.
 */

import type {
  CrossModalAsset,
  CrossModalSafetyResult,
  RecursiveTransformationDetection,
  TransformationLineage,
} from './longFormRecommendationTypes';
import type { CrossModalContentRegistry } from './crossModalContentRegistry';

export interface SafetyGuardOptions {
  /** Max allowed depth from any root to a leaf (default 8). */
  lineageDepthLimit?: number;
  /** Max direct descendants per source asset (default 12). */
  derivativeBranchLimit?: number;
  /** Max total descendants from a single root (default 60). */
  rootDescendantLimit?: number;
  /** Authority amplification threshold (derived authority − source authority > N). */
  authorityAmplificationThreshold?: number;
}

export interface CrossModalSafetyGuard {
  audit(input: { registry: CrossModalContentRegistry; companyId: string }): CrossModalSafetyResult;
}

export function createCrossModalSafetyGuard(options?: SafetyGuardOptions): CrossModalSafetyGuard {
  const depthLimit = Math.max(2, options?.lineageDepthLimit ?? 8);
  const branchLimit = Math.max(2, options?.derivativeBranchLimit ?? 12);
  const rootDescendantLimit = Math.max(branchLimit, options?.rootDescendantLimit ?? 60);
  const amplThreshold = Math.max(5, options?.authorityAmplificationThreshold ?? 20);

  function detectCycles(lineages: TransformationLineage[]): string[][] {
    // Build directed graph source → derived; find cycles via DFS coloring.
    const adj = new Map<string, string[]>();
    for (const l of lineages) {
      const arr = adj.get(l.sourceAssetId) ?? [];
      arr.push(l.derivedAssetId);
      adj.set(l.sourceAssetId, arr);
    }
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<string, number>();
    const stack: string[] = [];
    const cycles: string[][] = [];

    function dfs(node: string): void {
      color.set(node, GRAY);
      stack.push(node);
      for (const next of adj.get(node) ?? []) {
        const c = color.get(next) ?? WHITE;
        if (c === GRAY) {
          // cycle found: capture from `next` to current
          const start = stack.indexOf(next);
          if (start >= 0) cycles.push([...stack.slice(start), next]);
        } else if (c === WHITE) {
          dfs(next);
        }
      }
      stack.pop();
      color.set(node, BLACK);
    }
    for (const node of adj.keys()) {
      if ((color.get(node) ?? WHITE) === WHITE) dfs(node);
    }
    return cycles;
  }

  function computeDepth(lineages: TransformationLineage[], rootId: string, depthCache: Map<string, number>): number {
    if (depthCache.has(rootId)) return depthCache.get(rootId)!;
    const visiting = new Set<string>();
    function helper(node: string): number {
      if (visiting.has(node)) return 0; // cycle break
      visiting.add(node);
      const children = lineages.filter((l) => l.sourceAssetId === node).map((l) => l.derivedAssetId);
      if (children.length === 0) { visiting.delete(node); return 1; }
      let best = 1;
      for (const c of children) best = Math.max(best, 1 + helper(c));
      visiting.delete(node);
      return best;
    }
    const d = helper(rootId);
    depthCache.set(rootId, d);
    return d;
  }

  return {
    audit(input) {
      const assets = input.registry.listAssets(input.companyId);
      const lineages = input.registry.listLineages(input.companyId);
      const assetById = new Map<string, CrossModalAsset>();
      for (const a of assets) assetById.set(a.assetId, a);
      const detections: RecursiveTransformationDetection[] = [];

      // 1. recursive_transformation: source == derived lineages.
      for (const l of lineages) {
        if (l.sourceAssetId === l.derivedAssetId) {
          detections.push({
            type: 'recursive_transformation',
            involvedAssetIds: [l.sourceAssetId],
            detail: `Lineage ${l.lineageId} has source == derived (${l.sourceAssetId}).`,
            severity: 'high',
          });
        }
      }

      // 2. circular_lineage: cycles of length ≥ 2.
      const cycles = detectCycles(lineages);
      for (const cycle of cycles) {
        if (cycle.length < 3) continue; // length 1 already covered above
        detections.push({
          type: 'circular_lineage',
          involvedAssetIds: cycle,
          detail: `Circular lineage detected: ${cycle.join(' → ')}.`,
          severity: 'high',
        });
      }

      // 3. infinite_decomposition: a source with > branchLimit direct descendants.
      const childCounts = new Map<string, number>();
      for (const l of lineages) childCounts.set(l.sourceAssetId, (childCounts.get(l.sourceAssetId) ?? 0) + 1);
      let observedMaxBranching = 0;
      for (const [src, count] of childCounts) {
        if (count > observedMaxBranching) observedMaxBranching = count;
        if (count > branchLimit) {
          detections.push({
            type: 'infinite_decomposition',
            involvedAssetIds: [src],
            detail: `Asset ${src} has ${count} direct descendants — exceeds branch limit ${branchLimit}.`,
            severity: count > branchLimit * 2 ? 'high' : 'medium',
          });
        }
      }

      // 4. authority_amplification_loop: derivative authority > source + threshold repeatedly.
      const ampCount = new Map<string, number>();
      for (const l of lineages) {
        const src = assetById.get(l.sourceAssetId);
        const dst = assetById.get(l.derivedAssetId);
        if (!src || !dst) continue;
        if (dst.authorityClaimCoverage - src.authorityClaimCoverage > amplThreshold) {
          // chain by source archetype
          const key = `${src.narrativeArchetype ?? 'uncategorized'}`;
          ampCount.set(key, (ampCount.get(key) ?? 0) + 1);
        }
      }
      for (const [archetype, count] of ampCount) {
        if (count >= 3) {
          detections.push({
            type: 'authority_amplification_loop',
            involvedAssetIds: [],
            detail: `Archetype "${archetype}" has ${count} lineages where derivative authority exceeds source by >${amplThreshold}pts — suspicious amplification.`,
            severity: count >= 5 ? 'high' : 'medium',
          });
        }
      }

      // 5. excessive_derivative_nesting: chain depth > depthLimit.
      // 6. branch_explosion: total descendants from a single root > rootDescendantLimit.
      const depthCache = new Map<string, number>();
      const rootIds = assets
        .filter((a) => !lineages.some((l) => l.derivedAssetId === a.assetId))
        .map((a) => a.assetId);
      let observedMaxDepth = 0;
      for (const root of rootIds) {
        const d = computeDepth(lineages, root, depthCache);
        if (d > observedMaxDepth) observedMaxDepth = d;
        if (d > depthLimit) {
          detections.push({
            type: 'excessive_derivative_nesting',
            involvedAssetIds: [root],
            detail: `Root ${root} has chain depth ${d} — exceeds depth limit ${depthLimit}.`,
            severity: d > depthLimit * 2 ? 'high' : 'medium',
          });
        }
        // Count total descendants reachable from this root.
        const reach = new Set<string>();
        const stack = [root];
        while (stack.length > 0) {
          const node = stack.pop()!;
          for (const l of lineages) {
            if (l.sourceAssetId === node && !reach.has(l.derivedAssetId)) {
              reach.add(l.derivedAssetId);
              stack.push(l.derivedAssetId);
            }
          }
        }
        if (reach.size > rootDescendantLimit) {
          detections.push({
            type: 'branch_explosion',
            involvedAssetIds: [root],
            detail: `Root ${root} has ${reach.size} total descendants — exceeds limit ${rootDescendantLimit}.`,
            severity: 'high',
          });
        }
      }

      const safe = detections.filter((d) => d.severity === 'high').length === 0;
      return {
        lineageDepthLimit: depthLimit,
        derivativeBranchLimit: branchLimit,
        observedMaxDepth,
        observedMaxBranching,
        recursiveTransformationDetections: detections,
        safe,
      };
    },
  };
}

let _default: CrossModalSafetyGuard | null = null;
export function getDefaultCrossModalSafetyGuard(): CrossModalSafetyGuard {
  if (!_default) _default = createCrossModalSafetyGuard();
  return _default;
}
export function setDefaultCrossModalSafetyGuard(g: CrossModalSafetyGuard): void { _default = g; }
