/**
 * Writer Wave 3 — Deterministic Formatter.
 *
 * Pins the pure/deterministic transforms that move OUT of the AI model:
 *   - trims to platform char limits (PLATFORM_CHAR_LIMITS source of truth)
 *   - formats + places hashtags deterministically (wraps normalizeHashtag)
 *   - normalizes emoji spacing, capitalization, and whitespace
 *   - is idempotent: format(format(x)) === format(x)
 */

// The formatter transitively imports discoverabilityHelpers → the aiGateway
// barrel. Mock it so the pure-formatter tests never touch a live provider/DB.
jest.mock('../../services/aiGateway', () => ({
  generateCampaignPlan: jest.fn(),
  runCompletionWithOperation: jest.fn(),
}));

import {
  format,
  formatDeterministic,
  deterministicFormatter,
  normalizeSpacing,
  normalizeCapitalization,
  normalizeEmojiSpacing,
  formatHashtags,
  capToPlatformLimit,
} from '../../services/content/runtime/deterministicFormatter';
import { PLATFORM_CHAR_LIMITS } from '../../services/unifiedContentProcessor';

describe('deterministicFormatter — platform char trimming', () => {
  it('trims content to the platform hard limit (x = 280)', () => {
    const long = 'word '.repeat(200).trim(); // ~999 chars
    const out = format(long, 'x');
    expect(out.length).toBeLessThanOrEqual(PLATFORM_CHAR_LIMITS.x);
    expect(PLATFORM_CHAR_LIMITS.x).toBe(280);
  });

  it('respects each platform ceiling and never emits over-limit text', () => {
    const long = 'alpha '.repeat(1200).trim(); // ~7199 chars
    for (const platform of Object.keys(PLATFORM_CHAR_LIMITS)) {
      const out = format(long, platform);
      expect(out.length).toBeLessThanOrEqual(PLATFORM_CHAR_LIMITS[platform]);
    }
  });

  it('leaves under-limit content untouched by the cap step', () => {
    const short = 'A short linkedin post about growth.';
    expect(capToPlatformLimit(short, 'linkedin')).toBe(short);
  });

  it('does not cap for an unknown platform (no limit registered)', () => {
    const long = 'word '.repeat(200).trim();
    expect(capToPlatformLimit(long, 'no_such_platform')).toBe(long);
  });
});

describe('deterministicFormatter — hashtags', () => {
  it('normalizes, dedupes, and relocates hashtags to a trailing block', () => {
    const input = 'Grow your brand #GrowthHacking with #growthhacking and #AI today';
    const out = formatHashtags(input);
    // hashtags stripped from the body and appended as one normalized block
    expect(out).toContain('\n\n#growthhacking #ai');
    expect(out.startsWith('Grow your brand')).toBe(true);
    // deduped: #GrowthHacking and #growthhacking collapse to a single tag
    expect(out.match(/#growthhacking/g)?.length).toBe(1);
  });

  it('is a no-op when there are no hashtags', () => {
    const input = 'Plain content with no tags.';
    expect(formatHashtags(input)).toBe(input);
  });

  it('produces byte-identical output across repeated calls (deterministic)', () => {
    const input = 'Launch day #BigNews #bignews 🚀 here we go';
    expect(format(input, 'linkedin')).toBe(format(input, 'linkedin'));
  });
});

describe('deterministicFormatter — emoji / capitalization / spacing', () => {
  it('inserts a single space between emoji and adjacent words', () => {
    expect(normalizeEmojiSpacing('Hello🔥world')).toBe('Hello 🔥 world');
  });

  it('capitalizes the first alphabetic character only', () => {
    expect(normalizeCapitalization('hello World')).toBe('Hello World');
    expect(normalizeCapitalization('Already up')).toBe('Already up');
  });

  it('collapses whitespace runs, blank-line runs, and space-before-punctuation', () => {
    expect(normalizeSpacing('a    b')).toBe('a b');
    expect(normalizeSpacing('line1\n\n\n\nline2')).toBe('line1\n\nline2');
    expect(normalizeSpacing('word , next')).toBe('word, next');
    expect(normalizeSpacing('a\r\nb')).toBe('a\nb');
  });
});

describe('deterministicFormatter — idempotency', () => {
  const samples = [
    'hello   world #Cool #cool 🔥amazing stuff',
    'Grow #GrowthHacking with   messy    spacing\n\n\n\nand blank runs',
    'word '.repeat(400).trim() + ' #Recap #recap',
    'plain content, nothing special here.',
  ];

  for (const platform of ['x', 'linkedin', 'instagram', 'reddit']) {
    it(`format is idempotent on ${platform}`, () => {
      for (const s of samples) {
        const once = format(s, platform);
        const twice = format(once, platform);
        expect(twice).toBe(once);
      }
    });
  }
});

describe('deterministicFormatter — contract surface', () => {
  it('deterministicFormatter.format and formatDeterministic delegate to format', () => {
    const s = 'hello #World 🔥done';
    expect(deterministicFormatter.format(s, 'linkedin')).toBe(format(s, 'linkedin'));
    expect(formatDeterministic(s, 'linkedin')).toBe(format(s, 'linkedin'));
  });

  it('handles empty / whitespace input safely', () => {
    expect(format('', 'x')).toBe('');
    expect(format('   ', 'x')).toBe('');
  });
});
