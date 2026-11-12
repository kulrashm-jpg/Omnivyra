/**
 * 20270217000003_payment_provider_event_state_writer - COMMITTED real-schema
 * evidence (05/e9 rule). Pass 1: every case runs in a rolled-back transaction.
 * The committing race (two writers on one event) lives in
 * payment_provider_event_state_writer_concurrency_real.test.ts.
 */
import fs from 'fs';
import path from 'path';
import { db, inRollback } from './setup';

const ADV = 'public.advance_payment_provider_event_state_guarded(uuid,text,text)';
const ATTR = 'public.set_payment_provider_event_attributes(uuid,jsonb)';

beforeAll(async () => {
  for (const sig of [ADV, ATTR]) {
    const f = (await db.query('SELECT to_regprocedure($1) AS f', [sig])).rows[0].f;
    if (!f) throw new Error(`${sig} is NOT installed - refusing to pass vacuously`);
  }
  if (!(await db.query(`SELECT to_regclass('public.payment_provider_event_attributes') AS t`)).rows[0].t) {
    throw new Error('payment_provider_event_attributes is NOT installed');
  }
});

/** Insert a ledger event (INSERT is allowed; the ledger is append-only) and return its id. */
const newEvent = async (provider = 'stripe') =>
  (await db.query(
    `INSERT INTO public.payment_provider_events (provider, provider_event_id, event_type)
     VALUES ($1, 'evt_rs_' || gen_random_uuid()::text, 'test.event') RETURNING id`, [provider])).rows[0].id as string;
const advance = async (id: string, status: string, err: string | null = null) =>
  (await db.query(`SELECT public.advance_payment_provider_event_state_guarded($1, $2, $3) AS r`, [id, status, err])).rows[0].r as
    { applied: boolean; current: string; previous?: string };
const state = async (id: string) =>
  (await db.query(`SELECT processing_status AS s, retry_count AS n, error_message AS e, processed_at IS NOT NULL AS p
                     FROM public.payment_provider_event_state WHERE provider_event_pk = $1`, [id])).rows[0];
const raises = async (fn: () => Promise<unknown>, re: RegExp) => {
  await db.query('SAVEPOINT s');
  try { await fn(); await db.query('RELEASE SAVEPOINT s'); return false; } catch (e: any) {
    await db.query('ROLLBACK TO SAVEPOINT s'); return re.test(String(e.message));
  }
};

describe('forward-only state machine', () => {
  it.each([
    ['recorded', 'processed', true], ['recorded', 'duplicate', true], ['recorded', 'failed', true], ['recorded', 'requeued', false],
    ['failed', 'requeued', true], ['failed', 'failed', true], ['failed', 'processed', false],
    ['requeued', 'processed', true], ['requeued', 'failed', true], ['requeued', 'requeued', false],
    ['processed', 'failed', false], ['processed', 'processed', false], ['processed', 'requeued', false],
    ['duplicate', 'processed', false], ['duplicate', 'failed', false],
  ])('%s -> %s : applied=%s', async (from, to, ok) => {
    await inRollback(async () => {
      const id = await newEvent();
      const path: Record<string, string[]> = { recorded: [], failed: ['failed'], requeued: ['failed', 'requeued'], processed: ['processed'], duplicate: ['duplicate'] };
      for (const step of path[from]) expect((await advance(id, step)).applied).toBe(true);
      const r = await advance(id, to, to === 'failed' ? 'boom' : null);
      expect(r.applied).toBe(ok);
      expect((await state(id)).s).toBe(ok ? to : from); // a refused transition changes NOTHING
    });
  });

  it('the full retry path: recorded -> failed -> requeued -> processed (retry_count 1, processed_at set)', async () => {
    await inRollback(async () => {
      const id = await newEvent();
      await advance(id, 'failed', 'credit grant failed');
      await advance(id, 'requeued');
      await advance(id, 'processed');
      expect(await state(id)).toMatchObject({ s: 'processed', n: 1, p: true });
    });
  });

  it("an 'ignored' event is recorded as processed + reason (no 'ignored' status - e9)", async () => {
    await inRollback(async () => {
      const id = await newEvent();
      expect((await advance(id, 'processed', 'ignored:unsupported_event_type')).applied).toBe(true);
      expect(await state(id)).toMatchObject({ s: 'processed', e: 'ignored:unsupported_event_type' });
      expect(await raises(() => advance(id, 'ignored'), /PAYMENT_EVENT_STATUS_INVALID/)).toBe(true);
    });
  });

  it('an UNKNOWN event id raises PAYMENT_EVENT_NOT_FOUND (nothing created)', async () => {
    await inRollback(async () => {
      expect(await raises(() => advance('00000000-0000-4000-8000-0000000003ff', 'processed'), /PAYMENT_EVENT_NOT_FOUND/)).toBe(true);
    });
  });

  it("'recorded' is never a TARGET state (PAYMENT_EVENT_STATUS_INVALID)", async () => {
    await inRollback(async () => {
      const id = await newEvent();
      expect(await raises(() => advance(id, 'recorded'), /PAYMENT_EVENT_STATUS_INVALID/)).toBe(true);
    });
  });
});

describe('attributes: set-if-null, never overwritten', () => {
  it('first write sets; a different later value does NOT overwrite; a NULL field is filled later', async () => {
    await inRollback(async () => {
      const id = await newEvent('razorpay');
      await db.query(`SELECT public.set_payment_provider_event_attributes($1, $2)`, [id, { provider_order_id: 'order_A', signature_valid: true }]);
      await db.query(`SELECT public.set_payment_provider_event_attributes($1, $2)`, [id, { provider_order_id: 'order_B', provider_payment_id: 'pay_1' }]);
      const r = (await db.query(`SELECT provider, provider_order_id AS o, provider_payment_id AS p, signature_valid AS v
                                  FROM public.payment_provider_event_attributes WHERE provider_event_pk = $1`, [id])).rows[0];
      expect(r).toEqual({ provider: 'razorpay', o: 'order_A', p: 'pay_1', v: true });
    });
  });
  it('an order-id lookup works through the side table (idx_ppe_attributes_order)', async () => {
    await inRollback(async () => {
      const id = await newEvent('razorpay');
      await db.query(`SELECT public.set_payment_provider_event_attributes($1, $2)`, [id, { provider_order_id: 'order_lookup' }]);
      const r = (await db.query(`SELECT provider_event_pk AS id FROM public.payment_provider_event_attributes
                                  WHERE provider = 'razorpay' AND provider_order_id = 'order_lookup'`)).rows;
      expect(r).toEqual([{ id }]);
    });
  });
});

describe('the ledger stays immutable; the new objects are closed to clients', () => {
  it('a direct UPDATE of payment_provider_events still RAISES (raise_ledger_immutable untouched)', async () => {
    await inRollback(async () => {
      const id = await newEvent();
      expect(await raises(() => db.query(`UPDATE public.payment_provider_events SET processing_status = 'processed' WHERE id = $1`, [id]), /LEDGER_IMMUTABLE|immutable/i)).toBe(true);
    });
  });
  it('anon / authenticated: no privilege on the attributes table, no EXECUTE on either function; RLS on', async () => {
    for (const role of ['anon', 'authenticated']) {
      for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        expect((await db.query(`SELECT has_table_privilege($1, 'public.payment_provider_event_attributes', $2) AS x`, [role, priv])).rows[0].x).toBe(false);
      }
      for (const fn of [ADV, ATTR]) {
        expect((await db.query(`SELECT has_function_privilege($1, $2, 'EXECUTE') AS x`, [role, fn])).rows[0].x).toBe(false);
      }
    }
    expect((await db.query(`SELECT relrowsecurity AS r FROM pg_class WHERE oid = 'public.payment_provider_event_attributes'::regclass`)).rows[0].r).toBe(true);
  });
});

describe('the migration itself', () => {
  const MIG_DIR = path.resolve(__dirname, '../../../supabase/migrations');
  const MIG = fs.readFileSync(path.join(MIG_DIR, '20270217000003_payment_provider_event_state_writer.sql'), 'utf8');
  const RB = fs.readFileSync(path.join(MIG_DIR, 'rollbacks/payment_provider_event_state_writer_rollback.sql'), 'utf8');

  it('a re-run is a verified no-op (all 3 objects present -> accepted; postcondition passes)', async () => {
    await inRollback(async () => { await db.query(MIG); });
  });

  it('the rollback REFUSES while the attributes table holds rows (a DROP would destroy enrichment)', async () => {
    await inRollback(async () => {
      const id = await newEvent('razorpay');
      await db.query(`SELECT public.set_payment_provider_event_attributes($1, $2)`, [id, { provider_order_id: 'order_rb' }]);
      expect(await raises(() => db.query(RB), /holds 1 row/)).toBe(true);
      expect((await db.query(`SELECT to_regclass('public.payment_provider_event_attributes') AS t`)).rows[0].t).toBeTruthy();
    });
  });

  it('the rollback on an EMPTY attributes table removes exactly the 3 objects (inside a rolled-back transaction)', async () => {
    await inRollback(async () => {
      await db.query('DELETE FROM public.payment_provider_event_attributes');
      await db.query(RB);
      const r = (await db.query(`SELECT to_regclass('public.payment_provider_event_attributes') AS t,
                                        to_regprocedure($1) AS a, to_regprocedure($2) AS b,
                                        to_regclass('public.payment_provider_event_state') AS s`, [ADV, ATTR])).rows[0];
      expect(r).toEqual({ t: null, a: null, b: null, s: 'payment_provider_event_state' }); // the 20260663 table is untouched
    });
  });
});

