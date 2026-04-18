import { runCompletionWithOperation } from '../aiGateway';
import { CompanyProfile, CompanyProfileExtractionOutput, ExtractedEvidence } from './types';
import {
  normalizeUrl,
  normalizeSocialUrl,
  isPlaceholderUrl,
  isGenericSocialUrl,
  isLikelyCompanySocialLink,
  shouldSkipUrl,
  isSameDomain,
  getBrandTokensFromUrl,
  shouldReplaceValue,
  buildExtractionWithDefaults,
} from './normalization';

const MAX_CRAWL_PAGES = 4; // root + 3 sub-pages; 12 was causing 60s+ hangs on SPAs / Cloudflare sites
const MAX_SOCIAL_LINKS = 8;

const scoreUrl = (url: string): number => {
  const keywords = [
    'about', 'company', 'team', 'story', 'mission', 'values',
    'services', 'solutions', 'products', 'blog', 'news', 'press',
    'pricing', 'case', 'testimonial', 'customer', 'careers',
  ];
  const lower = url.toLowerCase();
  return keywords.reduce((score, keyword) => score + (lower.includes(keyword) ? 1 : 0), 0);
};

export const extractLinksFromHtml = (html: string, baseUrl: string): string[] => {
  const links = new Set<string>();
  const regex = /href=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html))) {
    const href = match[1];
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) continue;
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

export const extractSocialLinksFromHtml = (
  html: string,
  baseUrl: string
): Record<string, string[]> => {
  const buckets: Record<string, Map<string, number>> = {
    linkedin: new Map(), facebook: new Map(), instagram: new Map(),
    x: new Map(), youtube: new Map(), tiktok: new Map(), reddit: new Map(),
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
    if (lower.includes('linkedin.com') && isLikelyCompanySocialLink('linkedin', normalized)) addTo(buckets.linkedin);
    else if (lower.includes('facebook.com') && isLikelyCompanySocialLink('facebook', normalized)) addTo(buckets.facebook);
    else if (lower.includes('instagram.com') && isLikelyCompanySocialLink('instagram', normalized)) addTo(buckets.instagram);
    else if ((lower.includes('x.com') || lower.includes('twitter.com')) && isLikelyCompanySocialLink('x', normalized)) addTo(buckets.x);
    else if ((lower.includes('youtube.com') || lower.includes('youtu.be')) && isLikelyCompanySocialLink('youtube', normalized)) addTo(buckets.youtube);
    else if (lower.includes('tiktok.com') && isLikelyCompanySocialLink('tiktok', normalized)) addTo(buckets.tiktok);
    else if (lower.includes('reddit.com') && isLikelyCompanySocialLink('reddit', normalized)) addTo(buckets.reddit);
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
      } catch { return; }
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

export const extractEvidenceFromHtml = (html: string): ExtractedEvidence => {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const metaDescriptionMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i);
  const ogDescriptionMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["'][^>]*>/i);

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

  const keywords = ['about', 'mission', 'services', 'solutions', 'products', 'industry', 'audience', 'reveals', 'company', 'we help', 'who we are'];
  const scored = sentences
    .map((line) => ({ line, score: keywords.reduce((sum, key) => sum + (line.toLowerCase().includes(key) ? 1 : 0), 0) }))
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

export const fetchUrlSummary = async (url?: string | null): Promise<string | null> => {
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
  } catch {
    console.warn('Profile source fetch failed for company profile refinement.');
    return null;
  }
};

export const crawlWebsiteSources = async (
  websiteUrl: string,
  existingUrls: Set<string>
): Promise<{
  urls: Array<{ label: string; url: string }>;
  summaries: Array<{ label: string; url: string; summary: string }>;
  social_links: Record<string, string[]>;
}> => {
  const normalizedWebsite = normalizeUrl(websiteUrl);
  if (!normalizedWebsite) return { urls: [], summaries: [], social_links: {} };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  let rootHtml = '';
  let socialLinks: Record<string, string[]> = {
    linkedin: [], facebook: [], instagram: [], x: [], youtube: [], tiktok: [], reddit: [],
  };
  try {
    const response = await fetch(normalizedWebsite, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (response.ok) {
      rootHtml = await response.text();
      socialLinks = extractSocialLinksFromHtml(rootHtml, normalizedWebsite);
    }
  } catch {
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
    summaries: summaries.filter((entry) => entry.summary) as Array<{ label: string; url: string; summary: string }>,
    social_links: socialLinks,
  };
};

// ─── Re-exported from refinementPrompts.ts (moved to keep file under 500 lines)
export { cleanEvidenceWithAi, buildExtractionPrompt, generateMissingFieldQuestions } from './refinementPrompts';

export const buildSourceList = (profile: CompanyProfile): Array<{ label: string; url: string }> => {
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
    if (entry?.url) sources.push({ label: entry.label?.trim() || `other_${index + 1}`, url: entry.url });
  });
  (profile.social_profiles || []).forEach((entry) => {
    if (entry?.url) sources.push({ label: entry.platform || 'social', url: entry.url });
  });

  const deduped = new Map<string, { label: string; url: string }>();
  sources.forEach((source) => {
    const normalized = normalizeUrl(source.url);
    if (!normalized || shouldSkipUrl(normalized) || isPlaceholderUrl(normalized)) return;
    if (!deduped.has(normalized)) deduped.set(normalized, { ...source, url: normalized });
  });
  return Array.from(deduped.values());
};

export const buildSocialProfileList = (
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
      result.push({ platform, url: normalized, source: field?.source, confidence: field?.confidence });
    });
  };

  add('linkedin', incoming?.linkedin);
  add('facebook', incoming?.facebook);
  add('instagram', incoming?.instagram);
  add('x', incoming?.x);
  add('youtube', incoming?.youtube);
  add('tiktok', incoming?.tiktok);
  add('reddit', incoming?.reddit);
  add('blog', incoming?.blog);

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

export const mergeDiscoveredSocialProfiles = (
  profile: CompanyProfile,
  discovered: Record<string, string[]> | undefined | null
): CompanyProfile => {
  const updated = { ...profile };
  const safeDiscovered: Record<string, string[]> = discovered || {};
  const getList = (key: string) => Array.isArray(safeDiscovered[key]) ? safeDiscovered[key] : [];
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

  const primarySocials = [
    { platform: 'linkedin', url: linkedin[0] || '' },
    { platform: 'facebook', url: facebook[0] || '' },
    { platform: 'instagram', url: instagram[0] || '' },
    { platform: 'x', url: x[0] || '' },
    { platform: 'youtube', url: youtube[0] || '' },
    { platform: 'tiktok', url: tiktok[0] || '' },
    { platform: 'reddit', url: reddit[0] || '' },
  ].filter((entry) => entry.url);

  const existingProfiles = Array.isArray(updated.social_profiles) ? [...updated.social_profiles] : [];
  const seen = new Set(existingProfiles.map((entry) => normalizeSocialUrl(entry.url || '')).filter(Boolean));
  primarySocials.forEach((entry) => {
    const normalized = normalizeSocialUrl(entry.url);
    if (!normalized || seen.has(normalized)) return;
    if (isPlaceholderUrl(normalized)) return;
    existingProfiles.push({ platform: entry.platform, url: normalized, source: 'website', confidence: 'Medium' });
    seen.add(normalized);
  });
  updated.social_profiles = existingProfiles;

  const extraSocial = [
    ...linkedin.slice(1), ...facebook.slice(1), ...instagram.slice(1),
    ...x.slice(1), ...youtube.slice(1), ...tiktok.slice(1), ...reddit.slice(1),
  ];

  if (extraSocial.length > 0) {
    const existing = Array.isArray(updated.other_social_links) ? [...updated.other_social_links] : [];
    extraSocial.slice(0, MAX_SOCIAL_LINKS).forEach((url, index) => {
      const normalized = normalizeUrl(url);
      if (!normalized || isPlaceholderUrl(normalized)) return;
      existing.push({ label: `discovered_${index + 1}`, url });
    });
    updated.other_social_links = existing;
  }

  return updated;
};

export const buildChangedFields = (
  beforeProfile: CompanyProfile,
  afterProfile: CompanyProfile
): Array<{ field: string; before: any; after: any }> => {
  const trackedFields: Array<keyof CompanyProfile> = [
    'name', 'industry', 'category', 'products_services', 'target_audience',
    'geography', 'brand_voice', 'goals', 'competitors', 'unique_value',
    'content_themes', 'confidence_score',
  ];
  const normalizeValue = (value: any) => value === '' || value === undefined ? null : value;
  return trackedFields
    .map((field) => ({ field, before: normalizeValue(beforeProfile[field]), after: normalizeValue(afterProfile[field]) }))
    .filter((entry) => entry.before !== entry.after);
};

export const pickValue = (value?: string | string[] | null, fallback?: string | null): string | null => {
  if (Array.isArray(value)) {
    const filtered = value.filter((item) => typeof item === 'string' && item.trim().length > 0);
    return filtered.length > 0 ? filtered.join(', ') : fallback ?? null;
  }
  if (value === undefined || value === null) return fallback ?? null;
  if (typeof value === 'string' && value.trim().length === 0) return fallback ?? null;
  return value;
};
