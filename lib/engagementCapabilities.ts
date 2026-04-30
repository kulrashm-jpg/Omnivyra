/**
 * Engagement capability map — single source of truth for which
 * (platform, action) pairs are trustworthy for end-user engagement sends.
 *
 * Shared between the Next.js API routes and the React UI: the server uses
 * this to reject unsupported actions at the boundary; the client uses it to
 * hide tabs and disable send buttons without a round-trip.
 *
 * An entry is "verified" only when ALL of the following hold:
 *   1. An adapter / connector exists and returns a platform-native id on success.
 *   2. Credential acquisition is wired (OAuth + tokenStore refresh).
 *   3. The action is supported for the account types we admit (see account_type).
 *   4. A real execution path exists — executeAction() → connector.executeAction → platform API.
 *   5. The result contract is trustworthy — connectors surface platform errors
 *      and do not fabricate success.
 *
 * Everything not explicitly listed here is UNSUPPORTED and must be rejected.
 * No simulated / manual-mode fallbacks for user-initiated sends.
 */

/**
 * CAPABILITY_MAP_VERSION is a checksum-style string that must match the
 * extension's own extension/shared/capabilityMap.js. When they diverge,
 * the backend refuses to hand the extension commands and the extension
 * refuses to dispatch — a drift between client and server trust surfaces
 * is itself a trust bug.
 *
 * Bump whenever ENGAGEMENT_CAPABILITY_MATRIX changes. The extension copy
 * MUST be bumped in the same PR.
 */
export const CAPABILITY_MAP_VERSION = '2026-04-29.1';

export type EngagementActionKey = 'reply' | 'like' | 'dm' | 'post_create';

export type AccountType = 'any' | 'business' | 'creator';

export type EngagementCapability = {
  status: 'api_verified' | 'unsupported';
  /**
   * Dispatch channel for user-initiated sends:
   *   'api'     — platform REST/Graph API (default for comment + like).
   *   'browser' — dispatched to the Chrome extension's browser runtime.
   *               Used for actions that do not have a first-party API
   *               path yet but have a verified extension handler
   *               (currently: Messenger / Instagram Direct / LinkedIn DM).
   */
  mode?: 'api' | 'browser';
  /** For platforms where an action is only supported on certain account tiers
   *  (e.g. Instagram business accounts for comment reply via Graph API). */
  account_type?: AccountType;
  /** Human-readable reason shown to the user if UNSUPPORTED. */
  reason?: string;
};

const PLATFORM_ALIASES: Record<string, string> = {
  x: 'twitter',
  'twitter/x': 'twitter',
  li: 'linkedin',
  fb: 'facebook',
  ig: 'instagram',
  tw: 'twitter',
  meta: 'facebook',
};

export function normalizePlatformSlug(platform: string | null | undefined): string {
  const key = String(platform ?? '').trim().toLowerCase();
  return PLATFORM_ALIASES[key] ?? key;
}

export const ENGAGEMENT_PLATFORMS = [
  'linkedin',
  'facebook',
  'instagram',
  'twitter',
  'youtube',
  'reddit',
  'tiktok',
  'pinterest',
] as const;

export type EngagementPlatform = (typeof ENGAGEMENT_PLATFORMS)[number];

/** Defensively explicit — every (platform, action) pair is listed, including
 *  the unsupported ones, so the map is auditable at a glance. */
export const ENGAGEMENT_CAPABILITY_MATRIX: Record<
  EngagementPlatform,
  Record<EngagementActionKey, EngagementCapability>
> = {
  linkedin: {
    reply: { status: 'api_verified', mode: 'api', account_type: 'any' },
    like: { status: 'api_verified', mode: 'api', account_type: 'any' },
    // DM via the Chrome extension's browser runtime — handler exists with
    // a post-condition (composer-clear + message-echo). mode:'browser' so
    // /api/extension/commands dispatches it via the extension rather than
    // a direct API call.
    dm: { status: 'api_verified', mode: 'browser', account_type: 'any' },
    post_create: { status: 'api_verified', mode: 'api', account_type: 'any' },
  },
  facebook: {
    reply: { status: 'api_verified', mode: 'api', account_type: 'business' },
    like: { status: 'api_verified', mode: 'api', account_type: 'business' },
    dm: { status: 'api_verified', mode: 'browser', account_type: 'any' },
    post_create: { status: 'api_verified', mode: 'api', account_type: 'business' },
  },
  instagram: {
    reply: { status: 'api_verified', mode: 'api', account_type: 'business' },
    like: { status: 'api_verified', mode: 'api', account_type: 'business' },
    dm: { status: 'api_verified', mode: 'browser', account_type: 'business' },
    post_create: { status: 'api_verified', mode: 'api', account_type: 'business' },
  },
  twitter: {
    reply: { status: 'api_verified', mode: 'api', account_type: 'any' },
    like: { status: 'api_verified', mode: 'api', account_type: 'any' },
    dm: { status: 'api_verified', mode: 'browser', account_type: 'any' },
    post_create: { status: 'api_verified', mode: 'api', account_type: 'any' },
  },
  youtube: {
    reply: { status: 'api_verified', mode: 'api', account_type: 'any' },
    like: { status: 'unsupported', reason: 'YouTube like on comments is not API-verified.' },
    dm: { status: 'unsupported', reason: 'YouTube does not support DMs via API.' },
    post_create: { status: 'api_verified', mode: 'api', account_type: 'any' },
  },
  reddit: {
    reply: { status: 'api_verified', mode: 'api', account_type: 'any' },
    like: { status: 'api_verified', mode: 'api', account_type: 'any' },
    dm: { status: 'unsupported', reason: 'Reddit DM send is not yet API-verified.' },
    post_create: { status: 'unsupported', reason: 'Reddit submission create is not yet API-verified.' },
  },
  // TikTok and Pinterest have real publish adapters but no engagement-inbox
  // actions today. They appear only in VERIFIED_PUBLISH_PLATFORMS, not in
  // VERIFIED_ENGAGEMENT_PLATFORMS (the inbox tabs list).
  tiktok: {
    reply: { status: 'unsupported', reason: 'TikTok does not expose comment reply via public API.' },
    like: { status: 'unsupported', reason: 'TikTok does not expose like via public API.' },
    dm: { status: 'unsupported', reason: 'TikTok does not expose DMs via public API.' },
    // TikTok publish stays api_verified on the direct publish adapter path
    // (backend/adapters/tiktokAdapter). Browser runtime post_create was
    // downgraded to unsupported separately in extension/shared/capabilityMap.js.
    post_create: { status: 'api_verified', mode: 'api', account_type: 'any' },
  },
  pinterest: {
    reply: { status: 'unsupported', reason: 'Pinterest comment reply is not yet API-verified.' },
    like: { status: 'unsupported', reason: 'Pinterest like is not yet API-verified.' },
    dm: { status: 'unsupported', reason: 'Pinterest does not expose DMs via API.' },
    post_create: { status: 'api_verified', mode: 'api', account_type: 'any' },
  },
};

export function resolveEngagementCapability(
  platform: string | null | undefined,
  action: EngagementActionKey,
): EngagementCapability {
  const normalized = normalizePlatformSlug(platform) as EngagementPlatform;
  const row = ENGAGEMENT_CAPABILITY_MATRIX[normalized];
  if (!row) {
    return {
      status: 'unsupported',
      reason: `Platform "${platform}" is not a verified engagement surface.`,
    };
  }
  return row[action] ?? {
    status: 'unsupported',
    reason: `Action "${action}" is not supported on ${normalized}.`,
  };
}

const INBOX_ACTION_KEYS: EngagementActionKey[] = ['reply', 'like', 'dm'];

/** Platforms that have at least one verified inbox-surface action
 *  (reply / like / dm). Used for capability gating; connected platform
 *  visibility is handled by company integrations. */
export const VERIFIED_ENGAGEMENT_PLATFORMS: readonly string[] = ENGAGEMENT_PLATFORMS.filter(
  (platform) =>
    INBOX_ACTION_KEYS.some(
      (action) => ENGAGEMENT_CAPABILITY_MATRIX[platform][action].status === 'api_verified',
    ),
);

/** Platforms that have a verified post_create path. Used to gate the publish
 *  route so TikTok/Pinterest publishing remains available even though they
 *  are not inbox-surface platforms. */
export const VERIFIED_PUBLISH_PLATFORMS: readonly string[] = ENGAGEMENT_PLATFORMS.filter(
  (platform) => ENGAGEMENT_CAPABILITY_MATRIX[platform].post_create.status === 'api_verified',
);

export function isEngagementPlatformVerified(platform: string | null | undefined): boolean {
  const normalized = normalizePlatformSlug(platform);
  return VERIFIED_ENGAGEMENT_PLATFORMS.includes(normalized);
}

export function isPublishPlatformVerified(platform: string | null | undefined): boolean {
  const normalized = normalizePlatformSlug(platform);
  return VERIFIED_PUBLISH_PLATFORMS.includes(normalized);
}
