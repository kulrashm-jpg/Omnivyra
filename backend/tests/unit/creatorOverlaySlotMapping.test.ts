/**
 * Overlay slot mapping — every overlay field lands in ITS OWN slot.
 *
 * The image renderer used to build `[hook, headline, keyInsight, cta,
 * supportingText].filter(Boolean)` and then re-map the governed blocks BY
 * POSITION (hook = blocks[0], headline = blocks[1], …). The template path
 * always sends hook = '', so every field shifted one slot: the user's headline
 * landed in the never-drawn hook, the key insight became the headline, the CTA
 * became the insight and the supporting text was drawn in the CTA pill.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  autoCorrectOverlayFields,
  autoCorrectVisualCopy,
  governImageOverlayText,
  paragraphSafeOverlayBlock,
  OVERLAY_TEXT_FIELDS,
} from '../../services/creatorAssetGovernance';

const TEMPLATE_OVERLAY = {
  hook: '',
  headline: 'Ship campaigns in minutes',
  keyInsight: 'One brief becomes every asset',
  cta: 'Start free',
  supportingText: 'No design skills needed',
};

/** The pre-fix algorithm, reproduced verbatim for the regression check. */
function legacyPositionalMapping(overlay: typeof TEMPLATE_OVERLAY) {
  const raw = [overlay.hook, overlay.headline, overlay.keyInsight, overlay.cta, overlay.supportingText].filter(Boolean);
  const corrected = autoCorrectVisualCopy({ assetType: 'banner', textBlocks: raw, allowCTA: true });
  const safe = corrected.textBlocks.map(paragraphSafeOverlayBlock);
  return { hook: safe[0] ?? '', headline: safe[1] ?? '', keyInsight: safe[2] ?? '', cta: safe[3] ?? '', supportingText: safe[4] ?? '' };
}

describe('overlay text is governed per field, keyed by name', () => {
  it('CRITICAL: with hook = "" each field lands in its own slot', () => {
    const { governedOverlay } = governImageOverlayText({ assetType: 'banner', overlay: TEMPLATE_OVERLAY, allowCTA: true });
    expect(governedOverlay).toEqual({
      hook: '',
      headline: 'Ship campaigns in minutes',
      keyInsight: 'One brief becomes every asset',
      cta: 'Start free',
      supportingText: 'No design skills needed',
    });
  });

  it('REGRESSION: the old positional shift is gone', () => {
    const legacy = legacyPositionalMapping(TEMPLATE_OVERLAY);
    // Proves the old code really shifted (so this test guards something real)…
    expect(legacy.hook).toBe('Ship campaigns in minutes');
    expect(legacy.headline).toBe('One brief becomes every asset');
    expect(legacy.cta).toBe('No design skills needed');
    // …and that the new mapping does not.
    const { governedOverlay } = governImageOverlayText({ assetType: 'banner', overlay: TEMPLATE_OVERLAY, allowCTA: true });
    expect(governedOverlay.hook).toBe('');
    expect(governedOverlay.headline).toBe(TEMPLATE_OVERLAY.headline);
    expect(governedOverlay.cta).toBe(TEMPLATE_OVERLAY.cta);
  });

  it.each(OVERLAY_TEXT_FIELDS)('a lone %s stays in its own slot', (field) => {
    const overlay = { hook: '', headline: '', keyInsight: '', cta: '', supportingText: '', [field]: 'Only this field' };
    const { governedOverlay, safeTextBlocks } = governImageOverlayText({ assetType: 'banner', overlay, allowCTA: true });
    for (const key of OVERLAY_TEXT_FIELDS) {
      expect(governedOverlay[key]).toBe(key === field ? 'Only this field' : '');
    }
    expect(safeTextBlocks).toEqual(['Only this field']);
  });

  it('a CTA emptied by the no-CTA policy leaves its slot empty instead of shifting later fields', () => {
    const { governedOverlay, corrections } = governImageOverlayText({
      assetType: 'banner',
      overlay: { hook: 'Hook', headline: 'Headline', keyInsight: 'Insight', cta: 'Learn more', supportingText: 'Supporting' },
      allowCTA: false,
    });
    expect(governedOverlay.cta).toBe('');
    expect(governedOverlay.supportingText).toBe('Supporting');
    expect(corrections).toContain('removed_cta');
  });

  it('paragraph-safe collapse is applied per field', () => {
    const { governedOverlay } = governImageOverlayText({
      assetType: 'banner',
      overlay: { hook: '', headline: 'First sentence here. Second sentence here.', keyInsight: '', cta: '', supportingText: '' },
      allowCTA: true,
    });
    expect(governedOverlay.headline).toBe('First sentence here.');
  });

  it('governance counts only non-empty fields', () => {
    const r = autoCorrectOverlayFields({ assetType: 'banner', fields: TEMPLATE_OVERLAY, allowCTA: true });
    expect(r.textBlocks).toHaveLength(4);
    expect(r.textBlocks).not.toContain('');
  });

  it('autoCorrectVisualCopy (list form) keeps its filtering contract for other callers', () => {
    const r = autoCorrectVisualCopy({ assetType: 'banner', textBlocks: ['', 'A', ''], allowCTA: true });
    expect(r.textBlocks).toEqual(['A']);
  });

  it('the image renderer uses the field-keyed governance, not positional indexes', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../services/creatorAssetRendererImage.ts'), 'utf8');
    expect(src).toContain('governImageOverlayText(');
    expect(src).not.toMatch(/hook:\s*safeBlocks\[0\]/);
    expect(src).not.toMatch(/headline:\s*safeBlocks\[1\]/);
  });
});
