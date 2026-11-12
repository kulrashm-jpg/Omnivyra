/**
 * S2 tenant seam (e1-d) - marketPulseV2ServiceModel: market_pulse_runs / market_pulse_findings reads and writes go
 * through tenantTable with the caller's TenantContext. Every company-B row shares its id (runs) or run_id + id
 * (findings) with a company-A row, so a read keyed only by id / run_id shows up as a leak.
 *
 * HEAD control: S2_CONTROL=head calls the pre-seam signatures (raw company id) through the adapters below.
 */
export {};
type Row = Record<string, any>;
type Filter = [string, string, unknown];
const mockDb: Record<string, Row[]> = {};
const mockWrites: Array<{ table: string; op: string; filters: Filter[]; payload: any; options?: any }> = [];
/** One-shot errors returned by the next insert into a table (models PostgREST's missing-column error). */
const mockInsertErrors: Record<string, Array<{ message: string }>> = {};
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
      const injected = op === 'insert' ? mockInsertErrors[table]?.shift() : undefined;
      if (injected) return { data: null, error: injected };
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
// getMarketPulseContext's sibling services (other units) are stubbed: this suite covers this file's own DB sites.
const mockGetExp = jest.fn(async () => ({ overview: null }));
jest.mock('../../services/context/canonicalProfileAdapter', () => ({
  getCanonicalProfile: async () => ({ name: 'A Co', geography: 'IN', geography_list: ['IN'], report_settings: { market_pulse: {} } }),
}));
jest.mock('../../services/companyContextService', () => ({ buildCompanyContext: () => ({}) }));
jest.mock('../../services/companyContextIntelligenceService', () => ({ getCompanyContextIntelligence: async () => null }));
jest.mock('../../services/companyIntelligence', () => ({ adoptMarketPulseIdentity: (s: unknown) => s }));
jest.mock('../../services/marketPulse/executorContext', () => ({ buildExecutorContext: () => ({}) }));
jest.mock('../../services/marketPulse/scoringService', () => ({}));
jest.mock('../../services/intelligenceAlertService', () => ({}));
jest.mock('../../services/marketPulse/trustScoringService', () => ({}));
jest.mock('../../services/marketPulse/interpretationService', () => ({}));
jest.mock('../../services/marketPulse/changeIntelligenceService', () => ({}));
jest.mock('../../services/marketPulse/correlationEnrichmentService', () => ({}));
jest.mock('../../services/marketPulse/alertClassifierService', () => ({}));
jest.mock('../../services/marketPulse/crossProductCorrelationService', () => ({}));
jest.mock('../../services/marketPulse/marketMemoryEvolutionService', () => ({}));
jest.mock('../../services/marketPulse/executivePanelsService', () => ({}));
jest.mock('../../services/marketPulseIntelligenceService', () => ({ getAdaptiveMarketPulseFeed: async () => [] }));
jest.mock('../../services/marketPulseSynthesisService', () => ({ getMarketPulseSynthesis: async () => null }));
jest.mock('../../services/marketPulseBusinessImpactService', () => ({ getMarketPulseBusinessImpact: async () => null }));
jest.mock('../../services/marketPulseExecutiveExperienceService', () => ({ getMarketPulseExecutiveExperience: (...a: unknown[]) => (mockGetExp as any)(...a) }));
jest.mock('../../services/marketPulseCollaborationService', () => ({ getMarketPulseCollaborationContext: async () => null }));
jest.mock('../../services/marketPulseProductionHardeningService', () => ({ getMarketPulseProductionHardening: async () => null }));

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const T0 = '2026-11-10T10:00:00.000Z';
const T1 = '2026-11-12T10:00:00.000Z';
const writes = (t?: string) => mockWrites.filter((w) => !t || w.table === t);
const resetDb = () => {
  for (const k of Object.keys(mockDb)) delete mockDb[k];
  for (const k of Object.keys(mockInsertErrors)) delete mockInsertErrors[k];
  mockWrites.length = 0; mockSeq = 0;
};

import { systemTenantContext } from '../../db/tenantTable';
import * as model from '../../services/marketPulseV2ServiceModel';

const HEAD = process.env.S2_CONTROL === 'head';
const tA = systemTenantContext(A, 's2 market pulse v2 model test');
const m = model as any;
const getRun = (runId: string, ctx: any) => m.getMarketPulseRun(runId, HEAD ? ctx.companyId : ctx);
const createRun = (ctx: any, input: Row, job: string) => m.createMarketPulseRun(HEAD ? ctx.companyId : ctx, input, job);
const insertFinding = (ctx: any, payload: Row) => (HEAD ? m.insertMarketPulseFindingWithSchemaFallback(payload) : m.insertMarketPulseFindingWithSchemaFallback(ctx, payload));

function seed() {
  mockDb.market_pulse_runs = [
    { id: 'run0', company_id: A, status: 'completed', created_at: T0, context_snapshot: {} },
    { id: 'run0', company_id: B, status: 'completed', created_at: T0, context_snapshot: {} },
    { id: 'run1', company_id: A, status: 'completed', created_at: T1, context_snapshot: {}, executive_summary: 'A summary' },
    { id: 'run1', company_id: B, status: 'completed', created_at: T1, context_snapshot: {}, executive_summary: 'B-SECRET summary' },
    { id: 'runB', company_id: B, status: 'completed', created_at: T1, context_snapshot: {}, executive_summary: 'B-SECRET only' },
  ];
  mockDb.market_pulse_findings = [
    { id: 'f0', company_id: A, run_id: 'run0', canonical_event_key: 'k1', title: 'A old', created_at: T0, relevance_score: 50 },
    { id: 'f0', company_id: B, run_id: 'run0', canonical_event_key: 'k2', title: 'B-SECRET old', created_at: T0, relevance_score: 50 },
    { id: 'f1', company_id: A, run_id: 'run1', canonical_event_key: 'k1', title: 'A finding', created_at: T1, relevance_score: 60 },
    { id: 'f1', company_id: B, run_id: 'run1', canonical_event_key: 'k1', title: 'B-SECRET finding', created_at: T1, relevance_score: 99 },
  ];
}
beforeEach(() => { resetDb(); seed(); });

describe('marketPulseV2ServiceModel through the tenant seam', () => {
  it("getRun(A, run1) returns A's run and only A's findings (B's run and findings share the ids)", async () => {
    const out = await getRun('run1', tA);
    expect(out.run).toMatchObject({ company_id: A, executive_summary: 'A summary' });
    expect(out.findings.map((f: Row) => [f.company_id, f.title])).toEqual([[A, 'A finding']]);
    expect(JSON.stringify(out)).not.toContain('B-SECRET');
    expect(writes()).toHaveLength(0);
  });

  it("getRun(A, run1): the market delta compares with A's previous run only (B's run0 findings never appear as retired)", async () => {
    const out = await getRun('run1', tA);
    const delta = out.run.market_delta_summary;
    expect(delta).toMatchObject({ baseline: false, previous_run_id: 'run0' });
    expect(delta.retired_signals).toEqual([]);
    expect(out.findings[0].movement_summary).toMatchObject({ compared_to_finding_id: 'f0', first_observation: false });
  });

  it("getRun(A, a run id only B has) is not found", async () => {
    await expect(getRun('runB', tA)).rejects.toThrow();
  });

  it('createRun(A) inserts a run stamped with A and hands the executive-experience read the tenant context', async () => {
    const input = { mode: 'one_time', objective: 'growth', categories: [], region_scope: 'profile_markets', custom_regions: [], competitor_scope: 'combined' };
    const run = await createRun(tA, input, 'job1');
    expect(run).toMatchObject({ company_id: A, status: 'pending' });
    expect(run.context_snapshot).toMatchObject({ companyId: A, legacy_job_id: 'job1' });
    expect(writes('market_pulse_runs').map((w) => w.payload.company_id)).toEqual([A]);
    expect(mockGetExp).toHaveBeenCalledTimes(1);
    expect((mockGetExp.mock.calls[0] as unknown[])[0]).toMatchObject({ companyId: A, origin: 'system' });
  });

  it('insertFinding(A) refuses a payload naming B (nothing written) and stamps A on a payload without a company', async () => {
    await expect(Promise.resolve().then(() => insertFinding(tA, { run_id: 'run1', company_id: B, title: 'x' }))).rejects.toThrow(/TENANT_MISMATCH/);
    expect(writes()).toHaveLength(0);
    const ok = await insertFinding(tA, { run_id: 'run1', title: 'y' });
    expect(ok.error).toBeNull();
    expect(writes('market_pulse_findings').map((w) => w.payload.company_id)).toEqual([A]);
  });

  it('insertFinding(A): the missing-column fallback still drops the column and the retried row is stamped with A', async () => {
    mockInsertErrors.market_pulse_findings = [{ message: "Could not find the 'legacy_col' column of 'market_pulse_findings'" }];
    const ok = await insertFinding(tA, { run_id: 'run1', company_id: A, title: 'z', legacy_col: 1 });
    expect(ok).toMatchObject({ error: null, droppedColumns: ['legacy_col'] });
    const w = writes('market_pulse_findings');
    expect(w).toHaveLength(1);
    expect(w[0].payload).toMatchObject({ company_id: A, title: 'z' });
    expect(w[0].payload).not.toHaveProperty('legacy_col');
  });
});
