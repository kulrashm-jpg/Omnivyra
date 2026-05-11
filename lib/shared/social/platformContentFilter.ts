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
 */

import {
  getPlatformCapability,
  getSupportedPlatformsForContentType,
  normalizePlatformKey,
  type ContentCapability,
} from './platformCapabilities';
import {
  normalizeContentCapability,
  type NormalizeContentCapabilityInput,
} from './contentCapability';

export interface FilteredPlatforms {
  /** Capability resolved from the input signals; `null` if none could be derived. */
  capability: ContentCapability | null;
  /** Connected platforms that CAN publish this capability. */
  supported: string[];
  /** Connected platforms that ARE in the canonical registry but cannot
   *  publish the requested capability. Surface as disabled chips + tooltip. */
  hidden: Array<{ platform: string; reason: string }>;
  /** Connected platforms NOT in the canonical registry. Round-4 Phase 4:
   *  these must NEVER render publishable, enabled, or even disabled — they
   *  fail closed. Returned only so callers can log them for diagnostics. */
  unregistered: Array<{ platform: string; reason: string }>;
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
  const capability = normalizeContentCapability(input);

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

  if (!capability) {
    const { hidden, unregistered } = splitRegisteredVsUnregistered(
      connectedPlatforms,
      () => 'Content capability could not be determined.',
    );
    return { capability: null, supported: [], hidden, unregistered };
  }

  const supported = getSupportedPlatformsForContentType(capability, connectedPlatforms);
  const supportedSet = new Set(supported.map((p) => normalizePlatformKey(p)));
  const remaining = connectedPlatforms.filter((p) => !supportedSet.has(normalizePlatformKey(p)));

  const { hidden, unregistered } = splitRegisteredVsUnregistered(
    remaining,
    (platform) => {
      const cfg = getPlatformCapability(platform);
      return cfg?.notes ?? `${platform} does not support ${capability} content.`;
    },
  );

  return { capability, supported, hidden, unregistered };
}
