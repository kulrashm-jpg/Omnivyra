/**
 * O-5C — a source record's ACCOUNT link is filled in, never re-pointed.
 *
 * `upsertSourceRecord` carries the comment "Canonical links are only ever
 * filled in, never re-pointed here", but the conflict path tested only the
 * INPUT:
 *
 *     if (input.accountId) update.account_id = input.accountId;
 *
 * so a re-presented record carrying a different resolved employer silently
 * moved the association. It is reachable rather than theoretical:
 * `resolveAccount` in the lead orchestrator resolves from the RECORD's own
 * company data (domain, name, external id), NOT from the person's existing
 * attachment — and `attachPersonToAccount` is write-once, so the person's
 * canonical employer stays put while the source record's drifts away from it.
 *
 * ─── WHY THE GUARD NEEDED A SELECT CHANGE TOO ─────────────────────────────
 * The conflict read selected `id, payload_hash, observation_count` only, so
 * `found.account_id` was `undefined` for every row. A guard written as
 * `input.accountId && !found.account_id` would therefore have been a NO-OP that
 * looked like a fix: `!undefined` is always true. The column is now selected,
 * and the first test below pins that, because it is the load-bearing half.
 *
 * ─── O-5E — THE PERSON LINK IS NOW FILL-ONLY TOO ──────────────────────────
 * The `person_id` branch had the IDENTICAL shape and was corrected under O-5E,
 * so both canonical links are selected and both are fill-only. Ordinary
 * ingestion still has NO reassignment or merge mechanism, and this change does
 * not resolve parent/child subject divergence: `source_assertions` carry their
 * own subject, written once at insert, so a record whose resolution changes
 * will have children that disagree with it either way.
 *
 * The dual-leg INSERT payload is documented, intended design
 * (`source_records_entity_coherent`: "a person-shaped record may name both
 * itself and its employer") and is asserted unchanged below.
 *
 * SECRETS: all synthetic.
 */

type Row = Record<string, unknown>;

const db = {
  rows: [] as Row[],
  inserts: [] as Row[],
  selects: [] as Array<{ columns: string; eq: Array<[string, unknown]> }>,
  updates: [] as Array<{ payload: Row; eq: Array<[string, unknown]> }>,
  nextId: 1,
};

/** The real unique index: one row per provider record per tenant. */
const IDENTITY = ['organization_id', 'provider', 'source_entity_type', 'source_record_id'];

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const st = {
      op: 'select' as 'select' | 'insert' | 'update',
      columns: '',
      eq: [] as Array<[string, unknown]>,
      payload: null as Row | null,
    };
    const match = (r: Row) => st.eq.every(([c, v]) => (r[c] === undefined ? null : r[c]) === v);
    const exec = async () => {
      await Promise.resolve();
      if (table !== 'source_records') return { data: null, error: null };

      if (st.op === 'insert') {
        const p = st.payload as Row;
        db.inserts.push(p);
        // Model the unique index rather than assuming no conflict: the whole
        // path under test only runs when the insert raises 23505.
        const clash = db.rows.some((r) => IDENTITY.every((c) => r[c] === p[c]));
        if (clash) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
        }
        const created = { id: `sr-${db.nextId++}`, ...p };
        db.rows.push(created);
        return { data: { id: created.id }, error: null };
      }

      if (st.op === 'update') {
        db.updates.push({ payload: st.payload as Row, eq: st.eq });
        db.rows.filter(match).forEach((r) => Object.assign(r, st.payload));
        return { data: null, error: null };
      }

      db.selects.push({ columns: st.columns, eq: st.eq });
      const found = db.rows.filter(match);
      // Only the columns actually selected come back — this is what made the
      // original guard blind, so the double must not be more generous.
      const cols = st.columns.split(',').map((c) => c.trim()).filter(Boolean);
      const projected = found.map((r) => {
        const out: Row = {};
        for (const c of cols) out[c] = r[c] === undefined ? null : r[c];
        return out;
      });
      return { data: projected[0] ?? null, error: null };
    };
    const b: Record<string, unknown> = {
      select: (cols?: string) => { if (typeof cols === 'string') st.columns = cols; return b; },
      insert: (p: Row) => { st.op = 'insert'; st.payload = p; return b; },
      update: (p: Row) => { st.op = 'update'; st.payload = p; return b; },
      eq: (c: string, v: unknown) => { st.eq.push([c, v]); return b; },
      is: (c: string, v: unknown) => { st.eq.push([c, v]); return b; },
      single: () => exec(),
      maybeSingle: () => exec(),
      then: (r: (v: unknown) => unknown, j: (e: unknown) => unknown) => exec().then(r, j),
    };
    return b;
  },
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const { upsertSourceRecord, computePayloadHash } = require('../../services/prospectIdentity/ingestionBoundary');
/* eslint-enable @typescript-eslint/no-var-requires */

const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000bb';
const ACC_A = 'account-a';
const ACC_B = 'account-b';
const P1 = 'person-1';
const P2 = 'person-2';
const T1 = '2026-09-01T00:00:00.000Z';
const T2 = '2026-10-01T00:00:00.000Z';

/** An already-stored source record, as a prior ingest would have left it. */
const seed = (over: Row = {}) => {
  db.rows.push({
    id: `sr-seed-${db.rows.length + 1}`,
    organization_id: ORG_A, provider: 'crm', source_entity_type: 'person',
    source_record_id: 'REC-1',
    person_id: P1, account_id: null,
    raw_payload: { seq: 1 }, payload_hash: computePayloadHash({ seq: 1 }),
    observation_count: 1, observed_at: T1, ingestion_run_id: null,
    ...over,
  });
};

const ingest = (over: Row = {}) => upsertSourceRecord({
  organizationId: ORG_A, provider: 'crm', entityType: 'person',
  sourceRecordId: 'REC-1', rawPayload: { seq: 1 },
  personId: P1, observedAt: T1, ...over,
} as never, T2);

const stored = () => db.rows.filter((r) => r.source_record_id === 'REC-1' && r.organization_id === ORG_A)[0];
const conflictSelect = () => db.selects[0];
const updatePayload = (): Row => (db.updates.length === 0 ? {} : db.updates[0].payload);

beforeEach(() => { db.rows = []; db.inserts = []; db.selects = []; db.updates = []; db.nextId = 1; });

describe('O-5C — the account link is filled in, never re-pointed', () => {
  it('selects BOTH canonical links on the conflict read — without them the guards are blind', async () => {
    seed();
    await ingest({ accountId: ACC_A });

    expect(conflictSelect().columns).toContain('person_id');
    expect(conflictSelect().columns).toContain('account_id');
  });

  it('1. an ABSENT stored association is filled from a non-null incoming id', async () => {
    seed({ account_id: null });

    const out = await ingest({ accountId: ACC_A });

    expect(updatePayload().account_id).toBe(ACC_A);
    expect(stored().account_id).toBe(ACC_A);
    expect(out.outcome).toBe('unchanged');              // payload identical
  });

  it('2. an EXISTING association is NOT replaced by a different incoming id', async () => {
    seed({ account_id: ACC_A });

    await ingest({ accountId: ACC_B });

    expect(updatePayload()).not.toHaveProperty('account_id');
    expect(stored().account_id).toBe(ACC_A);            // the association held
  });

  it('3. an EXISTING association is not cleared when the incoming id is absent', async () => {
    seed({ account_id: ACC_A });

    await ingest({});                                   // no accountId supplied

    expect(updatePayload()).not.toHaveProperty('account_id');
    expect(stored().account_id).toBe(ACC_A);
  });

  it('4. re-presenting the SAME id is safe and writes no account change', async () => {
    seed({ account_id: ACC_A });

    await ingest({ accountId: ACC_A });

    expect(updatePayload()).not.toHaveProperty('account_id');
    expect(stored().account_id).toBe(ACC_A);
  });

});

describe('O-5E — the person link is filled in, never re-pointed', () => {
  it('8. a NULL stored person link is filled from a non-null incoming id', async () => {
    seed({ person_id: null });

    await ingest({ personId: P1 });

    expect(updatePayload().person_id).toBe(P1);
    expect(stored().person_id).toBe(P1);
  });

  it('9. an EXISTING person link is NOT replaced by a different incoming person', async () => {
    // The reachable case: the source record's identity is the PROVIDER's record
    // id, while the person is resolved from the payload's email/phone/external
    // keys with EMAIL FIRST. A CRM record re-presented with a corrected email
    // belonging to another person in the tenant used to move this record's
    // subject silently.
    seed({ person_id: P1 });

    await ingest({ personId: P2 });

    expect(updatePayload()).not.toHaveProperty('person_id');
    expect(stored().person_id).toBe(P1);                 // the subject held
  });

  it('10. an EXISTING person link is not cleared when the incoming id is absent', async () => {
    seed({ person_id: P1 });

    await ingest({ personId: undefined });

    expect(updatePayload()).not.toHaveProperty('person_id');
    expect(stored().person_id).toBe(P1);
  });

  it('11. re-presenting the SAME person writes no redundant person_id update', async () => {
    seed({ person_id: P1 });

    await ingest({ personId: P1 });

    expect(updatePayload()).not.toHaveProperty('person_id');
    expect(stored().person_id).toBe(P1);
  });

  it('12. both links fill independently when both are absent', async () => {
    seed({ person_id: null, account_id: null });

    await ingest({ personId: P1, accountId: ACC_A });

    expect(updatePayload().person_id).toBe(P1);
    expect(updatePayload().account_id).toBe(ACC_A);
  });

  it('13. a stored person link holds while an absent account link still fills', async () => {
    // The two guards are independent: one established link must not block the
    // other from being completed.
    seed({ person_id: P1, account_id: null });

    await ingest({ personId: P2, accountId: ACC_A });

    expect(updatePayload()).not.toHaveProperty('person_id');
    expect(updatePayload().account_id).toBe(ACC_A);
    expect(stored().person_id).toBe(P1);
    expect(stored().account_id).toBe(ACC_A);
  });
});

describe('O-5C — everything else on the conflict path is untouched', () => {
  it('5. the dual-leg INSERT design is preserved on a FRESH record', async () => {
    // No seed, so no conflict: this is the INSERT payload, which `source_records
    // _entity_coherent` explicitly permits to name both the person and its
    // employer.
    const out = await ingest({ accountId: ACC_A, sourceRecordId: 'REC-NEW' });

    expect(out.outcome).toBe('created');
    expect(db.inserts[0]).toMatchObject({
      source_entity_type: 'person', person_id: P1, account_id: ACC_A,
    });
  });

  it('6a. conflict selection still keys on the source-record identity', async () => {
    seed();
    await ingest({ accountId: ACC_A });

    expect(conflictSelect().eq).toEqual([
      ['organization_id', ORG_A], ['provider', 'crm'],
      ['source_entity_type', 'person'], ['source_record_id', 'REC-1'],
    ]);
  });

  it('6b. observation_count still bumps and timestamps still move', async () => {
    seed({ observation_count: 4 });

    await ingest({ accountId: ACC_A });

    expect(updatePayload().observation_count).toBe(5);
    expect(updatePayload().last_seen_at).toBe(T2);
    expect(updatePayload().updated_at).toBe(T2);
  });

  it('6c. payload-hash change detection still reports changed vs unchanged', async () => {
    seed();
    const same = await ingest({ accountId: ACC_A });
    expect(same.outcome).toBe('unchanged');
    expect(updatePayload()).not.toHaveProperty('payload_hash');

    db.selects = []; db.updates = [];
    const moved = await ingest({ rawPayload: { seq: 2 } });
    expect(moved.outcome).toBe('changed');
    expect(updatePayload().payload_hash).toBe(computePayloadHash({ seq: 2 }));
  });

  it('7a. the conflict update is tenant-scoped', async () => {
    seed();
    await ingest({ accountId: ACC_A });

    expect(db.updates[0].eq).toEqual(expect.arrayContaining([['organization_id', ORG_A]]));
  });

  it('7b. another tenant\'s identical record is a SEPARATE row, not an update', async () => {
    seed({ organization_id: ORG_B, account_id: ACC_B });

    const out = await ingest({ accountId: ACC_A });

    expect(out.outcome).toBe('created');                 // no conflict across tenants
    expect(db.updates).toEqual([]);
    // ...and the other tenant's association was not touched.
    expect(db.rows.filter((r) => r.organization_id === ORG_B)[0].account_id).toBe(ACC_B);
  });
});

// Module scope: keeps this file's top-level names from colliding with other test files under tsc.
export {};
