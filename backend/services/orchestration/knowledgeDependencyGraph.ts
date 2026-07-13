/**
 * knowledgeDependencyGraph.ts — the canonical Knowledge Dependency Graph
 * (CKRE-004 §2).
 *
 * DISTINCT from the CKRE-001R fingerprint dependency graph (which models crawl
 * signals). THIS graph models SEMANTIC dependencies: when a knowledge domain
 * changes, which downstream knowledge + consumer modules must be refreshed /
 * invalidated. Pure + deterministic (a frozen literal + pure graph helpers).
 *
 * Nodes are knowledge domains (mirroring CKRE-003) plus downstream consumer
 * modules (recommendations, content writer, campaign planner, SEO/growth
 * intelligence, reports). Every node declares its propagation rule, refresh
 * strategy, priority, the nodes it invalidates, and its affected consumers.
 */

import type { KnowledgeDomainId } from '../knowledge/companyKnowledgeModel';

export type DependencyNodeId =
  // knowledge domains (mirror CKRE-003)
  | 'WEBSITE' | 'IDENTITY' | 'BRAND' | 'PRODUCTS' | 'SERVICES' | 'AUDIENCE'
  | 'INDUSTRY' | 'POSITIONING' | 'MARKETING' | 'SEO' | 'SOCIAL' | 'COMPETITORS'
  | 'COMPANY_INTELLIGENCE' | 'METADATA'
  // downstream consumers
  | 'RECOMMENDATIONS' | 'CONTENT_WRITER' | 'CAMPAIGN_PLANNER'
  | 'SEO_INTELLIGENCE' | 'GROWTH_INTELLIGENCE' | 'REPORTS';

export type NodeKind = 'knowledge' | 'consumer';
export type PropagationRule = 'immediate' | 'batched' | 'deferred';
export type RefreshStrategy = 'invalidate_cache' | 'regenerate' | 'recompute' | 'none';

export interface DependencyNode {
  id: DependencyNodeId;
  kind: NodeKind;
  propagation: PropagationRule;
  refreshStrategy: RefreshStrategy;
  priority: number;                 // lower = higher priority
  /** Downstream nodes this node's change invalidates. */
  invalidates: DependencyNodeId[];
  /** External module/cache names affected (observability + invalidation plan). */
  affectedConsumers: string[];
  /** AI-cache operations to bust when this node changes (reuses aiResponseCache). */
  invalidatesCacheOps: string[];
}

const N = (
  id: DependencyNodeId, kind: NodeKind, propagation: PropagationRule, refreshStrategy: RefreshStrategy,
  priority: number, invalidates: DependencyNodeId[], affectedConsumers: string[], invalidatesCacheOps: string[] = [],
): DependencyNode => ({ id, kind, propagation, refreshStrategy, priority, invalidates, affectedConsumers, invalidatesCacheOps });

const GRAPH_INTERNAL: Record<DependencyNodeId, DependencyNode> = {
  WEBSITE:   N('WEBSITE', 'knowledge', 'immediate', 'recompute', 10, ['BRAND', 'SEO', 'SOCIAL', 'METADATA'], ['websiteIntelligence']),
  IDENTITY:  N('IDENTITY', 'knowledge', 'immediate', 'recompute', 10, ['BRAND', 'POSITIONING', 'RECOMMENDATIONS'], ['companyProfile']),
  BRAND:     N('BRAND', 'knowledge', 'immediate', 'regenerate', 20, ['MARKETING', 'RECOMMENDATIONS', 'CONTENT_WRITER'], ['creator', 'brandEngine'], ['profileEnrichment']),
  PRODUCTS:  N('PRODUCTS', 'knowledge', 'immediate', 'regenerate', 20, ['SERVICES', 'AUDIENCE', 'RECOMMENDATIONS'], ['recommendations']),
  SERVICES:  N('SERVICES', 'knowledge', 'immediate', 'regenerate', 20, ['AUDIENCE', 'RECOMMENDATIONS'], ['recommendations']),
  AUDIENCE:  N('AUDIENCE', 'knowledge', 'immediate', 'regenerate', 20, ['MARKETING', 'RECOMMENDATIONS', 'CAMPAIGN_PLANNER'], ['campaignPlanner']),
  INDUSTRY:  N('INDUSTRY', 'knowledge', 'immediate', 'recompute', 20, ['COMPETITORS', 'POSITIONING', 'MARKETING'], ['marketPulse']),
  POSITIONING: N('POSITIONING', 'knowledge', 'batched', 'regenerate', 30, ['MARKETING', 'RECOMMENDATIONS'], ['recommendations']),
  MARKETING: N('MARKETING', 'knowledge', 'batched', 'regenerate', 30, ['RECOMMENDATIONS', 'CONTENT_WRITER', 'CAMPAIGN_PLANNER', 'GROWTH_INTELLIGENCE'], ['campaignPlanner', 'contentWriter']),
  SEO:       N('SEO', 'knowledge', 'batched', 'recompute', 30, ['SEO_INTELLIGENCE', 'CONTENT_WRITER'], ['seoIntelligence']),
  SOCIAL:    N('SOCIAL', 'knowledge', 'batched', 'invalidate_cache', 30, ['CAMPAIGN_PLANNER', 'GROWTH_INTELLIGENCE'], ['socialPublisher']),
  COMPETITORS: N('COMPETITORS', 'knowledge', 'batched', 'recompute', 30, ['POSITIONING', 'GROWTH_INTELLIGENCE'], ['competitorIntelligence']),
  COMPANY_INTELLIGENCE: N('COMPANY_INTELLIGENCE', 'knowledge', 'batched', 'recompute', 30, ['RECOMMENDATIONS', 'GROWTH_INTELLIGENCE', 'REPORTS'], ['intelligence']),
  METADATA:  N('METADATA', 'knowledge', 'deferred', 'invalidate_cache', 40, [], ['metadata']),
  RECOMMENDATIONS: N('RECOMMENDATIONS', 'consumer', 'batched', 'regenerate', 50, ['CONTENT_WRITER', 'CAMPAIGN_PLANNER'], ['recommendations'], ['profileEnrichment']),
  CONTENT_WRITER:  N('CONTENT_WRITER', 'consumer', 'deferred', 'regenerate', 60, [], ['contentWriter']),
  CAMPAIGN_PLANNER: N('CAMPAIGN_PLANNER', 'consumer', 'deferred', 'regenerate', 60, [], ['campaignPlanner']),
  SEO_INTELLIGENCE: N('SEO_INTELLIGENCE', 'consumer', 'deferred', 'recompute', 60, ['GROWTH_INTELLIGENCE'], ['seoIntelligence']),
  GROWTH_INTELLIGENCE: N('GROWTH_INTELLIGENCE', 'consumer', 'deferred', 'recompute', 70, ['REPORTS'], ['growthIntelligence']),
  REPORTS:   N('REPORTS', 'consumer', 'deferred', 'regenerate', 80, [], ['reports']),
};

export const KNOWLEDGE_DEPENDENCY_GRAPH: Readonly<Record<DependencyNodeId, DependencyNode>> = GRAPH_INTERNAL;
export const DEPENDENCY_NODE_IDS = Object.keys(GRAPH_INTERNAL) as DependencyNodeId[];

export function getDependencyNode(id: DependencyNodeId): DependencyNode {
  const n = GRAPH_INTERNAL[id];
  if (!n) throw new Error(`UNKNOWN_DEPENDENCY_NODE:${id}`);
  return n;
}

/** CKRE-003 knowledge domain → graph node (identity mapping; domains mirror nodes). */
export function nodeForDomain(domain: KnowledgeDomainId): DependencyNodeId {
  return domain as DependencyNodeId; // domain ids are a subset of node ids
}

/** Transitive downstream closure of a node (everything it invalidates). Deterministic (sorted). */
export function downstreamOf(id: DependencyNodeId): DependencyNodeId[] {
  const out = new Set<DependencyNodeId>();
  const walk = (t: DependencyNodeId) => {
    for (const d of getDependencyNode(t).invalidates) {
      if (!out.has(d)) { out.add(d); walk(d); }
    }
  };
  walk(id);
  return Array.from(out).sort();
}

/** Deterministic topological order (dependencies before dependents); cycle-detecting. */
export function propagationOrder(nodes?: DependencyNodeId[]): DependencyNodeId[] {
  const scope = nodes ? new Set(nodes) : new Set(DEPENDENCY_NODE_IDS);
  const visited = new Set<DependencyNodeId>();
  const temp = new Set<DependencyNodeId>();
  const order: DependencyNodeId[] = [];
  const visit = (t: DependencyNodeId) => {
    if (!scope.has(t) || visited.has(t)) return;
    if (temp.has(t)) throw new Error(`KNOWLEDGE_DEPENDENCY_CYCLE:${t}`);
    temp.add(t);
    for (const d of [...getDependencyNode(t).invalidates].sort()) visit(d);
    temp.delete(t);
    visited.add(t);
    order.push(t);
  };
  for (const t of [...scope].sort()) visit(t);
  // order currently has dependents-first (post-order over `invalidates`); reverse
  // so an upstream node comes before what it invalidates.
  return order.reverse();
}

export interface PropagationResult {
  /** Seed nodes (directly changed) + their transitive downstream, in propagation order. */
  affectedNodes: DependencyNodeId[];
  affectedConsumers: string[];
  invalidatesCacheOps: string[];
  /** Execution order (upstream before downstream), deterministic. */
  executionOrder: DependencyNodeId[];
}

/**
 * Given the changed knowledge domains, deterministically compute the affected
 * nodes (seeds + downstream), consumers, cache ops, and execution order. Reuses
 * the graph — no duplicate dependency calculation.
 */
export function propagateKnowledgeChange(changedDomains: KnowledgeDomainId[]): PropagationResult {
  const affected = new Set<DependencyNodeId>();
  for (const domain of changedDomains) {
    const seed = nodeForDomain(domain);
    if (!GRAPH_INTERNAL[seed]) continue;
    affected.add(seed);
    for (const d of downstreamOf(seed)) affected.add(d);
  }
  const affectedNodes = Array.from(affected);
  const consumers = new Set<string>();
  const cacheOps = new Set<string>();
  for (const n of affectedNodes) {
    const def = getDependencyNode(n);
    def.affectedConsumers.forEach((c) => consumers.add(c));
    def.invalidatesCacheOps.forEach((c) => cacheOps.add(c));
  }
  return {
    affectedNodes: affectedNodes.sort(),
    affectedConsumers: Array.from(consumers).sort(),
    invalidatesCacheOps: Array.from(cacheOps).sort(),
    executionOrder: propagationOrder(affectedNodes),
  };
}
