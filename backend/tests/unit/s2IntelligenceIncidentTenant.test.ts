/**
 * S2 tenant seam (e1-d) - intelligenceIncidentService: intelligence_incidents and incident_timeline_entries reads /
 * writes go through tenantTable with the caller's TenantContext. Every company-B incident shares its id with a
 * company-A incident, and B's timeline rows hang off the same incident id.
 *
 * HEAD control: S2_CONTROL=head calls the pre-seam signatures (organizationId in the input) through the adapters.
 */
export {};
type Row = Record<string, any>;
type Filter = [string, string, unknown];
const mockDb: Record<string, Row[]> = {};
const mockWrites: Array<{ table: string; op: string; filters: Filter[]; payload: any; options?: any }> = [];
let mockSeq = 0;
/** Faithful in-memory PostgREST double: every filter is APPLIED, every write persisted and recorded with its filters. */
function mockTable(table: string) {
  const filters: Filter[] = [];
  const tests: Array<(r: Row) => boolean> = [];
  let op = 'select'; let payload: any = null; let options: any = undefined; let mode: 'many' | 'single' | 'maybe' = 'many';
  let lim = Infinity; const ords: Array<[string, boolean]> = [];
  const add = (kind: string, c: string, v: unknown, t: (r: Row) => boolean) => { filters.push([kind, c, v]); tests.push(t); return b; };
  const run = () => {
    const rows = (mockDb[table] = mockDb[table] ?? []);
    let out: Row[];
    if (op === 'insert' || op === 'upsert') {
      const list = (Array.isArray(payload) ? payload : [payload]) as Row[];
      const conflict = op === 'upsert' && typeof options?.onConflict === 'string' ? String(options.onConflict).split(',').map((x) => x.trim()) : null;
      out = list.map((p) => {
        if (op === 'upsert') {
          const keys = conflict ?? ['id'];
          const hit = rows.find((r) => keys.every((k) => p[k] !== undefined && r[k] === p[k]));
          if (hit) { if (!options?.ignoreDuplicates) Object.assign(hit, p); return { ...hit }; }
        }
        const r = { id: p.id ?? `${table}-${++mockSeq}`, created_at: `2026-11-12T10:00:${String(mockSeq).padStart(2, '0')}.000Z`, ...p };
        rows.push(r);
        return { ...r };
      });
      mockWrites.push({ table, op, filters: [...filters], payload, options });
    } else {
      const hit = rows.filter((r) => tests.every((t) => t(r)));
      if (op === 'update') { hit.forEach((r) => Object.assign(r, payload)); mockWrites.push({ table, op, filters: [...filters], payload }); }
      if (op === 'delete') { for (const h of hit) rows.splice(rows.indexOf(h), 1); mockWrites.push({ table, op, filters: [...filters], payload: null }); }
      out = hit.map((r) => ({ ...r }));
      for (const [c, asc] of [...ords].reverse()) out.sort((x, y) => (x[c] < y[c] ? -1 : x[c] > y[c] ? 1 : 0) * (asc ? 1 : -1));
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
    order: (c: string, o?: { ascending?: boolean }) => { ords.push([c, o?.ascending !== false]); return b; },
    limit: (n: number) => { lim = n; return b; },
    insert: (p: any, o?: any) => { op = 'insert'; payload = p; options = o; return b; },
    upsert: (p: any, o?: any) => { op = 'upsert'; payload = p; options = o; return b; },
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
const mockPublished: Array<{ kind: string; organizationId: string }> = [];
jest.mock('../../services/realtimePublisherService', () => ({ publishRealtime: async (a: any) => { mockPublished.push({ kind: 'realtime', organizationId: a.organizationId }); } }));
jest.mock('../../events/listeningEvents', () => ({
  publishIncidentCreated: async (a: any) => { mockPublished.push({ kind: 'created', organizationId: a.organizationId }); },
  publishIncidentUpdated: async (a: any) => { mockPublished.push({ kind: 'updated', organizationId: a.organizationId }); },
}));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/userContextService', () => ({
  enforceCompanyAccess: async ({ res, companyId }: any) => (companyId === '11111111-1111-4111-8111-111111111111'
    ? { userId: 'user-a', companyId } : (res.status(403).json({ error: 'FORBIDDEN' }), null)),
}));
jest.mock('../../services/rbacService', () => ({ getUserRole: async () => ({ role: 'COMPANY_ADMIN', error: null }) }));
jest.mock('../../services/rbac/communityAiCapabilities', () => ({ hasCommunityAiCapability: () => true }));

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const writes = (t?: string) => mockWrites.filter((w) => !t || w.table === t);
/** Every write is stamped with A (insert/upsert) or carries the eq(organization_id, A) predicate (update/delete). */
const allPinnedToA = () => writes().every((w) =>
  (w.op === 'insert' || w.op === 'upsert')
    ? (Array.isArray(w.payload) ? w.payload : [w.payload]).every((p: Row) => p.organization_id === A)
    : w.filters.some(([k, c, v]) => k === 'eq' && c === 'organization_id' && v === A));
const resetDb = () => { for (const k of Object.keys(mockDb)) delete mockDb[k]; mockWrites.length = 0; mockSeq = 0; mockPublished.length = 0; };
async function call(h: any, method: string, query: Row, body: Row = {}) {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (x: unknown) => { res.body = x; return res; };
  res.setHeader = () => res;
  await h({ method, headers: {}, query, body }, res);
  return res;
}

import { systemTenantContext } from '../../db/tenantTable';
import * as svc from '../../services/intelligenceIncidentService';
/* eslint-disable @typescript-eslint/no-var-requires */
const route = require('../../../pages/api/active-leads/incidents').default;
/* eslint-enable @typescript-eslint/no-var-requires */

const HEAD = process.env.S2_CONTROL === 'head';
const tA = systemTenantContext(A, 's2 intelligence incident test');
const s = svc as any;
const create = (ctx: any, input: Row) => (HEAD ? s.createIncident({ organizationId: ctx.companyId, ...input }) : s.createIncident(ctx, input));
const update = (ctx: any, input: Row) => (HEAD ? s.updateIncident({ organizationId: ctx.companyId, ...input }) : s.updateIncident(ctx, input));
const note = (ctx: any, input: Row) => (HEAD ? s.addIncidentNote({ organizationId: ctx.companyId, ...input }) : s.addIncidentNote(ctx, input));
const get = (ctx: any, id: string) => s.getIncident(HEAD ? ctx.companyId : ctx, id);
const list = (ctx: any, o?: Row) => s.listIncidents(HEAD ? ctx.companyId : ctx, o);

function seed() {
  mockDb.intelligence_incidents = [
    { id: 'inc1', organization_id: A, title: 'A incident', status: 'open', severity: 'sev3', owner_user_id: null, linked_escalation_id: null, linked_replay_id: null, created_at: '2026-11-11T00:00:00.000Z' },
    { id: 'inc1', organization_id: B, title: 'B-SECRET incident', status: 'open', severity: 'sev1', owner_user_id: null, linked_escalation_id: null, linked_replay_id: null, created_at: '2026-11-11T00:00:00.000Z' },
    { id: 'inc-b', organization_id: B, title: 'B-SECRET only', status: 'open', severity: 'sev1', owner_user_id: null, created_at: '2026-11-11T00:00:00.000Z' },
  ];
  mockDb.incident_timeline_entries = [
    { id: 't1', organization_id: A, incident_id: 'inc1', entry_kind: 'created', body: 'A created', created_at: '2026-11-11T00:00:01.000Z' },
    { id: 't1', organization_id: B, incident_id: 'inc1', entry_kind: 'note', body: 'B-SECRET note', created_at: '2026-11-11T00:00:02.000Z' },
  ];
}
const snapshotB = () => JSON.stringify(Object.values(mockDb).flat().filter((r) => r.organization_id === B));
beforeEach(() => { resetDb(); seed(); });

describe('intelligenceIncidentService through the tenant seam', () => {
  it('create(A) stamps the incident and its created timeline entry with A; events are published for A', async () => {
    const inc = await create(tA, { title: 'New', category: 'other', createdBy: 'user-a' });
    expect(inc).toMatchObject({ organization_id: A, title: 'New', status: 'open' });
    expect(writes().map((w) => [w.table, w.op])).toEqual([['intelligence_incidents', 'insert'], ['incident_timeline_entries', 'insert']]);
    expect(allPinnedToA()).toBe(true);
    expect(mockPublished.every((p) => p.organizationId === A)).toBe(true);
  });

  it("update(A, inc1) changes only A's inc1 (B's inc1 shares the id and is untouched); timeline stamped with A", async () => {
    const before = snapshotB();
    const out = await update(tA, { incidentId: 'inc1', status: 'resolved', actorUserId: 'user-a' });
    expect(out).toMatchObject({ id: 'inc1', organization_id: A, status: 'resolved' });
    expect(snapshotB()).toBe(before);
    expect(allPinnedToA()).toBe(true);
    const upd = writes('intelligence_incidents').filter((w) => w.op === 'update');
    expect(upd).toHaveLength(1);
    expect(upd[0].filters).toEqual(expect.arrayContaining([['eq', 'organization_id', A], ['eq', 'id', 'inc1']]));
  });

  it("update(A, an incident only B has) is not found and writes nothing", async () => {
    await expect(update(tA, { incidentId: 'inc-b', status: 'resolved', actorUserId: 'user-a' })).rejects.toThrow(/incident_not_found/);
    expect(writes()).toHaveLength(0);
  });

  it("note(A, an incident only B has) is refused and appends nothing", async () => {
    await expect(Promise.resolve().then(() => note(tA, { incidentId: 'inc-b', body: 'x', actorUserId: 'user-a' }))).rejects.toThrow(/incident_not_found/);
    expect(writes()).toHaveLength(0);
  });

  it("note(A, inc1) appends a timeline entry stamped with A", async () => {
    const e = await note(tA, { incidentId: 'inc1', body: 'hello', actorUserId: 'user-a' });
    expect(e).toMatchObject({ organization_id: A, incident_id: 'inc1', entry_kind: 'note', body: 'hello' });
    expect(allPinnedToA()).toBe(true);
  });

  it("get(A, inc1) returns A's incident and only A's timeline; list(A) excludes B", async () => {
    const out = await get(tA, 'inc1');
    expect(out.incident).toMatchObject({ organization_id: A, title: 'A incident' });
    expect(out.timeline.map((t: Row) => t.organization_id)).toEqual([A]);
    expect(JSON.stringify(out)).not.toContain('B-SECRET');
    const items = await list(tA);
    expect(items.map((i: Row) => i.organization_id)).toEqual([A]);
    expect(writes()).toHaveLength(0);
  });

  it('no tenant context: refused before any database access', async () => {
    await expect(Promise.resolve().then(() => s.listIncidents(undefined))).rejects.toThrow(/TENANT_CONTEXT_MISSING/);
    await expect(Promise.resolve().then(() => s.getIncident(undefined, 'inc1'))).rejects.toThrow(/TENANT_CONTEXT_MISSING/);
    expect(writes()).toHaveLength(0);
  });
});

describe('pages/api/active-leads/incidents builds the context from its access check', () => {
  it("GET list for A shows only A; POST update for B is refused by the access check and writes nothing", async () => {
    const ok = await call(route, 'GET', { companyId: A });
    expect(ok.statusCode).toBe(200);
    expect(ok.body.items.map((i: Row) => i.organization_id)).toEqual([A]);
    const no = await call(route, 'POST', {}, { companyId: B, action: 'update', incidentId: 'inc1', status: 'resolved' });
    expect(no.statusCode).toBe(403);
    expect(writes()).toHaveLength(0);
  });
  it("POST update for A resolves A's inc1 only", async () => {
    const before = snapshotB();
    const ok = await call(route, 'POST', {}, { companyId: A, action: 'update', incidentId: 'inc1', status: 'resolved' });
    expect(ok.statusCode).toBe(200);
    expect(ok.body.incident).toMatchObject({ organization_id: A, status: 'resolved' });
    expect(snapshotB()).toBe(before);
  });
  it("POST update / note naming an incident only B has is the uniform 404 (never a 500), with no writes", async () => {
    const upd = await call(route, 'POST', {}, { companyId: A, action: 'update', incidentId: 'inc-b', status: 'resolved' });
    const nt = await call(route, 'POST', {}, { companyId: A, action: 'note', incidentId: 'inc-b', body: 'x' });
    expect([upd.statusCode, upd.body.error]).toEqual([404, 'incident_not_found']);
    expect([nt.statusCode, nt.body.error]).toEqual([404, 'incident_not_found']);
    expect(writes()).toHaveLength(0);
  });
});
