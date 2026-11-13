/**
 * 039 (e1 condition 2) - the AI gateway mints ONE platform call id per logical request, inside the shared
 * in-flight promise and before any retry loop. Drives the REAL gateway (aiGatewayProvidersOps.runCompletion) with
 * the provider dispatch, DB, ledger and cache faked - the SEC91-D harness (sec91DGatewaySpend.test.ts), reused.
 *   - two CONCURRENT identical no-company callers share one promise -> exactly ONE platform usage write;
 *   - the retry tracking context carries the SAME call id (so provider attempt rows key off it);
 *   - two SEQUENTIAL requests are two logical requests -> two different call ids.
 */
jest.mock('@/config', () => ({
  config: {
    OPENAI_API_KEY: 'sk-PLATFORM-OPENAI',
    ANTHROPIC_API_KEY: 'sk-ant-PLATFORM-ANTHROPIC',
    OPENAI_MODEL: 'gpt-4o-mini',
    NODE_ENV: 'test',
    DEV_USER_ID: '',
  },
}));

// ── OpenAI SDK (only reached by the direct callOpenAi test below) ───────────
const mockSdkCreate = jest.fn(async (..._a: unknown[]) => ({ choices: [{ message: { content: 'sdk' }, finish_reason: 'stop' }], usage: null }));
jest.mock('openai', () => {
  class FakeOpenAI {
    chat = { completions: { create: (...a: unknown[]) => mockSdkCreate(...a) } };
    constructor(_opts: unknown) { /* no network */ }
  }
  return { __esModule: true, default: FakeOpenAI, OpenAI: FakeOpenAI };
});

// ── provider dispatch: captured, never real ─────────────────────────────────
const mockCallProvider = jest.fn();
jest.mock('../../services/aiGatewayProvidersRetry', () => ({
  callProviderWithRetry: (...a: unknown[]) => mockCallProvider(...a),
  buildMetadata: (provider: string, model: string, usage: unknown) => ({
    provider: provider === 'anthropic' ? 'direct-anthropic' : 'direct-openai', model, token_usage: usage, reasoning_trace_id: 't',
  }),
}));

// ── company LLM config (DB) ─────────────────────────────────────────────────
type CfgRow = { provider_name: string; model_key: string; is_active: boolean };
const mockConfigs: Record<string, CfgRow> = {};
const mockKeys: Record<string, { key: string; source: 'company' | 'platform'; byokUnavailable?: boolean }> = {};
jest.mock('../../services/llmProviderService', () => ({
  getCompanyLlmConfig: async (companyId: string) => mockConfigs[companyId] ?? null,
  resolveCompanyApiKey: async (companyId: string) => mockKeys[companyId],
  getActiveProviders: async () => [],
  getModelsByProvider: async () => [],
}));

// ── plan-tier router + cost estimator (the gates D4 must not skip) ──────────
const mockPlanModel = jest.fn(async (requested: string, _op: string, _org: unknown) => requested);
jest.mock('../../services/aiModelRouter', () => ({ resolveEffectiveModel: (...a: [string, string, unknown]) => mockPlanModel(...a) }));
const mockCost = jest.fn(async (..._a: unknown[]) => ({ action: 'allow' as string, effectiveModel: undefined as string | undefined, reason: '' }));
jest.mock('../../services/jobCostEstimator', () => ({ evaluateJobCost: (...a: unknown[]) => mockCost(...a) }));

// ── cache: REAL key construction, in-memory storage ─────────────────────────
const mockCacheStore = new Map<string, string>();
jest.mock('../../services/aiResponseCache', () => {
  const actual = jest.requireActual('../../services/aiResponseCache');
  return {
    ...actual,
    getCachedCompletion: async (_op: string, model: string, messages: any, v?: string | null, _t?: string | null, scope?: string | null) =>
      mockCacheStore.get(actual.buildNormalizedKey(model, messages, v, scope)) ?? null,
    setCachedCompletion: async (_op: string, model: string, messages: any, response: string, v?: string | null, _t?: string | null, scope?: string | null) => {
      mockCacheStore.set(actual.buildNormalizedKey(model, messages, v, scope), response);
    },
  };
});

// ── inert infrastructure ────────────────────────────────────────────────────
jest.mock('../../services/ai/aiRequestGuard', () => ({
  guardAiRequest: jest.fn(async () => undefined),
  providerFromModel: () => 'openai',
  AiGuardError: class AiGuardError extends Error {},
}));
jest.mock('../../services/usageEnforcementService', () => ({ checkUsageBeforeExecution: jest.fn(async () => ({ allowed: true })) }));
jest.mock('../../services/usageLedgerService', () => ({ logUsageEvent: jest.fn(async () => undefined), resolveLlmCost: jest.fn(async () => null) }));
jest.mock('../../services/usageMeterService', () => ({ incrementUsageMeter: jest.fn(async () => undefined) }));
jest.mock('../../services/pricingService', () => ({ assertModelPricingExists: jest.fn(async () => undefined), recordCostAnomaly: jest.fn(async () => undefined) }));
jest.mock('../../../lib/redis/usageProtection', () => ({ trackLlmTokens: jest.fn() }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: () => ({ insert: jest.fn(async () => ({ error: null })) }) }));
const mockAllowlistRows: Array<{ action_key: string; expires_at: string | null }> = [];
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: () => ({ select: async () => ({ data: mockAllowlistRows, error: null }) }) },
}));
const mockCounter = jest.fn();
jest.mock('../../observability', () => {
  const actual = jest.requireActual('../../observability');
  return { ...actual, recordRawCounter: (...a: unknown[]) => { mockCounter(...a); } };
});
const mockRunBilledOperation = jest.fn(async (args: any) => {
  const r = await args.executor();
  return {
    operationId: 'op-1', correlationId: 'c-1', idempotencyKey: 'k-1',
    result: { status: 'executed', result: r.result, settlement: { actualUsage: { inputTokens: 1, outputTokens: 1 } } },
  };
});
jest.mock('../../services/billing/enterpriseBillingOrchestrator', () => ({ runBilledOperation: (a: unknown) => mockRunBilledOperation(a) }));

/* eslint-disable @typescript-eslint/no-var-requires */
const ops = require('../../services/aiGatewayProvidersOps');
const { logUsageEvent } = require('../../services/usageLedgerService');
/* eslint-enable @typescript-eslint/no-var-requires */

const msgs = (t = 'Summarise platform topic signals') => [{ role: 'user' as const, content: t }];
const req = () => ({ companyId: null, model: 'gpt-4o-mini', temperature: 0.2, messages: msgs(), operation: 'generateContentForDay' });

let release: () => void = () => undefined;
beforeEach(() => {
  mockCacheStore.clear();
  (logUsageEvent as jest.Mock).mockClear();
  mockCallProvider.mockReset();
  mockCallProvider.mockImplementation(() => new Promise((resolve) => {
    release = () => resolve({ content: 'answer', usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 }, usedFallback: false, retry_attempt: 1 });
  }));
});
const platformWrites = () => (logUsageEvent as jest.Mock).mock.calls.map((c) => c[0]).filter((p: any) => p.platform_call);

it('two CONCURRENT identical no-company callers share one promise -> exactly ONE platform write, one call id', async () => {
  const a = ops.runCompletion(req());
  const b = ops.runCompletion(req());
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  release();
  const [ra, rb] = await Promise.all([a, b]);
  expect(ra).toBe(rb); // the same shared promise result
  expect(mockCallProvider).toHaveBeenCalledTimes(1);
  const writes = platformWrites();
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ organization_id: '00000000-0000-0000-0000-000000000000', platform_call: { writer: 'gateway', kind: 'final', attempt: 1 } });
  // the retry layer got the SAME call id in its tracking context (4th argument)
  expect(mockCallProvider.mock.calls[0][3]).toMatchObject({ callId: writes[0].platform_call.callId });
});

it('CONTROL: two SEQUENTIAL requests are two logical requests -> two different call ids', async () => {
  const first = ops.runCompletion(req());
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  release();
  await first;
  mockCacheStore.clear(); // no cache hit: a second real provider call
  const second = ops.runCompletion(req());
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  release();
  await second;
  const ids = platformWrites().map((p: any) => p.platform_call.callId);
  expect(ids).toHaveLength(2);
  expect(new Set(ids).size).toBe(2);
});
