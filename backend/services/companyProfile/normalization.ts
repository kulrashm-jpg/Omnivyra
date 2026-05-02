import { CompanyProfile, NormalizedCompanyProfile } from './types';

// ─── URL / social helpers ────────────────────────────────────────────────────

export const shouldSkipUrl = (url: string): boolean => {
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

export const normalizeCompanyId = (companyId?: string | null): string => {
  const DEFAULT_COMPANY_ID = 'default';
  return companyId && companyId.trim().length > 0 ? companyId : DEFAULT_COMPANY_ID;
};

export const normalizeUrl = (value: string): string | null => {
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

export const normalizeSocialUrl = (value: string): string | null => {
  const normalized = normalizeUrl(value);
  if (!normalized) return null;
  const withoutWww = normalized.replace('https://www.', 'https://');
  if (withoutWww.startsWith('https://twitter.com')) {
    return withoutWww.replace('https://twitter.com', 'https://x.com');
  }
  return withoutWww;
};

export const isPlaceholderUrl = (url: string): boolean => {
  const lower = url.toLowerCase();
  return (
    lower.includes('example.com') ||
    lower.includes('yourhandle') ||
    lower.includes('yourpage')
  );
};

export const isGenericSocialUrl = (url: string): boolean => {
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

export const isLikelyCompanySocialLink = (platform: string, url: string): boolean => {
  try {
    const parsed = new URL(url);
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

export const getBrandTokensFromUrl = (baseUrl: string): string[] => {
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

export const isSameDomain = (baseUrl: string, targetUrl: string): boolean => {
  try {
    const base = new URL(baseUrl);
    const target = new URL(targetUrl);
    return base.hostname === target.hostname;
  } catch {
    return false;
  }
};

// ─── Array / string merge helpers ────────────────────────────────────────────

export const mergeStringArrays = (current?: string[] | null, incoming?: string[] | null): string[] => {
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

export const splitToList = (value?: string | null): string[] => {
  if (!value) return [];
  return value
    .split(/[,;/|]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
};

const normalizeList = (value?: string | null): string[] => {
  if (!value) return [];
  return value
    .split(/[,;/|]+/g)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
};

// ─── Confidence helpers ───────────────────────────────────────────────────────

export const confidenceRank = (value?: string | null): number => {
  if (!value) return 0;
  const normalized = value.toLowerCase();
  if (normalized === 'high') return 3;
  if (normalized === 'medium') return 2;
  if (normalized === 'low') return 1;
  return 0;
};

export const shouldReplaceValue = (newConfidence?: string | null, oldConfidence?: string | null): boolean => {
  return confidenceRank(newConfidence) > confidenceRank(oldConfidence);
};

const isGenericValue = (value: string): boolean => {
  const lower = value.trim().toLowerCase();
  return ['technology', 'global', 'other'].includes(lower);
};

export const filterGenericValues = (values: string[] | null, source?: string | null): string[] => {
  if (!values) return [];
  if (source === 'website' || source === 'social' || source === 'user') return values;
  return values.filter((value) => !isGenericValue(value));
};

export const coerceArrayValue = (value: string | string[] | null): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return splitToList(value);
};

export const updateArrayField = (
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

export const updateScalarField = (
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

// ─── normalizeCompanyProfile / validateCompanyProfile ────────────────────────

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
        ...normalizeList(profile?.business_classification?.level_2),
        ...(profile?.business_classification?.level_3 ?? []),
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

// ─── Re-export extraction schema helpers (moved to extractionSchema.ts) ──────
export {
  normalizeExtractionOutput,
  buildExtractionWithDefaults,
  computeMissingFields,
  computeConfidenceScore,
} from './extractionSchema';
