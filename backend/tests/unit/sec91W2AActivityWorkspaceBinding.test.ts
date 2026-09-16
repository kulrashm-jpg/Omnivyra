/**
 * SEC-91 W2-A (STEP 3AH-91, wave 2) — W2F-1a (P1, found by the W2-F re-export
 * route gate): /api/activity-workspace/content (served by
 * backend/services/activityWorkspace/contentRouteHandler via re-export).
 *
 * The handler proved membership of the company named in the body and then
 * wrote daily_content_plans.content for `activity.id` WITHOUT binding that
 * activity to the company. A member of company A could send
 * { companyId: A, activity: { id: <B's activity> } } and overwrite company B's
 * scheduled content (improve_variant / improve_variant_all / refine_variant /
 * generate_variants), billed to A. The canonical writer also interpolated the
 * raw id into a PostgREST `.or()` filter, so an id like
 * "<uuid>,campaign_id.eq.<victim campaign>" widened the match to another
 * tenant's rows.
 *
 * Now: a saved activity is loaded server-side and its campaign must belong to
 * the authorized company (else 404, nothing generated, nothing written); writes
 * go to exactly that verified row; a body campaignId must not be another
 * tenant's; activity ids that are not plain tokens are rejected (400) and the
 * writer refuses them at the sink too.
 *
 * Real chain: contentRouteHandler → contentRouteModel → canonicalExecutionAdapter
 * against the ROUTE-AUTH-001 harness DB. Only the AI/billing sinks are stubbed.
 */
import { seed, rows, writeCalls, calls, CO_A, CO_B, CAMPAIGN_A, CAMPAIGN_B, USER_A } from '../helpers/routeAuthHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
/*
 * The shared harness treats `.or()` as a no-op (every row matches). This file
 * is about exactly that filter, so wrap the harness builder with a PostgREST-
 * faithful `.or`: the expression is split on ',' into `col.eq.value` terms and a
 * row matches if ANY term matches — which is also how an injected
 * "<uuid>,campaign_id.eq.<victim>" widens the match in production.
 */
jest.mock('../../db/supabaseClient', () => {
  const h = require('../helpers/routeAuthHarness');
  const withOr = (b: any) => {
    let pred: ((r: Record<string, unknown>) => boolean) | null = null;
    b.or = (expr: string) => {
      const terms = String(expr).split(',').map((t) => {
        const m = /^([a-z_]+)\.eq\.(.*)$/.exec(t.trim());
        return m ? { col: m[1], val: m[2] } : null;
      });
      pred = (r) => terms.some((t) => !!t && String(r[t.col] ?? '') === t.val);
      return b;
    };
    const filterRes = (res: any) => (pred && res && Array.isArray(res.data) ? { ...res, data: res.data.filter(pred) } : res);
    const origThen = b.then;
    b.then = (ok: any, err: any) => origThen.call(b, (res: any) => ok(filterRes(res)), err);
    const origMaybe = b.maybeSingle;
    b.maybeSingle = async () => {
      if (!pred) return origMaybe();
      const all = await new Promise<any>((resolve) => origThen.call(b, resolve));
      const f = filterRes(all);
      return { data: f.error ? null : (f.data[0] ?? null), error: f.error };
    };
    return b;
  };
  const supabase = { ...h.fakeSupabase, from: (t: string) => withOr(h.fakeSupabase.from(t)) };
  return { supabase, default: supabase, getSupabase: () => supabase, supabaseAdmin: supabase };
});
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/routeAuthHarness').identityModule());

// The orchestration barrel constructs queue clients at import time; route the
// functions the handler uses to the real canonical adapter. STEP 3AH-95: the
// handler now also resolves its write target through the adapter
// (resolveActivityRow — parameterised, uuid-only), so that seam is real here too.
jest.mock('../../services/orchestration', () => ({
  updateExecutionContentByActivity: (...a: unknown[]) =>
    require('../../services/orchestration/canonicalExecutionAdapter').updateExecutionContentByActivity(...a),
  resolveActivityRow: (...a: unknown[]) =>
    require('../../services/orchestration/canonicalExecutionAdapter').resolveActivityRow(...a),
}));
jest.mock('../../services/orchestration/synchronization', () => ({
  synchronizeByActivity: jest.fn(async () => null),
  synchronizeExecutionState: jest.fn(async () => null),
}));
jest.mock('../../services/campaignBlueprintService', () => ({ getUnifiedCampaignBlueprint: jest.fn(async () => null) }));
jest.mock('../../services/executionPlannerService', () => ({ getDailyPlans: jest.fn(async () => []) }));

// AI + billing sinks: observed, deterministic.
const mockCompletion = jest.fn(async () => ({ output: 'IMPROVED BY AI', metadata: {} }));
jest.mock('../../services/aiGateway', () => ({ runCompletionWithOperation: (...a: unknown[]) => (mockCompletion as any)(...a) }));
jest.mock('../../services/unifiedContentProcessor', () => ({ processContent: jest.fn(async (i: { content: string }) => ({ content: i.content })) }));
jest.mock('../../services/creditDeductionService', () => ({ getCreditCost: jest.fn(async () => 1) }));
const mockExecuteWithCredits = jest.fn(async (o: { executor: () => Promise<unknown> }) => ({ status: 'executed', result: await o.executor() }));
jest.mock('../../services/creditExecutionService', () => ({
  executeWithCredits: (o: any) => mockExecuteWithCredits(o),
  executeWithEntryConsumption: (o: any) => mockExecuteWithCredits(o),
  makeIdempotencyKey: (...p: unknown[]) => p.join(':'),
}));
jest.mock('../../services/billing/creditEconomyActivation', () => ({ getCreditEconomyExecutionMode: jest.fn(async () => 'shadow') }));
jest.mock('../../services/billing', () => ({
  isRefineVariantBillingEnabled: jest.fn(async () => ({ enabled: false, reason: 'test' })),
  runBilledAiCompletion: jest.fn(async () => ({ text: 'BILLED' })),
}));
jest.mock('../../services/contentGenerationPipeline', () => ({
  buildPlatformVariantsFromMaster: jest.fn(async () => [{ platform: 'linkedin', content_type: 'post', generated_content: 'VARIANT BY AI' }]),
  generateMasterContentFromIntent: jest.fn(async () => ({ id: 'm', content: 'MASTER BY AI', generation_status: 'generated' })),
  optimizeDiscoverabilityForPlatform: jest.fn(async () => ({ hashtags: ['#x'] })),
}));
jest.mock('../../services/contentGeneration/blueprintGenerator', () => ({
  generateMasterContentStrict: jest.fn(async () => ({ master: { id: 'm', content: 'STRICT MASTER' }, usage: { inputTokens: 1, outputTokens: 1 }, provider: 'openai', model: 'gpt-4o-mini' })),
}));
jest.mock('../../services/creator/governanceItemEnricher', () => ({ enrichItemWithGovernance: jest.fn(async (i: unknown) => i) }));
jest.mock('../../../lib/auth/rateLimit', () => ({ checkRateLimit: jest.fn(async () => ({ allowed: true, remaining: 100, resetAt: 0 })) }));
jest.mock('../../services/billing/admissionControl', () => ({ evaluateActivityAdmission: jest.fn(async () => undefined) }));
jest.mock('../../services/billing/creditEconomyShadow', () => ({ emitCreditEconomyShadowEvaluation: jest.fn(async () => undefined) }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const handler = require('../../services/activityWorkspace/contentRouteHandler').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { updateExecutionContentByActivity } = require('../../services/orchestration/canonicalExecutionAdapter');

const ACT_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const ACT_B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const B_CONTENT = JSON.stringify({ platform_variants: [{ platform: 'linkedin', content_type: 'post', generated_content: 'B ORIGINAL SCHEDULED POST' }] });
const A_CONTENT = JSON.stringify({ platform_variants: [] });

beforeEach(() => {
  // B's row is FIRST on purpose: an unfiltered/widened match lands on it.
  seed({
    daily_content_plans: [
      { id: ACT_B, campaign_id: CAMPAIGN_B, execution_id: 'wk1-exec-1', content: B_CONTENT },
      { id: ACT_A, campaign_id: CAMPAIGN_A, execution_id: 'wk1-exec-1', content: A_CONTENT },
    ],
  });
  mockCompletion.mockClear();
  mockExecuteWithCredits.mockClear();
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'info').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

function mockRes() {
  const res: any = { statusCode: 200, body: undefined, headers: {} };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  res.setHeader = (k: string, v: unknown) => { res.headers[k] = v; return res; };
  return res;
}
async function post(body: Record<string, unknown>) {
  const res = mockRes();
  await handler({ method: 'POST', body, query: {}, headers: { authorization: 'Bearer tok-user-a' }, url: '/api/activity-workspace/content' } as any, res);
  return res;
}
const rowB = () => rows('daily_content_plans').find((r) => r.id === ACT_B)!;
const rowA = () => rows('daily_content_plans').find((r) => r.id === ACT_A)!;
const planWrites = () => writeCalls(['daily_content_plans']);

const VARIANT = { platform: 'linkedin', content_type: 'post', generated_content: 'hello world' };
const BODIES: Record<string, (activityId: string, extra?: Record<string, unknown>) => Record<string, unknown>> = {
  improve_variant: (id, extra) => ({ action: 'improve_variant', companyId: CO_A, activity: { id }, improvementType: 'IMPROVE_CTA', platform: 'linkedin', variant: VARIANT, ...extra }),
  improve_variant_all: (id, extra) => ({ action: 'improve_variant_all', companyId: CO_A, activity: { id }, improvementTypes: ['IMPROVE_CTA'], platform: 'linkedin', variant: VARIANT, ...extra }),
  refine_variant: (id, extra) => ({ action: 'refine_variant', companyId: CO_A, activity: { id }, platform: 'linkedin', refinement_prompt: 'tighten', current_content: 'hello world', schedule: { platform: 'linkedin', contentType: 'post' }, ...extra }),
  generate_variants: (id, extra) => ({ action: 'generate_variants', companyId: CO_A, activity: { id, platform: 'linkedin', contentType: 'post' }, schedules: [{ platform: 'linkedin', contentType: 'post' }], dailyExecutionItem: { master_content: { content: 'm' } }, ...extra }),
};

describe.each(Object.keys(BODIES))('%s', (action) => {
  /*
   * STEP 3AH-95 reconciliation: the refusal is unchanged (nothing generated,
   * nothing written, B's row untouched); only its STATUS is now 403
   * ORG_SCOPE_VIOLATION instead of 404. That is the code the same route already
   * returns for a foreign company one check earlier, and the platform
   * vocabulary (TenantGuard: 403 cross-tenant, 404 unresolvable owner — the
   * route still answers 404 when the activity has no campaign). The
   * authenticated 403-vs-404 oracle is the accepted SEC91-A6-a decision.
   */
  it('THE EXPLOIT: member of A + companyId A + B\'s activity → 403; nothing generated, B\'s content untouched', async () => {
    const r = await post(BODIES[action](ACT_B));
    expect(r.statusCode).toBe(403);
    expect(planWrites()).toEqual([]);
    expect(rowB().content).toBe(B_CONTENT);
    expect(mockCompletion).not.toHaveBeenCalled();
    expect(mockExecuteWithCredits).not.toHaveBeenCalled();
  });

  it('own company\'s activity → 200 and exactly that row is written', async () => {
    const r = await post(BODIES[action](ACT_A));
    expect(r.statusCode).toBe(200);
    const writes = planWrites().filter((c) => c.op === 'update');
    expect(writes.length).toBeGreaterThan(0);
    for (const w of writes) expect(w.filters).toMatchObject({ id: ACT_A });
    expect(rowA().content).not.toBe(A_CONTENT);
    expect(rowB().content).toBe(B_CONTENT);
  });

  it('filter injection in the activity id → 400, nothing written, no AI call', async () => {
    const r = await post(BODIES[action](`${ACT_A},campaign_id.eq.${CAMPAIGN_B}`));
    expect(r.statusCode).toBe(400);
    expect(planWrites()).toEqual([]);
    expect(rowB().content).toBe(B_CONTENT);
    expect(mockCompletion).not.toHaveBeenCalled();
  });
});

describe('campaign and company binding', () => {
  it('a body campaignId owned by ANOTHER tenant → 404, nothing runs', async () => {
    const r = await post(BODIES.improve_variant(ACT_A, { campaignId: CAMPAIGN_B }));
    expect(r.statusCode).toBe(404);
    expect(planWrites()).toEqual([]);
    expect(mockCompletion).not.toHaveBeenCalled();
  });

  it('a body campaignId of the caller\'s own campaign is accepted', async () => {
    const r = await post(BODIES.improve_variant(ACT_A, { campaignId: CAMPAIGN_A }));
    expect(r.statusCode).toBe(200);
  });

  it('companyId omitted + B\'s activity: the fallback derives B and membership refuses (403), nothing written', async () => {
    const body = BODIES.improve_variant(ACT_B);
    delete body.companyId;
    const r = await post(body);
    expect(r.statusCode).toBe(403);
    expect(planWrites()).toEqual([]);
  });

  it('companyId of a company the caller does not belong to → 403 (unchanged)', async () => {
    const r = await post(BODIES.improve_variant(ACT_B, { companyId: CO_B }));
    expect(r.statusCode).toBe(403);
    expect(planWrites()).toEqual([]);
  });

  it('generate_master stays bound to the activity\'s own company: B\'s activity → 403, nothing written', async () => {
    const r = await post({ action: 'generate_master', companyId: CO_A, activity: { id: ACT_B } });
    expect(r.statusCode).toBe(403);
    expect(planWrites()).toEqual([]);
  });

  it('generate_master on the caller\'s own activity persists to that row', async () => {
    const r = await post({ action: 'generate_master', companyId: CO_A, activity: { id: ACT_A } });
    expect(r.statusCode).toBe(200);
    const writes = planWrites().filter((c) => c.op === 'update');
    expect(writes).toHaveLength(1);
    expect(writes[0].filters).toMatchObject({ id: ACT_A });
  });
});

describe('unchanged flows', () => {
  it('transient workspace- ids generate without persisting anything', async () => {
    const r = await post(BODIES.generate_variants('workspace-linkedin'));
    expect(r.statusCode).toBe(200);
    expect(planWrites()).toEqual([]);
  });

  it('an id that matches no row generates without persisting (as before), and never touches another row', async () => {
    const r = await post(BODIES.improve_variant('cccccccc-0000-4000-8000-00000000000c'));
    expect(r.statusCode).toBe(200);
    expect(planWrites()).toEqual([]);
    expect(rowB().content).toBe(B_CONTENT);
  });
});

describe('canonical writer (defence at the sink)', () => {
  it('refuses an activity key that is not a plain token, before any query', async () => {
    const before = calls().length;
    const out = await updateExecutionContentByActivity(`${ACT_A},campaign_id.eq.${CAMPAIGN_B}`, (e: Record<string, unknown>) => ({ ...e, pwned: true }));
    expect(out).toEqual({ ok: false, reason: 'invalid_activity_id' });
    expect(calls().length).toBe(before);
    expect(rowB().content).toBe(B_CONTENT);
  });

  it('prefers the exact row id over an execution_id match', async () => {
    const out = await updateExecutionContentByActivity(ACT_A, (e: Record<string, unknown>) => ({ ...e, marker: 'A-only' }));
    expect(out.ok).toBe(true);
    expect(JSON.parse(rowA().content).marker).toBe('A-only');
    expect(rowB().content).toBe(B_CONTENT);
    expect(USER_A).toBeTruthy();
  });
});
