/**
 * Platform Registry — Source of Truth for Per-Platform Capabilities
 *
 * Phase 1 deliverable. DEFINED-ONLY in Phase 1 (no consumers yet).
 *
 * Becomes authoritative for:
 *   - Phase 3: OAuth scope + business-account validation in callbacks.
 *   - Phase 4: publish capability + media-type validation in IntegrationController.
 *   - Phase 6: replaces scattered `if (platform === ...)` branching.
 *
 * IMPORTANT: This registry is INTRODUCED, not yet consumed. No code path is
 * permitted to depend on these values until Phase 3.
 *
 * SCOPE NOTES:
 *   - `scopes` lists the MINIMUM scopes required for the supported actions.
 *   - Some platforms list extended scopes used today by the legacy callback;
 *     these are kept verbatim as a SUPERSET to avoid scope-downgrade
 *     regressions during Phase 3 cutover.
 *
 * SET-2 DECISION LOG: see `SET2_ADAPTER_DECISIONS` at bottom of file.
 */

export type PlatformCapability =
  | 'publish'
  | 'reply'
  | 'like'
  | 'dm'
  | 'fetch_comments'
  | 'media'
  | 'reels'
  | 'video'
  | 'image'
  | 'playlist';

export type PlatformMediaType = 'text' | 'image' | 'video' | 'gallery' | 'playlist' | 'audio';

export type PlatformStatus =
  /** Production-grade adapter exists, OAuth route exists, refresh wired. */
  | 'production'
  /** Adapter is a placeholder (mock-only or API not publicly available). */
  | 'placeholder'
  /** Adapter exists but contract is unverified (no end-to-end success seen). */
  | 'unverified';

export type PlatformRegistryEntry = {
  /** Capabilities the platform's adapter can perform end-to-end. */
  supports: readonly PlatformCapability[];
  /** Minimum OAuth scopes required for `supports`. Authoritative in Phase 3. */
  scopes: readonly string[];
  /** Media types the publish path accepts. Authoritative in Phase 4. */
  mediaTypes: readonly PlatformMediaType[];
  /** True when only business / creator accounts can publish. Validated in Phase 3. */
  requiresBusinessAccount: boolean;
  /** Adapter readiness — informational; gates rollout decisions only. */
  status: PlatformStatus;
  /** Aliases that resolve to this platform key (normalized lowercase). */
  aliases?: readonly string[];
};

/**
 * Canonical platform keys. Every key here corresponds to a value of
 * `social_accounts.platform` (or its alias resolution target).
 */
export const PLATFORM_REGISTRY = {
  // ── Meta family (separate keys; Meta OAuth is a single flow under /api/auth/facebook) ──
  facebook: {
    supports: ['publish', 'reply', 'like', 'fetch_comments', 'media'],
    scopes: ['pages_show_list', 'pages_manage_posts', 'pages_read_engagement', 'pages_manage_engagement'],
    mediaTypes: ['text', 'image', 'video'],
    requiresBusinessAccount: true,
    status: 'production',
  },
  instagram: {
    supports: ['publish', 'reply', 'like', 'fetch_comments', 'media', 'reels'],
    scopes: ['instagram_basic', 'instagram_content_publish', 'instagram_manage_comments', 'pages_show_list'],
    mediaTypes: ['image', 'video', 'gallery'],
    requiresBusinessAccount: true,
    status: 'production',
    aliases: ['ig'],
  },
  threads: {
    supports: ['publish', 'reply', 'fetch_comments', 'media'],
    scopes: ['threads_basic', 'threads_content_publish', 'threads_manage_replies'],
    mediaTypes: ['text', 'image', 'video'],
    requiresBusinessAccount: true,
    status: 'unverified',
  },
  whatsapp: {
    supports: ['publish'],
    scopes: ['whatsapp_business_messaging', 'whatsapp_business_management'],
    mediaTypes: ['text'],
    requiresBusinessAccount: true,
    status: 'unverified',
  },

  // ── Standalone OAuth ──
  linkedin: {
    supports: ['publish', 'reply', 'like', 'dm', 'fetch_comments'],
    scopes: ['w_member_social', 'r_liteprofile', 'openid', 'profile', 'email'],
    mediaTypes: ['text', 'image'],
    requiresBusinessAccount: false,
    status: 'production',
    aliases: ['li'],
  },
  x: {
    supports: ['publish', 'reply', 'like', 'dm', 'fetch_comments'],
    scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
    mediaTypes: ['text', 'image', 'video'],
    requiresBusinessAccount: false,
    status: 'production',
    aliases: ['twitter', 'tw', 'twitter/x'],
  },
  youtube: {
    supports: ['publish', 'reply', 'fetch_comments', 'video'],
    scopes: [
      'https://www.googleapis.com/auth/youtube',
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.force-ssl',
    ],
    mediaTypes: ['video'],
    requiresBusinessAccount: false,
    status: 'production',
  },
  tiktok: {
    supports: ['publish', 'video'],
    scopes: ['video.upload', 'user.info.basic'],
    mediaTypes: ['video'],
    requiresBusinessAccount: false,
    status: 'production',
  },
  pinterest: {
    supports: ['publish', 'fetch_comments', 'image'],
    scopes: ['boards:read', 'boards:write', 'pins:read', 'pins:write'],
    mediaTypes: ['image'],
    requiresBusinessAccount: false,
    status: 'production',
  },
  spotify: {
    supports: ['playlist'],
    scopes: ['playlist-modify-public', 'playlist-modify-private', 'user-read-private', 'user-read-email'],
    mediaTypes: ['playlist'],
    requiresBusinessAccount: false,
    status: 'production',
  },
  reddit: {
    supports: ['reply', 'like', 'fetch_comments'],
    scopes: ['identity', 'submit', 'read', 'vote'],
    mediaTypes: ['text'],
    requiresBusinessAccount: false,
    status: 'unverified',
  },

  // ── Placeholder adapters (kept registered for routing; publish path no-op or mock) ──
  starmaker: {
    supports: [],
    scopes: [],
    mediaTypes: ['audio'],
    requiresBusinessAccount: false,
    status: 'placeholder',
    aliases: ['star_maker'],
  },
  suno: {
    supports: [],
    scopes: [],
    mediaTypes: ['audio'],
    requiresBusinessAccount: false,
    status: 'placeholder',
  },
} as const satisfies Record<string, PlatformRegistryEntry>;

export type PlatformKey = keyof typeof PLATFORM_REGISTRY;

const ALIAS_INDEX: Readonly<Record<string, PlatformKey>> = (() => {
  const map: Record<string, PlatformKey> = {};
  for (const key of Object.keys(PLATFORM_REGISTRY) as PlatformKey[]) {
    map[key] = key;
    const aliases = (PLATFORM_REGISTRY[key] as PlatformRegistryEntry).aliases;
    if (aliases) {
      for (const alias of aliases) {
        map[alias.toLowerCase()] = key;
      }
    }
  }
  return map;
})();

/**
 * Resolve a free-form platform string (case-insensitive) to its canonical key.
 * Returns null when the platform is not registered.
 *
 * NOT YET CONSUMED — Phase 3 onward.
 */
export function resolvePlatformKey(input: string | null | undefined): PlatformKey | null {
  if (!input) return null;
  const normalized = input.trim().toLowerCase();
  return ALIAS_INDEX[normalized] ?? null;
}

/**
 * Returns the registry entry for a platform, or null if unregistered.
 *
 * NOT YET CONSUMED — Phase 3 onward.
 */
export function getPlatformEntry(input: string | null | undefined): PlatformRegistryEntry | null {
  const key = resolvePlatformKey(input);
  return key ? (PLATFORM_REGISTRY[key] as PlatformRegistryEntry) : null;
}

/**
 * Returns true when the registry says the (platform, capability) tuple is
 * supported. Returns false if the platform is unregistered or the capability
 * is not in the entry's `supports` array.
 *
 * NOT YET CONSUMED — Phase 4 onward.
 */
export function platformSupports(
  platform: string | null | undefined,
  capability: PlatformCapability,
): boolean {
  const entry = getPlatformEntry(platform);
  if (!entry) return false;
  return entry.supports.includes(capability);
}

/**
 * Returns true when every required scope is present in `grantedScopes`.
 * Used by Phase 3 callback validation to refuse partial OAuth grants.
 *
 * NOT YET CONSUMED — Phase 3 onward.
 */
export function hasRequiredScopes(
  platform: string | null | undefined,
  grantedScopes: readonly string[],
): boolean {
  const entry = getPlatformEntry(platform);
  if (!entry) return false;
  const granted = new Set(grantedScopes.map((s) => s.toLowerCase()));
  return entry.scopes.every((s) => granted.has(s.toLowerCase()));
}

// ──────────────────────────────────────────────────────────────────────────────
// SET-2 ADAPTER DECISION LOG (Phase 1b)
//
// Set-2 adapters live at backend/services/platformAdapters/*Adapter.ts. They
// were authored as a parallel set to backend/adapters/*Adapter.ts for the
// Community-AI engagement layer.
//
// Phase 1 audit results: only TWO production callers reference Set-2 adapters:
//   - backend/services/platformAnalyticsIngester.ts
//   - pages/api/social-platforms/test-connection.ts
//
// Decisions below pre-stage Phase 6 cleanup. NO ADAPTER MAY BE DELETED until
// (a) its platform passes Phase 4 cutover AND (b) Phase 5.5 freeze exits.
// See migration plan §6 for ordering constraints.
// ──────────────────────────────────────────────────────────────────────────────

export type Set2Decision = {
  /** Path under backend/services/platformAdapters/ */
  file: string;
  /** Decision: keep & promote to provider, or mark for Phase 6 deletion */
  decision: 'keep' | 'delete';
  /** Reason for the decision */
  rationale: string;
};

export const SET2_ADAPTER_DECISIONS: readonly Set2Decision[] = [
  {
    file: 'baseAdapter.ts',
    decision: 'keep',
    rationale: 'Defines IPlatformAdapter interface + shared rate-limit/policy helpers. Foundational; will fold into PlatformProvider in Phase 4.',
  },
  {
    file: 'linkedinAdapter.ts',
    decision: 'delete',
    rationale: 'Duplicate of backend/adapters/linkedinAdapter.ts (Set-1). Set-1 is canonical for the publish pipeline. Delete in Phase 6 step 3 after Phase 4 LinkedIn cutover.',
  },
  {
    file: 'twitterAdapter.ts',
    decision: 'delete',
    rationale: 'Duplicate of backend/adapters/xAdapter.ts (Set-1). Platform key already migrated `twitter` → `x`. Delete in Phase 6 step 3 after Phase 4 X cutover.',
  },
  {
    file: 'pinterestAdapter.ts',
    decision: 'delete',
    rationale: 'Duplicate of backend/adapters/pinterestAdapter.ts (Set-1). Delete in Phase 6 step 3 after Phase 4 Pinterest cutover.',
  },
  {
    file: 'tiktokAdapter.ts',
    decision: 'delete',
    rationale: 'Duplicate of backend/adapters/tiktokAdapter.ts (Set-1). Set-2 has more sophisticated upload-chunking but Set-1 is the routed path. Migrate the chunking logic into the provider during Phase 4, then delete Set-2 in Phase 6.',
  },
  {
    file: 'youtubeAdapter.ts',
    decision: 'delete',
    rationale: 'Duplicate of backend/adapters/youtubeAdapter.ts (Set-1). Delete in Phase 6 step 3 after Phase 4 YouTube cutover.',
  },
  {
    file: 'threadsAdapter.ts',
    decision: 'keep',
    rationale: 'No Set-1 equivalent. Threads is provisioned by the Facebook OAuth flow; this is the only publish adapter. Promote to PlatformProvider in Phase 4.',
  },
  {
    file: 'whatsappAdapter.ts',
    decision: 'keep',
    rationale: 'No Set-1 equivalent. WhatsApp is provisioned by the Facebook OAuth flow. Promote to PlatformProvider in Phase 4. Verify WHATSAPP_PHONE_NUMBER_ID env contract.',
  },
  {
    file: 'redditAdapter.ts',
    decision: 'keep',
    rationale: 'No Set-1 equivalent. Reddit has its own OAuth callback under community-ai/connectors/reddit. Promote in Phase 4.',
  },
  {
    file: 'quoraAdapter.ts',
    decision: 'delete',
    rationale: 'Quora API is placeholder (`api.quora.com` is not a real public endpoint). No OAuth route, no production callers. Delete in Phase 6 step 3.',
  },
  {
    file: 'slackAdapter.ts',
    decision: 'delete',
    rationale: 'No OAuth route, no production callers, not in registry. Delete in Phase 6 step 3.',
  },
  {
    file: 'discordAdapter.ts',
    decision: 'delete',
    rationale: 'No OAuth route, no production callers, not in registry. Delete in Phase 6 step 3.',
  },
  {
    file: 'githubDiscussionsAdapter.ts',
    decision: 'delete',
    rationale: 'No OAuth route, no production callers, not in registry. Delete in Phase 6 step 3.',
  },
  {
    file: 'productHuntAdapter.ts',
    decision: 'delete',
    rationale: 'No OAuth route, no production callers, not in registry. Delete in Phase 6 step 3.',
  },
  {
    file: 'stackoverflowAdapter.ts',
    decision: 'delete',
    rationale: 'No OAuth route, no production callers, not in registry. Delete in Phase 6 step 3.',
  },
] as const;
