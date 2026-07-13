import { runCompletionWithOperation } from '../aiGateway';
import { CompanyProfile, CompanyProfileExtractionOutput, ExtractedEvidence } from './types';
import {
  extractWebsiteMetadata,
  hasDiscoveredSignal,
  type DiscoveredWebsiteMetadata,
} from './websiteMetadataExtractor';
// CKRE-001 — crawl-reuse cache, instrumentation, and deterministic change detection.
import { fetchPageCached } from '../crawl/crawlResultCache';
import {
  emitCrawlEvent,
  recordCrawlChangeMetric,
  resolveCrawlCorrelationId,
} from '../crawl/crawlEventService';
import { computeWebsiteFingerprint, hasFingerprintSignal } from '../crawl/websiteFingerprintService';
import { decideWebsiteChange } from '../crawl/changeDetectionService';
import { getLatestWebsiteFingerprint, saveWebsiteFingerprint } from '../crawl/fingerprintStore';

/**
 * CKRE-001 — optional instrumentation/change-detection context for a crawl.
 * Backward compatible: omit it and crawlWebsiteSources behaves exactly as
 * before (no events, no fingerprints). Supplying companyId enables the
 * deterministic fingerprint + change-detection foundation (no AI, no gating).
 */
export interface CrawlContext {
  companyId?: string | null;
  userId?: string | null;
  email?: string | null;
  correlationId?: string | null;
  workflow?: string | null;
  /** CKRE-001R §4 — crawl-session id, stamped onto every emitted event. */
  crawlId?: string;
}
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

const socialProfileKey = (platform: string | null | undefined, url: string | null | undefined): string | null => {
  const normalized = normalizeSocialUrl(url || '');
  if (!normalized) return null;
  return `${String(platform || 'social').trim().toLowerCase()}:${normalized}`;
};

const dedupeSocialProfileEntries = (
  entries: Array<{ platform: string; url: string; source?: string; confidence?: string }>,
): Array<{ platform: string; url: string; source?: string; confidence?: string }> => {
  const deduped = new Map<string, { platform: string; url: string; source?: string; confidence?: string }>();
  entries.forEach((entry) => {
    const normalized = normalizeSocialUrl(entry.url || '');
    const key = socialProfileKey(entry.platform, normalized);
    if (!normalized || !key) return;
    const normalizedEntry = {
      ...entry,
      platform: String(entry.platform || 'social').trim().toLowerCase(),
      url: normalized,
    };
    const existing = deduped.get(key);
    if (!existing || shouldReplaceValue(normalizedEntry.confidence, existing.confidence)) {
      deduped.set(key, normalizedEntry);
    }
  });
  return Array.from(deduped.values());
};

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
    pinterest: new Map(), whatsapp: new Map(),
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
    else if (lower.includes('pinterest.com') && isLikelyCompanySocialLink('pinterest', normalized)) addTo(buckets.pinterest);
    else if ((lower.includes('wa.me') || lower.includes('whatsapp.com')) && isLikelyCompanySocialLink('whatsapp', normalized)) addTo(buckets.whatsapp);
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
    pinterest: finalizeBucket(buckets.pinterest),
    whatsapp: finalizeBucket(buckets.whatsapp),
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
    // CKRE-001 §2/§7: route through the crawl-reuse cache so a page fetched
    // earlier in the same workflow (e.g. the root page, or a page shared by the
    // onboarding crawl and the profile-refinement crawl) is not fetched twice.
    // Still SSRF-safe (HARDEN-005) — the cache wraps safeFetch.
    const page = await fetchPageCached(url, { timeoutMs: 5000, maxBytes: 5 * 1024 * 1024 });
    if (!page.ok) return null;
    const evidence = extractEvidenceFromHtml(page.html);
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
  existingUrls: Set<string>,
  context?: CrawlContext,
): Promise<{
  urls: Array<{ label: string; url: string }>;
  summaries: Array<{ label: string; url: string; summary: string }>;
  social_links: Record<string, string[]>;
  /**
   * ONBOARD-001 §3/§7 — identity/brand/SEO metadata extracted from the SAME
   * root-page HTML fetched below (no extra crawl). null when the root fetch
   * failed or yielded no signal.
   */
  metadata: DiscoveredWebsiteMetadata | null;
}> => {
  const normalizedWebsite = normalizeUrl(websiteUrl);
  if (!normalizedWebsite) return { urls: [], summaries: [], social_links: {}, metadata: null };

  // CKRE-001 §1 — crawl instrumentation (only when a context is supplied;
  // omitting it preserves the exact prior behaviour). Correlation reuses the
  // signup/onboarding journey ID. All emission is fire-and-forget.
  const instrument = Boolean(context);
  const workflow = context?.workflow ?? 'profile_crawl';
  let correlationId: string | null = context?.correlationId ?? null;
  const emit = async (
    event: Parameters<typeof emitCrawlEvent>[0]['event'],
    outcome: 'allowed' | 'denied',
    reason?: string,
    metadataExtra?: Record<string, unknown>,
  ) => {
    if (!instrument) return;
    if (!correlationId) correlationId = await resolveCrawlCorrelationId(context?.email, context?.companyId ?? null);
    await emitCrawlEvent({
      event, outcome, correlationId,
      companyId: context?.companyId ?? null,
      userId: context?.userId ?? null,
      workflow, target: normalizedWebsite,
      reason: reason ?? null,
      // CKRE-001R §4 — stamp the crawl-session id when present.
      metadata: { ...(context?.crawlId ? { crawlId: context.crawlId } : {}), ...(metadataExtra ?? {}) },
    });
  };

  await emit('CrawlRequested', 'allowed');

  let rootHtml = '';
  let socialLinks: Record<string, string[]> = {
    linkedin: [], facebook: [], instagram: [], x: [], youtube: [], tiktok: [], reddit: [],
  };
  let metadata: DiscoveredWebsiteMetadata | null = null;
  // CKRE-001 §2/§7: fetch the root through the crawl-reuse cache — a root
  // fetched earlier in this workflow (onboarding step-5 vs step-5b, or the
  // within-call root summary below) is reused, not re-fetched. SSRF-safe.
  const rootFetch = await fetchPageCached(normalizedWebsite, { timeoutMs: 8000, maxBytes: 5 * 1024 * 1024 });
  if (rootFetch.fromCache) {
    await emit('CrawlSkipped', 'allowed', 'root_reused_from_workflow_cache');
  } else if (!rootFetch.ok) {
    await emit('CrawlFailed', 'denied', `root_fetch_status_${rootFetch.status}`);
  } else {
    await emit('CrawlStarted', 'allowed');
  }
  if (rootFetch.ok) {
    rootHtml = rootFetch.html;
    socialLinks = extractSocialLinksFromHtml(rootHtml, normalizedWebsite);
    // Reuse the fetched HTML for identity/brand/SEO discovery — zero extra fetches.
    const discovered = extractWebsiteMetadata(rootHtml, normalizedWebsite);
    metadata = hasDiscoveredSignal(discovered) ? discovered : null;
    if (metadata) await emit('MetadataExtracted', 'allowed');
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

  // CKRE-001 §1 — social-discovery + completion events.
  if (instrument) {
    const socialCount = Object.values(socialLinks).reduce((n, arr) => n + (arr?.length ?? 0), 0);
    await emit('SocialDiscoveryCompleted', 'allowed', undefined, { count: socialCount });
    if (rootFetch.ok) {
      await emit('CrawlCompleted', 'allowed', undefined, { pages: dedupedPageUrls.length });
    }
  }

  // CKRE-001 §3/§4/§5 — deterministic fingerprint + change detection (no AI,
  // no gating). Best-effort; a failure never affects the crawl result.
  if (context?.companyId && rootFetch.ok && rootHtml) {
    try {
      const flatSocial = Object.values(socialLinks).flat().filter(Boolean);
      const fingerprint = computeWebsiteFingerprint(
        {
          url: normalizedWebsite,
          html: rootHtml,
          headers: rootFetch.headers,
          metadata,
          socialLinks: flatSocial,
        },
        undefined,
        // CKRE-001R §5 — provenance: why + which workflow produced this bundle.
        { generationReason: 'crawl', workflow, producer: 'crawlWebsiteSources' },
      );
      if (hasFingerprintSignal(fingerprint)) {
        const prior = await getLatestWebsiteFingerprint(context.companyId);
        const decision = decideWebsiteChange(prior, fingerprint);
        recordCrawlChangeMetric(decision.verdict, workflow);
        await emit('ChangeEvaluated', 'allowed', decision.verdict, {
          score: decision.score,
          changedLevels: decision.changedLevels,
          reason: decision.reason,
        });
        await saveWebsiteFingerprint(context.companyId, fingerprint);
      }
    } catch {
      /* fingerprinting is a foundation layer — never break the crawl */
    }
  }

  return {
    urls: sourceUrls,
    summaries: summaries.filter((entry) => entry.summary) as Array<{ label: string; url: string; summary: string }>,
    social_links: socialLinks,
    metadata,
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
  if (profile.pinterest_url) sources.push({ label: 'pinterest', url: profile.pinterest_url });
  if (profile.whatsapp_url) sources.push({ label: 'whatsapp', url: profile.whatsapp_url });
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
  add('pinterest', incoming?.pinterest);
  add('whatsapp', incoming?.whatsapp);
  add('blog', incoming?.blog);

  return dedupeSocialProfileEntries([...(current || []), ...result]);
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
  const pinterest = getList('pinterest');
  const whatsapp = getList('whatsapp');

  if (!updated.linkedin_url && linkedin[0]) updated.linkedin_url = linkedin[0];
  if (!updated.facebook_url && facebook[0]) updated.facebook_url = facebook[0];
  if (!updated.instagram_url && instagram[0]) updated.instagram_url = instagram[0];
  if (!updated.x_url && x[0]) updated.x_url = x[0];
  if (!updated.youtube_url && youtube[0]) updated.youtube_url = youtube[0];
  if (!updated.tiktok_url && tiktok[0]) updated.tiktok_url = tiktok[0];
  if (!updated.reddit_url && reddit[0]) updated.reddit_url = reddit[0];
  if (!updated.pinterest_url && pinterest[0]) updated.pinterest_url = pinterest[0];
  if (!updated.whatsapp_url && whatsapp[0]) updated.whatsapp_url = whatsapp[0];

  const primarySocials = [
    { platform: 'linkedin', url: linkedin[0] || '' },
    { platform: 'facebook', url: facebook[0] || '' },
    { platform: 'instagram', url: instagram[0] || '' },
    { platform: 'x', url: x[0] || '' },
    { platform: 'youtube', url: youtube[0] || '' },
    { platform: 'tiktok', url: tiktok[0] || '' },
    { platform: 'reddit', url: reddit[0] || '' },
    { platform: 'pinterest', url: pinterest[0] || '' },
    { platform: 'whatsapp', url: whatsapp[0] || '' },
  ].filter((entry) => entry.url);

  const existingProfiles = dedupeSocialProfileEntries(
    Array.isArray(updated.social_profiles) ? [...updated.social_profiles] : [],
  );
  const seen = new Set(existingProfiles.map((entry) => socialProfileKey(entry.platform, entry.url)).filter(Boolean));
  primarySocials.forEach((entry) => {
    const normalized = normalizeSocialUrl(entry.url);
    const key = socialProfileKey(entry.platform, normalized);
    if (!normalized || !key || seen.has(key)) return;
    if (isPlaceholderUrl(normalized)) return;
    existingProfiles.push({ platform: entry.platform, url: normalized, source: 'website', confidence: 'Medium' });
    seen.add(key);
  });
  updated.social_profiles = dedupeSocialProfileEntries(existingProfiles);

  const extraSocial = [
    ...linkedin.slice(1), ...facebook.slice(1), ...instagram.slice(1),
    ...x.slice(1), ...youtube.slice(1), ...tiktok.slice(1), ...reddit.slice(1),
    ...pinterest.slice(1), ...whatsapp.slice(1),
  ];

  if (extraSocial.length > 0) {
    const existing = Array.isArray(updated.other_social_links) ? [...updated.other_social_links] : [];
    const seenExtra = new Set(existing.map((entry) => normalizeSocialUrl(entry.url || '')).filter(Boolean));
    extraSocial.slice(0, MAX_SOCIAL_LINKS).forEach((url, index) => {
      const normalized = normalizeUrl(url);
      if (!normalized || isPlaceholderUrl(normalized)) return;
      const normalizedSocial = normalizeSocialUrl(normalized);
      if (!normalizedSocial || seenExtra.has(normalizedSocial)) return;
      existing.push({ label: `discovered_${index + 1}`, url: normalizedSocial });
      seenExtra.add(normalizedSocial);
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
    'name', 'industry', 'category', 'business_classification', 'products_services', 'target_audience',
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
