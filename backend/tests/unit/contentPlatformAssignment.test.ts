/**
 * Phase 6G-1 — content↔platform assignment authority tests.
 *
 * The authority derives from PLATFORM_CAPABILITY_REGISTRY + normalizeContentCapability
 * + FORMAT_EXCLUSIVE_PLATFORMS (the same pair the publisher uses), so planning-time
 * and publish-time agree. Fail-closed for unresolvable capabilities (podcast/audio).
 */

import {
  getSupportedPlatformsForFormat,
  getSupportedFormatsForPlatform,
  isValidPlatformFormatPair,
  filterPlatformsForFormat,
} from '@/lib/shared/bolt/contentPlatformAssignment';

describe('6G-1 — invalid pairs rejected', () => {
  test('carousel → youtube rejected', () => {
    expect(isValidPlatformFormatPair('youtube', 'carousel')).toBe(false);
  });
  test('infographic → youtube rejected', () => {
    expect(isValidPlatformFormatPair('youtube', 'infographic')).toBe(false);
  });
  test('podcast → image-only platform (pinterest) rejected (no audio capability)', () => {
    expect(isValidPlatformFormatPair('pinterest', 'podcast')).toBe(false);
    expect(getSupportedPlatformsForFormat('podcast')).toEqual([]); // fail-closed everywhere
  });
  test('tweet → linkedin rejected (X-exclusive)', () => {
    expect(isValidPlatformFormatPair('linkedin', 'tweet')).toBe(false);
  });
});

describe('6G-1 — valid pairs allowed', () => {
  test('video → youtube allowed', () => {
    expect(isValidPlatformFormatPair('youtube', 'video')).toBe(true);
  });
  test('video → linkedin allowed', () => {
    expect(isValidPlatformFormatPair('linkedin', 'video')).toBe(true);
  });
  test('carousel → linkedin allowed', () => {
    expect(isValidPlatformFormatPair('linkedin', 'carousel')).toBe(true);
  });
});

describe('6G-1 — getSupportedPlatformsForFormat (derived)', () => {
  test('tweet → x only (FORMAT_EXCLUSIVE intersected with capability)', () => {
    expect(getSupportedPlatformsForFormat('tweet')).toEqual(['x']);
  });
  test('carousel → linkedin/facebook/instagram/pinterest, NOT youtube', () => {
    const p = getSupportedPlatformsForFormat('carousel');
    expect(p).toEqual(expect.arrayContaining(['linkedin', 'facebook', 'instagram', 'pinterest']));
    expect(p).not.toContain('youtube');
    expect(p).not.toContain('x');
  });
  test('video → includes youtube + linkedin', () => {
    const p = getSupportedPlatformsForFormat('video');
    expect(p).toEqual(expect.arrayContaining(['youtube', 'linkedin', 'instagram']));
  });
});

describe('6G-1 — getSupportedFormatsForPlatform (derived)', () => {
  test('youtube supports video, NOT carousel / infographic', () => {
    const f = getSupportedFormatsForPlatform('youtube');
    expect(f).toContain('video');
    expect(f).not.toContain('carousel');
    expect(f).not.toContain('infographic');
  });
  test('linkedin supports carousel + video + image + post, NOT tweet', () => {
    const f = getSupportedFormatsForPlatform('linkedin');
    expect(f).toEqual(expect.arrayContaining(['carousel', 'video', 'image', 'post']));
    expect(f).not.toContain('tweet'); // tweet is X-exclusive
  });
});

describe('6G-1 — filterPlatformsForFormat: never expands eligibility, preserves order', () => {
  test('prioritization order preserved; incompatible dropped (membership ⊆ input)', () => {
    // Simulate a 6D-C/6D-D pre-ordered list for carousel.
    const ordered = ['youtube', 'linkedin', 'x', 'pinterest'];
    const out = filterPlatformsForFormat(ordered, 'carousel');
    expect(out).toEqual(['linkedin', 'pinterest']); // order preserved, youtube/x dropped
    for (const p of out) expect(ordered).toContain(p); // never added
  });
  test('no-capability format (podcast) → empty filter result', () => {
    expect(filterPlatformsForFormat(['linkedin', 'youtube'], 'podcast')).toEqual([]);
  });
  test('valid-only input is returned unchanged (in order)', () => {
    expect(filterPlatformsForFormat(['linkedin', 'instagram'], 'carousel')).toEqual(['linkedin', 'instagram']);
  });
});
