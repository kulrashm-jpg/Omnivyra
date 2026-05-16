export type CreatorAccessibilityManifest = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  altText: string;
  readingOrder: string[];
  minFontSize: number;
  contrastRatio: number;
  screenReaderMetadata: Record<string, unknown>;
};

export function validateCreatorAccessibility(input: {
  altText?: string | null;
  readingOrder?: string[] | null;
  minFontSize?: number | null;
  contrastRatio?: number | null;
  locale?: string | null;
}): CreatorAccessibilityManifest {
  const errors: string[] = [];
  const warnings: string[] = [];
  const altText = String(input.altText || '').replace(/\s+/g, ' ').trim();
  const readingOrder = Array.isArray(input.readingOrder) ? input.readingOrder.map(String).filter(Boolean) : [];
  const minFontSize = Number(input.minFontSize ?? 0) || 0;
  const contrastRatio = Number(input.contrastRatio ?? 0) || 0;
  if (altText.length < 12) errors.push('alt_text_missing_or_too_short');
  if (readingOrder.length === 0) errors.push('reading_order_missing');
  if (minFontSize < 16) errors.push('minimum_typography_below_accessibility_floor');
  if (contrastRatio < 4.5) errors.push('wcag_contrast_below_aa');
  if (String(input.locale || '').toLowerCase().startsWith('ar') || String(input.locale || '').toLowerCase().startsWith('he')) {
    warnings.push('rtl_reading_order_requires_manual_review');
  }
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    altText,
    readingOrder,
    minFontSize,
    contrastRatio,
    screenReaderMetadata: {
      role: 'img',
      ariaLabel: altText,
      readingOrder,
      locale: input.locale ?? 'en',
    },
  };
}
