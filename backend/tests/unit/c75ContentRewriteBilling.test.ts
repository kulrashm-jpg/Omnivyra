/**
 * C75 (BLOCKING money): the content_rewrite family is billed through runBilledAiCompletion.
 *   - POST /api/ai/blog-card-chat     (blogCardChat)
 *   - POST /api/content/suggest       (creatorFieldAssist)
 *   - POST /api/content/regenerate    (regenerateContent)
 * Per path (e1's pattern): (a) exactly ONE hold for the org + content_rewrite, then confirm; (b) insufficient credits
 * -> the model is NEVER called and the existing 402 shape is returned; (c) a retried request -> 1 hold total;
 * CONTROL: with BILLING_REQUIRE_AI_HANDLE=true the path does not throw (the REAL guard sees the credit handle).
 *
 * Real: the three route handlers, runBilledAiCompletion, aiGatewayBillingGuard, billedAiHttpError.
 * Faked: the orchestrator (wallet + holds keyed by the idempotency descriptor), the provider call, auth, data reads.
 */

// ---------------------------------------------------------------- infra
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: () => ({ select: async () => ({ data: [], error: null }) }) },
}));

// ---------------------------------------------------------------- gateway (mirrors the real guard check)
const modelCalls: Array<{ operation: string; companyId?: string | null; viaGuard: boolean }> = [];
const outputs: string[] = [];
async function provider(req: any, viaGuard: boolean) {
  modelCalls.push({ operation: req.operation, companyId: req.companyId, viaGuard });
  return {
    output: outputs.shift() ?? '{"done":false,"nextQuestion":"Who is it for?"}',
    metadata: { token_usage: { prompt_tokens: 500, completion_tokens: 100, total_tokens: 600 }, provider: 'openai', model: 'gpt-4o-mini' },
  };
}
jest.mock('../../services/aiGateway', () => ({
  // Same six lines as aiGatewayProvidersOps.runCompletionWithOperation, against the REAL guard module.
  runCompletionWithOperation: async (req: any) => {
    const { checkAiBillingGuard, isAiBillingEnforced } = require('../../services/billing/aiGatewayBillingGuard');
    const guard = await checkAiBillingGuard({ operation: req.operation, orgId: req.companyId ?? undefined });
    if (!guard.allowed && isAiBillingEnforced()) throw new Error(`[aiGateway] BILLING_REQUIRED: operation "${req.operation}"`);
    return provider(req, true);
  },
  runCompletion: async (req: any) => provider(req, false), // the real alias skips the guard entirely
}));

// ---------------------------------------------------------------- fake orchestrator (wallet + holds)
const PRICE = 3; // stands in for the resolver's content_rewrite floor; the tests only compare against PRICE
const wallet = { balance: 0 };
const holds: Array<{ key: string; orgId: string; action: string; state: 'held' | 'confirmed' | 'released' }> = [];
jest.mock('../../services/billing/enterpriseBillingOrchestrator', () => ({
  runBilledOperation: async (opts: any) => {
    const key = JSON.stringify(opts.idempotency);
    const prior = holds.find((h) => h.key === key);
    const out = (result: unknown) => ({ operationId: 'op', correlationId: 'c', idempotencyKey: key, result });
    if (prior?.state === 'confirmed') return out({ status: 'already_confirmed' });
    if (prior?.state === 'released') return out({ status: 'already_released' });
    if (wallet.balance < PRICE) return out({ status: 'insufficient_credits', available: wallet.balance, required: PRICE });
    const hold = { key, orgId: opts.orgId, action: opts.action, state: 'held' as 'held' | 'confirmed' | 'released' };
    holds.push(hold);
    try {
      const r = await opts.executor();
      hold.state = 'confirmed';
      wallet.balance -= PRICE;
      return out({ status: 'executed', result: r.result, settlement: { creditsCharged: PRICE } });
    } catch (err) {
      hold.state = 'released';
      throw err;
    }
  },
}));

// ---------------------------------------------------------------- auth + route deps
const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
jest.mock('../../services/supabaseAuthService', () => ({ getSupabaseUserFromRequest: async () => ({ user: { id: USER }, error: null }) }));
jest.mock('../../services/userContextService', () => ({
  enforceCompanyAccess: async () => ({ userId: USER }),
  resolveUserContext: async () => ({ userId: USER, defaultCompanyId: ORG }),
}));
jest.mock('../../chatGovernance', () => ({ validateAndModerateUserMessage: async () => ({ allowed: true }) }));
// suggest service reads
jest.mock('../../services/context/canonicalContentContextResolver', () => ({ resolveCompanyGroundingGuard: async () => ({ brand: 'Acme', allowedNames: ['Acme'], directive: '' }) }));
jest.mock('../../services/context/canonicalProfileAdapter', () => ({ getCanonicalProfile: async () => null }));
jest.mock('../../services/contentOpportunityService', () => ({ generateContentOpportunities: async () => [] }));
jest.mock('../../services/content/knowledgeGraph/coverageReadService', () => ({ readCompanyTopicCoverage: async () => [] }));
// regenerate route + services
jest.mock('../../middleware/withRBAC', () => ({ withRBAC: (h: unknown) => h }));
jest.mock('../../services/rbacService', () => ({ Role: { SUPER_ADMIN: 'SUPER_ADMIN', ADMIN: 'ADMIN', CONTENT_CREATOR: 'CONTENT_CREATOR', CONTENT_MANAGER: 'CONTENT_MANAGER' } }));
jest.mock('../../services/campaignOwnershipService', () => ({ resolveCampaignOwnership: async () => ({ status: 'OWNED', companyId: ORG }) }));
jest.mock('../../services/telemetry/telemetryDispatcher', () => ({ trackEvent: () => undefined }));
const savedVersions: unknown[] = [];
const versionStore: Array<{ content_json: Record<string, unknown> }> = [{ content_json: { headline: 'Old' } }];
const ASSET = { asset_id: 'asset-1', campaign_id: 'camp-1', platform: 'linkedin', status: 'draft' };
jest.mock('../../db/contentAssetStore', () => ({
  getContentAssetById: async () => ASSET,
  listContentVersions: async () => [...versionStore],
  createContentVersion: async (v: unknown) => { savedVersions.push(v); return v; },
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

function mockRes() {
  const res: any = { statusCode: 200, body: undefined, headers: {} };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = (k: string, v: unknown) => { res.headers[k] = v; return res; };
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
  },
  suggest: {
    run: () => call(suggest, { company_id: ORG, content_type: 'post' }),
    good: JSON.stringify({ topic: 'Onboarding that sticks', brief: 'Explain the three steps. Show one example. Close with a checklist.', angle: 'a', objective: 'o', audience: 'ops leads', reason: 'r', intent: 'authority', priority: 'high', tone: 'clear', format_guidance: 'f', platform_guidance: '' }),
    ok: (res: any) => expect(res.body?.suggestion?.topic).toBe('Onboarding that sticks'),
  },
  regenerate: {
    run: () => call(regenerate, { assetId: 'asset-1', instruction: 'Make it punchier' }, { rbac: { companyId: ORG } }),
    good: JSON.stringify({ headline: 'New', caption: 'c', hook: 'h', callToAction: 'cta', hashtags: [], tone: 't', reasoning: 'r' }),
    ok: (res: any) => expect(res.statusCode).toBe(200),
  },
} as const;

beforeEach(() => {
  holds.length = 0;
  modelCalls.length = 0;
  outputs.length = 0;
  savedVersions.length = 0;
  wallet.balance = 100;
  delete process.env.BILLING_REQUIRE_AI_HANDLE;
});

describe.each(Object.keys(ROUTES) as Array<keyof typeof ROUTES>)('C75 billing: %s', (name) => {
  const r = ROUTES[name];

  it('(a) one call -> exactly ONE hold for the org as content_rewrite, confirmed; the model ran inside it', async () => {
    outputs.push(r.good);
    const res = await r.run();
    r.ok(res);
    expect(holds).toEqual([expect.objectContaining({ orgId: ORG, action: 'content_rewrite', state: 'confirmed' })]);
    expect(modelCalls).toHaveLength(1);
    expect(modelCalls[0].companyId).toBe(ORG);
    expect(wallet.balance).toBe(100 - PRICE);
  });

  it('(b) insufficient credits -> the model is NEVER called; existing 402 shape', async () => {
    wallet.balance = PRICE - 1;
    const res = await r.run();
    expect(modelCalls).toHaveLength(0);
    expect(holds).toHaveLength(0);
    expect(res.statusCode).toBe(402);
    expect(res.body).toEqual({ error: 'Insufficient credits to generate content', code: 'INSUFFICIENT_CREDITS', required: PRICE, balance: PRICE - 1 });
  });

  it('(c) the same request retried -> 1 hold total, 1 model call, charged once', async () => {
    outputs.push(r.good, r.good);
    await r.run();
    await r.run();
    expect(holds).toHaveLength(1);
    expect(modelCalls).toHaveLength(1);
    expect(wallet.balance).toBe(100 - PRICE);
  });

  it('a non-JSON model answer -> the hold is RELEASED (not charged)', async () => {
    outputs.push('not json at all');
    await r.run();
    expect(holds).toEqual([expect.objectContaining({ state: 'released' })]);
    expect(wallet.balance).toBe(100);
  });

  it('CONTROL: BILLING_REQUIRE_AI_HANDLE=true -> the path still succeeds (the real guard sees the credit handle)', async () => {
    process.env.BILLING_REQUIRE_AI_HANDLE = 'true';
    outputs.push(r.good);
    const res = await r.run();
    r.ok(res);
    expect(modelCalls).toEqual([expect.objectContaining({ viaGuard: true })]);
  });
});

describe('regenerate specifics', () => {
  it('a non-JSON answer saves NO new version (before C75 an empty version was written)', async () => {
    outputs.push('not json');
    const res = await ROUTES.regenerate.run();
    expect(res.statusCode).toBe(500);
    expect(savedVersions).toHaveLength(0);
  });
});

describe('regenerate idempotency is scoped to the asset VERSION', () => {
  it('after a successful regenerate (a new version exists), the same instruction is a NEW charge', async () => {
    outputs.push(ROUTES.regenerate.good, ROUTES.regenerate.good);
    await ROUTES.regenerate.run();
    versionStore.push({ content_json: { headline: 'New' } });
    try {
      await ROUTES.regenerate.run();
    } finally {
      versionStore.length = 1;
    }
    expect(holds.filter((h) => h.state === 'confirmed')).toHaveLength(2);
    expect(new Set(holds.map((h) => h.key)).size).toBe(2);
  });
});

describe('billedAiHttpError + the refine_variant twin', () => {
  const { billedAiHttpError } = require('../../services/billing/billedAiHttpError');
  const { BilledAiNotExecutedError } = require('../../services/billing/runBilledAiCompletion');
  it('maps refusals to the MonetizedWorkflowError shapes; other errors -> null', () => {
    expect(billedAiHttpError(new BilledAiNotExecutedError('insufficient_credits', { available: 1, required: 5 })))
      .toEqual({ status: 402, body: { error: 'Insufficient credits to generate content', code: 'INSUFFICIENT_CREDITS', required: 5, balance: 1 } });
    expect(billedAiHttpError(new BilledAiNotExecutedError('no_credit_account'))).toEqual({ status: 402, body: { error: 'No credit account for org', code: 'NO_CREDIT_ACCOUNT' } });
    expect(billedAiHttpError(new BilledAiNotExecutedError('not_a_member'))).toEqual({ status: 403, body: { error: 'ORG_SCOPE_VIOLATION' } });
    expect(billedAiHttpError(new BilledAiNotExecutedError('org_control_blocked', { code: 'ORG_BLOCKED', reason: 'r' }))).toEqual({ status: 403, body: { error: 'ORG_BLOCKED', detail: 'r' } });
    expect(billedAiHttpError(new BilledAiNotExecutedError('already_confirmed')).status).toBe(409);
    expect(billedAiHttpError(new Error('boom'))).toBeNull();
  });
  it('refine_variant (runBilledAiCompletion) answers a refusal with 402/403/409, not a generic 500', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.resolve(__dirname, '../../services/activityWorkspace/contentRouteHandler.ts'), 'utf8');
    const tail = src.slice(src.lastIndexOf('  } catch (error) {'));
    expect(tail).toMatch(/const billedRefusal = billedAiHttpError\(error\);\s*if \(billedRefusal\) return res\.status\(billedRefusal\.status\)\.json\(billedRefusal\.body\);/);
    expect(tail.indexOf('billedAiHttpError(error)')).toBeLessThan(tail.indexOf("error: 'Failed to process activity content request'"));
  });
});

describe('suggest idempotency is per request body', () => {
  it('two DIFFERENT suggest requests are two charges (only an identical retry dedups)', async () => {
    outputs.push(ROUTES.suggest.good, ROUTES.suggest.good);
    await call(suggest, { company_id: ORG, content_type: 'post', user_input: 'about onboarding' });
    await call(suggest, { company_id: ORG, content_type: 'post', user_input: 'about pricing' });
    expect(holds.filter((h) => h.state === 'confirmed')).toHaveLength(2);
    expect(modelCalls).toHaveLength(2);
  });
});

describe('billedAiHttpError: already_confirmed vs already_released are distinct (e1)', () => {
  const { billedAiHttpError } = require('../../services/billing/billedAiHttpError');
  const { BilledAiNotExecutedError } = require('../../services/billing/runBilledAiCompletion');
  it('confirmed = already processed (charged); released = failed earlier, not charged', () => {
    expect(billedAiHttpError(new BilledAiNotExecutedError('already_confirmed'))).toEqual({ status: 409, body: { error: 'This request was already processed.', code: 'ALREADY_PROCESSED' } });
    expect(billedAiHttpError(new BilledAiNotExecutedError('already_released'))).toEqual({ status: 409, body: { error: 'An earlier attempt of this request failed and was not charged. Please try again.', code: 'ALREADY_RELEASED' } });
  });
});
