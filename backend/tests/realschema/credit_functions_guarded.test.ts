/**
 * 20270217000023_credit_functions_guarded - COMMITTED real-schema evidence (pass 1:
 * every case runs in a rolled-back transaction; nothing is committed here - the
 * committing race lives in credit_functions_guarded_concurrency_real.test.ts).
 *
 * Pins:
 *  - apply_credit_reservation_guarded: parent required, same-org HOLD parent,
 *    settle-once under ANY key (confirm / release / confirm_partial), same-key
 *    idempotency, key-reuse conflict, settled amount <= the hold's split, other
 *    phases pass through to the live body;
 *  - apply_credit_partial_confirm_guarded: the owner's over-confirm rulings (e9,
 *    2026-11-12) - the excess draws ACROSS categories free -> incentive -> paid,
 *    a total shortfall is RECORDED (never refused), no balance goes negative, the
 *    released remainder gets its OWN ledger row;
 *  - the migration: post-state grants / INVOKER / pinned search_path, a verified
 *    no-op re-run, the ORDER precondition (refuses a pre-000001 body), the foreign-
 *    body refusal, and the provenance rollback (drops exactly the two functions).
 */
import fs from 'fs';
import path from 'path';
import { db, inRollback } from './setup';

const RES = 'public.apply_credit_reservation_guarded(uuid,text,integer,integer,integer,text,text,text,text,uuid,uuid,text)';
const PC = 'public.apply_credit_partial_confirm_guarded(uuid,uuid,integer,integer,integer,text,text,text,text,uuid)';
const LEGACY = 'public.apply_credit_reservation(uuid,text,integer,integer,integer,text,text,text,text,uuid,uuid,text)';
const MIG_DIR = path.resolve(__dirname, '../../../supabase/migrations');
const MIG = fs.readFileSync(path.join(MIG_DIR, '20270217000023_credit_functions_guarded.sql'), 'utf8');
const RB = fs.readFileSync(path.join(MIG_DIR, 'rollbacks/credit_functions_guarded_rollback.sql'), 'utf8');

const ORG = '6a0a0de0-0000-4000-8000-000000000001';
const ORG2 = '6a0a0de0-0000-4000-8000-000000000002';
const ACTOR = '6a0a0de0-0000-4000-8000-0000000000ff';

beforeAll(async () => {
  for (const sig of [RES, PC]) {
    const f = (await db.query('SELECT to_regprocedure($1) AS f', [sig])).rows[0].f;
    if (!f) throw new Error(`20270217000023 is NOT installed (${sig} missing) - refusing to pass vacuously`);
  }
});

const md5Of = async (sig: string) => (await db.query('SELECT md5(prosrc) AS m FROM pg_proc WHERE oid = to_regprocedure($1)', [sig])).rows[0]?.m as string | undefined;

async function seed(org: string, w: { free?: number; incentive?: number; paid?: number }) {
  await db.query('INSERT INTO public.companies (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [org, `guarded ${org.slice(-4)}`]);
  await db.query(
    `INSERT INTO public.organization_credits (organization_id, free_balance, incentive_balance, paid_balance) VALUES ($1, $2, $3, $4)
     ON CONFLICT (organization_id) DO UPDATE SET free_balance = EXCLUDED.free_balance, incentive_balance = EXCLUDED.incentive_balance, paid_balance = EXCLUDED.paid_balance,
       reserved_free = 0, reserved_incentive = 0, reserved_paid = 0`,
    [org, w.free ?? 0, w.incentive ?? 0, w.paid ?? 0]);
}

type Split = { free?: number; incentive?: number; paid?: number };
async function res(org: string, phase: string, s: Split, key: string | null, parent: string | null = null): Promise<any> {
  return (await db.query(`SELECT public.apply_credit_reservation_guarded($1, $2, $3, $4, $5, $6, 'test', NULL, 'guarded test', $7, $8, 'paid') AS r`,
    [org, phase, s.free ?? 0, s.incentive ?? 0, s.paid ?? 0, key, ACTOR, parent])).rows[0].r;
}
async function partial(org: string, hold: string | null, s: Split, key: string | null): Promise<any> {
  return (await db.query(`SELECT public.apply_credit_partial_confirm_guarded($1, $2, $3, $4, $5, $6, 'test', NULL, 'guarded test', $7) AS r`,
    [org, hold, s.free ?? 0, s.incentive ?? 0, s.paid ?? 0, key, ACTOR])).rows[0].r;
}
/** Run a call that must be refused; return its message (a savepoint keeps the transaction usable). */
async function refused(fn: () => Promise<unknown>): Promise<string> {
  await db.query('SAVEPOINT r');
  try { await fn(); } catch (e: any) { await db.query('ROLLBACK TO SAVEPOINT r'); return String(e.message); }
  await db.query('ROLLBACK TO SAVEPOINT r');
  throw new Error('expected a refusal, but the call succeeded');
}
const wallet = async (org: string) => (await db.query(
  `SELECT free_balance::int AS free, incentive_balance::int AS incentive, paid_balance::int AS paid,
          reserved_free::int AS rf, reserved_incentive::int AS ri, reserved_paid::int AS rp
     FROM public.organization_credits WHERE organization_id = $1`, [org])).rows[0];
const children = async (hold: string) => (await db.query(
  `SELECT idempotency_key, execution_phase, credits_delta::int AS d, free_delta::int AS f, incentive_delta::int AS i, paid_delta::int AS p, transaction_type, is_underfunded
     FROM public.credit_transactions WHERE parent_transaction_id = $1 ORDER BY created_at, idempotency_key`, [hold])).rows;
const hold = async (org: string, s: Split, key: string) => (await res(org, 'hold', s, key)).id as string;

describe('migration post-state', () => {
  it('both functions: INVOKER, search_path pinned, service_role EXECUTE, no client EXECUTE', async () => {
    for (const sig of [RES, PC]) {
      const p = (await db.query('SELECT prosecdef, proconfig FROM pg_proc WHERE oid = to_regprocedure($1)', [sig])).rows[0];
      expect(p.prosecdef).toBe(false);
      expect(p.proconfig).toEqual(['search_path=pg_catalog, public']);
      for (const role of ['anon', 'authenticated', 'public']) {
        expect((await db.query(`SELECT has_function_privilege($1, $2, 'EXECUTE') AS x`, [role, sig])).rows[0].x).toBe(false);
      }
      expect((await db.query(`SELECT has_function_privilege('service_role', $1, 'EXECUTE') AS x`, [sig])).rows[0].x).toBe(true);
    }
  });

  it('re-running the migration is a verified NO-OP (both md5s unchanged)', async () => {
    const before = [await md5Of(RES), await md5Of(PC)];
    await inRollback(async () => {
      await db.query(MIG);
      expect([await md5Of(RES), await md5Of(PC)]).toEqual(before);
    });
  });

  it('ORDER: a delegate body that is NOT a 20270217000001 post-fix form is REFUSED; nothing changes', async () => {
    await inRollback(async () => {
      const src = (await db.query('SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure($1)', [LEGACY])).rows[0].prosrc as string;
      const a = (await db.query('SELECT pg_get_function_arguments(to_regprocedure($1)) AS a', [LEGACY])).rows[0].a;
      await db.query(`CREATE OR REPLACE FUNCTION public.apply_credit_reservation(${a}) RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog, public AS $b$${src}\n-- drift$b$`);
      const guarded = await md5Of(RES);
      const msg = await refused(() => db.query(MIG));
      expect(msg).toMatch(/not a 20270217000001 post-fix body/);
      expect(await md5Of(RES)).toBe(guarded);
    });
  });

  it('a guarded function with a FOREIGN body is REFUSED (never silently replaced)', async () => {
    await inRollback(async () => {
      await db.query(`DROP FUNCTION ${RES}`); // a foreign definition may not share our defaults
      await db.query(`CREATE FUNCTION ${RES.replace(/\(.*$/, '')}(p_org_id uuid, p_phase text, p_free_amount integer, p_incentive_amount integer, p_paid_amount integer, p_idempotency_key text, p_reference_type text, p_reference_id text, p_note text, p_performed_by uuid, p_parent_id uuid, p_category text)
        RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog, public AS $b$BEGIN RETURN NULL; END$b$`);
      const foreign = await md5Of(RES);
      expect(await refused(() => db.query(MIG))).toMatch(/FOREIGN body/);
      expect(await md5Of(RES)).toBe(foreign);
    });
  });

  it('the rollback drops EXACTLY the two guarded functions; the legacy function is untouched', async () => {
    const legacy = await md5Of(LEGACY);
    await inRollback(async () => {
      await db.query(RB);
      expect(await md5Of(RES)).toBeUndefined();
      expect(await md5Of(PC)).toBeUndefined();
      expect(await md5Of(LEGACY)).toBe(legacy);
    });
    expect(await md5Of(RES)).toBeDefined(); // rolled back: still installed
  });

  it('the rollback REFUSES while the legacy pair has lost service_role EXECUTE (20270217000024 applied)', async () => {
    await inRollback(async () => {
      await db.query(`REVOKE EXECUTE ON FUNCTION ${LEGACY} FROM service_role`);
      expect(await refused(() => db.query(RB))).toMatch(/roll that back first/);
      expect(await md5Of(RES)).toBeDefined();
    });
  });
});

describe('apply_credit_reservation_guarded', () => {
  it('confirm / release WITHOUT a parent are refused (SETTLEMENT_PARENT_REQUIRED)', async () => {
    await inRollback(async () => {
      await seed(ORG, { free: 10 });
      expect(await refused(() => res(ORG, 'confirm', { free: 1 }, 'k:confirm'))).toMatch(/SETTLEMENT_PARENT_REQUIRED/);
      expect(await refused(() => res(ORG, 'release', { free: 1 }, 'k:release'))).toMatch(/SETTLEMENT_PARENT_REQUIRED/);
    });
  });

  it("a parent of ANOTHER org, or a parent that is not a HOLD, is refused (SETTLEMENT_PARENT_INVALID)", async () => {
    await inRollback(async () => {
      await seed(ORG, { free: 10 });
      await seed(ORG2, { free: 10 });
      const h = await hold(ORG, { free: 4 }, 'pi:hold');
      expect(await refused(() => res(ORG2, 'confirm', { free: 4 }, 'pi:confirm', h))).toMatch(/SETTLEMENT_PARENT_INVALID/);
      const g = (await res(ORG, 'grant', { free: 1 }, 'pi:grant')).id;
      expect(await refused(() => res(ORG, 'release', { free: 1 }, 'pi:release', g))).toMatch(/SETTLEMENT_PARENT_INVALID/);
    });
  });

  it('confirm THEN release under a different key: the release is REFUSED (HOLD_ALREADY_SETTLED) and the wallet is unchanged', async () => {
    await inRollback(async () => {
      await seed(ORG, { free: 10 });
      const h = await hold(ORG, { free: 4 }, 'cr:hold');
      await res(ORG, 'confirm', { free: 4 }, 'cr:confirm', h);
      const before = await wallet(ORG);
      expect(await refused(() => res(ORG, 'release', { free: 4 }, 'cr:release', h))).toMatch(/HOLD_ALREADY_SETTLED/);
      expect(await wallet(ORG)).toEqual(before);
      expect(before).toMatchObject({ free: 6, rf: 0 });
      expect(await children(h)).toHaveLength(1);
    });
  });

  it('a repeat of the SAME key returns the existing row and writes nothing', async () => {
    await inRollback(async () => {
      await seed(ORG, { free: 10 });
      const h = await hold(ORG, { free: 4 }, 'sk:hold');
      const a = await res(ORG, 'confirm', { free: 4 }, 'sk:confirm', h);
      const b = await res(ORG, 'confirm', { free: 4 }, 'sk:confirm', h);
      expect(b.id).toBe(a.id);
      expect(await children(h)).toHaveLength(1);
      expect(await wallet(ORG)).toMatchObject({ free: 6, rf: 0 });
    });
  });

  it('a key already used for ANOTHER hold is refused (IDEMPOTENCY_KEY_CONFLICT), never returned as this settlement', async () => {
    await inRollback(async () => {
      await seed(ORG, { free: 10 });
      const h1 = await hold(ORG, { free: 2 }, 'kc1:hold');
      const h2 = await hold(ORG, { free: 2 }, 'kc2:hold');
      await res(ORG, 'confirm', { free: 2 }, 'kc:confirm', h1);
      expect(await refused(() => res(ORG, 'confirm', { free: 2 }, 'kc:confirm', h2))).toMatch(/IDEMPOTENCY_KEY_CONFLICT/);
      expect(await children(h2)).toHaveLength(0);
    });
  });

  it("a settlement LARGER than the hold's split is refused (SETTLEMENT_EXCEEDS_HOLD) - it would drain another hold's reservation", async () => {
    await inRollback(async () => {
      await seed(ORG, { free: 10 });
      const h1 = await hold(ORG, { free: 3 }, 'ex1:hold');
      await hold(ORG, { free: 3 }, 'ex2:hold');
      expect(await refused(() => res(ORG, 'confirm', { free: 6 }, 'ex1:confirm', h1))).toMatch(/SETTLEMENT_EXCEEDS_HOLD/);
      expect(await wallet(ORG)).toMatchObject({ free: 4, rf: 6 });
    });
  });

  it('control: a hold, a grant and a correct release pass through to the live body', async () => {
    await inRollback(async () => {
      await seed(ORG, { free: 10 });
      await res(ORG, 'grant', { paid: 5 }, 'pt:grant');
      const h = await hold(ORG, { free: 4, paid: 1 }, 'pt:hold');
      expect(await wallet(ORG)).toMatchObject({ free: 6, paid: 4, rf: 4, rp: 1 });
      const r = await res(ORG, 'release', { free: 4, paid: 1 }, 'pt:release', h);
      expect(r.execution_phase).toBe('release');
      expect(await wallet(ORG)).toMatchObject({ free: 10, paid: 5, rf: 0, rp: 0 });
    });
  });

  it('a release of a hold already PARTIALLY confirmed is refused (confirm_partial counts as a settlement)', async () => {
    await inRollback(async () => {
      await seed(ORG, { free: 10 });
      const h = await hold(ORG, { free: 4 }, 'rp:hold');
      await partial(ORG, h, { free: 4 }, 'rp:confirm');
      expect(await refused(() => res(ORG, 'release', { free: 4 }, 'rp:release', h))).toMatch(/HOLD_ALREADY_SETTLED/);
    });
  });
});

describe('apply_credit_partial_confirm_guarded (owner over-confirm rulings)', () => {
  it('UNDER the hold: consumes the actual, and the remainder is released on its OWN ledger row', async () => {
    await inRollback(async () => {
      await seed(ORG, { free: 10 });
      const h = await hold(ORG, { free: 10 }, 'u:hold');
      const r = await partial(ORG, h, { free: 6 }, 'u:confirm');
      expect(r).toMatchObject({ total_consumed: 6, total_released: 4, is_underfunded: false, shortfall_total: 0 });
      expect(r.release_txn_id).toEqual(expect.any(String));
      expect(await wallet(ORG)).toMatchObject({ free: 4, rf: 0 });
      const rows = await children(h);
      expect(rows).toHaveLength(2);
      expect(rows).toEqual(expect.arrayContaining([
        expect.objectContaining({ idempotency_key: 'u:confirm', execution_phase: 'confirm_partial', d: -6, f: -6 }),
        expect.objectContaining({ idempotency_key: 'u:confirm:remainder', execution_phase: 'release', transaction_type: 'refund', d: 4, f: 4 }),
      ]));
    });
  });

  it('EXACTLY the hold: one confirm_partial row, no remainder row', async () => {
    await inRollback(async () => {
      await seed(ORG, { free: 10 });
      const h = await hold(ORG, { free: 5 }, 'x:hold');
      const r = await partial(ORG, h, { free: 5 }, 'x:confirm');
      expect(r).toMatchObject({ total_consumed: 5, total_released: 0, release_txn_id: null });
      expect(await children(h)).toHaveLength(1);
    });
  });

  it('a FREE over-run is paid from PAID when free and incentive are empty (draws across categories)', async () => {
    await inRollback(async () => {
      await seed(ORG, { free: 10, paid: 50 });
      const h = await hold(ORG, { free: 10 }, 'fo:hold');         // free 0 left
      const r = await partial(ORG, h, { free: 15 }, 'fo:confirm');
      expect(r).toMatchObject({ total_consumed: 15, consumed_free: 10, consumed_paid: 5, is_underfunded: false, shortfall_total: 0 });
      expect(await wallet(ORG)).toMatchObject({ free: 0, paid: 45, rf: 0 });
    });
  });

  it('the excess draws in the spending ORDER free -> incentive -> paid', async () => {
    await inRollback(async () => {
      await seed(ORG, { free: 12, incentive: 3, paid: 50 });
      const h = await hold(ORG, { free: 10 }, 'ord:hold');        // free 2 left
      const r = await partial(ORG, h, { free: 17 }, 'ord:confirm'); // excess 7: free 2, incentive 3, paid 2
      expect(r).toMatchObject({ consumed_free: 12, consumed_incentive: 3, consumed_paid: 2, total_consumed: 17 });
      expect(await wallet(ORG)).toMatchObject({ free: 0, incentive: 0, paid: 48 });
    });
  });

  it('the excess may use credits RELEASED by the same settlement (another category)', async () => {
    await inRollback(async () => {
      await seed(ORG, { free: 5, paid: 5 });
      const h = await hold(ORG, { free: 5, paid: 5 }, 'rel:hold');  // all balances 0
      const r = await partial(ORG, h, { free: 8 }, 'rel:confirm');  // paid 5 released; excess 3 drawn from it
      expect(r).toMatchObject({ total_consumed: 8, total_released: 5, consumed_paid: 3, is_underfunded: false });
      expect(await wallet(ORG)).toMatchObject({ free: 0, paid: 2, rf: 0, rp: 0 });
    });
  });

  it('a TOTAL shortfall is RECORDED and NOT refused; no balance goes negative', async () => {
    await inRollback(async () => {
      await seed(ORG, { free: 10 });
      const h = await hold(ORG, { free: 10 }, 'sf:hold');
      const r = await partial(ORG, h, { free: 25 }, 'sf:confirm');
      expect(r).toMatchObject({ total_consumed: 10, shortfall_total: 15, is_underfunded: true });
      const w = await wallet(ORG);
      expect(w).toMatchObject({ free: 0, incentive: 0, paid: 0, rf: 0 });
      const [row] = await children(h);
      expect(row).toMatchObject({ execution_phase: 'confirm_partial', is_underfunded: true });
    });
  });

  it('a SECOND settlement under another key is refused; the SAME key returns the first (idempotent, no new rows)', async () => {
    await inRollback(async () => {
      await seed(ORG, { free: 10 });
      const h = await hold(ORG, { free: 10 }, 'tw:hold');
      const a = await partial(ORG, h, { free: 6 }, 'tw:confirm');
      expect(await refused(() => partial(ORG, h, { free: 6 }, 'tw:other'))).toMatch(/HOLD_ALREADY_SETTLED/);
      const b = await partial(ORG, h, { free: 6 }, 'tw:confirm');
      expect(b).toMatchObject({ id: a.id, idempotent: true, total_consumed: 6, total_released: 4, release_txn_id: a.release_txn_id });
      expect(await children(h)).toHaveLength(2);
      expect(await wallet(ORG)).toMatchObject({ free: 4, rf: 0 });
    });
  });

  // e9 ruling (2026-11-12): the charge carries its USD. Neither live body wrote
  // usd_equivalent, so every partial-confirm charge billed $0.
  it("usd_equivalent = consumed x the org's credit rate at settle time (no rate on the hold)", async () => {
    await inRollback(async () => {
      await seed(ORG, { free: 10, paid: 50 });
      await db.query('UPDATE public.organization_credits SET credit_rate_usd = 0.02 WHERE organization_id = $1', [ORG]);
      const h = await hold(ORG, { free: 10 }, 'usd1:hold');
      const r = await partial(ORG, h, { free: 15 }, 'usd1:confirm'); // over-run: 15 consumed
      expect(Number(r.usd_equivalent)).toBeCloseTo(0.3, 6);
      const row = (await db.query(`SELECT usd_equivalent FROM public.credit_transactions WHERE idempotency_key = 'usd1:confirm'`)).rows[0];
      expect(Number(row.usd_equivalent)).toBeCloseTo(0.3, 6);
    });
  });

  it("a HOLD that carries a USD rate wins over the wallet's current rate", async () => {
    await inRollback(async () => {
      await seed(ORG, { free: 10 });
      // a hold priced at 0.05/credit (written directly: the delegate never sets usd)
      const h = (await db.query(
        `INSERT INTO public.credit_transactions (organization_id, transaction_type, credits_delta, idempotency_key, execution_phase, category, free_delta, paid_delta, incentive_delta, usd_equivalent)
         VALUES ($1, 'deduction', -10, 'usd2:hold', 'hold', 'free', -10, 0, 0, 0.5) RETURNING id`, [ORG])).rows[0].id;
      await db.query('UPDATE public.organization_credits SET free_balance = 0, reserved_free = 10 WHERE organization_id = $1', [ORG]);
      const r = await partial(ORG, h, { free: 4 }, 'usd2:confirm');
      expect(Number(r.usd_equivalent)).toBeCloseTo(0.2, 6); // 4 x 0.05, not 4 x 0.01
    });
  });

  it('refuses a missing parent / key, a foreign-org parent and negative amounts', async () => {
    await inRollback(async () => {
      await seed(ORG, { free: 10 });
      await seed(ORG2, { free: 10 });
      const h = await hold(ORG, { free: 4 }, 'bad:hold');
      expect(await refused(() => partial(ORG, null, { free: 1 }, 'bad:confirm'))).toMatch(/SETTLEMENT_PARENT_REQUIRED/);
      expect(await refused(() => partial(ORG, h, { free: 1 }, null))).toMatch(/IDEMPOTENCY_KEY_REQUIRED/);
      expect(await refused(() => partial(ORG2, h, { free: 1 }, 'bad:confirm'))).toMatch(/SETTLEMENT_PARENT_INVALID/);
      expect(await refused(() => partial(ORG, h, { free: -1 }, 'bad:confirm'))).toMatch(/NEGATIVE_AMOUNT/);
      expect(await children(h)).toHaveLength(0);
    });
  });
});
