/**
 * weeklyPlatformEnrichment — Phase-2 Step-12.
 *
 * Deterministic per-platform/content-type enrichment (requirements,
 * formatting, caption/media expectations, aspect ratios, packaging,
 * execution constraints). Reference data only — routing decisions still
 * come from the centralized routing engine (passed in), no inline
 * creator/text/video branching here.
 */

interface PlatformSpec {
  char_limit: number | null;
  tone: string;
  format: string;
  media: string;
  aspect_ratios: string[];
  packaging: string;
}

const PLATFORM_SPEC: Record<string, PlatformSpec> = {
  linkedin:  { char_limit: 3000,  tone: 'Professional, insight-led', format: 'Hook → Value → CTA', media: 'image/doc optional', aspect_ratios: ['1.91:1', '1:1'], packaging: 'headline + body + hashtags' },
  instagram: { char_limit: 2200,  tone: 'Visual, aspirational',       format: 'Caption + hashtags',  media: 'image/carousel/reel required', aspect_ratios: ['1:1', '4:5', '9:16'], packaging: 'caption + 5-15 hashtags' },
  x:         { char_limit: 280,   tone: 'Punchy, conversational',     format: 'Single or thread',    media: 'optional', aspect_ratios: ['16:9', '1:1'], packaging: 'tweet / thread' },
  twitter:   { char_limit: 280,   tone: 'Punchy, conversational',     format: 'Single or thread',    media: 'optional', aspect_ratios: ['16:9', '1:1'], packaging: 'tweet / thread' },
  facebook:  { char_limit: 63206, tone: 'Community, friendly',         format: 'Story + question',    media: 'optional', aspect_ratios: ['1.91:1', '1:1'], packaging: 'post + link preview' },
  youtube:   { char_limit: 5000,  tone: 'Educational, narrative',      format: 'Script/description',  media: 'video required', aspect_ratios: ['16:9', '9:16'], packaging: 'title + description + tags' },
  tiktok:    { char_limit: 2200,  tone: 'Casual, trend-aware',         format: 'Hook-first short',    media: 'video required', aspect_ratios: ['9:16'], packaging: 'caption + sounds + hashtags' },
  pinterest: { char_limit: 500,   tone: 'Inspirational, keyword-rich', format: 'Idea pin',           media: 'image/carousel required', aspect_ratios: ['2:3', '9:16'], packaging: 'title + description' },
};

const DEFAULT_SPEC: PlatformSpec = {
  char_limit: null, tone: 'Platform-appropriate', format: 'Standard post',
  media: 'optional', aspect_ratios: ['1:1'], packaging: 'standard',
};

export interface PlatformEnrichment {
  platform_requirements: { max_characters: number | null; required_fields: string[] };
  formatting_rules: { tone: string; structure: string };
  caption_expectation: string;
  media_expectation: string;
  aspect_ratios: string[];
  packaging_expectation: string;
  execution_constraints: string[];
  score: number;
}

export function enrichPlatform(
  platform: string,
  contentType: string,
  routing: { asset_requirement?: string; execution_type?: string } | null,
): PlatformEnrichment {
  const p = String(platform || 'linkedin').toLowerCase();
  const spec = PLATFORM_SPEC[p] ?? DEFAULT_SPEC;
  const assetRequired = routing?.asset_requirement === 'REQUIRED';
  const constraints: string[] = [];
  if (spec.char_limit) constraints.push(`max_${spec.char_limit}_chars`);
  if (assetRequired) constraints.push('asset_required');
  if (routing?.execution_type === 'VIDEO_WORKFLOW') constraints.push('video_upload_required');

  // Completeness score: known platform spec + content-type known + routing present.
  let score = 0;
  if (PLATFORM_SPEC[p]) score += 60;
  if (contentType) score += 20;
  if (routing?.execution_type) score += 20;

  return {
    platform_requirements: {
      max_characters: spec.char_limit,
      required_fields: assetRequired ? ['copy', 'asset'] : ['copy'],
    },
    formatting_rules: { tone: spec.tone, structure: spec.format },
    caption_expectation: `${spec.tone}; ${spec.format}`,
    media_expectation: spec.media,
    aspect_ratios: spec.aspect_ratios,
    packaging_expectation: spec.packaging,
    execution_constraints: constraints,
    score: Math.min(100, score),
  };
}
