import { detectTextRegions, validateProviderImageTextSafety } from '../../services/creatorImageTextValidation';

describe('provider image text validation', () => {
  it('flags supporting_visual overlay and CTA leakage', () => {
    const result = validateProviderImageTextSafety({
      mode: 'supporting_visual',
      providerReturnedImage: true,
      prompt: 'Strictly avoid all visible text. Add CTA energy through composition.',
      overlayText: { headline: 'Leaked headline' },
    });
    expect(result.ok).toBe(false);
    expect(result.flags).toEqual(expect.arrayContaining([
      'supporting_visual_overlay_text_leak',
      'supporting_visual_cta_prompt_leak',
    ]));
  });

  it('requires provider prompts to ban visible text', () => {
    const result = validateProviderImageTextSafety({
      mode: 'embedded_copy',
      providerReturnedImage: true,
      prompt: 'Create a polished background.',
      overlayText: null,
    });
    expect(result.ok).toBe(false);
    expect(result.flags).toContain('provider_prompt_missing_visible_text_ban');
  });

  it('OCR/text detection rejects hallucinated CTA and dense glyph regions', () => {
    const result = detectTextRegions({
      ocrText: 'BOOK A DEMO 你好你好你好',
      regionCount: 12,
      maxRegionDensity: 0.24,
    });
    expect(result.ok).toBe(false);
    expect(result.flags).toEqual(expect.arrayContaining([
      'provider_visible_text_detected',
      'provider_non_english_or_fake_glyphs',
      'provider_dense_text_block',
      'provider_cta_text_detected',
    ]));
  });
});
