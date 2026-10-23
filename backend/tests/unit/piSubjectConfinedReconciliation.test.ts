/**
 * D2 — subject-confined reconciliation.
 *
 * `reconcileAssertionLiveness` used to be keyed on
 * (organization_id, source_record_id) alone. That is SUBJECT-BLIND, and one
 * source record can legitimately carry evidence for more than one subject: the
 * lead orchestrator's account pass falls back to the person's external id when
 * the provider supplies no account id of its own. Because the pass keys its hash
 * map by ATTRIBUTE, and because the person and account attribute surfaces overlap
 * on country_code / region / city, ingesting for one subject could supersede
 * another subject's live row for the same attribute.
 *
 * Two legs make the confinement exact, and both are asserted here:
 *   - the subject COLUMN (person_id / account_id / relationship_id), and
 *   - `entity_type`, which DECLARES which leg is the subject. The column alone is
 *     insufficient, because the ingestion boundary sets `account_id`
 *     unconditionally, so a person-scoped row also carries an account leg.
 *
 * The database is doubled and every statement recorded: these are assertions
 * about what was SENT as well as about what changed. The double implements `.in`,
 * so an update that should have been narrowed cannot silently appear narrow.
 */

type Row = Record<string, unknown>;

const db = {
  tables: {} as Record<string, Row[]>,
  reads: [] as Array<{ table: string; eq: Array<[string, unknown]>; ins: Array<[string, unknown[]]> }>,
  updates: [] as Array<{ table: string; payload: Row; eq: Array<[string, unknown]>; ins: Array<[string, unknown[]]> }>,
};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const st = {
      op: 'select' as 'select' | 'update',
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
      if (st.op === 'update') {
        db.updates.push({ table, payload: st.payload as Row, eq: st.eq, ins: st.ins });
        rows().filter(match).forEach((r) => Object.assign(r, st.payload));
        return { data: null, error: null };
      }
      db.reads.push({ table, eq: st.eq, ins: st.ins });
      const found = rows().filter(match);
      return st.mode === 'one' ? { data: found[0] || null, error: null } : { data: found, error: null };
    };
    const b: Record<string, unknown> = {
      select: () => b,
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
}));

jest.mock('../../services/prospectIdentity/attributeAuthorityStore', () => ({
  AUTHORITY_ENTITY_TYPES: ['person', 'account', 'relationship'],
  isAuthorityEntityType: () => true,
  loadAuthorityDeclarations: async () => [],
}));
jest.mock('../../services/logger', () => ({
  logger: {
    warn: () => {}, info: () => {}, error: () => {}, debug: () => {},
  },
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const { reconcileAssertionLiveness, computeValueHash } = require('../../services/prospectIdentity/ingestionBoundary');
/* eslint-enable @typescript-eslint/no-var-requires */

const ORG = '00000000-0000-4000-8000-00000000000a';
const OTHER_ORG = '00000000-0000-4000-8000-00000000000b';
const SR = 'source-record-1';
const P1 = 'person-1';
const P2 = 'person-2';
const A1 = 'account-1';
const R1 = 'relationship-1';
const R2 = 'relationship-2';
const WITHDRAWN_AT = '2026-01-01T00:00:00.000Z';

const H = (v: string): string => computeValueHash(v, null);

const seed = (id: string, over: Row): Row => {
  const r: Row = {
    id,
    organization_id: ORG,
    source_record_id: SR,
    entity_type: 'person',
    person_id: null,
    account_id: null,
    relationship_id: null,
    attribute: 'city',
    value_hash: H('Leeds'),
    superseded_at: null,
    ...over,
  };
  db.tables.source_assertions = db.tables.source_assertions || [];
  db.tables.source_assertions.push(r);
  return r;
};

const pending = (attribute: string, value: string) => [{ attribute, rawValue: null, normalizedValue: value }];

const row = (id: string): Row => (db.tables.source_assertions || []).filter((r) => r.id === id)[0];

beforeEach(() => {
  db.tables = {};
  db.reads = [];
  db.updates = [];
});

describe('D2 — reconciliation is confined to the incoming subject', () => {
  it('the account pass does not supersede a person row sharing the source record', async () => {
    // The orchestrator shape: the person pass wrote a row carrying BOTH legs, the
    // account pass wrote its own row, and both share one source record.
    seed('person-row', {
      entity_type: 'person', person_id: P1, account_id: A1, value_hash: H('Leeds'),
    });
    seed('account-row', {
      entity_type: 'account', person_id: null, account_id: A1, value_hash: H('London'),
    });

    const out = await reconcileAssertionLiveness(
      ORG, SR, { kind: 'account', accountId: A1 }, pending('city', 'Manchester'),
    );

    // The account's own row is withdrawn, which is correct.
    expect(out).toEqual({ superseded: 1, revived: 0 });
    expect(row('account-row').superseded_at).not.toBeNull();
    // The PERSON's row is untouched, which is the point of D2. Before this change
    // it was superseded, because `account_id` matched and the hash differed.
    expect(row('person-row').superseded_at).toBeNull();
  });

  it('reconciling subject B never reads or writes subject A rows', async () => {
    seed('p1-row', { entity_type: 'person', person_id: P1, value_hash: H('Leeds') });
    seed('p2-row', { entity_type: 'person', person_id: P2, value_hash: H('York') });

    const out = await reconcileAssertionLiveness(
      ORG, SR, { kind: 'person', personId: P2 }, pending('city', 'Hull'),
    );

    expect(out).toEqual({ superseded: 1, revived: 0 });
    expect(row('p2-row').superseded_at).not.toBeNull();
    expect(row('p1-row').superseded_at).toBeNull();

    // What was SENT: both legs of the confinement, on the read and on the write.
    expect(db.reads[0].eq).toEqual(expect.arrayContaining([
      ['organization_id', ORG], ['source_record_id', SR], ['entity_type', 'person'], ['person_id', P2],
    ]));
    expect(db.updates[0].eq).toEqual(expect.arrayContaining([
      ['organization_id', ORG], ['entity_type', 'person'], ['person_id', P2],
    ]));
    expect(db.updates[0].ins).toEqual([['id', ['p2-row']]]);
  });

  it('relationship R1 reconciliation never touches R2', async () => {
    seed('r1-row', {
      entity_type: 'relationship', relationship_id: R1, attribute: 'job_title', value_hash: H('VP'),
    });
    seed('r2-row', {
      entity_type: 'relationship', relationship_id: R2, attribute: 'job_title', value_hash: H('SVP'),
    });

    const out = await reconcileAssertionLiveness(
      ORG, SR, { kind: 'relationship', relationshipId: R1 }, pending('job_title', 'Director'),
    );

    expect(out).toEqual({ superseded: 1, revived: 0 });
    expect(row('r1-row').superseded_at).not.toBeNull();
    expect(row('r2-row').superseded_at).toBeNull();
  });

  it('a fully detached row is neither superseded nor revived', async () => {
    // All three subject legs NULL — what person erasure leaves behind.
    seed('detached-stale', { entity_type: 'person', person_id: null, value_hash: H('Leeds') });
    seed('detached-withdrawn', {
      entity_type: 'person', person_id: null, value_hash: H('Hull'), superseded_at: WITHDRAWN_AT,
    });

    const out = await reconcileAssertionLiveness(
      ORG, SR, { kind: 'person', personId: P1 }, pending('city', 'Hull'),
    );

    expect(out).toEqual({ superseded: 0, revived: 0 });
    expect(row('detached-stale').superseded_at).toBeNull();
    // A MATCHING hash must not resurrect detached evidence.
    expect(row('detached-withdrawn').superseded_at).toBe(WITHDRAWN_AT);
    expect(db.updates).toEqual([]);
  });

  it('a same-key row in another tenant is never read or written', async () => {
    seed('mine', { entity_type: 'person', person_id: P1, value_hash: H('Leeds') });
    seed('theirs', {
      organization_id: OTHER_ORG, entity_type: 'person', person_id: P1, value_hash: H('Leeds'),
    });

    const out = await reconcileAssertionLiveness(
      ORG, SR, { kind: 'person', personId: P1 }, pending('city', 'Hull'),
    );

    expect(out).toEqual({ superseded: 1, revived: 0 });
    expect(row('mine').superseded_at).not.toBeNull();
    expect(row('theirs').superseded_at).toBeNull();
    const statements: Array<{ eq: Array<[string, unknown]> }> = [];
    db.reads.forEach((r) => statements.push(r));
    db.updates.forEach((u) => statements.push(u));
    statements.forEach((s) => {
      expect(s.eq).toEqual(expect.arrayContaining([['organization_id', ORG]]));
    });
  });

  it('still supersedes and revives the intended subject (unchanged behaviour)', async () => {
    seed('live-stale', {
      entity_type: 'person', person_id: P1, attribute: 'city', value_hash: H('Leeds'),
    });
    seed('was-withdrawn', {
      entity_type: 'person',
      person_id: P1,
      attribute: 'region',
      value_hash: H('Yorkshire'),
      superseded_at: WITHDRAWN_AT,
    });

    const out = await reconcileAssertionLiveness(
      ORG, SR, { kind: 'person', personId: P1 },
      [
        { attribute: 'city', rawValue: null, normalizedValue: 'Hull' },
        { attribute: 'region', rawValue: null, normalizedValue: 'Yorkshire' },
      ],
    );

    expect(out).toEqual({ superseded: 1, revived: 1 });
    expect(row('live-stale').superseded_at).not.toBeNull();
    expect(row('was-withdrawn').superseded_at).toBeNull();
  });

  it('leaves an attribute the record no longer speaks to alone', async () => {
    seed('other-attr', {
      entity_type: 'person', person_id: P1, attribute: 'timezone', value_hash: H('Europe/London'),
    });

    const out = await reconcileAssertionLiveness(
      ORG, SR, { kind: 'person', personId: P1 }, pending('city', 'Hull'),
    );

    expect(out).toEqual({ superseded: 0, revived: 0 });
    expect(row('other-attr').superseded_at).toBeNull();
  });
});

describe('D2 — a malformed subject fails before any query', () => {
  const bad: Array<[string, unknown]> = [
    ['undefined', undefined],
    ['null', null],
    ['no kind', {}],
    ['an unknown kind', { kind: 'tenant', tenantId: 'x' }],
    ['person with a missing id', { kind: 'person' }],
    ['person with a blank id', { kind: 'person', personId: '   ' }],
    ['person with a non-string id', { kind: 'person', personId: 42 }],
    ['account with a blank id', { kind: 'account', accountId: '' }],
    ['relationship with a missing id', { kind: 'relationship' }],
  ];

  it.each(bad)('rejects %s without issuing a query', async (_label, subject) => {
    seed('untouched', { entity_type: 'person', person_id: P1, value_hash: H('Leeds') });

    await expect(
      reconcileAssertionLiveness(ORG, SR, subject, pending('city', 'Hull')),
    ).rejects.toThrow('reconcile subject');

    expect(db.reads).toEqual([]);
    expect(db.updates).toEqual([]);
    expect(row('untouched').superseded_at).toBeNull();
  });

  it('never falls back to a subject-blind read, even with nothing pending', async () => {
    // The guard must fire before the empty-pending short circuit, so no caller can
    // reach the wide read by passing an empty attribute set.
    await expect(
      reconcileAssertionLiveness(ORG, SR, {}, []),
    ).rejects.toThrow('liveness is never subject-blind');

    expect(db.reads).toEqual([]);
  });
});

// Module scope: keeps this file's top-level names from colliding with other test files under tsc.
export {};
