import { CompanyProfile } from './companyProfileService';
import { supabase } from '../db/supabaseClient';

export type PlatformExecutionDay = {
  date: string;
  platform: string;
  contentType: string;
  theme: string;
  placeholder: boolean;
  suggestedTime: string;
  reasoning: string;
  trendUsed?: string | null;
};

export type PlatformExecutionPlan = {
  weekNumber: number;
  days: PlatformExecutionDay[];
  frequencySummary: Record<string, number>;
  omnivyra?: any;
};

const PLATFORM_TIMES: Record<string, string> = {
  linkedin: '09:00',
  instagram: '19:00',
  x: '12:00',
  youtube: '18:00',
  blog: '08:00',
  tiktok: '20:00',
  podcast: '08:00',
};

const PLATFORM_CONTENT_TYPES: Record<string, string[]> = {
  linkedin: ['text', 'image', 'carousel'],
  instagram: ['image', 'carousel', 'video'],
  x: ['text', 'image'],
  youtube: ['video'],
  blog: ['blog', 'text'],
  tiktok: ['video'],
  podcast: ['audio'],
};

const CONTENT_TYPE_LIMITS: Record<string, number> = {
  blog: 2,
  video: 3,
  audio: 2,
  podcast: 2,
};

const normalizePlatform = (platform: string): string => {
  const lower = platform.trim().toLowerCase();
  if (lower === 'twitter') return 'x';
  return lower;
};

const tokenize = (value: string): string[] =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length > 2);

const buildAlignmentTokens = (profile: CompanyProfile, campaign: any): Set<string> => {
  const values = [
    ...(profile.content_themes_list || []),
    ...(profile.target_audience_list || []),
    ...(profile.goals_list || []),
    profile.content_themes,
    profile.target_audience,
    profile.goals,
    campaign?.objective,
  ].filter(Boolean) as string[];
  return new Set(values.flatMap((value) => tokenize(value)));
};

const pickTrend = (trends: string[], tokens: Set<string>): string | null => {
  for (const trend of trends) {
    const trendTokens = tokenize(trend);
    if (trendTokens.some((token) => tokens.has(token))) {
      return trend;
    }
  }
  return null;
};

const selectContentType = (
  platform: string,
  weekContentTypes?: Record<string, string[]>,
  contentTypeCounts?: Record<string, number>
): string => {
  const types = weekContentTypes?.[platform] || PLATFORM_CONTENT_TYPES[platform] || ['text'];
  const counts = contentTypeCounts || {};
  for (const type of types) {
    const limit = CONTENT_TYPE_LIMITS[type];
    if (!limit || (counts[type] ?? 0) < limit) {
      return type;
    }
  }
  return 'text';
};

export function buildPlatformExecutionPlan(input: {
  companyProfile: CompanyProfile;
  campaign: any;
  weekPlan: any;
  trends: string[];
}): PlatformExecutionPlan {
  const weekNumber = input.weekPlan.week_number;
  const platformsRaw = input.weekPlan.platforms || [];
  const platformSet = new Set(platformsRaw.map(normalizePlatform));
  if (platformSet.size < 3) {
    (input.companyProfile.social_profiles || []).forEach((entry) => {
      if (entry?.platform) platformSet.add(normalizePlatform(entry.platform));
    });
  }
  const platforms = Array.from(platformSet).slice(0, 5) as string[];
  const frequencySummary: Record<string, number> = {};
  const contentTypeCounts: Record<string, number> = {};
  const alignmentTokens = buildAlignmentTokens(input.companyProfile, input.campaign);
  const trends = [...input.trends];

  const days: PlatformExecutionDay[] = [];
  let previousPlatform = '';
  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    const platform = platforms[dayIndex % platforms.length];
    const resolvedPlatform = platform === previousPlatform && platforms.length > 1
      ? platforms[(dayIndex + 1) % platforms.length]
      : platform;
    previousPlatform = resolvedPlatform;

    const contentType = selectContentType(
      resolvedPlatform,
      input.weekPlan.content_types,
      contentTypeCounts
    );
    contentTypeCounts[contentType] = (contentTypeCounts[contentType] ?? 0) + 1;
    frequencySummary[resolvedPlatform] = (frequencySummary[resolvedPlatform] ?? 0) + 1;

    const trend = pickTrend(trends, alignmentTokens);
    if (trend) {
      trends.splice(trends.indexOf(trend), 1);
    }

    const placeholder = ['video', 'audio', 'podcast'].includes(contentType);
    const reasoning = placeholder
      ? 'Requires manual production or media generation'
      : trend
      ? 'Trend aligned with campaign themes'
      : 'Aligned with weekly theme and platform mix';

    days.push({
      date: `Week ${weekNumber} Day ${dayIndex + 1}`,
      platform: resolvedPlatform,
      contentType,
      theme: input.weekPlan.theme,
      placeholder,
      suggestedTime: PLATFORM_TIMES[resolvedPlatform] || '10:00',
      reasoning,
      trendUsed: trend ?? null,
    });
  }

  return {
    weekNumber,
    days,
    frequencySummary,
    omnivyra: input.weekPlan?.omnivyra ?? input.campaign?.omnivyra ?? null,
  };
}

// ==============================================
// DB-driven platform intelligence (with fallback)
// ==============================================

export type PlatformMaster = {
  id: string;
  name: string;
  canonical_key: string;
  category: string | null;
  supports_auto_publish: boolean;
  active: boolean;
  created_at: string;
};

export type PlatformContentRule = {
  id: string;
  platform_id: string;
  content_type: string;
  max_characters: number | null;
  max_words: number | null;
  media_format: string | null;
  supports_hashtags: boolean;
  supports_mentions: boolean;
  supports_links: boolean;
  formatting_rules: any;
  created_at: string;
};

export type PlatformPostingRequirements = {
  id: string;
  platform_id: string;
  content_type: string;
  required_fields: any;
  optional_fields: any;
  created_at: string;
};

type PlatformRulesBundle = {
  platform: PlatformMaster;
  content_rules: PlatformContentRule[];
};

const PLATFORM_KEY_ALIASES: Record<string, string> = {
  twitter: 'x',
  'twitter/x': 'x',
  'twitter-x': 'x',
};

function normalizePlatformKey(platformKey: string): string {
  const raw = String(platformKey || '').trim().toLowerCase();
  return PLATFORM_KEY_ALIASES[raw] || raw;
}

const FALLBACK_PLATFORM_MASTER: Record<string, Omit<PlatformMaster, 'id'>> = {
  linkedin: {
    name: 'LinkedIn',
    canonical_key: 'linkedin',
    category: 'social',
    supports_auto_publish: true,
    active: true,
    created_at: new Date(0).toISOString(),
  },
  facebook: {
    name: 'Facebook',
    canonical_key: 'facebook',
    category: 'social',
    supports_auto_publish: true,
    active: true,
    created_at: new Date(0).toISOString(),
  },
  instagram: {
    name: 'Instagram',
    canonical_key: 'instagram',
    category: 'social',
    supports_auto_publish: true,
    active: true,
    created_at: new Date(0).toISOString(),
  },
  youtube: {
    name: 'YouTube',
    canonical_key: 'youtube',
    category: 'video',
    supports_auto_publish: true,
    active: true,
    created_at: new Date(0).toISOString(),
  },
  x: {
    name: 'X',
    canonical_key: 'x',
    category: 'social',
    supports_auto_publish: true,
    active: true,
    created_at: new Date(0).toISOString(),
  },
  tiktok: {
    name: 'TikTok',
    canonical_key: 'tiktok',
    category: 'social',
    supports_auto_publish: true,
    active: true,
    created_at: new Date(0).toISOString(),
  },
};

const FALLBACK_CONTENT_RULES: Record<string, Array<Omit<PlatformContentRule, 'id' | 'platform_id'>>> = {
  linkedin: [
    {
      content_type: 'post',
      max_characters: 3000,
      max_words: 450,
      media_format: 'text',
      supports_hashtags: true,
      supports_mentions: true,
      supports_links: true,
      formatting_rules: {
        hashtag_limit: 5,
        suggested_times: ['09:00'],
        type_map: {
          post: 'post', video: 'video', article: 'article', poll: 'post', carousel: 'post',
          newsletter: 'newsletter', short_story: 'article', white_paper: 'article',
          blog: 'article', thread: 'post',
        },
      },
      created_at: new Date(0).toISOString(),
    },
    {
      content_type: 'article',
      max_characters: 125000,
      max_words: 2500,
      media_format: 'text',
      supports_hashtags: true,
      supports_mentions: true,
      supports_links: true,
      formatting_rules: { hashtag_limit: 3, suggested_times: ['09:00'] },
      created_at: new Date(0).toISOString(),
    },
    {
      content_type: 'newsletter',
      max_characters: 125000,
      max_words: 1500,
      media_format: 'text',
      supports_hashtags: false,
      supports_mentions: true,
      supports_links: true,
      formatting_rules: { hashtag_limit: 0, suggested_times: ['08:00', '09:00'] },
      created_at: new Date(0).toISOString(),
    },
    {
      content_type: 'short_story',
      max_characters: 3000,
      max_words: 500,
      media_format: 'text',
      supports_hashtags: true,
      supports_mentions: true,
      supports_links: true,
      formatting_rules: { hashtag_limit: 3, suggested_times: ['09:00', '12:00'] },
      created_at: new Date(0).toISOString(),
    },
    {
      content_type: 'white_paper',
      max_characters: 125000,
      max_words: 3000,
      media_format: 'text',
      supports_hashtags: true,
      supports_mentions: true,
      supports_links: true,
      formatting_rules: { hashtag_limit: 3, suggested_times: ['09:00'] },
      created_at: new Date(0).toISOString(),
    },
    {
      content_type: 'video',
      max_characters: 2000,
      max_words: 300,
      media_format: 'video',
      supports_hashtags: true,
      supports_mentions: true,
      supports_links: true,
      formatting_rules: { hashtag_limit: 5, suggested_times: ['18:00'] },
      created_at: new Date(0).toISOString(),
    },
  ],
  facebook: [
    {
      content_type: 'post',
      max_characters: 63206,
      max_words: 2500,
      media_format: 'text',
      supports_hashtags: true,
      supports_mentions: true,
      supports_links: true,
      formatting_rules: {
        hashtag_limit: 30,
        suggested_times: ['09:00'],
        type_map: { post: 'post', video: 'video', article: 'post', poll: 'post', carousel: 'post', newsletter: 'post', short_story: 'post', white_paper: 'post', blog: 'post', thread: 'post' },
      },
      created_at: new Date(0).toISOString(),
    },
    {
      content_type: 'story',
      max_characters: 500,
      max_words: 120,
      media_format: 'image',
      supports_hashtags: true,
      supports_mentions: true,
      supports_links: false,
      formatting_rules: { hashtag_limit: 10, suggested_times: ['12:00'] },
      created_at: new Date(0).toISOString(),
    },
    {
      content_type: 'video',
      max_characters: 5000,
      max_words: 500,
      media_format: 'video',
      supports_hashtags: true,
      supports_mentions: true,
      supports_links: true,
      formatting_rules: { hashtag_limit: 30, suggested_times: ['18:00'] },
      created_at: new Date(0).toISOString(),
    },
    {
      content_type: 'reel',
      max_characters: 2200,
      max_words: 300,
      media_format: 'video',
      supports_hashtags: true,
      supports_mentions: true,
      supports_links: true,
      formatting_rules: { hashtag_limit: 30, suggested_times: ['19:00'] },
      created_at: new Date(0).toISOString(),
    },
  ],
  instagram: [
    {
      content_type: 'feed_post',
      max_characters: 2200,
      max_words: 300,
      media_format: 'image',
      supports_hashtags: true,
      supports_mentions: true,
      supports_links: true,
      formatting_rules: {
        hashtag_limit: 30,
        suggested_times: ['19:00'],
        type_map: {
          post: 'feed_post', video: 'reel', article: 'feed_post', poll: 'feed_post', carousel: 'feed_post',
          newsletter: 'feed_post', short_story: 'feed_post', white_paper: 'feed_post', blog: 'feed_post', thread: 'feed_post',
        },
      },
      created_at: new Date(0).toISOString(),
    },
    {
      content_type: 'story',
      max_characters: 2200,
      max_words: 120,
      media_format: 'image',
      supports_hashtags: true,
      supports_mentions: true,
      supports_links: false,
      formatting_rules: { hashtag_limit: 10, suggested_times: ['11:00'] },
      created_at: new Date(0).toISOString(),
    },
    {
      content_type: 'reel',
      max_characters: 2200,
      max_words: 300,
      media_format: 'video',
      supports_hashtags: true,
      supports_mentions: true,
      supports_links: true,
      formatting_rules: { hashtag_limit: 30, suggested_times: ['19:00'] },
      created_at: new Date(0).toISOString(),
    },
  ],
  youtube: [
    {
      content_type: 'video',
      max_characters: 5000,
      max_words: 1200,
      media_format: 'video',
      supports_hashtags: true,
      supports_mentions: false,
      supports_links: true,
      formatting_rules: {
        hashtag_limit: 15,
        suggested_times: ['18:00'],
        type_map: { post: 'video', video: 'video', article: 'video', poll: 'video', carousel: 'short', newsletter: 'video', short_story: 'video', white_paper: 'video', blog: 'video', thread: 'video' },
      },
      created_at: new Date(0).toISOString(),
    },
    {
      content_type: 'short',
      max_characters: 100,
      max_words: 120,
      media_format: 'video',
      supports_hashtags: true,
      supports_mentions: false,
      supports_links: true,
      formatting_rules: { hashtag_limit: 15, suggested_times: ['18:00'] },
      created_at: new Date(0).toISOString(),
    },
    {
      content_type: 'live',
      max_characters: 5000,
      max_words: 2500,
      media_format: 'video',
      supports_hashtags: true,
      supports_mentions: false,
      supports_links: true,
      formatting_rules: { hashtag_limit: 15, suggested_times: ['18:00'] },
      created_at: new Date(0).toISOString(),
    },
  ],
  x: [
    {
      content_type: 'tweet',
      max_characters: 280,
      max_words: 80,
      media_format: 'text',
      supports_hashtags: true,
      supports_mentions: true,
      supports_links: true,
      formatting_rules: {
        hashtag_limit: 2,
        suggested_times: ['12:00'],
        type_map: { post: 'tweet', video: 'video', article: 'tweet', poll: 'tweet', carousel: 'tweet', newsletter: 'tweet', short_story: 'tweet', white_paper: 'tweet', blog: 'tweet', thread: 'thread' },
      },
      created_at: new Date(0).toISOString(),
    },
    {
      content_type: 'thread',
      max_characters: 280,
      max_words: 120,
      media_format: 'text',
      supports_hashtags: true,
      supports_mentions: true,
      supports_links: true,
      formatting_rules: { hashtag_limit: 1, suggested_times: ['12:00'] },
      created_at: new Date(0).toISOString(),
    },
    {
      content_type: 'video',
      max_characters: 280,
      max_words: 80,
      media_format: 'video',
      supports_hashtags: true,
      supports_mentions: true,
      supports_links: true,
      formatting_rules: { hashtag_limit: 2, suggested_times: ['12:00'] },
      created_at: new Date(0).toISOString(),
    },
  ],
  tiktok: [
    {
      content_type: 'video',
      max_characters: 2200,
      max_words: 300,
      media_format: 'video',
      supports_hashtags: true,
      supports_mentions: true,
      supports_links: true,
      formatting_rules: {
        hashtag_limit: 10,
        suggested_times: ['20:00'],
        type_map: { post: 'video', video: 'video', article: 'video', poll: 'video', carousel: 'video' },
      },
      created_at: new Date(0).toISOString(),
    },
    {
      content_type: 'live',
      max_characters: 2200,
      max_words: 300,
      media_format: 'video',
      supports_hashtags: true,
      supports_mentions: true,
      supports_links: true,
      formatting_rules: { hashtag_limit: 10, suggested_times: ['20:00'] },
      created_at: new Date(0).toISOString(),
    },
  ],
};

const FALLBACK_POSTING_REQUIREMENTS: Record<
  string,
  Record<string, { required_fields: string[]; optional_fields: string[] }>
> = {
  linkedin: {
    post: { required_fields: ['cta'], optional_fields: ['hashtags', 'mentions', 'links', 'best_time'] },
    article: { required_fields: ['seo_title', 'seo_description'], optional_fields: ['cta', 'hashtags', 'links'] },
    video: { required_fields: ['cta'], optional_fields: ['hashtags', 'mentions', 'links'] },
  },
  facebook: {
    post: { required_fields: [], optional_fields: ['hashtags', 'mentions', 'links', 'cta'] },
    story: { required_fields: [], optional_fields: ['hashtags', 'mentions'] },
    video: { required_fields: [], optional_fields: ['hashtags', 'mentions', 'links', 'cta'] },
    reel: { required_fields: [], optional_fields: ['hashtags', 'mentions', 'links', 'cta'] },
  },
  instagram: {
    feed_post: { required_fields: ['hashtags'], optional_fields: ['mentions', 'links', 'cta'] },
    story: { required_fields: [], optional_fields: ['hashtags', 'mentions'] },
    reel: { required_fields: ['hashtags'], optional_fields: ['mentions', 'links', 'cta'] },
  },
  youtube: {
    video: { required_fields: ['cta'], optional_fields: ['hashtags', 'links'] },
    short: { required_fields: [], optional_fields: ['hashtags', 'links'] },
    live: { required_fields: [], optional_fields: ['hashtags', 'links'] },
  },
  x: {
    tweet: { required_fields: [], optional_fields: ['hashtags', 'mentions', 'links'] },
    thread: { required_fields: [], optional_fields: ['hashtags', 'mentions', 'links'] },
    video: { required_fields: [], optional_fields: ['hashtags', 'mentions', 'links'] },
  },
  tiktok: {
    video: { required_fields: ['hashtags'], optional_fields: ['mentions', 'links'] },
    live: { required_fields: [], optional_fields: ['hashtags', 'mentions', 'links'] },
  },
};

function fallbackPlatformMaster(key: string): PlatformMaster | null {
  const base = FALLBACK_PLATFORM_MASTER[key];
  if (!base) return null;
  return {
    id: `fallback-${key}`,
    ...base,
  };
}

function fallbackContentRules(key: string): PlatformContentRule[] {
  const rows = FALLBACK_CONTENT_RULES[key] || [];
  return rows.map((row, idx) => ({
    id: `fallback-${key}-${row.content_type}-${idx}`,
    platform_id: `fallback-${key}`,
    ...row,
  }));
}

function isMissingRelationError(message?: string): boolean {
  const m = String(message || '').toLowerCase();
  return (
    m.includes('does not exist') ||
    m.includes('relation') ||
    m.includes('schema cache') ||
    m.includes('permission denied')
  );
}

export async function getPlatformRules(platformKey: string): Promise<PlatformRulesBundle | null> {
  const key = normalizePlatformKey(platformKey);
  try {
    const { data: platform, error: platformError } = await supabase
      .from('platform_master')
      .select('*')
      .eq('canonical_key', key)
      .maybeSingle();

    if (platformError) {
      if (isMissingRelationError(platformError.message)) {
        const fb = fallbackPlatformMaster(key);
        return fb ? { platform: fb, content_rules: fallbackContentRules(key) } : null;
      }
      throw new Error(platformError.message);
    }

    if (!platform) {
      const fb = fallbackPlatformMaster(key);
      return fb ? { platform: fb, content_rules: fallbackContentRules(key) } : null;
    }

    const { data: rules, error: rulesError } = await supabase
      .from('platform_content_rules')
      .select('*')
      .eq('platform_id', platform.id);

    if (rulesError) {
      if (isMissingRelationError(rulesError.message)) {
        return { platform: platform as any, content_rules: fallbackContentRules(key) };
      }
      throw new Error(rulesError.message);
    }

    return {
      platform: platform as any,
      content_rules: (rules || []) as any,
    };
  } catch (err: any) {
    const fb = fallbackPlatformMaster(key);
    return fb ? { platform: fb, content_rules: fallbackContentRules(key) } : null;
  }
}

export async function getSupportedContentTypes(platformKey: string): Promise<string[]> {
  const bundle = await getPlatformRules(platformKey);
  if (!bundle) return [];
  const types = bundle.content_rules.map((r) => r.content_type).filter(Boolean);
  return Array.from(new Set(types)).sort();
}

export async function getPostingRequirements(
  platformKey: string,
  contentType: string
): Promise<{ required_fields: string[]; optional_fields: string[]; source: 'db' | 'fallback' }> {
  const key = normalizePlatformKey(platformKey);
  const normalizedType = String(contentType || '').trim().toLowerCase();
  try {
    const bundle = await getPlatformRules(key);
    if (!bundle) {
      return { required_fields: [], optional_fields: [], source: 'fallback' };
    }

    const platformId = bundle.platform.id;
    if (!platformId || String(platformId).startsWith('fallback-')) {
      const fb = FALLBACK_POSTING_REQUIREMENTS[key]?.[normalizedType];
      return {
        required_fields: fb?.required_fields ?? [],
        optional_fields: fb?.optional_fields ?? [],
        source: 'fallback',
      };
    }

    const { data, error } = await supabase
      .from('platform_post_metadata_requirements')
      .select('*')
      .eq('platform_id', platformId)
      .eq('content_type', normalizedType)
      .maybeSingle();

    if (error) {
      if (isMissingRelationError(error.message)) {
        const fb = FALLBACK_POSTING_REQUIREMENTS[key]?.[normalizedType];
        return {
          required_fields: fb?.required_fields ?? [],
          optional_fields: fb?.optional_fields ?? [],
          source: 'fallback',
        };
      }
      throw new Error(error.message);
    }

    if (!data) {
      const fb = FALLBACK_POSTING_REQUIREMENTS[key]?.[normalizedType];
      return {
        required_fields: fb?.required_fields ?? [],
        optional_fields: fb?.optional_fields ?? [],
        source: 'fallback',
      };
    }

    const required_fields = Array.isArray((data as any).required_fields) ? (data as any).required_fields : [];
    const optional_fields = Array.isArray((data as any).optional_fields) ? (data as any).optional_fields : [];

    return {
      required_fields: required_fields.filter(Boolean),
      optional_fields: optional_fields.filter(Boolean),
      source: 'db',
    };
  } catch (err: any) {
    const fb = FALLBACK_POSTING_REQUIREMENTS[key]?.[normalizedType];
    return {
      required_fields: fb?.required_fields ?? [],
      optional_fields: fb?.optional_fields ?? [],
      source: 'fallback',
    };
  }
}

export async function listPlatformCatalog(input?: { activeOnly?: boolean }): Promise<{
  platforms: Array<PlatformMaster & { supported_content_types: string[] }>;
}> {
  const activeOnly = input?.activeOnly !== false;
  try {
    const q = supabase.from('platform_master').select('*');
    const { data: platforms, error } = activeOnly ? await q.eq('active', true) : await q;
    if (error) {
      if (isMissingRelationError(error.message)) {
        const fallback = Object.keys(FALLBACK_PLATFORM_MASTER).map((k) => ({
          id: `fallback-${k}`,
          ...FALLBACK_PLATFORM_MASTER[k],
          supported_content_types: (FALLBACK_CONTENT_RULES[k] || []).map((r) => r.content_type),
        }));
        return { platforms: fallback };
      }
      throw new Error(error.message);
    }

    const rows = (platforms || []) as any as PlatformMaster[];
    if (rows.length === 0) {
      const fallback = Object.keys(FALLBACK_PLATFORM_MASTER).map((k) => ({
        id: `fallback-${k}`,
        ...FALLBACK_PLATFORM_MASTER[k],
        supported_content_types: (FALLBACK_CONTENT_RULES[k] || []).map((r) => r.content_type),
      }));
      return { platforms: fallback };
    }

    const { data: rules, error: rulesError } = await supabase
      .from('platform_content_rules')
      .select('platform_id, content_type');

    if (rulesError) {
      if (isMissingRelationError(rulesError.message)) {
        return {
          platforms: rows.map((p) => ({
            ...p,
            supported_content_types: (FALLBACK_CONTENT_RULES[p.canonical_key] || []).map((r) => r.content_type),
          })),
        };
      }
      throw new Error(rulesError.message);
    }

    const typesByPlatformId = new Map<string, Set<string>>();
    (rules || []).forEach((r: any) => {
      if (!r?.platform_id || !r?.content_type) return;
      const set = typesByPlatformId.get(r.platform_id) || new Set<string>();
      set.add(String(r.content_type));
      typesByPlatformId.set(r.platform_id, set);
    });

    return {
      platforms: rows.map((p) => ({
        ...p,
        supported_content_types: Array.from(typesByPlatformId.get(p.id) || new Set<string>()).sort(),
      })),
    };
  } catch (err: any) {
    const fallback = Object.keys(FALLBACK_PLATFORM_MASTER).map((k) => ({
      id: `fallback-${k}`,
      ...FALLBACK_PLATFORM_MASTER[k],
      supported_content_types: (FALLBACK_CONTENT_RULES[k] || []).map((r) => r.content_type),
    }));
    return { platforms: fallback };
  }
}
