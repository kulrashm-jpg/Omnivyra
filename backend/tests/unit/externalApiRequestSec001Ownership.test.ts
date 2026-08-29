/**
 * EXTERNAL-API-REQUEST-SEC-001 — the permission must be held in the company
 * that OWNS the request, not in one the caller nominates.
 *
 * `PUT /api/external-apis/requests/[id]` checked MANAGE_EXTERNAL_APIS against
 * `companyId` — which arrives as `?companyId=`, `body.companyId`, or the
 * caller's default — and then selected the request row with `.eq('id', id)`
 * and NO tenant predicate. Every mutation updates `.eq('id', id)` the same way.
 *
 * So a company admin of A names their own company (passing the role gate
 * legitimately) and then acts on ANY other company's request:
 *
 *   approve              → saveTenantPlatformConfig provisions an external API
 *                          source into the VICTIM's tenant
 *   reject               → writes a caller-supplied rejection_reason into the
 *                          victim's row
 *   approve_by_admin     → unauthorized state transition
 *   send_to_super_admin  → unauthorized state transition
 *
 * This is the shape §4 warns about: authorization performed against a
 * caller-supplied scope, resource selected without an ownership predicate.
 *
 * Every test asserts the WRITE SINK, not just the status code — the contract is
 * authorize → validate → write, never select → write → authorize.
 */

type Row = Record<string, unknown>;

const ADMIN_A = 'user-admin-company-a';
const ADMIN_B = 'user-admin-company-b';
const SUPER = 'user-super-admin';
const COMPANY_A = 'company-a';
const COMPANY_B = 'company-b';

const REQUEST_OF_B = {
  id: 'req-owned-by-b',
  company_id: COMPANY_B,
  name: 'B private API',
  base_url: 'https://b.example',
  purpose: 'internal',
  status: 'pending_admin_review',
};
const REQUEST_OF_A = { ...REQUEST_OF_B, id: 'req-owned-by-a', company_id: COMPANY_A, name: 'A API' };
/** A platform-level request with no owning tenant. */
const REQUEST_NO_COMPANY = { ...REQUEST_OF_B, id: 'req-no-company', company_id: null };

const REQUESTS: Record<string, Row> = {
  [REQUEST_OF_A.id]: REQUEST_OF_A,
  [REQUEST_OF_B.id]: REQUEST_OF_B,
  [REQUEST_NO_COMPANY.id]: REQUEST_NO_COMPANY,
};
const MEMBERSHIP: Record<string, string[]> = {
  [ADMIN_A]: [COMPANY_A],
  [ADMIN_B]: [COMPANY_B],
  [SUPER]: [],
};

let authUser: string | null = ADMIN_A;
let superAdmins: string[] = [SUPER];
/** Every mutation the route attempted against the requests table. */
const updates: Array<{ id: unknown; payload: Row }> = [];
/** Every tenant provisioning call — the sharpest side effect. */
const provisioned: Array<{ company_id: unknown; name: unknown }> = [];

jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn(async () =>
    authUser ? { user: { id: authUser }, error: null } : { user: null, error: 'MISSING_AUTH' }),
}));
jest.mock('../../services/superAdminSession', () => ({ getLegacySuperAdminSession: jest.fn(() => null) }));

jest.mock('../../services/userContextService', () => ({
  resolveUserContext: jest.fn(async () => ({
    userId: authUser ?? '',
    role: 'user',
    companyIds: authUser ? (MEMBERSHIP[authUser] ?? []) : [],
    defaultCompanyId: authUser ? (MEMBERSHIP[authUser] ?? [])[0] ?? '' : '',
    authenticated: Boolean(authUser),
  })),
}));

jest.mock('../../services/rbacService', () => ({
  isSuperAdmin: jest.fn(async (id: string) => superAdmins.includes(id)),
  isPlatformSuperAdmin: jest.fn(async (id: string) => superAdmins.includes(id)),
  getUserRole: jest.fn(async (id: string, companyId: string) =>
    (MEMBERSHIP[id] ?? []).includes(companyId)
      ? { role: 'COMPANY_ADMIN', error: null }
      : { role: null, error: 'COMPANY_ACCESS_DENIED' }),
  getCompanyRoleIncludingInvited: jest.fn(async () => null),
  hasPermission: jest.fn(async (role: string) => role === 'COMPANY_ADMIN' || role === 'SUPER_ADMIN'),
}));

jest.mock('../../services/externalApiService', () => ({
  saveTenantPlatformConfig: jest.fn(async (cfg: Row) => {
    provisioned.push({ company_id: cfg.company_id, name: cfg.name });
  }),
}));

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      let op: 'select' | 'update' = 'select';
      let payload: Row = {};
      const b: any = {};
      b.select = () => b;
      b.eq = (c: string, v: unknown) => { filters[c] = v; return b; };
      b.update = (p: Row) => { op = 'update'; payload = p; return b; };
      const resolve = () => {
        if (table !== 'external_api_source_requests') return { data: null, error: null };
        if (op === 'update') { updates.push({ id: filters.id, payload }); return { data: null, error: null }; }
        const row = REQUESTS[String(filters.id)];
        return row ? { data: row, error: null } : { data: null, error: { message: 'no rows' } };
      };
      b.single = () => Promise.resolve(resolve());
      b.maybeSingle = () => Promise.resolve(resolve());
      b.then = (r: any) => Promise.resolve(resolve()).then(r);
      return b;
    },
  },
}));

jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import handler from '../../../pages/api/external-apis/requests/[id]';

function mockRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  return res;
}

async function act(opts: { as: string | null; id: string; action: string; companyId?: string; extra?: Row }) {
  authUser = opts.as;
  const res = mockRes();
  await handler({
    method: 'PUT', url: `/api/external-apis/requests/${opts.id}`,
    query: { id: opts.id, ...(opts.companyId ? { companyId: opts.companyId } : {}) },
    body: { action: opts.action, ...(opts.extra ?? {}) },
  } as never, res);
  return res;
}

const MUTATING_ACTIONS = ['approve', 'reject', 'approve_by_admin', 'send_to_super_admin'];

beforeEach(() => {
  authUser = ADMIN_A;
  superAdmins = [SUPER];
  updates.length = 0;
  provisioned.length = 0;
  jest.spyOn(console, 'debug').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

/* ── A — unauthenticated ──────────────────────────────────────────────── */

describe('A — unauthenticated', () => {
  it.each(MUTATING_ACTIONS)('%s → 401, no write, no provisioning', async (action) => {
    const res = await act({ as: null, id: REQUEST_OF_B.id, action, companyId: COMPANY_A });
    expect(res.statusCode).toBe(401);
    expect(updates).toEqual([]);
    expect(provisioned).toEqual([]);
  });
});

/* ── B / F — legitimate access is preserved ───────────────────────────── */

describe('B — the owning company’s admin', () => {
  it('can approve their OWN company’s request, and it provisions into their tenant', async () => {
    const res = await act({ as: ADMIN_A, id: REQUEST_OF_A.id, action: 'approve', companyId: COMPANY_A });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: 'approved' });
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe(REQUEST_OF_A.id);
    expect(provisioned).toEqual([{ company_id: COMPANY_A, name: 'A API' }]);
  });

  it('can reject their own company’s request', async () => {
    const res = await act({
      as: ADMIN_A, id: REQUEST_OF_A.id, action: 'reject', companyId: COMPANY_A,
      extra: { rejection_reason: 'not needed' },
    });
    expect(res.statusCode).toBe(200);
    expect(updates).toHaveLength(1);
    expect(updates[0].payload.status).toBe('rejected');
  });

  it('send_to_super_admin still works for a company admin', async () => {
    const res = await act({ as: ADMIN_A, id: REQUEST_OF_A.id, action: 'send_to_super_admin', companyId: COMPANY_A });
    expect(res.statusCode).toBe(200);
    expect(updates[0].payload.status).toBe('sent_to_super_admin');
  });
});

describe('F — a platform/super admin keeps full reach', () => {
  it('may approve another company’s request', async () => {
    const res = await act({ as: SUPER, id: REQUEST_OF_B.id, action: 'approve', companyId: COMPANY_A });
    expect(res.statusCode).toBe(200);
    // Provisioning still targets the request's OWN company, not the caller's.
    expect(provisioned).toEqual([{ company_id: COMPANY_B, name: 'B private API' }]);
  });

  it('may act on a request that has no owning company', async () => {
    const res = await act({ as: SUPER, id: REQUEST_NO_COMPANY.id, action: 'reject', companyId: COMPANY_A });
    expect(res.statusCode).toBe(200);
    expect(updates).toHaveLength(1);
  });
});

/* ── C / D — the exploit ──────────────────────────────────────────────── */

describe('D — a company admin cannot act on another company’s request', () => {
  it.each(MUTATING_ACTIONS)('CRITICAL: %s on another tenant’s request writes NOTHING', async (action) => {
    const res = await act({
      as: ADMIN_A, id: REQUEST_OF_B.id, action, companyId: COMPANY_A,
      extra: { rejection_reason: 'attacker text' },
    });

    expect(res.statusCode).toBe(404);
    expect(updates).toEqual([]);
    expect(provisioned).toEqual([]);
  });

  it('CRITICAL: approve cannot provision into the victim’s tenant', async () => {
    await act({ as: ADMIN_A, id: REQUEST_OF_B.id, action: 'approve', companyId: COMPANY_A });
    expect(provisioned).toEqual([]);
  });

  it('the reverse direction is equally denied', async () => {
    const res = await act({ as: ADMIN_B, id: REQUEST_OF_A.id, action: 'approve', companyId: COMPANY_B });
    expect(res.statusCode).toBe(404);
    expect(updates).toEqual([]);
  });

  it('a request with no owning company is not actionable by a company admin', async () => {
    const res = await act({ as: ADMIN_A, id: REQUEST_NO_COMPANY.id, action: 'reject', companyId: COMPANY_A });
    expect(res.statusCode).toBe(404);
    expect(updates).toEqual([]);
  });
});

/* ── E — spoofed scope ────────────────────────────────────────────────── */

describe('E — a caller-supplied scope is not a privilege grant', () => {
  it('naming the victim’s company is refused at the role gate', async () => {
    const res = await act({ as: ADMIN_A, id: REQUEST_OF_B.id, action: 'approve', companyId: COMPANY_B });
    expect(res.statusCode).toBe(403);
    expect(res.body?.error).toBe('FORBIDDEN_ROLE');
    expect(updates).toEqual([]);
  });

  it('companyId in the BODY is no better than in the query', async () => {
    authUser = ADMIN_A;
    const res = mockRes();
    await handler({
      method: 'PUT', url: '/api/external-apis/requests/x',
      query: { id: REQUEST_OF_B.id },
      body: { action: 'approve', companyId: COMPANY_A },
    } as never, res);
    expect(res.statusCode).toBe(404);
    expect(updates).toEqual([]);
    expect(provisioned).toEqual([]);
  });

  it('?scope=platform does not grant platform reach to a company admin', async () => {
    authUser = ADMIN_A;
    const res = mockRes();
    await handler({
      method: 'PUT', url: '/api/external-apis/requests/x',
      query: { id: REQUEST_OF_B.id, scope: 'platform', companyId: COMPANY_A },
      body: { action: 'approve' },
    } as never, res);
    expect(res.statusCode).toBe(404);
    expect(updates).toEqual([]);
  });
});

/* ── G — unknown resource, no existence oracle ────────────────────────── */

describe('G — error semantics', () => {
  it('a nonexistent id is 404', async () => {
    const res = await act({ as: ADMIN_A, id: 'no-such-request', action: 'approve', companyId: COMPANY_A });
    expect(res.statusCode).toBe(404);
  });

  it('a FOREIGN id and a NONEXISTENT id are indistinguishable', async () => {
    const foreign = await act({ as: ADMIN_A, id: REQUEST_OF_B.id, action: 'approve', companyId: COMPANY_A });
    const missing = await act({ as: ADMIN_A, id: 'no-such-request', action: 'approve', companyId: COMPANY_A });
    expect(foreign.statusCode).toBe(missing.statusCode);
    expect(foreign.body).toEqual(missing.body);
  });

  it('a non-PUT verb is 405 before any lookup', async () => {
    authUser = ADMIN_A;
    const res = mockRes();
    await handler({ method: 'GET', url: '/x', query: { id: REQUEST_OF_B.id }, body: {} } as never, res);
    expect(res.statusCode).toBe(405);
    expect(updates).toEqual([]);
  });

  it('an invalid action is rejected before the row is even fetched', async () => {
    const res = await act({ as: ADMIN_A, id: REQUEST_OF_A.id, action: 'delete_everything', companyId: COMPANY_A });
    expect(res.statusCode).toBe(400);
    expect(updates).toEqual([]);
  });
});
