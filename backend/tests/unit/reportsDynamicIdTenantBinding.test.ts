/**
 * REPORTS-DYNAMIC-SEC-001 — GET/DELETE /api/reports/[reportId].
 *
 * SAFE. This suite is characterization: the route is the only reports endpoint
 * accepting a caller-supplied resource id — the exact shape that produced
 * Critical findings in WITHRBAC-SEC-001, OPPORTUNITIES-SEC-001 and
 * GOVERNANCE-SEC-002 — and it had no regression coverage.
 *
 * Why it is safe: the report is NEVER selected by id alone. Both verbs derive
 * the caller's ACTIVE memberships first and put them in the query itself:
 *
 *     .from('reports').select(...).eq('id', reportId)
 *       .in('company_id', accessibleCompanyIds)
 *
 * so a foreign report simply does not match and answers with the same 404 a
 * nonexistent id gets. The route accepts NO company identifier at all, so there
 * is nothing for a caller to spoof, and every downstream sink — telemetry, the
 * requeue/regeneration path, the company_profiles read, the timeline query —
 * receives the AUTHORIZED report's own company_id.
 *
 * The DELETE is doubly bound: the existence probe and the DELETE statement each
 * carry `.in('company_id', …)`.
 */

const MEMBER_A = 'aaaaaaaa-0000-0000-0000-0000000000aa';
const STALE_B = 'dddddddd-0000-0000-0000-0000000000dd';
const NO_COMPANY = 'eeeeeeee-0000-0000-0000-0000000000ee';
const COMPANY_A = 'a0000000-0000-0000-0000-00000000000a';
const VICTIM = 'b0000000-0000-0000-0000-00000000000b';
const REPORT_A = 'ra000000-0000-0000-0000-00000000000a';
const REPORT_VICTIM = 'rb000000-0000-0000-0000-00000000000b';

const ROLES = [
  { user_id: MEMBER_A, company_id: COMPANY_A, status: 'active' },
  // Inactive in the victim tenant — must never authorize.
  { user_id: STALE_B, company_id: VICTIM, status: 'inactive' },
];

/** The victim's report is COMPLETED with real data, so a leak would be visible. */
const REPORTS: Record<string, any> = {
  [REPORT_A]: {
    id: REPORT_A, company_id: COMPANY_A, user_id: MEMBER_A, domain: 'mine.example',
    report_type: 'snapshot', status: 'completed', created_at: new Date().toISOString(),
    data: { intelligence: { posts: [{ title: 'own post' }] }, engine_version: 'v1' }, metadata: {},
  },
  [REPORT_VICTIM]: {
    id: REPORT_VICTIM, company_id: VICTIM, user_id: 'someone', domain: 'victim.example',
    report_type: 'snapshot', status: 'completed', created_at: new Date().toISOString(),
    data: { intelligence: { posts: [{ title: 'VICTIM_SECRET_POST' }] }, engine_version: 'v1' }, metadata: {},
  },
};

let authUser: string | null = MEMBER_A;

const queries: Array<{ table: string; filters: Record<string, unknown> }> = [];
const writes: Array<{ table: string; op: string; filters: Record<string, unknown> }> = [];
/** Downstream sinks, with the company/report each received. */
const sinks: Array<{ name: string; value: unknown }> = [];

const reportQueries = () => queries.filter(q => q.table === 'reports');

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
    b.in = (c: string, v: unknown) => { filters[c + '__in'] = v; return b; };
    b.lte = (c: string, v: unknown) => { filters[c + '__lte'] = v; return b; };
    b.order = () => b; b.limit = () => b;
    b.update = (p: unknown) => { writes.push({ table, op: 'update', filters }); return b; };
    b.delete = () => { writes.push({ table, op: 'delete', filters }); return b; };
    const rows = (): any[] => {
      if (table === 'user_company_roles') {
        return ROLES.filter(r =>
          (filters.user_id === undefined || r.user_id === filters.user_id) &&
          (filters.status === undefined || r.status === filters.status));
      }
      if (table === 'reports') {
        const accessible = filters['company_id__in'] as string[] | undefined;
        let rs = Object.values(REPORTS);
        if (filters.id !== undefined) rs = rs.filter(r => r.id === filters.id);
        if (filters.company_id !== undefined) rs = rs.filter(r => r.company_id === filters.company_id);
        // Honour the tenant predicate exactly: this is what makes a foreign
        // report fall through to "not found" rather than being read.
        if (accessible !== undefined) rs = rs.filter(r => accessible.includes(r.company_id));
        return rs;
      }
      if (table === 'company_profiles') return [{ logo_url: null, favicon_url: null }];
      return [];
    };
    const resolve = () => {
      queries.push({ table, filters: { ...filters } });
      const d = rows();
      return { data: d, count: d.length, error: null };
    };
    b.maybeSingle = () => { const r = resolve(); return Promise.resolve({ data: r.data[0] ?? null, error: null }); };
    b.single = () => { const r = resolve(); return Promise.resolve({ data: r.data[0] ?? null, error: null }); };
    b.then = (fn: any) => Promise.resolve(resolve()).then(fn);
    return b;
  };
  return { supabase: { from: (t: string) => build(t) } };
});

/* downstream sinks */
jest.mock('../../services/telemetry/telemetryDispatcher', () => ({
  trackEvent: jest.fn((e: any) => { sinks.push({ name: 'trackEvent', value: e?.organizationId }); }),
}));
jest.mock('../../services/reportCardService', () => ({
  startAsyncReportGeneration: jest.fn(async (r: any) => { sinks.push({ name: 'startAsyncReportGeneration', value: r?.company_id }); }),
  MAX_REPORT_GENERATION_ATTEMPTS: 3,
  REPORT_RETRY_COOLDOWN_MINUTES: 10,
}));
jest.mock('../../services/export/canonicalReportPipeline', () => ({
  renderCanonicalReportHtml: jest.fn((p: any) => { sinks.push({ name: 'renderHtml', value: p?.companyContext?.companyId }); return '<html/>'; }),
  renderCanonicalReportPdf: jest.fn(async (p: any) => { sinks.push({ name: 'renderPdf', value: p?.companyContext?.companyId }); return Buffer.from('pdf'); }),
}));
jest.mock('../../services/export/htmlToPdfRenderer', () => ({ renderPdfFromHtml: jest.fn(async () => Buffer.from('pdf')) }));
jest.mock('../../services/reportContentSanitizationService', () => ({ sanitizeReportViewPayload: jest.fn((p: any) => p) }));
jest.mock('../../services/reportIntelligenceViewMappers', () => ({
  mapSnapshot: jest.fn((_i: any, id: string, companyId: string) => ({ reportId: id, companyContext: { companyId } })),
  mapPerformance: jest.fn((_i: any, id: string, companyId: string) => ({ reportId: id, companyContext: { companyId } })),
  mapGrowth: jest.fn((_i: any, id: string, companyId: string) => ({ reportId: id, companyContext: { companyId } })),
}));
jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import handler from '../../../pages/api/reports/[reportId]';

function mockRes() {
  const res: any = { statusCode: 0, body: undefined, headers: {} as Record<string, string> };
  res.setHeader = (k: string, v: string) => { res.headers[k.toLowerCase()] = v; return res; };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  res.send = (p: unknown) => { res.body = p; return res; };
  return res;
}
async function call(as: string | null, query: Record<string, unknown>, method = 'GET') {
  authUser = as;
  const res = mockRes();
  await handler({ method, url: '/api/reports/x', query, body: {}, headers: {} } as never, res);
  return res;
}

/** Nothing of the victim's was returned or handed to a sink. */
function noVictimLeak(body?: unknown) {
  const blob = JSON.stringify(body ?? {});
  expect(blob).not.toContain('VICTIM_SECRET_POST');
  expect(blob).not.toContain('victim.example');
  expect(blob).not.toContain(VICTIM);
  expect(sinks.filter(s => s.value === VICTIM)).toEqual([]);
}

beforeEach(() => {
  authUser = MEMBER_A;
  queries.length = 0; writes.length = 0; sinks.length = 0;
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

/* ── authentication ───────────────────────────────────────────────────── */

describe('authentication', () => {
  it('unauthenticated → 401 and nothing is queried', async () => {
    const res = await call(null, { reportId: REPORT_VICTIM, type: 'snapshot' });
    expect(res.statusCode).toBe(401);
    expect(queries).toEqual([]);
    noVictimLeak(res.body);
  });

  it('invalid authentication is refused the same way', async () => {
    const res = await call(null, { reportId: REPORT_A, type: 'snapshot' }, 'DELETE');
    expect(res.statusCode).toBe(401);
    expect(writes).toEqual([]);
  });
});

/* ── GET: resource ownership ──────────────────────────────────────────── */

describe('GET — resource ownership', () => {
  it('a member reads their OWN report', async () => {
    const res = await call(MEMBER_A, { reportId: REPORT_A, type: 'snapshot' });
    expect(res.statusCode).toBe(200);
    expect(res.body.companyContext.companyId).toBe(COMPANY_A);
  });

  it('CRITICAL: a foreign report is not returned', async () => {
    const res = await call(MEMBER_A, { reportId: REPORT_VICTIM, type: 'snapshot' });
    expect(res.statusCode).toBe(404);
    noVictimLeak(res.body);
  });

  it('CRITICAL: the report is never selected by id alone — the query carries the tenant predicate', async () => {
    // The whole boundary. A version that fetched by id and checked afterwards
    // would have loaded the victim's row; this never does.
    await call(MEMBER_A, { reportId: REPORT_VICTIM, type: 'snapshot' });
    const q = reportQueries();
    expect(q).toHaveLength(1);
    expect(q[0].filters.id).toBe(REPORT_VICTIM);
    expect(q[0].filters['company_id__in']).toEqual([COMPANY_A]);
  });

  it('CRITICAL: no downstream sink runs for a foreign report', async () => {
    await call(MEMBER_A, { reportId: REPORT_VICTIM, type: 'snapshot' });
    expect(sinks).toEqual([]);
    expect(writes).toEqual([]);
  });

  it('a stale (inactive) membership cannot read the report', async () => {
    const res = await call(STALE_B, { reportId: REPORT_VICTIM, type: 'snapshot' });
    expect(res.statusCode).toBe(404);
    noVictimLeak(res.body);
  });

  it('a caller with no memberships is refused before any report query', async () => {
    const res = await call(NO_COMPANY, { reportId: REPORT_A, type: 'snapshot' });
    expect(res.statusCode).toBe(404);
    expect(reportQueries()).toEqual([]);
  });
});

/* ── the existence oracle ─────────────────────────────────────────────── */

describe('no existence oracle', () => {
  it('CRITICAL: a foreign report is indistinguishable from a nonexistent one', async () => {
    // The victim's report is COMPLETED with real content, so before the tenant
    // predicate it would have answered 200 with data — visibly different.
    const foreign = await call(MEMBER_A, { reportId: REPORT_VICTIM, type: 'snapshot' });
    const missing = await call(MEMBER_A, { reportId: 'ff000000-0000-0000-0000-0000000000ff', type: 'snapshot' });
    expect(foreign.statusCode).toBe(missing.statusCode);
    expect(foreign.body).toEqual(missing.body);
  });

  it('a malformed report id answers the same 404', async () => {
    const res = await call(MEMBER_A, { reportId: "x' OR 1=1--", type: 'snapshot' });
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Report not found', code: 'NOT_FOUND' });
  });
});

/* ── DELETE: the write path ───────────────────────────────────────────── */

describe('DELETE — the write path', () => {
  it('a member can delete their OWN report', async () => {
    const res = await call(MEMBER_A, { reportId: REPORT_A }, 'DELETE');
    expect(res.statusCode).toBe(200);
    expect(writes.filter(w => w.op === 'delete')).toHaveLength(1);
  });

  it('CRITICAL: a foreign report cannot be deleted, and no delete executes', async () => {
    const res = await call(MEMBER_A, { reportId: REPORT_VICTIM }, 'DELETE');
    expect(res.statusCode).toBe(404);
    expect(writes).toEqual([]);
    noVictimLeak(res.body);
  });

  it('CRITICAL: the DELETE statement itself carries the tenant predicate', async () => {
    // Doubly bound: the existence probe AND the delete both scope by company,
    // so even a race between them could not remove a foreign row.
    await call(MEMBER_A, { reportId: REPORT_A }, 'DELETE');
    const del = writes.find(w => w.op === 'delete');
    expect(del!.filters['company_id__in']).toEqual([COMPANY_A]);
    expect(del!.filters.id).toBe(REPORT_A);
  });

  it('a stale membership cannot delete', async () => {
    const res = await call(STALE_B, { reportId: REPORT_VICTIM }, 'DELETE');
    expect(res.statusCode).toBe(404);
    expect(writes).toEqual([]);
  });

  it('a caller with no memberships cannot delete', async () => {
    const res = await call(NO_COMPANY, { reportId: REPORT_A }, 'DELETE');
    expect(res.statusCode).toBe(404);
    expect(writes).toEqual([]);
  });

  it('a missing reportId is rejected before any query', async () => {
    const res = await call(MEMBER_A, {}, 'DELETE');
    expect(res.statusCode).toBe(400);
    expect(writes).toEqual([]);
  });
});

/* ── input handling ───────────────────────────────────────────────────── */

describe('input handling', () => {
  it('an invalid report type is rejected before any DB work', async () => {
    const res = await call(MEMBER_A, { reportId: REPORT_VICTIM, type: 'evil' });
    expect(res.statusCode).toBe(400);
    expect(queries).toEqual([]);
  });

  it('CRITICAL: no caller-supplied company can widen access', async () => {
    // The route accepts no company identifier; these are ignored entirely.
    const res = await call(MEMBER_A, {
      reportId: REPORT_VICTIM, type: 'snapshot',
      companyId: VICTIM, company_id: VICTIM, organizationId: VICTIM,
    });
    expect(res.statusCode).toBe(404);
    expect(reportQueries()[0].filters['company_id__in']).toEqual([COMPANY_A]);
    noVictimLeak(res.body);
  });

  it('an export format cannot bypass the tenant predicate', async () => {
    for (const format of ['html', 'pdf']) {
      queries.length = 0; sinks.length = 0;
      const res = await call(MEMBER_A, { reportId: REPORT_VICTIM, type: 'snapshot', format });
      expect(res.statusCode).toBe(404);
      expect(sinks).toEqual([]);
    }
  });

  it('an unsupported verb reaches nothing', async () => {
    const res = await call(MEMBER_A, { reportId: REPORT_A, type: 'snapshot' }, 'POST');
    expect(res.statusCode).toBe(405);
    expect(queries).toEqual([]);
  });
});
