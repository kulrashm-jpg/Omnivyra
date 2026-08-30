/**
 * OPPORTUNITIES-SEC-001 — POST /api/opportunities/[id]/action.
 *
 * withRBAC resolves its company from `req.query.companyId || req.body.companyId`
 * — QUERY FIRST. The handler read `body.companyId` alone, and its ownership
 * comparison was guarded by that value's truthiness:
 *
 *     const companyId = typeof body.companyId === 'string' ? body.companyId : '';
 *     const resolvedCompanyId = companyId || rowCompanyId;
 *     if (companyId && companyId !== rowCompanyId) return 403;   // <- skipped when ''
 *
 * So a request carrying companyId ONLY in the query string satisfied the
 * wrapper while leaving the handler's value empty — and empty skipped the
 * check. `resolvedCompanyId` then fell back to the VICTIM's company id and was
 * handed straight to the sinks.
 *
 * Every action is a write. takeAction and setOpportunityReviewed UPDATE
 * opportunity_items BY ID with no tenant predicate; promoteToCampaign INSERTs a
 * campaign into the named company; fillOpportunitySlots generates and upserts
 * opportunities there.
 *
 * The REAL authorization chain runs here — withRBAC → enforceRole →
 * resolveUserContext → getUserRole. Only the data layer, auth seam and the
 * opportunity service are mocked. Assertions inspect the SINKS: which
 * opportunity was acted on, which company reached each service call, and
 * whether any write happened at all.
 */

const ADMIN_A = 'aaaaaaaa-0000-0000-0000-0000000000aa';
const MEMBER_A = 'dddddddd-0000-0000-0000-0000000000dd';
const SUPERADMIN = 'cccccccc-0000-0000-0000-0000000000cc';
const COMPANY_A = 'a0000000-0000-0000-0000-00000000000a';
const VICTIM = 'b0000000-0000-0000-0000-00000000000b';
const OPP_A = 'oa000000-0000-0000-0000-00000000000a';
const OPP_VICTIM = 'ob000000-0000-0000-0000-00000000000b';

const ROLES = [
  { user_id: ADMIN_A, company_id: COMPANY_A, role: 'COMPANY_ADMIN', status: 'active' },
  { user_id: MEMBER_A, company_id: COMPANY_A, role: 'CONTENT_CREATOR', status: 'active' },
  { user_id: SUPERADMIN, company_id: COMPANY_A, role: 'SUPER_ADMIN', status: 'active' },
];

const OPPS: Record<string, { id: string; company_id: string; type: string; status: string }> = {
  [OPP_A]: { id: OPP_A, company_id: COMPANY_A, type: 'SEASONAL', status: 'OPEN' },
  [OPP_VICTIM]: { id: OPP_VICTIM, company_id: VICTIM, type: 'SEASONAL', status: 'OPEN' },
};

let authUser: string | null = ADMIN_A;

const queries: Array<{ table: string; filters: Record<string, unknown> }> = [];
/** Every service-level side effect, with the exact arguments it received. */
const takeActionCalls: Array<{ id: string; action: string }> = [];
const reviewedCalls: string[] = [];
const promoteCalls: Array<{ id: string; companyId: string; userId: string }> = [];
const fillSlotCalls: Array<{ companyId: string; type: string }> = [];

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
    b.limit = () => b; b.order = () => b;
    const rows = (): any[] => {
      if (table === 'user_company_roles') {
        return ROLES.filter(r =>
          (filters.user_id === undefined || r.user_id === filters.user_id) &&
          (filters.company_id === undefined || r.company_id === filters.company_id) &&
          (filters.role === undefined || r.role === filters.role) &&
          (filters.status === undefined || r.status === filters.status));
      }
      if (table === 'opportunity_items') {
        const o = OPPS[String(filters.id)];
        return o ? [o] : [];
      }
      return [];
    };
    const resolve = () => {
      queries.push({ table, filters: { ...filters } });
      const d = rows();
      return { data: d, count: d.length, error: d.length ? null : { message: 'not found' } };
    };
    b.maybeSingle = () => { const r = resolve(); return Promise.resolve({ data: r.data[0] ?? null, error: null }); };
    b.single = () => { const r = resolve(); return Promise.resolve({ data: r.data[0] ?? null, error: r.data.length ? null : { message: 'not found' } }); };
    b.then = (fn: any) => Promise.resolve(resolve()).then(fn);
    return b;
  };
  return { supabase: { from: (t: string) => build(t) } };
});
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => require('../../db/supabaseClient').supabase.from(t),
}));

jest.mock('../../services/opportunityService', () => ({
  takeAction: jest.fn(async (id: string, action: string) => { takeActionCalls.push({ id, action }); }),
  setOpportunityReviewed: jest.fn(async (id: string) => { reviewedCalls.push(id); }),
  promoteToCampaign: jest.fn(async (id: string, companyId: string, userId: string) => {
    promoteCalls.push({ id, companyId, userId }); return 'new-campaign';
  }),
  fillOpportunitySlots: jest.fn(async (companyId: string, type: string) => { fillSlotCalls.push({ companyId, type }); }),
}));

jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import handler from '../../../pages/api/opportunities/[id]/action';

function mockRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.setHeader = () => res;
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  return res;
}
async function call(as: string | null, opts: { id?: string; query?: any; body?: any; method?: string } = {}) {
  authUser = as;
  const res = mockRes();
  await handler({
    method: opts.method ?? 'POST',
    url: '/api/opportunities/x/action',
    query: { id: opts.id ?? OPP_VICTIM, ...(opts.query ?? {}) },
    body: opts.body ?? {},
    headers: {},
  } as never, res);
  return res;
}
/** Nothing at all happened to the victim tenant. */
const noVictimEffect = () => {
  expect(takeActionCalls.filter(c => c.id === OPP_VICTIM)).toEqual([]);
  expect(reviewedCalls.filter(i => i === OPP_VICTIM)).toEqual([]);
  expect(promoteCalls.filter(c => c.id === OPP_VICTIM || c.companyId === VICTIM)).toEqual([]);
  expect(fillSlotCalls.filter(c => c.companyId === VICTIM)).toEqual([]);
};
const noSinks = () => {
  expect(takeActionCalls).toEqual([]);
  expect(reviewedCalls).toEqual([]);
  expect(promoteCalls).toEqual([]);
  expect(fillSlotCalls).toEqual([]);
};

beforeEach(() => {
  authUser = ADMIN_A;
  queries.length = 0;
  takeActionCalls.length = 0; reviewedCalls.length = 0;
  promoteCalls.length = 0; fillSlotCalls.length = 0;
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

/* ── A — unauthenticated ──────────────────────────────────────────────── */

describe('A — unauthenticated', () => {
  it('CRITICAL: 401 and no sink runs', async () => {
    const res = await call(null, { query: { companyId: COMPANY_A }, body: { action: 'DISMISSED' } });
    expect(res.statusCode).toBe(401);
    noSinks();
  });
});

/* ── B — legitimate same-company use ──────────────────────────────────── */

describe('B — a COMPANY_ADMIN acting on their OWN opportunity', () => {
  it.each(['DISMISSED', 'ARCHIVED', 'SCHEDULED'])('%s still works', async (action) => {
    const res = await call(ADMIN_A, { id: OPP_A, body: { action, companyId: COMPANY_A } });
    expect(res.statusCode).toBe(200);
    expect(takeActionCalls).toEqual([{ id: OPP_A, action }]);
    expect(fillSlotCalls).toEqual([{ companyId: COMPANY_A, type: 'SEASONAL' }]);
  });

  it('PROMOTED still works and promotes into their OWN company', async () => {
    const res = await call(ADMIN_A, { id: OPP_A, body: { action: 'PROMOTED', companyId: COMPANY_A } });
    expect(res.statusCode).toBe(200);
    expect(promoteCalls).toEqual([{ id: OPP_A, companyId: COMPANY_A, userId: ADMIN_A }]);
  });

  it('REVIEWED still works', async () => {
    const res = await call(ADMIN_A, { id: OPP_A, body: { action: 'REVIEWED', companyId: COMPANY_A } });
    expect(res.statusCode).toBe(200);
    expect(reviewedCalls).toEqual([OPP_A]);
  });

  it('the sinks receive the SERVER-OWNED company, not a caller value', async () => {
    await call(ADMIN_A, { id: OPP_A, body: { action: 'DISMISSED', companyId: COMPANY_A } });
    expect(fillSlotCalls[0].companyId).toBe(OPPS[OPP_A].company_id);
  });
});

/* ── C/D — cross-company and the identifier split ─────────────────────── */

describe('C/D — cross-company access and identifier splitting', () => {
  it('CRITICAL: query companyId + absent body companyId cannot act on a foreign opportunity', async () => {
    // THE defect. withRBAC authorized COMPANY_A from the QUERY; the handler's
    // body value was '' so the ownership check was skipped entirely.
    const res = await call(ADMIN_A, {
      id: OPP_VICTIM, query: { companyId: COMPANY_A }, body: { action: 'DISMISSED' },
    });
    expect(res.statusCode).toBe(403);
    noVictimEffect();
    noSinks();
  });

  it.each(['DISMISSED', 'ARCHIVED', 'SCHEDULED', 'REVIEWED', 'PROMOTED'])(
    'CRITICAL: %s cannot be executed against a foreign opportunity via the split', async (action) => {
      const res = await call(ADMIN_A, {
        id: OPP_VICTIM, query: { companyId: COMPANY_A }, body: { action },
      });
      expect(res.statusCode).toBe(403);
      noSinks();
    });

  it('CRITICAL: no campaign is created in the victim company', async () => {
    await call(ADMIN_A, { id: OPP_VICTIM, query: { companyId: COMPANY_A }, body: { action: 'PROMOTED' } });
    expect(promoteCalls).toEqual([]);
  });

  it('CRITICAL: no opportunity generation is triggered in the victim company', async () => {
    await call(ADMIN_A, { id: OPP_VICTIM, query: { companyId: COMPANY_A }, body: { action: 'DISMISSED' } });
    expect(fillSlotCalls).toEqual([]);
  });

  it('naming the victim company in the BODY is refused by the role check', async () => {
    const res = await call(ADMIN_A, { id: OPP_VICTIM, body: { action: 'DISMISSED', companyId: VICTIM } });
    expect(res.statusCode).toBe(403);
    noSinks();
  });

  it('body companyId = own company + victim opportunity is refused', async () => {
    const res = await call(ADMIN_A, { id: OPP_VICTIM, body: { action: 'DISMISSED', companyId: COMPANY_A } });
    expect(res.statusCode).toBe(403);
    noSinks();
  });

  it('conflicting query and body identifiers reach no sink', async () => {
    const res = await call(ADMIN_A, {
      id: OPP_VICTIM, query: { companyId: COMPANY_A }, body: { action: 'DISMISSED', companyId: VICTIM },
    });
    expect(res.statusCode).toBe(403);
    noSinks();
  });

  it('omitting every company identifier is refused before the handler', async () => {
    const res = await call(ADMIN_A, { id: OPP_VICTIM, body: { action: 'DISMISSED' } });
    expect(res.statusCode).toBe(400);
    noSinks();
  });

  it('a non-admin cannot use the split either', async () => {
    const res = await call(MEMBER_A, {
      id: OPP_VICTIM, query: { companyId: COMPANY_A }, body: { action: 'DISMISSED' },
    });
    expect(res.statusCode).toBe(403);
    noSinks();
  });
});

/* ── E — super-admin ──────────────────────────────────────────────────── */

describe('E — platform super-admin', () => {
  it('keeps the bypass when naming the opportunity’s OWN company', async () => {
    const res = await call(SUPERADMIN, { id: OPP_VICTIM, body: { action: 'DISMISSED', companyId: VICTIM } });
    expect(res.statusCode).toBe(200);
    expect(takeActionCalls).toEqual([{ id: OPP_VICTIM, action: 'DISMISSED' }]);
  });

  it('CRITICAL: even a super-admin cannot mix tenants via the split', async () => {
    // The bypass is for acting AS a tenant, not for pairing one tenant's
    // authorization with another tenant's resource.
    const res = await call(SUPERADMIN, {
      id: OPP_VICTIM, query: { companyId: COMPANY_A }, body: { action: 'DISMISSED' },
    });
    expect(res.statusCode).toBe(403);
    noSinks();
  });
});

/* ── F — enumeration ──────────────────────────────────────────────────── */

describe('F — nonexistent and malformed identifiers', () => {
  it('a nonexistent opportunity is 404 with no sink', async () => {
    const res = await call(ADMIN_A, {
      id: 'ff000000-0000-0000-0000-0000000000ff', body: { action: 'DISMISSED', companyId: COMPANY_A },
    });
    expect(res.statusCode).toBe(404);
    noSinks();
  });

  it('a malformed id reaches no sink', async () => {
    const res = await call(ADMIN_A, { id: "x' OR 1=1--", body: { action: 'DISMISSED', companyId: COMPANY_A } });
    expect(res.statusCode).toBe(404);
    noSinks();
  });

  it('a missing id is rejected before the lookup', async () => {
    authUser = ADMIN_A;
    const res = mockRes();
    await handler({ method: 'POST', url: '/x', query: { companyId: COMPANY_A },
                    body: { action: 'DISMISSED', companyId: COMPANY_A }, headers: {} } as never, res);
    expect(res.statusCode).toBe(400);
    noSinks();
  });
});

/* ── G — action validation and method ─────────────────────────────────── */

describe('G — action handling', () => {
  it('an unknown action reaches no sink', async () => {
    const res = await call(ADMIN_A, { id: OPP_A, body: { action: 'DELETE_EVERYTHING', companyId: COMPANY_A } });
    expect(res.statusCode).toBe(400);
    noSinks();
  });

  it('a missing action is rejected before the opportunity lookup', async () => {
    const res = await call(ADMIN_A, { id: OPP_A, body: { companyId: COMPANY_A } });
    expect(res.statusCode).toBe(400);
    noSinks();
  });

  it('a non-POST verb reaches no sink', async () => {
    const res = await call(ADMIN_A, { id: OPP_A, body: { action: 'DISMISSED', companyId: COMPANY_A }, method: 'GET' });
    expect(res.statusCode).toBe(405);
    noSinks();
  });
});
