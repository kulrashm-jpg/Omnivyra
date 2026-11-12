/**
 * S2 tenant seam (e1-b) - alertRoutingService: alert_rules and alerts reads / writes go through tenantTable with
 * the caller's TenantContext. Company B has a DISABLED rule of the same alert_type, a recent alert with the same
 * dedup key, and an unacknowledged alert.
 */
export {};
import { createHash } from 'crypto';
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
import { systemTenantContext } from '../../db/tenantTable';
import { acknowledgeAlert, listAlertRules, listAlerts, raiseAlert, upsertAlertRule } from '../../services/alertRoutingService';
/* eslint-disable @typescript-eslint/no-var-requires */
const route = require('../../../pages/api/active-leads/alerts').default;
/* eslint-enable @typescript-eslint/no-var-requires */

const tA = systemTenantContext(A, 's2 alert routing test');
const dedup = createHash('sha256').update('high_intent_detected|cluster:1').digest('hex').slice(0, 24);
beforeEach(() => {
  resetDb();
  mockDb.alert_rules = [{ id: 'rule-b', organization_id: B, alert_type: 'high_intent_detected', enabled: false, min_severity: 'critical', rate_limit_minutes: 60 }];
  mockDb.alerts = [{ id: 'alert-b', organization_id: B, alert_type: 'high_intent_detected', dedup_key: dedup, created_at: new Date().toISOString(), acknowledged_at: null }];
});
const raise = () => raiseAlert({ tenant: tA, alertType: 'high_intent_detected', severity: 'medium', dedupKey: 'cluster:1', title: 't', body: 'b' });

describe('alertRoutingService through the tenant seam', () => {
  it("raise(A) ignores B's disabled rule and B's recent alert; the alert is stamped with A", async () => {
    const r = await raise();
    expect(r).toMatchObject({ ok: true, deduped: false });
    expect(writes('alerts')[0].payload.organization_id).toBe(A);
    expect((r as any).alert.alert_rule_id).toBeNull();
  });
  it("upsertRule(A) inserts A's rule (B's same-type rule untouched); list(A) shows only A", async () => {
    const rule = await upsertAlertRule({ tenant: tA, alertType: 'high_intent_detected', enabled: true, minSeverity: 'low', rateLimitMinutes: 5, createdBy: 'user-a' });
    expect(rule).toMatchObject({ organization_id: A, enabled: true });
    await upsertAlertRule({ tenant: tA, alertType: 'high_intent_detected', enabled: true, minSeverity: 'high', rateLimitMinutes: 5, createdBy: 'user-a' });
    expect(writes('alert_rules').map((w) => w.op)).toEqual(['insert', 'update']);
    expect(pinnedTo('alert_rules', 'organization_id', A)).toBe(true);
    expect(mockDb.alert_rules.find((r) => r.id === 'rule-b')).toMatchObject({ enabled: false, min_severity: 'critical' });
    expect((await listAlertRules(tA)).map((r: any) => r.organization_id)).toEqual([A]);
  });
  it("ack(A, B's alert id) touches nothing; listAlerts(A) excludes B", async () => {
    expect(await acknowledgeAlert(tA, 'alert-b', 'user-a')).toBeNull();
    expect(pinnedTo('alerts', 'organization_id', A)).toBe(true);
    expect(mockDb.alerts.find((r) => r.id === 'alert-b')!.acknowledged_at).toBeNull();
    expect(await listAlerts(tA)).toEqual([]);
  });
});

describe('pages/api/active-leads/alerts builds the context from its access check', () => {
  it('PUT for A writes A; POST ack for B is refused by the access check', async () => {
    const ok = await call(route, 'PUT', {}, { companyId: A, rule: { alertType: 'high_intent_detected', minSeverity: 'low' } });
    expect(ok.statusCode).toBe(200);
    expect(writes('alert_rules')[0].payload.organization_id).toBe(A);
    const no = await call(route, 'POST', {}, { companyId: B, alertId: 'alert-b', action: 'acknowledge' });
    expect(no.statusCode).toBe(403);
    expect(mockDb.alerts.find((r) => r.id === 'alert-b')!.acknowledged_at).toBeNull();
  });
});
