/**
 * CLASS-2 (e9 sweep): appending a reconciliation snapshot to scheduled_posts.creator_attachment_metadata
 * is a compare-and-set on updated_at, retried on a miss - not a blind read-modify-write of the whole
 * JSONB value. And an unreadable row, or a column that holds an ARRAY, is never overwritten.
 * The real appendReconciliationSnapshot over the fake database.
 */
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: (t: string) => require('../helpers/fakeWhatsappDb').fakeTable(t) },
}));

import { failNext, fakeDb, resetFakeDb, type Row } from '../helpers/fakeWhatsappDb';
import { appendReconciliationSnapshot } from '../../services/providerReconciliation/snapshots';

const snap = (n: number) => ({ at: `2026-11-12T10:0${n}:00.000Z`, outcome: `o${n}` }) as never;
const post = (): Row => fakeDb.tables.scheduled_posts[0];
const seed = (metadata: unknown) => resetFakeDb({ scheduled_posts: [{ id: 'sp-1', creator_attachment_metadata: metadata, updated_at: '2026-11-12T09:00:00.000Z' }] });

beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => undefined));
afterEach(() => jest.restoreAllMocks());

it('NEGATIVE CONTROL: an append keeps the other sub-keys and adds the snapshot', async () => {
  seed({ provider_asset_urns: { linkedin: 'urn:li:1' } });
  await appendReconciliationSnapshot('sp-1', snap(1));
  expect(post().creator_attachment_metadata).toEqual({ provider_asset_urns: { linkedin: 'urn:li:1' }, reconciliation_snapshots: [snap(1)] });
});

it('another writer changed the row between the read and the write: re-read and re-applied - its change is NOT lost', async () => {
  seed({ reconciliation_snapshots: [snap(1)] });
  const mod = require('../helpers/fakeWhatsappDb');
  const real = mod.fakeTable;
  let interfered = false;
  jest.spyOn(mod, 'fakeTable').mockImplementation((t: unknown) => {
    if (!interfered && fakeDb.calls.filter((c: string) => c === 'scheduled_posts:select').length === 1) {
      interfered = true; // a concurrent append (and a URN cache write) land first
      Object.assign(post(), {
        creator_attachment_metadata: { reconciliation_snapshots: [snap(1), snap(2)], provider_asset_urns: { linkedin: 'urn:li:9' } },
        updated_at: '2026-11-12T09:30:00.000Z',
      });
    }
    return real(t);
  });
  await appendReconciliationSnapshot('sp-1', snap(3));
  expect(post().creator_attachment_metadata).toEqual({ reconciliation_snapshots: [snap(1), snap(2), snap(3)], provider_asset_urns: { linkedin: 'urn:li:9' } });
});

it('the row is UNREADABLE: nothing is written (it used to replace the whole column with just the snapshot)', async () => {
  seed({ provider_asset_urns: { linkedin: 'urn:li:1' } });
  failNext('scheduled_posts', 'select');
  await appendReconciliationSnapshot('sp-1', snap(1));
  expect(post().creator_attachment_metadata).toEqual({ provider_asset_urns: { linkedin: 'urn:li:1' } });
  expect(fakeDb.calls).not.toContain('scheduled_posts:update');
});

it('the column holds an ARRAY (creator attachments): never rewritten as an object', async () => {
  const attachments = [{ campaign_id: 'c1', platform: 'linkedin' }];
  seed(attachments);
  await appendReconciliationSnapshot('sp-1', snap(1));
  expect(post().creator_attachment_metadata).toEqual(attachments);
});
