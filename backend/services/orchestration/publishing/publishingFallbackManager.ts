/**
 * publishingFallbackManager — Phase-2 Step-31.
 *
 * Decides the publishing authority mode and isolates legacy publish
 * derivation so it activates ONLY when (a) the projection is missing,
 * (b) rollback fired, (c) orchestration incomplete, or (d) explicit LEGACY
 * cutover. Produces the legacy-derived comparison snapshot + the
 * [PUBLISHING_EXECUTION_DIFF] category result for SHADOW validation.
 */

import { resolveCutoverMode } from '../generation';
import type {
  PublishingExecutionProjection,
  PublishingMode,
} from './publishingEligibilityProjection';

export interface PublishingModeDecision {
  mode: PublishingMode;
  fallback_active: boolean;
  reason: string;
}

export function resolvePublishingMode(params: {
  projectionAvailable: boolean;
  rollbackTriggered: boolean;
  orchestrationComplete: boolean;
}): PublishingModeDecision {
  if (!params.projectionAvailable) {
    return { mode: 'LEGACY', fallback_active: true, reason: 'projection_unavailable' };
  }
  if (params.rollbackTriggered) {
    return { mode: 'LEGACY', fallback_active: true, reason: 'rollback_triggered' };
  }
  const cutover = resolveCutoverMode();
  if (cutover === 'LEGACY') {
    return { mode: 'LEGACY', fallback_active: true, reason: 'cutover_legacy' };
  }
  if (!params.orchestrationComplete) {
    return { mode: 'SHADOW', fallback_active: true, reason: 'orchestration_incomplete' };
  }
  if (cutover === 'AUTHORITATIVE') {
    return { mode: 'AUTHORITATIVE', fallback_active: false, reason: 'cutover_authoritative' };
  }
  return { mode: 'SHADOW', fallback_active: true, reason: 'cutover_shadow' };
}

export interface LegacyPublishingSnapshot {
  eligible: boolean;
  requires_creator_input: boolean;
  has_creator_asset: boolean;
  is_creator: boolean;
  scheduled: boolean;
}

/** Legacy-derived comparison snapshot (FALLBACK-ONLY — never authoritative). */
export function deriveLegacyPublishingSnapshot(
  legacyRaw: Record<string, unknown>,
): LegacyPublishingSnapshot {
  const status = String(legacyRaw.content_status ?? '').toLowerCase();
  const intentType = String(legacyRaw.intent_type ?? '').toLowerCase();
  const ca = legacyRaw.creator_asset as { url?: unknown; files?: unknown } | undefined;
  const hasCreatorAsset = Boolean(
    ca && (ca.url || (Array.isArray(ca.files) && ca.files.length > 0)),
  );
  return {
    eligible: ['render_ready', 'ready', 'creator_ready', 'scheduled', 'published'].includes(status),
    requires_creator_input: intentType === 'creator' && !hasCreatorAsset,
    has_creator_asset: hasCreatorAsset,
    is_creator: intentType === 'creator',
    scheduled: status === 'scheduled' || status === 'published' || !!legacyRaw.scheduled_post_id,
  };
}

export interface PublishingDiffResult {
  publish_eligibility_match: boolean;
  platform_payload_match: boolean;
  upload_match: boolean;
  creator_match: boolean;
  scheduling_match: boolean;
  orchestration_fidelity: boolean;
  mismatches: string[];
}

export function diffPublishing(
  authoritative: PublishingExecutionProjection,
  legacy: LegacyPublishingSnapshot,
): PublishingDiffResult {
  const mismatches: string[] = [];

  const authEligible =
    authoritative.scheduler_status === 'PUBLISH_READY' ||
    authoritative.scheduler_status === 'SCHEDULABLE' ||
    authoritative.scheduler_status === 'AI_READY';
  const publish_eligibility_match = authEligible === legacy.eligible;
  if (!publish_eligibility_match) mismatches.push('publish_eligibility');

  const platform_payload_match = authoritative.platform_payload_ready === legacy.eligible;
  if (!platform_payload_match) mismatches.push('platform_payload');

  const upload_match =
    authoritative.upload_eligibility.has_asset === legacy.has_creator_asset;
  if (!upload_match) mismatches.push('upload');

  const creator_match =
    authoritative.creator_eligibility.is_creator_flow === legacy.is_creator;
  if (!creator_match) mismatches.push('creator');

  const scheduling_match =
    (authoritative.scheduler_status === 'PUBLISH_READY' && legacy.scheduled) ||
    (authoritative.scheduler_status !== 'PUBLISH_READY') === !legacy.scheduled
      ? true
      : authoritative.schedulable === legacy.eligible;
  if (!scheduling_match) mismatches.push('scheduling');

  return {
    publish_eligibility_match,
    platform_payload_match,
    upload_match,
    creator_match,
    scheduling_match,
    orchestration_fidelity: mismatches.length === 0,
    mismatches,
  };
}
