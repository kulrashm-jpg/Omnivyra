/**
 * Phase 2 — Authority map engine.
 *
 * Walks the portfolio for a company and emits an authority graph: nodes
 * represent themes / operational domains / ICP pains / strategic narratives
 * / workflow categories / capability clusters. Each node's `coverageWeight`
 * reflects how many articles reinforce it.
 *
 * Outputs:
 *   - authorityCoverageMap (the graph)
 *   - authorityGapAreas (nodes with low / no coverage relative to peers)
 *   - oversaturatedAreas (nodes with disproportionate coverage)
 *   - weakNarrativeZones (archetypes with no / low coverage)
 *
 * Pure; no LLM.
 */

import type {
  AuthorityMap,
  AuthorityNode,
  AuthorityNodeType,
  ContentPortfolioAsset,
  NarrativeArchetype,
} from './longFormRecommendationTypes';
import { NARRATIVE_ARCHETYPES } from './longFormRecommendationTypes';

function stableHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h) ^ text.charCodeAt(i);
  return (h >>> 0).toString(16);
}

function nodeId(type: AuthorityNodeType, label: string): string {
  return `auth_${type}_${stableHash(label.toLowerCase()).slice(0, 10)}`;
}

function normalizeLabel(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function clamp100(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

export interface BuildAuthorityMapInput {
  assets: ContentPortfolioAsset[];
  /**
   * Optional expected weight per node — when supplied, gaps are scored
   * against this baseline (e.g. for "expected ICPs we should cover").
   */
  expectedCoverage?: {
    themes?: string[];
    icpPains?: string[];
    capabilityClusters?: string[];
    workflowCategories?: string[];
  };
}

export function buildAuthorityMap(input: BuildAuthorityMapInput): AuthorityMap {
  const assets = input.assets;

  // Build nodes via accumulator: { nodeId → AuthorityNode }
  const nodeMap = new Map<string, AuthorityNode>();
  function ensureNode(type: AuthorityNodeType, label: string): AuthorityNode {
    const norm = normalizeLabel(label);
    if (!norm) return ensureNode(type, '_unknown_');
    const id = nodeId(type, norm);
    let node = nodeMap.get(id);
    if (!node) {
      node = { nodeId: id, nodeType: type, label: norm, coverageWeight: 0, contributingArticleIds: [] };
      nodeMap.set(id, node);
    }
    return node;
  }

  for (const asset of assets) {
    // themes
    for (const t of asset.authorityThemes) {
      const n = ensureNode('theme', t);
      n.coverageWeight += 10;
      if (!n.contributingArticleIds.includes(asset.articleId)) n.contributingArticleIds.push(asset.articleId);
    }
    // operational_domain — derived from terminology clusters
    for (const t of asset.terminologyClusters) {
      const n = ensureNode('operational_domain', t);
      n.coverageWeight += 6;
      if (!n.contributingArticleIds.includes(asset.articleId)) n.contributingArticleIds.push(asset.articleId);
    }
    // icp_pain — from icpFocus list
    for (const icp of asset.icpFocus) {
      const n = ensureNode('icp_pain', icp);
      n.coverageWeight += 8;
      if (!n.contributingArticleIds.includes(asset.articleId)) n.contributingArticleIds.push(asset.articleId);
    }
    // strategic_narrative — one node per strategic narrative (deduped on first sentence).
    const narrLabel = asset.strategicNarrative.split('.')[0].slice(0, 80) || '_unknown_';
    {
      const n = ensureNode('strategic_narrative', narrLabel);
      n.coverageWeight += 4;
      if (!n.contributingArticleIds.includes(asset.articleId)) n.contributingArticleIds.push(asset.articleId);
    }
    // workflow_category — best-effort from capability emphasis (use last word as workflow key).
    for (const cap of asset.capabilityEmphasis) {
      const n = ensureNode('workflow_category', cap);
      n.coverageWeight += 5;
      if (!n.contributingArticleIds.includes(asset.articleId)) n.contributingArticleIds.push(asset.articleId);
    }
    // capability_cluster — strategic intent tags carry capability clusters.
    for (const tag of asset.strategicIntentTags) {
      const n = ensureNode('capability_cluster', tag);
      n.coverageWeight += 5;
      if (!n.contributingArticleIds.includes(asset.articleId)) n.contributingArticleIds.push(asset.articleId);
    }
  }

  // Clamp + normalize coverageWeight to 0–100 per node.
  const nodes = Array.from(nodeMap.values()).map((n) => ({ ...n, coverageWeight: clamp100(n.coverageWeight) }));
  const totalCoverage = nodes.length === 0 ? 0 : Math.round(nodes.reduce((s, n) => s + n.coverageWeight, 0) / nodes.length);

  // Gap detection: weight quantiles per nodeType.
  const authorityGapAreas: AuthorityMap['authorityGapAreas'] = [];
  const oversaturatedAreas: AuthorityMap['oversaturatedAreas'] = [];
  const byType = new Map<AuthorityNodeType, AuthorityNode[]>();
  for (const n of nodes) {
    const arr = byType.get(n.nodeType) ?? [];
    arr.push(n);
    byType.set(n.nodeType, arr);
  }
  for (const [, group] of byType) {
    if (group.length === 0) continue;
    const sorted = [...group].sort((a, b) => a.coverageWeight - b.coverageWeight);
    const median = sorted[Math.floor(sorted.length / 2)].coverageWeight;
    const max = sorted[sorted.length - 1].coverageWeight;
    for (const n of group) {
      if (n.coverageWeight < Math.max(15, median * 0.4)) {
        authorityGapAreas.push({
          nodeId: n.nodeId, label: n.label, nodeType: n.nodeType,
          gapSeverity: n.coverageWeight === 0 ? 'high' : n.coverageWeight < 8 ? 'high' : 'medium',
        });
      }
      if (max > 0 && n.coverageWeight >= max * 0.8 && n.contributingArticleIds.length >= 3) {
        oversaturatedAreas.push({
          nodeId: n.nodeId, label: n.label, nodeType: n.nodeType,
          coverageWeight: n.coverageWeight, articleCount: n.contributingArticleIds.length,
        });
      }
    }
  }

  // Expected coverage check — flag missing expected entries as high-severity gaps.
  if (input.expectedCoverage) {
    function addExpected(list: string[] | undefined, type: AuthorityNodeType) {
      if (!list) return;
      const labelSet = new Set(nodes.filter((n) => n.nodeType === type).map((n) => n.label));
      for (const label of list) {
        const norm = normalizeLabel(label);
        if (!labelSet.has(norm)) {
          const id = nodeId(type, norm);
          authorityGapAreas.push({ nodeId: id, label: norm, nodeType: type, gapSeverity: 'high' });
        }
      }
    }
    addExpected(input.expectedCoverage.themes, 'theme');
    addExpected(input.expectedCoverage.icpPains, 'icp_pain');
    addExpected(input.expectedCoverage.capabilityClusters, 'capability_cluster');
    addExpected(input.expectedCoverage.workflowCategories, 'workflow_category');
  }

  // Weak narrative zones (archetypes).
  const archetypeWeights = new Map<NarrativeArchetype | 'uncategorized', number>();
  for (const archetype of NARRATIVE_ARCHETYPES) archetypeWeights.set(archetype, 0);
  archetypeWeights.set('uncategorized', 0);
  for (const asset of assets) {
    const key = asset.narrativeArchetype ?? 'uncategorized';
    archetypeWeights.set(key, (archetypeWeights.get(key) ?? 0) + 10);
  }
  const maxArchetypeWeight = Math.max(...Array.from(archetypeWeights.values()));
  const weakNarrativeZones: AuthorityMap['weakNarrativeZones'] = [];
  for (const [archetype, weight] of archetypeWeights) {
    if (maxArchetypeWeight === 0) continue;
    if (weight === 0 || weight <= maxArchetypeWeight * 0.15) {
      weakNarrativeZones.push({ archetype, coverageWeight: clamp100(weight) });
    }
  }

  return {
    nodes,
    totalCoverage,
    authorityGapAreas,
    oversaturatedAreas,
    weakNarrativeZones,
  };
}
