export type ProviderTextValidationMode = 'embedded_copy' | 'supporting_visual' | 'legacy';

export type ProviderTextValidationResult = {
  ok: boolean;
  flags: string[];
  mode: ProviderTextValidationMode;
  confidence?: number;
  provider?: string;
};

export function detectTextRegions(input: {
  ocrText?: string | null;
  regionCount?: number;
  maxRegionDensity?: number;
  ctaTerms?: string[];
  confidence?: number;
  minConfidence?: number;
}): ProviderTextValidationResult {
  const flags: string[] = [];
  const text = String(input.ocrText || '').trim();
  const ctaTerms = input.ctaTerms ?? ['book', 'demo', 'buy', 'subscribe', 'learn more'];
  if (text.length > 0) flags.push('provider_visible_text_detected');
  if (/[^\x00-\x7F]{3,}/.test(text)) flags.push('provider_non_english_or_fake_glyphs');
  if ((input.maxRegionDensity ?? 0) > 0.18 || text.length > 80 || (input.regionCount ?? 0) > 8) {
    flags.push('provider_dense_text_block');
  }
  if (ctaTerms.some((term) => text.toLowerCase().includes(term))) {
    flags.push('provider_cta_text_detected');
  }
  if (text.length > 0 && typeof input.confidence === 'number' && input.confidence < (input.minConfidence ?? 0.62)) {
    flags.push('provider_ocr_confidence_below_threshold');
  }
  return { ok: flags.length === 0, flags, mode: 'legacy', confidence: input.confidence };
}

export function validateProviderImageTextSafety(input: {
  mode: ProviderTextValidationMode;
  providerReturnedImage: boolean;
  prompt: string;
  overlayText?: Record<string, unknown> | null;
  ocrText?: string | null;
  regionCount?: number;
  maxRegionDensity?: number;
  confidence?: number;
  minConfidence?: number;
  provider?: string;
}): ProviderTextValidationResult {
  const flags: string[] = [];
  const prompt = input.prompt.toLowerCase();
  const overlayHasText = Boolean(input.overlayText && Object.values(input.overlayText).some((value) => typeof value === 'string' && value.trim().length > 0));

  if (!prompt.includes('strictly avoid all visible text')) {
    flags.push('provider_prompt_missing_visible_text_ban');
  }
  if (input.mode === 'supporting_visual' && overlayHasText) {
    flags.push('supporting_visual_overlay_text_leak');
  }
  if (input.mode === 'supporting_visual' && /\b(cta|call to action|button)\b/i.test(input.prompt)) {
    flags.push('supporting_visual_cta_prompt_leak');
  }
  if (!input.providerReturnedImage) {
    flags.push('provider_image_unavailable_for_ocr');
  }
  const ocr = detectTextRegions({
    ocrText: input.ocrText,
    regionCount: input.regionCount,
    maxRegionDensity: input.maxRegionDensity,
    confidence: input.confidence,
    minConfidence: input.minConfidence,
  });
  flags.push(...ocr.flags);
  if (input.mode === 'supporting_visual' && ocr.flags.includes('provider_visible_text_detected')) {
    flags.push('supporting_visual_provider_text_rejected');
  }

  return {
    ok: flags.length === 0,
    flags,
    mode: input.mode,
    confidence: input.confidence,
    provider: input.provider,
  };
}
