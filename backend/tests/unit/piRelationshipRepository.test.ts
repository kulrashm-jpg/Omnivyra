/**
 * PI FOUNDATION — the relationship writer's TypeScript-layer contract.
 *
 * The real-schema suite already proves what the DATABASE refuses. This file
 * covers the decisions that live above it and which no constraint can express:
 *
 *   - that `createRelationship` never sends `is_primary`, so ingestion order can
 *     never decide who gets pursued — the one property that keeps targeting a
 *     deliberate act rather than a side effect of arrival sequence;
 *   - that a lost race (23505) is a REPLAY returning the winning row, not an
 *     error, because two enrichment passes observing the same employment is
 *     normal and must not surface as a failure;
 *   - that every state change goes through an RPC and NOTHING here ever writes
 *     `is_primary` or `unified_persons.account_id` directly. That is the "no
 *     second writer" guarantee, and it is a property of this module's call
 *     shape, so only a call-recording double can establish it.
 *
 * The double records every call rather than just answering them, because the
 * assertions above are about what was SENT, not what came back.
 */

type Row = Record<string, unknown>;

const db = {
  rows: [] as Row[],
  /** Every builder call, so the test can assert on the payload that was sent. */
  inserts: [] as Row[],
  reads: [] as Array<{ table: string; filters: Array<[string, unknown]> }>,
  /** Any attempt to UPDATE through the table API at all — must stay empty. */
  updates: [] as Array<{ table: string; payload: Row }>,
  rpcs: [] as Array<{ fn: string; args: Row }>,
  insertError: null as { code?: string; message: string } | null,
  readError: null as { message: string } | null,
  rpcError: null as { message: string } | null,
  nextId: 1,
};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const st = { op: 'select', filters: [] as Array<[string, unknown]>, payload: null as Row | null };
    const exec = async (mode: 'many' | 'single') => {
      await Promise.resolve();
      if (st.op === 'insert') {
        db.inserts.push(st.payload as Row);
        if (db.insertError) return { data: null, error: db.insertError };
        const created = { id: `rel-${db.nextId++}`, is_primary: false, ...(st.payload as Row) };
        db.rows.push(created);
        return { data: created, error: null };
      }
      if (st.op === 'update') {
        db.updates.push({ table, payload: st.payload as Row });
        return { data: null, error: null };
      }
      db.reads.push({ table, filters: st.filters });
      if (db.readError) return { data: null, error: db.readError };
      const found = db.rows.filter((r) => st.filters.every(([c, v]) => r[c] === v));
      return mode === 'many' ? { data: found, error: null } : { data: found[0] ?? null, error: null };
    };
    const b: Record<string, unknown> = {
      select: () => b,
      insert: (p: Row) => { st.op = 'insert'; st.payload = p; return b; },
      update: (p: Row) => { st.op = 'update'; st.payload = p; return b; },
      eq: (c: string, v: unknown) => { st.filters.push([c, v]); return b; },
      is: (c: string, v: unknown) => { st.filters.push([c, v]); return b; },
      order: () => b,
      limit: () => exec('many'),
      single: () => exec('single'),
      maybeSingle: () => exec('single'),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => exec('many').then(res, rej),
    };
    return b;
  },
}));

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: () => { throw new Error('relationshipRepository must not use the table API for mutations'); },
    rpc: async (fn: string, args: Row) => {
      db.rpcs.push({ fn, args });
      if (db.rpcError) return { data: null, error: db.rpcError };
      return { data: 'rel-rpc-1', error: null };
    },
  },
}));

const warnings: Array<{ event: string; ctx: unknown }> = [];
jest.mock('../../services/logger', () => ({
  logger: {
    warn: (event: string, ctx: unknown) => { warnings.push({ event, ctx }); },
    info: () => {}, error: () => {}, debug: () => {},
  },
}));

import {
  RELATIONSHIP_TYPES, isRelationshipType,
  listRelationshipsForPerson, listCurrentRelationships, getPrimaryRelationship,
  createRelationship, setPrimaryRelationship, clearPrimaryRelationship, endRelationship,
} from '../../services/prospectIdentity/relationshipRepository';

const ORG_A = '00000000-0000-4000-8000-00000000000a';
const ORG_B = '00000000-0000-4000-8000-00000000000b';
const PERSON = 'person-1';
const ACC_1 = 'account-1';
const ACC_2 = 'account-2';

const seed = (over: Row = {}): Row => {
  const r = {
    id: `seed-${db.nextId++}`,
    organization_id: ORG_A, person_id: PERSON, account_id: ACC_1,
    relationship_type: 'employee', is_primary: false,
    started_at: null, ended_at: null,
    job_title: null, department: null, seniority: null, buying_role: null,
    ...over,
  };
  db.rows.push(r);
  return r;
};

beforeEach(() => {
  db.rows = []; db.inserts = []; db.reads = []; db.updates = []; db.rpcs = [];
  db.insertError = null; db.readError = null; db.rpcError = null; db.nextId = 1;
  warnings.length = 0;
});

// ═══════════════════════════════════════════════════════════════════════════
describe('the vocabulary is closed', () => {
  it('exposes exactly the six ratified values', () => {
    expect([...RELATIONSHIP_TYPES]).toEqual([
      'employee', 'advisor', 'contractor', 'founder', 'former_employee', 'unknown',
    ]);
  });

  it('rejects anything outside it, including near-misses', () => {
    for (const v of ['board_member', 'investor', 'vendor', 'Employee', '', ' employee', null, 7]) {
      expect(isRelationshipType(v)).toBe(false);
    }
  });
});

describe('createRelationship — primary is never an ingestion side effect', () => {
  it('omits is_primary from the payload ENTIRELY, not merely setting it false', async () => {
    await createRelationship({ organizationId: ORG_A, personId: PERSON, accountId: ACC_1 });
    expect(db.inserts).toHaveLength(1);
    // `false` would be almost as good, but absence is what makes it impossible
    // for a future caller to pass one through by widening the input type.
    expect(Object.keys(db.inserts[0])).not.toContain('is_primary');
  });

  it('never touches the unified_persons pointer', async () => {
    await createRelationship({ organizationId: ORG_A, personId: PERSON, accountId: ACC_1 });
    expect(db.reads.map((r) => r.table)).not.toContain('unified_persons');
    expect(db.updates).toEqual([]);
  });

  it('defaults to employee and a NULL start date — dates are never invented', async () => {
    await createRelationship({ organizationId: ORG_A, personId: PERSON, accountId: ACC_1 });
    expect(db.inserts[0].relationship_type).toBe('employee');
    expect(db.inserts[0].started_at).toBeNull();
  });

  it('carries an explicit type and start date through unchanged', async () => {
    await createRelationship({
      organizationId: ORG_A, personId: PERSON, accountId: ACC_1,
      relationshipType: 'advisor', startedAt: '2024-03-01T00:00:00.000Z',
    });
    expect(db.inserts[0].relationship_type).toBe('advisor');
    expect(db.inserts[0].started_at).toBe('2024-03-01T00:00:00.000Z');
  });

  it('refuses an unknown type BEFORE touching the database', async () => {
    await expect(createRelationship({
      organizationId: ORG_A, personId: PERSON, accountId: ACC_1,
      relationshipType: 'board_member' as never,
    })).rejects.toThrow(/not a relationship type/);
    expect(db.inserts).toEqual([]);
  });

  it('refuses a missing tenant, person or account before any write', async () => {
    const bad = [
      { organizationId: '', personId: PERSON, accountId: ACC_1 },
      { organizationId: '   ', personId: PERSON, accountId: ACC_1 },
      { organizationId: ORG_A, personId: '', accountId: ACC_1 },
      { organizationId: ORG_A, personId: PERSON, accountId: '' },
    ];
    for (const input of bad) {
      await expect(createRelationship(input)).rejects.toThrow();
    }
    expect(db.inserts).toEqual([]);
  });

  it('stamps the tenant it was given, never one derived from the person', async () => {
    await createRelationship({ organizationId: ORG_B, personId: PERSON, accountId: ACC_1 });
    expect(db.inserts[0].organization_id).toBe(ORG_B);
  });
});

describe('createRelationship — a lost race is a replay, not a failure', () => {
  it('on 23505 returns the WINNING row, created:false, already_current', async () => {
    const winner = seed({ account_id: ACC_1 });
    db.insertError = { code: '23505', message: 'duplicate key value violates unique constraint "uq_par_live"' };

    const res = await createRelationship({ organizationId: ORG_A, personId: PERSON, accountId: ACC_1 });
    expect(res.created).toBe(false);
    if (res.created === false && res.reason === 'already_current') {
      expect(res.relationship.id).toBe(String(winner.id));
      expect(res.relationship.accountId).toBe(ACC_1);
    } else {
      throw new Error(`expected already_current, got ${JSON.stringify(res)}`);
    }
  });

  it('re-resolves onto the right ACCOUNT when the person has several', async () => {
    seed({ account_id: ACC_1 });
    const wanted = seed({ account_id: ACC_2 });
    db.insertError = { code: '23505', message: 'duplicate key' };
    const res = await createRelationship({ organizationId: ORG_A, personId: PERSON, accountId: ACC_2 });
    expect(res.created).toBe(false);
    if (res.created === false && res.reason === 'already_current') {
      expect(res.relationship.id).toBe(String(wanted.id));
    } else {
      throw new Error('expected already_current');
    }
  });

  it('a 23505 whose winner is HISTORICAL is reported rejected, not already_current', async () => {
    // uq_par_live only covers current rows, so this cannot normally happen —
    // but if it did, claiming an ended employment as "already current" would be
    // a false success, and a false success is worse than a reported rejection.
    seed({ account_id: ACC_1, ended_at: '2020-01-01T00:00:00.000Z' });
    db.insertError = { code: '23505', message: 'duplicate key' };
    const res = await createRelationship({ organizationId: ORG_A, personId: PERSON, accountId: ACC_1 });
    expect(res).toMatchObject({ created: false, reason: 'rejected' });
  });

  it('a non-unique error is reported as rejected and logged with its SQLSTATE', async () => {
    db.insertError = { code: '23503', message: 'insert or update violates foreign key "par_account_tenant_fk"' };
    const res = await createRelationship({ organizationId: ORG_A, personId: PERSON, accountId: ACC_1 });
    expect(res).toMatchObject({ created: false, reason: 'rejected' });
    if (res.created === false && res.reason === 'rejected') {
      expect(res.detail).toMatch(/par_account_tenant_fk/);
    }
    expect(warnings).toHaveLength(1);
    expect(warnings[0].event).toBe('relationship_create_rejected');
    expect(warnings[0].ctx).toMatchObject({ code: '23503' });
  });

  it('a rejection never reports created:true, whatever the SQLSTATE', async () => {
    for (const code of ['23514', '23503', '42501', undefined]) {
      db.insertError = { code, message: 'nope' };
      const res = await createRelationship({ organizationId: ORG_A, personId: PERSON, accountId: ACC_1 });
      expect(res.created).toBe(false);
    }
  });
});

describe('reads are tenant-scoped and currency-aware', () => {
  it('every read filters on organization_id AND person_id', async () => {
    await listRelationshipsForPerson(ORG_A, PERSON);
    expect(db.reads).toHaveLength(1);
    const cols = db.reads[0].filters.map(([c]) => c);
    expect(cols).toContain('organization_id');
    expect(cols).toContain('person_id');
    expect(db.reads[0].filters).toContainEqual(['organization_id', ORG_A]);
  });

  it('another tenant asking about the same person gets nothing', async () => {
    seed({ organization_id: ORG_A });
    expect(await listRelationshipsForPerson(ORG_A, PERSON)).toHaveLength(1);
    expect(await listRelationshipsForPerson(ORG_B, PERSON)).toHaveLength(0);
  });

  it('listCurrent drops ended rows; the full list keeps them', async () => {
    seed({ account_id: ACC_1 });
    seed({ account_id: ACC_2, ended_at: '2021-01-01T00:00:00.000Z' });
    expect(await listCurrentRelationships(ORG_A, PERSON)).toHaveLength(1);
    expect(await listRelationshipsForPerson(ORG_A, PERSON)).toHaveLength(2);
  });

  it('current rows sort ahead of historical ones', async () => {
    seed({ account_id: ACC_2, ended_at: '2021-01-01T00:00:00.000Z' });
    seed({ account_id: ACC_1 });
    const all = await listRelationshipsForPerson(ORG_A, PERSON);
    expect(all[0].endedAt).toBeNull();
    expect(all[1].endedAt).not.toBeNull();
  });

  it('getPrimaryRelationship ignores a HISTORICAL primary', async () => {
    // par_primary_is_current makes this unreachable in the database; the read
    // must not depend on that for its answer to be right.
    seed({ account_id: ACC_1, is_primary: true, ended_at: '2020-01-01T00:00:00.000Z' });
    expect(await getPrimaryRelationship(ORG_A, PERSON)).toBeNull();
  });

  it('getPrimaryRelationship returns the current primary, and null when there is none', async () => {
    seed({ account_id: ACC_1 });
    expect(await getPrimaryRelationship(ORG_A, PERSON)).toBeNull();
    seed({ account_id: ACC_2, is_primary: true });
    const p = await getPrimaryRelationship(ORG_A, PERSON);
    expect(p?.accountId).toBe(ACC_2);
  });

  it('a read failure THROWS rather than reporting "no relationships"', async () => {
    db.readError = { message: 'connection reset' };
    // Returning [] here would make an outage indistinguishable from a person
    // who genuinely has no employer, and the caller would act on it.
    await expect(listRelationshipsForPerson(ORG_A, PERSON)).rejects.toThrow(/relationship read failed/);
  });

  it('a blank tenant is refused on every read path', async () => {
    await expect(listRelationshipsForPerson('', PERSON)).rejects.toThrow(/organizationId is required/);
    await expect(listCurrentRelationships('', PERSON)).rejects.toThrow(/organizationId is required/);
    await expect(getPrimaryRelationship('', PERSON)).rejects.toThrow(/organizationId is required/);
    expect(db.reads).toEqual([]);
  });
});

describe('state changes go through the atomic functions — and only those', () => {
  it('setPrimary calls pi_relationship_set_primary with the tenant-prefixed args', async () => {
    const res = await setPrimaryRelationship({ organizationId: ORG_A, personId: PERSON, accountId: ACC_1 });
    expect(res).toEqual({ ok: true, relationshipId: 'rel-rpc-1' });
    expect(db.rpcs).toEqual([{
      fn: 'pi_relationship_set_primary',
      args: { p_organization_id: ORG_A, p_person_id: PERSON, p_account_id: ACC_1 },
    }]);
  });

  it('clearPrimary calls pi_relationship_clear_primary and names no account', async () => {
    await clearPrimaryRelationship({ organizationId: ORG_A, personId: PERSON });
    expect(db.rpcs[0].fn).toBe('pi_relationship_clear_primary');
    expect(Object.keys(db.rpcs[0].args)).toEqual(['p_organization_id', 'p_person_id']);
  });

  it('endRelationship calls pi_relationship_end and supplies an end instant', async () => {
    await endRelationship({
      organizationId: ORG_A, personId: PERSON, accountId: ACC_1, endedAt: '2024-01-01T00:00:00.000Z',
    });
    expect(db.rpcs[0].fn).toBe('pi_relationship_end');
    expect(db.rpcs[0].args.p_ended_at).toBe('2024-01-01T00:00:00.000Z');
  });

  it('endRelationship defaults to NOW, as a real ISO instant', async () => {
    await endRelationship({ organizationId: ORG_A, personId: PERSON, accountId: ACC_1 });
    const sent = String(db.rpcs[0].args.p_ended_at);
    expect(sent).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Math.abs(Date.now() - Date.parse(sent))).toBeLessThan(60_000);
  });

  it('NO mutation ever reaches is_primary or account_id through the table API', async () => {
    await setPrimaryRelationship({ organizationId: ORG_A, personId: PERSON, accountId: ACC_1 });
    await clearPrimaryRelationship({ organizationId: ORG_A, personId: PERSON });
    await endRelationship({ organizationId: ORG_A, personId: PERSON, accountId: ACC_1 });
    // This is the whole "one writer" claim: if any of these ever grew a direct
    // UPDATE, the pointer and the primary flag could commit separately.
    expect(db.updates).toEqual([]);
    expect(db.rpcs.map((r) => r.fn)).toEqual([
      'pi_relationship_set_primary', 'pi_relationship_clear_primary', 'pi_relationship_end',
    ]);
  });

  it('an RPC failure is reported as ok:false, never thrown away', async () => {
    db.rpcError = { message: 'relationship is not current' };
    expect(await setPrimaryRelationship({ organizationId: ORG_A, personId: PERSON, accountId: ACC_1 }))
      .toEqual({ ok: false, detail: 'relationship is not current' });
    expect(await clearPrimaryRelationship({ organizationId: ORG_A, personId: PERSON }))
      .toEqual({ ok: false, detail: 'relationship is not current' });
    expect(await endRelationship({ organizationId: ORG_A, personId: PERSON, accountId: ACC_1 }))
      .toEqual({ ok: false, detail: 'relationship is not current' });
  });

  it('a blank tenant is refused on every mutation path, with no RPC sent', async () => {
    await expect(setPrimaryRelationship({ organizationId: '', personId: PERSON, accountId: ACC_1 })).rejects.toThrow();
    await expect(clearPrimaryRelationship({ organizationId: '', personId: PERSON })).rejects.toThrow();
    await expect(endRelationship({ organizationId: '', personId: PERSON, accountId: ACC_1 })).rejects.toThrow();
    expect(db.rpcs).toEqual([]);
  });

  it('exposes no delete at all — ending is the only way to close a relationship', () => {
    const mod = require('../../services/prospectIdentity/relationshipRepository');
    expect(Object.keys(mod).filter((k) => /delete|remove|destroy|purge/i.test(k))).toEqual([]);
  });
});

describe('row mapping', () => {
  it('maps the structural columns and normalizes blank text to null', async () => {
    seed({
      account_id: ACC_1, is_primary: true, relationship_type: 'founder',
      started_at: '2020-01-01T00:00:00.000Z', ended_at: '   ',
    });
    const [r] = await listRelationshipsForPerson(ORG_A, PERSON);
    expect(r).toMatchObject({
      organizationId: ORG_A, personId: PERSON, accountId: ACC_1,
      relationshipType: 'founder', isPrimary: true,
      startedAt: '2020-01-01T00:00:00.000Z', endedAt: null,
    });
  });

  it('exposes NO relationship-scoped attribute — deciding those is a later gate', async () => {
    // The columns exist in the table and the backfill fills them; projecting
    // them through a database-capable module would make this the first such
    // module outside the b1b boundary to name an LI-1 attribute, which
    // `prospectIdentityIngestionBoundary` exists to prevent.
    seed({ account_id: ACC_1, job_title: 'VP Sales', department: 'Sales', seniority: 'vp' });
    const [r] = await listRelationshipsForPerson(ORG_A, PERSON);
    for (const k of ['jobTitle', 'department', 'seniority', 'buyingRole']) {
      expect(r).not.toHaveProperty(k);
    }
  });

  it('a missing or unrecognized type reads as unknown rather than crashing', async () => {
    seed({ account_id: ACC_1, relationship_type: null });
    const [r] = await listRelationshipsForPerson(ORG_A, PERSON);
    expect(r.relationshipType).toBe('unknown');
  });

  it('is_primary is strictly boolean — a truthy string is not primary', async () => {
    seed({ account_id: ACC_1, is_primary: 'true' });
    const [r] = await listRelationshipsForPerson(ORG_A, PERSON);
    expect(r.isPrimary).toBe(false);
  });
});
