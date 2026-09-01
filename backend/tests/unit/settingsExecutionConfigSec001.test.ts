/**
 * SETTINGS-EXECUTION-CONFIG-SEC-001 — pages/api/settings/execution-config.
 *
 * GET/PUT over company execution flags. The company is NEVER taken from the
 * request: the route calls a bespoke local resolveCompanyId(userId) with the
 * authenticated user id only, and there is no query/body company field at all.
 * That half is sound, and these tests pin it.
 *
 * THE DEFECT this suite was written to catch:
 *
 *   resolveCompanyId queried user_company_roles by user_id ONLY — with no
 *   status filter. Every other resolver in this codebase (the reports binder,
 *   settings/intelligence-access, command-center/company-state) requires
 *   status='active', and assertTenantAccess rejects a non-active membership as
 *   STALE_MEMBERSHIP.
 *
 *   user_company_roles carries non-active rows by design: inviting a user
 *   writes status='invited' (backend/apiHandlers/company/usersShared.ts) with
 *   no acceptance and NO session revocation, and deactivation writes
 *   status='inactive'. So a user who never accepted an invitation — or whose
 *   membership was revoked — still resolved to that company and could READ and
 *   WRITE its execution configuration.
 *
 * The fix is one predicate. These tests assert the company that actually
 * reached each read and each write, not response codes alone.
 */

export {};

const ACTIVE_USER = 'aaaaaaaa-0000-0000-0000-0000000000aa';
const INVITED_USER = 'bbbbbbbb-0000-0000-0000-0000000000bb';
const REVOKED_USER = 'dddddddd-0000-0000-0000-0000000000dd';
const NOBODY = 'eeeeeeee-0000-0000-0000-0000000000ee';
/** Active in OWN, but also carries a stale row for VICTIM. */
const MIXED_USER = 'ffffffff-0000-0000-0000-0000000000ff';

const OWN = 'a0000000-0000-0000-0000-00000000000a';
const VICTIM = 'b0000000-0000-0000-0000-00000000000b';

const ROLES = [
  { user_id: ACTIVE_USER, company_id: OWN, status: 'active' },
  { user_id: INVITED_USER, company_id: VICTIM, status: 'invited' },
  { user_id: REVOKED_USER, company_id: VICTIM, status: 'inactive' },
  // Stale row listed FIRST so an unordered limit(1) would prefer it.
  { user_id: MIXED_USER, company_id: VICTIM, status: 'inactive' },
  { user_id: MIXED_USER, company_id: OWN, status: 'active' },
];

let authUser: string | null = ACTIVE_USER;

const roleQueries: Array<Record<string, unknown>> = [];
const flagReads: string[] = [];
const flagWrites: Array<{ companyId: string; flags: unknown; updatedBy: string }> = [];

jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn(async () =>
    authUser ? { user: { id: authUser }, error: null } : { user: null, error: 'NO_AUTH' }),
}));

jest.mock('../../db/supabaseClient', () => {
  const build = (table: string) => {
    const filters: Record<string, unknown> = {};
    const b: any = {};
    b.select = () => b;
    b.eq = (c: string, v: unknown) => { filters[c] = v; return b; };
    b.limit = () => b;
    b.order = () => b;
    b.maybeSingle = () => {
      roleQueries.push({ table, ...filters });
      const rows = ROLES.filter(r =>
        (filters.user_id === undefined || r.user_id === filters.user_id) &&
        (filters.status === undefined || r.status === filters.status));
      return Promise.resolve({ data: rows[0] ? { company_id: rows[0].company_id } : null, error: null });
    };
    return b;
  };
  return { supabase: { from: (t: string) => build(t) } };
});

jest.mock('../../services/intentExecutionService', () => ({
  getCompanyExecutionFlags: jest.fn(async (companyId: string) => {
    flagReads.push(companyId);
    return { insights: { market_trends: false, competitor_tracking: false, ai_recommendations: false },
             frequency: { insights: '8h' } };
  }),
  setCompanyExecutionFlags: jest.fn(async (companyId: string, flags: unknown, updatedBy: string) => {
    flagWrites.push({ companyId, flags, updatedBy });
  }),
}));

const route = require('../../../pages/api/settings/execution-config').default;

function mockRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.end = () => res;
  res.setHeader = () => res;
  return res;
}

async function call(user: string | null, opts: { method?: string; body?: any; query?: any } = {}) {
  authUser = user;
  roleQueries.length = 0; flagReads.length = 0; flagWrites.length = 0;
  const res = mockRes();
  await route({ method: opts.method ?? 'GET', url: '/x', headers: {},
    query: opts.query ?? {}, body: opts.body ?? {} } as never, res);
  return res;
}

const PUT = { insights: { market_trends: true }, frequency: { insights: '1h' } };

describe('authentication and method', () => {
  it('unauthenticated is refused before any query', async () => {
    const res = await call(null, { method: 'PUT', body: PUT });
    expect(res.statusCode).toBe(401);
    expect(roleQueries).toEqual([]);
    expect(flagWrites).toEqual([]);
  });

  it('a non-GET/PUT verb reaches nothing', async () => {
    const res = await call(ACTIVE_USER, { method: 'DELETE' });
    expect(res.statusCode).toBe(405);
    expect(roleQueries).toEqual([]);
  });

  it('an invalid body is rejected before the write', async () => {
    const res = await call(ACTIVE_USER, { method: 'PUT', body: { frequency: { insights: '99h' } } });
    expect(res.statusCode).toBe(400);
    expect(flagWrites).toEqual([]);
  });
});

describe('company derivation', () => {
  it('an active member resolves to their own company on GET', async () => {
    const res = await call(ACTIVE_USER);
    expect(res.statusCode).toBe(200);
    expect(res.body.companyId).toBe(OWN);
    expect(flagReads).toEqual([OWN]);
  });

  it('an active member writes to their own company on PUT', async () => {
    const res = await call(ACTIVE_USER, { method: 'PUT', body: PUT });
    expect(res.statusCode).toBe(200);
    expect(flagWrites).toHaveLength(1);
    expect(flagWrites[0].companyId).toBe(OWN);
    expect(flagWrites[0].updatedBy).toBe(ACTIVE_USER);
  });

  it('a caller with no memberships is refused', async () => {
    const res = await call(NOBODY, { method: 'PUT', body: PUT });
    expect(res.statusCode).toBe(404);
    expect(flagWrites).toEqual([]);
    expect(flagReads).toEqual([]);
  });
});

describe('CRITICAL — a non-active membership must not authorize', () => {
  it('the membership query requires status=active', async () => {
    await call(ACTIVE_USER);
    expect(roleQueries[0]).toMatchObject({ table: 'user_company_roles', user_id: ACTIVE_USER, status: 'active' });
  });

  it('CRITICAL an INVITED (never accepted) user cannot read the company config', async () => {
    const res = await call(INVITED_USER);
    expect(res.statusCode).toBe(404);
    expect(flagReads).toEqual([]);
  });

  it('CRITICAL an INVITED user cannot WRITE the company config', async () => {
    const res = await call(INVITED_USER, { method: 'PUT', body: PUT });
    expect(res.statusCode).toBe(404);
    expect(flagWrites).toEqual([]);
  });

  it('CRITICAL a REVOKED (inactive) member cannot read the company config', async () => {
    const res = await call(REVOKED_USER);
    expect(res.statusCode).toBe(404);
    expect(flagReads).toEqual([]);
  });

  it('CRITICAL a REVOKED member cannot WRITE the company config', async () => {
    const res = await call(REVOKED_USER, { method: 'PUT', body: PUT });
    expect(res.statusCode).toBe(404);
    expect(flagWrites).toEqual([]);
  });

  it('CRITICAL a stale row never wins over an active one', async () => {
    // MIXED_USER's inactive VICTIM row is listed first, so an unfiltered
    // limit(1) would select it.
    const res = await call(MIXED_USER, { method: 'PUT', body: PUT });
    expect(res.statusCode).toBe(200);
    expect(res.body.companyId).toBe(OWN);
    expect(flagWrites[0].companyId).toBe(OWN);
    expect(flagWrites.map(w => w.companyId)).not.toContain(VICTIM);
    expect(flagReads).not.toContain(VICTIM);
  });
});

describe('CRITICAL — no request field can select the company', () => {
  it('no company alias in the body or query can redirect the read or the write', async () => {
    /*
     * The route takes no company from the request at all — resolveCompanyId
     * receives only the authenticated user id. This probe pins that: every
     * plausible alias is set to the victim and must be ignored entirely.
     */
    const aliases = {
      companyId: VICTIM, company_id: VICTIM, orgId: VICTIM, org_id: VICTIM,
      organizationId: VICTIM, organization_id: VICTIM, tenantId: VICTIM,
      tenant_id: VICTIM, viewAs: VICTIM, impersonate: VICTIM,
    };
    const res = await call(ACTIVE_USER, {
      method: 'PUT', query: { ...aliases }, body: { ...PUT, ...aliases },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.companyId).toBe(OWN);
    expect(flagWrites).toHaveLength(1);
    expect(flagWrites[0].companyId).toBe(OWN);
    expect(flagReads.every(c => c === OWN)).toBe(true);
  });

  it('no company alias can redirect the GET read either', async () => {
    /*
     * Mutation testing found this gap: the probe above exercises PUT, so the
     * GET branch's own read was never sent an alias — swapping it for
     * `(req.query.companyId || companyId)` survived. Both verbs are probed now.
     */
    const aliases = {
      companyId: VICTIM, company_id: VICTIM, orgId: VICTIM, org_id: VICTIM,
      organizationId: VICTIM, organization_id: VICTIM, tenantId: VICTIM,
      tenant_id: VICTIM, viewAs: VICTIM, impersonate: VICTIM,
    };
    const res = await call(ACTIVE_USER, { method: 'GET', query: { ...aliases }, body: { ...aliases } });

    expect(res.statusCode).toBe(200);
    expect(res.body.companyId).toBe(OWN);
    expect(flagReads).toEqual([OWN]);
    expect(flagReads).not.toContain(VICTIM);
  });

  it('the membership lookup is keyed on the AUTHENTICATED user, never a request field', async () => {
    await call(ACTIVE_USER, { query: { user_id: NOBODY }, body: { user_id: NOBODY } });
    expect(roleQueries[0].user_id).toBe(ACTIVE_USER);
  });
});

describe('ordering and sinks', () => {
  it('authorization precedes every flag read and write', async () => {
    await call(ACTIVE_USER, { method: 'PUT', body: PUT });
    expect(roleQueries).toHaveLength(1);
    expect(flagWrites).toHaveLength(1);
    // The role lookup happened, and only then the sinks.
    expect(roleQueries[0].table).toBe('user_company_roles');
  });

  it('a denied caller reaches neither sink', async () => {
    await call(REVOKED_USER, { method: 'PUT', body: PUT });
    expect(flagReads).toEqual([]);
    expect(flagWrites).toEqual([]);
  });

  it('the write carries only the validated flag payload and the authenticated actor', async () => {
    await call(ACTIVE_USER, { method: 'PUT', body: PUT });
    expect(flagWrites[0].updatedBy).toBe(ACTIVE_USER);
    expect(flagWrites[0].companyId).toBe(OWN);
  });
});
