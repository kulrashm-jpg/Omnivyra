/**
 * operationalDashboardModel.ts — canonical operational read model (CKRE-004 §11).
 *
 * READ-ONLY. Assembles a single deterministic snapshot of orchestration health
 * from the EXISTING sources (knowledge version store, task ledger, dependency
 * graph). No writes, no side effects — a projection for dashboards/observability.
 */

import type { ExecutionTask } from './executionTaskModel';
import { readTasks } from './orchestrationLedgerStore';
import { getKnowledgeState } from '../crawl/knowledgeVersionStore';
import { DEPENDENCY_NODE_IDS } from './knowledgeDependencyGraph';

export interface TaskCounts {
  pending: number;
  running: number;
  failed: number;
  blocked: number; // RETRYING + DEAD_LETTER
  completed: number;
}

export interface OperationalDashboard {
  companyId: string;
  currentKnowledgeVersion: number | null;
  currentRefreshState: 'idle' | 'running' | 'failed' | 'unknown';
  taskCounts: TaskCounts;
  dependencyNodeCount: number;
  lastRefreshAt: string | null;
  nextRefreshAt: string | null;
  knowledgeHealth: 'healthy' | 'degraded' | 'unknown';
  executionHealth: 'healthy' | 'degraded' | 'blocked';
  deadLetterTasks: string[];
}

/** Deterministic task-count projection. Pure. */
export function countTasks(tasks: ExecutionTask[]): TaskCounts {
  const c: TaskCounts = { pending: 0, running: 0, failed: 0, blocked: 0, completed: 0 };
  for (const t of tasks) {
    if (t.state === 'PENDING') c.pending++;
    else if (t.state === 'RUNNING') c.running++;
    else if (t.state === 'FAILED') c.failed++;
    else if (t.state === 'RETRYING' || t.state === 'DEAD_LETTER') c.blocked++;
    else if (t.state === 'COMPLETED') c.completed++;
  }
  return c;
}

function executionHealth(counts: TaskCounts, deadLetters: number): OperationalDashboard['executionHealth'] {
  if (deadLetters > 0) return 'blocked';
  if (counts.failed > 0 || counts.blocked > 0) return 'degraded';
  return 'healthy';
}

/** Assemble the read model. Read-only; never throws (returns an 'unknown' shell on error). */
export async function getOperationalDashboard(companyId: string): Promise<OperationalDashboard> {
  const shell: OperationalDashboard = {
    companyId, currentKnowledgeVersion: null, currentRefreshState: 'unknown',
    taskCounts: { pending: 0, running: 0, failed: 0, blocked: 0, completed: 0 },
    dependencyNodeCount: DEPENDENCY_NODE_IDS.length,
    lastRefreshAt: null, nextRefreshAt: null,
    knowledgeHealth: 'unknown', executionHealth: 'healthy', deadLetterTasks: [],
  };
  if (!companyId) return shell;

  try {
    const [state, tasks] = await Promise.all([getKnowledgeState(companyId), readTasks(companyId)]);
    const counts = countTasks(tasks);
    const deadLetters = tasks.filter((t) => t.state === 'DEAD_LETTER');
    const lastRecord = state.history.length ? state.history[state.history.length - 1] : null;
    const lastRefreshAt = (lastRecord && typeof (lastRecord as { at?: string }).at === 'string') ? (lastRecord as { at: string }).at : null;

    return {
      ...shell,
      currentKnowledgeVersion: state.version?.version ?? null,
      currentRefreshState: counts.running > 0 ? 'running' : (counts.failed > 0 ? 'failed' : 'idle'),
      taskCounts: counts,
      lastRefreshAt,
      nextRefreshAt: null, // owned by refreshPolicyEngine/adaptiveScheduling at decision time
      knowledgeHealth: state.version ? 'healthy' : 'unknown',
      executionHealth: executionHealth(counts, deadLetters.length),
      deadLetterTasks: deadLetters.map((t) => t.id).sort(),
    };
  } catch {
    return shell;
  }
}
