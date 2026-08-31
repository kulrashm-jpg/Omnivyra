/**
 * COMMAND-CENTER-COMPANY-STATE-SEC-001 — pages/api/command-center/company-state.
 *
 * A GET-only, read-only route with an INLINE membership check rather than an
 * approved primitive, which is why it is still in the tenant-authz baseline. It
 * had no tests at all.
 *
 * SECURITY VERDICT: CLEAN, and for a stronger reason than usual.
 *
 *   1. The route proves membership for `companyId` (user_company_roles, user +
 *      company + status='active') BEFORE any data read, and then uses THAT SAME
 *      variable as the predicate of all four reads. There is no second
 *      identifier anywhere in the file, so "authorize A, operate on B" is not
 *      expressible — the value proven is literally the value used.
 *
 *   2. It performs no writes at all.
 *
 * These tests assert the predicate that actually reached each read, and that the
 * membership lookup precedes every one of them.
 *
 * A note the reader will want, established against production read-only:
 * the route builds its client with getSupabaseBrowser(), which is the ANON-key
 * browser client ("Frontend / client components only", per its own docstring).
 * RLS is ON for all five tables it touches, and only `reports` has a
 * non-service_role SELECT policy. Querying production as the anon role returns
 * ZERO rows from user_company_roles, blogs, companies, social_accounts and
 * reports. So in production `roleData` is always null and this route answers 403
 * to every caller — it is fail-CLOSED. That is a functional defect, not a
 * security one, and it is deliberately NOT fixed here: this task's contract is
 * to change no runtime code unless a security defect is demonstrated. The tests
 * below therefore pin the authorization contract the code expresses, with a
 * service-role-shaped client, which is what the route would need to function.
 */

export {};

const MEMBER = 'aaaaaaaa-0000-0000-0000-0000000000aa';
const STALE = 'dddddddd-0000-0000-0000-0000000000dd';
const SUPERADMIN = 'cccccccc-0000-0000-0000-0000000000cc';
const NOBODY = 'eeeeeeee-0000-0000-0000-0000000000ee';

const COMPANY_A = 'a0000000-0000-0000-0000-00000000000a';
const VICTIM = 'b0000000-0000-0000-0000-00000000000b';

const ROLES = [
  { id: 'r1', user_id: MEMBER, company_id: COMPANY_A, status: 'active' },
  { id: 'r2', user_id: STALE, company_id: COMPANY_A, status: 'inactive' },
  { id: 'r3', user_id: SUPERADMIN, company_id: COMPANY_A, status: 'active', role: 'SUPER_ADMIN' },
];

/** Canary rows for the victim: if any reaches a response, the test fails loudly. */
const BLOGS = [
  { id: 'b-own', created_by: MEMBER, company_id: COMPANY_A, content_type: 'blog' },
  { id: 'VICTIM_BLOG', created_by: NOBODY, company_id: VICTIM, content_type: 'blog' },
];
const COMPANIES = [
  { id: COMPANY_A, website: 'https://own.example' },
  { id: VICTIM, website: 'https://VICTIM-SECRET.example' },
];
const SOCIAL = [
  { id: 's-own', company_id: COMPANY_A, is_active: true, platform: 'x' },
  { id: 'VICTIM_SOCIAL', company_id: VICTIM, is_active: true, platform: 'linkedin' },
];
const REPORTS = [
  { id: 'rep-own', company_id: COMPANY_A, created_at: '2026-01-01', status: 'complete' },
  { id: 'VICTIM_REPORT', company_id: VICTIM, created_at: '2026-02-02', status: 'generating' },
];

let authUser: string | null = MEMBER;

/** Every query, in order, with the predicates it carried. */
const queries: Array<{ table: string; filters: Record<string, unknown> }> = [];
const writes: Array<{ table: string; op: string }> = [];

jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn(async () =>
    authUser ? { user: { id: authUser }, error: null } : { user: null, error: 'NO_AUTH' }),
}));

/*
 * COMMAND-CENTER-CLIENT-CORRECTNESS-001 — the mock seam moved, the contract did
 * not. The route now imports the canonical service-role client
 * (backend/db/supabaseClient) instead of the anon-key browser client, so the
 * mock targets that module. Every assertion below is unchanged: the builder,
 * the fixtures, the canaries and the expectations are identical to the version
 * certified by COMMAND-CENTER-COMPANY-STATE-SEC-001. Only the module being
 * intercepted differs.
 *
 * This matters more than before, not less: the service-role client bypasses
 * RLS, so the membership gate these tests pin is now the ENTIRE boundary.
 */
jest.mock('../../db/supabaseClient', () => {
  const build = (table: string) => {
    const filters: Record<string, unknown> = {};
    const b: any = {};
    b.select = () => b;
    b.eq = (c: string, v: unknown) => { filters[c] = v; return b; };
    b.order = () => b;
    b.limit = () => b;
    for (const op of ['insert', 'update', 'upsert', 'delete']) {
      b[op] = () => { writes.push({ table, op }); return b; };
    }
    const rows = (): any[] => {
      queries.push({ table, filters: { ...filters } });
      const src: Record<string, any[]> = {
        user_company_roles: ROLES, blogs: BLOGS, companies: COMPANIES,
        social_accounts: SOCIAL, reports: REPORTS,
      };
      return (src[table] ?? []).filter((r) =>
        Object.entries(filters).every(([k, v]) => r[k] === v));
    };
    // Resolve ONCE per query: rows() records the query, so calling it twice
    // (for data and again for count) would log each list read twice.
    b.maybeSingle = () => Promise.resolve({ data: rows()[0] ?? null, error: null });
    b.then = (fn: any) => {
      const r = rows();
      return Promise.resolve({ data: r, error: null, count: r.length }).then(fn);
    };
    return b;
  };
  return { supabase: { from: (t: string) => build(t) } };
});

const route = require('../../../pages/api/command-center/company-state').default;

function mockRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.end = () => res;
  res.setHeader = () => res;
  return res;
}

async function call(user: string | null, query: any = {}, method = 'GET') {
  authUser = user;
  queries.length = 0; writes.length = 0;
  const res = mockRes();
  await route({ method, url: '/x', headers: {}, query, body: {} } as never, res);
  return res;
}

/** Reads of tenant data — i.e. everything except the membership lookup itself. */
const dataReads = () => queries.filter(q => q.table !== 'user_company_roles');
const dump = (res: any) => JSON.stringify(res.body ?? {});

/* ────────────────────────────────────────────────────────────────────────────
 * COMMAND-CENTER-CLIENT-CORRECTNESS-001 — the client-selection boundary.
 *
 * The outage was not a logic bug; it was the wrong CLIENT. The route used the
 * anon-key browser client, RLS returned zero rows from user_company_roles, the
 * membership lookup came back null, and every legitimate member received 403.
 *
 * A behavioural test cannot distinguish the two clients — both are mocked at
 * the module boundary — so the regression is pinned STATICALLY against the
 * route source. This is the assertion that fails if somebody restores
 * getSupabaseBrowser() to this file.
 * ──────────────────────────────────────────────────────────────────────────── */
describe('client selection — the outage regression', () => {
  const fs = require('fs');
  const path = require('path');
  const RAW = fs.readFileSync(
    path.resolve(__dirname, '../../../pages/api/command-center/company-state.ts'), 'utf8');

  /*
   * Assert against CODE, not prose. The route's header comment explains the
   * outage and necessarily names getSupabaseBrowser(), so a raw text match
   * would fail on the very comment that documents the fix.
   */
  const SRC = RAW.split('\n')
    .filter((l: string) => {
      const t = l.trim();
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
    })
    .join('\n');

  it('CRITICAL the route does NOT use the anon-key browser client', () => {
    expect(SRC).not.toMatch(/getSupabaseBrowser/);
    expect(SRC).not.toMatch(/lib\/supabaseBrowser/);
  });

  it('CRITICAL the route uses the canonical service-role client', () => {
    expect(SRC).toMatch(/import\s*\{\s*supabase\s*\}\s*from\s*'[^']*backend\/db\/supabaseClient'/);
  });

  it('the membership gate is still present in the source, before the data reads', () => {
    // With RLS bypassed, this gate is the entire boundary — so its presence and
    // its position are both part of the regression contract.
    const gate = SRC.indexOf("from('user_company_roles')");
    const firstDataRead = Math.min(
      ...["from('blogs')", "from('companies')", "from('social_accounts')", "from('reports')"]
        .map((t) => { const i = SRC.indexOf(t); return i === -1 ? Number.MAX_SAFE_INTEGER : i; }));
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(firstDataRead);
    expect(SRC).toMatch(/\.eq\('status',\s*'active'\)/);
  });
});

describe('authorization matrix', () => {
  it('unauthenticated is refused before any query', async () => {
    const res = await call(null, { company_id: COMPANY_A });
    expect(res.statusCode).toBe(401);
    expect(queries).toEqual([]);
  });

  it('a missing company_id is rejected before any query', async () => {
    const res = await call(MEMBER, {});
    expect(res.statusCode).toBe(400);
    expect(queries).toEqual([]);
  });

  it('a member reads their own company', async () => {
    const res = await call(MEMBER, { company_id: COMPANY_A });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.blogCount).toBe(1);
    expect(res.body.data.hasWebsiteUrl).toBe(true);
  });

  it('CRITICAL a foreign company is refused and reaches NO data read', async () => {
    const res = await call(MEMBER, { company_id: VICTIM });
    expect(res.statusCode).toBe(403);
    expect(dataReads()).toEqual([]);
    expect(dump(res)).not.toContain('VICTIM');
  });

  it('CRITICAL a stale (inactive) membership is refused and reaches no data read', async () => {
    const res = await call(STALE, { company_id: COMPANY_A });
    expect(res.statusCode).toBe(403);
    expect(dataReads()).toEqual([]);
  });

  it('a caller with no memberships is refused', async () => {
    const res = await call(NOBODY, { company_id: COMPANY_A });
    expect(res.statusCode).toBe(403);
    expect(dataReads()).toEqual([]);
  });

  it('a malformed company id is refused safely', async () => {
    const res = await call(MEMBER, { company_id: "x' OR 1=1--" });
    expect(res.statusCode).toBe(403);
    expect(dataReads()).toEqual([]);
  });

  it('a SUPER_ADMIN gets NO bypass — membership is still required', async () => {
    /*
     * Deliberately pinned: this route has no super-admin branch at all, which
     * makes it STRICTER than the platform primitives (isPlatformSuperAdmin
     * treats any SUPER_ADMIN role row as platform-wide). A super admin without
     * an active membership in the requested company is refused here.
     */
    const res = await call(SUPERADMIN, { company_id: VICTIM });
    expect(res.statusCode).toBe(403);
    expect(dataReads()).toEqual([]);
  });

  it('a non-GET verb reaches nothing', async () => {
    const res = await call(MEMBER, { company_id: COMPANY_A }, 'POST');
    expect(res.statusCode).toBe(405);
    expect(queries).toEqual([]);
  });
});

describe('CRITICAL — the authorized company is the operative company', () => {
  it('the membership lookup is scoped by user, company AND active status', async () => {
    await call(MEMBER, { company_id: COMPANY_A });
    expect(queries[0]).toMatchObject({
      table: 'user_company_roles',
      filters: { user_id: MEMBER, company_id: COMPANY_A, status: 'active' },
    });
  });

  it('the membership lookup precedes every data read', async () => {
    await call(MEMBER, { company_id: COMPANY_A });
    expect(queries[0].table).toBe('user_company_roles');
    expect(queries.length).toBeGreaterThan(1);
  });

  it('EVERY data read carries the authorized company predicate', async () => {
    await call(MEMBER, { company_id: COMPANY_A });
    const reads = dataReads();
    expect(reads.map(r => r.table).sort()).toEqual(['blogs', 'companies', 'reports', 'social_accounts']);
    for (const r of reads) {
      const company = r.table === 'companies' ? r.filters.id : r.filters.company_id;
      expect(company).toBe(COMPANY_A);
    }
  });

  it('CRITICAL no other request field can redirect a data read', async () => {
    /*
     * Generic override probe. Mutation testing found the gap: swapping a read's
     * predicate for `(req.query.other || companyId)` survived, because no test
     * sent a second identifier — so the fallback always resolved to the right
     * company and the mutation was invisible. Every plausible alias is now set
     * to the victim alongside a legitimate company_id, so a future edit is
     * caught whichever field name it reaches for.
     */
    const res = await call(MEMBER, {
      company_id: COMPANY_A,
      other: VICTIM, companyId: VICTIM, company: VICTIM, org_id: VICTIM,
      organization_id: VICTIM, id: VICTIM, target: VICTIM, viewAs: VICTIM,
    });

    expect(res.statusCode).toBe(200);
    for (const r of dataReads()) {
      const company = r.table === 'companies' ? r.filters.id : r.filters.company_id;
      expect(company).toBe(COMPANY_A);
    }
    const body = dump(res);
    for (const canary of ['VICTIM_BLOG', 'VICTIM_SECRET', 'VICTIM_SOCIAL', 'VICTIM_REPORT']) {
      expect(body).not.toContain(canary);
    }
    // The victim's counts must not leak through the aggregate flags either.
    expect(res.body.data.blogCount).toBe(1);
    expect(res.body.data.socialIntegrationCount).toBe(1);
    expect(res.body.data.hasWebsiteUrl).toBe(true);
  });

  it('the blogs read is additionally scoped to the calling user', async () => {
    await call(MEMBER, { company_id: COMPANY_A });
    const blogs = dataReads().find(r => r.table === 'blogs');
    expect(blogs?.filters).toMatchObject({ created_by: MEMBER, company_id: COMPANY_A, content_type: 'blog' });
  });

  it('no victim data appears in a successful response', async () => {
    const res = await call(MEMBER, { company_id: COMPANY_A });
    const body = dump(res);
    for (const canary of ['VICTIM_BLOG', 'VICTIM_SECRET', 'VICTIM_SOCIAL', 'VICTIM_REPORT']) {
      expect(body).not.toContain(canary);
    }
    expect(res.body.data.socialIntegrationCount).toBe(1);
  });

  it('the route performs no writes on any path', async () => {
    await call(MEMBER, { company_id: COMPANY_A });
    expect(writes).toEqual([]);
    await call(MEMBER, { company_id: VICTIM });
    expect(writes).toEqual([]);
    await call(null, { company_id: COMPANY_A });
    expect(writes).toEqual([]);
  });

  it('the response exposes no internal identifiers', async () => {
    const res = await call(MEMBER, { company_id: COMPANY_A });
    expect(Object.keys(res.body.data).sort()).toEqual([
      'blogCount', 'hasBlogsCreated', 'hasReportGenerated', 'hasReportGenerating',
      'hasSocialLinked', 'hasWebsiteUrl', 'lastReportAt', 'socialIntegrationCount',
    ]);
  });
});
