/**
 * Real-schema cover for 20270217000051_totp_factors_last_used_step + M3's atomic consume (e1, 2026-11-13; 05 asked for
 * it: the guarantee IS Postgres's UPDATE ... WHERE ... RETURNING under concurrency, which a fake can only assume).
 * After the replay: the column is bigint NOT NULL DEFAULT 0; CONCURRENT consumes of one step on a REAL row, from
 * separate connections, succeed exactly once; an older step after a newer one is refused; a newer step succeeds.
 * The UPDATE text is the one consumeTotpStep sends (structural `<`, no .or()).
 */
import { Client } from 'pg';
import { db } from './setup';

const URL = process.env.W6_DB_URL as string;
const USER = '00000000-0000-4000-8000-000000051a01';
const FACTOR = '00000000-0000-4000-8000-000000051f01';
const CONSUME = `UPDATE public.totp_factors SET last_used_step = $2, last_used_at = now()
                  WHERE id = $1 AND last_used_step < $2 RETURNING id`;

async function consumeOn(client: Client, step: number): Promise<boolean> {
  const { rows } = await client.query(CONSUME, [FACTOR, step]);
  return rows.length === 1;
}

describe('20270217000051 totp_factors.last_used_step', () => {
  const extra: Client[] = [];
  beforeAll(async () => {
    await db.query(`INSERT INTO public.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [USER, 'm3-051@example.test']);
    await db.query(
      `INSERT INTO public.totp_factors (id, user_id, vault_secret_id, verified_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (id) DO UPDATE SET last_used_step = 0, revoked_at = NULL`,
      [FACTOR, USER, '00000000-0000-4000-8000-000000051e01']);
    for (let i = 0; i < 4; i++) { const c = new Client({ connectionString: URL }); await c.connect(); extra.push(c); }
  });
  afterAll(async () => {
    await db.query('DELETE FROM public.totp_factors WHERE id = $1', [FACTOR]);
    await Promise.all(extra.map((c) => c.end()));
  });

  it('the column is bigint NOT NULL DEFAULT 0', async () => {
    const { rows } = await db.query(
      `SELECT data_type, is_nullable, column_default FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'totp_factors' AND column_name = 'last_used_step'`);
    expect(rows).toEqual([{ data_type: 'bigint', is_nullable: 'NO', column_default: '0' }]);
  });

  it('CONCURRENT consumes of ONE step from 4 connections: exactly one succeeds', async () => {
    await db.query('UPDATE public.totp_factors SET last_used_step = 0 WHERE id = $1', [FACTOR]);
    const step = 59_000_000;
    const results = await Promise.all(extra.map((c) => consumeOn(c, step)));
    expect(results.filter(Boolean)).toHaveLength(1);
    const { rows } = await db.query('SELECT last_used_step FROM public.totp_factors WHERE id = $1', [FACTOR]);
    expect(Number(rows[0].last_used_step)).toBe(step);
  });

  it('an OLDER step after a newer one is refused; a NEWER step succeeds', async () => {
    await db.query('UPDATE public.totp_factors SET last_used_step = 0 WHERE id = $1', [FACTOR]);
    expect(await consumeOn(extra[0], 59_000_010)).toBe(true);
    expect(await consumeOn(extra[1], 59_000_009)).toBe(false);
    expect(await consumeOn(extra[1], 59_000_010)).toBe(false);
    expect(await consumeOn(extra[2], 59_000_011)).toBe(true);
  });
});
