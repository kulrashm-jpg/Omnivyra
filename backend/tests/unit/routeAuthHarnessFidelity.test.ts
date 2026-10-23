/**
 * routeAuthHarness — FIDELITY REGRESSIONS.
 *
 * These tests pin the harness itself, not any product code. Every one of them
 * exists because an independent review demonstrated the previous model
 * diverging from a real database in a direction that could make an unsafe
 * implementation look safe, or destroy a modelled row silently.
 *
 * WHAT THESE TESTS ESTABLISH: that the harness's own model behaves as
 * documented — id allocation, declared-uniqueness enforcement on both upsert
 * legs, statement atomicity, duplicate-arbiter handling, and loud refusal of
 * targets it cannot model.
 *
 * WHAT THEY DO NOT ESTABLISH: anything about PostgreSQL or PostgREST. The
 * harness matches arbiter COLUMN NAMES and has no notion of an index, so none
 * of this is evidence about arbiter-index inference, real uniqueness
 * enforcement, transaction atomicity, or wire behaviour. Those require
 * execution against a database.
 */
import {
  seed,
  rows,
  calls,
  uniqueKey,
  resolveUpsertConflicts,
  upsertAppendsBlindly,
  resetHarnessDeclarations,
  declaredUpsertMode,
  failTable,
  fakeSupabase,
  invoke,
  writeCalls,
  completedWrites,
  erroredWrites,
  refusedCalls,
  consumeRefusals,
  assertNoHarnessConfigurationError,
  isHarnessConfigurationError,
  CO_A,
  CO_B,
} from '../helpers/routeAuthHarness';

const T = 'fx_rows';

/** Local row alias: the harness does not export its internal Row type. */
type Row = Record<string, any>;

/** Drive the fake client directly; these are tests OF the fake. */
const upsert = (payload: unknown, options?: unknown) =>
  options === undefined
    ? fakeSupabase.from(T).upsert(payload).select('*')
    : fakeSupabase.from(T).upsert(payload, options).select('*');

const ids = (): string[] => rows(T).map((r) => String(r.id));

async function caught(fn: () => Promise<unknown>): Promise<Error | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e as Error;
  }
}

/**
 * Run `fn`, expect the harness to refuse it, and ACKNOWLEDGE the refusal so the
 * harness's automatic guard does not also fail this test. Only the suite that
 * tests the refusal mechanism may do this — see consumeRefusals().
 */
async function expectRefused(fn: () => Promise<unknown>): Promise<Error> {
  const err = await caught(fn);
  expect(isHarnessConfigurationError(err)).toBe(true);
  expect(consumeRefusals().length).toBeGreaterThan(0);
  return err as Error;
}

describe('harness — fabricated id allocation', () => {
  beforeEach(() => {
    seed({ fx_rows: [{ id: 'seed-1', company_id: CO_A, text: 'seeded' }] });
    resolveUpsertConflicts(T, ['id']);
  });

  it('a merge followed by another id-less insert does not re-mint the surviving id', async () => {
    // THE DEFECT: the allocator was `table length + index`. A merge does not
    // append, so the ordinal it skipped stayed free and the next batch minted
    // it again — over a live row, silently.
    await upsert([{ id: 'seed-1', text: 'edited' }, { company_id: CO_A, text: 'first new' }], { onConflict: 'id' });
    const afterFirst = ids();
    expect(rows(T)).toHaveLength(2);

    await upsert([{ company_id: CO_A, text: 'second new' }], { onConflict: 'id' });
    expect(rows(T)).toHaveLength(3);
    expect(rows(T).map((r) => String(r.text)).sort()).toEqual(['edited', 'first new', 'second new']);
    // The id minted second is new, not one of the ids already in the table.
    const added = ids().filter((id) => !afterFirst.includes(id));
    expect(added).toHaveLength(1);
  });

  it('an insert, a delete, then an id-less insert does not reuse the deleted ordinal', async () => {
    await upsert([{ company_id: CO_A, text: 'a' }, { company_id: CO_A, text: 'b' }], { onConflict: 'id' });
    const [first] = ids().filter((id) => id !== 'seed-1');
    await fakeSupabase.from(T).delete().eq('id', first);
    expect(ids()).not.toContain(first);

    await upsert([{ company_id: CO_A, text: 'c' }], { onConflict: 'id' });
    // The new row's id is distinct from every id this table has ever issued,
    // so it cannot land on the surviving row.
    expect(new Set(ids()).size).toBe(ids().length);
    expect(ids()).not.toContain(first);
  });

  it('a minted id never collides with a caller-supplied id in the fabricated shape', async () => {
    // A caller naming `gen-1` must not have it taken from under it, and must
    // not receive it for a different row.
    const res = await upsert([{ id: 'gen-1', company_id: CO_A, text: 'explicit' }, { company_id: CO_A, text: 'minted' }], {
      onConflict: 'id',
    });
    expect(res.error).toBeNull();
    expect(new Set(ids()).size).toBe(ids().length);
    const minted = rows(T).find((r) => String(r.text) === 'minted');
    expect(String(minted!.id)).not.toBe('gen-1');
    expect(rows(T).find((r) => String(r.text) === 'explicit')).toMatchObject({ id: 'gen-1' });
  });

  it('several id-less rows in one batch each get a distinct id', async () => {
    await upsert(
      [
        { company_id: CO_A, text: 'one' },
        { company_id: CO_A, text: 'two' },
        { company_id: CO_A, text: 'three' },
      ],
      { onConflict: 'id' },
    );
    expect(rows(T)).toHaveLength(4);
    expect(new Set(ids()).size).toBe(4);
  });

  it('`id: undefined` is dropped like JSON drops it, and the row is minted', async () => {
    // THE DEFECT: `{ id: r?.id ?? mint, ...r }` let the spread restore an
    // explicit `id: undefined` over the fallback, storing an unusable row.
    // The model now strips every undefined-valued key up front, because
    // JSON.stringify does too — such a key never reaches a real request.
    const res = await upsert([{ id: undefined, company_id: CO_A, text: 'undef' }], { onConflict: 'id' });
    expect(res.error).toBeNull();
    const row = rows(T).find((r) => String(r.text) === 'undef');
    expect(row!.id).toBeDefined();
    expect(row!.id).not.toBeNull();
    expect(new Set(ids()).size).toBe(2);
  });

  it('an explicit `id: null` is a SUPPLIED null — 23502, not a free mint', async () => {
    // It used to be treated as "no id" and minted over, which manufactured a
    // valid row out of invalid input and hid whatever caller produced it.
    const before = rows(T).length;
    const res = await upsert([{ id: null, company_id: CO_A, text: 'nul' }], { onConflict: 'id' });
    expect(res.error?.code).toBe('23502');
    expect(res.error?.message).toMatch(/not-null/);
    expect(rows(T)).toHaveLength(before);
    expect(rows(T).map((r) => String(r.text))).not.toContain('nul');
  });

  it('`id: undefined` cannot wipe the primary key of a row it merges onto', async () => {
    // The merge leg is where this mattered: `{...target, ...row}` wrote
    // `undefined` straight over the matched row's real id.
    const res = await upsert([{ id: 'seed-1', text: 'edited', company_id: CO_A }], { onConflict: 'id' });
    expect(res.error).toBeNull();
    expect(rows(T)).toHaveLength(1);
    expect(rows(T)[0]).toMatchObject({ id: 'seed-1', text: 'edited' });
  });

  it('returns distinct objects for distinct rows, never the same reference twice', async () => {
    const res = await upsert(
      [
        { company_id: CO_A, text: 'x' },
        { company_id: CO_A, text: 'y' },
      ],
      { onConflict: 'id' },
    );
    expect(res.data).toHaveLength(2);
    expect(res.data[0]).not.toBe(res.data[1]);
    // And a returned row is a copy: mutating it must not reach the table.
    res.data[0].text = 'mutated';
    expect(rows(T).map((r) => String(r.text))).not.toContain('mutated');
  });
});

describe('harness — declared uniqueness on both upsert legs', () => {
  beforeEach(() => {
    seed({
      fx_rows: [
        { id: 'r1', company_id: CO_A, slug: 'one' },
        { id: 'r2', company_id: CO_A, slug: 'two' },
      ],
    });
    uniqueKey(T, 'slug');
    resolveUpsertConflicts(T, ['id']);
  });

  it('an in-place update cannot move a row onto another row’s unique value', async () => {
    // THE DEFECT: the declared-key check ran only on the insert leg, so a
    // DO UPDATE could collide with a different row and return error: null.
    // PostgreSQL rejects that from DO UPDATE SET.
    const res = await upsert([{ id: 'r1', slug: 'two' }], { onConflict: 'id' });
    expect(res.error?.code).toBe('23505');
    expect(rows(T).find((r) => String(r.id) === 'r1')).toMatchObject({ slug: 'one' });
    expect(rows(T).find((r) => String(r.id) === 'r2')).toMatchObject({ slug: 'two' });
  });

  it('a row may still update its OWN unique value', async () => {
    // The target of the update is exempt — otherwise every no-op update fails.
    const res = await upsert([{ id: 'r1', slug: 'one', company_id: CO_A }], { onConflict: 'id' });
    expect(res.error).toBeNull();
    expect(rows(T).find((r) => String(r.id) === 'r1')).toMatchObject({ slug: 'one' });
  });

  it('a violation part-way through a batch leaves NOTHING written', async () => {
    // THE DEFECT: the check ran inside the apply loop, so earlier rows of the
    // batch were already persisted when the call reported failure.
    const before = rows(T).length;
    const res = await upsert(
      [
        { id: 'new1', company_id: CO_A, slug: 'fresh' },
        { id: 'new2', company_id: CO_A, slug: 'two' },
      ],
      { onConflict: 'id' },
    );
    expect(res.error?.code).toBe('23505');
    expect(rows(T)).toHaveLength(before);
    expect(ids()).not.toContain('new1');
  });

  it('two rows sharing the arbiter key in one command are refused, not merged', async () => {
    // PostgreSQL: ON CONFLICT DO UPDATE command cannot affect row a second
    // time. The earlier model merged the second over the first and returned the
    // same object twice.
    const before = rows(T).length;
    const res = await upsert(
      [
        { id: 'r1', slug: 'alpha' },
        { id: 'r1', slug: 'beta' },
      ],
      { onConflict: 'id' },
    );
    expect(res.error?.code).toBe('21000');
    expect(rows(T)).toHaveLength(before);
    expect(rows(T).find((r) => String(r.id) === 'r1')).toMatchObject({ slug: 'one' });
  });
});

describe('harness — it refuses what it cannot model, loudly', () => {
  beforeEach(() => {
    seed({ fx_rows: [{ id: 'r1', company_id: CO_A, slug: 'one' }] });
    // seed() no longer clears the suite-level declarations, so this group —
    // which is about what happens with NO declaration — has to say so.
    resetHarnessDeclarations();
  });

  it('an upsert against a table with NO declared model is refused', async () => {
    // The default path, and the one that mattered: the production `.upsert()`
    // call sites numbered 281 under `backend/services` + `pages` excluding
    // tests (314 with lib/components/hooks/scripts added) while two tables had
    // declared a model, so almost every upsert fell through to a blind append
    // that reported success.
    const err = await expectRefused(() => upsert([{ id: 'r1', slug: 'x' }], { onConflict: 'id' }));
    expect(err.message).toMatch(/has not declared an upsert model/);
    expect(err.message).toMatch(/resolveUpsertConflicts/);
    expect(err.message).toMatch(/upsertAppendsBlindly/);
    expect(rows(T)).toHaveLength(1);
  });

  it('the append model plus a uniqueKey declaration is refused as inert', async () => {
    uniqueKey(T, 'id');
    upsertAppendsBlindly(T, 'fidelity fixture: exercising the inert combination');
    const err = await expectRefused(() => upsert([{ id: 'r1', slug: 'x' }], { onConflict: 'id' }));
    expect(err.message).toMatch(/inert/);
    expect(rows(T)).toHaveLength(1);
  });

  it('an onConflict that names no column is refused, not treated as an insert', async () => {
    resolveUpsertConflicts(T, ['id']);
    for (const bad of ['', ' , , ', ',']) {
      // expectRefused() consumes the refusal, and consuming now also lifts the
      // poison — so each iteration starts clean without re-seeding. seed() no
      // longer clears the poison at all; only the explicit acknowledgement does.
      const err = await expectRefused(() => upsert([{ id: 'r9', slug: 'z' }], { onConflict: bad }));
      expect(err.message).toMatch(/no column at all/);
      expect(rows(T)).toHaveLength(1);
    }
  });

  it('an onConflict naming an unknown column is refused rather than silently appending', async () => {
    resolveUpsertConflicts(T, ['id']);
    const err = await expectRefused(() => upsert([{ id: 'r9', slug: 'z' }], { onConflict: 'nonexistent_col' }));
    expect(err.message).toMatch(/42P10/);
    expect(rows(T)).toHaveLength(1);
  });

  it('a no-options upsert with no declared default arbiter is refused', async () => {
    resolveUpsertConflicts(T);
    const err = await expectRefused(() => upsert([{ id: 'r9', slug: 'z' }]));
    expect(err.message).toMatch(/will not guess/);
    expect(rows(T)).toHaveLength(1);
  });
});

describe('harness — an explicitly declared append model is allowed and recorded', () => {
  beforeEach(() => {
    seed({ fx_rows: [{ id: 'r1', company_id: CO_A, slug: 'one' }] });
    upsertAppendsBlindly(T, 'fidelity fixture: the suite only cares a write was attempted');
  });

  it('appends every row, models no resolution, and the reason is retrievable', async () => {
    const res = await upsert([{ id: 'r1', slug: 'appended-not-merged' }], { onConflict: 'id' });
    expect(res.error).toBeNull();
    // Appended, NOT merged — which is exactly why this model may not be used
    // by a suite that asserts anything about row identity or tenancy.
    expect(rows(T)).toHaveLength(2);
    expect(declaredUpsertMode(T)).toMatchObject({ mode: 'append' });
    expect((declaredUpsertMode(T) as { reason: string }).reason).toMatch(/only cares a write was attempted/);
  });

  it('requires a written reason', () => {
    expect(() => upsertAppendsBlindly(T, '   ')).toThrow(/requires a reason/);
  });
});

describe('harness — a refusal can never read as a successful security outcome', () => {
  beforeEach(() => {
    seed({ fx_rows: [{ id: 'r1', company_id: CO_B, slug: 'confidential' }] });
    // This group is about the UNDECLARED path, and declarations now survive
    // seed(), so it must ask for a blank slate rather than relying on seed()
    // to have silently provided one.
    resetHarnessDeclarations();
  });

  it('a refused statement IS counted by writeCalls, so a no-write assertion fails', async () => {
    // Deliberately NOT via expectRefused(): that acknowledges the refusal,
    // which clears the record this test is about.
    await caught(() => upsert([{ id: 'r1', company_id: CO_A, slug: 'TAKEOVER' }], { onConflict: 'id' }));
    // Nothing was written — which is exactly the trap. The protection is that
    // writeCalls() still counts the attempt, so `toHaveLength(0)` cannot pass.
    expect(writeCalls([T])).toHaveLength(1);
    expect(writeCalls([T])[0]).toMatchObject({ table: T, op: 'upsert', refused: true });
    // And completedWrites() is the accessor that excludes it.
    expect(completedWrites([T])).toHaveLength(0);
    // Reading stored state to conclude "unchanged, therefore rejected" is the
    // other half of the trap, and it now refuses too — see the poison group.
    expect(() => rows(T)).toThrow(/Stored state here proves nothing/);
    consumeRefusals();
    // Only after the explicit acknowledgement is the row readable, and it
    // confirms the write never landed.
    expect(rows(T)[0]).toMatchObject({ company_id: CO_B, slug: 'confidential' });
  });

  it('the refusal is surfaced to the caller that invoked the statement', async () => {
    // Not merely recorded somewhere a guard might later notice: the statement
    // itself throws, in the caller's own stack.
    let threw: unknown = null;
    try {
      await upsert([{ id: 'r1', company_id: CO_A, slug: 'TAKEOVER' }], { onConflict: 'id' });
    } catch (e) {
      threw = e;
    }
    expect(isHarnessConfigurationError(threw)).toBe(true);
    expect(consumeRefusals()).toHaveLength(1);
  });

  it('assertNoHarnessConfigurationError also reports it, for an explicit check', async () => {
    await caught(() => upsert([{ id: 'r1', company_id: CO_A, slug: 'TAKEOVER' }], { onConflict: 'id' }));
    expect(() => assertNoHarnessConfigurationError()).toThrow(/REFUSED by the harness/);
    consumeRefusals();
  });

  it('passes when nothing was refused', async () => {
    resolveUpsertConflicts(T, ['id']);
    await upsert([{ id: 'r1', slug: 'ok' }], { onConflict: 'id' });
    expect(refusedCalls()).toHaveLength(0);
    expect(() => assertNoHarnessConfigurationError()).not.toThrow();
  });
});

describe('harness — a refusal poisons the table for the rest of the test', () => {
  beforeEach(() => {
    seed({ fx_rows: [{ id: 'r1', company_id: CO_B, slug: 'confidential' }] });
    resetHarnessDeclarations();
  });

  it('every later operation on that table also refuses', async () => {
    // The point: a suite must not swallow one refusal and then keep reading
    // state as though the write had been considered and rejected.
    await caught(() => upsert([{ id: 'r1', company_id: CO_A, slug: 'TAKEOVER' }], { onConflict: 'id' }));
    const later = await caught(() => fakeSupabase.from(T).select('*').eq('id', 'r1'));
    expect(isHarnessConfigurationError(later)).toBe(true);
    expect(later!.message).toMatch(/was REFUSED in this test/);
    consumeRefusals();
  });

  it('reading stored state with rows() also refuses while the table is poisoned', async () => {
    // The other half of mechanism 3, and the one a suite cannot sidestep by
    // simply not touching the table again: concluding "the row is unchanged,
    // so something rejected the write" from a row nothing tried to write.
    await caught(() => upsert([{ id: 'r1', company_id: CO_A, slug: 'TAKEOVER' }], { onConflict: 'id' }));
    const later = await caught(async () => rows(T));
    expect(isHarnessConfigurationError(later)).toBe(true);
    expect(later!.message).toMatch(/Stored state here proves nothing/);
    consumeRefusals();
  });

  it('seed() does NOT clear the poison — only the explicit acknowledgement does', async () => {
    // It used to, which made the cheapest line in the file lift the cascade,
    // erase the refusal record and drop the declared model all at once.
    await caught(() => upsert([{ id: 'r1', company_id: CO_A, slug: 'TAKEOVER' }], { onConflict: 'id' }));
    seed({ fx_rows: [{ id: 'r1', company_id: CO_B, slug: 'confidential' }] });
    resolveUpsertConflicts(T, ['id']);
    const still = await caught(() => upsert([{ id: 'r1', slug: 'fine' }], { onConflict: 'id' }));
    expect(isHarnessConfigurationError(still)).toBe(true);

    // And the refusal record survived the re-seed too, so the explicit guard
    // still fires. `calls` is per-test state and is cleared; the LEDGER is not.
    expect(() => assertNoHarnessConfigurationError()).toThrow(/REFUSED by the harness/);

    // consumeRefusals() is the one thing that lifts it, and then the table works.
    consumeRefusals();
    const res = await upsert([{ id: 'r1', slug: 'fine' }], { onConflict: 'id' });
    expect(res.error).toBeNull();
    expect(rows(T)[0]).toMatchObject({ slug: 'fine' });
  });
});

describe('harness — returned rows are copies on every data method', () => {
  beforeEach(() => {
    seed({ fx_rows: [{ id: 'r1', company_id: CO_A, slug: 'one' }] });
    resolveUpsertConflicts(T, ['id']);
  });

  const mutateAndCheck = (data: Array<Record<string, unknown>>) => {
    expect(data.length).toBeGreaterThan(0);
    data[0].slug = 'MUTATED_VIA_RESULT';
    expect(rows(T).map((r) => String(r.slug))).not.toContain('MUTATED_VIA_RESULT');
  };

  it('select', async () => {
    const res = await fakeSupabase.from(T).select('*').eq('id', 'r1');
    mutateAndCheck(res.data);
  });

  it('insert', async () => {
    const res = await fakeSupabase.from(T).insert([{ id: 'r2', company_id: CO_A, slug: 'two' }]).select('*');
    mutateAndCheck(res.data);
  });

  it('upsert (merge leg)', async () => {
    const res = await upsert([{ id: 'r1', slug: 'updated' }], { onConflict: 'id' });
    mutateAndCheck(res.data);
  });

  it('update', async () => {
    const res = await fakeSupabase.from(T).update({ slug: 'patched' }).eq('id', 'r1').select('*');
    mutateAndCheck(res.data);
  });

  it('delete', async () => {
    const res = await fakeSupabase.from(T).delete().eq('id', 'r1').select('*');
    expect(res.data).toHaveLength(1);
    res.data[0].slug = 'MUTATED_VIA_RESULT';
    expect(rows(T)).toHaveLength(0);
  });

  it('rows() is the DELIBERATE exception — it hands out live state for inspection', () => {
    // Documented, and relied on by suites that assert stored state.
    rows(T)[0].slug = 'inspected-and-changed';
    expect(rows(T)[0]).toMatchObject({ slug: 'inspected-and-changed' });
  });
});

describe('harness — invoke() response fidelity', () => {
  beforeEach(() => { seed(); });

  it('a handler that never responds reports no status, not 200', async () => {
    const r = await invoke(async () => { /* sends nothing */ });
    expect(r.responded).toBe(false);
    expect(r.status).toBeUndefined();
  });

  it('FIRST send wins, and later sends are recorded not applied', async () => {
    // The dangerous direction: a route missing a `return` that sends the
    // payload and THEN a denial. Production has already flushed the payload.
    const r = await invoke(async (_req: any, res: any) => {
      res.status(200).json({ secret: 'leaked' });
      res.status(403).json({ error: 'denied' });
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ secret: 'leaked' });
    expect(r.extraSends).toHaveLength(1);
    expect(r.extraSends[0]).toMatchObject({ status: 403 });
  });

  it('an ordinary single send is unaffected', async () => {
    const r = await invoke(async (_req: any, res: any) => { res.status(201).json({ ok: true }); });
    expect(r.responded).toBe(true);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ ok: true });
    expect(r.extraSends).toHaveLength(0);
  });
});

describe('harness — conflict planning sees the PROJECTED state of the statement', () => {
  // THE DEFECT these pin, reported as a blocker in an independent review: the
  // planner had two populations — the stored rows and the rows it planned to
  // INSERT — and registered NOTHING for a row that merged. Merges are applied
  // only after the whole batch is planned, so during planning the stored target
  // still held its old value and its new one existed nowhere. The outcome of a
  // batch therefore depended on the ORDER of its elements.
  //
  // MODELLED, NOT ESTABLISHED. These assert the harness's own rule about its
  // own declared keys. Nothing here is evidence of PostgreSQL's
  // constraint-checking order, of deferred constraints, or of what a real
  // unique index would do with the same statement.
  beforeEach(() => {
    seed({
      fx_rows: [
        { id: 'r1', company_id: CO_A, slug: 's1' },
        { id: 'r2', company_id: CO_A, slug: 's2' },
      ],
    });
    uniqueKey(T, 'slug');
    resolveUpsertConflicts(T, ['id']);
  });

  const snapshot = () => JSON.stringify(rows(T));

  it('a merge that MOVES onto a value a later insert also wants is rejected', async () => {
    seed({ fx_rows: [{ id: 'r1', company_id: CO_A, slug: 's1' }] });
    uniqueKey(T, 'slug');
    resolveUpsertConflicts(T, ['id']);
    const before = snapshot();

    // Element 1 merges onto r1 and moves its slug s1 → s2.
    // Element 2 inserts a different row that also wants s2.
    const res = await upsert(
      [
        { id: 'r1', slug: 's2' },
        { id: 'r9', company_id: CO_A, slug: 's2' },
      ],
      { onConflict: 'id' },
    );

    expect(res.error?.code).toBe('23505');
    expect(res.error?.message).toMatch(/fx_rows\.slug/);
    // Nothing written, byte-comparably: the merge did not land either.
    expect(snapshot()).toBe(before);
    expect(rows(T)).toHaveLength(1);
    expect(ids()).not.toContain('r9');
  });

  it('and the SAME batch in the opposite order is rejected identically', async () => {
    // This is the half that used to pass. Reversing the elements put the
    // inserted row into the planned population FIRST, so the merge was then
    // checked against it and raised 23505 — meaning the batch's legality was
    // decided by the order the caller happened to use.
    seed({ fx_rows: [{ id: 'r1', company_id: CO_A, slug: 's1' }] });
    uniqueKey(T, 'slug');
    resolveUpsertConflicts(T, ['id']);
    const before = snapshot();

    const res = await upsert(
      [
        { id: 'r9', company_id: CO_A, slug: 's2' },
        { id: 'r1', slug: 's2' },
      ],
      { onConflict: 'id' },
    );

    expect(res.error?.code).toBe('23505');
    expect(snapshot()).toBe(before);
    expect(ids()).not.toContain('r9');
  });

  it('two merges that would both land on one value are rejected in either order', async () => {
    // Neither element is an insert, so the old planner registered nothing at
    // all for this batch and accepted it outright.
    const before = snapshot();
    const res = await upsert(
      [
        { id: 'r1', slug: 'collide' },
        { id: 'r2', slug: 'collide' },
      ],
      { onConflict: 'id' },
    );
    expect(res.error?.code).toBe('23505');
    expect(snapshot()).toBe(before);
  });

  it('a batch whose FINAL values are all distinct still succeeds', async () => {
    const res = await upsert(
      [
        { id: 'r1', slug: 's1-renamed' },
        { id: 'r2', slug: 's2-renamed' },
        { id: 'r9', company_id: CO_A, slug: 's9' },
      ],
      { onConflict: 'id' },
    );
    expect(res.error).toBeNull();
    expect(rows(T)).toHaveLength(3);
    expect(rows(T).map((r) => String(r.slug)).sort()).toEqual(['s1-renamed', 's2-renamed', 's9']);
  });

  it('a merge that VACATES a value lets another element of the same statement take it', async () => {
    // The inverse direction, and the reason the check needs an excluded set
    // rather than just a bigger population: r1's stored 's1' must stop counting
    // as an occupant once this statement is known to be moving it.
    //
    // THE HARNESS'S CHOICE, STATED: it judges the statement by its FINAL state.
    // Real PostgreSQL's answer depends on when the unique constraint is checked
    // relative to each row of the command, which is NOT established here and is
    // not claimed. A suite must not read this as production behaviour.
    const res = await upsert(
      [
        { id: 'r1', slug: 'moved-away' },
        { id: 'r9', company_id: CO_A, slug: 's1' },
      ],
      { onConflict: 'id' },
    );
    expect(res.error).toBeNull();
    expect(rows(T).find((r) => String(r.id) === 'r1')).toMatchObject({ slug: 'moved-away' });
    expect(rows(T).find((r) => String(r.id) === 'r9')).toMatchObject({ slug: 's1' });
  });

  it('a duplicate ARBITER key stays distinguishable from a unique-key collision', async () => {
    // 21000 is cardinality — one command cannot affect a row twice. 23505 is a
    // unique violation. A suite reading these apart is reading two different
    // database behaviours, so the planner must not collapse them.
    const dupArbiter = await upsert(
      [
        { id: 'r1', slug: 'x' },
        { id: 'r1', slug: 'y' },
      ],
      { onConflict: 'id' },
    );
    expect(dupArbiter.error?.code).toBe('21000');

    seed({
      fx_rows: [
        { id: 'r1', company_id: CO_A, slug: 's1' },
        { id: 'r2', company_id: CO_A, slug: 's2' },
      ],
    });
    const uniqueViolation = await upsert([{ id: 'r9', company_id: CO_A, slug: 's1' }], { onConflict: 'id' });
    expect(uniqueViolation.error?.code).toBe('23505');
  });

  it('planning writes nothing: a rejected statement leaves the table untouched', async () => {
    // `state.tables` is written only in the apply pass. The one piece of state
    // planning does advance is the monotonic id allocator, which never
    // re-issues, so an abandoned mint costs an ordinal and nothing else.
    const before = snapshot();
    const beforeCount = rows(T).length;
    const res = await upsert(
      [
        { id: 'r9', company_id: CO_A, slug: 'fresh' },
        { id: 'r8', company_id: CO_A, slug: 's2' },
      ],
      { onConflict: 'id' },
    );
    expect(res.error?.code).toBe('23505');
    expect(snapshot()).toBe(before);
    expect(rows(T)).toHaveLength(beforeCount);

    // The allocator moved on, and the next id-less insert gets a fresh id
    // rather than one a surviving row already holds.
    const ok = await upsert([{ company_id: CO_A, slug: 'after' }], { onConflict: 'id' });
    expect(ok.error).toBeNull();
    expect(new Set(ids()).size).toBe(ids().length);
  });
});

describe('harness — completedWrites() records what a statement DID', () => {
  beforeEach(() => {
    seed({ fx_rows: [{ id: 'r1', company_id: CO_B, slug: 'confidential' }] });
    uniqueKey(T, 'slug');
    resolveUpsertConflicts(T, ['id']);
  });

  it('a LATER failTable() cannot retroactively un-complete an earlier write', async () => {
    // THE DEFECT: completedWrites() filtered on `state.failTables` at assertion
    // time. A suite that drove a cross-tenant upsert and then exercised a
    // lookup-failure path got `completedWrites([t]).toHaveLength(0)` passing
    // over a write that had already re-tenanted the row.
    const res = await upsert([{ id: 'r1', company_id: CO_A, slug: 'TAKEOVER' }], { onConflict: 'id' });
    expect(res.error).toBeNull();
    expect(rows(T)[0]).toMatchObject({ company_id: CO_A, slug: 'TAKEOVER' });
    expect(completedWrites([T])).toHaveLength(1);

    failTable(T);
    expect(completedWrites([T])).toHaveLength(1);
    expect(rows(T)[0]).toMatchObject({ company_id: CO_A });
  });

  it('a modelled 23505 is NOT a completed write — nothing was stored', async () => {
    seed({
      fx_rows: [
        { id: 'r1', company_id: CO_A, slug: 's1' },
        { id: 'r2', company_id: CO_A, slug: 's2' },
      ],
    });
    const res = await upsert([{ id: 'r1', slug: 's2' }], { onConflict: 'id' });
    expect(res.error?.code).toBe('23505');
    expect(writeCalls([T])).toHaveLength(1);
    expect(completedWrites([T])).toHaveLength(0);
  });

  it('a forced failure is not a completed write, and the record says so at the time', async () => {
    failTable(T);
    const res = await upsert([{ id: 'r1', slug: 'x' }], { onConflict: 'id' });
    expect(res.error?.code).toBe('XX000');
    expect(writeCalls([T])).toHaveLength(1);
    expect(completedWrites([T])).toHaveLength(0);
  });

  it('an ordinary successful write is counted once', async () => {
    const res = await upsert([{ id: 'r1', slug: 'edited' }], { onConflict: 'id' });
    expect(res.error).toBeNull();
    expect(completedWrites([T])).toHaveLength(1);
    expect(completedWrites([T])[0]).toMatchObject({ op: 'upsert', completed: true });
  });
});

describe('harness — .update() validates the whole resulting state', () => {
  beforeEach(() => {
    seed({
      fx_rows: [
        { id: 'r1', company_id: CO_A, slug: 's1' },
        { id: 'r2', company_id: CO_A, slug: 's2' },
      ],
    });
    uniqueKey(T, 'slug');
    resolveUpsertConflicts(T, ['id']);
  });

  it('an update matching SEVERAL rows cannot set one unique value on all of them', async () => {
    // THE DEFECT: each matched row was compared only against the stored table,
    // with no account of the rows this same statement was about to change, so
    // the statement returned error: null and left duplicates behind.
    const before = JSON.stringify(rows(T));
    const res = await fakeSupabase.from(T).update({ slug: 'collapsed' }).eq('company_id', CO_A).select('*');
    expect(res.error?.code).toBe('23505');
    expect(JSON.stringify(rows(T))).toBe(before);
  });

  it('an update onto a DIFFERENT row’s stored value is still rejected', async () => {
    const res = await fakeSupabase.from(T).update({ slug: 's2' }).eq('id', 'r1').select('*');
    expect(res.error?.code).toBe('23505');
    expect(rows(T).find((r) => String(r.id) === 'r1')).toMatchObject({ slug: 's1' });
  });

  it('an update of a single row to a free value still succeeds', async () => {
    const res = await fakeSupabase.from(T).update({ slug: 'free' }).eq('id', 'r1').select('*');
    expect(res.error).toBeNull();
    expect(rows(T).find((r) => String(r.id) === 'r1')).toMatchObject({ slug: 'free' });
  });

  it('an update patch of `{ id: null }` is a supplied null, not a no-op', async () => {
    const res = await fakeSupabase.from(T).update({ id: null }).eq('id', 'r1').select('*');
    expect(res.error?.code).toBe('23502');
    expect(rows(T).find((r) => String(r.id) === 'r1')).toBeDefined();
  });

  it('an undefined-valued key in an update patch is dropped, not written', async () => {
    const res = await fakeSupabase.from(T).update({ slug: 'kept', company_id: undefined }).eq('id', 'r1').select('*');
    expect(res.error).toBeNull();
    expect(rows(T).find((r) => String(r.id) === 'r1')).toMatchObject({ slug: 'kept', company_id: CO_A });
  });
});

describe('harness — a declared defaultArbiter is validated like an explicit one', () => {
  beforeEach(() => {
    seed({ fx_rows: [{ id: 'r1', company_id: CO_A, slug: 's1' }] });
    resetHarnessDeclarations();
  });

  it('a typo in the declared default is refused, not silently un-matchable', async () => {
    // THE DEFECT: the default-arbiter branch returned the declared columns
    // without running the unknown-column check the explicit path runs, so
    // `resolveUpsertConflicts(t, ['compnay_id'])` produced an arbiter no row
    // could ever match — a blind append wearing the resolve model's name.
    resolveUpsertConflicts(T, ['compnay_id']);
    const err = await expectRefused(() => upsert([{ id: 'r1', slug: 'x' }]));
    expect(err.message).toMatch(/42P10/);
    expect(err.message).toMatch(/defaultArbiter/);
    expect(rows(T)).toHaveLength(1);
  });

  it('a correct declared default still resolves a no-options upsert', async () => {
    resolveUpsertConflicts(T, ['id']);
    const res = await upsert([{ id: 'r1', slug: 'merged-by-default' }]);
    expect(res.error).toBeNull();
    expect(rows(T)).toHaveLength(1);
    expect(rows(T)[0]).toMatchObject({ slug: 'merged-by-default' });
  });
});

describe('harness — append mode is not an exemption from the configuration checks', () => {
  beforeEach(() => {
    seed({ fx_rows: [{ id: 'r1', company_id: CO_A, slug: 's1' }] });
    resetHarnessDeclarations();
  });

  it('a NO-OPTIONS upsert under an unacknowledged append model is refused', async () => {
    // THE DEFECT: the append branch returned before every configuration check,
    // so declaring append silenced the one refusal this harness documents as
    // mandatory — the case where the server's default conflict resolution is
    // what decides whether a cross-tenant write merges. Two production call
    // sites on platform_strategies pass no options at all.
    upsertAppendsBlindly(T, 'fidelity fixture: only that a write was attempted');
    const err = await expectRefused(() => upsert([{ id: 'r1', slug: 'x' }]));
    expect(err.message).toMatch(/no onConflict option/);
    expect(err.message).toMatch(/alsoForNoOptionsCalls/);
    expect(rows(T)).toHaveLength(1);
  });

  it('acknowledging that call shape explicitly is what allows it', async () => {
    upsertAppendsBlindly(T, 'fidelity fixture: route upserts with no options', { alsoForNoOptionsCalls: true });
    const res = await upsert([{ id: 'r1', slug: 'appended' }]);
    expect(res.error).toBeNull();
    // Appended, NOT merged — which is the whole reason the acknowledgement has
    // to be written down.
    expect(rows(T)).toHaveLength(2);
    expect(refusedCalls()).toHaveLength(0);
    expect(declaredUpsertMode(T)).toMatchObject({ mode: 'append', noOptionsAcknowledged: true });
  });

  it('an onConflict naming no column is refused in append mode too', async () => {
    upsertAppendsBlindly(T, 'fidelity fixture: only that a write was attempted');
    const err = await expectRefused(() => upsert([{ id: 'r1', slug: 'x' }], { onConflict: '' }));
    expect(err.message).toMatch(/no column at all/);
    expect(rows(T)).toHaveLength(1);
  });

  it('an onConflict naming an unknown column is refused in append mode too', async () => {
    upsertAppendsBlindly(T, 'fidelity fixture: only that a write was attempted');
    const err = await expectRefused(() => upsert([{ id: 'r1', slug: 'x' }], { onConflict: 'nonexistent_col' }));
    expect(err.message).toMatch(/42P10/);
    expect(rows(T)).toHaveLength(1);
  });

  it('an explicit, known onConflict still appends without complaint', async () => {
    upsertAppendsBlindly(T, 'fidelity fixture: only that a write was attempted');
    const res = await upsert([{ id: 'r1', slug: 'appended' }], { onConflict: 'id' });
    expect(res.error).toBeNull();
    expect(rows(T)).toHaveLength(2);
    expect(refusedCalls()).toHaveLength(0);
  });
});

describe('harness — a mid-test seed() cannot drop the suite’s declared model', () => {
  it('the declared upsert model survives a re-seed', async () => {
    // THE DEFECT: seed() cleared state.upsertModes, so a mid-test
    // `seed({...})` — which two suites in this repository call to set up a
    // second scenario — left every later upsert in that test running under NO
    // declared model. Two of the nine blind-append suites did exactly this.
    seed({ fx_rows: [{ id: 'r1', company_id: CO_A, slug: 's1' }] });
    resolveUpsertConflicts(T, ['id']);

    seed({ fx_rows: [{ id: 'r1', company_id: CO_A, slug: 's1' }] });
    expect(declaredUpsertMode(T)).toMatchObject({ mode: 'resolve' });

    // It still RESOLVES — it neither refuses nor falls back to appending.
    const res = await upsert([{ id: 'r1', slug: 'merged' }], { onConflict: 'id' });
    expect(res.error).toBeNull();
    expect(rows(T)).toHaveLength(1);
    expect(rows(T)[0]).toMatchObject({ slug: 'merged' });
    expect(refusedCalls()).toHaveLength(0);
  });

  it('a declared uniqueKey survives a re-seed, and is not duplicated by re-declaring', async () => {
    seed({ fx_rows: [{ id: 'r1', company_id: CO_A, slug: 's1' }] });
    uniqueKey(T, 'slug');
    uniqueKey(T, 'slug');
    resolveUpsertConflicts(T, ['id']);

    seed({
      fx_rows: [
        { id: 'r1', company_id: CO_A, slug: 's1' },
        { id: 'r2', company_id: CO_A, slug: 's2' },
      ],
    });
    const res = await upsert([{ id: 'r1', slug: 's2' }], { onConflict: 'id' });
    expect(res.error?.code).toBe('23505');
  });

  it('resetHarnessDeclarations() is the explicit way to get a blank slate', async () => {
    seed({ fx_rows: [{ id: 'r1', company_id: CO_A, slug: 's1' }] });
    resolveUpsertConflicts(T, ['id']);
    resetHarnessDeclarations();
    expect(declaredUpsertMode(T)).toBeUndefined();
    const err = await expectRefused(() => upsert([{ id: 'r1', slug: 'x' }], { onConflict: 'id' }));
    expect(err.message).toMatch(/has not declared an upsert model/);
  });
});

describe('harness — the uniqueness verdict is INDEPENDENT of element order', () => {
  // THE DEFECT these pin, reported as a blocker twice. The planner decided each
  // element as it walked the batch, so the targets of LATER elements were not
  // yet excluded from the occupant population: a value another element was
  // about to VACATE still counted as occupied. An exhaustive sweep found 20 of
  // 72 ordered two-element batches changed outcome on reversal, and a legal
  // swap was rejected both ways while the comment claimed the statement was
  // "judged by its FINAL state".
  //
  // Every case below is asserted in BOTH orders. That is the whole point: a
  // reversed-order twin existed for the one SYMMETRIC case and was missing for
  // the asymmetric one, which is exactly where it would have failed.
  //
  // MODELLED, NOT ESTABLISHED: real PostgreSQL checks a non-deferrable unique
  // index per tuple as the command walks rows, so it may reject some statements
  // this accepts. See statementUniqueViolation().
  const two = (seedRows: Row[], a: Row, b: Row) => {
    const run = async (first: Row, second: Row) => {
      seed({ fx_rows: seedRows.map((r) => ({ ...r })) });
      uniqueKey(T, 'slug');
      resolveUpsertConflicts(T, ['id']);
      const before = JSON.stringify(rows(T));
      const res = await upsert([first, second], { onConflict: 'id' });
      return { code: res.error?.code ?? null, unchanged: JSON.stringify(rows(T)) === before };
    };
    return Promise.all([run(a, b), run(b, a)]);
  };

  const R1 = { id: 'r1', company_id: CO_A, slug: 's1' };
  const R2 = { id: 'r2', company_id: CO_A, slug: 's2' };

  it('1+4. a merge VACATES a value another element takes — accepted in both orders', async () => {
    const [fwd, rev] = await two([R1], { id: 'r1', slug: 'moved' }, { id: 'r9', company_id: CO_A, slug: 's1' });
    expect(fwd.code).toBeNull();
    expect(rev.code).toBeNull();
    expect(fwd.code).toBe(rev.code);
  });

  it('2+4. two merges EXCHANGE unique values — legal final state, accepted in both orders', async () => {
    // Rejected in both orders before, which contradicted the stated rule.
    const [fwd, rev] = await two([R1, R2], { id: 'r1', slug: 's2' }, { id: 'r2', slug: 's1' });
    expect(fwd.code).toBeNull();
    expect(rev.code).toBeNull();
  });

  it('3+4. a merge takes a value another merge vacates — accepted in both orders', async () => {
    const [fwd, rev] = await two([R1, R2], { id: 'r1', slug: 'free' }, { id: 'r2', slug: 's1' });
    expect(fwd.code).toBeNull();
    expect(rev.code).toBeNull();
  });

  it('6+4. a collision with a row the statement does NOT write — rejected in both orders', async () => {
    // r2 is untouched, so its 's2' stays occupied and nothing may take it.
    const [fwd, rev] = await two([R1, R2], { id: 'r1', slug: 's2' }, { id: 'r9', company_id: CO_A, slug: 'free' });
    expect(fwd.code).toBe('23505');
    expect(rev.code).toBe('23505');
    expect(fwd.unchanged).toBe(true);
    expect(rev.unchanged).toBe(true);
  });

  it('an illegal final state is still rejected in both orders', async () => {
    // Two written rows both ending on 's2' — no vacating involved.
    const [fwd, rev] = await two([R1], { id: 'r1', slug: 's2' }, { id: 'r9', company_id: CO_A, slug: 's2' });
    expect(fwd.code).toBe('23505');
    expect(rev.code).toBe('23505');
    expect(fwd.unchanged).toBe(true);
  });

  it('5. a duplicate ARBITER key is settled for the whole statement, before uniqueness', async () => {
    // 21000 is cardinality; 23505 is a unique violation. A statement containing
    // BOTH used to return whichever sat at the lower index — 21000 one way
    // round and 23505 the other. Cardinality is now decided in a first pass.
    const [fwd, rev] = await two([R1, R2], { id: 'r1', slug: 's1' }, { id: 'r1', slug: 's2' });
    expect(fwd.code).toBe('21000');
    expect(rev.code).toBe('21000');
  });

  it('a three-element batch colliding between elements 1 and 3 is rejected in both orders', async () => {
    const run = async (els: Row[]) => {
      seed({ fx_rows: [{ ...R1 }] });
      uniqueKey(T, 'slug');
      resolveUpsertConflicts(T, ['id']);
      const res = await upsert(els, { onConflict: 'id' });
      return res.error?.code ?? null;
    };
    // The merge moves r1 onto 'x1' and the third element also wants 'x1', so the
    // FINAL state would hold it twice. The collision is between positions 1 and
    // 3 with an unrelated element between them — the shape most likely to expose
    // a forward-pass planner.
    const a = { id: 'r1', slug: 'x1' };
    const b = { id: 'r8', company_id: CO_A, slug: 'x2' };
    const c = { id: 'r9', company_id: CO_A, slug: 'x1' };
    expect(await run([a, b, c])).toBe('23505');
    expect(await run([c, b, a])).toBe('23505');
  });

  it('a three-element batch where element 1 VACATES what element 3 takes is accepted in both orders', async () => {
    const run = async (els: Row[]) => {
      seed({ fx_rows: [{ ...R1 }] });
      uniqueKey(T, 'slug');
      resolveUpsertConflicts(T, ['id']);
      const res = await upsert(els, { onConflict: 'id' });
      return res.error?.code ?? null;
    };
    const a = { id: 'r1', slug: 'vacated' };                       // frees 's1'
    const b = { id: 'r8', company_id: CO_A, slug: 'x2' };
    const c = { id: 'r9', company_id: CO_A, slug: 's1' };          // takes 's1'
    expect(await run([a, b, c])).toBeNull();
    expect(await run([c, b, a])).toBeNull();
  });

  it('a pre-existing duplicate between two UNTOUCHED rows does not fail an unrelated write', async () => {
    // A real unique index could not have permitted that state, so it is illegal
    // FIXTURE state, not this statement's doing. Counting it made every write to
    // such a table fail with a database code a suite could read as enforcement.
    seed({
      fx_rows: [
        { id: 'd1', company_id: CO_A, slug: 'dup' },
        { id: 'd2', company_id: CO_A, slug: 'dup' },
        { id: 'r9', company_id: CO_A, slug: 'free' },
      ],
    });
    uniqueKey(T, 'slug');
    resolveUpsertConflicts(T, ['id']);
    const res = await upsert([{ id: 'r9', text: 'patched' }], { onConflict: 'id' });
    expect(res.error).toBeNull();
    expect(rows(T).find((r) => String(r.id) === 'r9')).toMatchObject({ text: 'patched' });
  });
});

describe('harness — `id` is modelled as a unique key on every validating path', () => {
  // THE DEFECT: `state.unique` held only what a suite declared, so `id` was
  // enforced NOWHERE unless a suite happened to declare it. `.insert({id:'r1'})`
  // onto an existing `r1` returned error: null and left TWO rows with that id;
  // `.update({id:'r2'}).eq('id','r1')` collapsed two rows onto one identity.
  // Every later `.eq('id', …)` then matched two rows, so a route whose
  // create-race protection IS the primary key appeared to succeed twice.
  //
  // MODELLED, NOT ESTABLISHED: that each real target has `id` as a primary key
  // is a schema question, true in this repository's committed DDL for the four
  // tables Fix 3 owns.
  beforeEach(() => {
    seed({ fx_rows: [{ id: 'r1', company_id: CO_A, slug: 's1' }] });
    resetHarnessDeclarations();
    resolveUpsertConflicts(T, ['id']);
  });

  it('a plain INSERT cannot duplicate an existing id', async () => {
    const res = await fakeSupabase.from(T).insert([{ id: 'r1', company_id: CO_A, slug: 'dup' }]).select('*');
    expect(res.error?.code).toBe('23505');
    expect(rows(T).filter((r) => String(r.id) === 'r1')).toHaveLength(1);
  });

  it('two batch-mates cannot share one id in a single INSERT', async () => {
    const res = await fakeSupabase.from(T).insert([
      { id: 'rX', company_id: CO_A, slug: 'a' },
      { id: 'rX', company_id: CO_A, slug: 'b' },
    ]).select('*');
    expect(res.error?.code).toBe('23505');
    expect(rows(T).filter((r) => String(r.id) === 'rX')).toHaveLength(0);
  });

  it('an UPDATE cannot collapse two rows onto one id', async () => {
    seed({ fx_rows: [{ id: 'r1', company_id: CO_A }, { id: 'r2', company_id: CO_A }] });
    resetHarnessDeclarations();
    const res = await fakeSupabase.from(T).update({ id: 'r2' }).eq('id', 'r1').select('*');
    expect(res.error?.code).toBe('23505');
    expect(rows(T).map((r) => String(r.id)).sort()).toEqual(['r1', 'r2']);
  });

  it('an upsert INSERT leg cannot land on an occupied id under a different arbiter', async () => {
    seed({ fx_rows: [{ id: 'r1', company_id: CO_A, slug: 's1', platform: 'li' }] });
    resetHarnessDeclarations();
    resolveUpsertConflicts(T, ['platform']);
    // Arbiter is `platform`; this row's platform matches nothing, so it INSERTs —
    // carrying an id that is already taken.
    const res = await upsert([{ id: 'r1', company_id: CO_A, platform: 'x' }], { onConflict: 'platform' });
    expect(res.error?.code).toBe('23505');
    expect(rows(T)).toHaveLength(1);
  });

  it('a legitimate merge onto the same id is NOT a duplicate', async () => {
    const res = await upsert([{ id: 'r1', slug: 'edited' }], { onConflict: 'id' });
    expect(res.error).toBeNull();
    expect(rows(T)).toHaveLength(1);
    expect(rows(T)[0]).toMatchObject({ id: 'r1', slug: 'edited' });
  });
});

describe('harness — configuration refusal precedes row-level validation', () => {
  // THE DEFECT: the supplied-null-id check ran on intake, BEFORE
  // requireUpsertMode and resolveArbiter. So one `id: null` anywhere in a batch
  // returned a modelled 23502 and the statement was never measured against any
  // declared model — an undeclared table, an unknown arbiter column and an empty
  // onConflict all stopped being refused, with no refusal recorded and no poison
  // set. A row-level error must never buy an exemption from a mandatory refusal.
  beforeEach(() => {
    seed({ fx_rows: [{ id: 'r1', company_id: CO_A, slug: 's1' }] });
    resetHarnessDeclarations();
  });

  it('an UNDECLARED table is refused even when the batch carries `id: null`', async () => {
    const err = await expectRefused(() => upsert([{ id: null, company_id: CO_A, slug: 'x' }], { onConflict: 'id' }));
    expect(err.message).toMatch(/has not declared an upsert model/);
  });

  it('an unknown arbiter column is refused even when the batch carries `id: null`', async () => {
    resolveUpsertConflicts(T, ['id']);
    const err = await expectRefused(() => upsert([{ id: null, company_id: CO_A }], { onConflict: 'nonexistent_col' }));
    expect(err.message).toMatch(/42P10/);
  });

  it('an empty onConflict is refused even when the batch carries `id: null`', async () => {
    resolveUpsertConflicts(T, ['id']);
    const err = await expectRefused(() => upsert([{ id: null, company_id: CO_A }], { onConflict: '' }));
    expect(err.message).toMatch(/no column at all/);
  });

  it('an unacknowledged no-options append is refused even when the batch carries `id: null`', async () => {
    upsertAppendsBlindly(T, 'fidelity fixture: only that a write was attempted');
    const err = await expectRefused(() => upsert([{ id: null, company_id: CO_A }]));
    expect(err.message).toMatch(/alsoForNoOptionsCalls/);
  });

  it('once the model IS declared, `id: null` is the 23502 it should always have been', async () => {
    resolveUpsertConflicts(T, ['id']);
    const res = await upsert([{ id: null, company_id: CO_A, slug: 'x' }], { onConflict: 'id' });
    expect(res.error?.code).toBe('23502');
    expect(rows(T)).toHaveLength(1);
  });
});

describe('harness — attempted, completed, refused and errored are four distinct outcomes', () => {
  // A grant-path assertion used to be satisfiable by a REFUSED statement:
  // writeCalls() counts it (deliberately, so a no-write assertion cannot pass on
  // one), its payload is readable, and calls() ordering is preserved. Two live
  // product tests passed over writes that never happened because of exactly
  // that. These pin the four meanings apart.
  beforeEach(() => {
    seed({ fx_rows: [{ id: 'r1', company_id: CO_A, slug: 's1' }, { id: 'r2', company_id: CO_A, slug: 's2' }] });
    resetHarnessDeclarations();
  });

  it('a COMPLETED write is the only one that stored anything', async () => {
    resolveUpsertConflicts(T, ['id']);
    const res = await upsert([{ id: 'r1', slug: 'edited' }], { onConflict: 'id' });
    expect(res.error).toBeNull();
    expect(writeCalls([T])).toHaveLength(1);
    expect(completedWrites([T])).toHaveLength(1);
    expect(erroredWrites([T])).toHaveLength(0);
    expect(refusedCalls()).toHaveLength(0);
    expect(rows(T).find((r) => String(r.id) === 'r1')).toMatchObject({ slug: 'edited' });
  });

  it('an ERRORED write is attempted, not completed, and carries its code', async () => {
    uniqueKey(T, 'slug');
    resolveUpsertConflicts(T, ['id']);
    const res = await upsert([{ id: 'r1', slug: 's2' }], { onConflict: 'id' });
    expect(res.error?.code).toBe('23505');
    expect(writeCalls([T])).toHaveLength(1);
    expect(completedWrites([T])).toHaveLength(0);
    expect(erroredWrites([T])).toHaveLength(1);
    expect(erroredWrites([T])[0]).toMatchObject({ errorCode: '23505' });
    expect(refusedCalls()).toHaveLength(0);
  });

  it('a REFUSED statement is attempted but neither completed nor errored', async () => {
    // THE ROUTE-SHAPED CASE, which is how both live false passes survived: a
    // caller that swallows the throw and then asserts presence or ordering.
    await caught(() => upsert([{ id: 'r1', slug: 'x' }], { onConflict: 'id' }));
    expect(writeCalls([T])).toHaveLength(1);          // a presence assertion PASSES
    expect(writeCalls([T])[0].payload).toBeDefined();  // a payload assertion PASSES
    expect(completedWrites([T])).toHaveLength(0);      // only THIS tells the truth
    expect(erroredWrites([T])).toHaveLength(0);
    expect(refusedCalls()).toHaveLength(1);
    consumeRefusals();
  });

  it('a FORCED failure is attempted and errored, not completed', async () => {
    resolveUpsertConflicts(T, ['id']);
    failTable(T);
    const res = await upsert([{ id: 'r1', slug: 'x' }], { onConflict: 'id' });
    expect(res.error?.code).toBe('XX000');
    expect(completedWrites([T])).toHaveLength(0);
    expect(erroredWrites([T])[0]).toMatchObject({ errorCode: 'XX000' });
  });

  it('a refusal survives a mid-test seed(), so a no-write assertion cannot pass on it', async () => {
    // seed() used to clear `state.calls` outright, erasing mechanism (ii): a
    // suite that swallowed a refusal and re-seeded for a second scenario got
    // `writeCalls(t).toHaveLength(0)` passing. Eight suites call seed() mid-test.
    await caught(() => upsert([{ id: 'r1', slug: 'x' }], { onConflict: 'id' }));
    seed({ fx_rows: [{ id: 'r1', company_id: CO_A, slug: 's1' }] });
    expect(writeCalls([T])).toHaveLength(1);
    expect(writeCalls([T])[0]).toMatchObject({ refused: true });
    expect(() => assertNoHarnessConfigurationError()).toThrow(/REFUSED by the harness/);
    consumeRefusals();
  });
});

describe('harness — the copy contract holds for NESTED values', () => {
  // THE DEFECT: copies were `{ ...row }` — SHALLOW — while the contract promised
  // that mutating a returned row "cannot reach stored state". One level down it
  // could, and stored rows aliased the caller's own payload objects. JSONB
  // columns are the common shape in this repository.
  beforeEach(() => {
    seed({ fx_rows: [{ id: 'r1', company_id: CO_A, meta: { k: 1, deep: { n: 1 } }, tags: ['a'] }] });
    resetHarnessDeclarations();
    resolveUpsertConflicts(T, ['id']);
  });

  it('mutating a nested value of a SELECTed row does not reach stored state', async () => {
    const res = await fakeSupabase.from(T).select('*').eq('id', 'r1');
    res.data[0].meta.k = 999;
    res.data[0].meta.deep.n = 999;
    res.data[0].tags.push('mutated');
    expect(rows(T)[0].meta).toEqual({ k: 1, deep: { n: 1 } });
    expect(rows(T)[0].tags).toEqual(['a']);
  });

  it('a stored row does not alias the caller’s payload object', async () => {
    const payload: Record<string, unknown> = { id: 'r2', company_id: CO_A, meta: { k: 1 } };
    await fakeSupabase.from(T).insert([payload]).select('*');
    (payload.meta as Record<string, unknown>).k = 777;
    expect(rows(T).find((r) => String(r.id) === 'r2')!.meta).toEqual({ k: 1 });
  });

  it('nested isolation holds on the upsert merge leg and on update', async () => {
    const merged = await upsert([{ id: 'r1', meta: { k: 2, deep: { n: 2 } } }], { onConflict: 'id' });
    merged.data[0].meta.deep.n = 999;
    expect(rows(T)[0].meta).toEqual({ k: 2, deep: { n: 2 } });

    const updated = await fakeSupabase.from(T).update({ meta: { k: 3 } }).eq('id', 'r1').select('*');
    updated.data[0].meta.k = 999;
    expect(rows(T)[0].meta).toEqual({ k: 3 });
  });

  it('rows() remains the DELIBERATE live exception, nested included', () => {
    (rows(T)[0].meta as Record<string, unknown>).k = 42;
    expect(rows(T)[0].meta).toEqual({ k: 42, deep: { n: 1 } });
  });
});

describe('harness — .update() validates the whole resulting state without stale values', () => {
  beforeEach(() => {
    seed({
      fx_rows: [
        { id: 'r1', company_id: CO_A, slug: 's1' },
        { id: 'r2', company_id: CO_A, slug: 's2' },
      ],
    });
    resetHarnessDeclarations();
    uniqueKey(T, 'slug');
  });

  it('setting one unique value on SEVERAL matched rows is rejected', async () => {
    const before = JSON.stringify(rows(T));
    const res = await fakeSupabase.from(T).update({ slug: 'collapsed' }).eq('company_id', CO_A).select('*');
    expect(res.error?.code).toBe('23505');
    expect(JSON.stringify(rows(T))).toBe(before);
  });

  it('a patch that does not touch the unique column is NOT rejected', async () => {
    // The second design rejected this: rows later in the match set still counted
    // with their OLD values, so a patch of an unrelated column collided with the
    // row's own stored value.
    const res = await fakeSupabase.from(T).update({ note: 'x' }).eq('company_id', CO_A).select('*');
    expect(res.error).toBeNull();
    expect(rows(T).every((r) => r.note === 'x')).toBe(true);
  });

  it('updating a row to the value it already holds is allowed', async () => {
    const res = await fakeSupabase.from(T).update({ slug: 's1' }).eq('id', 'r1').select('*');
    expect(res.error).toBeNull();
  });

  it('two matched rows SWAPPING is judged on the final state', async () => {
    // Both rows are written, so neither's stored value remains an occupant.
    // A single `.update()` applies one uniform patch and cannot express a swap,
    // so this pins the inverse: moving the whole match set onto free values.
    const res = await fakeSupabase.from(T).update({ slug: 'same' }).eq('id', 'r1').select('*');
    expect(res.error).toBeNull();
    expect(rows(T).find((r) => String(r.id) === 'r1')).toMatchObject({ slug: 'same' });
  });

  it('moving onto a value held by an UNMATCHED row is still rejected', async () => {
    const res = await fakeSupabase.from(T).update({ slug: 's2' }).eq('id', 'r1').select('*');
    expect(res.error?.code).toBe('23505');
    expect(rows(T).find((r) => String(r.id) === 'r1')).toMatchObject({ slug: 's1' });
  });
});

describe('harness — the uniqueness invariant is about MULTIPLICITY, not occupancy', () => {
  // THE DEFECT these pin. The previous rule asked only whether a written value
  // collided with a SURVIVOR's value. It therefore ignored a duplicate between
  // two survivors — right, because a real unique index could not have permitted
  // it — but it was narrower than its own rationale: the moment the statement
  // WROTE one of the duplicated rows, that row left `survivors`, its twin
  // stayed, and the written row's OWN UNCHANGED VALUE read as occupied. So a
  // patch that did not mention the unique column at all returned 23505, and
  // every write touching a duplicated row was refused — the exact failure the
  // rationale existed to remove, surviving for exactly those rows.
  //
  // THE INVARIANT NOW: for every declared unique column and every value, the
  // statement may not raise that value's multiplicity above max(1, before).
  //
  // MODELLED, NOT ESTABLISHED: a real non-deferrable unique index could never
  // have reached the duplicated fixture state these tests start from, and checks
  // per tuple as the command walks rows. Nothing here is evidence about
  // PostgreSQL; see the NOT ESTABLISHED list.
  const DUP = () => {
    seed({
      fx_rows: [
        { id: 'd1', company_id: CO_A, slug: 'v', note: 'a' },
        { id: 'd2', company_id: CO_A, slug: 'v', note: 'b' },
        { id: 'r9', company_id: CO_A, slug: 'x', note: 'c' },
      ],
    });
    resetHarnessDeclarations();
    uniqueKey(T, 'slug');
    resolveUpsertConflicts(T, ['id']);
  };
  const CLEAN = () => {
    seed({
      fx_rows: [
        { id: 'r1', company_id: CO_A, slug: 's1' },
        { id: 'r2', company_id: CO_A, slug: 's2' },
      ],
    });
    resetHarnessDeclarations();
    uniqueKey(T, 'slug');
    resolveUpsertConflicts(T, ['id']);
  };
  const multiplicity = (v: string) => rows(T).filter((r) => String(r.slug) === v).length;

  it('case 1 — a conflict the statement CREATES is refused', async () => {
    CLEAN();
    const res = await upsert([{ id: 'r1', slug: 's2' }], { onConflict: 'id' });
    expect(res.error?.code).toBe('23505');
    expect(rows(T).find((r) => String(r.id) === 'r1')).toMatchObject({ slug: 's1' });
  });

  it('case 2 — a pre-existing duplicate the statement does not touch is ignored', async () => {
    DUP();
    const res = await upsert([{ id: 'r9', note: 'patched' }], { onConflict: 'id' });
    expect(res.error).toBeNull();
    expect(rows(T).find((r) => String(r.id) === 'r9')).toMatchObject({ note: 'patched' });
  });

  it('case 3 — a write TOUCHING a duplicated row with the unique column UNCHANGED is allowed', async () => {
    // The H4 regression. `slug` is absent from the payload entirely, so the
    // statement cannot have created the duplicate it was being blamed for.
    DUP();
    const res = await upsert([{ id: 'd1', note: 'patched' }], { onConflict: 'id' });
    expect(res.error).toBeNull();
    expect(rows(T).find((r) => String(r.id) === 'd1')).toMatchObject({ slug: 'v', note: 'patched' });
    expect(multiplicity('v')).toBe(2); // unchanged, not increased
  });

  it('case 3b — the same on the UPDATE path, and when BOTH duplicated rows are matched', async () => {
    DUP();
    let res = await fakeSupabase.from(T).update({ note: 'n' }).eq('id', 'd1').select('*');
    expect(res.error).toBeNull();

    DUP();
    res = await fakeSupabase.from(T).update({ note: 'n' }).eq('slug', 'v').select('*');
    expect(res.error).toBeNull();
    expect(res.count).toBe(2);
    expect(multiplicity('v')).toBe(2);
  });

  it('case 4 — moving a unique column INTO a conflicting value is refused', async () => {
    DUP();
    const res = await upsert([{ id: 'r9', slug: 'v' }], { onConflict: 'id' });
    expect(res.error?.code).toBe('23505');
    expect(rows(T).find((r) => String(r.id) === 'r9')).toMatchObject({ slug: 'x' });
  });

  it('case 5 — a statement that would INCREASE the duplicate count is refused', async () => {
    DUP();
    const res = await upsert([{ id: 'rX', company_id: CO_A, slug: 'v' }], { onConflict: 'id' });
    expect(res.error?.code).toBe('23505');
    expect(multiplicity('v')).toBe(2);

    // and on the plain INSERT path
    DUP();
    const ins = await fakeSupabase.from(T).insert([{ id: 'rI', company_id: CO_A, slug: 'v' }]).select('*');
    expect(ins.error?.code).toBe('23505');
    expect(multiplicity('v')).toBe(2);
  });

  it('case 6 — a statement that REDUCES the duplicate count is allowed', async () => {
    DUP();
    const res = await upsert([{ id: 'd1', slug: 'freed' }], { onConflict: 'id' });
    expect(res.error).toBeNull();
    expect(multiplicity('v')).toBe(1);
    expect(multiplicity('freed')).toBe(1);
  });

  it('the invariant does not admit a NEW duplicate value anywhere', async () => {
    // Two written rows landing on one previously-free value must still fail,
    // which is the property the looser rule must not have cost us.
    CLEAN();
    const res = await upsert(
      [{ id: 'r1', slug: 'brand-new' }, { id: 'rN', company_id: CO_A, slug: 'brand-new' }],
      { onConflict: 'id' },
    );
    expect(res.error?.code).toBe('23505');
  });

  it('and order independence is unaffected by the change', async () => {
    const run = async (els: Row[]) => {
      CLEAN();
      const res = await upsert(els, { onConflict: 'id' });
      return res.error?.code ?? null;
    };
    const a = { id: 'r1', slug: 'moved' };
    const b = { id: 'rT', company_id: CO_A, slug: 's1' };
    expect(await run([a, b])).toBe(await run([b, a]));
    const c = { id: 'r1', slug: 's2' };
    const d = { id: 'r2', slug: 's1' };
    expect(await run([c, d])).toBe(await run([d, c]));
  });
});

describe('harness — append mode validates no CONFLICT, but still refuses a null identity', () => {
  beforeEach(() => {
    seed({ fx_rows: [{ id: 'r1', company_id: CO_A, slug: 's1' }] });
    resetHarnessDeclarations();
    upsertAppendsBlindly(T, 'fidelity fixture: only that a write was attempted', { alsoForNoOptionsCalls: true });
  });

  it('an explicit `id: null` is 23502 in append mode too, and stores nothing', async () => {
    // It used to be stored silently — `["r1", null]` — while the WHAT IS MOCKED
    // list stated the 23502 rule with no append exception, making the list false
    // and admitting a row with no identity.
    const res = await upsert([{ id: null, company_id: CO_A, slug: 'z' }], { onConflict: 'id' });
    expect(res.error?.code).toBe('23502');
    expect(rows(T).map((r) => r.id)).toEqual(['r1']);
  });

  it('the null check does NOT pre-empt this branch’s configuration refusals', async () => {
    // Order matters: a malformed row must not buy an exemption from a mandatory
    // refusal. An unknown arbiter column is still 42P10, not 23502.
    const err = await expectRefused(() => upsert([{ id: null, company_id: CO_A }], { onConflict: 'nonexistent_col' }));
    expect(err.message).toMatch(/42P10/);
  });

  it('a duplicate id appended here no longer makes the table write-dead', async () => {
    // Append validates nothing, so this is still allowed — that is its contract.
    // What changed is the consequence: a later `.update()` on that id used to
    // return a spurious 23505 forever, because the old occupancy rule counted
    // the twin. Under the multiplicity invariant it does not.
    const res = await upsert([{ id: 'r1', company_id: CO_A, slug: 'dup-id' }], { onConflict: 'id' });
    expect(res.error).toBeNull();
    expect(rows(T).filter((r) => String(r.id) === 'r1')).toHaveLength(2);

    const later = await fakeSupabase.from(T).update({ note: 'n' }).eq('id', 'r1').select('*');
    expect(later.error).toBeNull();
    expect(later.count).toBe(2);
  });
});

describe('harness — a recorded Call is a SNAPSHOT, not a handle on the caller’s object', () => {
  beforeEach(() => {
    seed({ fx_rows: [] });
    resetHarnessDeclarations();
    resolveUpsertConflicts(T, ['id']);
  });

  it('mutating the payload AFTER the statement does not change what writeCalls() reports', async () => {
    // `payload` and `options` used to be the caller's own objects by reference,
    // so a route that mutated its payload after writing changed the recorded
    // observation. An observation that drifts is worse than none — and the
    // residual note reasons explicitly about `.payload` being readable on a
    // refused call.
    const payload: Array<Record<string, any>> = [
      { id: 'p1', company_id: CO_A, nested: { secret: 'ORIGINAL' } },
    ];
    const options = { onConflict: 'id' };
    await fakeSupabase.from(T).upsert(payload, options).select('*');

    payload[0].id = 'TOTALLY_DIFFERENT';
    payload[0].nested.secret = 'MUTATED_AFTER_THE_WRITE';
    (options as Record<string, unknown>).onConflict = 'mutated';

    const recorded = writeCalls([T])[0];
    expect(recorded.payload).toEqual([
      { id: 'p1', company_id: CO_A, nested: { secret: 'ORIGINAL' } },
    ]);
    expect(recorded.options).toEqual({ onConflict: 'id' });
    expect(rows(T)[0]).toMatchObject({ id: 'p1', nested: { secret: 'ORIGINAL' } });
  });

  it('filters are snapshotted too', async () => {
    const val: Record<string, unknown> = { deep: 'ORIGINAL' };
    await fakeSupabase.from(T).select('*').eq('meta', val);
    val.deep = 'MUTATED';
    expect(calls()[calls().length - 1].filters.meta).toEqual({ deep: 'ORIGINAL' });
  });
});
