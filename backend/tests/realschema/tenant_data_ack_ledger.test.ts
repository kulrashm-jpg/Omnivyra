/**
 * Tenant data-controller acknowledgement: the consent ledger premise
 * (20270209000002/0003; GOV-SECURITY condition, reference shape of
 * g11_optout_review.test.ts PREMISE).
 *
 * "One row per acceptance, no update path" is true only because two triggers on
 * public.consent_records are enabled, BEFORE ROW, on the right event, bound to
 * functions that still raise. The PREMISE test asserts the mechanism; the
 * NEGATIVE CONTROLS show it is NECESSARY (without the trigger, the same update
 * or delete succeeds), not merely present.
 */
import { db, inRollback, seedTenants, ORG_A } from './setup';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The 20270209000002 postcondition block, read from the MIGRATION FILE itself
 * (never a copy), so this suite exercises exactly what will run at apply.
 */
const POSTCONDITION = (() => {
  const sql = readFileSync(join(__dirname, '..', '..', '..', 'supabase', 'migrations',
    '20270209000002_consent_records_tenant_data_ack.sql'), 'utf8');
  const start = sql.indexOf('DO $post$');
  const end = sql.indexOf('$post$;', start + 'DO $post$'.length);
  if (start < 0 || end < 0) throw new Error('postcondition block not found in 20270209000002');
  return sql.slice(start, end + '$post$;'.length);
})();

async function one(sql: string, params: unknown[] = []): Promise<Record<string, unknown>> {
  const { rows } = await db.query(sql, params);
  expect(rows).toHaveLength(1);
  return rows[0];
}

async function ackRow(): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO public.consent_records (organization_id, platform, capability, consent_version, granted_at, scope_snapshot, metadata)
     VALUES ($1, 'pi_data', 'tenant_data_controller_ack', 'v-test', now(), '["vendor_data"]'::jsonb, '{"text_sha256":"x"}'::jsonb)
     RETURNING id`, [ORG_A]);
  return rows[0].id;
}

async function probe(sql: string, params: unknown[] = []): Promise<string> {
  await db.query('SAVEPOINT p');
  try { await db.query(sql, params); await db.query('ROLLBACK TO SAVEPOINT p'); return 'ok'; }
  catch (err: any) { await db.query('ROLLBACK TO SAVEPOINT p'); return String(err.message ?? err.code); }
}

describe('consent ledger premise for tenant data acknowledgements', () => {
  it('the CHECK admits the acknowledgement capability, and it is VALIDATED', async () => {
    const c = await one(`SELECT convalidated, pg_get_constraintdef(oid) AS d FROM pg_constraint
       WHERE conrelid = 'public.consent_records'::regclass AND conname = 'consent_records_capability_check'`);
    expect(c.convalidated).toBe(true);
    expect(String(c.d)).toContain('tenant_data_controller_ack');
  });

  it('PREMISE: both triggers exist, are enabled, BEFORE ROW on the right event, bound to functions that still raise', async () => {
    const upd = await one(
      `SELECT t.tgenabled::text AS enabled, (t.tgtype & 1) <> 0 AS is_row, (t.tgtype & 2) <> 0 AS is_before,
              (t.tgtype & 16) <> 0 AS on_update, p.oid = 'public.trg_consent_records_append_only_update()'::regprocedure AS bound
         FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE t.tgrelid = 'public.consent_records'::regclass AND t.tgname = 'consent_records_append_only' AND NOT t.tgisinternal`);
    expect(['O', 'A']).toContain(upd.enabled);   // fires on ordinary writes (origin or always)
    expect(upd).toMatchObject({ is_row: true, is_before: true, on_update: true, bound: true });
    const del = await one(
      `SELECT t.tgenabled::text AS enabled, (t.tgtype & 1) <> 0 AS is_row, (t.tgtype & 2) <> 0 AS is_before,
              (t.tgtype & 8) <> 0 AS on_delete, p.oid = 'public.trg_consent_records_block_delete()'::regprocedure AS bound
         FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE t.tgrelid = 'public.consent_records'::regclass AND t.tgname = 'consent_records_no_delete' AND NOT t.tgisinternal`);
    expect(['O', 'A']).toContain(del.enabled);
    expect(del).toMatchObject({ is_row: true, is_before: true, on_delete: true, bound: true });
    // Substring on the line that carries the premise, not md5(prosrc).
    expect(String((await one(`SELECT pg_get_functiondef('public.trg_consent_records_append_only_update()'::regprocedure) AS d`)).d))
      .toContain('consent_records is append-only; only revoked_at / revoked_by may be set after insert');
    expect(String((await one(`SELECT pg_get_functiondef('public.trg_consent_records_block_delete()'::regprocedure) AS d`)).d))
      .toContain('consent_records is append-only; deletes blocked');
  });

  it('an acknowledgement row cannot be edited or deleted', () => inRollback(async () => {
    await seedTenants();
    const id = await ackRow();
    expect(await probe(`UPDATE public.consent_records SET consent_version = 'forged' WHERE id = $1`, [id])).toMatch(/append-only/);
    expect(await probe(`UPDATE public.consent_records SET scope_snapshot = '["contact_data"]'::jsonb WHERE id = $1`, [id])).toMatch(/append-only/);
    expect(await probe(`DELETE FROM public.consent_records WHERE id = $1`, [id])).toMatch(/deletes blocked/);
    // Revocation (the one permitted change) still works.
    expect(await probe(`UPDATE public.consent_records SET revoked_at = now() WHERE id = $1`, [id])).toBe('ok');
  }));

  it('NEGATIVE CONTROL: without the triggers the SAME edit and delete succeed (the triggers are load-bearing)', () => inRollback(async () => {
    await seedTenants();
    const id = await ackRow();
    await db.query('DROP TRIGGER consent_records_append_only ON public.consent_records');   // rolled back with the test
    await db.query('DROP TRIGGER consent_records_no_delete ON public.consent_records');
    expect(await probe(`UPDATE public.consent_records SET consent_version = 'forged' WHERE id = $1`, [id])).toBe('ok');
    expect(await probe(`DELETE FROM public.consent_records WHERE id = $1`, [id])).toBe('ok');
  }));

  // PERMANENT (PI review): the allowed set is ('O','A'). A later edit that ADDS
  // 'R' (replica-only, which does NOT fire on ordinary writes) would keep the
  // 'D' control green while certifying a guard that never runs. This pins 'R'.
  it.each(['consent_records_append_only', 'consent_records_no_delete'])(
    'a trigger set to ENABLE REPLICA makes the 0002 postcondition RAISE, naming %s', (trg) => inRollback(async () => {
      expect(await probe(POSTCONDITION)).toBe('ok');                       // baseline: the premise holds
      await db.query(`ALTER TABLE public.consent_records ENABLE REPLICA TRIGGER ${trg}`);   // rolled back with the test
      const msg = await probe(POSTCONDITION);
      expect(msg).toContain('consent ack postcondition');
      expect(msg).toContain(`trigger ${trg}`);
    }));
});
