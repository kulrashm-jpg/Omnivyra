/**
 * RECOMMENDATIONS-SEC-001 — create-campaign-from-group and group-preview.
 *
 * Both routes were wrapped in withRBAC and both were still cross-tenant
 * exploitable, because the wrapper and the handler read DIFFERENT FIELDS:
 *
 *   withRBAC  → req.query.companyId || req.body.companyId   (camelCase)
 *   handler   → req.body.company_id                          (snake_case)
 *
 * So the caller was authorized against one company and the route then operated
 * on another. A user holding COMPANY_ADMIN / CONTENT_CREATOR / SUPER_ADMIN in
 * ANY company posts `companyId=<their own>` to satisfy the wrapper and
 * `company_id=<victim>` to redirect every query and sink at the victim tenant.
 *
 * This is the INVERSE of the usual pattern this programme finds: the caller's
 * company is properly authorized — it is the RESOURCE company that never is.
 *
 * create-campaign-from-group is a WRITE path: it inserts campaign_versions
 * under company_id, UPDATES that company's recommendation_snapshots to point at
 * the attacker's new campaign, and inserts an audit_logs row under it.
 * group-preview reads the tenant's learning signals and attributes the AI
 * call's billing to it via wirePhase2Route({ organizationId }).
 *
 * The REAL authorization chain runs here — withRBAC → enforceRole →
 * resolveUserContext → getUserRole, and requireCompanyAccess →
 * assertTenantAccess. Only the data layer, auth seam and downstream services
 * are mocked. Assertions inspect the SINK: exactly which rows were written,
 * under which company, and whether downstream services were reached at all.
 */

const ADMIN_A = 'aaaaaaaa-0000-0000-0000-0000000000aa';
const CREATOR_A = 'dddddddd-0000-0000-0000-0000000000dd';
const OUTSIDER = 'eeeeeeee-0000-0000-0000-0000000000ee';
const SUPERADMIN = 'cccccccc-0000-0000-0000-0000000000cc';
const COMPANY_A = 'a0000000-0000-0000-0000-00000000000a';
const VICTIM = 'b0000000-0000-0000-0000-00000000000b';

const ROLES = [
  { user_id: ADMIN_A, company_id: COMPANY_A, role: 'COMPANY_ADMIN', status: 'active' },
  { user_id: CREATOR_A, company_id: COMPANY_A, role: 'CONTENT_CREATOR', status: 'active' },
  { user_id: SUPERADMIN, company_id: COMPANY_A, role: 'SUPER_ADMIN', status: 'active' },
  // Stale membership in the victim tenant — must NOT authorize.
  { user_id: OUTSIDER, company_id: VICTIM, role: 'COMPANY_ADMIN', status: 'inactive' },
];

let authUser: string | null = ADMIN_A;

type Q = { table: string; filters: Record<string, unknown> };
const queries: Q[] = [];
const writes: Array<{ table: string; op: 'insert' | 'update'; payload: any; filters: Record<string, unknown> }> = [];
const billingCalls: Array<{ organizationId: string }> = [];
const aiCalls: Array<{ companyId: string }> = [];
const planCalls: string[] = [];

/** Reads/writes other than the authorization chain's own lookups. */
const appQueries = () => queries.filter(q => !['user_company_roles', 'companies'].includes(q.table));

jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn(async () =>
    authUser ? { user: { id: authUser, email: 'u@e.com', emailVerified: true }, error: null }
             : { user: null, error: 'MISSING_AUTH' }),
}));

jest.mock('../../db/supabaseClient', () => {
  const build = (table: string) => {
    const filters: Record<string, unknown> = {};
    const b: any = {};
    b.select = () => b;
    b.eq = (c: string, v: unknown) => { filters[c] = v; return b; };
    b.in = (c: string, v: unknown) => { filters[c] = v; return b; };
    b.gte = (c: string, v: unknown) => { filters[`${c}__gte`] = v; return b; };
    b.filter = (c: string, _o: string, v: unknown) => { filters[c] = v; return b; };
    b.order = () => b; b.limit = () => b;
    b.insert = (payload: any) => { writes.push({ table, op: 'insert', payload, filters: { ...filters } }); return b; };
    b.update = (payload: any) => { writes.push({ table, op: 'update', payload, filters }); return b; };
    const rows = (): any[] => {
      if (table === 'user_company_roles') {
        return ROLES.filter(r =>
          (filters.user_id === undefined || r.user_id === filters.user_id) &&
          (filters.company_id === undefined || r.company_id === filters.company_id) &&
          (filters.role === undefined || r.role === filters.role) &&
          (filters.status === undefined || r.status === filters.status));
      }
      if (table === 'companies') return [{ id: filters.id, status: 'active' }];
      if (table === 'campaigns') return [{ id: 'new-campaign-id', name: 'c' }];
      if (table === 'campaign_versions') return [{ campaign_id: 'cv-camp', created_at: '2026-01-01' }];
      if (table === 'recommendation_snapshots') return [{ id: 'snap1', snapshot_hash: 'h1' }];
      return [];
    };
    const resolve = () => {
      queries.push({ table, filters: { ...filters } });
      return { data: rows(), count: rows().length, error: null };
    };
    b.maybeSingle = () => { const r = resolve(); return Promise.resolve({ data: r.data[0] ?? null, error: null }); };
    b.single = () => { const r = resolve(); return Promise.resolve({ data: r.data[0] ?? null, error: null }); };
    b.then = (fn: any) => Promise.resolve(resolve()).then(fn);
    return b;
  };
  return { supabase: { from: (t: string) => build(t) } };
});
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => require('../../db/supabaseClient').supabase.from(t),
}));

/* downstream sinks */
jest.mock('../../services/billing/phase2RouteWiring', () => ({
  wirePhase2Route: jest.fn(async (a: any) => {
    billingCalls.push({ organizationId: a.organizationId });
    return a.run();
  }),
}));
jest.mock('../../services/billing/phase2EnforcementGate', () => ({ PaymentRequiredError: class extends Error {} }));
jest.mock('../../services/aiGateway', () => ({
  generateRecommendation: jest.fn(async (a: any) => { aiCalls.push({ companyId: a.companyId }); return { output: { groups: [] } }; }),
}));
jest.mock('../../services/campaignAiOrchestrator', () => ({
  runCampaignAiPlan: jest.fn(async (a: any) => { planCalls.push(a.campaignId); return { snapshot_hash: 'sh', omnivyre_decision: {} }; }),
}));
jest.mock('../../services/campaignPlanningInputsService', () => ({ getCampaignPlanningInputs: jest.fn(async () => null) }));
jest.mock('../../services/campaignContextConfig', () => ({
  DEFAULT_BUILD_MODE_RECOMMENDATION: 'default',
  normalizeCampaignTypes: jest.fn(() => []),
  normalizeCampaignWeights: jest.fn(() => ({})),
}));
jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock('../../security/audit/SecurityAuditService', () => ({ logSecurityEvent: jest.fn() }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import createHandler from '../../../pages/api/recommendations/create-campaign-from-group';
import previewHandler from '../../../pages/api/recommendations/group-preview';

function mockRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.setHeader = () => res;
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  return res;
}
async function call(h: any, as: string | null, body: Record<string, unknown>, method = 'POST') {
  authUser = as;
  const res = mockRes();
  await h({ method, url: '/api/recommendations/x', query: {}, body, headers: {} } as never, res);
  return res;
}
const CREATE_BODY = {
  selected_recommendations: [{ snapshot_hash: 'h1' }],
  groups: [{ theme_name: 'Theme' }],
};
const PREVIEW_BODY = { selected_recommendations: [{ snapshot_hash: 'h1' }] };

/** No row was written anywhere under `company`, and nothing was read for it. */
function assertNothingTouched(company: string) {
  const wrote = writes.filter(w =>
    JSON.stringify(w.payload).includes(company) || JSON.stringify(w.filters).includes(company));
  expect(wrote).toEqual([]);
  const read = appQueries().filter(q => JSON.stringify(q.filters).includes(company));
  expect(read).toEqual([]);
  expect(billingCalls.filter(b => b.organizationId === company)).toEqual([]);
  expect(aiCalls.filter(a => a.companyId === company)).toEqual([]);
}

beforeEach(() => {
  authUser = ADMIN_A;
  queries.length = 0; writes.length = 0;
  billingCalls.length = 0; aiCalls.length = 0; planCalls.length = 0;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

/* ═══ create-campaign-from-group — the write path ═══════════════════════ */

describe('create-campaign-from-group', () => {
  it('unauthenticated → 401 and NOTHING is written', async () => {
    const res = await call(createHandler, null, { companyId: VICTIM, company_id: VICTIM, ...CREATE_BODY });
    expect(res.statusCode).toBe(401);
    expect(writes).toEqual([]);
    expect(planCalls).toEqual([]);
  });

  it('CRITICAL: the split-identifier exploit is refused — companyId=own, company_id=victim', async () => {
    // THE defect. withRBAC authorizes COMPANY_A (which ADMIN_A really admins);
    // every sink below used company_id = VICTIM.
    const res = await call(createHandler, ADMIN_A, { companyId: COMPANY_A, company_id: VICTIM, ...CREATE_BODY });
    expect(res.statusCode).toBe(403);
    assertNothingTouched(VICTIM);
    expect(writes).toEqual([]);
    expect(planCalls).toEqual([]);
  });

  it('CRITICAL: no campaign_versions row is inserted under the victim', async () => {
    await call(createHandler, ADMIN_A, { companyId: COMPANY_A, company_id: VICTIM, ...CREATE_BODY });
    expect(writes.filter(w => w.table === 'campaign_versions')).toEqual([]);
  });

  it('CRITICAL: the victim’s recommendation_snapshots are never UPDATED', async () => {
    await call(createHandler, ADMIN_A, { companyId: COMPANY_A, company_id: VICTIM, ...CREATE_BODY });
    expect(writes.filter(w => w.table === 'recommendation_snapshots' && w.op === 'update')).toEqual([]);
  });

  it('CRITICAL: no audit_logs row is written under the victim', async () => {
    await call(createHandler, ADMIN_A, { companyId: COMPANY_A, company_id: VICTIM, ...CREATE_BODY });
    expect(writes.filter(w => w.table === 'audit_logs')).toEqual([]);
  });

  it('CRITICAL: no campaign is created and no AI plan runs on denial', async () => {
    await call(createHandler, ADMIN_A, { companyId: COMPANY_A, company_id: VICTIM, ...CREATE_BODY });
    expect(writes.filter(w => w.table === 'campaigns')).toEqual([]);
    expect(planCalls).toEqual([]);
  });

  it('a CONTENT_CREATOR cannot use the split-identifier trick either', async () => {
    const res = await call(createHandler, CREATOR_A, { companyId: COMPANY_A, company_id: VICTIM, ...CREATE_BODY });
    expect(res.statusCode).toBe(403);
    expect(writes).toEqual([]);
  });

  it('CRITICAL: a super admin naming a victim in company_id is still bound — but by design keeps the bypass', async () => {
    // Documented platform behaviour: assertTenantAccess grants super admins any
    // tenant. Pinned so a change to that contract is deliberate, not accidental.
    const res = await call(createHandler, SUPERADMIN, { companyId: COMPANY_A, company_id: VICTIM, ...CREATE_BODY });
    expect(res.statusCode).toBe(200);
  });

  it('a stale (inactive) membership does not authorize', async () => {
    const res = await call(createHandler, OUTSIDER, { companyId: VICTIM, company_id: VICTIM, ...CREATE_BODY });
    expect(res.statusCode).toBe(403);
    expect(writes).toEqual([]);
  });

  it('legitimate use still works, and writes under the caller’s OWN company', async () => {
    const res = await call(createHandler, ADMIN_A, { companyId: COMPANY_A, company_id: COMPANY_A, ...CREATE_BODY });
    expect(res.statusCode).toBe(200);
    const cv = writes.find(w => w.table === 'campaign_versions');
    expect(cv!.payload.company_id).toBe(COMPANY_A);
    const audit = writes.find(w => w.table === 'audit_logs');
    expect(audit!.payload.company_id).toBe(COMPANY_A);
    expect(planCalls).toHaveLength(1);
  });

  it('a missing company_id is rejected before any write', async () => {
    const res = await call(createHandler, ADMIN_A, { companyId: COMPANY_A, ...CREATE_BODY });
    expect(res.statusCode).toBe(400);
    expect(writes).toEqual([]);
  });

  it('a non-POST verb writes nothing', async () => {
    const res = await call(createHandler, ADMIN_A, { companyId: COMPANY_A, company_id: COMPANY_A, ...CREATE_BODY }, 'GET');
    expect(res.statusCode).toBe(405);
    expect(writes).toEqual([]);
  });
});

/* ═══ group-preview — the read + billing path ═══════════════════════════ */

describe('group-preview', () => {
  it('unauthenticated → 401, no billing and no AI call', async () => {
    const res = await call(previewHandler, null, { companyId: VICTIM, company_id: VICTIM, ...PREVIEW_BODY });
    expect(res.statusCode).toBe(401);
    expect(billingCalls).toEqual([]);
    expect(aiCalls).toEqual([]);
  });

  it('CRITICAL: the split-identifier exploit is refused', async () => {
    const res = await call(previewHandler, ADMIN_A, { companyId: COMPANY_A, company_id: VICTIM, ...PREVIEW_BODY });
    expect(res.statusCode).toBe(403);
    assertNothingTouched(VICTIM);
  });

  it('CRITICAL: the victim’s learning signals are never read', async () => {
    await call(previewHandler, ADMIN_A, { companyId: COMPANY_A, company_id: VICTIM, ...PREVIEW_BODY });
    const leaked = appQueries().filter(q =>
      ['campaign_versions', 'campaign_learnings', 'ai_enhancement_logs', 'audit_logs'].includes(q.table));
    expect(leaked).toEqual([]);
  });

  it('CRITICAL: no credit/billing is attributed to the victim organisation', async () => {
    await call(previewHandler, ADMIN_A, { companyId: COMPANY_A, company_id: VICTIM, ...PREVIEW_BODY });
    expect(billingCalls).toEqual([]);
  });

  it('legitimate use still works and bills the caller’s OWN company', async () => {
    const res = await call(previewHandler, ADMIN_A, { companyId: COMPANY_A, company_id: COMPANY_A, ...PREVIEW_BODY });
    expect(res.statusCode).toBe(200);
    expect(billingCalls).toEqual([{ organizationId: COMPANY_A }]);
    expect(aiCalls).toEqual([{ companyId: COMPANY_A }]);
  });

  it('the route writes nothing at all', async () => {
    await call(previewHandler, ADMIN_A, { companyId: COMPANY_A, company_id: COMPANY_A, ...PREVIEW_BODY });
    expect(writes).toEqual([]);
  });

  it('a stale membership does not authorize', async () => {
    const res = await call(previewHandler, OUTSIDER, { companyId: VICTIM, company_id: VICTIM, ...PREVIEW_BODY });
    expect(res.statusCode).toBe(403);
    expect(billingCalls).toEqual([]);
  });

  it('a missing company_id is rejected before any sink', async () => {
    const res = await call(previewHandler, ADMIN_A, { companyId: COMPANY_A, ...PREVIEW_BODY });
    expect(res.statusCode).toBe(400);
    expect(billingCalls).toEqual([]);
    expect(aiCalls).toEqual([]);
  });

  it('a non-POST verb reaches no sink', async () => {
    const res = await call(previewHandler, ADMIN_A, { companyId: COMPANY_A, company_id: COMPANY_A, ...PREVIEW_BODY }, 'GET');
    expect(res.statusCode).toBe(405);
    expect(billingCalls).toEqual([]);
  });
});

/* ═══ cluster-wide ═════════════════════════════════════════════════════ */

describe('both routes', () => {
  it('CRITICAL: no variant of the identifier split reaches a sink', async () => {
    const variants = [
      { companyId: COMPANY_A, company_id: VICTIM },
      { companyId: COMPANY_A, company_id: VICTIM, organizationId: VICTIM },
      { companyId: COMPANY_A, company_id: VICTIM, scope: 'platform' },
      { companyId: COMPANY_A, company_id: VICTIM, role: 'SUPER_ADMIN', isAdmin: true },
    ];
    for (const v of variants) {
      await call(createHandler, ADMIN_A, { ...v, ...CREATE_BODY });
      await call(previewHandler, ADMIN_A, { ...v, ...PREVIEW_BODY });
    }
    expect(writes).toEqual([]);
    expect(billingCalls).toEqual([]);
    expect(aiCalls).toEqual([]);
    expect(planCalls).toEqual([]);
    assertNothingTouched(VICTIM);
  });
});
