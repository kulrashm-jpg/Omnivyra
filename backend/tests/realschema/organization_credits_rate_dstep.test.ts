/**
 * Real-schema cover for 20270217000047 (credit_rate_usd DEFAULT 0.007) and for the D-RATE guarded data step
 * (e1, 2026-11-13; owner pricing ruling via e9).
 *
 * D-RATE is ONE guarded data-modifying statement (83's write runner allows exactly one statement). This suite runs the
 * SAME text, kept in DRATE below and in C:/tmp/e1-dstep-credit-rate-0007.sql, against wallets seeded to the C80
 * baseline (Embrosales + 28 at 0.001 + 2 at 0.01) inside a rolled-back transaction, and proves that every guard aborts
 * the WHOLE statement when its condition fails.
 */
import { db, inRollback, attempt } from './setup';

/** Verbatim D-RATE statement (keep identical to C:/tmp/e1-dstep-credit-rate-0007.sql). */
const DRATE = `with emb as (select count(*) as n from public.organization_credits where organization_id::text like '73e5fa6f-%'), pre as (select count(*) filter (where credit_rate_usd = 0.001) as n001, count(*) filter (where credit_rate_usd = 0.01) as n01, count(*) filter (where credit_rate_usd not in (0.001, 0.01)) as nother from public.organization_credits where organization_id::text not like '73e5fa6f-%'), guard_pre as (select 1 / (case when emb.n = 1 and pre.n001 = 28 and pre.n01 = 2 and pre.nother = 0 then 1 else 0 end) as ok, emb.n as embrosales_wallets, pre.n001, pre.n01, pre.nother from emb, pre), upd as (update public.organization_credits set credit_rate_usd = 0.007 where organization_id::text not like '73e5fa6f-%' and credit_rate_usd in (0.001, 0.01) and (select ok from guard_pre) = 1 returning organization_id) select 1 / (case when (select count(*) from upd) = 30 then 1 else 0 end) as counts_ok, (select count(*) from upd) as updated, g.embrosales_wallets, g.n001 as before_at_0001, g.n01 as before_at_001, g.nother as before_other from guard_pre g`;

const EMB = '73e5fa6f-0000-4000-8000-0000000000e5';
const uuid = (n: number) => `11111111-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function seedBaseline(opts: { n001?: number; n01?: number; extra?: number; embrosales?: number } = {}): Promise<void> {
  await db.query('DELETE FROM public.organization_credits');
  const { n001 = 28, n01 = 2, extra = 0, embrosales = 1 } = opts;
  for (let i = 0; i < embrosales; i++) {
    await db.query(`INSERT INTO public.organization_credits (organization_id, credit_rate_usd) VALUES ($1, 0.001)`,
      [i === 0 ? EMB : `73e5fa6f-0000-4000-8000-00000000${String(i).padStart(4, '0')}`]);
  }
  let n = 1;
  for (let i = 0; i < n001; i++) await db.query(`INSERT INTO public.organization_credits (organization_id, credit_rate_usd) VALUES ($1, 0.001)`, [uuid(n++)]);
  for (let i = 0; i < n01; i++) await db.query(`INSERT INTO public.organization_credits (organization_id, credit_rate_usd) VALUES ($1, 0.01)`, [uuid(n++)]);
  for (let i = 0; i < extra; i++) await db.query(`INSERT INTO public.organization_credits (organization_id, credit_rate_usd) VALUES ($1, 0.05)`, [uuid(n++)]);
}
async function rates(): Promise<{ emb: string | null; at0007: number; others: number }> {
  const { rows } = await db.query(
    `SELECT max(credit_rate_usd::text) FILTER (WHERE organization_id::text LIKE '73e5fa6f-%') AS emb,
            count(*) FILTER (WHERE organization_id::text NOT LIKE '73e5fa6f-%' AND credit_rate_usd = 0.007)::int AS at0007,
            count(*) FILTER (WHERE organization_id::text NOT LIKE '73e5fa6f-%' AND credit_rate_usd <> 0.007)::int AS others
       FROM public.organization_credits`);
  return rows[0];
}

describe('20270217000047 credit_rate_usd DEFAULT', () => {
  it('the column DEFAULT is 0.007, so a wallet inserted without a rate gets 0.007', async () => {
    const { rows } = await db.query(
      `SELECT pg_get_expr(d.adbin, d.adrelid) AS def FROM pg_attrdef d
         JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
        WHERE d.adrelid = 'public.organization_credits'::regclass AND a.attname = 'credit_rate_usd'`);
    expect(rows[0].def).toBe('0.007');
    await inRollback(async () => {
      await db.query(`INSERT INTO public.organization_credits (organization_id) VALUES ($1)`, [uuid(999)]);
      const r = await db.query(`SELECT credit_rate_usd::text AS r FROM public.organization_credits WHERE organization_id = $1`, [uuid(999)]);
      expect(Number(r.rows[0].r)).toBe(0.007);
    });
  });
});

describe('D-RATE guarded data step (one statement)', () => {
  it('on the C80 baseline it updates exactly 30 wallets to 0.007 and leaves Embrosales at 0.001', async () => {
    await inRollback(async () => {
      await seedBaseline();
      const { rows } = await db.query(DRATE);
      expect(rows[0]).toMatchObject({ counts_ok: 1, updated: '30', embrosales_wallets: '1', before_at_0001: '28', before_at_001: '2', before_other: '0' });
      expect(await rates()).toEqual({ emb: '0.001000', at0007: 30, others: 0 });
    });
  });

  it.each([
    ['a 29th wallet at 0.001 (drift since C80)', { n001: 29 }],
    ['only one wallet at 0.01', { n01: 1 }],
    ['a wallet at an unexpected rate', { extra: 1 }],
    ['no Embrosales wallet', { embrosales: 0 }],
    ['two wallets matching the Embrosales prefix', { embrosales: 2 }],
  ])('REFUSES and writes NOTHING when the baseline differs: %s', async (_label, opts) => {
    await inRollback(async () => {
      await seedBaseline(opts as Record<string, number>);
      const before = await rates();
      expect(await attempt(DRATE)).toBe('22012'); // division_by_zero = a guard fired
      expect(await rates()).toEqual(before);
    });
  });

  it('a second run REFUSES (the set is no longer the baseline) - it cannot double-apply', async () => {
    await inRollback(async () => {
      await seedBaseline();
      await db.query(DRATE);
      const after = await rates();
      expect(await attempt(DRATE)).toBe('22012');
      expect(await rates()).toEqual(after);
    });
  });
});
