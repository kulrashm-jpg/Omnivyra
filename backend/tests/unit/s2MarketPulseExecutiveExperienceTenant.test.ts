/**
 * S2 tenant seam (e1-d) - marketPulseExecutiveExperienceService: every marketpulse_* read / write goes through
 * tenantTable with the caller's TenantContext. Every company-B row shares its id (and, where it has one, its
 * entity / dedupe key) with a company-A row, so a missing tenant predicate shows up as a leak or a cross-tenant write.
 *
 * HEAD control: S2_CONTROL=head calls the pre-seam signatures (raw company id) through the adapters below.
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
        const r = { id: p.id ?? `${table}-${++mockSeq}`, created_at: new Date().toISOString(), ...p };
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
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/contentArchitectService', () => ({
  resolveCompanyAccess: async (_req: any, res: any, companyId: string) => (companyId === '11111111-1111-4111-8111-111111111111'
    ? { userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'COMPANY_ADMIN' } : (res.status(403).json({ error: 'FORBIDDEN' }), null)),
}));

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-11-12T10:00:00.000Z');
const DAY = NOW.toISOString().slice(0, 10);
const writes = (t?: string) => mockWrites.filter((w) => !t || w.table === t);
/** Every write is stamped with A (insert/upsert) or carries the eq(company_id, A) predicate (update/delete). */
const allPinnedToA = () => writes().every((w) =>
  (w.op === 'insert' || w.op === 'upsert')
    ? (Array.isArray(w.payload) ? w.payload : [w.payload]).every((p: Row) => p.company_id === A)
    : w.filters.some(([k, c, v]) => k === 'eq' && c === 'company_id' && v === A));
const resetDb = () => { for (const k of Object.keys(mockDb)) delete mockDb[k]; mockWrites.length = 0; mockSeq = 0; };
async function call(h: any, method: string, query: Row, body: Row = {}) {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (x: unknown) => { res.body = x; return res; };
  res.setHeader = () => res;
  await h({ method, headers: {}, query, body, cookies: {} }, res);
  return res;
}

import { systemTenantContext } from '../../db/tenantTable';
import * as svc from '../../services/marketPulseExecutiveExperienceService';
/* eslint-disable @typescript-eslint/no-var-requires */
const route = require('../../../pages/api/market-pulse/watchlist').default;
/* eslint-enable @typescript-eslint/no-var-requires */

const HEAD = process.env.S2_CONTROL === 'head';
const tA = systemTenantContext(A, 's2 market pulse executive experience test');
const anySvc = svc as any;
/** Adapters: the seam signature, or (control) the pre-seam raw-id signature. */
const synth = (ctx: any) => (HEAD ? anySvc.synthesizeMarketPulseExecutiveExperience(ctx?.companyId) : anySvc.synthesizeMarketPulseExecutiveExperience(ctx));
const getExp = (ctx: any, v = 'executive') => (HEAD ? anySvc.getMarketPulseExecutiveExperience(ctx?.companyId, v) : anySvc.getMarketPulseExecutiveExperience(ctx, v));
const saveWatch = (ctx: any, p: Row) => (HEAD ? anySvc.saveMarketPulseWatchlistItem({ companyId: ctx?.companyId, ...p }) : anySvc.saveMarketPulseWatchlistItem(ctx, p));

const twoDaysAgo = new Date(NOW.getTime() - 2 * 86400000).toISOString();
function seed() {
  // Same ids for A and B everywhere; B's rows are all "louder" so a leak changes the output.
  mockDb.marketpulse_business_pressures = [
    { id: 'p1', company_id: A, severity: 70, confidence: 60, pressure_type: 'demand', narrative_summary: 'A pressure', title: 'A pressure' },
    { id: 'p1', company_id: B, severity: 99, confidence: 99, pressure_type: 'compliance', narrative_summary: 'B-SECRET pressure', title: 'B-SECRET' },
  ];
  mockDb.marketpulse_business_impacts = [{ id: 'i1', company_id: B, severity: 95, narrative_summary: 'B-SECRET impact' }];
  mockDb.marketpulse_operational_consequences = [{ id: 'c1', company_id: B, severity: 95, narrative_summary: 'B-SECRET consequence' }];
  mockDb.marketpulse_narratives = [{ id: 'n1', company_id: B, severity: 95, narrative_summary: 'B-SECRET opportunity narrative' }];
  mockDb.marketpulse_watchlists = [
    { id: 'w1', company_id: A, watchlist_type: 'competitor', watchlist_value: 'a-co', priority_level: 'normal', muted: false, updated_at: twoDaysAgo },
    { id: 'w1', company_id: B, watchlist_type: 'competitor', watchlist_value: 'acme', priority_level: 'critical', muted: true, updated_at: NOW.toISOString() },
  ];
  // A's previous severity 50 -> A's p1 (70) is escalating. B's row for the same entity is muted at 99.
  mockDb.marketpulse_lifecycle_states = [
    { id: 'l1', company_id: A, entity_type: 'pressure', entity_id: 'p1', lifecycle_state: 'monitored', severity: 50, transition_count: 1, updated_at: twoDaysAgo },
    { id: 'l1', company_id: B, entity_type: 'pressure', entity_id: 'p1', lifecycle_state: 'muted', severity: 99, transition_count: 7, updated_at: NOW.toISOString() },
  ];
  // A has today's escalation (to be coalesced) created 2 days ago in clock terms; B has the SAME id, key and entity, created now.
  mockDb.marketpulse_escalation_events = [
    { id: 'e1', company_id: A, entity_type: 'pressure', entity_id: 'p1', dedupe_key: `pressure:p1:escalated:${DAY}`, created_at: twoDaysAgo, coalesced_count: 1, alert_fatigue_guard: {} },
    { id: 'e1', company_id: B, entity_type: 'pressure', entity_id: 'p1', dedupe_key: `pressure:p1:escalated:${DAY}`, created_at: NOW.toISOString(), coalesced_count: 5, alert_fatigue_guard: {} },
  ];
  mockDb.marketpulse_executive_overviews = [
    { id: 'o1', company_id: A, view_type: 'executive', generated_at: twoDaysAgo, overview_payload: { summary: 'A overview' } },
    { id: 'o1', company_id: B, view_type: 'executive', generated_at: NOW.toISOString(), overview_payload: { summary: 'B-SECRET overview' } },
  ];
  mockDb.marketpulse_digest_items = [
    { id: 'd1', company_id: A, digest_type: 'executive', priority_rank: 5, summary: 'A digest' },
    { id: 'd1', company_id: B, digest_type: 'executive', priority_rank: 1, summary: 'B-SECRET digest' },
  ];
  mockDb.marketpulse_workflow_hooks = [
    { id: 'h1', company_id: A, created_at: twoDaysAgo, hook_type: 'leadership_summary' },
    { id: 'h1', company_id: B, created_at: NOW.toISOString(), hook_type: 'leadership_summary' },
  ];
}
const snapshotB = () => JSON.stringify(Object.values(mockDb).flat().filter((r) => r.company_id === B));

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'queueMicrotask'] });
  resetDb();
  seed();
});
afterEach(() => jest.useRealTimers());

describe('marketPulseExecutiveExperienceService through the tenant seam', () => {
  it("synthesize(A) reads only A's inputs; every write is stamped with / pinned to A; B's rows are unchanged", async () => {
    const before = snapshotB();
    const out = await synth(tA);
    expect(writes().length).toBeGreaterThan(0);
    expect(allPinnedToA()).toBe(true);
    expect(JSON.stringify(out)).not.toContain('B-SECRET');
    expect(out.digestItems.map((d: Row) => d.source_pressure_id)).toEqual(['p1']);
    expect(snapshotB()).toBe(before);
  });

  it("synthesize(A): A's lifecycle continues from A's own row (B's muted row for the same entity does not leak)", async () => {
    await synth(tA);
    const aRows = mockDb.marketpulse_lifecycle_states.filter((r) => r.company_id === A);
    expect(aRows).toHaveLength(1);
    expect(aRows[0]).toMatchObject({ lifecycle_state: 'escalating', previous_severity: 50, transition_count: 2 });
    expect(writes('marketpulse_lifecycle_states').find((w) => w.op === 'upsert')!.options).toMatchObject({ onConflict: 'company_id,entity_type,entity_id' });
  });

  it("synthesize(A): coalescing A's escalation updates only A's event, never B's event with the same id", async () => {
    await synth(tA);
    const [a, b] = ['A', 'B'].map((t) => mockDb.marketpulse_escalation_events.find((r) => r.company_id === (t === 'A' ? A : B))!);
    expect(a.coalesced_count).toBe(2);
    expect(b.coalesced_count).toBe(5);
    const upd = writes('marketpulse_escalation_events').filter((w) => w.op === 'update');
    expect(upd).toHaveLength(1);
    expect(upd[0].filters).toEqual(expect.arrayContaining([['eq', 'company_id', A], ['eq', 'id', 'e1']]));
  });

  it("get(A) returns only A's overview, digest, lifecycle, escalations, hooks and watchlists", async () => {
    const out = await getExp(tA);
    expect(JSON.stringify(out)).not.toContain('B-SECRET');
    expect(out.overview).toMatchObject({ company_id: A });
    for (const k of ['digestItems', 'lifecycle', 'escalations', 'workflowHooks', 'watchlists']) {
      expect(out[k].length).toBe(1);
      expect(out[k].every((r: Row) => r.company_id === A)).toBe(true);
    }
    expect(writes()).toHaveLength(0);
  });

  it("saveWatchlistItem(A) for B's (type, value) inserts A's own row; B's row is untouched", async () => {
    const before = snapshotB();
    const item = await saveWatch(tA, { watchlistType: 'competitor', watchlistValue: 'acme', priorityLevel: 'normal', actorUserId: null });
    expect(item).toMatchObject({ company_id: A, watchlist_value: 'acme', priority_level: 'normal' });
    expect(allPinnedToA()).toBe(true);
    expect(snapshotB()).toBe(before);
  });

  it('no tenant context: refused before any database access', async () => {
    await expect(synth(undefined)).rejects.toThrow(/TENANT_CONTEXT_MISSING/);
    await expect(getExp(undefined)).rejects.toThrow(/TENANT_CONTEXT_MISSING/);
    expect(writes()).toHaveLength(0);
  });
});

describe('pages/api/market-pulse/watchlist builds the context from its access check', () => {
  it("GET for A lists only A's watchlists; POST for B is refused by the access check and writes nothing", async () => {
    const ok = await call(route, 'GET', { companyId: A });
    expect(ok.statusCode).toBe(200);
    expect(ok.body.watchlists.map((w: Row) => w.company_id)).toEqual([A]);
    const no = await call(route, 'POST', { companyId: B }, { watchlistType: 'competitor', watchlistValue: 'x' });
    expect(no.statusCode).toBe(403);
    expect(writes()).toHaveLength(0);
  });
  it('POST for A writes a watchlist row stamped with A', async () => {
    const ok = await call(route, 'POST', { companyId: A }, { watchlistType: 'competitor', watchlistValue: 'acme' });
    expect(ok.statusCode).toBe(200);
    expect(ok.body.item).toMatchObject({ company_id: A, watchlist_value: 'acme' });
    expect(allPinnedToA()).toBe(true);
  });
});
