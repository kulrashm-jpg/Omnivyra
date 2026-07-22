/**
 * Tests — Canonical per-platform adaptation profiles (Wave 2 item 6:
 * cross-platform originality).
 *
 * Guards the invariant that eliminated the shared
 * `'Neutral adaptation with clear readability.'` fallback: every listed platform
 * resolves to its OWN materially-distinct profile, so no two platforms can
 * collide on byte-identical style. Threads and youtube_community — the two
 * surfaces the audit flagged as routed to the generic string — must now be
 * present and distinct.
 */

import {
  getPlatformProfile,
  listPlatformProfiles,
  listPlatformKeys,
  type PlatformAdaptationProfile,
} from '../../../lib/content/platformAdaptationProfiles';

const GENERIC_FALLBACK = 'Neutral adaptation with clear readability.';

const LISTED_PLATFORMS = [
  'linkedin',
  'facebook',
  'instagram',
  'x',
  'twitter',
  'threads',
  'pinterest',
  'tiktok',
  'reddit',
  'youtube',
  'youtube_community',
];

describe('platformAdaptationProfiles — resolution', () => {
  test('every listed platform resolves to a real profile', () => {
    for (const platform of LISTED_PLATFORMS) {
      const profile = getPlatformProfile(platform);
      expect(profile).toBeDefined();
      expect(profile.platform).toBe(platform);
      expect(profile.styleDirective.trim().length).toBeGreaterThan(0);
      // Shape completeness.
      expect(typeof profile.hookStyle).toBe('string');
      expect(typeof profile.ctaStyle).toBe('string');
      expect(typeof profile.emojiPolicy).toBe('string');
      expect(typeof profile.formatting).toBe('string');
      expect(profile.wordRange).toHaveLength(2);
      expect(profile.differentiationNote.trim().length).toBeGreaterThan(0);
    }
  });

  test('listPlatformProfiles exposes exactly the listed platforms', () => {
    const keys = listPlatformKeys().sort();
    expect(keys).toEqual([...LISTED_PLATFORMS].sort());
    expect(listPlatformProfiles()).toHaveLength(LISTED_PLATFORMS.length);
  });
});

describe('platformAdaptationProfiles — no collisions', () => {
  test('no two profiles share a styleDirective (materially distinct)', () => {
    const directives = listPlatformProfiles().map((p) => p.styleDirective);
    const unique = new Set(directives);
    expect(unique.size).toBe(directives.length);
  });

  test('no profile uses the legacy generic fallback string', () => {
    for (const profile of listPlatformProfiles()) {
      expect(profile.styleDirective).not.toBe(GENERIC_FALLBACK);
      expect(profile.styleDirective).not.toContain('Neutral adaptation');
    }
  });
});

describe('platformAdaptationProfiles — threads & youtube_community', () => {
  test('threads is present and distinct from x', () => {
    const threads = getPlatformProfile('threads');
    const x = getPlatformProfile('x');
    expect(threads.platform).toBe('threads');
    expect(threads.styleDirective).not.toBe(x.styleDirective);
    expect(threads.styleDirective).not.toBe(GENERIC_FALLBACK);
  });

  test('youtube_community is present and distinct from youtube', () => {
    const community = getPlatformProfile('youtube_community');
    const youtube = getPlatformProfile('youtube');
    expect(community.platform).toBe('youtube_community');
    expect(community.styleDirective).not.toBe(youtube.styleDirective);
    expect(community.styleDirective).not.toBe(GENERIC_FALLBACK);
  });

  test('threads and youtube_community are distinct from each other', () => {
    expect(getPlatformProfile('threads').styleDirective).not.toBe(
      getPlatformProfile('youtube_community').styleDirective,
    );
  });
});

describe('platformAdaptationProfiles — alias normalization', () => {
  test('twitter is the legacy X alias, kept as its own distinct profile', () => {
    const twitter = getPlatformProfile('twitter');
    const x = getPlatformProfile('x');
    expect(twitter.platform).toBe('twitter');
    // Distinct wording (no byte-identical collision) but X-native intent.
    expect(twitter.styleDirective).not.toBe(x.styleDirective);
  });

  test('case, whitespace, and separator variants normalize onto a real profile', () => {
    const variants: Array<[string, string]> = [
      ['  X  ', 'x'],
      ['LinkedIn', 'linkedin'],
      ['YouTube Community', 'youtube_community'],
      ['youtube-community', 'youtube_community'],
      ['youtubecommunity', 'youtube_community'],
      ['IG', 'instagram'],
    ];
    for (const [raw, expected] of variants) {
      expect(getPlatformProfile(raw).platform).toBe(expected);
    }
  });
});

describe('platformAdaptationProfiles — unknown platforms', () => {
  test('getPlatformProfile never returns the generic string for an unknown platform', () => {
    const unknown = getPlatformProfile('some_new_network_42');
    expect(unknown.styleDirective).not.toBe(GENERIC_FALLBACK);
    expect(unknown.styleDirective).not.toContain('Neutral adaptation');
    // Minimal-but-platform-NAMED: the directive references the platform.
    expect(unknown.styleDirective).toContain('some_new_network_42');
    expect(unknown.platform).toBe('some_new_network_42');
  });

  test('empty / null platform still returns a non-generic profile', () => {
    for (const bad of ['', '   ', null, undefined] as Array<string | null | undefined>) {
      const profile: PlatformAdaptationProfile = getPlatformProfile(bad);
      expect(profile.styleDirective).not.toBe(GENERIC_FALLBACK);
      expect(profile.styleDirective).not.toContain('Neutral adaptation');
    }
  });
});
