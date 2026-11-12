/**
 * Harness control: the real-schema SQL transport answers the way PostgREST does (6f, 83 review, 2026-11-13).
 *
 * The C3 claim fence reads `updated_at` back and compare-and-sets on it. node-pg's Date -> toISOString cut the
 * value to milliseconds, so the CAS could never match through the transport although it matches through real
 * PostgREST (microseconds kept). These cases pin: the microsecond round-trip AND that a CAS on it matches; the
 * NEGATIVE control that a millisecond-truncated token does NOT match (a looser fake - e.g. one that compared at
 * millisecond precision - would pass the positive case alone); row order under ORDER BY / LIMIT / OFFSET; and
 * PostgREST's RPC answer shapes (bare scalar, one object, array, null).
 */
import { db, inRollback } from './setup';
import { pgRpc, pgTable } from './helpers/pgTransport';

const client = () => db;
const t = (name: string) => pgTable(client, name) as any;

async function fixture(): Promise<void> {
  await db.query(`SET LOCAL TimeZone = 'UTC'`);
  await db.query(`CREATE TABLE public.harness_tr_rows (id int PRIMARY KEY, v int NOT NULL, n numeric, doc jsonb, updated_at timestamptz NOT NULL)`);
  await db.query(`INSERT INTO public.harness_tr_rows VALUES
    (1, 30, 1.5, '{"a":1}', '2026-11-12 10:00:00.123456+00'),
    (2, 10, NULL, NULL,      '2026-11-12 10:00:01.000001+00'),
    (3, 50, NULL, NULL,      '2026-11-12 10:00:02.999999+00'),
    (4, 20, NULL, NULL,      '2026-11-12 10:00:03.5+00'),
    (5, 40, NULL, NULL,      '2026-11-12 10:00:04+00')`);
}

describe('real-schema transport: rows as PostgREST renders them', () => {
  it('a microsecond timestamptz round-trips, and a CAS on the token read back MATCHES', async () => {
    await inRollback(async () => {
      await fixture();
      const read = await t('harness_tr_rows').select('id, updated_at').eq('id', 1).maybeSingle();
      expect(read.error).toBeNull();
      expect(read.data).toEqual({ id: 1, updated_at: '2026-11-12T10:00:00.123456+00:00' });
      const cas = await t('harness_tr_rows').update({ v: 31 }).eq('id', 1).eq('updated_at', read.data.updated_at).select('id');
      expect(cas.error).toBeNull();
      expect(cas.data).toEqual([{ id: 1 }]);
    });
  });

  it('NEGATIVE CONTROL: a millisecond-truncated token (the old toISOString shape) does NOT match', async () => {
    await inRollback(async () => {
      await fixture();
      const cas = await t('harness_tr_rows').update({ v: 99 }).eq('id', 1).eq('updated_at', '2026-11-12T10:00:00.123Z').select('id');
      expect(cas.error).toBeNull();
      expect(cas.data).toEqual([]);
      const { rows } = await db.query(`SELECT v FROM public.harness_tr_rows WHERE id = 1`);
      expect(rows[0].v).toBe(30);
    });
  });

  it('row order: ORDER BY with LIMIT / OFFSET returns exactly the requested rows in order', async () => {
    await inRollback(async () => {
      await fixture();
      const desc = await t('harness_tr_rows').select('id, v').order('v', { ascending: false }).limit(3);
      expect(desc.data).toEqual([{ id: 3, v: 50 }, { id: 5, v: 40 }, { id: 1, v: 30 }]);
      const page = await t('harness_tr_rows').select('id').order('v', { ascending: true }).range(1, 3);
      expect(page.data).toEqual([{ id: 4 }, { id: 1 }, { id: 5 }]);
      const star = await t('harness_tr_rows').select('*').eq('id', 1).maybeSingle();
      expect(star.data).toEqual({ id: 1, v: 30, n: 1.5, doc: { a: 1 }, updated_at: '2026-11-12T10:00:00.123456+00:00' });
    });
  });

  it('RETURNING rows carry the same shape (insert / delete)', async () => {
    await inRollback(async () => {
      await fixture();
      const ins = await t('harness_tr_rows').insert({ id: 6, v: 60, updated_at: '2026-11-12T10:00:06.000007+00:00' }).select('id, updated_at');
      expect(ins.data).toEqual([{ id: 6, updated_at: '2026-11-12T10:00:06.000007+00:00' }]);
      const del = await t('harness_tr_rows').delete().eq('id', 6).select('id');
      expect(del.data).toEqual([{ id: 6 }]);
    });
  });

  it('RPC answers: scalar -> the bare value; composite -> one object; SETOF -> array; void -> null', async () => {
    await inRollback(async () => {
      await fixture();
      await db.query(`CREATE FUNCTION public.harness_tr_scalar(p_x int) RETURNS text LANGUAGE sql AS $f$ SELECT 'refreshed' || p_x $f$`);
      await db.query(`CREATE FUNCTION public.harness_tr_one(p_id int) RETURNS public.harness_tr_rows LANGUAGE sql AS $f$ SELECT * FROM public.harness_tr_rows WHERE id = p_id $f$`);
      await db.query(`CREATE FUNCTION public.harness_tr_set(p_min int) RETURNS TABLE (id int, v int) LANGUAGE sql AS $f$ SELECT id, v FROM public.harness_tr_rows WHERE v >= p_min ORDER BY id $f$`);
      await db.query(`CREATE FUNCTION public.harness_tr_void() RETURNS void LANGUAGE sql AS $f$ SELECT $f$`);
      const rpc = pgRpc(client);
      expect(await rpc('harness_tr_scalar', { p_x: 1 })).toEqual({ data: 'refreshed1', error: null });
      expect((await rpc('harness_tr_one', { p_id: 2 })).data).toEqual(expect.objectContaining({ id: 2, v: 10, updated_at: '2026-11-12T10:00:01.000001+00:00' }));
      expect((await rpc('harness_tr_set', { p_min: 40 })).data).toEqual([{ id: 3, v: 50 }, { id: 5, v: 40 }]);
      expect(await rpc('harness_tr_void', {})).toEqual({ data: null, error: null });
    });
  });
});

describe('real-schema transport: deterministic zone and no guessing (83 review)', () => {
  it('renders UTC whatever the SESSION TimeZone, and leaves the caller\'s TimeZone as it was', async () => {
    await inRollback(async () => {
      await fixture();
      await db.query(`SET LOCAL TimeZone = 'Asia/Kolkata'`);
      const read = await t('harness_tr_rows').select('id, updated_at').eq('id', 1).maybeSingle();
      expect(read.data).toEqual({ id: 1, updated_at: '2026-11-12T10:00:00.123456+00:00' });
      const { rows } = await db.query(`SELECT current_setting('TimeZone') AS tz`);
      expect(rows[0].tz).toBe('Asia/Kolkata');
      // CONTROL: the session itself really renders +05:30, so the case above is not vacuous.
      const raw = await db.query(`SELECT to_jsonb(updated_at) #>> '{}' AS v FROM public.harness_tr_rows WHERE id = 1`);
      expect(raw.rows[0].v).toBe('2026-11-12T15:30:00.123456+05:30');
    });
  });

  it('an overloaded function is REFUSED rather than answered in a guessed shape', async () => {
    await inRollback(async () => {
      await fixture();
      await db.query(`CREATE FUNCTION public.harness_tr_over(p_x int) RETURNS int LANGUAGE sql AS 'SELECT p_x'`);
      await db.query(`CREATE FUNCTION public.harness_tr_over(p_x text) RETURNS SETOF public.harness_tr_rows LANGUAGE sql AS 'SELECT * FROM public.harness_tr_rows'`);
      const out = await pgRpc(client)('harness_tr_over', { p_x: 1 });
      expect(out.data).toBeNull();
      expect(String((out.error as Error)?.message)).toMatch(/overloaded/);
    });
  });
});
