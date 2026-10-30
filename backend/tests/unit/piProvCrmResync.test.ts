/**
 * Prospect provenance — CRM RESYNC never replaces original attribution
 * (owner decision; contract "CRM resync and enrichment never replace the
 * original source or discovery time").
 *
 * Hardens piProvIngestionCrm with N-resync properties:
 *   - `canonical_leads.source`, `created_at`, `lead_metadata` and the person
 *     anchor are identical after every resync, whatever the CRM now says;
 *   - the originating contribution is unchanged and stays the only one;
 *   - a resync of the SAME CRM record with CHANGED data records nothing new
 *     (`duplicate`): under the contract the idempotency key
 *     (organization_id, canonical_lead_id, external_ref) identifies the source
 *     EVENT, and a CRM record id is one event however often it is re-sent;
 *   - a legacy raw-keyed prospect is matched on EVERY resync and never
 *     duplicated (its raw key is not rewritten, so each resync falls back to it).
 */
type Row = Record<string, unknown>;

const db = {
  tables: {} as Record<string, Row[]>,
  writes: [] as Array<{ table: string; op: string; payload: Row; filters: Array<[string, unknown]> }>,
  nextId: 1,
};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const st = { op: 'select', payload: null as Row | null, filters: [] as Array<[string, unknown]> };
    const rows = (): Row[] => (db.tables[table] ??= []);
    const match = (r: Row) => st.filters.every(([c, v]) => r[c] === v);
    const exec = async (single: boolean) => {
      await Promise.resolve();
      if (st.op === 'insert') {
        const created = { id: `${table}-${db.nextId++}`, ...(st.payload as Row) };
        rows().push(created);
        db.writes.push({ table, op: 'insert', payload: st.payload as Row, filters: st.filters });
        return { data: created, error: null };
      }
      if (st.op === 'update') {
        const hit = rows().filter(match);
        for (const r of hit) Object.assign(r, st.payload);
        db.writes.push({ table, op: 'update', payload: st.payload as Row, filters: st.filters });
        return { data: hit, error: null };
      }
      const hit = rows().filter(match);
      return { data: single ? (hit[0] ?? null) : hit, error: null };
    };
    const api: Record<string, unknown> = {
      select: () => api,
      insert: (p: Row) => { st.op = 'insert'; st.payload = p; return api; },
      update: (p: Row) => { st.op = 'update'; st.payload = p; return api; },
      eq: (c: string, v: unknown) => { st.filters.push([c, v]); return api; },
      limit: () => api,
      maybeSingle: () => exec(true),
      single: () => exec(true),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => exec(false).then(res, rej),
    };
    return api;
  },
}));

// Writer double enforcing both database rules: (org, lead, external_ref)
// idempotency and one originating row per lead.
const contributions: Row[] = [];
const outcomes: Row[] = [];
jest.mock('../../services/prospectProvenance/contributionWriter', () => ({
  recordSourceContribution: jest.fn(async (input: Row) => {
    const key = (r: Row) => `${r.organizationId}|${r.canonicalLeadId}|${r.externalRef}`;
    if (contributions.some((r) => key(r) === key(input))) {
      const dup = { status: 'duplicate', role: null };
      outcomes.push(dup);
      return dup;
    }
    let role = input.leadCreated ? 'originating' : 'contributing';
    if (role === 'originating' && contributions.some((r) => r.canonicalLeadId === input.canonicalLeadId && r.role === 'originating')) {
      role = 'contributing';
    }
    const row = { ...JSON.parse(JSON.stringify(input)), role, id: `c-${contributions.length + 1}` };
    contributions.push(row);
    const out = { status: 'inserted', id: row.id, role, roleDowngraded: false };
    outcomes.push(out);
    return out;
  }),
}));

jest.mock('../../services/prospectIdentity/ingestionBoundary', () => ({
  ingestSourceRecord: jest.fn(async (input: { sourceRecordId: string }) => ({ sourceRecordId: `sr-${input.sourceRecordId}`, outcome: 'created' })),
}));
jest.mock('../../services/identityResolutionService', () => ({
  resolveUnifiedPerson: jest.fn(async () => ({ unifiedPersonId: 'person-aa', matchedBy: 'email' })),
}));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => ({}) } }));
jest.mock('../../services/providers/providerCostGovernor', () => ({
  authorizeProviderCall: () => ({ allowed: true }),
  recordProviderUsage: () => undefined,
}));
jest.mock('../../services/touchpointService', () => ({ bulkCreateTouchpoints: async () => ({ created: 0 }) }));
jest.mock('../../services/unifiedIngestionService', () => ({ ingestUnifiedData: async () => ({}) }));
const adoptLead = jest.fn();
jest.mock('../../services/leadIntelligence/leadIntelligenceRuntime', () => ({ adoptLead: (...a: unknown[]) => adoptLead(...a) }));
jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { ingestCrmData } from '../../services/crmIngestionService';

const ORG = '00000000-0000-4000-8000-0000000000aa';
const N = 5;
const ROW = {
  externalId: 'CRM-7', name: 'Grace', email: 'grace@example.com', source: 'webinar', status: 'open',
  createdAt: '2026-08-01T00:00:00.000Z', metadata: { first: 'evidence' },
};
const resync = (i: number) => ({
  ...ROW,
  name: `Grace v${i}`, source: `channel-${i}`, status: `status-${i}`,
  createdAt: `2026-09-0${i}T00:00:00.000Z`, metadata: { overwritten: i },
});
const leads = () => db.tables.canonical_leads ?? [];
const snap = <T>(v: T): T => JSON.parse(JSON.stringify(v));

beforeEach(() => {
  db.tables = {}; db.writes = []; db.nextId = 1;
  contributions.length = 0; outcomes.length = 0; adoptLead.mockClear();
});

describe(`CRM resync x${N} — original attribution survives`, () => {
  it('source, created_at, lead_metadata and person anchor never change; status follows the CRM', async () => {
    await ingestCrmData({ companyId: ORG, rows: [ROW] });
    const original = snap(leads()[0]);
    const originating = snap(contributions[0]);
    expect(originating).toMatchObject({ role: 'originating', externalRef: 'crm:CRM-7', leadCreated: true });

    for (let i = 1; i <= N; i++) {
      await ingestCrmData({ companyId: ORG, rows: [resync(i)] });
      expect(leads()).toHaveLength(1);
      const lead = leads()[0];
      for (const k of ['id', 'source', 'created_at', 'lead_metadata', 'unified_person_id', 'external_lead_key', 'user_id']) {
        expect(lead[k]).toEqual(original[k]);
      }
      expect(lead.lead_status).toBe(`status-${i}`);
    }

    // Every canonical_leads UPDATE named only CRM-mutable state.
    const updates = db.writes.filter((w) => w.table === 'canonical_leads' && w.op === 'update');
    expect(updates).toHaveLength(N);
    for (const u of updates) expect(Object.keys(u.payload).sort()).toEqual(['lead_status', 'qualification_score']);
    expect(db.writes.filter((w) => w.table === 'canonical_leads' && w.op === 'insert')).toHaveLength(1);

    // The originating contribution is unchanged and remains the only contribution.
    expect(contributions).toHaveLength(1);
    expect(contributions[0]).toEqual(originating);
    // Each changed-data resync was the SAME source event ⇒ duplicate, nothing new.
    expect(outcomes.map((o) => o.status)).toEqual(['inserted', ...Array(N).fill('duplicate')]);
  });

  it('a keyless CRM row (hash key) resyncs onto the same prospect', async () => {
    const keyless = { ...ROW, externalId: null };
    for (let i = 0; i <= N; i++) await ingestCrmData({ companyId: ORG, rows: [{ ...keyless, status: `s${i}` }] });
    expect(leads()).toHaveLength(1);
    expect(String(leads()[0].external_lead_key)).toMatch(/^crm:[0-9a-f]{64}$/);
    expect(contributions).toHaveLength(1);
  });
});

describe(`legacy raw-keyed prospect x${N} — matched every time, never duplicated`, () => {
  const LEGACY: Row = {
    id: 'legacy-7', company_id: ORG, external_lead_key: 'CRM-7', source: 'organic',
    created_at: '2026-01-01T00:00:00.000Z', lead_metadata: { orig: 1 }, unified_person_id: 'p-orig',
  };

  it('keeps its raw key, source and discovery time; first resync contributes, the rest are duplicates', async () => {
    db.tables.canonical_leads = [snap(LEGACY)];
    for (let i = 1; i <= N; i++) await ingestCrmData({ companyId: ORG, rows: [resync(i)] });

    expect(leads()).toHaveLength(1);
    expect(leads()[0]).toMatchObject({ ...LEGACY, lead_status: `status-${N}` });
    expect(db.writes.filter((w) => w.table === 'canonical_leads' && w.op === 'insert')).toHaveLength(0);

    // A pre-provenance prospect is never RE-ORIGINATED by a resync.
    expect(contributions).toHaveLength(1);
    expect(contributions[0]).toMatchObject({
      canonicalLeadId: 'legacy-7', leadCreated: false, role: 'contributing', externalRef: 'crm:CRM-7',
      sourceMetadata: expect.objectContaining({ prospectMatchedBy: 'legacy' }),
    });
    expect(outcomes.map((o) => o.status)).toEqual(['inserted', ...Array(N - 1).fill('duplicate')]);
  });

  it('a namespaced row and a raw row for the same id: the namespaced row wins, the raw row is untouched', async () => {
    db.tables.canonical_leads = [
      snap(LEGACY),
      { id: 'ns-7', company_id: ORG, external_lead_key: 'crm:CRM-7', source: 'webinar', created_at: '2026-08-01T00:00:00.000Z', unified_person_id: 'p-x' },
    ];
    await ingestCrmData({ companyId: ORG, rows: [resync(1)] });
    expect(leads()).toHaveLength(2);
    expect(leads().find((l) => l.id === 'legacy-7')).toEqual(LEGACY);
    expect(contributions[0]).toMatchObject({ canonicalLeadId: 'ns-7', sourceMetadata: expect.objectContaining({ prospectMatchedBy: 'namespaced' }) });
  });
});
