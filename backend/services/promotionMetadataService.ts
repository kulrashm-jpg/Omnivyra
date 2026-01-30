import { savePromotionMetadata } from '../db/platformPromotionStore';
import { getCampaignMemory } from './campaignMemoryService';
import { detectContentOverlap } from './contentOverlapService';
import { getPromotionMetadata, isOmniVyraEnabled } from './omnivyraClientV1';
import { setLastFallbackReason } from './omnivyraHealthService';

const toKeywords = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((t) => t.trim())
    .filter((t) => t.length > 3)
    .slice(0, 6);

const normalizeConfidence = (value: any): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value <= 1) return Math.round(value * 100);
    return Math.round(value);
  }
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
    const num = Number(value);
    if (num <= 1) return Math.round(num * 100);
    return Math.round(num);
  }
  return 0;
};

export async function generatePromotionMetadata(input: {
  companyId: string;
  contentAssetId: string;
  platform: string;
  content: { headline?: string; caption?: string; hook?: string; callToAction?: string };
}): Promise<any> {
  let fallbackReason: string | null = null;
  if (isOmniVyraEnabled()) {
    const response = await getPromotionMetadata({
      companyId: input.companyId,
      contentAssetId: input.contentAssetId,
      platform: input.platform,
      content: input.content,
    });
    if (response.status === 'ok') {
      const data = response.data || {};
      const metadata = {
        content_asset_id: input.contentAssetId,
        platform: input.platform,
        hashtags: data.hashtags ?? [],
        keywords: data.keywords ?? [],
        seo_title: data.seo_title ?? '',
        seo_description: data.seo_description ?? '',
        meta_tags: data.meta_tags ?? [],
        alt_text: data.alt_text ?? '',
        cta: data.cta ?? input.content.callToAction ?? 'Learn more',
        confidence: normalizeConfidence(data.confidence ?? response.confidence),
        created_at: new Date().toISOString(),
      };
      const saved = await savePromotionMetadata(metadata);
      console.log('PROMOTION METADATA GENERATED', {
        assetId: input.contentAssetId,
        platform: input.platform,
        source: 'omnivyra',
      });
      return {
        ...saved,
        omnivyra: {
          decision_id: response.decision_id,
          confidence: response.confidence,
          placeholders: response.placeholders,
          explanation: response.explanation,
          contract_version: response.contract_version,
          partial: response.partial,
        },
        fallback_reason: null,
      };
    }
    fallbackReason = (response._omnivyra_meta?.error_type || 'omnivyra_unavailable') as string;
    setLastFallbackReason(fallbackReason);
    console.warn('OMNIVYRA_FALLBACK_PROMOTION', { reason: response.error?.message });
  } else {
    fallbackReason = 'omnivyra_disabled';
    setLastFallbackReason(fallbackReason);
  }

  const baseText = [input.content.headline, input.content.caption, input.content.hook]
    .filter(Boolean)
    .join(' ');
  const keywords = toKeywords(baseText);
  const hashtags = keywords.map((k) => `#${k}`);
  const seo_title = input.content.headline ?? '';
  const seo_description = input.content.caption?.slice(0, 150) ?? '';
  const meta_tags = keywords.slice(0, 5);
  const alt_text = input.content.headline ?? input.content.caption ?? '';
  const cta = input.content.callToAction ?? 'Learn more';

  const memory = await getCampaignMemory({ companyId: input.companyId });
  const overlap = await detectContentOverlap({
    companyId: input.companyId,
    newProposedContent: [...hashtags, ...keywords, cta],
    campaignMemory: memory,
  });
  if (overlap.similarityScore > 0.6) {
    console.log('CONTENT OVERLAP DETECTED', overlap);
  }

  const metadata = {
    content_asset_id: input.contentAssetId,
    platform: input.platform,
    hashtags,
    keywords,
    seo_title,
    seo_description,
    meta_tags,
    alt_text,
    cta,
    confidence: Math.round(80 - overlap.similarityScore * 20),
    created_at: new Date().toISOString(),
  };

  await savePromotionMetadata(metadata);
  console.log('PROMOTION METADATA GENERATED', { assetId: input.contentAssetId, platform: input.platform });
  return { ...metadata, fallback_reason: fallbackReason };
}
