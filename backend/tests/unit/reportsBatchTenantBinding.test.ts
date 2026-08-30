/**
 * REPORTS-BATCH-SEC-001 — the 10 baselined pages/api/reports/* routes.
 *
 * All ten are SAFE. This suite is characterization: they had no regression
 * coverage, and their tenant binding is a HAND-ROLLED helper duplicated across
 * nine route files plus one shared module — exactly the shape that drifts.
 *
 * None of the ten uses withRBAC or an approved primitive. Each authenticates,
 * then calls a local `resolveCompanyId(userId, requestedCompanyId)`:
 *
 *     if (requestedCompanyId) {
 *       // must have an ACTIVE role in THAT company, else null
 *       .from('user_company_roles').eq('user_id', userId)
 *         .eq('company_id', requestedCompanyId).eq('status','active')
 *       return data?.company_id ?? null;
 *     }
 *     // otherwise fall back to the caller's own first active membership
 *
 * That is a genuine membership check, and the value it returns — the row's
 * company_id, not the caller's raw input — is what every sink receives. The
 * absent-identifier branch is NOT a truthiness bypass: it falls back to the
 * caller's own company rather than skipping the check.
 *
 * Verified identical in all ten (nine inline copies byte-for-byte, plus
 * automationActivityShared). This suite pins that so a single edited copy
 * cannot drift unnoticed.
 */

const MEMBER_A = 'aaaaaaaa-0000-0000-0000-0000000000aa';
const STALE_B = 'dddddddd-0000-0000-0000-0000000000dd';
const COMPANY_A = 'a0000000-0000-0000-0000-00000000000a';
const VICTIM = 'b0000000-0000-0000-0000-00000000000b';

/** STALE_B's membership in VICTIM is inactive and must never authorize. */
const ROLES = [
  { user_id: MEMBER_A, company_id: COMPANY_A, role: 'COMPANY_ADMIN', status: 'active' },
  { user_id: STALE_B, company_id: VICTIM, role: 'COMPANY_ADMIN', status: 'inactive' },
];

let authUser: string | null = MEMBER_A;

/** Every query, with the predicates it carried. */
const queries: Array<{ table: string; filters: Record<string, unknown> }> = [];
const writes: Array<{ table: string; payload: unknown }> = [];
/** Consequential service sinks, with the company each actually received. */
const sinks: Array<{ name: string; companyId: unknown }> = [];

/** Reads/writes beyond the membership lookup itself. */
const appQueries = () => queries.filter(q => q.table !== 'user_company_roles');

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
    b.gte = (c: string, v: unknown) => { filters[c + '__gte'] = v; return b; };
    b.lte = (c: string, v: unknown) => { filters[c + '__lte'] = v; return b; };
    b.order = () => b; b.limit = () => b; b.range = () => b;
    b.insert = (p: unknown) => { writes.push({ table, payload: p }); return b; };
    b.update = (p: unknown) => { writes.push({ table, payload: p }); return b; };
    b.upsert = (p: unknown) => { writes.push({ table, payload: p }); return b; };
    b.delete = () => { writes.push({ table, payload: 'delete' }); return b; };
    const rows = (): any[] => {
      if (table === 'user_company_roles') {
        return ROLES.filter(r =>
          (filters.user_id === undefined || r.user_id === filters.user_id) &&
          (filters.company_id === undefined || r.company_id === filters.company_id) &&
          (filters.status === undefined || r.status === filters.status));
      }
      if (table === 'companies') return [{ id: filters.id, status: 'active', domain: 'example.com' }];
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
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => require('../../db/supabaseClient').supabase.from(t),
}));

/* ── the consequential sinks of execute and generate ──────────────────── */

const record = (name: string) => (a: any) =>
  { sinks.push({ name, companyId: a?.companyId ?? a?.organizationId ?? a?.orgId ?? a }); };

jest.mock('../../services/reportPersistenceService', () => ({
  getLatestPersistedReport: jest.fn(async (a: any) => { record('getLatestPersistedReport')(a); return null; }),
  persistOrchestratedReport: jest.fn(async (a: any) => { record('persistOrchestratedReport')(a); }),
}));
jest.mock('../../services/snapshotInputResolver', () => ({
  resolveSnapshotReportInput: jest.fn(async (a: any) => { record('resolveSnapshotReportInput')(a); return { companyId: a.companyId }; }),
  persistSnapshotReportInputs: jest.fn(async (a: any) => { record('persistSnapshotReportInputs')(a); }),
}));
jest.mock('../../services/analyticsInputResolver', () => ({
  resolveAnalyticsReportInput: jest.fn(async (a: any) => { record('resolveAnalyticsReportInput')(a); return { companyId: a.companyId }; }),
  persistAnalyticsReportInputs: jest.fn(async (a: any) => { record('persistAnalyticsReportInputs')(a); }),
}));
jest.mock('../../services/reportReadinessService', () => ({
  evaluateResolvedReportReadiness: jest.fn(async () => ({ ready: false, missing_requirements: ['stubbed'] })),
}));
jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import indexHandler from '../../../pages/api/reports/index';
import growthHandler from '../../../pages/api/reports/growth';
import journeyHandler from '../../../pages/api/reports/journey';
import performanceHandler from '../../../pages/api/reports/performance';
import readinessHandler from '../../../pages/api/reports/readiness';
import snapshotHandler from '../../../pages/api/reports/snapshot';
import automationActivityHandler from '../../../pages/api/reports/automation-activity';
import automationConfigHandler from '../../../pages/api/reports/automation-config';
import executeHandler from '../../../pages/api/reports/execute';
import generateHandler from '../../../pages/api/reports/generate';

function mockRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.setHeader = () => res;
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  res.end = () => res;
  return res;
}
async function call(h: any, as: string | null, opts: { query?: any; body?: any; method?: string } = {}) {
  authUser = as;
  const res = mockRes();
  await h({ method: opts.method ?? 'GET', url: '/api/reports/x',
            query: opts.query ?? {}, body: opts.body ?? {}, headers: {} } as never, res);
  return res;
}

/** Nothing belonging to the victim tenant was read, written, or handed onward. */
function noVictimReach(body?: unknown) {
  expect(sinks.filter(s => s.companyId === VICTIM)).toEqual([]);
  expect(writes.filter(w => JSON.stringify(w.payload).includes(VICTIM))).toEqual([]);
  expect(appQueries().filter(q => JSON.stringify(q.filters).includes(VICTIM))).toEqual([]);
  if (body !== undefined) expect(JSON.stringify(body ?? {})).not.toContain(VICTIM);
}

beforeEach(() => {
  authUser = MEMBER_A;
  queries.length = 0; writes.length = 0; sinks.length = 0;
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

/* ── the eight read-shaped routes ─────────────────────────────────────── */

const READ_ROUTES: Array<[string, () => any, 'company_id' | 'companyId']> = [
  ['reports/index', () => indexHandler, 'company_id'],
  ['reports/growth', () => growthHandler, 'company_id'],
  ['reports/journey', () => journeyHandler, 'companyId'],
  ['reports/performance', () => performanceHandler, 'company_id'],
  ['reports/readiness', () => readinessHandler, 'companyId'],
  ['reports/snapshot', () => snapshotHandler, 'company_id'],
  ['reports/automation-activity', () => automationActivityHandler, 'company_id'],
  ['reports/automation-config', () => automationConfigHandler, 'company_id'],
];

describe.each(READ_ROUTES)('%s', (_name, getHandler, param) => {
  it('unauthenticated → 401 and no membership lookup or read happens', async () => {
    const res = await call(getHandler(), null, { query: { [param]: VICTIM } });
    expect(res.statusCode).toBe(401);
    expect(queries).toEqual([]);
    noVictimReach(res.body);
  });

  it('CRITICAL: naming another company is 403 and reaches no application read', async () => {
    const res = await call(getHandler(), MEMBER_A, { query: { [param]: VICTIM } });
    expect(res.statusCode).toBe(403);
    expect(appQueries()).toEqual([]);
    noVictimReach(res.body);
  });

  it('CRITICAL: the membership lookup is scoped to the caller AND an active role', async () => {
    // This is the whole boundary: a hand-rolled check, so pin its predicates.
    await call(getHandler(), MEMBER_A, { query: { [param]: VICTIM } });
    const m = queries.filter(q => q.table === 'user_company_roles');
    expect(m.length).toBeGreaterThan(0);
    expect(m[0].filters.user_id).toBe(MEMBER_A);
    expect(m[0].filters.company_id).toBe(VICTIM);
    expect(m[0].filters.status).toBe('active');
  });

  it('a stale (inactive) membership does not authorize', async () => {
    const res = await call(getHandler(), STALE_B, { query: { [param]: VICTIM } });
    expect(res.statusCode).toBe(403);
    noVictimReach(res.body);
  });

  it('an omitted company falls back to the caller’s OWN company, never a foreign one', async () => {
    // Unlike the withRBAC routes, this branch is reachable here — there is no
    // wrapper demanding a company first — so the fallback is real behaviour.
    const res = await call(getHandler(), MEMBER_A, { query: {} });
    expect(res.statusCode).not.toBe(403);
    noVictimReach(res.body);
  });

  it('a malformed company identifier is refused', async () => {
    const res = await call(getHandler(), MEMBER_A, { query: { [param]: "x' OR 1=1--" } });
    expect(res.statusCode).toBe(403);
    expect(appQueries()).toEqual([]);
  });

  it('the route writes nothing', async () => {
    await call(getHandler(), MEMBER_A, { query: { [param]: COMPANY_A } });
    expect(writes).toEqual([]);
  });
});

/* ── execute — generation + persistence ───────────────────────────────── */

describe('reports/execute', () => {
  // NOTE: execute is GET-only, yet it persists reports (persistOrchestratedReport).
  // A write on GET is a REST/caching hygiene issue — recorded in the report, not
  // changed here; it is not a tenant-boundary defect.
  it('unauthenticated → 401 and no sink runs', async () => {
    const res = await call(executeHandler, null, { method: 'GET', query: { company_id: VICTIM } });
    expect(res.statusCode).toBe(401);
    expect(sinks).toEqual([]);
    expect(writes).toEqual([]);
  });

  it('CRITICAL: naming another company is 403 — no report is built or persisted', async () => {
    const res = await call(executeHandler, MEMBER_A, { method: 'GET', query: { company_id: VICTIM } });
    expect(res.statusCode).toBe(403);
    expect(sinks).toEqual([]);
    expect(writes).toEqual([]);
    noVictimReach(res.body);
  });

  it('CRITICAL: persistOrchestratedReport is never reached for a foreign company', async () => {
    await call(executeHandler, MEMBER_A, { method: 'GET', query: { company_id: VICTIM } });
    expect(sinks.filter(s => s.name === 'persistOrchestratedReport')).toEqual([]);
  });

  it('a stale membership cannot execute', async () => {
    const res = await call(executeHandler, STALE_B, { method: 'GET', query: { company_id: VICTIM } });
    expect(res.statusCode).toBe(403);
    expect(sinks).toEqual([]);
  });

  it('a non-GET verb reaches no sink', async () => {
    const res = await call(executeHandler, MEMBER_A, { method: 'POST', query: { company_id: COMPANY_A } });
    expect(res.statusCode).toBe(405);
    expect(sinks).toEqual([]);
    expect(queries).toEqual([]);
  });
});

/* ── generate — resolution, persistence, billing ──────────────────────── */

describe('reports/generate', () => {
  it('unauthenticated → 401 and no sink runs', async () => {
    const res = await call(generateHandler, null, { method: 'POST', body: { companyId: VICTIM } });
    expect(res.statusCode).toBe(401);
    expect(sinks).toEqual([]);
    expect(writes).toEqual([]);
  });

  it('CRITICAL: naming another company is 403 — nothing resolved, persisted or billed', async () => {
    const res = await call(generateHandler, MEMBER_A, { method: 'POST', body: { companyId: VICTIM } });
    expect(res.statusCode).toBe(403);
    expect(sinks).toEqual([]);
    expect(writes).toEqual([]);
    noVictimReach(res.body);
  });

  it('CRITICAL: no input resolution or persistence runs for a foreign company', async () => {
    await call(generateHandler, MEMBER_A, { method: 'POST', body: { companyId: VICTIM } });
    for (const n of ['resolveSnapshotReportInput', 'persistSnapshotReportInputs',
                     'resolveAnalyticsReportInput', 'persistAnalyticsReportInputs']) {
      expect(sinks.filter(s => s.name === n)).toEqual([]);
    }
  });

  it('CRITICAL: authorization precedes the first sink for a legitimate caller too', async () => {
    // Readiness is stubbed not-ready, so the run stops at 400 — but resolution
    // has already happened, and it must have received the VERIFIED company.
    const res = await call(generateHandler, MEMBER_A, { method: 'POST', body: { companyId: COMPANY_A } });
    expect(res.statusCode).toBe(400);
    const resolved = sinks.filter(s => s.name.startsWith('resolve'));
    expect(resolved.length).toBeGreaterThan(0);
    for (const s of resolved) expect(s.companyId).toBe(COMPANY_A);
  });

  it('a stale membership cannot generate', async () => {
    const res = await call(generateHandler, STALE_B, { method: 'POST', body: { companyId: VICTIM } });
    expect(res.statusCode).toBe(403);
    expect(sinks).toEqual([]);
  });

  it('a caller-supplied reportId is not a selector', async () => {
    // The request type declares reportId but the handler never reads it.
    const res = await call(generateHandler, MEMBER_A, {
      method: 'POST', body: { companyId: COMPANY_A, reportId: 'ff000000-0000-0000-0000-0000000000ff' } });
    expect(res.statusCode).toBe(400); // readiness stub, not a resource lookup
    expect(JSON.stringify(sinks)).not.toContain('ff000000');
  });

  it('a non-POST verb reaches no sink', async () => {
    const res = await call(generateHandler, MEMBER_A, { method: 'GET', body: {} });
    expect(res.statusCode).toBe(405);
    expect(sinks).toEqual([]);
  });
});

/* ── batch-wide ───────────────────────────────────────────────────────── */

describe('batch-wide', () => {
  it('CRITICAL: across all ten routes a foreign company reaches no read, write or sink', async () => {
    for (const [, getHandler, param] of READ_ROUTES) {
      await call(getHandler(), MEMBER_A, { query: { [param]: VICTIM } });
    }
    await call(executeHandler, MEMBER_A, { method: 'GET', query: { company_id: VICTIM } });
    await call(generateHandler, MEMBER_A, { method: 'POST', body: { companyId: VICTIM } });
    expect(appQueries()).toEqual([]);
    expect(writes).toEqual([]);
    expect(sinks).toEqual([]);
    noVictimReach();
  });

  it('every route performs the membership lookup before anything else', async () => {
    for (const [, getHandler, param] of READ_ROUTES) {
      queries.length = 0;
      await call(getHandler(), MEMBER_A, { query: { [param]: COMPANY_A } });
      expect(queries[0].table).toBe('user_company_roles');
    }
  });
});
