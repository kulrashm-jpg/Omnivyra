/**
 * CKRE-004 §2/§4/§5/§8/§9/§11 — pure orchestration primitives:
 * semantic dependency graph, invalidation planning, adaptive scheduling,
 * the execution-task model, and the dashboard projection.
 */

import {
  KNOWLEDGE_DEPENDENCY_GRAPH, DEPENDENCY_NODE_IDS, propagateKnowledgeChange, nodeForDomain, downstreamOf,
} from '../../services/orchestration/knowledgeDependencyGraph';
import { computeInvalidationPlan } from '../../services/orchestration/downstreamInvalidationService';
import { computeSchedule } from '../../services/orchestration/adaptiveSchedulingService';
import { getRefreshPolicyConfig } from '../../services/crawl/refreshPolicyConfig';
import {
  makeTask, dedupeTasks, startTask, completeTask, failTask, cancelTask, recoverStuck, isStuck,
  runnableTasks, canTaskTransition, assertTaskTransition, taskIdempotencyKey,
} from '../../services/orchestration/executionTaskModel';
import { countTasks } from '../../services/orchestration/operationalDashboardModel';
import { resolveSubscription, isSubscribed, SUBSCRIBED_EVENTS } from '../../services/orchestration/orchestrationEventSubscriptions';

const NOW = '2026-07-13T00:00:00.000Z';

describe('CKRE-004 §2 — semantic dependency graph', () => {
  test('every node id resolves and is distinct from fingerprint graph (has consumers)', () => {
    expect(DEPENDENCY_NODE_IDS.length).toBeGreaterThan(0);
    for (const id of DEPENDENCY_NODE_IDS) expect(KNOWLEDGE_DEPENDENCY_GRAPH[id].id).toBe(id);
    expect(nodeForDomain('WEBSITE')).toBe('WEBSITE');
  });
  test('propagation is deterministic, sorted, and includes downstream + cache ops', () => {
    const a = propagateKnowledgeChange(['WEBSITE']);
    const b = propagateKnowledgeChange(['WEBSITE']);
    expect(a).toEqual(b);
    expect(a.affectedNodes).toEqual([...a.affectedNodes].sort());
    expect(a.invalidatesCacheOps).toEqual([...a.invalidatesCacheOps].sort());
    expect(a.affectedNodes).toContain('WEBSITE');
    // WEBSITE reaches SEO downstream.
    expect(downstreamOf('WEBSITE')).toContain('SEO');
  });
  test('empty change → empty plan', () => {
    const p = propagateKnowledgeChange([]);
    expect(p.affectedNodes).toEqual([]);
    expect(p.executionOrder).toEqual([]);
  });
});

describe('CKRE-004 §4 — invalidation plan', () => {
  test('computeInvalidationPlan mirrors propagation and sorts changedDomains', () => {
    const plan = computeInvalidationPlan(['SEO', 'WEBSITE']);
    expect(plan.changedDomains).toEqual(['SEO', 'WEBSITE']);
    expect(plan.executionOrder.length).toBeGreaterThan(0);
    expect(plan.affectedConsumers).toEqual([...plan.affectedConsumers].sort());
  });
});

describe('CKRE-004 §5 — adaptive scheduling is policy-derived', () => {
  const base = { config: getRefreshPolicyConfig(), tier: 'pro' as const, activity: 'low' as const, lastRefreshAt: null, lastActivityAt: null, now: Date.parse(NOW), isFirstOnboarding: false, isNewCompany: false, manualRefresh: false, forcedRefresh: false };
  test('forced → immediate pri 0; manual → immediate pri 10; onboarding → 1h', () => {
    expect(computeSchedule({ ...base, forcedRefresh: true }).priority).toBe(0);
    expect(computeSchedule({ ...base, manualRefresh: true }).priority).toBe(10);
    expect(computeSchedule({ ...base, isFirstOnboarding: true }).cadence).toBe('onboarding');
  });
  test('long inactivity → dormant, deterministic', () => {
    const stale = new Date(Date.parse(NOW) - 40 * 24 * 3600 * 1000).toISOString();
    const s = computeSchedule({ ...base, lastActivityAt: stale });
    expect(s.cadence).toBe('dormant');
  });
});

describe('CKRE-004 §8/§9 — execution task model', () => {
  const t = () => makeTask({ companyId: 'c1', type: 'downstream_invalidation', target: 'SEO', priority: 40, version: 2, now: NOW });

  test('idempotency key is stable; dedup keeps highest priority', () => {
    expect(taskIdempotencyKey('c1', 'downstream_invalidation', 'SEO', 2)).toBe('c1:downstream_invalidation:SEO:2');
    const dup = [{ ...t(), priority: 60 }, { ...t(), priority: 30 }];
    const out = dedupeTasks(dup);
    expect(out).toHaveLength(1);
    expect(out[0].priority).toBe(30);
  });

  test('legal transitions enforced', () => {
    expect(canTaskTransition('PENDING', 'RUNNING')).toBe(true);
    expect(canTaskTransition('COMPLETED', 'RUNNING')).toBe(false);
    expect(() => assertTaskTransition('COMPLETED', 'RUNNING')).toThrow(/ILLEGAL_TASK_TRANSITION/);
  });

  test('retry then dead-letter on exhausted attempts', () => {
    let task = makeTask({ companyId: 'c1', type: 'knowledge_refresh', target: 'all', priority: 40, maxAttempts: 2, now: NOW });
    task = startTask(task, NOW);            // attempt 1
    task = failTask(task, 'boom', NOW);
    expect(task.state).toBe('RETRYING');
    task = startTask(task, NOW);            // attempt 2 (== maxAttempts)
    task = failTask(task, 'boom', NOW);
    expect(task.state).toBe('DEAD_LETTER');
  });

  test('completeTask, cancel no-op on terminal, stuck recovery', () => {
    const done = completeTask(startTask(t(), NOW), NOW);
    expect(done.state).toBe('COMPLETED');
    expect(cancelTask(done, NOW)).toBe(done); // terminal → no-op

    const running = startTask(t(), NOW);
    const nowMs = Date.parse(NOW) + running.timeoutMs + 1;
    expect(isStuck(running, nowMs)).toBe(true);
    expect(recoverStuck(running, NOW).state).toBe('RETRYING');
  });

  test('runnableTasks returns PENDING/RETRYING in priority order', () => {
    const a = makeTask({ companyId: 'c', type: 'downstream_invalidation', target: 'A', priority: 50, now: NOW });
    const b = makeTask({ companyId: 'c', type: 'downstream_invalidation', target: 'B', priority: 20, now: NOW });
    const done = completeTask(startTask(makeTask({ companyId: 'c', type: 'downstream_invalidation', target: 'C', priority: 10, now: NOW }), NOW), NOW);
    const run = runnableTasks([a, b, done]);
    expect(run.map((x) => x.target)).toEqual(['B', 'A']);
  });
});

describe('CKRE-004 §3 — declarative subscriptions', () => {
  test('subscribed events resolve to triggers; unknown → null', () => {
    expect(isSubscribed('KnowledgeRolledBack')).toBe(true);
    expect(resolveSubscription('KnowledgeRolledBack')?.trigger).toBe('orchestrate_rollback');
    expect(resolveSubscription('WebsiteChanged')?.seedDomains).toContain('WEBSITE');
    expect(resolveSubscription('NopeEvent')).toBeNull();
    expect(SUBSCRIBED_EVENTS.length).toBeGreaterThan(10);
  });
});

describe('CKRE-004 §11 — dashboard projection', () => {
  test('countTasks buckets states deterministically', () => {
    const mk = (state: string) => ({ state } as any);
    const counts = countTasks([mk('PENDING'), mk('RUNNING'), mk('FAILED'), mk('RETRYING'), mk('DEAD_LETTER'), mk('COMPLETED')]);
    expect(counts).toEqual({ pending: 1, running: 1, failed: 1, blocked: 2, completed: 1 });
  });
});
