/**
 * Regression: a `supporting_image` must NEVER resolve to `embedded_copy`.
 *
 * Production bug (2026-06-02): scheduling a LinkedIn post with an attached
 * Image returned 422 CREATOR_ATTACHMENT_SCHEDULE_VALIDATION_FAILED with
 * errors visual_priority_rejects_text_overlay / headline_overlay_forbidden /
 * text_density|area_exceeds_profile. Root cause: resolveAttachmentModeFromIntent
 * coerced the supporting_image to embedded_copy because the source post text
 * was long/paragraph-like, so the renderer baked the post onto the image — but
 * the supporting_image governance profile is zero-text (maxWords 0,
 * visualPriority 'visual', allowHeadline false), so the publish validator
 * hard-rejects any text overlay on it, on every platform.
 *
 * The fix pins supporting_image to supporting_visual regardless of text signals
 * or an explicit embedded_copy request, while leaving typography-bearing asset
 * types (banner/brand_card/infographic/carousel) free to embed copy.
 */

import { resolveAttachmentModeFromIntent } from '../../../lib/content/writerCreatorAttachmentContracts';

const PARAGRAPH = 'This fragmented approach often leads to missed opportunities and inefficient '
  + 'budget allocation due to unclear performance metrics. Here is the contrarian insight: '
  + 'sometimes, less truly is more for your marketing strategy in 2026 and beyond.';

describe('resolveAttachmentModeFromIntent — supporting_image taxonomy gate', () => {
  test('paragraph-like source text + CTA does NOT coerce a supporting_image to embedded_copy', () => {
    const r = resolveAttachmentModeFromIntent({
      assetType: 'supporting_image',
      sourceText: PARAGRAPH,
      cta: 'Learn more',
    });
    expect(r.mode).toBe('supporting_visual');
    expect(r.coerced).toBe(true); // signals fired but were overridden
  });

  test('an explicit embedded_copy request on a supporting_image is overridden to supporting_visual', () => {
    const r = resolveAttachmentModeFromIntent({
      assetType: 'supporting_image',
      requestedMode: 'embedded_copy',
      sourceText: PARAGRAPH,
    });
    expect(r.mode).toBe('supporting_visual');
    expect(r.coerced).toBe(true);
  });

  test('a supporting_image with no signals stays supporting_visual (unchanged default)', () => {
    const r = resolveAttachmentModeFromIntent({ assetType: 'supporting_image' });
    expect(r.mode).toBe('supporting_visual');
  });

  test('typography-bearing assets (banner) still embed copy when text signals fire (no regression)', () => {
    const r = resolveAttachmentModeFromIntent({
      assetType: 'banner',
      sourceText: PARAGRAPH,
      cta: 'Buy now',
    });
    expect(r.mode).toBe('embedded_copy');
  });

  test('brand_card with an explicit embedded_copy request is honored (no regression)', () => {
    const r = resolveAttachmentModeFromIntent({
      assetType: 'brand_card',
      requestedMode: 'embedded_copy',
    });
    expect(r.mode).toBe('embedded_copy');
  });
});
