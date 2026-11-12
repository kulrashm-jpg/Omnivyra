/**
 * S2 tenant seam (e1-b) - listeningConfigurationService: every listening_configurations read / insert / update goes
 * through tenantTable with the caller's TenantContext (organization_id stamped / predicated by the seam).
 * Company B holds a configuration row that every non-tenant filter would match (one row per org, read by maybeSingle).
 */
export {};
type Row = Record<string, any>;
type Filter = [string, string, unknown];
const mockDb: Record<string, Row[]> = {};
/** Column DEFAULTs of the real schema, applied on insert (faithful: Postgres fills them, the service relies on them). */
const mockDefaults: Record<string, Row> = {
  projection_sync_state: { cursor_position: null, pending_retry_count: 0, metadata: {} },
};
const mockWrites: Array<{ table: string; op: string; filters: Filter[]; payload: any }> = [];
let mockSeq = 0;
/** Faithful in-memory PostgREST double: every filter is APPLIED, every write persisted and recorded with its filters. */
function mockTable(table: string) {
  const filters: Filter[] = [];
  const tests: Array<(r: Row) => boolean> = [];
  let op = 'select'; let payload: any = null; let mode: 'many' | 'single' | 'maybe' = 'many';
  let lim = Infinity; let ord: [string, boolean] | null = null;
  const add = (kind: string, c: string, v: unknown, t: (r: Row) => boolean) => { filters.push([kind, c, v]); tests.push(t); return b; };
  const run = () => {
    const rows = (mockDb[table] = mockDb[table] ?? []);
    let out: Row[];
    if (op === 'insert' || op === 'upsert') {
      const list = (Array.isArray(payload) ? payload : [payload]) as Row[];
      out = list.map((p) => { const r = { id: p.id ?? `${table}-${++mockSeq}`, ...(mockDefaults[table] ?? {}), ...p }; rows.push(r); return { ...r }; });
      mockWrites.push({ table, op, filters: [...filters], payload });
    } else {
      const hit = rows.filter((r) => tests.every((t) => t(r)));
      if (op === 'update') { hit.forEach((r) => Object.assign(r, payload)); mockWrites.push({ table, op, filters: [...filters], payload }); }
      if (op === 'delete') { for (const h of hit) rows.splice(rows.indexOf(h), 1); mockWrites.push({ table, op, filters: [...filters], payload: null }); }
      out = hit.map((r) => ({ ...r }));
      if (ord) { const [c, asc] = ord; out.sort((x, y) => (x[c] < y[c] ? -1 : x[c] > y[c] ? 1 : 0) * (asc ? 1 : -1)); }
      out = out.slice(0, lim);
    }
    if (mode === 'many') return { data: out, error: null };
    if (out.length > 1) return { data: null, error: { code: 'PGRST116', message: 'multiple rows returned' } };
    if (out.length === 0) return mode === 'maybe' ? { data: null, error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
    return { data: out[0], error: null };
  };
  const b: any = {
    select: () => b,
    eq: (c: string, v: unknown) => add('eq', c, v, (r) => r[c] === v),
    neq: (c: string, v: unknown) => add('neq', c, v, (r) => r[c] !== v),
    in: (c: string, v: unknown[]) => add('in', c, v, (r) => v.includes(r[c])),
    is: (c: string, v: unknown) => add('is', c, v, (r) => (v === null ? r[c] === null || r[c] === undefined : r[c] === v)),
    gt: (c: string, v: any) => add('gt', c, v, (r) => r[c] > v),
    gte: (c: string, v: any) => add('gte', c, v, (r) => r[c] >= v),
    lt: (c: string, v: any) => add('lt', c, v, (r) => r[c] < v),
    lte: (c: string, v: any) => add('lte', c, v, (r) => r[c] <= v),
    or: () => { throw new Error('or() not modelled by this fake'); },
    order: (c: string, o?: { ascending?: boolean }) => { ord = [c, o?.ascending !== false]; return b; },
    limit: (n: number) => { lim = n; return b; },
    insert: (p: any) => { op = 'insert'; payload = p; return b; },
    upsert: (p: any) => { op = 'upsert'; payload = p; return b; },
    update: (p: any) => { op = 'update'; payload = p; return b; },
    delete: () => { op = 'delete'; return b; },
    single: () => { mode = 'single'; return b; },
    maybeSingle: () => { mode = 'maybe'; return b; },
    then: (ok: any, ko: any) => Promise.resolve(run()).then(ok, ko),
  };
  return b;
}
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => mockTable(t), ownedDbRpc: async () => ({ data: null, error: null }) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => mockTable(t) } }));
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const writes = (t: string) => mockWrites.filter((w) => w.table === t);
/** Every write on `t` carries the tenant predicate for A (update/delete) or is stamped with A (insert/upsert). */
const pinnedTo = (t: string, col: string, id: string) => writes(t).every((w) =>
  (w.op === 'insert' || w.op === 'upsert')
    ? (Array.isArray(w.payload) ? w.payload : [w.payload]).every((p: Row) => p[col] === id)
    : w.filters.some(([k, c, v]) => k === 'eq' && c === col && v === id));
const resetDb = () => { for (const k of Object.keys(mockDb)) delete mockDb[k]; mockWrites.length = 0; mockSeq = 0; };
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/userContextService', () => ({
  enforceCompanyAccess: async ({ res, companyId }: any) => (companyId === '11111111-1111-4111-8111-111111111111'
    ? { userId: 'user-a', companyId } : (res.status(403).json({ error: 'FORBIDDEN' }), null)),
}));
jest.mock('../../services/rbacService', () => ({ getUserRole: async () => ({ role: 'COMPANY_ADMIN', error: null }) }));
jest.mock('../../services/rbac/communityAiCapabilities', () => ({ hasCommunityAiCapability: () => true }));
async function call(h: any, method: string, query: Row, body: Row = {}) {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (x: unknown) => { res.body = x; return res; };
  res.setHeader = () => res;
  await h({ method, headers: {}, query, body }, res);
  return res;
}
jest.mock('../../services/capabilityCacheService', () => ({ invalidateCapabilityAggregate: () => undefined }));
jest.mock('../../services/capabilityAggregationService', () => ({ buildCapabilityAggregate: async () => ({}) }));
jest.mock('../../services/monitoringEligibilityService', () => ({ evaluateMonitoringEligibility: () => ({ eligible: true, blockers: [] }) }));
jest.mock('../../services/creditEstimationService', () => ({
  estimateCredits: () => ({ estimate_hash: 'h1', monthly_min: 1, monthly_max: 2, per_run: 1 }),
  verifyEstimateHash: () => true,
}));
jest.mock('../../services/monitoringOrchestrationService', () => ({ getMonitoringStatusSnapshot: async () => ({}) }));

import { systemTenantContext } from '../../db/tenantTable';
import {
  activateListeningConfiguration,
  getListeningConfiguration,
  suspendListeningConfiguration,
} from '../../services/listeningConfigurationService';
/* eslint-disable @typescript-eslint/no-var-requires */
const route = require('../../../pages/api/active-leads/configuration').default;
/* eslint-enable @typescript-eslint/no-var-requires */

const tA = systemTenantContext(A, 's2 listening configuration test');
const draft = (mode: any) => ({
  tenant: tA, mode, platforms: ['reddit'], keywordCount: 3, industryCategory: null, industryVolatility: null,
  monthlyCreditCeiling: 0, dailyRunCeiling: 1, cooldownMinutes: 60, confirmedBy: 'user-a', estimateHash: 'h1',
  acknowledgeCreditEstimate: true, acknowledgeConsentRequirement: true,
});
const bRow = () => mockDb.listening_configurations.find((r) => r.organization_id === B)!;

beforeEach(() => {
  resetDb();
  mockDb.listening_configurations = [{ id: 'cfg-b', organization_id: B, mode: 'daily', platforms: ['reddit'], next_planned_run_at: '2026-12-01T00:00:00Z', confirmed_by: 'user-b' }];
});

describe('listeningConfigurationService through the tenant seam', () => {
  it("get(A) never returns B's configuration", async () => {
    expect(await getListeningConfiguration(tA)).toBeNull();
  });
  it('activate(A) inserts a row stamped with A, then updates only that row; B is untouched', async () => {
    const first = await activateListeningConfiguration(draft('daily'));
    expect(first.ok).toBe(true);
    expect(writes('listening_configurations')[0].op).toBe('insert');
    expect(writes('listening_configurations')[0].payload.organization_id).toBe(A);
    const second = await activateListeningConfiguration(draft('weekly'));
    expect(second.ok).toBe(true);
    expect((second as any).configuration).toMatchObject({ organization_id: A, mode: 'weekly' });
    expect(writes('listening_configurations').map((w) => w.op)).toEqual(['insert', 'update']);
    expect(pinnedTo('listening_configurations', 'organization_id', A)).toBe(true);
    expect(bRow()).toMatchObject({ mode: 'daily', confirmed_by: 'user-b' });
    expect(mockDb.listening_configurations.filter((r) => r.organization_id === A)).toHaveLength(1);
  });
  it("suspend(A) with no A row is a no-op (B's daily config is not suspended)", async () => {
    expect(await suspendListeningConfiguration(tA)).toBeNull();
    expect(writes('listening_configurations')).toHaveLength(0);
    expect(bRow()).toMatchObject({ mode: 'daily', next_planned_run_at: '2026-12-01T00:00:00Z' });
  });
  it('suspend(A) suspends only A', async () => {
    mockDb.listening_configurations.push({ id: 'cfg-a', organization_id: A, mode: 'daily', next_planned_run_at: 'x' });
    const r = await suspendListeningConfiguration(tA);
    expect(r).toMatchObject({ id: 'cfg-a', mode: 'manual_only' });
    expect(pinnedTo('listening_configurations', 'organization_id', A)).toBe(true);
    expect(bRow().mode).toBe('daily');
  });
});

describe('pages/api/active-leads/configuration builds the context from its access check', () => {
  it('POST for A writes A; DELETE for B is refused by the access check and writes nothing', async () => {
    const ok = await call(route, 'POST', {}, { companyId: A, mode: 'manual_only', platforms: [] });
    expect(ok.statusCode).toBe(200);
    expect(writes('listening_configurations')[0].payload.organization_id).toBe(A);
    const no = await call(route, 'DELETE', { companyId: B });
    expect(no.statusCode).toBe(403);
    expect(writes('listening_configurations')).toHaveLength(1);
    expect(bRow().mode).toBe('daily');
  });
});
