/**
 * PMF-007 §1/§5/§7/§10/§12 — Recommendation platform runtime: AIA-agent-orchestrated,
 * producing node executes through AIC with the engine backend, exact recs served with
 * an additive explanation (parity), safety net (zero regression), observability.
 */

jest.mock('../../observability', () => ({ recordRawCounter: jest.fn(), recordRawHistogram: jest.fn() }));
jest.mock('../../services/aiAgent/aiAgentRuntime', () => ({ runAgent: jest.fn() }));
jest.mock('../../services/aiCapability/aiCapabilityRuntime', () => ({ executeCapability: jest.fn() }));

import { recordRawCounter } from '../../observability';
import { executeCapability } from '../../services/aiCapability/aiCapabilityRuntime';
import { runRecommendationsViaPlatform } from '../../services/recommendationCapability/recommendationPlatformRuntime';

const mockExecuteCapability = executeCapability as jest.Mock;
const NOW = '2026-07-13T00:00:00.000Z';

function agentResult(over: Record<string, unknown> = {}) {
  return {
    status: 'completed', agent: 'RECOMMENDATION_AGENT', runId: 'r', state: 'COMPLETED', results: {}, checkpoint: { executionMetadata: { checkpointCount: 4, resumeCount: 0 } },
    execution: { startedAt: NOW, finishedAt: NOW, durationMs: 11, completedSteps: 10, totalSteps: 10, resumed: false },
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockExecuteCapability.mockImplementation(async (_req: any, deps: any) => {
    await deps.modelRunner({});
    return { status: 'completed', capability: 'RECOMMENDATION_DECISION', result: deps.outputParser(), knowledgeVersion: 9, execution: { tokens: { input: 6, output: 6 } }, validation: { failures: 0 } };
  });
});

const agentRunnerCompleting = jest.fn(async (_req: any, deps: any) => {
  await deps.capabilityExecutor({ capability: 'RECOMMENDATION_DECISION', companyId: 'org1', input: { __agentStep: 'CAMPAIGN_RECOMMENDATIONS' } });
  return agentResult();
});

describe('PMF-007 §1/§5/§7 — output parity + explainability', () => {
  test('serves the engine recs, adds an explanation, records telemetry', async () => {
    const RECS = { recommendations: [{ id: 'a' }], confidence: 82, valid: true };
    const generate = jest.fn(async () => RECS);
    const out = await runRecommendationsViaPlatform({ companyId: 'org1', generate, now: NOW }, { agentRunner: agentRunnerCompleting as any }) as any;

    expect(generate).toHaveBeenCalledTimes(1);      // engine ran once inside the AIC model runner
    expect(mockExecuteCapability).toHaveBeenCalledTimes(1); // producing node went through AIC
    // payload preserved (parity)
    expect(out.recommendations).toEqual([{ id: 'a' }]);
    expect(out.confidence).toBe(82);
    // §7 explanation attached with every required field
    expect(out.__explanation.confidence).toBe(82);
    expect(out.__explanation.knowledgeVersion).toBe(9);
    expect(out.__explanation.decisionSource.node).toBe('CAMPAIGN_RECOMMENDATIONS');
    expect(Array.isArray(out.__explanation.evidence)).toBe(true);
    expect(Array.isArray(out.__explanation.reasonCodes)).toBe(true);
    expect(Array.isArray(out.__explanation.dependencies)).toBe(true);
    expect(typeof out.__explanation.priorityExplanation).toBe('string');

    const counters = (recordRawCounter as jest.Mock).mock.calls.map((c) => c[0]);
    expect(counters).toContain('recommendation.runtime_usage');
    expect(counters).toContain('recommendation.migration_coverage');
    expect(counters).toContain('recommendation.graph_execution_ms');
    expect(counters).toContain('recommendation.knowledge_version_usage');
    expect(counters).toContain('recommendation.confidence');
  });

  test('explain=false preserves byte parity (no explanation attached)', async () => {
    const RECS = { recommendations: [1] };
    const generate = jest.fn(async () => RECS);
    const out = await runRecommendationsViaPlatform({ companyId: 'org1', generate, now: NOW, explain: false }, { agentRunner: agentRunnerCompleting as any }) as any;
    expect(out).toBe(RECS); // exact object, no annotation
  });

  test('auto-approves the modeled final gate (synchronous parity); deterministic', async () => {
    const generate = jest.fn(async () => ({ recommendations: [1, 2] }));
    const a = await runRecommendationsViaPlatform({ companyId: 'org1', generate, now: NOW }, { agentRunner: agentRunnerCompleting as any });
    const b = await runRecommendationsViaPlatform({ companyId: 'org1', generate, now: NOW }, { agentRunner: agentRunnerCompleting as any });
    expect(a).toEqual(b);
    const req = agentRunnerCompleting.mock.calls[0][0];
    expect(req.agent).toBe('RECOMMENDATION_AGENT');
    expect(req.approvals[0]).toMatchObject({ stepId: 'FINAL_RECOMMENDATIONS', decision: 'approved' });
  });
});

describe('PMF-007 §10 — safety net (zero regression)', () => {
  test('agent never runs the producing node → engine executed directly', async () => {
    const RECS = { recommendations: ['direct'] };
    const generate = jest.fn(async () => RECS);
    const agentRunnerNoProduce = jest.fn(async () => agentResult({ status: 'partial' }));
    const out = await runRecommendationsViaPlatform({ companyId: 'org1', generate, now: NOW, explain: false }, { agentRunner: agentRunnerNoProduce as any });
    expect(out).toBe(RECS);
    expect(generate).toHaveBeenCalledTimes(1); // safety net ran it
  });

  test('agent throws → engine executed directly (never worse than legacy)', async () => {
    const RECS = { recommendations: ['recovered'] };
    const generate = jest.fn(async () => RECS);
    const agentRunnerThrows = jest.fn(async () => { throw new Error('agent boom'); });
    const out = await runRecommendationsViaPlatform({ companyId: 'org1', generate, now: NOW, explain: false }, { agentRunner: agentRunnerThrows as any });
    expect(out).toBe(RECS);
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
