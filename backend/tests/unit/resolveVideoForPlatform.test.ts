import {
  resolveVideoForPlatform,
  readCreatorVideoAsset,
} from '../../../lib/shared/creatorVideoResolution';

describe('resolveVideoForPlatform', () => {
  const UPLOADED = 'https://cdn/validated-upload.mp4';

  it('same mode → returns the validated uploaded media', () => {
    const url = resolveVideoForPlatform({
      creatorAsset: { video_mode: 'same', url: 'https://asset/url.mp4' },
      platform: 'linkedin',
      uploadedMediaUrl: UPLOADED,
    });
    expect(url).toBe(UPLOADED);
  });

  it('legacy asset (no video_mode / no platform_videos) → uploaded media unchanged', () => {
    const url = resolveVideoForPlatform({
      creatorAsset: { url: 'https://asset/url.mp4' },
      platform: 'instagram',
      uploadedMediaUrl: UPLOADED,
    });
    expect(url).toBe(UPLOADED);
  });

  it('no creator asset at all → uploaded media (full backward compat)', () => {
    expect(resolveVideoForPlatform({ creatorAsset: null, platform: 'x', uploadedMediaUrl: UPLOADED })).toBe(UPLOADED);
  });

  it('different mode → returns the platform-specific URL', () => {
    const asset = {
      video_mode: 'different' as const,
      url: 'https://asset/primary.mp4',
      platform_videos: {
        linkedin: 'https://cdn/li.mp4',
        instagram: 'https://cdn/ig.mp4',
        youtube: 'https://cdn/yt.mp4',
      },
    };
    expect(resolveVideoForPlatform({ creatorAsset: asset, platform: 'linkedin', uploadedMediaUrl: UPLOADED })).toBe('https://cdn/li.mp4');
    expect(resolveVideoForPlatform({ creatorAsset: asset, platform: 'instagram', uploadedMediaUrl: UPLOADED })).toBe('https://cdn/ig.mp4');
    expect(resolveVideoForPlatform({ creatorAsset: asset, platform: 'youtube', uploadedMediaUrl: UPLOADED })).toBe('https://cdn/yt.mp4');
  });

  it('different mode but platform URL absent → falls back to asset url, never fails', () => {
    const asset = {
      video_mode: 'different' as const,
      url: 'https://asset/primary.mp4',
      platform_videos: { linkedin: 'https://cdn/li.mp4' },
    };
    // tiktok has no specific URL → fall back to the same-video url
    expect(resolveVideoForPlatform({ creatorAsset: asset, platform: 'tiktok', uploadedMediaUrl: UPLOADED })).toBe('https://asset/primary.mp4');
  });

  it('different mode, platform absent AND no asset url → falls back to uploaded media', () => {
    const asset = { video_mode: 'different' as const, platform_videos: { linkedin: 'https://cdn/li.mp4' } };
    expect(resolveVideoForPlatform({ creatorAsset: asset, platform: 'facebook', uploadedMediaUrl: UPLOADED })).toBe(UPLOADED);
  });

  it('platform key matching is case-insensitive', () => {
    const asset = { video_mode: 'different' as const, platform_videos: { linkedin: 'https://cdn/li.mp4' } };
    expect(resolveVideoForPlatform({ creatorAsset: asset, platform: 'LinkedIn', uploadedMediaUrl: '' })).toBe('https://cdn/li.mp4');
  });

  it('returns empty string when nothing resolves (media-less row)', () => {
    expect(resolveVideoForPlatform({ creatorAsset: { video_mode: 'same' }, platform: 'x', uploadedMediaUrl: '' })).toBe('');
  });
});

describe('resolveVideoForPlatform — format-aware (platform, format)', () => {
  const UPLOADED = 'https://cdn/validated-upload.mp4';
  const asset = {
    video_mode: 'different' as const,
    url: 'https://asset/primary.mp4',
    platform_videos: { youtube: 'https://cdn/yt-primary.mp4' },
    platform_video_mappings: [
      { platformId: 'youtube', videoFormat: 'Short', videoUrl: 'https://cdn/yt-short.mp4' },
      { platformId: 'youtube', videoFormat: 'Long Video', videoUrl: 'https://cdn/yt-long.mp4' },
      { platformId: 'instagram', videoFormat: 'Reel', videoUrl: 'https://cdn/ig-reel.mp4' },
      { platformId: 'tiktok', videoFormat: 'Short Video', videoUrl: 'https://cdn/tt-short.mp4' },
    ],
  };

  it('YouTube + Short → youtube short asset', () => {
    expect(resolveVideoForPlatform({ creatorAsset: asset, platform: 'youtube', format: 'Short', uploadedMediaUrl: UPLOADED }))
      .toBe('https://cdn/yt-short.mp4');
  });

  it('YouTube + Long Video → youtube long asset (independently resolved)', () => {
    expect(resolveVideoForPlatform({ creatorAsset: asset, platform: 'youtube', format: 'Long Video', uploadedMediaUrl: UPLOADED }))
      .toBe('https://cdn/yt-long.mp4');
  });

  it('Instagram + Reel and TikTok + Short Video resolve correctly', () => {
    expect(resolveVideoForPlatform({ creatorAsset: asset, platform: 'instagram', format: 'Reel', uploadedMediaUrl: UPLOADED }))
      .toBe('https://cdn/ig-reel.mp4');
    expect(resolveVideoForPlatform({ creatorAsset: asset, platform: 'tiktok', format: 'Short Video', uploadedMediaUrl: UPLOADED }))
      .toBe('https://cdn/tt-short.mp4');
  });

  it('format match is case-insensitive', () => {
    expect(resolveVideoForPlatform({ creatorAsset: asset, platform: 'YouTube', format: 'long video', uploadedMediaUrl: '' }))
      .toBe('https://cdn/yt-long.mp4');
  });

  it('no format → platform mapping (platform_videos) wins, primary per platform', () => {
    expect(resolveVideoForPlatform({ creatorAsset: asset, platform: 'youtube', uploadedMediaUrl: UPLOADED }))
      .toBe('https://cdn/yt-primary.mp4');
  });

  it('no platform_videos, no format → first mapping for the platform (primary)', () => {
    const a = { video_mode: 'different' as const, platform_video_mappings: asset.platform_video_mappings };
    expect(resolveVideoForPlatform({ creatorAsset: a, platform: 'youtube', uploadedMediaUrl: UPLOADED }))
      .toBe('https://cdn/yt-short.mp4'); // first youtube mapping
  });

  it('format requested but no matching mapping → falls back down the chain (never fail open)', () => {
    const a = { video_mode: 'different' as const, url: 'https://asset/shared.mp4', platform_video_mappings: asset.platform_video_mappings };
    // youtube has no "Reel" mapping → platform mapping (first youtube) → shared
    expect(resolveVideoForPlatform({ creatorAsset: a, platform: 'youtube', format: 'Reel', uploadedMediaUrl: UPLOADED }))
      .toBe('https://cdn/yt-short.mp4');
    // platform with no mapping at all → shared video
    expect(resolveVideoForPlatform({ creatorAsset: a, platform: 'linkedin', format: 'Video', uploadedMediaUrl: UPLOADED }))
      .toBe('https://asset/shared.mp4');
  });

  it('legacy platform_videos (no mappings) still resolve unchanged', () => {
    const legacy = { video_mode: 'different' as const, platform_videos: { youtube: 'https://cdn/yt-legacy.mp4' } };
    expect(resolveVideoForPlatform({ creatorAsset: legacy, platform: 'youtube', format: 'Short', uploadedMediaUrl: UPLOADED }))
      .toBe('https://cdn/yt-legacy.mp4'); // no mapping → platform_videos
  });

  it('same-video mode ignores format and returns the validated upload', () => {
    expect(resolveVideoForPlatform({ creatorAsset: { video_mode: 'same', url: 'https://a/x.mp4' }, platform: 'youtube', format: 'Short', uploadedMediaUrl: UPLOADED }))
      .toBe(UPLOADED);
  });
});

/**
 * Consumer wire-up reality: the scheduler threads the row's CREATOR format code
 * (normalizeCreatorFormat → 'short' | 'reel' | 'video'), not the UI display
 * label. These tests document exactly what resolves end-to-end + that
 * unmatched labels fall back safely (no regression).
 */
describe('resolveVideoForPlatform — threaded creator format codes (consumer)', () => {
  const UPLOADED = 'https://cdn/validated-upload.mp4';
  const asset = {
    video_mode: 'different' as const,
    url: 'https://asset/shared.mp4',
    platform_videos: { youtube: 'https://cdn/yt-primary.mp4' },
    platform_video_mappings: [
      { platformId: 'youtube', videoFormat: 'Short', videoUrl: 'https://cdn/yt-short.mp4' },
      { platformId: 'youtube', videoFormat: 'Long Video', videoUrl: 'https://cdn/yt-long.mp4' },
      { platformId: 'instagram', videoFormat: 'Reel', videoUrl: 'https://cdn/ig-reel.mp4' },
      { platformId: 'facebook', videoFormat: 'Video', videoUrl: 'https://cdn/fb-video.mp4' },
    ],
  };

  it("creator 'short' matches the Short mapping (YouTube Short → short asset)", () => {
    expect(resolveVideoForPlatform({ creatorAsset: asset, platform: 'youtube', format: 'short', uploadedMediaUrl: UPLOADED }))
      .toBe('https://cdn/yt-short.mp4');
  });

  it("creator 'reel' matches the Reel mapping (Instagram Reel → reel asset)", () => {
    expect(resolveVideoForPlatform({ creatorAsset: asset, platform: 'instagram', format: 'reel', uploadedMediaUrl: UPLOADED }))
      .toBe('https://cdn/ig-reel.mp4');
  });

  it("creator 'video' matches the single-word 'Video' label (Facebook → fb video)", () => {
    expect(resolveVideoForPlatform({ creatorAsset: asset, platform: 'facebook', format: 'video', uploadedMediaUrl: UPLOADED }))
      .toBe('https://cdn/fb-video.mp4');
  });

  it("creator 'video' now canonically matches 'Long Video' (YouTube Long → long asset)", () => {
    // Vocabulary alignment: canonical('video') === canonical('Long Video') === 'video'.
    expect(resolveVideoForPlatform({ creatorAsset: asset, platform: 'youtube', format: 'video', uploadedMediaUrl: UPLOADED }))
      .toBe('https://cdn/yt-long.mp4');
  });
});

describe('Section D — canonical vocabulary resolution matrix', () => {
  const UPLOADED = 'https://cdn/validated-upload.mp4';
  const asset = {
    video_mode: 'different' as const,
    url: 'https://asset/shared.mp4',
    platform_videos: { youtube: 'https://cdn/yt-primary.mp4' },
    platform_video_mappings: [
      { platformId: 'youtube', videoFormat: 'Short', videoUrl: 'https://cdn/yt-short.mp4' },
      { platformId: 'youtube', videoFormat: 'Long Video', videoUrl: 'https://cdn/yt-long.mp4' },
      { platformId: 'facebook', videoFormat: 'Video', videoUrl: 'https://cdn/fb-video.mp4' },
      { platformId: 'instagram', videoFormat: 'Reel', videoUrl: 'https://cdn/ig-reel.mp4' },
      { platformId: 'pinterest', videoFormat: 'Video Pin', videoUrl: 'https://cdn/pin.mp4' },
    ],
  };
  const r = (platform: string, format: string) =>
    resolveVideoForPlatform({ creatorAsset: asset, platform, format, uploadedMediaUrl: UPLOADED });

  it('YouTube + Short → Short asset', () => expect(r('youtube', 'Short')).toBe('https://cdn/yt-short.mp4'));
  it('YouTube + Short Video (canonical short) → Short asset', () => expect(r('youtube', 'Short Video')).toBe('https://cdn/yt-short.mp4'));
  it('YouTube + Long Video → Long Video asset', () => expect(r('youtube', 'Long Video')).toBe('https://cdn/yt-long.mp4'));
  it('Facebook + Video → Video asset', () => expect(r('facebook', 'Video')).toBe('https://cdn/fb-video.mp4'));
  it('Instagram + Reel → Reel asset', () => expect(r('instagram', 'Reel')).toBe('https://cdn/ig-reel.mp4'));
  it('Pinterest + Video Pin → Video Pin asset', () => expect(r('pinterest', 'Video Pin')).toBe('https://cdn/pin.mp4'));

  it('legacy platform_videos → unchanged', () => {
    const legacy = { video_mode: 'different' as const, platform_videos: { youtube: 'https://cdn/yt-legacy.mp4' } };
    expect(resolveVideoForPlatform({ creatorAsset: legacy, platform: 'youtube', format: 'Long Video', uploadedMediaUrl: UPLOADED })).toBe('https://cdn/yt-legacy.mp4');
  });
  it('same-video mode → unchanged', () => {
    expect(resolveVideoForPlatform({ creatorAsset: { video_mode: 'same', url: 'https://a/x.mp4' }, platform: 'youtube', format: 'Long Video', uploadedMediaUrl: UPLOADED })).toBe(UPLOADED);
  });
  it('unknown format → fail closed (no match, falls back; never wrong asset)', () => {
    // canonical('bogus') === '' → format branch skipped → platform primary.
    expect(r('youtube', 'totally-unknown')).toBe('https://cdn/yt-primary.mp4');
  });
});

describe('Section F — YouTube Short + Long Video resolve independently (no fallback-to-primary)', () => {
  const UPLOADED = 'https://cdn/validated-upload.mp4';
  // A single YouTube asset carrying BOTH formats — no platform_videos primary,
  // so any fallback would be detectable.
  const asset = {
    video_mode: 'different' as const,
    url: 'https://asset/shared.mp4',
    platform_video_mappings: [
      { platformId: 'youtube', videoFormat: 'Short', videoUrl: 'https://cdn/yt-short.mp4' },
      { platformId: 'youtube', videoFormat: 'Long Video', videoUrl: 'https://cdn/yt-long.mp4' },
    ],
  };
  it("scheduler-threaded 'short' → Short asset", () => {
    expect(resolveVideoForPlatform({ creatorAsset: asset, platform: 'youtube', format: 'short', uploadedMediaUrl: UPLOADED })).toBe('https://cdn/yt-short.mp4');
  });
  it("scheduler-threaded 'video' → Long Video asset (independent, not primary/shared)", () => {
    const out = resolveVideoForPlatform({ creatorAsset: asset, platform: 'youtube', format: 'video', uploadedMediaUrl: UPLOADED });
    expect(out).toBe('https://cdn/yt-long.mp4');
    expect(out).not.toBe('https://asset/shared.mp4');
    expect(out).not.toBe(UPLOADED);
  });
});

describe('readCreatorVideoAsset', () => {
  it('reads from content.asset_payload.override_asset (creator-asset save path)', () => {
    const content = {
      asset_payload: { override_asset: { video_mode: 'different', url: 'u', platform_videos: { linkedin: 'li' } } },
    };
    expect(readCreatorVideoAsset(content)?.video_mode).toBe('different');
    expect(readCreatorVideoAsset(content)?.platform_videos?.linkedin).toBe('li');
  });

  it('falls back to top-level creator_asset', () => {
    const content = { creator_asset: { video_mode: 'same', url: 'u' } };
    expect(readCreatorVideoAsset(content)?.url).toBe('u');
  });

  it('returns null when no asset present', () => {
    expect(readCreatorVideoAsset({ foo: 'bar' })).toBeNull();
    expect(readCreatorVideoAsset(null)).toBeNull();
  });
});
