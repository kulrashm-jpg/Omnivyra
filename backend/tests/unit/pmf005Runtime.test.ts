/**
 * PMF-005 §1/§4/§8/§11 — Campaign Planner platform runtime: AIA-agent-orchestrated,
 * plan node executes through AIC with the engine as backend, exact plan served
 * (parity), safety net (zero regression), observability.
 */

jest.mock('../../observability', () => ({ recordRawCounter: jest.fn(), recordRawHistogram: jest.fn() }));
jest.mock('../../services/aiAgent/aiAgentRuntime', () => ({ runAgent: jest.fn() }));
jest.mock('../../services/aiCapability/aiCapabilityRuntime', () => ({ executeCapability: jest.fn() }));

import { recordRawCounter } from '../../observability';
import { executeCapability } from '../../services/aiCapability/aiCapabilityRuntime';
import { runCampaignPlanViaPlatform } from '../../services/campaignCapability/campaignPlatformRuntime';

const mockExecuteCapability = executeCapability as jest.Mock;
const NOW = '2026-07-13T00:00:00.000Z';

function agentResult(over: Record<string, unknown> = {}) {
  return {
    status: 'completed', agent: 'CAMPAIGN_PLANNER_AGENT', runId: 'r', state: 'COMPLETED', results: {}, checkpoint: { executionMetadata: { checkpointCount: 4, resumeCount: 0 } },
    execution: { startedAt: NOW, finishedAt: NOW, durationMs: 12, completedSteps: 10, totalSteps: 10, resumed: false },
    ...over,
  };
}

// AIC mock: runs the modelRunner (→ engine) and returns a completed CapabilityResult.
beforeEach(() => {
  jest.clearAllMocks();
  mockExecuteCapability.mockImplementation(async (_req: any, deps: any) => {
    await deps.modelRunner({});
    return { status: 'completed', capability: 'CAMPAIGN_PLAN', result: deps.outputParser(), knowledgeVersion: 6, execution: { tokens: { input: 8, output: 8 } }, validation: { failures: 0 } };
  });
});

// A stub AIA runAgent that drives the plan node's capability executor (as the real
// agent would when it reaches the CAMPAIGN_STRATEGY node), then completes.
const agentRunnerCompleting = jest.fn(async (_req: any, deps: any) => {
  await deps.capabilityExecutor({ capability: 'CAMPAIGN_PLAN', companyId: 'org1', input: { __agentStep: 'CAMPAIGN_STRATEGY' } });
  return agentResult();
});

describe('PMF-005 §1/§4/§8 — platform runtime output parity', () => {
  test('serves the EXACT engine plan (identity), plan node runs through AIC, records telemetry', async () => {
    const PLAN = { mode: 'generate_plan', plan: { weeks: [{ week: 1, theme: 'Launch' }] }, validation_result: { valid: true } };
    const generate = jest.fn(async () => PLAN);
    const out = await runCampaignPlanViaPlatform({ companyId: 'org1', generate, now: NOW }, { agentRunner: agentRunnerCompleting as any });

    expect(out).toBe(PLAN);                       // exact object, no reshape
    expect(generate).toHaveBeenCalledTimes(1);    // engine ran once (inside the AIC model runner)
    expect(mockExecuteCapability).toHaveBeenCalledTimes(1); // plan node went through AIC
    const counters = (recordRawCounter as jest.Mock).mock.calls.map((c) => c[0]);
    expect(counters).toContain('campaign.runtime_usage');
    expect(counters).toContain('campaign.migration_coverage');
    expect(counters).toContain('campaign.agent_execution_ms');
    expect(counters).toContain('campaign.checkpoint_count');
    expect(counters).toContain('campaign.knowledge_version_usage');
  });

  test('auto-approves the modeled validation gate (synchronous parity)', async () => {
    const generate = jest.fn(async () => ({ ok: true }));
    await runCampaignPlanViaPlatform({ companyId: 'org1', generate, now: NOW }, { agentRunner: agentRunnerCompleting as any });
    const req = agentRunnerCompleting.mock.calls[0][0];
    expect(req.agent).toBe('CAMPAIGN_PLANNER_AGENT');
    expect(req.approvals[0]).toMatchObject({ stepId: 'CAMPAIGN_VALIDATION', decision: 'approved' });
  });

  test('deterministic: identical engine → identical plan', async () => {
    const generate = jest.fn(async () => ({ plan: { weeks: [1, 2] } }));
    const a = await runCampaignPlanViaPlatform({ companyId: 'org1', generate, now: NOW }, { agentRunner: agentRunnerCompleting as any });
    const b = await runCampaignPlanViaPlatform({ companyId: 'org1', generate, now: NOW }, { agentRunner: agentRunnerCompleting as any });
    expect(a).toEqual(b);
  });
});

describe('PMF-005 §8 — safety net (zero regression)', () => {
  test('agent never runs the plan node → engine executed directly', async () => {
    const PLAN = { plan: 'direct' };
    const generate = jest.fn(async () => PLAN);
    // Agent completes WITHOUT invoking the plan node executor (engine never runs).
    const agentRunnerNoPlan = jest.fn(async () => agentResult({ status: 'partial' }));
    const out = await runCampaignPlanViaPlatform({ companyId: 'org1', generate, now: NOW }, { agentRunner: agentRunnerNoPlan as any });
    expect(out).toBe(PLAN);
    expect(generate).toHaveBeenCalledTimes(1); // safety net ran it
  });

  test('agent throws → engine executed directly (never worse than legacy)', async () => {
    const PLAN = { plan: 'recovered' };
    const generate = jest.fn(async () => PLAN);
    const agentRunnerThrows = jest.fn(async () => { throw new Error('agent boom'); });
    const out = await runCampaignPlanViaPlatform({ companyId: 'org1', generate, now: NOW }, { agentRunner: agentRunnerThrows as any });
    expect(out).toBe(PLAN);
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
