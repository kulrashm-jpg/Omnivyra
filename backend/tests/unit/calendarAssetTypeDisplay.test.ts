/**
 * Regression coverage for the calendar content-type renderer fix.
 *
 * The bug this guards against: `scheduled_posts.content_type` stores the
 * platform-native value (`tweet`, `feed_post`, `post`, `pin`, ...) because
 * the DB constraint `chk_content_type` requires per-platform tokens. The
 * calendar must instead display the user-selected canonical asset
 * (`poll`, `article`, `story`, `carousel`, `reel`, ...) when one is
 * available on the event payload as `asset_type`. Every calendar surface
 * (modal, week strip, day-cell tile, day-detail card) goes through the
 * same helper, so testing the helper covers all four surfaces.
 */

import {
  resolveDisplayContentType,
  resolveDisplayContentTypeLabel,
} from '../../../lib/calendar/assetTypeDisplay';

describe('calendar asset_type rendering', () => {
  describe('asset_type wins over platform-native content_type', () => {
    test.each([
      // [label, asset_type, content_type, expectedToken, expectedLabel]
      ['poll on X (DB has tweet)',      'poll',     'tweet',     'poll',      'poll'],
      ['article on LinkedIn',           'article',  'article',   'article',   'article'],
      ['story on Instagram',            'story',    'story',     'story',     'story'],
      ['post on Facebook',              'post',     'post',      'post',      'post'],
      ['carousel on Instagram (DB feed_post)', 'carousel', 'feed_post', 'carousel', 'carousel'],
      ['reel on Instagram (DB reel)',   'reel',     'reel',      'reel',      'reel'],
      ['poll on LinkedIn (DB post)',    'poll',     'post',      'poll',      'poll'],
      ['article on X (DB tweet)',       'article',  'tweet',     'article',   'article'],
      ['short_story → token underscored, label spaced', 'short_story', 'tweet', 'short_story', 'short story'],
    ])('%s', (_label, asset_type, content_type, expectedToken, expectedLabel) => {
      const event = { asset_type, content_type };
      expect(resolveDisplayContentType(event)).toBe(expectedToken);
      expect(resolveDisplayContentTypeLabel(event)).toBe(expectedLabel);
    });
  });

  describe('falls back to content_type when asset_type missing', () => {
    test('standalone scheduled post on X has no daily_content_plans row', () => {
      const event = { content_type: 'tweet' }; // asset_type undefined
      expect(resolveDisplayContentType(event)).toBe('tweet');
      expect(resolveDisplayContentTypeLabel(event)).toBe('tweet');
    });

    test('legacy event with empty-string asset_type still falls back', () => {
      const event = { asset_type: '', content_type: 'feed_post' };
      expect(resolveDisplayContentType(event)).toBe('feed_post');
      expect(resolveDisplayContentTypeLabel(event)).toBe('feed post');
    });

    test('whitespace-only asset_type is ignored', () => {
      const event = { asset_type: '   ', content_type: 'pin' };
      expect(resolveDisplayContentType(event)).toBe('pin');
      expect(resolveDisplayContentTypeLabel(event)).toBe('pin');
    });

    test('null asset_type falls back to content_type', () => {
      const event = { asset_type: null, content_type: 'video' };
      expect(resolveDisplayContentType(event)).toBe('video');
      expect(resolveDisplayContentTypeLabel(event)).toBe('video');
    });
  });

  describe('final default to "post"', () => {
    test('both fields missing yields "post"', () => {
      expect(resolveDisplayContentType({})).toBe('post');
      expect(resolveDisplayContentTypeLabel({})).toBe('post');
    });

    test('both fields empty strings yields "post"', () => {
      expect(resolveDisplayContentType({ asset_type: '', content_type: '' })).toBe('post');
      expect(resolveDisplayContentTypeLabel({ asset_type: '', content_type: '' })).toBe('post');
    });

    test('both fields null yields "post"', () => {
      expect(
        resolveDisplayContentType({ asset_type: null, content_type: null }),
      ).toBe('post');
      expect(
        resolveDisplayContentTypeLabel({ asset_type: null, content_type: null }),
      ).toBe('post');
    });
  });

  describe('normalization', () => {
    test('lower-cases mixed-case input', () => {
      expect(resolveDisplayContentType({ asset_type: 'Poll' })).toBe('poll');
      expect(resolveDisplayContentType({ asset_type: 'ARTICLE' })).toBe('article');
    });

    test('hyphens become underscores in the token form', () => {
      expect(resolveDisplayContentType({ asset_type: 'short-story' })).toBe('short_story');
    });

    test('label form spaces both hyphens and underscores', () => {
      expect(resolveDisplayContentTypeLabel({ asset_type: 'short_story' })).toBe('short story');
      expect(resolveDisplayContentTypeLabel({ asset_type: 'feed-post' })).toBe('feed post');
    });

    test('idempotent on already-clean values', () => {
      expect(resolveDisplayContentType({ asset_type: 'reel' })).toBe('reel');
      expect(resolveDisplayContentTypeLabel({ asset_type: 'reel' })).toBe('reel');
    });
  });

  describe('regression: every platform mapping that previously collapsed to "post"', () => {
    // Pre-fix: BOLT schedule processor mapped these user-selected asset types
    // to platform-native values that all rendered as "post" / "tweet" /
    // "feed_post" / "pin". The helper must preserve the user-selected token.
    const cases = [
      { platform: 'linkedin', asset: 'poll',     native: 'post' },
      { platform: 'linkedin', asset: 'carousel', native: 'post' },
      { platform: 'linkedin', asset: 'image',    native: 'post' },
      { platform: 'linkedin', asset: 'story',    native: 'post' },
      { platform: 'x',        asset: 'article',  native: 'tweet' },
      { platform: 'x',        asset: 'poll',     native: 'tweet' },
      { platform: 'x',        asset: 'story',    native: 'tweet' },
      { platform: 'facebook', asset: 'poll',     native: 'post' },
      { platform: 'facebook', asset: 'carousel', native: 'post' },
      { platform: 'instagram',asset: 'poll',     native: 'feed_post' },
      { platform: 'instagram',asset: 'article',  native: 'feed_post' },
      { platform: 'pinterest',asset: 'video',    native: 'pin' },
    ];
    test.each(cases)(
      '$platform $asset (DB $native) renders as $asset',
      ({ asset, native }) => {
        const event = { asset_type: asset, content_type: native };
        expect(resolveDisplayContentType(event)).toBe(asset);
        expect(resolveDisplayContentTypeLabel(event)).toBe(asset);
      },
    );
  });
});
