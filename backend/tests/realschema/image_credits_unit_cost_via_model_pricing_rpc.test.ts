/**
 * Image credits x branch E (B-1) - COMMITTED real-schema evidence (05/e9 rule).
 * e9 (2026-11-12): E's atomic apply_model_pricing_change (20270210000001) lands
 * BEFORE image credits; vendor unit costs (kind 'unit', e.g. provider 'apollo',
 * model_name 'credit') are written ONLY through it (POST /api/admin/pricing/update,
 * which the Super Admin unit-cost screen calls). E's function takes its kind
 * vocabulary from llm_model_pricing_kind_check, which image credits'
 * 20270216000000 widens with 'unit' - so this suite pins the COMBINATION.
 * Every case runs in a rolled-back transaction (pass 1: commits nothing).
 */
import { db, inRollback } from './setup';

const call = (kind: string, input: number, output = 0) =>
  db.query(
    `SELECT public.apply_model_pricing_change(
       p_provider => 'apollo', p_model_name => 'credit-rs-test', p_kind => $1,
       p_input_per_1k_usd => $2, p_output_per_1k_usd => $3,
       p_effective_from => now(), p_notes => 'realschema') AS id`,
    [kind, input, output]);

beforeAll(async () => {
  const fn = (await db.query(
    `SELECT to_regprocedure('public.apply_model_pricing_change(text,text,text,numeric,numeric,timestamptz,text,integer,integer)') AS f`)).rows[0].f;
  if (!fn) throw new Error('apply_model_pricing_change (20270210000001) is NOT installed - refusing to pass vacuously');
  const def = (await db.query(
    `SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'llm_model_pricing_kind_check'`)).rows[0]?.d as string | undefined;
  if (!def || !def.includes(`'unit'`)) throw new Error(`llm_model_pricing_kind_check lacks 'unit' (${def}) - 20270216000000 not applied`);
});

it("a vendor UNIT cost is written through E's atomic RPC: one active row, kind 'unit'", async () => {
  await inRollback(async () => {
    const id = (await call('unit', 1.25)).rows[0].id as string;
    expect(id).toBeTruthy();
    const rows = (await db.query(
      `SELECT kind, input_per_1k_usd::float AS i, output_per_1k_usd::float AS o, is_active FROM public.llm_model_pricing
        WHERE provider = 'apollo' AND model_name = 'credit-rs-test' AND kind = 'unit' AND is_active`)).rows;
    expect(rows).toEqual([{ kind: 'unit', i: 1.25, o: 0, is_active: true }]);
  });
});

it('a SECOND unit-cost change supersedes atomically: still exactly one active row, at the new price', async () => {
  await inRollback(async () => {
    await call('unit', 1.25);
    await call('unit', 2.5);
    const rows = (await db.query(
      `SELECT input_per_1k_usd::float AS i FROM public.llm_model_pricing
        WHERE provider = 'apollo' AND model_name = 'credit-rs-test' AND kind = 'unit' AND is_active`)).rows;
    expect(rows).toEqual([{ i: 2.5 }]);
  });
});

it('control: a kind outside the table CHECK is refused by the database (the CHECK is the single vocabulary)', async () => {
  await inRollback(async () => {
    await db.query('SAVEPOINT s');
    let refused = false;
    try { await call('not_a_kind', 1); } catch { refused = true; }
    await db.query('ROLLBACK TO SAVEPOINT s');
    expect(refused).toBe(true);
  });
});
