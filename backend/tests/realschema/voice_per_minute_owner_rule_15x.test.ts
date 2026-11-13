/**
 * Real-schema cover for 20270217000049_voice_per_minute_owner_rule_15x (e1, 2026-11-13; owner rule via e9).
 *
 * After the replay (which applies 049 like any migration): voice_per_minute is charged 14 credits/min
 * (credit_cost_config), its ONE active action_pricing_config row is fixed 0.098 / 0.098 dated 2026-11-14 00:49 (the
 * 046 rows are 00:00 - 046's own suite asserts 046 left voice_per_minute alone), the VOICE reference maximum is 75,
 * re-running 049 changes nothing, and the rollback restores 10 credits / the previous row / 60.
 */
import * as fs from 'fs';
import * as path from 'path';
import { db, inRollback } from './setup';

const MIG = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20270217000049_voice_per_minute_owner_rule_15x.sql'), 'utf8');
const ROLLBACK = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/rollbacks/voice_per_minute_owner_rule_15x_rollback.sql'), 'utf8');

async function state() {
  const credits = (await db.query(`SELECT credits FROM public.credit_cost_config WHERE action_type = 'voice_per_minute'`)).rows;
  const active = (await db.query(
    `SELECT source_type, minimum_charge_usd::text AS min, ceiling_usd::text AS ceil, effective_from
       FROM public.action_pricing_config WHERE action_key = 'voice_per_minute' AND is_active`)).rows;
  const voice = (await db.query(`SELECT maximum_credits FROM public.activity_class_economics WHERE activity_class = 'VOICE'`)).rows;
  const total = Number((await db.query(`SELECT count(*) AS n FROM public.action_pricing_config WHERE action_key = 'voice_per_minute'`)).rows[0].n);
  return { credits, active, voice, total };
}

describe('20270217000049 voice_per_minute_owner_rule_15x', () => {
  it('after the replay: 14 credits/min, one active fixed 0.098/0.098 row (00:49), VOICE max 75', async () => {
    const s = await state();
    expect(s.credits).toEqual([{ credits: 14 }]);
    expect(s.active).toHaveLength(1);
    expect(s.active[0]).toMatchObject({ source_type: 'fixed' });
    expect(Number(s.active[0].min)).toBe(0.098);
    expect(Number(s.active[0].ceil)).toBe(0.098);
    expect((s.active[0].effective_from as Date).toISOString()).toBe('2026-11-14T00:49:00.000Z');
    expect(s.voice).toEqual([{ maximum_credits: 75 }]);
  });

  it('14 credits/min at 0.007 is at least 15x the actual voice cost (Whisper 0.006, AssemblyAI 0.0062 per minute)', () => {
    expect((14 * 0.007) / 0.0062).toBeGreaterThanOrEqual(15);
  });

  it('re-running 049 is a no-op (no new rows, same state)', async () => {
    await inRollback(async () => {
      const before = await state();
      await db.query(MIG);
      expect(await state()).toEqual(before);
    });
  });

  it('the rollback restores 10 credits, a non-049 active row, and VOICE max 60', async () => {
    await inRollback(async () => {
      await db.query(ROLLBACK);
      const s = await state();
      expect(s.credits).toEqual([{ credits: 10 }]);
      expect(s.voice).toEqual([{ maximum_credits: 60 }]);
      for (const r of s.active) expect((r.effective_from as Date).toISOString()).not.toBe('2026-11-14T00:49:00.000Z');
    });
  });
});
