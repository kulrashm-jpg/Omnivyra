/**
 * CLASS-2 (e9 sweep, D5/D7): updateScheduledPostOnFailure can be pinned to the writer's OWN claim
 * code (expectedErrorCode, with expectedFromStatus), so a run whose claim was taken over writes
 * nothing over the new holder. The real function over the fake database.
 */
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: (t: string) => require('../helpers/fakeWhatsappDb').fakeTable(t) },
}));

import { fakeDb, resetFakeDb } from '../helpers/fakeWhatsappDb';
import { updateScheduledPostOnFailure } from '../../db/queries';

const post = () => fakeDb.tables.scheduled_posts[0];
beforeEach(() => resetFakeDb({ scheduled_posts: [{ id: 'sp-1', status: 'publishing', error_code: 'PUBLISH_CLAIMED:mine' }], daily_content_plans: [] }));

it('NEGATIVE CONTROL: still my claim -> failed with the code, applied', async () => {
  expect(await updateScheduledPostOnFailure('sp-1', 'bad media', 'publishing', 'PUBLISH_MEDIA_REVALIDATION_FAILED', 'PUBLISH_CLAIMED:mine'))
    .toEqual({ applied: true });
  expect(post()).toMatchObject({ status: 'failed', error_code: 'PUBLISH_MEDIA_REVALIDATION_FAILED' });
});

it.each([
  ['another run claimed it', 'PUBLISH_CLAIMED:theirs'],
  ['another run has started the platform call', 'PUBLISH_CALL_STARTED'],
])('%s -> nothing written, cas_mismatch', async (_l, theirs) => {
  post().error_code = theirs;
  expect(await updateScheduledPostOnFailure('sp-1', 'bad media', 'publishing', 'PUBLISH_MEDIA_REVALIDATION_FAILED', 'PUBLISH_CLAIMED:mine'))
    .toEqual({ applied: false, reason: 'cas_mismatch' });
  expect(post()).toMatchObject({ status: 'publishing', error_code: theirs });
});

it('a claim pin without a status compare-and-set is refused (it would be a blind write wearing a fence)', async () => {
  await expect(updateScheduledPostOnFailure('sp-1', 'x', undefined, 'C', 'PUBLISH_CLAIMED:mine')).rejects.toThrow('requires expectedFromStatus');
  expect(post().status).toBe('publishing');
});
