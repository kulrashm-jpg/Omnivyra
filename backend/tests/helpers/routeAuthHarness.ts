/**
 * ROUTE-AUTH-001 (STEP 3AH-85) — shared harness for route authentication and
 * tenant-isolation tests.
 *
 * Only the DATABASE and the IDENTITY PROVIDER are faked. Everything between the
 * route and the database — resolveUserContext, enforceCompanyAccess,
 * TenantGuard.assertTenantAccess, requireCampaignAccess, the campaign
 * ownership binding, rbacService — runs for real, so a regression in any link
 * of the authorization chain fails the route's test.
 *
 * Usage (jest.mock factories may `require`, but may not close over module
 * scope, so each test file wires the modules itself):
 *
 *   jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
 *   jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
 *   jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
 *   jest.mock('../../services/supabaseAuthService', () => require('../helpers/routeAuthHarness').authModule());
 *   jest.mock('../../security/IdentityResolver', () => require('../helpers/routeAuthHarness').identityModule());
 *
 * Fixture world: two active companies (CO_A, CO_B), one COMPANY_ADMIN member in
 * each (USER_A, USER_B), one campaign each (CAMPAIGN_A, CAMPAIGN_B, owned via
 * campaign_versions), and a super admin (USER_SUPER). Tests add route-specific
 * rows with seed().
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export const CO_A = 'co-a-0000-0000-0000-00000000000a';
export const CO_B = 'co-b-0000-0000-0000-00000000000b';
export const USER_A = 'user-a-00-0000-0000-00000000000a';
export const USER_B = 'user-b-00-0000-0000-00000000000b';
export const USER_SUPER = 'user-s-00-0000-0000-00000000000s';
export const CAMPAIGN_A = 'camp-a-00-0000-0000-00000000000a';
export const CAMPAIGN_B = 'camp-b-00-0000-0000-00000000000b';
export const UNKNOWN_ID = 'unkn-x-00-0000-0000-00000000000x';
export const TOKENS: Record<string, string> = { A: 'tok-user-a', B: 'tok-user-b', SUPER: 'tok-user-super' };
/** If this string ever reaches a response for USER_A, isolation failed. */
export const CANARY_B = 'CANARY-COMPANY-B-CONFIDENTIAL';

const USERS_BY_TOKEN: Record<string, { id: string; email: string }> = {
  'tok-user-a': { id: USER_A, email: 'a@example.test' },
  'tok-user-b': { id: USER_B, email: 'b@example.test' },
  'tok-user-super': { id: USER_SUPER, email: 's@example.test' },
};

type Row = Record<string, any>;
export type Call = {
  table: string;
  op: string;
  filters: Record<string, unknown>;
  payload?: unknown;
  /**
   * Second argument of insert/update/upsert/delete, e.g. `{ onConflict }`.
   *
   * A SNAPSHOT, like `payload` and `filters` — deep-copied when the statement
   * was recorded, so a caller that mutates its own object afterwards cannot
   * change what this reports. See run().
   */
  options?: unknown;
  /**
   * The harness REFUSED to model this statement (a suite configuration
   * defect). Nothing was written — but writeCalls() DELIBERATELY INCLUDES it,
   * so a `writeCalls(...).toHaveLength(0)` assertion FAILS rather than passing
   * as though a security control had rejected a real write. Use
   * completedWrites() when you want only statements that actually wrote.
   */
  refused?: true;
  /**
   * The statement was modelled through to a SUCCESSFUL result: it ran, it was
   * not refused, it was not forced to fail, and it returned no error.
   *
   * RECORDED AT THE TIME IT RAN, which is the whole point. An earlier version
   * derived this at assertion time by reading `state.failTables`, so a
   * `failTable()` call made LATER — for an unrelated lookup-failure path — made
   * an EARLIER completed write report as not-completed. A suite that drove a
   * cross-tenant upsert and then exercised a failure path got
   * `expect(completedWrites([t])).toHaveLength(0)` passing over a write that
   * had re-tenanted the row. It also counted a modelled 23505/21000 as a
   * completed write, although such a statement writes nothing.
   */
  completed?: true;
  /**
   * The modelled database error code this statement RETURNED, if any — 23505,
   * 21000, 23502 or the forced XX000. Set at the time it ran, like `completed`.
   *
   * "Attempted but errored" is a THIRD outcome, distinct from both completed and
   * refused, and before this field a suite could not tell it apart from a
   * refusal except by reading the returned value at the call site.
   */
  errorCode?: string;
};

/**
 * How a table's UPSERTs are modelled. There is NO default: an upsert against a
 * table with no declared mode is refused, because the two plausible defaults
 * (resolve on the primary key, or append blindly) differ in exactly the
 * direction that decides whether a cross-tenant write looks safe.
 *
 *   - `resolve`  — a row whose arbiter columns match an existing row UPDATES it;
 *                  otherwise it INSERTs. `defaultArbiter` is what to use when
 *                  `.upsert()` is called with no options at all; null means
 *                  "refuse that case too".
 *   - `append`   — every row is appended, which is the harness's historical
 *                  behaviour. Available only by explicit declaration with a
 *                  written reason, so a suite that genuinely only cares that a
 *                  write was ATTEMPTED can say so and be read as saying so.
 *                  It does NOT exempt the statement from the harness's
 *                  configuration checks: an `onConflict` that names no column
 *                  or names a column seen nowhere is still refused, and a
 *                  NO-OPTIONS upsert is refused unless the declaration
 *                  explicitly acknowledged that call shape
 *                  (`{ alsoForNoOptionsCalls: true }`). An earlier version
 *                  returned before every one of those checks, so declaring
 *                  append silenced the one refusal this harness documents as
 *                  mandatory.
 */
export type UpsertMode =
  | { mode: 'resolve'; defaultArbiter: string[] | null }
  | { mode: 'append'; reason: string; noOptionsAcknowledged: boolean };

const state: {
  tables: Record<string, Row[]>;
  calls: Call[];
  failTables: Set<string>;
  /**
   * table → columns that INSERT must find unoccupied (see uniqueKey).
   *
   * A SUITE-LEVEL DECLARATION, so seed() does NOT clear it; only
   * resetHarnessDeclarations() does. See seed() for why.
   */
  unique: Record<string, string[]>;
  /**
   * table → how its UPSERTs are modelled. An undeclared table refuses; see
   * UpsertMode, resolveUpsertConflicts() and upsertAppendsBlindly().
   *
   * Also a suite-level declaration, and also not cleared by seed().
   */
  upsertModes: Record<string, UpsertMode>;
  /**
   * Tables a refusal has poisoned for the rest of the test.
   *
   * Cleared ONLY by consumeRefusals(), the explicit acknowledgement API. seed()
   * deliberately does NOT clear it: a mid-test seed() used to wipe the poison,
   * the refusal records and the declared models in one call, so a suite could
   * refuse a statement and then carry on under NO declared model with nothing
   * left to show it had happened.
   */
  poisoned: Set<string>;
  /**
   * Every refusal in this test file, in order.
   *
   * Separate from `calls` on purpose: seed() clears `calls` (they are per-test
   * observations) but must not be able to erase the record that the harness
   * refused to run something. Cleared only by consumeRefusals().
   */
  refusalLedger: Call[];
  /**
   * Monotonic counter for fabricated ids. Deliberately NOT derived from any
   * table's length: an UPSERT that merges does not append, and a DELETE
   * shortens the table, so a length-derived ordinal is freed for re-use while
   * the row that first received it is still live. Minting then collides with
   * that row and — on a conflict-resolving table — silently overwrites it.
   * A counter cannot free an ordinal. seed() resets it and then advances it past
   * every fabricated id among the seeded rows, so a reset cannot re-mint a
   * surviving one either.
   */
  genSeq: number;
} = {
  tables: {},
  calls: [],
  failTables: new Set(),
  unique: {},
  upsertModes: {},
  poisoned: new Set(),
  refusalLedger: [],
  genSeq: 0,
};

/** Shape of a fabricated id, so the allocator can recognise and reserve them. */
const GEN_ID_RE = /^gen-(\d+)$/;

/**
 * Advance the allocator past every fabricated id in `rows`. Called for seeded
 * rows and for each incoming batch, so the generated namespace is reserved
 * against ids a caller supplies in that shape.
 */
function reserveGenIds(rows: Row[]): void {
  for (const r of rows) {
    const m = GEN_ID_RE.exec(String(r?.id ?? ''));
    if (!m) continue;
    const n = Number(m[1]);
    // Beyond 2^53 a JS integer no longer increments exactly, so the counter
    // would stop advancing and start re-issuing a live id. Refuse rather than
    // pretend the allocator is monotonic outside its exact range.
    if (!Number.isSafeInteger(n)) {
      throw new HarnessConfigurationError(
        `a row carries the fabricated id "${String(r.id)}", whose ordinal ${m[1]} is outside JavaScript's exact integer range. ` +
          `The allocator cannot stay monotonic past 2^53, so it will not try. Use an ordinary id in the fixture.`,
      );
    }
    state.genSeq = Math.max(state.genSeq, n);
  }
}

/**
 * Mint a fabricated id no row of `table` holds. BOUNDED: it gives up with a
 * loud failure rather than looping, because a mint that cannot succeed is a
 * fixture problem and a hung test run is the worst way to report one.
 */
function mintId(table: string): string {
  const all = state.tables[table] || [];
  for (let attempt = 0; attempt < 10000; attempt += 1) {
    if (!Number.isSafeInteger(state.genSeq + 1)) {
      throw new HarnessConfigurationError(
        `the fabricated-id counter reached JavaScript's exact integer limit, so a further id cannot be allocated safely.`,
      );
    }
    const candidate = `gen-${++state.genSeq}`;
    if (!all.some((x) => String(x.id) === candidate)) return candidate;
  }
  throw new HarnessConfigurationError(
    `could not allocate a free fabricated id for "${table}" in 10000 attempts; the fixture appears to occupy the whole gen-N namespace.`,
  );
}

/**
 * A DEEP copy of a plain-data value.
 *
 * Plain objects and arrays are rebuilt; everything else — primitives, Date, Map,
 * Buffer, class instances, functions — is passed through BY REFERENCE, because
 * cloning those would change their identity or silently lose information, and
 * fixtures in this repository are plain JSON shapes.
 *
 * WHY THIS EXISTS. The returned-rows contract used to be `{ ...row }`, a SHALLOW
 * copy, while the note next to it promised that mutating a returned row "cannot
 * reach stored state". One level down it could: `data[0].campaign_snapshot.x = y`
 * reached the stored row, and stored rows aliased the caller's own payload
 * objects, so a route that mutated its payload after writing mutated the fake
 * database. JSONB columns are the common shape here — the base fixture seeds
 * `campaign_versions` with a `campaign_snapshot` object — so this was reachable,
 * not theoretical.
 *
 * THE LIMIT, STATED: a Date, Map, Set, Buffer, class instance or
 * NULL-PROTOTYPE object (`Object.create(null)`) nested in a fixture is still
 * SHARED, because the clone test is `getPrototypeOf(v) === Object.prototype`.
 * A null-prototype object is plain DATA and so is the one shape a reader would
 * assume is cloned — it is named here for that reason. Unreachable from real
 * wire data, since JSON.parse always yields Object.prototype. If a suite needs
 * isolation for any of these, it must not rely on this.
 */
function deepCopy<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => deepCopy(v)) as unknown as T;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Row = {};
    for (const [k, v] of Object.entries(value as Row)) out[k] = deepCopy(v);
    return out as unknown as T;
  }
  return value;
}

/**
 * The unique columns this harness enforces for `table`: everything a suite
 * declared with uniqueKey(), plus `id` ALWAYS.
 *
 * WHY `id` IS IMPLICIT. `id` is this harness's identity column by construction —
 * it is what mintId() fabricates, what reserveGenIds() reserves, and what every
 * fixture and every `.eq('id', …)` treats as the row's identity. It was
 * nevertheless enforced NOWHERE unless a suite happened to call
 * `uniqueKey(t,'id')`, so `.insert({id:'r1'})` onto an existing `r1` returned
 * `error: null` and left TWO rows with that id; `.update({id:'r2'}).eq('id','r1')`
 * collapsed two rows onto one identity. Every later `.eq('id', …)` then matched
 * two rows, so a route whose create-race protection IS the primary key appeared
 * to succeed twice.
 *
 * MODELLED, NOT ESTABLISHED: that each real target actually has `id` as a
 * primary key is a schema question. For the four tables this repository's Fix 3
 * migration owns it is true in the committed DDL, but this harness asserts the
 * MODEL, not the database.
 *
 * NOT APPLIED IN APPEND MODE, which by its own contract validates nothing at
 * all — see upsertAppendsBlindly().
 */
function enforcedUniqueColumns(table: string): string[] {
  const declared = state.unique[table] || [];
  return declared.includes('id') ? [...declared] : ['id', ...declared];
}

/**
 * The unique column, if any, that ONE STATEMENT would leave duplicated.
 *
 * THIS IS A WHOLE-STATEMENT, FINAL-STATE CHECK, and it is deliberately not a
 * per-element one. Two earlier designs were order-dependent:
 *
 *   1. The first registered nothing for a row that MERGED, so
 *      `[merge moving T.slug 's1'→'s2', insert slug 's2']` was ACCEPTED while the
 *      same batch reversed was rejected 23505.
 *   2. The second fixed that by accumulating the finals as it went, but still ran
 *      as a single forward pass: the targets of LATER elements were not yet
 *      excluded, so a value a later element was about to VACATE still counted as
 *      occupied. `[merge r1 off 's1', insert 's1']` was accepted forwards and
 *      rejected 23505 backwards; a legal swap `[r1→'s2', r2→'s1']` was rejected
 *      both ways while the comment claimed the statement was "judged by its FINAL
 *      state". An exhaustive sweep found 20 of 72 ordered two-element batches
 *      changed outcome on reversal.
 *
 * THE INVARIANT, stated exactly: FOR EVERY DECLARED UNIQUE COLUMN AND EVERY
 * VALUE, THE STATEMENT MAY NOT INCREASE THAT VALUE'S MULTIPLICITY ABOVE
 * `max(1, multiplicity before)`.
 *
 *   - A value held 0 or 1 times before may be held at most ONCE after. That is
 *     ordinary uniqueness: a statement may not create a duplicate.
 *   - A value ALREADY held k > 1 times before may still be held k times after,
 *     but never k + 1. The statement is judged on what IT does, not on the state
 *     it inherited.
 *
 * Both populations are computed from row SETS, so the verdict cannot depend on
 * element order:
 *   - `survivors` — stored rows the statement does not write.
 *   - `finals`    — the post-statement value of every row it does write.
 *   - `before`    — every stored row, survivors and write targets alike.
 *
 * WHY MULTIPLICITY AND NOT "IS THIS VALUE OCCUPIED". An earlier version asked
 * only whether a written value collided with a SURVIVOR's value. That ignored a
 * duplicate between two survivors — correctly, since a real unique index could
 * not have permitted it and it is illegal FIXTURE state rather than anything the
 * statement did — but it was narrower than its own rationale: the moment the
 * statement WROTE one of the duplicated rows, that row left `survivors`, its
 * twin stayed, and the written row's OWN UNCHANGED VALUE read as occupied. So
 * `.update({note:'x'}).eq('id','d1')` — a patch that does not mention the unique
 * column at all — returned 23505 on such a fixture, and every write touching a
 * duplicated row was refused. The failure mode the rationale set out to remove
 * survived for exactly those rows, and the harness's own comment elsewhere
 * listed that symptom as a defect it had already fixed.
 *
 * The six cases this distinguishes, each pinned by a regression test:
 *   1. a conflict the statement CREATES                        → refused
 *   2. a pre-existing duplicate the statement does not touch   → allowed
 *   3. a write touching a duplicated row, unique col UNCHANGED → allowed
 *   4. a write moving a unique col INTO a conflicting value    → refused
 *   5. a statement that would INCREASE the duplicate count     → refused
 *   6. a statement that reduces or preserves the count         → allowed
 *
 * NULLs are DISTINCT, as on a real unique index, so they are never counted.
 *
 * MODELLED, NOT ESTABLISHED: this is the harness's rule about its own declared
 * keys. Real PostgreSQL checks a non-deferrable unique index per tuple as the
 * command walks rows, so it MAY reject statements this accepts — the vacate and
 * swap cases above, and case 3, are exactly where the two could differ, and a
 * real index could never have reached the duplicated fixture state at all. That
 * question needs a database; see the NOT ESTABLISHED list.
 */
function statementUniqueViolation(
  table: string,
  survivors: Row[],
  finals: Row[],
  before: Row[],
): string | null {
  const tally = (population: Row[], col: string): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const r of population) {
      if (r[col] == null) continue; // a unique index treats NULLs as DISTINCT
      const v = String(r[col]);
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    return counts;
  };
  for (const col of enforcedUniqueColumns(table)) {
    const was = tally(before, col);
    const now = tally([...survivors, ...finals], col);
    for (const [v, after] of now) {
      if (after > Math.max(1, was.get(v) ?? 0)) return col;
    }
  }
  return null;
}

/**
 * The arbiter key of `row`, or null when the row cannot take part in conflict
 * resolution at all because one of the arbiter columns is NULL or absent.
 *
 * A unique index treats NULLs as DISTINCT, so two rows with a NULL arbiter
 * column neither conflict with each other nor with anything else — they simply
 * insert. An earlier version keyed on `String(r[c])`, which collapsed two NULLs
 * to `"null"` and refused the statement with a bogus 21000.
 */
function arbiterKey(row: Row, arbiter: string[]): string | null {
  if (arbiter.length === 0) return null;
  const parts: string[] = [];
  for (const c of arbiter) {
    if (row[c] === null || row[c] === undefined) return null;
    parts.push(String(row[c]));
  }
  return parts.join('\u0000');
}

function cardinalityResult(table: string, arbiter: string[]): { data: null; error: { message: string; code: string }; count: number } {
  return {
    data: null,
    error: {
      message: `ON CONFLICT DO UPDATE command cannot affect row a second time (${table}; arbiter ${arbiter.join(',')})`,
      code: '21000',
    },
    count: 0,
  };
}

function duplicateKeyResult(table: string, col: string): { data: null; error: { message: string; code: string }; count: number } {
  return {
    data: null,
    error: { message: `duplicate key value violates unique constraint on ${table}.${col}`, code: '23505' },
    count: 0,
  };
}

/**
 * A supplied NULL in the row-identity column.
 *
 * MODELLED ONLY FOR `id`, and only because `id` is this harness's identity
 * column by construction — it is what mintId() fabricates, what reserveGenIds()
 * reserves and what every fixture uses as the row's identity. A declared
 * uniqueKey() on some other column says nothing about whether that column is
 * NOT NULL, so this rule is deliberately not generalised to it.
 *
 * NOT ESTABLISHED: that a real target has `id` NOT NULL, or that PostgREST
 * surfaces such a violation as 23502 rather than something else. The code is
 * the one PostgreSQL raises for a not-null violation; whether this statement
 * would reach it is a database question.
 */
function notNullResult(table: string, col: string): { data: null; error: { message: string; code: string }; count: number } {
  return {
    data: null,
    error: {
      message: `null value in column "${col}" of relation "${table}" violates not-null constraint`,
      code: '23502',
    },
    count: 0,
  };
}

/**
 * Decide the arbiter columns for an UPSERT, or refuse.
 *
 * Refusals, each because the real client or server would reject the statement
 * and modelling it as a plain INSERT would invent a safe outcome:
 *   - no options at all and no declared default (see resolveUpsertConflicts);
 *   - an `onConflict` that names no column (`''`, `','`, `' , , '`). PostgreSQL
 *     rejects `ON CONFLICT ()` as a syntax error;
 *   - an `onConflict` naming a column that appears on no row of the table and
 *     in no row of the batch. Such a column cannot correspond to a unique
 *     index, which PostgreSQL answers with 42P10. The harness does not model
 *     a schema, so this name-based test is the closest honest approximation —
 *     it is deliberately conservative and will refuse a genuinely nullable
 *     column that happens to be absent everywhere.
 */
function assertArbiterColumnsKnown(table: string, cols: string[], batch: Row[], origin: string): void {
  const known = new Set<string>();
  for (const r of [...(state.tables[table] || []), ...batch]) {
    for (const k of Object.keys(r || {})) known.add(k);
  }
  const unknown = cols.filter((c) => !known.has(c));
  if (unknown.length > 0) {
    throw new HarnessConfigurationError(
      `${origin} on "${table}" names arbiter column(s) ${unknown.join(', ')}, which appear on no row of the table and in no row ` +
        `of this batch. PostgreSQL answers 42P10 when no unique index matches the conflict target; the harness refuses rather than ` +
        `silently appending. If the column is real but absent from every fixture, seed it.`,
    );
  }
}

function resolveArbiter(table: string, options: unknown, batch: Row[]): string[] {
  const declared = (options as { onConflict?: unknown } | undefined)?.onConflict;
  if (declared === undefined || declared === null) {
    const declaredMode = state.upsertModes[table];
    const fallback = declaredMode && declaredMode.mode === 'resolve' ? declaredMode.defaultArbiter : null;
    if (!fallback || fallback.length === 0) {
      throw new HarnessConfigurationError(
        `.upsert() on "${table}" was called with no onConflict option, and this suite declared no default arbiter. ` +
          `The harness will not guess: resolving on the primary key and appending blindly differ in exactly the direction that ` +
          `decides whether a cross-tenant write looks safe, and which one PostgREST actually performs is NOT established by this ` +
          `repository. State the model this suite intends — resolveUpsertConflicts('${table}', ['<arbiter column>']) to resolve, or ` +
          `upsertAppendsBlindly('${table}', '<why>', { alsoForNoOptionsCalls: true }) if the suite only cares that a write was ` +
          `attempted and accepts that nothing here models conflict resolution.`,
      );
    }
    // THE DECLARED DEFAULT GETS THE SAME VALIDATION AS AN EXPLICIT TARGET. An
    // earlier version returned the fallback straight from here, skipping the
    // unknown-column check below, so a typo in `resolveUpsertConflicts(t,
    // ['compnay_id'])` silently became an arbiter no row could ever match —
    // which is a blind append wearing the resolve model's name.
    assertArbiterColumnsKnown(table, fallback, batch, `the declared defaultArbiter for .upsert()`);
    return [...fallback];
  }
  const cols = String(declared).split(',').map((c) => c.trim()).filter(Boolean);
  if (cols.length === 0) {
    throw new HarnessConfigurationError(
      `.upsert() on "${table}" named an onConflict of ${JSON.stringify(String(declared))}, which parses to no column at all. ` +
        `PostgreSQL rejects ON CONFLICT () as a syntax error; the harness will not model it as a plain INSERT.`,
    );
  }
  assertArbiterColumnsKnown(table, cols, batch, `.upsert()`);
  return cols;
}

/**
 * The declared mode for `table`, or a refusal. THERE IS NO DEFAULT, by design:
 * an undeclared table used to fall through to a blind append that reported
 * success, which is how an unmodelled upsert could make a cross-tenant write
 * look safe. Two tables in this repository had declared a model while the
 * production `.upsert()` call sites numbered in the hundreds, so the silent
 * path was the one almost every suite was on.
 *
 * THE COUNT, WITH ITS SCOPE, because an earlier version gave the bare figure
 * 281 and a reviewer could not reproduce it from the sentence alone:
 *
 *   grep -rn "\.upsert(" backend/services pages --include=*.ts \
 *     | grep -v /tests/ | grep -v "\.test\." | wc -l      → 281
 *
 * Widening the scope changes it: adding `backend/` outside services, `lib`,
 * `components`, `hooks` and `scripts` gives 314, and `backend pages` alone
 * gives 305. The figure is a count of CALL SITES, not of tables, and not of
 * distinct FILES: the recipe above spans 199 files, while 223 is the distinct-file
 * count of the WIDEST scope — an earlier version of this sentence put 223 against
 * the 281 recipe. Measured in the working tree at 5604b50b.
 */
function requireUpsertMode(table: string): UpsertMode {
  const declaredMode = state.upsertModes[table];
  if (declaredMode) return declaredMode;
  throw new HarnessConfigurationError(
    `.upsert() ran against "${table}", which this suite has not declared an upsert model for. The harness refuses rather than ` +
      `appending the rows and reporting success, because that is indistinguishable from a conflict target having correctly ` +
      `rejected the write. Declare one:\n` +
      `  resolveUpsertConflicts('${table}', ['<arbiter column>'])  — model arbiter resolution (what a real ON CONFLICT does)\n` +
      `  upsertAppendsBlindly('${table}', '<why>')                 — keep the historical append model, on the record`,
  );
}

/**
 * A defect in how a SUITE configured the harness, not an application or
 * database error. It is a distinct class with a marker property so a test can
 * tell it apart from a modelled failure: a tenant-safety assertion must never
 * be satisfied merely because the harness declined to execute the write.
 * See assertNoHarnessConfigurationError().
 */
export class HarnessConfigurationError extends Error {
  readonly isHarnessConfigurationError = true;
  constructor(message: string) {
    super(`routeAuthHarness CONFIGURATION DEFECT: ${message}`);
    this.name = 'HarnessConfigurationError';
  }
}

export function isHarnessConfigurationError(e: unknown): boolean {
  return !!(e && typeof e === 'object' && (e as { isHarnessConfigurationError?: unknown }).isHarnessConfigurationError === true);
}

/**
 * Statements the harness refused to model. Never completed writes.
 *
 * Read from the refusal LEDGER, not from `calls`. seed() clears `calls`, so an
 * earlier version let a mid-test seed() erase every refusal record — and with
 * it the evidence that assertNoHarnessConfigurationError() exists to find.
 */
export function refusedCalls(): Call[] {
  return [...state.refusalLedger];
}

/**
 * Acknowledge and clear the recorded refusals AND the poison they set,
 * returning the refusals.
 *
 * ONLY for a test that is deliberately asserting the refusal mechanism itself —
 * the harness's own fidelity suite. Everywhere else, leaving a refusal behind
 * SHOULD fail the test, which is what the automatic guard below does. Calling
 * this to silence that guard in a product test would re-open exactly the false
 * pass the guard exists to prevent.
 *
 * This is now the ONLY way to clear the poison. It used to be seed() as well,
 * which meant the cheapest possible action — re-seeding a fixture — silently
 * lifted the cascade.
 */
export function consumeRefusals(): Call[] {
  const refused = [...state.refusalLedger];
  state.refusalLedger = [];
  state.calls = state.calls.filter((c) => !c.refused);
  state.poisoned = new Set();
  return refused;
}

/**
 * Drop the suite-level declarations — uniqueKey() and the upsert models.
 *
 * seed() deliberately does not do this (see seed()), so a group of tests that
 * needs a blank declaration slate — for instance one asserting that an
 * UNDECLARED table is refused, in a file where another group declares it — must
 * say so explicitly. Fixtures are per-test; declarations are not.
 */
export function resetHarnessDeclarations(): void {
  state.unique = {};
  state.upsertModes = {};
}
/**
 * REFUSALS ARE UNSWALLOWABLE BY CONSTRUCTION, not by a hook.
 *
 * A refusal means the harness was misconfigured, so nothing ran — and a route
 * that catches the throw turns it into an ordinary 500, which a tenant-safety
 * suite could read as "the write was refused". Four mechanisms make that false
 * pass hard to reach, none of which depends on a suite remembering to ask:
 *
 *   1. The statement THROWS in the caller's own stack (see run()).
 *   2. writeCalls() COUNTS the refused attempt, so the canonical
 *      `writeCalls(t).toHaveLength(0)` assertion FAILS rather than passing.
 *      completedWrites() excludes it, and that is the accessor to reach for
 *      when the question is "what actually wrote" — but a no-write assertion
 *      belongs on writeCalls(), which is why this note names it first.
 *   3. The table is POISONED for the rest of the test, and `rows(table)` THROWS
 *      on a poisoned table. So the two things a suite does after swallowing a
 *      throw — operate on the table again, or read its stored state — both
 *      fail. Only consumeRefusals() lifts this.
 *   4. The refusal is written to a LEDGER that seed() cannot clear, so
 *      assertNoHarnessConfigurationError() keeps firing for the rest of the
 *      test file.
 *
 * WHAT EACH OF THOSE REPLACED, so the reasoning is auditable:
 *   - A module-scope `afterEach` guard, which broke any suite importing this
 *     module lazily inside a test body — Jest refuses a hook defined inside a
 *     test. The design is hook-free for that reason.
 *   - seed() clearing the poison AND the refusal records AND the declared
 *     models, all three at once. A mid-test `seed({...})` — an ordinary,
 *     innocuous-looking line that EIGHT suites in this repository do call — lifted
 *     the cascade, erased the evidence, and left every later upsert in that test
 *     running under NO declared model.
 *
 * THE RESIDUAL IS WIDER THAN AN EARLIER VERSION ADMITTED, and this is the
 * honest statement of it. That version claimed only "a suite that catches the
 * throw, never touches the table again, never reads rows() and asserts ONLY an
 * HTTP status" could miss a refusal. The real gap is structural: mechanisms (i)
 * and (ii) protect the DENY path, not the GRANT path.
 *
 * On a grant path a refused statement is indistinguishable from a real write to
 * every accessor except completedWrites():
 *   - `writeCalls(t).toHaveLength(1)` PASSES on it (by design — that is what
 *     makes the deny-path assertion safe);
 *   - its `.payload` is readable, so a `toMatchObject` payload control passes;
 *   - `calls()` ordering is preserved, so a sequence assertion passes.
 * So ANY grant-path suite asserting write PRESENCE, PAYLOAD or ORDERING can pass
 * over a statement that wrote nothing. Two live instances existed in this
 * repository when this was written, one of them a test literally named "the
 * owner writes" that asserted only `calls()`.
 *
 * WHAT THAT MEANS FOR A SUITE AUTHOR: a grant-path assertion MUST use
 * completedWrites() (or read the resulting row). Nothing weaker distinguishes a
 * write from a refusal. The fidelity suite pins this with a route-shaped case.
 *
 * assertNoHarnessConfigurationError() remains the explicit, opt-in remedy and
 * stays opt-in deliberately: it is file-global, so making it automatic would
 * require a hook, and a module-scope hook is what broke suites that import this
 * module lazily inside a test body.
 *
 * ADOPTION, counted precisely because "3 of 72" was ambiguous and then stale.
 * THREE suites adopt it as a HOOK, which is what adoption means here:
 * collaborationBlockTenantSafety, contentBlocksRouteCallContract and
 * tenantGuardCanonicalOwnership. A FOURTH call site exists — the fidelity suite
 * asserts this function's own behaviour — which is a self-test, not an
 * adoption. The earlier figure was written when the three call sites were two
 * adoptions plus that self-test, so adding the tenantGuard hook made whichever
 * population it denoted wrong. Counted against 72 consumer suites.
 */
export function assertNoHarnessConfigurationError(): void {
  const refused = refusedCalls();
  if (refused.length > 0) {
    throw new Error(
      `routeAuthHarness: ${refused.length} statement(s) were REFUSED by the harness as a configuration defect ` +
        `(${refused.map((c) => `${c.op} ${c.table}`).join(', ')}). A refusal is not security enforcement — the write never ran. ` +
        `Fix the suite's harness declaration before reading anything into this result.`,
    );
  }
}

function baseTables(): Record<string, Row[]> {
  return {
    companies: [
      { id: CO_A, status: 'active', name: 'Company A' },
      { id: CO_B, status: 'active', name: `Company B ${CANARY_B}` },
    ],
    user_company_roles: [
      { user_id: USER_A, company_id: CO_A, role: 'COMPANY_ADMIN', status: 'active' },
      { user_id: USER_B, company_id: CO_B, role: 'COMPANY_ADMIN', status: 'active' },
      { user_id: USER_SUPER, company_id: CO_A, role: 'SUPER_ADMIN', status: 'active' },
    ],
    campaigns: [
      { id: CAMPAIGN_A, company_id: CO_A, user_id: USER_A, name: 'Campaign A', status: 'planning' },
      { id: CAMPAIGN_B, company_id: CO_B, user_id: USER_B, name: `Campaign B ${CANARY_B}`, status: 'planning' },
    ],
    campaign_versions: [
      { campaign_id: CAMPAIGN_A, company_id: CO_A, version: 1, created_at: '2026-01-01', campaign_snapshot: {} },
      { campaign_id: CAMPAIGN_B, company_id: CO_B, version: 1, created_at: '2026-01-01', campaign_snapshot: {} },
    ],
  };
}

/** Reset to the base world, then merge route-specific rows (appended per table). */
/**
 * Reset the FIXTURES: tables, recorded calls, forced failures and the id
 * allocator.
 *
 * WHAT IT DELIBERATELY NO LONGER TOUCHES, and why. It used to also clear
 * `state.unique`, `state.upsertModes` and `state.poisoned`. Those are not
 * fixtures:
 *
 *   - uniqueKey() and the upsert models are SUITE-LEVEL DECLARATIONS of what
 *     the suite believes the schema and the client do. A mid-test `seed({...})`
 *     — which EIGHT suites in this repository call to set up a second scenario —
 *     silently dropped them, so every upsert for the remainder of that test ran
 *     under no declared model at all. Keeping them means a declaration made in
 *     `beforeEach` survives a re-seed, which is what the author meant.
 *   - The poison and the refusal ledger exist to make a refusal impossible to
 *     lose. Letting the cheapest line in the file clear them defeated that.
 *
 * A group of tests that genuinely needs a blank declaration slate calls
 * resetHarnessDeclarations(); one asserting the refusal mechanism itself calls
 * consumeRefusals(). Both are explicit, which is the point.
 *
 * EIGHT SUITES call seed() mid-test. An earlier version said "two"; a review
 * then reported ten, and a loose scan eleven — all three counted `seed(` lines
 * that sit in a `beforeEach` or a helper declared after the first test.
 *
 * THE METHOD, since that is what went wrong each time: a `seed(` or
 * `<namespace>.seed(` call lexically inside an `it()`/`test()` callback body,
 * determined by brace depth rather than by line order. Counted that way:
 * routeAuth001CampaignBinding, routeAuth001CampaignBinding2,
 * routeAuth001DataAdmin, routeAuth001TemplatesCreator,
 * routeAuth001TemplatesCreatorRuntime, routeAuthHarnessFidelity,
 * sec91W2EClientIpAdoption (via `harness.seed(...)`), and
 * uploadMediaFinalizeAuthFirst. routeAuth001DataAdmin is the one that also
 * declares an upsert model, so it is the one directly exposed to the erasure.
 */
export function seed(extra: Record<string, Row[]> = {}): void {
  state.tables = baseTables();
  // REFUSED CALLS SURVIVE A RE-SEED. `calls` is otherwise per-test observation
  // state and is cleared — but clearing a refusal out of it removed mechanism
  // (ii) entirely: a suite that swallowed a refusal and then re-seeded for a
  // second scenario got `writeCalls(t).toHaveLength(0)` PASSING. Eight suites in
  // this repository call seed() mid-test, so that was reachable, and one of them
  // (routeAuth001DataAdmin) is a declaring suite.
  state.calls = state.calls.filter((c) => c.refused);
  state.failTables = new Set();
  state.genSeq = 0;
  // Deep-copied, so a stored fixture row never aliases the object the suite
  // passed to seed() — a suite that mutates its own fixture literal between
  // tests would otherwise mutate stored state.
  for (const [t, rows] of Object.entries(extra)) state.tables[t] = [...(state.tables[t] || []), ...rows.map((r) => deepCopy(r))];
  // Reset the allocator, then advance it past every fabricated id now present,
  // so a reset cannot re-mint an id a surviving seeded row already holds.
  for (const rows of Object.values(state.tables)) reserveGenIds(rows);
}
seed();

/**
 * Make queries against `table` return a database error (lookup-failure paths).
 *
 * With no `op`, EVERY statement against the table fails — the original
 * behaviour, and what a lookup-failure path usually wants.
 *
 * With an `op` ('select' | 'insert' | 'update' | 'upsert' | 'delete'), only
 * that statement kind fails. WHY THAT EXISTS: a read-then-write route cannot
 * otherwise be tested on its WRITE failure at all. The fault is checked at the
 * top of runInner, before the op is dispatched, so a table-wide failTable()
 * fails the route's SELECT first and the write is never reached — the test
 * silently exercises the read path while claiming to exercise the write. The
 * two paths can have genuinely different consequences (see
 * pages/api/track/angle-industry-matrix.ts, where a failed read used to
 * OVERWRITE a running aggregate while a failed write merely lost it), so they
 * need to be provable apart.
 *
 * Both forms are additive and are cleared by seed().
 */
export function failTable(table: string, op?: 'select' | 'insert' | 'update' | 'upsert' | 'delete'): void {
  state.failTables.add(op ? `${table}|${op}` : table);
}

/**
 * Declare a uniqueness constraint (e.g. a primary key) on `table.column`, so
 * an INSERT whose value is already present fails with Postgres 23505 instead of
 * silently appending. Opt-in and cleared by seed().
 *
 * This is what lets a suite exercise insert-then-conflict code paths — the
 * shape a route uses when it must not lose a create race (WSF-ORD-007).
 *
 * IF THE TABLE ALSO RECEIVES UPSERTS, declare resolveUpsertConflicts() too.
 * Without an arbiter the harness cannot tell a legitimate merge from a key
 * violation, so an upsert would append straight past this declaration and it
 * would be inert for every upsert in the suite. The builder refuses that
 * combination rather than letting the declaration read as enforcement.
 */
export function uniqueKey(table: string, column: string): void {
  const already = state.unique[table] || [];
  // Deduplicated because a declaration now survives seed(), so a beforeEach
  // that declares the same key before every test would otherwise accumulate it.
  if (already.includes(column)) return;
  state.unique[table] = [...already, column];
}

/**
 * Declare that UPSERTs against `table` resolve their conflict target instead of
 * unconditionally appending. With this declared, `.upsert(rows, { onConflict })`
 * models arbiter selection: a row whose `onConflict` columns all match an
 * existing row is UPDATED in place; a row that matches no arbiter is INSERTed,
 * and the columns declared via uniqueKey() still apply to it — so landing on an
 * occupied key the conflict target does not cover fails with 23505, which is
 * the shape PostgreSQL raises when a *different* unique index is violated.
 *
 * `defaultArbiter` is what to use when `.upsert()` is called with NO options at
 * all. THIS HARNESS DOES NOT KNOW WHAT PostgREST DOES IN THAT CASE, and this
 * paragraph is careful not to say otherwise. The belief most of this repository
 * is written around — that with `resolution=merge-duplicates` and no
 * `on_conflict` parameter the server infers the table's primary key and
 * performs an id-based DO UPDATE — is a BELIEF, sourced from the client's
 * documentation and not from any execution against PostgREST. See "NOT
 * ESTABLISHED" below, which lists the same question.
 *
 * What follows from that is the parameter's whole purpose: a suite that
 * exercises a route which can reach `.upsert()` without options must STATE the
 * default it believes applies, e.g.
 * `resolveUpsertConflicts('content_block', ['id'])`, and that statement is then
 * the suite's input to the model — auditable, attributable, and falsifiable by
 * one database probe. An earlier version of this harness modelled the
 * no-options case as "no arbiter" and returned 23505, reporting as SAFE the
 * re-tenanting a bare primary-key arbiter would perform; an earlier version of
 * THIS COMMENT then over-corrected and asserted the inference as established
 * fact, forty lines above the note disclaiming it.
 *
 * If no `defaultArbiter` is declared and a no-options upsert arrives, this
 * throws rather than guessing. Guessing in either direction is what produced the
 * inverted model; a loud failure makes the suite author state the route's
 * assumed PostgREST semantics instead.
 *
 * Opt-in, and NOT cleared by seed() — it is a suite-level declaration; see
 * seed() and resetHarnessDeclarations(). Conflict RESOLUTION is per table and
 * opt-in; the id ALLOCATOR below is not — see "FABRICATED IDS" in the limits
 * note.
 *
 * WHAT IS MOCKED, AND WHAT IS NOT. Mocked, and nothing more:
 *   - an explicit `onConflict` selects those COLUMN NAMES as the arbiter;
 *   - a no-options upsert uses the declared default, and is refused if none was
 *     declared;
 *   - a row matching no arbiter is an INSERT, and the unique columns —
 *     everything uniqueKey() declared, PLUS `id` always — are enforced over the
 *     statement's WHOLE FINAL STATE, in one check, from set-valued populations.
 *     The verdict therefore cannot depend on element order: a batch and its
 *     reversal always agree. A value another element of the same statement
 *     VACATES is free to be taken, and a legal swap is legal. A duplicate
 *     existing only between two rows the statement does not write is ignored as
 *     illegal fixture state rather than attributed to the statement. See
 *     statementUniqueViolation() for the two order-dependent designs this
 *     replaced, and for what real PostgreSQL may do differently;
 *   - `id` uniqueness is MODELLED on the validating paths (insert, upsert and
 *     update) and NOT in append mode, which validates nothing by contract;
 *   - a statement is all-or-nothing: a violation part-way through a batch
 *     writes nothing;
 *   - two rows sharing the arbiter key in one statement are refused (modelled on
 *     PostgreSQL's 21000) rather than merged;
 *   - an arbiter that names no column, or names a column seen nowhere, is
 *     REFUSED rather than modelled as a plain insert — in BOTH upsert modes,
 *     and for a declared defaultArbiter as well as an explicit onConflict;
 *   - an explicit `id: null` is a SUPPLIED null, modelled as 23502, not as
 *     "no id supplied". A key whose value is `undefined` is dropped before
 *     anything is modelled, because JSON drops it on the wire too.
 *
 * NOT MODELLED AT ALL — these pass through, and a suite must not read anything
 * into their success:
 *   - `ignoreDuplicates` is NEVER READ. `.upsert(rows, { ignoreDuplicates:
 *     true })` is ON CONFLICT DO NOTHING in production and is modelled here as
 *     a DO UPDATE, so the harness OVERWRITES where PostgreSQL would leave the
 *     existing row alone. The direction is fail-loud rather than fail-silent —
 *     a suite asserting "the row was not changed" fails here — but a suite
 *     asserting "the row WAS updated" through such a call is asserting
 *     something production does not do.
 *     THE COUNT, WITH ITS SCOPE: over `backend` + `pages`, excluding `/tests/`
 *     and `*.test.*`, `ignoreDuplicates: true` appears at 38 call sites and
 *     `: false` at 24 (64 mentions of the token in all). An earlier version of
 *     this line said "seven", wrong by more than 5x. The 38 `: true` sites are
 *     the ones this harness mismodels, and several are tenant-scoped and
 *     idempotency-keyed.
 *   - `rpc(fn, args)` records a call with op `'rpc'` and returns
 *     `{ data: null, error: null }` UNCONDITIONALLY. No table model applies, no
 *     poison applies, and writeCalls() does not count it — so a write performed
 *     inside a Postgres function is invisible to every write accessor here.
 *   - `storage.from(...)` returns success for every operation. No bucket, no
 *     object, no authorization is modelled.
 *   - `auth.admin.getUserById` always answers without error.
 *
 * NOT ESTABLISHED BY ANY OF IT — these need a database:
 *   - PostgreSQL's arbiter-INDEX inference. This matches column NAMES and has no
 *     notion of an index; it does not know whether a matching unique index
 *     exists, and on the schema this repository currently describes for
 *     content_block it does NOT, so a green suite here is compatible with a
 *     production path that fails on every call.
 *   - real uniqueness enforcement, and the 23505-vs-DO-UPDATE outcome;
 *   - 21000 for a duplicate arbiter key in one command;
 *   - statement and transaction atomicity;
 *   - PostgREST's wire behaviour, INCLUDING its default conflict resolution.
 *     The `defaultArbiter` parameter above exists so a suite can state what it
 *     BELIEVES that default to be; that belief is a suite's input to the model,
 *     not something this harness has verified. An earlier version of this note
 *     asserted PostgREST's primary-key inference as established fact while
 *     listing its wire behaviour as unverified, nine lines apart.
 *   - PostgREST's requirement that every object in a bulk payload carry the
 *     same keys. A batch mixing id-bearing and id-less rows is ACCEPTED here;
 *     see the limits note.
 *
 * FABRICATED IDS, UNIQUENESS AND RETURNED ROWS — the remaining known gaps:
 *   - A row with NO `id` KEY receives a fabricated `gen-N`. These are
 *     sequential, not uuids, and will not satisfy a uuid validator on a round
 *     trip. The allocator is monotonic and reserves its namespace against
 *     caller-supplied `gen-N`, so it cannot re-mint a live id after a merge or
 *     a delete — but it is NOT opt-in: it changes the fabricated ids of every
 *     multi-row insert in every suite.
 *     An explicit `id: null` is NOT "no id": it is a supplied null, and
 *     minting over it would manufacture a valid row out of invalid input and
 *     hide a caller defect. It is modelled as 23502 on either leg. An `id`
 *     whose value is `undefined` is stripped with every other undefined-valued
 *     key before modelling, matching what JSON.stringify would put on the wire,
 *     so it can neither be minted over nor written across a merged row's real
 *     primary key.
 *   - MINTING HAPPENS DURING PLANNING, so a statement that is then rejected has
 *     still advanced the allocator. That is deliberate and harmless: the
 *     allocator only ever moves forward and never re-issues, so an abandoned
 *     mint costs an ordinal and nothing else. Planning touches no table — the
 *     allocator is the only state it advances, and `state.tables` is written
 *     only in the apply pass, after the whole statement has validated.
 *   - RETURNED ROWS ARE DEEP COPIES ON EVERY DATA METHOD — insert, upsert,
 *     update, delete and select all return deepCopy(row), so mutating a
 *     returned row cannot reach stored state AT ANY DEPTH and two entries of
 *     `data` are never the same object. An earlier version of this sentence
 *     still said `{ ...row }`, the SHALLOW form it replaced, which understated
 *     the guarantee and contradicted deepCopy()'s own docblock. See deepCopy()
 *     for the one real limit: a Date, Map, Set, Buffer, class instance or
 *     NULL-PROTOTYPE object nested in a fixture is shared by reference. An earlier version copied only on the conflict-resolving
 *     upsert path while claiming the property unconditionally; `insert`,
 *     `update`, `delete` and `select` all handed out live references, so route
 *     code of the ordinary shape `const { data } = await sb.from(t).select();
 *     data[0].x = y;` mutated the fake database with no write statement at all.
 *     THE ONE DELIBERATE EXCEPTION is the test accessor `rows(table)`, which
 *     returns the live array ON PURPOSE so a suite can inspect stored state;
 *     it is not a data method and is not part of this contract.
 *   - Copies carry only payload columns: two entries of `data` are never the same
 *     object; they carry only payload columns. The harness models no server
 *     default, so a column like `updated_at` is absent under test and always
 *     present in production.
 *   - `invoke()` NO LONGER DEFAULTS THE STATUS. `status` is `undefined` until
 *     the handler sends something and `responded` says whether it did, because
 *     a default of 200 made `expect(r.status).toBe(200)` pass for a handler
 *     that never responded — which in real Next.js is an error, not a success.
 *     A guard that signals "allowed" by sending nothing should assert
 *     `responded === false`, not a status.
 *   - FIRST SEND WINS, as on a real response. Later sends are recorded in
 *     `extraSends` rather than overwriting. An earlier version kept the LAST
 *     send, which inverted production: a route that sent a 200 body and then a
 *     403 reported "403, nothing leaked" under test while production had
 *     already flushed the body.
 *   - Still divergent, and NOT a production guarantee: `req.query` values and
 *     `req.body` carry whatever types the test passed, where Next.js delivers
 *     `string | string[]` and may deliver no body at all; `req.body` is the
 *     same object the test passed, so a handler that mutates it corrupts the
 *     fixture; and a handler that returns a non-promise and responds
 *     asynchronously is not awaited, so its response is lost. Assert on the
 *     body, not only the status.
 */
export function resolveUpsertConflicts(table: string, defaultArbiter?: string[]): void {
  state.upsertModes[table] = { mode: 'resolve', defaultArbiter: defaultArbiter ?? null };
}

/**
 * Declare that UPSERTs against `table` are modelled as a BLIND APPEND — the
 * harness's historical behaviour — and say why in `reason`.
 *
 * This exists so a suite that genuinely only needs "a write was attempted"
 * can keep that model ON THE RECORD instead of inheriting it silently. It
 * models no conflict resolution at all, so it must NOT be used by a suite that
 * asserts anything about tenant isolation, row identity or uniqueness through
 * an upsert: appending reports success for a payload a real ON CONFLICT might
 * have merged into another tenant's row.
 *
 * `reason` is required so the choice of the weaker model is visible to a
 * reviewer reading the suite. It is retrievable through
 * declaredUpsertMode(table). It is NOT part of the recorded call log — an
 * earlier version of this sentence said it was "printed in the call log", which
 * was never true: the Call type carries no mode and no reason.
 *
 * THE NO-OPTIONS CALL SITES, AUDITED REPO-WIDE. Measured by bracket matching
 * every `.upsert(` under `backend` + `pages` (excluding tests and commented-out
 * code) and checking for a top-level second argument: 301 call sites, 287 with
 * options, 14 with none.
 *
 * THE POPULATION IS MIXED, AND SAYING SO MATTERS. Those 301 are every
 * `.upsert(` TOKEN, not 301 PostgREST statements, so "287 with options" is not
 * a count of Supabase upserts that pass options. At least nineteen of the 301
 * are not Supabase statements at all:
 *   - FOUR are `.upsert()` on application-level store abstractions
 *     (intelligence/manualOverrides ×2, semanticRootRegistry,
 *     leadIntelligenceOrchestration/orchestrator);
 *   - FIFTEEN are the CMS adapters' own `this.upsert(context, externalId,
 *     input)` method, across seven files (cms/DrupalAdapter ×2,
 *     cms/GhostAdapter ×3, cms/HubSpotCmsAdapter ×2, cms/JoomlaAdapter ×2,
 *     cms/ShopifyAdapter ×2, cms/WebflowAdapter ×2, cms/WixCmsAdapter ×2).
 *     These carry THREE arguments, so the top-level-comma test counted them
 *     into "287 with options" although they pass no PostgREST options and
 *     reach no database. An earlier version of this census did not mention
 *     them, which left the 301/287/14 split reading as a clean partition of
 *     PostgREST statements when it is not.
 * NEITHER GROUP AFFECTS THE CONCLUSION BELOW: every one of the nineteen passes
 * at least two arguments, so none of them was ever among the 14. The operative
 * figure is the 14, and what matters about it is which are real Supabase
 * statements — the four store abstractions are not, leaving
 * TEN genuine ones across SIX files:
 *   campaigns/save-strategy.ts:64  campaign_strategies           (declared)
 *   campaigns/save-strategy.ts:102 content_pillars               (declared)
 *   campaigns/save-strategy.ts:127 platform_strategies           (declared)
 *   campaigns/[id]/approve-frequency-rebalance.ts:130 platform_strategies (declared)
 *   campaigns/metrics.ts:96        campaign_performance_metrics  (declared)
 *   campaigns/save-weekly-plan.ts:24 weekly_content_plans        (no suite reaches it)
 *   services/configService.ts:438  (dynamic table name)          (no suite reaches it)
 *   services/pricingConfigService.ts:64, :73, :85                (no suite reaches it)
 *
 * AN EARLIER VERSION OF THIS CENSUS SAID ELEVEN ACROSS SEVEN, and listed
 * `queue/jobProcessors/whatsappWebhookProcessor.ts:128 engagement_messages`
 * among them. THAT WAS WRONG: that statement passes
 * `{ onConflict: 'thread_id,platform_message_id' }`, with a ten-line comment
 * explaining the arbiter choice. The error had a reproducible cause worth
 * recording — the scanner tracked string state but did not skip COMMENTS inside
 * the argument list, and that payload contains a comment with apostrophes
 * ("one tenant's webhook"), which desynchronised its quote tracking so the real
 * second argument was never seen. The corrected scanner skips line comments and
 * block comments during the argument scan.
 *
 * The error also propagated misleading guidance into
 * sec91AEngagementReplyDraft.test.ts, which has been corrected: a suite driving
 * the webhook processor would NOT need `alsoForNoOptionsCalls` — it would need
 * `resolveUpsertConflicts('engagement_messages', ['thread_id','platform_message_id'])`
 * with those columns present on a fixture row or in the batch, or it gets 42P10.
 *
 * The four unreached sites get no declaration — an acknowledgement on a path
 * nothing exercises would weaken the model for nothing. They are listed so the
 * next person does not re-derive the audit.
 *
 * `alsoForNoOptionsCalls` must be set explicitly for a table whose production
 * `.upsert()` is called with NO options. Append mode used to swallow that case
 * silently, which made it the one way to bypass the single refusal this harness
 * documents as mandatory — the case where the server's default conflict
 * resolution decides whether a cross-tenant write merges. Acknowledging it
 * records that the suite knows nothing here models that resolution.
 */
export function upsertAppendsBlindly(
  table: string,
  reason: string,
  opts?: { alsoForNoOptionsCalls?: boolean },
): void {
  if (!reason || !reason.trim()) {
    throw new HarnessConfigurationError(
      `upsertAppendsBlindly('${table}') requires a reason, so the choice of the weaker model is visible to a reviewer.`,
    );
  }
  state.upsertModes[table] = {
    mode: 'append',
    reason: reason.trim(),
    noOptionsAcknowledged: opts?.alsoForNoOptionsCalls === true,
  };
}

/** The declared upsert model for `table`, or undefined. For assertions. */
export function declaredUpsertMode(table: string): UpsertMode | undefined {
  return state.upsertModes[table];
}

/**
 * The recorded statements, in order.
 *
 * RETURNS THE LIVE ARRAY, like rows() and unlike refusedCalls(). A suite could
 * therefore truncate it and erase mechanism (ii) wholesale; nothing here
 * prevents that, and only the refusal LEDGER would survive. The asymmetry was
 * undocumented, which is the part worth fixing — each recorded Call is itself a
 * snapshot (see Call.options), so the ELEMENTS cannot drift even though the
 * array can be emptied.
 */
export function calls(): Call[] {
  return state.calls;
}
/**
 * The LIVE stored rows of `table` — deliberately not a copy, so a suite can
 * inspect stored state. See the RETURNED ROWS contract for why this is the one
 * exception to it.
 *
 * THROWS IF THE TABLE IS POISONED. A suite that swallowed a refusal and then
 * reads stored state to conclude "the write was rejected, the row is unchanged"
 * is reading a row nothing ever attempted to write. That is the false pass the
 * refusal machinery exists to prevent, and this is the half of it a suite
 * cannot opt out of by simply not touching the table again.
 */
export function rows(table: string): Row[] {
  if (state.poisoned.has(table)) {
    throw new HarnessConfigurationError(
      `rows("${table}") was read after a statement against it was REFUSED in this test. Stored state here proves nothing: the ` +
        `write was never modelled, so an unchanged row is not evidence that anything rejected it. Declare the upsert model this ` +
        `suite intends, or call consumeRefusals() if this test is deliberately asserting the refusal itself.`,
    );
  }
  return state.tables[table] || [];
}
/** Calls that touched one of `tables` (the route's sink), guard reads excluded by choice of tables. */
export function sinkCalls(tables: string[]): Call[] {
  return state.calls.filter((c) => tables.includes(c.table));
}

/**
 * Statements that ATTEMPTED a write, INCLUDING ones the harness refused.
 *
 * The inclusion is deliberate and is the opposite of an earlier version. A
 * refusal writes nothing, so excluding it made `writeCalls(t).toHaveLength(0)`
 * — the assertion suites actually write — PASS on a misconfigured harness, as
 * though a security control had rejected a real write. Including it makes that
 * assertion FAIL, loudly, which is the only safe direction.
 *
 * SO: a "nothing was written" assertion belongs HERE, on writeCalls(). Reach
 * for completedWrites() only when the question is specifically "which
 * statements actually wrote" — for instance when a test deliberately forces a
 * failure and wants to confirm the write did not land. Note that op `'rpc'` is
 * NOT a write by this definition and is never counted; see the NOT MODELLED
 * list for what that hides.
 */
export function writeCalls(tables?: string[]): Call[] {
  return state.calls.filter((c) => ['insert', 'update', 'upsert', 'delete'].includes(c.op) && (!tables || tables.includes(c.table)));
}

/**
 * Writes that RAN WITHOUT ERROR.
 *
 * One definition, recorded when the statement ran (see Call.completed): it ran,
 * it was not refused, it was not forced to fail, and it returned no error. A
 * modelled 23505 or 21000 is therefore NOT a completed write — nothing was
 * stored — and a failTable() call made after the fact cannot change what an
 * earlier statement did.
 *
 * READ THE NAME PRECISELY: "ran without error" is NOT "changed a row". An
 * UPDATE or DELETE whose filters match nothing runs cleanly and is counted here
 * with `count: 0`, which is faithful to SQL. So
 * `completedWrites(t).toHaveLength(1)` establishes that a statement was issued
 * and accepted, never that a row moved — pair it with the returned `count`, or
 * with the stored row, when the row is the point.
 *
 * An earlier version computed this at assertion time from `state.failTables`
 * and had three mutually inconsistent behaviours; its own two docstrings
 * disagreed about what it meant.
 */
export function completedWrites(tables?: string[]): Call[] {
  return writeCalls(tables).filter((c) => c.completed === true);
}

/**
 * Writes that RAN and returned a modelled database error — 23505, 21000, 23502
 * or a forced XX000. Nothing was stored.
 *
 * THE FOUR OUTCOMES, which are now four and not two:
 *   ATTEMPTED  writeCalls()       — every write statement, including refusals.
 *   COMPLETED  completedWrites()  — ran, no refusal, no error. ONLY these may be
 *                                  read as "the write happened".
 *   REFUSED    refusedCalls()     — the harness declined to model it; a SUITE
 *                                  defect, never enforcement.
 *   ERRORED    erroredWrites()    — ran and the MODEL rejected it.
 *
 * A grant-path assertion belongs on completedWrites(). A no-write assertion
 * belongs on writeCalls(), which counts refusals so it cannot pass on one.
 */
export function erroredWrites(tables?: string[]): Call[] {
  return writeCalls(tables).filter((c) => typeof c.errorCode === 'string');
}

type Filter = { col: string; op: string; val: unknown };

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((f) => {
    const v = row[f.col];
    switch (f.op) {
      case 'eq': return v === f.val || (v != null && f.val != null && String(v) === String(f.val));
      case 'neq': return v !== f.val;
      case 'in': return Array.isArray(f.val) && (f.val as unknown[]).map(String).includes(String(v));
      case 'is': return f.val === null ? v == null : v === f.val;
      case 'gt': return v > (f.val as any);
      case 'gte': return v >= (f.val as any);
      case 'lt': return v < (f.val as any);
      case 'lte': return v <= (f.val as any);
      default: return true;
    }
  });
}

function makeBuilder(table: string): any {
  const filters: Filter[] = [];
  let op = 'select';
  let payload: any = null;
  /** Second argument of insert/update/upsert/delete, e.g. `{ onConflict }`. */
  let options: unknown;
  let limitN: number | null = null;
  let orderBy: { col: string; asc: boolean } | null = null;
  const b: any = {};
  const passthrough = ['select', 'range', 'or', 'not', 'ilike', 'like', 'contains', 'overlaps', 'match', 'textSearch', 'filter', 'returns', 'abortSignal', 'csv', 'throwOnError'];
  for (const m of passthrough) b[m] = () => b;
  for (const m of ['eq', 'neq', 'in', 'is', 'gt', 'gte', 'lt', 'lte']) {
    b[m] = (col: string, val: unknown) => { filters.push({ col, op: m, val }); return b; };
  }
  b.order = (col: string, opts?: { ascending?: boolean }) => { orderBy = { col, asc: opts?.ascending !== false }; return b; };
  b.limit = (n: number) => { limitN = n; return b; };
  for (const m of ['insert', 'update', 'upsert', 'delete']) {
    b[m] = (p?: unknown, o?: unknown) => { op = m; payload = p; options = o; return b; };
  }
  const runInner = (): { data: any; error: any; count: number } => {
    if (state.poisoned.has(table)) {
      throw new HarnessConfigurationError(
        `a previous statement against "${table}" was REFUSED in this test, so the harness refuses every later operation on it. ` +
          `Nothing it appears to have prevented was actually prevented. Declare the upsert model this suite intends.`,
      );
    }
    // Table-wide fault, or one scoped to this statement kind. See failTable().
    if (state.failTables.has(table) || state.failTables.has(`${table}|${op}`)) {
      return { data: null, error: { message: `forced failure on ${table}`, code: 'XX000' }, count: 0 };
    }
    const all = state.tables[table] || (state.tables[table] = []);
    if (op === 'insert' || op === 'upsert') {
      // Each id-less row in a batch gets a DISTINCT fabricated id. An earlier
      // version read `all.length` once per element, before any row was pushed,
      // so every id-less row in one batch was fabricated with the SAME id. That
      // was invisible while upserts appended blindly, but once they began
      // resolving an arbiter the second row matched the first and was merged
      // into it — silently collapsing a multi-row insert to one row. That is
      // precisely the production call shape here: splitIntoBlocks emits blocks
      // with no id, and both generation callers pass several of them at once.
      // Each row becomes its OWN object. An id is NOT minted here: minting is
      // deferred until the plan knows the row will be INSERTed, because an
      // UPSERT that MERGES must not carry a fabricated id into the matched row
      // and overwrite its real primary key.
      //
      // UNDEFINED-VALUED KEYS ARE DROPPED, matching the wire: JSON.stringify
      // omits them, so a request never carries `"id": undefined` and the model
      // must not either. Without this, `{...target, ...row}` wrote `undefined`
      // over a merged row's real primary key, and `needsId` could not tell an
      // absent key from a present-but-undefined one.
      // DEEP-copied on intake, so a stored row never aliases the caller's own
      // payload object. See deepCopy() for the one-level-down leak this closes.
      const batch: Row[] = (Array.isArray(payload) ? payload : [payload]).map((r: Row) => {
        const copy: Row = {};
        for (const [k, v] of Object.entries(r || {})) if (v !== undefined) copy[k] = deepCopy(v);
        return copy;
      });
      // Reserve ids the caller supplied in the fabricated shape BEFORE minting,
      // so a generated id can never duplicate one of them.
      reserveGenIds(batch);
      // No `id` KEY at all. An explicit `id: null` is a supplied null and is
      // handled as 23502 — minting over it would fabricate a valid row from
      // invalid input and hide the caller defect that produced it.
      const needsId = (r: Row): boolean => !('id' in r);
      const hasSuppliedNullId = (): boolean => batch.some((r) => r.id === null);

      if (op === 'insert') {
        // An INSERT has no upsert model to require, so the row-level null check
        // is free to run first here.
        if (hasSuppliedNullId()) return notNullResult(table, 'id');
        const list: Row[] = batch.map((row: Row) => {
          if (needsId(row)) row.id = mintId(table);
          return row;
        });
        // An INSERT overwrites nothing, so every stored row is a survivor and
        // every new row is a final. Same whole-statement rule as the other legs.
        // `before` is every stored row; an INSERT overwrites none of them, so
        // survivors and before are the same population here.
        const bad = statementUniqueViolation(table, all, list, all);
        if (bad) return duplicateKeyResult(table, bad);
        all.push(...list);
        return { data: list.map((r) => deepCopy(r)), error: null, count: list.length };
      }

      // ---- UPSERT ----------------------------------------------------------
      // Every table must have declared a model; there is no default. See
      // requireUpsertMode for why guessing is not an option here.
      const upsertMode = requireUpsertMode(table);

      if (upsertMode.mode === 'append') {
        if ((state.unique[table] || []).length > 0) {
          throw new HarnessConfigurationError(
            `"${table}" declares uniqueKey() and the append upsert model at the same time. An appending upsert walks straight past ` +
              `the declared key, so the uniqueKey() call would be inert for every upsert in this suite while reading as enforcement. ` +
              `Use resolveUpsertConflicts('${table}', [...]) instead, or drop the uniqueKey() declaration.`,
          );
        }
        // APPEND MODE IS NOT AN EXEMPTION FROM THE CONFIGURATION CHECKS. An
        // earlier version returned from here before any of them, so declaring
        // append silenced the no-options refusal — the one case this harness
        // documents as mandatory, and the one where the server's default
        // conflict resolution is what decides whether a cross-tenant write
        // merges. Two production call sites on platform_strategies pass no
        // options at all and were reaching this path.
        const declaredTarget = (options as { onConflict?: unknown } | undefined)?.onConflict;
        if (declaredTarget === undefined || declaredTarget === null) {
          if (!upsertMode.noOptionsAcknowledged) {
            throw new HarnessConfigurationError(
              `.upsert() on "${table}" was called with no onConflict option, and this suite declared the APPEND model without ` +
                `acknowledging that call shape. Appending reports success for a payload the server's default conflict resolution ` +
                `might have merged into another tenant's row, and what that default is has NOT been established by this ` +
                `repository. Either state the default you believe applies — resolveUpsertConflicts('${table}', ` +
                `['<arbiter column>']) — or record that this suite's assertions do not depend on it: ` +
                `upsertAppendsBlindly('${table}', '<why>', { alsoForNoOptionsCalls: true }).`,
            );
          }
        } else {
          // An explicit target still has to be a target the harness could
          // model: `ON CONFLICT ()` is a syntax error and a column matching no
          // unique index is 42P10, in append mode no less than in resolve mode.
          const cols = String(declaredTarget).split(',').map((c) => c.trim()).filter(Boolean);
          if (cols.length === 0) {
            throw new HarnessConfigurationError(
              `.upsert() on "${table}" named an onConflict of ${JSON.stringify(String(declaredTarget))}, which parses to no column ` +
                `at all. PostgreSQL rejects ON CONFLICT () as a syntax error; the harness will not model it as a plain append.`,
            );
          }
          assertArbiterColumnsKnown(table, cols, batch, `.upsert()`);
        }
        // A SUPPLIED NULL ID IS STILL 23502 HERE, checked after this branch's
        // own configuration guards so a malformed row cannot buy an exemption
        // from them. Append mode models no CONFLICT RESOLUTION; that is its
        // whole contract. It never promised to store a row with a null identity,
        // and the "WHAT IS MOCKED" list states the 23502 rule without an append
        // exception — so omitting it here made the list false and let an
        // unusable row (`{"id": null}`) into the table silently.
        if (hasSuppliedNullId()) return notNullResult(table, 'id');
        const list: Row[] = batch.map((row: Row) => {
          if (needsId(row)) row.id = mintId(table);
          return row;
        });
        all.push(...list);
        return { data: list.map((r) => deepCopy(r)), error: null, count: list.length };
      }

      // resolve mode: arbiter selection, modelled. Runs BEFORE the row-level
      // null-id check below, so a malformed row can never short-circuit a
      // mandatory configuration refusal — see the note on that check.
      const arbiter = resolveArbiter(table, options, batch);

      // THREE PASSES, NOT ONE. Every earlier version decided each element as it
      // walked the batch, which made the verdict depend on element order; see
      // statementUniqueViolation() for the two distinct ways that went wrong.
      //
      //   PASS 1  resolve each element's target, and settle CARDINALITY for the
      //           whole statement.
      //   PASS 2  mint for the insert legs, build the final-state populations,
      //           and validate ONCE.
      //   PASS 3  apply — reached only if the whole statement is legal.

      // ---- PASS 1: targets and cardinality ---------------------------------
      // Cardinality is settled for the WHOLE statement before any uniqueness
      // check runs. PostgreSQL's ON CONFLICT DO UPDATE cannot affect one row
      // twice in a single command, and that is a different defect from a unique
      // violation. An earlier version interleaved the two checks per element, so
      // a statement containing BOTH returned whichever code sat at the lower
      // index — 21000 one way round and 23505 the other.
      const plan: Array<{ row: Row; target?: Row }> = [];
      const seenKeys = new Set<string>();
      for (const r of batch) {
        const key = arbiterKey(r, arbiter);
        if (key !== null) {
          // A NULL or absent arbiter value yields no key at all, so it is NOT
          // deduplicated — a unique index treats NULLs as distinct.
          if (seenKeys.has(key)) return cardinalityResult(table, arbiter);
          seenKeys.add(key);
        }
        // Matched against the table AS IT STANDS BEFORE the batch, so a later
        // row cannot resolve onto one this same statement just inserted.
        const target = key === null
          ? undefined
          : all.find((x) => arbiter.every((c) => x[c] != null && String(x[c]) === String(r[c])));
        plan.push({ row: r, target });
      }

      // A supplied NULL id, checked only now — after requireUpsertMode and
      // resolveArbiter. It used to be tested on intake, ahead of both, so ONE
      // `id: null` anywhere in a batch returned a modelled 23502 and the
      // statement was never measured against any declared model: an undeclared
      // table, an unknown arbiter column and an empty `onConflict` all stopped
      // being refused, with no refusal recorded and no poison set. That defeated
      // this harness's headline invariant.
      if (hasSuppliedNullId()) return notNullResult(table, 'id');

      // ---- PASS 2: mint, then validate the whole statement's final state ---
      for (const step of plan) {
        if (!step.target && needsId(step.row)) step.row.id = mintId(table);
      }
      const movedTargets = plan.map((s) => s.target).filter((t): t is Row => !!t);
      const finals = plan.map((s) => (s.target ? { ...s.target, ...s.row } : s.row));
      const survivors = all.filter((x) => !movedTargets.includes(x));
      // `all` is the pre-statement population — survivors AND the rows being
      // merged — which is what the multiplicity baseline must be measured over.
      const bad = statementUniqueViolation(table, survivors, finals, all);
      if (bad) return duplicateKeyResult(table, bad);
      // ---- PASS 3: apply ---------------------------------------------------
      const out: Row[] = [];
      for (const step of plan) {
        if (step.target) {
          Object.assign(step.target, step.row);
          out.push(deepCopy(step.target));
        } else {
          all.push(step.row);
          out.push(deepCopy(step.row));
        }
      }
      return { data: out, error: null, count: out.length };
    }
    let hit = all.filter((r) => matches(r, filters));
    if (op === 'update') {
      // Same normalisation as the insert/upsert payload: an undefined-valued key
      // never reaches the wire, so it must not overwrite a column here either,
      // and the value is deep-copied so a stored row never aliases the patch.
      const rawPatch = (payload && typeof payload === 'object' ? payload : {}) as Row;
      const patch: Row = {};
      for (const [k, v] of Object.entries(rawPatch)) if (v !== undefined) patch[k] = deepCopy(v);
      if (patch.id === null) return notNullResult(table, 'id');
      // ONE WHOLE-STATEMENT, FINAL-STATE CHECK, exactly as the upsert legs use.
      // Two earlier versions were wrong here in opposite directions: the first
      // compared each matched row only against the stored table, so an UPDATE
      // matching several rows could set one declared-unique value on all of them
      // and return error: null; the second accumulated as it walked, so rows
      // LATER in `hit` still counted with their OLD values and a patch that did
      // not even touch the unique column could be rejected.
      const survivors = all.filter((x) => !hit.includes(x));
      const finals = hit.map((r) => ({ ...r, ...patch }));
      const bad = statementUniqueViolation(table, survivors, finals, all);
      if (bad) return duplicateKeyResult(table, bad);
      hit.forEach((r) => Object.assign(r, patch));
      return { data: hit.map((r) => deepCopy(r)), error: null, count: hit.length };
    }
    if (op === 'delete') {
      const removed = hit.map((r) => deepCopy(r));
      state.tables[table] = all.filter((r) => !hit.includes(r));
      return { data: removed, error: null, count: removed.length };
    }
    if (orderBy) {
      const { col, asc } = orderBy;
      hit = [...hit].sort((x, y) => (x[col] === y[col] ? 0 : (x[col] > y[col] ? 1 : -1) * (asc ? 1 : -1)));
    }
    if (limitN != null) hit = hit.slice(0, limitN);
    // Copies, like every other path: a returned row must not be a handle
    // on stored state. See the RETURNED ROWS contract in the limits note.
    return { data: hit.map((r) => deepCopy(r)), error: null, count: hit.length };
  };
  /**
   * Record the statement, then model it.
   *
   * When the harness REFUSES a statement as a suite configuration defect, the
   * recorded call is flagged `refused` and writeCalls() DELIBERATELY STILL
   * COUNTS IT — an earlier version of this very comment said writeCalls()
   * excludes it, which was the opposite of the design and of the code twenty
   * lines away. completedWrites() is what excludes it.
   * refusedCalls()/assertNoHarnessConfigurationError() surface it from a ledger
   * seed() cannot clear.
   *
   * The refusal is deliberately a throw and not a returned error: a returned
   * error is indistinguishable from a modelled database failure, and a suite
   * could read it as enforcement.
   *
   * `completed` is set HERE, from the result, so it records what this statement
   * did rather than being recomputed later from mutable state.
   */
  const run = (): { data: any; error: any; count: number } => {
    // PAYLOAD AND OPTIONS ARE SNAPSHOTTED. They used to be the caller's own
    // objects by reference, so a route that mutated its payload AFTER the
    // statement changed what writeCalls() reported — an observation that drifts
    // is worse than no observation, and the residual note reasons explicitly
    // about `.payload` being readable on a refused call. Stored rows were
    // already deep-copied on intake; the recorded observation was not.
    const recorded: Call = {
      table,
      op,
      filters: Object.fromEntries(filters.map((f) => [f.col, deepCopy(f.val)])),
      payload: deepCopy(payload),
      options: deepCopy(options),
    };
    state.calls.push(recorded);
    try {
      const result = runInner();
      if (result.error) recorded.errorCode = String((result.error as { code?: unknown }).code ?? 'unknown');
      else recorded.completed = true;
      return result;
    } catch (e) {
      if (isHarnessConfigurationError(e)) {
        recorded.refused = true;
        state.refusalLedger.push(recorded);
        // Poison the table for the rest of this test: a suite must not swallow
        // one refusal and then keep reading state as though the write had been
        // considered and rejected. Only consumeRefusals() clears it.
        state.poisoned.add(table);
      }
      throw e;
    }
  };
  b.maybeSingle = async () => { const r = run(); return { data: r.error ? null : (r.data[0] ?? null), error: r.error }; };
  b.single = async () => {
    const r = run();
    if (r.error) return { data: null, error: r.error };
    return r.data[0] ? { data: r.data[0], error: null } : { data: null, error: { message: 'no rows', code: 'PGRST116' } };
  };
  b.then = (ok: any, err: any) => Promise.resolve(run()).then(ok, err);
  return b;
}

export const fakeSupabase: any = {
  from: (t: string) => makeBuilder(t),
  rpc: async (fn: string, args?: unknown) => {
    state.calls.push({ table: `rpc:${fn}`, op: 'rpc', filters: {}, payload: args });
    return { data: null, error: null };
  },
  storage: { from: () => ({ upload: async () => ({ data: null, error: null }), remove: async () => ({ data: null, error: null }), getPublicUrl: () => ({ data: { publicUrl: '' } }), createSignedUrl: async () => ({ data: { signedUrl: '' }, error: null }) }) },
  auth: {
    getUser: async (token?: string) => {
      const u = token ? USERS_BY_TOKEN[token] : null;
      return u ? { data: { user: u }, error: null } : { data: { user: null }, error: { message: 'invalid' } };
    },
    admin: { getUserById: async (id: string) => ({ data: { user: Object.values(USERS_BY_TOKEN).find((u) => u.id === id) ?? null }, error: null }) },
  },
};

export function supabaseModule() {
  return { supabase: fakeSupabase, default: fakeSupabase, getSupabase: () => fakeSupabase, supabaseAdmin: fakeSupabase };
}
export function writeOwnerModule() {
  return { ownedDbTable: (t: string) => makeBuilder(t) };
}

function tokenOf(req: any): string | null {
  const h = req?.headers?.authorization || req?.headers?.Authorization;
  if (typeof h === 'string' && h.startsWith('Bearer ')) return h.slice(7);
  return null;
}
export function userForRequest(req: any): { id: string; email: string } | null {
  const t = tokenOf(req);
  return t ? USERS_BY_TOKEN[t] ?? null : null;
}

export function authModule() {
  return {
    getSupabaseUserFromRequest: jest.fn(async (req: any) => {
      const u = userForRequest(req);
      if (u) return { user: u, error: null };
      return { user: null, error: tokenOf(req) ? 'INVALID_AUTH' : 'MISSING_AUTH' };
    }),
  };
}

export function identityModule() {
  return {
    resolvePrincipal: jest.fn(async (req: any) => {
      const u = userForRequest(req);
      return u
        ? { ok: true, principal: { userId: u.id, supabaseUid: u.id, email: u.email, legacyCookieSuperAdmin: false } }
        : { ok: false, reason: 'NO_AUTH' };
    }),
  };
}

export type Invoked = {
  /**
   * The status the handler SENT, or `undefined` when it sent nothing — a default
   * of 200 made `expect(r.status).toBe(200)` pass for a handler that never
   * responded, which in real Next.js is an error, not a success.
   */
  status: number | undefined;
  body: any;
  headers: Record<string, unknown>;
  redirect: string | null;
  /** True once the handler sent a response. */
  responded: boolean;
  /** Sends after the first. Recorded, never applied — see the note on invoke(). */
  extraSends: Array<{ status: number | undefined; body: any }>;
};

/** Invoke a Next.js API handler with a fake req/res. `as` picks the caller (A, B, SUPER) or anonymous. */
export async function invoke(
  handler: (req: any, res: any) => unknown,
  opts: { method?: string; query?: Record<string, unknown>; body?: unknown; as?: 'A' | 'B' | 'SUPER' | null; headers?: Record<string, string> } = {},
): Promise<Invoked> {
  const headers: Record<string, string> = { ...(opts.headers || {}) };
  if (opts.as) headers.authorization = `Bearer ${TOKENS[opts.as]}`;
  const req: any = {
    method: opts.method || 'GET',
    query: { ...(opts.query || {}) },
    body: opts.body ?? {},
    headers,
    cookies: {},
    url: '/api/test',
    socket: { remoteAddress: '127.0.0.1' },
  };
  const out: Invoked = { status: undefined, body: undefined, headers: {}, redirect: null, responded: false, extraSends: [] };
  // FIRST SEND WINS, like a real HTTP response. An earlier version let the LAST
  // send overwrite the first, which inverted production: a route that sent a
  // 200 body and then a 403 reported "403, nothing leaked" under test while
  // production had already flushed the body. Later sends are recorded in
  // `extraSends` so a test can assert the route double-sent at all.
  let pendingStatus: number | undefined;
  const commit = (b: unknown, hasBody: boolean) => {
    if (out.responded) {
      out.extraSends.push({ status: pendingStatus, body: hasBody ? b : undefined });
      return;
    }
    out.responded = true;
    out.status = pendingStatus ?? 200;
    if (hasBody) out.body = b;
  };
  const res: any = {
    statusCode: 200,
    headersSent: false,
    status(code: number) { pendingStatus = code; this.statusCode = code; return this; },
    json(b: unknown) { commit(b, true); this.headersSent = true; return this; },
    send(b: unknown) { commit(b, true); this.headersSent = true; return this; },
    end(b?: unknown) { commit(b, b !== undefined); this.headersSent = true; return this; },
    setHeader(k: string, v: unknown) { out.headers[k.toLowerCase()] = v; return this; },
    getHeader(k: string) { return out.headers[k.toLowerCase()]; },
    removeHeader(k: string) { delete out.headers[k.toLowerCase()]; },
    writeHead(code: number) { pendingStatus = code; this.headersSent = true; commit(undefined, false); return this; },
    write() { return true; },
    redirect(a: number | string, b?: string) {
      if (typeof a === 'number') { pendingStatus = a; out.redirect = b ?? null; } else { pendingStatus = 307; out.redirect = a; }
      commit(undefined, false);
      this.headersSent = true;
      return this;
    },
    on() { return this; },
    once() { return this; },
  };
  await handler(req, res);
  return out;
}

/** True when a serialized response body mentions company B's canary. */
export function leaksB(body: unknown): boolean {
  try { return JSON.stringify(body ?? '').includes(CANARY_B) || JSON.stringify(body ?? '').includes(CO_B); } catch { return false; }
}
