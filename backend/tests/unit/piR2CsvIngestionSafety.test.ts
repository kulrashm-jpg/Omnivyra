/**
 * PI-FIX (round 2) — CSV ingestion safety, pure and mocked parts.
 *
 *  C4  a supplied reference may not enter the platform's `csv:` namespace.
 *  C5  the legacy raw-key prospect fallback is confined to the same source.
 *  --  unmapped columns are reported (`ignoredColumns`), never silently dropped.
 *  --  CSV and manual records declare themselves operator-asserted, which is
 *      what switches the identity conflict guard on in the orchestrator.
 */

type Row = Record<string, unknown>;
type Filter = [kind: string, column: string, value: unknown];

const db = {
  tables: {} as Record<string, Row[]>,
  queries: [] as Array<{ table: string; op: string; filters: Filter[] }>,
  nextId: 1,
};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const st = { op: 'select', filters: [] as Filter[], payload: null as Row | null };
    const rows = (): Row[] => (db.tables[table] ??= []);
    const match = (r: Row) => st.filters.every(([k, c, v]) => (k === 'eq' ? r[c] === v : true));
    const exec = async () => {
      db.queries.push({ table, op: st.op, filters: st.filters });
      if (st.op === 'insert') {
        const created = { id: `${table}-${db.nextId++}`, ...(st.payload as Row) };
        rows().push(created);
        return { data: created, error: null };
      }
      return { data: rows().filter(match), error: null };
    };
    const api: Record<string, unknown> = {
      select: () => api,
      insert: (p: Row) => { st.op = 'insert'; st.payload = p; return api; },
      eq: (c: string, v: unknown) => { st.filters.push(['eq', c, v]); return api; },
      is: (c: string, v: unknown) => { st.filters.push(['is', c, v]); return api; },
      limit: () => api,
      single: () => exec().then((r) => ({ data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error })),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => exec().then(res, rej),
    };
    return api;
  },
}));

import { csvAdapter, csvExternalId, toNormalizedCsvRecord } from '../../services/leadIngestion/adapters/csvAdapter';
import {
  MANUAL_INPUT_FIELDS,
  ManualInputError,
  manualAdapter,
  unmappedManualFields,
} from '../../services/leadIngestion/adapters/manualAdapter';
import { resolveOrCreateProspect } from '../../services/prospectIdentity/prospectResolution';

const ORG = '00000000-0000-4000-8000-0000000000aa';

beforeEach(() => {
  db.tables = {};
  db.queries = [];
  db.nextId = 1;
});

describe('C4 — the csv: namespace belongs to the platform', () => {
  it('refuses a reference equal to a generated digest', () => {
    const digest = csvExternalId({ organizationId: ORG, email: 'anon@x.test' });
    expect(digest).toMatch(/^csv:[0-9a-f]{32}$/);
    expect(() => toNormalizedCsvRecord({ organizationId: ORG, referenceId: digest, email: 'carol@y.test' }))
      .toThrow(ManualInputError);
  });

  it('refuses any reference starting with csv: (csv:42 would collide with reference 42)', () => {
    let err: unknown;
    try { csvAdapter.translate({ referenceId: ' csv:42 ', email: 'c@y.test' }, ORG); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(ManualInputError);
    expect((err as ManualInputError).field).toBe('referenceId');
    expect(String((err as Error).message)).not.toContain('42');
  });

  it('still accepts ordinary references, and ones that merely contain csv', () => {
    for (const ref of ['42', 'CSV:42', 'mycsv:1', 'csv']) {
      const n = toNormalizedCsvRecord({ organizationId: ORG, referenceId: ref, email: 'a@b.test' });
      expect(n.externalId).toBe(ref);
    }
  });

  it('id-less rows still get their generated digest (stored key format unchanged)', () => {
    const n = toNormalizedCsvRecord({ organizationId: ORG, email: 'a@b.test' });
    expect(n.externalId).toBe(csvExternalId({ organizationId: ORG, email: 'a@b.test' }));
    expect(n.person?.externalKeys).toBeNull();
  });
});

describe('operator-asserted declaration', () => {
  it('CSV and manual records are operator-asserted', () => {
    expect(csvAdapter.translate({ email: 'a@b.test' }, ORG).normalized.operatorAsserted).toBe(true);
    expect(manualAdapter.translate({ email: 'a@b.test' }, ORG).normalized.operatorAsserted).toBe(true);
  });
});

describe('unmapped columns are reported, not dropped', () => {
  it('lists keys the ManualLeadInput vocabulary does not read, in input order', () => {
    expect(csvAdapter.unmappedFields!({ 'E-mail': 'x@y.test', fullName: 'A', Notes: 'n', email: 'a@b.test', ' email': 'z' }))
      .toEqual(['E-mail', 'Notes', ' email']);
  });

  it('a fully mapped row reports nothing', () => {
    expect(csvAdapter.unmappedFields!({ email: 'a@b.test', fullName: 'A', referenceId: '1', organizationId: ORG })).toEqual([]);
  });

  it('the runtime vocabulary is exactly the declared field set', () => {
    expect(MANUAL_INPUT_FIELDS).toHaveLength(29);
    expect(unmappedManualFields(Object.fromEntries(MANUAL_INPUT_FIELDS.map((f) => [f, 'x'])))).toEqual([]);
    expect(unmappedManualFields(null)).toEqual([]);
  });

  it('translate output is unchanged by an extra column (the raw payload still carries it verbatim)', () => {
    const raw = { email: 'a@b.test', fullName: 'A', Notes: 'kept in raw' };
    const r = csvAdapter.translate(raw, ORG);
    expect(r.raw).toBe(raw);
    expect(r.normalized).toEqual(csvAdapter.translate({ email: 'a@b.test', fullName: 'A' }, ORG).normalized);
  });
});

describe('C5 — the legacy raw-key fallback cannot cross sources', () => {
  const seedLegacy = (source: string) => {
    db.tables.canonical_leads = [{ id: `legacy-${source}`, company_id: ORG, external_lead_key: '42', source }];
  };

  it('a csv record does NOT adopt a crm prospect keyed by the same raw key', async () => {
    seedLegacy('crm');
    const r = await resolveOrCreateProspect(ORG, {
      source: 'csv', externalLeadKey: '42', namespacedExternalLeadKey: 'csv:42', legacyMatchRequiresSameSource: true,
    });
    expect(r.outcome).toBe('created');
    expect(r.prospectId).not.toBe('legacy-crm');
    expect(r.externalLeadKey).toBe('csv:42');
  });

  it('a csv record still adopts its OWN pre-namespacing prospect', async () => {
    seedLegacy('csv');
    const r = await resolveOrCreateProspect(ORG, {
      source: 'csv', externalLeadKey: '42', namespacedExternalLeadKey: 'csv:42', legacyMatchRequiresSameSource: true,
    });
    expect(r).toMatchObject({ outcome: 'matched', prospectId: 'legacy-csv', matchedKey: 'legacy', externalLeadKey: '42' });
  });

  it('the legacy lookup is tenant- AND source-filtered; the namespaced lookup is not source-filtered', async () => {
    await resolveOrCreateProspect(ORG, { source: 'csv', externalLeadKey: '42', namespacedExternalLeadKey: 'csv:42', legacyMatchRequiresSameSource: true });
    const selects = db.queries.filter((x) => x.table === 'canonical_leads' && x.op === 'select');
    const byKey = (k: string) => selects.find((x) => x.filters.some(([, c, v]) => c === 'external_lead_key' && v === k))!;
    expect(byKey('42').filters).toEqual(expect.arrayContaining([['eq', 'company_id', ORG], ['eq', 'source', 'csv']]));
    expect(byKey('csv:42').filters.some(([, c]) => c === 'source')).toBe(false);
  });

  it('a provider candidate (flag absent) keeps the source-blind fallback: a crm resync still adopts a legacy row whose source is free text', async () => {
    db.tables.canonical_leads = [{ id: 'legacy-webinar', company_id: ORG, external_lead_key: '42', source: 'webinar' }];
    const r = await resolveOrCreateProspect(ORG, { source: 'crm', externalLeadKey: '42', namespacedExternalLeadKey: 'crm:42' });
    expect(r).toMatchObject({ outcome: 'matched', prospectId: 'legacy-webinar', matchedKey: 'legacy' });
  });

  it('a candidate without namespacing is unchanged (single raw-key lookup, no source filter)', async () => {
    seedLegacy('crm');
    const r = await resolveOrCreateProspect(ORG, { source: 'csv', externalLeadKey: '42' });
    expect(r).toMatchObject({ outcome: 'matched', prospectId: 'legacy-crm' });
  });
});
