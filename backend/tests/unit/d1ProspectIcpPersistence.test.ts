/**
 * D1 — the ICP writer: contract 15 (versioning, one active version) and
 * contract 16 (ratification, immutability).
 *
 * The database is doubled, so what is proven here is the WRITER'S BEHAVIOUR:
 * which statements it issues, in what order, with which filters, and — the
 * decisive one — how it reacts to the SQLSTATEs the real schema raises. The
 * schema's own guarantees are proven in
 * `backend/tests/realschema/d1_tenant_icp.test.ts` against live PostgreSQL.
 *
 * The double is scripted rather than smart: each test queues the responses the
 * database would give, in order, and then asserts on the recorded calls. A
 * clever fake that re-implemented the partial unique index would prove only
 * that the fake works.
 */

interface Call {
  table: string;
  kind: 'insert' | 'update' | 'select';
  row?: Record<string, unknown>;
  filters: Record<string, unknown>;
  order?: [string, unknown];
}

interface Response { data?: unknown; error?: unknown }

const calls: Call[] = [];
let queue: Response[] = [];

const nextResponse = (): Response => (queue.length ? queue.shift()! : { data: [], error: null });

function makeBuilder(table: string) {
  const call: Call = { table, kind: 'select', filters: {} };
  let kindSet = false;
  const settle = () => { calls.push(call); return Promise.resolve(nextResponse()); };

  const b: Record<string, unknown> = {
    insert(row: Record<string, unknown>) { call.kind = 'insert'; call.row = row; kindSet = true; return b; },
    update(row: Record<string, unknown>) { call.kind = 'update'; call.row = row; kindSet = true; return b; },
    select() { if (!kindSet) { call.kind = 'select'; kindSet = true; } return b; },
    eq(k: string, v: unknown) { call.filters[k] = v; return b; },
    is(k: string, v: unknown) { call.filters[k] = v; return b; },
    order(k: string, o: unknown) { call.order = [k, o]; return b; },
    single: () => settle(),
    limit: () => settle(),
    // Makes the builder itself awaitable, for `await ...update().eq().select()`.
    then: (res: unknown, rej: unknown) =>
      settle().then(res as never, rej as never),
  };
  return b;
}

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => makeBuilder(table),
}));

import {
  createIcpVersion, ensureIcp, getRatifiedIcp, IcpContractError,
  nextVersionNumber, ratifyIcpVersion,
} from '../../services/prospectIcp';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000bb';
const ICP_ID = '00000000-0000-4000-8000-0000000000c1';
const AT = '2026-09-01T00:00:00.000Z';

const CRITERIA = [{
  id: 'ind', kind: 'required', subject: 'account', attribute: 'industry',
  predicate: { op: 'one_of', values: ['Software'] },
}];

const versionRow = (over: Record<string, unknown> = {}) => ({
  id: 'ver-1', organization_id: ORG_A, icp_id: ICP_ID, version: 1, status: 'proposed',
  criteria: CRITERIA, proposal: {}, proposed_by_model: null,
  ratified_at: null, ratified_by: null, superseded_at: null, superseded_by_version: null,
  created_at: AT, ...over,
});

const errorOf = async (fn: () => Promise<unknown>): Promise<string> => {
  try { await fn(); } catch (e) { return e instanceof IcpContractError ? e.code : `unexpected:${String(e)}`; }
  return 'no_error';
};

beforeEach(() => { calls.length = 0; queue = []; });

// ───────────────────────────────────────────────────────────────────────────
describe('D1 — never ON CONFLICT (the 42P10 trap)', () => {
  it('the writer contains no upsert, no onConflict and no ON CONFLICT — by source inspection', () => {
    // A behavioural test cannot prove the ABSENCE of a call the code never
    // makes, so this reads the module. `uq_prospect_icp_versions_one_ratified`
    // is PARTIAL; PostgREST cannot infer it and answers 42P10 — the failure
    // W0.1, W0.2 and W3 each hit.
    const source = readFileSync(
      join(__dirname, '..', '..', 'services', 'prospectIcp', 'persistence.ts'), 'utf8',
    );
    const statements = source.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
      .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n');
    expect(statements).not.toMatch(/\.upsert\s*\(/);
    expect(statements).not.toMatch(/onConflict/i);
    expect(statements).not.toMatch(/ON CONFLICT/i);
    // ...and it does say what it does instead.
    expect(source).toMatch(/catch `23505`/);
  });
});

describe('D1 contract 15 — the ICP object', () => {
  it('creates an ICP by INSERT, keyed on the verified tenant', async () => {
    queue = [{ data: { id: ICP_ID }, error: null }];
    const out = await ensureIcp(ORG_A, 'default', 'Primary profile');

    expect(out).toEqual({ icpId: ICP_ID, outcome: 'created' });
    expect(calls[0].kind).toBe('insert');
    expect(calls[0].table).toBe('prospect_icps');
    expect(calls[0].row).toMatchObject({ organization_id: ORG_A, icp_key: 'default', name: 'Primary profile' });
  });

  it('a duplicate key is a 23505 that RE-RESOLVES — not a SELECT-then-INSERT race', async () => {
    queue = [
      { data: null, error: { code: '23505', message: 'duplicate key' } },   // the INSERT
      { data: [{ id: ICP_ID }], error: null },                              // the re-resolve
    ];
    const out = await ensureIcp(ORG_A, 'default');

    expect(out).toEqual({ icpId: ICP_ID, outcome: 'already_present' });
    // The INSERT came FIRST. A read-then-write would have reversed this, and two
    // concurrent callers would both have seen nothing and both inserted.
    expect(calls.map((c) => c.kind)).toEqual(['insert', 'select']);
    expect(calls[1].filters).toEqual({ organization_id: ORG_A, icp_key: 'default' });
  });

  it('lower-cases the key, so `Default` and `default` cannot become two profiles', async () => {
    queue = [{ data: { id: ICP_ID }, error: null }];
    await ensureIcp(ORG_A, '  DEFAULT  ');
    expect(calls[0].row).toMatchObject({ icp_key: 'default' });
  });

  it('refuses a malformed key and a non-uuid tenant before touching the database', async () => {
    expect(await errorOf(() => ensureIcp(ORG_A, 'Not A Slug'))).toBe('icp_key_invalid');
    expect(await errorOf(() => ensureIcp('not-a-uuid', 'default'))).toBe('tenant_required');
    expect(await errorOf(() => ensureIcp('', 'default'))).toBe('tenant_required');
    expect(calls).toHaveLength(0);
  });

  it('every read filters on organization_id FIRST — cross-tenant reads return nothing', async () => {
    queue = [{ data: [], error: null }];
    const found = await getRatifiedIcp(ORG_B, 'default');
    expect(found).toBeNull();
    expect(calls[0].filters.organization_id).toBe(ORG_B);
  });
});

describe('D1 contract 15 — versioning', () => {
  it('takes the next version number from the current maximum', async () => {
    queue = [{ data: [{ version: 4 }], error: null }];
    expect(await nextVersionNumber(ORG_A, ICP_ID)).toBe(5);
    expect(calls[0].order).toEqual(['version', { ascending: false }]);

    calls.length = 0;
    queue = [{ data: [], error: null }];
    expect(await nextVersionNumber(ORG_A, ICP_ID)).toBe(1);   // the first version is 1
  });

  it('creates a version by INSERT and reports a taken number as a 23505 collision', async () => {
    queue = [
      { data: null, error: { code: '23505', message: 'duplicate key' } },
      { data: [versionRow({ version: 2 })], error: null },
    ];
    const out = await createIcpVersion({
      organizationId: ORG_A, icpId: ICP_ID, criteria: CRITERIA, version: 2, status: 'proposed',
    });
    expect(out).toMatchObject({ version: 2, outcome: 'already_present' });
    expect(calls[0].kind).toBe('insert');
  });

  it('translates a composite-FK violation into a stated cross-tenant refusal', async () => {
    // `(icp_id, organization_id) -> prospect_icps(id, organization_id)`. Naming
    // another tenant's ICP is 23503, and "violates foreign key constraint" does
    // not tell a caller that is what they did.
    queue = [{ data: null, error: { code: '23503', message: 'violates foreign key constraint' } }];
    expect(await errorOf(() => createIcpVersion({
      organizationId: ORG_B, icpId: ICP_ID, criteria: CRITERIA, version: 1,
    }))).toBe('cross_tenant_reference');
  });

  it('enforces contract 17 BEFORE the write — an invalid criterion never reaches storage', async () => {
    expect(await errorOf(() => createIcpVersion({
      organizationId: ORG_A, icpId: ICP_ID, version: 1,
      criteria: [{
        id: 'sen', kind: 'required', subject: 'person', attribute: 'seniority',
        predicate: { op: 'one_of', values: ['cxo'] },
      }],
    }))).toBe('value_outside_vocabulary');
    expect(calls).toHaveLength(0);
  });
});

describe('D1 contract 16 — draft vs proposal vs ratified', () => {
  it.each(['draft', 'proposed'] as const)('a version may be created as %s', async (status) => {
    queue = [{ data: { id: 'ver-1' }, error: null }];
    const out = await createIcpVersion({
      organizationId: ORG_A, icpId: ICP_ID, criteria: CRITERIA, version: 1, status,
    });
    expect(out.outcome).toBe('created');
    expect(calls[0].row).toMatchObject({ status });
    // A created version NEVER carries a ratifier — the row does not even
    // mention one, so there is nothing for a caller to set.
    expect(Object.keys(calls[0].row!)).not.toContain('ratified_by');
    expect(Object.keys(calls[0].row!)).not.toContain('ratified_at');
  });

  it.each(['ratified', 'superseded'] as const)('a version can NEVER be created %s', async (status) => {
    expect(await errorOf(() => createIcpVersion({
      organizationId: ORG_A, icpId: ICP_ID, criteria: CRITERIA, status: status as never,
    }))).toBe('status_not_creatable');
    expect(calls).toHaveLength(0);
  });

  it('a proposing MODEL is recorded, and recording it ratifies nothing', async () => {
    queue = [{ data: { id: 'ver-1' }, error: null }];
    await createIcpVersion({
      organizationId: ORG_A, icpId: ICP_ID, criteria: CRITERIA, version: 1,
      status: 'proposed', proposedByModel: 'some-model-v1',
    });
    expect(calls[0].row).toMatchObject({ proposed_by_model: 'some-model-v1', status: 'proposed' });
  });

  it('a DRAFT is not an input to scoring — getRatifiedIcp reads only status=ratified', async () => {
    queue = [
      { data: [{ id: ICP_ID }], error: null },     // resolve the ICP
      { data: [], error: null },                   // ...no RATIFIED version
    ];
    expect(await getRatifiedIcp(ORG_A, 'default')).toBeNull();
    expect(calls[1].filters.status).toBe('ratified');
  });

  it('getRatifiedIcp returns the ratified version with its (icp_id, version) coordinates', async () => {
    queue = [
      { data: [{ id: ICP_ID }], error: null },
      {
        data: [versionRow({ version: 7, status: 'ratified', ratified_at: AT, ratified_by: 'user-9' })],
        error: null,
      },
    ];
    const icp = await getRatifiedIcp(ORG_A, 'default');
    expect(icp).toMatchObject({
      organizationId: ORG_A, icpId: ICP_ID, icpKey: 'default', version: 7, ratifiedBy: 'user-9',
    });
    expect(icp!.criteria.map((c) => c.id)).toEqual(['ind']);
  });
});

describe('D1 contract 16 — ratification is a human act', () => {
  it('refuses to ratify without a ratifier — an AI model has no user id', async () => {
    for (const missing of ['', '   ', undefined as unknown as string, null as unknown as string]) {
      calls.length = 0;
      expect(await errorOf(() => ratifyIcpVersion({
        organizationId: ORG_A, icpId: ICP_ID, version: 1,
        ratifiedByUserId: missing, ratifiedAt: AT,
      }))).toBe('ratifier_required');
      // The refusal happens before ANY database access, so a ratification with
      // no ratifier is never even attempted.
      expect(calls).toHaveLength(0);
    }
  });

  it('supersedes the incumbent, then promotes — and reports which version it retired', async () => {
    queue = [
      { data: [versionRow({ version: 2, status: 'proposed' })], error: null },        // read target
      {
        data: [versionRow({ id: 'ver-old', version: 1, status: 'ratified', ratified_at: AT, ratified_by: 'u0' })],
        error: null,
      },                                                                              // read incumbent
      { data: [], error: null },                                                      // supersede
      { data: [{ id: 'ver-2' }], error: null },                                       // promote
    ];

    const out = await ratifyIcpVersion({
      organizationId: ORG_A, icpId: ICP_ID, version: 2, ratifiedByUserId: 'user-9', ratifiedAt: AT,
    });
    expect(out).toEqual({ versionId: 'ver-2', version: 2, supersededVersion: 1 });

    const updates = calls.filter((c) => c.kind === 'update');
    expect(updates).toHaveLength(2);

    // The incumbent is retired FIRST. The partial unique index permits one
    // ratified row, so the reverse order could only ever raise 23505.
    expect(updates[0].row).toMatchObject({ status: 'superseded', superseded_by_version: 2 });
    expect(updates[0].filters).toMatchObject({ organization_id: ORG_A, version: 1, status: 'ratified' });
    // The incumbent's CONTENT is untouched — the trigger permits only this.
    expect(Object.keys(updates[0].row!).sort()).toEqual(
      ['status', 'superseded_at', 'superseded_by_version', 'updated_at'],
    );

    expect(updates[1].row).toMatchObject({ status: 'ratified', ratified_by: 'user-9', ratified_at: AT });
    // Compare-and-set on the status we read, so a concurrent writer that moved
    // the row updates zero rows rather than being silently overwritten.
    expect(updates[1].filters).toMatchObject({ status: 'proposed', version: 2, organization_id: ORG_A });
  });

  it('ratifying the first version supersedes nothing', async () => {
    queue = [
      { data: [versionRow({ version: 1, status: 'proposed' })], error: null },
      { data: [], error: null },                       // no incumbent
      { data: [{ id: 'ver-1' }], error: null },
    ];
    const out = await ratifyIcpVersion({
      organizationId: ORG_A, icpId: ICP_ID, version: 1, ratifiedByUserId: 'user-9', ratifiedAt: AT,
    });
    expect(out.supersededVersion).toBeNull();
    expect(calls.filter((c) => c.kind === 'update')).toHaveLength(1);
  });

  it('a duplicate ACTIVE version is a 23505, surfaced — never retried, never ON CONFLICT', async () => {
    queue = [
      { data: [versionRow({ version: 2, status: 'proposed' })], error: null },
      { data: [], error: null },
      { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } },
    ];
    expect(await errorOf(() => ratifyIcpVersion({
      organizationId: ORG_A, icpId: ICP_ID, version: 2, ratifiedByUserId: 'user-9', ratifiedAt: AT,
    }))).toBe('concurrent_ratification');

    // Retrying would ratify a version the second person did not choose.
    expect(calls.filter((c) => c.kind === 'update')).toHaveLength(1);
  });

  it('a promotion that updates ZERO rows is reported as a race, not as success', async () => {
    queue = [
      { data: [versionRow({ version: 2, status: 'proposed' })], error: null },
      { data: [], error: null },
      { data: [], error: null },                       // compare-and-set matched nothing
    ];
    expect(await errorOf(() => ratifyIcpVersion({
      organizationId: ORG_A, icpId: ICP_ID, version: 2, ratifiedByUserId: 'user-9', ratifiedAt: AT,
    }))).toBe('ratification_raced');
  });

  it('a RATIFIED version is immutable — re-ratifying it is refused', async () => {
    queue = [{
      data: [versionRow({ version: 1, status: 'ratified', ratified_at: AT, ratified_by: 'u0' })],
      error: null,
    }];
    expect(await errorOf(() => ratifyIcpVersion({
      organizationId: ORG_A, icpId: ICP_ID, version: 1, ratifiedByUserId: 'user-9', ratifiedAt: AT,
    }))).toBe('already_ratified');
    expect(calls.filter((c) => c.kind === 'update')).toHaveLength(0);
  });

  it('a SUPERSEDED version is immutable — it can never be re-ratified', async () => {
    queue = [{
      data: [versionRow({
        version: 1, status: 'superseded', ratified_at: AT, ratified_by: 'u0',
        superseded_at: AT, superseded_by_version: 2,
      })],
      error: null,
    }];
    // The correct move is a NEW version, never resurrecting an old one: a
    // superseded row is a historical fact that an explanation may still cite.
    expect(await errorOf(() => ratifyIcpVersion({
      organizationId: ORG_A, icpId: ICP_ID, version: 1, ratifiedByUserId: 'user-9', ratifiedAt: AT,
    }))).toBe('version_superseded');
    expect(calls.filter((c) => c.kind === 'update')).toHaveLength(0);
  });

  it('a version in ANOTHER tenant is simply not found — cross-tenant ratification refused', async () => {
    queue = [{ data: [], error: null }];             // ORG_B sees nothing of ORG_A's ICP
    expect(await errorOf(() => ratifyIcpVersion({
      organizationId: ORG_B, icpId: ICP_ID, version: 1, ratifiedByUserId: 'user-9', ratifiedAt: AT,
    }))).toBe('version_not_found');
    expect(calls[0].filters.organization_id).toBe(ORG_B);
    expect(calls.filter((c) => c.kind === 'update')).toHaveLength(0);
  });

  it('there is no unratify: the writer exposes no path back from ratified', () => {
    const source = readFileSync(
      join(__dirname, '..', '..', 'services', 'prospectIcp', 'persistence.ts'), 'utf8',
    );
    expect(source).not.toMatch(/export (async )?function unratify/);
    expect(source).not.toMatch(/status: 'draft'/);     // nothing is ever moved BACK to draft
    // The only status a ratified row is ever written to is 'superseded'.
    const written = [...source.matchAll(/status: '(\w+)'/g)].map((m) => m[1]);
    expect([...new Set(written)].sort()).toEqual(['ratified', 'superseded']);
  });
});
