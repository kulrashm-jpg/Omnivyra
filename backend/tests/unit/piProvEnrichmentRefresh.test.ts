/**
 * Closure C — enrichment REFRESH semantics and ACCOUNT/PERSON applicability.
 *
 *   - An identical refresh is idempotent (same content-addressed ref ⇒ duplicate).
 *   - A materially different refresh records a NEW contributing contribution.
 *   - The originating contribution and canonical_leads are never written.
 *   - Account evidence attaches only to prospects whose account link is
 *     EVIDENCED, is marked account-level, and never fans out blindly.
 *   - Person evidence attaches only to that person's prospect, unambiguously.
 *
 * `ownedDbTable` is an in-memory table set supporting the filters the default
 * readers use (eq / in / is / limit); the contribution writer is an in-memory
 * store enforcing `uq_psc_org_lead_external_ref` and one-originating-per-lead.
 */
type Row = Record<string, unknown>;

const db = {
  tables: {} as Record<string, Row[]>,
  writes: [] as Array<{ table: string; op: string }>,
};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const st = { op: 'select', preds: [] as Array<(r: Row) => boolean>, limit: Infinity };
    const exec = async () => {
      await Promise.resolve();
      if (st.op !== 'select') {
        db.writes.push({ table, op: st.op });
        return { data: null, error: { message: `unexpected ${st.op} on ${table}` } };
      }
      const hit = (db.tables[table] ?? []).filter((r) => st.preds.every((p) => p(r)));
      return { data: hit.slice(0, st.limit), error: null };
    };
    const api: Record<string, unknown> = {
      select: () => api,
      insert: () => { st.op = 'insert'; return api; },
      update: () => { st.op = 'update'; return api; },
      upsert: () => { st.op = 'upsert'; return api; },
      delete: () => { st.op = 'delete'; return api; },
      eq: (c: string, v: unknown) => { st.preds.push((r) => r[c] === v); return api; },
      in: (c: string, vs: unknown[]) => { st.preds.push((r) => vs.includes(r[c])); return api; },
      is: (c: string, v: unknown) => { st.preds.push((r) => (r[c] ?? null) === v); return api; },
      limit: (n: number) => { st.limit = n; return api; },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => exec().then(res, rej),
    };
    return api;
  },
}));

const store: Row[] = [];
jest.mock('../../services/prospectProvenance/contributionWriter', () => ({
  recordSourceContribution: jest.fn(async (input: Row) => {
    const key = (r: Row) => `${r.organizationId}|${r.canonicalLeadId}|${r.externalRef}`;
    if (store.some((r) => key(r) === key(input))) return { status: 'duplicate', role: null };
    const role = input.leadCreated ? 'originating' : 'contributing';
    const id = `c-${store.length + 1}`;
    store.push({ ...input, id, role });
    return { status: 'inserted', id, role, roleDowngraded: false };
  }),
}));
jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import {
  recordEnrichmentContribution, enrichmentExternalRef, enrichmentObservationFingerprint, ACCOUNT_FANOUT_CAP,
} from '../../services/prospectProvenance/ingestion/enrichmentContribution';
import { makePersistObservation } from '../../services/enrichment/providers';
import { getProvenanceIngestionCounters, resetProvenanceIngestionCounters } from '../../services/prospectProvenance/ingestion/provenanceTelemetry';

const ORG = '4bdbec26-4f7e-4e77-a965-d499e1472f5c';
const ORG_B = '0eda0896-7814-4613-8b49-4a8f408e45f1';
const PERSON = '11111111-1111-4111-8111-111111111111';
const PERSON_2 = '11111111-1111-4111-8111-222222222222';
const PERSON_X = '11111111-1111-4111-8111-999999999999';
const ACCOUNT = '22222222-2222-4222-8222-222222222222';
const OTHER_ACCOUNT = '22222222-2222-4222-8222-999999999999';
const LEAD = '33333333-3333-4333-8333-333333333333';
const LEAD_2 = '33333333-3333-4333-8333-444444444444';
const LEAD_ACC = '33333333-3333-4333-8333-555555555555';
const LEAD_UNRELATED = '33333333-3333-4333-8333-999999999999';
const NOW = '2026-10-30T09:00:00.000Z';

const ORIGINATING: Row = {
  id: 'c-orig', organizationId: ORG, canonicalLeadId: LEAD, role: 'originating',
  sourceCategory: 'pi_discovery', platform: 'apollo', externalRef: 'apollo:ap-1', sourceRecordId: 'sr-disc',
};

function seed(): void {
  db.tables = {
    canonical_leads: [
      { id: LEAD, company_id: ORG, unified_person_id: PERSON, source: 'apollo', created_at: '2026-08-01T00:00:00Z' },
      { id: LEAD_2, company_id: ORG, unified_person_id: PERSON_2, source: 'csv' },
      { id: LEAD_ACC, company_id: ORG, unified_person_id: null, source: 'apollo' },   // account-only prospect
      { id: LEAD_UNRELATED, company_id: ORG, unified_person_id: PERSON_X, source: 'csv' },
      { id: 'b-lead', company_id: ORG_B, unified_person_id: PERSON, source: 'csv' },
    ],
    unified_persons: [
      { id: PERSON, company_id: ORG, account_id: ACCOUNT },                // primary employer = ACCOUNT
      { id: PERSON_2, company_id: ORG, account_id: null },
      { id: PERSON_X, company_id: ORG, account_id: OTHER_ACCOUNT },        // unrelated company
    ],
    person_account_relationships: [
      { id: 'rel-1', organization_id: ORG, person_id: PERSON_2, account_id: ACCOUNT, ended_at: null },
      { id: 'rel-old', organization_id: ORG, person_id: PERSON_X, account_id: ACCOUNT, ended_at: '2025-01-01T00:00:00Z' },
    ],
    source_records: [
      { id: 'sr-acc', organization_id: ORG, account_id: ACCOUNT },
      { id: 'sr-disc', organization_id: ORG, account_id: null },
      { id: 'sr-b', organization_id: ORG_B, account_id: ACCOUNT },
    ],
    prospect_source_contributions: [
      { organization_id: ORG, canonical_lead_id: LEAD_ACC, contribution_role: 'originating', source_record_id: 'sr-acc' },
      { organization_id: ORG, canonical_lead_id: LEAD, contribution_role: 'originating', source_record_id: 'sr-disc' },
      { organization_id: ORG_B, canonical_lead_id: 'b-lead', contribution_role: 'originating', source_record_id: 'sr-b' },
    ],
  };
  db.writes = [];
}

beforeEach(() => {
  seed();
  store.length = 0; store.push({ ...ORIGINATING });
  resetProvenanceIngestionCounters();
});

const title = (v: unknown) => [{ subject: 'person' as const, attribute: 'job_title', value: v }];
const base = {
  organizationId: ORG, providerId: 'apollo', subject: 'person' as const, entityId: PERSON,
  sourceRecordId: 'sr-enrich-1', observedAt: '2026-10-29T00:00:00.000Z', ingestedAt: NOW,
  correlationId: 'corr-1', attributes: ['job_title'], payloadHash: 'h1',
};

describe('observation fingerprint', () => {
  it('is 16 hex, order/case/whitespace-insensitive, ignores empty values', () => {
    const a = enrichmentObservationFingerprint([
      { subject: 'person', attribute: 'job_title', value: 'CTO' },
      { subject: 'account', attribute: 'technologies', value: ['React', 'Go'] },
    ]);
    const b = enrichmentObservationFingerprint([
      { subject: 'account', attribute: 'Technologies', value: [' go ', 'react', 'GO'] },
      { subject: 'person', attribute: 'job_title', value: '  cto ' },
      { subject: 'person', attribute: 'department', value: '' },
      { subject: 'person', attribute: 'seniority', value: null },
    ]);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(b).toBe(a);
  });

  it('changes when a value materially changes, or moves between subjects', () => {
    const cto = enrichmentObservationFingerprint(title('CTO'));
    expect(enrichmentObservationFingerprint(title('CEO'))).not.toBe(cto);
    expect(enrichmentObservationFingerprint([{ subject: 'account', attribute: 'job_title', value: 'CTO' }])).not.toBe(cto);
    expect(enrichmentObservationFingerprint([{ subject: 'account', attribute: 'employee_count', value: 50 }]))
      .not.toBe(enrichmentObservationFingerprint([{ subject: 'account', attribute: 'employee_count', value: 51 }]));
  });

  it('the ref keeps the provider namespace and refuses a malformed fingerprint', () => {
    const fp = enrichmentObservationFingerprint(title('CTO'));
    expect(enrichmentExternalRef('apollo', 'person', PERSON, fp)).toBe(`enrichment_apollo:person:${PERSON}:${fp}`);
    expect(enrichmentExternalRef('apollo', 'person', PERSON, fp)).toMatch(/^[a-z][a-z0-9_]{0,39}:.+/);
    expect(enrichmentExternalRef('apollo', 'person', PERSON, 'not-hex')).toBeNull();
    expect(enrichmentExternalRef('Bad Id', 'person', PERSON, fp)).toBeNull();
  });
});

describe('refresh semantics', () => {
  it('identical refresh (new time, new payload hash, new correlation) ⇒ duplicate, nothing new', async () => {
    const first = await recordEnrichmentContribution({ ...base, prospectId: LEAD, observedValues: title('CTO') });
    const again = await recordEnrichmentContribution({
      ...base, prospectId: LEAD, observedValues: title(' cto '), observedAt: '2026-12-01T00:00:00.000Z',
      payloadHash: 'h-other', correlationId: 'corr-2',
    });
    expect(first).toMatchObject({ status: 'inserted', role: 'contributing' });
    expect(again).toEqual({ status: 'duplicate', role: null });
    expect(store).toHaveLength(2);
  });

  it('materially changed refresh ⇒ a NEW contributing contribution; the first stays; originating untouched', async () => {
    await recordEnrichmentContribution({ ...base, prospectId: LEAD, observedValues: title('CTO') });
    const changed = await recordEnrichmentContribution({ ...base, prospectId: LEAD, observedValues: title('CEO'), correlationId: 'corr-2' });
    expect(changed).toMatchObject({ status: 'inserted', role: 'contributing' });
    expect(store).toHaveLength(3);
    expect(store[0]).toEqual(ORIGINATING);
    expect(store.filter((r) => r.role === 'originating')).toHaveLength(1);
    const refs = store.slice(1).map((r) => r.externalRef as string);
    expect(new Set(refs).size).toBe(2);
    for (const r of store.slice(1)) {
      expect(r).toMatchObject({ leadCreated: false, sourceCategory: 'pi_enrichment', platform: 'apollo', canonicalLeadId: LEAD });
      // Values are hashed, never stored.
      expect(JSON.stringify(r.evidence)).not.toMatch(/CTO|CEO/i);
    }
    expect(db.writes).toEqual([]);
  });

  it('through the real persistence port: identical twice ⇒ 1 row, changed ⇒ 2 rows', async () => {
    const ingest = (async () => ({ sourceRecordId: 'sr-enrich-1', outcome: 'updated', assertionsRecorded: 1, assertionsAlreadyPresent: 0, canonicalApplied: [], canonicalWithheld: [] })) as never;
    const persist = makePersistObservation(ingest);
    const field = (value: string) => ({ attribute: 'job_title', subject: 'person' as const, value, observedAt: null, confidence: 0.9, providerInferred: false });
    const input = (value: string, corr: string) => ({
      organizationId: ORG, providerId: 'apollo', subject: 'person' as const, entityId: PERSON, prospectId: LEAD,
      fields: [field(value)], rawPayload: { t: value, at: corr }, payloadHash: corr, observedAt: null, correlationId: corr,
    });
    await persist(input('CTO', 'r1'));
    await persist(input('CTO', 'r2'));
    expect(store).toHaveLength(2);
    await persist(input('VP Engineering', 'r3'));
    expect(store).toHaveLength(3);
    expect(getProvenanceIngestionCounters()).toMatchObject({ 'pi_enrichment:inserted': 2, 'pi_enrichment:duplicate': 1 });
  });
});

describe('person applicability', () => {
  it('a caller prospect NOT anchored to the person ⇒ skipped, nothing recorded', async () => {
    expect(await recordEnrichmentContribution({ ...base, prospectId: LEAD_2, observedValues: title('CTO') }))
      .toEqual({ status: 'skipped', reason: 'prospect_not_anchored_to_person' });
    expect(await recordEnrichmentContribution({ ...base, prospectId: 'b-lead', observedValues: title('CTO') }))
      .toEqual({ status: 'skipped', reason: 'prospect_not_anchored_to_person' });   // other tenant's prospect
    expect(store).toHaveLength(1);
  });

  it('evidence level is person', async () => {
    await recordEnrichmentContribution({ ...base, prospectId: LEAD, observedValues: title('CTO') });
    expect(store[1].evidence).toMatchObject({ evidenceLevel: 'person', personId: PERSON, accountId: null, accountLink: null });
  });
});

describe('account applicability (evidenced only, marked account-level)', () => {
  const acc = { ...base, subject: 'account' as const, entityId: ACCOUNT, attributes: ['employee_count'],
    observedValues: [{ subject: 'account' as const, attribute: 'employee_count', value: 120 }] };

  it('caller prospect whose person names the account ⇒ recorded, account-level, link = person_primary_account', async () => {
    const out = await recordEnrichmentContribution({ ...acc, prospectId: LEAD });
    expect(out).toMatchObject({ status: 'inserted', role: 'contributing' });
    expect(store[1].evidence).toMatchObject({
      subject: 'account', evidenceLevel: 'account', accountId: ACCOUNT, personId: null, accountLink: 'person_primary_account',
    });
  });

  it('caller prospect whose ORIGINATING source record names the account ⇒ link = originating_source_record', async () => {
    await recordEnrichmentContribution({ ...acc, prospectId: LEAD_ACC });
    expect(store[1]).toMatchObject({ canonicalLeadId: LEAD_ACC, evidence: expect.objectContaining({ accountLink: 'originating_source_record' }) });
  });

  it('caller prospect linked only by a CURRENT relationship ⇒ link = person_account_relationship', async () => {
    await recordEnrichmentContribution({ ...acc, prospectId: LEAD_2 });
    expect(store[1].evidence).toMatchObject({ accountLink: 'person_account_relationship' });
  });

  it('caller prospect with NO evidenced link (incl. an ENDED relationship) ⇒ skipped:account_link_unevidenced', async () => {
    expect(await recordEnrichmentContribution({ ...acc, prospectId: LEAD_UNRELATED }))
      .toEqual({ status: 'skipped', reason: 'account_link_unevidenced' });
    expect(store).toHaveLength(1);
  });

  it('no caller prospect ⇒ fan-out to EVIDENCED prospects only; unrelated and other-tenant prospects untouched', async () => {
    const out = await recordEnrichmentContribution(acc);
    expect(out).toMatchObject({ status: 'fanout' });
    const got = new Set(store.slice(1).map((r) => r.canonicalLeadId));
    expect(got).toEqual(new Set([LEAD, LEAD_2, LEAD_ACC]));
    expect(got.has(LEAD_UNRELATED)).toBe(false);
    expect(got.has('b-lead')).toBe(false);
    for (const r of store.slice(1)) {
      expect(r.evidence).toMatchObject({ evidenceLevel: 'account', accountId: ACCOUNT, personId: null });
      expect(r.sourceMetadata).toMatchObject({ prospectResolvedBy: 'account_link' });
    }
    // Repeat is idempotent across the whole fan-out.
    const again = await recordEnrichmentContribution(acc);
    expect((again as { targets: Array<{ outcome: { status: string } }> }).targets.every((t) => t.outcome.status === 'duplicate')).toBe(true);
    expect(store).toHaveLength(4);
  });

  it('an over-cap or incomplete evidenced set records NOTHING (never a partial fan-out)', async () => {
    const many = Array.from({ length: ACCOUNT_FANOUT_CAP + 1 }, (_, i) => ({ prospectId: `l-${i}`, via: 'person_primary_account' as const }));
    expect(await recordEnrichmentContribution(acc, { findAccountProspects: async () => ({ targets: many, complete: true }) }))
      .toEqual({ status: 'skipped', reason: 'too_many_account_prospects' });
    expect(await recordEnrichmentContribution(acc, { findAccountProspects: async () => ({ targets: many.slice(0, 2), complete: false }) }))
      .toEqual({ status: 'skipped', reason: 'too_many_account_prospects' });
    expect(store).toHaveLength(1);
  });
});
