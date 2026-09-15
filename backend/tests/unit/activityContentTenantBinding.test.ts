/**
 * 3AH-92 (S-2) — /api/activity-workspace/content must never write into a
 * daily_content_plans row owned by a tenant the caller is not authorized for.
 *
 * THE DEFECT: every action authorized the caller against a caller-chosen
 * `companyId`, then handed the caller's raw `activity.id` to the canonical
 * write, which located the row with `.or(\`id.eq.${id},execution_id.eq.${id}\`)`
 * — no tenant filter, and the id spliced into the PostgREST filter grammar. A
 * member of company A could name company B's row (or `<uuid>,id.not.is.null`)
 * and have AI-rewritten text written into it, billed to A.
 *
 * The real chain runs: handler -> resolveActivityRow -> assertOrgMembership ->
 * TenantGuard -> checkCampaignOwnership -> runReservedFixedWorkflow ->
 * persist* -> updateExecutionContentByActivity, against the shared fake DB.
 * The fake DB speaks just enough PostgREST to keep main honest: `.or()` is
 * parsed (not ignored) and a non-UUID compared to the uuid `id` column errors
 * (22P02), as Postgres does. Paid AI and credits are faked and logged.
 * Every step lands in ONE ordered event log.
 */
import {
  seed, invoke, failTable, rows, calls, CO_A, CO_B, CAMPAIGN_A, CAMPAIGN_B, USER_A, USER_B,
} from '../helpers/routeAuthHarness';

const mockEvents: string[] = [];

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => {
  const h = jest.requireActual('../helpers/routeAuthHarness');
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  // PostgREST `or=(a.eq.x,b.not.is.null,...)` — enough grammar to evaluate what main sends.
  const compileOr = (table: string, expr: string) => {
    const preds = expr.split(',').map((part) => {
      const [col, ...rest] = part.split('.');
      const negate = rest[0] === 'not';
      const [op, ...v] = negate ? rest.slice(1) : rest;
      const val = v.join('.');
      if (table === 'daily_content_plans' && col === 'id' && op === 'eq' && !UUID.test(val)) return 'BAD';
      const test = (r: any) => (op === 'eq' ? String(r[col] ?? '') === val : op === 'is' ? (val === 'null' ? r[col] == null : String(r[col]) === val) : false);
      return (r: any) => (negate ? !test(r) : test(r));
    });
    return preds.includes('BAD') ? 'BAD' : (r: any) => (preds as Array<(r: any) => boolean>).some((p) => p(r));
  };
  const wrap = (table: string) => {
    const b = h.fakeSupabase.from(table);
    let orPred: any = null;
    let bad = false;
    const eq = b.eq;
    b.eq = (c: string, v: unknown) => {
      if (table === 'daily_content_plans' && c === 'id') {
        if (!UUID.test(String(v))) bad = true;
        return eq(c, String(v).toLowerCase());
      }
      return eq(c, v);
    };
    b.or = (expr: string) => { mockEvents.push(`db:or:${table}:${expr}`); orPred = compileOr(table, expr); if (orPred === 'BAD') bad = true; return b; };
    const upd = b.update;
    b.update = (p: unknown) => { mockEvents.push(`db:write:${table}`); return upd(p); };
    const then = b.then;
    const post = (r: any) => (bad ? { data: null, error: { code: '22P02', message: 'invalid input syntax for type uuid' }, count: 0 }
      : orPred ? { ...r, data: (r.data || []).filter(orPred) } : r);
    b.then = (ok: any, err: any) => then((r: any) => ok(post(r)), err);
    b.maybeSingle = () => new Promise((resolve) => then((r: any) => { const p = post(r); resolve({ data: p.error ? null : (p.data?.[0] ?? null), error: p.error }); }));
    return b;
  };
  const supabase = { ...h.fakeSupabase, from: (t: string) => { mockEvents.push(`db:${t}`); return wrap(t); } };
  return { supabase, default: supabase, getSupabase: () => supabase, supabaseAdmin: supabase };
});
jest.mock('../../db/writeOwner', () => jest.requireActual('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => {
  const m = jest.requireActual('../helpers/routeAuthHarness').authModule();
  const inner = m.getSupabaseUserFromRequest;
  return { ...m, getSupabaseUserFromRequest: jest.fn(async (req: any) => { mockEvents.push('auth'); return inner(req); }) };
});
jest.mock('../../security/IdentityResolver', () => jest.requireActual('../helpers/routeAuthHarness').identityModule());

// ── paid sinks: AI + credits (faked, logged) ────────────────────────────────
jest.mock('../../services/aiGateway', () => ({
  runCompletionWithOperation: jest.fn(async (i: any) => { mockEvents.push(`ai:${i.companyId}`); return { output: 'AI REWRITE', metadata: {} }; }),
}));
jest.mock('../../services/contentGenerationPipeline', () => new Proxy({}, {
  get: (_t, key) => {
    if (key === '__esModule') return true;
    if (typeof key !== 'string' || key === 'then') return undefined;
    if (key === 'optimizeDiscoverabilityForPlatform') return async () => ({ hashtags: ['#x'] });
    return async (item: any) => {
      mockEvents.push(`ai:${item?.company_id}`);
      return key.startsWith('build') ? [{ platform: 'linkedin', content_type: 'post', generated_content: 'AI VARIANT' }]
        : { id: 'm', content: 'AI MASTER', generation_status: 'generated' };
    };
  },
}));
jest.mock('../../services/contentGeneration/blueprintGenerator', () => ({
  generateMasterContentStrict: jest.fn(async (item: any) => {
    mockEvents.push(`ai:${item.company_id}`);
    return { master: { id: 'm', content: 'AI MASTER', generation_status: 'generated' }, usage: { inputTokens: 1, outputTokens: 1 }, provider: 'openai', model: 'm' };
  }),
}));
jest.mock('../../services/creditExecutionService', () => ({
  makeIdempotencyKey: (...p: string[]) => p.join(':'),
  executeWithCredits: jest.fn(async (i: any) => {
    mockEvents.push(`credit:${i.orgId}`);
    const out = await i.executor();
    return { status: 'executed', result: i.llmPricing ? out.result : out };
  }),
  executeWithEntryConsumption: jest.fn(),
}));
jest.mock('../../services/billing', () => ({
  isRefineVariantBillingEnabled: jest.fn(async () => ({ enabled: true, reason: null })),
  runBilledAiCompletion: jest.fn(async (i: any) => { mockEvents.push(`credit:${i.orgId}`); mockEvents.push(`ai:${i.completion.companyId}`); return { text: 'AI REFINED' }; }),
}));
jest.mock('../../services/creditDeductionService', () => ({ getCreditCost: jest.fn(async () => 1) }));
jest.mock('../../services/billing/creditEconomyActivation', () => ({ getCreditEconomyExecutionMode: jest.fn(async () => 'shadow') }));
jest.mock('../../services/billing/creditEconomyShadow', () => ({ emitCreditEconomyShadowEvaluation: jest.fn(async () => undefined) }));
jest.mock('../../services/billing/admissionControl', () => ({ evaluateActivityAdmission: jest.fn(async () => undefined) }));
jest.mock('../../../shared/monetization/featureRegistry', () => ({ resolveMonetizationFeature: () => ({ feature_key: 'f', pricing_key: 'p' }) }));
jest.mock('../../services/unifiedContentProcessor', () => ({ processContent: jest.fn(async (i: any) => ({ content: i.content })) }));
jest.mock('../../services/creator/governanceItemEnricher', () => ({ enrichItemWithGovernance: jest.fn(async (i: unknown) => i) }));
jest.mock('../../services/contentGeneration/contentTypeHelpers', () => ({ getContentTypeCategory: () => 'post' }));
jest.mock('../../../lib/auth/rateLimit', () => ({ checkRateLimit: jest.fn(async () => ({ allowed: true, remaining: 9, resetAt: 0 })) }));
// Orchestration barrel: only the canonical adapter the route uses (the barrel builds queues at import).
jest.mock('../../services/orchestration', () => {
  const a = jest.requireActual('../../services/orchestration/canonicalExecutionAdapter');
  return { updateExecutionContentByActivity: a.updateExecutionContentByActivity, resolveActivityRow: a.resolveActivityRow };
});
jest.mock('../../services/orchestration/synchronization', () => ({ synchronizeByActivity: jest.fn(async () => null), synchronizeExecutionState: jest.fn(async () => null) }));
jest.mock('../../services/campaignBlueprintService', () => ({ getUnifiedCampaignBlueprint: jest.fn(async () => null) }));
jest.mock('../../services/executionPlannerService', () => ({ getDailyPlans: jest.fn(async () => []) }));

import handler from '../../services/activityWorkspace/contentRouteHandler';
import * as adapter from '../../services/orchestration/canonicalExecutionAdapter';

// ── fixture world (harness: CO_A/CAMPAIGN_A/USER_A, CO_B/CAMPAIGN_B/USER_B) ──
const PLAN_A = '1a0e8400-e29b-41d4-a716-4466554400a1';
const PLAN_A2 = '1a0e8400-e29b-41d4-a716-4466554400a2';
const PLAN_A3 = '1a0e8400-e29b-41d4-a716-4466554400a3';
const EXEC_A = '1a0e8400-e29b-41d4-a716-44665544e0a2';
const PLAN_B = '2b0e8400-e29b-41d4-a716-4466554400b1';
const PLAN_B2 = '2b0e8400-e29b-41d4-a716-4466554400b2';
const EXEC_B = '2b0e8400-e29b-41d4-a716-44665544e0b2';
const PLAN_B3 = '2b0e8400-e29b-41d4-a716-4466554400b3';
const PLAN_ORPHAN = '3c0e8400-e29b-41d4-a716-4466554400c1';
const PLAN_NULLCO = '3c0e8400-e29b-41d4-a716-4466554400c2';
const CAMPAIGN_ORPHAN = 'camp-o-00-0000-0000-00000000000o';
const CAMPAIGN_NULLCO = 'camp-n-00-0000-0000-00000000000n';
const ORIGINAL = (tag: string) => JSON.stringify({ generated_content: `ORIGINAL-${tag}`, platform_variants: [] });
const plan = (id: string, campaign_id: string, tag: string, execution_id: string | null = null) =>
  ({ id, campaign_id, execution_id, content: ORIGINAL(tag) });

beforeEach(() => {
  mockEvents.length = 0;
  seed({
    // Foreign rows FIRST: on main, `.or()` + rows[0] then lands on company B.
    daily_content_plans: [
      plan(PLAN_B3, CAMPAIGN_B, 'B3', PLAN_A3), // B row whose execution_id collides with A's primary key
      plan(PLAN_B, CAMPAIGN_B, 'B'),
      plan(PLAN_B2, CAMPAIGN_B, 'B2', EXEC_B),
      plan(PLAN_A, CAMPAIGN_A, 'A'),
      plan(PLAN_A2, CAMPAIGN_A, 'A2', EXEC_A),
      plan(PLAN_A3, CAMPAIGN_A, 'A3'),
      plan(PLAN_ORPHAN, CAMPAIGN_ORPHAN, 'ORPHAN'),
      plan(PLAN_NULLCO, CAMPAIGN_NULLCO, 'NULLCO'),
    ],
    campaigns: [{ id: CAMPAIGN_NULLCO, company_id: null, name: 'no owner' }],
  });
});

// ── helpers ───────────────────────────────────────────────────────────────────
const VARIANT = { platform: 'linkedin', content_type: 'post', generated_content: 'hello world. buy now.' };
const BODIES: Record<string, (activityId: string, extra?: Record<string, unknown>) => Record<string, unknown>> = {
  improve_variant: (id, x) => ({ action: 'improve_variant', activity: { id }, improvementType: 'IMPROVE_CTA', platform: 'linkedin', variant: VARIANT, ...x }),
  improve_variant_all: (id, x) => ({ action: 'improve_variant_all', activity: { id }, improvementTypes: ['IMPROVE_HOOK', 'ADD_DISCOVERABILITY'], platform: 'linkedin', variant: VARIANT, ...x }),
  refine_variant: (id, x) => ({ action: 'refine_variant', activity: { id }, schedule: { platform: 'linkedin', contentType: 'post' }, refinement_prompt: 'tighten', current_content: 'hello', ...x }),
  generate_variants: (id, x) => ({ action: 'generate_variants', activity: { id, platform: 'linkedin', contentType: 'post' }, schedules: [{ platform: 'linkedin', contentType: 'post' }], ...x }),
  generate_master: (id, x) => ({ action: 'generate_master', activity: { id, platform: 'linkedin', contentType: 'post' }, ...x }),
};
const ACTIONS = Object.keys(BODIES);
const WRITE_ACTIONS = ACTIONS.filter((a) => a !== 'generate_master'); // generate_master ignores body.companyId
const post = (body: Record<string, unknown>, as: 'A' | 'B' | null = 'A', headers: Record<string, string> = {}) =>
  invoke(handler as any, { method: 'POST', body, as, headers });
const content = (id: string) => String(rows('daily_content_plans').find((r) => r.id === id)?.content ?? '');
const paid = () => mockEvents.filter((e) => e.startsWith('ai:') || e.startsWith('credit:'));
const writes = () => mockEvents.filter((e) => e.startsWith('db:write:'));
const first = (p: string) => mockEvents.findIndex((e) => e.startsWith(p));
const lastIdx = (p: string) => mockEvents.map((e, i) => (e.startsWith(p) ? i : -1)).reduce((m, i) => Math.max(m, i), -1);
/** No foreign/unowned row changed, nothing was written, nothing was paid for. */
function expectNothingHappened() {
  expect(writes()).toEqual([]);
  expect(paid()).toEqual([]);
  for (const [id, tag] of [[PLAN_B, 'B'], [PLAN_B2, 'B2'], [PLAN_B3, 'B3'], [PLAN_A, 'A'], [PLAN_A2, 'A2'], [PLAN_A3, 'A3'], [PLAN_ORPHAN, 'ORPHAN'], [PLAN_NULLCO, 'NULLCO']]) {
    expect(content(id)).toBe(ORIGINAL(tag));
  }
}

// ── 1. anonymous ──────────────────────────────────────────────────────────────
describe('1. anonymous caller', () => {
  it.each(ACTIONS)('%s → 401 before any read, AI, credit or write', async (action) => {
    const r = await post(BODIES[action](PLAN_B, { companyId: CO_B, company_id: CO_B, userId: USER_B }), null);
    expect(r.status).toBe(401);
    expect(mockEvents).toEqual(['auth']);
    expectNothingHappened();
  });
});

// ── 2. legitimate same-company writes ────────────────────────────────────────
describe('2. member of the owning company', () => {
  it.each(ACTIONS)('%s on its own row → 200, writes ONLY that row, billed to its own company, authz first', async (action) => {
    const r = await post(BODIES[action](PLAN_A, { companyId: CO_A }), 'A');
    expect(r.status).toBe(200);
    expect(content(PLAN_A)).not.toBe(ORIGINAL('A'));
    expect(content(PLAN_A)).toContain('AI ');
    for (const [id, tag] of [[PLAN_B, 'B'], [PLAN_B3, 'B3'], [PLAN_A2, 'A2']]) expect(content(id)).toBe(ORIGINAL(tag));
    expect(paid().filter((e) => e.startsWith('credit:'))).toEqual(expect.arrayContaining([`credit:${CO_A}`]));
    expect(paid().every((e) => e.endsWith(CO_A))).toBe(true);
    // ownership is established before money or AI moves, and the write comes last
    const authz = Math.max(lastIdx('db:user_company_roles'), lastIdx('db:campaign_versions'), lastIdx('db:campaigns'));
    expect(authz).toBeGreaterThan(-1);
    expect(first('credit:')).toBeGreaterThan(authz);
    expect(first('db:write:daily_content_plans')).toBeGreaterThan(first('credit:'));
    // the write itself is pinned to the row AND its campaign
    const w = calls().filter((c) => c.table === 'daily_content_plans' && c.op === 'update');
    expect(w.length).toBeGreaterThan(0);
    for (const c of w) expect(c.filters).toEqual({ id: PLAN_A, campaign_id: CAMPAIGN_A });
    // the raw id never reached a PostgREST filter string
    expect(mockEvents.filter((e) => e.startsWith('db:or:'))).toEqual([]);
  });
  it('an own row addressed by its execution_id is written (and only it)', async () => {
    const r = await post(BODIES.improve_variant(EXEC_A, { companyId: CO_A }), 'A');
    expect(r.status).toBe(200);
    expect(content(PLAN_A2)).toContain('AI REWRITE');
    expect(content(PLAN_A)).toBe(ORIGINAL('A'));
  });
  it.each(['workspace-linkedin', 'w1-monday-launch-post', ''])('transient draft id %p → 200, billed to own company, nothing persisted', async (id) => {
    const r = await post(BODIES.generate_variants(id, { companyId: CO_A }), 'A');
    expect(r.status).toBe(200);
    expect(r.body.platform_variants).toHaveLength(1);
    expect(paid()).toEqual(expect.arrayContaining([`credit:${CO_A}`]));
    expect(writes()).toEqual([]);
  });
  it('company derived server-side from the row when the body names none', async () => {
    const r = await post(BODIES.improve_variant(PLAN_A), 'A');
    expect(r.status).toBe(200);
    expect(paid()).toEqual(expect.arrayContaining([`credit:${CO_A}`]));
    expect(content(PLAN_A)).toContain('AI REWRITE');
  });
});

// ── 3–6, 8. wrong company / overrides / foreign activity ─────────────────────
describe('a row owned by another tenant is never written', () => {
  it.each(WRITE_ACTIONS)('3. %s — member of B naming A\'s row with its own company → 403', async (action) => {
    const r = await post(BODIES[action](PLAN_A, { companyId: CO_B }), 'B');
    expect(r.status).toBe(403);
    expectNothingHappened();
  });
  it.each(ACTIONS)('4. %s — body company_id naming the victim (snake case) is inert → 403', async (action) => {
    const r = await post(BODIES[action](PLAN_B, { company_id: CO_A, organizationId: CO_A, orgId: CO_A }), 'A');
    expect(r.status).toBe(403);
    expectNothingHappened();
  });
  it.each(WRITE_ACTIONS)('4. %s — company_id naming the victim next to the caller\'s own companyId → 403', async (action) => {
    const r = await post(BODIES[action](PLAN_B, { companyId: CO_A, company_id: CO_B }), 'A');
    expect(r.status).toBe(403);
    expectNothingHappened();
  });
  it.each(WRITE_ACTIONS)('5./6. %s — body companyId = caller\'s own company, activity = B\'s row → 403 (THE S-2 case)', async (action) => {
    const r = await post(BODIES[action](PLAN_B, { companyId: CO_A }), 'A');
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: 'ORG_SCOPE_VIOLATION' });
    expectNothingHappened();
  });
  it('5. body companyId naming the victim company itself → 403 (not a member)', async () => {
    const r = await post(BODIES.improve_variant(PLAN_B, { companyId: CO_B }), 'A');
    expect(r.status).toBe(403);
    expectNothingHappened();
  });
  it('6. generate_master on B\'s row → 403 whatever companyId says', async () => {
    for (const companyId of [CO_A, CO_B, undefined]) {
      mockEvents.length = 0;
      const r = await post(BODIES.generate_master(PLAN_B, { companyId }), 'A');
      expect(r.status).toBe(403);
      expectNothingHappened();
    }
  });
  it.each(WRITE_ACTIONS)('8. %s — B\'s row addressed by its execution_id, companyId = A → 403', async (action) => {
    const r = await post(BODIES[action](EXEC_B, { companyId: CO_A }), 'A');
    expect(r.status).toBe(403);
    expectNothingHappened();
  });
  it('8. an id that is A\'s primary key AND B\'s execution_id is ambiguous → 409, nothing written', async () => {
    const r = await post(BODIES.improve_variant(PLAN_A3, { companyId: CO_A }), 'A');
    // PLAN_A3 is also PLAN_B3.execution_id (seeded) — refuse rather than guess
    expect(r.status).toBe(409);
    expectNothingHappened();
  });
});

// ── 7, 9. campaign identity ──────────────────────────────────────────────────
describe('campaign identity comes from the row, never the body', () => {
  it('7. foreign campaignId on a transient draft → 403 (derived tenant is B)', async () => {
    const r = await post(BODIES.generate_variants('workspace-x', { campaignId: CAMPAIGN_B }), 'A');
    expect(r.status).toBe(403);
    expectNothingHappened();
  });
  it('7. own campaignId + own company cannot launder B\'s row → 403', async () => {
    const r = await post(BODIES.improve_variant(PLAN_B, { companyId: CO_A, campaignId: CAMPAIGN_A }), 'A');
    expect(r.status).toBe(403);
    expectNothingHappened();
  });
  it('9. mismatched body campaignId on an own row is inert: A billed, only A\'s row written', async () => {
    const r = await post(BODIES.improve_variant(PLAN_A2, { companyId: CO_A, campaignId: CAMPAIGN_B }), 'A');
    expect(r.status).toBe(200);
    expect(paid().every((e) => e.endsWith(CO_A))).toBe(true);
    expect(content(PLAN_A2)).toContain('AI REWRITE');
    for (const [id, tag] of [[PLAN_B, 'B'], [PLAN_B2, 'B2'], [PLAN_B3, 'B3']]) expect(content(id)).toBe(ORIGINAL(tag));
  });
  it('9. company A + campaign B + row B → 403', async () => {
    const r = await post(BODIES.refine_variant(PLAN_B2, { companyId: CO_A, campaignId: CAMPAIGN_B }), 'A');
    expect(r.status).toBe(403);
    expectNothingHappened();
  });
});

// ── 10–11. missing ownership / lookup failures ───────────────────────────────
describe('fail closed', () => {
  it.each([[PLAN_ORPHAN, 'campaign with no owner record'], [PLAN_NULLCO, 'campaign with a null company']])('10. %s (%s) → 403 with or without a body company', async (id) => {
    for (const companyId of [CO_A, undefined]) {
      mockEvents.length = 0;
      const r = await post(BODIES.improve_variant(id, { companyId }), 'A');
      expect(r.status).toBe(403);
      expectNothingHappened();
    }
  });
  it.each(['daily_content_plans', 'campaign_versions'])('11. lookup failure on %s → 503 retryable, nothing paid or written', async (table) => {
    failTable(table);
    const r = await post(BODIES.improve_variant(PLAN_A2, { companyId: CO_A }), 'A');
    expect(r.status).toBe(503);
    expect(r.body.retryable).toBe(true);
    expectNothingHappened();
  });
  it('11. membership lookup failure → denied, nothing paid or written', async () => {
    failTable('user_company_roles');
    const r = await post(BODIES.improve_variant(PLAN_A2, { companyId: CO_A }), 'A');
    expect(r.status).toBe(403);
    expectNothingHappened();
  });
});

// ── 12. malformed identifiers ────────────────────────────────────────────────
describe('12. malformed activity ids', () => {
  it.each([
    [`${PLAN_A2},id.not.is.null`, 'the .or() widening injection'],
    [`${PLAN_A2},campaign_id.eq.${CAMPAIGN_B}`, 'campaign injection'],
    [`${PLAN_A2})`, 'grammar breakout'],
    [`x${PLAN_B}`, 'prefixed row id'],
    [`${PLAN_B}/../${PLAN_A2}`, 'path-ish'],
  ])('%p (%s) → 400 before any AI, credit or write', async (id) => {
    for (const action of ACTIONS) {
      mockEvents.length = 0;
      const r = await post(BODIES[action](id, { companyId: CO_A }), 'A');
      expect(r.status).toBe(400);
      expectNothingHappened();
      expect(mockEvents.filter((e) => e.startsWith('db:or:'))).toEqual([]);
    }
  });
  it('an upper-cased foreign row id still resolves to that row → 403', async () => {
    const r = await post(BODIES.improve_variant(PLAN_B.toUpperCase(), { companyId: CO_A }), 'A');
    expect(r.status).toBe(403);
    expectNothingHappened();
  });
  it('a non-string activity id cannot smuggle a foreign row', async () => {
    const r = await post({ ...BODIES.improve_variant('', { companyId: CO_A }), activity: { id: [PLAN_B] } }, 'A');
    expect(r.status).toBe(403);
    expectNothingHappened();
  });
});

// ── 13. forged request context ───────────────────────────────────────────────
describe('13. forged request context', () => {
  const forged = { 'x-company-id': CO_A, 'x-user-id': USER_A, 'x-tenant-id': CO_A, 'x-organization-id': CO_A };
  it('member of B with headers/body claiming A cannot write A\'s row → 403', async () => {
    const r = await post(BODIES.improve_variant(PLAN_A2, { companyId: CO_A, userId: USER_A, user_id: USER_A }), 'B', forged);
    expect(r.status).toBe(403);
    expectNothingHappened();
  });
  it('anonymous caller with forged identity headers/body → 401', async () => {
    const r = await post(BODIES.generate_master(PLAN_A2, { companyId: CO_A, userId: USER_A }), null, forged);
    expect(r.status).toBe(401);
    expect(mockEvents).toEqual(['auth']);
  });
  it('generate_master grounds AI in the ROW\'s company, not the body companyId', async () => {
    const r = await post(BODIES.generate_master(PLAN_A2, { companyId: CO_B }), 'A');
    expect(r.status).toBe(200);
    expect(paid()).toEqual([`credit:${CO_A}`, `ai:${CO_A}`]);
    expect(content(PLAN_A2)).toContain('AI MASTER');
  });
});

// ── the canonical adapter, used by every caller ──────────────────────────────
describe('updateExecutionContentByActivity / resolveActivityRow', () => {
  const t = (e: Record<string, unknown>) => ({ ...e, touched: true });
  it('an injection string is rejected without querying or writing', async () => {
    const r = await adapter.updateExecutionContentByActivity(`${PLAN_A2},id.not.is.null`, t, 'test');
    expect(r).toMatchObject({ ok: false, reason: 'invalid_activity_id' });
    expect(mockEvents.filter((e) => e.startsWith('db:'))).toEqual([]);
    expectNothingHappened();
  });
  it('a primary key writes exactly that row, via parameterised lookups only', async () => {
    const r = await adapter.updateExecutionContentByActivity(PLAN_B, t, 'test');
    expect(r.ok).toBe(true);
    expect(content(PLAN_B)).toContain('"touched":true');
    expect(content(PLAN_B2)).toBe(ORIGINAL('B2'));
    expect(mockEvents.filter((e) => e.startsWith('db:or:'))).toEqual([]);
  });
  it('a campaign scope refuses a row outside it', async () => {
    const r = await adapter.updateExecutionContentByActivity(PLAN_B, t, 'test', { campaignId: CAMPAIGN_A });
    expect(r).toMatchObject({ ok: false, reason: 'out_of_scope' });
    expectNothingHappened();
  });
  it('primary key wins over a colliding execution_id (non-strict); strict refuses', async () => {
    const r = await adapter.updateExecutionContentByActivity(PLAN_A3, t, 'test');
    expect(r.ok).toBe(true);
    expect(content(PLAN_A3)).toContain('"touched":true');
    expect(content(PLAN_B3)).toBe(ORIGINAL('B3'));
    expect(await adapter.resolveActivityRow(PLAN_A3, { strict: true })).toEqual({ ok: false, reason: 'ambiguous_activity_id' });
  });
  it('two rows sharing an execution_id are ambiguous → no write', async () => {
    rows('daily_content_plans').find((r) => r.id === PLAN_B)!.execution_id = EXEC_B;
    const r = await adapter.updateExecutionContentByActivity(EXEC_B, t, 'test');
    expect(r).toMatchObject({ ok: false, reason: 'ambiguous_activity_id' });
    expectNothingHappened();
  });
  it('a lookup error is reported, never read as "no row", and nothing is written', async () => {
    failTable('daily_content_plans');
    expect(await adapter.resolveActivityRow(PLAN_A2)).toEqual({ ok: false, reason: 'lookup_error' });
    const r = await adapter.updateExecutionContentByActivity(PLAN_A2, t, 'test');
    expect(r).toMatchObject({ ok: false, reason: 'lookup_error' });
    expect(writes()).toEqual([]);
  });
  it('non-UUID ids resolve nothing (as the uuid column always made them)', async () => {
    for (const id of ['wk1-exec-3', 'workspace-linkedin', '']) {
      const r = await adapter.updateExecutionContentByActivity(id, t, 'test');
      expect(r.ok).toBe(false);
    }
    expect(writes()).toEqual([]);
  });
});

// ── static pin: persistence accepts only a bound target ─────────────────────
describe('persistence is typed to the server-bound target', () => {
  const fs = require('fs');
  const path = require('path');
  const src = (f: string): string => fs.readFileSync(path.resolve(__dirname, '../../services', f), 'utf8');
  it('no persist call in the route passes a caller-derived id', () => {
    const handlerSrc = src('activityWorkspace/contentRouteHandler.ts');
    const persistCalls = handlerSrc.match(/persist(Master|Variants)ToDb\(\s*([A-Za-z_]+)/g) ?? [];
    expect(persistCalls.length).toBeGreaterThanOrEqual(8);
    for (const c of persistCalls) expect(c).toMatch(/\(\s*writeTarget$/);
  });
  it('the adapter no longer splices ids into a PostgREST .or() filter', () => {
    const code = src('orchestration/canonicalExecutionAdapter.ts').split('\n')
      .filter((l: string) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
    expect(code).not.toMatch(/\.or\(/);
  });
});

