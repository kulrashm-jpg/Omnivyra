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

function normalizePlatform(p: string): string {
  const s = String(p || '').trim().toLowerCase();
  if (s === 'twitter') return 'x';
  return s || DEFAULT_PLATFORM;
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
