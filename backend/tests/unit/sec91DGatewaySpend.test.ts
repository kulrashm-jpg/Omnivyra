/**
 * SEC91-D (STEP 3AH-91) — AI gateway: whose key pays, what it may buy, and who
 * may see the answer. Drives the REAL executeGatewayCompletion
 * (aiGatewayProvidersOps) and the REAL resolveLlmConfig (aiGatewayCore); only
 * the provider dispatch, DB, plan/cost lookups and cache storage are faked.
 *
 *   D4  a company_llm_configs row WITHOUT a usable company key no longer buys
 *       the company's chosen (premium) model on the platform key unless the
 *       plan/cost gates allow it; BYOK keeps its chosen model on its own key.
 *   D6  BYOK responses are cached and in-flight-coalesced only within the
 *       company whose key produced them; platform keys are byte-identical.
 *   D2  a billed call (runBilledAiCompletion) carries its credit handle into
 *       the gateway's own billing-guard check, so it is never recorded — or,
 *       under BILLING_REQUIRE_AI_HANDLE=true, blocked — as untracked.
 *   D7  chat moderation stays fail-open, but every fail-open is counted.
 *   D9  the OpenAI SDK does no retries of its own when the gateway owns
 *       transient retries (no nested retry loops).
 */
import { createHash } from 'crypto';

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
const { invalidateAllowlistCache } = require('../../services/billing/aiGatewayBillingGuard');
const { runBilledAiCompletion } = require('../../services/billing/runBilledAiCompletion');
const { buildNormalizedKey } = jest.requireActual('../../services/aiResponseCache');
const { resolveOpenAiSdkMaxRetries } = require('../../services/aiGatewayCore');
/* eslint-enable @typescript-eslint/no-var-requires */

const CO_FREE_KEYLESS = '11111111-1111-1111-1111-111111111111';
const CO_BYOK = '22222222-2222-2222-2222-222222222222';
const CO_PLATFORM = '33333333-3333-3333-3333-333333333333';
const CO_DECRYPT_FAIL = '44444444-4444-4444-4444-444444444444';
const CO_ENTERPRISE_KEYLESS = '55555555-5555-5555-5555-555555555555';

const msgs = (t = 'Write a tagline for a bakery') => [{ role: 'user' as const, content: t }];
const req = (companyId: string | null, extra: Record<string, unknown> = {}) => ({
  companyId, model: 'gpt-4o-mini', temperature: 0.2, messages: msgs(), operation: 'generateContentForDay', ...extra,
});
const providerCall = (i = 0) => ({ provider: mockCallProvider.mock.calls[i][0], params: mockCallProvider.mock.calls[i][1] });

let providerReply = 'generated';
beforeEach(() => {
  for (const k of Object.keys(mockConfigs)) delete mockConfigs[k];
  for (const k of Object.keys(mockKeys)) delete mockKeys[k];
  mockCacheStore.clear();
  mockCallProvider.mockReset();
  mockCallProvider.mockImplementation(async () => ({ content: providerReply, usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }, usedFallback: false, retry_attempt: 1 }));
  mockPlanModel.mockReset();
  mockPlanModel.mockImplementation(async (m: string) => m);
  mockCost.mockReset();
  mockCost.mockImplementation(async () => ({ action: 'allow', effectiveModel: undefined, reason: '' }));
  mockCounter.mockClear();
  mockRunBilledOperation.mockClear();
  mockAllowlistRows.length = 0;
  invalidateAllowlistCache();
  delete process.env.BILLING_REQUIRE_AI_HANDLE;
  delete process.env.AI_GATEWAY_RETRY_TRANSIENT;
  providerReply = 'generated';

  // A free-plan company whose admin saved a premium Anthropic model with NO key.
  mockConfigs[CO_FREE_KEYLESS] = { provider_name: 'anthropic', model_key: 'claude-opus-4-1', is_active: true };
  mockKeys[CO_FREE_KEYLESS] = { key: 'sk-ant-PLATFORM-ANTHROPIC', source: 'platform' };
  // A company on its own OpenAI key with its own premium model.
  mockConfigs[CO_BYOK] = { provider_name: 'openai', model_key: 'gpt-4-turbo', is_active: true };
  mockKeys[CO_BYOK] = { key: 'sk-COMPANY-BYOK', source: 'company' };
  // A company whose stored key fails to decrypt.
  mockConfigs[CO_DECRYPT_FAIL] = { provider_name: 'openai', model_key: 'gpt-4-turbo', is_active: true };
  mockKeys[CO_DECRYPT_FAIL] = { key: 'sk-PLATFORM-OPENAI', source: 'platform', byokUnavailable: true };
  // An enterprise company with a keyless config whose plan DOES allow its model.
  mockConfigs[CO_ENTERPRISE_KEYLESS] = { provider_name: 'anthropic', model_key: 'claude-sonnet-4-6', is_active: true };
  mockKeys[CO_ENTERPRISE_KEYLESS] = { key: 'sk-ant-PLATFORM-ANTHROPIC', source: 'platform' };
});

// Plan tiers: the router downgrades every non-mini model for the free company.
const freePlan = () => mockPlanModel.mockImplementation(async (m: string, _op: string, org: unknown) => (org === CO_FREE_KEYLESS || org === CO_DECRYPT_FAIL ? 'gpt-4o-mini' : m));

// ── D4 ──────────────────────────────────────────────────────────────────────
describe('SEC91-D4 credential-bound model selection', () => {
  it('keyless company config on a free plan does NOT buy its premium model on the platform key', async () => {
    freePlan();
    await ops.runCompletion(req(CO_FREE_KEYLESS));
    const { provider, params } = providerCall();
    expect(params.model).not.toBe('claude-opus-4-1');
    expect(params.model).toBe('gpt-4o-mini');
    expect(provider).toBe('openai');
    expect(params.apiKey).toBe('sk-PLATFORM-OPENAI');
    // the plan gate was consulted for the company's chosen model
    expect(mockPlanModel.mock.calls.some((c) => c[0] === 'claude-opus-4-1')).toBe(true);
  });

  it('keyless company config is also subject to the cost estimator (downgrade)', async () => {
    mockCost.mockImplementation(async (model: unknown) => (model === 'claude-opus-4-1'
      ? { action: 'downgrade', effectiveModel: 'gpt-4o-mini', reason: 'over plan cost' }
      : { action: 'allow', effectiveModel: undefined, reason: '' }));
    await ops.runCompletion(req(CO_FREE_KEYLESS));
    expect(providerCall().params.model).not.toBe('claude-opus-4-1');
    expect(providerCall().params.apiKey).toBe('sk-PLATFORM-OPENAI');
  });

  it('keyless company config whose plan allows the model keeps it (legitimate enterprise use preserved)', async () => {
    await ops.runCompletion(req(CO_ENTERPRISE_KEYLESS));
    const { provider, params } = providerCall();
    expect(provider).toBe('anthropic');
    expect(params.model).toBe('claude-sonnet-4-6');
    expect(params.apiKey).toBe('sk-ant-PLATFORM-ANTHROPIC');
  });

  it('BYOK keeps its chosen model and pays with its own key — even on a plan that would downgrade', async () => {
    mockPlanModel.mockImplementation(async () => 'gpt-4o-mini');
    await ops.runCompletion(req(CO_BYOK));
    const { provider, params } = providerCall();
    expect(provider).toBe('openai');
    expect(params.model).toBe('gpt-4-turbo');
    expect(params.apiKey).toBe('sk-COMPANY-BYOK');
  });

  it('a stored key that fails to decrypt does not silently buy the premium model on the platform key', async () => {
    freePlan();
    await ops.runCompletion(req(CO_DECRYPT_FAIL));
    const { params } = providerCall();
    expect(params.model).toBe('gpt-4o-mini');
    expect(params.apiKey).toBe('sk-PLATFORM-OPENAI');
  });

  it('no company config → platform default + gated request model (unchanged)', async () => {
    await ops.runCompletion(req(CO_PLATFORM, { model: 'gpt-4o' }));
    const { provider, params } = providerCall();
    expect(provider).toBe('openai');
    expect(params.model).toBe('gpt-4o');
    expect(params.apiKey).toBe('sk-PLATFORM-OPENAI');
  });
});

// ── D6 ──────────────────────────────────────────────────────────────────────
describe('SEC91-D6 cache + in-flight coalescing credential scope', () => {
  it('platform-key cache keys are byte-identical to the legacy key', () => {
    const legacy = `omnivyra:ai_resp:v2:${createHash('sha256').update(JSON.stringify({ model: 'gpt-4o-mini', messages: msgs(), v: '' })).digest('hex')}`;
    expect(buildNormalizedKey('gpt-4o-mini', msgs(), undefined)).toBe(legacy);
    expect(buildNormalizedKey('gpt-4o-mini', msgs(), undefined, null)).toBe(legacy);
    expect(buildNormalizedKey('gpt-4o-mini', msgs(), undefined, 'byok:x')).not.toBe(legacy);
  });

  it("a BYOK tenant's cached answer is never served to another tenant (and vice versa)", async () => {
    mockConfigs[CO_BYOK] = { provider_name: 'openai', model_key: 'gpt-4o-mini', is_active: true }; // same model as the platform
    providerReply = 'BYOK-TENANT-ANSWER';
    const b = await ops.runCompletion(req(CO_BYOK));
    expect(b.output).toBe('BYOK-TENANT-ANSWER');
    providerReply = 'PLATFORM-TENANT-ANSWER';
    const a = await ops.runCompletion(req(CO_PLATFORM));
    expect(a.output).toBe('PLATFORM-TENANT-ANSWER');
    expect(mockCallProvider).toHaveBeenCalledTimes(2);
    // B's own repeat is still a cache hit
    const b2 = await ops.runCompletion(req(CO_BYOK));
    expect(b2.output).toBe('BYOK-TENANT-ANSWER');
    expect(mockCallProvider).toHaveBeenCalledTimes(2);
  });

  it('concurrent identical requests from a BYOK and a platform tenant are NOT coalesced onto one key', async () => {
    mockConfigs[CO_BYOK] = { provider_name: 'openai', model_key: 'gpt-4o-mini', is_active: true };
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    mockCallProvider.mockImplementation(async (_p: string, params: { apiKey: string }) => {
      await gate;
      return { content: `answer-for-${params.apiKey}`, usage: null, usedFallback: false, retry_attempt: 1 };
    });
    const pA = ops.runCompletion(req(CO_PLATFORM));
    const pB = ops.runCompletion(req(CO_BYOK));
    await new Promise((r) => setImmediate(r));
    release();
    const [a, b] = await Promise.all([pA, pB]);
    expect(mockCallProvider).toHaveBeenCalledTimes(2);
    expect(a.output).toBe('answer-for-sk-PLATFORM-OPENAI');
    expect(b.output).toBe('answer-for-sk-COMPANY-BYOK');
  });

  it('two platform-key tenants still share the exact cache (legacy behaviour preserved)', async () => {
    const other = '66666666-6666-6666-6666-666666666666';
    await ops.runCompletion(req(CO_PLATFORM));
    await ops.runCompletion(req(other));
    expect(mockCallProvider).toHaveBeenCalledTimes(1);
  });
});

// ── D2 ──────────────────────────────────────────────────────────────────────
describe('SEC91-D2 credit handle reaches the gateway billing guard', () => {
  const billedArgs = () => ({
    module: 'test', userId: 'u1', orgId: CO_PLATFORM, action: 'content_rewrite', referenceType: 'x', referenceId: 'y',
    llmPricing: { provider: 'openai', model: 'gpt-4o-mini', maxInputTokens: 100, maxOutputTokens: 100, actionKey: 'content_rewrite' },
    idempotency: { kind: 'http', actorUserId: 'u1', action: 'content_rewrite', referenceId: 'y', requestBody: {} },
    completion: { model: 'gpt-4o-mini', temperature: 0, messages: msgs('billed prompt'), operation: 'refineVariant', companyId: CO_PLATFORM },
  });

  it('enforced: a BILLED call is executed (not blocked as untracked)', async () => {
    process.env.BILLING_REQUIRE_AI_HANDLE = 'true';
    const out = await runBilledAiCompletion(billedArgs());
    expect(out.text).toBe('generated');
    expect(mockCallProvider).toHaveBeenCalledTimes(1);
  });

  it('enforced: an UNBILLED call with no handle is blocked before the provider', async () => {
    process.env.BILLING_REQUIRE_AI_HANDLE = 'true';
    await expect(ops.runCompletionWithOperation({ ...req(CO_PLATFORM), operation: 'refineVariant' })).rejects.toThrow(/BILLING_REQUIRED/);
    expect(mockCallProvider).not.toHaveBeenCalled();
  });

  it('a handle reserved for org A does not vouch for a nested call attributed to org B', async () => {
    process.env.BILLING_REQUIRE_AI_HANDLE = 'true';
    const args = billedArgs();
    args.completion.companyId = CO_BYOK;
    await expect(runBilledAiCompletion(args)).rejects.toThrow(/BILLING_REQUIRED/);
    expect(mockCallProvider).not.toHaveBeenCalled();
  });
});

// ── D7 ──────────────────────────────────────────────────────────────────────
describe('SEC91-D7 moderation fail-open is observable', () => {
  it('provider failure → allowed (unchanged) and ai.moderation.fail_open is counted', async () => {
    mockCallProvider.mockImplementation(async () => { throw Object.assign(new Error('upstream 500'), { status: 500 }); });
    const r = await ops.moderateChatMessage({ message: 'hello there' });
    expect(r.allowed).toBe(true);
    expect(mockCounter.mock.calls.some((c) => c[0] === 'ai.moderation.fail_open')).toBe(true);
  });
});

// ── D9 ──────────────────────────────────────────────────────────────────────
describe('SEC91-D9 OpenAI SDK retries do not nest under gateway retries', () => {
  it('gateway owns transient retries → SDK maxRetries 0; flag off → SDK default (unchanged)', () => {
    expect(resolveOpenAiSdkMaxRetries({ AI_GATEWAY_RETRY_TRANSIENT: '1' } as unknown as NodeJS.ProcessEnv)).toBe(0);
    expect(resolveOpenAiSdkMaxRetries({ AI_GATEWAY_RETRY_TRANSIENT: 'true' } as unknown as NodeJS.ProcessEnv)).toBe(0);
    expect(resolveOpenAiSdkMaxRetries({} as unknown as NodeJS.ProcessEnv)).toBeUndefined();
  });

  it('callOpenAi passes maxRetries:0 to the SDK request when the gateway owns retries, and a timeout always', async () => {
    const { callOpenAi } = require('../../services/aiGatewayCore'); // eslint-disable-line @typescript-eslint/no-var-requires
    process.env.AI_GATEWAY_RETRY_TRANSIENT = '1';
    await callOpenAi({ apiKey: 'sk-x', model: 'gpt-4o-mini', temperature: 0, messages: msgs(), operation: 'op' });
    const optsOn = mockSdkCreate.mock.calls[0][1] as { maxRetries?: number; timeout?: number };
    expect(optsOn.maxRetries).toBe(0);
    expect(optsOn.timeout).toBeGreaterThan(0);
    delete process.env.AI_GATEWAY_RETRY_TRANSIENT;
    await callOpenAi({ apiKey: 'sk-x', model: 'gpt-4o-mini', temperature: 0, messages: msgs(), operation: 'op' });
    const optsOff = mockSdkCreate.mock.calls[1][1] as { maxRetries?: number; timeout?: number };
    expect('maxRetries' in optsOff).toBe(false);
    expect(optsOff.timeout).toBeGreaterThan(0);
  });
});
