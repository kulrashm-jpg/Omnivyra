/**
 * Machine-readable error codes for the campaign→publish pipeline.
 * Stable strings — safe to switch on in clients, logs, and tests.
 * Additive only; never renumber/rename an existing code.
 */
export const PipelineErrorCode = {
  // ── scheduling / queue ────────────────────────────────────────────
  QUEUE_UNAVAILABLE: 'QUEUE_UNAVAILABLE',
  SCHEDULING_DEGRADED: 'SCHEDULING_DEGRADED',
  SCHEDULING_PRODUCED_ZERO: 'SCHEDULING_PRODUCED_ZERO',
  STALE_EXECUTION_RECLAIMED: 'STALE_EXECUTION_RECLAIMED',
  // ── publish readiness ─────────────────────────────────────────────
  MEDIA_REQUIRED_MISSING: 'MEDIA_REQUIRED_MISSING',
  MEDIA_UNSUPPORTED_ON_PLATFORM: 'MEDIA_UNSUPPORTED_ON_PLATFORM',
  MEDIA_WOULD_BE_STRIPPED: 'MEDIA_WOULD_BE_STRIPPED',
  PLATFORM_UNSUPPORTED: 'PLATFORM_UNSUPPORTED',
  PLATFORM_PUBLISH_PATH_MISSING: 'PLATFORM_PUBLISH_PATH_MISSING',
  TIKTOK_FINALIZE_UNCONFIRMED: 'TIKTOK_FINALIZE_UNCONFIRMED',
  CREATOR_DEPENDENCY_UNRESOLVED: 'CREATOR_DEPENDENCY_UNRESOLVED',
  MEDIA_URL_INVALID: 'MEDIA_URL_INVALID',
  MEDIA_ASSET_INACCESSIBLE: 'MEDIA_ASSET_INACCESSIBLE',
  NOT_READY_FOR_SCHEDULE: 'NOT_READY_FOR_SCHEDULE',
  CONTENT_EMPTY: 'CONTENT_EMPTY',
} as const;

export type PipelineErrorCode =
  (typeof PipelineErrorCode)[keyof typeof PipelineErrorCode];

/** Deterministic, machine-readable error object shape used everywhere. */
export interface PipelineError {
  ok: false;
  code: PipelineErrorCode;
  /** Human-actionable message (safe to surface in UI). */
  message: string;
  /** Optional structured context (never secrets). */
  context?: Record<string, unknown>;
}

export interface PipelineOk {
  ok: true;
  context?: Record<string, unknown>;
}

export type PipelineResult = PipelineOk | PipelineError;

export function pipelineError(
  code: PipelineErrorCode,
  message: string,
  context?: Record<string, unknown>,
): PipelineError {
  return { ok: false, code, message, ...(context ? { context } : {}) };
}
