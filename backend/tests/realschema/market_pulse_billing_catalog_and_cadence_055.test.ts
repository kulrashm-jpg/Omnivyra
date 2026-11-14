/**
 * Real-schema cover for 20270217000055 (e1; OWNER ruling 2026-11-14; D1a + D2a). After the full replay:
 *   - credit_cost_config market_pulse = 8 (per AI region), INTELLIGENCE_SCAN; NO active action_pricing_config row;
 *   - market_pulse_automation_settings_cadence_check admits ('daily','weekly') and still refuses anything else;
 *   - the cadence default is 'weekly';
 *   - the rollback restores daily-only + default daily and deletes exactly 055's row - and REFUSES while a weekly row
 *     exists (a company's chosen cadence is not rewritten by a rollback).
 * Disposable replay DB only; every mutation runs inside inRollback.
 */
import * as fs from 'fs';
import * as path from 'path';
import { db, inRollback } from './setup';

const URL = process.env.W6_DB_URL ?? '';
if (!/@(127\.0\.0\.1|localhost|\[::1\]):\d+\//.test(URL)) throw new Error('market_pulse_billing_catalog_and_cadence_055 refuses a non-loopback W6_DB_URL');

const ROLLBACK = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/rollbacks/market_pulse_billing_catalog_and_cadence_rollback.sql'), 'utf8');
const checkDef = async () => (await db.query(
  `SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint
    WHERE conrelid = 'public.market_pulse_automation_settings'::regclass AND conname = 'market_pulse_automation_settings_cadence_check'`)).rows[0]?.d as string;
const cadenceDefault = async () => (await db.query(
  `SELECT column_default AS d FROM information_schema.columns
    WHERE table_schema='public' AND table_name='market_pulse_automation_settings' AND column_name='cadence'`)).rows[0]?.d as string;
async function attempt(sql: string, params: unknown[] = []): Promise<string> {
  await db.query('SAVEPOINT s055');
  try { await db.query(sql, params); await db.query('RELEASE SAVEPOINT s055'); return 'ok'; }
  catch (e: any) { await db.query('ROLLBACK TO SAVEPOINT s055'); return String(e.message); }
}

describe('20270217000055 Market Pulse billing catalog + cadence', () => {
  it('the catalog row: market_pulse = 8 per region, INTELLIGENCE_SCAN, exactly once; no active apc row', async () => {
    const { rows } = await db.query(`SELECT credits, category, activity_class FROM public.credit_cost_config WHERE action_type = 'market_pulse'`);
    expect(rows).toEqual([{ credits: 8, category: 'medium', activity_class: 'INTELLIGENCE_SCAN' }]);
    const apc = await db.query(`SELECT 1 FROM public.action_pricing_config WHERE action_key = 'market_pulse' AND is_active`);
    expect(apc.rows).toEqual([]);
  });

  it("the cadence CHECK admits daily and weekly and nothing else; the default is 'weekly'", async () => {
    const d = await checkDef();
    // Exact predicate (Postgres normalises IN (...) to = ANY (ARRAY[...])): exactly the two values, nothing else.
    expect(d).toBe("CHECK ((cadence = ANY (ARRAY['daily'::text, 'weekly'::text])))");
    expect(await cadenceDefault()).toMatch(/^'weekly'/);
  });

  it('rollback restores daily-only + default daily and deletes exactly the 055 row (no weekly rows present)', async () => {
    await inRollback(async () => {
      const before = Number((await db.query('SELECT count(*)::int AS n FROM public.credit_cost_config')).rows[0].n);
      const weekly = Number((await db.query(`SELECT count(*)::int AS n FROM public.market_pulse_automation_settings WHERE cadence='weekly'`)).rows[0].n);
      expect(weekly).toBe(0);
      await db.query(ROLLBACK);
      expect(await checkDef()).not.toMatch(/weekly/);
      expect(await cadenceDefault()).toMatch(/^'daily'/);
      expect(Number((await db.query('SELECT count(*)::int AS n FROM public.credit_cost_config')).rows[0].n)).toBe(before - 1);
    });
  });

  it('rollback REFUSES while a weekly row exists', async () => {
    await inRollback(async () => {
      const co = (await db.query(`SELECT id FROM public.companies LIMIT 1`)).rows[0]?.id;
      if (!co) {
        // No company in the replay DB: assert the refusal guard textually instead (it is the first statement).
        expect(ROLLBACK).toMatch(/IF EXISTS \(SELECT 1 FROM public\.market_pulse_automation_settings WHERE cadence = 'weekly'\)/);
        return;
      }
      await db.query(
        `INSERT INTO public.market_pulse_automation_settings (company_id, cadence, objective, region_scope, competitor_scope)
         VALUES ($1, 'weekly', 'growth', 'profile_markets', 'combined')
         ON CONFLICT (company_id) DO UPDATE SET cadence = 'weekly'`, [co]);
      expect(await attempt(ROLLBACK)).toMatch(/055 rollback refused/);
    });
  });
});
