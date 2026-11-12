/**
 * CLASS-2 C3 (e9 sweep): a confirmed outbound DM supersedes the OTHER pending DMs to the same
 * person - but never one the extension holds under a dispatch lease. That one is being sent right
 * now: superseding it could not stop the send, it only made the send's own result fail
 * LEASE_MISMATCH, so a delivered DM was recorded as failed.
 * The real mirrorOutboundDmAction over the fake database.
 */
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => require('../helpers/fakeWhatsappDb').fakeTable(t),
}));
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: (t: string) => require('../helpers/fakeWhatsappDb').fakeTable(t) },
}));

import { fakeDb, resetFakeDb, type Row } from '../helpers/fakeWhatsappDb';
import { mirrorOutboundDmAction } from '../../services/engagementOutboundMirrorService';

const TARGET = 'https://www.linkedin.com/in/jane';
const action = (id: string): Row => fakeDb.tables.community_ai_actions.find((a) => a.id === id)!;
const dm = (id: string, over: Row = {}): Row => ({
  id, organization_id: 'co-a', platform: 'linkedin', action_type: 'dm', status: 'pending', target_id: TARGET,
  dispatch_lease_id: null, dispatch_lease_holder_id: null, dispatch_lease_expires_at: null, ...over,
});

beforeEach(() => {
  resetFakeDb({
    engagement_threads: [{ id: 'th-1', organization_id: 'co-a', platform: 'linkedin', platform_thread_id: TARGET, raw_payload: {}, updated_at: '2026-11-12T09:00:00.000Z' }],
    engagement_messages: [],
    community_ai_actions: [dm('a-free'), dm('a-leased', { dispatch_lease_id: 'L1', dispatch_lease_holder_id: 'ext-1', dispatch_lease_expires_at: '2099-01-01T00:00:00.000Z' })],
  });
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

it('the leased DM (in flight to the extension) is NOT superseded; the unleased one is', async () => {
  const r = await mirrorOutboundDmAction({ organizationId: 'co-a', actionId: 'a-sent', platform: 'linkedin', targetId: TARGET, text: 'Hi Jane', confirmed: true });
  expect(r.mirrored).toBe(true);
  expect(action('a-free')).toMatchObject({ status: 'failed' });
  expect(action('a-leased')).toMatchObject({ status: 'pending', dispatch_lease_id: 'L1' });
});
