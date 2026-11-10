/**
 * The own-content rule for 1.5 comment collection (EXTENSION-1.5.0-CONTRACT.md §5.1, E-3),
 * and the default state of the 1.5 ingestion switch.
 */
import { mapOwnPostComments, MAX_ITEMS_PER_RESULT } from '../../services/extension15/ownContent';
import { EXTENSION_V15_COMMAND_INGESTION_ENABLED, EXTENSION_BROWSER_INGESTION_SUSPENDED } from '../../services/extensionIngestionSuspension';

const ME = 'urn:li:fsd_profile:ACoAAme0001';
const OTHER = 'urn:li:fsd_profile:ACoAAother1';
const item = (over: Record<string, unknown> = {}) => ({
  post_urn: 'urn:li:activity:7001',
  post_author_urn: ME,
  comment_urn: 'urn:li:comment:(activity:7001,8001)',
  author_urn: OTHER,
  author_name: 'A Person',
  text: 'Great post',
  created_at: '2026-11-10T10:00:00.000Z',
  ...over,
});

describe('own-content rule', () => {
  it('keeps comments on the bound member own posts; drops other authors posts; counts both', () => {
    const r = mapOwnPostComments([item(), item({ post_urn: 'urn:li:activity:7002', post_author_urn: OTHER, comment_urn: 'c2' })], ME, {});
    expect(r).toMatchObject({ ok: true, rejectedNotOwn: 1, rejectedInvalid: 0 });
    if (r.ok !== true) throw new Error();
    expect(r.comments).toHaveLength(1);
    expect(r.comments[0]).toMatchObject({ post_urn: 'urn:li:activity:7001', actor_id: OTHER, author_self: false, content: 'Great post', source: 'extension_v15' });
    expect(r.posts).toEqual([{ post_urn: 'urn:li:activity:7001' }]);
  });
  it('the member own reply on their own post is kept and marked self', () => {
    const r = mapOwnPostComments([item({ author_urn: ME })], ME, {});
    if (r.ok !== true) throw new Error();
    expect(r.comments[0].author_self).toBe(true);
  });
  it('when the command named posts, a post outside that list is dropped even if own', () => {
    const r = mapOwnPostComments([item(), item({ post_urn: 'urn:li:activity:7009', comment_urn: 'c9' })], ME, { post_urns: ['urn:li:activity:7001'] });
    expect(r).toMatchObject({ ok: true, rejectedNotOwn: 1 });
  });
  it.each([
    ['missing post author', { post_author_urn: undefined }],
    ['missing text', { text: '' }],
    ['not a urn', { post_urn: 'https://www.linkedin.com/feed/update/1' }],
    ['missing comment urn', { comment_urn: undefined }],
    ['oversized text', { text: 'x'.repeat(20001) }],
  ])('drops an invalid item: %s', (_n, over) => {
    expect(mapOwnPostComments([item(over)], ME, {})).toMatchObject({ ok: true, rejectedInvalid: 1, comments: [] });
  });
  it('refuses a non-array and more than the cap', () => {
    expect(mapOwnPostComments('x', ME, {})).toMatchObject({ ok: false, code: 'ITEMS_REQUIRED' });
    expect(mapOwnPostComments(Array.from({ length: MAX_ITEMS_PER_RESULT + 1 }, () => item()), ME, {})).toMatchObject({ ok: false, status: 413 });
  });
});

describe('switch defaults', () => {
  it('1.4 browser ingestion stays suspended and 1.5 ingestion ships OFF', () => {
    expect(EXTENSION_BROWSER_INGESTION_SUSPENDED).toBe(true);
    expect(EXTENSION_V15_COMMAND_INGESTION_ENABLED).toBe(false);
  });
});
