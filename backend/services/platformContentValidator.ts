/**
 * Server-Side Platform × Content Validator
 * ──────────────────────────────────────────────────────────────────────────
 * Hard rejection layer (Phase 6). Even when the UI filter is bypassed (direct
 * API call, stale tab, automated job), publishing MUST reject incompatible
 * submissions BEFORE the platform adapter is invoked.
 *
 * The validator is authoritative — it draws from the SAME registry the UI
 * uses (constraint #7). There is no silent fallback: every reject returns a
 * structured failure with a `code` callers can branch on.
 *
 * Wire point: `pages/api/social/publish.ts` calls this after the engagement
 * capability check and before resolving the social_account. The adapter-level
 * `INSTAGRAM_NO_MEDIA` check remains as defense-in-depth.
 */

import {
  getPlatformCapability,
  normalizePlatformKey,
  type ContentCapability,
} from '../../lib/shared/social/platformCapabilities';
import {
  normalizeContentCapability,
  type NormalizeContentCapabilityInput,
} from '../../lib/shared/social/contentCapability';

export type ValidationFailureCode =
  | 'PLATFORM_NOT_REGISTERED'
  | 'CAPABILITY_UNRESOLVED'
  | 'CAPABILITY_NOT_SUPPORTED'
  | 'MEDIA_REQUIRED';

export interface ValidationOk {
  ok: true;
  platform: string;
  capability: ContentCapability;
}

export interface ValidationFailure {
  ok: false;
  code: ValidationFailureCode;
  message: string;
  /** Resolved platform key (normalized) when known. */
  platform: string | null;
  /** Resolved capability when known. */
  capability: ContentCapability | null;
}

export type ValidationResult = ValidationOk | ValidationFailure;

export interface ValidatePlatformContentInput {
  platform: string;
  /** EITHER pass an already-normalized capability… */
  contentCapability?: ContentCapability;
  /** …OR pass the raw signals and let the validator normalize. */
  contentSignals?: NormalizeContentCapabilityInput;
  payload: {
    /** Has any non-empty text body. */
    hasText?: boolean;
    /** Media attachments. */
    mediaUrls?: string[] | null;
  };
}

function resolveCapability(input: ValidatePlatformContentInput): ContentCapability | null {
  if (input.contentCapability) return input.contentCapability;
  if (input.contentSignals) return normalizeContentCapability(input.contentSignals);
  return null;
}

/**
 * Validate a (platform, content) pair against the capability registry.
 * Pure function — no IO, no DB. Safe to call from any layer.
 */
export function validatePlatformContentCompatibility(
  input: ValidatePlatformContentInput,
): ValidationResult {
  const platform = normalizePlatformKey(input.platform);
  const cfg = platform ? getPlatformCapability(platform) : null;

  if (!platform || !cfg) {
    return {
      ok: false,
      code: 'PLATFORM_NOT_REGISTERED',
      message: `Platform "${input.platform}" is not registered in the capability registry.`,
      platform: platform || null,
      capability: null,
    };
  }

  const capability = resolveCapability(input);
  if (!capability) {
    return {
      ok: false,
      code: 'CAPABILITY_UNRESOLVED',
      message: 'Content capability could not be determined from the provided signals.',
      platform,
      capability: null,
    };
  }

  if (!cfg.supportedContent.includes(capability)) {
    return {
      ok: false,
      code: 'CAPABILITY_NOT_SUPPORTED',
      message: cfg.notes ?? `${platform} does not support ${capability} content.`,
      platform,
      capability,
    };
  }

  const mediaUrls = Array.isArray(input.payload.mediaUrls) ? input.payload.mediaUrls : [];
  const hasMedia = mediaUrls.length > 0;

  if (cfg.requiresMediaForPublish && !hasMedia) {
    return {
      ok: false,
      code: 'MEDIA_REQUIRED',
      message: cfg.notes ?? `${platform} requires media (image or video) for publishing.`,
      platform,
      capability,
    };
  }

  return { ok: true, platform, capability };
}
