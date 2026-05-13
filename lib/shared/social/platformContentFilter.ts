/**
 * Platform × Content Filter
 * ──────────────────────────────────────────────────────────────────────────
 * Thin orchestration layer that ties normalization (contentCapability.ts) to
 * the capability registry (platformCapabilities.ts). This is the single helper
 * UI callers should reach for.
 *
 * Returns BOTH the supported list and the hidden list so callers can surface
 * a tooltip ("Instagram requires media for publishing") instead of silently
 * dropping platforms.
 *
 * Asset-aware activation (Phase 2.C):
 *   Callers pass `attachedAssetTypes` on the input. When present, the helper
 *   resolves a *set* of capabilities (text + the capabilities those assets
 *   unlock) and a platform is "supported" if it matches ANY capability in
 *   the set. So a Post with an attached image asset activates Instagram +
 *   Pinterest automatically — no per-call branching needed.
 *
 * Video-only platforms (YouTube/TikTok) are filtered out of the displayable
 * list entirely via {@link VIDEO_ONLY_PLATFORM_KEYS}. They are NOT shown as
 * disabled chips — text/image-only Writer flows can never publish to them,
 * so the UX is "hidden" rather than "disabled."
 */

import {
  getPlatformCapability,
  getSupportedPlatformsForContentType,
  normalizePlatformKey,
  type ContentCapability,
} from './platformCapabilities';
import {
  normalizeContentCapability,
  resolveContentCapabilitySet,
  type NormalizeContentCapabilityInput,
} from './contentCapability';

/**
 * Platforms whose ONLY supported capabilities are video/creator content
 * Writer flows cannot produce. These are excluded from the displayable
 * list entirely — never rendered as disabled chips. Matches the spec:
 *
 *   "Expected hidden/inactive: YouTube, TikTok, video-only destinations"
 */
export const VIDEO_ONLY_PLATFORM_KEYS: ReadonlySet<string> = new Set(['youtube', 'tiktok']);

export interface FilteredPlatforms {
  /** Primary capability resolved from the input signals (back-compat).
   *  `null` if none could be derived. */
  capability: ContentCapability | null;
  /** The full set of capabilities the input can satisfy (Phase 2.C).
   *  Includes the base capability plus anything unlocked by
   *  `attachedAssetTypes`. Empty array on the same fail-closed path as
   *  `capability: null`. */
  capabilities: ContentCapability[];
  /** Connected platforms that CAN publish at least one capability in
   *  `capabilities`. */
  supported: string[];
  /** Connected platforms that ARE in the canonical registry but cannot
   *  publish ANY capability in the resolved set. Surface as disabled
   *  chips + tooltip. */
  hidden: Array<{ platform: string; reason: string }>;
  /** Connected platforms NOT in the canonical registry. Round-4 Phase 4:
   *  these must NEVER render publishable, enabled, or even disabled — they
   *  fail closed. Returned only so callers can log them for diagnostics. */
  unregistered: Array<{ platform: string; reason: string }>;
  /** Video-only platforms (YouTube/TikTok) connected by the company but
   *  hidden from the displayable list by policy. Returned only for
   *  diagnostics / telemetry — callers should NOT render these. */
  videoOnlyHidden: string[];
}

/**
 * Filter a set of connected platforms by the content's normalized capability.
 *
 * Behavior contract:
 *   - If capability cannot be normalized (`null`), the helper hides every
 *     platform. Callers MUST treat this as "block render" rather than "show
 *     all" — per architectural constraint, we fail closed.
 *   - Unknown platforms (not in the registry) are also hidden, with a generic
 *     reason.
 */
export function filterConnectedPlatformsForContent(
  connectedPlatforms: string[],
  input: NormalizeContentCapabilityInput,
): FilteredPlatforms {
  const capabilities = resolveContentCapabilitySet(input);
  const capability = capabilities[0] ?? null;

  // Decide whether the video-only exclusion applies. The policy:
  //   - WRITER-style content (text / writer / image / carousel / pdf
  //     mixes — none of which include video or creator) → exclude
  //     YouTube + TikTok entirely from the displayable list.
  //   - CREATOR/VIDEO content (reels, shorts, native video) → include
  //     them as supported, since those flows legitimately publish there.
  // This is gated on the resolved capability set so the matrix stays
  // consistent: every call site reaches the same decision.
  const capabilitiesIncludeVideoOrCreator = capabilities.some(
    (c) => c === 'video' || c === 'creator',
  );
  const applyVideoOnlyExclusion = !capabilitiesIncludeVideoOrCreator;

  const videoOnlyHidden: string[] = [];
  const filteredConnected: string[] = [];
  const seenVideoOnly = new Set<string>();
  for (const raw of connectedPlatforms) {
    const key = normalizePlatformKey(raw);
    if (!key) continue;
    if (applyVideoOnlyExclusion && VIDEO_ONLY_PLATFORM_KEYS.has(key)) {
      if (!seenVideoOnly.has(key)) {
        seenVideoOnly.add(key);
        videoOnlyHidden.push(key);
      }
      continue;
    }
    filteredConnected.push(raw);
  }

  const splitRegisteredVsUnregistered = (
    platforms: string[],
    reasonFor: (platform: string) => string,
  ) => {
    const hidden: FilteredPlatforms['hidden'] = [];
    const unregistered: FilteredPlatforms['unregistered'] = [];
    const seen = new Set<string>();
    for (const raw of platforms) {
      const platform = normalizePlatformKey(raw);
      if (!platform || seen.has(platform)) continue;
      seen.add(platform);
      const cfg = getPlatformCapability(platform);
      if (cfg) hidden.push({ platform, reason: reasonFor(platform) });
      else unregistered.push({ platform, reason: `${platform} is not registered for content publishing.` });
    }
    return { hidden, unregistered };
  };

  if (capabilities.length === 0) {
    const { hidden, unregistered } = splitRegisteredVsUnregistered(
      filteredConnected,
      () => 'Content capability could not be determined.',
    );
    return { capability: null, capabilities: [], supported: [], hidden, unregistered, videoOnlyHidden };
  }

  // Asset-aware support: a platform is supported when it can publish ANY
  // capability in the resolved set. This is the union; the per-capability
  // helper is reused so the registry stays the single source of truth.
  const supportedSet = new Set<string>();
  for (const capability of capabilities) {
    for (const p of getSupportedPlatformsForContentType(capability, filteredConnected)) {
      supportedSet.add(normalizePlatformKey(p));
    }
  }
  const supported = [...supportedSet];
  const remaining = filteredConnected.filter((p) => !supportedSet.has(normalizePlatformKey(p)));

  const { hidden, unregistered } = splitRegisteredVsUnregistered(
    remaining,
    (platform) => {
      const cfg = getPlatformCapability(platform);
      if (cfg?.notes) return cfg.notes;
      const list = capabilities.join(' or ');
      return `${platform} does not support ${list} content.`;
    },
  );

  return { capability, capabilities, supported, hidden, unregistered, videoOnlyHidden };
}
