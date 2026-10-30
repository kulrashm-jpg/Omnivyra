/**
 * Workstream E — acceptance #8 (unit): MarketPulse tenant isolation.
 *
 * Tenant B processing the SAME global signal never changes tenant A's
 * observation or the shared `marketpulse_signals` row. Each tenant's own
 * content lands in `marketpulse_signal_observations`, keyed by
 * (company_id, signal_id, observation_key) — the double enforces that unique
 * key exactly as uq_mpso_company_signal_observation does (23505).
 *
 * The real-PostgreSQL proof is backend/tests/realschema/pi_prov_privacy_marketpulse.test.ts.
 */
type Row = Record<string, unknown>;
const db = {
  tables: {} as Record<string, Row[]>,
  ops: [] as Array<{ table: string; op: string }>,
  nextId: 1,
  /** Force the observation insert to fail with this error. */
  observationError: null as { code?: string; message: string } | null,
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
        const p = list[0];
        if (table === 'marketpulse_signals' && p.duplicate_key && rows().some((r) => r.duplicate_key === p.duplicate_key)) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "idx_marketpulse_signals_duplicate_key"' } };
        }
        if (table === 'marketpulse_signal_observations') {
          if (db.observationError) return { data: null, error: db.observationError };
          if (rows().some((r) => r.company_id === p.company_id && r.signal_id === p.signal_id && r.observation_key === p.observation_key)) {
            return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "uq_mpso_company_signal_observation"' } };
          }
        }
        const created = list.map((x) => ({ id: `${table}-${db.nextId++}`, created_at: '2026-10-01T00:00:00.000Z', ...x }));
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
      delete: () => { st.op = 'delete'; return api; },
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
jest.mock('../../services/leadIntelligence/leadIntelligenceRuntime', () => ({ adoptLead: jest.fn() }));

import {
  buildSignalFromFinding,
  marketPulseObservationKey,
  persistMarketPulseSignalForCompany,
  recordMarketPulseObservation,
} from '../../services/marketPulseIntelligenceService';

const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000bb';
const RUN_A = '11111111-1111-4111-8111-111111111111';
const FIND_A = '22222222-2222-4222-8222-222222222222';
const RUN_B = '33333333-3333-4333-8333-333333333333';
const FIND_B = '44444444-4444-4444-8444-444444444444';

const build = (summary: string) => buildSignalFromFinding({
  title: 'Cloud pricing shift', summary, category: 'technology', regions: ['EU'], impactType: 'risk',
  confidenceScore: 60, freshnessScore: 80, momentumScore: 0.5, canonicalEventKey: 'cloud-pricing', sourceName: 'Market Pulse legacy scan',
});

const obs = () => db.tables.marketpulse_signal_observations ?? [];
const writesTo = (table: string) => db.ops.filter((o) => o.table === table && o.op !== 'select' && o.op !== 'insert');

beforeEach(() => { db.tables = {}; db.ops = []; db.nextId = 1; db.observationError = null; });

describe('acceptance #8 — tenant B never changes tenant A\'s observation or the shared row', () => {
  it('two tenants on one global signal: one shared row (untouched), one observation each with own content', async () => {
    const resA = await persistMarketPulseSignalForCompany({
      companyId: ORG_A, ...build('Tenant A wording'),
      provenance: { runId: RUN_A, findingId: FIND_A, observedAt: '2026-10-29T04:30:00.000Z', sourceUrl: 'https://a.example/news' },
    });
    const sharedBefore = { ...db.tables.marketpulse_signals[0] };
    const obsABefore = JSON.parse(JSON.stringify(obs()[0]));

    const resB = await persistMarketPulseSignalForCompany({
      companyId: ORG_B, ...build('Tenant B wording'),
      provenance: { runId: RUN_B, findingId: FIND_B, observedAt: '2026-10-30T04:30:00.000Z' },
    });

    // Shared row: exactly one, byte-identical, never updated/upserted/deleted.
    expect(db.tables.marketpulse_signals).toHaveLength(1);
    expect(db.tables.marketpulse_signals[0]).toEqual(sharedBefore);
    expect(writesTo('marketpulse_signals')).toEqual([]);

    // Observations: one per tenant, A's unchanged by B, never updated/deleted.
    expect(obs()).toHaveLength(2);
    expect(obs().find((r) => r.company_id === ORG_A)).toEqual(obsABefore);
    expect(writesTo('marketpulse_signal_observations')).toEqual([]);

    const a = obs().find((r) => r.company_id === ORG_A)!;
    const b = obs().find((r) => r.company_id === ORG_B)!;
    expect(a).toMatchObject({
      signal_id: sharedBefore.id, observation_key: `finding:${FIND_A}`, run_id: RUN_A, finding_id: FIND_A,
      observed_at: '2026-10-29T04:30:00.000Z', summary: 'Tenant A wording', source_url: 'https://a.example/news',
    });
    expect(b).toMatchObject({
      signal_id: sharedBefore.id, observation_key: `finding:${FIND_B}`, run_id: RUN_B, finding_id: FIND_B,
      observed_at: '2026-10-30T04:30:00.000Z', summary: 'Tenant B wording',
    });
    // The snapshot is the tenant's own computed signal, without the shared id.
    expect((b.snapshot as Row).summary).toBe('Tenant B wording');
    expect((b.snapshot as Row).id).toBeUndefined();

    expect(resA.observation).toMatchObject({ status: 'inserted' });
    expect(resB.observation).toMatchObject({ status: 'inserted' });
  });

  it('a retry by the same tenant for the same finding converges on one observation (23505 = already_present)', async () => {
    const p = { runId: RUN_A, findingId: FIND_A, observedAt: '2026-10-29T04:30:00.000Z' };
    await persistMarketPulseSignalForCompany({ companyId: ORG_A, ...build('A'), provenance: p });
    const again = await persistMarketPulseSignalForCompany({ companyId: ORG_A, ...build('A'), provenance: p });
    expect(obs()).toHaveLength(1);
    expect(again.observation).toEqual({ status: 'already_present', observationKey: `finding:${FIND_A}` });
  });

  it('the same finding id under a different tenant is a different observation (key is per tenant)', async () => {
    const p = { runId: RUN_A, findingId: FIND_A, observedAt: '2026-10-29T04:30:00.000Z' };
    await persistMarketPulseSignalForCompany({ companyId: ORG_A, ...build('A'), provenance: p });
    await persistMarketPulseSignalForCompany({ companyId: ORG_B, ...build('B'), provenance: p });
    expect(obs().map((r) => [r.company_id, r.summary]).sort()).toEqual([[ORG_A, 'A'], [ORG_B, 'B']]);
  });
});

describe('observation key and writer outcomes', () => {
  it('prefers finding, then run, then a content hash', () => {
    const base = { title: 't', summary: 's', observedAt: '2026-10-29T00:00:00.000Z' };
    expect(marketPulseObservationKey({ ...base, findingId: 'f1', runId: 'r1' })).toBe('finding:f1');
    expect(marketPulseObservationKey({ ...base, runId: 'r1' })).toBe('run:r1');
    const c1 = marketPulseObservationKey(base);
    expect(c1).toMatch(/^content:[0-9a-f]{64}$/);
    expect(marketPulseObservationKey(base)).toBe(c1);
    expect(marketPulseObservationKey({ ...base, summary: 's2' })).not.toBe(c1);
  });

  it('a non-uuid run/finding is kept in the key but never sent to the uuid columns', async () => {
    await persistMarketPulseSignalForCompany({ companyId: ORG_A, ...build('A'), provenance: { runId: 'run-a', findingId: 'f-a' } });
    expect(obs()[0]).toMatchObject({ observation_key: 'finding:f-a', run_id: null, finding_id: null });
  });

  it.each([['42P01'], ['PGRST205']])('table not deployed (%s) → skipped, MarketPulse still completes', async (code) => {
    db.observationError = { code, message: 'relation "marketpulse_signal_observations" does not exist' };
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const res = await persistMarketPulseSignalForCompany({ companyId: ORG_A, ...build('A') });
      expect(res.observation.status).toBe('skipped');
      expect(db.tables.marketpulse_company_signal_relevance).toHaveLength(1);
    } finally { warn.mockRestore(); }
  });

  it('any other insert failure is reported as error, logged, and never thrown', async () => {
    db.observationError = { code: '42501', message: 'permission denied' };
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const out = await recordMarketPulseObservation({
        companyId: ORG_A, signalId: 'sig-1', signal: build('A').signal, observedAt: '2026-10-29T00:00:00.000Z', sourceUrl: null,
      });
      expect(out).toMatchObject({ status: 'error', code: '42501', message: 'permission denied' });
      expect(warn).toHaveBeenCalled();
    } finally { warn.mockRestore(); }
  });
});
