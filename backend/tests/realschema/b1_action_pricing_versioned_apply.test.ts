/**
 * B-1 -- public.apply_action_pricing_change against real PostgreSQL (migration 20270210000000).
 *
 * Every property here is one a unit test cannot establish, because it is a property of a
 * transaction or of the catalog. Each "FAIL input" names the input that the old two-statement
 * writer got wrong. The table is real (baseline + replay), including its source_type CHECK and the
 * partial unique index on (action_key) WHERE is_active.
 */
import { db, inRollback } from './setup';

const FN = 'public.apply_action_pricing_change(text, numeric, numeric, numeric, timestamptz, text, text)';

async function seedActive(actionKey: string, sourceType: string, multiplier = 1) {
  await db.query('DELETE FROM public.action_pricing_config WHERE action_key = $1', [actionKey]);
  const { rows } = await db.query(
    `INSERT INTO public.action_pricing_config (action_key, cost_multiplier, minimum_charge_usd, effective_from, is_active, source_type)
     VALUES ($1, $2, 0, now() - interval '1 day', true, $3) RETURNING id`,
    [actionKey, multiplier, sourceType],
  );
  return rows[0].id as string;
}
async function active(actionKey: string) {
  const { rows } = await db.query(
    'SELECT id, source_type, cost_multiplier::float8 AS m FROM public.action_pricing_config WHERE action_key = $1 AND is_active',
    [actionKey],
  );
  return rows;
}
async function apply(actionKey: string, multiplier: number, sourceType: string | null = null) {
  const { rows } = await db.query(
    'SELECT public.apply_action_pricing_change($1, $2, 0, NULL, now(), $3, $4) AS id',
    [actionKey, multiplier, 'b1 test', sourceType],
  );
  return rows[0].id as string;
}
/** Run a statement that must fail, inside a savepoint so the outer test transaction survives. */
async function expectSqlError(fn: () => Promise<unknown>): Promise<{ code: string; message: string }> {
  await db.query('SAVEPOINT b1_expect');
  try {
    await fn();
  } catch (e) {
    await db.query('ROLLBACK TO SAVEPOINT b1_expect');
    const err = e as { code: string; message: string };
    return { code: err.code, message: err.message };
  }
  await db.query('RELEASE SAVEPOINT b1_expect');
  throw new Error('expected the statement to fail, but it succeeded');
}

describe('B-1 apply_action_pricing_change', () => {
  it('carries source_type from the prior active row; the old row is deactivated; exactly one active row', async () => {
    await inRollback(async () => {
      const oldId = await seedActive('b1_carry', 'embedding', 1);
      const newId = await apply('b1_carry', 1.5);
      const rows = await active('b1_carry');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(newId);
      expect(rows[0].source_type).toBe('embedding');
      expect(rows[0].m).toBe(1.5);
      const { rows: old } = await db.query('SELECT is_active FROM public.action_pricing_config WHERE id = $1', [oldId]);
      expect(old[0].is_active).toBe(false);
    });
  });

  it('FAIL input (the unscoped-predicate bug): editing one action leaves EVERY other action active', async () => {
    await inRollback(async () => {
      await seedActive('b1_edit_me', 'llm');
      const otherId = await seedActive('b1_leave_me', 'fixed');
      await apply('b1_edit_me', 2);
      const other = await active('b1_leave_me');
      expect(other).toHaveLength(1);
      expect(other[0].id).toBe(otherId);
    });
  });

  it('FAIL input (the B-1 core): a value the CHECK rejects leaves the PRIOR row active -- the deactivate rolls back', async () => {
    await inRollback(async () => {
      const oldId = await seedActive('b1_bad_type', 'llm');
      const err = await expectSqlError(() => apply('b1_bad_type', 3, 'not_a_source_type'));
      expect(err.code).toBe('23514');
      const rows = await active('b1_bad_type');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(oldId);
    });
  });

  it('FAIL input: a brand-new action_key with no source_type is a NAMED refusal (22023), not a NOT NULL violation; nothing written', async () => {
    await inRollback(async () => {
      await db.query("DELETE FROM public.action_pricing_config WHERE action_key = 'b1_new_key'");
      const err = await expectSqlError(() => apply('b1_new_key', 1));
      expect(err.code).toBe('22023');
      expect(err.message).toContain('source_type is required for action_key b1_new_key');
      const { rows } = await db.query("SELECT count(*)::int AS n FROM public.action_pricing_config WHERE action_key = 'b1_new_key'");
      expect(rows[0].n).toBe(0);
    });
  });

  it('a brand-new action_key WITH a valid source_type is created active', async () => {
    await inRollback(async () => {
      await db.query("DELETE FROM public.action_pricing_config WHERE action_key = 'b1_new_ok'");
      const id = await apply('b1_new_ok', 1, 'fixed');
      const rows = await active('b1_new_ok');
      expect(rows).toEqual([{ id, source_type: 'fixed', m: 1 }]);
    });
  });

  it('an explicit source_type overrides the carried one', async () => {
    await inRollback(async () => {
      await seedActive('b1_override', 'llm');
      await apply('b1_override', 1, 'fixed');
      expect((await active('b1_override'))[0].source_type).toBe('fixed');
    });
  });

  it.each([[''], ['   ']])('FAIL input: a blank action_key (%j) is a named refusal', async (key) => {
    await inRollback(async () => {
      const err = await expectSqlError(() => apply(key, 1, 'llm'));
      expect(err.code).toBe('22023');
    });
  });

  it('grants and pins: client roles cannot EXECUTE, service_role can; SECURITY INVOKER; search_path pinned exactly', async () => {
    const { rows } = await db.query(
      `SELECT has_function_privilege('anon', $1::regprocedure, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', $1::regprocedure, 'EXECUTE') AS authed,
              has_function_privilege('service_role', $1::regprocedure, 'EXECUTE') AS svc,
              has_function_privilege('public', $1::regprocedure, 'EXECUTE') AS pub,
              p.prosecdef, p.proconfig
         FROM pg_proc p WHERE p.oid = $1::regprocedure`,
      [FN],
    );
    expect(rows[0]).toEqual({
      anon: false, authed: false, svc: true, pub: false,
      prosecdef: false, proconfig: ['search_path=pg_catalog, public'],
    });
  });
});
