import type { ScheduleItem } from '../../types/activityWorkspace';

export type MasterContentDocumentPayload = {
  master_title: string;
  source_execution_id: string;
  platforms: string[];
  platform_variants: Record<string, { execution_id: string; status: 'PENDING' | 'GENERATED'; content?: string }>;
};

export type WorkspacePayloadWeekLike = {
  planning_adjustments_summary?: unknown;
  momentum_adjustments?: {
    momentum_transfer_strength?: string;
    narrative_recovery?: boolean;
    absorbed_from_week?: unknown;
    [key: string]: unknown;
  } | null;
  distribution_strategy?: string | null;
  week_extras?: { recovered_topics?: unknown[] } | null;
};

export type WorkspacePayload = WorkspacePayloadWeekLike & {
  campaignId?: string | null;
  companyId?: string | null;
  weekNumber?: number;
  day?: string;
  activityId?: string;
  title?: string;
  topic?: string;
  description?: string;
  dailyExecutionItem?: Record<string, unknown> | null;
  source?: 'daily' | 'weekly';
  schedules?: ScheduleItem[];
  repurposing_context?: unknown;
  master_content_document?: MasterContentDocumentPayload | null;
};

export type RefineChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export const ALL_PLATFORM_OPTIONS = ['linkedin', 'facebook', 'instagram', 'x', 'youtube', 'tiktok', 'reddit', 'pinterest'];

export const CONTENT_TYPE_OPTIONS_BY_PLATFORM: Record<string, string[]> = {
  linkedin: ['feed_post', 'article', 'white_paper', 'case_study', 'carousel', 'video', 'newsletter'],
  facebook: ['post', 'carousel', 'video', 'story', 'reel'],
  instagram: ['feed_post', 'carousel', 'reel', 'story', 'video'],
  x: ['tweet', 'thread', 'video', 'carousel'],
  youtube: ['video', 'short', 'description', 'live'],
  tiktok: ['video', 'short', 'carousel'],
  reddit: ['post', 'discussion', 'carousel'],
  pinterest: ['pin', 'carousel', 'video'],
};

export const VIDEO_CONTENT_TYPES = new Set(['video', 'short', 'reel', 'story', 'live', 'description']);

export function getContentTypeOptions(
  platform: string,
  normalizeKey: (value: unknown) => string
) {
  const key = normalizeKey(platform);
  const defaults = ['post', 'article', 'white_paper', 'video', 'carousel'];
  return CONTENT_TYPE_OPTIONS_BY_PLATFORM[key] || defaults;
}

export function isVideoContentType(ct: string, normalizeKey: (value: unknown) => string) {
  return VIDEO_CONTENT_TYPES.has(normalizeKey(ct));
}

export function getAddablePlatformsForContentType(
  contentType: string,
  normalizeKey: (value: unknown) => string
) {
  const ct = normalizeKey(contentType);
  const isVideo = isVideoContentType(ct, normalizeKey);
  return ALL_PLATFORM_OPTIONS.filter((platform) => {
    const options = getContentTypeOptions(platform, normalizeKey);
    if (!options.map(normalizeKey).includes(ct)) return false;
    if (isVideo && (platform === 'x' || platform === 'twitter')) return false;
    if (!isVideo && platform === 'youtube') return false;
    return true;
  });
}

export function buildScheduleRowsFromExecutionItem(
  item: Record<string, unknown>,
  existingSchedules: ScheduleItem[],
  normalizeKey: (value: unknown) => string
) {
  const existingByKey = new Map<string, ScheduleItem>();
  for (const row of existingSchedules) {
    const key = `${normalizeKey(row.platform)}::${normalizeKey(row.contentType)}`;
    existingByKey.set(key, row);
  }

  const targets: Array<{ platform: string; contentType: string }> = [];
  const addTarget = (platform: unknown, contentType: unknown) => {
    const p = normalizeKey(platform);
    const c = normalizeKey(contentType) || 'post';
    if (!p) return;
    if (!targets.some((t) => t.platform === p && t.contentType === c)) {
      targets.push({ platform: p, contentType: c });
    }
  };

  const variants = Array.isArray((item as any)?.platform_variants) ? (item as any).platform_variants : [];
  variants.forEach((v: any) => addTarget(v?.platform, v?.content_type));

  const activeTargets = Array.isArray((item as any)?.active_platform_targets) ? (item as any).active_platform_targets : [];
  activeTargets.forEach((t: any) => addTarget(t?.platform, t?.content_type));

  const plannedTargets = Array.isArray((item as any)?.planned_platform_targets) ? (item as any).planned_platform_targets : [];
  plannedTargets.forEach((t: any) => addTarget(t?.platform, t?.content_type));

  const selectedPlatforms = Array.isArray((item as any)?.selected_platforms) ? (item as any).selected_platforms : [];
  selectedPlatforms.forEach((platform: any) => addTarget(platform, (item as any)?.content_type));

  addTarget((item as any)?.platform, (item as any)?.content_type);

  if (targets.length === 0 && existingSchedules.length > 0) return existingSchedules;

  return targets.map((t, idx) => {
    const key = `${t.platform}::${t.contentType}`;
    const existing = existingByKey.get(key);
    return {
      id: existing?.id || `hydrated-${t.platform}-${t.contentType}-${idx}`,
      platform: t.platform,
      contentType: t.contentType,
      date: existing?.date || existingSchedules[0]?.date || '',
      time: existing?.time || existingSchedules[0]?.time || '09:00',
      status: existing?.status,
      description: existing?.description,
      title: existing?.title,
    };
  });
}

export function buildMarketingSupport(args: {
  platform: string;
  contentType: string;
  content: string;
  variant?: Record<string, unknown> | null;
  payload?: WorkspacePayload | null;
  normalizeKey: (value: unknown) => string;
}) {
  const { platform, contentType, content, variant, payload, normalizeKey } = args;
  const cleaned = String(content || '').trim();
  const platformKey = normalizeKey(platform);
  const typeKey = normalizeKey(contentType);
  const variantTrace = asObject((variant as any)?.adaptation_trace);
  const variantLimit = Number((variantTrace as any)?.character_limit_used);
  const defaultContentLimits: Record<string, number> = {
    'x::tweet': 280,
    'x::thread': 1800,
    'twitter::tweet': 280,
    'linkedin::feed_post': 3000,
    'linkedin::post': 3000,
    'facebook::post': 2000,
    'instagram::caption': 2200,
    'instagram::feed_post': 2200,
    'youtube::description': 5000,
    'youtube::video': 5000,
  };
  const fallbackContentLimit =
    defaultContentLimits[`${platformKey}::${typeKey}`] ||
    defaultContentLimits[`${platformKey}::post`] ||
    1200;
  const contentMax = Number.isFinite(variantLimit) && variantLimit > 0 ? variantLimit : fallbackContentLimit;
  const titleMax = platformKey === 'youtube' ? 100 : 80;
  const metaTitleMax = 60;
  const metaDescriptionMax = 160;
  const hashtagsMax = platformKey === 'instagram' ? 30 : platformKey === 'x' || platformKey === 'twitter' ? 10 : 8;
  const keywordsMax = 10;
  const targetRatio = 0.9;

  const sourceWords = Array.from(
    new Set(
      cleaned
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((w) => w.trim())
        .filter((w) => w.length >= 4)
    )
  );
  const sourceSentence = cleaned.replace(/\s+/g, ' ').trim();
  const fillTextAtTarget = (seed: string, max: number) => {
    const target = Math.max(1, Math.floor(max * targetRatio));
    let out = String(seed || '').replace(/\s+/g, ' ').trim();
    const source = sourceSentence || String(payload?.title || payload?.topic || 'Campaign content').trim();
    if (!out) out = source;
    if (out.length >= target) return out.slice(0, max).trim();
    const sourceTokens = source.split(/\s+/).filter(Boolean);
    let idx = 0;
    while (out.length < target && sourceTokens.length > 0) {
      out = `${out} ${sourceTokens[idx % sourceTokens.length]}`.trim();
      idx += 1;
    }
    return out.slice(0, max).trim();
  };
  const fillListAtTarget = (seeds: string[], maxCount: number, formatter?: (v: string) => string) => {
    const targetCount = Math.max(1, Math.ceil(maxCount * targetRatio));
    const cleanedSeeds = seeds
      .map((v) => normalizeKey(v).replace(/[^a-z0-9_]+/g, ''))
      .filter(Boolean);
    const values: string[] = [];
    for (const seed of cleanedSeeds) {
      if (!values.includes(seed)) values.push(seed);
    }
    for (const word of sourceWords) {
      if (values.length >= targetCount) break;
      if (!values.includes(word)) values.push(word);
    }
    const capped = values.slice(0, maxCount);
    return formatter ? capped.map(formatter) : capped;
  };

  const lines = cleaned
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const firstSentence =
    cleaned.split(/[.!?]/).map((p) => p.trim()).find(Boolean) ||
    lines[0] ||
    String(payload?.title || payload?.topic || 'Campaign content').trim();
  const title = fillTextAtTarget(firstSentence, titleMax);
  const metaTitle = fillTextAtTarget(`${title} | ${String(platform).toUpperCase()}`, metaTitleMax);
  const metaDescription = fillTextAtTarget(cleaned || title, metaDescriptionMax);
  const extractedHashtags = Array.from(
    new Set((cleaned.match(/#[A-Za-z0-9_]+/g) || []).map((tag) => tag.toLowerCase()))
  );
  const seededHashtags = [
    `#${normalizeKey(platform).replace(/[^a-z0-9]+/g, '') || 'social'}`,
    '#marketing',
    '#contentstrategy',
  ];
  const hashtags = fillListAtTarget(
    [...extractedHashtags, ...seededHashtags],
    hashtagsMax,
    (v) => (v.startsWith('#') ? v : `#${v}`)
  );
  const keywordSeed = `${payload?.topic || payload?.title || ''} ${title}`;
  const keywords = fillListAtTarget(
    keywordSeed
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((w) => w.trim())
      .filter((w) => w.length >= 4),
    keywordsMax
  );
  const cta =
    normalizeKey(platform) === 'linkedin'
      ? 'Ask a professional question to drive comments.'
      : normalizeKey(platform) === 'x'
        ? 'End with a concise action line and a hashtag.'
        : 'Use a clear CTA to encourage engagement or clicks.';

  return {
    title,
    metaTitle,
    metaDescription,
    hashtags,
    keywords,
    cta,
    limits: {
      contentMax,
      titleMax,
      metaTitleMax,
      metaDescriptionMax,
      hashtagsMax,
      keywordsMax,
    },
    utilization: {
      contentPct: contentMax > 0 ? Math.round((cleaned.length / contentMax) * 100) : null,
      titlePct: titleMax > 0 ? Math.round((title.length / titleMax) * 100) : null,
      metaTitlePct: metaTitleMax > 0 ? Math.round((metaTitle.length / metaTitleMax) * 100) : null,
      metaDescriptionPct: metaDescriptionMax > 0 ? Math.round((metaDescription.length / metaDescriptionMax) * 100) : null,
      hashtagsPct: hashtagsMax > 0 ? Math.round((hashtags.length / hashtagsMax) * 100) : null,
      keywordsPct: keywordsMax > 0 ? Math.round((keywords.length / keywordsMax) * 100) : null,
    },
  };
}
