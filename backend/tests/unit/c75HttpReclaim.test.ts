/**
 * e1 review of b5cdf9617 (BLOCKING): a FAILED http attempt (hold released, nothing charged) must not lock out the
 * identical retry. The REAL orchestrator (runBilledOperation) + REAL runBilledAiCompletion + REAL
 * resolveHttpAttemptRoot run here; the fake sits one level lower, at the ledger (executeWithCredits +
 * findCreditTransaction over one key -> phase map), so the reclaim is exercised end to end through each route.
 */

// ---------------------------------------------------------------- ledger fake
const ledger = new Map<string, 'hold' | 'confirm' | 'release'>();
const wallet = { balance: 0 };
const PRICE = 3;
let executions = 0;
jest.mock('../../repositories/creditExecutionRepository', () => ({
  findCreditTransaction: async (key: string) => (ledger.has(key) ? { id: key, execution_phase: ledger.get(key) } : null),
}));
jest.mock('../../services/creditExecutionService', () => ({
  // the REAL key builder (billingIdempotencyService derives http roots with it)
  makeIdempotencyKey: (...a: any[]) => jest.requireActual('../../services/creditExecutionServiceContracts').makeIdempotencyKey(...a),
  // Same settled-phase gate + HOLD/CONFIRM/RELEASE key derivation as creditExecutionServiceRuntimeCore.
  executeWithCredits: async (opts: any) => {
    const base = opts.idempotencyKey;
    if (ledger.has(`${base}:confirm`)) return { status: 'already_confirmed' };
    if (ledger.has(`${base}:release`)) return { status: 'already_released' };
    if (wallet.balance < PRICE) return { status: 'insufficient_credits', available: wallet.balance, required: PRICE };
    ledger.set(`${base}:hold`, 'hold');
    executions += 1;
    try {
      const r = await opts.executor();
      ledger.set(`${base}:confirm`, 'confirm');
      wallet.balance -= PRICE;
      return { status: 'executed', result: r.result, settlement: { creditsCharged: PRICE } };
    } catch (err) {
      ledger.set(`${base}:release`, 'release');
      throw err;
    }
  },
}));
jest.mock('../../db/supabaseClient', () => {
  const chain: any = {};
  chain.upsert = () => chain;
  chain.select = () => chain;
  chain.single = async () => ({ data: { id: 'op-1' }, error: null });
  chain.update = () => chain;
  chain.eq = () => Promise.resolve({ data: [], error: null });
  chain.maybeSingle = async () => ({ data: null, error: null });
  return { supabase: { from: () => chain } };
});

// ---------------------------------------------------------------- gateway + routes (as in c75ContentRewriteBilling)
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
const outputs: string[] = [];
let modelCalls = 0;
jest.mock('../../services/aiGateway', () => ({
  runCompletionWithOperation: async () => {
    modelCalls += 1;
    return { output: outputs.shift() ?? '{}', metadata: { token_usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }, provider: 'openai', model: 'gpt-4o-mini' } };
  },
  runCompletion: async () => { throw new Error('unbilled path must not be used'); },
}));
jest.mock('../../services/billing/aiGatewayBillingGuard', () => ({
  checkAiBillingGuard: async () => ({ allowed: true, reason: 'has_handle' }),
  runWithCreditHandle: (_h: unknown, fn: () => unknown) => fn(),
}));
const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
jest.mock('../../services/supabaseAuthService', () => ({ getSupabaseUserFromRequest: async () => ({ user: { id: USER }, error: null }) }));
jest.mock('../../services/userContextService', () => ({
  enforceCompanyAccess: async () => ({ userId: USER }),
  resolveUserContext: async () => ({ userId: USER, defaultCompanyId: ORG }),
}));
jest.mock('../../chatGovernance', () => ({ validateAndModerateUserMessage: async () => ({ allowed: true }) }));
jest.mock('../../services/context/canonicalContentContextResolver', () => ({ resolveCompanyGroundingGuard: async () => ({ brand: 'Acme', allowedNames: ['Acme'], directive: '' }) }));
jest.mock('../../services/context/canonicalProfileAdapter', () => ({ getCanonicalProfile: async () => null }));
jest.mock('../../services/contentOpportunityService', () => ({ generateContentOpportunities: async () => [] }));
jest.mock('../../services/content/knowledgeGraph/coverageReadService', () => ({ readCompanyTopicCoverage: async () => [] }));
jest.mock('../../middleware/withRBAC', () => ({ withRBAC: (h: unknown) => h }));
jest.mock('../../services/rbacService', () => ({ Role: { SUPER_ADMIN: 'SUPER_ADMIN', ADMIN: 'ADMIN', CONTENT_CREATOR: 'CONTENT_CREATOR', CONTENT_MANAGER: 'CONTENT_MANAGER' } }));
jest.mock('../../services/campaignOwnershipService', () => ({ resolveCampaignOwnership: async () => ({ status: 'OWNED', companyId: ORG }) }));
jest.mock('../../services/telemetry/telemetryDispatcher', () => ({ trackEvent: () => undefined }));
const ASSET = { asset_id: 'asset-1', campaign_id: 'camp-1', platform: 'linkedin', status: 'draft' };
jest.mock('../../db/contentAssetStore', () => ({
  getContentAssetById: async () => ASSET,
  listContentVersions: async () => [{ content_json: { headline: 'Old' } }],
  createContentVersion: async (v: unknown) => v,
  updateContentAssetStatus: async () => ASSET,
  createContentAsset: async () => ASSET,
  createContentReview: async () => ({}),
  listContentAssets: async () => [],
  getContentAssetByKey: async () => null,
}));
jest.mock('../../services/languageRefinementService', () => ({ refineLanguageOutput: async ({ content }: any) => ({ refined: content }) }));
jest.mock('../../services/editorialTextRefinementService', () => ({ refineGeneratedText: (t: string) => t }));
jest.mock('../../services/contentOverlapService', () => ({ detectContentOverlap: async () => ({ similarityScore: 0 }) }));

import blogCardChat from '../../../pages/api/ai/blog-card-chat';
import suggest from '../../../pages/api/content/suggest';
import regenerate from '../../../pages/api/content/regenerate';
import { resolveHttpAttemptRoot } from '../../services/billing/billingIdempotencyService';

function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = () => res;
  return res;
}
const call = async (h: any, body: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
  const res = mockRes();
  await h({ method: 'POST', body, query: {}, headers: {}, ...extra }, res);
  return res;
};

const ROUTES = {
  blogCardChat: {
    run: () => call(blogCardChat, { message: 'Write about onboarding', companyId: ORG }),
    good: '{"done":false,"nextQuestion":"Who is the audience?"}',
    ok: (res: any) => expect(res.body).toEqual(expect.objectContaining({ done: false })),
    repeat: (res: any) => expect(res.body).toEqual({ error: 'This request was already processed.', code: 'ALREADY_PROCESSED' }),
  },
  suggest: {
    run: () => call(suggest, { company_id: ORG, content_type: 'post' }),
    good: JSON.stringify({ topic: 'Onboarding that sticks', brief: 'Explain the three steps. Show one example. Close with a checklist.', angle: 'a', objective: 'o', audience: 'ops', reason: 'r', intent: 'authority', priority: 'high', tone: 't', format_guidance: 'f', platform_guidance: '' }),
    ok: (res: any) => expect(res.body?.suggestion?.topic).toBe('Onboarding that sticks'),
    repeat: (res: any) => expect(res.statusCode).toBe(200), // an identical repeat -> the free deterministic suggestion
  },
  regenerate: {
    run: () => call(regenerate, { assetId: 'asset-1', instruction: 'Make it punchier' }, { rbac: { companyId: ORG } }),
    good: JSON.stringify({ headline: 'New', caption: 'c', hook: 'h', callToAction: 'cta', hashtags: [], tone: 't', reasoning: 'r' }),
    ok: (res: any) => expect(res.statusCode).toBe(200),
    repeat: (res: any) => expect(res.body).toEqual({ error: 'This request was already processed.', code: 'ALREADY_PROCESSED' }),
  },
} as const;

beforeEach(() => {
  ledger.clear();
  outputs.length = 0;
  modelCalls = 0;
  executions = 0;
  wallet.balance = 100;
});

describe.each(Object.keys(ROUTES) as Array<keyof typeof ROUTES>)('http reclaim: %s', (name) => {
  const r = ROUTES[name];

  it('bad model output -> released, nothing charged; the IDENTICAL retry with good output executes and charges ONCE', async () => {
    outputs.push('not json');
    await r.run();
    expect(wallet.balance).toBe(100);
    expect([...ledger.values()].filter((p) => p === 'release')).toHaveLength(1);

    outputs.push(r.good);
    const retry = await r.run();
    r.ok(retry);
    expect(modelCalls).toBe(2);
    expect(wallet.balance).toBe(100 - PRICE);
    expect([...ledger.values()].filter((p) => p === 'confirm')).toHaveLength(1);
  });

  it('a CHARGED request repeated -> no second charge, no second model call; not reported as a failure', async () => {
    outputs.push(r.good);
    await r.run();
    const again = await r.run();
    r.repeat(again);
    expect(modelCalls).toBe(1);
    expect(wallet.balance).toBe(100 - PRICE);
  });
});

describe('resolveHttpAttemptRoot', () => {
  const look = (rows: Record<string, string>) => async (k: string) => rows[k] ?? null;
  it('fresh -> root; released -> next attempt; confirmed attempt -> stays (dedup)', async () => {
    expect(await resolveHttpAttemptRoot('k', look({}))).toBe('k');
    expect(await resolveHttpAttemptRoot('k', look({ 'k:release': 'r' }))).toBe('k:r1');
    expect(await resolveHttpAttemptRoot('k', look({ 'k:release': 'r', 'k:r1:release': 'r' }))).toBe('k:r2');
    expect(await resolveHttpAttemptRoot('k', look({ 'k:release': 'r', 'k:r1:confirm': 'c' }))).toBe('k:r1');
    expect(await resolveHttpAttemptRoot('k', look({ 'k:confirm': 'c' }))).toBe('k');
  });
});
