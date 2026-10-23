/**
 * PI — the relationship attribute producer's own decisions.
 *
 * The real-schema suite proves the outcomes: isolation, authority, D-1..D-5,
 * tenant safety. This file covers the choices that live above the database and
 * that a passing outcome would not reveal:
 *
 *   - that the stored source-record identity is SCOPED TO THE RELATIONSHIP,
 *     which is the single detail standing between this producer and
 *     cross-employment supersession;
 *   - that no person attribute bag is ever handed to the record upsert, so the
 *     producer cannot create a person-global employment fact even by accident;
 *   - that the authority scope asked for is 'relationship' and the arbitration
 *     surface is the four employment attributes;
 *   - that an authority read failure aborts BEFORE any canonical write.
 *
 * The database is doubled and every statement recorded, because these are
 * assertions about what was SENT. `upsertSourceRecord`,
 * `reconcileAssertionLiveness` and `decideCanonicalUpdates` are the REAL b1b
 * implementations running against that double — the producer's job is to wire
 * them, so stubbing them would test nothing.
 */

type Row = Record<string, unknown>;

const db = {
  tables: {} as Record<string, Row[]>,
  inserts: [] as Array<{ table: string; payload: Row }>,
  updates: [] as Array<{ table: string; payload: Row; filters: Array<[string, unknown]> }>,
  reads: [] as Array<{ table: string; filters: Array<[string, unknown]> }>,
  /** Scoped to one table: an unscoped failure hits the source record first. */
  insertError: null as { table: string; code?: string; message: string } | null,
  nextId: 1,
};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const st = {
      op: 'select' as 'select' | 'insert' | 'update',
      filters: [] as Array<[string, unknown]>,
      payload: null as Row | null,
      mode: 'many' as 'many' | 'one',
    };
    const rows = (): Row[] => (db.tables[table] ??= []);
    const match = (r: Row) => st.filters.every(([c, v]) => (r[c] ?? null) === v);
    const exec = async () => {
      await Promise.resolve();
      if (st.op === 'insert') {
        db.inserts.push({ table, payload: st.payload as Row });
        if (db.insertError?.table === table) {
          return { data: null, error: db.insertError };
        }
        // Mirror the real column defaults. Without `superseded_at: null` the
        // liveness pass sees `undefined`, treats the row as superseded and
        // REVIVES it — a double that invents a state the database cannot hold.
        const defaults: Row = table === 'source_assertions'
          ? { superseded_at: null, applied_to_canonical_at: null, applied_reason: null }
          : {};
        const created = { id: `${table}-${db.nextId++}`, ...defaults, ...(st.payload as Row) };
        rows().push(created);
        return { data: created, error: null };
      }
      if (st.op === 'update') {
        db.updates.push({ table, payload: st.payload as Row, filters: st.filters });
        for (const r of rows().filter(match)) Object.assign(r, st.payload);
        return { data: null, error: null };
      }
      db.reads.push({ table, filters: st.filters });
      const found = rows().filter(match);
      return st.mode === 'one'
        ? { data: found[0] ?? null, error: null }
        : { data: found, error: null };
    };
    const b: Record<string, unknown> = {
      select: () => b,
      insert: (p: Row) => { st.op = 'insert'; st.payload = p; return b; },
      update: (p: Row) => { st.op = 'update'; st.payload = p; return b; },
      eq: (c: string, v: unknown) => { st.filters.push([c, v]); return b; },
      is: (c: string, v: unknown) => { st.filters.push([c, v]); return b; },
      in: () => b,
      order: () => b,
      limit: () => exec(),
      single: () => { st.mode = 'one'; return exec(); },
      maybeSingle: () => { st.mode = 'one'; return exec(); },
      then: (r: (v: unknown) => unknown, j: (e: unknown) => unknown) => exec().then(r, j),
    };
    return b;
  },
}));

// The authority declaration, controlled per test — including its failure.
const authority = {
  byAttribute: {} as Record<string, readonly string[]>,
  scopesAsked: [] as Array<{ org: string; scope: string }>,
  failWith: null as string | null,
};
jest.mock('../../services/prospectIdentity/attributeAuthorityStore', () => ({
  AUTHORITY_ENTITY_TYPES: ['person', 'account', 'relationship'],
  isAuthorityEntityType: (v: unknown) =>
    typeof v === 'string' && ['person', 'account', 'relationship'].includes(v),
  loadAuthorityDeclarations: async (org: string, scope: string) => {
    authority.scopesAsked.push({ org, scope });
    if (authority.failWith) throw new Error(authority.failWith);
    return Object.entries(authority.byAttribute).map(([attribute, providers]) => ({
      organizationId: org, entityType: scope, attribute, providers,
      declaredByUserId: null, updatedAt: null,
    }));
  },
}));

jest.mock('../../services/logger', () => ({
  logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
}));

import {
  assertRelationshipAttribute, isRelationshipAttribute,
  RELATIONSHIP_ATTRIBUTE_PRODUCER_VERSION, type RelationshipAssertionResult,
} from '../../services/prospectIdentity/relationshipAttributeIngestion';

const ORG_A = '00000000-0000-4000-8000-00000000000a';
const REL_A = 'rel-aaaa';
const REL_B = 'rel-bbbb';
const PERSON = 'person-1';
const ACTOR = 'user-actor';
const NOW = '2026-07-01T00:00:00.000Z';

const seedRelationship = (id: string, over: Row = {}) => {
  (db.tables['person_account_relationships'] ??= []).push({
    id, organization_id: ORG_A, person_id: PERSON, account_id: 'account-1',
    ended_at: null, job_title: null, department: null, seniority: null, buying_role: null,
    attributes_source: null, attributes_updated_at: null, ...over,
  });
};

const call = (over: Record<string, unknown> = {}) => assertRelationshipAttribute({
  organizationId: ORG_A, relationshipId: REL_A, attribute: 'job_title',
  value: 'VP Sales', provider: 'apollo', sourceRecordKey: 'apollo:batch-1',
  observedAt: '2026-01-01T00:00:00.000Z', ...over,
} as never, NOW);
// Narrows to the success branch for tests that inspect its fields; a refusal
// fails the test loudly with its reason instead of reading undefined fields.
type OkResult = Extract<RelationshipAssertionResult, { ok: true }>;
const callOk = async (over: Record<string, unknown> = {}): Promise<OkResult> => {
  const res = await call(over);
  if (res.ok === false) throw new Error(`expected ok, got refusal: ${res.reason}`);
  return res as OkResult;
};

beforeEach(() => {
  db.tables = {}; db.inserts = []; db.updates = []; db.reads = [];
  db.insertError = null; db.nextId = 1;
  authority.byAttribute = {}; authority.scopesAsked = []; authority.failWith = null;
});

// ═══════════════════════════════════════════════════════════════════════════
describe('the attribute surface is exactly the four employment attributes', () => {
  it('accepts those four and nothing else', () => {
    for (const a of ['job_title', 'department', 'seniority', 'buying_role']) {
      expect(isRelationshipAttribute(a)).toBe(true);
    }
    // authority and influence stay PERSON-scoped; the rest are not in scope.
    for (const a of ['authority', 'influence', 'full_name', 'industry', 'tenure', '', null]) {
      expect(isRelationshipAttribute(a)).toBe(false);
    }
    expect(RELATIONSHIP_ATTRIBUTE_PRODUCER_VERSION).toMatch(/^pi-rel-attr\./);
  });
});

describe('input guards — refused before any write', () => {
  it('refuses a missing tenant, relationship, source key, provider or attribute', async () => {
    seedRelationship(REL_A);
    expect(await call({ organizationId: '  ' })).toEqual({ ok: false, reason: 'tenant_required' });
    expect(await call({ relationshipId: '' })).toEqual({ ok: false, reason: 'relationship_required' });
    expect(await call({ sourceRecordKey: '' })).toEqual({ ok: false, reason: 'source_key_required' });
    expect(await call({ provider: '   ' })).toEqual({ ok: false, reason: 'provider_required' });
    expect(await call({ attribute: 'authority' })).toEqual({ ok: false, reason: 'invalid_attribute' });
    expect(db.inserts).toEqual([]);
  });

  it('refuses a blank value, and an out-of-vocabulary seniority or buying_role', async () => {
    seedRelationship(REL_A);
    expect(await call({ value: '   ' })).toEqual({ ok: false, reason: 'invalid_value' });
    expect(await call({ value: null })).toEqual({ ok: false, reason: 'invalid_value' });
    expect(await call({ attribute: 'seniority', value: 'Grand Poobah' }))
      .toEqual({ ok: false, reason: 'invalid_value' });
    expect(await call({ attribute: 'buying_role', value: 'wizard' }))
      .toEqual({ ok: false, reason: 'invalid_value' });
    expect(db.inserts).toEqual([]);
  });

  it('normalises a vocabulary value rather than demanding the exact casing', async () => {
    seedRelationship(REL_A);
    const res = await call({ attribute: 'seniority', value: '  VP  ' });
    expect(res.ok).toBe(true);
    const assertion = db.inserts.find((i) => i.table === 'source_assertions');
    expect(assertion?.payload.normalized_value).toBe('vp');
    expect(assertion?.payload.raw_value).toBe('  VP  ');
  });

  it('mirrors the origin/actor coherence constraint as a legible refusal', async () => {
    seedRelationship(REL_A);
    expect(await call({ origin: 'human', assertedByUserId: null }))
      .toEqual({ ok: false, reason: 'actor_required' });
    expect(await call({ origin: 'provider', assertedByUserId: ACTOR }))
      .toEqual({ ok: false, reason: 'actor_forbidden' });
    expect(db.inserts).toEqual([]);
  });

  it('refuses an unknown relationship, which is also how cross-tenant is refused', async () => {
    // No relationship seeded: the tenant-filtered read finds nothing.
    expect(await call()).toEqual({ ok: false, reason: 'relationship_not_found' });
    expect(db.inserts).toEqual([]);
    // The read WAS tenant-filtered — that is what makes this a tenant check.
    const read = db.reads.find((r) => r.table === 'person_account_relationships');
    expect(read?.filters).toEqual([['id', REL_A], ['organization_id', ORG_A]]);
  });
});

describe('the source record is scoped to the relationship', () => {
  it('stores a record id containing the relationship, not just the caller key', async () => {
    seedRelationship(REL_A);
    await call({ sourceRecordKey: 'apollo:batch-1' });
    const record = db.inserts.find((i) => i.table === 'source_records');
    expect(record?.payload.source_record_id).toBe(`apollo:batch-1#rel:${REL_A}`);
  });

  it('the SAME caller key yields DIFFERENT records for different employments', async () => {
    seedRelationship(REL_A);
    seedRelationship(REL_B);
    await call({ relationshipId: REL_A, sourceRecordKey: 'apollo:batch-1' });
    await call({ relationshipId: REL_B, sourceRecordKey: 'apollo:batch-1' });
    const ids = db.inserts.filter((i) => i.table === 'source_records')
      .map((i) => i.payload.source_record_id);
    expect(new Set(ids).size).toBe(2);
    // This is what stops `reconcileAssertionLiveness`, which keys on
    // (organization_id, source_record_id, attribute) and knows nothing about
    // relationships, from retiring one employment's claim when the other is
    // asserted.
  });

  it('the record is person-shaped and carries the relationship person', async () => {
    seedRelationship(REL_A);
    await call();
    const record = db.inserts.find((i) => i.table === 'source_records');
    expect(record?.payload.source_entity_type).toBe('person');
    expect(record?.payload.person_id).toBe(PERSON);
  });

  it('hands NO attribute bag to the record upsert, so no person assertion can be created', async () => {
    seedRelationship(REL_A);
    await call();
    // Every assertion written names the relationship and neither subject column.
    const assertions = db.inserts.filter((i) => i.table === 'source_assertions');
    expect(assertions).toHaveLength(1);
    expect(assertions[0].payload).toMatchObject({
      entity_type: 'relationship', relationship_id: REL_A, person_id: null, account_id: null,
    });
    // And nothing was written to the person spine at all.
    expect(db.updates.map((u) => u.table)).not.toContain('unified_persons');
    expect(db.inserts.map((i) => i.table)).not.toContain('unified_persons');
  });
});

describe('provenance on the assertion', () => {
  it('records provider identity for a provider claim', async () => {
    seedRelationship(REL_A);
    await call({ provider: 'apollo', confidence: 0.8 });
    const a = db.inserts.find((i) => i.table === 'source_assertions')!.payload;
    expect(a).toMatchObject({
      provider: 'apollo', origin: 'provider', asserted_by_user_id: null,
      confidence: 0.8, observed_at: '2026-01-01T00:00:00.000Z', recorded_at: NOW,
    });
  });

  it('records actor identity for a human claim', async () => {
    seedRelationship(REL_A);
    await call({ provider: 'human', origin: 'human', assertedByUserId: ACTOR });
    const a = db.inserts.find((i) => i.table === 'source_assertions')!.payload;
    expect(a).toMatchObject({ origin: 'human', asserted_by_user_id: ACTOR, provider: 'human' });
  });

  it('stamps the winning assertion, and only when unstamped', async () => {
    seedRelationship(REL_A);
    await call();
    const stamp = db.updates.find((u) => u.table === 'source_assertions');
    expect(stamp?.payload).toMatchObject({ applied_to_canonical_at: NOW });
    expect(stamp?.payload.applied_reason).toBe('single_uncontested_assertion');
    // `is(applied_to_canonical_at, null)` keeps a later re-win from overwriting
    // the first stamp.
    expect(stamp?.filters).toContainEqual(['applied_to_canonical_at', null]);
    expect(stamp?.filters).toContainEqual(['organization_id', ORG_A]);
  });
});

describe('authority integration', () => {
  it('asks for the RELATIONSHIP scope, with the tenant it was given', async () => {
    seedRelationship(REL_A);
    await call();
    expect(authority.scopesAsked).toEqual([{ org: ORG_A, scope: 'relationship' }]);
  });

  it('fails CLOSED: an authority read failure writes no canonical value', async () => {
    seedRelationship(REL_A);
    authority.failWith = 'authority declaration read failed: connection reset';
    await expect(call()).rejects.toThrow(/authority declaration read failed/);
    // The evidence it had already recorded stays recorded...
    expect(db.inserts.some((i) => i.table === 'source_assertions')).toBe(true);
    // ...but the relationship was never updated.
    expect(db.updates.map((u) => u.table)).not.toContain('person_account_relationships');
  });

  it('a declaration restricts the eligible sources', async () => {
    seedRelationship(REL_A);
    authority.byAttribute = { job_title: ['human'] };
    // An apollo claim alone, with human declared: apollo is not eligible, and a
    // sole candidate collapses by value before authority is consulted, so the
    // single uncontested claim still applies. The restriction is proven in the
    // real-schema suite where a human claim competes.
    const res = await call();
    expect(res.ok).toBe(true);
  });
});

describe('arbitration integration', () => {
  it('arbitrates only over the four employment attributes', async () => {
    seedRelationship(REL_A);
    // Evidence for a PERSON-scoped attribute sitting on this relationship must
    // be ignored: it is outside the relationship surface.
    (db.tables['source_assertions'] ??= []).push({
      id: 'stray', organization_id: ORG_A, entity_type: 'relationship', relationship_id: REL_A,
      attribute: 'authority', normalized_value: 'high', provider: 'apollo',
      confidence: null, observed_at: '2030-01-01T00:00:00.000Z',
      recorded_at: '2030-01-01T00:00:00.000Z', superseded_at: null,
    });
    await call();
    const patch = db.updates.find((u) => u.table === 'person_account_relationships')?.payload;
    expect(patch).toBeTruthy();
    expect(Object.keys(patch!)).not.toContain('authority');
    expect(patch).toMatchObject({ job_title: 'VP Sales' });
  });

  it('updates the canonical row under both id AND tenant', async () => {
    seedRelationship(REL_A);
    await call();
    const upd = db.updates.find((u) => u.table === 'person_account_relationships');
    expect(upd?.filters).toEqual([['id', REL_A], ['organization_id', ORG_A]]);
  });

  it('stamps attributes_source with the WINNING provider, not the calling one', async () => {
    seedRelationship(REL_A, { job_title: 'VP Sales' });
    // An attested incumbent asserted by human earlier...
    (db.tables['source_assertions'] ??= []).push({
      id: 'human-1', organization_id: ORG_A, entity_type: 'relationship', relationship_id: REL_A,
      attribute: 'job_title', normalized_value: 'Chief Revenue Officer', provider: 'human',
      confidence: null, observed_at: '2026-02-01T00:00:00.000Z',
      recorded_at: '2026-02-01T00:00:00.000Z', superseded_at: null,
    }, {
      id: 'human-0', organization_id: ORG_A, entity_type: 'relationship', relationship_id: REL_A,
      attribute: 'job_title', normalized_value: 'VP Sales', provider: 'human',
      confidence: null, observed_at: '2026-01-15T00:00:00.000Z',
      recorded_at: '2026-01-15T00:00:00.000Z', superseded_at: null,
    });
    authority.byAttribute = { job_title: ['human'] };

    // ...and now apollo asserts something else. Human is authoritative, so the
    // canonical value comes from human and the stamp must say so.
    const res = await call({ provider: 'apollo', value: 'CTO' });
    expect(res.ok).toBe(true);
    const patch = db.updates.find((u) => u.table === 'person_account_relationships')?.payload;
    expect(patch).toMatchObject({ job_title: 'Chief Revenue Officer', attributes_source: 'human' });
    expect(patch?.attributes_updated_at).toBe(NOW);
  });

  it('writes nothing when arbitration applies nothing', async () => {
    // An unattested incumbent: D-4 protects it, so there is no canonical write.
    seedRelationship(REL_A, { job_title: 'Operator Typed This' });
    const res = await callOk();
    expect(res.ok).toBe(true);
    expect(res.canonicalApplied).toEqual([]);
    expect(res.canonicalWithheld).toEqual([{ attribute: 'job_title', reason: 'unattested_incumbent' }]);
    expect(db.updates.map((u) => u.table)).not.toContain('person_account_relationships');
  });
});

describe('the canonical decision log', () => {
  it('appends ONE relationship decision per applied attribute, with full content', async () => {
    seedRelationship(REL_A);
    const res = await callOk();
    expect(res.ok).toBe(true);

    const logged = db.inserts.filter((i) => i.table === 'canonical_attribute_decisions');
    expect(logged).toHaveLength(1);
    expect(logged[0].payload).toMatchObject({
      organization_id: ORG_A,
      entity_type: 'relationship',
      relationship_id: REL_A,
      // A relationship decision describes an employment, so it names neither.
      person_id: null,
      account_id: null,
      attribute: 'job_title',
      value: 'VP Sales',
      reason: 'single_uncontested_assertion',
      decided_at: NOW,
    });
    // The logged assertion is the one arbitration actually chose.
    expect(logged[0].payload.assertion_id).toBe(res.canonicalApplied[0].assertionId);
  });

  it('logs the decision BEFORE stamping the assertion', async () => {
    seedRelationship(REL_A);
    await call();
    // The same order as the person/account boundary: append the decision, then
    // stamp. A stamp without a logged decision would be a canonical write with
    // no audit row.
    const order: string[] = [];
    for (const i of db.inserts) if (i.table === 'canonical_attribute_decisions') order.push('log');
    for (const u of db.updates) if (u.table === 'source_assertions') order.push('stamp');
    expect(order).toEqual(['log', 'stamp']);
  });

  it('logs NOTHING when arbitration applies nothing', async () => {
    // An unattested incumbent: evidence is recorded, no canonical decision is
    // made, so there is no decision to log. This is also what makes a replay
    // idempotent.
    seedRelationship(REL_A, { job_title: 'Operator Typed This' });
    const res = await callOk();
    expect(res.canonicalApplied).toEqual([]);
    expect(db.inserts.filter((i) => i.table === 'canonical_attribute_decisions')).toEqual([]);
  });

  it('a replay that changes nothing logs no second decision', async () => {
    seedRelationship(REL_A);
    await call();
    const after = db.inserts.filter((i) => i.table === 'canonical_attribute_decisions').length;
    // The value is now in force, so arbitration applies nothing the second time.
    await call();
    expect(db.inserts.filter((i) => i.table === 'canonical_attribute_decisions').length).toBe(after);
  });

  it('a decision-log failure aborts rather than leaving an unaudited canonical value', async () => {
    seedRelationship(REL_A);
    db.insertError = {
      table: 'canonical_attribute_decisions',
      code: '23503', message: 'violates canonical_decisions_relationship_tenant_fk',
    };
    await expect(call()).rejects.toThrow(/canonical decision log failed/);
    // The assertion was never stamped, so nothing claims to have been applied.
    expect(db.updates.filter((u) => u.table === 'source_assertions')).toEqual([]);
  });

  it('logs one decision per attribute when several apply at once', async () => {
    seedRelationship(REL_A);
    // Evidence for a second attribute that has been waiting to apply.
    (db.tables['source_assertions'] ??= []).push({
      id: 'dept-1', organization_id: ORG_A, entity_type: 'relationship', relationship_id: REL_A,
      attribute: 'department', normalized_value: 'Sales', provider: 'apollo',
      confidence: null, observed_at: '2026-02-01T00:00:00.000Z',
      recorded_at: '2026-02-01T00:00:00.000Z', superseded_at: null,
      applied_to_canonical_at: null, applied_reason: null,
    });
    const res = await callOk();
    expect(res.canonicalApplied.map((a: any) => a.attribute).sort()).toEqual(['department', 'job_title']);
    const logged = db.inserts.filter((i) => i.table === 'canonical_attribute_decisions');
    expect(logged.map((l) => l.payload.attribute).sort()).toEqual(['department', 'job_title']);
    for (const l of logged) expect(l.payload.relationship_id).toBe(REL_A);
  });
});

describe('idempotency', () => {
  it('a duplicate claim is reported as already present, not as an error', async () => {
    seedRelationship(REL_A);
    db.insertError = { table: 'source_assertions', code: '23505', message: 'duplicate key value violates uq_source_assertions_dedupe' };
    const res = await callOk();
    expect(res.ok).toBe(true);
    expect(res.assertionRecorded).toBe(false);
    expect(res.assertionAlreadyPresent).toBe(true);
  });

  it('any OTHER insert failure throws rather than claiming success', async () => {
    seedRelationship(REL_A);
    db.insertError = { table: 'source_assertions', code: '23514', message: 'violates check constraint' };
    await expect(call()).rejects.toThrow(/assertion insert failed \(23514\)/);
  });
});

describe('C-1 — the assertion read is SUBJECT-SCOPED', () => {
  /**
   * The ARBITRATION read — NOT D2's liveness read. Both select from
   * `source_assertions`, the liveness pass runs first (via
   * `reconcileAssertionLiveness`) and already carried `entity_type` before this
   * change, so a positional `[0]` asserts against the wrong statement and
   * passes even without the predicate under test. The arbitration read is the
   * one that does NOT filter `source_record_id`.
   */
  const arbitrationRead = () => db.reads.filter((r) => r.table === 'source_assertions'
    && r.filters.every(([c]) => c !== 'source_record_id'))[0];

  it('sends entity_type = relationship alongside the tenant and relationship predicates', async () => {
    seedRelationship(REL_A);
    await call();

    expect(arbitrationRead().filters).toEqual(expect.arrayContaining([
      ['organization_id', ORG_A],
      ['entity_type', 'relationship'],
      ['relationship_id', REL_A],
    ]));
  });

  it('a PERSON-scoped row carrying this relationship_id is not relationship evidence', async () => {
    // Schema-legal and unreachable by any current writer — this module is the
    // only one that sets `relationship_id` — but no CHECK forbids it and the
    // detachment trigger guards UPDATE only, so an INSERT of this shape would
    // be accepted. Before C-1 it would have won arbitration on recency.
    seedRelationship(REL_A, { job_title: 'VP Sales' });
    (db.tables['source_assertions'] ??= []).push({
      id: 'person-leg', organization_id: ORG_A, entity_type: 'person',
      person_id: PERSON, relationship_id: REL_A,
      attribute: 'job_title', normalized_value: 'Impostor Title', provider: 'apollo',
      confidence: null, observed_at: '2099-01-01T00:00:00.000Z',
      recorded_at: '2099-01-01T00:00:00.000Z', superseded_at: null,
      applied_to_canonical_at: null, applied_reason: null,
    });

    await call();

    const patch = db.updates.find((u) => u.table === 'person_account_relationships')?.payload;
    expect(patch?.job_title).not.toBe('Impostor Title');
    // ...and it was never stamped as the winning assertion.
    const stamps = db.updates.filter((u) => u.table === 'source_assertions');
    for (const s of stamps) expect(s.filters).not.toEqual(expect.arrayContaining([['id', 'person-leg']]));
  });

  it('an ACCOUNT-scoped row carrying this relationship_id is not relationship evidence', async () => {
    seedRelationship(REL_A, { job_title: 'VP Sales' });
    (db.tables['source_assertions'] ??= []).push({
      id: 'account-leg', organization_id: ORG_A, entity_type: 'account',
      account_id: 'account-1', relationship_id: REL_A,
      attribute: 'job_title', normalized_value: 'Account Title', provider: 'apollo',
      confidence: null, observed_at: '2099-01-01T00:00:00.000Z',
      recorded_at: '2099-01-01T00:00:00.000Z', superseded_at: null,
      applied_to_canonical_at: null, applied_reason: null,
    });

    await call();

    const patch = db.updates.find((u) => u.table === 'person_account_relationships')?.payload;
    expect(patch?.job_title).not.toBe('Account Title');
  });

  it('relationship-scoped evidence still arbitrates — the predicate did not over-filter', async () => {
    seedRelationship(REL_A, { job_title: null });
    (db.tables['source_assertions'] ??= []).push({
      id: 'rel-live', organization_id: ORG_A, entity_type: 'relationship',
      person_id: null, account_id: null, relationship_id: REL_A,
      attribute: 'department', normalized_value: 'Sales', provider: 'apollo',
      confidence: null, observed_at: '2026-02-01T00:00:00.000Z',
      recorded_at: '2026-02-01T00:00:00.000Z', superseded_at: null,
      applied_to_canonical_at: null, applied_reason: null,
    });

    const res = await callOk();

    expect(res.canonicalApplied.map((a: any) => a.attribute).sort()).toEqual(['department', 'job_title']);
  });

  it('another tenant\'s relationship evidence is still excluded', async () => {
    seedRelationship(REL_A, { job_title: 'VP Sales' });
    (db.tables['source_assertions'] ??= []).push({
      id: 'other-tenant', organization_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      entity_type: 'relationship', person_id: null, account_id: null, relationship_id: REL_A,
      attribute: 'job_title', normalized_value: 'Other Tenant Title', provider: 'apollo',
      confidence: null, observed_at: '2099-01-01T00:00:00.000Z',
      recorded_at: '2099-01-01T00:00:00.000Z', superseded_at: null,
      applied_to_canonical_at: null, applied_reason: null,
    });

    await call();

    const patch = db.updates.find((u) => u.table === 'person_account_relationships')?.payload;
    expect(patch?.job_title).not.toBe('Other Tenant Title');
  });

  it('another relationship\'s evidence is still excluded', async () => {
    seedRelationship(REL_A, { job_title: 'VP Sales' });
    (db.tables['source_assertions'] ??= []).push({
      id: 'other-rel', organization_id: ORG_A, entity_type: 'relationship',
      person_id: null, account_id: null, relationship_id: REL_B,
      attribute: 'job_title', normalized_value: 'Other Relationship Title', provider: 'apollo',
      confidence: null, observed_at: '2099-01-01T00:00:00.000Z',
      recorded_at: '2099-01-01T00:00:00.000Z', superseded_at: null,
      applied_to_canonical_at: null, applied_reason: null,
    });

    await call();

    const patch = db.updates.find((u) => u.table === 'person_account_relationships')?.payload;
    expect(patch?.job_title).not.toBe('Other Relationship Title');
  });
});
