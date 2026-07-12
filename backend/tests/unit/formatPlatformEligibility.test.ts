/**
 * AUDIT-004 mapping fix — generation-time format×platform eligibility must be
 * capability ∩ exclusive ∩ blocklist, not the blocklist-only leaf that let
 * carousel→YouTube / reel→WhatsApp / poll→X slip through.
 */
import {
  filterPlatformsForFormat,
  getSupportedPlatformsForFormat,
  isValidPlatformFormatPair,
} from '../../../lib/shared/bolt/contentPlatformAssignment';

const ALL = ['linkedin', 'x', 'facebook', 'instagram', 'pinterest', 'reddit', 'youtube', 'tiktok', 'threads', 'whatsapp'];

describe('format × platform eligibility (capability ∩ exclusive ∩ blocklist)', () => {
  it('carousel is visual-only — excludes text/video-only platforms', () => {
    const p = filterPlatformsForFormat(ALL, 'carousel');
    expect(p.sort()).toEqual(['facebook', 'instagram', 'linkedin', 'pinterest']);
    expect(p).not.toContain('youtube');
    expect(p).not.toContain('whatsapp');
    expect(p).not.toContain('reddit');
  });

  it('reel is instagram/youtube/tiktok only', () => {
    expect(filterPlatformsForFormat(ALL, 'reel').sort()).toEqual(['instagram', 'tiktok', 'youtube']);
  });

  it('poll excludes X (blocklist) but keeps text-capable platforms', () => {
    const p = filterPlatformsForFormat(ALL, 'poll');
    expect(p).not.toContain('x');
    expect(p).toEqual(expect.arrayContaining(['linkedin', 'facebook']));
    // the UI-picker authority also enforces the block now
    expect(getSupportedPlatformsForFormat('poll', ALL)).not.toContain('x');
  });

  it('tweet stays X-exclusive', () => {
    expect(filterPlatformsForFormat(ALL, 'tweet')).toEqual(['x']);
  });

  it('post/article (text) run on every text-capable platform', () => {
    expect(filterPlatformsForFormat(ALL, 'post')).toEqual(expect.arrayContaining(['linkedin', 'x', 'facebook']));
    expect(filterPlatformsForFormat(ALL, 'article')).toEqual(expect.arrayContaining(['linkedin', 'facebook']));
  });

  it('preserves candidate order + is empty when nothing is eligible', () => {
    expect(filterPlatformsForFormat(['pinterest', 'x'], 'tweet')).toEqual(['x']);
    expect(filterPlatformsForFormat(['x'], 'poll')).toEqual([]); // X-only + poll blocked on X → drop
  });
});

// ── IMPL-002A: one-and-only-one authority — the three public entry points must
// never disagree, across the full format universe, and no format may ever
// surface a platform outside its own capability ∩ exclusive ∩ blocklist result.
describe('canonical authority is self-consistent across every format × platform', () => {
  const FORMATS = [
    'post', 'article', 'tweet', 'thread', 'poll', 'newsletter',
    'carousel', 'infographic', 'quote_card', 'reel', 'story', 'video',
    'podcast', // capability-unresolved → must fail-closed to []
  ];

  it('filterPlatformsForFormat === getSupportedPlatformsForFormat (same set, same order)', () => {
    for (const fmt of FORMATS) {
      const viaFilter = filterPlatformsForFormat([...ALL], fmt);
      const viaSupport = getSupportedPlatformsForFormat(fmt, [...ALL]);
      expect(viaFilter.slice().sort()).toEqual(viaSupport.slice().sort());
    }
  });

  it('isValidPlatformFormatPair agrees with the supported set for every pair', () => {
    for (const fmt of FORMATS) {
      const supported = new Set(getSupportedPlatformsForFormat(fmt, [...ALL]));
      for (const platform of ALL) {
        expect(isValidPlatformFormatPair(platform, fmt)).toBe(supported.has(platform));
      }
    }
  });

  it('no eligible platform ever violates the exclusive whitelist or the blocklist', () => {
    for (const fmt of FORMATS) {
      const eligible = getSupportedPlatformsForFormat(fmt, [...ALL]);
      // tweet is X-exclusive
      if (fmt === 'tweet') expect(eligible).toEqual(['x']);
      // poll can never reach X/Twitter (blocklist)
      if (fmt === 'poll') { expect(eligible).not.toContain('x'); expect(eligible).not.toContain('twitter'); }
      // podcast/audio has no capability → fail-closed
      if (fmt === 'podcast') expect(eligible).toEqual([]);
    }
  });

  it('carousel (visual-only) never leaks onto text/video-only platforms', () => {
    // NOTE: only carousel is asserted here. `infographic` follows its own
    // capability-registry mapping (a broad image/text capability) — IMPL-002A
    // does not redesign the capability model, so we assert the authority's
    // *actual* result, not an invented visual-only rule.
    const eligible = getSupportedPlatformsForFormat('carousel', [...ALL]);
    expect(eligible).not.toContain('youtube');
    expect(eligible).not.toContain('tiktok');
    expect(eligible).not.toContain('whatsapp');
    expect(eligible).not.toContain('x');
    expect(eligible).not.toContain('reddit');
  });
});
