/**
 * PI WS-3D — PROSPECT PROBLEM OBSERVATION: the capture path, invoked.
 *
 * The capability is a seam from a tenant-verified caller, through the admission
 * gate that `offeringIntelligence/problemFit.ts` already owns, into a relation
 * whose migration (`20270105000000`) is AUTHORED AND UNAPPLIED. So the real
 * proof of the CHECKs, the unique index, the composite foreign keys and the
 * CASCADE lives in `backend/tests/realschema/pi_ws3d_problem_observations.test.ts`
 * — which has NOT been run: there is no PostgreSQL and no Docker daemon in this
 * environment, and the embedded-Postgres harness is not in this checkout.
 *
 * What this file does instead is MODEL those storage invariants exactly as the
 * migration declares them, so that
 *   (a) they are pinned somewhere rather than nowhere, and
 *   (b) the repository is shown to map each of them onto the refusal vocabulary
 *       the contract publishes, against the same model.
 *
 * ─── WHAT IS DELIBERATELY NOT RE-LITIGATED HERE ───────────────────────────
 * The six evidence requirements are driven field by field from the published
 * contract in `piWs2cProblemFitBuySide.test.ts`, every inadmissible derivation
 * is driven from `INADMISSIBLE_PROBLEM_DERIVATIONS` there and in
 * `piWs3aProblemFitSourceReverify.test.ts`, and origin-spelling normalisation is
 * pinned at `piWs3aProblemFitSourceReverify.test.ts:199`. This suite asserts
 * DELEGATION to that gate — that a refused candidate writes nothing and that its
 * rejection list travels out unmodified — and never a second copy of the rules.
 *
 * The double RECORDS every call, because most of what matters here is a property
 * of what was SENT rather than of what came back: which columns a write carried,
 * which predicates a read asserted, and how many attempts a replay cost.
 */

type Row = Record<string, unknown>;

/** A PostgreSQL error, as the pg/PostgREST layer surfaces one. */
class PgError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

/** OUR clock, as `recorded_at DEFAULT now()` would set it. Deliberately NOT the
 *  source's instant below: the contract's whole point is that they are two. */
const RECORDED_AT = '2026-10-28T11:30:00.000Z';
const OBSERVED_AT = '2026-09-14T08:15:00.000Z';

const db = {
  tables: {} as Record<string, Row[]>,
  selects: [] as Array<{
    table: string; cols: string; filters: Array<[string, unknown]>;
    orders: Array<[string, { ascending?: boolean; nullsFirst?: boolean }]>; limit: number | null;
  }>,
  inserts: [] as Array<{ table: string; payload: Row }>,
  /** Any non-select operation at all, so "this module writes nothing" is checkable. */
  mutations: [] as Array<{ table: string; op: string }>,
  /** Forces the next insert to fail with this error, for the injected-conflict cases. */
  insertError: null as { code?: string; message?: string; details?: string } | null,
  readErrors: {} as Record<string, { code?: string; message?: string }>,
  throwOn: null as string | null,
  /** When true the fake ignores query predicates, so the ROW-LEVEL re-assertions
   *  are tested rather than the fake's own filtering. */
  ignoreFilters: false,
  nextId: 1,
};

const rowsOf = (table: string): Row[] => {
  if (!db.tables[table]) db.tables[table] = [];
  return db.tables[table];
};

const PPO = 'prospect_problem_observations';

/**
 * The storage invariants of `20270105000000`, modelled. Each raises the SQLSTATE
 * PostgreSQL would raise, so the repository's mapping is tested against the
 * database's own vocabulary rather than against a convenient stand-in.
 */
function assertStorageConstraints(row: Row): void {
  const s = (v: unknown) => (typeof v === 'string' ? v : '');
  const check = (ok: boolean, name: string) => {
    if (!ok) throw new PgError('23514', `new row violates check constraint "${name}"`);
  };

  check(row.entity_type === 'person' || row.entity_type === 'account', 'ppo_entity_type_valid');
  check(
    (row.entity_type === 'person' && row.person_id != null && row.account_id == null)
    || (row.entity_type === 'account' && row.account_id != null && row.person_id == null),
    'ppo_one_subject',
  );
  check(s(row.statement).trim().length > 0, 'ppo_statement_not_blank');
  check(/^[a-f0-9]{64}$/.test(s(row.statement_hash)), 'ppo_statement_hash_shape');
  check(s(row.origin_store).trim().length > 0, 'ppo_origin_store_not_blank');
  check(s(row.origin_record_id).trim().length > 0, 'ppo_origin_record_id_not_blank');
  check(row.origin === 'provider' || row.origin === 'human', 'ppo_origin_valid');
  check(
    (row.origin === 'human' && row.recorded_by_user_id != null)
    || (row.origin === 'provider' && row.recorded_by_user_id == null),
    'ppo_origin_actor',
  );
  check(
    row.confidence == null || (Number(row.confidence) >= 0 && Number(row.confidence) <= 1),
    'ppo_confidence_range',
  );

  // Composite tenant-safe foreign keys: a row can never name a subject, or cite
  // a source record, belonging to another tenant.
  const fk = (parent: string, idCol: string, tenantCol: string, id: unknown) => {
    if (id == null) return;
    const hit = rowsOf(parent).some((r) => r[idCol] === id && r[tenantCol] === row.organization_id);
    if (!hit) {
      throw new PgError('23503', `insert or update on table "${PPO}" violates foreign key constraint`);
    }
  };
  fk('unified_persons', 'id', 'company_id', row.person_id);
  fk('prospect_accounts', 'id', 'organization_id', row.account_id);
  fk('source_records', 'id', 'organization_id', row.source_record_id);

  // uq_ppo_person_origin_statement / uq_ppo_account_origin_statement — TIME-free
  // but SUBJECT-AWARE, and PARTIAL per subject leg.
  //
  // Modelled the way the two indexes actually are, because a double that keyed
  // on (tenant, store, record, hash) alone would make the "two subjects, two
  // rows" cases below fail, while a double that keyed on nothing would make the
  // replay cases pass for the wrong reason. `entity_type` is in the key AND
  // compared explicitly: that explicit compare is what represents PARTIALITY,
  // so a person row is only ever a candidate duplicate of another person row.
  const subjectLeg = (r: Row) => (r.entity_type === 'person' ? r.person_id : r.account_id);
  const key = (r: Row) => [
    r.organization_id, r.origin_store, r.origin_record_id, r.statement_hash,
    r.entity_type, subjectLeg(r),
  ].join('\u0000');
  const violated = row.entity_type === 'person'
    ? 'uq_ppo_person_origin_statement'
    : 'uq_ppo_account_origin_statement';
  if (rowsOf(PPO).some((r) => r.entity_type === row.entity_type && key(r) === key(row))) {
    throw new PgError('23505', `duplicate key value violates unique constraint "${violated}"`);
  }
}

/**
 * `ppo_person_tenant_fk ... ON DELETE CASCADE` — the words go with the person.
 * Modelled so the erasure consequence is pinned here too; the application-level
 * case lives in `piWsfPersonErasure.test.ts`.
 */
const cascadePersonDelete = (companyId: string, personId: string): void => {
  db.tables.unified_persons = rowsOf('unified_persons')
    .filter((p) => !(p.id === personId && p.company_id === companyId));
  db.tables[PPO] = rowsOf(PPO)
    .filter((r) => !(r.person_id === personId && r.organization_id === companyId));
};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const st = {
      op: 'select',
      cols: '',
      filters: [] as Array<[string, unknown]>,
      orders: [] as Array<[string, { ascending?: boolean; nullsFirst?: boolean }]>,
      limit: null as number | null,
      payload: null as Row | null,
    };

    const exec = async (mode: 'many' | 'single') => {
      await Promise.resolve();
      if (st.op !== 'select') db.mutations.push({ table, op: st.op });

      if (st.op === 'insert') {
        const payload = st.payload as Row;
        db.inserts.push({ table, payload });
        if (db.insertError) return { data: null, error: db.insertError };
        try {
          if (table === PPO) assertStorageConstraints(payload);
        } catch (e) {
          const pg = e as PgError;
          return { data: null, error: { code: pg.code, message: pg.message, details: pg.message } };
        }
        const created: Row = { id: `ppo-${db.nextId++}`, recorded_at: RECORDED_AT, ...payload };
        rowsOf(table).push(created);
        return { data: created, error: null };
      }

      db.selects.push({ table, cols: st.cols, filters: st.filters, orders: st.orders, limit: st.limit });
      if (db.throwOn === table) throw new Error('transport exploded');
      const err = db.readErrors[table];
      if (err) return { data: null, error: err };

      let found = db.ignoreFilters
        ? rowsOf(table).slice()
        : rowsOf(table).filter((r) => st.filters.every(([c, v]) => r[c] === v));

      if (st.orders.length > 0) {
        found = found.slice().sort((a, b) => {
          for (const [col, opt] of st.orders) {
            const av = a[col] ?? null;
            const bv = b[col] ?? null;
            if (av === null && bv === null) continue;
            // PostgREST's nullsFirst, as the repository passes it explicitly.
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
      eq: (c: string, v: unknown) => { st.filters.push([c, v]); return b; },
      is: (c: string, v: unknown) => { st.filters.push([c, v]); return b; },
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
    from: () => { throw new Error('the capture path must not reach the table API directly'); },
  },
}));

const logs: Array<{ level: string; event: string; ctx: unknown }> = [];
jest.mock('../../services/logger', () => ({
  logger: {
    warn: (event: string, ctx: unknown) => { logs.push({ level: 'warn', event, ctx }); },
    error: (event: string, ctx: unknown) => { logs.push({ level: 'error', event, ctx }); },
    info: () => {}, debug: () => {},
  },
}));

import { createHash } from 'node:crypto';
import fs from 'fs';
import path from 'path';
import {
  PROBLEM_OBSERVATION_READ_LIMIT_DEFAULT,
  PROBLEM_OBSERVATION_READ_LIMIT_MAX,
  computeStatementHash,
  readProblemObservations,
  recordProblemObservation,
} from '../../services/prospectProblems/problemObservationRepository';
import {
  PROBLEM_OBSERVATION_INGESTION_PERFORMS_NO_WRITE,
  defaultProblemObservationPorts,
  readProspectProblemObservations,
  recordProspectProblemObservation,
  type ProblemObservationCapture,
} from '../../services/prospectProblems/problemObservationIngestion';
import {
  PROBLEM_OBSERVATION_CONTRACT_VERSION,
  PROBLEM_OBSERVATION_RELATION,
  SELF_ATTRIBUTED_ORIGIN_STORES,
  type ProblemObservationInput,
} from '../../services/prospectProblems/types';
import {
  PROBLEM_FIT_CANDIDATE_STORES,
  PROBLEM_FIT_CONTRACT_VERSION,
  auditedProblemSource,
} from '../../services/offeringIntelligence/problemFit';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const ORG_A = 'org-a';
const ORG_B = 'org-b';
const LEAD_A = 'lead-a';
const PERSON_A = 'person-a';
const ACCOUNT_A = 'account-a';
const USER_A = 'user-a';
const SOURCE_REC = 'srec-1';
const STATEMENT = 'our three dashboards disagree and nobody can say which one to take to the board';
const STORE = 'crm_call_notes';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

const seedSpine = (over: { org?: string; accountId?: string | null } = {}) => {
  const org = over.org ?? ORG_A;
  const accountId = over.accountId === undefined ? ACCOUNT_A : over.accountId;
  rowsOf('canonical_leads').push({ id: LEAD_A, company_id: org, unified_person_id: PERSON_A });
  rowsOf('unified_persons').push({ id: PERSON_A, company_id: org, account_id: accountId });
  if (accountId) rowsOf('prospect_accounts').push({ id: accountId, organization_id: org });
  rowsOf('source_records').push({ id: SOURCE_REC, organization_id: org });
};

/** A complete capture, as the route would hand one over. */
const capture = (over: Partial<ProblemObservationCapture> = {}): ProblemObservationCapture => ({
  organizationId: ORG_A,
  prospectId: LEAD_A,
  subjectType: 'person',
  statement: STATEMENT,
  statementLanguage: 'en',
  origin: { store: STORE, recordId: 'call-2026-09-14' },
  originKind: 'provider',
  recordedByUserId: null,
  sourceRecordId: SOURCE_REC,
  observedAt: OBSERVED_AT,
  confidence: 0.7,
  ...over,
});

/** A direct repository input, bypassing resolution. */
const stored = (over: Partial<ProblemObservationInput> = {}): ProblemObservationInput => ({
  organizationId: ORG_A,
  prospectId: LEAD_A,
  subjectType: 'person',
  subjectId: PERSON_A,
  statement: STATEMENT,
  statementLanguage: 'en',
  origin: { store: STORE, recordId: 'call-2026-09-14' },
  originKind: 'provider',
  recordedByUserId: null,
  sourceRecordId: SOURCE_REC,
  observedAt: OBSERVED_AT,
  confidence: 0.7,
  ...over,
});

/** A row as the relation would hold it, for read-path cases. */
const seedObservation = (over: Row = {}): Row => {
  const row: Row = {
    id: `seed-${db.nextId++}`,
    organization_id: ORG_A,
    entity_type: 'person',
    person_id: PERSON_A,
    account_id: null,
    statement: STATEMENT,
    statement_hash: sha(STATEMENT),
    statement_language: 'en',
    origin_store: STORE,
    origin_record_id: `call-${db.nextId}`,
    origin: 'provider',
    recorded_by_user_id: null,
    source_record_id: SOURCE_REC,
    confidence: 0.7,
    observed_at: OBSERVED_AT,
    recorded_at: RECORDED_AT,
    ...over,
  };
  rowsOf(PPO).push(row);
  return row;
};

const observationInserts = () => db.inserts.filter((i) => i.table === PPO);
const observationRows = () => rowsOf(PPO);

beforeEach(() => {
  db.tables = {};
  db.selects = []; db.inserts = []; db.mutations = [];
  db.insertError = null; db.readErrors = {}; db.throwOn = null;
  db.ignoreFilters = false; db.nextId = 1;
  logs.length = 0;
});

// ═══════════════════════════════════════════════════════════════════════════
// 1 · VALID ROUND-TRIP
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-3D · a stated problem is captured verbatim and read back', () => {
  it('stores the statement exactly as stated, with its origin, its source time and its confidence', async () => {
    seedSpine();

    const res = await recordProspectProblemObservation(capture());

    expect(res).toMatchObject({ ok: true, duplicate: false });
    expect(observationInserts()).toHaveLength(1);
    const payload = observationInserts()[0].payload;
    // VERBATIM. No casefolding, no punctuation stripping, no summary.
    expect(payload.statement).toBe(STATEMENT);
    expect(payload.statement_hash).toBe(sha(STATEMENT));
    expect(payload).toMatchObject({
      organization_id: ORG_A,
      entity_type: 'person',
      person_id: PERSON_A,
      account_id: null,
      statement_language: 'en',
      origin_store: STORE,
      origin_record_id: 'call-2026-09-14',
      origin: 'provider',
      recorded_by_user_id: null,
      source_record_id: SOURCE_REC,
      confidence: 0.7,
      observed_at: OBSERVED_AT,
    });
    // THE INGEST CLOCK IS NOT THE SOURCE CLOCK, and the write never sets it.
    expect(Object.keys(payload)).not.toContain('recorded_at');
    // The resolution route the caller arrived by is NOT a fourth subject.
    expect(Object.keys(payload)).not.toContain('prospect_id');
  });

  it('reads it back with the two clocks distinct, and the subject it resolved to', async () => {
    seedSpine();
    await recordProspectProblemObservation(capture());

    const read = await readProspectProblemObservations({
      organizationId: ORG_A, prospectId: LEAD_A, subjectType: 'person',
    });

    expect(read).toMatchObject({ ok: true, subjectType: 'person', subjectId: PERSON_A });
    if (read.ok !== true) throw new Error('unreachable');
    expect(read.read.state).toBe('available');
    expect(read.read.observations).toHaveLength(1);
    const obs = read.read.observations[0];
    expect(obs.statement).toBe(STATEMENT);
    expect(obs.observedAt).toBe(OBSERVED_AT);
    expect(obs.recordedAt).toBe(RECORDED_AT);
    // The property the contract is built on: one is never read for the other.
    expect(obs.recordedAt).not.toBe(obs.observedAt);
    expect(obs).toMatchObject({
      organizationId: ORG_A, subjectType: 'person', subjectId: PERSON_A,
      originStore: STORE, originKind: 'provider', confidence: 0.7, statementLanguage: 'en',
    });
  });

  it('attributes an account-subject statement to the account, and nothing else', async () => {
    seedSpine();

    const res = await recordProspectProblemObservation(capture({ subjectType: 'account' }));

    expect(res).toMatchObject({ ok: true });
    expect(observationInserts()[0].payload).toMatchObject({
      entity_type: 'account', account_id: ACCOUNT_A, person_id: null,
    });
  });

  it('orders on the SOURCE clock with unstated times LAST, tie-broken by our own', async () => {
    seedSpine();
    seedObservation({ id: 'o-old', observed_at: '2026-01-01T00:00:00.000Z' });
    seedObservation({ id: 'o-new', observed_at: '2026-10-01T00:00:00.000Z' });
    seedObservation({ id: 'o-null-a', observed_at: null, recorded_at: '2026-02-01T00:00:00.000Z' });
    seedObservation({ id: 'o-null-b', observed_at: null, recorded_at: '2026-03-01T00:00:00.000Z' });

    const read = await readProblemObservations({
      organizationId: ORG_A, subjectType: 'person', subjectId: PERSON_A,
    });

    expect(read.state).toBe('available');
    // A statement whose time the source never gave must not sort as the most
    // recent thing the prospect said.
    expect(read.observations.map((o) => o.id)).toEqual(['o-new', 'o-old', 'o-null-b', 'o-null-a']);
    // ...and the order was asked for, not merely obtained.
    const q = db.selects.find((s) => s.table === PPO);
    expect(q?.orders).toEqual([
      ['observed_at', { ascending: false, nullsFirst: false }],
      ['recorded_at', { ascending: false }],
    ]);
  });

  it('bounds every read, clamps an over-large limit and never selects *', async () => {
    seedSpine();
    await readProblemObservations({ organizationId: ORG_A, subjectType: 'person', subjectId: PERSON_A });
    await readProblemObservations({
      organizationId: ORG_A, subjectType: 'person', subjectId: PERSON_A,
      limit: PROBLEM_OBSERVATION_READ_LIMIT_MAX + 5000,
    });

    const reads = db.selects.filter((s) => s.table === PPO);
    expect(reads[0].limit).toBe(PROBLEM_OBSERVATION_READ_LIMIT_DEFAULT);
    expect(reads[1].limit).toBe(PROBLEM_OBSERVATION_READ_LIMIT_MAX);
    for (const r of reads) expect(r.cols).not.toBe('*');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 · CROSS-TENANT, BOTH WAYS
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-3D · the tenant is a predicate AND a re-assertion', () => {
  it('asserts the tenant in every query it issues, on the spine and on the relation', async () => {
    seedSpine();
    await recordProspectProblemObservation(capture());
    await readProspectProblemObservations({
      organizationId: ORG_A, prospectId: LEAD_A, subjectType: 'person',
    });

    expect(db.selects.length).toBeGreaterThan(0);
    for (const s of db.selects) {
      const tenantFilters = s.filters.filter(
        ([c, v]) => (c === 'organization_id' || c === 'company_id') && v === ORG_A,
      );
      expect(tenantFilters.length).toBeGreaterThanOrEqual(1);
    }
    // The relation read leads with the tenant, before the subject.
    const rel = db.selects.find((s) => s.table === PPO);
    expect(rel?.filters[0]).toEqual(['organization_id', ORG_A]);
  });

  it('drops a foreign-tenant row from the returned set even when the query does not filter', async () => {
    // The predicate is what makes the query correct; the re-assertion is what
    // keeps it correct if the query is ever edited wrongly.
    seedObservation({ id: 'mine' });
    seedObservation({ id: 'theirs', organization_id: ORG_B });
    db.ignoreFilters = true;

    const read = await readProblemObservations({
      organizationId: ORG_A, subjectType: 'person', subjectId: PERSON_A,
    });

    expect(read.state).toBe('available');
    expect(read.observations.map((o) => o.id)).toEqual(['mine']);
  });

  it('drops a row for ANOTHER SUBJECT in the same tenant, even unfiltered', async () => {
    seedObservation({ id: 'mine' });
    seedObservation({ id: 'other-person', person_id: 'person-z' });
    seedObservation({ id: 'other-kind', entity_type: 'account', person_id: null, account_id: ACCOUNT_A });
    db.ignoreFilters = true;

    const read = await readProblemObservations({
      organizationId: ORG_A, subjectType: 'person', subjectId: PERSON_A,
    });

    expect(read.observations.map((o) => o.id)).toEqual(['mine']);
  });

  it('refuses a prospect that resolves to another tenant, and never records it', async () => {
    rowsOf('canonical_leads').push({ id: LEAD_A, company_id: ORG_B, unified_person_id: PERSON_A });
    rowsOf('unified_persons').push({ id: PERSON_A, company_id: ORG_B, account_id: ACCOUNT_A });
    db.ignoreFilters = true;      // the query would have excluded it; the row check must

    const res = await recordProspectProblemObservation(capture());

    expect(res).toMatchObject({ ok: false, refusal: 'subject_other_tenant' });
    expect(observationInserts()).toEqual([]);
    // The distinction is kept in the LOGS and nowhere a client can see it.
    expect(logs.some((l) => l.event === 'problem_observation_subject_unresolved')).toBe(true);
  });

  it('refuses a person that resolves to another tenant behind a same-tenant lead', async () => {
    rowsOf('canonical_leads').push({ id: LEAD_A, company_id: ORG_A, unified_person_id: PERSON_A });
    rowsOf('unified_persons').push({ id: PERSON_A, company_id: ORG_B, account_id: ACCOUNT_A });
    db.ignoreFilters = true;

    const res = await recordProspectProblemObservation(capture());

    expect(res).toMatchObject({ ok: false, refusal: 'subject_other_tenant' });
    expect(observationInserts()).toEqual([]);
  });

  it('refuses an account that resolves to another tenant behind a same-tenant person', async () => {
    rowsOf('canonical_leads').push({ id: LEAD_A, company_id: ORG_A, unified_person_id: PERSON_A });
    rowsOf('unified_persons').push({ id: PERSON_A, company_id: ORG_A, account_id: ACCOUNT_A });
    rowsOf('prospect_accounts').push({ id: ACCOUNT_A, organization_id: ORG_B });
    db.ignoreFilters = true;

    const res = await recordProspectProblemObservation(capture({ subjectType: 'account' }));

    expect(res).toMatchObject({ ok: false, refusal: 'subject_other_tenant' });
    expect(observationInserts()).toEqual([]);
  });

  it('a blank tenant is a programming error and THROWS, on every entry point', async () => {
    seedSpine();
    for (const organizationId of ['', '   ']) {
      await expect(recordProspectProblemObservation(capture({ organizationId })))
        .rejects.toThrow(/organizationId is required/);
      await expect(readProspectProblemObservations({
        organizationId, prospectId: LEAD_A, subjectType: 'person',
      })).rejects.toThrow(/organizationId is required/);
      await expect(recordProblemObservation(stored({ organizationId })))
        .rejects.toThrow(/organizationId is required/);
      await expect(readProblemObservations({
        organizationId, subjectType: 'person', subjectId: PERSON_A,
      })).rejects.toThrow(/organizationId is required/);
    }
    expect(observationInserts()).toEqual([]);
  });

  it('a statement attributed to nothing is never stored', async () => {
    await expect(recordProblemObservation(stored({ subjectId: '  ' })))
      .rejects.toThrow(/subjectId is required/);
    await expect(readProblemObservations({
      organizationId: ORG_A, subjectType: 'person', subjectId: '',
    })).rejects.toThrow(/subjectId is required/);
    expect(observationInserts()).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 · INVALID EVIDENCE — DELEGATION, NOT A SECOND CONTRACT
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-3D · the admission gate decides, and this path only delegates', () => {
  it('a refused candidate writes NOTHING and carries the gate\'s rejections unmodified', async () => {
    seedSpine();
    // One refusal is enough: the six fields are driven field by field from the
    // published contract in piWs2cProblemFitBuySide.test.ts, and every
    // inadmissible derivation from INADMISSIBLE_PROBLEM_DERIVATIONS there.
    const res = await recordProspectProblemObservation(capture({ observedAt: 'last tuesday' }));

    expect(res).toMatchObject({ ok: false, refusal: 'inadmissible_evidence' });
    if (res.ok !== false) throw new Error('unreachable');
    expect(observationInserts()).toEqual([]);
    expect(observationRows()).toEqual([]);
    expect(db.mutations).toEqual([]);

    // The gate's own words, so a writer fixes one record against one definition.
    const why = res.rejections.find((r) => r.field === 'observedAt');
    expect(why).toBeDefined();
    expect(why!.reason).toMatch(/ingest time is not an observation time/);
    // Widened in shape only — nothing was reworded, re-grouped or dropped.
    for (const r of res.rejections) {
      expect(typeof r.field).toBe('string');
      expect(typeof r.reason).toBe('string');
      expect(Object.keys(r).sort()).toEqual(['field', 'reason']);
    }
  });

  it('reports EVERY unmet requirement at once, not the first one', async () => {
    seedSpine();
    const res = await recordProspectProblemObservation(capture({
      statement: '   ', observedAt: null as unknown as string, confidence: 9,
    }));

    expect(res).toMatchObject({ ok: false, refusal: 'inadmissible_evidence' });
    if (res.ok !== false) throw new Error('unreachable');
    expect(res.rejections.map((r) => r.field).sort())
      .toEqual(['confidence', 'observedAt', 'statement']);
    expect(observationInserts()).toEqual([]);
  });

  it('the gate runs AFTER the subject is resolved, so it is never handed a guessed subject', async () => {
    // No spine at all: the subject refusal must come first, and the gate — which
    // would also have refused this record — must not be what answered.
    const res = await recordProspectProblemObservation(capture({ statement: '  ' }));

    expect(res).toMatchObject({ ok: false, refusal: 'subject_not_found' });
    expect(observationInserts()).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5 · MISSING OPTIONAL EVIDENCE — ABSENCE IS NEVER FILLED IN
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-3D · an absent confidence stays absent and the source clock is never substituted', () => {
  it('writes confidence NULL and observed_at EXACTLY as the source reported it', async () => {
    seedSpine();

    const res = await recordProspectProblemObservation(capture({
      confidence: null, statementLanguage: null, sourceRecordId: null,
    }));

    expect(res).toMatchObject({ ok: true });
    const payload = observationInserts()[0].payload;
    // The stored payload, column by column — the shape that cannot be satisfied
    // by a default standing in for evidence.
    expect(payload.confidence).toBeNull();
    expect(payload.statement_language).toBeNull();
    expect(payload.source_record_id).toBeNull();
    expect(payload.observed_at).toBe(OBSERVED_AT);
    expect(payload.observed_at).not.toBe(RECORDED_AT);
    // Nothing was defaulted on the way out either.
    const read = await readProblemObservations({
      organizationId: ORG_A, subjectType: 'person', subjectId: PERSON_A,
    });
    expect(read.observations[0]).toMatchObject({
      confidence: null, statementLanguage: null, sourceRecordId: null, observedAt: OBSERVED_AT,
    });
  });

  it('a confidence of 0 is a RECORDED zero and survives as one', async () => {
    seedSpine();
    await recordProspectProblemObservation(capture({ confidence: 0 }));
    expect(observationInserts()[0].payload.confidence).toBe(0);
  });

  it('a blank statement language is stored as NULL, never as an empty string', async () => {
    seedSpine();
    await recordProspectProblemObservation(capture({ statementLanguage: '   ' }));
    expect(observationInserts()[0].payload.statement_language).toBeNull();
  });

  it('the write carries exactly the declared columns and no clock, id or score of its own', async () => {
    seedSpine();
    await recordProspectProblemObservation(capture());

    expect(Object.keys(observationInserts()[0].payload).sort()).toEqual([
      'account_id', 'confidence', 'entity_type', 'observed_at', 'organization_id', 'origin',
      'origin_record_id', 'origin_store', 'person_id', 'recorded_by_user_id', 'source_record_id',
      'statement', 'statement_hash', 'statement_language',
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6 · PROVENANCE INTEGRITY
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-3D · evidence may not cite itself, and who recorded it must match how', () => {
  it('refuses an origin naming the capture relation, before any database round trip', async () => {
    seedSpine();
    for (const store of SELF_ATTRIBUTED_ORIGIN_STORES) {
      db.selects = []; db.inserts = [];
      const res = await recordProspectProblemObservation(capture({
        origin: { store, recordId: 'rec-1' },
      }));
      expect(res).toMatchObject({ ok: false, refusal: 'self_attributed_origin' });
      expect(observationInserts()).toEqual([]);
      // Decidable from the request alone, so nothing was spent on it.
      expect(db.selects).toEqual([]);
    }
  });

  it('cannot be bypassed by spelling — case and a `public.` qualifier name the same relation', async () => {
    seedSpine();
    for (const store of [
      PROBLEM_OBSERVATION_RELATION,
      PROBLEM_OBSERVATION_RELATION.toUpperCase(),
      `public.${PROBLEM_OBSERVATION_RELATION}`,
      `PUBLIC.${PROBLEM_OBSERVATION_RELATION.toUpperCase()}`,
      `  ${PROBLEM_OBSERVATION_RELATION}  `,
    ]) {
      const res = await recordProspectProblemObservation(capture({
        origin: { store, recordId: 'rec-1' },
      }));
      expect(res).toMatchObject({ ok: false, refusal: 'self_attributed_origin' });
    }
    expect(observationInserts()).toEqual([]);
  });

  it('refuses a human origin with nobody recording it, and a provider origin with somebody', async () => {
    seedSpine();

    const anonymous = await recordProspectProblemObservation(capture({
      originKind: 'human', recordedByUserId: null,
    }));
    expect(anonymous).toMatchObject({ ok: false, refusal: 'origin_actor_incoherent' });
    expect(anonymous.ok === false && anonymous.detail).toMatch(/never anonymous/);

    const attributed = await recordProspectProblemObservation(capture({
      originKind: 'provider', recordedByUserId: USER_A,
    }));
    expect(attributed).toMatchObject({ ok: false, refusal: 'origin_actor_incoherent' });

    const unknownKind = await recordProspectProblemObservation(capture({
      originKind: 'operator' as unknown as 'human',
    }));
    expect(unknownKind).toMatchObject({ ok: false, refusal: 'origin_actor_incoherent' });

    expect(observationInserts()).toEqual([]);
  });

  it('records a human-attested statement with the recording user named', async () => {
    seedSpine();
    rowsOf('users').push({ id: USER_A });

    const res = await recordProspectProblemObservation(capture({
      originKind: 'human', recordedByUserId: USER_A,
    }));

    expect(res).toMatchObject({ ok: true });
    expect(observationInserts()[0].payload).toMatchObject({
      origin: 'human', recorded_by_user_id: USER_A,
    });
  });

  it('IGNORES a caller-supplied derivedFrom — the seam attests the statement itself', async () => {
    seedSpine();
    // `derivedFrom` is not part of the capture contract. A caller that supplies
    // one anyway must not be able to declare its own admissibility: the gate is
    // still handed `prospect_statement`, so a refused derivation cannot sneak in
    // and an accepted one cannot be claimed.
    const res = await recordProspectProblemObservation({
      ...capture(), derivedFrom: 'revenue',
    } as ProblemObservationCapture);

    expect(res).toMatchObject({ ok: true });
    expect(Object.keys(observationInserts()[0].payload)).not.toContain('derived_from');
    expect(Object.keys(observationInserts()[0].payload)).not.toContain('derivedFrom');
  });

  it('hashes the trimmed statement with the house convention, and normalises nothing else', () => {
    expect(computeStatementHash(`  ${STATEMENT}  `)).toBe(sha(STATEMENT));
    // Independently recomputed, so a changed helper is a failure rather than a
    // silently-agreeing pair of implementations.
    expect(computeStatementHash(STATEMENT)).toMatch(/^[a-f0-9]{64}$/);
    // No casefolding, no punctuation stripping, no stemming: two different
    // utterances must not quietly merge into one.
    expect(computeStatementHash('Our dashboards disagree'))
      .not.toBe(computeStatementHash('our dashboards disagree'));
    expect(computeStatementHash('our dashboards disagree'))
      .not.toBe(computeStatementHash('our dashboards disagree.'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7 · RETRY / DUPLICATE
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-3D · a replay is a success, not a second row', () => {
  it('an INJECTED 23505 is reported as an idempotent success naming the row that won', async () => {
    seedSpine();
    const winner = seedObservation({ id: 'winner', origin_record_id: 'call-2026-09-14' });
    db.insertError = { code: '23505', message: 'duplicate key value violates unique constraint "uq_ppo_person_origin_statement"' };

    const res = await recordProspectProblemObservation(capture());

    expect(res).toEqual({ ok: true, observationId: 'winner', duplicate: true });
    // Proven by BOTH counts: one attempt was made, and one row exists.
    expect(observationInserts()).toHaveLength(1);
    expect(observationRows()).toHaveLength(1);
    expect(observationRows()[0]).toBe(winner);
    // The recovery read happened AFTER the database decided, keyed exactly on
    // the idempotency key, and under the tenant. The last two predicates are
    // the SUBJECT: the key is subject-aware, so a recovery read that omitted
    // them would match every subject sharing this statement in this source
    // record and answer with the wrong row. Asserted as exact equality, so an
    // added or dropped predicate fails here rather than passing silently.
    const recovery = db.selects.filter((s) => s.table === PPO);
    expect(recovery).toHaveLength(1);
    expect(recovery[0].filters).toEqual([
      ['organization_id', ORG_A],
      ['origin_store', STORE],
      ['origin_record_id', 'call-2026-09-14'],
      ['statement_hash', sha(STATEMENT)],
      ['entity_type', 'person'],
      ['person_id', PERSON_A],
    ]);
  });

  it('a genuine replay through the real unique index costs two attempts and stores one row', async () => {
    seedSpine();

    const first = await recordProspectProblemObservation(capture());
    const second = await recordProspectProblemObservation(capture());

    expect(first).toMatchObject({ ok: true, duplicate: false });
    expect(second).toMatchObject({ ok: true, duplicate: true });
    expect(first.ok === true && second.ok === true && first.observationId)
      .toBe(second.ok === true ? second.observationId : null);
    expect(observationInserts()).toHaveLength(2);     // attempts
    expect(observationRows()).toHaveLength(1);        // stored
  });

  it('the SAME statement for a DIFFERENT subject kind is a distinct observation', async () => {
    // This test previously asserted the opposite, on the reasoning that a
    // statement recorded before identity resolved must not duplicate once it
    // did. That reasoning was unreachable: `ppo_one_subject` requires the
    // declared leg to be NOT NULL, so this table never holds a subjectless
    // observation, and the only thing the subject-free key actually did was
    // discard an attribution. A person and an account are different subjects.
    seedSpine();
    rowsOf('prospect_accounts').push({ id: 'account-later', organization_id: ORG_A });

    const first = await recordProblemObservation(stored());
    const second = await recordProblemObservation(stored({
      subjectType: 'account', subjectId: 'account-later', observedAt: '2026-09-14T08:15:00.999Z',
    }));

    expect(first).toMatchObject({ ok: true, duplicate: false });
    expect(second).toMatchObject({ ok: true, duplicate: false });
    expect(observationRows()).toHaveLength(2);
    // Each row keeps its own subject: neither was folded into the other.
    expect(observationRows().map((r) => r.entity_type).sort()).toEqual(['account', 'person']);
  });

  it('two DIFFERENT PEOPLE stating the same words in one source record are two observations', async () => {
    // The attribution the subject-free key silently discarded. One call record
    // naming two people who each said the same sentence holds two statements.
    seedSpine();
    rowsOf('unified_persons').push({ id: 'person-two', company_id: ORG_A, account_id: ACCOUNT_A });

    const first = await recordProblemObservation(stored());
    const second = await recordProblemObservation(stored({ subjectId: 'person-two' }));

    expect(first).toMatchObject({ ok: true, duplicate: false });
    expect(second).toMatchObject({ ok: true, duplicate: false });
    expect(observationRows()).toHaveLength(2);
    // Same origin record and same statement: ONLY the subject differs.
    expect(new Set(observationRows().map((r) => r.origin_record_id)).size).toBe(1);
    expect(new Set(observationRows().map((r) => r.statement_hash)).size).toBe(1);
    expect(observationRows().map((r) => r.person_id).sort())
      .toEqual([PERSON_A, 'person-two'].sort());
  });

  it('two DIFFERENT ACCOUNTS stating the same words in one source record are two observations', async () => {
    seedSpine();
    rowsOf('prospect_accounts').push({ id: 'account-two', organization_id: ORG_A });

    const first = await recordProblemObservation(stored({ subjectType: 'account', subjectId: ACCOUNT_A }));
    const second = await recordProblemObservation(stored({ subjectType: 'account', subjectId: 'account-two' }));

    expect(first).toMatchObject({ ok: true, duplicate: false });
    expect(second).toMatchObject({ ok: true, duplicate: false });
    expect(observationRows()).toHaveLength(2);
    expect(observationRows().map((r) => r.account_id).sort())
      .toEqual(['account-two', ACCOUNT_A].sort());
  });

  it('a retry for the SAME person is still a replay, not a second row', async () => {
    seedSpine();
    const first = await recordProblemObservation(stored());
    const again = await recordProblemObservation(stored({ observedAt: '2026-09-14T08:15:00.999Z' }));

    expect(first).toMatchObject({ ok: true, duplicate: false });
    expect(again).toMatchObject({ ok: true, duplicate: true });
    // The replay recovers the FIRST row's identifier, not a sibling subject's.
    expect(again.ok === true && again.observationId)
      .toBe(first.ok === true ? first.observationId : null);
    expect(observationRows()).toHaveLength(1);
  });

  it('a retry for the SAME account is still a replay', async () => {
    seedSpine();
    const first = await recordProblemObservation(stored({ subjectType: 'account', subjectId: ACCOUNT_A }));
    const again = await recordProblemObservation(stored({ subjectType: 'account', subjectId: ACCOUNT_A }));

    expect(first).toMatchObject({ ok: true, duplicate: false });
    expect(again).toMatchObject({ ok: true, duplicate: true });
    expect(observationRows()).toHaveLength(1);
  });

  it('the replay recovery read is keyed on the SUBJECT too, so it cannot return a sibling', async () => {
    // With two subjects' rows present for one (store, record, statement), a
    // subject-free recovery read would have matched both rows and answered with
    // whichever came back first, or failed its single-row read and reported
    // `store_unavailable` for what was a clean replay. The predicates are the
    // proof that the read is as narrow as the constraint that raised 23505.
    seedSpine();
    rowsOf('unified_persons').push({ id: 'person-two', company_id: ORG_A, account_id: ACCOUNT_A });
    await recordProblemObservation(stored());
    await recordProblemObservation(stored({ subjectId: 'person-two' }));

    db.selects.length = 0;
    const replay = await recordProblemObservation(stored({ subjectId: 'person-two' }));
    expect(replay).toMatchObject({ ok: true, duplicate: true });

    const recovery = db.selects.filter((q) => q.table === PPO).pop();
    const cols = (recovery?.filters ?? []).map(([c]: [string, unknown]) => c);
    expect(cols).toEqual(expect.arrayContaining([
      'organization_id', 'origin_store', 'origin_record_id', 'statement_hash',
      'entity_type', 'person_id',
    ]));
    expect(recovery?.filters).toEqual(expect.arrayContaining([['person_id', 'person-two']]));
  });

  it('a 23505 that is NOT the idempotency key degrades to store_unavailable, never a false duplicate', async () => {
    // The repository branches on the SQLSTATE, not on a constraint name, so it
    // cannot parse WHICH unique index was violated — and it does not need to.
    // The recovery read is itself the discriminator: it is keyed on the
    // idempotency key, so an unrelated unique violation finds no row and the
    // write is reported as unavailable rather than as a successful replay.
    // Reporting a duplicate here would claim the statement was already stored
    // when it was not.
    seedSpine();
    db.insertError = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "prospect_problem_observations_pkey"',
    };

    const result = await recordProblemObservation(stored());
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.refusal).toBe('store_unavailable');
    expect(observationRows()).toHaveLength(0);
  });

  it('two genuinely distinct observations are NOT collapsed', async () => {
    seedSpine();

    // Different words in the same source record.
    await recordProspectProblemObservation(capture());
    const differentWords = await recordProspectProblemObservation(capture({
      statement: 'renewals slip because nobody owns the handover',
    }));
    // The same words in a different source record.
    const differentRecord = await recordProspectProblemObservation(capture({
      origin: { store: STORE, recordId: 'call-2026-10-02' },
    }));
    // The same words in a different STORE.
    const differentStore = await recordProspectProblemObservation(capture({
      origin: { store: 'email_threads', recordId: 'call-2026-09-14' },
    }));

    for (const r of [differentWords, differentRecord, differentStore]) {
      expect(r).toMatchObject({ ok: true, duplicate: false });
    }
    expect(observationRows()).toHaveLength(4);
    expect(new Set(observationRows().map((r) => r.id)).size).toBe(4);
  });

  it('the same statement in another TENANT is a separate observation', async () => {
    seedSpine();
    rowsOf('canonical_leads').push({ id: 'lead-b', company_id: ORG_B, unified_person_id: 'person-b' });
    rowsOf('unified_persons').push({ id: 'person-b', company_id: ORG_B, account_id: null });
    // The cited source record is tenant-scoped too, so the other tenant needs
    // its own; a cross-tenant citation is refused by the provenance leg above.
    rowsOf('source_records').push({ id: SOURCE_REC, organization_id: ORG_B });

    await recordProspectProblemObservation(capture());
    const other = await recordProspectProblemObservation(capture({
      organizationId: ORG_B, prospectId: 'lead-b',
    }));

    expect(other).toMatchObject({ ok: true, duplicate: false });
    expect(observationRows()).toHaveLength(2);
  });

  it('a conflict whose winning row cannot be located is NOT reported as a success', async () => {
    seedSpine();
    db.insertError = { code: '23505', message: 'duplicate key value violates unique constraint "uq_ppo_person_origin_statement"' };

    const res = await recordProspectProblemObservation(capture());

    expect(res).toMatchObject({ ok: false, refusal: 'store_unavailable' });
    expect(res.ok === false && res.detail).toMatch(/already stored but its identity could not be read/);
  });

  it('a conflict whose winning row reports another tenant is NOT reported as a success', async () => {
    seedSpine();
    seedObservation({ id: 'foreign-winner', organization_id: ORG_B, origin_record_id: 'call-2026-09-14' });
    db.insertError = { code: '23505', message: 'duplicate key' };
    db.ignoreFilters = true;

    const res = await recordProspectProblemObservation(capture());

    expect(res).toMatchObject({ ok: false, refusal: 'store_unavailable' });
    expect(res.ok === false && res.detail).toMatch(/another tenant/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// STORAGE INVARIANTS, MODELLED — the real-schema suite is authored and UNRUN
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-3D · the storage layer\'s refusals become named refusals, not raw codes', () => {
  it('a missing subject under this tenant (23503) reads as subject_not_found', async () => {
    // No `unified_persons` row, so the composite tenant-safe FK refuses.
    const res = await recordProblemObservation(stored({ sourceRecordId: null }));

    expect(res).toMatchObject({ ok: false, refusal: 'subject_not_found' });
    if (res.ok !== false) throw new Error('unreachable');
    expect(res.rejections).toEqual([
      { field: 'subjectId', reason: 'not present under this tenant' },
    ]);
  });

  it('a source record in ANOTHER tenant is refused by the provenance leg', async () => {
    rowsOf('unified_persons').push({ id: PERSON_A, company_id: ORG_A, account_id: null });
    rowsOf('source_records').push({ id: SOURCE_REC, organization_id: ORG_B });

    const res = await recordProblemObservation(stored());

    expect(res).toMatchObject({ ok: false, refusal: 'subject_not_found' });
    expect(observationRows()).toEqual([]);
  });

  it('a CHECK refusal (23514) reads as inadmissible_evidence and names the row', async () => {
    rowsOf('unified_persons').push({ id: PERSON_A, company_id: ORG_A, account_id: null });
    rowsOf('source_records').push({ id: SOURCE_REC, organization_id: ORG_A });
    // `ppo_confidence_range` — a value the application layer does not police,
    // because the gate already did; the CHECK remains the guarantee.
    const res = await recordProblemObservation(stored({ confidence: 4 }));

    expect(res).toMatchObject({ ok: false, refusal: 'inadmissible_evidence' });
    if (res.ok !== false) throw new Error('unreachable');
    expect(res.detail).toMatch(/ppo_confidence_range/);
    expect(res.rejections[0].field).toBe('row');
  });

  it('refuses a malformed row before the database has to, naming which field', async () => {
    for (const [over, field] of [
      [{ statement: '   ' }, 'statement'],
      [{ origin: { store: '  ', recordId: 'r' } }, 'origin.store'],
      [{ origin: { store: 's', recordId: '  ' } }, 'origin.recordId'],
    ] as Array<[Partial<ProblemObservationInput>, string]>) {
      const res = await recordProblemObservation(stored(over));
      expect(res).toMatchObject({ ok: false, refusal: 'inadmissible_evidence' });
      if (res.ok !== false) throw new Error('unreachable');
      expect(res.rejections.map((r) => r.field)).toContain(field);
    }
    expect(db.inserts).toEqual([]);
  });

  it('an illegible relation is store_unavailable on write and unavailable on read — NEVER "none"', async () => {
    rowsOf('unified_persons').push({ id: PERSON_A, company_id: ORG_A, account_id: null });

    for (const code of ['42P01', '42703', 'PGRST205']) {
      db.insertError = { code, message: `relation "${PPO}" does not exist` };
      const res = await recordProblemObservation(stored({ sourceRecordId: null }));
      expect(res).toMatchObject({ ok: false, refusal: 'store_unavailable' });
    }
    db.insertError = null;

    for (const code of ['42P01', '42703', 'PGRST205']) {
      db.readErrors[PPO] = { code, message: 'nope' };
      const read = await readProblemObservations({
        organizationId: ORG_A, subjectType: 'person', subjectId: PERSON_A,
      });
      expect(read.state).toBe('unavailable');
      // Unreadable is not empty, and the caller is told which it was.
      expect(read.observations).toEqual([]);
      expect(read.detail).toMatch(/could not be read/);
    }
  });

  it('a thrown transport is store_unavailable, not an exception escaping the seam', async () => {
    rowsOf('unified_persons').push({ id: PERSON_A, company_id: ORG_A, account_id: null });
    db.throwOn = PPO;

    const read = await readProblemObservations({
      organizationId: ORG_A, subjectType: 'person', subjectId: PERSON_A,
    });
    expect(read).toMatchObject({ state: 'unavailable', observations: [] });
    expect(read.detail).toMatch(/read threw/);
  });

  it('an unreadable SPINE is store_unavailable, and is never answered as an absent prospect', async () => {
    seedSpine();
    db.readErrors.canonical_leads = { code: '08006', message: 'connection failure' };

    const res = await recordProspectProblemObservation(capture());
    expect(res).toMatchObject({ ok: false, refusal: 'store_unavailable' });

    const read = await readProspectProblemObservations({
      organizationId: ORG_A, prospectId: LEAD_A, subjectType: 'person',
    });
    expect(read).toMatchObject({ ok: false, refusal: 'store_unavailable' });
  });

  it('an absent prospect, an unresolved person and an unresolved account are all subject_not_found', async () => {
    const absent = await recordProspectProblemObservation(capture());
    expect(absent).toMatchObject({ ok: false, refusal: 'subject_not_found' });

    db.tables = {};
    rowsOf('canonical_leads').push({ id: LEAD_A, company_id: ORG_A, unified_person_id: null });
    const noPerson = await recordProspectProblemObservation(capture());
    expect(noPerson).toMatchObject({ ok: false, refusal: 'subject_not_found' });

    db.tables = {};
    seedSpine({ accountId: null });
    const noAccount = await recordProspectProblemObservation(capture({ subjectType: 'account' }));
    expect(noAccount).toMatchObject({ ok: false, refusal: 'subject_not_found' });

    expect(observationInserts()).toEqual([]);
  });

  it('ppo_one_subject and ppo_origin_actor are refused by the model exactly as declared', () => {
    // The CHECKs themselves, pinned here because the migration is UNAPPLIED and
    // the real-schema suite that proves them cannot run in this environment.
    const base: Row = {
      organization_id: ORG_A, entity_type: 'person', person_id: PERSON_A, account_id: null,
      statement: STATEMENT, statement_hash: sha(STATEMENT), origin_store: STORE,
      origin_record_id: 'r', origin: 'provider', recorded_by_user_id: null, confidence: null,
    };
    rowsOf('unified_persons').push({ id: PERSON_A, company_id: ORG_A });
    rowsOf('prospect_accounts').push({ id: ACCOUNT_A, organization_id: ORG_A });

    const refusedBy = (over: Row): string => {
      try { assertStorageConstraints({ ...base, ...over }); return 'accepted'; } catch (e) {
        return (e as PgError).message;
      }
    };

    expect(refusedBy({ person_id: PERSON_A, account_id: ACCOUNT_A })).toMatch(/ppo_one_subject/);
    expect(refusedBy({ person_id: null })).toMatch(/ppo_one_subject/);
    expect(refusedBy({ entity_type: 'account', account_id: ACCOUNT_A })).toMatch(/ppo_one_subject/);
    expect(refusedBy({ entity_type: 'company' })).toMatch(/ppo_entity_type_valid/);
    expect(refusedBy({ statement: '   ' })).toMatch(/ppo_statement_not_blank/);
    expect(refusedBy({ statement_hash: 'NOTAHASH' })).toMatch(/ppo_statement_hash_shape/);
    expect(refusedBy({ statement_hash: sha(STATEMENT).toUpperCase() })).toMatch(/ppo_statement_hash_shape/);
    expect(refusedBy({ origin_store: ' ' })).toMatch(/ppo_origin_store_not_blank/);
    expect(refusedBy({ origin_record_id: ' ' })).toMatch(/ppo_origin_record_id_not_blank/);
    expect(refusedBy({ origin: 'robot' })).toMatch(/ppo_origin_valid/);
    expect(refusedBy({ origin: 'human' })).toMatch(/ppo_origin_actor/);
    expect(refusedBy({ recorded_by_user_id: USER_A })).toMatch(/ppo_origin_actor/);
    expect(refusedBy({ confidence: -0.1 })).toMatch(/ppo_confidence_range/);
    expect(refusedBy({ confidence: 1.1 })).toMatch(/ppo_confidence_range/);
    // ...and the legal shapes are legal.
    expect(refusedBy({})).toBe('accepted');
    expect(refusedBy({ confidence: 0 })).toBe('accepted');
    expect(refusedBy({ confidence: 1 })).toBe('accepted');
    expect(refusedBy({ observed_at: null })).toBe('accepted');
    expect(refusedBy({
      entity_type: 'account', person_id: null, account_id: ACCOUNT_A,
    })).toBe('accepted');
  });

  it('deleting the person CASCADES the words away rather than orphaning them', async () => {
    seedSpine();
    await recordProspectProblemObservation(capture());
    expect(observationRows()).toHaveLength(1);

    cascadePersonDelete(ORG_A, PERSON_A);

    // ON DELETE CASCADE, not SET NULL: the row IS the personal data, and a
    // nulled subject would leave the full text behind under no owner.
    expect(observationRows()).toEqual([]);
  });

  it('the migration declares CASCADE on both subject legs and RESTRICT on provenance', () => {
    const sql = fs.readFileSync(path.join(
      REPO_ROOT, 'supabase/migrations/20270105000000_pi_prospect_problem_observations.sql',
    ), 'utf8');
    const fk = (name: string) => {
      const m = sql.match(new RegExp(`ADD CONSTRAINT ${name}[\\s\\S]*?;`));
      expect(m).not.toBeNull();
      return m![0];
    };
    expect(fk('ppo_person_tenant_fk')).toMatch(/FOREIGN KEY \(person_id, organization_id\)/);
    expect(fk('ppo_person_tenant_fk')).toMatch(/unified_persons \(id, company_id\) ON DELETE CASCADE/);
    expect(fk('ppo_person_tenant_fk')).not.toMatch(/SET NULL/);
    expect(fk('ppo_account_tenant_fk')).toMatch(/FOREIGN KEY \(account_id, organization_id\)/);
    expect(fk('ppo_account_tenant_fk')).toMatch(/prospect_accounts \(id, organization_id\) ON DELETE CASCADE/);
    expect(fk('ppo_account_tenant_fk')).not.toMatch(/SET NULL/);
    // A source record must not be deletable while a statement cites it.
    expect(fk('ppo_source_record_tenant_fk')).toMatch(/source_records \(id, organization_id\) ON DELETE RESTRICT/);
    // The idempotency key is SUBJECT-AWARE and time-free, as two PARTIAL
    // indexes. Partiality is load-bearing, not cosmetic: one index over both
    // nullable legs would compare a NULL in every row and, under the default
    // NULLS DISTINCT, stop deduplicating one subject kind altogether.
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_ppo_person_origin_statement[\s\S]*?\(organization_id, origin_store, origin_record_id, statement_hash, person_id\)[\s\S]*?WHERE entity_type = 'person'/,
    );
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_ppo_account_origin_statement[\s\S]*?\(organization_id, origin_store, origin_record_id, statement_hash, account_id\)[\s\S]*?WHERE entity_type = 'account'/,
    );
    // The subject-free index must be GONE, not merely supplemented.
    expect(sql).not.toMatch(/uq_ppo_origin_statement/);
    // And the postcondition must now expect four named indexes.
    expect(sql).toMatch(/expected 4 named indexes/);
    // `observed_at` and `confidence` are nullable with NO DEFAULT.
    expect(sql).not.toMatch(/observed_at\s+timestamptz\s+(NOT NULL|DEFAULT)/);
    expect(sql).not.toMatch(/confidence\s+numeric\s+(NOT NULL|DEFAULT)/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9 / 10 · NOTHING HERE MAKES PROBLEM FIT SCORABLE
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-3D · the capture path scores nothing and activates nothing', () => {
  const MODULES = [
    'backend/services/prospectProblems/types.ts',
    'backend/services/prospectProblems/problemObservationRepository.ts',
    'backend/services/prospectProblems/problemObservationIngestion.ts',
    'pages/api/prospects/[id]/problems.ts',
  ];

  it('no capture module declares a score, dimension, weight or priority key', () => {
    let scanned = 0;
    for (const rel of MODULES) {
      const src = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      scanned += 1;
      // Strip comments: the modules EXPLAIN at length that they score nothing,
      // and the prose must not be what the scan matches on.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const key of ['scorable', 'score', 'dimension', 'weight', 'priority']) {
        expect({ rel, key, hit: new RegExp(`\\b${key}\\b`, 'i').test(code) })
          .toEqual({ rel, key, hit: false });
      }
    }
    // Guard the guard: an empty file list would make this vacuously green.
    expect(scanned).toBe(MODULES.length);
    expect(scanned).toBeGreaterThanOrEqual(4);
  });

  it('no capture module imports the fit scoring surface beyond the admission gate', () => {
    const repo = fs.readFileSync(path.join(
      REPO_ROOT, 'backend/services/prospectProblems/problemObservationRepository.ts',
    ), 'utf8');
    // The writer imports NO fit module at all.
    expect(repo).not.toMatch(/from '.*offeringIntelligence/);
    const ingestion = fs.readFileSync(path.join(
      REPO_ROOT, 'backend/services/prospectProblems/problemObservationIngestion.ts',
    ), 'utf8');
    // The seam imports exactly the gate, and nothing that assesses readiness.
    expect(ingestion).toMatch(/admitProspectProblem/);
    expect(ingestion).not.toMatch(/assessProblemFitReadiness/);
  });

  it('no file outside backend/services/prospectProblems opens the capture relation', () => {
    const roots = ['backend', 'pages', 'lib', 'components', 'shared', 'scripts'];
    const owned = path.join('backend', 'services', 'prospectProblems');
    const offenders: string[] = [];
    let scanned = 0;

    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '.next') continue;
          walk(full);
        } else if (/\.(ts|tsx|js)$/.test(entry.name)) {
          const relative = path.relative(REPO_ROOT, full);
          if (relative.startsWith(owned)) continue;
          scanned += 1;
          const src = fs.readFileSync(full, 'utf8');
          if (!src.includes(PROBLEM_OBSERVATION_RELATION)) continue;
          // A test may NAME the relation; only opening it is the concern.
          const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
          const opens = new RegExp(
            `(?:ownedDbTable|from)\\s*\\(\\s*['"\`](?:public\\.)?${PROBLEM_OBSERVATION_RELATION}`,
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

  it('the capture relation is NOT in the audited candidate stores — the audit blocks, it does not allowlist', () => {
    // So an unexamined store passes the gate. That is the INTENDED behaviour,
    // pinned at piWs3aProblemFitSourceReverify.test.ts:208-215, and the reason
    // item 9's readiness case matters: even admitted, it produces no number.
    expect(auditedProblemSource(PROBLEM_OBSERVATION_RELATION)).toBeNull();
    expect(PROBLEM_FIT_CANDIDATE_STORES.map((c) => c.relation))
      .not.toContain(PROBLEM_OBSERVATION_RELATION);
    // The gate's own contract was not moved to accommodate this capability.
    expect(PROBLEM_FIT_CONTRACT_VERSION).toBe('pf.1');
  });

  it('the published contract version is this capability\'s own, and the seam writes nothing itself', () => {
    expect(PROBLEM_OBSERVATION_CONTRACT_VERSION).toBe('pi-problem-obs.1');
    expect(PROBLEM_OBSERVATION_INGESTION_PERFORMS_NO_WRITE).toBe(true);
    // The ports default to the repository, so there is exactly one write path.
    expect(typeof defaultProblemObservationPorts.record).toBe('function');
    expect(typeof defaultProblemObservationPorts.read).toBe('function');
  });

  it('a read issues no mutation at all, on any path', async () => {
    seedSpine();
    seedObservation();
    await readProspectProblemObservations({
      organizationId: ORG_A, prospectId: LEAD_A, subjectType: 'person',
    });
    await readProspectProblemObservations({
      organizationId: ORG_A, prospectId: 'no-such-lead', subjectType: 'person',
    });
    expect(db.mutations).toEqual([]);
  });
});
