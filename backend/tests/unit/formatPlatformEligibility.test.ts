/**
 * AUDIT-004 mapping fix — generation-time format×platform eligibility must be
 * capability ∩ exclusive ∩ blocklist, not the blocklist-only leaf that let
 * carousel→YouTube / reel→WhatsApp / poll→X slip through.
 */
import {
  filterPlatformsForFormat,
  getSupportedPlatformsForFormat,
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
