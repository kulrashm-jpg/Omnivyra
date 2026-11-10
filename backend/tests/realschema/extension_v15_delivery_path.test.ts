/**
 * U1 on real PostgreSQL (migration 20270207000002, EXTENSION-1.5.0-CONTRACT.md §4):
 * the database marks an approved LinkedIn reply/like v15-only at creation when its
 * target is in a thread collected by extension 1.5, and no later UPDATE (by a caller
 * or by a re-ingestion of the thread) can set or clear the mark.
 */
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { db, inRollback, ORG_A, seedTenants } from './setup';
import { openTenant, approvedAction } from './helpers/c3ClaimFixtures';

async function threadWithTarget(ingestedVia: string): Promise<{ target: string; thread: string }> {
  const target = `urn:li:comment:(activity:8${Date.now() % 1e9},${Math.floor(Math.random() * 1e9)})`;
  const thread = randomUUID();
  await db.query(`INSERT INTO public.engagement_threads (id, organization_id, platform, platform_thread_id, raw_payload)
                  VALUES ($1, $2, 'linkedin', $3, $4::jsonb)`,
    [thread, ORG_A, `urn:li:activity:${thread}`, JSON.stringify({ ingested_via: ingestedVia, post_author_urn: 'urn:li:fsd_profile:ACoAAu1Member0001' })]);
  await db.query(`INSERT INTO public.engagement_messages (thread_id, organization_id, platform, platform_message_id, content)
                  VALUES ($1, $2, 'linkedin', $3, 'a comment')`, [thread, ORG_A, target]);
  return { target, thread };
}
const mark = async (id: string) =>
  (await db.query(`SELECT delivery_path FROM public.community_ai_actions WHERE id = $1`, [id])).rows[0].delivery_path as string | null;

beforeAll(async () => { await seedTenants(); });

describe('community_ai_actions.delivery_path (U1)', () => {
  it.each(['reply', 'like'])('a %s on a 1.5-collected thread is marked at creation', (actionType) => inRollback(async () => {
    await openTenant(db, ORG_A);
    const { target } = await threadWithTarget('extension_v15');
    const { id } = await approvedAction(db, { org: ORG_A, status: 'pending', executionMode: 'browser', targetId: target, actionType });
    expect(await mark(id)).toBe('extension_v15');
  }));

  it.each([
    ['a thread collected by 1.4', 'extension_comments'],
  ])('a reply on %s is not marked (1.4 keeps it)', (_n, via) => inRollback(async () => {
    await openTenant(db, ORG_A);
    const { target } = await threadWithTarget(via);
    const { id } = await approvedAction(db, { org: ORG_A, status: 'pending', executionMode: 'browser', targetId: target });
    expect(await mark(id)).toBeNull();
  }));

  it('a target with no ingested message is not marked', () => inRollback(async () => {
    await openTenant(db, ORG_A);
    const { id } = await approvedAction(db, { org: ORG_A, status: 'pending', executionMode: 'browser', targetId: 'urn:li:comment:(activity:1,404)' });
    expect(await mark(id)).toBeNull();
  }));

  it('the mark is sticky: an UPDATE cannot clear it, and a re-ingestion of the thread by 1.4 does not unmark it', () => inRollback(async () => {
    await openTenant(db, ORG_A);
    const { target, thread } = await threadWithTarget('extension_v15');
    const { id } = await approvedAction(db, { org: ORG_A, status: 'pending', executionMode: 'browser', targetId: target });
    await db.query(`UPDATE public.community_ai_actions SET delivery_path = NULL WHERE id = $1`, [id]);
    expect(await mark(id)).toBe('extension_v15');
    await db.query(`UPDATE public.engagement_threads SET raw_payload = '{"ingested_via":"extension_comments"}'::jsonb WHERE id = $1`, [thread]);
    await db.query(`UPDATE public.community_ai_actions SET updated_at = now() WHERE id = $1`, [id]);
    expect(await mark(id)).toBe('extension_v15');
  }));

  it('an UPDATE cannot set the mark on an unmarked row', () => inRollback(async () => {
    await openTenant(db, ORG_A);
    const { id } = await approvedAction(db, { org: ORG_A, status: 'pending', executionMode: 'browser', targetId: 'urn:li:comment:(activity:1,405)' });
    await db.query(`UPDATE public.community_ai_actions SET delivery_path = 'extension_v15' WHERE id = $1`, [id]);
    expect(await mark(id)).toBeNull();
  }));

  it('client roles cannot execute either function; both are SECURITY DEFINER with a pinned search_path', async () => {
    const { rows } = await db.query(`
      SELECT p.oid::regprocedure::text AS fn, p.prosecdef, p.proconfig,
             has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_x,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_x
        FROM pg_proc p
       WHERE p.oid IN (to_regprocedure('public.community_ai_action_v15_delivery_path(uuid,text,text,text)'),
                       to_regprocedure('public.community_ai_actions_set_delivery_path()'))`);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r).toMatchObject({ prosecdef: true, proconfig: ['search_path=public, pg_temp'], anon_x: false, auth_x: false });
    }
  });

  it('the rollback (BEGIN/COMMIT stripped, run inside a rolled-back transaction) removes every object and restores the 000001 submit gate; its postcondition passes', () => inRollback(async () => {
    const sql = readFileSync(join(__dirname, '../../../supabase/migrations/rollbacks/extension_v15_delivery_path_rollback.sql'), 'utf8')
      .split('\n').filter((l) => !/^(BEGIN|COMMIT);\s*$/.test(l)).join('\n');
    await db.query(sql);
    const { rows } = await db.query(`SELECT
        EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.community_ai_actions'::regclass AND attname = 'delivery_path' AND NOT attisdropped) AS col,
        position('NOT_V15_DELIVERY' IN (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.authorize_extension_submit(uuid,uuid,text,text,uuid,text,text)'))) AS mark_check`);
    expect(rows[0]).toEqual({ col: false, mark_check: 0 });
  }));
});
