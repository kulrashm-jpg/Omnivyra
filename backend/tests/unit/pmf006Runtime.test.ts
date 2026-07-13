/**
 * PMF-006 §1/§5/§8/§11 — Strategic Mix platform runtime: AIA-agent-orchestrated,
 * mix node executes through AIC with the engine as backend, exact mix served
 * (parity), safety net (zero regression), observability.
 */

jest.mock('../../observability', () => ({ recordRawCounter: jest.fn(), recordRawHistogram: jest.fn() }));
jest.mock('../../services/aiAgent/aiAgentRuntime', () => ({ runAgent: jest.fn() }));
jest.mock('../../services/aiCapability/aiCapabilityRuntime', () => ({ executeCapability: jest.fn() }));

import { recordRawCounter } from '../../observability';
import { executeCapability } from '../../services/aiCapability/aiCapabilityRuntime';
import { runStrategicMixViaPlatform } from '../../services/strategicMixCapability/strategicMixPlatformRuntime';

const mockExecuteCapability = executeCapability as jest.Mock;
const NOW = '2026-07-13T00:00:00.000Z';

function agentResult(over: Record<string, unknown> = {}) {
  return {
    status: 'completed', agent: 'STRATEGIC_MIX_AGENT', runId: 'r', state: 'COMPLETED', results: {}, checkpoint: { executionMetadata: { checkpointCount: 5, resumeCount: 0 } },
    execution: { startedAt: NOW, finishedAt: NOW, durationMs: 9, completedSteps: 12, totalSteps: 12, resumed: false },
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockExecuteCapability.mockImplementation(async (_req: any, deps: any) => {
    await deps.modelRunner({});
    return { status: 'completed', capability: 'STRATEGIC_MIX_DECISION', result: deps.outputParser(), knowledgeVersion: 5, execution: { tokens: { input: 4, output: 4 } }, validation: { failures: 0 } };
  });
});

// Stub AIA runAgent that drives the mix node's capability executor (CAMPAIGN_SELECTION), then completes.
const agentRunnerCompleting = jest.fn(async (_req: any, deps: any) => {
  await deps.capabilityExecutor({ capability: 'STRATEGIC_MIX_DECISION', companyId: 'org1', input: { __agentStep: 'CAMPAIGN_SELECTION' } });
  return agentResult();
});

describe('PMF-006 §1/§5/§8 — platform runtime output parity', () => {
  test('serves the EXACT engine mix (identity), mix node runs through AIC, records telemetry', async () => {
    const MIX = { plan: { weeks: [{ week: 1 }] }, result: { mode: 'combined' }, confidence: 88, valid: true };
    const generate = jest.fn(async () => MIX);
    const out = await runStrategicMixViaPlatform({ companyId: 'org1', generate, now: NOW }, { agentRunner: agentRunnerCompleting as any });

    expect(out).toBe(MIX);                          // exact object, no reshape
    expect(generate).toHaveBeenCalledTimes(1);      // engine ran once inside the AIC model runner
    expect(mockExecuteCapability).toHaveBeenCalledTimes(1); // mix node went through AIC
    const counters = (recordRawCounter as jest.Mock).mock.calls.map((c) => c[0]);
    expect(counters).toContain('strategicmix.runtime_usage');
    expect(counters).toContain('strategicmix.migration_coverage');
    expect(counters).toContain('strategicmix.decision_graph_ms');
    expect(counters).toContain('strategicmix.checkpoint_count');
    expect(counters).toContain('strategicmix.knowledge_version_usage');
    expect(counters).toContain('strategicmix.confidence');
  });

  test('auto-approves the modeled final-recommendation gate (synchronous parity)', async () => {
    const generate = jest.fn(async () => ({ ok: true }));
    await runStrategicMixViaPlatform({ companyId: 'org1', generate, now: NOW }, { agentRunner: agentRunnerCompleting as any });
    const req = agentRunnerCompleting.mock.calls[0][0];
    expect(req.agent).toBe('STRATEGIC_MIX_AGENT');
    expect(req.approvals[0]).toMatchObject({ stepId: 'FINAL_RECOMMENDATION', decision: 'approved' });
  });

  test('deterministic: identical engine → identical mix', async () => {
    const generate = jest.fn(async () => ({ plan: { weeks: [1, 2] } }));
    const a = await runStrategicMixViaPlatform({ companyId: 'org1', generate, now: NOW }, { agentRunner: agentRunnerCompleting as any });
    const b = await runStrategicMixViaPlatform({ companyId: 'org1', generate, now: NOW }, { agentRunner: agentRunnerCompleting as any });
    expect(a).toEqual(b);
  });
});

describe('PMF-006 §8 — safety net (zero regression)', () => {
  test('agent never runs the mix node → engine executed directly', async () => {
    const MIX = { plan: 'direct' };
    const generate = jest.fn(async () => MIX);
    const agentRunnerNoMix = jest.fn(async () => agentResult({ status: 'partial' }));
    const out = await runStrategicMixViaPlatform({ companyId: 'org1', generate, now: NOW }, { agentRunner: agentRunnerNoMix as any });
    expect(out).toBe(MIX);
    expect(generate).toHaveBeenCalledTimes(1); // safety net ran it
  });

  test('agent throws → engine executed directly (never worse than legacy)', async () => {
    const MIX = { plan: 'recovered' };
    const generate = jest.fn(async () => MIX);
    const agentRunnerThrows = jest.fn(async () => { throw new Error('agent boom'); });
    const out = await runStrategicMixViaPlatform({ companyId: 'org1', generate, now: NOW }, { agentRunner: agentRunnerThrows as any });
    expect(out).toBe(MIX);
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
