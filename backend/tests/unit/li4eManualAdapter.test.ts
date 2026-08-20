/**
 * LI-4E — the manual adapter, end to end through the real LI-4D pipeline.
 *
 * The primary tests deliberately do NOT call the adapter directly. They call
 * `ingestLeadBatch`, which discovers the adapter through the registry and runs
 * the real orchestrator, the real LI-2 boundary, the real identity resolver and
 * the real LI-4C duplicate detector against ONE shared in-memory database.
 *
 * That matters: every layer below the orchestrator is genuine code here, not a
 * mock of itself. The only thing replaced is the database driver — because the
 * point is to prove the chain holds, not to re-prove PostgreSQL.
 */

type Row = Record<string, unknown>;

/** The shared database every layer in this test reads and writes. */
const db: Record<string, Row[]> = {
  unified_persons: [],
  source_records: [],
  source_assertions: [],
  person_duplicate_candidates: [],
  prospect_accounts: [],
};
let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;
let failTable: string | null = null;

/** Unique constraints the real schema enforces, mirrored so collisions are real. */
function violatesUnique(table: string, row: Row): boolean {
  if (table === 'unified_persons') {
    return db.unified_persons.some((r) =>
      r.company_id === row.company_id &&
      ((row.primary_email && r.primary_email === row.primary_email) ||
       (row.primary_phone && r.primary_phone === row.primary_phone)));
  }
  if (table === 'source_records') {
    return db.source_records.some((r) =>
      r.organization_id === row.organization_id &&
      r.provider === row.provider &&
      r.source_record_id === row.source_record_id);
  }
  if (table === 'person_duplicate_candidates') {
    const pair = (r: Row) => [r.person_id, r.candidate_person_id].sort().join('|');
    return db.person_duplicate_candidates.some((r) =>
      r.status === 'open' && r.candidate_person_id &&
      r.organization_id === row.organization_id && pair(r) === pair(row));
  }
  if (table === 'source_assertions') {
    return db.source_assertions.some((r) =>
      r.source_record_id === row.source_record_id && r.attribute === row.attribute
      && r.value_hash === row.value_hash);
  }
  return false;
}

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const filters: Array<[string, unknown]> = [];
    const ins: Array<[string, unknown[]]> = [];
    const contains: Array<[string, unknown]> = [];
    const b: Record<string, unknown> = {};
    const c = () => b;

    const matches = (r: Row) =>
      filters.every(([k, v]) => (v === null ? r[k] == null : r[k] === v)) &&
      ins.every(([k, vs]) => vs.includes(r[k] as never)) &&
      contains.every(([k, v]) => {
        const have = (r[k] ?? {}) as Record<string, unknown>;
        return Object.entries(v as Record<string, unknown>)
          .every(([pk, pv]) => JSON.stringify(have[pk]) === JSON.stringify(pv));
      });

    const rows = () => (db[table] ?? []).filter(matches);

    b.select = () => c();
    b.limit = () => c();
    b.order = () => c();
    b.eq = (k: string, v: unknown) => { filters.push([k, v]); return c(); };
    b.is = (k: string, v: unknown) => { filters.push([k, v]); return c(); };
    b.in = (k: string, v: unknown[]) => { ins.push([k, v]); return c(); };
    b.contains = (k: string, v: unknown) => { contains.push([k, v]); return c(); };
    // LI-2 reads the canonical row with `.select().eq().eq().single()`, so a
    // select chain must terminate in single/maybeSingle as well as being awaitable.
    b.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null });
    b.single = async () => {
      if (failTable === table) return { error: { code: 'XX000', message: `${table} unavailable` } };
      const found = rows()[0];
      return found ? { data: found, error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
    };

    b.insert = (row: Row) => {
      const done = async () => {
        if (failTable === table) return { error: { code: 'XX000', message: `${table} unavailable` } };
        if (violatesUnique(table, row)) {
          return { error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
        }
        // Column DEFAULTs the real schema applies. `unified_persons.status`
        // defaults to 'active' (LI-4C); without it every person would read as
        // non-active and LI-4C's detector — which only considers live people —
        // would find nothing.
        const defaults: Row = table === 'unified_persons'
          ? { status: 'active', merged_into_id: null }
          : table === 'person_duplicate_candidates' ? { status: 'open' }
            // `source_records.observation_count integer NOT NULL DEFAULT 1`
            // (20261002000000). The boundary never sets it on insert, so without
            // the default here a first observation reads as undefined and the
            // count contract below could not be asserted at all.
            : table === 'source_records' ? { observation_count: 1 }
              : {};
        const created: Row = { id: nextId(table), created_at: '2026-01-01T00:00:00.000Z', ...defaults, ...row };
        (db[table] ??= []).push(created);
        return { data: { id: created.id }, error: null };
      };
      return { select: () => ({ single: done, maybeSingle: done }), single: done };
    };

    b.update = (patch: Row) => {
      const uf: Array<[string, unknown]> = [];
      const u: Record<string, unknown> = {};
      const apply = () => {
        const hit = (db[table] ?? []).filter((r) => uf.every(([k, v]) => (v === null ? r[k] == null : r[k] === v)));
        for (const r of hit) Object.assign(r, patch);
        return hit;
      };
      u.eq = (k: string, v: unknown) => { uf.push([k, v]); return u; };
      u.is = (k: string, v: unknown) => { uf.push([k, v]); return u; };
      u.select = async () => ({ data: apply().map((r) => ({ id: r.id })), error: null });
      (u as { then?: unknown }).then = (res: (v: unknown) => void) => res({ data: apply(), error: null });
      return u;
    };

    (b as { then?: unknown }).then = (res: (v: unknown) => void) => {
      if (failTable === table) return res({ error: { message: `${table} unavailable` } });
      return res({ data: rows(), error: null });
    };
    return b;
  },
}));

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}), { virtual: true });

import { ingestLeadBatch } from '../../services/leadIngestion/orchestrator';
import { __resetLeadSourceRegistry, listLeadSources, hasLeadSourceAdapter } from '../../services/leadIngestion/registry';
import { registerBuiltInLeadSources } from '../../services/leadIngestion';
import {
  manualAdapter, manualExternalId, toNormalizedManualRecord, validateManualInput,
  ManualInputError, MANUAL_SOURCE, type ManualLeadInput,
} from '../../services/leadIngestion/adapters/manualAdapter';

const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000bb';

const person = (over: Partial<ManualLeadInput> = {}): Record<string, unknown> => ({
  firstName: 'Test', lastName: 'Person', email: 'Test.Person@Example.COM',
  jobTitle: 'Head of Ops', ...over,
});

const ingest = (org: string, records: Array<Record<string, unknown>>) =>
  ingestLeadBatch({ organizationId: org, source: MANUAL_SOURCE, records, now: '2026-08-15T00:00:00.000Z' });

// The ingestion capability gate is default-OFF. This suite drives the REAL
// orchestrator end to end, so it states the enabled contract explicitly and
// restores the ambient value afterwards.
const INGESTION_FLAG = 'ENABLE_LEAD_INGESTION';
let ingestionFlagBefore: string | undefined;
beforeAll(() => { ingestionFlagBefore = process.env[INGESTION_FLAG]; });
afterAll(() => {
  if (ingestionFlagBefore === undefined) delete process.env[INGESTION_FLAG];
  else process.env[INGESTION_FLAG] = ingestionFlagBefore;
});

beforeEach(() => {
  process.env[INGESTION_FLAG] = 'true';
  for (const k of Object.keys(db)) db[k] = [];
  seq = 0;
  failTable = null;
  __resetLeadSourceRegistry();
  registerBuiltInLeadSources();
});

describe('LI-4E — 1/2. adapter contract and registry discovery', () => {
  // LI-5E.4 added a SECOND built-in, `crm`. These three assertions counted the
  // built-ins, so they move with it. What they protect has NOT been relaxed:
  // both built-ins are operator-supplied entry adapters, and no provider adapter
  // is registered. `crm` leaves the forbidden list below because it is a
  // NAMESPACE, not an integration — it reaches no CRM. `manual` is unchanged.
  it('registers exactly the two operator-supplied sources', () => {
    expect(listLeadSources()).toEqual([
      { source: 'manual', label: 'Manual entry', capabilities: ['person_discovery', 'account_discovery'] },
      { source: 'crm', label: 'CRM record (operator-supplied)', capabilities: ['person_discovery', 'account_discovery'] },
    ]);
  });

  it('registers NO provider adapter', () => {
    // Every entry below would require a credential, a network call or a vendor.
    for (const p of ['apollo', 'linkedin', 'rapidapi', 'csv', 'xlsx', 'hubspot', 'salesforce', 'zoho']) {
      expect(hasLeadSourceAdapter(p)).toBe(false);
    }
  });

  it('registration is idempotent', () => {
    expect(() => { registerBuiltInLeadSources(); registerBuiltInLeadSources(); }).not.toThrow();
    expect(listLeadSources()).toHaveLength(2);
  });

  it('claims only capabilities it implements — it fetches, searches and enriches nothing', () => {
    expect(manualAdapter.capabilities).not.toContain('search');
    expect(manualAdapter.capabilities).not.toContain('enrichment');
    expect(manualAdapter.capabilities).not.toContain('bulk_fetch');
    expect(manualAdapter.capabilities).not.toContain('single_record_fetch');
  });
});

describe('LI-4E — 3. normalization reuses the platform rules', () => {
  it('normalises the email through the existing rule', () => {
    const r = toNormalizedManualRecord({ organizationId: ORG_A, email: '  Test.Person@Example.COM ' });
    // Trimmed by the adapter; lowercased by the platform's normalizer downstream.
    expect(r.person?.email).toBe('Test.Person@Example.COM');
  });

  it('composes fullName from first and last when not supplied', () => {
    const r = toNormalizedManualRecord({ organizationId: ORG_A, email: 'a@x.test', firstName: 'Ada', lastName: 'Lovelace' });
    expect(r.person?.fullName).toBe('Ada Lovelace');
  });

  it('prefers an explicit fullName', () => {
    const r = toNormalizedManualRecord({
      organizationId: ORG_A, email: 'a@x.test', firstName: 'Ada', lastName: 'Lovelace', fullName: 'Ada King',
    });
    expect(r.person?.fullName).toBe('Ada King');
  });

  it('upper-cases a country code through the existing normalizer', () => {
    const r = toNormalizedManualRecord({ organizationId: ORG_A, email: 'a@x.test', countryCode: 'gb' });
    expect(r.person?.countryCode).toBe('GB');
  });

  it('passes the employer DOMAIN through unnormalised — W4 owns that rule', () => {
    const r = toNormalizedManualRecord({
      organizationId: ORG_A, email: 'a@x.test', companyDomain: 'https://ACME.test/careers',
    });
    expect(r.account?.domain).toBe('https://ACME.test/careers');
  });

  it('creates no second normalizer', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../services/leadIngestion/adapters/manualAdapter.ts'), 'utf8');
    expect(src).toMatch(/import \{ normalizeEmail, normalizePhone \}/);
    expect(src).toMatch(/normalizeCountryCode, normalizeDisplayText/);
    // It must not define its own.
    expect(src).not.toMatch(/function normalizeEmail/);
    expect(src).not.toMatch(/function normalizePhone/);
  });
});

describe('LI-4E — 6/7/8. end-to-end through the real orchestrator', () => {
  it('a new person traverses the whole chain and lands once', async () => {
    const r = await ingest(ORG_A, [person()]);
    expect(r.succeeded).toBe(1);

    const o = r.outcomes[0];
    expect(o.ok).toBe(true);
    expect(o.personId).toBeTruthy();
    expect(o.sourceRecordId).toBeTruthy();
    expect(o.provenanceOutcome).toBe('created');

    expect(db.unified_persons).toHaveLength(1);          // exactly one canonical person
    expect(db.source_records).toHaveLength(1);           // exactly one evidence row
    expect(db.source_assertions.length).toBeGreaterThan(0);
  });

  it('the person is tenant-owned and carries the normalized identity', async () => {
    await ingest(ORG_A, [person()]);
    const p = db.unified_persons[0];
    expect(p.company_id).toBe(ORG_A);
    expect(p.primary_email).toBe('test.person@example.com');   // normalized by W1
  });

  it('provenance names the manual source and the record identity', async () => {
    await ingest(ORG_A, [person({ referenceId: 'OP-100' })]);
    const sr = db.source_records[0];
    expect(sr.organization_id).toBe(ORG_A);
    expect(sr.provider).toBe('manual');
    expect(sr.source_record_id).toBe('OP-100');
    expect(sr.person_id).toBe(db.unified_persons[0].id);       // linked on arrival
  });

  it('assertions carry the operator-stated attributes', async () => {
    await ingest(ORG_A, [person({ jobTitle: 'Head of Ops' })]);
    const attrs = db.source_assertions.map((a) => a.attribute);
    expect(attrs).toContain('job_title');
    expect(attrs).toContain('full_name');
  });

  it('the adapter never writes anything itself', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../services/leadIngestion/adapters/manualAdapter.ts'), 'utf8');
    expect(src).not.toMatch(/ownedDbTable/);
    expect(src).not.toMatch(/unified_persons/);
    expect(src).not.toMatch(/source_records/);
    expect(src).not.toMatch(/resolveUnifiedPerson/);
  });

  it('resolves the employer through W4 and attaches the person', async () => {
    const r = await ingest(ORG_A, [person({ companyName: 'ACME', companyDomain: 'acme.test' })]);
    expect(r.outcomes[0].accountId).toBeTruthy();
    expect(db.prospect_accounts).toHaveLength(1);
    expect(db.prospect_accounts[0].organization_id).toBe(ORG_A);
    expect(db.unified_persons[0].account_id).toBe(db.prospect_accounts[0].id);
  });
});

describe('LI-4E — 9/11. idempotency and the duplicate path', () => {
  it('B: the same reference twice is one source record and one person', async () => {
    await ingest(ORG_A, [person({ referenceId: 'OP-1' })]);
    const second = await ingest(ORG_A, [person({ referenceId: 'OP-1' })]);

    expect(second.succeeded).toBe(1);
    expect(db.source_records).toHaveLength(1);           // collided on 23505, re-resolved
    expect(db.unified_persons).toHaveLength(1);
    expect(second.outcomes[0].provenanceOutcome).not.toBe('created');
  });

  it('re-entry with NO reference is idempotent via the deterministic identity', async () => {
    await ingest(ORG_A, [person()]);
    await ingest(ORG_A, [person()]);
    expect(db.source_records).toHaveLength(1);
    expect(db.unified_persons).toHaveLength(1);
  });

  it('C: a second reference for the same email is TWO records but ONE person', async () => {
    const a = await ingest(ORG_A, [person({ referenceId: 'OP-1' })]);
    const b = await ingest(ORG_A, [person({ referenceId: 'OP-2' })]);

    expect(db.source_records).toHaveLength(2);           // distinct evidence
    expect(db.unified_persons).toHaveLength(1);          // one canonical person
    expect(a.outcomes[0].personId).toBe(b.outcomes[0].personId);
  });

  it('D: a disjoint-identifier person is PARKED, never merged', async () => {
    // Person 1 known only by phone; person 2 only by email.
    await ingest(ORG_A, [{ referenceId: 'OP-P', phone: '+15550100000', firstName: 'Split' }]);
    await ingest(ORG_A, [{ referenceId: 'OP-E', email: 'split@example.test', firstName: 'Split' }]);
    expect(db.unified_persons).toHaveLength(2);

    // A third entry carrying BOTH identifiers resolves onto one of them and
    // surfaces the other as a candidate.
    const r = await ingest(ORG_A, [{ referenceId: 'OP-BOTH', email: 'split@example.test', phone: '+15550100000' }]);

    expect(r.outcomes[0].duplicatesParked).toBe(1);
    expect(db.person_duplicate_candidates).toHaveLength(1);
    const cand = db.person_duplicate_candidates[0];
    expect(cand.status).toBe('open');
    expect(cand.classification).toBe('definite');
    expect(cand.organization_id).toBe(ORG_A);
    expect(cand.source_record_id).toBeTruthy();          // attributable to its evidence

    // NOTHING was merged.
    expect(db.unified_persons.filter((p) => p.status === 'merged')).toHaveLength(0);
    expect(db.unified_persons.filter((p) => p.merged_into_id)).toHaveLength(0);
  });

  it('re-running the duplicate case does not raise a second open candidate', async () => {
    await ingest(ORG_A, [{ referenceId: 'OP-P', phone: '+15550100000' }]);
    await ingest(ORG_A, [{ referenceId: 'OP-E', email: 'split@example.test' }]);
    await ingest(ORG_A, [{ referenceId: 'OP-B1', email: 'split@example.test', phone: '+15550100000' }]);
    const again = await ingest(ORG_A, [{ referenceId: 'OP-B2', email: 'split@example.test', phone: '+15550100000' }]);

    expect(db.person_duplicate_candidates).toHaveLength(1);
    expect(again.outcomes[0].duplicatesAlreadyOpen).toBe(1);
    expect(again.outcomes[0].duplicatesParked).toBe(0);
  });
});

/**
 * `observation_count` — the ONE non-idempotent effect in the ingestion path.
 *
 * It lives on `source_records` and nowhere else: it counts how many times a
 * given provider record was OBSERVED, while the row itself stays unique. Row
 * identity and observation count are deliberately different guarantees, and the
 * boundary says so — "the ROW IDENTITY … is exact and is what the tests assert".
 *
 * These tests pin the sequential contract only. The documented KNOWN LIMIT is
 * that the read-modify-write may UNDER-report under simultaneous re-ingestion,
 * so nothing here asserts a count under concurrency — that would pin a value the
 * implementation deliberately does not promise.
 */
describe('LI-4E — observation_count: the source record is counted, not duplicated', () => {
  it('a first observation lands at the schema default of 1', async () => {
    await ingest(ORG_A, [person({ referenceId: 'OBS-1' })]);
    expect(db.source_records).toHaveLength(1);
    expect(db.source_records[0].observation_count).toBe(1);
  });

  it('re-ingesting the SAME provider record increments rather than duplicating', async () => {
    await ingest(ORG_A, [person({ referenceId: 'OBS-1' })]);
    await ingest(ORG_A, [person({ referenceId: 'OBS-1' })]);

    expect(db.source_records).toHaveLength(1);             // identity is exact
    expect(db.source_records[0].observation_count).toBe(2); // the count is not
  });

  it('the increment builds on the stored value — it never resets to 1', async () => {
    for (let i = 0; i < 4; i++) await ingest(ORG_A, [person({ referenceId: 'OBS-1' })]);
    expect(db.source_records).toHaveLength(1);
    expect(db.source_records[0].observation_count).toBe(4);
  });

  it('a CHANGED payload for the same record still counts one observation, not a new row', async () => {
    await ingest(ORG_A, [person({ referenceId: 'OBS-1', jobTitle: 'Head of Ops' })]);
    await ingest(ORG_A, [person({ referenceId: 'OBS-1', jobTitle: 'VP Operations' })]);
    expect(db.source_records).toHaveLength(1);
    expect(db.source_records[0].observation_count).toBe(2);
  });

  it('a DIFFERENT provider record for the same person is its own row at 1', async () => {
    // Source-record identity is (org, provider, entity_type, source_record_id).
    // The person is reused; the count is per record, never per person.
    await ingest(ORG_A, [person({ referenceId: 'OBS-1' })]);
    await ingest(ORG_A, [person({ referenceId: 'OBS-2' })]);

    expect(db.unified_persons).toHaveLength(1);            // one person
    expect(db.source_records).toHaveLength(2);             // two observations of it
    expect(db.source_records.map((r) => r.observation_count).sort()).toEqual([1, 1]);
  });

  it('the same record in another tenant starts its own count — the counter is tenant-scoped', async () => {
    await ingest(ORG_A, [person({ referenceId: 'OBS-1' })]);
    await ingest(ORG_A, [person({ referenceId: 'OBS-1' })]);
    await ingest(ORG_B, [person({ referenceId: 'OBS-1' })]);

    const a = db.source_records.find((r) => r.organization_id === ORG_A);
    const b = db.source_records.find((r) => r.organization_id === ORG_B);
    expect(a!.observation_count).toBe(2);
    expect(b!.observation_count).toBe(1);
  });

  it('a record that never reached provenance is never counted', async () => {
    // Identity fails ⇒ the boundary is never called ⇒ no row, no count.
    failTable = 'unified_persons';
    const r = await ingest(ORG_A, [person({ referenceId: 'OBS-1' })]);
    expect(r.failed).toBe(1);
    expect(db.source_records ?? []).toHaveLength(0);
  });
});

/**
 * Mid-record partial-write residue.
 *
 * The chain is NOT transactional — the orchestrator states it — so a failure at
 * step N leaves steps 1..N-1 committed. That is the existing contract, and these
 * tests exist to DOCUMENT and PROTECT it, not to argue with it: they assert the
 * rows that survive, not merely the error that is returned.
 */
describe('LI-4E — partial-write residue: what survives a mid-record failure', () => {
  it('provenance failure: the person is ALREADY durable, and the record still reports failed', async () => {
    failTable = 'source_records';
    const r = await ingest(ORG_A, [person({ referenceId: 'PW-1' })]);

    expect(r.succeeded).toBe(0);
    expect(r.failed).toBe(1);
    expect(r.outcomes[0]).toMatchObject({ ok: false, rejection: 'provenance_failed' });

    // STATE, not just the verdict: the identity survives the failure.
    expect(db.unified_persons).toHaveLength(1);
    expect(db.unified_persons[0].company_id).toBe(ORG_A);
    expect(db.source_records ?? []).toHaveLength(0);
    expect(db.source_assertions ?? []).toHaveLength(0);
  });

  it('identity failure: nothing downstream is written at all', async () => {
    failTable = 'unified_persons';
    const r = await ingest(ORG_A, [person({ referenceId: 'PW-2' })]);

    expect(r.outcomes[0]).toMatchObject({ ok: false, rejection: 'identity_failed' });
    expect(db.unified_persons ?? []).toHaveLength(0);
    expect(db.source_records ?? []).toHaveLength(0);
    expect(db.source_assertions ?? []).toHaveLength(0);
    expect(db.person_duplicate_candidates ?? []).toHaveLength(0);
  });

  it('duplicate-detection failure: person AND evidence are durable, yet ok is false', async () => {
    // The sharpest case: the record reports failed while the person and its
    // evidence stand. The outcome carries the ids precisely so the operator can
    // see what landed. Detection only writes when a candidate actually exists,
    // so this reuses the disjoint-identifier shape the park case establishes.
    await ingest(ORG_A, [{ referenceId: 'PW-P', phone: '+15550100000', firstName: 'Split' }]);
    await ingest(ORG_A, [{ referenceId: 'PW-E', email: 'split@example.test', firstName: 'Split' }]);
    failTable = 'person_duplicate_candidates';
    const r = await ingest(ORG_A, [{ referenceId: 'PW-3', email: 'split@example.test', phone: '+15550100000' }]);

    const o = r.outcomes[0];
    expect(o.ok).toBe(false);
    expect(o.rejection).toBe('duplicate_detection_failed');
    expect(o.personId).toBeTruthy();          // reported, because it is durable
    expect(o.sourceRecordId).toBeTruthy();    // reported, because it is durable

    expect(db.unified_persons.length).toBeGreaterThan(1);
    expect(db.source_records.some((s) => s.source_record_id === 'PW-3')).toBe(true);
    expect(db.source_assertions.length).toBeGreaterThan(0);
  });

  it('a failed record never reports success — no false green anywhere in the batch', async () => {
    failTable = 'source_records';
    const r = await ingest(ORG_A, [person({ referenceId: 'PW-4' })]);
    expect(r.outcomes.every((o) => o.ok === false)).toBe(true);
    expect(r.succeeded).toBe(0);
  });

  it('one record failing mid-write does not stop the rest of the batch', async () => {
    // Arm detection to fail, then send a batch whose FIRST record trips it and
    // whose SECOND does not. Per-record independence has to hold even when the
    // failing record has already left residue behind.
    await ingest(ORG_A, [{ referenceId: 'PW-P', phone: '+15550100000', firstName: 'Split' }]);
    await ingest(ORG_A, [{ referenceId: 'PW-E', email: 'split@example.test', firstName: 'Split' }]);
    failTable = 'person_duplicate_candidates';

    const r = await ingest(ORG_A, [
      { referenceId: 'PW-5', email: 'split@example.test', phone: '+15550100000' }, // trips detection
      person({ referenceId: 'PW-6', email: 'unrelated@example.com' }),             // clean
    ]);

    expect(r.total).toBe(2);
    expect(r.outcomes[0]).toMatchObject({ ok: false, rejection: 'duplicate_detection_failed' });
    expect(r.outcomes[1].ok).toBe(true);          // the failure did not stop the batch
    expect(db.source_records.some((s) => s.source_record_id === 'PW-6')).toBe(true);
  });

  it('retrying after the fault clears CONVERGES — the residue is reused, never duplicated', async () => {
    failTable = 'source_records';
    const first = await ingest(ORG_A, [person({ referenceId: 'PW-7' })]);
    expect(first.failed).toBe(1);
    expect(db.unified_persons).toHaveLength(1);   // residue from the failed attempt

    failTable = null;
    const second = await ingest(ORG_A, [person({ referenceId: 'PW-7' })]);
    expect(second.succeeded).toBe(1);

    // The retry reused the orphaned person rather than creating a second one,
    // and the source record is a FIRST observation — the failed attempt never
    // reached the boundary, so it was never counted.
    expect(db.unified_persons).toHaveLength(1);
    expect(db.source_records).toHaveLength(1);
    expect(db.source_records[0].observation_count).toBe(1);
  });
});

describe('LI-4E — 10/13. tenant isolation', () => {
  it('the same person in two tenants stays two independent canonical people', async () => {
    const a = await ingest(ORG_A, [person({ referenceId: 'OP-1' })]);
    const b = await ingest(ORG_B, [person({ referenceId: 'OP-1' })]);

    expect(a.outcomes[0].personId).not.toBe(b.outcomes[0].personId);
    expect(db.unified_persons).toHaveLength(2);
    expect(db.unified_persons.map((p) => p.company_id).sort()).toEqual([ORG_A, ORG_B].sort());
  });

  it('the same reference in two tenants yields two separate source records', async () => {
    await ingest(ORG_A, [person({ referenceId: 'OP-1' })]);
    await ingest(ORG_B, [person({ referenceId: 'OP-1' })]);
    expect(db.source_records).toHaveLength(2);
    expect(db.source_records.map((r) => r.organization_id).sort()).toEqual([ORG_A, ORG_B].sort());
  });

  it('Tenant A never resolves onto Tenant B\'s person', async () => {
    await ingest(ORG_B, [person({ referenceId: 'OP-1' })]);
    const a = await ingest(ORG_A, [person({ referenceId: 'OP-1' })]);
    const resolved = db.unified_persons.find((p) => p.id === a.outcomes[0].personId)!;
    expect(resolved.company_id).toBe(ORG_A);
  });

  it('no duplicate candidate ever spans two tenants', async () => {
    await ingest(ORG_A, [{ referenceId: 'P', phone: '+15550100000' }]);
    await ingest(ORG_B, [{ referenceId: 'E', email: 'split@example.test' }]);
    await ingest(ORG_A, [{ referenceId: 'B', email: 'split@example.test', phone: '+15550100000' }]);

    for (const cand of db.person_duplicate_candidates) {
      const p1 = db.unified_persons.find((p) => p.id === cand.person_id);
      const p2 = db.unified_persons.find((p) => p.id === cand.candidate_person_id);
      expect(p1?.company_id).toBe(cand.organization_id);
      if (p2) expect(p2.company_id).toBe(cand.organization_id);
    }
  });
});

describe('LI-4E — 12. concurrency', () => {
  /**
   * KNOWN GAP, asserted rather than hidden (LI-4E finding P1-1).
   *
   * `resolveUnifiedPerson` (W1) does NOT catch 23505 when two callers create the
   * same brand-new person at once — it throws. The outcome is still SAFE: the
   * unique index means exactly one person is created, never two, and the loser
   * gets a deterministic `identity_failed` that a retry resolves. But it is not
   * self-healing the way LI-2, W4 and LI-4C are, and fixing W1 is outside this
   * phase. These tests pin the behaviour that actually exists.
   */
  it('concurrent entries for a NEW person create exactly one person, never two', async () => {
    const rows = [person({ referenceId: 'RACE-1' })];
    const [a, b] = await Promise.all([ingest(ORG_A, rows), ingest(ORG_A, rows)]);

    expect(db.unified_persons).toHaveLength(1);          // no duplicate, ever
    expect(a.succeeded + b.succeeded).toBeGreaterThanOrEqual(1);

    const loser = [...a.outcomes, ...b.outcomes].find((o) => !o.ok);
    if (loser) {
      // Fails closed and says why — it does not silently create a second person.
      expect(loser.rejection).toBe('identity_failed');
      expect(db.unified_persons).toHaveLength(1);
    }
  });

  it('a retry after a concurrent loss resolves onto the winner', async () => {
    const rows = [person({ referenceId: 'RACE-2' })];
    await Promise.all([ingest(ORG_A, rows), ingest(ORG_A, rows)]);
    const retry = await ingest(ORG_A, rows);

    expect(retry.succeeded).toBe(1);
    expect(db.unified_persons).toHaveLength(1);
    expect(retry.outcomes[0].personId).toBe(db.unified_persons[0].id);
  });

  it('once the person EXISTS, concurrent entries resolve onto it and never duplicate', async () => {
    await ingest(ORG_A, [person({ referenceId: 'SEED' })]);   // person now exists
    const [a, b] = await Promise.all([
      ingest(ORG_A, [person({ referenceId: 'R1' })]),
      ingest(ORG_A, [person({ referenceId: 'R2' })]),
    ]);
    expect(a.succeeded).toBe(1);
    expect(b.succeeded).toBe(1);
    expect(db.unified_persons).toHaveLength(1);
    expect(a.outcomes[0].personId).toBe(b.outcomes[0].personId);
    expect(db.source_records).toHaveLength(3);                // three distinct references
  });

  it('concurrent entries with the same phone yield one person', async () => {
    const row = { referenceId: 'P1', phone: '+15550100000' };
    await Promise.all([
      ingest(ORG_A, [{ ...row, referenceId: 'P1' }]),
      ingest(ORG_A, [{ ...row, referenceId: 'P2' }]),
    ]);
    expect(db.unified_persons).toHaveLength(1);
  });

  it('concurrent entries across tenants never collide', async () => {
    const rows = [person({ referenceId: 'X-1' })];
    await Promise.all([ingest(ORG_A, rows), ingest(ORG_B, rows)]);
    expect(db.unified_persons).toHaveLength(2);
    expect(db.source_records).toHaveLength(2);
  });
});

describe('LI-4E — 13. validation and failure', () => {
  const bad = async (row: Record<string, unknown>, field: string) => {
    const r = await ingest(ORG_A, [row]);
    expect(r.succeeded).toBe(0);
    expect(r.outcomes[0].rejection).toBe('normalization_failed');
    expect(r.outcomes[0].error).toMatch(new RegExp(field, 'i'));
    // Nothing at all was persisted.
    expect(db.unified_persons).toHaveLength(0);
    expect(db.source_records).toHaveLength(0);
    expect(db.person_duplicate_candidates).toHaveLength(0);
  };

  it('rejects a malformed email', () => bad({ email: 'not-an-email' }, 'email'));
  it('rejects a malformed phone', () => bad({ phone: '12' }, 'phone'));
  it('rejects an entry with no identity at all', () => bad({ firstName: 'Nameless' }, 'email, a phone or a reference'));
  it('rejects an unparseable observedAt', () => bad({ email: 'a@x.test', observedAt: 'yesterday' }, 'timestamp'));
  it('rejects a blank reference id', () => bad({ email: 'a@x.test', referenceId: '   ' }, 'referenceId'));
  it('rejects a bad country code', () => bad({ email: 'a@x.test', countryCode: 'GBR' }, 'country code'));
  it('rejects content-bearing metadata', () => bad({ email: 'a@x.test', metadata: { transcript: 'x' } }, 'metadata'));
  it('rejects credential-bearing metadata', () => bad({ email: 'a@x.test', metadata: { api_key: 'x' } }, 'metadata'));
  it('rejects oversized metadata', () => bad({ email: 'a@x.test', metadata: { note: 'x'.repeat(3000) } }, 'metadata'));
  it('rejects non-object metadata', () => bad({ email: 'a@x.test', metadata: ['a'] }, 'metadata'));

  it('a tenant-less record cannot reach the pipeline at all', () => {
    expect(() => validateManualInput({ organizationId: '', email: 'a@x.test' }))
      .toThrow(ManualInputError);
  });

  it('one invalid entry does not stop the valid ones', async () => {
    const r = await ingest(ORG_A, [
      person({ referenceId: 'OK-1' }),
      { email: 'broken' },
      person({ referenceId: 'OK-2', email: 'other@example.test' }),
    ]);
    expect(r.total).toBe(3);
    expect(r.succeeded).toBe(2);
    expect(r.failed).toBe(1);
    expect(db.unified_persons).toHaveLength(2);
  });

  it('a provenance failure leaves no canonical debris beyond the resolved person', async () => {
    failTable = 'source_records';
    const r = await ingest(ORG_A, [person({ referenceId: 'FAIL-1' })]);
    expect(r.outcomes[0].ok).toBe(false);
    expect(r.outcomes[0].rejection).toBe('provenance_failed');
    expect(db.source_records).toHaveLength(0);
    expect(db.person_duplicate_candidates).toHaveLength(0);
  });

  it('retrying after the fault clears succeeds cleanly', async () => {
    failTable = 'source_records';
    await ingest(ORG_A, [person({ referenceId: 'RETRY-1' })]);
    failTable = null;
    const r = await ingest(ORG_A, [person({ referenceId: 'RETRY-1' })]);
    expect(r.succeeded).toBe(1);
    expect(db.source_records).toHaveLength(1);
    expect(db.unified_persons).toHaveLength(1);
  });
});

describe('LI-4E — 14/15. no network, and security', () => {
  it('the adapter performs no HTTP, fetch, SDK or credential lookup', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../services/leadIngestion/adapters/manualAdapter.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // Actual CALLS and URLs, not bare words: the adapter legitimately mentions
    // 'credential' and 'api_key' in the metadata keys it REFUSES, and a
    // substring match would read that safeguard as a violation.
    for (const pattern of [
      /\bfetch\s*\(/, /\baxios\b/, /https?:\/\//, /XMLHttpRequest/, /safeFetch\s*\(/,
      /process\.env/, /require\s*\(\s*['"](http|https|node-fetch|axios)/,
    ]) {
      expect(code).not.toMatch(pattern);
    }
  });

  it('it imports nothing that can reach a network or a database', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../services/leadIngestion/adapters/manualAdapter.ts'), 'utf8');
    const imports = src.split('\n').filter((l: string) => l.trim().startsWith('import'));
    for (const line of imports) {
      expect(line).not.toMatch(/(writeOwner|supabase|axios|node-fetch|safeFetch|pg)/);
    }
    // node:crypto is the only node builtin, and it hashes — it does no I/O.
    expect(imports.some((l: string) => l.includes("node:crypto"))).toBe(true);
  });

  it('translate is synchronous, so it structurally cannot await I/O', () => {
    const result = manualAdapter.translate({ email: 'a@x.test' }, ORG_A);
    expect(result).not.toBeInstanceOf(Promise);
    expect(result.normalized.organizationId).toBe(ORG_A);
  });

  it('the batch tenant overrides whatever the record claims', () => {
    const result = manualAdapter.translate({ email: 'a@x.test', organizationId: ORG_B }, ORG_A);
    expect(result.normalized.organizationId).toBe(ORG_A);
  });

  it('the raw record is preserved verbatim for provenance', () => {
    const raw = { email: 'a@x.test', operatorNote: 'met at a conference' };
    expect(manualAdapter.translate(raw, ORG_A).raw).toBe(raw);
  });

  it('a deterministic id is a hash, never an email', () => {
    const id = manualExternalId({ organizationId: ORG_A, email: 'a@x.test' });
    expect(id).toMatch(/^manual:[0-9a-f]{32}$/);
    expect(id).not.toContain('@');
  });

  it('the deterministic id is stable and tenant-scoped', () => {
    const a1 = manualExternalId({ organizationId: ORG_A, email: 'a@x.test' });
    const a2 = manualExternalId({ organizationId: ORG_A, email: 'a@x.test' });
    const b = manualExternalId({ organizationId: ORG_B, email: 'a@x.test' });
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
  });
});
