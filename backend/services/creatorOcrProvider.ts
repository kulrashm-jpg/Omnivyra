import { createHash } from 'crypto';

export type CreatorOcrAssetType =
  | 'supporting_image'
  | 'banner'
  | 'infographic'
  | 'carousel'
  | 'brand_card'
  | 'pdf'
  | 'slider'
  | 'image';

export type CreatorOcrAttachmentMode = 'embedded_copy' | 'supporting_visual' | 'unknown';

export type CreatorOcrThresholds = {
  minConfidence: number;
  maxVisibleTextCharacters: number;
  maxTextRegions: number;
  maxDenseRegionRatio: number;
  rejectCta: boolean;
  requireProvider: boolean;
};

export type CreatorOcrRegion = {
  text: string;
  confidence: number;
  language?: string | null;
  bbox?: { x: number; y: number; width: number; height: number } | null;
};

export type CreatorOcrResult = {
  provider: 'external-http-ocr-v1' | 'unavailable';
  ok: boolean;
  confidence: number;
  text: string;
  regions: CreatorOcrRegion[];
  flags: string[];
  thresholds: CreatorOcrThresholds;
  imageHash?: string;
  checkedAt: string;
};

type ExternalOcrResponse = {
  text?: unknown;
  confidence?: unknown;
  regions?: unknown;
  language?: unknown;
};

function compact(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeAssetType(value: string): CreatorOcrAssetType {
  const normalized = compact(value).toLowerCase();
  if (
    normalized === 'supporting_image'
    || normalized === 'banner'
    || normalized === 'infographic'
    || normalized === 'carousel'
    || normalized === 'brand_card'
    || normalized === 'pdf'
    || normalized === 'slider'
    || normalized === 'image'
  ) {
    return normalized;
  }
  return 'image';
}

export function resolveCreatorOcrThresholds(input: {
  assetType: string;
  platform?: string | null;
  attachmentMode?: string | null;
}): CreatorOcrThresholds {
  const assetType = normalizeAssetType(input.assetType);
  const platform = compact(input.platform).toLowerCase();
  const mode = input.attachmentMode === 'supporting_visual' ? 'supporting_visual' : input.attachmentMode === 'embedded_copy' ? 'embedded_copy' : 'unknown';
  const visualFirst = platform === 'instagram' || mode === 'supporting_visual' || assetType === 'supporting_image';
  return {
    minConfidence: visualFirst ? 0.72 : 0.62,
    maxVisibleTextCharacters: mode === 'supporting_visual' ? 0 : assetType === 'pdf' ? 2000 : assetType === 'carousel' || assetType === 'slider' ? 420 : 180,
    maxTextRegions: mode === 'supporting_visual' ? 0 : assetType === 'pdf' ? 80 : assetType === 'carousel' || assetType === 'slider' ? 36 : 12,
    maxDenseRegionRatio: visualFirst ? 0.12 : 0.22,
    rejectCta: mode === 'supporting_visual' || assetType === 'supporting_image' || assetType === 'brand_card' || assetType === 'infographic',
    requireProvider: mode === 'supporting_visual',
  };
}

function normalizeRegions(value: unknown, fallbackText: string, fallbackConfidence: number): CreatorOcrRegion[] {
  if (!Array.isArray(value)) {
    return fallbackText ? [{ text: fallbackText, confidence: fallbackConfidence, language: null, bbox: null }] : [];
  }
  return value.map((item) => {
    const row = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const bbox = row.bbox && typeof row.bbox === 'object' ? row.bbox as Record<string, unknown> : null;
    return {
      text: compact(row.text),
      confidence: Math.max(0, Math.min(1, Number(row.confidence ?? fallbackConfidence) || 0)),
      language: typeof row.language === 'string' ? row.language : null,
      bbox: bbox ? {
        x: Number(bbox.x ?? 0) || 0,
        y: Number(bbox.y ?? 0) || 0,
        width: Number(bbox.width ?? 0) || 0,
        height: Number(bbox.height ?? 0) || 0,
      } : null,
    };
  }).filter((item) => item.text.length > 0);
}

export function validateCreatorOcrResult(input: {
  result: Pick<CreatorOcrResult, 'text' | 'regions' | 'confidence' | 'provider'>;
  thresholds: CreatorOcrThresholds;
}): { ok: boolean; flags: string[] } {
  const flags: string[] = [];
  const text = compact(input.result.text);
  const regionCount = input.result.regions.length;
  const denseRegionRatio = input.result.regions.filter((region) => compact(region.text).length > 48).length / Math.max(1, regionCount);
  const lower = text.toLowerCase();

  if (input.thresholds.requireProvider && input.result.provider === 'unavailable') flags.push('ocr_provider_required_unavailable');
  if (input.result.confidence < input.thresholds.minConfidence && text.length > 0) flags.push('ocr_confidence_below_threshold');
  if (text.length > input.thresholds.maxVisibleTextCharacters) flags.push('ocr_visible_text_exceeds_threshold');
  if (regionCount > input.thresholds.maxTextRegions) flags.push('ocr_region_count_exceeds_threshold');
  if (denseRegionRatio > input.thresholds.maxDenseRegionRatio) flags.push('ocr_dense_region_ratio_exceeds_threshold');
  if (/[^\x00-\x7F]{3,}/.test(text)) flags.push('ocr_non_english_or_fake_glyphs');
  if (/\b(book a demo|buy now|subscribe|learn more|click here|sign up|get started)\b/i.test(lower) && input.thresholds.rejectCta) {
    flags.push('ocr_cta_phrase_detected');
  }
  return { ok: flags.length === 0, flags };
}

export async function runCreatorOcr(input: {
  image: Buffer;
  assetType: string;
  platform?: string | null;
  attachmentMode?: string | null;
  mimeType?: string;
}): Promise<CreatorOcrResult> {
  const thresholds = resolveCreatorOcrThresholds(input);
  const endpoint = compact(process.env.CREATOR_OCR_ENDPOINT);
  const token = compact(process.env.CREATOR_OCR_API_KEY);
  const imageHash = createHash('sha256').update(input.image).digest('hex');
  if (!endpoint) {
    const result: CreatorOcrResult = {
      provider: 'unavailable',
      ok: !thresholds.requireProvider,
      confidence: 0,
      text: '',
      regions: [],
      flags: thresholds.requireProvider ? ['ocr_provider_required_unavailable'] : ['ocr_provider_unconfigured'],
      thresholds,
      imageHash,
      checkedAt: new Date().toISOString(),
    };
    return result;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      image_base64: input.image.toString('base64'),
      mime_type: input.mimeType ?? 'image/png',
      asset_type: input.assetType,
      platform: input.platform ?? null,
      attachment_mode: input.attachmentMode ?? null,
    }),
  });
  if (!response.ok) {
    const result: CreatorOcrResult = {
      provider: 'unavailable',
      ok: false,
      confidence: 0,
      text: '',
      regions: [],
      flags: [`ocr_provider_http_${response.status}`],
      thresholds,
      imageHash,
      checkedAt: new Date().toISOString(),
    };
    return result;
  }
  const body = await response.json().catch(() => ({})) as ExternalOcrResponse;
  const text = compact(body.text);
  const confidence = Math.max(0, Math.min(1, Number(body.confidence ?? 0) || 0));
  const regions = normalizeRegions(body.regions, text, confidence);
  const validation = validateCreatorOcrResult({
    result: { provider: 'external-http-ocr-v1', text, regions, confidence },
    thresholds,
  });
  return {
    provider: 'external-http-ocr-v1',
    ok: validation.ok,
    confidence,
    text,
    regions,
    flags: validation.flags,
    thresholds,
    imageHash,
    checkedAt: new Date().toISOString(),
  };
}
