/**
 * Change 1a (E-1) — arbitration is SUBJECT-CORRECT.
 *
 * The assertion writer sets `account_id` unconditionally, so a person-scoped row
 * carries an account leg as well as its person leg. The arbitration read keyed
 * only on `(organization_id, account_id)`, with no `entity_type`, so an
 * employee's own `city`, `region` and `country_code` — the three attributes
 * where the person and account surfaces overlap — were read as COMPANY evidence.
 * They could decide an account attribute and, because candidacy and attestation
 * are built from the same array, they could also ATTEST an account incumbent and
 * authorise its overwrite.
 *
 * E-1, as approved: person-scoped evidence must neither determine nor attest an
 * account canonical attribute. Person-derived account attestation is NOT
 * preserved for historical compatibility.
 *
 * These tests drive the REAL `ingestSourceRecord` against a doubled database and
 * assert BOTH the canonical outcome AND the predicates that were sent, because
 * the change lives in a query rather than in `decideCanonicalUpdates`. A test
 * that called the pure function with a hand-built array could not detect it.
 *
 * Several cases fail against the old behaviour and pass with the predicate:
 * 1, 2, 3, 4, 6 and 13. Cases 5, 7-12 are regression guards.
 */

type Row = Record<string, unknown>;

const db = {
  tables: {} as Record<string, Row[]>,
  reads: [] as Array<{ table: string; eq: Array<[string, unknown]>; in: Array<[string, unknown[]]> }>,
  inserts: [] as Array<{ table: string; payload: Row }>,
  updates: [] as Array<{ table: string; payload: Row; eq: Array<[string, unknown]>; in: Array<[string, unknown[]]> }>,
  nextId: 1,
};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const st = {
      op: 'select' as 'select' | 'insert' | 'update',
      eq: [] as Array<[string, unknown]>,
      ins: [] as Array<[string, unknown[]]>,
      payload: null as Row | null,
      mode: 'many' as 'many' | 'one',
    };
    const rows = (): Row[] => (db.tables[table] = db.tables[table] || []);
    const match = (r: Row) => st.eq.every(([c, v]) => (r[c] === undefined ? null : r[c]) === v)
      && st.ins.every(([c, vs]) => vs.indexOf(r[c]) !== -1);
    const exec = async () => {
      await Promise.resolve();
      if (st.op === 'insert') {
        db.inserts.push({ table, payload: st.payload as Row });
        // Mirror the real column defaults. Without `superseded_at: null` the
        // liveness pass reads `undefined`, treats the row as withdrawn and
        // revives it — a double inventing a state the database cannot hold.
        const defaults: Row = table === 'source_assertions'
          ? { superseded_at: null, applied_to_canonical_at: null, applied_reason: null }
          : {};
        const created = { id: `${table}-${db.nextId++}`, ...defaults, ...(st.payload as Row) };
        rows().push(created);
        return { data: created, error: null };
      }
      if (st.op === 'update') {
        db.updates.push({ table, payload: st.payload as Row, eq: st.eq, in: st.ins });
        rows().filter(match).forEach((r) => Object.assign(r, st.payload));
        return { data: null, error: null };
      }
      db.reads.push({ table, eq: st.eq, in: st.ins });
      const found = rows().filter(match);
      return st.mode === 'one' ? { data: found[0] || null, error: null } : { data: found, error: null };
    };
    const b: Record<string, unknown> = {
      select: () => b,
      insert: (p: Row) => { st.op = 'insert'; st.payload = p; return b; },
      update: (p: Row) => { st.op = 'update'; st.payload = p; return b; },
      eq: (c: string, v: unknown) => { st.eq.push([c, v]); return b; },
      is: (c: string, v: unknown) => { st.eq.push([c, v]); return b; },
      in: (c: string, vs: unknown[]) => { st.ins.push([c, vs]); return b; },
      order: () => b,
      limit: () => exec(),
      single: () => { st.mode = 'one'; return exec(); },
      maybeSingle: () => { st.mode = 'one'; return exec(); },
      then: (r: (v: unknown) => unknown, j: (e: unknown) => unknown) => exec().then(r, j),
    };
    return b;
  },
  /**
   * `pi_apply_canonical_decisions`, emulated against the same fake store.
   *
   * The canonical update, the decision log and the provenance stamp moved into
   * one database function so they share a transaction. A fake store has no
   * transaction, so this double cannot prove atomicity and does not pretend to
   * — that property is proven against real PostgreSQL in
   * `backend/tests/realschema/ca_canonical_write_atomicity.test.ts`.
   *
   * What it DOES preserve is the observable write shape, so the arbitration
   * assertions in this file keep testing arbitration: the same canonical patch,
   * one decision row per applied attribute, and a stamp that touches only the
   * winning assertion and only when it is not already stamped.
   */
  ownedDbRpc: async (fn: string, args: Record<string, unknown>) => {
    await Promise.resolve();
    if (fn !== 'pi_apply_canonical_decisions') {
      return { data: null, error: new Error(`unexpected rpc ${fn}`) };
    }
    const org = args.p_organization_id as string;
    const entityType = args.p_entity_type as string;
    const target = args.p_target_id as string;
    const now = args.p_now as string;
    const decisions = (args.p_decisions ?? []) as Array<Record<string, string>>;
    if (decisions.length === 0) return { data: 0, error: null };

    const table = entityType === 'person' ? 'unified_persons' : 'prospect_accounts';
    const tenantCol = entityType === 'person' ? 'company_id' : 'organization_id';
    const rows = (t: string): Row[] => (db.tables[t] = db.tables[t] || []);

    // Fails closed on a missing or wrongly-tenanted subject, as the real
    // function does with RAISE EXCEPTION.
    const canonical = rows(table).filter((r) => r.id === target && r[tenantCol] === org)[0];
    if (!canonical) {
      return { data: null, error: new Error(`no ${table} row ${target} in tenant ${org}`) };
    }

    const patch: Row = { attributes_source: args.p_provider, attributes_updated_at: now };
    for (const d of decisions) patch[d.attribute] = d.value;
    db.updates.push({ table, payload: patch, eq: [['id', target], [tenantCol, org]], in: [] });
    Object.assign(canonical, patch);

    for (const d of decisions) {
      const logged: Row = {
        organization_id: org,
        entity_type: entityType,
        person_id: entityType === 'person' ? target : null,
        account_id: entityType === 'account' ? target : null,
        attribute: d.attribute,
        assertion_id: d.assertion_id,
        value: d.value,
        reason: d.reason,
        decided_at: now,
      };
      db.inserts.push({ table: 'canonical_attribute_decisions', payload: logged });
      rows('canonical_attribute_decisions').push({
        id: `canonical_attribute_decisions-${db.nextId++}`, ...logged,
      });

      const stamp: Row = { applied_to_canonical_at: now, applied_reason: d.reason };
      db.updates.push({
        table: 'source_assertions',
        payload: stamp,
        eq: [['id', d.assertion_id], ['organization_id', org], ['applied_to_canonical_at', null]],
        in: [],
      });
      rows('source_assertions')
        .filter((r) => r.id === d.assertion_id && r.organization_id === org
          && (r.applied_to_canonical_at ?? null) === null)
        .forEach((r) => Object.assign(r, stamp));
    }
    return { data: decisions.length, error: null };
  },
}));

/** The authority declaration, controlled per test — D-3 is DATA, not code. */
const authority = { byAttribute: {} as Record<string, readonly string[]> };
jest.mock('../../services/prospectIdentity/attributeAuthorityStore', () => ({
  AUTHORITY_ENTITY_TYPES: ['person', 'account', 'relationship'],
  isAuthorityEntityType: (v: unknown) => typeof v === 'string'
    && ['person', 'account', 'relationship'].indexOf(v) !== -1,
  loadAuthorityDeclarations: async (org: string, scope: string) => Object.keys(authority.byAttribute)
    .map((attribute) => ({
      organizationId: org,
      entityType: scope,
      attribute,
      providers: authority.byAttribute[attribute],
      declaredByUserId: null,
      updatedAt: null,
    })),
}));

jest.mock('../../services/logger', () => ({
  logger: {
    warn: () => {}, info: () => {}, error: () => {}, debug: () => {},
  },
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const { ingestSourceRecord, computeValueHash } = require('../../services/prospectIdentity/ingestionBoundary');
/* eslint-enable @typescript-eslint/no-var-requires */

const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000bb';
const ACC = 'account-1';
const P1 = 'person-1';
const P2 = 'person-2';
const T1 = '2026-01-01T00:00:00.000Z';
const T2 = '2026-06-01T00:00:00.000Z';
const T3 = '2026-09-01T00:00:00.000Z';

const H = (v: string): string => computeValueHash(v, null);

const seedTable = (table: string, row: Row): Row => {
  db.tables[table] = db.tables[table] || [];
  db.tables[table].push(row);
  return row;
};

/** The company spine row account arbitration reads and writes. */
const seedAccount = (over: Row = {}): Row => seedTable('prospect_accounts', {
  id: ACC, organization_id: ORG_A, industry: null, city: null, region: null, country_code: null, ...over,
});

/** The person spine row person arbitration reads and writes. */
const seedPerson = (over: Row = {}): Row => seedTable('unified_persons', {
  id: P1, company_id: ORG_A, job_title: null, city: null, ...over,
});

/**
 * An existing assertion. `source_record_id` is deliberately NOT the record the
 * ingestion under test creates, so D2's liveness pass (which keys on the source
 * record) leaves these rows alone and only arbitration reads them.
 */
const seedAssertion = (id: string, over: Row = {}): Row => {
  const value = (over.normalized_value as string) ?? 'Leeds';
  return seedTable('source_assertions', {
    id,
    organization_id: ORG_A,
    source_record_id: 'sr-seed',
    entity_type: 'person',
    person_id: null,
    account_id: null,
    relationship_id: null,
    attribute: 'city',
    raw_value: null,
    normalized_value: value,
    value_hash: H(value),
    provider: 'alpha',
    confidence: null,
    observed_at: T1,
    recorded_at: T1,
    superseded_at: null,
    applied_to_canonical_at: null,
    applied_reason: null,
    ...over,
  });
};

/** A person-scoped assertion that ALSO carries the account leg — the defect shape. */
const personAssertion = (id: string, over: Row = {}): Row => seedAssertion(id, {
  entity_type: 'person', person_id: P1, account_id: ACC, ...over,
});

/** An account-scoped assertion. `person_id` is NULL by `entity_coherent`. */
const accountAssertion = (id: string, over: Row = {}): Row => seedAssertion(id, {
  entity_type: 'account', person_id: null, account_id: ACC, ...over,
});

const ingestAccount = (accountAttributes: Row = {}, over: Row = {}) => ingestSourceRecord({
  organizationId: ORG_A,
  provider: 'alpha',
  entityType: 'account',
  sourceRecordId: 'REC-ACCOUNT',
  rawPayload: { seq: 1 },
  accountId: ACC,
  observedAt: T3,
  accountAttributes,
  ...over,
});

const ingestPerson = (personAttributes: Row = {}, over: Row = {}) => ingestSourceRecord({
  organizationId: ORG_A,
  provider: 'alpha',
  entityType: 'person',
  sourceRecordId: 'REC-PERSON',
  rawPayload: { seq: 1 },
  personId: P1,
  observedAt: T3,
  personAttributes,
  ...over,
});

/** The arbitration read: the only `source_assertions` select with no `source_record_id`. */
const arbitrationRead = () => db.reads.filter((r) => r.table === 'source_assertions'
  && r.eq.every(([c]) => c !== 'source_record_id'))[0];

const canonicalPatch = (table: string): Row => {
  const u = db.updates.filter((x) => x.table === table);
  return (u.length === 0 ? {} : u[u.length - 1].payload);
};

const decisionFor = (attribute: string): Row | undefined => db.inserts
  .filter((i) => i.table === 'canonical_attribute_decisions' && i.payload.attribute === attribute)
  .map((i) => i.payload)[0];

beforeEach(() => {
  db.tables = {};
  db.reads = [];
  db.inserts = [];
  db.updates = [];
  db.nextId = 1;
  authority.byAttribute = {};
});

describe('Change 1a — person evidence never decides or attests an account attribute', () => {
  it('1. a person row carrying an account leg cannot populate a null account attribute', async () => {
    seedAccount({ city: null, industry: null });
    personAssertion('a-person-city', { attribute: 'city', normalized_value: 'Leeds', observed_at: T1 });

    const res = await ingestAccount({ industry: 'Software' });

    expect(res.canonicalApplied).toContain('industry');
    expect(res.canonicalApplied).not.toContain('city');
    expect(canonicalPatch('prospect_accounts')).not.toHaveProperty('city');

    // The predicate that makes it so, as SENT.
    expect(arbitrationRead().eq).toEqual(expect.arrayContaining([
      ['organization_id', ORG_A], ['entity_type', 'account'], ['account_id', ACC],
    ]));
  });

  it('2. two employees with different cities cannot set the employer location', async () => {
    seedAccount({ city: null, industry: null });
    personAssertion('a-p1-city', { attribute: 'city', normalized_value: 'Leeds', observed_at: T1 });
    personAssertion('a-p2-city', {
      attribute: 'city', normalized_value: 'York', observed_at: T2, person_id: P2,
    });

    const res = await ingestAccount({ industry: 'Software' });

    expect(res.canonicalApplied).toEqual(['industry']);
    expect(res.canonicalContested).not.toContain('city');
    expect(canonicalPatch('prospect_accounts')).not.toHaveProperty('city');
  });

  it('3. a person row cannot attest an account incumbent and authorise its overwrite', async () => {
    // 'London' is canonical. Only the PERSON row carries 'London'; the account's
    // own evidence says 'Manchester'. Before Change 1a the person row attested
    // the incumbent, which made it re-arbitratable and overwrote it.
    seedAccount({ city: 'London', industry: null });
    personAssertion('a-person-london', { attribute: 'city', normalized_value: 'London', observed_at: T1 });
    accountAssertion('a-acct-manchester', { attribute: 'city', normalized_value: 'Manchester', observed_at: T2 });

    const res = await ingestAccount({ industry: 'Software' });

    expect(res.canonicalApplied).not.toContain('city');
    expect(res.canonicalWithheld).toEqual(expect.arrayContaining([
      { attribute: 'city', reason: 'unattested_incumbent' },
    ]));
    expect(canonicalPatch('prospect_accounts')).not.toHaveProperty('city');
  });

  it('4. an incumbent with only person-scoped candidates is not applied, withheld or contested', async () => {
    seedAccount({ city: 'London', industry: null });
    personAssertion('a-p-london', { attribute: 'city', normalized_value: 'London', observed_at: T1 });
    personAssertion('a-p-manchester', { attribute: 'city', normalized_value: 'Manchester', observed_at: T2 });

    const res = await ingestAccount({ industry: 'Software' });

    // No account candidates for `city`, so the attribute is never considered.
    expect(res.canonicalApplied).not.toContain('city');
    expect(res.canonicalWithheld.map((w: Row) => w.attribute)).not.toContain('city');
    expect(res.canonicalContested).not.toContain('city');
    expect(db.tables.prospect_accounts[0].city).toBe('London');
  });

  it('5. account-scoped evidence still populates an eligible null account attribute', async () => {
    seedAccount({ industry: null });

    const res = await ingestAccount({ industry: 'Software' });

    expect(res.canonicalApplied).toContain('industry');
    expect(canonicalPatch('prospect_accounts').industry).toBe('Software');
    expect(decisionFor('industry')!.reason).toBe('single_uncontested_assertion');
  });

  it('6. when account and person evidence conflict, only account evidence decides', async () => {
    seedAccount({ city: null, industry: null });
    accountAssertion('a-acct-manchester', { attribute: 'city', normalized_value: 'Manchester', observed_at: T1 });
    personAssertion('a-person-leeds', { attribute: 'city', normalized_value: 'Leeds', observed_at: T2 });

    const res = await ingestAccount({ industry: 'Software' });

    expect(res.canonicalApplied).toContain('city');
    expect(canonicalPatch('prospect_accounts').city).toBe('Manchester');
    expect(res.canonicalContested).not.toContain('city');
    expect(decisionFor('city')!.reason).toBe('single_uncontested_assertion');
  });
});

describe('Change 1a — person arbitration is preserved', () => {
  it('7. person-scoped evidence still populates a person attribute', async () => {
    seedPerson({ job_title: null });

    const res = await ingestPerson({ jobTitle: 'VP' });

    expect(res.canonicalApplied).toContain('job_title');
    expect(canonicalPatch('unified_persons').job_title).toBe('VP');
  });

  it('8. account-scoped evidence does not determine a person attribute', async () => {
    // The BEHAVIOUR here held before Change 1a too: an account row has
    // `person_id` NULL by `entity_coherent`, so the person subject predicate
    // already excluded it, and Change 1a is belt-and-braces on this side. The
    // predicate assertion below is what makes this case fail against the old
    // read, so it is a guard on the behaviour and a witness to the new filter.
    seedPerson({ job_title: null });
    accountAssertion('a-acct-title', { attribute: 'job_title', normalized_value: 'CEO', observed_at: T1 });

    const res = await ingestPerson({ jobTitle: 'VP' });

    expect(canonicalPatch('unified_persons').job_title).toBe('VP');
    expect(arbitrationRead().eq).toEqual(expect.arrayContaining([
      ['organization_id', ORG_A], ['entity_type', 'person'], ['person_id', P1],
    ]));
  });

  it('9. person-level D-4 attestation and overwrite remain intact', async () => {
    seedPerson({ job_title: 'VP' });
    seedAssertion('a-person-vp', {
      entity_type: 'person', person_id: P1, attribute: 'job_title', normalized_value: 'VP', observed_at: T1,
    });

    const res = await ingestPerson({ jobTitle: 'CRO' });

    // 'VP' is attested by a person assertion, so a newer person value re-arbitrates.
    expect(res.canonicalApplied).toContain('job_title');
    expect(canonicalPatch('unified_persons').job_title).toBe('CRO');
    expect(res.canonicalContested).toContain('job_title');
  });
});

describe('Change 1a — tenant and lifecycle invariants', () => {
  it('10. another tenant\'s assertions are excluded and organization scoping is retained', async () => {
    seedAccount({ city: null, industry: null });
    accountAssertion('a-other-tenant', {
      organization_id: ORG_B, attribute: 'city', normalized_value: 'Manchester', observed_at: T1,
    });

    const res = await ingestAccount({ industry: 'Software' });

    expect(res.canonicalApplied).not.toContain('city');
    expect(db.tables.source_assertions.filter((r) => r.id === 'a-other-tenant')[0].applied_to_canonical_at)
      .toBeNull();

    const touched = db.reads
      .filter((r) => r.table === 'source_assertions' || r.table === 'prospect_accounts')
      .concat(db.updates.filter((u) => u.table === 'source_assertions' || u.table === 'prospect_accounts') as never[]);
    expect(touched.length).toBeGreaterThan(0);
    touched.forEach((s) => {
      const org = s.eq.filter(([c]) => c === 'organization_id');
      if (org.length > 0) expect(org[0][1]).toBe(ORG_A);
    });
  });

  it('11. a superseded account assertion still attests but cannot win', async () => {
    seedAccount({ city: 'Manchester', industry: null });
    accountAssertion('a-acct-withdrawn', {
      attribute: 'city', normalized_value: 'Manchester', observed_at: T1, superseded_at: T2,
    });
    accountAssertion('a-acct-live', { attribute: 'city', normalized_value: 'Leeds', observed_at: T2 });

    const res = await ingestAccount({ industry: 'Software' });

    // The withdrawn row attests 'Manchester', so the incumbent is re-arbitratable;
    // it cannot itself win, so 'Leeds' is applied.
    expect(res.canonicalApplied).toContain('city');
    expect(canonicalPatch('prospect_accounts').city).toBe('Leeds');
  });

  it('12a. single_uncontested_assertion — one account candidate', async () => {
    seedAccount({ city: null, industry: null });
    accountAssertion('a1', { attribute: 'city', normalized_value: 'Leeds', observed_at: T1 });

    await ingestAccount({ industry: 'Software' });

    expect(decisionFor('city')!.reason).toBe('single_uncontested_assertion');
  });

  it('12b. newest_observation — two account candidates, different times', async () => {
    seedAccount({ city: null, industry: null });
    accountAssertion('a1', { attribute: 'city', normalized_value: 'Leeds', observed_at: T1 });
    accountAssertion('a2', { attribute: 'city', normalized_value: 'York', observed_at: T2 });

    const res = await ingestAccount({ industry: 'Software' });

    expect(decisionFor('city')!.reason).toBe('newest_observation');
    expect(canonicalPatch('prospect_accounts').city).toBe('York');
    expect(res.canonicalContested).toContain('city');
  });

  it('12c. authoritative_source — a declared provider decides a disagreement', async () => {
    authority.byAttribute = { city: ['beta'] };
    seedAccount({ city: null, industry: null });
    accountAssertion('a1', { attribute: 'city', normalized_value: 'Leeds', observed_at: T2, provider: 'alpha' });
    accountAssertion('a2', { attribute: 'city', normalized_value: 'York', observed_at: T1, provider: 'beta' });

    await ingestAccount({ industry: 'Software' });

    expect(decisionFor('city')!.reason).toBe('authoritative_source');
    expect(canonicalPatch('prospect_accounts').city).toBe('York');
  });

  it('12d. sources_disagree — a candidate that cannot be ordered in time', async () => {
    seedAccount({ city: null, industry: null });
    accountAssertion('a1', { attribute: 'city', normalized_value: 'Leeds', observed_at: T1 });
    accountAssertion('a2', {
      attribute: 'city', normalized_value: 'York', observed_at: null, recorded_at: null,
    });

    const res = await ingestAccount({ industry: 'Software' });

    expect(res.canonicalWithheld).toEqual(expect.arrayContaining([
      { attribute: 'city', reason: 'sources_disagree' },
    ]));
    expect(canonicalPatch('prospect_accounts')).not.toHaveProperty('city');
  });
});

describe('Change 1a — decision-log and winner-stamping provenance', () => {
  it('13. the decision and the stamp reference the account assertion, not the person one', async () => {
    // Both carry the SAME value, so the canonical result is identical either way.
    // The person row is newer, so it would win `compareForStamp` and become the
    // stamped assertion — putting a person assertion id into an ACCOUNT decision.
    seedAccount({ city: null });
    accountAssertion('a-acct-leeds', { attribute: 'city', normalized_value: 'Leeds', observed_at: T1 });
    personAssertion('a-person-leeds', { attribute: 'city', normalized_value: 'Leeds', observed_at: T2 });

    const res = await ingestAccount();

    expect(res.canonicalApplied).toContain('city');
    expect(canonicalPatch('prospect_accounts').city).toBe('Leeds');

    expect(decisionFor('city')!.assertion_id).toBe('a-acct-leeds');

    const stamps = db.updates.filter((u) => u.table === 'source_assertions'
      && Object.prototype.hasOwnProperty.call(u.payload, 'applied_to_canonical_at'));
    expect(stamps.length).toBe(1);
    expect(stamps[0].eq).toEqual(expect.arrayContaining([['id', 'a-acct-leeds']]));
    expect(db.tables.source_assertions.filter((r) => r.id === 'a-person-leeds')[0].applied_to_canonical_at)
      .toBeNull();
  });
});

// Module scope: keeps this file's top-level names from colliding with other test files under tsc.
export {};
