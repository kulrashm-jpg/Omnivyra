/**
 * boltPlannerTaxonomy — authoritative BOLT content-type taxonomy for the
 * campaign-planner Platform Content Matrix.
 *
 * This is the planner-side selection surface that feeds generation, so
 * restricting it here keeps generation consistent without touching the
 * deeper DB-backed governance enums (article/pdf/podcast remain valid for
 * existing data — see KNOWN note in the change summary).
 *
 * BOLT Text:    Post, Thread, Short Stories, Poll, Tweet
 *               (Tweet is limited to X / Twitter — 1:1 binding.)
 * BOLT Creator: Image, Banner, Carousel, Slider, Infographics, Video,
 *               Short, Reel.
 * Everything else is removed from the matrix.
 *
 * Keys are the canonical lowercase content-type keys used everywhere else
 * (short_story / infographic), so they intersect cleanly with the
 * capability-derived per-platform content_types from the company config.
 */

export const BOLT_TEXT_PLANNER_FORMATS = [
  'post',
  'thread',
  'short_story',
  'poll',
  'tweet',
] as const;

export const BOLT_CREATOR_PLANNER_FORMATS = [
  'image',
  'banner',
  'carousel',
  'slider',
  'infographic',
  'video',
  'short',
  'reel',
] as const;

/** Tweet is X/Twitter-only (1:1 format→platform binding). */
export const X_ONLY_FORMATS = new Set<string>(['tweet']);
const X_PLATFORM_KEYS = new Set<string>(['x', 'twitter']);

const BOLT_PLANNER_SET = new Set<string>([
  ...BOLT_TEXT_PLANNER_FORMATS,
  ...BOLT_CREATOR_PLANNER_FORMATS,
]);

/** A few common aliases the company config may emit → canonical keys. */
const ALIAS: Record<string, string> = {
  short_stories: 'short_story',
  shortstory: 'short_story',
  story: 'short_story',
  infographics: 'infographic',
  tweets: 'tweet',
  threads: 'thread',
  carousal: 'carousel',
  slides: 'slider',
};

export function normalizeBoltContentType(ct: string): string {
  const c = String(ct ?? '').toLowerCase().trim();
  return ALIAS[c] ?? c;
}

export function isBoltPlannerFormat(ct: string): boolean {
  return BOLT_PLANNER_SET.has(normalizeBoltContentType(ct));
}

export function isXPlatform(platform: string): boolean {
  return X_PLATFORM_KEYS.has(String(platform ?? '').toLowerCase().trim().replace(/^twitter$/, 'twitter'));
}

/**
 * Resolve the BOLT content types allowed for a platform:
 *   (capability-derived configTypes ∩ BOLT taxonomy), normalized,
 *   then Tweet restricted to X/Twitter only (and ensured present on X
 *   since X always supports text).
 *
 * "As per the platform" — a BOLT type only appears where the platform's
 * own capability set (configTypes) supports it; the rest are removed.
 */
export function resolveBoltContentTypesForPlatform(
  platform: string,
  configTypes: readonly string[],
): string[] {
  const isX = isXPlatform(platform);
  const out = new Set<string>();

  for (const raw of configTypes ?? []) {
    const ct = normalizeBoltContentType(raw);
    if (!BOLT_PLANNER_SET.has(ct)) continue; // drop article/pdf/podcast/etc.
    if (X_ONLY_FORMATS.has(ct) && !isX) continue; // Tweet → X/Twitter only
    out.add(ct);
  }

  // X always supports text → guarantee Tweet is offered on X/Twitter even
  // if the capability list happened to surface it only as "post".
  if (isX) out.add('tweet');

  // Stable order: Text formats first (in declared order), then Creator.
  const ordered: string[] = [];
  for (const t of BOLT_TEXT_PLANNER_FORMATS) if (out.has(t)) ordered.push(t);
  for (const t of BOLT_CREATOR_PLANNER_FORMATS) if (out.has(t)) ordered.push(t);
  return ordered;
}
