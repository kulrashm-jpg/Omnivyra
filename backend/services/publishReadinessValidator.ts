/**
 * Centralized PUBLISH READINESS VALIDATOR (Round-2 items 5 + 6).
 *
 * One reusable, deterministic, side-effect-free check used by the
 * scheduler, the publisher, and the calendar. Composes the EXISTING
 * registry validator (`platformContentValidator`) and the canonical
 * lifecycle resolver — it does NOT duplicate or redesign adapters.
 *
 * The new safety it adds over the registry validator: an ADAPTER-REALITY
 * layer. The capability registry *declares* LinkedIn/X support image/
 * video, but those adapters do not upload media (audit Round-1) — so a
 * media post there is silently delivered text-only. This validator
 * rejects that explicitly instead of letting media be stripped.
 *
 * Modes (env `PUBLISH_GUARD_MODE`, production-safe rollback):
 *   enforce (default) — return a hard PipelineError
 *   warn              — ok:true but include the issue in `warnings`
 *   off               — skip the adapter-reality guard entirely
 * The base registry validation always runs regardless of mode.
 */

import {
  validatePlatformContentCompatibility,
  type ValidationFailure,
} from './platformContentValidator';
import { normalizePlatformKey } from '../../lib/shared/social/platformCapabilities';
import {
  resolveCanonicalState,
  CanonicalContentState,
  type ResolvableRow,
} from '../../lib/shared/contentLifecycle';
import {
  PipelineErrorCode,
  pipelineError,
  type PipelineError,
} from '../../lib/shared/pipelineErrorCodes';
import { logPipelineEvent } from '../../lib/shared/observability';
import { getPlatformLimits } from '../../lib/shared/contentFormatter';

type GuardMode = 'enforce' | 'warn' | 'off';
function guardMode(): GuardMode {
  const m = String(process.env.PUBLISH_GUARD_MODE ?? 'enforce').trim().toLowerCase();
  return m === 'warn' || m === 'off' ? (m as GuardMode) : 'enforce';
}
/**
 * Phase B — separately-gated char-limit mode at publish time. Defaults to
 * 'off' for safe rollout: this is the SECOND line of defense behind the
 * schedule-time `SCHEDULE_CHAR_LIMIT_MODE`, which is the primary gate. Flip
 * this to 'warn' once schedule-time is in `enforce`, then to 'enforce' once
 * warn-mode telemetry confirms no legitimate overflow.
 */
function publishCharLimitMode(): GuardMode {
  const m = String(process.env.PUBLISH_CHAR_LIMIT_MODE ?? 'off').trim().toLowerCase();
  return m === 'warn' || m === 'enforce' ? (m as GuardMode) : 'off';
}

/**
 * ADAPTER REALITY — what the CURRENT adapter implementations actually do
 * (not what the registry declares). Source: Round-1 audit of
 * backend/adapters/*Adapter.ts.
 */
const ADAPTER_CAN_PUBLISH_MEDIA: Record<string, boolean> = {
  instagram: true,
  youtube: true,
  tiktok: true,
  pinterest: true,
  facebook: true, // via link/source param (partial but delivered)
  linkedin: false, // adapter sends shareMediaCategory NONE — media dropped
  x: false, // adapter explicitly drops media
};
/** Platforms with a working canonical publish case in platformAdapter.ts. */
const ADAPTER_HAS_PUBLISH_PATH: Record<string, boolean> = {
  linkedin: true,
  instagram: true,
  facebook: true,
  x: true,
  youtube: true,
  tiktok: true,
  pinterest: true,
  threads: false, // no canonical publish case → default-throws
};

export interface PublishReadinessInput {
  platform: string;
  /** Resolved/normalized content capability, if known. */
  contentCapability?: Parameters<typeof validatePlatformContentCompatibility>[0]['contentCapability'];
  contentSignals?: Parameters<typeof validatePlatformContentCompatibility>[0]['contentSignals'];
  hasText?: boolean;
  mediaUrls?: string[] | null;
  /**
   * Phase B — the actual content text, when available. When provided AND
   * `PUBLISH_CHAR_LIMIT_MODE` is `warn` or `enforce`, the validator checks
   * the platform's per-character limit and rejects (enforce) or warns
   * (warn). Omitting `content` preserves pre-Phase-B behavior (no check).
   * Callers should pass the row's `content` field so this gate runs.
   */
  content?: string;
  /** The daily_content_plans / scheduled_post row, for canonical state. */
  row?: ResolvableRow;
  /** Skip the canonical scheduling-readiness gate (e.g. publish-now). */
  skipSchedulingReadiness?: boolean;
}

export interface PublishReadinessOk {
  ok: true;
  platform: string;
  canonicalState: CanonicalContentState | null;
  warnings: PipelineError[];
}
export type PublishReadinessResult = PublishReadinessOk | PipelineError;

function isHttpUrl(u: unknown): boolean {
  if (typeof u !== 'string' || !u.trim()) return false;
  try {
    const p = new URL(u.trim());
    return p.protocol === 'http:' || p.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Deterministic, synchronous, IO-free. Reusable everywhere.
 * (Asset *liveness* — network HEAD — is intentionally NOT here; use the
 * separate async `assertMediaAccessible` so this stays pure/cacheable.)
 */
export function validatePublishReadiness(
  input: PublishReadinessInput,
): PublishReadinessResult {
  const platform = normalizePlatformKey(input.platform);
  const mediaUrls = Array.isArray(input.mediaUrls)
    ? input.mediaUrls.filter((u) => typeof u === 'string' && u.trim().length > 0)
    : [];
  const hasMedia = mediaUrls.length > 0;
  const warnings: PipelineError[] = [];
  const mode = guardMode();

  // 1. No working publish path (Threads today).
  if (ADAPTER_HAS_PUBLISH_PATH[platform] === false) {
    return pipelineError(
      PipelineErrorCode.PLATFORM_PUBLISH_PATH_MISSING,
      `Publishing to "${platform}" is not implemented — there is no publish path for this platform. Remove it from the campaign or pick a supported platform.`,
      { platform },
    );
  }

  // 2. Base registry validation (platform registered, capability supported,
  //    media-required-but-missing) — reuse existing authority, remap codes.
  const base = validatePlatformContentCompatibility({
    platform: input.platform,
    contentCapability: input.contentCapability,
    contentSignals: input.contentSignals,
    payload: { hasText: input.hasText, mediaUrls },
  });
  if (!base.ok) {
    const fail = base as ValidationFailure; // discriminant: ok===false
    const codeMap: Record<string, PipelineErrorCode> = {
      PLATFORM_NOT_REGISTERED: PipelineErrorCode.PLATFORM_UNSUPPORTED,
      CAPABILITY_UNRESOLVED: PipelineErrorCode.CONTENT_EMPTY,
      CAPABILITY_NOT_SUPPORTED: PipelineErrorCode.MEDIA_UNSUPPORTED_ON_PLATFORM,
      MEDIA_REQUIRED: PipelineErrorCode.MEDIA_REQUIRED_MISSING,
    };
    return pipelineError(
      codeMap[fail.code] ?? PipelineErrorCode.PLATFORM_UNSUPPORTED,
      fail.message,
      { platform: fail.platform, capability: fail.capability, baseCode: fail.code },
    );
  }

  // 3. ADAPTER-REALITY: media present but the adapter would drop it.
  if (hasMedia && ADAPTER_CAN_PUBLISH_MEDIA[platform] === false) {
    const err = pipelineError(
      PipelineErrorCode.MEDIA_WOULD_BE_STRIPPED,
      `"${platform}" would publish this post as TEXT ONLY — its adapter does not upload media yet. The attached media (${mediaUrls.length}) would be silently lost. Resolve before publishing (remove media, or publish to a media-capable platform).`,
      { platform, mediaCount: mediaUrls.length },
    );
    if (mode === 'enforce') return err;
    if (mode === 'warn') warnings.push(err);
    // mode 'off' → skip
  }

  // 4. URL validity for any attached media.
  const badUrls = mediaUrls.filter((u) => !isHttpUrl(u));
  if (badUrls.length > 0) {
    return pipelineError(
      PipelineErrorCode.MEDIA_URL_INVALID,
      `Media URL(s) are not valid http(s) URLs and cannot be published.`,
      { platform, invalidCount: badUrls.length },
    );
  }

  // 4b. Phase B — publish-time char-limit gate. Second line of defense behind
  //     the schedule-time guard. Only runs when caller provides `content` AND
  //     the env mode is `warn`/`enforce`. Off-by-default so no rollout risk.
  const clMode = publishCharLimitMode();
  if (clMode !== 'off' && typeof input.content === 'string') {
    const text = input.content;
    const maxChars = getPlatformLimits(platform).maxChars;
    if (text.length > maxChars) {
      const err = pipelineError(
        PipelineErrorCode.CONTENT_OVER_CHAR_LIMIT,
        `Content exceeds ${platform} ${maxChars}-char limit (actual: ${text.length}). ` +
        `Reject before adapter to prevent silent truncation.`,
        { platform, actualChars: text.length, maxChars, excessChars: text.length - maxChars },
      );
      if (clMode === 'enforce') return err;
      warnings.push(err);
    }
  }

  // 5. TikTok finalize ambiguity guard (non-fatal — surfaced, logged).
  if (platform === 'tiktok') {
    warnings.push(
      pipelineError(
        PipelineErrorCode.TIKTOK_FINALIZE_UNCONFIRMED,
        'TikTok publish finalization is not positively confirmed by the adapter (status/fetch step). Treat success as tentative until analytics confirm the post.',
        { platform },
      ),
    );
  }

  // 6. Canonical scheduling/creator-dependency readiness.
  let canonicalState: CanonicalContentState | null = null;
  if (input.row) {
    canonicalState = resolveCanonicalState(input.row);
    if (!input.skipSchedulingReadiness) {
      if (canonicalState === CanonicalContentState.PENDING_CREATOR) {
        return pipelineError(
          PipelineErrorCode.CREATOR_DEPENDENCY_UNRESOLVED,
          'Creator asset is not ready yet (pending creator upload/render). Cannot schedule/publish until the asset is provided.',
          { platform, canonicalState },
        );
      }
      const schedulable =
        canonicalState === CanonicalContentState.READY_FOR_SCHEDULE ||
        canonicalState === CanonicalContentState.READY_FOR_REVIEW ||
        canonicalState === CanonicalContentState.SCHEDULED ||
        canonicalState === CanonicalContentState.AI_GENERATING;
      if (!schedulable) {
        return pipelineError(
          PipelineErrorCode.NOT_READY_FOR_SCHEDULE,
          `Content is not in a schedulable state (canonical=${canonicalState}).`,
          { platform, canonicalState },
        );
      }
    }
  }

  if (warnings.length > 0) {
    logPipelineEvent('publish.validation', 'warn', {
      platform,
      warnings: warnings.map((w) => w.code),
      canonicalState,
    }, { dedupeKey: `${platform}|${warnings.map((w) => w.code).join(',')}` });
  }

  return { ok: true, platform, canonicalState, warnings };
}

/**
 * Optional async asset-accessibility probe (kept OUT of the pure
 * validator so that stays deterministic/reusable). Best-effort HEAD;
 * never throws. Returns a PipelineError on a confirmed dead asset.
 */
export async function assertMediaAccessible(
  mediaUrls: string[] | null | undefined,
  timeoutMs = 4000,
): Promise<PipelineError | null> {
  const urls = (Array.isArray(mediaUrls) ? mediaUrls : []).filter(isHttpUrl);
  for (const url of urls) {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), timeoutMs);
      const r = await fetch(url, { method: 'HEAD', signal: ac.signal });
      clearTimeout(t);
      if (r.status >= 400) {
        return pipelineError(
          PipelineErrorCode.MEDIA_ASSET_INACCESSIBLE,
          `Attached media is not accessible (HTTP ${r.status}). It may be an expired signed URL.`,
          { url: url.slice(0, 120), status: r.status },
        );
      }
    } catch {
      // Network/timeout — inconclusive, not a hard fail (avoid false positives).
      return null;
    }
  }
  return null;
}
