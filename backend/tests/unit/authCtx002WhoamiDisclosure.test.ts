/**
 * AUTH-CTX-002 — GET /api/debug/whoami.
 *
 * The audit found NO defect. This suite is characterization: it pins the
 * contract that makes the route safe, so a later edit cannot quietly turn a
 * diagnostic into a disclosure.
 *
 * Why it is safe, and what is therefore pinned below:
 *
 *   1. The route reads NO caller input. There is no user id, company id or
 *      selector to supply — `ctx.userId` is the only thing that reaches the
 *      query, and it is derived from a token validated by
 *      `supabase.auth.getUser` (authResolver: "NO dev / JWT-claims fallback").
 *      So a caller can only ever read their OWN membership rows.
 *   2. Unauthenticated callers are answered with an INVARIANT empty payload.
 *      That is the correct diagnostic answer to "who does the server think I
 *      am?" — nobody — and it discloses nothing about the system.
 *   3. Only booleans about the caller's own request are echoed. The cookie and
 *      Authorization VALUES are never returned.
 *   4. The membership query's PostgREST error is swallowed, so no internal
 *      detail reaches the response.
 *
 * The real `resolveUserContext` runs in every test here — only the auth seam
 * beneath it (`getSupabaseUserFromRequest`) is mocked. That way AUTH-CTX-001's
 * own logic, including `unauthenticatedContext` and the dev opt-in gate, is
 * exercised rather than simulated.
 */

const ORDINARY = '11111111-1111-1111-1111-111111111111';
const ADMIN = '22222222-2222-2222-2222-222222222222';
const SUPER = '33333333-3333-3333-3333-333333333333';
const VICTIM = '99999999-9999-9999-9999-999999999999';
const COMPANY_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const COMPANY_V = 'vvvvvvvv-vvvv-vvvv-vvvv-vvvvvvvvvvvv';

/** Every membership row in the "database", across several tenants. */
const ROLE_ROWS = [
  { user_id: ORDINARY, company_id: COMPANY_A, role: 'CONTENT_CREATOR', status: 'active' },
  { user_id: ADMIN, company_id: COMPANY_A, role: 'COMPANY_ADMIN', status: 'active' },
  { user_id: SUPER, company_id: COMPANY_A, role: 'SUPER_ADMIN', status: 'active' },
  // A different tenant entirely — must never appear for anyone above.
  { user_id: VICTIM, company_id: COMPANY_V, role: 'COMPANY_ADMIN', status: 'active' },
];

/** null = no/invalid token. Otherwise the id the auth layer proves. */
let authUser: string | null = ORDINARY;
let authError: string | null = null;

/**
 * Every user_id the service-role client was asked about.
 *
 * NOTE: an AUTHENTICATED request produces TWO entries — `resolveUserContext`
 * reads user_company_roles to build the context, and the route then reads the
 * same table again to display the raw rows. That duplicate read is the point
 * of the endpoint (it shows the rows the context was derived from, so a
 * discrepancy is visible), and both reads use the same server-derived id. The
 * invariant that matters is not HOW MANY reads happen but that EVERY one of
 * them is scoped to the caller themself.
 */
const queriedUserIds: unknown[] = [];

/** Every membership read on this request was scoped to `expected`, and only it. */
function assertOnlyQueried(expected: string) {
  expect(queriedUserIds.length).toBeGreaterThan(0);
  expect([...new Set(queriedUserIds)]).toEqual([expected]);
}

jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn(async () =>
    authUser
      ? { user: { id: authUser, email: 'u@example.com', emailVerified: true }, error: null }
      : { user: null, error: authError ?? 'MISSING_AUTH' }
  ),
}));

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const b: any = {};
      let wanted: unknown;
      b.select = () => b;
      b.eq = (col: string, v: unknown) => {
        if (col === 'user_id') { queriedUserIds.push(v); wanted = v; }
        return b;
      };
      const resolve = () => {
        if (table !== 'user_company_roles') return { data: null, error: null };
        // user_id is `uuid`; PostgREST rejects '' with 22P02 rather than
        // matching every row. The route must survive that as an empty list.
        if (typeof wanted !== 'string' || wanted === '') {
          return { data: null, error: { code: '22P02', message: 'invalid input syntax for type uuid: ""' } };
        }
        return {
          data: ROLE_ROWS.filter(r => r.user_id === wanted)
            .map(({ company_id, role, status }) => ({ company_id, role, status })),
          error: null,
        };
      };
      b.then = (r: any) => Promise.resolve(resolve()).then(r);
      return b;
    },
  },
}));

jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import handler from '../../../pages/api/debug/whoami';

function mockRes() {
  const res: any = { statusCode: 0, body: undefined, headers: {} as Record<string, string> };
  res.setHeader = (k: string, v: string) => { res.headers[k.toLowerCase()] = v; return res; };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  return res;
}

async function whoami(as: string | null, opts: { query?: Record<string, unknown>; headers?: Record<string, string>; method?: string; error?: string } = {}) {
  authUser = as;
  authError = opts.error ?? null;
  const res = mockRes();
  await handler({
    method: opts.method ?? 'GET',
    url: '/api/debug/whoami',
    query: opts.query ?? {},
    headers: opts.headers ?? {},
    body: {},
  } as never, res);
  return res;
}

/** Every field the route is allowed to return. Anything else is a new leak. */
const ALLOWED_FIELDS = [
  'resolved_user_id', 'role', 'company_ids_known', 'default_company_id',
  'membership_type', 'user_company_roles_for_this_user',
  'request_cookies_present', 'request_authorization_header_present',
];

/** Serialize the payload and prove no other tenant/user appears anywhere in it. */
function assertNoForeignPrincipal(body: unknown) {
  const blob = JSON.stringify(body ?? {});
  expect(blob).not.toContain(VICTIM);
  expect(blob).not.toContain(COMPANY_V);
}

beforeEach(() => {
  authUser = ORDINARY;
  authError = null;
  queriedUserIds.length = 0;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

/* ── A — unauthenticated ──────────────────────────────────────────────── */

describe('A — unauthenticated', () => {
  it('returns an INVARIANT empty payload — no identity, no tenant', async () => {
    const res = await whoami(null);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      resolved_user_id: '',
      role: 'user',
      company_ids_known: [],
      default_company_id: '',
      membership_type: undefined,
      user_company_roles_for_this_user: [],
      request_cookies_present: false,
      request_authorization_header_present: false,
    });
  });

  it('CRITICAL: no membership row of ANY user is returned', async () => {
    const res = await whoami(null);
    expect(res.body.user_company_roles_for_this_user).toEqual([]);
    assertNoForeignPrincipal(res.body);
  });

  it('the empty userId reaches the query but matches nothing', async () => {
    // AUTH-CTX-001 makes ctx.userId '' rather than a synthetic id. The uuid
    // column rejects it, so the service-role read cannot degrade into an
    // unfiltered scan of user_company_roles.
    const res = await whoami(null);
    expect(queriedUserIds).toEqual(['']);
    expect(res.body.user_company_roles_for_this_user).toEqual([]);
  });

  it('the response is identical whatever the caller sends', async () => {
    const bare = (await whoami(null)).body;
    const noisy = (await whoami(null, {
      query: { userId: VICTIM, user_id: VICTIM, companyId: COMPANY_V, as: 'admin', role: 'SUPER_ADMIN' },
    })).body;
    expect({ ...noisy }).toEqual({ ...bare });
  });
});

/* ── B — authenticated ordinary user ──────────────────────────────────── */

describe('B — authenticated ordinary user', () => {
  it('sees their OWN identity and memberships only', async () => {
    const res = await whoami(ORDINARY);
    expect(res.statusCode).toBe(200);
    expect(res.body.resolved_user_id).toBe(ORDINARY);
    expect(res.body.company_ids_known).toEqual([COMPANY_A]);
    expect(res.body.user_company_roles_for_this_user).toEqual([
      { company_id: COMPANY_A, role: 'CONTENT_CREATOR', status: 'active' },
    ]);
    assertNoForeignPrincipal(res.body);
  });

  it('is not reported as an admin', async () => {
    const res = await whoami(ORDINARY);
    expect(res.body.role).toBe('user');
  });

  it('returns no field beyond the documented set', async () => {
    const res = await whoami(ORDINARY);
    expect(Object.keys(res.body).sort()).toEqual([...ALLOWED_FIELDS].sort());
  });

  it('CRITICAL: no authentication material is echoed back', async () => {
    const res = await whoami(ORDINARY, {
      headers: { cookie: 'sb-access-token=super-secret-value', authorization: 'Bearer super-secret-jwt' },
    });
    const blob = JSON.stringify(res.body);
    expect(blob).not.toContain('super-secret-value');
    expect(blob).not.toContain('super-secret-jwt');
    expect(blob).not.toContain('Bearer');
    // Only the booleans, which describe the caller's own request.
    expect(res.body.request_cookies_present).toBe(true);
    expect(res.body.request_authorization_header_present).toBe(true);
  });
});

/* ── C — company admin ────────────────────────────────────────────────── */

describe('C — authenticated company admin', () => {
  it('sees their own admin role, and still only their own tenant', async () => {
    const res = await whoami(ADMIN);
    expect(res.body.resolved_user_id).toBe(ADMIN);
    expect(res.body.role).toBe('admin');
    expect(res.body.company_ids_known).toEqual([COMPANY_A]);
    assertNoForeignPrincipal(res.body);
  });

  it('being an admin grants no wider read', async () => {
    const ordinary = (await whoami(ORDINARY)).body;
    const admin = (await whoami(ADMIN)).body;
    expect(admin.user_company_roles_for_this_user).toHaveLength(
      ordinary.user_company_roles_for_this_user.length
    );
  });
});

/* ── D — super admin ──────────────────────────────────────────────────── */

describe('D — platform/super admin', () => {
  it('CRITICAL: a super admin still sees ONLY their own rows', async () => {
    // The query predicate is ctx.userId, not a privilege check. Elevation
    // does not widen it — this route has no privileged mode.
    const res = await whoami(SUPER);
    expect(res.body.resolved_user_id).toBe(SUPER);
    expect(res.body.user_company_roles_for_this_user).toEqual([
      { company_id: COMPANY_A, role: 'SUPER_ADMIN', status: 'active' },
    ]);
    assertNoForeignPrincipal(res.body);
    assertOnlyQueried(SUPER);
  });
});

/* ── E — cross-user / cross-company ───────────────────────────────────── */

describe('E — no selector exists to abuse', () => {
  it('CRITICAL: query parameters never change whose identity is inspected', async () => {
    const res = await whoami(ORDINARY, {
      query: { userId: VICTIM, user_id: VICTIM, id: VICTIM, companyId: COMPANY_V, impersonate: VICTIM },
    });
    expect(res.body.resolved_user_id).toBe(ORDINARY);
    assertOnlyQueried(ORDINARY);
    assertNoForeignPrincipal(res.body);
  });

  it('CRITICAL: a forged identity header is ignored — only the proven token counts', async () => {
    const res = await whoami(ORDINARY, {
      headers: { 'x-user-id': VICTIM, 'x-company-id': COMPANY_V, 'x-role': 'SUPER_ADMIN' },
    });
    expect(res.body.resolved_user_id).toBe(ORDINARY);
    expect(res.body.role).toBe('user');
    assertNoForeignPrincipal(res.body);
  });

  it('CRITICAL: every membership read is scoped to the caller, never a named id', async () => {
    await whoami(ORDINARY, { query: { userId: VICTIM } });
    assertOnlyQueried(ORDINARY);
    expect(queriedUserIds).not.toContain(VICTIM);
  });
});

/* ── F — malformed / invalid authentication ───────────────────────────── */

describe('F — malformed and revoked authentication', () => {
  it.each([
    ['MISSING_AUTH'], ['INVALID_AUTH'], ['SESSION_REVOKED'],
    ['ACCOUNT_DELETED'], ['ACCOUNT_SUSPENDED'], ['ACCOUNT_INVITED'],
  ])('%s yields the empty payload, never another user', async (err) => {
    const res = await whoami(null, { error: err });
    expect(res.statusCode).toBe(200);
    expect(res.body.resolved_user_id).toBe('');
    expect(res.body.company_ids_known).toEqual([]);
    expect(res.body.user_company_roles_for_this_user).toEqual([]);
    assertNoForeignPrincipal(res.body);
  });

  it('CRITICAL: the auth failure REASON is not disclosed', async () => {
    // AUTH-CTX-001 carries authError on the context for server-side use. This
    // route must not surface it — the distinction between "revoked",
    // "suspended" and "deleted" is an account-state oracle.
    const res = await whoami(null, { error: 'ACCOUNT_SUSPENDED' });
    const blob = JSON.stringify(res.body);
    expect(blob).not.toContain('ACCOUNT_SUSPENDED');
    expect(blob).not.toContain('authError');
    expect(res.body.authError).toBeUndefined();
    expect(res.body.authenticated).toBeUndefined();
  });

  it('the reason cannot be inferred by comparing responses', async () => {
    const suspended = (await whoami(null, { error: 'ACCOUNT_SUSPENDED' })).body;
    const missing = (await whoami(null, { error: 'MISSING_AUTH' })).body;
    expect({ ...suspended }).toEqual({ ...missing });
  });

  it('the DEV synthetic identity does not appear (production has no DEV_USER_ID)', async () => {
    // The pre-AUTH-CTX-001 fallback returned 'dev-user' holding an arbitrary
    // real tenant. devIdentityOptIn() requires DEV_USER_ID AND a non-production
    // build; neither test nor production satisfies it.
    const res = await whoami(null);
    expect(res.body.resolved_user_id).toBe('');
    expect(res.body.resolved_user_id).not.toBe('dev-user');
    expect(res.body.company_ids_known).toEqual([]);
  });
});

/* ── G — error path ───────────────────────────────────────────────────── */

describe('G — error handling leaks nothing', () => {
  it('the PostgREST error is swallowed, not returned', async () => {
    const res = await whoami(null); // forces the 22P02 path
    const blob = JSON.stringify(res.body);
    expect(blob).not.toContain('22P02');
    expect(blob).not.toContain('invalid input syntax');
    expect(res.body.error).toBeUndefined();
  });

  it('no stack trace, table name or connection detail is exposed', async () => {
    const blob = JSON.stringify((await whoami(null)).body);
    for (const marker of ['at Object.', '.ts:', 'supabase', 'postgres', 'service_role', 'SUPABASE']) {
      expect(blob).not.toContain(marker);
    }
  });
});

/* ── side effects ─────────────────────────────────────────────────────── */

describe('the route is read-only', () => {
  it('a non-GET verb is refused before any identity work', async () => {
    const res = await whoami(ORDINARY, { method: 'POST' });
    expect(res.statusCode).toBe(405);
    expect(res.headers.allow).toBe('GET');
    expect(queriedUserIds).toEqual([]);
  });

  it('every read is scoped to the caller and nothing is written', async () => {
    await whoami(ORDINARY);
    assertOnlyQueried(ORDINARY);
  });
});
