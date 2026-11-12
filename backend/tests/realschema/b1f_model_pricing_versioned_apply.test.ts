/**
 * B-1 follow-up -- public.apply_model_pricing_change against real PostgreSQL (migration 20270210000001).
 * Same contract as apply_action_pricing_change, plus the token-limit carry the old writer got wrong.
 */
import { Client } from 'pg';
import { db, inRollback } from './setup';

const FN = 'public.apply_model_pricing_change(text, text, text, numeric, numeric, timestamptz, text, integer, integer)';

async function seedActive(provider: string, model: string, kind: string, ctx: number | null, out: number | null) {
  await db.query('DELETE FROM public.llm_model_pricing WHERE provider = $1 AND model_name = $2 AND kind = $3', [provider, model, kind]);
  const { rows } = await db.query(
    `INSERT INTO public.llm_model_pricing (provider, model_name, kind, input_per_1k_usd, output_per_1k_usd, effective_from, is_active, max_context_tokens, max_output_tokens)
     VALUES ($1, $2, $3, 0.1, 0, now() - interval '1 day', true, $4, $5) RETURNING id`,
    [provider, model, kind, ctx, out],
  );
  return rows[0].id as string;
}
async function active(provider: string, model: string, kind: string) {
  const { rows } = await db.query(
    `SELECT id, input_per_1k_usd::float8 AS i, max_context_tokens AS ctx, max_output_tokens AS out
       FROM public.llm_model_pricing WHERE provider = $1 AND model_name = $2 AND kind = $3 AND is_active`,
    [provider, model, kind],
  );
  return rows;
}
async function apply(provider: string, model: string, kind: string, input: number, ctx: number | null = null) {
  const { rows } = await db.query(
    'SELECT public.apply_model_pricing_change($1, $2, $3, $4, 0, now(), $5, $6, NULL) AS id',
    [provider, model, kind, input, 'b1f test', ctx],
  );
  return rows[0].id as string;
}
async function expectSqlError(fn: () => Promise<unknown>): Promise<{ code: string; message: string }> {
  await db.query('SAVEPOINT b1f_expect');
  try {
    await fn();
  } catch (e) {
    await db.query('ROLLBACK TO SAVEPOINT b1f_expect');
    const err = e as { code: string; message: string };
    return { code: err.code, message: err.message };
  }
  await db.query('RELEASE SAVEPOINT b1f_expect');
  throw new Error('expected the statement to fail, but it succeeded');
}

describe('B-1 follow-up apply_model_pricing_change', () => {
  it('FAIL input (the old writer wiped them): token limits are CARRIED from the prior active row', async () => {
    await inRollback(async () => {
      await seedActive('b1f', 'm-carry', 'completion', 128000, 4096);
      const id = await apply('b1f', 'm-carry', 'completion', 0.3);
      expect(await active('b1f', 'm-carry', 'completion')).toEqual([{ id, i: 0.3, ctx: 128000, out: 4096 }]);
    });
  });

  it('a supplied token limit overrides the carried one; the other is still carried', async () => {
    await inRollback(async () => {
      await seedActive('b1f', 'm-over', 'completion', 128000, 4096);
      await apply('b1f', 'm-over', 'completion', 0.3, 200000);
      const rows = await active('b1f', 'm-over', 'completion');
      expect(rows[0].ctx).toBe(200000);
      expect(rows[0].out).toBe(4096);
    });
  });

  it('FAIL input: editing one (provider, model, kind) leaves another kind of the same model, and other models, active', async () => {
    await inRollback(async () => {
      await seedActive('b1f', 'm-scope', 'completion', null, null);
      const emb = await seedActive('b1f', 'm-scope', 'embedding', null, null);
      const otherModel = await seedActive('b1f', 'm-other', 'completion', null, null);
      await apply('b1f', 'm-scope', 'completion', 0.9);
      expect((await active('b1f', 'm-scope', 'embedding'))[0].id).toBe(emb);
      expect((await active('b1f', 'm-other', 'completion'))[0].id).toBe(otherModel);
    });
  });

  it('FAIL input: a negative price (CHECK) for an EXISTING model leaves the PRIOR row active -- the deactivate rolls back', async () => {
    await inRollback(async () => {
      const oldId = await seedActive('b1f', 'm-neg', 'completion', null, null);
      const err = await expectSqlError(() => apply('b1f', 'm-neg', 'completion', -1));
      expect(err.code).toBe('23514');
      expect((await active('b1f', 'm-neg', 'completion'))[0].id).toBe(oldId);
    });
  });

  it('FAIL input: a kind the CHECK rejects writes nothing', async () => {
    await inRollback(async () => {
      await db.query("DELETE FROM public.llm_model_pricing WHERE model_name = 'm-badkind'");
      const err = await expectSqlError(() => apply('b1f', 'm-badkind', 'not_a_kind', 0.1));
      expect(err.code).toBe('23514');
      const { rows } = await db.query("SELECT count(*)::int AS n FROM public.llm_model_pricing WHERE model_name = 'm-badkind'");
      expect(rows[0].n).toBe(0);
    });
  });

  it.each([['', 'm'], ['p', '  ']])('FAIL input: blank provider/model (%j, %j) is a named refusal', async (p, m) => {
    await inRollback(async () => {
      const err = await expectSqlError(() => apply(p, m, 'completion', 0.1));
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
      prosecdef: false, proconfig: ['search_path=pg_catalog, public, pg_temp'],
    });
  });

  it('FAIL input: with NO active row, a concurrent call for the same NEW (provider, model, kind) waits on the ADVISORY lock', async () => {
    const [p, m, k] = ['b1f', 'm-concurrent-new', 'completion'];
    const second = new Client({ connectionString: process.env.W6_DB_URL });
    const third = new Client({ connectionString: process.env.W6_DB_URL });
    await second.connect();
    await third.connect();
    try {
      await db.query('DELETE FROM public.llm_model_pricing WHERE provider = $1 AND model_name = $2', [p, m]);
      const { rows: pidRow } = await db.query('SELECT pg_backend_pid() AS pid');
      const dbPid = pidRow[0].pid as number;
      await second.query('BEGIN');
      await second.query('SELECT public.apply_model_pricing_change($1, $2, $3, 0.1, 0, now(), $4, NULL, NULL)', [p, m, k, 's2']);
      const pending = db.query('SELECT public.apply_model_pricing_change($1, $2, $3, 0.2, 0, now(), $4, NULL, NULL)', [p, m, k, 's1']);
      let waitingOn: string | null = null;
      for (let i = 0; i < 50 && !waitingOn; i++) {
        const { rows } = await third.query('SELECT locktype FROM pg_locks WHERE pid = $1 AND NOT granted LIMIT 1', [dbPid]);
        waitingOn = rows[0]?.locktype ?? null;
        if (!waitingOn) await new Promise((r) => setTimeout(r, 20));
      }
      await second.query('ROLLBACK');
      await pending;
      expect(waitingOn).toBe('advisory');
      const { rows: n } = await db.query(
        'SELECT count(*)::int AS n FROM public.llm_model_pricing WHERE provider = $1 AND model_name = $2 AND kind = $3 AND is_active', [p, m, k],
      );
      expect(n[0].n).toBe(1);
    } finally {
      await second.query('ROLLBACK').catch(() => undefined);
      await second.end();
      await third.end();
      await db.query('DELETE FROM public.llm_model_pricing WHERE provider = $1 AND model_name = $2', [p, m]);
    }
  });
});
