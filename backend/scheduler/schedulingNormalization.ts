/**
 * G7 — Canonical scheduler normalization.
 *
 * Single source of truth for the platform-name + content-type coercion that
 * the `scheduled_posts.chk_platform` / `scheduled_posts.chk_content_type` DB
 * constraints require. Before this module existed, the same coercion was
 * implemented inline in 4+ places (scheduler/schedule.ts, activity-workspace/
 * schedule.ts, structuredPlanScheduler.ts, bolt processors) with subtle
 * divergence between them.
 *
 * The DB constraint (chk_content_type) accepts:
 *   linkedin  → post | article | video | audio_event
 *   twitter   → tweet | thread | video
 *   instagram → feed_post | story | reel | igtv
 *   youtube   → video | short | live
 *   facebook  → post | story | video | event
 *
 * Two coercion patterns exist in the wild:
 *
 *   1. UPWARD (generic → platform-native):
 *      Callers that always pass contentType='post' and expect the helper to
 *      map it to the platform-native value (e.g. post → tweet for twitter,
 *      post → feed_post for instagram).
 *
 *   2. DOWNWARD (rich → DB-allowed):
 *      Callers that pass contentType in a richer vocabulary and expect the
 *      helper to collapse aliases (e.g. feed_post → post for linkedin,
 *      poll → post, short_story → post, tweet passthrough).
 *
 * `canonicalizeContentTypeForDb` handles BOTH directions in one table so the
 * call sites no longer need to know which direction they're in. The result
 * is always a value the chk_content_type constraint accepts for the given
 * platform.
 */

/** Platform aliases for DB storage. chk_platform requires 'twitter', never 'x'. */
const PLATFORM_DB_ALIAS: Readonly<Record<string, string>> = {
  x: 'twitter',
};

/**
 * Per-platform content-type canonicalization.
 *
 * Map structure: `<platform>.<rawContentTypeLowercased>` → DB-accepted value.
 * Missing keys fall back to the rawContentType unchanged (so genuinely
 * platform-native values like twitter/thread pass through).
 *
 * Includes both UPWARD (post → platform-native) and DOWNWARD (alias → DB)
 * coercions in one table.
 */
const CONTENT_TYPE_CANONICALIZATION: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  twitter: {
    post: 'tweet',     // upward: generic 'post' → twitter-native 'tweet'
    tweet: 'tweet',
    thread: 'thread',
    video: 'video',
  },
  linkedin: {
    feed_post: 'post', // downward: legacy alias → DB-accepted 'post'
    post: 'post',
    article: 'article',
    video: 'video',
    audio_event: 'audio_event',
    poll: 'post',         // poll is rendered as a post with engagement format
    short_story: 'post',  // short stories publish as regular posts
    tweet: 'post',        // safety: a 'tweet' contentType on linkedin collapses to post
  },
  instagram: {
    post: 'feed_post', // upward: generic 'post' → instagram-native 'feed_post'
    feed_post: 'feed_post',
    story: 'story',
    reel: 'reel',
    igtv: 'igtv',
    short_story: 'feed_post',
    poll: 'feed_post',
  },
  youtube: {
    video: 'video',
    short: 'short',
    live: 'live',
    post: 'video', // upward: generic 'post' → youtube has no text post; default to video
  },
  facebook: {
    post: 'post',
    feed_post: 'post',
    story: 'story',
    video: 'video',
    event: 'event',
    poll: 'post',
    short_story: 'post',
  },
};

/**
 * Coerce a raw platform string to the value the DB's chk_platform constraint
 * accepts. Lowercased + trimmed; applies the x→twitter alias.
 */
export function canonicalizePlatformForDb(rawPlatform: string): string {
  const normalized = String(rawPlatform ?? '').trim().toLowerCase();
  return PLATFORM_DB_ALIAS[normalized] ?? normalized;
}

/**
 * Coerce a raw content-type string to the value the DB's chk_content_type
 * constraint accepts for the given platform. The platform argument MUST
 * already be canonicalized via `canonicalizePlatformForDb` (so callers can
 * cache it once).
 *
 * When the platform is unknown or the content-type isn't in the
 * canonicalization table, returns the input unchanged so existing behavior
 * is preserved for novel content types. The DB constraint will catch
 * anything genuinely invalid.
 */
export function canonicalizeContentTypeForDb(
  dbPlatform: string,
  rawContentType: string,
): string {
  const normalized = String(rawContentType ?? '').trim().toLowerCase() || 'post';
  const table = CONTENT_TYPE_CANONICALIZATION[dbPlatform];
  if (!table) return normalized;
  return table[normalized] ?? normalized;
}

/**
 * Convenience: do both coercions in one call. Returns the pair already
 * checked against each other.
 */
export function canonicalizeScheduleForDb(input: {
  platform: string;
  contentType: string;
}): { dbPlatform: string; dbContentType: string } {
  const dbPlatform = canonicalizePlatformForDb(input.platform);
  const dbContentType = canonicalizeContentTypeForDb(dbPlatform, input.contentType);
  return { dbPlatform, dbContentType };
}
