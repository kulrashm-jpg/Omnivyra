/**
 * FIX3-B1 — `content_block` upsert must not permit a cross-tenant write.
 *
 * THE DEFECT THIS LOCKS DOWN. `collaborationService.upsertBlocks` built its
 * rows from caller-supplied data and wrote them with `onConflict: 'id'` over
 * the RLS-bypassing service-role client. `content_block.id` is a globally
 * unique primary key, so a caller-supplied id was sufficient to land an
 * `ON CONFLICT (id) DO UPDATE` on ANOTHER company's row and rewrite its
 * `company_id` — destroying that row and moving it into the caller's tenant.
 * The route proved the CONTENT belonged to the caller; it never proved the
 * BLOCKS did, and passed `req.body.blocks` through with `as never`.
 * On top of that, every failure returned `[]`, so a denied write and a
 * successful no-op were indistinguishable to the caller.
 *
 * WHAT IS ASSERTED HERE. The real validation chain in upsertBlocks runs against
 * the shared fake-database harness (the same one the route-authorization suites
 * use), so these are not permissive mocks: the ownership lookup really queries
 * a table whose rows carry company_id / content_id, and the write really lands
 * in it. The cross-tenant and out-of-scope cases assert BOTH that the call is
 * refused AND that no row was mutated — a refusal that still wrote would pass a
 * status assertion alone. The shape-validation and database-failure cases
 * assert the status and code only, because they are refused before any write is
 * attempted and the surrounding cases already pin that no write reached the
 * table; an earlier version of this paragraph claimed every test asserted both,
 * which was not true of those four.
 *
 * HOW THE CONFLICT TARGET IS PINNED — two independent ways, because one of them
 * alone is not enough. (1) The target is read off the ARGUMENTS captured from
 * the actual `.upsert(rows, options)` call, not off the exported constant. That
 * is a string comparison: it catches a revert, but it only proves a spelling.
 * (2) A BEHAVIOURAL group puts the service in the one state the target exists
 * for — the ownership answer has gone stale because the row was re-parented in
 * the window between the check and the write — and asserts the outcome: the
 * write is refused, the other company's row keeps its owner and its text, and
 * no row is created at the caller-chosen id. Reverting the call site to
 * `{ onConflict: 'id' }` flips all three.
 *
 * The harness is told to resolve that target (resolveUpsertConflicts) and to
 * enforce the primary key (uniqueKey), so a legitimate same-company update is
 * asserted as an in-place row change rather than as an appended mock row, and a
 * multi-block id-less batch — the shape both generation callers send — is
 * asserted to keep every row with a distinct id.
 *
 * Each of the four id-normalisation sites is pinned by its own test. Three of
 * them were previously unobservable: removing the database-side lower-case, the
 * write-side trim or the capture-side trim each left this suite green.
 *
 * WHAT THE MUTATION EVIDENCE FOR THE COMPANY PREDICATE ACTUALLY IS, since an
 * earlier account of it was wrong in a way that flattered this suite.
 *
 * Deleting `.eq('company_id', companyId)` from the ownership lookup kills six
 * tests here. That much is right. The classification was not: it was reported
 * as "four behavioural", and it is THREE, all of them the same assertion —
 * `expect(writesToBlocks()).toHaveLength(0)`, at the three places this file
 * writes it. The other three kills are two argument-string comparisons and one
 * status-code comparison.
 *
 * MORE IMPORTANTLY: every ROW-STATE assertion survives that deletion. The
 * `toEqual(PROTECTED_B2)` lines and the row-count lines all still pass, because
 * the harness's arbiter model refuses the write on the declared unique key and
 * the row is therefore untouched for a reason that has nothing to do with the
 * control under test — and that model stands in for a unique key only the
 * UNAPPLIED migration creates. So the primary cross-tenant control here rests
 * on three write-attempt counters, which are schema-independent, plus a status
 * and two strings. Deleting those three lines would leave it resting on
 * nothing behavioural at all. They are load-bearing; treat them that way.
 *
 * WHAT IS NOT ASSERTED HERE. The harness is a MODEL. It resolves the arbiter
 * columns it is handed and then applies the declared unique key; it does not
 * implement PostgreSQL's arbiter-index inference. Nothing in this file is
 * evidence about PostgreSQL uniqueness enforcement or ON CONFLICT semantics —
 * that the composite unique key exists, that `(company_id, id)` infers it, and
 * that a foreign id therefore raises 23505 all remain UNVERIFIED pending
 * execution against a real database.
 */
import {
  seed,
  rows,
  calls,
  failTable,
  uniqueKey,
  resolveUpsertConflicts,
  fakeSupabase,
  assertNoHarnessConfigurationError,
  CO_A,
  CO_B,
} from '../helpers/routeAuthHarness';

jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());

/* eslint-disable-next-line @typescript-eslint/no-var-requires */
const collaborationService = require('../../services/content/collaborationService');

// Real uuids: upsertBlocks rejects a malformed id before any database access,
// so the fixtures must be well-formed to exercise the ownership path at all.
// Every BLOCK_* fixture deliberately contains hex LETTERS: an all-digit uuid is
// unchanged by toUpperCase(), which would make the case-normalisation cases
// below pass without testing anything.
const CONTENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CONTENT_A2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CONTENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BLOCK_A1 = '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a';
const BLOCK_A2_OTHER_CONTENT = '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b';
const BLOCK_B1 = '3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c';
/**
 * Company B's block, deliberately carrying company A's CONTENT id.
 *
 * WHY THIS FIXTURE EXISTS. Every other company-B fixture is foreign in BOTH
 * columns, so the ownership lookup's `.eq('content_id', …)` alone refuses it
 * and the `.eq('company_id', …)` predicate — the PRIMARY cross-tenant control —
 * could be deleted with no outcome test noticing. This row is foreign in the
 * COMPANY column only, so the company predicate is the only thing standing
 * between company A and it.
 */
const BLOCK_B2_SAME_CONTENT = '4d4d4d4d-4d4d-4d4d-8d4d-4d4d4d4d4d4d';
const BLOCK_ABSENT = '9d9d9d9d-9d9d-4d9d-8d9d-9d9d9d9d9d9d';

type Block = Record<string, unknown>;

function seedBlocks(): void {
  seed({
    content_block: [
      { id: BLOCK_A1, company_id: CO_A, content_id: CONTENT_A, block_type: 'body', position: 0, text: 'A original', locked: false },
      { id: BLOCK_A2_OTHER_CONTENT, company_id: CO_A, content_id: CONTENT_A2, block_type: 'body', position: 0, text: 'A other content', locked: false },
      { id: BLOCK_B1, company_id: CO_B, content_id: CONTENT_B, block_type: 'body', position: 0, text: 'B CONFIDENTIAL', locked: false },
      { id: BLOCK_B2_SAME_CONTENT, company_id: CO_B, content_id: CONTENT_A, block_type: 'cta', position: 7, text: 'B SAME-CONTENT', locked: true },
    ],
  });
  // `content_block.id` is a primary key, and the whole point of the fix is that
  // the UPSERT must RESOLVE its conflict target rather than blindly append.
  // Both are declared on the harness, so a row that matches no arbiter takes
  // the INSERT path and is rejected by the key on `id` — the 23505 shape.
  // Neither declaration changes any other suite: both are opt-in per table.
  uniqueKey('content_block', 'id');
  // `['id']` is THIS SUITE'S STATED BELIEF about what the server does when
  // `.upsert()` is called with no options at all — a bare primary-key DO
  // UPDATE. It is a belief sourced from the client's documentation and NOT
  // established by this repository against PostgREST; the harness's own
  // `resolveUpsertConflicts` note says the same in the same words, and
  // "NOT ESTABLISHED" there lists this exact question.
  //
  // It is declared so that an accidental drop of the options argument is
  // modelled as the re-tenanting this fix exists to prevent rather than as a
  // safe uniqueness error — i.e. the model errs toward the UNSAFE reading, so
  // a suite cannot pass by relying on a comfortable guess. One database probe
  // would settle it; until then nothing here may be read as evidence of it.
  resolveUpsertConflicts('content_block', ['id']);
}

/**
 * Re-parent BLOCK_A1 to company B immediately after the next content_block
 * SELECT resolves, i.e. in the window between the service's ownership check and
 * its write. Returns a restore function.
 *
 * WHY THIS EXISTS. The ownership pre-validation refuses a foreign id before any
 * write, so on a consistent database the write is never reached with an id the
 * caller does not own — which means no service-path test can otherwise observe
 * what the conflict target does. The target is a backstop for exactly one
 * state: the pre-validation's answer has gone stale. This reproduces that state
 * deterministically so the backstop can be asserted BEHAVIOURALLY rather than by
 * comparing a string.
 */
function reParentAfterOwnershipCheck(): () => void {
  const originalFrom = fakeSupabase.from;
  let fired = false;
  fakeSupabase.from = (t: string) => {
    const builder = originalFrom(t);
    if (t !== 'content_block') return builder;
    const originalThen = builder.then.bind(builder);
    builder.then = (ok: (v: unknown) => unknown, err: (e: unknown) => unknown) =>
      originalThen((result: unknown) => {
        if (!fired) {
          fired = true;
          const row = rows('content_block').find((r) => String(r.id) === BLOCK_A1);
          if (row) row.company_id = CO_B;
        }
        return ok(result);
      }, err);
    return builder;
  };
  return () => { fakeSupabase.from = originalFrom; };
}

const blockRow = (id: string): Block | undefined =>
  rows('content_block').find((r) => String(r.id) === id) as Block | undefined;

/** Writes that actually reached the table (the ownership lookup is a select). */
const writesToBlocks = (): unknown[] =>
  calls().filter((c) => c.table === 'content_block' && c.op !== 'select');

/**
 * What each write statement ASSERTED ABOUT A ROW: its filters merged with its
 * payload.
 *
 * Shape-agnostic in the way that actually matters. A statement identifies its
 * target two different ways depending on strategy — a batched upsert puts the
 * id in the PAYLOAD and names a conflict target, while a scoped update puts the
 * id in the FILTER and sets only the changed columns. An earlier version read
 * the payload alone, so three tests in unlabelled groups failed against a
 * company- and content-scoped UPDATE purely because the id had moved into the
 * filter — punishing a strategy that is strictly safer. Merging the two gives
 * one view that both strategies satisfy, and the payload still wins on a
 * conflict so an assertion about a WRITTEN VALUE is unaffected.
 */
const writtenRows = (): Array<Record<string, unknown>> =>
  writesToBlocks().flatMap((c) => {
    const call = c as { payload?: unknown; filters?: Record<string, unknown> };
    const filters = call.filters && typeof call.filters === 'object' ? call.filters : {};
    const p = call.payload;
    const rowsOf: Array<Record<string, unknown>> = Array.isArray(p)
      ? (p as Array<Record<string, unknown>>)
      : p && typeof p === 'object'
        ? [p as Record<string, unknown>]
        : [];
    return rowsOf.map((row) => ({ ...filters, ...row }));
  });

async function expectRejected(
  fn: () => Promise<unknown>,
): Promise<Error & { status?: number; code?: string }> {
  let caught: (Error & { status?: number; code?: string }) | null = null;
  try {
    await fn();
  } catch (e) {
    caught = e as Error & { status?: number; code?: string };
  }
  // A resolved promise here is the exact failure mode the fix exists to remove:
  // "denied" must never be reported as a successful empty result.
  expect(caught).not.toBeNull();
  return caught as Error & { status?: number; code?: string };
}

/**
 * Run `fn` and report what happened, without deciding in advance whether a
 * refusal or a success is correct. Used by the property tests, which assert an
 * INVARIANT that must hold whichever way the implementation upholds it.
 */
async function attempt(
  fn: () => Promise<unknown>,
): Promise<{ threw: boolean; error?: Error & { status?: number; code?: string }; value?: unknown }> {
  try {
    return { threw: false, value: await fn() };
  } catch (e) {
    return { threw: true, error: e as Error & { status?: number; code?: string } };
  }
}

beforeEach(() => {
  seedBlocks();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  // A harness refusal leaves every row untouched, so a tenant-safety assertion
  // can pass because the harness declined to run the write rather than because
  // the service refused it. Fail the test instead of reading that as safety.
  assertNoHarnessConfigurationError();
  jest.restoreAllMocks();
});

describe('FIX3-B1 upsertBlocks — the conflict target is company-scoped (STRING-LEVEL, supplementary)', () => {
  it('sends (company_id, id) as the conflict target on the real write', async () => {
    await collaborationService.upsertBlocks(CO_A, CONTENT_A, [
      { id: BLOCK_A1, blockType: 'body', position: 0, text: 'A updated' },
    ]);
    const write = writesToBlocks()[0] as { op: string; options?: unknown };
    expect(write.op).toBe('upsert');
    // Read off the ARGUMENTS the service actually handed to `.upsert()`, not off
    // the exported constant. Reverting the call site to `{ onConflict: 'id' }`
    // fails here even while the exported constant still reads 'company_id,id'.
    expect(write.options).toEqual({ onConflict: 'company_id,id' });
  });

  it('exports the same target it sends, so the constant cannot drift', async () => {
    await collaborationService.upsertBlocks(CO_A, CONTENT_A, [
      { id: BLOCK_A1, blockType: 'body', position: 0, text: 'A updated' },
    ]);
    const write = writesToBlocks()[0] as { options?: { onConflict?: string } };
    expect(write.options?.onConflict).toBe(collaborationService.BLOCK_CONFLICT_TARGET);
    expect(collaborationService.BLOCK_CONFLICT_TARGET).toBe('company_id,id');
  });
});

describe('FIX3-B1 upsertBlocks — legitimate same-company update', () => {
  it('updates the owned row in place, without appending a second row', async () => {
    const before = rows('content_block').length;
    const saved = await collaborationService.upsertBlocks(CO_A, CONTENT_A, [
      { id: BLOCK_A1, blockType: 'body', position: 0, text: 'A updated', locked: false },
    ]);
    expect(Array.isArray(saved)).toBe(true);
    expect(writesToBlocks().length).toBe(1);

    // Asserted on the TABLE after the write, not on the recorded payload: the
    // harness resolves (company_id, id) here, so an arbiter that failed to
    // match would show up as a THIRD row rather than an updated one.
    expect(rows('content_block')).toHaveLength(before);
    expect(blockRow(BLOCK_A1)).toMatchObject({
      id: BLOCK_A1,
      company_id: CO_A,
      content_id: CONTENT_A,
      text: 'A updated',
    });
    // No other row moved.
    expect(blockRow(BLOCK_B1)).toMatchObject({ company_id: CO_B, text: 'B CONFIDENTIAL' });
    expect(blockRow(BLOCK_A2_OTHER_CONTENT)).toMatchObject({ content_id: CONTENT_A2, text: 'A other content' });
  });

  it('returns the updated block to the caller', async () => {
    const saved = await collaborationService.upsertBlocks(CO_A, CONTENT_A, [
      { id: BLOCK_A1, blockType: 'body', position: 0, text: 'A updated' },
    ]);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ id: BLOCK_A1, text: 'A updated' });
  });

  it('records the row it sent, company- and content-stamped from the arguments', async () => {
    await collaborationService.upsertBlocks(CO_A, CONTENT_A, [
      { id: BLOCK_A1, blockType: 'body', position: 0, text: 'A updated', locked: false },
    ]);
    const written = writtenRows()[0];
    expect(written).toMatchObject({
      id: BLOCK_A1,
      company_id: CO_A,
      content_id: CONTENT_A,
      text: 'A updated',
    });
  });

  it('inserts blocks that carry no id without consulting ownership', async () => {
    const before = rows('content_block').length;
    await collaborationService.upsertBlocks(CO_A, CONTENT_A, [
      { blockType: 'hook', position: 0, text: 'new' },
    ]);
    // No supplied ids → no ownership select is needed; one write; one new row.
    expect(calls().filter((c) => c.table === 'content_block' && c.op === 'select').length).toBe(0);
    expect(writesToBlocks().length).toBe(1);
    expect(rows('content_block')).toHaveLength(before + 1);
  });
});
describe('FIX3-B1 upsertBlocks — a supplied id from another company is refused', () => {
  it('refuses the write and leaves the other company’s row untouched', async () => {
    const err = await expectRejected(() =>
      collaborationService.upsertBlocks(CO_A, CONTENT_A, [
        { id: BLOCK_B1, blockType: 'body', position: 0, text: 'TAKEOVER' },
      ]),
    );
    expect(err.status).toBe(404);
    expect(err.code).toBe('NOT_FOUND');

    // No write of any kind reached the table.
    expect(writesToBlocks()).toHaveLength(0);

    // Company B's row is byte-for-byte as seeded: not re-tenanted, not rewritten.
    expect(blockRow(BLOCK_B1)).toMatchObject({
      company_id: CO_B,
      content_id: CONTENT_B,
      text: 'B CONFIDENTIAL',
    });
  });

  it('refuses the whole batch when only one element is foreign (no partial write)', async () => {
    await expectRejected(() =>
      collaborationService.upsertBlocks(CO_A, CONTENT_A, [
        { id: BLOCK_A1, blockType: 'body', position: 0, text: 'legitimate' },
        { id: BLOCK_B1, blockType: 'body', position: 1, text: 'TAKEOVER' },
      ]),
    );
    expect(writesToBlocks()).toHaveLength(0);
    // The caller's own block is also unchanged — the batch is atomic in intent.
    expect(blockRow(BLOCK_A1)).toMatchObject({ text: 'A original' });
    expect(blockRow(BLOCK_B1)).toMatchObject({ company_id: CO_B, text: 'B CONFIDENTIAL' });
  });
});

describe('FIX3-B1 upsertBlocks — out-of-scope and malformed ids are refused', () => {
  it('refuses a same-company block that belongs to different content', async () => {
    const err = await expectRejected(() =>
      collaborationService.upsertBlocks(CO_A, CONTENT_A, [
        { id: BLOCK_A2_OTHER_CONTENT, blockType: 'body', position: 0, text: 'moved' },
      ]),
    );
    expect(err.status).toBe(404);
    expect(writesToBlocks()).toHaveLength(0);
    expect(blockRow(BLOCK_A2_OTHER_CONTENT)).toMatchObject({
      content_id: CONTENT_A2,
      text: 'A other content',
    });
  });

  it('refuses an id that does not exist at all', async () => {
    const err = await expectRejected(() =>
      collaborationService.upsertBlocks(CO_A, CONTENT_A, [
        { id: BLOCK_ABSENT, blockType: 'body', position: 0, text: 'ghost' },
      ]),
    );
    expect(err.status).toBe(404);
    expect(writesToBlocks()).toHaveLength(0);
  });

  it('refuses a malformed id before touching the database', async () => {
    const err = await expectRejected(() =>
      collaborationService.upsertBlocks(CO_A, CONTENT_A, [
        { id: 'not-a-uuid', blockType: 'body', position: 0 },
      ]),
    );
    expect(err.status).toBe(400);
    expect(err.code).toBe('VALIDATION');
    expect(calls().filter((c) => c.table === 'content_block')).toHaveLength(0);
  });

  it('refuses a duplicate supplied id in one batch', async () => {
    const err = await expectRejected(() =>
      collaborationService.upsertBlocks(CO_A, CONTENT_A, [
        { id: BLOCK_A1, blockType: 'body', position: 0 },
        { id: BLOCK_A1, blockType: 'body', position: 1 },
      ]),
    );
    expect(err.status).toBe(400);
    expect(calls().filter((c) => c.table === 'content_block')).toHaveLength(0);
  });

  it('refuses a non-object element', async () => {
    const err = await expectRejected(() =>
      collaborationService.upsertBlocks(CO_A, CONTENT_A, ['nope' as unknown as Block]),
    );
    expect(err.status).toBe(400);
  });
});

describe('FIX3-B1 upsertBlocks — database failures are raised, never a false success', () => {
  it('raises when the ownership lookup fails', async () => {
    failTable('content_block');
    const err = await expectRejected(() =>
      collaborationService.upsertBlocks(CO_A, CONTENT_A, [
        { id: BLOCK_A1, blockType: 'body', position: 0 },
      ]),
    );
    expect(err.status).toBe(500);
    expect(err.code).toBe('BLOCK_LOOKUP_FAILED');
  });

  it('raises when the write itself fails', async () => {
    failTable('content_block');
    const err = await expectRejected(() =>
      // No supplied id → the ownership lookup is skipped, so this exercises the
      // write-failure path specifically.
      collaborationService.upsertBlocks(CO_A, CONTENT_A, [{ blockType: 'body', position: 0 }]),
    );
    expect(err.status).toBe(500);
    expect(err.code).toBe('BLOCK_WRITE_FAILED');
  });

  it('still returns an empty array for a genuinely empty request', async () => {
    // An empty batch is not a failure and must not raise: the distinction
    // between "nothing to do" and "refused" is the point of the change.
    await expect(collaborationService.upsertBlocks(CO_A, CONTENT_A, [])).resolves.toEqual([]);
    expect(calls().filter((c) => c.table === 'content_block')).toHaveLength(0);
  });

  it('rejects a missing companyId or contentId rather than returning []', async () => {
    const e1 = await expectRejected(() =>
      collaborationService.upsertBlocks('', CONTENT_A, [{ blockType: 'body', position: 0 }]),
    );
    expect(e1.status).toBe(400);
    const e2 = await expectRejected(() =>
      collaborationService.upsertBlocks(CO_A, '', [{ blockType: 'body', position: 0 }]),
    );
    expect(e2.status).toBe(400);
  });
});

describe('FIX3-B1 upsertBlocks — ownership lookup is scoped on both columns', () => {
  it('queries company_id AND content_id AND the supplied id set', async () => {
    await expectRejected(() =>
      collaborationService.upsertBlocks(CO_A, CONTENT_A, [
        { id: BLOCK_B1, blockType: 'body', position: 0 },
      ]),
    );
    const lookup = calls().find((c) => c.table === 'content_block' && c.op === 'select');
    expect(lookup).toBeDefined();
    // Scoping on content_id as well as company_id is what makes the
    // same-company/different-content case fail closed.
    expect(lookup!.filters).toMatchObject({ company_id: CO_A, content_id: CONTENT_A });
    expect(lookup!.filters.id).toEqual([BLOCK_B1]);
  });
});

describe('FIX3-B1 — what the composite conflict target changes', () => {
  /**
   * These two cases go straight at the fake database, bypassing the service, to
   * show the DIFFERENCE the conflict target makes once a foreign id has somehow
   * reached the write. That state is deliberately hypothetical — the ownership
   * pre-validation refuses a foreign id before any write — which is exactly why
   * the conflict target is a defence-in-depth backstop and has to be exercised
   * on its own to be covered at all.
   *
   * THIS IS A MODEL, NOT EVIDENCE ABOUT POSTGRESQL. The harness resolves the
   * arbiter columns it was handed and then applies the declared unique key. It
   * does not implement arbiter-index inference, and nothing here proves
   * PostgreSQL's uniqueness enforcement or ON CONFLICT semantics. Those remain
   * UNVERIFIED pending execution against a real database.
   */
  const foreignRow = {
    id: BLOCK_B1,
    company_id: CO_A,
    content_id: CONTENT_A,
    block_type: 'body',
    position: 0,
    text: 'TAKEOVER',
    locked: false,
  };

  it('under (company_id, id) the foreign id matches no arbiter and is rejected', async () => {
    const res = await fakeSupabase
      .from('content_block')
      .upsert([foreignRow], { onConflict: 'company_id,id' })
      .select('*');
    expect(res.error).not.toBeNull();
    expect(res.error.code).toBe('23505');
    expect(blockRow(BLOCK_B1)).toMatchObject({ company_id: CO_B, text: 'B CONFIDENTIAL' });
  });

  it('under a bare `id` target the same row IS re-tenanted — the defect itself', async () => {
    const res = await fakeSupabase
      .from('content_block')
      .upsert([foreignRow], { onConflict: 'id' })
      .select('*');
    expect(res.error).toBeNull();
    // Asserted on purpose: this is what the original call site did, and it is
    // the reason the target above is load-bearing rather than cosmetic.
    expect(blockRow(BLOCK_B1)).toMatchObject({ company_id: CO_A, text: 'TAKEOVER' });
  });
});

describe('FIX3-B1 upsertBlocks — supplied ids are case-insensitive', () => {
  it('accepts the caller’s OWN id in uppercase and updates that same row', async () => {
    const before = rows('content_block').length;
    await collaborationService.upsertBlocks(CO_A, CONTENT_A, [
      { id: BLOCK_A1.toUpperCase(), blockType: 'body', position: 0, text: 'A upper' },
    ]);
    // A uuid is case-insensitive by definition and PostgreSQL returns the
    // canonical lowercase form, so without normalisation the ownership compare
    // missed and the caller got a spurious 404 on its own block.
    expect(rows('content_block')).toHaveLength(before);
    expect(blockRow(BLOCK_A1)).toMatchObject({ id: BLOCK_A1, text: 'A upper' });
  });

  it('writes the normalised lowercase id, never the supplied casing', async () => {
    await collaborationService.upsertBlocks(CO_A, CONTENT_A, [
      { id: BLOCK_A1.toUpperCase(), blockType: 'body', position: 0, text: 'A upper' },
    ]);
    const written = writtenRows()[0];
    expect(written).toMatchObject({ id: BLOCK_A1 });
    expect(rows('content_block').map((r) => String(r.id))).not.toContain(BLOCK_A1.toUpperCase());
  });

  it('queries the ownership lookup with the normalised id', async () => {
    await collaborationService.upsertBlocks(CO_A, CONTENT_A, [
      { id: BLOCK_A1.toUpperCase(), blockType: 'body', position: 0, text: 'A upper' },
    ]);
    const lookup = calls().find((c) => c.table === 'content_block' && c.op === 'select');
    expect(lookup!.filters.id).toEqual([BLOCK_A1]);
  });

  it('still refuses another company’s id supplied in uppercase', async () => {
    const err = await expectRejected(() =>
      collaborationService.upsertBlocks(CO_A, CONTENT_A, [
        { id: BLOCK_B1.toUpperCase(), blockType: 'body', position: 0, text: 'TAKEOVER' },
      ]),
    );
    expect(err.status).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
    expect(writesToBlocks()).toHaveLength(0);
    expect(blockRow(BLOCK_B1)).toMatchObject({ company_id: CO_B, text: 'B CONFIDENTIAL' });
  });

  it('rejects the same id supplied twice in different cases as a duplicate', async () => {
    const err = await expectRejected(() =>
      collaborationService.upsertBlocks(CO_A, CONTENT_A, [
        { id: BLOCK_A1, blockType: 'body', position: 0 },
        { id: BLOCK_A1.toUpperCase(), blockType: 'body', position: 1 },
      ]),
    );
    expect(err.status).toBe(400);
    expect(calls().filter((c) => c.table === 'content_block')).toHaveLength(0);
  });
});

/**
 * Make the next content_block SELECT return its ids in UPPERCASE, modelling a
 * driver or fake that hands back a non-canonical uuid representation. Returns a
 * restore function.
 *
 * This is what the database-side `.toLowerCase()` in the ownership comparison
 * claims robustness against. Without this injector that line is unobservable —
 * every producer in this repository returns canonical lowercase — so removing it
 * was a silent no-op and a surviving mutant.
 */
function uppercaseOwnershipRows(): () => void {
  const originalFrom = fakeSupabase.from;
  let fired = false;
  fakeSupabase.from = (t: string) => {
    const builder = originalFrom(t);
    if (t !== 'content_block') return builder;
    const originalThen = builder.then.bind(builder);
    builder.then = (ok: (v: unknown) => unknown, err: (e: unknown) => unknown) =>
      originalThen((result: unknown) => {
        const r = result as { data?: Array<{ id?: unknown }> | null };
        if (!fired && Array.isArray(r?.data)) {
          fired = true;
          r.data = r.data.map((row) => ({ ...row, id: String(row.id).toUpperCase() }));
        }
        return ok(r);
      }, err);
    return builder;
  };
  return () => { fakeSupabase.from = originalFrom; };
}

describe('FIX3-B1 — the SECURITY PROPERTY, independent of write strategy', () => {
  /**
   * These assert the property, not the mechanism: whatever strategy the service
   * uses to write, a block belonging to another company must not be mutated,
   * re-tenanted, or replaced, and no row may be created at a caller-chosen id.
   *
   * WHY IT IS WRITTEN THIS WAY. An earlier version of this group asserted the
   * CURRENT mechanism — a 23505 raised because a composite arbiter missed — so
   * an implementation that is strictly SAFER failed it: a company- and
   * content-scoped UPDATE plus an INSERT, which never names a conflict target
   * at all and so cannot re-tenant under any schema, broke all three tests.
   * Pinning one mechanism punishes a better one. These assert the invariant
   * instead, and are satisfied by any strategy that upholds it.
   *
   * STILL A MODEL — see the file header. The harness matches arbiter column
   * names and has no notion of an index, so none of this is evidence about
   * PostgreSQL arbiter-index inference, real uniqueness enforcement, or
   * transaction atomicity.
   */
  let restore: (() => void) | null = null;
  afterEach(() => { if (restore) { restore(); restore = null; } });

  /** Every field of the protected row, so a partial overwrite cannot hide. */
  const PROTECTED_B1 = {
    id: BLOCK_B1,
    company_id: CO_B,
    content_id: CONTENT_B,
    block_type: 'body',
    position: 0,
    text: 'B CONFIDENTIAL',
    locked: false,
  };

  it('a foreign block id never mutates the other company’s row, by any path', async () => {
    const before = rows('content_block').length;
    const outcome = await attempt(() =>
      collaborationService.upsertBlocks(CO_A, CONTENT_A, [
        { id: BLOCK_B1, blockType: 'body', position: 0, text: 'TAKEOVER' },
      ]),
    );
    // The invariant, asserted field by field rather than on three keys.
    expect(blockRow(BLOCK_B1)).toEqual(PROTECTED_B1);
    expect(rows('content_block')).toHaveLength(before);
    // And the caller was not handed the protected row as a success.
    expect(JSON.stringify(outcome.value ?? [])).not.toContain('CONFIDENTIAL');
  });

  it('a STALE ownership answer still never re-tenants the row', async () => {
    // The row is moved to company B in the window between the ownership check
    // and the write — the one state a conflict target exists to guard. The
    // assertion is the invariant, not which error (or none) the strategy
    // produces: a scoped UPDATE would simply affect no row.
    restore = reParentAfterOwnershipCheck();
    const before = rows('content_block').length;
    await attempt(() =>
      collaborationService.upsertBlocks(CO_A, CONTENT_A, [
        { id: BLOCK_A1, blockType: 'body', position: 0, text: 'STALE WRITE' },
      ]),
    );
    const row = blockRow(BLOCK_A1)!;
    expect(row.company_id).toBe(CO_B);
    expect(row.text).toBe('A original');
    expect(rows('content_block')).toHaveLength(before);
  });

  it('a legitimate same-company update still succeeds under the same scrutiny', async () => {
    // The positive control for this group: the property must not be upheld by
    // refusing everything.
    const before = rows('content_block').length;
    const outcome = await attempt(() =>
      collaborationService.upsertBlocks(CO_A, CONTENT_A, [
        { id: BLOCK_A1, blockType: 'body', position: 0, text: 'A legitimately updated' },
      ]),
    );
    expect(outcome.threw).toBe(false);
    expect(rows('content_block')).toHaveLength(before);
    expect(blockRow(BLOCK_A1)).toMatchObject({ company_id: CO_A, content_id: CONTENT_A, text: 'A legitimately updated' });
  });
});

describe('FIX3-B1 — the CURRENT mechanism (supplementary, not the property)', () => {
  /**
   * These pin how today's implementation upholds the property. They are
   * deliberately separate from the group above: if the write strategy changes
   * to something equally or more secure, THESE should be rewritten and the
   * property tests should keep passing untouched.
   */
  let restore: (() => void) | null = null;
  afterEach(() => { if (restore) { restore(); restore = null; } });

  it('today it refuses the stale write with 500 BLOCK_WRITE_FAILED', async () => {
    restore = reParentAfterOwnershipCheck();
    const err = await expectRejected(() =>
      collaborationService.upsertBlocks(CO_A, CONTENT_A, [
        { id: BLOCK_A1, blockType: 'body', position: 0, text: 'STALE WRITE' },
      ]),
    );
    expect(err.status).toBe(500);
    expect(err.code).toBe('BLOCK_WRITE_FAILED');
  });

  it('today it sends the company-scoped conflict target (string-level, supplementary)', async () => {
    await collaborationService.upsertBlocks(CO_A, CONTENT_A, [
      { id: BLOCK_A1, blockType: 'body', position: 0, text: 'A updated' },
    ]);
    const write = writesToBlocks()[0] as { op: string; options?: unknown };
    expect(write.op).toBe('upsert');
    expect(write.options).toEqual({ onConflict: 'company_id,id' });
  });
});

describe('FIX3-B1 — the COMPANY predicate on the ownership lookup', () => {
  /**
   * BLOCK_B2_SAME_CONTENT is company B's block carrying company A's content id.
   * Content scoping cannot refuse it, so these tests fail if the
   * `.eq('company_id', …)` predicate is removed — the primary control, which
   * previously had no behavioural coverage at all because every company-B
   * fixture was foreign in both columns.
   */
  const PROTECTED_B2 = {
    id: BLOCK_B2_SAME_CONTENT,
    company_id: CO_B,
    content_id: CONTENT_A,
    block_type: 'cta',
    position: 7,
    text: 'B SAME-CONTENT',
    locked: true,
  };

  it('refuses a block of ANOTHER company that shares this content id', async () => {
    const err = await expectRejected(() =>
      collaborationService.upsertBlocks(CO_A, CONTENT_A, [
        { id: BLOCK_B2_SAME_CONTENT, blockType: 'body', position: 0, text: 'TAKEOVER' },
      ]),
    );
    expect(err.status).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
  });

  it('attempts NO write at all when the company predicate refuses it', async () => {
    // This is the assertion that dies when `.eq('company_id', …)` is removed:
    // the lookup would then report the row as owned and a write WOULD be sent.
    await expectRejected(() =>
      collaborationService.upsertBlocks(CO_A, CONTENT_A, [
        { id: BLOCK_B2_SAME_CONTENT, blockType: 'body', position: 0, text: 'TAKEOVER' },
      ]),
    );
    expect(writesToBlocks()).toHaveLength(0);
  });

  it('leaves that row byte-comparably unchanged, and creates no new row', async () => {
    const before = rows('content_block').length;
    await expectRejected(() =>
      collaborationService.upsertBlocks(CO_A, CONTENT_A, [
        { id: BLOCK_B2_SAME_CONTENT, blockType: 'body', position: 0, text: 'TAKEOVER' },
      ]),
    );
    expect(blockRow(BLOCK_B2_SAME_CONTENT)).toEqual(PROTECTED_B2);
    expect(rows('content_block')).toHaveLength(before);
    // AND no write was attempted. Without this line the assertions above are
    // satisfied even when the company predicate is deleted — the harness's
    // arbiter model refuses the write instead, so the row is still untouched
    // and the test passes for a reason that has nothing to do with the control
    // under test. That model depends on a unique key the unapplied migration
    // adds, so on today's schema it would not rescue anything.
    expect(writesToBlocks()).toHaveLength(0);
  });

  it('refuses the whole batch when it is mixed with a block the caller DOES own', async () => {
    await expectRejected(() =>
      collaborationService.upsertBlocks(CO_A, CONTENT_A, [
        { id: BLOCK_A1, blockType: 'body', position: 0, text: 'legitimate' },
        { id: BLOCK_B2_SAME_CONTENT, blockType: 'body', position: 1, text: 'TAKEOVER' },
      ]),
    );
    expect(writesToBlocks()).toHaveLength(0);
    expect(blockRow(BLOCK_A1)).toMatchObject({ text: 'A original' });
    expect(blockRow(BLOCK_B2_SAME_CONTENT)).toEqual(PROTECTED_B2);
  });

  it('the ownership lookup really carries the company predicate', async () => {
    // Supplementary to the behavioural cases above, not a substitute for them.
    await expectRejected(() =>
      collaborationService.upsertBlocks(CO_A, CONTENT_A, [
        { id: BLOCK_B2_SAME_CONTENT, blockType: 'body', position: 0 },
      ]),
    );
    const lookup = calls().find((c) => c.table === 'content_block' && c.op === 'select');
    expect(lookup!.filters).toMatchObject({ company_id: CO_A, content_id: CONTENT_A });
  });

  it('and a block the caller owns in that same content is still updatable', async () => {
    // Positive control: the company predicate must refuse B's row without
    // refusing A's row in the same content.
    const outcome = await attempt(() =>
      collaborationService.upsertBlocks(CO_A, CONTENT_A, [
        { id: BLOCK_A1, blockType: 'body', position: 0, text: 'A still fine' },
      ]),
    );
    expect(outcome.threw).toBe(false);
    expect(blockRow(BLOCK_A1)).toMatchObject({ company_id: CO_A, text: 'A still fine' });
    expect(blockRow(BLOCK_B2_SAME_CONTENT)).toEqual(PROTECTED_B2);
  });
});

describe('FIX3-B1 upsertBlocks — an id-less batch keeps every row', () => {
  it('writes three id-less blocks as three distinct rows', async () => {
    const before = rows('content_block').length;
    const saved = await collaborationService.upsertBlocks(CO_A, CONTENT_A, [
      { blockType: 'hook', position: 0, text: 'one' },
      { blockType: 'body', position: 1, text: 'two' },
      { blockType: 'cta', position: 2, text: 'three' },
    ]);
    // This is the production shape: splitIntoBlocks emits several blocks with
    // no id, and both generation callers pass them in one call. An earlier
    // harness fabricated one id for the whole batch, so rows 2 and 3 were
    // merged into row 1 and the collapse was invisible.
    expect(rows('content_block')).toHaveLength(before + 3);
    expect(saved).toHaveLength(3);
  });

  it('gives each id-less row a distinct id, and merges none of them', async () => {
    await collaborationService.upsertBlocks(CO_A, CONTENT_A, [
      { blockType: 'hook', position: 0, text: 'one' },
      { blockType: 'body', position: 1, text: 'two' },
      { blockType: 'cta', position: 2, text: 'three' },
    ]);
    const added = rows('content_block').filter((r) => ['one', 'two', 'three'].includes(String(r.text)));
    expect(added).toHaveLength(3);
    expect(new Set(added.map((r) => String(r.id))).size).toBe(3);
    expect(added.map((r) => Number(r.position)).sort()).toEqual([0, 1, 2]);
  });

  it('stamps every id-less row with the caller company and content', async () => {
    await collaborationService.upsertBlocks(CO_A, CONTENT_A, [
      { blockType: 'hook', position: 0, text: 'one' },
      { blockType: 'body', position: 1, text: 'two' },
    ]);
    const added = rows('content_block').filter((r) => ['one', 'two'].includes(String(r.text)));
    expect(added).toHaveLength(2);
    for (const r of added) {
      expect(r).toMatchObject({ company_id: CO_A, content_id: CONTENT_A });
    }
  });
});

describe('FIX3-B1 — the harness distinguishes the three arbiter cases', () => {
  /**
   * Driven straight at the fake database, because the service can never send an
   * upsert without options. These pin the MODEL itself, after it was found to
   * report the unsafe case as safe: a missing `onConflict` was treated as "no
   * arbiter" and answered 23505, where the server is BELIEVED to infer the
   * primary key and perform an id-based DO UPDATE. That belief is this suite's
   * input to the model and has not been executed against PostgREST.
   *
   * A MODEL, NOT EVIDENCE ABOUT POSTGRESQL — see the file header.
   */
  const foreignRow = {
    id: BLOCK_B1,
    company_id: CO_A,
    content_id: CONTENT_A,
    block_type: 'body',
    position: 0,
    text: 'TAKEOVER',
    locked: false,
  };

  it('composite target: no arbiter match, rejected, the row untouched', async () => {
    const res = await fakeSupabase
      .from('content_block')
      .upsert([foreignRow], { onConflict: 'company_id,id' })
      .select('*');
    expect(res.error?.code).toBe('23505');
    expect(blockRow(BLOCK_B1)).toMatchObject({ company_id: CO_B, text: 'B CONFIDENTIAL' });
  });

  it('bare id target: the row IS re-tenanted — the defect itself', async () => {
    const res = await fakeSupabase
      .from('content_block')
      .upsert([foreignRow], { onConflict: 'id' })
      .select('*');
    expect(res.error).toBeNull();
    expect(blockRow(BLOCK_B1)).toMatchObject({ company_id: CO_A, text: 'TAKEOVER' });
  });

  it('NO options: modelled as the primary-key default, so it re-tenants too', async () => {
    const res = await fakeSupabase.from('content_block').upsert([foreignRow]).select('*');
    expect(res.error).toBeNull();
    // Not a safe 23505. On this suite's declared belief about the server's
    // default — a primary-key DO UPDATE — this is what that does. Modelling it
    // as "no arbiter" hid the real defect. The belief is unverified; what IS
    // established here is that the harness no longer answers the comfortable
    // 23505 for a call shape whose real outcome nobody has measured.
    expect(blockRow(BLOCK_B1)).toMatchObject({ company_id: CO_A, text: 'TAKEOVER' });
  });

  // The deliberate "no default arbiter" refusal now lives in
  // backend/tests/unit/routeAuthHarnessFidelity.test.ts, with the rest of the
  // harness's own regressions. It cannot live here: this suite's afterEach
  // fails any test that left a harness refusal behind, precisely so a refusal
  // can never be read as tenant enforcement.
});

describe('FIX3-B1 upsertBlocks — each normalisation site is pinned separately', () => {
  /**
   * The id is normalised at four sites (see the service's own note). Sites 1 and
   * 4 are independent reads of `b.id`, and site 3 is defensive, so each needs
   * its own assertion: without these, removing any one of them left the suite
   * green.
   */
  let restore: (() => void) | null = null;
  afterEach(() => { if (restore) { restore(); restore = null; } });

  it('site 3 — a non-canonical id from the database still matches the owned set', async () => {
    restore = uppercaseOwnershipRows();
    // The ownership lookup returns the id uppercased. The database-side
    // lower-case is the only thing that makes the set compare succeed; without
    // it the caller is refused a block it owns, with a spurious 404.
    const saved = await collaborationService.upsertBlocks(CO_A, CONTENT_A, [
      { id: BLOCK_A1, blockType: 'body', position: 0, text: 'A updated' },
    ]);
    expect(saved).toHaveLength(1);
    expect(writesToBlocks()).toHaveLength(1);
  });

  it('site 1 — a padded id is accepted, not rejected as malformed', async () => {
    // Without the capture-site trim, UUID_RE (anchored) fails and this is a 400
    // before any database access.
    const saved = await collaborationService.upsertBlocks(CO_A, CONTENT_A, [
      { id: `  ${BLOCK_A1}  `, blockType: 'body', position: 0, text: 'A padded' },
    ]);
    expect(saved).toHaveLength(1);
    expect(blockRow(BLOCK_A1)).toMatchObject({ text: 'A padded' });
  });

  it('site 4 — a padded id is PERSISTED trimmed, and updates in place', async () => {
    const before = rows('content_block').length;
    await collaborationService.upsertBlocks(CO_A, CONTENT_A, [
      { id: `  ${BLOCK_A1}  `, blockType: 'body', position: 0, text: 'A padded' },
    ]);
    const written = writtenRows()[0];
    // Without the write-site trim the payload carries '  <uuid>  ', which is a
    // different id from the one validated — and the arbiter then misses, so the
    // row count would grow instead of the row updating.
    expect(written).toMatchObject({ id: BLOCK_A1 });
    expect(rows('content_block')).toHaveLength(before);
    expect(rows('content_block').map((r) => String(r.id))).not.toContain(`  ${BLOCK_A1}  `);
  });
});
