/**
 * Real-schema cover for 20270217000046_action_pricing_owner_rule_15x (e1, 2026-11-13; owner pricing ruling via e9).
 *
 * After the replay (which applies 046 like any migration): every one of the 45 target keys has EXACTLY ONE active row,
 * priced multiplier 15 / floor 0.007 (1 credit at the new rate) / its ceiling; the keys 046 must not touch (report
 * pipelines, 'fixed' rows, embedding) keep their rows; re-running 046 changes nothing; the rollback restores each key's
 * previous active row (or none, for keys that had only a credit_cost_config price).
 * HEAD control: without 046 the target keys are at multiplier 3 (or have no row at all).
 */
import * as fs from 'fs';
import * as path from 'path';
import { db, inRollback } from './setup';

const MIG = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20270217000046_action_pricing_owner_rule_15x.sql'), 'utf8');
const ROLLBACK = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/rollbacks/action_pricing_owner_rule_15x_rollback.sql'), 'utf8');
const TS = '2026-11-14 00:00:00+00';

/** The 45 target keys and ceilings, read from the migration's own VALUES list (single source of truth). */
const TARGET: Array<[string, string]> = Array.from(
  MIG.matchAll(/^\s+\('([A-Za-z_]+)', ([0-9.]+)\)/gm), (m) => [m[1], m[2]] as [string, string]);
const UNTOUCHED = ['website_audit', 'deep_analysis', 'full_strategy', 'auto_post', 'voice_per_minute', 'external_api', 'embedding'];

type Row = { action_key: string; cost_multiplier: string; minimum_charge_usd: string; ceiling_usd: string | null; effective_from: Date };
async function active(): Promise<Map<string, Row[]>> {
  const { rows } = await db.query(
    `SELECT action_key, cost_multiplier::text, minimum_charge_usd::text, ceiling_usd::text, effective_from
       FROM public.action_pricing_config WHERE is_active ORDER BY action_key`);
  const m = new Map<string, Row[]>();
  for (const r of rows as Row[]) m.set(r.action_key, [...(m.get(r.action_key) ?? []), r]);
  return m;
}
const num = (v: string | null) => (v == null ? null : Number(v));
async function dropTemps(): Promise<void> {
  await db.query('DROP TABLE IF EXISTS m046_target; DROP TABLE IF EXISTS m046_untouched;');
}

describe('20270217000046 action_pricing_owner_rule_15x', () => {
  it('parses 45 target keys from the migration (the test reads the same list the migration applies)', () => {
    expect(TARGET).toHaveLength(45);
    expect(new Set(TARGET.map(([k]) => k)).size).toBe(45);
    for (const k of UNTOUCHED) expect(TARGET.map(([t]) => t)).not.toContain(k);
  });

  it('every target key has exactly ONE active row: multiplier 15, floor 0.007, its ceiling, effective 2026-11-14', async () => {
    const a = await active();
    const wrong: string[] = [];
    for (const [k, ceil] of TARGET) {
      const rs = a.get(k) ?? [];
      const ok = rs.length === 1 && num(rs[0].cost_multiplier) === 15 && num(rs[0].minimum_charge_usd) === 0.007
        && num(rs[0].ceiling_usd) === Number(ceil) && rs[0].effective_from.toISOString() === '2026-11-14T00:00:00.000Z';
      if (!ok) wrong.push(`${k}=${JSON.stringify(rs)}`);
    }
    expect(wrong).toEqual([]);
  });

  it('the keys 046 must not touch are not re-priced to the owner rule', async () => {
    const a = await active();
    for (const k of UNTOUCHED) {
      for (const r of a.get(k) ?? []) {
        expect(r.effective_from.toISOString()).not.toBe('2026-11-14T00:00:00.000Z');
      }
    }
  });

  it('re-running 046 is a no-op (no new rows, same active set)', async () => {
    await inRollback(async () => {
      const before = await db.query('SELECT count(*)::int AS n FROM public.action_pricing_config');
      const activeBefore = JSON.stringify([...(await active()).entries()]);
      await dropTemps();
      await db.query(MIG);
      await dropTemps();
      const after = await db.query('SELECT count(*)::int AS n FROM public.action_pricing_config');
      expect(after.rows[0].n).toBe(before.rows[0].n);
      expect(JSON.stringify([...(await active()).entries()])).toBe(activeBefore);
    });
  });

  it('rollback: no 046 row stays active; a key that had an earlier row gets it back; a catalogue-only key has none', async () => {
    await inRollback(async () => {
      await db.query(ROLLBACK);
      const { rows } = await db.query(
        `SELECT count(*)::int AS n FROM public.action_pricing_config WHERE is_active AND effective_from = $1`, [TS]);
      expect(rows[0].n).toBe(0);
      const a = await active();
      // content_rewrite existed before 046 (20261024000002) -> an earlier row is active again
      expect((a.get('content_rewrite') ?? []).length).toBe(1);
      expect(num((a.get('content_rewrite') ?? [])[0]?.cost_multiplier ?? null)).not.toBe(15);
      // blog_generation only had a credit_cost_config price -> no token row after rollback
      expect(a.get('blog_generation')).toBeUndefined();
    });
  });

  it('client roles hold nothing on action_pricing_config (posture restated)', async () => {
    const { rows } = await db.query(
      `SELECT has_table_privilege('anon','public.action_pricing_config','SELECT') AS anon,
              has_table_privilege('authenticated','public.action_pricing_config','SELECT') AS auth`);
    expect(rows[0]).toEqual({ anon: false, auth: false });
  });
});
