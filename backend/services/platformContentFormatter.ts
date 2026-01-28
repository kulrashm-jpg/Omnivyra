import { getRulesForPlatform } from './platformRulesService';
import { savePlatformVariant } from '../db/platformPromotionStore';
import { OmniVyraAdvisory } from './omnivyraAdapterService';

const truncate = (text: string, max?: number | null): string => {
  if (!max || text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
};

export async function formatPlatformContent(input: {
  contentAssetId: string;
  platform: string;
  contentType: string;
  content: { caption?: string; hook?: string; callToAction?: string };
  hashtags?: string[];
  omnivyraAdvisory?: OmniVyraAdvisory;
}): Promise<any> {
  const rule = await getRulesForPlatform({
    platform: input.platform,
    contentType: input.contentType,
    omnivyraAdvisory: input.omnivyraAdvisory,
  });

  const base = [input.content.hook, input.content.caption, input.content.callToAction]
    .filter(Boolean)
    .join(' ');
  const hashtagBlock = input.hashtags && input.hashtags.length > 0 ? `\n${input.hashtags.join(' ')}` : '';
  const formatted = truncate(`${base}${hashtagBlock}`, rule.max_length);
  const variant = await savePlatformVariant({
    content_asset_id: input.contentAssetId,
    platform: input.platform,
    formatted_content: formatted,
    character_count: formatted.length,
    media_placeholder: ['video', 'audio'].includes(input.contentType),
    compliance_status: 'warning',
    created_at: new Date().toISOString(),
  });

  console.log('PLATFORM VARIANTS CREATED', { assetId: input.contentAssetId, platform: input.platform });
  return { rule, variant };
}
