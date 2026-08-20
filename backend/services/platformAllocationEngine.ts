/**
 * Platform Allocation Engine
 * BOLT: assigns platform to each content slot based on content type and campaign signals.
 * Rule-based, deterministic, no LLM.
 */

export type SlotInput = {
  platform?: string;
  content_type?: string;
  day?: string;
  day_index?: number;
  day_name?: string;
  short_topic?: string;
  full_topic?: string;
  reasoning?: string;
};

export type AllocationContext = {
  companyPreferredPlatforms?: string[];
  highPerformingPlatforms?: string[];
};

const DEFAULT_PLATFORM = 'linkedin';

/**
 * content_type → platform mapping.
 * Unknown types default to linkedin.
 */
const CONTENT_TYPE_TO_PLATFORM: Record<string, string> = {
  thought_leadership: 'linkedin',
  short_insight: 'x',
  tweet: 'x',
  thread: 'x',
  long_form: 'blog',
  blog: 'blog',
  article: 'linkedin',
  carousel: 'linkedin',
  video: 'youtube',
  reel: 'youtube',
  short_video: 'youtube',
  linkedin_post: 'linkedin',
  poll: 'linkedin',
  story: 'linkedin',
  post: 'linkedin',
  feed_post: 'linkedin',
};



/**
 * Content-canonical platform normalization: `twitter` → `x`.
 *
 * This engine allocates platforms to CONTENT slots, so it speaks the content
 * pipeline's vocabulary — the same one `CONTENT_TYPE_TO_PLATFORM` above already
 * emits (`tweet`/`thread`/`short_insight` → `'x'`) and every downstream
 * consumer is keyed on.
 *
 * It deliberately does NOT use `constants/platforms.normalizePlatform`, which
 * canonicalizes the other way (`x` → `twitter`) for the connector /
 * community-AI / analytics domain. With that one, `highPerforming` held
 * `'twitter'` while the mapping table held `'x'`, so the X preference could
 * never match, and an existing `x` slot was rewritten to `twitter` — leaking a
 * storage-vocabulary value into a content slot.
 *
 * Conversion to the DB representation happens only at the persistence seam,
 * `canonicalizePlatformForDb`. `twitter` is an accepted INPUT alias here; it is
 * never an output.
 */
function normalizePlatform(platform: string | null | undefined): string {
  return String(platform ?? '').trim().toLowerCase().replace(/^twitter$/, 'x');
}

/**
 * Determine platform for a slot using content_type mapping, then preferences.
 */
function resolvePlatform(
  slot: SlotInput,
  context: AllocationContext
): string {
  const contentType = String(slot.content_type ?? 'post').trim().toLowerCase();
  let platform = CONTENT_TYPE_TO_PLATFORM[contentType] ?? DEFAULT_PLATFORM;

  const highPerforming = (context.highPerformingPlatforms ?? [])
    .map((p) => normalizePlatform(p))
    .filter(Boolean);
  const companyPreferred = (context.companyPreferredPlatforms ?? [])
    .map((p) => normalizePlatform(p))
    .filter(Boolean);

  if (highPerforming.length > 0 && highPerforming.includes(platform)) {
    return platform;
  }
  if (companyPreferred.length > 0) {
    if (companyPreferred.includes(platform)) return platform;
    return companyPreferred[0] ?? platform;
  }
  if (highPerforming.length > 0) {
    return highPerforming[0] ?? platform;
  }

  return platform;
}

/**
 * Assign platform to each slot. Keeps existing platform when set.
 */
export function allocatePlatforms<T extends SlotInput>(
  slots: T[],
  context: AllocationContext = {}
): T[] {
  return slots.map((slot) => {
    const existing = String(slot.platform ?? '').trim();
    if (existing) {
      return { ...slot, platform: normalizePlatform(existing) };
    }
    const platform = resolvePlatform(slot, context);
    return { ...slot, platform };
  });
}
