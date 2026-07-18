// WAVE3 (item 2): generateCampaignPlan import removed — the AI discoverability
// branch was deleted, so no LLM dependency remains in this module.
import { getDiscoverabilityTargets } from '../discoverabilityRules';
import { getMediaRequirements, getPlatformMediaSearchRule } from '../platformMediaSearchRules';
import {
  DISCOVERABILITY_STOPWORDS,
  nonEmpty,
  asObject,
  uniqueLimited,
} from './contentTypeHelpers';
import type { PlatformVariantPayload } from './types';

type DiscoverabilityMeta = NonNullable<PlatformVariantPayload['discoverability_meta']>;

export function tokenizeDiscoverability(text: string): string[] {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !DISCOVERABILITY_STOPWORDS.has(token));
}

export function buildKeywordClustersDeterministic(
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

export function normalizeHashtag(value: string): string {
  const token = nonEmpty(value)
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '');
  return token ? `#${token}` : '';
}

export function buildHashtagsFromClusters(
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

export function buildYouTubeTags(
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

export function buildDeterministicDiscoverabilityMeta(
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

export function appendHashtagsToVariantContent(
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

export function compactQueryPhrase(value: string, fallback: string, maxWords: number): string {
  const cleaned = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return fallback;
  return cleaned
    .split(' ')
    .slice(0, maxWords)
    .join(' ');
}

export function normalizeLegacyMediaSearchIntent(
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

export async function optimizeDiscoverabilityForPlatform(
  masterContent: string,
  platform: string,
  contentType: string
): Promise<DiscoverabilityMeta> {
  // WAVE3 (item 2): discoverability metadata is pure mechanical formatting
  // (hashtag/keyword derivation + platform-bounded limits) — not reasoning —
  // so it is now DETERMINISTIC-ONLY. The former AI branch was already gated
  // OFF by default (DISCOVERABILITY_OPTIMIZER_AI) and merely re-derived what
  // buildDeterministicDiscoverabilityMeta already produces, then re-clamped it
  // to the same limits. Removed the dead AI round-trip. Signature (async ⇒
  // Promise<DiscoverabilityMeta>) and output shape are unchanged.
  return buildDeterministicDiscoverabilityMeta(masterContent, platform, contentType);
}
