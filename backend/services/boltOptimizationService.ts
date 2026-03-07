/**
 * BOLT Optimization Service
 * Connects Campaign Learning Layer to BOLT execution decisions.
 * Applies historical performance insights to slot ordering and platform preference.
 * Rule-based, deterministic, no LLM.
 */

export type SlotInput = {
  platform?: string;
  content_type?: string;
  day?: string;
  day_index?: number;
  day_name?: string;
  time?: string;
  short_topic?: string;
  full_topic?: string;
  reasoning?: string;
};

export type CompanyPerformanceInsights = {
  high_performing_platforms?: Array<{ value: string; avgEngagement?: number; signalCount?: number }>;
  high_performing_content_types?: Array<{ value: string; avgEngagement?: number; signalCount?: number }>;
  low_performing_patterns?: Array<{ platform?: string; content_type?: string; theme?: string; reason?: string }>;
};

/**
 * Content types that can be published on multiple platforms.
 * Used to prefer high-performing platforms when swapping.
 */
const CONTENT_TYPE_ALTERNATIVE_PLATFORMS: Record<string, string[]> = {
  post: ['linkedin', 'x'],
  feed_post: ['linkedin', 'x'],
  carousel: ['linkedin', 'x'],
  poll: ['linkedin', 'x'],
  article: ['linkedin', 'blog'],
};

function normalizePlatform(p: string): string {
  const s = String(p ?? '').trim().toLowerCase();
  if (s === 'twitter') return 'x';
  return s || 'linkedin';
}

function normalizeContentType(ct: string): string {
  return String(ct ?? 'post').trim().toLowerCase();
}

/**
 * Apply BOLT optimizations based on company performance insights.
 * - Platform: prefer high-performing platforms when content_type supports alternatives
 * - Content type: reorder so high-performing content types appear first
 * - Low-performing: deprioritize slots matching low-performing patterns (sort to end)
 * - Deterministic: stable sort by score, then original index
 */
export function applyBoltOptimizations<T extends SlotInput>(
  slots: T[],
  insights: CompanyPerformanceInsights = {}
): T[] {
  const highPlatforms = new Set(
    (insights.high_performing_platforms ?? []).map((p) => normalizePlatform(p.value))
  );
  const highContentTypes = new Set(
    (insights.high_performing_content_types ?? []).map((c) => normalizeContentType(c.value))
  );
  const lowPlatforms = new Set(
    (insights.low_performing_patterns ?? [])
      .filter((p) => p.platform)
      .map((p) => normalizePlatform(p.platform!))
  );
  const lowContentTypes = new Set(
    (insights.low_performing_patterns ?? [])
      .filter((p) => p.content_type)
      .map((p) => normalizeContentType(p.content_type!))
  );

  const boostedPlatformsSet = new Set<string>();
  const boostedContentTypesSet = new Set<string>();

  const scored = slots.map((slot, origIndex) => {
    let platform = normalizePlatform(slot.platform ?? '');
    const contentType = normalizeContentType(slot.content_type ?? 'post');

    if (highPlatforms.size > 0) {
      const alts = CONTENT_TYPE_ALTERNATIVE_PLATFORMS[contentType];
      if (alts?.length) {
        const preferred = alts.find((a) => highPlatforms.has(a));
        if (preferred && preferred !== platform) {
          platform = preferred;
          boostedPlatformsSet.add(platform);
        }
      }
    }

    let score = 0;
    if (highPlatforms.has(platform)) score += 2;
    if (highContentTypes.has(contentType)) {
      score += 2;
      boostedContentTypesSet.add(contentType);
    }
    if (lowPlatforms.has(platform)) score -= 2;
    if (lowContentTypes.has(contentType)) score -= 2;

    return { slot: { ...slot, platform } as T, score, origIndex };
  });

  const boostedPlatforms = Array.from(boostedPlatformsSet);
  const boostedContentTypes = Array.from(boostedContentTypesSet);

  const sorted = scored
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.origIndex - b.origIndex;
    })
    .map(({ slot }) => slot);

  if (boostedPlatforms.length > 0 || boostedContentTypes.length > 0) {
    console.debug('[BOLT][optimization] BOLT optimization applied', {
      boostedPlatforms,
      boostedContentTypes,
    });
  }

  return sorted;
}
