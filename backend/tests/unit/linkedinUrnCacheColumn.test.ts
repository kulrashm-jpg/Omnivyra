/**
 * Owner ruling via e9 (2026-11-12): scheduled_posts.creator_attachment_metadata is canonically a JSONB
 * ARRAY of creator attachments (attribution reads it as one). The LinkedIn URN cache wrote an object
 * sub-key INTO it - spreading the array into an object and destroying the attachments. The cache now
 * lives in its own column, provider_asset_urns, written by compare-and-set on updated_at.
 * The real cache functions over the fake database.
 */
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: (t: string) => require('../helpers/fakeWhatsappDb').fakeTable(t) },
}));

import { fakeDb, failNext, resetFakeDb, type Row } from '../helpers/fakeWhatsappDb';
import { __urnCacheForTests } from '../../adapters/linkedin/linkedinMediaUpload';

const { readUrnCache, writeUrnCache } = __urnCacheForTests;
const ATTACHMENTS = [{ campaign_id: 'c1', platform: 'linkedin', variant: { headline: 'H' } }];
const post = (): Row => fakeDb.tables.scheduled_posts[0];
const seed = (over: Row = {}) => resetFakeDb({ scheduled_posts: [{ id: 'sp-1', creator_attachment_metadata: ATTACHMENTS, provider_asset_urns: null, updated_at: '2026-11-12T09:00:00.000Z', ...over }] });

it('a URN write leaves the creator attachments (the ARRAY) untouched, and is read back', async () => {
  seed();
  expect(await writeUrnCache('sp-1', 'https://cdn/x.png', 'urn:li:digitalmediaAsset:1')).toEqual({ ok: true });
  expect(post().creator_attachment_metadata).toEqual(ATTACHMENTS);
  expect(await readUrnCache('sp-1', 'https://cdn/x.png')).toBe('urn:li:digitalmediaAsset:1');
});

it('two media of one post cached concurrently: neither URN is lost (CAS on updated_at, re-read)', async () => {
  seed();
  const mod = require('../helpers/fakeWhatsappDb');
  const real = mod.fakeTable;
  let interfered = false;
  jest.spyOn(mod, 'fakeTable').mockImplementation((t: unknown) => {
    if (!interfered && fakeDb.calls.filter((c: string) => c === 'scheduled_posts:select').length === 1) {
      interfered = true; // the other upload's URN lands between this one's read and write
      Object.assign(post(), { provider_asset_urns: { linkedin: { 'https://cdn/y.mp4': 'urn:li:digitalmediaAsset:2' } }, updated_at: '2026-11-12T09:30:00.000Z' });
    }
    return real(t);
  });
  expect(await writeUrnCache('sp-1', 'https://cdn/x.png', 'urn:li:digitalmediaAsset:1')).toEqual({ ok: true });
  jest.restoreAllMocks();
  expect(post().provider_asset_urns).toEqual({ linkedin: { 'https://cdn/y.mp4': 'urn:li:digitalmediaAsset:2', 'https://cdn/x.png': 'urn:li:digitalmediaAsset:1' } });
});

it('an unreadable row writes nothing (and the caller treats the cache as best-effort)', async () => {
  seed();
  failNext('scheduled_posts', 'select');
  expect((await writeUrnCache('sp-1', 'https://cdn/x.png', 'urn:1')).ok).toBe(false);
  expect(post().provider_asset_urns).toBeNull();
  expect(fakeDb.calls).not.toContain('scheduled_posts:update');
});

it('NEGATIVE CONTROL: a miss reads null (the asset is simply uploaded again)', async () => {
  seed();
  expect(await readUrnCache('sp-1', 'https://cdn/none.png')).toBeNull();
});
