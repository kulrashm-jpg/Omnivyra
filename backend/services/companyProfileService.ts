import OpenAI from 'openai';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { supabase } from '../db/supabaseClient';

export type CompanyProfile = {
  id?: string;
  company_id: string;
  name?: string;
  industry?: string;
  category?: string;
  website_url?: string;
  industry_list?: string[];
  category_list?: string[];
  geography_list?: string[];
  competitors_list?: string[];
  content_themes_list?: string[];
  products_services_list?: string[];
  target_audience_list?: string[];
  goals_list?: string[];
  brand_voice_list?: string[];
  social_profiles?: Array<{ platform: string; url: string; source?: string; confidence?: string }>;
  field_confidence?: Record<string, string>;
  overall_confidence?: number;
  source_urls?: string[];
  linkedin_url?: string;
  facebook_url?: string;
  instagram_url?: string;
  x_url?: string;
  youtube_url?: string;
  tiktok_url?: string;
  reddit_url?: string;
  blog_url?: string;
  other_social_links?: Array<{ label?: string; url?: string }>;
  products_services?: string;
  target_audience?: string;
  geography?: string;
  brand_voice?: string;
  goals?: string;
  competitors?: string;
  unique_value?: string;
  content_themes?: string;
  confidence_score?: number;
  source?: 'user' | 'ai_refined';
  last_refined_at?: string | null;
  created_at?: string;
  updated_at?: string;
  // Commercial Strategy
  target_customer_segment?: string | null;
  ideal_customer_profile?: string | null;
  pricing_model?: string | null;
  sales_motion?: string | null;
  avg_deal_size?: string | null;
  sales_cycle?: string | null;
  key_metrics?: string | null;
  user_locked_fields?: string[] | null;
  last_edited_by?: string | null;
  // Marketing Intelligence
  marketing_channels?: string | null;
  content_strategy?: string | null;
  campaign_focus?: string | null;
  key_messages?: string | null;
  brand_positioning?: string | null;
  competitive_advantages?: string | null;
  growth_priorities?: string | null;
  // Campaign Purpose & Strategic Intent (from Define Target Customer / Define Strategic Purpose)
  campaign_purpose_intent?: {
    primary_objective?: string | null;
    campaign_intent?: string | null;
    monetization_intent?: string | null;
    dominant_problem_domains?: string[];
    brand_positioning_angle?: string | null;
  } | null;
}

/** Commercial strategy fields; when saved by user they are added to user_locked_fields. */
export const COMMERCIAL_FIELD_NAMES = [
  'target_customer_segment',
  'ideal_customer_profile',
  'pricing_model',
  'sales_motion',
  'avg_deal_size',
  'sales_cycle',
  'key_metrics',
] as const;

/** Marketing intelligence fields; when saved by user they are added to user_locked_fields. */
export const MARKETING_INTELLIGENCE_FIELD_NAMES = [
  'marketing_channels',
  'content_strategy',
  'campaign_focus',
  'key_messages',
  'brand_positioning',
  'competitive_advantages',
  'growth_priorities',
] as const;

export type CompanyProfileRefinementDetails = {
  company_id: string;
  before_profile: CompanyProfile;
  after_profile: CompanyProfile;
  source_urls: Array<{ label: string; url: string }>;
  source_summaries: Array<{ label: string; url: string; summary: string }>;
  changed_fields: Array<{ field: string; before: any; after: any }>;
  created_at: string;
  extraction_output?: CompanyProfileExtractionOutput;
  missing_fields_questions?: Array<{ field: string; question: string; options: string[]; allow_multiple?: boolean }>;
};

export type NormalizedCompanyProfile = {
  base: CompanyProfile | null;
  categories: string[];
  target_audience: {
    age_range?: string;
    gender?: string;
    personas?: string[];
  } | null;
  geo_focus: string[];
  brand_type: string | null;
};

const DEFAULT_COMPANY_ID = 'default';

const normalizeList = (value?: string | null): string[] => {
  if (!value) return [];
  return value
    .split(/[,;/|]+/g)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
};

const mergeStringArrays = (current?: string[] | null, incoming?: string[] | null): string[] => {
  const deduped = new Map<string, string>();
  (current || []).forEach((item) => {
    if (!item) return;
    const trimmed = item.trim();
    if (!trimmed) return;
    deduped.set(trimmed.toLowerCase(), trimmed);
  });
  (incoming || []).forEach((item) => {
    if (!item) return;
    const trimmed = item.trim();
    if (!trimmed) return;
    deduped.set(trimmed.toLowerCase(), trimmed);
  });
  return Array.from(deduped.values());
};

const confidenceRank = (value?: string | null): number => {
  if (!value) return 0;
  const normalized = value.toLowerCase();
  if (normalized === 'high') return 3;
  if (normalized === 'medium') return 2;
  if (normalized === 'low') return 1;
  return 0;
};

const shouldReplaceValue = (newConfidence?: string | null, oldConfidence?: string | null): boolean => {
  return confidenceRank(newConfidence) > confidenceRank(oldConfidence);
};

const isGenericValue = (value: string): boolean => {
  const lower = value.trim().toLowerCase();
  return ['technology', 'global', 'other'].includes(lower);
};

const filterGenericValues = (values: string[] | null, source?: string | null): string[] => {
  if (!values) return [];
  if (source === 'website' || source === 'social' || source === 'user') return values;
  return values.filter((value) => !isGenericValue(value));
};

const isPlaceholderUrl = (url: string): boolean => {
  const lower = url.toLowerCase();
  return (
    lower.includes('example.com') ||
    lower.includes('yourhandle') ||
    lower.includes('yourpage')
  );
};

const detectBrandType = (profile: CompanyProfile | null): string | null => {
  const text = [
    profile?.industry,
    profile?.category,
    profile?.brand_voice,
    profile?.goals,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (!text) return null;
  if (text.includes('b2b')) return 'b2b';
  if (text.includes('b2c')) return 'b2c';
  if (text.includes('enterprise')) return 'enterprise';
  if (text.includes('consumer')) return 'consumer';
  return null;
};

const parseAudience = (value?: string | null): NormalizedCompanyProfile['target_audience'] => {
  if (!value) return null;
  const text = value.toLowerCase();
  const ageMatch = text.match(/\b(\d{2})\s*(?:-|to)\s*(\d{2})\b/);
  const age_range = ageMatch ? `${ageMatch[1]}-${ageMatch[2]}` : undefined;
  let gender: string | undefined;
  if (text.includes('women') || text.includes('female')) gender = 'female';
  if (text.includes('men') || text.includes('male')) gender = 'male';
  if (text.includes('non-binary') || text.includes('nonbinary')) gender = 'non-binary';

  const personas = text
    .split(/[,;/|]+/g)
    .map((item) => item.trim())
    .filter((item) => item.length > 2)
    .filter((item) => !item.match(/\b\d{2}\b/));

  return {
    age_range,
    gender,
    personas: personas.length > 0 ? Array.from(new Set(personas)) : undefined,
  };
};

export const normalizeCompanyProfile = (
  profile: CompanyProfile | null
): NormalizedCompanyProfile => {
  const categories = Array.from(
    new Set(
      [
        ...normalizeList(profile?.industry),
        ...normalizeList(profile?.category),
        ...normalizeList(profile?.content_themes),
      ].filter(Boolean)
    )
  );

  const geo_focus = Array.from(new Set(normalizeList(profile?.geography)));

  return {
    base: profile,
    categories,
    target_audience: parseAudience(profile?.target_audience),
    geo_focus,
    brand_type: detectBrandType(profile),
  };
};

export const validateCompanyProfile = (
  profile: CompanyProfile | null
): { status: 'ready' | 'blocked'; missing_fields: string[] } => {
  const missing: string[] = [];
  if (!profile) {
    return {
      status: 'blocked',
      missing_fields: [
        'industry_list',
        'target_audience',
        'content_themes',
        'goals',
        'social_profiles',
      ],
    };
  }

  const hasList = (value?: string[] | null) =>
    Array.isArray(value) && value.some((item) => item && item.trim().length > 0);
  const hasText = (value?: string | null) => Boolean(value && value.trim().length > 0);
  const hasSocialProfiles = Array.isArray(profile.social_profiles)
    ? profile.social_profiles.some((entry) => entry?.url && !isPlaceholderUrl(entry.url))
    : false;

  if (!hasList(profile.industry_list) && !hasText(profile.industry)) {
    missing.push('industry_list');
  }
  if (!hasList(profile.target_audience_list) && !hasText(profile.target_audience)) {
    missing.push('target_audience');
  }
  if (!hasList(profile.content_themes_list) && !hasText(profile.content_themes)) {
    missing.push('content_themes');
  }
  if (!hasList(profile.goals_list) && !hasText(profile.goals)) {
    missing.push('goals');
  }
  if (!hasSocialProfiles) {
    missing.push('social_profiles');
  }

  return {
    status: missing.length > 0 ? 'blocked' : 'ready',
    missing_fields: missing,
  };
};

const refinementSchema = z.object({
  name: z.string().optional().nullable(),
  industry: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  website_url: z.string().optional().nullable(),
  products_services: z.string().optional().nullable(),
  target_audience: z.string().optional().nullable(),
  geography: z.string().optional().nullable(),
  brand_voice: z.string().optional().nullable(),
  goals: z.string().optional().nullable(),
  competitors: z.string().optional().nullable(),
  unique_value: z.string().optional().nullable(),
  content_themes: z.string().optional().nullable(),
  confidence_score: z.number().min(0).max(100).optional().nullable(),
});

const extractionFieldSchema = z.object({
  value: z.union([z.string(), z.array(z.string())]).optional().nullable(),
  values: z.union([z.string(), z.array(z.string())]).optional().nullable(),
  source: z.enum(['website', 'social', 'inferred', 'user', 'missing']),
  confidence: z.enum(['High', 'Medium', 'Low']),
});

const extractionSchema = z.object({
  company_name: extractionFieldSchema.optional(),
  industry: extractionFieldSchema.optional(),
  category: extractionFieldSchema.optional(),
  website_url: extractionFieldSchema.optional(),
  social_profiles: z
    .object({
      linkedin: extractionFieldSchema.optional(),
      facebook: extractionFieldSchema.optional(),
      instagram: extractionFieldSchema.optional(),
      x: extractionFieldSchema.optional(),
      youtube: extractionFieldSchema.optional(),
      tiktok: extractionFieldSchema.optional(),
      reddit: extractionFieldSchema.optional(),
      blog: extractionFieldSchema.optional(),
    })
    .optional(),
  geography: extractionFieldSchema.optional(),
  products_services: extractionFieldSchema.optional(),
  target_audience: extractionFieldSchema.optional(),
  brand_voice: extractionFieldSchema.optional(),
  goals: extractionFieldSchema.optional(),
  competitors: extractionFieldSchema.optional(),
  unique_value_proposition: extractionFieldSchema.optional(),
  content_themes: extractionFieldSchema.optional(),
  missing_fields: z.array(z.string()).optional(),
});

type CompanyProfileExtractionOutput = z.infer<typeof extractionSchema>;

type EnrichmentField = {
  value: string | string[] | null;
  source: 'website' | 'social' | 'inferred' | 'missing';
  confidence: 'High' | 'Medium' | 'Low';
};

type EnrichmentOutput = {
  competitors?: EnrichmentField;
  social_profiles?: {
    linkedin?: EnrichmentField;
    facebook?: EnrichmentField;
    instagram?: EnrichmentField;
    x?: EnrichmentField;
    youtube?: EnrichmentField;
    tiktok?: EnrichmentField;
    reddit?: EnrichmentField;
    blog?: EnrichmentField;
  };
  geography?: EnrichmentField;
  content_themes?: EnrichmentField;
  target_audience?: EnrichmentField;
};

const enrichmentSchema = z.object({
  competitors: extractionFieldSchema.optional(),
  geography: extractionFieldSchema.optional(),
  content_themes: extractionFieldSchema.optional(),
  target_audience: extractionFieldSchema.optional(),
  social_profiles: z
    .object({
      linkedin: extractionFieldSchema.optional(),
      facebook: extractionFieldSchema.optional(),
      instagram: extractionFieldSchema.optional(),
      x: extractionFieldSchema.optional(),
      youtube: extractionFieldSchema.optional(),
      tiktok: extractionFieldSchema.optional(),
      reddit: extractionFieldSchema.optional(),
      blog: extractionFieldSchema.optional(),
    })
    .optional(),
});

const normalizeSourceValue = (
  value: any
): 'website' | 'social' | 'inferred' | 'user' | 'missing' => {
  const normalized = String(value || '').toLowerCase();
  if (normalized.startsWith('website')) return 'website';
  if (normalized.startsWith('social')) return 'social';
  if (normalized === 'inferred') return 'inferred';
  if (normalized === 'user') return 'user';
  if (normalized === 'missing') return 'missing';
  return 'missing';
};

const normalizeExtractionOutput = (raw: any): any => {
  if (!raw || typeof raw !== 'object') return raw;
  const normalizedInput = { ...raw };
  if (normalizedInput.industry_list && !normalizedInput.industry) {
    normalizedInput.industry = normalizedInput.industry_list;
  }
  if (normalizedInput.category_list && !normalizedInput.category) {
    normalizedInput.category = normalizedInput.category_list;
  }
  if (normalizedInput.geography_list && !normalizedInput.geography) {
    normalizedInput.geography = normalizedInput.geography_list;
  }
  if (normalizedInput.competitors_list && !normalizedInput.competitors) {
    normalizedInput.competitors = normalizedInput.competitors_list;
  }
  if (normalizedInput.content_themes_list && !normalizedInput.content_themes) {
    normalizedInput.content_themes = normalizedInput.content_themes_list;
  }
  if (normalizedInput.products_services_list && !normalizedInput.products_services) {
    normalizedInput.products_services = normalizedInput.products_services_list;
  }
  if (normalizedInput.target_audience_list && !normalizedInput.target_audience) {
    normalizedInput.target_audience = normalizedInput.target_audience_list;
  }
  if (normalizedInput.goals_list && !normalizedInput.goals) {
    normalizedInput.goals = normalizedInput.goals_list;
  }
  if (normalizedInput.brand_voice_list && !normalizedInput.brand_voice) {
    normalizedInput.brand_voice = normalizedInput.brand_voice_list;
  }
  const normalizeField = (field: any) => {
    if (!field || typeof field !== 'object') return field;
    const rawValue = field.value ?? field.values;
    const normalizedValue = Array.isArray(rawValue)
      ? rawValue.filter((item: any) => item !== null && item !== undefined && String(item).trim().length > 0)
      : rawValue;
    return {
      ...field,
      source: normalizeSourceValue(field.source),
      value: Array.isArray(normalizedValue) && normalizedValue.length === 0 ? null : normalizedValue,
    };
  };

  return {
    ...normalizedInput,
    company_name: normalizeField(normalizedInput.company_name),
    industry: normalizeField(normalizedInput.industry),
    category: normalizeField(normalizedInput.category),
    website_url: normalizeField(normalizedInput.website_url),
    social_profiles: raw.social_profiles
      ? {
          linkedin: normalizeField(raw.social_profiles.linkedin),
          facebook: normalizeField(raw.social_profiles.facebook),
          instagram: normalizeField(raw.social_profiles.instagram),
          x: normalizeField(raw.social_profiles.x),
          youtube: normalizeField(raw.social_profiles.youtube),
          tiktok: normalizeField(raw.social_profiles.tiktok),
          reddit: normalizeField(raw.social_profiles.reddit),
          blog: normalizeField(raw.social_profiles.blog),
        }
      : raw.social_profiles,
    geography: normalizeField(normalizedInput.geography),
    products_services: normalizeField(normalizedInput.products_services),
    target_audience: normalizeField(normalizedInput.target_audience),
    brand_voice: normalizeField(normalizedInput.brand_voice),
    goals: normalizeField(normalizedInput.goals),
    competitors: normalizeField(normalizedInput.competitors),
    unique_value_proposition: normalizeField(normalizedInput.unique_value_proposition),
    content_themes: normalizeField(normalizedInput.content_themes),
    missing_fields: Array.isArray(normalizedInput.missing_fields) ? normalizedInput.missing_fields : undefined,
  };
};

const defaultField = (): { value: null; source: 'missing'; confidence: 'Low' } => ({
  value: null,
  source: 'missing',
  confidence: 'Low',
});

const coerceField = (field: any) => {
  const normalized = normalizeExtractionOutput({ field }).field;
  const validation = extractionFieldSchema.safeParse(normalized);
  if (!validation.success) return defaultField();
  return validation.data;
};

const buildExtractionWithDefaults = (raw: any): CompanyProfileExtractionOutput => {
  const normalized = normalizeExtractionOutput(raw || {});
  const social = normalized.social_profiles || {};
  return {
    company_name: coerceField(normalized.company_name),
    industry: coerceField(normalized.industry),
    category: coerceField(normalized.category),
    website_url: coerceField(normalized.website_url),
    social_profiles: {
      linkedin: coerceField(social.linkedin),
      facebook: coerceField(social.facebook),
      instagram: coerceField(social.instagram),
      x: coerceField(social.x),
      youtube: coerceField(social.youtube),
      tiktok: coerceField(social.tiktok),
      reddit: coerceField(social.reddit),
      blog: coerceField(social.blog),
    },
    geography: coerceField(normalized.geography),
    products_services: coerceField(normalized.products_services),
    target_audience: coerceField(normalized.target_audience),
    brand_voice: coerceField(normalized.brand_voice),
    goals: coerceField(normalized.goals),
    competitors: coerceField(normalized.competitors),
    unique_value_proposition: coerceField(normalized.unique_value_proposition),
    content_themes: coerceField(normalized.content_themes),
    missing_fields: Array.isArray(normalized.missing_fields)
      ? normalized.missing_fields
      : [],
  };
};

const computeMissingFields = (extraction: CompanyProfileExtractionOutput): string[] => {
  const fields: Array<[string, any]> = [
    ['company_name', extraction.company_name],
    ['industry', extraction.industry],
    ['category', extraction.category],
    ['website_url', extraction.website_url],
    ['social_profiles.linkedin', extraction.social_profiles.linkedin],
    ['social_profiles.facebook', extraction.social_profiles.facebook],
    ['social_profiles.instagram', extraction.social_profiles.instagram],
    ['social_profiles.x', extraction.social_profiles.x],
    ['social_profiles.youtube', extraction.social_profiles.youtube],
    ['social_profiles.tiktok', extraction.social_profiles.tiktok],
    ['social_profiles.reddit', extraction.social_profiles.reddit],
    ['social_profiles.blog', extraction.social_profiles.blog],
    ['geography', extraction.geography],
    ['products_services', extraction.products_services],
    ['target_audience', extraction.target_audience],
    ['brand_voice', extraction.brand_voice],
    ['goals', extraction.goals],
    ['competitors', extraction.competitors],
    ['unique_value_proposition', extraction.unique_value_proposition],
    ['content_themes', extraction.content_themes],
  ];

  return fields
    .filter(([, field]) => field.source === 'missing' || field.confidence === 'Low')
    .map(([name]) => name);
};

const mergeArrayValues = (current: string | string[] | null, incoming: string | string[] | null): string[] => {
  const currentList = Array.isArray(current)
    ? current
    : current
      ? [current]
      : [];
  const incomingList = Array.isArray(incoming)
    ? incoming
    : incoming
      ? [incoming]
      : [];
  const deduped = new Map<string, string>();
  [...currentList, ...incomingList].forEach((item) => {
    if (!item || typeof item !== 'string') return;
    const normalized = item.trim();
    if (!normalized) return;
    deduped.set(normalized.toLowerCase(), normalized);
  });
  return Array.from(deduped.values());
};

const shouldOverwriteField = (field?: EnrichmentField): boolean => {
  if (!field) return false;
  return field.confidence !== 'High';
};

// Enrichment pass removed in favor of a single normalization prompt.

const getOpenAiClient = (): OpenAI => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY');
  }
  return new OpenAI({ apiKey });
};

const shouldSkipUrl = (url: string): boolean => {
  const lower = url.toLowerCase();
  return (
    lower.includes('/_next/static') ||
    lower.endsWith('.css') ||
    lower.endsWith('.js') ||
    lower.endsWith('.map') ||
    lower.endsWith('.svg') ||
    lower.endsWith('.png') ||
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.gif')
  );
};

const normalizeCompanyId = (companyId?: string | null): string => {
  return companyId && companyId.trim().length > 0 ? companyId : DEFAULT_COMPANY_ID;
};

type ExtractedEvidence = {
  title?: string | null;
  meta_description?: string | null;
  og_description?: string | null;
  headings?: string[];
  highlights?: string[];
};

const MAX_CRAWL_PAGES = 12;
const MAX_SOCIAL_LINKS = 8;

const normalizeUrl = (value: string): string | null => {
  if (!value) return null;
  const tryParse = (input: string): string | null => {
    try {
      const parsed = new URL(input);
      return parsed.toString()
        .split('#')[0]
        .replace(/\?.*$/, '')
        .replace(/\/$/, '')
        .toLowerCase();
    } catch {
      return null;
    }
  };
  const direct = tryParse(value);
  if (direct) return direct;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^https?:\/\//i.test(trimmed)) {
    return tryParse(`https://${trimmed}`);
  }
  return null;
};

const normalizeSocialUrl = (value: string): string | null => {
  const normalized = normalizeUrl(value);
  if (!normalized) return null;
  const withoutWww = normalized.replace('https://www.', 'https://');
  if (withoutWww.startsWith('https://twitter.com')) {
    return withoutWww.replace('https://twitter.com', 'https://x.com');
  }
  return withoutWww;
};

const getBrandTokensFromUrl = (baseUrl: string): string[] => {
  try {
    const host = new URL(baseUrl).hostname.replace(/^www\./i, '').toLowerCase();
    const root = host.split('.').slice(0, -1).join('.');
    const rawTokens = root.split(/[.\-]/g);
    const stop = new Set(['inc', 'llc', 'company', 'co', 'corp', 'ltd', 'group', 'the']);
    return rawTokens
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !stop.has(token));
  } catch {
    return [];
  }
};

const isGenericSocialUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, '');
    const path = parsed.pathname.toLowerCase();
    if (path === '/' || path === '') return true;
    if (host.includes('facebook.com') && (path.startsWith('/share') || path.startsWith('/sharer'))) return true;
    if (host.includes('youtube.com') && (path.startsWith('/watch') || path.startsWith('/results') || path.startsWith('/feed'))) {
      return true;
    }
    return false;
  } catch {
    return true;
  }
};

const isLikelyCompanySocialLink = (platform: string, url: string): boolean => {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, '');
    const path = parsed.pathname.toLowerCase();
    if (platform === 'facebook') {
      if (path.startsWith('/profile.php')) return false;
      if (path.startsWith('/pages/')) return true;
      const segments = path.split('/').filter(Boolean);
      return segments.length === 1;
    }
    if (platform === 'youtube') {
      if (path.startsWith('/watch') || path.startsWith('/results') || path.startsWith('/feed')) return false;
      return (
        path.startsWith('/channel/') ||
        path.startsWith('/user/') ||
        path.startsWith('/c/') ||
        path.startsWith('/@')
      );
    }
    if (platform === 'instagram') {
      const segments = path.split('/').filter(Boolean);
      return segments.length >= 1 && !segments[0].startsWith('p');
    }
    if (platform === 'linkedin') {
      return path.startsWith('/company/');
    }
    if (platform === 'x') {
      const segments = path.split('/').filter(Boolean);
      return segments.length === 1 && segments[0] !== 'home';
    }
    if (platform === 'tiktok') {
      return path.startsWith('/@');
    }
    if (platform === 'reddit') {
      return path.startsWith('/r/');
    }
    return true;
  } catch {
    return false;
  }
};

const isSameDomain = (baseUrl: string, targetUrl: string): boolean => {
  try {
    const base = new URL(baseUrl);
    const target = new URL(targetUrl);
    return base.hostname === target.hostname;
  } catch {
    return false;
  }
};

const extractLinksFromHtml = (html: string, baseUrl: string): string[] => {
  const links = new Set<string>();
  const regex = /href=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html))) {
    const href = match[1];
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) {
      continue;
    }
    try {
      const resolved = new URL(href, baseUrl).toString();
      const normalized = normalizeUrl(resolved);
      if (!normalized) continue;
      if (shouldSkipUrl(normalized)) continue;
      links.add(normalized);
    } catch {
      continue;
    }
  }
  return Array.from(links);
};

const scoreUrl = (url: string): number => {
  const keywords = [
    'about',
    'company',
    'team',
    'story',
    'mission',
    'values',
    'services',
    'solutions',
    'products',
    'blog',
    'news',
    'press',
    'pricing',
    'case',
    'testimonial',
    'customer',
    'careers',
  ];
  const lower = url.toLowerCase();
  return keywords.reduce((score, keyword) => score + (lower.includes(keyword) ? 1 : 0), 0);
};

const extractSocialLinks = (urls: string[]): Record<string, string[]> => {
  const buckets: Record<string, string[]> = {
    linkedin: [],
    facebook: [],
    instagram: [],
    x: [],
    youtube: [],
    tiktok: [],
    reddit: [],
  };
  urls.forEach((url) => {
    const normalized = normalizeSocialUrl(url);
    if (!normalized) return;
    const lower = normalized.toLowerCase();
    if (lower.includes('linkedin.com') && isLikelyCompanySocialLink('linkedin', normalized)) {
      buckets.linkedin.push(url);
    } else if (lower.includes('facebook.com') && isLikelyCompanySocialLink('facebook', normalized)) {
      buckets.facebook.push(url);
    } else if (lower.includes('instagram.com') && isLikelyCompanySocialLink('instagram', normalized)) {
      buckets.instagram.push(url);
    } else if ((lower.includes('x.com') || lower.includes('twitter.com')) && isLikelyCompanySocialLink('x', normalized)) {
      buckets.x.push(url);
    } else if ((lower.includes('youtube.com') || lower.includes('youtu.be')) && isLikelyCompanySocialLink('youtube', normalized)) {
      buckets.youtube.push(url);
    } else if (lower.includes('tiktok.com') && isLikelyCompanySocialLink('tiktok', normalized)) {
      buckets.tiktok.push(url);
    } else if (lower.includes('reddit.com') && isLikelyCompanySocialLink('reddit', normalized)) {
      buckets.reddit.push(url);
    }
  });
  return buckets;
};

const extractSocialLinksFromHtml = (
  html: string,
  baseUrl: string
): Record<string, string[]> => {
  const buckets: Record<string, Map<string, number>> = {
    linkedin: new Map(),
    facebook: new Map(),
    instagram: new Map(),
    x: new Map(),
    youtube: new Map(),
    tiktok: new Map(),
    reddit: new Map(),
  };
  const anchorRegex = /<a\s+[^>]*?>[\s\S]*?<\/a>/gi;
  const hrefRegex = /href=["']([^"']+)["']/i;
  const dataHrefRegex = /data-href=["']([^"']+)["']/i;
  const ariaRegex = /aria-label=["']([^"']+)["']/i;
  const titleRegex = /title=["']([^"']+)["']/i;
  const brandTokens = getBrandTokensFromUrl(baseUrl);

  const scoreCandidate = (candidate: string, labelText: string) => {
    const lowerUrl = candidate.toLowerCase();
    const lowerLabel = labelText.toLowerCase();
    let score = 0;
    brandTokens.forEach((token) => {
      if (lowerUrl.includes(token)) score += 3;
      if (lowerLabel.includes(token)) score += 2;
    });
    if (lowerLabel.includes('official')) score += 1;
    return score;
  };

  const addCandidate = (candidate: string, labelText: string) => {
    const normalized = normalizeSocialUrl(candidate);
    if (!normalized) return;
    if (isPlaceholderUrl(normalized) || isGenericSocialUrl(normalized)) return;
    const lower = normalized.toLowerCase();
    const score = scoreCandidate(normalized, labelText);
    const addTo = (bucket: Map<string, number>) => {
      const existing = bucket.get(normalized) || 0;
      bucket.set(normalized, Math.max(existing, score));
    };
    if (lower.includes('linkedin.com') && isLikelyCompanySocialLink('linkedin', normalized)) {
      addTo(buckets.linkedin);
    } else if (lower.includes('facebook.com') && isLikelyCompanySocialLink('facebook', normalized)) {
      addTo(buckets.facebook);
    } else if (lower.includes('instagram.com') && isLikelyCompanySocialLink('instagram', normalized)) {
      addTo(buckets.instagram);
    } else if ((lower.includes('x.com') || lower.includes('twitter.com')) && isLikelyCompanySocialLink('x', normalized)) {
      addTo(buckets.x);
    } else if ((lower.includes('youtube.com') || lower.includes('youtu.be')) && isLikelyCompanySocialLink('youtube', normalized)) {
      addTo(buckets.youtube);
    } else if (lower.includes('tiktok.com') && isLikelyCompanySocialLink('tiktok', normalized)) {
      addTo(buckets.tiktok);
    } else if (lower.includes('reddit.com') && isLikelyCompanySocialLink('reddit', normalized)) {
      addTo(buckets.reddit);
    }
  };

  const anchors: string[] = html.match(anchorRegex) || [];
  anchors.forEach((anchor: string) => {
    const href = anchor.match(hrefRegex)?.[1] || '';
    const dataHref = anchor.match(dataHrefRegex)?.[1] || '';
    const ariaLabel = anchor.match(ariaRegex)?.[1] || '';
    const title = anchor.match(titleRegex)?.[1] || '';
    const text = anchor.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const labelText = `${text} ${ariaLabel} ${title}`.trim();

    [href, dataHref].forEach((value) => {
      if (!value) return;
      try {
        const resolved = new URL(value, baseUrl).toString();
        addCandidate(resolved, labelText);
      } catch {
        return;
      }
    });
  });

  const finalizeBucket = (bucket: Map<string, number>) => {
    const entries = Array.from(bucket.entries()).sort((a, b) => b[1] - a[1]);
    const hasScored = entries.some(([, score]) => score > 0);
    const filtered = hasScored ? entries.filter(([, score]) => score > 0) : entries;
    return filtered.map(([url]) => url);
  };

  return {
    linkedin: finalizeBucket(buckets.linkedin),
    facebook: finalizeBucket(buckets.facebook),
    instagram: finalizeBucket(buckets.instagram),
    x: finalizeBucket(buckets.x),
    youtube: finalizeBucket(buckets.youtube),
    tiktok: finalizeBucket(buckets.tiktok),
    reddit: finalizeBucket(buckets.reddit),
  };
};

const extractEvidenceFromHtml = (html: string): ExtractedEvidence => {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const metaDescriptionMatch = html.match(
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i
  );
  const ogDescriptionMatch = html.match(
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["'][^>]*>/i
  );

  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const sentences = cleaned
    .split(/(?<=[.?!])\s+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 40);

  const keywords = [
    'about',
    'mission',
    'services',
    'solutions',
    'products',
    'industry',
    'audience',
    'reveals',
    'company',
    'we help',
    'who we are',
  ];

  const scored = sentences
    .map((line) => ({
      line,
      score: keywords.reduce(
        (sum, key) => sum + (line.toLowerCase().includes(key) ? 1 : 0),
        0
      ),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((entry) => entry.line);

  return {
    title: titleMatch?.[1]?.trim() || null,
    meta_description: metaDescriptionMatch?.[1]?.trim() || null,
    og_description: ogDescriptionMatch?.[1]?.trim() || null,
    headings: [],
    highlights: scored,
  };
};

const fetchUrlSummary = async (url?: string | null): Promise<string | null> => {
  if (!url) return null;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) return null;
    const text = await response.text();
    const evidence = extractEvidenceFromHtml(text);
    const parts = [
      evidence.title ? `Title: ${evidence.title}` : null,
      evidence.meta_description ? `Meta: ${evidence.meta_description}` : null,
      evidence.og_description ? `OG: ${evidence.og_description}` : null,
      ...(evidence.highlights || []).map((line) => `- ${line}`),
    ].filter(Boolean);

    if (parts.length === 0) return null;
    return parts.join('\n').slice(0, 2000);
  } catch (error) {
    console.warn('Profile source fetch failed for company profile refinement.');
    return null;
  }
};

const crawlWebsiteSources = async (
  websiteUrl: string,
  existingUrls: Set<string>
): Promise<{
  urls: Array<{ label: string; url: string }>;
  summaries: Array<{ label: string; url: string; summary: string }>;
  social_links: Record<string, string[]>;
}> => {
  const normalizedWebsite = normalizeUrl(websiteUrl);
  if (!normalizedWebsite) {
    return { urls: [], summaries: [], social_links: {} };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  let rootHtml = '';
  let socialLinks: Record<string, string[]> = {
    linkedin: [],
    facebook: [],
    instagram: [],
    x: [],
    youtube: [],
    tiktok: [],
    reddit: [],
  };
  try {
    const response = await fetch(normalizedWebsite, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (response.ok) {
      rootHtml = await response.text();
      socialLinks = extractSocialLinksFromHtml(rootHtml, normalizedWebsite);
    }
  } catch (error) {
    clearTimeout(timeoutId);
  }

  const candidateLinks = extractLinksFromHtml(rootHtml, normalizedWebsite)
    .filter((link) => isSameDomain(normalizedWebsite, link))
    .filter((link) => !existingUrls.has(link));

  const scoredLinks = candidateLinks
    .map((url) => ({ url, score: scoreUrl(url) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CRAWL_PAGES);

  const pageUrls = [normalizedWebsite, ...scoredLinks.map((item) => item.url)]
    .filter((url) => !existingUrls.has(url));
  const dedupedPageUrls = Array.from(new Set(pageUrls));

  const summaries = await Promise.all(
    dedupedPageUrls.map(async (url) => ({
      label: url === normalizedWebsite ? 'website_root' : 'website_page',
      url,
      summary: await fetchUrlSummary(url),
    }))
  );

  const sourceUrls = dedupedPageUrls.map((url) => ({
    label: url === normalizedWebsite ? 'website_root' : 'website_page',
    url,
  }));

  return {
    urls: sourceUrls,
    summaries: summaries.filter((entry) => entry.summary) as Array<{
      label: string;
      url: string;
      summary: string;
    }>,
    social_links: socialLinks,
  };
};

const cleanEvidenceWithAi = async (
  client: OpenAI,
  summaries: Array<{ label: string; url: string; summary: string }>
): Promise<Array<{ label: string; url: string; summary: string }>> => {
  if (summaries.length === 0) return [];
  const systemPrompt =
    'You are a business content cleaner. Return JSON only. No prose.';
  const userPrompt =
    'From the text below, remove:' +
    '\n- any lines containing "_next/static"' +
    '\n- any .css, .js, .map content' +
    '\n- UI animation text (e.g., "Card flips automatically", "click here", "hover", "menu")' +
    '\n- navigation/footer text' +
    '\n- repeated slogans' +
    '\n\nKeep ONLY:' +
    '\n- about/company descriptions' +
    '\n- mission or vision statements' +
    '\n- product & service descriptions' +
    '\n- blog topics or headings' +
    '\n- social profile bio text' +
    '\n- references to locations, industries, users, or competitors' +
    '\n\nReturn only clean business evidence as JSON.' +
    '\n\nText:\n' +
    JSON.stringify(summaries);

  const completion = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  const raw = completion.choices[0]?.message?.content?.trim() || '{}';
  const parsed = JSON.parse(raw);
  const cleaned = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.evidence) ? parsed.evidence : [];
  const deduped = new Map<string, { label: string; url: string; summary: string }>();
  cleaned.forEach((entry: any) => {
    if (!entry?.summary || !entry?.url) return;
    deduped.set(`${entry.url}:${entry.summary}`, entry);
  });
  return Array.from(deduped.values());
};

const buildExtractionPrompt = (
  cleanedEvidence: Array<{ label: string; url: string; summary: string }>,
  currentProfile: CompanyProfile
) => {
  const systemPrompt =
    'You are a Company Profile Extraction Engine.\n\n' +
    'Extract structured business facts from the provided evidence (website + social profiles).\n\n' +
    'Rules:\n' +
    '- Ignore CSS, JS, UI text, animations, navigation, and layout artifacts.\n' +
    '- Use only meaningful business content.\n' +
    '- Do not invent facts.\n' +
    '- Support multiple values for industry, geography, competitors, and content themes.\n' +
    '- If evidence exists, always return concrete values.\n' +
    '- If evidence is insufficient, return null with source="missing".\n\n' +
    'For each field return:\n' +
    '{ values: string[] | string | null, source: "website" | "social" | "inferred" | "missing", confidence: "High" | "Medium" | "Low" }\n\n' +
    'Output must be structured JSON only. No commentary.';

  const userPrompt =
    'Extract a structured Company Profile from the evidence below.\n\n' +
    'For each field return:\n' +
    '- values: string[] (or null)\n' +
    '- source: "website" | "social" | "inferred" | "missing"\n' +
    '- confidence: "High" | "Medium" | "Low"\n\n' +
    'Fields:\n' +
    '- company_name\n' +
    '- industry_list\n' +
    '- category_list\n' +
    '- geography_list\n' +
    '- products_services\n' +
    '- target_audience\n' +
    '- brand_voice\n' +
    '- goals\n' +
    '- competitors_list\n' +
    '- unique_value_proposition\n' +
    '- content_themes_list\n' +
    '- website_url\n' +
    '- social_profiles (object with linkedin, facebook, instagram, x, youtube, tiktok, reddit, blog)\n\n' +
    'Important:\n' +
    '- category_list should reflect what the company does (product/service categories), not just industry.\n' +
    '- Prefer 3-7 concise categories when evidence supports it.\n' +
    '- Use website headings, product/service sections, and positioning statements to infer categories.\n' +
    '- Avoid overly generic categories like "technology" unless explicitly stated.\n' +
    '- industry_list, category_list, geography_list, competitors_list, content_themes_list must be arrays.\n' +
    '- Do not return empty arrays if evidence exists.\n' +
    '- If multiple industries or geographies apply, include all.\n\n' +
    'Evidence:\n' +
    JSON.stringify(cleanedEvidence);

  return { systemPrompt, userPrompt };
};

const generateMissingFieldQuestions = async (
  client: OpenAI,
  extraction: CompanyProfileExtractionOutput
): Promise<Array<{ field: string; question: string; options: string[]; allow_multiple?: boolean }>> => {
  const systemPrompt =
    'From the Company Profile output and missing_fields list, generate a user questionnaire. ' +
    'For each missing or low-confidence field: write a clear question, provide dropdown-style options, ' +
    'allow multiple selections where relevant. Return JSON array only.';

  const userPrompt = JSON.stringify({
    extraction,
    missing_fields: extraction.missing_fields || [],
    fields_to_cover: [
      'industry',
      'category',
      'geography',
      'target_audience',
      'brand_voice',
      'goals',
      'competitors',
      'unique_value_proposition',
      'content_themes',
      'products_services',
    ],
    format: [
      {
        field: 'Industry',
        question: 'What industry best describes your company?',
        options: ['AI', 'SaaS', 'Wellness', 'Education', 'Finance', 'Other'],
        allow_multiple: true,
      },
    ],
  });

  const completion = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  const raw = completion.choices[0]?.message?.content?.trim() || '{}';
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : Array.isArray(parsed?.questions) ? parsed.questions : [];
};

const buildSourceList = (profile: CompanyProfile): Array<{ label: string; url: string }> => {
  const sources: Array<{ label: string; url: string }> = [];
  if (profile.website_url) sources.push({ label: 'website', url: profile.website_url });
  if (profile.linkedin_url) sources.push({ label: 'linkedin', url: profile.linkedin_url });
  if (profile.facebook_url) sources.push({ label: 'facebook', url: profile.facebook_url });
  if (profile.instagram_url) sources.push({ label: 'instagram', url: profile.instagram_url });
  if (profile.x_url) sources.push({ label: 'x', url: profile.x_url });
  if (profile.youtube_url) sources.push({ label: 'youtube', url: profile.youtube_url });
  if (profile.tiktok_url) sources.push({ label: 'tiktok', url: profile.tiktok_url });
  if (profile.reddit_url) sources.push({ label: 'reddit', url: profile.reddit_url });
  if (profile.blog_url) sources.push({ label: 'blog', url: profile.blog_url });

  (profile.other_social_links || []).forEach((entry, index) => {
    if (entry?.url) {
      sources.push({
        label: entry.label?.trim() || `other_${index + 1}`,
        url: entry.url,
      });
    }
  });

  (profile.social_profiles || []).forEach((entry) => {
    if (entry?.url) {
      sources.push({
        label: entry.platform || 'social',
        url: entry.url,
      });
    }
  });

  const deduped = new Map<string, { label: string; url: string }>();
  sources.forEach((source) => {
    const normalized = normalizeUrl(source.url);
    if (!normalized || shouldSkipUrl(normalized) || isPlaceholderUrl(normalized)) return;
    if (!deduped.has(normalized)) {
      deduped.set(normalized, { ...source, url: normalized });
    }
  });
  return Array.from(deduped.values());
};

const pickValue = (value?: string | string[] | null, fallback?: string | null): string | null => {
  if (Array.isArray(value)) {
    const filtered = value.filter((item) => typeof item === 'string' && item.trim().length > 0);
    return filtered.length > 0 ? filtered.join(', ') : fallback ?? null;
  }
  if (value === undefined || value === null) return fallback ?? null;
  if (typeof value === 'string' && value.trim().length === 0) return fallback ?? null;
  return value;
};

const computeConfidenceScore = (extraction: CompanyProfileExtractionOutput): number => {
  const fields = [
    extraction.company_name,
    extraction.industry,
    extraction.category,
    extraction.website_url,
    extraction.geography,
    extraction.products_services,
    extraction.target_audience,
    extraction.brand_voice,
    extraction.goals,
    extraction.competitors,
    extraction.unique_value_proposition,
    extraction.content_themes,
  ];
  const total = fields.length;
  const extracted = fields.filter((field) => field && field.source !== 'missing').length;
  return Math.round((extracted / total) * 100);
};

const coerceArrayValue = (value: string | string[] | null): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return splitToList(value);
};

const updateArrayField = (
  current: string[] | null | undefined,
  incoming: string | string[] | null,
  incomingSource?: string | null,
  currentConfidence?: string | null,
  incomingConfidence?: string | null
): { value: string[]; confidence: string } => {
  const merged = mergeStringArrays(current || [], filterGenericValues(coerceArrayValue(incoming), incomingSource));
  const confidence =
    confidenceRank(incomingConfidence) > confidenceRank(currentConfidence)
      ? incomingConfidence || currentConfidence || 'Low'
      : currentConfidence || incomingConfidence || 'Low';
  return { value: merged, confidence };
};

const updateScalarField = (
  current: string | null | undefined,
  incoming: string | string[] | null,
  incomingSource?: string | null,
  currentConfidence?: string | null,
  incomingConfidence?: string | null
): { value: string | null; confidence: string } => {
  const incomingValue = Array.isArray(incoming) ? incoming[0] : incoming;
  const cleanedValue =
    incomingValue && incomingSource && incomingSource !== 'missing' && !isGenericValue(incomingValue)
      ? incomingValue
      : incomingValue;
  if (shouldReplaceValue(incomingConfidence, currentConfidence) && cleanedValue) {
    return { value: cleanedValue, confidence: incomingConfidence || 'Low' };
  }
  return { value: current ?? null, confidence: currentConfidence || incomingConfidence || 'Low' };
};

const buildSocialProfileList = (
  current: CompanyProfile['social_profiles'],
  incoming: CompanyProfileExtractionOutput['social_profiles']
): Array<{ platform: string; url: string; source?: string; confidence?: string }> => {
  const result: Array<{ platform: string; url: string; source?: string; confidence?: string }> = [];
  const add = (platform: string, field: any) => {
    const raw = field?.value;
    const urls = Array.isArray(raw) ? raw : raw ? [raw] : [];
    urls.forEach((url) => {
      if (!url || typeof url !== 'string') return;
      if (isPlaceholderUrl(url)) return;
      const normalized = normalizeSocialUrl(url);
      if (!normalized || shouldSkipUrl(normalized)) return;
      if (isGenericSocialUrl(normalized)) return;
      if (platform !== 'blog' && !isLikelyCompanySocialLink(platform, normalized)) return;
      result.push({
        platform,
        url: normalized,
        source: field?.source,
        confidence: field?.confidence,
      });
    });
  };

  add('linkedin', incoming.linkedin);
  add('facebook', incoming.facebook);
  add('instagram', incoming.instagram);
  add('x', incoming.x);
  add('youtube', incoming.youtube);
  add('tiktok', incoming.tiktok);
  add('reddit', incoming.reddit);
  add('blog', incoming.blog);

  const merged = [...(current || []), ...result];
  const deduped = new Map<string, { platform: string; url: string; source?: string; confidence?: string }>();
  merged.forEach((entry) => {
    const normalized = normalizeSocialUrl(entry.url || '');
    if (!normalized) return;
    const existing = deduped.get(normalized);
    if (!existing || shouldReplaceValue(entry.confidence, existing.confidence)) {
      deduped.set(normalized, { ...entry, url: normalized });
    }
  });
  return Array.from(deduped.values());
};
const mergeDiscoveredSocialProfiles = (
  profile: CompanyProfile,
  discovered: Record<string, string[]> | undefined | null
): CompanyProfile => {
  const updated = { ...profile };
  const safeDiscovered: Record<string, string[]> = discovered || {};
  const getList = (key: string) =>
    Array.isArray(safeDiscovered[key]) ? safeDiscovered[key] : [];
  const linkedin = getList('linkedin');
  const facebook = getList('facebook');
  const instagram = getList('instagram');
  const x = getList('x');
  const youtube = getList('youtube');
  const tiktok = getList('tiktok');
  const reddit = getList('reddit');

  if (!updated.linkedin_url && linkedin[0]) updated.linkedin_url = linkedin[0];
  if (!updated.facebook_url && facebook[0]) updated.facebook_url = facebook[0];
  if (!updated.instagram_url && instagram[0]) updated.instagram_url = instagram[0];
  if (!updated.x_url && x[0]) updated.x_url = x[0];
  if (!updated.youtube_url && youtube[0]) updated.youtube_url = youtube[0];
  if (!updated.tiktok_url && tiktok[0]) updated.tiktok_url = tiktok[0];
  if (!updated.reddit_url && reddit[0]) updated.reddit_url = reddit[0];

  const primarySocials: Array<{ platform: string; url: string }> = [
    { platform: 'linkedin', url: linkedin[0] || '' },
    { platform: 'facebook', url: facebook[0] || '' },
    { platform: 'instagram', url: instagram[0] || '' },
    { platform: 'x', url: x[0] || '' },
    { platform: 'youtube', url: youtube[0] || '' },
    { platform: 'tiktok', url: tiktok[0] || '' },
    { platform: 'reddit', url: reddit[0] || '' },
  ].filter((entry) => entry.url);

  const existingProfiles = Array.isArray(updated.social_profiles)
    ? [...updated.social_profiles]
    : [];
  const seen = new Set(
    existingProfiles.map((entry) => normalizeSocialUrl(entry.url || '')).filter(Boolean)
  );
  primarySocials.forEach((entry) => {
    const normalized = normalizeSocialUrl(entry.url);
    if (!normalized || seen.has(normalized)) return;
    if (isPlaceholderUrl(normalized)) return;
    existingProfiles.push({ platform: entry.platform, url: normalized, source: 'website', confidence: 'Medium' });
    seen.add(normalized);
  });
  updated.social_profiles = existingProfiles;

  const extraSocial = [
    ...linkedin.slice(1),
    ...facebook.slice(1),
    ...instagram.slice(1),
    ...x.slice(1),
    ...youtube.slice(1),
    ...tiktok.slice(1),
    ...reddit.slice(1),
  ];

  if (extraSocial.length > 0) {
    const existing = Array.isArray(updated.other_social_links)
      ? [...updated.other_social_links]
      : [];
    extraSocial.slice(0, MAX_SOCIAL_LINKS).forEach((url, index) => {
      const normalized = normalizeUrl(url);
      if (!normalized || isPlaceholderUrl(normalized)) return;
      existing.push({ label: `discovered_${index + 1}`, url });
    });
    updated.other_social_links = existing;
  }

  return updated;
};

const buildChangedFields = (
  beforeProfile: CompanyProfile,
  afterProfile: CompanyProfile
): Array<{ field: string; before: any; after: any }> => {
  const trackedFields: Array<keyof CompanyProfile> = [
    'name',
    'industry',
    'category',
    'products_services',
    'target_audience',
    'geography',
    'brand_voice',
    'goals',
    'competitors',
    'unique_value',
    'content_themes',
    'confidence_score',
  ];

  const normalizeValue = (value: any) =>
    value === '' || value === undefined ? null : value;

  return trackedFields
    .map((field) => ({
      field,
      before: normalizeValue(beforeProfile[field]),
      after: normalizeValue(afterProfile[field]),
    }))
    .filter((entry) => entry.before !== entry.after);
};

const storeRefinementAudit = async (details: CompanyProfileRefinementDetails) => {
  try {
    const { error } = await supabase.from('company_profile_refinements').insert({
      company_id: details.company_id,
      before_profile: details.before_profile,
      after_profile: details.after_profile,
      source_urls: details.source_urls,
      source_summaries: details.source_summaries,
      changed_fields: details.changed_fields,
      extraction_output: details.extraction_output,
      missing_fields_questions: details.missing_fields_questions,
      overall_confidence: details.after_profile.overall_confidence ?? 0,
      created_at: details.created_at,
    });
    if (error) {
      console.warn('Failed to store company profile refinement audit', error.message);
    }
  } catch (error) {
    console.warn('Failed to store company profile refinement audit');
  }
};

export const shouldRefineProfile = (lastRefinedAt?: string | null): boolean => {
  if (!lastRefinedAt) return true;
  const last = new Date(lastRefinedAt).getTime();
  if (Number.isNaN(last)) return true;
  const now = Date.now();
  const diffDays = (now - last) / (1000 * 60 * 60 * 24);
  return diffDays >= 7;
};

const fetchProfileRaw = async (companyId: string): Promise<CompanyProfile | null> => {
  const { data, error } = await supabase
    .from('company_profiles')
    .select('*')
    .eq('company_id', companyId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(`Failed to fetch company profile: ${error.message}`);
  }

  return data;
};

export const getLatestProfile = async (): Promise<CompanyProfile | null> => {
  const { data, error } = await supabase
    .from('company_profiles')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch latest company profile: ${error.message}`);
  }

  return data ?? null;
};

const splitToList = (value?: string | null): string[] => {
  if (!value) return [];
  return value
    .split(/[,;/|]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
};

export async function saveProfile(input: Partial<CompanyProfile>): Promise<CompanyProfile> {
  let companyId = input.company_id;
  if (!companyId) {
    companyId = randomUUID();
  }
  companyId = normalizeCompanyId(companyId);
  console.log('Resolved company_id:', companyId);
  const existing = await fetchProfileRaw(companyId);

  const lastRefinedAt =
    input.last_refined_at ?? existing?.last_refined_at ?? new Date().toISOString();
  const confidenceScore = input.confidence_score ?? existing?.confidence_score ?? 0;

  const payload = {
    company_id: companyId,
    name: input.name ?? existing?.name ?? null,
    industry: input.industry ?? existing?.industry ?? null,
    category: input.category ?? existing?.category ?? null,
    website_url: input.website_url ?? existing?.website_url ?? null,
    industry_list: mergeStringArrays(
      existing?.industry_list ?? splitToList(existing?.industry),
      input.industry_list ?? splitToList(input.industry)
    ),
    category_list: mergeStringArrays(
      existing?.category_list ?? splitToList(existing?.category),
      input.category_list ?? splitToList(input.category)
    ),
    geography_list: mergeStringArrays(
      existing?.geography_list ?? splitToList(existing?.geography),
      input.geography_list ?? splitToList(input.geography)
    ),
    competitors_list: mergeStringArrays(
      existing?.competitors_list ?? splitToList(existing?.competitors),
      input.competitors_list ?? splitToList(input.competitors)
    ),
    content_themes_list: mergeStringArrays(
      existing?.content_themes_list ?? splitToList(existing?.content_themes),
      input.content_themes_list ?? splitToList(input.content_themes)
    ),
    products_services_list: mergeStringArrays(
      existing?.products_services_list ?? splitToList(existing?.products_services),
      input.products_services_list ?? splitToList(input.products_services)
    ),
    target_audience_list: mergeStringArrays(
      existing?.target_audience_list ?? splitToList(existing?.target_audience),
      input.target_audience_list ?? splitToList(input.target_audience)
    ),
    goals_list: mergeStringArrays(
      existing?.goals_list ?? splitToList(existing?.goals),
      input.goals_list ?? splitToList(input.goals)
    ),
    brand_voice_list: mergeStringArrays(
      existing?.brand_voice_list ?? splitToList(existing?.brand_voice),
      input.brand_voice_list ?? splitToList(input.brand_voice)
    ),
    social_profiles: input.social_profiles ?? existing?.social_profiles ?? null,
    field_confidence: input.field_confidence ?? existing?.field_confidence ?? null,
    overall_confidence: input.overall_confidence ?? existing?.overall_confidence ?? 0,
    source_urls: input.source_urls ?? existing?.source_urls ?? null,
    linkedin_url: input.linkedin_url ?? existing?.linkedin_url ?? null,
    facebook_url: input.facebook_url ?? existing?.facebook_url ?? null,
    instagram_url: input.instagram_url ?? existing?.instagram_url ?? null,
    x_url: input.x_url ?? existing?.x_url ?? null,
    youtube_url: input.youtube_url ?? existing?.youtube_url ?? null,
    tiktok_url: input.tiktok_url ?? existing?.tiktok_url ?? null,
    reddit_url: input.reddit_url ?? existing?.reddit_url ?? null,
    blog_url: input.blog_url ?? existing?.blog_url ?? null,
    other_social_links: input.other_social_links ?? existing?.other_social_links ?? null,
    products_services: input.products_services ?? existing?.products_services ?? null,
    target_audience: input.target_audience ?? existing?.target_audience ?? null,
    geography: input.geography ?? existing?.geography ?? null,
    brand_voice: input.brand_voice ?? existing?.brand_voice ?? null,
    goals: input.goals ?? existing?.goals ?? null,
    competitors: input.competitors ?? existing?.competitors ?? null,
    unique_value: input.unique_value ?? existing?.unique_value ?? null,
    content_themes: input.content_themes ?? existing?.content_themes ?? null,
    confidence_score: confidenceScore,
    source: 'user' as const,
    last_refined_at: lastRefinedAt,
    updated_at: new Date().toISOString(),
    target_customer_segment: input.target_customer_segment ?? existing?.target_customer_segment ?? null,
    ideal_customer_profile: input.ideal_customer_profile ?? existing?.ideal_customer_profile ?? null,
    pricing_model: input.pricing_model ?? existing?.pricing_model ?? null,
    sales_motion: input.sales_motion ?? existing?.sales_motion ?? null,
    avg_deal_size: input.avg_deal_size ?? existing?.avg_deal_size ?? null,
    sales_cycle: input.sales_cycle ?? existing?.sales_cycle ?? null,
    key_metrics: input.key_metrics ?? existing?.key_metrics ?? null,
    user_locked_fields: existing?.user_locked_fields ?? [],
    last_edited_by: existing?.last_edited_by ?? null,
    marketing_channels: input.marketing_channels ?? existing?.marketing_channels ?? null,
    content_strategy: input.content_strategy ?? existing?.content_strategy ?? null,
    campaign_focus: input.campaign_focus ?? existing?.campaign_focus ?? null,
    key_messages: input.key_messages ?? existing?.key_messages ?? null,
    brand_positioning: input.brand_positioning ?? existing?.brand_positioning ?? null,
    competitive_advantages: input.competitive_advantages ?? existing?.competitive_advantages ?? null,
    growth_priorities: input.growth_priorities ?? existing?.growth_priorities ?? null,
    campaign_purpose_intent: input.campaign_purpose_intent ?? existing?.campaign_purpose_intent ?? null,
  };

  const lockedSet = new Set<string>(Array.isArray(existing?.user_locked_fields) ? existing.user_locked_fields : []);
  let didLock = false;
  for (const key of COMMERCIAL_FIELD_NAMES) {
    const val = input[key];
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      lockedSet.add(key);
      didLock = true;
    }
  }
  for (const key of MARKETING_INTELLIGENCE_FIELD_NAMES) {
    const val = input[key];
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      lockedSet.add(key);
      didLock = true;
    }
  }
  if (didLock) {
    payload.user_locked_fields = Array.from(lockedSet);
    payload.last_edited_by = 'user';
  }

  const { data, error } = await supabase
    .from('company_profiles')
    .upsert(payload, { onConflict: 'company_id' })
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to save company profile: ${error.message}`);
  }

  return data;
}

export async function getProfile(
  companyId?: string,
  options?: { autoRefine?: boolean }
): Promise<CompanyProfile | null> {
  const resolvedCompanyId = normalizeCompanyId(companyId);
  const profile = await fetchProfileRaw(resolvedCompanyId);
  if (!profile) return null;

  const autoRefine = options?.autoRefine ?? true;
  if (autoRefine && shouldRefineProfile(profile.last_refined_at)) {
    return refineProfileWithAI(profile, { force: true });
  }

  return profile;
}

const runProfileRefinement = async (
  profile: CompanyProfile,
  options?: { force?: boolean }
): Promise<{ profile: CompanyProfile; details: CompanyProfileRefinementDetails }> => {
  if (!options?.force && !shouldRefineProfile(profile.last_refined_at)) {
    const details: CompanyProfileRefinementDetails = {
      company_id: profile.company_id,
      before_profile: profile,
      after_profile: profile,
      source_urls: [],
      source_summaries: [],
      changed_fields: [],
      created_at: new Date().toISOString(),
    };
    return { profile, details };
  }

  const client = getOpenAiClient();
  let workingProfile = { ...profile };
  console.log('Profile before refine:', workingProfile);
  let discoveredSources: Array<{ label: string; url: string }> = [];
  let discoveredSummaries: Array<{ label: string; url: string; summary: string }> = [];
  const existingSourceUrls = new Set(
    (workingProfile.source_urls || [])
      .map((url) => normalizeUrl(url))
      .filter((url): url is string => Boolean(url))
  );

  if (workingProfile.website_url) {
    const crawlResult = await crawlWebsiteSources(workingProfile.website_url, existingSourceUrls);
    discoveredSources = crawlResult.urls;
    discoveredSummaries = crawlResult.summaries;
    const discoveredSocial = crawlResult.social_links;
    console.log('DISCOVERED SOCIAL LINKS:', discoveredSocial);
    workingProfile = mergeDiscoveredSocialProfiles(workingProfile, discoveredSocial);
  }

  const sourceList = [
    ...discoveredSources,
    ...buildSourceList(workingProfile),
  ];
  const dedupedSourceList = Array.from(
    new Map(sourceList.map((item) => [item.url, item])).values()
  );

  const socialSummaries = await Promise.all(
    dedupedSourceList.map(async (source) => ({
      label: source.label,
      url: source.url,
      summary: await fetchUrlSummary(source.url),
    }))
  );
  const summarizedSources = [
    ...discoveredSummaries,
    ...socialSummaries.filter((entry) => entry.summary),
  ]
    .filter((entry) => !shouldSkipUrl(entry.url))
    .slice(0, 40);

  const socialEvidenceLines = (workingProfile.social_profiles || [])
    .map((entry) => entry?.url)
    .filter(Boolean)
    .map((url) => `- ${url}`);
  const socialEvidence =
    socialEvidenceLines.length > 0
      ? [
          {
            label: 'social_profiles',
            url: 'social_profiles',
            summary: `SOCIAL PROFILES FOUND:\n${socialEvidenceLines.join('\n')}`,
          },
        ]
      : [];

  const evidenceWithSocial = [...summarizedSources, ...socialEvidence];

  const cleanedEvidence = await cleanEvidenceWithAi(client, evidenceWithSocial);
  const evidenceForExtraction = cleanedEvidence.length > 0 ? cleanedEvidence : evidenceWithSocial;
  const extractionPrompt = buildExtractionPrompt(evidenceForExtraction, workingProfile);

  const extractionCompletion = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: extractionPrompt.systemPrompt },
      { role: 'user', content: extractionPrompt.userPrompt },
    ],
  });

  const extractionRaw = extractionCompletion.choices[0]?.message?.content?.trim() || '{}';
  const extractionParsed = JSON.parse(extractionRaw);
  let extraction = buildExtractionWithDefaults(extractionParsed);
  console.log('CLEANED EVIDENCE:', cleanedEvidence);
  console.log('AI EXTRACTION RAW:', extractionCompletion);
  console.log('PARSED EXTRACTION:', extraction);
  console.log('Extraction result:', extraction);
  if (!extraction.missing_fields || extraction.missing_fields.length === 0) {
    extraction.missing_fields = computeMissingFields(extraction);
  }
  let missingFieldQuestions: Array<{ field: string; question: string; options: string[]; allow_multiple?: boolean }> = [];
  try {
    missingFieldQuestions = await generateMissingFieldQuestions(client, extraction);
  } catch (error) {
    console.warn('Missing-field questionnaire generation failed.');
  }
  const existingConfidence = workingProfile.field_confidence || {};

  const industryUpdate = updateArrayField(
    workingProfile.industry_list ?? splitToList(workingProfile.industry),
    extraction.industry.value,
    extraction.industry.source,
    existingConfidence.industry,
    extraction.industry.confidence
  );
  const categoryUpdate = updateArrayField(
    workingProfile.category_list ?? splitToList(workingProfile.category),
    extraction.category.value,
    extraction.category.source,
    existingConfidence.category,
    extraction.category.confidence
  );
  const geographyUpdate = updateArrayField(
    workingProfile.geography_list ?? splitToList(workingProfile.geography),
    extraction.geography.value,
    extraction.geography.source,
    existingConfidence.geography,
    extraction.geography.confidence
  );
  const competitorsUpdate = updateArrayField(
    workingProfile.competitors_list ?? splitToList(workingProfile.competitors),
    extraction.competitors.value,
    extraction.competitors.source,
    existingConfidence.competitors,
    extraction.competitors.confidence
  );
  const themesUpdate = updateArrayField(
    workingProfile.content_themes_list ?? splitToList(workingProfile.content_themes),
    extraction.content_themes.value,
    extraction.content_themes.source,
    existingConfidence.content_themes,
    extraction.content_themes.confidence
  );
  const productsUpdate = updateArrayField(
    workingProfile.products_services_list ?? splitToList(workingProfile.products_services),
    extraction.products_services.value,
    extraction.products_services.source,
    existingConfidence.products_services,
    extraction.products_services.confidence
  );
  const audienceUpdate = updateArrayField(
    workingProfile.target_audience_list ?? splitToList(workingProfile.target_audience),
    extraction.target_audience.value,
    extraction.target_audience.source,
    existingConfidence.target_audience,
    extraction.target_audience.confidence
  );
  const goalsUpdate = updateArrayField(
    workingProfile.goals_list ?? splitToList(workingProfile.goals),
    extraction.goals.value,
    extraction.goals.source,
    existingConfidence.goals,
    extraction.goals.confidence
  );
  const brandVoiceUpdate = updateArrayField(
    workingProfile.brand_voice_list ?? splitToList(workingProfile.brand_voice),
    extraction.brand_voice.value,
    extraction.brand_voice.source,
    existingConfidence.brand_voice,
    extraction.brand_voice.confidence
  );

  const nameUpdate = updateScalarField(
    workingProfile.name,
    extraction.company_name.value,
    extraction.company_name.source,
    existingConfidence.company_name,
    extraction.company_name.confidence
  );
  const websiteUpdate = updateScalarField(
    workingProfile.website_url,
    extraction.website_url.value,
    extraction.website_url.source,
    existingConfidence.website_url,
    extraction.website_url.confidence
  );
  const uniqueUpdate = updateScalarField(
    workingProfile.unique_value,
    extraction.unique_value_proposition.value,
    extraction.unique_value_proposition.source,
    existingConfidence.unique_value_proposition,
    extraction.unique_value_proposition.confidence
  );

  const mergedSocialProfiles = buildSocialProfileList(
    workingProfile.social_profiles,
    extraction.social_profiles
  );
  mergedSocialProfiles.forEach((entry) => {
    if (entry.platform === 'linkedin' && !workingProfile.linkedin_url) workingProfile.linkedin_url = entry.url;
    if (entry.platform === 'facebook' && !workingProfile.facebook_url) workingProfile.facebook_url = entry.url;
    if (entry.platform === 'instagram' && !workingProfile.instagram_url) workingProfile.instagram_url = entry.url;
    if (entry.platform === 'x' && !workingProfile.x_url) workingProfile.x_url = entry.url;
    if (entry.platform === 'youtube' && !workingProfile.youtube_url) workingProfile.youtube_url = entry.url;
    if (entry.platform === 'tiktok' && !workingProfile.tiktok_url) workingProfile.tiktok_url = entry.url;
    if (entry.platform === 'reddit' && !workingProfile.reddit_url) workingProfile.reddit_url = entry.url;
    if (entry.platform === 'blog' && !workingProfile.blog_url) workingProfile.blog_url = entry.url;
  });

  const mergedSourceUrls = Array.from(
    new Set([
      ...(workingProfile.source_urls || []),
      ...dedupedSourceList.map((entry) => entry.url),
    ].map((url) => normalizeUrl(url)).filter((url): url is string => Boolean(url)))
  );

  const fieldConfidence = {
    company_name: nameUpdate.confidence,
    industry: industryUpdate.confidence,
    category: categoryUpdate.confidence,
    geography: geographyUpdate.confidence,
    competitors: competitorsUpdate.confidence,
    content_themes: themesUpdate.confidence,
    products_services: productsUpdate.confidence,
    target_audience: audienceUpdate.confidence,
    goals: goalsUpdate.confidence,
    brand_voice: brandVoiceUpdate.confidence,
    website_url: websiteUpdate.confidence,
    unique_value_proposition: uniqueUpdate.confidence,
  };

  const extractionConfidence = computeConfidenceScore(extraction);
  const refined = {
    name: nameUpdate.value,
    industry: industryUpdate.value.join(', '),
    category: categoryUpdate.value.join(', '),
    website_url: websiteUpdate.value,
    products_services: productsUpdate.value.join(', '),
    target_audience: audienceUpdate.value.join(', '),
    geography: geographyUpdate.value.join(', '),
    brand_voice: brandVoiceUpdate.value.join(', '),
    goals: goalsUpdate.value.join(', '),
    competitors: competitorsUpdate.value.join(', '),
    unique_value: uniqueUpdate.value,
    content_themes: themesUpdate.value.join(', '),
    confidence_score: Math.max(workingProfile.confidence_score ?? 0, extractionConfidence),
    industry_list: industryUpdate.value,
    category_list: categoryUpdate.value,
    geography_list: geographyUpdate.value,
    competitors_list: competitorsUpdate.value,
    content_themes_list: themesUpdate.value,
    products_services_list: productsUpdate.value,
    target_audience_list: audienceUpdate.value,
    goals_list: goalsUpdate.value,
    brand_voice_list: brandVoiceUpdate.value,
    social_profiles: mergedSocialProfiles,
    field_confidence: fieldConfidence,
    overall_confidence: Math.max(workingProfile.overall_confidence ?? 0, extractionConfidence),
    source_urls: mergedSourceUrls,
  };

  console.log('MERGED PROFILE:', refined);
  console.info('Company profile extraction summary', {
    company_id: workingProfile.company_id,
    missing_fields: extraction.missing_fields || [],
    counts: {
      industry: refined.industry_list?.length || 0,
      category: refined.category_list?.length || 0,
      geography: refined.geography_list?.length || 0,
      products_services: refined.products_services_list?.length || 0,
      target_audience: refined.target_audience_list?.length || 0,
      goals: refined.goals_list?.length || 0,
      content_themes: refined.content_themes_list?.length || 0,
      competitors: refined.competitors_list?.length || 0,
      social_profiles: refined.social_profiles?.length || 0,
      source_urls: refined.source_urls?.length || 0,
    },
  });
  const locked = new Set<string>(
    Array.isArray(workingProfile.user_locked_fields) ? workingProfile.user_locked_fields : []
  );
  const pick = <T>(refinedVal: T, workingVal: T, field: string): T =>
    locked.has(field) ? workingVal : (refinedVal ?? workingVal ?? null);

  const refinedPayload = {
    company_id: workingProfile.company_id,
    name: pick(refined.name, workingProfile.name, 'name'),
    industry: pick(refined.industry, workingProfile.industry, 'industry'),
    category: pick(refined.category, workingProfile.category, 'category'),
    website_url: pick(refined.website_url, workingProfile.website_url, 'website_url'),
    linkedin_url: workingProfile.linkedin_url ?? null,
    facebook_url: workingProfile.facebook_url ?? null,
    instagram_url: workingProfile.instagram_url ?? null,
    x_url: workingProfile.x_url ?? null,
    youtube_url: workingProfile.youtube_url ?? null,
    tiktok_url: workingProfile.tiktok_url ?? null,
    reddit_url: workingProfile.reddit_url ?? null,
    blog_url: workingProfile.blog_url ?? null,
    other_social_links: workingProfile.other_social_links ?? null,
    products_services: pick(refined.products_services, workingProfile.products_services, 'products_services'),
    target_audience: pick(refined.target_audience, workingProfile.target_audience, 'target_audience'),
    geography: pick(refined.geography, workingProfile.geography, 'geography'),
    brand_voice: pick(refined.brand_voice, workingProfile.brand_voice, 'brand_voice'),
    goals: pick(refined.goals, workingProfile.goals, 'goals'),
    competitors: pick(refined.competitors, workingProfile.competitors, 'competitors'),
    unique_value: pick(refined.unique_value, workingProfile.unique_value, 'unique_value'),
    content_themes: pick(refined.content_themes, workingProfile.content_themes, 'content_themes'),
    industry_list: pick(refined.industry_list, workingProfile.industry_list, 'industry_list'),
    category_list: pick(refined.category_list, workingProfile.category_list, 'category_list'),
    geography_list: pick(refined.geography_list, workingProfile.geography_list, 'geography_list'),
    competitors_list: pick(refined.competitors_list, workingProfile.competitors_list, 'competitors_list'),
    content_themes_list: pick(refined.content_themes_list, workingProfile.content_themes_list, 'content_themes_list'),
    products_services_list: pick(refined.products_services_list, workingProfile.products_services_list, 'products_services_list'),
    target_audience_list: pick(refined.target_audience_list, workingProfile.target_audience_list, 'target_audience_list'),
    goals_list: pick(refined.goals_list, workingProfile.goals_list, 'goals_list'),
    brand_voice_list: pick(refined.brand_voice_list, workingProfile.brand_voice_list, 'brand_voice_list'),
    social_profiles: locked.has('social_profiles') ? workingProfile.social_profiles : (refined.social_profiles ?? workingProfile.social_profiles ?? null),
    field_confidence: refined.field_confidence ?? workingProfile.field_confidence ?? null,
    overall_confidence: refined.overall_confidence ?? workingProfile.overall_confidence ?? 0,
    source_urls: refined.source_urls ?? workingProfile.source_urls ?? null,
    confidence_score: refined.confidence_score ?? workingProfile.confidence_score ?? 0,
    source: 'ai_refined' as const,
    last_refined_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    target_customer_segment: workingProfile.target_customer_segment ?? null,
    ideal_customer_profile: workingProfile.ideal_customer_profile ?? null,
    pricing_model: workingProfile.pricing_model ?? null,
    sales_motion: workingProfile.sales_motion ?? null,
    avg_deal_size: workingProfile.avg_deal_size ?? null,
    sales_cycle: workingProfile.sales_cycle ?? null,
    key_metrics: workingProfile.key_metrics ?? null,
    user_locked_fields: workingProfile.user_locked_fields ?? null,
    last_edited_by: workingProfile.last_edited_by ?? null,
    marketing_channels: workingProfile.marketing_channels ?? null,
    content_strategy: workingProfile.content_strategy ?? null,
    campaign_focus: workingProfile.campaign_focus ?? null,
    key_messages: workingProfile.key_messages ?? null,
    brand_positioning: workingProfile.brand_positioning ?? null,
    competitive_advantages: workingProfile.competitive_advantages ?? null,
    growth_priorities: workingProfile.growth_priorities ?? null,
  };

  const { data, error } = await supabase
    .from('company_profiles')
    .upsert(refinedPayload, { onConflict: 'company_id' })
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to refine company profile: ${error.message}`);
  }

  const changedFields = buildChangedFields(workingProfile, data);
  const auditDetails: CompanyProfileRefinementDetails = {
    company_id: workingProfile.company_id,
    before_profile: workingProfile,
    after_profile: data,
    source_urls: dedupedSourceList,
    source_summaries: evidenceForExtraction,
    changed_fields: changedFields,
    created_at: new Date().toISOString(),
    extraction_output: extraction,
    missing_fields_questions: missingFieldQuestions,
  };
  await storeRefinementAudit(auditDetails);

  // User-initiated recommendations only: no automatic recommendation generation on profile update.
  // Recommendations are generated only via POST /api/recommendations/generate.

  return { profile: data, details: auditDetails };
};

export async function refineProfileWithAI(
  profile: CompanyProfile,
  options?: { force?: boolean }
): Promise<CompanyProfile> {
  const result = await runProfileRefinement(profile, options);
  return result.profile;
}

export async function refineProfileWithAIWithDetails(
  profile: CompanyProfile,
  options?: { force?: boolean }
): Promise<{ profile: CompanyProfile; details: CompanyProfileRefinementDetails }> {
  return runProfileRefinement(profile, options);
}
