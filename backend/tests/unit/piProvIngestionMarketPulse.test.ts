/**
 * Prospect provenance (Agent 2) — MarketPulse: one tenant's processing must not
 * overwrite the shared `marketpulse_signals` evidence another tenant references;
 * each tenant's adopted snapshot carries its OWN observation and provenance.
 */
type Row = Record<string, unknown>;
const db = {
  tables: {} as Record<string, Row[]>,
  ops: [] as Array<{ table: string; op: string }>,
  nextId: 1,
};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const st = { op: 'select', payload: null as Row | Row[] | null, filters: [] as Array<[string, unknown]> };
    const rows = (): Row[] => (db.tables[table] ??= []);
    const match = (r: Row) => st.filters.every(([c, v]) => r[c] === v);
    const exec = async (single: boolean) => {
      await Promise.resolve();
      db.ops.push({ table, op: st.op });
      if (st.op === 'insert') {
        const list = Array.isArray(st.payload) ? st.payload : [st.payload as Row];
        if (table === 'marketpulse_signals') {
          const p = list[0];
          if (p.duplicate_key && rows().some((r) => r.duplicate_key === p.duplicate_key)) {
            return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "idx_marketpulse_signals_duplicate_key"' } };
          }
        }
        const created = list.map((p) => ({ id: `${table}-${db.nextId++}`, created_at: '2026-10-01T00:00:00.000Z', ...p }));
        rows().push(...created);
        return { data: single ? created[0] : created, error: null };
      }
      if (st.op === 'upsert' || st.op === 'update') {
        const p = st.payload as Row;
        if (table === 'marketpulse_company_signal_relevance') {
          const existing = rows().find((r) => r.company_id === p.company_id && r.signal_id === p.signal_id);
          if (existing) Object.assign(existing, p); else rows().push({ id: `rel-${db.nextId++}`, ...p });
          return { data: p, error: null };
        }
        throw new Error(`unexpected ${st.op} on ${table}`);
      }
      const hit = rows().filter(match);
      return { data: single ? (hit[0] ?? null) : hit, error: null };
    };
    const api: Record<string, unknown> = {
      select: () => api,
      insert: (p: Row | Row[]) => { st.op = 'insert'; st.payload = p; return api; },
      upsert: (p: Row) => { st.op = 'upsert'; st.payload = p; return api; },
      update: (p: Row) => { st.op = 'update'; st.payload = p; return api; },
      eq: (c: string, v: unknown) => { st.filters.push([c, v]); return api; },
      limit: () => api,
      order: () => api,
      maybeSingle: () => exec(true),
      single: () => exec(true),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => exec(false).then(res, rej),
    };
    return api;
  },
}));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => ({}) } }));
jest.mock('../../services/companyContextIntelligenceService', () => ({ getCompanyContextIntelligence: async () => null }));
jest.mock('../../services/companyContextEnrichmentService', () => ({
  calculateContextQualityMetadata: () => ({ context_reliability_score: 70, intelligence_density_score: 70, degraded_context: false, degradation_reasons: [] }),
}));
const adoptLead = jest.fn();
jest.mock('../../services/leadIntelligence/leadIntelligenceRuntime', () => ({ adoptLead: (...a: unknown[]) => adoptLead(...a) }));

import { buildSignalFromFinding, persistMarketPulseSignalForCompany } from '../../services/marketPulseIntelligenceService';

const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000bb';

const build = (summary: string) => buildSignalFromFinding({
  title: 'Cloud pricing shift', summary, category: 'technology', regions: ['EU'], impactType: 'risk',
  confidenceScore: 60, freshnessScore: 80, momentumScore: 0.5, canonicalEventKey: 'cloud-pricing', sourceName: 'Market Pulse legacy scan',
});

beforeEach(() => { db.tables = {}; db.ops = []; db.nextId = 1; adoptLead.mockClear(); });

describe('shared signal is never overwritten across tenants', () => {
  it("tenant B's run does not mutate the row tenant A created", async () => {
    const a = build('Tenant A wording');
    await persistMarketPulseSignalForCompany({ companyId: ORG_A, ...a, provenance: { runId: 'run-a', findingId: 'f-a', observedAt: '2026-10-29T04:30:00.000Z' } });
    const sharedBefore = { ...db.tables.marketpulse_signals[0] };

    const b = build('Tenant B wording');
    const res = await persistMarketPulseSignalForCompany({ companyId: ORG_B, ...b, provenance: { runId: 'run-b', findingId: 'f-b', observedAt: '2026-10-30T04:30:00.000Z' } });

    expect(db.tables.marketpulse_signals).toHaveLength(1);
    expect(db.tables.marketpulse_signals[0]).toEqual(sharedBefore);
    expect(db.ops.filter((o) => o.table === 'marketpulse_signals' && (o.op === 'upsert' || o.op === 'update'))).toEqual([]);
    // B's own result reflects B's observation, under the shared id.
    expect(res.signal).toMatchObject({ id: sharedBefore.id, summary: 'Tenant B wording' });
  });

  it('each tenant gets its own relevance row and its own adopted snapshot + provenance', async () => {
    await persistMarketPulseSignalForCompany({ companyId: ORG_A, ...build('A'), provenance: { runId: 'run-a', findingId: 'f-a', observedAt: '2026-10-29T04:30:00.000Z' } });
    await persistMarketPulseSignalForCompany({ companyId: ORG_B, ...build('B'), provenance: { runId: 'run-b', findingId: 'f-b', observedAt: '2026-10-30T04:30:00.000Z' } });
    const sharedId = db.tables.marketpulse_signals[0].id;

    expect(db.tables.marketpulse_company_signal_relevance.map((r) => r.company_id).sort()).toEqual([ORG_A, ORG_B]);

    const [[srcA, rowA], [srcB, rowB]] = adoptLead.mock.calls as Array<[string, Row]>;
    expect(srcA).toBe('marketpulse');
    expect(srcB).toBe('marketpulse');
    expect(rowA).toMatchObject({ id: sharedId, company_id: ORG_A, summary: 'A', created_at: '2026-10-29T04:30:00.000Z' });
    expect(rowB).toMatchObject({ id: sharedId, company_id: ORG_B, summary: 'B', created_at: '2026-10-30T04:30:00.000Z' });
    expect(rowA.provenance).toEqual({
      source_category: 'marketpulse', platform: 'marketpulse', external_ref: `marketpulse:${sharedId}`,
      observed_at: '2026-10-29T04:30:00.000Z', source_url: null, run_id: 'run-a', finding_id: 'f-a',
      shared_signal_created: true, shared_signal_created_at: '2026-10-01T00:00:00.000Z',
    });
    expect(rowB.provenance).toMatchObject({ run_id: 'run-b', finding_id: 'f-b', shared_signal_created: false });
  });

  it('a retry by the same tenant is idempotent: one signal, one relevance row', async () => {
    await persistMarketPulseSignalForCompany({ companyId: ORG_A, ...build('A') });
    await persistMarketPulseSignalForCompany({ companyId: ORG_A, ...build('A') });
    expect(db.tables.marketpulse_signals).toHaveLength(1);
    expect(db.tables.marketpulse_company_signal_relevance).toHaveLength(1);
    expect(db.tables.marketpulse_signal_impacts.length).toBeGreaterThan(0);
  });

  it('without provenance the observation falls back to the signal\'s own published_at', async () => {
    const s = build('A');
    await persistMarketPulseSignalForCompany({ companyId: ORG_A, ...s });
    const row = adoptLead.mock.calls[0][1] as Row;
    expect((row.provenance as Row).observed_at).toBe(s.signal.published_at);
  });

  it('a non-duplicate insert failure still throws (no silent success)', async () => {
    const s = build('A');
    (s.signal as Row).duplicate_key = null;
    db.tables.marketpulse_signals = [];
    const mod = jest.requireMock('../../db/writeOwner') as { ownedDbTable: (t: string) => unknown };
    const orig = mod.ownedDbTable;
    mod.ownedDbTable = (t: string) => {
      const api = orig(t) as Record<string, unknown>;
      if (t === 'marketpulse_signals') api.single = async () => ({ data: null, error: { code: '42501', message: 'permission denied' } });
      return api;
    };
    try {
      await expect(persistMarketPulseSignalForCompany({ companyId: ORG_A, ...s })).rejects.toThrow('permission denied');
    } finally {
      mod.ownedDbTable = orig;
    }
  });
});
