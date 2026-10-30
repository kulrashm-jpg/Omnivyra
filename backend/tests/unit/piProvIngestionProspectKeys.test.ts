/**
 * Prospect provenance (Agent 2) — WS-1 prospect resolution with namespaced keys
 * and legacy raw-key compatibility. The 19 production prospects carry RAW
 * `external_lead_key` values; a resync must match them, never duplicate them.
 */
type Row = Record<string, unknown>;
type Filter = [string, string, unknown];

const db = {
  tables: {} as Record<string, Row[]>,
  queries: [] as Array<{ table: string; op: string; filters: Filter[]; payload: Row | null }>,
  nextId: 1,
};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const st = { op: 'select', filters: [] as Filter[], payload: null as Row | null };
    const rows = (): Row[] => (db.tables[table] ??= []);
    const match = (r: Row) => st.filters.every(([k, c, v]) => (k === 'eq' ? r[c] === v : k === 'is' ? (r[c] ?? null) === v : true));
    const exec = async () => {
      await Promise.resolve();
      db.queries.push({ table, op: st.op, filters: st.filters, payload: st.payload });
      if (st.op === 'insert') {
        const p = st.payload as Row;
        if (table === 'canonical_leads' && rows().some((r) => r.company_id === p.company_id && r.external_lead_key === p.external_lead_key)) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "idx_canonical_leads_company_external"' } };
        }
        const created = { id: `${table}-${db.nextId++}`, ...p };
        rows().push(created);
        return { data: created, error: null };
      }
      if (st.op === 'update') {
        const hit = rows().filter(match);
        for (const r of hit) Object.assign(r, st.payload);
        return { data: hit, error: null };
      }
      return { data: rows().filter(match), error: null };
    };
    const api: Record<string, unknown> = {
      select: () => api,
      insert: (p: Row) => { st.op = 'insert'; st.payload = p; return api; },
      update: (p: Row) => { st.op = 'update'; st.payload = p; return api; },
      eq: (c: string, v: unknown) => { st.filters.push(['eq', c, v]); return api; },
      is: (c: string, v: unknown) => { st.filters.push(['is', c, v]); return api; },
      limit: () => api,
      single: () => exec().then((r) => ({ data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error })),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => exec().then(res, rej),
    };
    return api;
  },
}));

import { resolveOrCreateProspect } from '../../services/prospectIdentity/prospectResolution';
import { piProspectCandidateKeys } from '../../services/prospectProvenance/ingestion/piIngestionContribution';

const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000bb';
const q = (table: string, op: string) => db.queries.filter((x) => x.table === table && x.op === op);

beforeEach(() => { db.tables = {}; db.queries = []; db.nextId = 1; });

const candidate = (source: string, id: string) => ({ source, ...piProspectCandidateKeys(source, id) });

describe('namespaced creation', () => {
  it('creates under the namespaced key and stamps provenance (Apollo = pi_discovery)', async () => {
    const r = await resolveOrCreateProspect(ORG_A, candidate('apollo', 'ap-1'));
    expect(r.outcome).toBe('created');
    expect(r.externalLeadKey).toBe('apollo:ap-1');
    const lead = db.tables.canonical_leads[0];
    expect(lead.external_lead_key).toBe('apollo:ap-1');
    expect(lead.source).toBe('apollo');
    expect((lead.lead_metadata as Row).provenance).toEqual({ sourceCategory: 'pi_discovery', platform: 'apollo', externalRef: 'apollo:ap-1' });
    expect(db.tables.canonical_users[0].external_user_key).toBe('apollo:ap-1');
  });

  it('retry is idempotent: the second call matches by the namespaced key and writes nothing', async () => {
    const first = await resolveOrCreateProspect(ORG_A, candidate('apollo', 'ap-1'));
    db.queries = [];
    const again = await resolveOrCreateProspect(ORG_A, candidate('apollo', 'ap-1'));
    expect(again).toMatchObject({ outcome: 'matched', prospectId: first.prospectId, matchedKey: 'namespaced' });
    expect(q('canonical_leads', 'insert')).toHaveLength(0);
    expect(q('canonical_users', 'insert')).toHaveLength(0);
  });

  it('csv/manual ids already in their namespace are not double-prefixed and have no separate legacy lookup', async () => {
    await resolveOrCreateProspect(ORG_A, candidate('csv', 'csv:abc'));
    expect(db.tables.canonical_leads[0].external_lead_key).toBe('csv:abc');
    expect(q('canonical_leads', 'select')).toHaveLength(1);
  });
});

describe('legacy raw-key compatibility', () => {
  it('matches an existing RAW-keyed prospect instead of creating a duplicate', async () => {
    db.tables.canonical_leads = [{ id: 'legacy-1', company_id: ORG_A, external_lead_key: 'C-9', source: 'webinar', lead_metadata: { original: true } }];
    const r = await resolveOrCreateProspect(ORG_A, candidate('crm', 'C-9'));
    expect(r).toMatchObject({ outcome: 'matched', prospectId: 'legacy-1', matchedKey: 'legacy', externalLeadKey: 'C-9' });
    expect(q('canonical_leads', 'insert')).toHaveLength(0);
    expect(q('canonical_leads', 'update')).toHaveLength(0);
    // The original row is untouched: no re-keying, no provenance stamped onto it.
    expect(db.tables.canonical_leads[0]).toEqual({ id: 'legacy-1', company_id: ORG_A, external_lead_key: 'C-9', source: 'webinar', lead_metadata: { original: true } });
  });

  it('tries the namespaced key FIRST', async () => {
    db.tables.canonical_leads = [
      { id: 'new-1', company_id: ORG_A, external_lead_key: 'crm:C-9' },
      { id: 'legacy-1', company_id: ORG_A, external_lead_key: 'C-9' },
    ];
    const r = await resolveOrCreateProspect(ORG_A, candidate('crm', 'C-9'));
    expect(r).toMatchObject({ prospectId: 'new-1', matchedKey: 'namespaced' });
  });

  it('without a namespaced key, resolution is exactly as before (raw key, no matchedKey)', async () => {
    const r = await resolveOrCreateProspect(ORG_A, { source: 'csv', externalLeadKey: 'K1' });
    expect(r.outcome).toBe('created');
    expect(db.tables.canonical_leads[0].external_lead_key).toBe('K1');
    expect((db.tables.canonical_leads[0].lead_metadata as Row).provenance).toBeUndefined();
    const again = await resolveOrCreateProspect(ORG_A, { source: 'csv', externalLeadKey: 'K1' });
    expect(again.matchedKey).toBeUndefined();
  });
});

describe('tenant isolation', () => {
  it("another tenant's legacy row with the same raw key is never matched", async () => {
    db.tables.canonical_leads = [{ id: 'b-legacy', company_id: ORG_B, external_lead_key: 'SHARED' }];
    const r = await resolveOrCreateProspect(ORG_A, candidate('crm', 'SHARED'));
    expect(r.outcome).toBe('created');
    expect(r.prospectId).not.toBe('b-legacy');
    for (const x of q('canonical_leads', 'select')) {
      expect(x.filters).toContainEqual(['eq', 'company_id', ORG_A]);
    }
  });
});
