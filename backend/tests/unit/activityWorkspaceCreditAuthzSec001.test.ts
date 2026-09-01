/**
 * ACTIVITY-WORKSPACE-CREDIT-AUTHZ-SEC-001 — D3: caller-named tenant reached a
 * credit-consuming sink.
 *
 * `contentRouteHandler` resolved its organization as
 * `req.body.companyId || (activity -> campaign -> company)`. The first half let
 * the caller name the tenant outright; the second is no safer, because a caller
 * can name an activity belonging to any company. Either way that value flowed
 * into runReservedFixedWorkflow / runBilledAiCompletion, which RESERVE AND
 * CONSUME CREDITS against it — so a member of company A could spend company B's
 * credits by saying so.
 *
 * `generate_master` already did this correctly: it ignores body.companyId,
 * re-derives the org from the persisted activity, and calls assertOrgMembership
 * with a 403 ORG_SCOPE_VIOLATION. The fix reuses that primitive, that rejection
 * and that status code, hoisted to where the tenant is established.
 *
 * The authorization chain here is REAL — assertOrgMembership -> assertTenantAccess
 * -> membership + organization-lifecycle queries. Only the identity provider,
 * the database and the billing sinks are faked. Every denial asserts BOTH the
 * response AND that no sink ran: a 403 after the credits were reserved would
 * not be a fix.
 */

export {};

const CO_A = 'co-a-0000-0000-0000-00000000000a';
const CO_B = 'co-b-0000-0000-0000-00000000000b';
const USER_A = 'user-a-00-0000-0000-00000000000a';

/** If company B is ever charged, this is what the sink will have received. */
const CANARY = CO_B;

const COMPANIES = [
  { id: CO_A, status: 'active', deleted_at: null },
  { id: CO_B, status: 'active', deleted_at: null },
];

/** USER_A is an ACTIVE member of A only. Other rows model the denial states. */
let roleRows: any[] = [];
const ACTIVE_IN_A = [{ user_id: USER_A, company_id: CO_A, role: 'COMPANY_ADMIN', status: 'active' }];

let calls: Array<{ table: string; filters: Record<string, unknown> }> = [];
let authedUser: string | null = USER_A;

function rowsFor(table: string): any[] {
  if (table === 'user_company_roles') return roleRows;
  if (table === 'companies') return COMPANIES;
  // Activity/campaign fixtures: the activity belongs to company B, so the
  // server-side fallback resolves B too — it is not a safer source.
  if (table === 'daily_content_plans') return [{ id: 'act-b', campaign_id: 'camp-b' }];
  if (table === 'campaigns') return [{ id: 'camp-b', company_id: CO_B }];
  return [];
}

function makeBuilder(table: string) {
  const filters: Record<string, unknown> = {};
  const b: any = {};
  for (const m of ['select', 'order', 'limit', 'in', 'neq', 'is', 'insert', 'update', 'upsert', 'delete']) b[m] = () => b;
  b.eq = (c: string, v: unknown) => { filters[c] = v; return b; };
  const resolve = () => {
    calls.push({ table, filters: { ...filters } });
    return {
      data: rowsFor(table).filter((r) =>
        Object.entries(filters).every(([k, v]) => (r as any)[k] === v)),
      error: null,
    };
  };
  b.maybeSingle = async () => ({ data: resolve().data[0] ?? null, error: null });
  b.single = async () => ({ data: resolve().data[0] ?? null, error: null });
  b.then = (ok: any, err: any) => Promise.resolve(resolve()).then(ok, err);
  return b;
}

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('@/backend/db/supabaseClient', () => ({ supabase: { from: (t: string) => makeBuilder(t) } }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => makeBuilder(t) } }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => makeBuilder(t) }));

jest.mock('@/backend/services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn(async () =>
    (authedUser ? { user: { id: authedUser, email: 'a@example.com' }, error: null }
                : { user: null, error: 'MISSING_AUTH' })),
}));

/* ── the consequential sinks: observed, never executed ────────────────────── */
const sinkReserved = jest.fn(async () => ({ platform: 'linkedin', generated_content: 'improved' }));
/*
 * Declared explicitly rather than via requireActual: the real module re-exports
 * the orchestration barrel, which constructs a BullMQ client at import time and
 * throws without REDIS_URL. Only the handler's own imports are reproduced here.
 */
jest.mock('../../services/activityWorkspace/contentRouteModel', () => ({
  runReservedFixedWorkflow: (...a: any[]) => (sinkReserved as any)(...a),
  asObject: (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null),
  persistMasterToDb: jest.fn(async () => {}),
  persistVariantsToDb: jest.fn(async () => {}),
  FAILED_VARIANT_PREFIXES: [] as string[],
  MonetizedWorkflowError: class MonetizedWorkflowError extends Error {
    status: number; payload: unknown;
    constructor(status: number, payload: unknown) { super('monetized'); this.status = status; this.payload = payload; }
  },
}));
jest.mock('@/backend/services/orchestration', () => ({
  updateExecutionContentByActivity: jest.fn(async () => {}),
}));

const sinkBilled = jest.fn(async () => ({ ok: true, content: 'refined', charged: true }));
const sinkRefineEnabled = jest.fn(async () => ({ enabled: true, reason: null }));
jest.mock('@/backend/services/billing', () => ({
  isRefineVariantBillingEnabled: (...a: any[]) => (sinkRefineEnabled as any)(...a),
  runBilledAiCompletion: (...a: any[]) => (sinkBilled as any)(...a),
}));

const sinkCompletion = jest.fn(async () => ({ content: 'direct' }));
jest.mock('@/backend/services/aiGateway', () => ({
  runCompletionWithOperation: (...a: any[]) => (sinkCompletion as any)(...a),
}));

/*
 * generate_master applies sliding-window rate limits after its own membership
 * check. Unmocked, that opens a Redis connection and the test HANGS rather than
 * fails — which also masks mutation results, because a mutation that turns a
 * denial into an approval reaches exactly this code. Stubbed permissive so the
 * authorization boundary is what the assertions measure.
 */
jest.mock('@/lib/auth/rateLimit', () => ({
  checkRateLimit: jest.fn(async () => ({ allowed: true, remaining: 100, resetSeconds: 60 })),
}));

import handler from '../../services/activityWorkspace/contentRouteHandler';

function mockRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  res.setHeader = () => res;
  return res;
}
const post = async (body: Record<string, unknown>) => {
  const res = mockRes();
  await handler({ method: 'POST', body, query: {}, headers: {} } as any, res);
  return res;
};

/** Every consequential sink in this handler. */
const allSinks = () => [sinkReserved, sinkBilled, sinkCompletion];
const noSinkRan = () => allSinks().every((s) => s.mock.calls.length === 0);
/** Every organization id that reached any sink. */
const chargedOrgs = () => [
  ...sinkReserved.mock.calls.map((c: any) => c[0]?.companyId),
  ...sinkBilled.mock.calls.map((c: any) => c[0]?.orgId),
  ...sinkCompletion.mock.calls.map((c: any) => c[0]?.companyId),
].filter((v) => v !== undefined);

/* ── per-branch request bodies that reach the sink when authorized ────────── */
const VARIANT = { platform: 'linkedin', generated_content: 'hello world', content_type: 'post' };
const BODIES: Record<string, (companyId?: string) => Record<string, unknown>> = {
  improve_variant: (companyId) => ({
    action: 'improve_variant', companyId, improvementType: 'IMPROVE_CTA',
    platform: 'linkedin', variant: VARIANT,
  }),
  improve_variant_all: (companyId) => ({
    action: 'improve_variant_all', companyId, improvementTypes: ['IMPROVE_CTA', 'IMPROVE_HOOK'],
    platform: 'linkedin', variant: VARIANT,
  }),
  refine_variant: (companyId) => ({
    action: 'refine_variant', companyId, platform: 'linkedin',
    refinement_prompt: 'tighten it', current_content: 'hello world',
    schedule: { platform: 'linkedin', contentType: 'post' },
  }),
};
const BRANCHES = Object.keys(BODIES);

beforeEach(() => {
  calls = [];
  authedUser = USER_A;
  roleRows = [...ACTIVE_IN_A];
  sinkReserved.mockClear(); sinkBilled.mockClear();
  sinkCompletion.mockClear(); sinkRefineEnabled.mockClear();
});

/* ════════════════════════════════════════════════════════════════════════════
 * The three affected branches, each proven independently.
 * ════════════════════════════════════════════════════════════════════════════ */
for (const branch of BRANCHES) {
  describe(branch, () => {
    it('CASE A — active member naming their OWN company is allowed and the sink gets it', async () => {
      /*
       * Asserted as "not denied, and the sink received company A" rather than a
       * literal 200. The billing sinks are stubbed, so what a branch returns
       * AFTER the charge depends on the fidelity of that stub, not on the
       * security boundary. The boundary is: the request got through, and the
       * organization that reached the sink is the caller's own.
       */
      const res = await post(BODIES[branch](CO_A));
      expect(res.statusCode).not.toBe(403);
      expect(res.statusCode).not.toBe(401);
      expect(noSinkRan()).toBe(false);
      expect(chargedOrgs()).toContain(CO_A);
      expect(chargedOrgs()).not.toContain(CANARY);
    });

    it('CRITICAL CASE B — naming a FOREIGN company is denied and nothing is charged', async () => {
      const res = await post(BODIES[branch](CO_B));
      expect(res.statusCode).toBe(403);
      expect(res.body).toEqual({ error: 'ORG_SCOPE_VIOLATION' });
      expect(noSinkRan()).toBe(true);
      expect(chargedOrgs()).toEqual([]);
    });

    it('CRITICAL CASE C — no membership at all is denied, sink not reached', async () => {
      roleRows = [];
      const res = await post(BODIES[branch](CO_A));
      expect(res.statusCode).toBe(403);
      expect(noSinkRan()).toBe(true);
    });

    it('CRITICAL CASE D — an INACTIVE membership is denied, sink not reached', async () => {
      roleRows = [{ user_id: USER_A, company_id: CO_A, role: 'COMPANY_ADMIN', status: 'inactive' }];
      const res = await post(BODIES[branch](CO_A));
      expect(res.statusCode).toBe(403);
      expect(noSinkRan()).toBe(true);
    });

    it('CRITICAL CASE D — an INVITED membership is denied, sink not reached', async () => {
      roleRows = [{ user_id: USER_A, company_id: CO_A, role: 'COMPANY_ADMIN', status: 'invited' }];
      const res = await post(BODIES[branch](CO_A));
      expect(res.statusCode).toBe(403);
      expect(noSinkRan()).toBe(true);
    });

    it('CRITICAL the server-side fallback is authorized too, not just the body value', async () => {
      /*
       * Omitting companyId makes the handler resolve it from
       * activity -> campaign -> company. The fixture activity belongs to company
       * B, so that path is no safer than the body: it must be authorized on the
       * same terms, or the fix would only have moved the defect one hop.
       */
      const body = BODIES[branch](undefined);
      delete (body as any).companyId;
      (body as any).activity = { id: 'act-b' };
      const res = await post(body);
      expect(res.statusCode).toBe(403);
      expect(noSinkRan()).toBe(true);
    });

    it('CASE E — alternate tenant field names cannot smuggle a company in', async () => {
      // The handler reads only `companyId`; these must stay inert rather than
      // becoming a second, unguarded channel if someone later widens parsing.
      const res = await post({
        ...BODIES[branch](CO_A),
        company_id: CO_B, organizationId: CO_B, organization_id: CO_B,
        org_id: CO_B, orgId: CO_B, tenantId: CO_B,
      });
      expect(res.statusCode).not.toBe(403);
      expect(chargedOrgs()).not.toContain(CANARY);
      expect(chargedOrgs()).toContain(CO_A);
    });

    it('the membership was genuinely checked against the database', async () => {
      // Guards against a stub that returns success without asking anything.
      await post(BODIES[branch](CO_A));
      expect(calls.some((c) => c.table === 'user_company_roles'
        && c.filters.user_id === USER_A && c.filters.company_id === CO_A)).toBe(true);
    });

    it('unauthenticated is rejected before anything is charged', async () => {
      authedUser = null;
      const res = await post(BODIES[branch](CO_A));
      expect(res.statusCode).toBe(401);
      expect(noSinkRan()).toBe(true);
    });
  });
}

/* ════════════════════════════════════════════════════════════════════════════
 * Preserved semantics.
 * ════════════════════════════════════════════════════════════════════════════ */
describe('preserved behaviour', () => {
  it('generate_master keeps its own stricter server-side derivation', async () => {
    /*
     * It IGNORES body.companyId and re-derives from the persisted activity, so
     * the hoisted check deliberately skips it. Here the activity belongs to
     * company B and the caller is only in A, so its OWN assertOrgMembership
     * must still deny — proving the branch was left intact rather than bypassed.
     */
    const res = await post({
      action: 'generate_master', companyId: CO_A, activity: { id: 'act-b' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'ORG_SCOPE_VIOLATION' });
    expect(noSinkRan()).toBe(true);
  });

  it('an invalid action is still a 400, ahead of any authorization', async () => {
    const res = await post({ action: 'not_a_real_action', companyId: CO_B });
    expect(res.statusCode).toBe(400);
    expect(noSinkRan()).toBe(true);
  });

  it('a non-POST method is still 405', async () => {
    const res = mockRes();
    await handler({ method: 'GET', body: {}, query: {}, headers: {} } as any, res);
    expect(res.statusCode).toBe(405);
  });

  it('CRITICAL a request with no company at all still cannot charge anyone', async () => {
    /*
     * A null tenant is deliberately NOT rejected by the new check — the sink
     * itself refuses it, so workspace-draft flows that legitimately run without
     * an organization keep working. What must never happen is a charge.
     */
    const body = BODIES.improve_variant(undefined);
    delete (body as any).companyId;
    await post(body);
    // No REAL organization is charged. (The sink is stubbed here, so the 400 it
    // raises for a null tenant is pinned statically below rather than executed.)
    expect(chargedOrgs()).not.toContain(CO_A);
    expect(chargedOrgs()).not.toContain(CO_B);
  });

  it('CRITICAL the sink itself still refuses a null tenant', () => {
    // contentRouteModel.runReservedFixedWorkflow is stubbed in this suite, so
    // its own guard is pinned by source: it is what makes skipping the
    // authorization check for a null company safe.
    const fs = require('fs');
    const path = require('path');
    const src: string = fs.readFileSync(
      path.resolve(__dirname, '../../services/activityWorkspace/contentRouteModel.ts'), 'utf8');
    expect(src).toMatch(/if \(!input\.companyId\)[\s\S]{0,160}MonetizedWorkflowError\(400/);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
 * Static pin — every consequential branch stays behind the boundary.
 * ════════════════════════════════════════════════════════════════════════════ */
describe('the tenant boundary is established once, before every branch', () => {
  const fs = require('fs');
  const path = require('path');
  const src: string = fs.readFileSync(
    path.resolve(__dirname, '../../services/activityWorkspace/contentRouteHandler.ts'), 'utf8');

  it('CRITICAL authorization precedes the first action branch', () => {
    const guardAt = src.indexOf('assertOrgMembership(user.id, companyId)');
    const firstBranchAt = src.indexOf("if (action === 'improve_variant')");
    expect(guardAt).toBeGreaterThan(-1);
    expect(firstBranchAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(firstBranchAt);
  });

  it('CRITICAL the rejection matches the pattern generate_master already used', () => {
    expect(src).toMatch(/ORG_SCOPE_VIOLATION/);
    const code = src.split('\n')
      .filter((l: string) => { const t = l.trim(); return !(t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')); })
      .join('\n');
    expect(code).toMatch(/assertOrgMembership\(user\.id, companyId\)[\s\S]{0,160}ORG_SCOPE_VIOLATION/);
  });
});
