/**
 * Prospect provenance (Agent 2) — the legacy CRM importer.
 *
 * Pins: no `unified_source` write to `canonical_leads` (absent in production);
 * namespaced keys for new rows with legacy raw-key matching; a resync never
 * replaces the original source / created_at / lead_metadata; every row records
 * a contribution (originating only when it created the lead); retries converge;
 * tenants never cross.
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

const contributions: Array<Record<string, unknown>> = [];
const contributionKeys = new Set<string>();
jest.mock('../../services/prospectProvenance/contributionWriter', () => ({
  recordSourceContribution: jest.fn(async (input: Record<string, unknown>) => {
    const key = `${input.organizationId}|${input.canonicalLeadId}|${input.externalRef}`;
    if (contributionKeys.has(key)) return { status: 'duplicate', role: null };
    contributionKeys.add(key);
    contributions.push(input);
    return { status: 'inserted', id: `c-${contributions.length}`, role: input.leadCreated ? 'originating' : 'contributing', roleDowngraded: false };
  }),
}));

jest.mock('../../services/prospectIdentity/ingestionBoundary', () => ({
  ingestSourceRecord: jest.fn(async (input: { sourceRecordId: string }) => ({ sourceRecordId: `sr-${input.sourceRecordId}`, outcome: 'created' })),
}));
jest.mock('../../services/identityResolutionService', () => ({
  resolveUnifiedPerson: jest.fn(async (input: { companyId: string }) => ({ unifiedPersonId: `person-${input.companyId.slice(-2)}`, matchedBy: 'email' })),
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

const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000bb';
const ROW = {
  externalId: 'CRM-1',
  name: 'Ada',
  email: 'ada@example.com',
  source: 'webinar',
  status: 'open',
  createdAt: '2026-08-01T00:00:00.000Z',
  campaignId: 'camp-1',
  metadata: { first: 'evidence' },
};
const leads = () => db.tables.canonical_leads ?? [];

beforeEach(() => {
  db.tables = {}; db.writes = []; db.nextId = 1;
  contributions.length = 0; contributionKeys.clear(); adoptLead.mockClear();
});

describe('new CRM prospect', () => {
  it('is written under the namespaced key, without unified_source, and originates', async () => {
    await ingestCrmData({ companyId: ORG_A, rows: [ROW] });
    expect(leads()).toHaveLength(1);
    const lead = leads()[0];
    expect(lead.external_lead_key).toBe('crm:CRM-1');
    expect(lead).not.toHaveProperty('unified_source');
    expect(lead).toMatchObject({ source: 'webinar', created_at: '2026-08-01T00:00:00.000Z', lead_metadata: { first: 'evidence' } });

    expect(contributions).toHaveLength(1);
    expect(contributions[0]).toMatchObject({
      organizationId: ORG_A, canonicalLeadId: lead.id, leadCreated: true,
      sourceCategory: 'crm', platform: null, externalRef: 'crm:CRM-1',
      sourceRecordId: 'sr-CRM-1', observedAt: '2026-08-01T00:00:00.000Z',
    });
    // The information formerly written as `unified_source` is carried, not dropped.
    expect((contributions[0].sourceMetadata as Row)).toMatchObject({
      crmLeadSource: 'webinar', unifiedSource: expect.anything(), observedAtBasis: 'source', campaignId: 'camp-1',
    });
    // The adoption row still carries unified_source (lead_intelligence, unchanged).
    expect(adoptLead).toHaveBeenCalledWith('crm', expect.objectContaining({ id: lead.id, unified_source: expect.anything() }));
  });

  it('no canonical_leads write ever names unified_source', async () => {
    await ingestCrmData({ companyId: ORG_A, rows: [ROW] });
    await ingestCrmData({ companyId: ORG_A, rows: [{ ...ROW, status: 'won' }] });
    for (const w of db.writes.filter((x) => x.table === 'canonical_leads')) {
      expect(w.payload).not.toHaveProperty('unified_source');
    }
  });
});

describe('resync keeps the originating source', () => {
  it('a resync updates only CRM state; source, created_at and lead_metadata survive', async () => {
    await ingestCrmData({ companyId: ORG_A, rows: [ROW] });
    await ingestCrmData({ companyId: ORG_A, rows: [{ ...ROW, source: 'ads', status: 'won', createdAt: '2026-09-09T00:00:00.000Z', metadata: { overwritten: true } }] });
    expect(leads()).toHaveLength(1);
    expect(leads()[0]).toMatchObject({
      source: 'webinar', created_at: '2026-08-01T00:00:00.000Z', lead_metadata: { first: 'evidence' }, lead_status: 'won',
    });
    const update = db.writes.find((w) => w.table === 'canonical_leads' && w.op === 'update')!;
    expect(Object.keys(update.payload).sort()).toEqual(['lead_status', 'qualification_score']);
    expect(update.filters).toContainEqual(['company_id', ORG_A]);
  });

  it('idempotent retry: the same CRM record does not add a second contribution or prospect', async () => {
    await ingestCrmData({ companyId: ORG_A, rows: [ROW] });
    await ingestCrmData({ companyId: ORG_A, rows: [ROW] });
    expect(leads()).toHaveLength(1);
    expect(contributions).toHaveLength(1);
    expect(contributions[0].leadCreated).toBe(true);
  });

  it('a LEGACY raw-keyed production prospect is matched (not duplicated) and gets a contributing row', async () => {
    db.tables.canonical_leads = [{
      id: 'legacy-1', company_id: ORG_A, external_lead_key: 'CRM-1', source: 'organic',
      created_at: '2026-01-01T00:00:00.000Z', lead_metadata: { orig: 1 }, unified_person_id: 'p-orig',
    }];
    await ingestCrmData({ companyId: ORG_A, rows: [ROW] });
    expect(leads()).toHaveLength(1);
    expect(leads()[0]).toMatchObject({
      id: 'legacy-1', external_lead_key: 'CRM-1', source: 'organic', created_at: '2026-01-01T00:00:00.000Z',
      lead_metadata: { orig: 1 }, unified_person_id: 'p-orig',
    });
    expect(contributions).toHaveLength(1);
    expect(contributions[0]).toMatchObject({
      canonicalLeadId: 'legacy-1', leadCreated: false, externalRef: 'crm:CRM-1',
      sourceMetadata: expect.objectContaining({ prospectMatchedBy: 'legacy' }),
    });
  });

  it('fills a missing person anchor but never re-points an existing one', async () => {
    db.tables.canonical_leads = [{ id: 'legacy-2', company_id: ORG_A, external_lead_key: 'CRM-1', source: 'organic', unified_person_id: null }];
    await ingestCrmData({ companyId: ORG_A, rows: [ROW] });
    expect(leads()[0].unified_person_id).toBe('person-aa');
  });
});

describe('tenant isolation', () => {
  it('the same CRM id in two tenants yields two prospects and two contributions, never crossed', async () => {
    await ingestCrmData({ companyId: ORG_A, rows: [ROW] });
    await ingestCrmData({ companyId: ORG_B, rows: [ROW] });
    expect(leads()).toHaveLength(2);
    expect(leads().map((l) => l.company_id).sort()).toEqual([ORG_A, ORG_B]);
    expect(contributions.map((c) => [c.organizationId, leads().find((l) => l.id === c.canonicalLeadId)!.company_id]))
      .toEqual([[ORG_A, ORG_A], [ORG_B, ORG_B]]);
    expect(contributions.every((c) => c.leadCreated === true)).toBe(true);
  });

  it("does not match another tenant's legacy raw-keyed row", async () => {
    db.tables.canonical_leads = [{ id: 'b-legacy', company_id: ORG_B, external_lead_key: 'CRM-1', source: 'organic' }];
    await ingestCrmData({ companyId: ORG_A, rows: [ROW] });
    expect(leads()).toHaveLength(2);
    expect(leads().find((l) => l.id === 'b-legacy')).toEqual({ id: 'b-legacy', company_id: ORG_B, external_lead_key: 'CRM-1', source: 'organic' });
    expect(contributions[0].organizationId).toBe(ORG_A);
  });
});

describe('a provenance failure never breaks the CRM sync', () => {
  it('a contribution writer error is absorbed; the lead is still written', async () => {
    const writer = jest.requireMock('../../services/prospectProvenance/contributionWriter') as { recordSourceContribution: jest.Mock };
    writer.recordSourceContribution.mockImplementationOnce(async () => { throw new Error('relation "prospect_source_contributions" does not exist'); });
    const res = await ingestCrmData({ companyId: ORG_A, rows: [ROW] });
    expect(res.leadsInserted).toBe(1);
    expect(leads()).toHaveLength(1);
  });
});
