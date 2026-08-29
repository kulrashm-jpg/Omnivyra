/**
 * EXTERNAL-API-SEC-001 — `?scope=platform` is a scope REQUEST, not a grant.
 *
 * `/api/external-apis/[id]` computed two different things and used them
 * inconsistently:
 *
 *   platformScopeRequested = req.query.scope === 'platform'   (caller input)
 *   hasPlatformScope       = legacy session | platform admin | super admin
 *                                                            (server verdict)
 *
 * DELETE gated its `company_id` filter on the VERDICT. GET and PUT gated
 * theirs on the REQUEST. So
 *
 *     GET/PUT /api/external-apis/<id>?scope=platform&companyId=<own company>
 *
 * passed the role check against the caller's own company and then ran with no
 * company filter at all.
 *
 * Confirmed read-only against production: `external_api_sources` holds 14 rows
 * and ALL of them have `company_id IS NULL` — they are the platform-wide API
 * catalog. The tenant-scoped path matches none of them, so this flag was the
 * only way a tenant reached them: any COMPANY_ADMIN (the role that carries
 * MANAGE_EXTERNAL_APIS) could read and rewrite base_url, auth_type, headers
 * and api_key_env_name for every tenant at once.
 *
 * These tests drive the REAL route; only the auth reader, the RBAC verdicts
 * and the data layer are scripted.
 */

type Row = Record<string, unknown>;

const ATTACKER = 'user-company-a-admin';
const OWNER = 'user-platform-admin';
const MEMBER_B = 'user-company-b-member';
const COMPANY_A = 'company-a';
const COMPANY_B = 'company-b';
const PLATFORM_ROW = 'api-source-platform-1';
const TENANT_B_ROW = 'api-source-company-b';

/** id → the row's owning company (null = platform-level, as in production). */
const ROW_OWNER: Record<string, string | null> = {
  [PLATFORM_ROW]: null,
  [TENANT_B_ROW]: COMPANY_B,
};
/** userId → companies they hold a role in. */
const MEMBERSHIP: Record<string, string[]> = {
  [ATTACKER]: [COMPANY_A],
  [MEMBER_B]: [COMPANY_B],
  [OWNER]: [],
};

let authUser: string | null = ATTACKER;
let platformAdmins: string[] = [OWNER];
/** Every UPDATE/DELETE the data layer actually executed, with its filters. */
const writes: Array<{ op: string; filters: Record<string, unknown>; payload?: Row }> = [];

jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn(async () =>
    authUser ? { user: { id: authUser }, error: null } : { user: null, error: 'MISSING_AUTH' }),
}));

jest.mock('../../services/superAdminSession', () => ({
  getLegacySuperAdminSession: jest.fn(() => null),
}));

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
  isPlatformSuperAdmin: jest.fn(async (id: string) => platformAdmins.includes(id)),
  isSuperAdmin: jest.fn(async (id: string) => platformAdmins.includes(id)),
  getUserRole: jest.fn(async (id: string, companyId: string) =>
    (MEMBERSHIP[id] ?? []).includes(companyId)
      ? { role: 'COMPANY_ADMIN', error: null }
      : { role: null, error: 'COMPANY_ACCESS_DENIED' }),
  getCompanyRoleIncludingInvited: jest.fn(async () => null),
  hasPermission: jest.fn(async (role: string) => role === 'COMPANY_ADMIN' || role === 'SUPER_ADMIN'),
}));

jest.mock('../../services/externalApiService', () => ({
  validatePlatformConfig: jest.fn(() => ({ ok: true })),
  VALID_API_CATEGORIES: ['social', 'others'],
}));
jest.mock('../../auth/credentialEncryption', () => ({ encryptCredential: jest.fn((v: string) => v) }));
jest.mock('../../services/companyApiConfigCache', () => ({
  invalidateCompanyConfigCacheForApiSource: jest.fn(async () => {}),
}));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

/**
 * Scripted PostgREST. The whole point is that `.eq('company_id', …)` either
 * IS or ISN'T applied, so filters are recorded and honoured faithfully.
 */
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      let op = 'select';
      let payload: Row | undefined;
      const builder: any = {};
      builder.select = () => builder;
      builder.eq = (col: string, val: unknown) => { filters[col] = val; return builder; };
      builder.update = (p: Row) => { op = 'update'; payload = p; return builder; };
      builder.delete = () => { op = 'delete'; return builder; };
      const resolve = () => {
        if (table !== 'external_api_sources') return { data: null, error: null };
        const id = filters.id as string;
        const owner = id in ROW_OWNER ? ROW_OWNER[id] : undefined;
        if (owner === undefined) return { data: null, error: { message: 'no rows' } };
        // A company filter is applied only when the route asked for one.
        if ('company_id' in filters && filters.company_id !== owner) {
          return { data: null, error: { message: 'no rows' } };
        }
        if (op !== 'select') writes.push({ op, filters: { ...filters }, payload });
        return { data: { id, company_id: owner, name: 'catalog entry', base_url: 'https://real.example' }, error: null };
      };
      builder.single = () => Promise.resolve(resolve());
      builder.then = (r: any) => Promise.resolve(resolve()).then(r);
      return builder;
    },
  },
}));

import handler from '../../../pages/api/external-apis/[id]';

function mockRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  return res;
}

async function call(opts: {
  as: string | null; method: string; id: string;
  scope?: 'platform'; companyId?: string; body?: Row;
}) {
  authUser = opts.as;
  const query: Row = { id: opts.id };
  if (opts.scope) query.scope = opts.scope;
  if (opts.companyId) query.companyId = opts.companyId;
  const res = mockRes();
  await handler({ method: opts.method, url: `/api/external-apis/${opts.id}`, query, body: opts.body ?? {} } as never, res);
  return res;
}

beforeEach(() => {
  authUser = ATTACKER;
  platformAdmins = [OWNER];
  writes.length = 0;
  jest.spyOn(console, 'debug').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

/* ── C — the exploit: cross-scope via a caller-supplied flag ──────────── */

describe('C — a tenant admin cannot claim platform scope', () => {
  it('CRITICAL: GET of a platform row with ?scope=platform is refused', async () => {
    const res = await call({ as: ATTACKER, method: 'GET', id: PLATFORM_ROW, scope: 'platform', companyId: COMPANY_A });
    expect(res.statusCode).not.toBe(200);
    expect(res.body?.api).toBeUndefined();
  });

  it('CRITICAL: PUT of a platform row with ?scope=platform performs NO write', async () => {
    const res = await call({
      as: ATTACKER, method: 'PUT', id: PLATFORM_ROW, scope: 'platform', companyId: COMPANY_A,
      body: { name: 'pwned', base_url: 'https://attacker.example' },
    });
    expect(res.statusCode).not.toBe(200);
    // G — mutation safety: the row was never updated.
    expect(writes.filter((w) => w.op === 'update')).toEqual([]);
  });

  it('CRITICAL: cross-company PUT against ANOTHER tenant’s row performs no write', async () => {
    const res = await call({
      as: ATTACKER, method: 'PUT', id: TENANT_B_ROW, scope: 'platform', companyId: COMPANY_A,
      body: { name: 'pwned' },
    });
    expect(res.statusCode).not.toBe(200);
    expect(writes.filter((w) => w.op === 'update')).toEqual([]);
  });

  it('every attempted write still carries a company filter', async () => {
    await call({ as: ATTACKER, method: 'PUT', id: PLATFORM_ROW, scope: 'platform', companyId: COMPANY_A, body: { name: 'x' } });
    await call({ as: ATTACKER, method: 'DELETE', id: PLATFORM_ROW, scope: 'platform', companyId: COMPANY_A });
    for (const w of writes) expect(w.filters).toHaveProperty('company_id');
  });

  it('DELETE was already correct and stays correct', async () => {
    await call({ as: ATTACKER, method: 'DELETE', id: PLATFORM_ROW, scope: 'platform', companyId: COMPANY_A });
    expect(writes.filter((w) => w.op === 'delete')).toEqual([]);
  });
});

/* ── A/B — legitimate behaviour is preserved ─────────────────────────── */

describe('A/B — legitimate access is unchanged', () => {
  it('a platform admin still gets full platform scope on GET', async () => {
    const res = await call({ as: OWNER, method: 'GET', id: PLATFORM_ROW, scope: 'platform' });
    expect(res.statusCode).toBe(200);
    expect(res.body?.api?.id).toBe(PLATFORM_ROW);
  });

  it('a platform admin can still PUT a platform row', async () => {
    const res = await call({
      as: OWNER, method: 'PUT', id: PLATFORM_ROW, scope: 'platform',
      body: { name: 'renamed by admin', base_url: 'https://real.example' },
    });
    expect(res.statusCode).toBe(200);
    expect(writes.filter((w) => w.op === 'update')).toHaveLength(1);
    // The admin's write is deliberately unfiltered by company — that is the
    // whole point of platform scope, and it is now privilege-gated.
    expect(writes[0].filters).not.toHaveProperty('company_id');
  });

  it('a company member still reads their OWN company’s row', async () => {
    const res = await call({ as: MEMBER_B, method: 'GET', id: TENANT_B_ROW, companyId: COMPANY_B });
    expect(res.statusCode).toBe(200);
    expect(res.body?.api?.id).toBe(TENANT_B_ROW);
  });

  it('a company member still updates their OWN company’s row', async () => {
    const res = await call({
      as: MEMBER_B, method: 'PUT', id: TENANT_B_ROW, companyId: COMPANY_B,
      body: { name: 'ours', base_url: 'https://ours.example' },
    });
    expect(res.statusCode).toBe(200);
    expect(writes.filter((w) => w.op === 'update')).toHaveLength(1);
    expect(writes[0].filters.company_id).toBe(COMPANY_B);
  });

  it('an unprivileged caller sending the flag is DOWNGRADED, not rejected', async () => {
    // The flag is ignored; they keep ordinary company scope, so no legitimate
    // client is broken by sending it.
    const res = await call({ as: MEMBER_B, method: 'GET', id: TENANT_B_ROW, scope: 'platform', companyId: COMPANY_B });
    expect(res.statusCode).toBe(200);
    expect(res.body?.api?.id).toBe(TENANT_B_ROW);
  });
});

/* ── C (cross-company without the flag) ──────────────────────────────── */

describe('C — cross-company without the flag is still denied', () => {
  it('naming another company the caller does not belong to → 403', async () => {
    const res = await call({ as: ATTACKER, method: 'GET', id: TENANT_B_ROW, companyId: COMPANY_B });
    expect(res.statusCode).toBe(403);
    expect(res.body?.error).toBe('FORBIDDEN_ROLE');
  });

  it('and no write is attempted', async () => {
    await call({ as: ATTACKER, method: 'PUT', id: TENANT_B_ROW, companyId: COMPANY_B, body: { name: 'x' } });
    expect(writes).toEqual([]);
  });
});

/* ── D/E — authentication ─────────────────────────────────────────────── */

describe('D/E — a resource id cannot substitute for a session', () => {
  it('unauthenticated → 401, nothing read or written', async () => {
    const res = await call({ as: null, method: 'GET', id: PLATFORM_ROW, scope: 'platform', companyId: COMPANY_A });
    expect(res.statusCode).toBe(401);
    expect(writes).toEqual([]);
  });

  it('unauthenticated PUT → 401, no write', async () => {
    const res = await call({ as: null, method: 'PUT', id: PLATFORM_ROW, scope: 'platform', companyId: COMPANY_A, body: { name: 'x' } });
    expect(res.statusCode).toBe(401);
    expect(writes).toEqual([]);
  });

  it('unauthenticated DELETE → 401, no delete', async () => {
    const res = await call({ as: null, method: 'DELETE', id: PLATFORM_ROW, scope: 'platform', companyId: COMPANY_A });
    expect(res.statusCode).toBe(401);
    expect(writes).toEqual([]);
  });
});

/* ── F — nonexistent resource ─────────────────────────────────────────── */

describe('F — a nonexistent id', () => {
  it('does not succeed, and reveals no row', async () => {
    const res = await call({ as: MEMBER_B, method: 'GET', id: 'no-such-api-source', companyId: COMPANY_B });
    expect(res.statusCode).not.toBe(200);
    expect(res.body?.api).toBeUndefined();
  });

  it('a missing id and a forbidden-scope id are equally unsuccessful', async () => {
    const missing = await call({ as: MEMBER_B, method: 'GET', id: 'no-such-api-source', companyId: COMPANY_B });
    const forbidden = await call({ as: MEMBER_B, method: 'GET', id: PLATFORM_ROW, scope: 'platform', companyId: COMPANY_B });
    expect(missing.statusCode).toBe(forbidden.statusCode);
  });

  it('a missing id is rejected before any method dispatch', async () => {
    const res = await call({ as: MEMBER_B, method: 'GET', id: '' });
    expect(res.statusCode).toBe(400);
  });
});
