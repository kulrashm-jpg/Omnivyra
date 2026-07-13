/**
 * agentOperationalModel.ts — canonical operational read model (AIA-001 §11).
 *
 * READ-ONLY. Projects a deterministic operational snapshot of a company's agent
 * runs from the EXISTING checkpoint store — running/queued/blocked agents, waiting
 * approvals, checkpoints, last completed step, next planned step, execution health.
 * No writes, no side effects, no UI. Reuses the agent state store; adds no storage.
 */

import { reportSettingsAgentStore, type AgentStore } from './agentStateStore';
import { resolveAgent } from './agentRegistry';
import type { AgentCheckpoint } from './agentContracts';

export interface AgentRunView {
  runId: string;
  agent: string;
  state: AgentCheckpoint['state'];
  completedSteps: number;
  totalSteps: number;
  lastCompletedStep: string | null;
  nextPlannedStep: string | null;
  waitingApproval: { stepId: string; capability: string } | null;
  checkpointCount: number;
  resumeCount: number;
  updatedAt: string;
}

export interface AgentOperationalSnapshot {
  companyId: string;
  running: AgentRunView[];
  queued: AgentRunView[];   // CREATED/READY/RESUMING — scheduled but not yet running
  blocked: AgentRunView[];  // BLOCKED (manual intervention)
  waitingApprovals: AgentRunView[];
  completed: number;
  failed: number;
  cancelled: number;
  executionHealth: 'healthy' | 'degraded' | 'blocked';
}

function nextPlanned(cp: AgentCheckpoint): string | null {
  const def = resolveAgent(cp.agentId);
  if (!def) return cp.pendingCapabilities[0] ?? null;
  const doneSet = new Set(cp.completedCapabilities);
  const ready = def.steps.find((s) => !doneSet.has(s.id) && s.dependsOn.every((d) => doneSet.has(d)));
  return ready?.id ?? cp.pendingCapabilities[0] ?? null;
}

function toView(cp: AgentCheckpoint): AgentRunView {
  const def = resolveAgent(cp.agentId);
  const totalSteps = def?.steps.length ?? cp.completedCapabilities.length + cp.pendingCapabilities.length;
  const lastCompletedStep = cp.completedCapabilities.length ? cp.completedCapabilities[cp.completedCapabilities.length - 1] : null;
  // A WAITING run's blocker is the first pending step that requires approval.
  const blocker = cp.state === 'WAITING' && def
    ? def.steps.find((s) => s.requiresApproval && cp.pendingCapabilities.includes(s.id)) ?? null
    : null;
  return {
    runId: cp.runId, agent: cp.agentId, state: cp.state,
    completedSteps: cp.completedCapabilities.length, totalSteps,
    lastCompletedStep, nextPlannedStep: nextPlanned(cp),
    waitingApproval: blocker ? { stepId: blocker.id, capability: blocker.capability } : null,
    checkpointCount: cp.executionMetadata.checkpointCount,
    resumeCount: cp.executionMetadata.resumeCount,
    updatedAt: cp.executionMetadata.updatedAt,
  };
}

/** Assemble the operational snapshot. Read-only; never throws. */
export async function getAgentOperationalSnapshot(companyId: string, store: AgentStore = reportSettingsAgentStore): Promise<AgentOperationalSnapshot> {
  const shell: AgentOperationalSnapshot = { companyId, running: [], queued: [], blocked: [], waitingApprovals: [], completed: 0, failed: 0, cancelled: 0, executionHealth: 'healthy' };
  if (!companyId) return shell;
  let all: AgentCheckpoint[] = [];
  try { all = await store.list(companyId); } catch { return shell; }

  for (const cp of all) {
    const view = toView(cp);
    switch (cp.state) {
      case 'RUNNING': shell.running.push(view); break;
      case 'CREATED': case 'READY': case 'RESUMING': case 'PLANNING': shell.queued.push(view); break;
      case 'BLOCKED': shell.blocked.push(view); break;
      case 'WAITING': shell.waitingApprovals.push(view); break;
      case 'COMPLETED': shell.completed++; break;
      case 'FAILED': shell.failed++; break;
      case 'CANCELLED': shell.cancelled++; break;
    }
  }

  shell.executionHealth = shell.blocked.length > 0 ? 'blocked' : (shell.failed > 0 ? 'degraded' : 'healthy');
  // Deterministic ordering.
  const byRun = (a: AgentRunView, b: AgentRunView) => a.runId.localeCompare(b.runId);
  shell.running.sort(byRun); shell.queued.sort(byRun); shell.blocked.sort(byRun); shell.waitingApprovals.sort(byRun);
  return shell;
}
