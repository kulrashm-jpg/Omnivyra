/**
 * Phase 10D — asset/image/video activity-economy bridge (pure; no DB).
 */

import { resolveAssetActivityEconomics, assetActivityFor } from '../../services/creator/assetActivityEconomics';

describe('assetActivityFor', () => {
  it('maps content types to image/video activities', () => {
    expect(assetActivityFor('image')).toBe('image_generation');
    expect(assetActivityFor('carousel')).toBe('image_generation');
    expect(assetActivityFor('infographic')).toBe('image_generation');
    expect(assetActivityFor('video')).toBe('video_generation');
    expect(assetActivityFor('reel')).toBe('video_generation');
  });
});

describe('resolveAssetActivityEconomics (reuses costProfiles + catalog)', () => {
  it('image → IMAGE_GENERATION economics + per-asset cost × count', () => {
    const e = resolveAssetActivityEconomics({ contentType: 'image', assetCount: 3 });
    expect(e.activity).toBe('image_generation');
    expect(e.activityClass).toBe('IMAGE_GENERATION');
    expect(e.entryConsumption).toBe(2);
    expect(e.minimumCredits).toBe(2);
    expect(e.maximumCredits).toBe(12);
    expect(e.reservationCredits).toBe(10); // max − entry
    expect(e.actualCredits).toBe(3);       // 1 credit/asset × 3
  });

  it('carousel → 2 credits/asset', () => {
    const e = resolveAssetActivityEconomics({ contentType: 'carousel', assetCount: 2 });
    expect(e.activityClass).toBe('IMAGE_GENERATION');
    expect(e.actualCredits).toBe(4); // 2 × 2
  });

  it('infographic → 1.5 credits/asset (ceil)', () => {
    const e = resolveAssetActivityEconomics({ contentType: 'infographic', assetCount: 3 });
    expect(e.actualCredits).toBe(5); // ceil(1.5 × 3 = 4.5)
  });

  it('video → VIDEO_GENERATION economics', () => {
    const e = resolveAssetActivityEconomics({ contentType: 'video', assetCount: 1 });
    expect(e.activity).toBe('video_generation');
    expect(e.activityClass).toBe('VIDEO_GENERATION');
    expect(e.entryConsumption).toBe(10);
    expect(e.maximumCredits).toBe(150);
  });

  it('defaults assetCount to 1 and unknown type to the image profile', () => {
    const e = resolveAssetActivityEconomics({ contentType: 'somethingelse' });
    expect(e.assetCount).toBe(1);
    expect(e.activityClass).toBe('IMAGE_GENERATION');
    expect(e.actualCredits).toBe(1); // image fallback, 1 credit/asset
  });
});
