/**
 * AIA-001 §2/§3/§4/§7/§8/§11 — pure agent framework units: lifecycle machine,
 * registry, approval gate, recovery table, orchestration helpers, operational model.
 */

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn() } }));

import {
  canAgentTransition, assertAgentTransition, isTerminal, AGENT_STATES,
} from '../../services/aiAgent/agentLifecycle';
import { resolveAgent, REGISTERED_AGENTS } from '../../services/aiAgent/agentRegistry';
import { decideApprovalGate, makeApprovalRecord } from '../../services/aiAgent/agentApproval';
import { decideAgentRecovery } from '../../services/aiAgent/agentRecovery';
import { computeReadySteps, stepIsActive } from '../../services/aiAgent/agentCapabilityOrchestrator';
import { getAgentOperationalSnapshot } from '../../services/aiAgent/agentOperationalModel';
import { emptyMemory, type AgentCheckpoint, type AgentStep } from '../../services/aiAgent/agentContracts';
import type { AgentStore } from '../../services/aiAgent/agentStateStore';

describe('AIA-001 §3 — deterministic lifecycle', () => {
  test('legal transitions allowed, illegal blocked', () => {
    expect(canAgentTransition('CREATED', 'PLANNING')).toBe(true);
    expect(canAgentTransition('RUNNING', 'WAITING')).toBe(true);
    expect(canAgentTransition('WAITING', 'RESUMING')).toBe(true);
    expect(canAgentTransition('COMPLETED', 'RUNNING')).toBe(false);
    expect(() => assertAgentTransition('COMPLETED', 'RUNNING')).toThrow(/ILLEGAL_AGENT_TRANSITION/);
  });
  test('terminal states', () => {
    expect(isTerminal('COMPLETED')).toBe(true);
    expect(isTerminal('FAILED')).toBe(true);
    expect(isTerminal('RUNNING')).toBe(false);
    expect(AGENT_STATES.length).toBe(10);
  });
});

describe('AIA-001 §2 — agent registry', () => {
  test('agents resolve; supportedCapabilities derived from steps', () => {
    expect(REGISTERED_AGENTS.length).toBeGreaterThanOrEqual(4);
    const campaign = resolveAgent('CAMPAIGN_AGENT')!;
    expect(campaign).not.toBeNull();
    expect(campaign.supportedCapabilities).toEqual(expect.arrayContaining(['GROWTH_INTELLIGENCE', 'SEO_INTELLIGENCE', 'STRATEGIC_MIX', 'CAMPAIGN_PLANNER']));
    expect(campaign.approvalRequired).toBe(true); // plan step requires approval
    expect(resolveAgent('NOPE')).toBeNull();
  });
});

describe('AIA-001 §7 — approval gate', () => {
  const base = { stepId: 's', approvals: [], requestedAtMs: null, nowMs: 1000, timeoutMs: 500 };
  test('no decision within timeout → wait; past timeout → resubmit', () => {
    expect(decideApprovalGate(base).outcome).toBe('wait');
    expect(decideApprovalGate({ ...base, requestedAtMs: 400 }).outcome).toBe('resubmit'); // 600ms > 500
  });
  test('latest decision wins', () => {
    expect(decideApprovalGate({ ...base, approvals: [makeApprovalRecord('s', 'approved', 'T')] }).outcome).toBe('proceed');
    expect(decideApprovalGate({ ...base, approvals: [makeApprovalRecord('s', 'rejected', 'T')] }).outcome).toBe('reject');
    expect(decideApprovalGate({ ...base, approvals: [makeApprovalRecord('s', 'approved', 'T1'), makeApprovalRecord('s', 'resubmit', 'T2')] }).outcome).toBe('resubmit');
  });
});

describe('AIA-001 §8 — deterministic recovery', () => {
  const base = { attempt: 1, maxAttempts: 2, hasFallbackCapability: false, fallbackUsed: false, bestEffort: false, hasCheckpoint: false };
  test('retry while attempts remain', () => {
    expect(decideAgentRecovery({ ...base, failure: 'capability_failed' }).action).toBe('retry_step');
  });
  test('fallback when exhausted and available', () => {
    expect(decideAgentRecovery({ ...base, failure: 'capability_failed', attempt: 2, hasFallbackCapability: true }).action).toBe('fallback_capability');
  });
  test('best_effort → partial; checkpoint → rollback; else fail', () => {
    expect(decideAgentRecovery({ ...base, failure: 'capability_failed', attempt: 2, bestEffort: true }).action).toBe('partial');
    expect(decideAgentRecovery({ ...base, failure: 'capability_failed', attempt: 2, hasCheckpoint: true }).action).toBe('rollback');
    expect(decideAgentRecovery({ ...base, failure: 'capability_failed', attempt: 2 }).action).toBe('fail');
  });
  test('blocked → manual; deterministic', () => {
    expect(decideAgentRecovery({ ...base, failure: 'capability_blocked' }).action).toBe('manual');
    expect(decideAgentRecovery({ ...base, failure: 'timeout' })).toEqual(decideAgentRecovery({ ...base, failure: 'timeout' }));
  });
});

describe('AIA-001 §4 — orchestration helpers', () => {
  const steps: AgentStep[] = [
    { id: 'a', capability: 'X', mode: 'parallel', dependsOn: [], requiresApproval: false },
    { id: 'b', capability: 'Y', mode: 'parallel', dependsOn: [], requiresApproval: false },
    { id: 'c', capability: 'Z', mode: 'sequential', dependsOn: ['a', 'b'], requiresApproval: false },
  ];
  test('ready steps respect dependencies, sorted', () => {
    expect(computeReadySteps(steps, new Set()).map((s) => s.id)).toEqual(['a', 'b']);
    expect(computeReadySteps(steps, new Set(['a'])).map((s) => s.id)).toEqual(['b']);
    expect(computeReadySteps(steps, new Set(['a', 'b'])).map((s) => s.id)).toEqual(['c']);
    expect(computeReadySteps(steps, new Set(['a', 'b', 'c'])).length).toBe(0);
  });
  test('conditional gating via predicate registry', () => {
    const cond: AgentStep = { id: 'g', capability: 'X', mode: 'conditional', dependsOn: [], requiresApproval: false, when: 'hasBudget' };
    const mem = emptyMemory({});
    expect(stepIsActive(cond, mem, { hasBudget: () => false })).toBe(false);
    expect(stepIsActive(cond, mem, { hasBudget: () => true })).toBe(true);
    expect(stepIsActive(cond, mem, {})).toBe(true); // unknown predicate → fail-open
  });
});

describe('AIA-001 §11 — operational read model', () => {
  function cp(runId: string, agentId: string, state: AgentCheckpoint['state'], completed: string[], pending: string[]): AgentCheckpoint {
    return { runId, agentId, companyId: 'org1', state, currentStep: 0, completedCapabilities: completed, pendingCapabilities: pending, approvals: [], memory: emptyMemory({}), executionMetadata: { createdAt: 'T', updatedAt: 'T', attempts: {}, checkpointCount: 1, resumeCount: 0 } };
  }
  const store: AgentStore = {
    load: async () => null,
    save: async () => true,
    list: async () => [
      cp('r1', 'CAMPAIGN_AGENT', 'WAITING', ['growth', 'seo', 'mix'], ['plan']),
      cp('r2', 'GROWTH_AGENT', 'RUNNING', ['growth'], ['recommend']),
      cp('r3', 'CONTENT_AGENT', 'COMPLETED', ['write', 'creative', 'recommend'], []),
      cp('r4', 'GROWTH_AGENT', 'FAILED', ['growth'], ['recommend']),
    ],
  };

  test('projects running/waiting/blocked/completed with next planned step', async () => {
    const snap = await getAgentOperationalSnapshot('org1', store);
    expect(snap.running.map((v) => v.runId)).toEqual(['r2']);
    expect(snap.waitingApprovals.map((v) => v.runId)).toEqual(['r1']);
    expect(snap.completed).toBe(1);
    expect(snap.failed).toBe(1);
    expect(snap.executionHealth).toBe('degraded'); // a failure, no blocked
    // r1 waiting on the 'plan' approval gate
    expect(snap.waitingApprovals[0].waitingApproval?.stepId).toBe('plan');
    // r2 next planned step is 'recommend'
    expect(snap.running[0].nextPlannedStep).toBe('recommend');
  });
});
