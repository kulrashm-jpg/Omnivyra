/**
 * CONSOLIDATED-AUTH-SECURITY-AUDIT-001 — the remaining AUTH-CTX-001 blast radius.
 *
 * Four routes audited in one pass. One defect, three clean:
 *
 *   pages/api/debug/bolt-state.ts            CONFIRMED DEFECT → route removed
 *   pages/api/recommendations/[id]/result.ts NOT A DEFECT     → contract pinned
 *   pages/api/recommendations/[id]/status.ts NOT A DEFECT     → contract pinned
 *   pages/api/trends/fetch.ts                NOT A DEFECT     → contract pinned
 *
 * `bolt-state` matched this programme's recurring pattern exactly, minus even
 * the pretence of a gate: NO authentication, a caller-controlled `companyId`
 * used directly as the tenant predicate, and service-role reads that bypass
 * RLS. Any anonymous caller who knew a company uuid could read that tenant's
 * campaign plans and scheduled-post content. It had zero callers in the repo
 * and its own docblock said to remove it, so the route was deleted rather than
 * gated — deleting the surface beats guarding a diagnostic nobody invokes.
 *
 * The other three are pinned as characterization (the AUTH-CTX-002 model):
 * their runtime code is untouched, and these tests exist so the property that
 * makes each safe cannot be edited away silently.
 */

import fs from 'fs';
import path from 'path';

const REPO = path.resolve(__dirname, '../../..');

/* ────────────────────────────────────────────────────────────────────────
 * 1. debug/bolt-state — CONFIRMED DEFECT, route removed
 * ──────────────────────────────────────────────────────────────────────── */

describe('debug/bolt-state — the unauthenticated cross-tenant reader is gone', () => {
  const ROUTE = path.join(REPO, 'pages/api/debug/bolt-state.ts');

  it('CRITICAL: the route file no longer exists', () => {
    expect(fs.existsSync(ROUTE)).toBe(false);
  });

  it('CRITICAL: no route answers /api/debug/bolt-state', () => {
    const dir = path.join(REPO, 'pages/api/debug');
    const remaining = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    expect(remaining).not.toContain('bolt-state.ts');
    expect(remaining).not.toContain('bolt-state.js');
  });

  it('it is no longer grandfathered in the tenant-authz baseline', () => {
    // HARDEN-007 baselines routes that read tenant data without an approved
    // authorization call. Deleting the route without clearing the entry would
    // leave the gate permanently slack for a path that no longer exists.
    const baseline = JSON.parse(
      fs.readFileSync(path.join(REPO, 'scripts/tenant-authz-baseline.json'), 'utf8')
    );
    expect(baseline.grandfathered).not.toContain('pages/api/debug/bolt-state.ts');
  });

  it('nothing in the repository still calls it', () => {
    // Establishing zero callers is what made deletion the safe fix rather than
    // a breaking change. If a caller is ever added back, this fails loudly.
    const hits: string[] = [];
    const skip = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'coverage']);
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (skip.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.(ts|tsx|js|jsx)$/.test(entry.name)) continue;
        if (full === __filename) continue;
        if (fs.readFileSync(full, 'utf8').includes('debug/bolt-state')) {
          hits.push(path.relative(REPO, full));
        }
      }
    };
    walk(path.join(REPO, 'pages'));
    walk(path.join(REPO, 'components'));
    walk(path.join(REPO, 'backend'));
    walk(path.join(REPO, 'lib'));
    expect(hits).toEqual([]);
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * 2/3. recommendations result + status — NOT A DEFECT, contract pinned
 * ──────────────────────────────────────────────────────────────────────── */

const OWNER = 'aaaaaaaa-0000-0000-0000-00000000000a';
const OUTSIDER = 'bbbbbbbb-0000-0000-0000-00000000000b';
const SUPERADMIN = 'cccccccc-0000-0000-0000-00000000000c';
const COMPANY_A = 'a0000000-0000-0000-0000-0000000000aa';
const COMPANY_B = 'b0000000-0000-0000-0000-0000000000bb';
const JOB_B = 'job00000-0000-0000-0000-0000000000bb';

/** The job belongs to COMPANY_B. OWNER is in COMPANY_A and must never see it. */
const JOBS = [
  {
    id: JOB_B, company_id: COMPANY_B, status: 'COMPLETED',
    regions: ['EU'], created_at: '2026-01-01', updated_at: '2026-01-02',
  },
];

let principal: string | null = OWNER;
let superAdmins: string[] = [SUPERADMIN];

/** Every predicate the job query actually applied. */
let jobFilters: { id?: unknown; companyIds?: unknown } = {};
/** Tables read after the job lookup, with their predicate. */
const downstreamReads: Array<{ table: string; jobId: unknown }> = [];

jest.mock('../../services/userContextService', () => ({
  resolveUserContext: jest.fn(async () => {
    if (principal === null) {
      return { userId: '', role: 'user', companyIds: [], defaultCompanyId: '', authenticated: false, authError: 'MISSING_AUTH' };
    }
    return {
      userId: principal, role: 'user',
      companyIds: [COMPANY_A], defaultCompanyId: COMPANY_A,
      authenticated: true, authError: null,
    };
  }),
}));

jest.mock('../../services/rbacService', () => ({
  isSuperAdmin: jest.fn(async (id: string) => superAdmins.includes(id)),
}));

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const b: any = {};
      const f: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = (c: string, v: unknown) => { f[c] = v; return b; };
      b.in = (c: string, v: unknown) => { f[c] = v; return b; };
      b.order = () => b;
      const resolve = () => {
        if (table === 'recommendation_jobs') {
          jobFilters = { id: f.id, companyIds: f.company_id };
          let rows = JOBS.filter(j => j.id === f.id);
          // The route only applies .in('company_id', …) for non-admins; when it
          // does, honour it exactly so a missing predicate is visible.
          if (f.company_id !== undefined) {
            const ids = f.company_id as string[];
            rows = rows.filter(j => ids.includes(j.company_id));
          }
          return { data: rows[0] ?? null, error: null };
        }
        downstreamReads.push({ table, jobId: f.job_id });
        if (table === 'recommendation_analysis') {
          return { data: { job_id: f.job_id, consolidated_recommendation_json: { secret: 'COMPANY_B_STRATEGY' }, divergence_score: 1, disclaimer_text: 'd', confidence_score: 2 }, error: null };
        }
        return { data: [{ id: 's1', region_code: 'EU', api_id: 'api1', status: 'SUCCESS', created_at: '2026-01-01' }], error: null };
      };
      b.maybeSingle = () => Promise.resolve(resolve());
      b.single = () => Promise.resolve(resolve());
      b.then = (r: any) => Promise.resolve(resolve()).then(r);
      return b;
    },
  },
}));

jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import resultHandler from '../../../pages/api/recommendations/[id]/result';
import statusHandler from '../../../pages/api/recommendations/[id]/status';

function mockRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  return res;
}

async function call(h: any, as: string | null, query: Record<string, unknown>, method = 'GET') {
  principal = as;
  const res = mockRes();
  await h({ method, url: '/api/recommendations/x', query, headers: {}, body: {} } as never, res);
  return res;
}

beforeEach(() => {
  principal = OWNER;
  superAdmins = [SUPERADMIN];
  jobFilters = {};
  downstreamReads.length = 0;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe.each([
  ['result', () => resultHandler],
  ['status', () => statusHandler],
])('recommendations/[id]/%s — tenant scoping holds', (name, getHandler) => {
  it('CRITICAL: an unauthenticated caller gets 404 and reaches no job', async () => {
    const res = await call(getHandler(), null, { id: JOB_B });
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Job not found' });
    // AUTH-CTX-001 makes userId '' → the route returns before querying at all.
    expect(jobFilters).toEqual({});
    expect(downstreamReads).toEqual([]);
  });

  it('CRITICAL: a member of another company cannot read the job', async () => {
    // OWNER is in COMPANY_A; the job belongs to COMPANY_B.
    const res = await call(getHandler(), OWNER, { id: JOB_B });
    expect(res.statusCode).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('COMPANY_B_STRATEGY');
    expect(downstreamReads).toEqual([]);
  });

  it('CRITICAL: the job query carries the caller’s company predicate', async () => {
    // This is the property that makes the route safe: the resource is NOT
    // looked up by id alone. Losing .in('company_id', …) is the exact bug
    // class EXTERNAL-API-REQUEST-SEC-001 found.
    await call(getHandler(), OWNER, { id: JOB_B });
    expect(jobFilters.id).toBe(JOB_B);
    expect(jobFilters.companyIds).toEqual([COMPANY_A]);
  });

  it('the tenant predicate comes from the context, not from the query string', async () => {
    await call(getHandler(), OWNER, { id: JOB_B, companyId: COMPANY_B, company_id: COMPANY_B, scope: 'platform' });
    expect(jobFilters.companyIds).toEqual([COMPANY_A]);
    expect(await Promise.resolve(downstreamReads)).toEqual([]);
  });

  it('an authenticated caller with no memberships reaches no job', async () => {
    const h = getHandler();
    principal = OUTSIDER;
    const ctx = require('../../services/userContextService');
    ctx.resolveUserContext.mockResolvedValueOnce({
      userId: OUTSIDER, role: 'user', companyIds: [], defaultCompanyId: '', authenticated: true, authError: null,
    });
    const res = mockRes();
    await h({ method: 'GET', url: '/x', query: { id: JOB_B }, headers: {}, body: {} } as never, res);
    expect(res.statusCode).toBe(404);
    expect(downstreamReads).toEqual([]);
  });

  it('a nonexistent id is indistinguishable from a forbidden one', async () => {
    const forbidden = await call(getHandler(), OWNER, { id: JOB_B });
    const missing = await call(getHandler(), OWNER, { id: 'ffffffff-0000-0000-0000-00000000ffff' });
    expect(forbidden.statusCode).toBe(missing.statusCode);
    expect(forbidden.body).toEqual(missing.body);
  });

  it('a super admin is intentionally unscoped — the documented privileged path', async () => {
    const res = await call(getHandler(), SUPERADMIN, { id: JOB_B });
    expect(res.statusCode).toBe(200);
    expect(jobFilters.companyIds).toBeUndefined();
  });

  it('a non-GET verb is refused before any identity or job work', async () => {
    const res = await call(getHandler(), OWNER, { id: JOB_B }, 'POST');
    expect(res.statusCode).toBe(405);
    expect(jobFilters).toEqual({});
    expect(downstreamReads).toEqual([]);
  });

  it('a missing id is rejected before the job query', async () => {
    const res = await call(getHandler(), OWNER, {});
    expect(res.statusCode).toBe(400);
    expect(jobFilters).toEqual({});
  });

  it(`${name}: downstream reads are keyed on the ALREADY-authorized job id`, async () => {
    // The second query uses .eq('job_id', jobId). That is safe only because
    // the job row was proven to be in the caller's company first — pin the
    // ordering, since reversing it would reintroduce the defect.
    const res = await call(getHandler(), SUPERADMIN, { id: JOB_B });
    expect(res.statusCode).toBe(200);
    expect(downstreamReads.every(r => r.jobId === JOB_B)).toBe(true);
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * 4. trends/fetch — NOT A DEFECT, contract pinned
 * ──────────────────────────────────────────────────────────────────────── */

const trendCalls: Array<{ companyId: unknown; userId: unknown }> = [];

jest.mock('../../services/externalApiService', () => ({
  fetchTrendsFromApis: jest.fn(async (companyId: string, _geo?: string, _cat?: string, opts?: any) => {
    trendCalls.push({ companyId, userId: opts?.userId });
    return [{ topic: 'trend' }];
  }),
}));

import trendsHandler from '../../../pages/api/trends/fetch';

describe('trends/fetch — the company is server-derived', () => {
  beforeEach(() => { trendCalls.length = 0; });

  it('CRITICAL: an unauthenticated caller never reaches the trends sink', async () => {
    const res = await call(trendsHandler, null, { geo: 'US' });
    expect(res.statusCode).toBe(400);
    expect(trendCalls).toEqual([]);
  });

  it('CRITICAL: a caller-supplied companyId is ignored entirely', async () => {
    // The route reads user.defaultCompanyId and nothing else. A companyId in
    // the query string is not a selector here — this pins that.
    const res = await call(trendsHandler, OWNER, {
      geo: 'US', companyId: COMPANY_B, company_id: COMPANY_B, orgId: COMPANY_B,
    });
    expect(res.statusCode).toBe(200);
    expect(trendCalls).toEqual([{ companyId: COMPANY_A, userId: OWNER }]);
  });

  it('a legitimate caller fetches trends for their own company', async () => {
    const res = await call(trendsHandler, OWNER, { geo: 'US', category: 'tech' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ trends: [{ topic: 'trend' }] });
    expect(trendCalls[0].companyId).toBe(COMPANY_A);
  });

  it('a non-GET verb reaches no sink', async () => {
    const res = await call(trendsHandler, OWNER, {}, 'POST');
    expect(res.statusCode).toBe(405);
    expect(trendCalls).toEqual([]);
  });
});
