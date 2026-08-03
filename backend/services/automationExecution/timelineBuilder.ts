/**
 * INT-001 Phase 5 — Execution Timeline. Resolves the task dependency graph
 * into deterministic scheduled times anchored at the plan's generatedAt.
 * Wait tasks shape the schedule but do not appear as timeline entries.
 */

import type { AutomationTask, ExecutionTimelineEntry } from './types';

export function buildExecutionTimeline(tasks: AutomationTask[], generatedAt: string): ExecutionTimelineEntry[] {
  const startMs = Date.parse(generatedAt);
  const base = Number.isFinite(startMs) ? startMs : 0;

  // Resolve cumulative offset per task: offset(task) = offset(dependency) + own delay.
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const offsetCache = new Map<string, number>();
  const offsetOf = (task: AutomationTask): number => {
    const cached = offsetCache.get(task.id);
    if (cached !== undefined) return cached;
    const parent = task.dependsOn ? byId.get(task.dependsOn) : undefined;
    const value = (parent ? offsetOf(parent) : 0) + task.estimatedDelayHours;
    offsetCache.set(task.id, value);
    return value;
  };

  const entries: ExecutionTimelineEntry[] = tasks
    .filter((t) => t.kind !== 'wait')
    .map((t) => {
      const offsetHours = offsetOf(t);
      return {
        day: Math.floor(offsetHours / 24),
        scheduledAt: new Date(base + offsetHours * 3_600_000).toISOString(),
        taskId: t.id,
        action: t.action,
        channel: t.channel,
      };
    });

  // Deterministic ordering: time, then original task order (stable input order).
  return entries.sort((a, b) => (a.scheduledAt === b.scheduledAt
    ? a.taskId.localeCompare(b.taskId)
    : a.scheduledAt.localeCompare(b.scheduledAt)));
}
