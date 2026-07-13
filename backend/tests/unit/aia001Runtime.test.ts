/**
 * AIA-001 §1/§3/§4/§5/§6/§7/§8 — the agent runtime end-to-end: dependency-ordered
 * capability orchestration through AIC, approval WAIT + resume, checkpoints/memory,
 * fallback recovery, determinism, and backward-compatible guards.
 */

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../../security/audit/SecurityAuditService', () => ({ logSecurityEvent: jest.fn(async () => undefined) }));
jest.mock('../../observability', () => ({ recordRawCounter: jest.fn(), recordRawHistogram: jest.fn() }));
jest.mock('../../services/signupEventService', () => ({ SIGNUP_EVENT_SCHEMA_VERSION: '1.1', ensureSignupCorrelationId: jest.fn(async () => null) }));
jest.mock('../../services/crawl/crawlEventService', () => ({ resolveCrawlCorrelationId: jest.fn(async () => 'company:org1') }));
jest.mock('../../services/aiCapability/aiCapabilityRuntime', () => ({ executeCapability: jest.fn() }));

import { logSecurityEvent } from '../../security/audit/SecurityAuditService';
import { runAgent, resumeAgent, cancelAgent } from '../../services/aiAgent/aiAgentRuntime';
import type { AgentStore } from '../../services/aiAgent/agentStateStore';
import type { CapabilityExecutor } from '../../services/aiAgent/agentCapabilityOrchestrator';
import { makeApprovalRecord, type AgentCheckpoint } from '../../services/aiAgent';
import type { CapabilityResult } from '../../services/aiCapability/capabilityContracts';

const mockLog = logSecurityEvent as jest.MockedFunction<typeof logSecurityEvent>;
const NOW = '2026-07-13T00:00:00.000Z';

function memStore() {
  const data = new Map<string, AgentCheckpoint>();
  const store: AgentStore = {
    load: async (c, r) => data.get(`${c}:${r}`) ?? null,
    save: async (c, cp) => { data.set(`${c}:${cp.runId}`, JSON.parse(JSON.stringify(cp))); return true; },
    list: async (c) => [...data.values()].filter((x) => x.companyId === c),
  };
  return { store, data };
}

function capResult(capability: string, status: CapabilityResult['status'] = 'completed'): CapabilityResult {
  return {
    status, capability, result: status === 'failed' ? null : { ok: true, cap: capability }, confidence: status === 'failed' ? 0 : 80,
    sources: [{ kind: 'knowledge', ref: 'k' }], knowledgeVersion: 7,
    execution: { capability, startedAt: NOW, finishedAt: NOW, durationMs: 0, model: 'm', attempts: 1, resumed: false, stagesCompleted: [], knowledgeVersion: 7, tokens: { input: 1, output: 1 }, cacheUsed: false },
    tools: { calls: [], totalMs: 0, okCount: 0, failedCount: 0 },
    validation: { ok: status !== 'failed', checks: [], failures: status === 'failed' ? 1 : 0 },
  };
}

/** Executor that maps a capability to a status function. */
function executorFrom(map: (capability: string, callIndex: number) => CapabilityResult['status']): { exec: CapabilityExecutor; calls: string[] } {
  const calls: string[] = [];
  const exec: CapabilityExecutor = async (req) => {
    const idx = calls.filter((c) => c === req.capability).length;
    calls.push(req.capability);
    return capResult(req.capability, map(req.capability, idx));
  };
  return { exec, calls };
}

const deps = (store: AgentStore, exec: CapabilityExecutor) => ({ store, capabilityExecutor: exec, nowIso: () => NOW, clockMs: () => 0 });

function caps(): string[] { return mockLog.mock.calls.map((c) => (c[0] as any).capability); }

beforeEach(() => jest.clearAllMocks());

describe('AIA-001 §1/§4/§6 — orchestration + checkpoints', () => {
  test('agent completes, executing capabilities in dependency order via AIC', async () => {
    const { store } = memStore();
    const { exec, calls } = executorFrom(() => 'completed');
    const res = await runAgent({ agent: 'WEBSITE_INTELLIGENCE_AGENT', companyId: 'org1', runId: 'run1', now: NOW }, deps(store, exec));
    expect(res.status).toBe('completed');
    expect(res.state).toBe('COMPLETED');
    // analyze_site (WEBSITE_INTELLIGENCE) before competitors (COMPETITOR_INTELLIGENCE)
    expect(calls).toEqual(['WEBSITE_INTELLIGENCE', 'COMPETITOR_INTELLIGENCE']);
    expect(Object.keys(res.results).sort()).toEqual(['analyze_site', 'competitors']);
    const c = caps();
    expect(c).toContain('agent.AgentCreated');
    expect(c).toContain('agent.AgentStarted');
    expect(c).toContain('agent.CheckpointCreated');
    expect(c).toContain('agent.AgentCompleted');
  });

  test('checkpoint persisted and memory carries intermediate results', async () => {
    const { store, data } = memStore();
    const { exec } = executorFrom(() => 'completed');
    await runAgent({ agent: 'GROWTH_AGENT', companyId: 'org1', runId: 'run2', now: NOW }, deps(store, exec));
    const saved = data.get('org1:run2')!;
    expect(saved.state).toBe('COMPLETED');
    expect(saved.completedCapabilities).toEqual(expect.arrayContaining(['growth', 'recommend']));
    expect(Object.keys(saved.memory.intermediateResults)).toEqual(expect.arrayContaining(['growth', 'recommend']));
    expect(saved.memory.decisionHistory.length).toBeGreaterThan(0);
  });
});

describe('AIA-001 §7 — approval WAIT + resume', () => {
  test('pauses at approval gate then resumes to completion', async () => {
    const { store } = memStore();
    const { exec } = executorFrom(() => 'completed');
    // First run: write + creative complete, recommend needs approval → WAITING.
    const first = await runAgent({ agent: 'CONTENT_AGENT', companyId: 'org1', runId: 'run3', now: NOW }, deps(store, exec));
    expect(first.status).toBe('waiting');
    expect(first.state).toBe('WAITING');
    expect(first.pendingApproval?.stepId).toBe('recommend');
    expect(caps()).toContain('agent.ApprovalRequested');
    expect(caps()).toContain('agent.AgentWaiting');

    // Resume with approval → completes.
    jest.clearAllMocks();
    const second = await resumeAgent({ agent: 'CONTENT_AGENT', companyId: 'org1', runId: 'run3', now: NOW, approvals: [makeApprovalRecord('recommend', 'approved', NOW)] }, deps(store, exec));
    expect(second.status).toBe('completed');
    expect(second.execution.resumed).toBe(true);
    expect(second.checkpoint.executionMetadata.resumeCount).toBe(1);
    expect(caps()).toContain('agent.AgentResumed');
    expect(caps()).toContain('agent.CheckpointRestored');
    expect(caps()).toContain('agent.ApprovalReceived');
  });

  test('rejected approval fails the agent', async () => {
    const { store } = memStore();
    const { exec } = executorFrom(() => 'completed');
    await runAgent({ agent: 'CONTENT_AGENT', companyId: 'org1', runId: 'run4', now: NOW }, deps(store, exec));
    const res = await resumeAgent({ agent: 'CONTENT_AGENT', companyId: 'org1', runId: 'run4', now: NOW, approvals: [makeApprovalRecord('recommend', 'rejected', NOW)] }, deps(store, exec));
    expect(res.status).toBe('failed');
    expect(res.error).toBe('approval_rejected');
  });
});

describe('AIA-001 §8 — failure recovery', () => {
  test('step retries then falls back to the fallback capability', async () => {
    const { store } = memStore();
    // CAMPAIGN_PLANNER always fails; STRATEGIC_MIX (its fallback) succeeds. Others ok.
    const { exec, calls } = executorFrom((cap) => (cap === 'CAMPAIGN_PLANNER' ? 'failed' : 'completed'));
    await runAgent({ agent: 'CAMPAIGN_AGENT', companyId: 'org1', runId: 'run5', now: NOW }, deps(store, exec));
    const res = await resumeAgent({ agent: 'CAMPAIGN_AGENT', companyId: 'org1', runId: 'run5', now: NOW, approvals: [makeApprovalRecord('plan', 'approved', NOW)] }, deps(store, exec));
    expect(res.status).toBe('completed');
    // plan resolved via fallback STRATEGIC_MIX
    expect(res.results.plan.capability).toBe('STRATEGIC_MIX');
    // CAMPAIGN_PLANNER was retried (maxStepAttempts=2) before fallback
    expect(calls.filter((c) => c === 'CAMPAIGN_PLANNER').length).toBe(2);
  });

  test('exhausted step failure with a checkpoint → BLOCKED for manual intervention', async () => {
    const { store } = memStore();
    // growth has no fallback and GROWTH_AGENT is all_steps → after retries exhaust and a
    // checkpoint exists, the deterministic recovery rolls back and blocks for a human.
    const { exec } = executorFrom((cap) => (cap === 'GROWTH_INTELLIGENCE' ? 'failed' : 'completed'));
    const res = await runAgent({ agent: 'GROWTH_AGENT', companyId: 'org1', runId: 'run6', now: NOW }, deps(store, exec));
    expect(res.status).toBe('blocked');
    expect(res.state).toBe('BLOCKED');
    expect(res.error).toBe('rollback_to_checkpoint');
  });
});

describe('AIA-001 §3 — determinism + guards', () => {
  test('identical run → identical result', async () => {
    const a = await runAgent({ agent: 'WEBSITE_INTELLIGENCE_AGENT', companyId: 'org1', runId: 'runD', now: NOW }, deps(memStore().store, executorFrom(() => 'completed').exec));
    const b = await runAgent({ agent: 'WEBSITE_INTELLIGENCE_AGENT', companyId: 'org1', runId: 'runD', now: NOW }, deps(memStore().store, executorFrom(() => 'completed').exec));
    expect(a).toEqual(b);
  });
  test('unknown agent → failed', async () => {
    const res = await runAgent({ agent: 'NOPE', companyId: 'org1', runId: 'x', now: NOW }, deps(memStore().store, executorFrom(() => 'completed').exec));
    expect(res.status).toBe('failed');
    expect(res.error).toBe('unknown_agent');
  });
  test('cancel sets CANCELLED', async () => {
    const { store } = memStore();
    const { exec } = executorFrom(() => 'completed');
    await runAgent({ agent: 'CONTENT_AGENT', companyId: 'org1', runId: 'run7', now: NOW }, deps(store, exec)); // waits on approval
    const ok = await cancelAgent('org1', 'run7', deps(store, exec));
    expect(ok).toBe(true);
    const view = await store.load('org1', 'run7');
    expect(view!.state).toBe('CANCELLED');
  });
});
