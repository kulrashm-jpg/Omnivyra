/**
 * CLASS-2 D9 (e9 sweep): reconciling an uncertain publish as PUBLISHED takes two writes (the CAS
 * on the exact uncertain state, then the shared published writer). Between them the row used to be
 * `failed` + error_code NULL + no platform_post_id - CLAIMABLE - so a concurrent Publish now or
 * queue retry could publish a post the operator had just confirmed is live. It now stays
 * PUBLISH_OUTCOME_UNCERTAIN (never claimable) until the published write lands.
 * The real reconcileUncertainPublish and queries over the fake database; authority is not the
 * subject here and is granted.
 */
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: (t: string) => require('../helpers/fakeWhatsappDb').fakeTable(t) },
}));
jest.mock('../../security/platformWriteAuthority', () => ({ hasPlatformWriteAuthority: () => true }));

import { failNext, fakeDb, resetFakeDb, type Row } from '../helpers/fakeWhatsappDb';
import { reconcileUncertainPublish } from '../../services/publishOutcomeReconciliation';
import { publishOutcomeBlocksAttempt } from '../../queue/publishOutcome';
import { PUBLISH_OUTCOME_UNCERTAIN } from '../../queue/publishRetryState';

const post = (): Row => fakeDb.tables.scheduled_posts[0];
const actor = { userId: 'admin-1', organizations: [], legacyCookieSuperAdmin: false } as never;
const input = (resolution: 'published' | 'not_published') => ({
  scheduledPostId: 'sp-1', resolution, note: 'checked on the platform', platformPostId: resolution === 'published' ? 'li-123' : '', postUrl: 'https://x/li-123', actor,
});

beforeEach(() => {
  resetFakeDb({
    scheduled_posts: [{ id: 'sp-1', status: 'failed', error_code: PUBLISH_OUTCOME_UNCERTAIN, platform_post_id: null, error_message: 'swept' }],
    daily_content_plans: [],
  });
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

it('between the two writes of a PUBLISHED reconciliation the post is never claimable', async () => {
  const seen: Row[] = [];
  const mod = require('../helpers/fakeWhatsappDb');
  const real = mod.fakeTable;
  jest.spyOn(mod, 'fakeTable').mockImplementation((t: unknown) => {
    // The moment the second write is about to be built: what a concurrent claimant would read.
    if (t === 'scheduled_posts' && fakeDb.calls.filter((c: string) => c === 'scheduled_posts:update').length === 1 && seen.length === 0) seen.push({ ...post() });
    return real(t);
  });
  const r = await reconcileUncertainPublish(input('published'));
  expect(r).toMatchObject({ status: 'reconciled', resolution: 'published' });
  expect(seen).toHaveLength(1);
  expect(seen[0].error_code).toBe(PUBLISH_OUTCOME_UNCERTAIN);
  expect(publishOutcomeBlocksAttempt(seen[0] as never)).toBe('uncertain');
  expect(post()).toMatchObject({ status: 'published', platform_post_id: 'li-123', error_code: null });
});

it('the published write does not land: the post is STILL awaiting reconciliation (uncertain), not claimable', async () => {
  failNext('scheduled_posts', 'update', 1); // the first write lands; the second errors
  await expect(reconcileUncertainPublish(input('published'))).rejects.toThrow();
  expect(post()).toMatchObject({ status: 'failed', error_code: PUBLISH_OUTCOME_UNCERTAIN, platform_post_id: null });
  expect(publishOutcomeBlocksAttempt(post() as never)).toBe('uncertain');
});

it('NEGATIVE CONTROL: NOT published -> one write, the reconciled-not-published code (retryable by the operator)', async () => {
  expect(await reconcileUncertainPublish(input('not_published'))).toMatchObject({ status: 'reconciled', resolution: 'not_published' });
  expect(post()).toMatchObject({ status: 'failed', error_code: 'PUBLISH_RECONCILED_NOT_PUBLISHED' });
});
