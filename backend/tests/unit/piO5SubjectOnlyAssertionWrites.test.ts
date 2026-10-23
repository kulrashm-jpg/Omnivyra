/**
 * O-5 — an assertion names ONE subject.
 *
 * `recordAssertions` wrote `account_id: input.accountId ?? null` ungated, so a
 * person-scoped assertion carried the account leg as well as its own whenever
 * the caller had resolved an employer — which the lead orchestrator always has
 * by the time it records provenance (it passes `personId` AND `accountId` on the
 * person pass). `entity_type` said `'person'`; the row said "and also this
 * account". That ambiguity is what Change 1a, O-2 and O-3 each had to defend
 * against in a different reader.
 *
 * The schema already states the intended model for the other two subjects —
 * `source_assertions_relationship_coherent` requires a relationship assertion to
 * name neither person nor account, `source_assertions_entity_coherent` requires
 * an account assertion to name no person, and the sibling attempt ledger spells
 * it out: "Exactly one subject. A row about neither, or about both, is
 * meaningless." Person rows were the one case left open, by omission rather than
 * by decision.
 *
 * ─── WHAT THIS DOES NOT DO ────────────────────────────────────────────────
 * It is FORWARD-ONLY. Historical dual-leg rows are untouched, so the reader-side
 * filters remain load-bearing and the suites that seed dual-leg fixtures
 * (`piSubjectCorrectArbitration`, `piSubjectConfinedReconciliation`,
 * `piWs7AccountIntelligence`, `piO3*`) are still testing real historical data,
 * not stale expectations. This writer change is additional protection, not a
 * replacement for those filters.
 *
 * The employer association is NOT stored here and never was: it lives on
 * `unified_persons.account_id`, written write-once by `attachPersonToAccount`.
 * The last test exercises that real function to show the association survives
 * while the evidence row stops duplicating it.
 *
 * SECRETS: all synthetic.
 */

type Row = Record<string, unknown>;

const db = {
  tables: {} as Record<string, Row[]>,
  inserts: [] as Array<{ table: string; payload: Row }>,
  updates: [] as Array<{ table: string; payload: Row; eq: Array<[string, unknown]> }>,
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
        // Mirror the real column defaults, as the Change 1a double does.
        const defaults: Row = table === 'source_assertions'
          ? { superseded_at: null, applied_to_canonical_at: null, applied_reason: null }
          : {};
        const created = { id: `${table}-${db.nextId++}`, ...defaults, ...(st.payload as Row) };
        rows().push(created);
        return { data: created, error: null };
      }
      if (st.op === 'update') {
        db.updates.push({ table, payload: st.payload as Row, eq: st.eq });
        const hit = rows().filter(match);
        hit.forEach((r) => Object.assign(r, st.payload));
        return { data: hit, error: null };
      }
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
   * `pi_apply_canonical_decisions`, emulated against this file's fake store.
   *
   * The canonical update, the decision log and the provenance stamp moved into
   * one database function so they share a transaction. A fake store has no
   * transaction, so this double cannot and does not prove atomicity — that is
   * proven against real PostgreSQL in
   * `backend/tests/realschema/ca_canonical_write_atomicity.test.ts`. What it
   * preserves is the observable effect, so the assertions in this file keep
   * testing what they were written to test.
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
    const tbl = (t: string): Row[] => (db.tables[t] = db.tables[t] || []);

    // Fails closed on a missing or wrongly-tenanted subject, as the real
    // function does with RAISE EXCEPTION.
    const canonical = tbl(table).filter((r) => r.id === target && r[tenantCol] === org)[0];
    if (!canonical) {
      return { data: null, error: new Error(`no ${table} row ${target} in tenant ${org}`) };
    }

    const patch: Row = { attributes_source: args.p_provider, attributes_updated_at: now };
    for (const d of decisions) patch[d.attribute] = d.value;
      db.updates.push({ table, payload: patch, eq: [['id', target], [tenantCol, org]] });
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
      tbl('canonical_attribute_decisions').push({ id: `cad-${d.attribute}-${d.assertion_id}`, ...logged });

      const stamp: Row = { applied_to_canonical_at: now, applied_reason: d.reason };
        db.updates.push({
          table: 'source_assertions',
          payload: stamp,
          eq: [['id', d.assertion_id], ['organization_id', org], ['applied_to_canonical_at', null]],
        });
      tbl('source_assertions')
        .filter((r) => r.id === d.assertion_id && r.organization_id === org
          && (r.applied_to_canonical_at ?? null) === null)
        .forEach((r) => Object.assign(r, stamp));
    }
    return { data: decisions.length, error: null };
  },
}));

jest.mock('../../services/prospectIdentity/attributeAuthorityStore', () => ({
  AUTHORITY_ENTITY_TYPES: ['person', 'account', 'relationship'],
  isAuthorityEntityType: (v: unknown) => typeof v === 'string'
    && ['person', 'account', 'relationship'].indexOf(v) !== -1,
  loadAuthorityDeclarations: async () => [],
}));

jest.mock('../../services/logger', () => ({
  logger: {
    warn: () => {}, info: () => {}, error: () => {}, debug: () => {},
  },
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const { ingestSourceRecord } = require('../../services/prospectIdentity/ingestionBoundary');
const { attachPersonToAccount } = require('../../services/prospectIdentity/accountResolution');
/* eslint-enable @typescript-eslint/no-var-requires */

const ORG = '00000000-0000-4000-8000-0000000000aa';
const ACC = 'account-1';
const P1 = 'person-1';
const OBSERVED = '2026-09-01T00:00:00.000Z';

const seedAccount = (over: Row = {}) => {
  (db.tables.prospect_accounts = db.tables.prospect_accounts || []).push({
    id: ACC, organization_id: ORG, industry: null, city: null, region: null, country_code: null, ...over,
  });
};
const seedPerson = (over: Row = {}) => {
  (db.tables.unified_persons = db.tables.unified_persons || []).push({
    id: P1, company_id: ORG, account_id: null, job_title: null, city: null, ...over,
  });
};

/** Every `source_assertions` insert payload this ingest produced. */
const assertionWrites = (): Row[] => db.inserts
  .filter((i) => i.table === 'source_assertions').map((i) => i.payload);

const sourceRecordWrite = (): Row => db.inserts
  .filter((i) => i.table === 'source_records').map((i) => i.payload)[0];

const canonicalPatch = (table: string): Row => {
  const u = db.updates.filter((x) => x.table === table);
  return u.length === 0 ? {} : u[u.length - 1].payload;
};

beforeEach(() => { db.tables = {}; db.inserts = []; db.updates = []; db.nextId = 1; });

describe('O-5 — a person assertion names the person and no account', () => {
  it('1. a person ingest with a resolved employer writes account_id = NULL', async () => {
    seedPerson();
    seedAccount();

    await ingestSourceRecord({
      organizationId: ORG, provider: 'crm', entityType: 'person',
      sourceRecordId: 'REC-1', rawPayload: { seq: 1 },
      // Exactly what the lead orchestrator passes on its person pass.
      personId: P1, accountId: ACC, observedAt: OBSERVED,
      personAttributes: { jobTitle: 'VP', city: 'Leeds' },
    });

    const writes = assertionWrites();
    expect(writes.length).toBeGreaterThan(0);
    for (const row of writes) {
      expect(row.entity_type).toBe('person');
      expect(row.person_id).toBe(P1);
      expect(row.account_id).toBeNull();           // the defect, closed
    }
    // And the overlap attribute is among them, which is the one that mattered.
    expect(writes.map((r) => r.attribute)).toContain('city');
  });

  it('3a. a person ingest with no employer context also writes NULL', async () => {
    seedPerson();

    await ingestSourceRecord({
      organizationId: ORG, provider: 'crm', entityType: 'person',
      sourceRecordId: 'REC-2', rawPayload: { seq: 1 },
      personId: P1, observedAt: OBSERVED,
      personAttributes: { jobTitle: 'VP' },
    });

    for (const row of assertionWrites()) {
      expect(row.account_id).toBeNull();
      expect(row.person_id).toBe(P1);
    }
  });
});

describe('O-5 — an account assertion is unchanged', () => {
  it('2. an account ingest still persists the supplied account_id', async () => {
    seedAccount();

    await ingestSourceRecord({
      organizationId: ORG, provider: 'crm', entityType: 'account',
      sourceRecordId: 'REC-3', rawPayload: { seq: 1 },
      accountId: ACC, observedAt: OBSERVED,
      accountAttributes: { industry: 'Software', city: 'Manchester' },
    });

    const writes = assertionWrites();
    expect(writes.length).toBeGreaterThan(0);
    for (const row of writes) {
      expect(row.entity_type).toBe('account');
      expect(row.account_id).toBe(ACC);
      expect(row.person_id).toBeNull();            // by `entity_coherent`, as before
    }
  });

  it('3b. an account ingest with no account context parks evidence with NULL', async () => {
    await ingestSourceRecord({
      organizationId: ORG, provider: 'crm', entityType: 'account',
      sourceRecordId: 'REC-4', rawPayload: { seq: 1 },
      observedAt: OBSERVED,
      accountAttributes: { industry: 'Software' },
    });

    const writes = assertionWrites();
    expect(writes.length).toBeGreaterThan(0);
    for (const row of writes) {
      expect(row.entity_type).toBe('account');
      expect(row.account_id).toBeNull();
    }
  });

  it('4. an account ingest that is ALSO handed a personId still names no person', async () => {
    // Pre-existing behaviour, asserted here so the new gate cannot be mistaken
    // for having changed the person leg's rule.
    seedAccount();

    await ingestSourceRecord({
      organizationId: ORG, provider: 'crm', entityType: 'account',
      sourceRecordId: 'REC-5', rawPayload: { seq: 1 },
      personId: P1, accountId: ACC, observedAt: OBSERVED,
      accountAttributes: { industry: 'Software' },
    });

    for (const row of assertionWrites()) {
      expect(row.entity_type).toBe('account');
      expect(row.person_id).toBeNull();
      expect(row.account_id).toBe(ACC);
    }
  });
});

describe('O-5 — the scope boundary, asserted rather than described', () => {
  it('the source_records writer is UNCHANGED — it still carries both legs', async () => {
    // Deliberate: the O-5 audit found the same pattern on the parent row, and
    // this pass is explicitly not authorized to touch it. If a later change
    // does, this test should be updated with that authorization — not quietly.
    seedPerson();
    seedAccount();

    await ingestSourceRecord({
      organizationId: ORG, provider: 'crm', entityType: 'person',
      sourceRecordId: 'REC-6', rawPayload: { seq: 1 },
      personId: P1, accountId: ACC, observedAt: OBSERVED,
      personAttributes: { jobTitle: 'VP' },
    });

    expect(sourceRecordWrite()).toMatchObject({
      source_entity_type: 'person', person_id: P1, account_id: ACC,
    });
  });
});

describe('O-5 — the employer association is untouched', () => {
  it('5. attachPersonToAccount still owns it, and the boundary never writes it', async () => {
    seedPerson();
    seedAccount();

    // The real association path, exercised for real — this is where the
    // employer is recorded, and it is write-once.
    const attached = await attachPersonToAccount(ORG, P1, ACC);
    expect(attached).toEqual({ attached: true, reason: 'person attached to account' });
    expect(db.tables.unified_persons[0].account_id).toBe(ACC);

    db.inserts = [];
    db.updates = [];

    await ingestSourceRecord({
      organizationId: ORG, provider: 'crm', entityType: 'person',
      sourceRecordId: 'REC-7', rawPayload: { seq: 1 },
      personId: P1, accountId: ACC, observedAt: OBSERVED,
      personAttributes: { jobTitle: 'VP' },
    });

    // The evidence row no longer duplicates the association...
    for (const row of assertionWrites()) expect(row.account_id).toBeNull();
    // ...the canonical patch does not touch the employer column...
    expect(canonicalPatch('unified_persons')).not.toHaveProperty('account_id');
    // ...and the association itself still stands.
    expect(db.tables.unified_persons[0].account_id).toBe(ACC);
  });
});
