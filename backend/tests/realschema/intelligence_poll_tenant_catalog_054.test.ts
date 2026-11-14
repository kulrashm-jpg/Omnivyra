/**
 * Real-schema cover for 20270217000054 (e1; e9 + owner ruling 2026-11-14; pricing hold). After the full replay:
 *   - credit_cost_config holds exactly the ruled row: intelligence_poll_tenant = 1 credit, low, INTELLIGENCE_SCAN;
 *   - NO active action_pricing_config row exists for it (that would make resolveActivityCreditRange token-priced);
 *   - the rollback deletes exactly that row and nothing else, and leaves a differently configured row alone.
 * Disposable replay DB only (refuses a non-loopback W6_DB_URL); every mutation runs inside inRollback.
 */
import * as fs from 'fs';
import * as path from 'path';
import { db, inRollback } from './setup';

const URL = process.env.W6_DB_URL ?? '';
if (!/@(127\.0\.0\.1|localhost|\[::1\]):\d+\//.test(URL)) throw new Error('intelligence_poll_tenant_catalog_054 refuses a non-loopback W6_DB_URL');

const ROLLBACK = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/rollbacks/intelligence_poll_tenant_catalog_row_rollback.sql'), 'utf8');
const row = async () => (await db.query(
  `SELECT credits, category, smart_dedup_seconds, activity_class, description
     FROM public.credit_cost_config WHERE action_type = 'intelligence_poll_tenant'`)).rows;
const total = async () => Number((await db.query('SELECT count(*)::int AS n FROM public.credit_cost_config')).rows[0].n);

describe('20270217000054 intelligence_poll_tenant catalog row', () => {
  it('the ruled row exists exactly once: 1 credit per source per day, low, INTELLIGENCE_SCAN', async () => {
    expect(await row()).toEqual([{
      credits: 1, category: 'low', smart_dedup_seconds: 0, activity_class: 'INTELLIGENCE_SCAN',
      description: 'Tenant-owned source check, per source per day (20270217000054)',
    }]);
  });

  it('no active action_pricing_config row (the preview must stay fixed-fee, not token-priced)', async () => {
    const { rows } = await db.query(
      `SELECT 1 FROM public.action_pricing_config WHERE action_key = 'intelligence_poll_tenant' AND is_active`);
    expect(rows).toEqual([]);
  });

  it('rollback deletes exactly the 054 row and nothing else', async () => {
    await inRollback(async () => {
      const before = await total();
      await db.query(ROLLBACK);
      expect(await row()).toEqual([]);
      expect(await total()).toBe(before - 1);
    });
  });

  it('rollback leaves a differently configured intelligence_poll_tenant row alone (marker match, not key match)', async () => {
    await inRollback(async () => {
      await db.query(`UPDATE public.credit_cost_config SET description = 'operator-edited' WHERE action_type = 'intelligence_poll_tenant'`);
      const before = await total();
      await db.query(ROLLBACK);
      expect(await total()).toBe(before);
      expect((await row())[0]).toMatchObject({ description: 'operator-edited' });
    });
  });
});
