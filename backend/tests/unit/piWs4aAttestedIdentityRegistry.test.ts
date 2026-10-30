/**
 * PI WS-4A — ATTESTED ENGAGEMENT IDENTITY: the registry, exercised.
 *
 * The capability is a seam from a tenant-verified administrator into a relation
 * whose migration (`20270106000000`) is AUTHORED AND UNAPPLIED. There is no
 * PostgreSQL, no Docker daemon and no embedded-Postgres harness in this
 * checkout, so NOTHING HERE IS DATABASE-VERIFIED. What this file does instead
 * is MODEL the storage invariants exactly as the migration declares them, so
 * that
 *   (a) they are pinned somewhere rather than nowhere, and
 *   (b) the repository is shown to map each of them onto the refusal
 *       vocabulary the contract publishes, against the same model.
 *
 * The final describe block reads the migration TEXT, which is the only
 * assertion in this file that touches the real artefact: the single foreign
 * key, the partial un-folded active key, the seven named CHECKs, the absence of
 * `lower(` on the identity column, and the absence of any CHECK naming an actor
 * column — the falsifiable half of the DEFECT-008 guard.
 *
 * ─── WHAT IS DELIBERATELY NOT RE-LITIGATED ────────────────────────────────
 * The meaning of an attestation, the normalisation rules and the refusal
 * vocabulary are the published contract's, and are imported rather than
 * restated. This suite asserts that the repository OBEYS them; it never keeps a
 * second copy of them.
 *
 * The double RECORDS every call, because most of what matters here is a
 * property of what was SENT rather than of what came back: which columns a
 * write carried, which predicates a read asserted and in what order, how many
 * reads a lookup cost, and whether a replay ever read before it wrote.
 */

type Row = Record<string, unknown>;

/** A PostgreSQL error, as the pg/PostgREST layer surfaces one. */
class PgError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

type Filter = { kind: 'eq' | 'is' | 'in'; col: string; value: unknown };

/** The database's own clock, as `attested_at DEFAULT now()` would set it. */
const ATTESTED_AT = '2020-01-01T00:00:00.000Z';

const db = {
  tables: {} as Record<string, Row[]>,
  /** Every operation, in order — so "it never read before it wrote" is checkable. */
  ops: [] as string[],
  selects: [] as Array<{
    table: string; cols: string; filters: Filter[];
    orders: Array<[string, { ascending?: boolean; nullsFirst?: boolean }]>; limit: number | null;
  }>,
  inserts: [] as Array<{ table: string; payload: Row }>,
  updates: [] as Array<{ table: string; payload: Row; filters: Filter[] }>,
  mutations: [] as Array<{ table: string; op: string }>,
  /** Forces the next insert to fail with this error, for the injected cases. */
  insertError: null as { code?: string; message?: string; details?: string } | null,
  updateError: null as { code?: string; message?: string; details?: string } | null,
  readErrors: {} as Record<string, { code?: string; message?: string }>,
  throwOn: null as string | null,
  /** When true the fake ignores predicates, so the ROW-LEVEL re-assertions are
   *  tested rather than the fake's own filtering. */
  ignoreFilters: false,
  nextId: 1,
};

const rowsOf = (table: string): Row[] => {
  if (!db.tables[table]) db.tables[table] = [];
  return db.tables[table];
};

const AEI = 'attested_engagement_identities';

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * The storage invariants of `20270106000000`, modelled. Each raises the
 * SQLSTATE PostgreSQL would raise, so the repository's mapping is tested
 * against the database's own vocabulary rather than a convenient stand-in.
 */
function assertStorageConstraints(row: Row, existing: Row[]): void {
  const check = (ok: boolean, name: string) => {
    if (!ok) throw new PgError('23514', `new row violates check constraint "${name}"`);
  };

  // NOT NULL on the mandatory actor. Modelled because the column deliberately
  // carries no FK, which makes this the only storage-level guarantee it has.
  if (row.attested_by_user_id == null || str(row.attested_by_user_id) === '') {
    throw new PgError('23502', 'null value in column "attested_by_user_id" violates not-null constraint');
  }

  check(
    str(row.platform).trim().length > 0
    && row.platform === str(row.platform).trim().toLowerCase(),
    'aei_platform_shape',
  );
  // NON-BLANK AND TRIMMED ONLY. No `lower()` rule — modelled as the migration
  // declares it, so a case-folding writer would FAIL this model rather than
  // quietly pass it.
  check(
    str(row.platform_user_id).trim().length > 0
    && row.platform_user_id === str(row.platform_user_id).trim(),
    'aei_platform_user_id_shape',
  );
  check(row.attested_as === 'tenant_own', 'aei_attested_as_valid');
  check(str(row.statement).trim().length > 0, 'aei_statement_not_blank');
  check(
    row.evidence !== null && typeof row.evidence === 'object' && !Array.isArray(row.evidence)
    && JSON.stringify(row.evidence).length <= 16384,
    'aei_evidence_object',
  );
  check(
    (row.revoked_at == null) === (row.revoked_reason == null)
    && (row.revoked_at == null || str(row.revoked_reason).trim().length > 0),
    'aei_revocation_coherent',
  );
  check(
    row.revoked_at == null || str(row.revoked_at) >= str(row.attested_at),
    'aei_revocation_not_before_attestation',
  );

  // The ONLY foreign key: organization_id -> companies ON DELETE CASCADE.
  if (!rowsOf('companies').some((c) => c.id === row.organization_id)) {
    throw new PgError('23503', `insert or update on table "${AEI}" violates foreign key constraint`);
  }

  // uq_aei_active_identity — PARTIAL on `revoked_at IS NULL`, and NOT folded.
  // Modelled with the partiality explicit and the comparison case-SENSITIVE,
  // because both are load-bearing: a total index would make a revoked row block
  // its own re-attestation, and a folded one would reject two genuinely
  // different case-significant profile URLs as duplicates.
  if (row.revoked_at == null) {
    const clash = existing.some((r) => r !== row
      && r.revoked_at == null
      && r.organization_id === row.organization_id
      && r.platform === row.platform
      && r.platform_user_id === row.platform_user_id);
    if (clash) {
      throw new PgError('23505', 'duplicate key value violates unique constraint "uq_aei_active_identity"');
    }
  }
}

const matches = (r: Row, filters: Filter[]): boolean => filters.every((f) => {
  if (f.kind === 'in') return Array.isArray(f.value) && (f.value as unknown[]).includes(r[f.col]);
  return r[f.col] === f.value;
});

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const st = {
      op: 'select',
      cols: '',
      filters: [] as Filter[],
      orders: [] as Array<[string, { ascending?: boolean; nullsFirst?: boolean }]>,
      limit: null as number | null,
      payload: null as Row | null,
    };

    const exec = async (mode: 'many' | 'single') => {
      await Promise.resolve();
      if (st.op !== 'select') db.mutations.push({ table, op: st.op });
      db.ops.push(`${st.op}:${table}`);
      // The transport itself failing — checked for EVERY operation, because a
      // write that throws and a read that throws must both fail closed.
      if (db.throwOn === table) throw new Error('transport exploded');

      if (st.op === 'insert') {
        const payload = st.payload as Row;
        db.inserts.push({ table, payload });
        if (db.insertError) return { data: null, error: db.insertError };
        const created: Row = {
          id: `aei-${db.nextId++}`,
          attested_as: 'tenant_own',
          evidence: {},
          attested_at: ATTESTED_AT,
          revoked_at: null,
          revoked_by_user_id: null,
          revoked_reason: null,
          ...payload,
        };
        try {
          if (table === AEI) assertStorageConstraints(created, rowsOf(table));
        } catch (e) {
          const pg = e as PgError;
          return { data: null, error: { code: pg.code, message: pg.message, details: pg.message } };
        }
        rowsOf(table).push(created);
        return { data: created, error: null };
      }

      if (st.op === 'update') {
        db.updates.push({ table, payload: st.payload as Row, filters: st.filters });
        if (db.updateError) return { data: null, error: db.updateError };
        const target = db.ignoreFilters
          ? rowsOf(table).slice()
          : rowsOf(table).filter((r) => matches(r, st.filters));
        const updated: Row[] = [];
        for (const r of target) {
          const next: Row = { ...r, ...(st.payload as Row) };
          try {
            if (table === AEI) assertStorageConstraints(next, rowsOf(table));
          } catch (e) {
            const pg = e as PgError;
            return { data: null, error: { code: pg.code, message: pg.message, details: pg.message } };
          }
          Object.assign(r, st.payload as Row);
          updated.push(r);
        }
        return { data: updated, error: null };
      }

      db.selects.push({
        table, cols: st.cols, filters: st.filters, orders: st.orders, limit: st.limit,
      });
      if (db.throwOn === table) throw new Error('transport exploded');
      const err = db.readErrors[table];
      if (err) return { data: null, error: err };

      let found = db.ignoreFilters
        ? rowsOf(table).slice()
        : rowsOf(table).filter((r) => matches(r, st.filters));

      if (st.orders.length > 0) {
        found = found.slice().sort((a, b) => {
          for (const [col, opt] of st.orders) {
            const av = a[col] ?? null;
            const bv = b[col] ?? null;
            if (av === null && bv === null) continue;
            if (av === null) return opt?.nullsFirst ? -1 : 1;
            if (bv === null) return opt?.nullsFirst ? 1 : -1;
            if (av === bv) continue;
            const direction = opt?.ascending === false ? -1 : 1;
            return (av < bv ? -1 : 1) * direction;
          }
          return 0;
        });
      }
      if (typeof st.limit === 'number') found = found.slice(0, st.limit);

      return mode === 'many' ? { data: found, error: null } : { data: found[0] ?? null, error: null };
    };

    const b: Record<string, unknown> = {
      select: (c: string) => { st.cols = c; return b; },
      insert: (p: Row) => { st.op = 'insert'; st.payload = p; return b; },
      update: (p: Row) => { st.op = 'update'; st.payload = p; return b; },
      upsert: (p: Row) => { st.op = 'upsert'; st.payload = p; return b; },
      delete: () => { st.op = 'delete'; return b; },
      eq: (c: string, v: unknown) => { st.filters.push({ kind: 'eq', col: c, value: v }); return b; },
      is: (c: string, v: unknown) => { st.filters.push({ kind: 'is', col: c, value: v }); return b; },
      in: (c: string, v: unknown) => { st.filters.push({ kind: 'in', col: c, value: v }); return b; },
      order: (c: string, o: { ascending?: boolean; nullsFirst?: boolean }) => {
        st.orders.push([c, o]); return b;
      },
      limit: (n: number) => { st.limit = n; return exec('many'); },
      single: () => exec('single'),
      maybeSingle: () => exec('single'),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => exec('many').then(res, rej),
    };
    return b;
  },
}));

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: () => { throw new Error('the registry must not reach the table API directly'); },
  },
}));

jest.mock('../../services/logger', () => ({
  logger: {
    warn: () => {}, error: () => {}, info: () => {}, debug: () => {},
  },
}));

import fs from 'fs';
import path from 'path';
import {
  ATTESTED_AS_TENANT_OWN,
  ATTESTED_ENGAGEMENT_IDENTITY_RELATION,
  engagementIdentityKey,
  normalizeEngagementIdentity,
  normalizeEngagementPlatform,
} from '../../services/engagementIdentity/attestedIdentityContract';
import {
  ATTESTED_IDENTITY_LOOKUP_MAX,
  ATTESTED_IDENTITY_READ_LIMIT_DEFAULT,
  ATTESTED_IDENTITY_READ_LIMIT_MAX,
  attestIdentity,
  findOwnedIdentities,
  listActiveAttestedIdentities,
  revokeIdentity,
} from '../../services/engagementIdentity/attestedIdentityRepository';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const MIGRATION = 'supabase/migrations/20270106000000_pi_attested_engagement_identities.sql';
const ORG_A = 'org-a';
const ORG_B = 'org-b';
const ADMIN = 'user-admin';
const OTHER_ADMIN = 'user-other';
/** A case-significant profile URL — the ordinary case, not an edge case. */
const LI_IDENTITY = 'https://www.linkedin.com/in/AnjaliVerma';
const STATEMENT = 'this is our own company page, operated by the marketing team';

const seedTenants = () => {
  rowsOf('companies').push({ id: ORG_A }, { id: ORG_B });
};

const attestation = (over: Partial<{
  organizationId: string; platform: string; platformUserId: string;
  statement: string; attestedByUserId: string;
}> = {}) => ({
  organizationId: ORG_A,
  platform: 'linkedin',
  platformUserId: LI_IDENTITY,
  statement: STATEMENT,
  attestedByUserId: ADMIN,
  ...over,
});

/** A row as the relation would hold it, for read and revoke paths. */
const seedRow = (over: Row = {}): Row => {
  const row: Row = {
    id: `seed-${db.nextId++}`,
    organization_id: ORG_A,
    platform: 'linkedin',
    platform_user_id: LI_IDENTITY,
    attested_as: 'tenant_own',
    statement: STATEMENT,
    evidence: {},
    attested_by_user_id: ADMIN,
    attested_at: ATTESTED_AT,
    revoked_at: null,
    revoked_by_user_id: null,
    revoked_reason: null,
    ...over,
  };
  rowsOf(AEI).push(row);
  return row;
};

const registryRows = () => rowsOf(AEI);
const registrySelects = () => db.selects.filter((s) => s.table === AEI);
const registryInserts = () => db.inserts.filter((i) => i.table === AEI);

/** Every error a read or write can present, each of which must fail CLOSED. */
const FAIL_CLOSED_ERRORS: ReadonlyArray<[string, { code?: string; message?: string }]> = [
  ['relation absent', { code: '42P01', message: 'relation "attested_engagement_identities" does not exist' }],
  ['column absent', { code: '42703', message: 'column does not exist' }],
  ['stale schema cache', { code: 'PGRST205', message: 'Could not find the table in the schema cache' }],
  ['tenant key refused', { code: '23503', message: 'violates foreign key constraint' }],
  ['permission denied', { code: '42501', message: 'permission denied for table' }],
  ['unknown internal', { code: 'XX000', message: 'internal error' }],
  ['no code at all', { message: 'something went wrong' }],
];

beforeEach(() => {
  db.tables = {};
  db.ops = []; db.selects = []; db.inserts = []; db.updates = []; db.mutations = [];
  db.insertError = null; db.updateError = null; db.readErrors = {}; db.throwOn = null;
  db.ignoreFilters = false; db.nextId = 1;
});

// ═══════════════════════════════════════════════════════════════════════════
// 1 · ATTEST
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-4A · an administrator attests one identity', () => {
  it('stores the pair verbatim, with the tenant, the actor and the closed role', async () => {
    seedTenants();

    const res = await attestIdentity(attestation());

    expect(res).toMatchObject({ ok: true, alreadyActive: false });
    expect(registryInserts()).toHaveLength(1);
    const payload = registryInserts()[0].payload;
    expect(payload).toMatchObject({
      organization_id: ORG_A,
      platform: 'linkedin',
      platform_user_id: LI_IDENTITY,
      attested_as: ATTESTED_AS_TENANT_OWN,
      statement: STATEMENT,
      attested_by_user_id: ADMIN,
    });
    // CASE PRESERVED. A folded identity would never match the author row.
    expect(payload.platform_user_id).toBe(LI_IDENTITY);
    expect(payload.platform_user_id).not.toBe(LI_IDENTITY.toLowerCase());
    // The caller supplies no evidence payload and no clock; both are the
    // relation's own defaults.
    expect(Object.keys(payload)).not.toContain('evidence');
    expect(Object.keys(payload)).not.toContain('attested_at');
    expect(Object.keys(payload)).not.toContain('revoked_at');
    // IT WROTE BEFORE IT READ — there is no SELECT-then-INSERT here.
    expect(db.ops[0]).toBe(`insert:${AEI}`);
    expect(registrySelects()).toHaveLength(0);
  });

  it('lower-cases the platform and NEVER aliases it — a stored author row may hold "x"', async () => {
    seedTenants();

    await attestIdentity(attestation({ platform: '  X  ', platformUserId: '  @NewsDesk  ' }));

    const payload = registryInserts()[0].payload;
    // Trimmed and folded, and still 'x': aliasing it to 'twitter' would store a
    // value that never equality-matches the author row it is about.
    expect(payload.platform).toBe('x');
    expect(payload.platform).not.toBe('twitter');
    // Trimmed only. The outer whitespace goes; the case does not.
    expect(payload.platform_user_id).toBe('@NewsDesk');
  });

  it('uses the contract normalisers rather than a second spelling of them', async () => {
    seedTenants();
    await attestIdentity(attestation({ platform: ' LI ', platformUserId: ' Mixed_Case ' }));
    const payload = registryInserts()[0].payload;
    expect(payload.platform).toBe(normalizeEngagementPlatform(' LI '));
    expect(payload.platform_user_id).toBe(normalizeEngagementIdentity(' Mixed_Case '));
  });

  it('refuses a blank half, a blank statement and an anonymous actor without writing', async () => {
    seedTenants();

    for (const [field, input] of [
      ['platform', attestation({ platform: '   ' })],
      ['platformUserId', attestation({ platformUserId: '  ' })],
      ['statement', attestation({ statement: '  ' })],
      ['attestedByUserId', attestation({ attestedByUserId: '' })],
    ] as const) {
      const res = await attestIdentity(input);
      expect({ field, res }).toMatchObject({ field, res: { ok: false, reason: 'invalid_input' } });
    }
    // NOTHING was attempted: a refusal is not a write.
    expect(db.mutations).toEqual([]);
  });

  it('throws only when the request cannot be a request at all', async () => {
    await expect(attestIdentity(attestation({ organizationId: '' })))
      .rejects.toThrow(/organizationId is required/);
  });

  it('maps a refused CHECK onto invalid_input, not onto an unavailable store', async () => {
    seedTenants();
    db.insertError = {
      code: '23514',
      message: 'new row violates check constraint "aei_statement_not_blank"',
      details: 'aei_statement_not_blank',
    };

    const res = await attestIdentity(attestation());

    expect(res).toMatchObject({ ok: false, reason: 'invalid_input' });
    if (res.ok !== false) throw new Error('unreachable');
    expect(res.detail).toMatch(/aei_statement_not_blank/);
  });

  it.each(FAIL_CLOSED_ERRORS)('fails closed on %s', async (_label, error) => {
    seedTenants();
    db.insertError = error;

    const res = await attestIdentity(attestation());

    expect(res).toMatchObject({ ok: false, reason: 'store_unavailable' });
  });

  it('fails closed when the write throws', async () => {
    // The double throws on EVERY operation against the named table, by design:
    // its own comment says a write that throws and a read that throws must both
    // fail closed. So this is the write throwing, and the only honest answer is
    // unavailability. An earlier revision of this test asserted `ok: true` here
    // on the theory that just the read throws — which contradicted both the
    // harness and this test's own name, and would have let a transport failure
    // be reported to an administrator as a successful attestation.
    seedTenants();
    db.insertError = null;
    db.throwOn = AEI;

    const res = await attestIdentity(attestation());

    expect(res).toMatchObject({ ok: false, reason: 'store_unavailable' });
    // Nothing was stored, and nothing was reported as stored.
    expect(rowsOf(AEI)).toHaveLength(0);
  });

  it('fails closed when the write returns no row identity', async () => {
    seedTenants();
    db.insertError = null;
    db.tables.companies = [];           // the single FK refuses the row
    const res = await attestIdentity(attestation());
    expect(res).toMatchObject({ ok: false, reason: 'store_unavailable' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 · REPLAY — AN ACTIVE ATTESTATION IS NOT AN ERROR
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-4A · a replay recovers the active row rather than duplicating it', () => {
  it('reports alreadyActive with the existing identifier, from one tenant-scoped read', async () => {
    seedTenants();
    const first = await attestIdentity(attestation());
    expect(first).toMatchObject({ ok: true, alreadyActive: false });
    if (first.ok !== true) throw new Error('unreachable');
    db.selects = []; db.ops = [];

    const second = await attestIdentity(attestation({ attestedByUserId: OTHER_ADMIN }));

    expect(second).toEqual({ ok: true, id: first.id, alreadyActive: true });
    // ONE row, and the original actor survives: a replay is not an overwrite.
    expect(registryRows()).toHaveLength(1);
    expect(registryRows()[0].attested_by_user_id).toBe(ADMIN);
    // The recovery read happened AFTER the insert, and is keyed on the ACTIVE
    // key — tenant first, then the pair, then `revoked_at IS NULL`.
    expect(db.ops).toEqual([`insert:${AEI}`, `select:${AEI}`]);
    expect(registrySelects()).toHaveLength(1);
    expect(registrySelects()[0].filters).toEqual([
      { kind: 'eq', col: 'organization_id', value: ORG_A },
      { kind: 'eq', col: 'platform', value: 'linkedin' },
      { kind: 'eq', col: 'platform_user_id', value: LI_IDENTITY },
      { kind: 'is', col: 'revoked_at', value: null },
    ]);
  });

  it('two tenants may each attest the same identity — the key is tenant-scoped', async () => {
    seedTenants();
    const a = await attestIdentity(attestation({ organizationId: ORG_A }));
    const b = await attestIdentity(attestation({ organizationId: ORG_B }));
    expect(a).toMatchObject({ ok: true, alreadyActive: false });
    expect(b).toMatchObject({ ok: true, alreadyActive: false });
    expect(registryRows()).toHaveLength(2);
  });

  it('two identities differing only in case are TWO attestations, not a replay', async () => {
    seedTenants();
    const upper = await attestIdentity(attestation());
    const lower = await attestIdentity(attestation({ platformUserId: LI_IDENTITY.toLowerCase() }));
    expect(upper).toMatchObject({ ok: true, alreadyActive: false });
    // A `lower()`-folded key would have called this a replay and silently
    // dropped a genuinely different profile URL.
    expect(lower).toMatchObject({ ok: true, alreadyActive: false });
    expect(registryRows()).toHaveLength(2);
  });

  it('a revoked row does not block re-attestation — the active key is PARTIAL', async () => {
    seedTenants();
    seedRow({
      revoked_at: '2021-01-01T00:00:00.000Z',
      revoked_by_user_id: ADMIN,
      revoked_reason: 'page was sold',
    });

    const again = await attestIdentity(attestation());

    expect(again).toMatchObject({ ok: true, alreadyActive: false });
    expect(registryRows()).toHaveLength(2);
  });

  it('a 23505 whose active row cannot be recovered is store_unavailable, never a replay', async () => {
    seedTenants();
    db.insertError = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "uq_aei_active_identity"',
    };
    // No active row exists, so the recovery read finds nothing.
    const res = await attestIdentity(attestation());
    expect(res).toMatchObject({ ok: false, reason: 'store_unavailable' });
  });

  it('a 23505 whose recovery read fails is store_unavailable', async () => {
    seedTenants();
    seedRow();
    db.insertError = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "uq_aei_active_identity"',
    };
    db.readErrors[AEI] = { code: 'XX000', message: 'read exploded' };
    const res = await attestIdentity(attestation());
    expect(res).toMatchObject({ ok: false, reason: 'store_unavailable' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 · REVOKE
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-4A · withdrawal keeps the row and never rewrites history', () => {
  it('sets only the three revocation columns, tenant-filtered FIRST and active-only', async () => {
    seedTenants();
    const row = seedRow();

    const res = await revokeIdentity({
      organizationId: ORG_A, id: String(row.id), revokedByUserId: OTHER_ADMIN, reason: 'page was sold',
    });

    expect(res).toEqual({ ok: true, revoked: true });
    expect(db.updates).toHaveLength(1);
    // EXACTLY three columns. No statement, no attested_*, no attested_as.
    expect(Object.keys(db.updates[0].payload).sort())
      .toEqual(['revoked_at', 'revoked_by_user_id', 'revoked_reason']);
    expect(db.updates[0].filters).toEqual([
      { kind: 'eq', col: 'organization_id', value: ORG_A },   // tenant FIRST
      { kind: 'eq', col: 'id', value: String(row.id) },
      { kind: 'is', col: 'revoked_at', value: null },         // active only
    ]);
    // The attestation itself is untouched.
    expect(registryRows()[0]).toMatchObject({
      statement: STATEMENT, attested_by_user_id: ADMIN, attested_at: ATTESTED_AT,
      revoked_by_user_id: OTHER_ADMIN, revoked_reason: 'page was sold',
    });
    expect(typeof registryRows()[0].revoked_at).toBe('string');
  });

  it('an already-withdrawn attestation is already_revoked, and its original record stands', async () => {
    seedTenants();
    const row = seedRow({
      revoked_at: '2021-06-01T00:00:00.000Z',
      revoked_by_user_id: ADMIN,
      revoked_reason: 'the first reason',
    });

    const res = await revokeIdentity({
      organizationId: ORG_A, id: String(row.id), revokedByUserId: OTHER_ADMIN, reason: 'a second reason',
    });

    expect(res).toMatchObject({ ok: false, reason: 'already_revoked' });
    // HISTORY IS NEVER REWRITTEN.
    expect(registryRows()[0]).toMatchObject({
      revoked_at: '2021-06-01T00:00:00.000Z',
      revoked_by_user_id: ADMIN,
      revoked_reason: 'the first reason',
    });
  });

  it('an absent attestation is not_found, distinguished by a tenant-scoped read', async () => {
    seedTenants();
    seedRow();

    const res = await revokeIdentity({
      organizationId: ORG_A, id: 'no-such-row', revokedByUserId: ADMIN, reason: 'mistake',
    });

    expect(res).toMatchObject({ ok: false, reason: 'not_found' });
    // The classifying read is tenant-scoped, and happens only after the update
    // matched nothing.
    expect(registrySelects()).toHaveLength(1);
    expect(registrySelects()[0].filters[0])
      .toEqual({ kind: 'eq', col: 'organization_id', value: ORG_A });
    expect(db.ops).toEqual([`update:${AEI}`, `select:${AEI}`]);
  });

  it("another tenant's attestation is not_found, never withdrawn", async () => {
    seedTenants();
    const foreign = seedRow({ organization_id: ORG_B });

    const res = await revokeIdentity({
      organizationId: ORG_A, id: String(foreign.id), revokedByUserId: ADMIN, reason: 'not mine',
    });

    expect(res).toMatchObject({ ok: false, reason: 'not_found' });
    expect(registryRows()[0].revoked_at).toBeNull();
  });

  it('refuses a blank reason, a blank actor and a blank id without mutating', async () => {
    seedTenants();
    const row = seedRow();

    for (const [field, input] of [
      ['reason', { organizationId: ORG_A, id: String(row.id), revokedByUserId: ADMIN, reason: '   ' }],
      ['revokedByUserId', { organizationId: ORG_A, id: String(row.id), revokedByUserId: ' ', reason: 'x' }],
      ['id', { organizationId: ORG_A, id: '  ', revokedByUserId: ADMIN, reason: 'x' }],
    ] as const) {
      const res = await revokeIdentity(input);
      expect({ field, res }).toMatchObject({ field, res: { ok: false, reason: 'invalid_input' } });
    }
    expect(db.mutations).toEqual([]);
    expect(registryRows()[0].revoked_at).toBeNull();
  });

  it('throws only when the request cannot be a request at all', async () => {
    await expect(revokeIdentity({
      organizationId: '', id: 'x', revokedByUserId: ADMIN, reason: 'y',
    })).rejects.toThrow(/organizationId is required/);
  });

  it('maps a refused CHECK onto invalid_input — a clock behind the database is not silently corrected', async () => {
    seedTenants();
    // `aei_revocation_not_before_attestation`: an attestation stamped in the
    // future cannot be withdrawn by a caller whose clock is behind it.
    const row = seedRow({ attested_at: '2999-01-01T00:00:00.000Z' });

    const res = await revokeIdentity({
      organizationId: ORG_A, id: String(row.id), revokedByUserId: ADMIN, reason: 'mistake',
    });

    expect(res).toMatchObject({ ok: false, reason: 'invalid_input' });
    if (res.ok !== false) throw new Error('unreachable');
    expect(res.detail).toMatch(/aei_revocation_not_before_attestation/);
    expect(registryRows()[0].revoked_at).toBeNull();
  });

  it.each(FAIL_CLOSED_ERRORS)('fails closed on %s', async (_label, error) => {
    seedTenants();
    const row = seedRow();
    db.updateError = error;

    const res = await revokeIdentity({
      organizationId: ORG_A, id: String(row.id), revokedByUserId: ADMIN, reason: 'mistake',
    });

    expect(res).toMatchObject({ ok: false, reason: 'store_unavailable' });
  });

  it('fails closed when the classifying read cannot be made — never a guess between the two', async () => {
    seedTenants();
    db.readErrors[AEI] = { code: 'XX000', message: 'read exploded' };

    const res = await revokeIdentity({
      organizationId: ORG_A, id: 'no-such-row', revokedByUserId: ADMIN, reason: 'mistake',
    });

    expect(res).toMatchObject({ ok: false, reason: 'store_unavailable' });
    if (res.ok !== false) throw new Error('unreachable');
    // Explicitly NOT not_found and NOT already_revoked.
    expect(res.reason).not.toBe('not_found');
    expect(res.reason).not.toBe('already_revoked');
  });

  it('fails closed when the update reports another tenant row (predicates ignored)', async () => {
    seedTenants();
    seedRow({ organization_id: ORG_B });
    db.ignoreFilters = true;

    const res = await revokeIdentity({
      organizationId: ORG_A, id: 'anything', revokedByUserId: ADMIN, reason: 'mistake',
    });

    expect(res).toMatchObject({ ok: false, reason: 'store_unavailable' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 · THE ACTIVE REGISTRY READ
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-4A · the active registry read is bounded, active-only and tenant-scoped', () => {
  it('returns active rows newest first, with the identity verbatim', async () => {
    seedTenants();
    seedRow({ attested_at: '2021-01-01T00:00:00.000Z', platform_user_id: 'older' });
    seedRow({ attested_at: '2023-01-01T00:00:00.000Z', platform_user_id: LI_IDENTITY });
    seedRow({
      attested_at: '2024-01-01T00:00:00.000Z',
      platform_user_id: 'withdrawn',
      revoked_at: '2024-02-01T00:00:00.000Z',
      revoked_by_user_id: ADMIN,
      revoked_reason: 'gone',
    });

    const read = await listActiveAttestedIdentities({ organizationId: ORG_A });

    expect(read.legible).toBe(true);
    expect(read.identities.map((i) => i.platformUserId)).toEqual([LI_IDENTITY, 'older']);
    expect(read.identities[0]).toMatchObject({
      organizationId: ORG_A, platform: 'linkedin', attestedAs: ATTESTED_AS_TENANT_OWN,
      attestedByUserId: ADMIN, revokedAt: null, revokedByUserId: null, revokedReason: null,
    });
    const select = registrySelects()[0];
    expect(select.filters[0]).toEqual({ kind: 'eq', col: 'organization_id', value: ORG_A });
    expect(select.filters).toContainEqual({ kind: 'is', col: 'revoked_at', value: null });
    expect(select.limit).toBe(ATTESTED_IDENTITY_READ_LIMIT_DEFAULT);
    expect(select.orders).toEqual([['attested_at', { ascending: false }]]);
    expect(select.cols).not.toContain('*');
  });

  it('clamps an oversized limit and honours a smaller one', async () => {
    seedTenants();
    await listActiveAttestedIdentities({ organizationId: ORG_A, limit: 10_000 });
    await listActiveAttestedIdentities({ organizationId: ORG_A, limit: 5 });
    expect(registrySelects().map((s) => s.limit)).toEqual([ATTESTED_IDENTITY_READ_LIMIT_MAX, 5]);
  });

  it('filters by the normalised platform, and refuses a supplied blank one', async () => {
    seedTenants();
    seedRow({ platform: 'linkedin' });
    seedRow({ platform: 'x', platform_user_id: '@NewsDesk' });

    const read = await listActiveAttestedIdentities({ organizationId: ORG_A, platform: ' X ' });
    expect(read.legible).toBe(true);
    expect(read.identities.map((i) => i.platform)).toEqual(['x']);

    // A supplied-but-blank filter is a caller error: dropping it would widen
    // the read to every platform, and answering nothing would hide the mistake.
    await expect(listActiveAttestedIdentities({ organizationId: ORG_A, platform: '  ' }))
      .rejects.toThrow(/may not be blank/);
  });

  it("re-asserts the tenant and the active state ON THE ROWS, not only in the query", async () => {
    seedTenants();
    seedRow({ organization_id: ORG_B, platform_user_id: 'foreign' });
    seedRow({
      platform_user_id: 'withdrawn',
      revoked_at: '2024-02-01T00:00:00.000Z',
      revoked_by_user_id: ADMIN,
      revoked_reason: 'gone',
    });
    seedRow({ platform_user_id: LI_IDENTITY });
    db.ignoreFilters = true;            // the query's predicates are discarded

    const read = await listActiveAttestedIdentities({ organizationId: ORG_A });

    expect(read.legible).toBe(true);
    expect(read.identities.map((i) => i.platformUserId)).toEqual([LI_IDENTITY]);
  });

  it.each(FAIL_CLOSED_ERRORS)('is illegible, not empty, on %s', async (_label, error) => {
    seedTenants();
    seedRow();
    db.readErrors[AEI] = error;

    const read = await listActiveAttestedIdentities({ organizationId: ORG_A });

    // THE FLAG IS THE ANSWER. An empty `identities` accompanies it; it is never
    // the answer by itself.
    expect(read.legible).toBe(false);
    expect(read.identities).toEqual([]);
    expect(typeof read.detail).toBe('string');
    expect(read.detail).not.toBe('');
  });

  it('is illegible when the read throws', async () => {
    seedTenants();
    db.throwOn = AEI;
    const read = await listActiveAttestedIdentities({ organizationId: ORG_A });
    expect(read.legible).toBe(false);
    expect(read.identities).toEqual([]);
  });

  it('throws only when the request cannot be a request at all', async () => {
    await expect(listActiveAttestedIdentities({ organizationId: '' }))
      .rejects.toThrow(/organizationId is required/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5 · THE OWNERSHIP LOOKUP — THE READ THE ADMISSION DECISION DEPENDS ON
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-4A · the ownership lookup is bounded, pair-matched and fail-closed', () => {
  it('answers in ONE read, bounded to the identities supplied', async () => {
    seedTenants();
    seedRow({ platform: 'linkedin', platform_user_id: LI_IDENTITY });
    seedRow({ platform: 'x', platform_user_id: '@NewsDesk' });
    seedRow({ platform: 'reddit', platform_user_id: 'u/unrelated' });

    const found = await findOwnedIdentities({
      organizationId: ORG_A,
      keys: [
        { platform: 'LinkedIn', platformUserId: ` ${LI_IDENTITY} ` },
        { platform: 'reddit', platformUserId: 'u/somebody_else' },
      ],
    });

    expect(found.legible).toBe(true);
    expect(Array.from(found.ownedKeys))
      .toEqual([engagementIdentityKey('linkedin', LI_IDENTITY)]);
    // ONE read, and it asked only about what it was given.
    expect(registrySelects()).toHaveLength(1);
    const select = registrySelects()[0];
    expect(select.filters[0]).toEqual({ kind: 'eq', col: 'organization_id', value: ORG_A });
    expect(select.filters).toContainEqual({ kind: 'is', col: 'revoked_at', value: null });
    expect(select.filters).toContainEqual({ kind: 'in', col: 'platform', value: ['linkedin', 'reddit'] });
    expect(select.filters).toContainEqual({
      kind: 'in', col: 'platform_user_id', value: [LI_IDENTITY, 'u/somebody_else'],
    });
    expect(select.limit).toBe(ATTESTED_IDENTITY_LOOKUP_MAX);
  });

  it('RE-MATCHES THE PAIRS: the two `.in` filters are a cross product, not a list of pairs', async () => {
    seedTenants();
    // The tenant attested its LinkedIn page and nothing else.
    seedRow({ platform: 'linkedin', platform_user_id: 'OWNED-PAGE' });

    const found = await findOwnedIdentities({
      organizationId: ORG_A,
      keys: [
        { platform: 'linkedin', platformUserId: 'SOME-OTHER-PAGE' },
        { platform: 'twitter', platformUserId: 'OWNED-PAGE' },
      ],
    });

    // The `.in` prefilter DOES return the stored row — platform is in
    // {linkedin, twitter} and the identity is in {SOME-OTHER-PAGE, OWNED-PAGE}
    // — which is exactly the cross product the pair re-match exists to collapse.
    expect(registrySelects()).toHaveLength(1);
    expect(found.legible).toBe(true);
    // Neither asked pair is `linkedin:OWNED-PAGE`, so nothing is owned. Without
    // the re-match, `twitter:OWNED-PAGE` would have been reported as owned and
    // that account's statements would be permanently inadmissible.
    expect(Array.from(found.ownedKeys)).toEqual([]);
  });

  it('is case-sensitive on the identity and case-insensitive on the platform', async () => {
    seedTenants();
    seedRow({ platform: 'linkedin', platform_user_id: LI_IDENTITY });

    const exact = await findOwnedIdentities({
      organizationId: ORG_A,
      keys: [{ platform: 'LINKEDIN', platformUserId: LI_IDENTITY }],
    });
    expect(Array.from(exact.ownedKeys)).toEqual([engagementIdentityKey('linkedin', LI_IDENTITY)]);

    const folded = await findOwnedIdentities({
      organizationId: ORG_A,
      keys: [{ platform: 'linkedin', platformUserId: LI_IDENTITY.toLowerCase() }],
    });
    // A different profile URL is a different identity, and is NOT owned.
    expect(folded.legible).toBe(true);
    expect(Array.from(folded.ownedKeys)).toEqual([]);
  });

  it('ignores a revoked attestation — only an ACTIVE row means "owned"', async () => {
    seedTenants();
    seedRow({
      platform: 'linkedin',
      platform_user_id: LI_IDENTITY,
      revoked_at: '2024-02-01T00:00:00.000Z',
      revoked_by_user_id: ADMIN,
      revoked_reason: 'sold',
    });
    db.ignoreFilters = true;            // the revocation predicate is discarded

    const found = await findOwnedIdentities({
      organizationId: ORG_A, keys: [{ platform: 'linkedin', platformUserId: LI_IDENTITY }],
    });

    expect(found.legible).toBe(true);
    expect(Array.from(found.ownedKeys)).toEqual([]);
  });

  it("re-asserts the tenant on the rows — another tenant's attestation is never ours", async () => {
    seedTenants();
    seedRow({ organization_id: ORG_B, platform: 'linkedin', platform_user_id: LI_IDENTITY });
    db.ignoreFilters = true;

    const found = await findOwnedIdentities({
      organizationId: ORG_A, keys: [{ platform: 'linkedin', platformUserId: LI_IDENTITY }],
    });

    expect(found.legible).toBe(true);
    expect(Array.from(found.ownedKeys)).toEqual([]);
  });

  it('an empty question is answerable and costs no read', async () => {
    seedTenants();
    seedRow();

    const found = await findOwnedIdentities({ organizationId: ORG_A, keys: [] });

    expect(found).toEqual({ legible: true, detail: null, ownedKeys: new Set() });
    expect(registrySelects()).toHaveLength(0);
  });

  it('drops a half-blank pair, which can never match a stored row', async () => {
    seedTenants();
    seedRow();

    const found = await findOwnedIdentities({
      organizationId: ORG_A,
      keys: [{ platform: 'linkedin', platformUserId: '   ' }, { platform: '', platformUserId: 'x' }],
    });

    // Every supplied pair was unusable, so the question was empty — and still
    // answerable, which is why this is legible rather than illegible.
    expect(found.legible).toBe(true);
    expect(Array.from(found.ownedKeys)).toEqual([]);
    expect(registrySelects()).toHaveLength(0);
  });

  it('fails closed over the lookup bound rather than answering about a prefix', async () => {
    seedTenants();
    const keys = Array.from({ length: ATTESTED_IDENTITY_LOOKUP_MAX + 1 }, (_v, i) => ({
      platform: 'linkedin', platformUserId: `id-${i}`,
    }));

    const found = await findOwnedIdentities({ organizationId: ORG_A, keys });

    // A truncated answer would report an ATTESTED identity as unattested, which
    // is the one direction of error this registry exists to prevent.
    expect(found.legible).toBe(false);
    expect(found.ownedKeys.size).toBe(0);
    expect(found.detail).toMatch(new RegExp(String(ATTESTED_IDENTITY_LOOKUP_MAX)));
    expect(registrySelects()).toHaveLength(0);
  });

  it.each(FAIL_CLOSED_ERRORS)('returns legible:false — NEVER a legible empty set — on %s', async (_label, error) => {
    seedTenants();
    seedRow();
    db.readErrors[AEI] = error;

    const found = await findOwnedIdentities({
      organizationId: ORG_A, keys: [{ platform: 'linkedin', platformUserId: LI_IDENTITY }],
    });

    expect(found.legible).toBe(false);
    expect(found.ownedKeys.size).toBe(0);
    expect(typeof found.detail).toBe('string');
    expect(found.detail).not.toBe('');
    // The property the predecessor got wrong: an unreadable registry must not
    // be representable as "the workspace owns nobody".
    expect({ legible: found.legible, empty: found.ownedKeys.size === 0 })
      .toEqual({ legible: false, empty: true });
  });

  it('is illegible when the read throws', async () => {
    seedTenants();
    db.throwOn = AEI;
    const found = await findOwnedIdentities({
      organizationId: ORG_A, keys: [{ platform: 'linkedin', platformUserId: LI_IDENTITY }],
    });
    expect(found.legible).toBe(false);
    expect(found.ownedKeys.size).toBe(0);
  });

  it('throws only when the request cannot be a request at all', async () => {
    await expect(findOwnedIdentities({ organizationId: '', keys: [] }))
      .rejects.toThrow(/organizationId is required/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6 · THE MIGRATION TEXT — THE ONLY REAL ARTEFACT THIS SUITE READS
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-4A · 20270106000000 declares the registry the repository was written against', () => {
  const sql = fs.readFileSync(path.join(REPO_ROOT, MIGRATION), 'utf8');
  /** The table definition only, so a comment elsewhere cannot satisfy a scan. */
  const tableSlice = sql.slice(sql.indexOf('CREATE TABLE'), sql.indexOf('CREATE UNIQUE INDEX'));
  const uncommented = (s: string): string => s.replace(/^[ \t]*--.*$/gm, '');
  /**
   * Executable SQL only: `--` comments AND single-quoted literals removed.
   *
   * `uncommented` alone is not enough for a scan that asks "does this file
   * DO x?", because this migration deliberately explains in prose why it does
   * NOT do x. Two assertions below were failing on exactly that: the phrase
   * `ON DELETE SET NULL` appears inside a COMMENT ON COLUMN literal recording
   * the DEFECT-008 rationale, and `access_token` appears inside the
   * postcondition's own `attname IN (...)` guard list — i.e. inside the check
   * that PROVES no such column exists. Grepping the raw file made the file's
   * own safety argument look like the hazard.
   */
  const executable = (s: string): string =>
    uncommented(s).replace(/'(?:[^']|'')*'/g, "''");
  const CHECK_NAMES = [
    'aei_platform_shape',
    'aei_platform_user_id_shape',
    'aei_attested_as_valid',
    'aei_statement_not_blank',
    'aei_evidence_object',
    'aei_revocation_coherent',
    'aei_revocation_not_before_attestation',
  ] as const;

  it('names the relation the contract publishes', () => {
    expect(ATTESTED_ENGAGEMENT_IDENTITY_RELATION).toBe(AEI);
    expect(sql).toContain(`public.${AEI}`);
  });

  it('declares EXACTLY ONE foreign key, and it is the cascading tenant key', () => {
    const references = executable(sql).match(/REFERENCES\s+public\.[a-z_]+/g) ?? [];
    expect(references).toEqual(['REFERENCES public.companies']);
    expect(uncommented(tableSlice)).toMatch(
      /organization_id\s+uuid NOT NULL REFERENCES public\.companies \(id\) ON DELETE CASCADE/,
    );
    // DEFECT-008: no users reference on either actor column, in any form.
    // Scanned over EXECUTABLE SQL: the migration's own comments name the
    // forbidden shape in order to explain why it is absent, and a raw grep
    // cannot tell a prohibition from an occurrence.
    expect(executable(sql)).not.toMatch(/REFERENCES\s+public\.users/);
    expect(executable(sql)).not.toMatch(/ON DELETE SET NULL/);
    // ...and the postcondition proves it rather than the comment asserting it.
    expect(sql).toMatch(/expected exactly 1 foreign key/);
  });

  it('keeps both actor columns mandatory-or-absent with NO CHECK naming them', () => {
    expect(uncommented(tableSlice)).toMatch(/attested_by_user_id\s+uuid NOT NULL/);
    expect(uncommented(tableSlice)).toMatch(/revoked_by_user_id\s+uuid/);

    const chunks = uncommented(tableSlice).split(/CONSTRAINT\s+/).slice(1);
    expect(chunks).toHaveLength(CHECK_NAMES.length);
    expect(chunks.map((c) => c.split(/\s/)[0])).toEqual([...CHECK_NAMES]);
    // THE FALSIFIABLE HALF OF THE DEFECT-008 GUARD. A CHECK pairing an actor
    // column's nullity with `revoked_at` would abort a user's deletion with
    // 23514 the moment anyone added the obvious foreign key.
    for (const chunk of chunks) {
      expect({ check: chunk.split(/\s/)[0], namesActor: /_by_user_id/.test(chunk) })
        .toEqual({ check: chunk.split(/\s/)[0], namesActor: false });
    }
    expect(sql).toMatch(/reference an actor column/);
  });

  it('declares the seven named CHECKs, and folds the platform but NEVER the identity', () => {
    for (const name of CHECK_NAMES) {
      expect(uncommented(tableSlice)).toContain(`CONSTRAINT ${name}`);
    }
    expect(sql).toMatch(/expected 7 named CHECK constraints/);

    const body = (name: string): string => {
      const chunks = uncommented(tableSlice).split(/CONSTRAINT\s+/).slice(1);
      const hit = chunks.find((c) => c.startsWith(name));
      expect(hit).toBeDefined();
      return hit as string;
    };
    // The platform IS folded, and the CHECK is what stops a divergent
    // normaliser storing 'LinkedIn' where the author row says 'linkedin'.
    expect(body('aei_platform_shape')).toMatch(/platform = lower\(btrim\(platform\)\)/);
    // The identity is NOT: non-blank and trimmed, and no `lower()` anywhere.
    expect(body('aei_platform_user_id_shape'))
      .toMatch(/platform_user_id = btrim\(platform_user_id\)/);
    expect(body('aei_platform_user_id_shape')).not.toMatch(/lower\(/);
    expect(body('aei_attested_as_valid')).toMatch(/attested_as IN \('tenant_own'\)/);
    expect(body('aei_evidence_object')).toMatch(/jsonb_typeof\(evidence\) = 'object'/);
    expect(body('aei_evidence_object')).toMatch(/pg_column_size\(evidence\) <= \d+/);
    expect(body('aei_revocation_coherent'))
      .toMatch(/\(revoked_at IS NULL\) = \(revoked_reason IS NULL\)/);
    expect(body('aei_revocation_not_before_attestation'))
      .toMatch(/revoked_at IS NULL OR revoked_at >= attested_at/);
  });

  it('declares the active key PARTIAL on revoked_at IS NULL and NOT lower()-folded', () => {
    const index = uncommented(sql)
      .match(/CREATE UNIQUE INDEX IF NOT EXISTS uq_aei_active_identity[\s\S]*?;/);
    expect(index).not.toBeNull();
    const def = index![0];
    expect(def).toMatch(/\(organization_id, platform, platform_user_id\)/);
    // PARTIAL: without the predicate a revoked row would block its own identity
    // from ever being attested again, and a second withdrawal would be unstorable.
    expect(def).toMatch(/WHERE revoked_at IS NULL/);
    // NEVER FOLDED: a folded key collapses two different case-significant
    // profile URLs into one and rejects the second as a replay.
    expect(def).not.toMatch(/lower\(/);
    expect(sql).toMatch(/must be PARTIAL on revoked_at IS NULL/);
    expect(sql).toMatch(/must not be lower\(\)-folded/);
  });

  it('declares exactly the two named indexes the repository reads through', () => {
    const created = uncommented(sql).match(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS ([a-z_]+)/g) ?? [];
    expect(created).toHaveLength(2);
    expect(uncommented(sql)).toMatch(/idx_aei_org_attested_at[\s\S]*?\(organization_id, attested_at DESC\)/);
    expect(sql).toMatch(/expected 2 named indexes/);
  });

  it('carries no OAuth surface and no backfill', () => {
    // EXECUTABLE SQL, not the raw file: the postcondition's own
    // `attname IN ('access_token', ...)` guard — the check that PROVES no such
    // column exists — is a string literal naming every forbidden column, so a
    // raw scan reports the guard as the violation it guards against.
    const code = executable(sql);
    for (const forbidden of ['access_token', 'refresh_token', 'provider_user_id', 'waba', 'page_access']) {
      expect({ forbidden, present: code.includes(forbidden) })
        .toEqual({ forbidden, present: false });
    }
    // The column list is still asserted where it belongs: on the table itself.
    for (const forbidden of ['access_token', 'refresh_token', 'provider_user_id', 'waba', 'page_access']) {
      expect({ forbidden, present: executable(tableSlice).includes(forbidden) })
        .toEqual({ forbidden, present: false });
    }
    // And the postcondition that enforces it at apply time is still present.
    expect(sql).toMatch(/attname IN \('access_token'/);
    // `social_accounts` and `user_company_roles` are deliberately NOT
    // preconditions: a preflight naming either would give this registry a
    // latent dependency on the OAuth mapping it replaces.
    const preflight = sql.slice(sql.indexOf('DO $preflight$'), sql.indexOf('$preflight$;'));
    expect(preflight).toContain("to_regclass('public.companies')");
    expect(preflight).toContain("to_regclass('public.engagement_authors')");
    expect(preflight).toContain("to_regclass('public.users')");
    expect(preflight).toContain("to_regprocedure('public.omnivyra_touch_updated_at()')");
    expect(preflight).not.toContain('social_accounts');
    expect(preflight).not.toContain('user_company_roles');
    // No INSERT ... SELECT, and the postcondition proves the table is empty.
    expect(code).not.toMatch(/INSERT INTO/i);
    expect(sql).toMatch(/must be empty on arrival/);
  });

  it('enables RLS without FORCE, grants service_role only, and transacts', () => {
    const code = uncommented(sql);
    expect(code).toMatch(/ALTER TABLE public\.attested_engagement_identities ENABLE ROW LEVEL SECURITY/);
    expect(code).not.toMatch(/FORCE ROW LEVEL SECURITY/);
    expect(code).toMatch(/CREATE POLICY attested_engagement_identities_service_role/);
    expect(code).toMatch(/auth\.role\(\) = 'service_role'/);
    // No `authenticated` policy at all — every access is the repository's, on
    // the server credential. The policy is SCOPED on the CREATE itself: `TO
    // service_role` is what makes every other role match no policy, so the
    // clause is pinned rather than merely the policy's name.
    expect(code).not.toMatch(/TO authenticated/);
    expect(code).toMatch(
      /CREATE POLICY attested_engagement_identities_service_role[\s\S]*?\n\s+TO service_role\n/,
    );
    /*
     * THE POSTCONDITION COMPARES THE WHOLE ROLE ARRAY, NOT MEMBERSHIP.
     *
     * What stood here was `expect(sql).toMatch(/no authenticated policy may
     * exist/)` — a scan for the prose heading over a check of the form
     * `'authenticated' = ANY (roles)`. That check COULD NOT FAIL, so the
     * assertion guarded nothing: a policy written without a TO clause reports
     * roles = {public}, never {authenticated}, so the membership test passed
     * while the policy reached `authenticated` THROUGH PUBLIC — the single
     * condition it existed to forbid. The migration now compares the full
     * array, which makes a {public} policy fail at apply time, and that is
     * what is pinned instead.
     */
    expect(code).toMatch(/IF v_roles IS DISTINCT FROM ARRAY\['service_role'\] THEN/);
    expect(code).toMatch(/SELECT roles::text\[\] INTO v_roles FROM pg_policies/);
    // ...and the vacuous membership test is GONE from the executable SQL. It
    // survives only in the comment recording why it was removed, which
    // `uncommented` has already stripped from `code`.
    expect(code).not.toMatch(/=\s*ANY\s*\(\s*roles\s*\)/);
    // EXACTLY ONE policy on the relation after apply. A second policy would be
    // an additional grant of access that no review saw.
    expect(code).toMatch(/IF v_pol <> 1 THEN/);
    expect(sql).toMatch(/expected exactly 1 policy on the relation/);
    // service_role holds EXACTLY the three privileges the one repository uses —
    // a whole-array comparison again, read from pg_class.relacl via aclexplode
    // because information_schema.role_table_grants can read falsely empty and
    // would turn this into another assertion that cannot fail.
    expect(code).toMatch(
      /IF v_priv IS DISTINCT FROM ARRAY\['INSERT', 'SELECT', 'UPDATE'\] THEN/,
    );
    expect(code).toMatch(/CROSS JOIN LATERAL aclexplode\(c\.relacl\)/);
    expect(code).not.toMatch(/information_schema\.role_table_grants/);
    // Nothing else holds anything: the three PostgREST roles by name, and
    // PUBLIC separately, because aclexplode reports a PUBLIC grant as
    // grantee 0, which joins to no pg_roles row and so escapes the check above.
    expect(code).toMatch(/r\.rolname IN \('anon', 'authenticated', 'authenticator'\)/);
    expect(code).toMatch(/a\.grantee = 0/);
    expect(code).toMatch(/IF v_pub <> 0 THEN/);
    // RLS is PROVED enabled and PROVED not forced, from pg_class, not assumed
    // from the ALTER TABLE having been written.
    expect(code).toMatch(
      /SELECT c\.relrowsecurity, c\.relforcerowsecurity INTO v_rls, v_force/,
    );
    expect(code).toMatch(/IF v_rls IS NOT TRUE THEN/);
    expect(code).toMatch(/IF v_force IS NOT FALSE THEN/);
    expect(code.trimStart().startsWith('BEGIN;')).toBe(true);
    expect(code.trimEnd().endsWith('COMMIT;')).toBe(true);
    expect(code).toMatch(/omnivyra_touch_updated_at\(\)/);
    expect(code).toMatch(/FROM pg_trigger/);
  });

  it('CONVERGES a role set that is not exactly {service_role}: drops, then recreates', () => {
    const code = uncommented(sql);
    // The convergence lives in its own dollar-quoted block, so the whole
    // mechanism is read as one slice and a stray DROP elsewhere in the file
    // cannot satisfy any of this.
    const rls = code.slice(code.indexOf('DO $aei_rls$'), code.indexOf('$aei_rls$;'));
    expect(rls).not.toBe('');
    // The guard is a WHOLE-ARRAY inequality on the catalog's role set, so the
    // branch fires for {public} — the shape a policy written with no TO clause
    // actually has — and not only for some named role.
    expect(rls).toMatch(/roles::text\[\] <> ARRAY\['service_role'\]/);
    // The DROP is inside that IF EXISTS branch, never unconditional.
    expect(rls).toMatch(
      /IF EXISTS \([\s\S]*?roles::text\[\] <> ARRAY\['service_role'\][\s\S]*?\) THEN\s*DROP POLICY attested_engagement_identities_service_role/,
    );
    // ...and it is scoped to THIS relation's own policy, by name and by table.
    expect(rls).toMatch(
      /DROP POLICY attested_engagement_identities_service_role\s+ON public\.attested_engagement_identities;/,
    );
    // Drop BEFORE recreate, or convergence would land on the wrong policy.
    const dropAt = rls.search(/DROP POLICY attested_engagement_identities_service_role/);
    const createAt = rls.search(/CREATE POLICY attested_engagement_identities_service_role/);
    expect(dropAt).toBeGreaterThan(-1);
    expect(createAt).toBeGreaterThan(dropAt);
    // The recreate is guarded by ABSENCE, so a policy that is already correct
    // is left alone rather than churned, and the two branches together land on
    // exactly one policy from either starting state.
    expect(rls).toMatch(
      /IF NOT EXISTS \([\s\S]*?policyname = 'attested_engagement_identities_service_role'[\s\S]*?\) THEN\s*CREATE POLICY attested_engagement_identities_service_role/,
    );
    // Whichever branch ran, the postconditions re-read the catalog and demand
    // exactly one policy whose role set is exactly {service_role}. Convergence
    // is therefore asserted on the END STATE, not on the branch having run.
    expect(code).toMatch(/IF v_pol <> 1 THEN/);
    expect(code).toMatch(/IF v_roles IS DISTINCT FROM ARRAY\['service_role'\] THEN/);
  });

  it('does not touch, rename or renumber any other migration', () => {
    const dir = path.join(REPO_ROOT, 'supabase/migrations');
    expect(fs.existsSync(path.join(dir, '20270105000000_pi_prospect_problem_observations.sql'))).toBe(true);
    // This file creates ONE table and alters nothing that already exists.
    const code = uncommented(sql);
    expect(code.match(/CREATE TABLE IF NOT EXISTS/g)).toHaveLength(1);
    const alters = code.match(/ALTER TABLE public\.[a-z_]+/g) ?? [];
    expect(Array.from(new Set(alters)))
      .toEqual(['ALTER TABLE public.attested_engagement_identities']);
    // Destructive DDL against ANY OTHER kind of object stays forbidden
    // outright: no table, column, constraint or index is ever dropped here.
    expect(code).not.toMatch(/DROP\s+(TABLE|COLUMN|CONSTRAINT|INDEX)/i);
    /*
     * `DROP POLICY` was in that list too, and the list is where it stopped
     * being true: the converging DO block now drops a pre-existing policy
     * whose role set is not {service_role} before recreating it correctly.
     * Removing `POLICY` from the pattern alone would have left the file free to
     * drop any policy on any table, so the drop is pinned instead — ONE drop,
     * on this migration's own policy, on this migration's own relation, inside
     * the convergence block. A second drop, or a drop of anything else, fails.
     *
     * `\bDROP\b` rather than /drop/i: `NOT a.attisdropped` in the column
     * postcondition is not a drop, and a case-insensitive scan reads it as one.
     */
    const drops = code.match(/\bDROP\b[\s\S]*?;/g) ?? [];
    expect(drops).toHaveLength(1);
    expect(drops[0]).toMatch(
      /^DROP POLICY attested_engagement_identities_service_role\s+ON public\.attested_engagement_identities;$/,
    );
    const rls = code.slice(code.indexOf('DO $aei_rls$'), code.indexOf('$aei_rls$;'));
    expect(rls).toContain('DROP POLICY attested_engagement_identities_service_role');
  });

  it('has a rollback that drops only this relation', () => {
    const rollbackPath = path.join(
      REPO_ROOT, 'supabase/migrations/rollbacks/pi_attested_engagement_identities_rollback.sql',
    );
    expect(fs.existsSync(rollbackPath)).toBe(true);
    const rollback = fs.readFileSync(rollbackPath, 'utf8');
    const code = uncommented(rollback);
    expect(code).toMatch(/DROP TABLE IF EXISTS public\.attested_engagement_identities;/);
    expect((code.match(/DROP/g) ?? [])).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7 · THE REGISTRY ASSESSES NOTHING, AND HAS ONE WRITER
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-4A · the registry assesses nothing and nothing else opens it', () => {
  const MODULES = [
    'backend/services/engagementIdentity/attestedIdentityContract.ts',
    'backend/services/engagementIdentity/attestedIdentityRepository.ts',
    'supabase/migrations/20270106000000_pi_attested_engagement_identities.sql',
  ];
  const BANNED = ['scorable', 'score', 'dimension', 'weight', 'priority', 'rank'] as const;

  it('no registry module declares an assessment of any kind', () => {
    let scanned = 0;
    for (const rel of MODULES) {
      const src = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      scanned += 1;
      // Strip comments: these files EXPLAIN at length that they assess nothing,
      // and the prose must not be what the scan matches on.
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/^[ \t]*--.*$/gm, '');
      for (const key of BANNED) {
        expect({ rel, key, hit: new RegExp(`\\b${key}\\b`, 'i').test(code) })
          .toEqual({ rel, key, hit: false });
      }
    }
    // Guard the guard: an empty file list would make this vacuously green.
    expect(scanned).toBe(MODULES.length);
    expect(scanned).toBeGreaterThanOrEqual(3);
  });

  it('the repository reaches the database only through the owned write seam', () => {
    const src = fs.readFileSync(path.join(
      REPO_ROOT, 'backend/services/engagementIdentity/attestedIdentityRepository.ts',
    ), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).toMatch(/ownedDbTable/);
    // No raw client, and no OAuth relation.
    expect(code).not.toMatch(/from '\.\.\/\.\.\/db\/supabaseClient'/);
    expect(code).not.toMatch(/supabase\s*\.\s*from\s*\(/);
    expect(code).not.toMatch(/social_accounts/);
    expect(code).not.toMatch(/engagement_authors/);
    // It opens exactly one relation, by the contract's constant.
    const opened = code.match(/ownedDbTable\(\s*([A-Za-z_'"`.]+)/g) ?? [];
    expect(opened.length).toBeGreaterThan(0);
    for (const call of opened) {
      expect(call).toContain('ATTESTED_ENGAGEMENT_IDENTITY_RELATION');
    }
    // `isRelationIllegible` is REUSED, never re-spelled.
    expect(code).toMatch(/isRelationIllegible/);
    expect(code).not.toMatch(/'42P01'/);
    expect(code).not.toMatch(/PGRST205/);
  });

  it('the contract file is imported, not edited into a second normaliser', () => {
    const src = fs.readFileSync(path.join(
      REPO_ROOT, 'backend/services/engagementIdentity/attestedIdentityRepository.ts',
    ), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).toMatch(/from '\.\/attestedIdentityContract'/);
    // No local re-implementation: the repository must not define its own
    // trimming or folding helper for either half of the identity.
    expect(code).not.toMatch(/function\s+normalize/);
    expect(code).not.toMatch(/\.toLowerCase\(\)/);
  });

  it('no file outside backend/services/engagementIdentity opens the registry relation', () => {
    const roots = ['backend', 'pages', 'lib', 'components', 'shared', 'scripts'];
    const owned = path.join('backend', 'services', 'engagementIdentity');
    const offenders: string[] = [];
    let scanned = 0;

    const walk = (dir: string) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '.next') continue;
          walk(full);
        } else if (/\.(ts|tsx|js)$/.test(entry.name)) {
          const relative = path.relative(REPO_ROOT, full);
          if (relative.startsWith(owned)) continue;
          scanned += 1;
          const src = fs.readFileSync(full, 'utf8');
          if (!src.includes(AEI)) continue;
          // A test may NAME the relation; only opening it is the concern.
          const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
          const opens = new RegExp(
            `(?:ownedDbTable|from)\\s*\\(\\s*['"\`](?:public\\.)?${AEI}`,
            'i',
          );
          if (opens.test(code)) offenders.push(relative);
        }
      }
    };
    for (const r of roots) walk(path.join(REPO_ROOT, r));

    expect(offenders).toEqual([]);
    // Guard the guard: a scan that found no files proves nothing.
    expect(scanned).toBeGreaterThan(500);
  });

  it('carries no raw control bytes', () => {
    for (const rel of MODULES) {
      const raw = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      // eslint-disable-next-line no-control-regex
      expect({ rel, hit: /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(raw) })
        .toEqual({ rel, hit: false });
    }
  });
});
