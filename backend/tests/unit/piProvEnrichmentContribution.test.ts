/**
 * Prospect provenance — PI ENRICHMENT records a CONTRIBUTING source
 * (owner decision 5; acceptance #6: enrichment preserves the originating source).
 *
 * The contribution writer is doubled with an in-memory store that enforces the
 * two database rules the real one enforces (`uq_psc_org_lead_external_ref`,
 * `uq_psc_one_originating_per_lead`), and `canonical_leads` is an in-memory
 * table, so "never touched" is proven on the data rather than on call shapes.
 */
type Row = Record<string, unknown>;

const db = {
  tables: {} as Record<string, Row[]>,
  writes: [] as Array<{ table: string; op: string; payload: Row | null }>,
  selectError: null as { message: string } | null,
};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const st = { op: 'select', payload: null as Row | null, filters: [] as Array<[string, unknown]>, limit: Infinity };
    const exec = async () => {
      await Promise.resolve();
      if (st.op !== 'select') {
        db.writes.push({ table, op: st.op, payload: st.payload });
        return { data: null, error: { message: `unexpected ${st.op} on ${table}` } };
      }
      if (db.selectError) return { data: null, error: db.selectError };
      const hit = (db.tables[table] ?? []).filter((r) => st.filters.every(([c, v]) => r[c] === v));
      return { data: hit.slice(0, st.limit), error: null };
    };
    const api: Record<string, unknown> = {
      select: () => api,
      insert: (p: Row) => { st.op = 'insert'; st.payload = p; return api; },
      update: (p: Row) => { st.op = 'update'; st.payload = p; return api; },
      upsert: (p: Row) => { st.op = 'upsert'; st.payload = p; return api; },
      delete: () => { st.op = 'delete'; return api; },
      eq: (c: string, v: unknown) => { st.filters.push([c, v]); return api; },
      limit: (n: number) => { st.limit = n; return api; },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => exec().then(res, rej),
    };
    return api;
  },
}));

const store: Row[] = [];
let writerThrows: Error | null = null;
jest.mock('../../services/prospectProvenance/contributionWriter', () => ({
  recordSourceContribution: jest.fn(async (input: Row) => {
    if (writerThrows) throw writerThrows;
    const key = (r: Row) => `${r.organizationId}|${r.canonicalLeadId}|${r.externalRef}`;
    if (store.some((r) => key(r) === key(input))) return { status: 'duplicate', role: null };
    let role = input.leadCreated ? 'originating' : 'contributing';
    let roleDowngraded = false;
    if (role === 'originating' && store.some((r) => r.canonicalLeadId === input.canonicalLeadId && r.role === 'originating')) {
      role = 'contributing'; roleDowngraded = true;
    }
    const id = `c-${store.length + 1}`;
    store.push({ ...input, id, role });
    return { status: 'inserted', id, role, roleDowngraded };
  }),
}));

const warn = jest.fn();
jest.mock('../../services/logger', () => ({ logger: { warn: (...a: unknown[]) => warn(...a), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import {
  recordEnrichmentContribution,
  enrichmentExternalRef,
  enrichmentObservationFingerprint,
} from '../../services/prospectProvenance/ingestion/enrichmentContribution';
import { piEnrichmentProfile, PI_ENRICHMENT_PROFILE } from '../../services/prospectProvenance/ingestion/sourceProfiles';
import {
  getProvenanceIngestionCounters, resetProvenanceIngestionCounters,
} from '../../services/prospectProvenance/ingestion/provenanceTelemetry';
import {
  makePersistObservation, executeEnrichment,
  type EnrichmentProviderAdapter, type ExecuteEnrichmentPorts,
} from '../../services/enrichment/providers';
import { parseExternalRef } from '../../../lib/prospectProvenance/contract';

const ORG = '4bdbec26-4f7e-4e77-a965-d499e1472f5c';
const ORG_B = '0eda0896-7814-4613-8b49-4a8f408e45f1';
const PERSON = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '22222222-2222-4222-8222-222222222222';
const LEAD = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-10-30T09:00:00.000Z';

const ORIGINAL_LEAD: Row = {
  id: LEAD, company_id: ORG, unified_person_id: PERSON, source: 'apollo',
  created_at: '2026-08-01T00:00:00.000Z', external_lead_key: 'apollo:ap-1',
  lead_metadata: { provenance: { sourceCategory: 'pi_discovery', platform: 'apollo', externalRef: 'apollo:ap-1' } },
};
const ORIGINATING: Row = {
  id: 'c-orig', organizationId: ORG, canonicalLeadId: LEAD, role: 'originating',
  sourceCategory: 'pi_discovery', platform: 'apollo', externalRef: 'apollo:ap-1', sourceRecordId: 'sr-discovery',
  observedAt: '2026-08-01T00:00:00.000Z',
};

const base = {
  organizationId: ORG, providerId: 'apollo', subject: 'person' as const, entityId: PERSON,
  sourceRecordId: 'sr-enrich-1', observedAt: '2026-10-29T00:00:00.000Z', ingestedAt: NOW,
  correlationId: 'corr-1', attributes: ['job_title'], payloadHash: 'h1',
};

const snapshot = (v: unknown) => JSON.parse(JSON.stringify(v));
// closure C: every recorded ref is content-addressed by the observed values.
const EMPTY_FP = enrichmentObservationFingerprint([]);

beforeEach(() => {
  db.tables = { canonical_leads: [{ ...ORIGINAL_LEAD, lead_metadata: snapshot(ORIGINAL_LEAD.lead_metadata) }] };
  db.writes = []; db.selectError = null;
  store.length = 0; store.push({ ...ORIGINATING });
  writerThrows = null; warn.mockClear();
  resetProvenanceIngestionCounters();
});

describe('enrichment profile and reference', () => {
  it('pi_enrichment, platform = provider, a namespace distinct from discovery', () => {
    expect(piEnrichmentProfile('apollo')).toEqual({ sourceCategory: 'pi_enrichment', platform: 'apollo', refProvider: 'enrichment_apollo' });
    expect(PI_ENRICHMENT_PROFILE.refProvider).toBe('enrichment_apollo');
    const ref = enrichmentExternalRef('apollo', 'person', PERSON)!;
    expect(ref).toBe(`enrichment_apollo:person:${PERSON}`);
    expect(parseExternalRef(ref)).toEqual({ provider: 'enrichment_apollo', id: `person:${PERSON}` });
    expect(ref).not.toBe(ORIGINATING.externalRef);
  });

  it('a provider id that cannot form a valid namespace is refused, never sanitised', () => {
    expect(piEnrichmentProfile('Bad Provider!')).toBeNull();
    expect(piEnrichmentProfile('')).toBeNull();
    expect(piEnrichmentProfile('x'.repeat(30))).toBeNull(); // enrichment_ + 30 > 40
  });
});

describe('acceptance #6 — enrichment contributes and preserves the originating source', () => {
  it('records ONE contributing row; originating row, canonical_leads source/created_at/metadata untouched', async () => {
    const out = await recordEnrichmentContribution({ ...base, prospectId: LEAD });
    expect(out).toEqual({ status: 'inserted', id: 'c-2', role: 'contributing', roleDowngraded: false });

    expect(store).toHaveLength(2);
    expect(store[0]).toEqual(ORIGINATING);                       // originating unchanged
    expect(store.filter((r) => r.role === 'originating')).toHaveLength(1);
    expect(store[1]).toMatchObject({
      organizationId: ORG, canonicalLeadId: LEAD, leadCreated: false, role: 'contributing',
      sourceCategory: 'pi_enrichment', platform: 'apollo',
      externalRef: `enrichment_apollo:person:${PERSON}:${EMPTY_FP}`, sourceRecordId: 'sr-enrich-1',
      observedAt: '2026-10-29T00:00:00.000Z', ingestionRunId: 'corr-1',
      evidence: expect.objectContaining({ subject: 'person', personId: PERSON, accountId: null, attributes: ['job_title'], payloadHash: 'h1' }),
      sourceMetadata: expect.objectContaining({ observedAtBasis: 'source', prospectResolvedBy: 'caller' }),
    });

    expect(db.tables.canonical_leads).toEqual([ORIGINAL_LEAD]);
    expect(db.writes).toEqual([]);                               // no write to any table but the writer
  });

  it('a prospect with NO originating row is not re-originated by enrichment', async () => {
    store.length = 0;
    const out = await recordEnrichmentContribution({ ...base, prospectId: LEAD });
    expect(out).toMatchObject({ status: 'inserted', role: 'contributing' });
    expect(store.filter((r) => r.role === 'originating')).toHaveLength(0);
  });

  it('idempotent: a retry and an IDENTICAL later refresh converge on one contribution (duplicate)', async () => {
    await recordEnrichmentContribution({ ...base, prospectId: LEAD });
    const retry = await recordEnrichmentContribution({ ...base, prospectId: LEAD });
    const refresh = await recordEnrichmentContribution({ ...base, prospectId: LEAD, observedAt: '2026-11-30T00:00:00.000Z', payloadHash: 'h2' });
    expect(retry).toEqual({ status: 'duplicate', role: null });
    expect(refresh).toEqual({ status: 'duplicate', role: null });
    expect(store).toHaveLength(2);
    expect(getProvenanceIngestionCounters()).toMatchObject({ 'pi_enrichment:inserted': 1, 'pi_enrichment:duplicate': 2 });
  });

  it('no provider time ⇒ ingestion time, flagged', async () => {
    await recordEnrichmentContribution({ ...base, prospectId: LEAD, observedAt: null });
    expect(store[1]).toMatchObject({ observedAt: NOW, sourceMetadata: expect.objectContaining({ observedAtBasis: 'ingestion' }) });
  });

  it('an account subject records against the given prospect with the account as evidence', async () => {
    await recordEnrichmentContribution(
      { ...base, prospectId: LEAD, subject: 'account', entityId: ACCOUNT },
      { readProspectAccountLink: async () => 'person_primary_account' },
    );
    expect(store[1]).toMatchObject({
      externalRef: `enrichment_apollo:account:${ACCOUNT}:${EMPTY_FP}`,
      evidence: expect.objectContaining({ subject: 'account', evidenceLevel: 'account', accountId: ACCOUNT, personId: null, accountLink: 'person_primary_account' }),
    });
  });
});

describe('which prospect — never guessed', () => {
  it('person subject without a prospect id: the single tenant prospect anchored to that person', async () => {
    const out = await recordEnrichmentContribution(base);
    expect(out).toMatchObject({ status: 'inserted', role: 'contributing' });
    expect(store[1]).toMatchObject({ canonicalLeadId: LEAD, sourceMetadata: expect.objectContaining({ prospectResolvedBy: 'person_anchor' }) });
  });

  it('several prospects for the person ⇒ skipped:ambiguous_prospect, nothing recorded', async () => {
    db.tables.canonical_leads.push({ id: 'lead-2', company_id: ORG, unified_person_id: PERSON });
    expect(await recordEnrichmentContribution(base)).toEqual({ status: 'skipped', reason: 'ambiguous_prospect' });
    expect(store).toHaveLength(1);
    expect(getProvenanceIngestionCounters()['pi_enrichment:skipped']).toBe(1);
  });

  it("another tenant's prospect for the same person id is never used", async () => {
    db.tables.canonical_leads = [{ id: 'b-lead', company_id: ORG_B, unified_person_id: PERSON }];
    expect(await recordEnrichmentContribution(base)).toEqual({ status: 'skipped', reason: 'no_prospect' });
    expect(store).toHaveLength(1);
  });

  it('account subject without a prospect id and no EVIDENCED prospect ⇒ skipped:no_prospect (no blind fan-out)', async () => {
    expect(await recordEnrichmentContribution(
      { ...base, subject: 'account', entityId: ACCOUNT },
      { findAccountProspects: async () => ({ targets: [], complete: true }) },
    )).toEqual({ status: 'skipped', reason: 'no_prospect' });
  });

  it('unusable provider id or missing source record ⇒ skipped, counted', async () => {
    expect(await recordEnrichmentContribution({ ...base, prospectId: LEAD, providerId: 'Bad Id' }))
      .toEqual({ status: 'skipped', reason: 'unmapped_provider' });
    expect(await recordEnrichmentContribution({ ...base, prospectId: LEAD, sourceRecordId: null }))
      .toEqual({ status: 'skipped', reason: 'no_source_record' });
    expect(getProvenanceIngestionCounters()['pi_enrichment:skipped']).toBe(2);
  });
});

describe('failures are observable and never fatal', () => {
  it('a writer that throws ⇒ error result, warn log, counter', async () => {
    writerThrows = new Error('relation "prospect_source_contributions" does not exist');
    const out = await recordEnrichmentContribution({ ...base, prospectId: LEAD });
    expect(out).toMatchObject({ status: 'error', code: 'threw' });
    expect(getProvenanceIngestionCounters()['pi_enrichment:error']).toBe(1);
    expect(warn).toHaveBeenCalledWith('prospect_provenance_side_effect_failed', expect.objectContaining({ path: 'pi_enrichment' }));
  });

  it('a failing prospect lookup ⇒ error result, never a throw', async () => {
    db.selectError = { message: 'boom' };
    const out = await recordEnrichmentContribution(base);
    expect(out).toMatchObject({ status: 'error', code: 'threw' });
    expect(getProvenanceIngestionCounters()['pi_enrichment:error']).toBe(1);
  });
});

describe('persistence port wiring', () => {
  const ingested: Row[] = [];
  const fakeIngest = (async (record: Row) => {
    ingested.push(record);
    return { sourceRecordId: 'sr-enrich-1', outcome: 'created', assertionsRecorded: 1, assertionsAlreadyPresent: 0, canonicalApplied: [], canonicalWithheld: [] };
  }) as never;
  const persistInput = {
    organizationId: ORG, providerId: 'apollo', subject: 'person' as const, entityId: PERSON,
    fields: [{ attribute: 'job_title', subject: 'person' as const, value: 'CTO', observedAt: null, confidence: null, providerInferred: false }],
    rawPayload: { title: 'CTO' }, payloadHash: 'h1', observedAt: null, correlationId: 'corr-1',
  };
  beforeEach(() => { ingested.length = 0; });

  it('types the enrichment source record pi_enrichment/apollo, separate from the originating record', async () => {
    const persist = makePersistObservation(fakeIngest);
    const out = await persist({ ...persistInput, prospectId: LEAD });
    expect(out).toEqual({ sourceRecordId: 'sr-enrich-1', canonicalWithheld: [] });
    expect(ingested[0]).toMatchObject({
      provider: 'apollo', entityType: 'person', sourceRecordId: `apollo:person:${PERSON}`,
      sourceCategory: 'pi_enrichment', platform: 'apollo', personId: PERSON, accountId: null,
    });
    expect(ingested[0].sourceRecordId).not.toBe(ORIGINATING.sourceRecordId);
    expect(store[1]).toMatchObject({ canonicalLeadId: LEAD, role: 'contributing', sourceRecordId: 'sr-enrich-1', sourceCategory: 'pi_enrichment' });
  });

  it('an unusable provider id writes no typed category (never a guessed one) and records nothing', async () => {
    const persist = makePersistObservation(fakeIngest);
    await persist({ ...persistInput, providerId: 'Bad Id', prospectId: LEAD });
    expect(ingested[0]).not.toHaveProperty('sourceCategory');
    expect(store).toHaveLength(1);
  });

  it('a recorder that throws never fails the persisted enrichment', async () => {
    const persist = makePersistObservation(fakeIngest, (async () => { throw new Error('boom'); }) as never);
    await expect(persist({ ...persistInput, prospectId: LEAD })).resolves.toEqual({ sourceRecordId: 'sr-enrich-1', canonicalWithheld: [] });
  });

  it('the contribution writer failing never fails the persisted enrichment', async () => {
    writerThrows = new Error('down');
    const persist = makePersistObservation(fakeIngest);
    await expect(persist({ ...persistInput, prospectId: LEAD })).resolves.toEqual({ sourceRecordId: 'sr-enrich-1', canonicalWithheld: [] });
  });

  it('executeEnrichment forwards request.prospectId to the persistence port', async () => {
    const adapter: EnrichmentProviderAdapter = {
      id: 'apollo', label: 'Apollo', supports: ['job_title'], credentialEnvVar: null,
      isAvailable: () => true,
      async enrich() {
        return {
          outcome: 'enriched',
          fields: [{ attribute: 'job_title', subject: 'person', value: 'CTO', observedAt: null, confidence: null, providerInferred: false }],
          notReturned: [], rawPayload: { title: 'CTO' }, payloadHash: 'h1',
        };
      },
    };
    const seen: Row[] = [];
    const ports: ExecuteEnrichmentPorts = {
      authorizeCost: async () => ({ authorized: true, holdId: 'h', cost: { kind: 'free' } }),
      releaseCost: async () => undefined,
      resolveCredential: async () => 'tenant-scoped-test-secret',
      findRecentObservation: async () => null,
      persistObservation: async (input) => { seen.push(input as unknown as Row); return { sourceRecordId: 'sr', canonicalWithheld: [] }; },
      now: () => NOW,
    };
    await executeEnrichment({
      organizationId: ORG, subject: 'person', entityId: PERSON, attributes: ['job_title'],
      selectors: { email_domain: 'example.com' }, purpose: 'test', correlationId: 'corr-1', prospectId: LEAD,
    }, 'apollo', ports, { adapter });
    expect(seen[0]).toMatchObject({ prospectId: LEAD, entityId: PERSON });

    seen.length = 0;
    await executeEnrichment({
      organizationId: ORG, subject: 'person', entityId: PERSON, attributes: ['job_title'],
      selectors: { email_domain: 'example.com' }, purpose: 'test', correlationId: 'corr-2',
    }, 'apollo', ports, { adapter });
    expect(seen[0].prospectId).toBeNull();
  });
});
