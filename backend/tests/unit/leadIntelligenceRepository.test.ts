/**
 * Durable repository — idempotency, unified read, tenant scoping, timeline,
 * fail-open, and large-dataset behaviour, against an in-memory ownedDbTable mock.
 */
jest.mock('../../db/writeOwner', () => {
  const stores: Record<string, Array<Record<string, unknown>>> = { lead_intelligence: [], lead_intelligence_events: [] };
  const flags: { throw: boolean } = { throw: false };
  (globalThis as Record<string, unknown>).__liStores = stores;
  (globalThis as Record<string, unknown>).__liFlags = flags;

  function makeQuery(table: string) {
    if (flags.throw) throw new Error('db unavailable');
    const state: { filters: Array<[string, unknown]>; limitN?: number; upsertId?: string } = { filters: [] };
    const arr = () => (stores[table] ||= []);
    const builder: Record<string, unknown> = {
      upsert(row: Record<string, unknown>, opts?: { onConflict?: string }) {
        const keys = (opts?.onConflict ?? '').split(',').filter(Boolean);
        const list = arr();
        const idx = keys.length ? list.findIndex((r) => keys.every((k) => r[k] === row[k])) : -1;
        let id: string;
        if (idx >= 0) { id = String(list[idx].id); list[idx] = { ...list[idx], ...row }; }
        else { id = `id_${list.length + 1}`; list.push({ id, ...row }); }
        state.upsertId = id;
        return builder;
      },
      insert(row: Record<string, unknown>) { const list = arr(); list.push({ id: `id_${list.length + 1}`, ...row }); return Promise.resolve({ data: null, error: null }); },
      select() { return builder; },
      eq(c: string, v: unknown) { state.filters.push([c, v]); return builder; },
      order() { return builder; },
      limit(n: number) { state.limitN = n; return builder; },
      maybeSingle() {
        if (state.upsertId) return Promise.resolve({ data: { id: state.upsertId }, error: null });
        const r = arr().find((rr) => state.filters.every(([c, v]) => rr[c] === v));
        return Promise.resolve({ data: r ?? null, error: null });
      },
      then(resolve: (x: { data: unknown; error: null }) => void) {
        let r = arr().filter((rr) => state.filters.every(([c, v]) => rr[c] === v));
        if (state.limitN != null) r = r.slice(0, state.limitN);
        resolve({ data: r, error: null });
      },
    };
    return builder;
  }
  return { ownedDbTable: (t: string) => makeQuery(t) };
});

import { upsertCanonicalLead, appendLeadEvent, getCanonicalLead, listCanonicalLeads, getLeadTimeline } from '../../services/leadIntelligence/leadIntelligenceRepository';
import type { CanonicalLead } from '../../../lib/leadIntelligence';

const stores = (globalThis as Record<string, unknown>).__liStores as Record<string, Array<Record<string, unknown>>>;
const flags = (globalThis as Record<string, unknown>).__liFlags as { throw: boolean };

const lead = (over: Partial<CanonicalLead> = {}): CanonicalLead => ({
  organizationId: 'co1', source: 'website', unifiedPersonId: 'up1', ingestedAt: '2026-01-01T00:00:00Z',
  identity: { email: 'a@b.com', unifiedPersonId: 'up1' },
  attribution: { originalSource: 'web', originalChannel: null, campaign: 'q3', content: null, session: null, journey: null, referrer: null, utm: { source: null, medium: null, campaign: null, content: null, term: null }, identity: {}, sourceMetadata: {} },
  scores: { total: 0.7 }, status: 'new', occurredAt: '2026-01-01T00:00:00Z',
  sourceRef: { table: 'leads', id: 'l1' },
  ...over,
});

beforeEach(() => { stores.lead_intelligence.length = 0; stores.lead_intelligence_events.length = 0; flags.throw = false; });

describe('Durable Lead Intelligence repository', () => {
  it('upsert is idempotent — repeated ingestion never duplicates', async () => {
    const a = await upsertCanonicalLead(lead());
    const b = await upsertCanonicalLead(lead({ status: 'reviewing' })); // same source row
    expect(a?.id).toBe(b?.id);
    expect(stores.lead_intelligence).toHaveLength(1);
    expect(stores.lead_intelligence[0].status).toBe('reviewing'); // latest state upserted
  });

  it('different source rows create distinct canonical records', async () => {
    await upsertCanonicalLead(lead({ sourceRef: { table: 'leads', id: 'l1' } }));
    await upsertCanonicalLead(lead({ sourceRef: { table: 'leads', id: 'l2' } }));
    expect(stores.lead_intelligence).toHaveLength(2);
  });

  it('reads the unified view + filters by tenant/source', async () => {
    await upsertCanonicalLead(lead());
    await upsertCanonicalLead(lead({ organizationId: 'co2', sourceRef: { table: 'leads', id: 'l9' } }));
    const co1 = await listCanonicalLeads({ companyId: 'co1' });
    expect(co1).toHaveLength(1);
    expect(co1[0].sourceLabel).toBe('Website');
    expect(co1[0].campaign).toBe('q3');
    expect(await listCanonicalLeads({ companyId: 'co2' })).toHaveLength(1);
    const id = String(stores.lead_intelligence[0].id);
    expect((await getCanonicalLead('co1', id))?.organizationId).toBe('co1');
  });

  it('appends + reads a provenance timeline', async () => {
    const r = await upsertCanonicalLead(lead());
    await appendLeadEvent('co1', r!.id, { origin: 'leads', source: 'website', entityId: 'l1', eventType: 'lead.website.ingested', occurredAt: '2026-01-02T00:00:00Z', metadata: { x: 1 } });
    const tl = await getLeadTimeline('co1', r!.id);
    expect(tl).toHaveLength(1);
    expect(tl[0].origin).toBe('leads');
    expect(tl[0].metadata.x).toBe(1);
  });

  it('fail-open: a DB error yields null/[] (adoption + consumers unaffected)', async () => {
    flags.throw = true;
    expect(await upsertCanonicalLead(lead())).toBeNull();
    expect(await listCanonicalLeads({ companyId: 'co1' })).toEqual([]);
    expect(await getLeadTimeline('co1', 'x')).toEqual([]);
  });

  it('handles a large dataset (5k records) with a capped read', async () => {
    for (let i = 0; i < 5000; i += 1) await upsertCanonicalLead(lead({ sourceRef: { table: 'leads', id: `l${i}` } }));
    expect(stores.lead_intelligence).toHaveLength(5000);
    const page = await listCanonicalLeads({ companyId: 'co1', limit: 1000 });
    expect(page).toHaveLength(1000); // capped, never unbounded
  });
});
