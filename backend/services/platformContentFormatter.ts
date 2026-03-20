/**
 * Platform Content Formatter
 * Formats content for a specific platform + content type, then persists the variant.
 *
 * Text processing is delegated entirely to processContent() (unifiedContentProcessor).
 * This service only handles: content assembly (hook + caption + cta + hashtags) and DB persistence.
 */

import { getRulesForPlatform } from './platformRulesService';
import { savePlatformVariant } from '../db/platformPromotionStore';
import { processContent } from './unifiedContentProcessor';
import { OmniVyraAdvisory } from './omnivyraAdapterService';

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

  // Assemble raw content from structured fields
  const assembled = [input.content.hook, input.content.caption, input.content.callToAction]
    .filter(Boolean)
    .join('\n\n');

  // Process through the canonical pipeline (strips artifacts, refines language,
  // applies structural + visual formatting, enforces char limit sentence-aware)
  const { content: processed } = await processContent({
    content: assembled,
    platform: input.platform,
    content_type: input.contentType,
    card_type: 'platform_variant',
    enforce_char_limit: true,
  });

  // Append hashtag block after processing (hashtags are exempt from formatting pipeline)
  const hashtagBlock =
    input.hashtags && input.hashtags.length > 0 ? `\n${input.hashtags.join(' ')}` : '';
  const formatted = processed + hashtagBlock;

  const variant = await savePlatformVariant({
    content_asset_id: input.contentAssetId,
    platform: input.platform,
    formatted_content: formatted,
    character_count: formatted.length,
    media_placeholder: ['video', 'audio', 'reel', 'short'].includes(input.contentType),
    compliance_status: 'warning',
    created_at: new Date().toISOString(),
  });

  console.log('PLATFORM VARIANTS CREATED', {
    assetId: input.contentAssetId,
    platform: input.platform,
    char_count: formatted.length,
  });
  return { rule, variant };
}
