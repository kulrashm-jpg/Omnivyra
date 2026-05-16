/**
 * Authenticated QA matrix — Part 1 of the dual-mode hardening pass.
 *
 * Pins the *expected ACTIVE platform set* for every Post / Thread × asset
 * combination called out in the spec, plus the *expected HIDDEN-from-list*
 * behavior for video-only destinations (YouTube + TikTok).
 *
 * Why this exists
 * ───────────────
 * Pre-Part-1, capability resolution was singleton (`'text'` for Post,
 * `'writer'` for Thread). Instagram + Pinterest were permanently hidden.
 * The fix is `resolveContentCapabilitySet` + asset-aware
 * `filterConnectedPlatformsForContent`. These tests pin the contract end-
 * to-end so a future change can't silently re-introduce the regression.
 *
 * Scenarios covered:
 *   Post text-only             ─▶ {linkedin, x, facebook, threads, reddit, whatsapp}
 *   Post + image               ─▶ +instagram, +pinterest, +blog
 *   Post + banner              ─▶ same as +image
 *   Post + infographic         ─▶ same as +image
 *   Post + carousel            ─▶ +linkedin/x/facebook/instagram/pinterest (carousel-supporting)
 *   Post + pdf                 ─▶ +blog (pdf → 'writer' adds blog)
 *   Thread text-only           ─▶ {linkedin, x, facebook, threads, reddit, blog}
 *   Thread + image             ─▶ +instagram, +pinterest
 *   Thread + slider            ─▶ +instagram, +pinterest (slider → 'carousel')
 *   YouTube/TikTok connections ─▶ never appear in supported NOR hidden
 *
 * No mocks needed — the resolver is pure.
 */

import {
  filterConnectedPlatformsForContent,
  VIDEO_ONLY_PLATFORM_KEYS,
} from '../../../lib/shared/social/platformContentFilter';
import { resolveContentCapabilitySet } from '../../../lib/shared/social/contentCapability';

const ALL_CONNECTED = [
  'linkedin', 'x', 'facebook', 'instagram', 'pinterest', 'reddit',
  'whatsapp', 'threads', 'blog', 'youtube', 'tiktok',
];

function activeOn(input: { contentType: string; attachedAssetTypes?: string[] }): Set<string> {
  const out = filterConnectedPlatformsForContent(ALL_CONNECTED, input);
  return new Set(out.supported);
}

describe('VIDEO_ONLY_PLATFORM_KEYS', () => {
  it('lists exactly YouTube and TikTok', () => {
    expect(VIDEO_ONLY_PLATFORM_KEYS.has('youtube')).toBe(true);
    expect(VIDEO_ONLY_PLATFORM_KEYS.has('tiktok')).toBe(true);
    expect(VIDEO_ONLY_PLATFORM_KEYS.size).toBe(2);
  });
});

describe('resolveContentCapabilitySet', () => {
  it('returns the base capability when no assets are attached', () => {
    expect(resolveContentCapabilitySet({ contentType: 'post' })).toEqual(['text']);
    expect(resolveContentCapabilitySet({ contentType: 'thread' })).toEqual(['writer']);
  });

  it('expands the set when attached asset types unlock more capabilities', () => {
    const set = new Set(resolveContentCapabilitySet({
      contentType: 'post',
      attachedAssetTypes: ['image'],
    }));
    expect(set.has('text')).toBe(true);
    expect(set.has('image')).toBe(true);
  });

  it('treats supporting image, banner, infographic, and brand card as image-class', () => {
    for (const assetType of ['supporting_image', 'image', 'banner', 'infographic', 'brand_card']) {
      const set = new Set(resolveContentCapabilitySet({
        contentType: 'post',
        attachedAssetTypes: [assetType],
      }));
      expect(set.has('image')).toBe(true);
    }
  });

  it('treats carousel + slider as carousel-class', () => {
    for (const assetType of ['carousel', 'slider']) {
      const set = new Set(resolveContentCapabilitySet({
        contentType: 'post',
        attachedAssetTypes: [assetType],
      }));
      expect(set.has('carousel')).toBe(true);
    }
  });

  it('treats pdf as writer-class', () => {
    const set = new Set(resolveContentCapabilitySet({
      contentType: 'post',
      attachedAssetTypes: ['pdf'],
    }));
    expect(set.has('text')).toBe(true);
    expect(set.has('writer')).toBe(true);
  });

  it('deduplicates the set when multiple assets resolve to the same capability', () => {
    const set = resolveContentCapabilitySet({
      contentType: 'post',
      attachedAssetTypes: ['image', 'banner', 'infographic'],
    });
    expect(set.filter((c) => c === 'image')).toHaveLength(1);
  });
});

describe('filterConnectedPlatformsForContent — Post matrix', () => {
  it('text-only Post: LinkedIn / X / Facebook / Threads / Reddit / WhatsApp active', () => {
    const active = activeOn({ contentType: 'post' });
    for (const key of ['linkedin', 'x', 'facebook', 'threads', 'reddit', 'whatsapp']) {
      expect(active.has(key)).toBe(true);
    }
    // Image-first platforms hidden when no image is attached.
    expect(active.has('instagram')).toBe(false);
    expect(active.has('pinterest')).toBe(false);
  });

  it('Post + image: Instagram + Pinterest light up alongside the text platforms', () => {
    const active = activeOn({ contentType: 'post', attachedAssetTypes: ['image'] });
    expect(active.has('instagram')).toBe(true);
    expect(active.has('pinterest')).toBe(true);
    expect(active.has('linkedin')).toBe(true);
    expect(active.has('x')).toBe(true);
    expect(active.has('facebook')).toBe(true);
  });

  it('Post + banner: same activation as Post + image', () => {
    const a = activeOn({ contentType: 'post', attachedAssetTypes: ['banner'] });
    const b = activeOn({ contentType: 'post', attachedAssetTypes: ['image'] });
    expect([...a].sort()).toEqual([...b].sort());
  });

  it('Post + infographic: same activation as Post + image', () => {
    const a = activeOn({ contentType: 'post', attachedAssetTypes: ['infographic'] });
    const b = activeOn({ contentType: 'post', attachedAssetTypes: ['image'] });
    expect([...a].sort()).toEqual([...b].sort());
  });

  it('standalone Infographic: normalizes as image-class content', () => {
    const active = activeOn({ contentType: 'infographic' });
    expect(active.has('instagram')).toBe(true);
    expect(active.has('pinterest')).toBe(true);
    expect(active.has('linkedin')).toBe(true);
  });

  it('Post + carousel: Instagram + Pinterest + carousel-supporting platforms', () => {
    const active = activeOn({ contentType: 'post', attachedAssetTypes: ['carousel'] });
    expect(active.has('instagram')).toBe(true);
    expect(active.has('pinterest')).toBe(true);
    expect(active.has('linkedin')).toBe(true);
    expect(active.has('facebook')).toBe(true);
  });

  it('Post + pdf: Blog activates (writer capability)', () => {
    const active = activeOn({ contentType: 'post', attachedAssetTypes: ['pdf'] });
    expect(active.has('blog')).toBe(true);
    expect(active.has('linkedin')).toBe(true);
  });
});

describe('filterConnectedPlatformsForContent — Thread matrix', () => {
  it('text-only Thread: LinkedIn / X / Facebook / Threads / Reddit / Blog active', () => {
    const active = activeOn({ contentType: 'thread' });
    for (const key of ['linkedin', 'x', 'facebook', 'threads', 'reddit', 'blog']) {
      expect(active.has(key)).toBe(true);
    }
    // Image-first platforms hidden when no image is attached.
    expect(active.has('instagram')).toBe(false);
    expect(active.has('pinterest')).toBe(false);
  });

  it('Thread + image: Instagram + Pinterest light up', () => {
    const active = activeOn({ contentType: 'thread', attachedAssetTypes: ['image'] });
    expect(active.has('instagram')).toBe(true);
    expect(active.has('pinterest')).toBe(true);
    expect(active.has('linkedin')).toBe(true);
  });

  it('Thread + infographic: Instagram + Pinterest light up', () => {
    const active = activeOn({ contentType: 'thread', attachedAssetTypes: ['infographic'] });
    expect(active.has('instagram')).toBe(true);
    expect(active.has('pinterest')).toBe(true);
    expect(active.has('linkedin')).toBe(true);
  });

  it('Thread + slider: carousel-class unlocks Instagram + Pinterest', () => {
    const active = activeOn({ contentType: 'thread', attachedAssetTypes: ['slider'] });
    expect(active.has('instagram')).toBe(true);
    expect(active.has('pinterest')).toBe(true);
    expect(active.has('linkedin')).toBe(true);
  });

  it('Thread + pdf: Blog stays active (writer is already there)', () => {
    const active = activeOn({ contentType: 'thread', attachedAssetTypes: ['pdf'] });
    expect(active.has('blog')).toBe(true);
  });
});

describe('filterConnectedPlatformsForContent — video-only platforms', () => {
  it('YouTube + TikTok never appear in supported nor hidden — they are pre-filtered out', () => {
    const out = filterConnectedPlatformsForContent(ALL_CONNECTED, { contentType: 'post' });
    expect(out.supported.includes('youtube')).toBe(false);
    expect(out.supported.includes('tiktok')).toBe(false);
    expect(out.hidden.some((h) => h.platform === 'youtube')).toBe(false);
    expect(out.hidden.some((h) => h.platform === 'tiktok')).toBe(false);
    expect(out.videoOnlyHidden.sort()).toEqual(['tiktok', 'youtube']);
  });

  it('Attaching an image does NOT activate YouTube/TikTok', () => {
    const active = activeOn({ contentType: 'post', attachedAssetTypes: ['image'] });
    expect(active.has('youtube')).toBe(false);
    expect(active.has('tiktok')).toBe(false);
  });

  it('Attaching a carousel does NOT activate YouTube/TikTok', () => {
    const active = activeOn({ contentType: 'post', attachedAssetTypes: ['carousel'] });
    expect(active.has('youtube')).toBe(false);
    expect(active.has('tiktok')).toBe(false);
  });
});

describe('filterConnectedPlatformsForContent — video/creator policy carve-out', () => {
  it('reel/creator content does NOT pre-filter YouTube/TikTok (they are valid destinations)', () => {
    const out = filterConnectedPlatformsForContent(
      ['instagram', 'tiktok', 'youtube', 'whatsapp', 'reddit'],
      { contentType: 'reel' },
    );
    // creator-capability content publishes to TikTok + Instagram.
    expect(out.supported).toEqual(expect.arrayContaining(['instagram', 'tiktok']));
    // videoOnlyHidden stays empty because the policy didn't apply here.
    expect(out.videoOnlyHidden).toEqual([]);
  });

  it('video contentType also keeps YouTube + TikTok in scope', () => {
    const out = filterConnectedPlatformsForContent(
      ['linkedin', 'tiktok', 'youtube'],
      { contentType: 'video' },
    );
    expect(out.supported).toEqual(expect.arrayContaining(['youtube', 'tiktok']));
  });

  it('text/writer Writer flows still exclude YouTube + TikTok by policy', () => {
    const out = filterConnectedPlatformsForContent(
      ['linkedin', 'tiktok', 'youtube'],
      { contentType: 'post' },
    );
    expect(out.supported).not.toContain('youtube');
    expect(out.supported).not.toContain('tiktok');
    expect(out.videoOnlyHidden.sort()).toEqual(['tiktok', 'youtube']);
  });
});

describe('filterConnectedPlatformsForContent — back-compat', () => {
  it('capability field still reflects the primary base capability', () => {
    const out = filterConnectedPlatformsForContent(['linkedin'], { contentType: 'post' });
    expect(out.capability).toBe('text');
    expect(out.capabilities).toEqual(['text']);
  });

  it('null capability path returns an empty supported list and registers fail-closed', () => {
    const out = filterConnectedPlatformsForContent(['linkedin', 'instagram'], {});
    expect(out.capability).toBeNull();
    expect(out.capabilities).toEqual([]);
    expect(out.supported).toEqual([]);
  });

  it('unregistered platforms are still tracked separately', () => {
    const out = filterConnectedPlatformsForContent(['linkedin', 'something_made_up'], { contentType: 'post' });
    expect(out.unregistered.map((u) => u.platform)).toEqual(['something_made_up']);
  });
});
