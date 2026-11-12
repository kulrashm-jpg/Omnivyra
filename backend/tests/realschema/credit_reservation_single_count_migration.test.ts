/**
 * 20270217000001_credit_reservation_single_count - COMMITTED real-schema evidence
 * for the MIGRATION itself (05 / e9 rule, 2026-11-12). The behaviour (two holds
 * that both fit) is pinned in image_credits_reservation_concurrency.test.ts; this
 * suite pins the md5-branching migration: its post-state, a verified no-op re-run,
 * a byte-exact rollback, and the refusal of an unknown body. All in rolled-back
 * transactions. The CI replay applies 20260625 before it, so CI lands on the
 * 20260625 branch (LF 7799ec27 or CRLF 7ee214ad); prod lands on 03d616e6 (LF).
 */
import fs from 'fs';
import path from 'path';
import { db, inRollback } from './setup';

const SIG = 'public.apply_credit_reservation(uuid,text,integer,integer,integer,text,text,text,text,uuid,uuid,text)';
const MIG_DIR = path.resolve(__dirname, '../../../supabase/migrations');
const MIG = fs.readFileSync(path.join(MIG_DIR, '20270217000001_credit_reservation_single_count.sql'), 'utf8');
const RB = fs.readFileSync(path.join(MIG_DIR, 'rollbacks/credit_reservation_single_count_rollback.sql'), 'utf8');
const PATCHED = ['03d616e692cdfb9fefc25eb81e8e4595', '90bcbfb5e9eb2eedf1a0b7a8266554bf', '7799ec27', '7ee214ad'];
const PRE_IMAGES = ['ad5383bf6ccf24a2c8ddee70db3b1297', '1db00c4d06a4a16c84ed419c4cc47bf6', 'c62d8dde', '6e9ef990'];
const md5 = async () => (await db.query(`SELECT md5(prosrc) AS m FROM pg_proc WHERE oid = to_regprocedure($1)`, [SIG])).rows[0]?.m as string | undefined;
const isOneOf = (m: string | undefined, list: string[]) => !!m && list.some((x) => m.startsWith(x));

it('post-state: the function is one of the four PATCHED forms, INVOKER, pinned search_path, no client EXECUTE', async () => {
  const m = await md5();
  expect(isOneOf(m, PATCHED)).toBe(true);
  const p = (await db.query(`SELECT prosecdef, proconfig FROM pg_proc WHERE oid = to_regprocedure($1)`, [SIG])).rows[0];
  expect(p.prosecdef).toBe(false);
  expect(p.proconfig).toEqual(expect.arrayContaining(['search_path=pg_catalog, public']));
  for (const role of ['anon', 'authenticated']) {
    expect((await db.query(`SELECT has_function_privilege($1, $2, 'EXECUTE') AS x`, [role, SIG])).rows[0].x).toBe(false);
  }
});

it('re-running the migration is a verified NO-OP (md5 unchanged)', async () => {
  const before = await md5();
  await inRollback(async () => {
    await db.query(MIG);
    expect(await md5()).toBe(before);
  });
});

it('the rollback restores a verbatim PRE-IMAGE (byte-exact md5), inside a rolled-back transaction', async () => {
  await inRollback(async () => {
    await db.query(RB);
    expect(isOneOf(await md5(), PRE_IMAGES)).toBe(true);
  });
  expect(isOneOf(await md5(), PATCHED)).toBe(true); // rolled back: still patched
});

it('an UNKNOWN body is REFUSED and nothing changes', async () => {
  await inRollback(async () => {
    const src = (await db.query(`SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure($1)`, [SIG])).rows[0].prosrc as string;
    const args = (await db.query(`SELECT pg_get_function_arguments(to_regprocedure($1)) AS a, pg_get_function_result(to_regprocedure($1)) AS r`, [SIG])).rows[0];
    await db.query(`CREATE OR REPLACE FUNCTION public.apply_credit_reservation(${args.a}) RETURNS ${args.r} LANGUAGE plpgsql SET search_path = pg_catalog, public AS $b$${src}\n-- drift$b$`);
    const drifted = await md5();
    await db.query('SAVEPOINT s');
    let refused = false;
    try { await db.query(MIG); } catch (e: any) { refused = /UNKNOWN apply_credit_reservation body/.test(String(e.message)); }
    await db.query('ROLLBACK TO SAVEPOINT s');
    expect(refused).toBe(true);
    expect(await md5()).toBe(drifted);
  });
});
