/**
 * knowledgeOrchestrator.ts — Company Knowledge Orchestration Engine (CKRE-004 §1/§6/§7).
 *
 * THE canonical orchestration seam. It COORDINATES the existing services — it does
 * not replace or duplicate them:
 *   - crawl / refresh          → refreshOrchestrator, refreshPolicyEngine
 *   - knowledge lifecycle      → companyKnowledgeService (capture/rollback/diff)
 *   - dependency propagation   → knowledgeDependencyGraph (semantic graph)
 *   - downstream invalidation  → downstreamInvalidationService + aiResponseCache
 *   - scheduling               → adaptiveSchedulingService (policy-derived)
 *   - task model / recovery    → executionTaskModel
 *   - ledger                   → orchestrationLedgerStore (report_settings)
 *   - events / metrics         → orchestrationEventService (AUTH-001 envelope)
 *   - subscriptions            → orchestrationEventSubscriptions (declarative)
 *
 * Deterministic, resumable, observable, backward compatible. No business logic of
 * its own; every effect is delegated to an existing service. Never throws.
 */

import type { KnowledgeDomainId } from '../knowledge/companyKnowledgeModel';
import { rollbackKnowledge, getCurrentKnowledge } from '../knowledge/companyKnowledgeService';
import { getKnowledgeState } from '../crawl/knowledgeVersionStore';
import { applyDownstreamInvalidation, computeInvalidationPlan, type InvalidationPlan } from './downstreamInvalidationService';
import {
  makeTask, dedupeTasks, startTask, completeTask, failTask, recoverStuck, isStuck,
  runnableTasks, type ExecutionTask,
} from './executionTaskModel';
import { readTasks, upsertTasks } from './orchestrationLedgerStore';
import { emitOrchestrationEvent, resolveOrchestrationCorrelationId } from './orchestrationEventService';
import { resolveSubscription, type SubscriptionDefinition } from './orchestrationEventSubscriptions';
import { logger } from '../logger';

export interface OrchestrationContext {
  companyId: string;
  changedDomains?: KnowledgeDomainId[];
  targetVersion?: number;
  reason?: string;
  now?: string;
  correlationId?: string;
}

export interface OrchestrationResult {
  ok: boolean;
  outcome: 'completed' | 'partial' | 'failed' | 'noop';
  plan: InvalidationPlan | null;
  tasks: ExecutionTask[];
  correlationId: string;
  error?: string;
}

/**
 * §6 — Plan the execution deterministically: one invalidation task per affected
 * node in propagation order. Pure (given `now`).
 */
export function planExecution(companyId: string, changedDomains: KnowledgeDomainId[], version: number | null, now: string): { plan: InvalidationPlan; tasks: ExecutionTask[] } {
  const plan = computeInvalidationPlan(changedDomains);
  const tasks = dedupeTasks(
    plan.executionOrder.map((node, idx) =>
      makeTask({ companyId, type: 'downstream_invalidation', target: node, priority: 40 + idx, version, now })),
  );
  return { plan, tasks };
}

/**
 * §1 — Orchestrate a knowledge change end-to-end: plan → persist ledger → apply
 * downstream invalidation → mark tasks → emit lifecycle events. Never throws.
 */
export async function orchestrateKnowledgeChange(ctx: OrchestrationContext): Promise<OrchestrationResult> {
  const { companyId } = ctx;
  const now = ctx.now ?? new Date().toISOString();
  const cid = ctx.correlationId ?? (await resolveOrchestrationCorrelationId(null, companyId));
  const changedDomains = ctx.changedDomains ?? [];

  if (!companyId) return { ok: false, outcome: 'failed', plan: null, tasks: [], correlationId: cid, error: 'NO_COMPANY' };
  if (changedDomains.length === 0) {
    return { ok: true, outcome: 'noop', plan: computeInvalidationPlan([]), tasks: [], correlationId: cid };
  }

  let version: number | null = null;
  try { version = (await getKnowledgeState(companyId)).version?.version ?? null; } catch { version = null; }

  const { plan, tasks } = planExecution(companyId, changedDomains, version, now);

  void emitOrchestrationEvent({ event: 'OrchestrationPlanned', outcome: 'allowed', correlationId: cid, companyId, reason: changedDomains.join(','), metadata: { tasks: tasks.length, nodes: plan.affectedNodes } });
  void emitOrchestrationEvent({ event: 'OrchestrationStarted', outcome: 'allowed', correlationId: cid, companyId, reason: changedDomains.join(',') });
  for (const t of tasks) void emitOrchestrationEvent({ event: 'TaskEnqueued', outcome: 'allowed', correlationId: cid, companyId, reason: t.id });

  // Persist the planned tasks (idempotent — dedup by id).
  await upsertTasks(companyId, tasks, now);

  // Execute the downstream-invalidation effect (the orchestrator's own coordinated
  // effect); refresh/regeneration remain delegated to the existing services.
  let failures = 0;
  const settled: ExecutionTask[] = [];
  try {
    await applyDownstreamInvalidation(companyId, changedDomains, cid);
    for (const t of tasks) settled.push(completeTask(startTask(t, now), now));
  } catch (err) {
    failures = tasks.length;
    const msg = err instanceof Error ? err.message : String(err);
    for (const t of tasks) settled.push(failTask(startTask(t, now), msg, now));
    logger.warn('orchestrate_knowledge_change_invalidation_failed', { companyId, message: msg });
  }
  await upsertTasks(companyId, settled, now);

  const outcome: OrchestrationResult['outcome'] = failures === 0 ? 'completed' : (failures < tasks.length ? 'partial' : 'failed');
  void emitOrchestrationEvent({
    event: outcome === 'completed' ? 'OrchestrationCompleted' : outcome === 'partial' ? 'OrchestrationPartial' : 'OrchestrationFailed',
    outcome: outcome === 'failed' ? 'denied' : 'allowed', correlationId: cid, companyId,
    reason: changedDomains.join(','), metadata: { tasks: settled.length, failures },
  });

  return { ok: outcome !== 'failed', outcome, plan, tasks: settled, correlationId: cid };
}

/**
 * §7 — Orchestrate a rollback: reuse CKRE-003 rollbackKnowledge (never overwrites
 * history), then invalidate downstream consumers and emit RollbackOrchestrated.
 */
export async function orchestrateRollback(ctx: OrchestrationContext): Promise<OrchestrationResult> {
  const { companyId, targetVersion } = ctx;
  const now = ctx.now ?? new Date().toISOString();
  const cid = ctx.correlationId ?? (await resolveOrchestrationCorrelationId(null, companyId));
  if (!companyId || !(typeof targetVersion === 'number')) {
    return { ok: false, outcome: 'failed', plan: null, tasks: [], correlationId: cid, error: 'BAD_INPUT' };
  }

  const roll = await rollbackKnowledge(companyId, targetVersion, ctx.reason ?? 'orchestrated_rollback', now);
  if (!roll.ok) {
    void emitOrchestrationEvent({ event: 'OrchestrationFailed', outcome: 'denied', correlationId: cid, companyId, reason: roll.error ?? 'rollback_failed', metadata: { targetVersion } });
    return { ok: false, outcome: 'failed', plan: null, tasks: [], correlationId: cid, error: roll.error };
  }

  // A rollback changes every composed domain → invalidate all consumers.
  const current = await getCurrentKnowledge(companyId).catch(() => null);
  const changedDomains = (current ? Object.keys(current.domains) : []) as KnowledgeDomainId[];
  const plan = await applyDownstreamInvalidation(companyId, changedDomains, cid);

  void emitOrchestrationEvent({ event: 'RollbackOrchestrated', outcome: 'allowed', correlationId: cid, companyId, reason: `->v${targetVersion}`, metadata: { validated: roll.validated, consumers: plan.affectedConsumers } });
  return { ok: true, outcome: 'completed', plan, tasks: [], correlationId: cid };
}

/**
 * §7 — Resume orchestration after a crash/restart: recover stuck/timed-out tasks
 * from the ledger and re-mark runnable ones. Delegates actual re-execution to the
 * existing services (this only heals the deterministic task ledger). Never throws.
 */
export async function resumeOrchestration(companyId: string, now: string = new Date().toISOString()): Promise<{ recovered: number; runnable: number }> {
  if (!companyId) return { recovered: 0, runnable: 0 };
  const cid = await resolveOrchestrationCorrelationId(null, companyId);
  const nowMs = Date.parse(now);
  const tasks = await readTasks(companyId);
  const healed = tasks.map((t) => (isStuck(t, Number.isFinite(nowMs) ? nowMs : 0) ? recoverStuck(t, now) : t));
  const changed = healed.filter((t, i) => t !== tasks[i]);
  if (changed.length) {
    await upsertTasks(companyId, healed, now);
    for (const t of changed) void emitOrchestrationEvent({ event: t.state === 'DEAD_LETTER' ? 'TaskDeadLettered' : 'TaskRetried', outcome: 'allowed', correlationId: cid, companyId, reason: t.id });
  }
  const runnable = runnableTasks(healed);
  if (runnable.length) void emitOrchestrationEvent({ event: 'ExecutionResumed', outcome: 'allowed', correlationId: cid, companyId, reason: `${runnable.length} runnable`, metadata: { recovered: changed.length } });
  return { recovered: changed.length, runnable: runnable.length };
}

/**
 * §3 — Dispatch a subscribed event to the right orchestration action. Consumes the
 * declarative subscription registry. Unknown events are ignored (no-op). Never throws.
 */
export async function dispatch(eventName: string, ctx: OrchestrationContext): Promise<OrchestrationResult | { ignored: true; event: string }> {
  const sub: SubscriptionDefinition | null = resolveSubscription(eventName);
  if (!sub) return { ignored: true, event: eventName };
  const seeded = [...new Set([...(ctx.changedDomains ?? []), ...sub.seedDomains])] as KnowledgeDomainId[];
  switch (sub.trigger) {
    case 'orchestrate_rollback':
      return orchestrateRollback(ctx);
    case 'orchestrate_knowledge_change':
    case 'invalidate_integration':
      return orchestrateKnowledgeChange({ ...ctx, changedDomains: seeded });
    case 'plan_refresh':
    case 'monitor_refresh':
      // Refresh planning/monitoring stays owned by refreshPolicyEngine/refreshOrchestrator;
      // orchestration only propagates knowledge effects when domains are seeded.
      return seeded.length
        ? orchestrateKnowledgeChange({ ...ctx, changedDomains: seeded })
        : { ok: true, outcome: 'noop', plan: computeInvalidationPlan([]), tasks: [], correlationId: ctx.correlationId ?? (await resolveOrchestrationCorrelationId(null, ctx.companyId)) };
    default:
      return { ignored: true, event: eventName };
  }
}
