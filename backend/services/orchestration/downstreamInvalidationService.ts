/**
 * downstreamInvalidationService.ts — deterministic downstream invalidation
 * (CKRE-004 §4).
 *
 * When knowledge changes, deterministically identify (via the Knowledge
 * Dependency Graph) the affected modules, caches, AI contexts, recommendations,
 * reports, planners, drafts, and intelligence — and invalidate ONLY those.
 * Reuses the graph (no duplicate dependency calc) and the existing AI cache.
 */

import type { KnowledgeDomainId } from '../knowledge/companyKnowledgeModel';
import { propagateKnowledgeChange, type DependencyNodeId } from './knowledgeDependencyGraph';
import { emitOrchestrationEvent, resolveOrchestrationCorrelationId } from './orchestrationEventService';
import { logger } from '../logger';

export interface InvalidationPlan {
  changedDomains: KnowledgeDomainId[];
  affectedNodes: DependencyNodeId[];
  affectedConsumers: string[];
  cacheOps: string[];
  executionOrder: DependencyNodeId[];
}

/** Compute the deterministic invalidation plan from changed domains. Pure. */
export function computeInvalidationPlan(changedDomains: KnowledgeDomainId[]): InvalidationPlan {
  const prop = propagateKnowledgeChange(changedDomains);
  return {
    changedDomains: [...changedDomains].sort(),
    affectedNodes: prop.affectedNodes,
    affectedConsumers: prop.affectedConsumers,
    cacheOps: prop.invalidatesCacheOps,
    executionOrder: prop.executionOrder,
  };
}

/**
 * Apply the invalidation: best-effort bust of the affected AI-cache ops and emit
 * InvalidationPropagated so downstream consumers honor their own caches. Never
 * throws. Returns the plan for callers/observability.
 */
export async function applyDownstreamInvalidation(
  companyId: string,
  changedDomains: KnowledgeDomainId[],
  correlationId?: string,
): Promise<InvalidationPlan> {
  const plan = computeInvalidationPlan(changedDomains);
  const cid = correlationId ?? (await resolveOrchestrationCorrelationId(null, companyId));

  // Best-effort AI-cache invalidation for affected ops (reuses aiResponseCache).
  if (plan.cacheOps.length) {
    try {
      const { invalidateCacheByPrefix } = await import('../aiResponseCache');
      for (const op of plan.cacheOps) {
        try { await invalidateCacheByPrefix(op); } catch { /* per-op best-effort */ }
      }
    } catch (err) {
      logger.warn('downstream_invalidation_cache_bust_failed', { companyId, message: err instanceof Error ? err.message : String(err) });
    }
  }

  void emitOrchestrationEvent({
    event: 'InvalidationPropagated', outcome: 'allowed', correlationId: cid, companyId,
    reason: `${plan.changedDomains.join(',') || 'none'}`,
    metadata: { affectedNodes: plan.affectedNodes, affectedConsumers: plan.affectedConsumers, cacheOps: plan.cacheOps },
  });

  return plan;
}
