/**
 * BOLT Text-Only Content Configuration
 *
 * BOLT is restricted to text-based content: posts, blogs, articles, short stories,
 * stories, threads, polls. It excludes:
 * - Video platforms: YouTube, TikTok
 * - Non-text content: video, carousel, sliders, reels, images, banners
 */

/** Platforms excluded from BOLT (video-first social platforms). */
export const BOLT_EXCLUDED_PLATFORMS = new Set(['youtube', 'tiktok']);

/** Content types allowed for BOLT (text-based only). */
export const BOLT_TEXT_CONTENT_TYPES = new Set([
  'post',
  'blog',
  'article',
  'newsletter',
  'short_story',
  'story',
  'white_paper',
  'thread',
  'poll',
]);

/** Content types excluded from BOLT (media/visual formats). */
export const BOLT_EXCLUDED_CONTENT_TYPES = new Set([
  'video',
  'reel',
  'reels',
  'carousel',
  'carousels',
  'slider',
  'sliders',
  'slides',
  'image',
  'images',
  'banner',
  'banners',
  'short',
  'shorts',
  'short_video',
  'infographic',
  'deck',
  'presentation',
]);

function normalizeForComparison(s: string): string {
  return String(s ?? '').trim().toLowerCase().replace(/[-_\s]+/g, '_');
}

/** Returns true if the content type is allowed for BOLT (text-based). */
export function isBoltTextContentType(contentType: string): boolean {
  const norm = normalizeForComparison(contentType);
  if (!norm) return false;
  if (BOLT_EXCLUDED_CONTENT_TYPES.has(norm)) return false;
  if (BOLT_TEXT_CONTENT_TYPES.has(norm)) return true;
  // Also allow variants like "linkedin_post", "educational post" -> post
  if (norm.includes('post') && !norm.includes('video')) return true;
  if (norm.includes('article') || norm.includes('blog') || norm.includes('newsletter')) return true;
  if (norm.includes('thread') || norm.includes('story')) return true;
  if (norm.includes('white_paper') || norm.includes('whitepaper')) return true;
  if (norm.includes('poll')) return true;
  return false;
}

/** Returns true if the content type is excluded from BOLT. */
export function isBoltExcludedContentType(contentType: string): boolean {
  const norm = normalizeForComparison(contentType);
  if (!norm) return true;
  if (BOLT_EXCLUDED_CONTENT_TYPES.has(norm)) return true;
  if (norm.includes('video') || norm.includes('reel') || norm.includes('carousel')) return true;
  if (norm.includes('image') || norm.includes('banner') || norm.includes('slider')) return true;
  return false;
}

/** Filter platforms to BOLT-eligible (text platforms only). Excludes YouTube, TikTok. */
export function filterBoltPlatforms(platforms: string[]): string[] {
  if (!Array.isArray(platforms) || platforms.length === 0) return [];
  const seen = new Set<string>();
  return platforms.filter((p) => {
    const norm = String(p ?? '').trim().toLowerCase().replace(/^twitter$/i, 'x');
    if (BOLT_EXCLUDED_PLATFORMS.has(norm)) return false;
    if (seen.has(norm)) return false;
    seen.add(norm);
    return true;
  });
}

/** Filter content types to BOLT-eligible (text-only). */
export function filterBoltContentTypes(types: string[]): string[] {
  if (!Array.isArray(types) || types.length === 0) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const t of types) {
    const norm = normalizeForComparison(t);
    if (!norm || seen.has(norm)) continue;
    if (isBoltExcludedContentType(t)) continue;
    seen.add(norm);
    result.push(t);
  }
  return result.length > 0 ? result : ['post'];
}

/**
 * Filter content_type_mix array (e.g. ["2 video", "5 post", "1 blog"]) to text-only.
 * Excluded types (video, reel, carousel, etc.) are converted to "post" or dropped.
 */
export function filterBoltContentTypeMix(mix: string[] | undefined | null): string[] {
  if (!Array.isArray(mix) || mix.length === 0) return ['post'];
  const result: string[] = [];
  for (const item of mix) {
    const s = String(item ?? '').trim();
    if (!s) continue;
    const lower = s.toLowerCase();
    const excluded = ['video', 'reel', 'carousel', 'slider', 'image', 'banner', 'short'];
    const isExcluded = excluded.some((x) => lower.includes(x));
    if (isExcluded) {
      const numMatch = s.match(/^(\d+)\s/);
      if (numMatch) result.push(`${numMatch[1]} post`);
      else continue;
    } else {
      result.push(s);
    }
  }
  return result.length > 0 ? result : ['post'];
}

/** Excluded platforms for BOLT (video-first). */
const BOLT_EXCLUDED_PLATFORMS_LIST = ['youtube', 'tiktok'];

/** Content type strings that indicate non-text (excluded from BOLT). */
const BOLT_EXCLUDED_CONTENT_SUBSTRINGS = ['video', 'reel', 'carousel', 'slider', 'image', 'banner', 'short'];

/**
 * Sanitize a BOLT plan to text-only: remove YouTube/TikTok from platform allocation,
 * filter content_type_mix and platform_content_breakdown to text formats only.
 */
export function sanitizeBoltPlanForTextOnly(weeks: unknown[]): unknown[] {
  if (!Array.isArray(weeks) || weeks.length === 0) return weeks;
  return weeks.map((w: any) => {
    const week = { ...w };
    if (week.platform_allocation && typeof week.platform_allocation === 'object') {
      const pa = { ...week.platform_allocation };
      for (const p of BOLT_EXCLUDED_PLATFORMS_LIST) {
        delete pa[p];
        delete pa[p.charAt(0).toUpperCase() + p.slice(1)];
      }
      week.platform_allocation = pa;
    }
    if (Array.isArray(week.content_type_mix)) {
      week.content_type_mix = filterBoltContentTypeMix(week.content_type_mix);
    }
    if (week.platform_content_breakdown && typeof week.platform_content_breakdown === 'object') {
      const pcb: Record<string, unknown[]> = {};
      for (const [platform, items] of Object.entries(week.platform_content_breakdown)) {
        const p = String(platform).toLowerCase();
        if (BOLT_EXCLUDED_PLATFORMS_LIST.includes(p)) continue;
        const arr = Array.isArray(items) ? items : [];
        const filtered = arr.filter((item: any) => {
          const type = String(item?.type ?? item?.content_type ?? '').toLowerCase();
          return !BOLT_EXCLUDED_CONTENT_SUBSTRINGS.some((s) => type.includes(s));
        }).map((item: any) => {
          const type = String(item?.type ?? item?.content_type ?? 'post').toLowerCase();
          const isExcluded = BOLT_EXCLUDED_CONTENT_SUBSTRINGS.some((s) => type.includes(s));
          if (isExcluded) return { ...item, type: 'post' };
          return item;
        });
        if (filtered.length > 0) pcb[platform] = filtered;
      }
      week.platform_content_breakdown = pcb;
    }
    return week;
  });
}
