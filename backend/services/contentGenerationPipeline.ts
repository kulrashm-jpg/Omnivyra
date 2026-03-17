import { generateCampaignPlan, runCompletionWithOperation } from './aiGateway';
import { refineLanguageOutput } from './languageRefinementService';
import { getCachedBlueprint, setCachedBlueprint, type ContentBlueprint } from './contentBlueprintCache';
import {
  getContentBlueprintPromptWithFingerprint,
  CONTENT_MASTER_SYSTEM,
  PLATFORM_VARIANTS_SYSTEM,
  CONTENT_GENERATION_PROMPT_VERSION,
} from '../prompts';
import { validateContentBlueprint, validatePlatformVariants } from './aiOutputValidationService';
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
const VIDEO_TYPES = new Set(['video', 'reel', 'short', 'podcast']);
const CAROUSEL_TYPES = new Set(['carousel', 'slides']);
const ARTICLE_TYPES = new Set(['article', 'newsletter', 'blog']);
const THREAD_TYPES = new Set(['thread', 'tweetstorm']);

function getContentTypeCategory(ct: string): 'video' | 'carousel' | 'article' | 'thread' | 'post' {
  const t = ct.toLowerCase();
  if (VIDEO_TYPES.has(t)) return 'video';
  if (CAROUSEL_TYPES.has(t)) return 'carousel';
  if (ARTICLE_TYPES.has(t)) return 'article';
  if (THREAD_TYPES.has(t)) return 'thread';
  return 'post';
}

function getContentTypeSystemPrompt(category: 'video' | 'carousel' | 'article' | 'thread' | 'post'): string {
  switch (category) {
    case 'video':
      return `You are a video content strategist. Write a production guide for a creator to film. Output plain text structured as:
THEME: [1-sentence theme]
HOOK (opening 5 seconds): [punchy opening line or visual action]
KEY TALKING POINTS:
- [point 1]
- [point 2]
- [point 3]
B-ROLL SUGGESTIONS: [brief visual ideas]
CLOSING CTA: [what to say at the end]
Keep it concise and actionable for the creator.`;
    case 'carousel':
      return `You are a carousel content designer. Write slide-by-slide content. Output plain text structured as:
SLIDE 1 (Cover): [bold headline]
SLIDE 2: [key point]
SLIDE 3: [key point]
SLIDE 4: [key point]
SLIDE 5: [key point]
SLIDE 6 (optional): [key point]
SLIDE 7 (CTA): [call to action]
Each slide: max 15 words. Make each slide a standalone punchy statement.`;
    case 'article':
      return `You are a long-form content writer. Write a complete article with proper structure. Include a compelling headline, brief intro paragraph, 3-4 sections with subheadings, and a conclusion with CTA. Output plain text with clear section breaks. Target 500-700 words.`;
    case 'thread':
      return `You are a Twitter/X thread writer. Write a thread of 5-7 tweets. Format as:
1/ [opening hook tweet - must stop the scroll]
2/ [key insight]
3/ [key insight]
4/ [key insight]
5/ [key insight]
6/ [optional insight]
7/ [closing with CTA]
Each tweet: max 270 characters. Output plain text.`;
    default:
      return `Write publish-ready social media post content from the provided JSON context. Keep it neutral and non-platform-specific. Output plain text only. Max 180 words.`;
  }
}

function getContentTypeMaxWords(category: 'video' | 'carousel' | 'article' | 'thread' | 'post'): number {
  switch (category) {
    case 'article': return 700;
    case 'thread': return 350;
    case 'carousel': return 120;
    case 'video': return 200;
    default: return 180;
  }
}

const MAX_WORDS_MASTER = 180;
const MAX_WORDS_VARIANT = 120;
const X_CHAR_LIMIT = 280;
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
  const metaBase = { platform: nonEmpty(platform).toLowerCase() || 'unknown', formatting_applied: true as const };

  // If the AI already produced structured content (has newlines), trust and preserve it.
  // Only apply CTA ordering and basic line normalization.
  const hasStructure = adaptedContent.includes('\n');
  if (hasStructure) {
    // Collapse 3+ blank lines to 2; trim each line
    let structured = adaptedContent
      .split('\n')
      .map((line) => line.trimEnd())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    // For X/Twitter: ensure each sentence is on its own line
    if (rules.preferSentencePerLine) {
      const paragraphs = structured.split(/\n{2,}/);
      const lines: string[] = [];
      for (const para of paragraphs) {
        const paraLines = para.split('\n').map((l) => l.trim()).filter(Boolean);
        for (const line of paraLines) {
          const sents = splitIntoSentences(line);
          lines.push(...sents);
        }
        lines.push('');
      }
      structured = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    }

    // Enforce CTA at end if required
    if (rules.enforceCtaAtEnd) {
      const paras = structured.split(/\n{2,}/);
      if (paras.length > 1) {
        const ctaIdx = paras.findIndex(isLikelyCtaSentence);
        if (ctaIdx >= 0 && ctaIdx !== paras.length - 1) {
          const [cta] = paras.splice(ctaIdx, 1);
          paras.push(cta);
          structured = paras.join('\n\n');
        }
      }
    }

    return { content: structured, meta: metaBase };
  }

  // Flat content — fall back to sentence-splitting and grouping
  const sentences = splitIntoSentences(adaptedContent);
  if (sentences.length <= 1) {
    return { content: nonEmpty(adaptedContent), meta: metaBase };
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

  return { content: formatted.trim(), meta: metaBase };
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

/** Convert blueprint to full master text for backward compatibility. */
function blueprintToFullText(bp: ContentBlueprint): string {
  const body = Array.isArray(bp.key_points) && bp.key_points.length > 0
    ? bp.key_points.join('\n\n')
    : '';
  const parts = [nonEmpty(bp.hook), body, nonEmpty(bp.cta)].filter(Boolean);
  return parts.join('\n\n');
}

/** Truncate text to maxChars at word boundary. */
function truncateAtWordBoundary(text: string, maxChars: number): string {
  const s = String(text ?? '').trim();
  if (s.length <= maxChars) return s;
  const cut = s.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > maxChars * 0.6) return cut.slice(0, lastSpace).trim();
  return cut.trim();
}

/** Strip excessive hashtags (keep max 2 for X). */
function stripExcessiveHashtags(text: string, maxHashtags: number): string {
  const parts = String(text ?? '').split(/(\s+#\w+)/g);
  const hashtags: string[] = [];
  const rest: string[] = [];
  for (const p of parts) {
    if (/^\s*#\w+/.test(p)) {
      hashtags.push(p.trim());
    } else {
      rest.push(p);
    }
  }
  const kept = hashtags.slice(0, maxHashtags);
  return [...rest.filter(Boolean), ...kept].join(' ').replace(/\s+/g, ' ').trim();
}

/** Shorten long sentences for X (split by period, trim). */
function shortenSentences(text: string): string {
  return String(text ?? '')
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join('. ')
    .trim();
}

/** LinkedIn: full text, allow bullet formatting, maintain spacing. */
export function renderLinkedInVariant(masterText: string): string {
  return String(masterText ?? '').trim();
}

/** Extract CTA-like ending (last sentence often contains CTA). */
function extractCtaFromText(text: string): string | null {
  const s = String(text ?? '').trim();
  if (!s) return null;
  const sentences = s.split(/[.!?]+/).map((x) => x.trim()).filter(Boolean);
  if (sentences.length === 0) return null;
  const last = sentences[sentences.length - 1] ?? '';
  if (last.length < 10) return null;
  const ctaMarkers = ['learn more', 'book', 'contact', 'start', 'join', 'subscribe', 'follow', 'try', 'download', 'link in bio', 'click'];
  const lower = last.toLowerCase();
  if (ctaMarkers.some((m) => lower.includes(m))) return last;
  return null;
}

/** X/Twitter: truncate 280, remove excessive hashtags (>2), preserve CTA if truncated away. */
export function renderXVariant(masterText: string, cta?: string | null): string {
  let out = shortenSentences(masterText ?? '');
  out = stripExcessiveHashtags(out, 2);
  let result = truncateAtWordBoundary(out, X_CHAR_LIMIT);
  const extractedCta = cta ?? extractCtaFromText(masterText);
  if (extractedCta && !result.toLowerCase().includes(extractedCta.toLowerCase().slice(0, 20))) {
    const append = ` ${extractedCta}`.trim();
    const withCta = truncateAtWordBoundary(result + append, X_CHAR_LIMIT);
    if (withCta.length > result.length) result = withCta;
  }
  return result;
}

/** Instagram: append hashtags from discoverability, allow emoji. */
export function renderInstagramVariant(
  masterText: string,
  discoverabilityMeta?: DiscoverabilityMeta,
  maxLength?: number | null
): string {
  let out = String(masterText ?? '').trim();
  if (discoverabilityMeta?.hashtags?.length) {
    const tags = discoverabilityMeta.hashtags.slice(0, 8).join(' ');
    const candidate = `${out}\n\n${tags}`.trim();
    const limit = maxLength ?? 2200;
    out = candidate.length <= limit ? candidate : out;
  }
  return out;
}

/** Facebook: reuse LinkedIn variant (same format). */
export function renderFacebookVariant(masterText: string): string {
  return renderLinkedInVariant(masterText);
}

/**
 * Deterministic platform rendering rules.
 * LinkedIn → full text; X → truncate 280, strip hashtags, preserve CTA; Instagram → append hashtags; Facebook → LinkedIn.
 */
function renderDeterministicVariant(
  masterText: string,
  platform: string,
  maxLength?: number | null,
  discoverabilityMeta?: DiscoverabilityMeta,
  cta?: string | null
): string {
  const p = nonEmpty(platform).toLowerCase();
  if (p === 'linkedin') return renderLinkedInVariant(masterText);
  if (p === 'x' || p === 'twitter') return renderXVariant(masterText, cta);
  if (p === 'instagram') return renderInstagramVariant(masterText, discoverabilityMeta, maxLength);
  if (p === 'facebook') return renderFacebookVariant(masterText);
  if (maxLength && maxLength > 0) return truncateAtWordBoundary(masterText, maxLength);
  return String(masterText ?? '').trim();
}

/** Carousel: slide_1=hook, slide_2-4=key_points, slide_5=cta. */
export function renderCarouselFromBlueprint(bp: ContentBlueprint): string[] {
  const slides: string[] = [];
  if (nonEmpty(bp.hook)) slides.push(bp.hook);
  const pts = Array.isArray(bp.key_points) ? bp.key_points.filter(Boolean) : [];
  for (const pt of pts) slides.push(String(pt ?? '').trim());
  if (nonEmpty(bp.cta)) slides.push(bp.cta);
  return slides.length > 0 ? slides : [blueprintToFullText(bp)];
}

/** Short video script: intro=hook, body=key_points, ending=cta. */
export function renderVideoScriptFromBlueprint(bp: ContentBlueprint): string {
  const intro = nonEmpty(bp.hook) ? `[INTRO]\n${bp.hook}` : '';
  const body = Array.isArray(bp.key_points) && bp.key_points.length > 0
    ? `[BODY]\n${bp.key_points.map((p) => `• ${p}`).join('\n')}`
    : '';
  const ending = nonEmpty(bp.cta) ? `[ENDING]\n${bp.cta}` : '';
  const parts = [intro, body, ending].filter(Boolean);
  return parts.length > 0 ? parts.join('\n\n') : blueprintToFullText(bp);
}

/** Platforms that can be derived deterministically from LinkedIn-style full text. */
const DETERMINISTIC_DERIVABLE = new Set(['x', 'twitter', 'facebook', 'instagram']);

/** Check if platform can use deterministic rendering from a source (e.g. linkedin). */
function canDeriveDeterministically(platform: string): boolean {
  return DETERMINISTIC_DERIVABLE.has(nonEmpty(platform).toLowerCase());
}

/**
 * Generates structured content blueprint (hook, key_points, cta) instead of full master content.
 * Lighter AI call; used for two-stage pipeline.
 */
export async function generateContentBlueprint(item: DailyExecutionItemLike): Promise<ContentBlueprint> {
  const companyId = nonEmpty((item as any)?.company_id) || 'default';
  const theme = nonEmpty(item.topic) || nonEmpty(item.title) || 'TBD';
  const contentType = nonEmpty(item.content_type).toLowerCase() || 'post';
  const intent = asObject(item.intent);
  const brief = asObject(item.writer_content_brief);
  const audience =
    nonEmpty(intent?.target_audience) ||
    nonEmpty(brief?.whoAreWeWritingFor) ||
    'General audience';

  const cached = getCachedBlueprint(companyId, theme, contentType, audience);
  if (cached) return cached;

  const contextPayload = {
    topic: theme,
    objective: nonEmpty(intent?.objective) || nonEmpty(brief?.whatShouldReaderLearn) || 'TBD objective',
    target_audience: audience,
    pain_point: nonEmpty(intent?.pain_point) || nonEmpty(brief?.whatProblemAreWeAddressing) || 'Audience challenge',
    outcome_promise: nonEmpty(intent?.outcome_promise) || nonEmpty(brief?.expectedOutcome) || 'Clear improvement',
    tone: nonEmpty(brief?.narrativeStyle) || nonEmpty(brief?.toneGuidance) || 'Neutral, practical',
    cta_type: nonEmpty(intent?.cta_type) || 'Soft CTA',
    key_points: Array.isArray(brief?.key_points)
      ? (brief.key_points as unknown[]).map((v) => nonEmpty(v)).filter(Boolean)
      : [],
  };

  const { content: systemPrompt, template_name, template_version, template_hash } = getContentBlueprintPromptWithFingerprint();
  console.info('Prompt executed', { prompt: 'content_blueprint', version: CONTENT_GENERATION_PROMPT_VERSION });
  const result = await runCompletionWithOperation({
    companyId: null,
    campaignId: null,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    operation: 'generateContentBlueprint',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify(contextPayload) },
    ],
    prompt_template_name: template_name,
    prompt_template_version: template_version,
    prompt_template_hash: template_hash,
  });

  const raw = typeof result?.output === 'string' ? result.output : '';
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  let parsed: Partial<ContentBlueprint> = {};
  try {
    parsed = JSON.parse(trimmed || '{}');
  } catch {
    parsed = {};
  }

  const blueprint: ContentBlueprint = {
    hook: nonEmpty(parsed.hook) || `Topic: ${theme}`,
    key_points: Array.isArray(parsed.key_points)
      ? parsed.key_points.map((v) => String(v ?? '')).filter(Boolean)
      : [contextPayload.objective],
    cta: nonEmpty(parsed.cta) || '— Learn more when you\'re ready.',
  };

  // Blueprint → refined → master content assembly. No unrefined blueprint language propagates downstream.
  if (blueprint.hook) {
    const r = await refineLanguageOutput({
      content: blueprint.hook,
      card_type: 'master_content',
    });
    blueprint.hook = (r.refined as string) || blueprint.hook;
  }
  if (Array.isArray(blueprint.key_points) && blueprint.key_points.length > 0) {
    const r = await refineLanguageOutput({
      content: blueprint.key_points,
      card_type: 'master_content',
    });
    if (Array.isArray(r.refined)) {
      blueprint.key_points = r.refined;
    }
  }
  if (blueprint.cta) {
    const r = await refineLanguageOutput({
      content: blueprint.cta,
      card_type: 'master_content',
    });
    blueprint.cta = (r.refined as string) || blueprint.cta;
  }

  const validatedBlueprint = validateContentBlueprint(blueprint) ?? blueprint;
  setCachedBlueprint(companyId, theme, contentType, audience, validatedBlueprint);
  return validatedBlueprint;
}

/** Content quality guard: blueprint must have at least 2 key points and hook ≥ 6 words. */
export function isBlueprintQualitySufficient(bp: ContentBlueprint): boolean {
  const keyPointsOk = Array.isArray(bp.key_points) && bp.key_points.length >= 2;
  const hookWords = String(bp.hook ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  const hookOk = hookWords >= 6;
  return keyPointsOk && hookOk;
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
    const ctCategory = getContentTypeCategory(nonEmpty(item?.content_type));
    const productionSystemPrompt = getContentTypeSystemPrompt(ctCategory);
    const productionContext = {
      topic,
      objective,
      core_message: coreMessage,
      target_audience: nonEmpty(intent?.target_audience) || nonEmpty((asObject(item?.writer_content_brief) as any)?.whoAreWeWritingFor) || 'Campaign audience',
      tone: nonEmpty((asObject(item?.writer_content_brief) as any)?.narrativeStyle) || nonEmpty(intent?.tone) || 'Professional and engaging',
      cta: nonEmpty(intent?.cta_type) || 'Follow for more',
      creator_instruction: nonEmpty((item as any)?.creatorInstruction) || nonEmpty((item as any)?.creator_instruction) || '',
    };
    try {
      const productionResult = await generateCampaignPlan({
        companyId: null,
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.3,
        messages: [
          { role: 'system', content: productionSystemPrompt },
          { role: 'user', content: JSON.stringify(productionContext) },
        ],
      });
      const productionContent = nonEmpty(productionResult?.output) || `[MEDIA BLUEPRINT]\nTopic: ${topic}\nObjective: ${objective}\nCore message: ${coreMessage}`;
      return {
        id: `master-${itemId}`,
        generated_at: nowIso,
        content: productionContent,
        generation_status: 'generated',
        generation_source: 'ai',
        content_type_mode: 'media_blueprint',
        required_media: true,
        media_status: 'missing',
        decision_trace: decisionTrace,
      };
    } catch {
      return {
        id: `master-${itemId}`,
        generated_at: nowIso,
        content: `[MEDIA BLUEPRINT]\nTopic: ${topic}\nObjective: ${objective}\nCore message: ${coreMessage}`,
        generation_status: 'generated',
        generation_source: 'ai',
        content_type_mode: 'media_blueprint',
        required_media: true,
        media_status: 'missing',
        decision_trace: decisionTrace,
      };
    }
  }

  const ctCategory = getContentTypeCategory(nonEmpty(item?.content_type));
  const contextPayload = {
    content_type: nonEmpty(item?.content_type).toLowerCase() || 'post',
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
    ...(typeof (item as any)?.extra_instruction === 'string' && (item as any).extra_instruction.trim()
      ? { additional_guidance: (item as any).extra_instruction.trim() }
      : {}),
  };

  const contentTypeSystemPrompt = getContentTypeSystemPrompt(ctCategory);
  const contentTypeMaxWords = getContentTypeMaxWords(ctCategory);

  try {
    const systemPrompt = contentTypeSystemPrompt;
    console.info('Prompt executed', { prompt: 'content_generation', version: CONTENT_GENERATION_PROMPT_VERSION, content_type: contextPayload.content_type });
    const aiResult = await generateCampaignPlan({
      companyId: null,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: JSON.stringify({ ...contextPayload, max_words: contentTypeMaxWords }),
        },
      ],
    });
    let aiContent = nonEmpty(aiResult?.output);
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
    const refinedMaster = await refineLanguageOutput({
      content: aiContent,
      card_type: 'master_content',
    });
    aiContent = (refinedMaster.refined as string) || aiContent;
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

/** Platform style hints for batch variant generation (structured). */
const PLATFORM_STYLE_MAP: Record<string, string> = {
  linkedin: 'Professional tone, clear structure, slightly longer form with practical insight.',
  facebook: 'Conversational voice, engagement-focused flow, short paragraphs.',
  x: 'Concise and punchy style, high information density.',
  twitter: 'Concise and punchy style, high information density.',
  instagram: 'Emotionally resonant and visually descriptive tone, hashtag-friendly ending.',
  youtube: 'Title + description orientation, SEO-friendly structure, include metadata hints naturally.',
};

/**
 * Generates platform variants in a single AI call. Returns map of "platform_contenttype" -> raw content.
 * Use when 2+ text-based targets to reduce token usage and latency.
 * @param masterContentOrBlueprints - Single master string or array of blueprints for batch (one call, batched outputs).
 */
async function generatePlatformVariantsInOneCall(
  masterContentOrBlueprints: string | ContentBlueprint[],
  targets: Array<{ platform: string; content_type: string; max_length?: number; discoverabilityMeta?: DiscoverabilityMeta }>,
  context: { writer_content_brief?: Record<string, unknown>; intent?: Record<string, unknown> }
): Promise<Record<string, string> | Array<Record<string, string>>> {
  const isBatch = Array.isArray(masterContentOrBlueprints);
  const blueprints = isBatch ? (masterContentOrBlueprints as ContentBlueprint[]) : null;
  const masterContent = isBatch
    ? (blueprints as ContentBlueprint[]).map((bp) => blueprintToFullText(bp)).join('\n\n---\n\n')
    : (masterContentOrBlueprints as string);
  if (targets.length === 0) return isBatch ? [] : {};
  if (targets.length === 0) return {};
  const platformConfig = targets.map((t) => ({
    key: `${t.platform}_${t.content_type}`,
    platform: t.platform,
    content_type: t.content_type,
    style: PLATFORM_STYLE_MAP[t.platform] ?? 'Neutral adaptation with clear readability.',
    max_chars: t.max_length ?? null,
    hashtags: t.discoverabilityMeta?.hashtags?.slice(0, 5) ?? [],
  }));
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const systemPrompt = PLATFORM_VARIANTS_SYSTEM;
  console.info('Prompt executed', { prompt: 'platform_variants', version: CONTENT_GENERATION_PROMPT_VERSION });
  const result = await runCompletionWithOperation({
    companyId: null,
    campaignId: null,
    model,
    temperature: 0,
    response_format: { type: 'json_object' },
    operation: 'generatePlatformVariants',
    messages: [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: JSON.stringify(
          isBatch
            ? {
                batch_mode: true,
                content_pieces: (blueprints as ContentBlueprint[]).map((bp) => blueprintToFullText(bp)),
                platform_config: platformConfig,
                writer_brief: context.writer_content_brief ?? null,
                intent: context.intent ?? null,
                output_format: 'Object with keys "0","1",... — each value is { "platform_contenttype": "content" } per platform_config keys.',
              }
            : {
                master_content: masterContent,
                platform_config: platformConfig,
                writer_brief: context.writer_content_brief ?? null,
                intent: context.intent ?? null,
                output_format: Object.fromEntries(platformConfig.map((p) => [p.key, '<adapted content for this platform>'])),
              }
        ),
      },
    ],
  });
  const raw = typeof result?.output === 'string' ? result.output : '';
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try {
    const parsed = JSON.parse(trimmed || '{}');
    if (isBatch) {
      const items: Record<string, string>[] = [];
      for (let i = 0; i < (blueprints?.length ?? 0); i++) {
        const key = String(i);
        items.push((parsed[key] && typeof parsed[key] === 'object') ? parsed[key] : {});
      }
      return items;
    }
    return (parsed as Record<string, string>) || {};
  } catch {
    return isBatch ? [] : {};
  }
}

/**
 * Renders platform variants from a content blueprint. Uses deterministic rules when possible:
 * LinkedIn → full text; X → truncate 280; Facebook → full; Instagram → append hashtags.
 * Uses AI only when deterministic transformation is insufficient (e.g. YouTube).
 */
export async function renderPlatformVariantsFromBlueprint(
  blueprint: ContentBlueprint,
  item: DailyExecutionItemLike
): Promise<PlatformVariantPayload[]> {
  const targets = resolvePlatformTargets(item);
  if (targets.length === 0) return [];

  const fullText = blueprintToFullText(blueprint);
  const masterPayload: MasterContentPayload = {
    id: `master-${sanitizeIdPart(item.execution_id || item.topic || 'item')}`,
    generated_at: new Date().toISOString(),
    content: fullText,
    generation_status: 'generated',
    generation_source: 'ai',
    content_type_mode: 'text',
  };

  const mediaTargets = targets.filter((t) => isMediaDependentContentType(t.content_type));
  const textTargets = targets.filter((t) => !isMediaDependentContentType(t.content_type));

  const built: PlatformVariantPayload[] = [];

  for (const target of mediaTargets) {
    const placeholder = await generatePlatformVariantFromMaster(masterPayload, target.platform, {
      content_type: target.content_type,
      max_length: target.max_length,
      generation_overrides: target.generation_overrides,
      writer_content_brief: asObject(item?.writer_content_brief) || undefined,
      intent: asObject(item?.intent) || undefined,
      discoverabilityMeta: undefined,
      existingMediaSearchIntent: undefined,
    });
    built.push(placeholder);
  }

  const deterministicTargets = textTargets.filter((t) => canDeriveDeterministically(t.platform));
  const aiTargets = textTargets.filter((t) => !canDeriveDeterministically(t.platform));

  for (const target of deterministicTargets) {
    const discoverabilityMeta = await optimizeDiscoverabilityForPlatform(
      fullText,
      target.platform,
      target.content_type
    );
    const rawContent = renderDeterministicVariant(
      fullText,
      target.platform,
      target.platform === 'x' || target.platform === 'twitter' ? X_CHAR_LIMIT : target.max_length,
      discoverabilityMeta,
      blueprint.cta ? String(blueprint.cta).trim() : null
    );
    let bounded = target.max_length ? rawContent.slice(0, target.max_length) : rawContent;
    const formatted = applyAlgorithmicFormatting(bounded, target.platform);
    bounded = target.max_length ? formatted.content.slice(0, target.max_length) : formatted.content;
    const refined = await refineLanguageOutput({
      content: bounded,
      card_type: 'platform_variant',
      platform: target.platform,
    });
    bounded = (refined.refined as string) || bounded;
    bounded = target.max_length ? bounded.slice(0, target.max_length) : bounded;
    const mediaSearchIntent = buildMediaSearchIntent(
      target.platform,
      target.content_type,
      fullText,
      asObject(item?.intent) || null
    );
    built.push({
      platform: target.platform,
      content_type: target.content_type,
      generated_content: bounded,
      generation_status: 'generated',
      locked_variant: false,
      adapted_from_master: true,
      adaptation_style: 'platform_specific',
      requires_media: false,
      generation_overrides: target.generation_overrides,
      adaptation_trace: {
        platform: target.platform,
        style_strategy: 'deterministic',
        character_limit_used: target.platform === 'x' || target.platform === 'twitter' ? X_CHAR_LIMIT : target.max_length ?? null,
        target_length_used: null,
        actual_length_used: bounded.length,
        format_family: 'text',
        media_constraints_applied: false,
        adaptation_reason: `Deterministic: ${target.platform} from blueprint.`,
      },
      discoverability_meta: discoverabilityMeta,
      algorithmic_formatting_meta: formatted.meta,
      media_intent: getMediaIntentDescriptor(target.platform),
      media_search_intent: mediaSearchIntent,
    });
  }

  if (aiTargets.length > 0) {
    const discoverabilityMetas = await Promise.all(
      aiTargets.map((t) => optimizeDiscoverabilityForPlatform(fullText, t.platform, t.content_type))
    );
    const aiTargetsWithMeta = aiTargets.map((t, i) => ({ ...t, discoverabilityMeta: discoverabilityMetas[i] }));
    const batchRaw =
      aiTargets.length >= 2
        ? await generatePlatformVariantsInOneCall(fullText, aiTargetsWithMeta, {
            writer_content_brief: asObject(item?.writer_content_brief) || undefined,
            intent: asObject(item?.intent) || undefined,
          })
        : null;

    for (let i = 0; i < aiTargets.length; i++) {
      const target = aiTargets[i]!;
      const discoverabilityMeta = discoverabilityMetas[i];
      const batchKey = `${target.platform}_${target.content_type}`;
      let rawContent: string | null =
        batchRaw && typeof batchRaw === 'object' && !Array.isArray(batchRaw)
          ? (batchRaw as Record<string, string>)[batchKey] ?? null
          : null;

      if (!rawContent && aiTargets.length === 1) {
        const single = await generatePlatformVariantFromMaster(masterPayload, target.platform, {
          content_type: target.content_type,
          max_length: target.max_length,
          generation_overrides: target.generation_overrides,
          writer_content_brief: asObject(item?.writer_content_brief) || undefined,
          intent: asObject(item?.intent) || undefined,
          discoverabilityMeta,
        });
        built.push(single);
        continue;
      }

      if (!rawContent) {
        const fallback = await generatePlatformVariantFromMaster(masterPayload, target.platform, {
          content_type: target.content_type,
          max_length: target.max_length,
          writer_content_brief: asObject(item?.writer_content_brief) || undefined,
          intent: asObject(item?.intent) || undefined,
          discoverabilityMeta,
        });
        built.push(fallback);
        continue;
      }

      const maxLength = toPositiveNumber(target.max_length);
      let bounded = maxLength ? rawContent.slice(0, maxLength) : rawContent;
      const formatted = applyAlgorithmicFormatting(bounded, target.platform);
      bounded = maxLength ? formatted.content.slice(0, maxLength) : formatted.content;
      const refined = await refineLanguageOutput({
        content: bounded,
        card_type: 'platform_variant',
        platform: target.platform,
      });
      bounded = (refined.refined as string) || bounded;
      bounded = maxLength ? bounded.slice(0, maxLength) : bounded;
      const mediaSearchIntent = buildMediaSearchIntent(
        target.platform,
        target.content_type,
        fullText,
        asObject(item?.intent) || null
      );
      built.push({
        platform: target.platform,
        content_type: target.content_type,
        generated_content: bounded,
        generation_status: 'generated',
        locked_variant: false,
        adapted_from_master: true,
        adaptation_style: 'platform_specific',
        requires_media: false,
        generation_overrides: target.generation_overrides,
        adaptation_trace: {
          platform: target.platform,
          style_strategy: PLATFORM_STYLE_MAP[target.platform] ?? 'AI adaptation',
          character_limit_used: maxLength ?? null,
          target_length_used: maxLength ? Math.floor(maxLength * 0.9) : null,
          actual_length_used: bounded.length,
          format_family: 'text',
          media_constraints_applied: false,
          adaptation_reason: `AI-adapted for ${target.platform}.`,
        },
        discoverability_meta: discoverabilityMeta,
        algorithmic_formatting_meta: formatted.meta,
        media_intent: getMediaIntentDescriptor(target.platform),
        media_search_intent: mediaSearchIntent,
      });
    }
  }

  const validatedVariants = validatePlatformVariants(built);
  return validatedVariants;
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
          content: [
            'Rewrite the given MASTER CONTENT for the specified platform and content type.',
            'Keep meaning aligned to master content. Do not mention other platforms.',
            '',
            'FORMATTING RULES — apply based on the platform:',
            '- linkedin / facebook: Start with a single bold hook line (**Hook here**). Then short paragraphs of 1-2 sentences each, separated by a blank line. Emphasise key phrases with **bold**. End with a CTA line.',
            '- x / twitter: Each distinct thought on its own line. Separate groups of thoughts with a blank line. Max 280 characters total.',
            '- instagram: Short punchy paragraphs separated by blank lines. Hashtags on a separate line at the very end after a blank line.',
            '- youtube: Keyword-rich first sentence. Structured paragraphs separated by blank lines.',
            '- Default: Short readable paragraphs (2-3 sentences), each separated by a blank line.',
            '',
            'OUTPUT FORMAT: Plain text with blank lines between paragraphs. No markdown headers (no #). No bullet dashes (use • only if natural). Preserve line breaks.',
          ].join('\n'),
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
    const contentTypeFormatGuide: Record<string, string> = {
      article: 'Format as a structured article with clear sections, subheadings, and conclusion. Minimum 400 words.',
      newsletter: 'Format as an email newsletter with sections, subheadings, and a clear CTA at the end.',
      thread: 'Format as a Twitter/X thread: 5-7 tweets numbered 1/ through 7/. Each tweet max 270 chars.',
      post: 'Format as a single social post. Punchy, direct, max 3 paragraphs.',
      story: 'Format as quick visual story text overlay — very short, max 2 lines per frame.',
      carousel: 'Keep format as slide text (each slide: bold headline + 1-2 support lines).',
    };
    const formatGuide = contentTypeFormatGuide[contentType] ?? '';
    const aiContent = await requestVariant(
      `Rewrite the following MASTER CONTENT for platform "${normalizedPlatform}" and content_type "${contentType}". Style: ${styleInstruction}. ${formatGuide ? `Format: ${formatGuide}` : ''} ${
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
    const refinedVariant = await refineLanguageOutput({
      content: bounded,
      card_type: 'platform_variant',
      platform: normalizedPlatform,
    });
    bounded = (refinedVariant.refined as string) || bounded;
    bounded = maxLength ? bounded.slice(0, maxLength) : bounded;
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
    const existing = Array.isArray(item.platform_variants) ? item.platform_variants : [];
    return validatePlatformVariants(existing);
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

  const mediaTargets = targets.filter((t) => isMediaDependentContentType(t.content_type));
  const textTargets = targets.filter((t) => !isMediaDependentContentType(t.content_type));

  const built: PlatformVariantPayload[] = [];

  // Batch path: one AI call for all text-based platform variants (2+ targets)
  if (textTargets.length >= 1) {
    const discoverabilityMetas = await Promise.all(
      textTargets.map((t) =>
        optimizeDiscoverabilityForPlatform(nonEmpty(master?.content), t.platform, t.content_type)
      )
    );
    const textTargetsWithMeta = textTargets.map((t, i) => ({
      ...t,
      discoverabilityMeta: discoverabilityMetas[i],
    }));

    const batchRaw =
      textTargets.length >= 2
        ? await generatePlatformVariantsInOneCall(nonEmpty(master?.content) || '', textTargetsWithMeta, {
            writer_content_brief: asObject(item?.writer_content_brief) || undefined,
            intent: asObject(item?.intent) || undefined,
          })
        : null;

    for (let i = 0; i < textTargets.length; i++) {
      const target = textTargets[i]!;
      const discoverabilityMeta = discoverabilityMetas[i];
      const key = `${target.platform}::${target.content_type}`;
      const batchKey = `${target.platform}_${target.content_type}`;
      const existingVariant = existingByKey.get(key);

      if (existingVariant?.locked_variant) {
        built.push(existingVariant);
        continue;
      }

      let rawContent: string | null = null;
      if (batchRaw && batchRaw[batchKey]) {
        rawContent = nonEmpty(batchRaw[batchKey]);
      }
      if (!rawContent && textTargets.length === 1) {
        try {
          const single = await generatePlatformVariantFromMaster(master, target.platform, {
            content_type: target.content_type,
            max_length: target.max_length,
            generation_overrides: target.generation_overrides,
            writer_content_brief: asObject(item?.writer_content_brief) || undefined,
            intent: asObject(item?.intent) || undefined,
            discoverabilityMeta,
            existingMediaSearchIntent: existingVariant?.media_search_intent,
          });
          built.push(single);
        } catch {
          const fallbackVariant =
            existingVariant ??
            existing.find(
              (v) =>
                nonEmpty(v?.platform).toLowerCase() === target.platform &&
                nonEmpty(v?.content_type).toLowerCase() === target.content_type
            );
          if (fallbackVariant) {
            built.push(fallbackVariant);
          } else {
            built.push({
              platform: target.platform,
              content_type: target.content_type,
              generated_content: '[PLATFORM ADAPTATION FAILED]\nBased on master content.',
              generation_status: 'failed',
              locked_variant: false,
              adapted_from_master: true,
              adaptation_style: 'platform_specific',
              requires_media: false,
              generation_overrides: target.generation_overrides,
              adaptation_trace: {
                platform: target.platform,
                style_strategy: PLATFORM_STYLE_MAP[target.platform] ?? 'Neutral',
                character_limit_used: target.max_length ?? null,
                target_length_used: null,
                actual_length_used: null,
                format_family: 'text',
                media_constraints_applied: false,
                adaptation_reason: `Adaptation failed for ${target.platform}.`,
              },
            });
          }
        }
        continue;
      }
      if (!rawContent) {
        let fallback: PlatformVariantPayload;
        try {
          fallback = await generatePlatformVariantFromMaster(master, target.platform, {
            content_type: target.content_type,
            max_length: target.max_length,
            generation_overrides: target.generation_overrides,
            writer_content_brief: asObject(item?.writer_content_brief) || undefined,
            intent: asObject(item?.intent) || undefined,
            discoverabilityMeta,
            existingMediaSearchIntent: existingVariant?.media_search_intent,
          });
        } catch {
          fallback = existingVariant && nonEmpty(existingVariant.generated_content).length > 0
            ? existingVariant
            : {
                platform: target.platform,
                content_type: target.content_type,
                generated_content: '[PLATFORM ADAPTATION FAILED]\nBased on master content.',
                generation_status: 'failed' as const,
                locked_variant: false,
                adapted_from_master: true,
                adaptation_style: 'platform_specific',
                requires_media: false,
                generation_overrides: target.generation_overrides,
                adaptation_trace: {
                  platform: target.platform,
                  style_strategy: PLATFORM_STYLE_MAP[target.platform] ?? 'Neutral',
                  character_limit_used: target.max_length ?? null,
                  target_length_used: null,
                  actual_length_used: null,
                  format_family: 'text',
                  media_constraints_applied: false,
                  adaptation_reason: `Adaptation failed for ${target.platform}.`,
                },
              };
        }
        built.push(
          fallback.generation_status === 'failed' && existingVariant && nonEmpty(existingVariant.generated_content).length > 0
            ? existingVariant
            : fallback
        );
        continue;
      }

      const maxLength = toPositiveNumber(target.max_length);
      let bounded = maxLength ? rawContent.slice(0, maxLength) : rawContent;
      const formatted = applyAlgorithmicFormatting(bounded, target.platform);
      bounded = maxLength ? formatted.content.slice(0, maxLength) : formatted.content;
      const refined = await refineLanguageOutput({
        content: bounded,
        card_type: 'platform_variant',
        platform: target.platform,
      });
      bounded = (refined.refined as string) || bounded;
      bounded = maxLength ? bounded.slice(0, maxLength) : bounded;

      const mediaSearchIntent =
        normalizeLegacyMediaSearchIntent(existingVariant?.media_search_intent) ||
        buildMediaSearchIntent(target.platform, target.content_type, nonEmpty(master?.content), asObject(item?.intent) || null);
      built.push({
        platform: target.platform,
        content_type: target.content_type,
        generated_content: bounded,
        generation_status: 'generated',
        locked_variant: false,
        adapted_from_master: true,
        adaptation_style: 'platform_specific',
        requires_media: false,
        generation_overrides: target.generation_overrides,
        adaptation_trace: {
          platform: target.platform,
          style_strategy: PLATFORM_STYLE_MAP[target.platform] ?? 'Neutral adaptation',
          character_limit_used: maxLength ?? null,
          target_length_used: maxLength ? Math.floor(maxLength * 0.9) : null,
          actual_length_used: bounded.length,
          format_family: 'text',
          media_constraints_applied: false,
          adaptation_reason: `Adapted from master for ${target.platform} (batch).`,
        },
        discoverability_meta: discoverabilityMeta,
        algorithmic_formatting_meta: formatted.meta,
        media_intent: getMediaIntentDescriptor(target.platform),
        media_search_intent: mediaSearchIntent,
      });
    }
  }

  // Media-dependent targets: placeholder (no AI)
  for (const target of mediaTargets) {
    const key = `${target.platform}::${target.content_type}`;
    const existingVariant = existingByKey.get(key);
    if (existingVariant?.locked_variant) {
      built.push(existingVariant);
      continue;
    }
    const placeholder = await generatePlatformVariantFromMaster(master, target.platform, {
      content_type: target.content_type,
      max_length: target.max_length,
      generation_overrides: target.generation_overrides,
      writer_content_brief: asObject(item?.writer_content_brief) || undefined,
      intent: asObject(item?.intent) || undefined,
      discoverabilityMeta: undefined,
      existingMediaSearchIntent: existingVariant?.media_search_intent,
    });
    built.push(placeholder);
  }

  // Preserve extra existing variants not represented by current targets.
  for (const variant of existing) {
    const key = `${nonEmpty(variant?.platform).toLowerCase()}::${nonEmpty(variant?.content_type).toLowerCase()}`;
    if (!built.some((v) => `${v.platform}::${v.content_type}` === key)) built.push(variant);
  }
  const validatedVariants = validatePlatformVariants(built);
  return validatedVariants;
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
      const isMedia = isMediaDependentContentType(item?.content_type);

      if (isMedia) {
        if (!existingMasterGenerated) {
          item.master_content = await generateMasterContentFromIntent(item);
        }
      } else {
        const useBlueprintFlow = !existingMasterGenerated;
        if (useBlueprintFlow) {
          const blueprint = await generateContentBlueprint(item);
          if (!isBlueprintQualitySufficient(blueprint)) {
            item.master_content = await generateMasterContentFromIntent(item);
            item.platform_variants = await buildPlatformVariantsFromMaster(item);
          } else {
          const fullText = blueprintToFullText(blueprint);
          const itemId = sanitizeIdPart(item.execution_id || item.title || item.topic || item.platform || 'daily-item');
          item.master_content = {
            id: `master-${itemId}`,
            generated_at: new Date().toISOString(),
            content: fullText,
            generation_status: 'generated',
            generation_source: 'ai',
            content_type_mode: 'text',
            decision_trace: {
              source_topic: nonEmpty(item.topic) || nonEmpty(item.title) || 'TBD',
              objective: nonEmpty(asObject(item.intent)?.objective) || 'TBD',
              pain_point: 'From blueprint',
              outcome_promise: 'From blueprint',
              writing_angle: 'From blueprint',
              tone_used: 'From blueprint',
              narrative_role: 'support',
              progression_step: null,
            },
          };
          item.platform_variants = await renderPlatformVariantsFromBlueprint(blueprint, item);
          }
        }
      }

      if (!existingMasterGenerated && !isMedia && !item.platform_variants) {
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
      if (item.master_content && isMedia) {
        item.master_content.content_type_mode = 'media_blueprint';
        item.master_content.required_media = true;
        item.master_content.media_status = mediaStatus ?? 'missing';
      }

      if (isMedia || existingMasterGenerated) {
        item.platform_variants = await buildPlatformVariantsFromMaster(item);
      }
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

