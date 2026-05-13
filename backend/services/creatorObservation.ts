/**
 * Creator Observation — lightweight, additive structured-event helper for
 * the Creator subsystem.
 *
 * Why this exists
 * ───────────────
 * The Creator pipeline (provider image generation → overlay composite →
 * PDF upload → asset save) accumulated `console.warn` calls organically
 * over the last several hardening passes. Each carries useful detail but
 * none follow a uniform shape, so dashboard pivots / grep aggregates are
 * harder than they should be.
 *
 * This module wraps the existing `logger` with a thin convention:
 *
 *   creatorEvent(stage, status, detail)  →  one structured log line per
 *                                            distinct outcome bucket.
 *
 * Stages mirror the pipeline phases (provider, overlay, pdf_upload,
 * asset_save, restore). Statuses are a small fixed set (ok, fallback,
 * skip, error). The detail object is free-form but expected to carry
 * the *category* of the failure for clean dashboard aggregation.
 *
 * Imports nothing the renderer doesn't already use, no new deps, no
 * new schema, no new endpoints. Purely additive.
 */

import { logger } from './logger';

export type CreatorStage =
  | 'provider'        // OpenAI image generation
  | 'overlay'         // deterministic SVG overlay composite
  | 'pdf_upload'      // pdfkit → storage upload
  | 'asset_save'      // POST /api/block-templates
  | 'restore'         // handleUseExistingAsset / continuity bundle parse
  | 'generation';     // generic generation envelope

export type CreatorStatus =
  /** Stage completed in the happy path. */
  | 'ok'
  /** Stage failed but the renderer degraded gracefully (e.g. PDF preview
   *  available, downloadable not; provider unavailable → gradient
   *  fallback). User-visible message exists. */
  | 'fallback'
  /** Stage was intentionally skipped (composition mode skips overlay
   *  composite; non-Creator asset has no restore bundle; etc). */
  | 'skip'
  /** Hard failure — no graceful path. Caller surfaces a visible error. */
  | 'error';

export interface CreatorEventDetail {
  /** Asset type / creator type if known. */
  assetType?:    string | null;
  /** Platform context if known. */
  platform?:     string | null;
  /** Coarse failure / fallback category for dashboards. */
  category?:     string;
  /** Raw error message — bounded to keep log lines compact. */
  message?:      string;
  /** Anything else useful — kept loose; do NOT put PII or large payloads. */
  [key: string]: unknown;
}

/**
 * Emit a structured creator-pipeline event. The log line shape is:
 *
 *   {
 *     event:  'creator_event',
 *     stage:  '<CreatorStage>',
 *     status: '<CreatorStatus>',
 *     ...detail
 *   }
 *
 * Routes to `logger.info` for `ok` / `fallback` / `skip`; `logger.warn`
 * for `error` so error-level surfaces stay accurate (these are not
 * subsystem-fatal — auth-spine reserves `logger.error` for genuinely
 * page-out-worthy events).
 */
export function creatorEvent(
  stage:   CreatorStage,
  status:  CreatorStatus,
  detail:  CreatorEventDetail = {},
): void {
  const trimmedMessage = typeof detail.message === 'string'
    ? detail.message.slice(0, 240)
    : detail.message;
  const payload: Record<string, unknown> = {
    stage,
    status,
    ...detail,
    message: trimmedMessage,
  };
  if (status === 'error') {
    logger.warn('creator_event', payload);
    return;
  }
  logger.info('creator_event', payload);
}
