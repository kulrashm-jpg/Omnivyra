import { generateCampaignPlan } from './aiGateway';
import { getDiscoverabilityTargets } from './discoverabilityRules';
import { getAlgorithmicFormattingRules } from './platformAlgorithmFormattingRules';
import { getMediaIntentDescriptor } from './mediaIntentDescriptorRules';
import { getMediaRequirements, getPlatformMediaSearchRule } from './platformMediaSearchRules';

type GenerationStatus = 'pending' | 'generated' | 'failed';

export type MasterContentPayload = {
  id: string;
  generated_at: string;
  content: string;
  generation_status: GenerationStatus;
  generation_source: 'ai';
  content_type_mode?: 'text' | 'media_blueprint';
  required_media?: boolean;
  media_status?: 'missing' | 'ready';
  decision_trace?: {
    source_topic: string;
    objective: string;
    pain_point: string;
    outcome_promise: string;
    writing_angle: string;
    tone_used: string;
    narrative_role: string;
    progression_step: number | null;
  };
};

export type PlatformVariantPayload = {
  platform: string;
  content_type: string;
  generated_content: string;
  generation_status: GenerationStatus;
  locked_variant: boolean;
  adapted_from_master?: boolean;
  adaptation_style?: 'platform_specific';
  requires_media?: boolean;
  generation_overrides?: Record<string, unknown>;
  adaptation_trace?: {
    platform: string;
    style_strategy: string;
    character_limit_used: number | null;
    target_length_used?: number | null;
    actual_length_used?: number | null;
    format_family: string;
    media_constraints_applied: boolean;
    adaptation_reason: string;
  };
  discoverability_meta?: {
    optimized: boolean;
    strategy_source: 'ai' | 'deterministic';
    platform: string;
    content_type: string;
    hashtag_target: { min: number; max: number; recommended: number };
    keyword_clusters: {
      primary: string[];
      secondary: string[];
      intent_outcome: string[];
    };
    hashtags: string[];
    youtube_tags?: string[];
    generated_at: string;
  };
  algorithmic_formatting_meta?: {
    platform: string;
    formatting_applied: true;
  };
  media_intent?: {
    platform: string;
    recommended_type?: string;
    visual_goal?: string;
    visual_style?: string;
    text_overlay?: 'none' | 'optional' | 'recommended';
    aspect_ratio?: string;
    overlay_style?: string;
    thumbnail_style?: string;
    opening_scene_goal?: string;
    preview_frame_hint?: string;
  };
  media_search_intent?: {
    media_requirements: Array<{
      role: string;
      media_type: 'image' | 'video' | 'thumbnail' | 'illustration';
      required: boolean;
      orientation: 'portrait' | 'landscape' | 'square';
      primary_query: string;
      alternative_queries: string[];
      style_tags: string[];
      platform_reason: string;
    }>;
  };
};

export type MediaAssetPayload = {
  id?: string;
  type: string;
  source_url: string;
  status: 'attached';
};

type PlatformTarget = {
  platform: string;
  content_type: string;
  max_length?: number;
  generation_overrides?: Record<string, unknown>;
};

type DailyExecutionItemLike = {
  execution_id?: string;
  platform?: string;
  content_type?: string;
  topic?: string;
  title?: string;
  intent?: Record<string, unknown>;
  writer_content_brief?: Record<string, unknown>;
  active_platform_targets?: unknown;
  planned_platform_targets?: unknown;
  selected_platforms?: unknown;
  media_assets?: MediaAssetPayload[];
  media_status?: 'missing' | 'ready';
  master_content?: MasterContentPayload;
  platform_variants?: PlatformVariantPayload[];
  progression_step?: number | null;
  global_progression_index?: number | null;
  execution_readiness?: {
    text_ready: boolean;
    media_ready: boolean;
    platform_ready: boolean;
    discoverability_ready: boolean;
    algorithm_ready: boolean;
    ready_to_schedule: boolean;
    blocking_reasons: string[];
  };
  execution_jobs?: Array<{
    job_id: string;
    platform: string;
    content_type: string;
    variant_ref: string;
    ready_to_schedule: boolean;
    status: 'ready' | 'blocked';
    blocking_reasons: string[];
  }>;
};

const MEDIA_DEPENDENT_TYPES = new Set(['video', 'reel', 'short', 'carousel', 'slides', 'song']);
const DISCOVERABILITY_STOPWORDS = new Set([
  'about',
  'after',
  'again',
  'because',
  'between',
  'could',
  'would',
  'their',
  'there',
  'these',
  'those',
  'where',
  'which',
  'while',
  'with',
  'without',
  'into',
  'from',
  'that',
  'this',
  'have',
  'will',
  'your',
  'you',
  'they',
  'them',
  'what',
  'when',
  'been',
  'were',
  'using',
  'used',
  'just',
  'more',
  'than',
  'make',
  'made',
  'over',
  'under',
  'across',
  'toward',
  'towards',
  'into',
  'onto',
  'through',
  'plan',
  'content',
  'campaign',
]);

type DiscoverabilityMeta = NonNullable<PlatformVariantPayload['discoverability_meta']>;

function nonEmpty(value: unknown): string {
  return String(value ?? '').trim();
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function sanitizeIdPart(value: unknown): string {
  const raw = nonEmpty(value).toLowerCase();
  return raw.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}

function toPositiveNumber(value: unknown): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.floor(n);
}

function uniqueLimited(values: string[], limit: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = nonEmpty(value).toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= limit) break;
  }
  return out;
}

function tokenizeDiscoverability(text: string): string[] {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !DISCOVERABILITY_STOPWORDS.has(token));
}

function buildKeywordClustersDeterministic(
  masterContent: string,
  platform: string,
  contentType: string
): DiscoverabilityMeta['keyword_clusters'] {
  const tokens = tokenizeDiscoverability(`${masterContent} ${platform} ${contentType}`);
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
  const sorted = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([token]) => token);
  const primary = uniqueLimited(sorted.slice(0, 4), 4);
  const secondary = uniqueLimited(sorted.slice(4, 10), 6);
  const intentFallback = ['strategy', 'growth', 'outcome', 'results', 'execution', 'impact'];
  const intent_outcome = uniqueLimited([...sorted.slice(10, 14), ...intentFallback], 4);
  return { primary, secondary, intent_outcome };
}

function normalizeHashtag(value: string): string {
  const token = nonEmpty(value)
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '');
  return token ? `#${token}` : '';
}

function buildHashtagsFromClusters(
  clusters: DiscoverabilityMeta['keyword_clusters'],
  minCount: number,
  maxCount: number
): string[] {
  const seed = [...clusters.primary, ...clusters.secondary, ...clusters.intent_outcome];
  const hashtags = uniqueLimited(seed.map(normalizeHashtag).filter(Boolean), maxCount);
  if (hashtags.length >= minCount) return hashtags.slice(0, maxCount);
  const genericBoost = [
    '#marketing',
    '#contentstrategy',
    '#brandgrowth',
    '#digitalstrategy',
    '#audiencegrowth',
    '#leadgeneration',
    '#socialmedia',
    '#businessgrowth',
  ];
  return uniqueLimited([...hashtags, ...genericBoost], maxCount);
}

function buildYouTubeTags(
  clusters: DiscoverabilityMeta['keyword_clusters'],
  maxTags: number
): string[] {
  const seed = [...clusters.primary, ...clusters.secondary, ...clusters.intent_outcome];
  const expanded: string[] = [];
  for (const token of seed) {
    expanded.push(token);
    expanded.push(`${token} strategy`);
    expanded.push(`${token} tips`);
  }
  return uniqueLimited(expanded, maxTags);
}

function buildDeterministicDiscoverabilityMeta(
  masterContent: string,
  platform: string,
  contentType: string
): DiscoverabilityMeta {
  const targets = getDiscoverabilityTargets(platform);
  const clusters = buildKeywordClustersDeterministic(masterContent, platform, contentType);
  const hashtags = buildHashtagsFromClusters(clusters, targets.hashtagMin, targets.hashtagMax);
  return {
    optimized: true,
    strategy_source: 'deterministic',
    platform: nonEmpty(platform).toLowerCase(),
    content_type: nonEmpty(contentType).toLowerCase() || 'post',
    hashtag_target: {
      min: targets.hashtagMin,
      max: targets.hashtagMax,
      recommended: targets.hashtagRecommended,
    },
    keyword_clusters: clusters,
    hashtags,
    youtube_tags:
      nonEmpty(platform).toLowerCase() === 'youtube'
        ? buildYouTubeTags(clusters, targets.youtubeTagsMax || 50)
        : undefined,
    generated_at: new Date().toISOString(),
  };
}

function appendHashtagsToVariantContent(
  content: string,
  meta: DiscoverabilityMeta | undefined,
  maxLength?: number
): string {
  if (!meta || meta.hashtags.length === 0) return content;
  const candidate = `${content.trim()}\n\n${meta.hashtags.join(' ')}`.trim();
  if (!maxLength || candidate.length <= maxLength) return candidate;
  const available = Math.max(0, maxLength - content.trim().length - 2);
  if (available < 3) return content.slice(0, maxLength);
  const shortenedTags = meta.hashtags.join(' ').slice(0, available).trim();
  return `${content.trim()}\n\n${shortenedTags}`.trim();
}

function splitIntoSentences(text: string): string[] {
  return String(text || '')
    .replace(/\r/g, '')
    .split(/(?<=[.!?])\s+/g)
    .map((part) => nonEmpty(part))
    .filter(Boolean);
}

function isLikelyCtaSentence(sentence: string): boolean {
  const lower = nonEmpty(sentence).toLowerCase();
  if (!lower) return false;
  return (
    lower.includes('learn more') ||
    lower.includes('book') ||
    lower.includes('contact') ||
    lower.includes('start') ||
    lower.includes('join') ||
    lower.includes('subscribe') ||
    lower.includes('follow') ||
    lower.includes('try') ||
    lower.includes('download')
  );
}

export function applyAlgorithmicFormatting(
  adaptedContent: string,
  platform: string
): { content: string; meta: NonNullable<PlatformVariantPayload['algorithmic_formatting_meta']> } {
  const rules = getAlgorithmicFormattingRules(platform);
  const sentences = splitIntoSentences(adaptedContent);
  if (sentences.length <= 1) {
    return {
      content: nonEmpty(adaptedContent),
      meta: {
        platform: nonEmpty(platform).toLowerCase() || 'unknown',
        formatting_applied: true,
      },
    };
  }

  let ordered = [...sentences];
  if (rules.enforceCtaAtEnd) {
    const ctaIndex = ordered.findIndex(isLikelyCtaSentence);
    if (ctaIndex >= 0 && ctaIndex !== ordered.length - 1) {
      const [cta] = ordered.splice(ctaIndex, 1);
      ordered.push(cta);
    }
  }

  let formatted = '';
  if (rules.preferSentencePerLine) {
    formatted = ordered.join('\n');
  } else {
    const chunks: string[] = [];
    for (let i = 0; i < ordered.length; i += rules.maxSentencesPerParagraph) {
      const chunk = ordered.slice(i, i + rules.maxSentencesPerParagraph).join(' ');
      chunks.push(chunk);
    }
    formatted = chunks.join('\n\n');
  }

  return {
    content: formatted.trim(),
    meta: {
      platform: nonEmpty(platform).toLowerCase() || 'unknown',
      formatting_applied: true,
    },
  };
}

function compactQueryPhrase(value: string, fallback: string, maxWords: number): string {
  const cleaned = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return fallback;
  return cleaned
    .split(' ')
    .slice(0, maxWords)
    .join(' ');
}

function normalizeLegacyMediaSearchIntent(
  raw: unknown
): NonNullable<PlatformVariantPayload['media_search_intent']> | undefined {
  const obj = asObject(raw);
  if (!obj) return undefined;
  const requirementsRaw = (obj as any).media_requirements;
  if (Array.isArray(requirementsRaw)) {
    const normalized = requirementsRaw
      .map((entry) => {
        const row = asObject(entry);
        if (!row) return null;
        const primary = nonEmpty((row as any).primary_query);
        if (!primary) return null;
        return {
          role: nonEmpty((row as any).role) || 'primary_visual',
          media_type: (nonEmpty((row as any).media_type) || 'image') as 'image' | 'video' | 'thumbnail' | 'illustration',
          required: Boolean((row as any).required),
          orientation: (nonEmpty((row as any).orientation) || 'landscape') as 'portrait' | 'landscape' | 'square',
          primary_query: primary,
          alternative_queries: Array.isArray((row as any).alternative_queries)
            ? (row as any).alternative_queries.map((v: unknown) => nonEmpty(v)).filter(Boolean)
            : [],
          style_tags: Array.isArray((row as any).style_tags)
            ? (row as any).style_tags.map((v: unknown) => nonEmpty(v)).filter(Boolean)
            : [],
          platform_reason: nonEmpty((row as any).platform_reason),
        };
      })
      .filter(Boolean) as Array<NonNullable<PlatformVariantPayload['media_search_intent']>['media_requirements'][number]>;
    if (normalized.length > 0) return { media_requirements: normalized };
  }
  const legacyPrimary = nonEmpty((obj as any).primary_query);
  if (!legacyPrimary) return undefined;
  return {
    media_requirements: [
      {
        role: 'primary_visual',
        media_type: (nonEmpty((obj as any).media_type) || 'image') as 'image' | 'video' | 'thumbnail' | 'illustration',
        required: true,
        orientation: (nonEmpty((obj as any).orientation) || 'landscape') as 'portrait' | 'landscape' | 'square',
        primary_query: legacyPrimary,
        alternative_queries: Array.isArray((obj as any).alternative_queries)
          ? (obj as any).alternative_queries.map((v: unknown) => nonEmpty(v)).filter(Boolean)
          : [],
        style_tags: Array.isArray((obj as any).style_tags)
          ? (obj as any).style_tags.map((v: unknown) => nonEmpty(v)).filter(Boolean)
          : [],
        platform_reason: nonEmpty((obj as any).platform_reason),
      },
    ],
  };
}

export function buildMediaSearchIntent(
  platform: string,
  contentType: string,
  masterContent: string,
  intent?: Record<string, unknown> | null
): NonNullable<PlatformVariantPayload['media_search_intent']> {
  const rule = getPlatformMediaSearchRule(platform);
  const normalizedPlatform = nonEmpty(platform).toLowerCase() || 'unknown';
  const normalizedContentType = nonEmpty(contentType).toLowerCase() || 'post';
  const objective = compactQueryPhrase(
    nonEmpty(intent?.objective),
    compactQueryPhrase(masterContent, 'campaign objective', 8),
    8
  );
  const painPoint = compactQueryPhrase(nonEmpty(intent?.pain_point), 'audience pain point', 6);
  const outcomePromise = compactQueryPhrase(nonEmpty(intent?.outcome_promise), 'desired outcome', 6);
  const platformStyle = compactQueryPhrase(rule.style_tags.join(' '), 'clean visual style', 5);

  const requirements = getMediaRequirements(normalizedContentType, normalizedPlatform);
  const media_requirements = requirements.map((requirement) => {
    const base = `${objective} ${painPoint} ${outcomePromise} ${platformStyle} ${requirement.role} ${requirement.media_type}`.trim();
    const primary_query = compactQueryPhrase(
      base,
      `${normalizedPlatform} ${normalizedContentType} ${requirement.media_type} ${requirement.role}`,
      18
    );
    const alternative_queries = [
      compactQueryPhrase(
        `${objective} ${outcomePromise} ${requirement.role} ${rule.style_tags.join(' ')}`,
        primary_query,
        18
      ),
      compactQueryPhrase(
        `${painPoint} solution ${normalizedPlatform} ${normalizedContentType} ${requirement.media_type} ${requirement.role}`,
        primary_query,
        18
      ),
      compactQueryPhrase(
        `${normalizedPlatform} ${normalizedContentType} ${requirement.media_type} ${requirement.role} concept`,
        primary_query,
        18
      ),
    ]
      .filter(Boolean)
      .filter((q, idx, arr) => arr.findIndex((v) => v.toLowerCase() === q.toLowerCase()) === idx)
      .slice(0, 3);
    return {
      role: requirement.role,
      media_type: requirement.media_type,
      required: requirement.required,
      orientation: requirement.orientation,
      primary_query,
      alternative_queries,
      style_tags: rule.style_tags,
      platform_reason: rule.platform_reason,
    };
  });

  return { media_requirements };
}

function mediaTypeMatchesRequirement(
  assetTypeRaw: unknown,
  requiredType: 'image' | 'video' | 'thumbnail' | 'illustration'
): boolean {
  const assetType = nonEmpty(assetTypeRaw).toLowerCase();
  if (!assetType) return false;
  if (requiredType === 'video') return assetType.includes('video');
  if (requiredType === 'thumbnail') return assetType.includes('thumbnail') || assetType.includes('image');
  if (requiredType === 'illustration') return assetType.includes('illustration') || assetType.includes('image');
  return assetType.includes('image') || assetType.includes('thumbnail') || assetType.includes('illustration');
}

export function buildExecutionReadiness(item: DailyExecutionItemLike): {
  text_ready: boolean;
  media_ready: boolean;
  platform_ready: boolean;
  discoverability_ready: boolean;
  algorithm_ready: boolean;
  ready_to_schedule: boolean;
  blocking_reasons: string[];
} {
  const masterGenerated = nonEmpty(item?.master_content?.generation_status).toLowerCase() === 'generated';
  const variants = Array.isArray(item?.platform_variants) ? item.platform_variants : [];
  const preferredPlatform = nonEmpty(item?.platform).toLowerCase();
  const selectedVariant =
    variants.find((v) => nonEmpty(v?.platform).toLowerCase() === preferredPlatform) || variants[0];
  const hasVariant = Boolean(selectedVariant);

  const text_ready = masterGenerated && hasVariant;
  const platform_ready =
    Boolean(selectedVariant) &&
    nonEmpty(selectedVariant?.generation_status).toLowerCase() === 'generated' &&
    !nonEmpty(selectedVariant?.generated_content).includes('[PLATFORM ADAPTATION FAILED]');

  const discoverability_ready = Boolean(selectedVariant?.discoverability_meta);
  const algorithm_ready = Boolean(selectedVariant?.algorithmic_formatting_meta);

  const requirements = Array.isArray(selectedVariant?.media_search_intent?.media_requirements)
    ? selectedVariant!.media_search_intent!.media_requirements
    : [];
  const requiredMedia = requirements.filter((r) => r.required);
  const assets = Array.isArray(item?.media_assets) ? item!.media_assets! : [];
  const mediaNotRequired = requiredMedia.length === 0;
  const allRequiredPresent =
    mediaNotRequired ||
    requiredMedia.every((requirement) =>
      assets.some((asset) => mediaTypeMatchesRequirement(asset?.type, requirement.media_type))
    );
  const media_ready = allRequiredPresent;

  const blocking_reasons: string[] = [];
  if (!text_ready) blocking_reasons.push('text_not_ready');
  if (!platform_ready) blocking_reasons.push('platform_not_ready');
  if (!discoverability_ready) blocking_reasons.push('discoverability_not_ready');
  if (!algorithm_ready) blocking_reasons.push('algorithm_not_ready');
  if (!media_ready) blocking_reasons.push('missing_required_media');

  const ready_to_schedule =
    text_ready && media_ready && platform_ready && discoverability_ready && algorithm_ready;

  return {
    text_ready,
    media_ready,
    platform_ready,
    discoverability_ready,
    algorithm_ready,
    ready_to_schedule,
    blocking_reasons,
  };
}

export function buildExecutionJobsFromItem(item: DailyExecutionItemLike): Array<{
  job_id: string;
  platform: string;
  content_type: string;
  variant_ref: string;
  ready_to_schedule: boolean;
  status: 'ready' | 'blocked';
  blocking_reasons: string[];
}> {
  const variants = Array.isArray(item?.platform_variants) ? item.platform_variants : [];
  const readiness = item?.execution_readiness;
  const canSchedule = Boolean(readiness?.ready_to_schedule);
  const readinessBlocking = Array.isArray(readiness?.blocking_reasons) ? readiness!.blocking_reasons : [];
  const executionId = nonEmpty(item?.execution_id) || 'execution-item';

  return variants.map((variant) => {
    const platform = nonEmpty(variant?.platform).toLowerCase() || 'unknown';
    const contentType = nonEmpty(variant?.content_type).toLowerCase() || 'post';
    const ready_to_schedule = canSchedule && Boolean(variant);
    const status: 'ready' | 'blocked' = ready_to_schedule ? 'ready' : 'blocked';
    return {
      job_id: `${executionId}-${platform}`,
      platform,
      content_type: contentType,
      variant_ref: `${platform}::${contentType}`,
      ready_to_schedule,
      status,
      blocking_reasons: status === 'blocked' ? readinessBlocking : [],
    };
  });
}

export async function optimizeDiscoverabilityForPlatform(
  masterContent: string,
  platform: string,
  contentType: string
): Promise<DiscoverabilityMeta> {
  const deterministic = buildDeterministicDiscoverabilityMeta(masterContent, platform, contentType);
  const targets = getDiscoverabilityTargets(platform);
  const aiOptimizationEnabled = String(process.env.DISCOVERABILITY_OPTIMIZER_AI || '').toLowerCase() === 'true';
  if (!aiOptimizationEnabled) {
    return deterministic;
  }
  try {
    const aiResult = await generateCampaignPlan({
      companyId: null,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Generate discoverability metadata. Return JSON only with: keyword_clusters {primary:string[], secondary:string[], intent_outcome:string[]}, hashtags:string[], youtube_tags?:string[]. Keep hashtags platform-aware and bounded by requested limits.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            platform: nonEmpty(platform).toLowerCase(),
            content_type: nonEmpty(contentType).toLowerCase() || 'post',
            hashtag_target: {
              min: targets.hashtagMin,
              max: targets.hashtagMax,
              recommended: targets.hashtagRecommended,
            },
            youtube_tags_max: targets.youtubeTagsMax || 50,
            master_content: masterContent,
          }),
        },
      ],
    });
    const parsed = JSON.parse(nonEmpty(aiResult?.output) || '{}') as {
      keyword_clusters?: { primary?: unknown[]; secondary?: unknown[]; intent_outcome?: unknown[] };
      hashtags?: unknown[];
      youtube_tags?: unknown[];
    };
    const clusters: DiscoverabilityMeta['keyword_clusters'] = {
      primary: uniqueLimited((parsed.keyword_clusters?.primary || []).map((v) => String(v)), 6),
      secondary: uniqueLimited((parsed.keyword_clusters?.secondary || []).map((v) => String(v)), 8),
      intent_outcome: uniqueLimited((parsed.keyword_clusters?.intent_outcome || []).map((v) => String(v)), 6),
    };
    const hashtags = uniqueLimited(
      (parsed.hashtags || []).map((v) => normalizeHashtag(String(v))).filter(Boolean),
      targets.hashtagMax
    );
    const boundedHashtags =
      hashtags.length >= targets.hashtagMin
        ? hashtags
        : buildHashtagsFromClusters(
            {
              primary: clusters.primary.length > 0 ? clusters.primary : deterministic.keyword_clusters.primary,
              secondary: clusters.secondary.length > 0 ? clusters.secondary : deterministic.keyword_clusters.secondary,
              intent_outcome:
                clusters.intent_outcome.length > 0 ? clusters.intent_outcome : deterministic.keyword_clusters.intent_outcome,
            },
            targets.hashtagMin,
            targets.hashtagMax
          );
    const youtube_tags =
      nonEmpty(platform).toLowerCase() === 'youtube'
        ? uniqueLimited(
            (parsed.youtube_tags || []).map((v) => String(v)).filter(Boolean),
            targets.youtubeTagsMax || 50
          )
        : undefined;
    return {
      ...deterministic,
      strategy_source: 'ai',
      keyword_clusters: {
        primary: clusters.primary.length > 0 ? clusters.primary : deterministic.keyword_clusters.primary,
        secondary: clusters.secondary.length > 0 ? clusters.secondary : deterministic.keyword_clusters.secondary,
        intent_outcome:
          clusters.intent_outcome.length > 0 ? clusters.intent_outcome : deterministic.keyword_clusters.intent_outcome,
      },
      hashtags: boundedHashtags,
      youtube_tags: nonEmpty(platform).toLowerCase() === 'youtube'
        ? (youtube_tags && youtube_tags.length > 0 ? youtube_tags : deterministic.youtube_tags)
        : undefined,
      generated_at: new Date().toISOString(),
    };
  } catch (error) {
    console.warn('[content-generation-pipeline][discoverability-optimization-fallback]', {
      platform: nonEmpty(platform).toLowerCase(),
      content_type: nonEmpty(contentType).toLowerCase() || 'post',
      error: String(error),
    });
    return deterministic;
  }
}

export function isMediaDependentContentType(content_type: unknown): boolean {
  const normalized = nonEmpty(content_type).toLowerCase();
  return MEDIA_DEPENDENT_TYPES.has(normalized);
}

function hasValidAttachedMedia(item: DailyExecutionItemLike): boolean {
  const mediaAssets = Array.isArray(item?.media_assets) ? item.media_assets : [];
  let hasValidSource = false;
  for (const asset of mediaAssets) {
    const sourceUrl = nonEmpty(asset?.source_url);
    if (!sourceUrl) {
      console.warn('[content-generation-pipeline][media-asset-empty-source-url]', {
        execution_id: item.execution_id ?? null,
      });
      continue;
    }
    hasValidSource = true;
  }
  return hasValidSource;
}

export function resolveMediaStatus(item: DailyExecutionItemLike): 'missing' | 'ready' | undefined {
  const isMediaType = isMediaDependentContentType(item?.content_type);
  const mediaAssets = Array.isArray(item?.media_assets) ? item.media_assets : [];
  const hasValidSource = hasValidAttachedMedia(item);

  if (isMediaType) {
    if (mediaAssets.length === 0) {
      console.warn('[content-generation-pipeline][media-dependent-missing-assets]', {
        execution_id: item.execution_id ?? null,
        content_type: item.content_type ?? null,
      });
    }
    return hasValidSource ? 'ready' : 'missing';
  }

  if (mediaAssets.length > 0) {
    console.warn('[content-generation-pipeline][non-media-has-media-assets]', {
      execution_id: item.execution_id ?? null,
      content_type: item.content_type ?? null,
      media_assets_count: mediaAssets.length,
    });
  }
  return undefined;
}

function resolvePlatformTargets(item: DailyExecutionItemLike): PlatformTarget[] {
  const normalizeTarget = (input: unknown): PlatformTarget | null => {
    if (typeof input === 'string') {
      const platform = nonEmpty(input).toLowerCase();
      if (!platform) return null;
      return {
        platform,
        content_type: nonEmpty(item.content_type).toLowerCase() || 'post',
      };
    }
    const obj = asObject(input);
    if (!obj) return null;
    const platform = nonEmpty(obj.platform).toLowerCase();
    if (!platform) return null;
    return {
      platform,
      content_type: nonEmpty(obj.content_type).toLowerCase() || nonEmpty(item.content_type).toLowerCase() || 'post',
      max_length: toPositiveNumber(obj.max_length),
      generation_overrides: asObject(obj.generation_overrides) || undefined,
    };
  };

  const fromArray = (value: unknown): PlatformTarget[] => {
    const arr = Array.isArray(value) ? value : [];
    return arr.map(normalizeTarget).filter(Boolean) as PlatformTarget[];
  };

  const activeTargets = fromArray(item.active_platform_targets);
  if (activeTargets.length > 0) return activeTargets;

  const plannedTargets = fromArray(item.planned_platform_targets);
  if (plannedTargets.length > 0) return plannedTargets;

  // Compatibility fallback when explicit targets are absent.
  const selectedPlatforms = fromArray(item.selected_platforms);
  if (selectedPlatforms.length > 0) return selectedPlatforms;

  const fallbackPlatform = nonEmpty(item.platform).toLowerCase();
  if (!fallbackPlatform) return [];
  return [{ platform: fallbackPlatform, content_type: nonEmpty(item.content_type).toLowerCase() || 'post' }];
}

function buildVariantOnlyMasterFallback(item: DailyExecutionItemLike): MasterContentPayload {
  const itemId = sanitizeIdPart(item.execution_id || item.title || item.topic || item.platform || 'daily-item');
  const topic = nonEmpty(item.topic) || nonEmpty(item.title) || 'TBD topic';
  if (isMediaDependentContentType(item?.content_type)) {
    return {
      id: `master-${itemId}`,
      generated_at: new Date().toISOString(),
      content: `[MEDIA BLUEPRINT]\nTopic: ${topic}\nObjective: TBD objective\nCore message: TBD core message`,
      generation_status: 'generated',
      generation_source: 'ai',
      content_type_mode: 'media_blueprint',
      required_media: true,
      media_status: 'missing',
    };
  }
  return {
    id: `master-${itemId}`,
    generated_at: new Date().toISOString(),
    content: `[MASTER GENERATION FAILED — deterministic fallback]\nTopic: ${topic}`,
    generation_status: 'failed',
    generation_source: 'ai',
    content_type_mode: 'text',
  };
}

function isPlaceholderLikeContent(content: unknown): boolean {
  const text = nonEmpty(content);
  if (!text) return true;
  return (
    text.includes('[MASTER CONTENT PLACEHOLDER]') ||
    text.includes('[MEDIA BLUEPRINT]') ||
    text.includes('[MASTER GENERATION FAILED')
  );
}

export function isAiGeneratedMasterContent(master: unknown): boolean {
  const obj = asObject(master);
  if (!obj) return false;
  const status = nonEmpty(obj.generation_status).toLowerCase();
  if (status !== 'generated') return false;
  const content = nonEmpty(obj.content);
  return Boolean(content) && !isPlaceholderLikeContent(content);
}

export async function generateMasterContentFromIntent(item: DailyExecutionItemLike): Promise<MasterContentPayload> {
  const itemId = sanitizeIdPart(item.execution_id || item.title || item.topic || item.platform || 'daily-item');
  const nowIso = new Date().toISOString();

  const intent = asObject(item.intent);
  const brief = asObject(item.writer_content_brief);
  const topic = nonEmpty(item.topic) || nonEmpty(item.title) || nonEmpty(intent?.topic) || 'TBD topic';
  const objective =
    nonEmpty(intent?.objective) ||
    nonEmpty(brief?.whatShouldReaderLearn) ||
    nonEmpty(brief?.topicGoal) ||
    'TBD objective';
  const coreMessage =
    nonEmpty(intent?.outcome_promise) ||
    nonEmpty(intent?.pain_point) ||
    nonEmpty(brief?.whatProblemAreWeAddressing) ||
    'TBD core message';
  const decisionTrace: NonNullable<MasterContentPayload['decision_trace']> = {
    source_topic: topic,
    objective,
    pain_point:
      nonEmpty(intent?.pain_point) ||
      nonEmpty(brief?.whatProblemAreWeAddressing) ||
      'Audience challenge relevant to topic',
    outcome_promise:
      nonEmpty(intent?.outcome_promise) ||
      nonEmpty(brief?.expectedOutcome) ||
      'Clear measurable improvement for the audience',
    writing_angle:
      nonEmpty(brief?.messagingAngle) ||
      nonEmpty(brief?.topicGoal) ||
      nonEmpty(intent?.strategic_role) ||
      'Educational narrative aligned to weekly intent',
    tone_used:
      nonEmpty(brief?.narrativeStyle) ||
      nonEmpty(brief?.toneGuidance) ||
      'Neutral, clear, practical',
    narrative_role: nonEmpty((item as any)?.narrative_role) || 'support',
    progression_step: Number.isFinite(Number((item as any)?.progression_step))
      ? Number((item as any)?.progression_step)
      : null,
  };

  if (isMediaDependentContentType(item?.content_type)) {
    return {
      id: `master-${itemId}`,
      generated_at: nowIso,
      content: [
        '[MEDIA BLUEPRINT]',
        `Topic: ${topic}`,
        `Objective: ${objective}`,
        `Core message: ${coreMessage}`,
      ].join('\n'),
      generation_status: 'generated',
      generation_source: 'ai',
      content_type_mode: 'media_blueprint',
      required_media: true,
      media_status: 'missing',
      decision_trace: decisionTrace,
    };
  }

  const contextPayload = {
    topic,
    objective,
    target_audience:
      nonEmpty(intent?.target_audience) ||
      nonEmpty(brief?.whoAreWeWritingFor) ||
      'General audience aligned to campaign context',
    writing_angle:
      nonEmpty(brief?.messagingAngle) ||
      nonEmpty(brief?.topicGoal) ||
      nonEmpty(intent?.strategic_role) ||
      'Educational narrative aligned to weekly intent',
    pain_point:
      nonEmpty(intent?.pain_point) ||
      nonEmpty(brief?.whatProblemAreWeAddressing) ||
      'Audience challenge relevant to topic',
    outcome_promise:
      nonEmpty(intent?.outcome_promise) ||
      nonEmpty(brief?.expectedOutcome) ||
      'Clear measurable improvement for the audience',
    tone:
      nonEmpty(brief?.narrativeStyle) ||
      nonEmpty(brief?.toneGuidance) ||
      'Neutral, clear, practical',
    core_message: coreMessage,
    key_points: Array.isArray(brief?.key_points)
      ? (brief.key_points as unknown[]).map((v) => nonEmpty(v)).filter(Boolean)
      : [],
    cta_type: nonEmpty(intent?.cta_type) || 'Soft CTA',
    progression_step: Number.isFinite(Number(item?.progression_step)) ? Number(item.progression_step) : null,
    global_progression_index: Number.isFinite(Number(item?.global_progression_index))
      ? Number(item.global_progression_index)
      : null,
  };

  try {
    const aiResult = await generateCampaignPlan({
      companyId: null,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'Write publish-ready universal master content from the provided JSON context. Keep it neutral and non-platform-specific. Maintain weekly narrative intent. Output plain text only.',
        },
        {
          role: 'user',
          content: JSON.stringify(contextPayload),
        },
      ],
    });
    const aiContent = nonEmpty(aiResult?.output);
    if (!aiContent) {
      console.warn('[content-generation-pipeline][empty-ai-master-content]', {
        execution_id: item.execution_id ?? null,
      });
      return {
        id: `master-${itemId}`,
        generated_at: nowIso,
        content: `[MASTER GENERATION FAILED — deterministic fallback]\nTopic: ${topic}`,
        generation_status: 'failed',
        generation_source: 'ai',
        content_type_mode: 'text',
        decision_trace: decisionTrace,
      };
    }
    return {
      id: `master-${itemId}`,
      generated_at: nowIso,
      content: aiContent,
      generation_status: 'generated',
      generation_source: 'ai',
      content_type_mode: 'text',
      decision_trace: decisionTrace,
    };
  } catch (error) {
    console.warn('[content-generation-pipeline][ai-master-generation-failed]', {
      execution_id: item.execution_id ?? null,
      error: String(error),
    });
    return {
      id: `master-${itemId}`,
      generated_at: nowIso,
      content: `[MASTER GENERATION FAILED — deterministic fallback]\nTopic: ${topic}`,
      generation_status: 'failed',
      generation_source: 'ai',
      content_type_mode: 'text',
      decision_trace: decisionTrace,
    };
  }
}

export async function generatePlatformVariantFromMaster(
  master: MasterContentPayload,
  platform: string,
  constraints: {
    content_type?: string;
    max_length?: number;
    generation_overrides?: Record<string, unknown>;
    writer_content_brief?: Record<string, unknown>;
    intent?: Record<string, unknown>;
    discoverabilityMeta?: DiscoverabilityMeta;
    existingMediaSearchIntent?: unknown;
  } = {}
): Promise<PlatformVariantPayload> {
  const normalizedPlatform = nonEmpty(platform).toLowerCase() || 'unknown';
  const contentType = nonEmpty(constraints.content_type).toLowerCase() || 'post';
  const platformStyles: Record<string, string> = {
    linkedin: 'Professional tone, clear structure, slightly longer form with practical insight.',
    facebook: 'Conversational voice, engagement-focused flow, short paragraphs.',
    x: 'Concise and punchy style, high information density.',
    twitter: 'Concise and punchy style, high information density.',
    instagram: 'Emotionally resonant and visually descriptive tone, hashtag-friendly ending.',
    youtube: 'Title + description orientation, SEO-friendly structure, include metadata hints naturally.',
  };
  const styleInstruction = platformStyles[normalizedPlatform] || 'Neutral adaptation with clear readability.';
  const maxLength = toPositiveNumber(constraints.max_length);
  const targetLength = maxLength ? Math.floor(maxLength * 0.9) : null;
  const formatFamily =
    nonEmpty((constraints.writer_content_brief as any)?.format_requirements?.format_family) ||
    (isMediaDependentContentType(contentType) ? 'media_blueprint' : 'text');
  const adaptationTrace = {
    platform: normalizedPlatform,
    style_strategy: styleInstruction,
    character_limit_used: maxLength ?? null,
    target_length_used: targetLength,
    actual_length_used: null,
    format_family: formatFamily,
    media_constraints_applied: isMediaDependentContentType(contentType),
    adaptation_reason: `Adapted from master content for ${normalizedPlatform}.`,
  };
  if (isMediaDependentContentType(contentType)) {
    return {
      platform: normalizedPlatform,
      content_type: contentType,
      generated_content: '[PLATFORM MEDIA BLUEPRINT]\nUses shared media asset.\nWaiting for media link.',
      generation_status: 'generated',
      locked_variant: false,
      adapted_from_master: true,
      adaptation_style: 'platform_specific',
      requires_media: true,
      generation_overrides: constraints.generation_overrides,
      adaptation_trace: adaptationTrace,
    };
  }

  const masterContent = nonEmpty(master?.content);
  if (!masterContent) {
    console.warn('[content-generation-pipeline][missing-master-content]', {
      platform: normalizedPlatform,
      content_type: contentType,
    });
    return {
      platform: normalizedPlatform,
      content_type: contentType,
      generated_content: '[PLATFORM ADAPTATION FAILED]\nBased on master content.',
      generation_status: 'failed',
      locked_variant: false,
      adapted_from_master: true,
      adaptation_style: 'platform_specific',
      requires_media: false,
      generation_overrides: constraints.generation_overrides,
      adaptation_trace: adaptationTrace,
    };
  }

  if (!platformStyles[normalizedPlatform]) {
    console.warn('[content-generation-pipeline][unsupported-platform-style-default]', {
      platform: normalizedPlatform,
      content_type: contentType,
    });
  }

  const brief = constraints.writer_content_brief ?? {};
  const intent = constraints.intent ?? {};
  const buildUserPrompt = (instruction: string) =>
    JSON.stringify({
      instruction,
      max_length: maxLength ?? null,
      target_length: targetLength ?? null,
      length_policy: maxLength
        ? `Target around 90% of limit. Keep output between ${targetLength} and ${maxLength} characters.`
        : 'No strict max length provided.',
      master_content: masterContent,
      writer_content_brief: brief,
      intent,
      discoverability_meta: constraints.discoverabilityMeta || null,
    });

  const requestVariant = async (instruction: string): Promise<string> => {
    const aiResult = await generateCampaignPlan({
      companyId: null,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'Rewrite the given MASTER CONTENT for the specified platform and content type. Keep meaning aligned to master content, do not mention other platforms, and output plain text only.',
        },
        {
          role: 'user',
          content: buildUserPrompt(instruction),
        },
      ],
    });
    return nonEmpty(aiResult?.output);
  };

  try {
    const aiContent = await requestVariant(
      `Rewrite the following MASTER CONTENT for platform "${normalizedPlatform}" and content_type "${contentType}". Style: ${styleInstruction}. ${
        constraints.discoverabilityMeta?.hashtags?.length
          ? `Include discoverability hashtags naturally near the end. Preferred hashtags: ${constraints.discoverabilityMeta.hashtags.join(', ')}.`
          : ''
      }`
    );
    if (!aiContent) {
      console.warn('[content-generation-pipeline][empty-ai-platform-variant]', {
        platform: normalizedPlatform,
        content_type: contentType,
      });
      return {
        platform: normalizedPlatform,
        content_type: contentType,
        generated_content: '[PLATFORM ADAPTATION FAILED]\nBased on master content.',
        generation_status: 'failed',
        locked_variant: false,
        adapted_from_master: true,
        adaptation_style: 'platform_specific',
        requires_media: false,
        generation_overrides: constraints.generation_overrides,
        adaptation_trace: adaptationTrace,
      };
    }

    let bounded = maxLength ? aiContent.slice(0, maxLength) : aiContent;
    bounded = appendHashtagsToVariantContent(bounded, constraints.discoverabilityMeta, maxLength);
    const formatted = applyAlgorithmicFormatting(bounded, normalizedPlatform);
    bounded = maxLength ? formatted.content.slice(0, maxLength) : formatted.content;
    if (maxLength && targetLength && bounded.length < targetLength) {
      const expanded = await requestVariant(
        `Rewrite for platform "${normalizedPlatform}" and content_type "${contentType}" with richer promotional detail (CTA, hook, value) while staying <= ${maxLength} chars and targeting ~${targetLength} chars. Style: ${styleInstruction}`
      );
      const expandedBounded = nonEmpty(maxLength ? expanded.slice(0, maxLength) : expanded);
      if (expandedBounded.length > bounded.length) {
        bounded = expandedBounded;
      }
    }
    const traceWithLength = {
      ...adaptationTrace,
      actual_length_used: bounded.length,
    };
    const mediaSearchIntent =
      normalizeLegacyMediaSearchIntent(constraints.existingMediaSearchIntent) ||
      buildMediaSearchIntent(normalizedPlatform, contentType, masterContent, constraints.intent || null);
    return {
      platform: normalizedPlatform,
      content_type: contentType,
      generated_content: bounded,
      generation_status: 'generated',
      locked_variant: false,
      adapted_from_master: true,
      adaptation_style: 'platform_specific',
      requires_media: false,
      generation_overrides: constraints.generation_overrides,
      adaptation_trace: traceWithLength,
      discoverability_meta: constraints.discoverabilityMeta,
      algorithmic_formatting_meta: formatted.meta,
      media_intent: getMediaIntentDescriptor(normalizedPlatform),
      media_search_intent: mediaSearchIntent,
    };
  } catch (error) {
    console.warn('[content-generation-pipeline][ai-platform-adaptation-failed]', {
      platform: normalizedPlatform,
      content_type: contentType,
      error: String(error),
    });
    return {
      platform: normalizedPlatform,
      content_type: contentType,
      generated_content: '[PLATFORM ADAPTATION FAILED]\nBased on master content.',
      generation_status: 'failed',
      locked_variant: false,
      adapted_from_master: true,
      adaptation_style: 'platform_specific',
      requires_media: false,
      generation_overrides: constraints.generation_overrides,
      adaptation_trace: adaptationTrace,
    };
  }
}

export async function buildPlatformVariantsFromMaster(item: DailyExecutionItemLike): Promise<PlatformVariantPayload[]> {
  const targets = resolvePlatformTargets(item);
  if (targets.length === 0) {
    console.warn('[content-generation-pipeline][missing-platform-targets]', {
      execution_id: item.execution_id ?? null,
    });
    return Array.isArray(item.platform_variants) ? item.platform_variants : [];
  }

  if (!item.master_content) {
    console.warn('[content-generation-pipeline][missing-master-content]', {
      execution_id: item.execution_id ?? null,
    });
  }
  const master = item.master_content ?? buildVariantOnlyMasterFallback(item);
  const existing = Array.isArray(item.platform_variants) ? item.platform_variants : [];
  const existingByKey = new Map<string, PlatformVariantPayload>();
  for (const variant of existing) {
    const key = `${nonEmpty(variant?.platform).toLowerCase()}::${nonEmpty(variant?.content_type).toLowerCase()}`;
    if (key !== '::') existingByKey.set(key, variant);
  }

  const built: PlatformVariantPayload[] = [];
  for (const target of targets) {
    const key = `${target.platform}::${target.content_type}`;
    const existingVariant = existingByKey.get(key);
    if (existingVariant?.locked_variant) {
      built.push(existingVariant);
      continue;
    }

    const discoverabilityMeta =
      isMediaDependentContentType(target.content_type)
        ? undefined
        : await optimizeDiscoverabilityForPlatform(
            nonEmpty(master?.content),
            target.platform,
            target.content_type
          );

    const regenerated = await generatePlatformVariantFromMaster(master, target.platform, {
      content_type: target.content_type,
      max_length: target.max_length,
      generation_overrides: target.generation_overrides,
      writer_content_brief: asObject(item?.writer_content_brief) || undefined,
      intent: asObject(item?.intent) || undefined,
      discoverabilityMeta,
      existingMediaSearchIntent: existingVariant?.media_search_intent,
    });
    if (
      regenerated.generation_status === 'failed' &&
      existingVariant &&
      nonEmpty(existingVariant.generated_content).length > 0
    ) {
      built.push(existingVariant);
      continue;
    }
    built.push(regenerated);
  }

  // Preserve extra existing variants not represented by current targets.
  for (const variant of existing) {
    const key = `${nonEmpty(variant?.platform).toLowerCase()}::${nonEmpty(variant?.content_type).toLowerCase()}`;
    if (!built.some((v) => `${v.platform}::${v.content_type}` === key)) built.push(variant);
  }
  return built;
}

export async function attachGenerationPipelineToDailyItems(weeks: any[]): Promise<any[]> {
  const arr = Array.isArray(weeks) ? weeks : [];
  for (const week of arr) {
    const dailyItems: DailyExecutionItemLike[] = Array.isArray((week as any)?.daily_execution_items)
      ? ((week as any).daily_execution_items as DailyExecutionItemLike[])
      : [];

    for (const item of dailyItems) {
      const execution_id = nonEmpty(item?.execution_id) || null;
      if (!asObject(item?.intent)) {
        console.warn('[content-generation-pipeline][missing-intent]', { execution_id });
      }
      if (!asObject(item?.writer_content_brief)) {
        console.warn('[content-generation-pipeline][missing-writer-content-brief]', { execution_id });
      }

      const existingMaster = asObject(item?.master_content);
      const existingMasterGenerated = nonEmpty(existingMaster?.generation_status).toLowerCase() === 'generated';
      if (!existingMasterGenerated) {
        item.master_content = await generateMasterContentFromIntent(item);
      } else if (!Array.isArray(item?.platform_variants) || item.platform_variants.length === 0) {
        console.warn('[content-generation-pipeline][master-without-variants]', { execution_id });
      }
      if (
        String(item?.master_content?.generation_status || '').toLowerCase() === 'generated' &&
        !asObject(item?.master_content?.decision_trace)
      ) {
        console.warn('[content-generation-pipeline][missing-master-decision-trace]', { execution_id });
      }

      const mediaStatus = resolveMediaStatus(item);
      if (mediaStatus) {
        item.media_status = mediaStatus;
      }
      if (item.master_content && isMediaDependentContentType(item?.content_type)) {
        item.master_content.content_type_mode = 'media_blueprint';
        item.master_content.required_media = true;
        item.master_content.media_status = mediaStatus ?? 'missing';
      }

      item.platform_variants = await buildPlatformVariantsFromMaster(item);
      item.execution_readiness = buildExecutionReadiness(item);
      item.execution_jobs = buildExecutionJobsFromItem(item);
      const variants = Array.isArray(item?.platform_variants) ? item.platform_variants : [];
      for (const variant of variants) {
        if (String(variant?.generation_status || '').toLowerCase() === 'generated' && !asObject(variant?.adaptation_trace)) {
          console.warn('[content-generation-pipeline][missing-variant-adaptation-trace]', {
            execution_id,
            platform: variant?.platform ?? null,
            content_type: variant?.content_type ?? null,
          });
        }
      }
    }
  }
  return arr;
}

