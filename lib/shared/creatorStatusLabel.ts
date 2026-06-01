/**
 * Creator calendar STATUS LABEL mapper (visibility-only).
 *
 * Standardizes the small set of user-facing statuses the creator calendar
 * needs WITHOUT touching the shared canonical badge map
 * (`contentLifecycle.ts` `CANONICAL_BADGE`) — that map is consumed by ~55
 * surfaces incl. BOLT Text preview and must not change. This module
 * *composes* the existing pure helpers and is consumed only by the
 * calendar tiles + the post-preview drawer.
 *
 * Final label set (confirmed): GENERATING, WAITING_FOR_VIDEO,
 * VIDEO_UPLOADED, SCHEDULED, PUBLISHED, FAILED. WAITING_FOR_VIDEO doubles
 * as "ready for upload" — there is one pre-upload state.
 *
 * AI-generated assets (image/carousel/infographic — Omnivyra renders them)
 * progress GENERATING → SCHEDULED → PUBLISHED and never carry a creator
 * brief / upload affordance. Creator-produced assets (video/reel/short —
 * Omnivyra only writes a brief) progress WAITING_FOR_VIDEO → VIDEO_UPLOADED
 * → SCHEDULED → PUBLISHED.
 */

import {
  CanonicalContentState,
  isCanonicalState,
  resolveCanonicalState,
  type ResolvableRow,
} from './contentLifecycle';
import { readLifecycleState } from './creatorLifecycleStateMachine';
import { isSupportedManualVideoUpload } from './contentTypeClassification';

export type CreatorStatusKey =
  | 'GENERATING'
  | 'WAITING_FOR_VIDEO'
  | 'VIDEO_UPLOADED'
  | 'SCHEDULED'
  | 'PUBLISHED'
  | 'FAILED';

/** Reuses the existing canonical group buckets so chip colors are shared. */
export type CreatorStatusGroup =
  | 'pending'
  | 'ready'
  | 'scheduled'
  | 'published'
  | 'failed'
  | 'draft';

/**
 * Loose calendar-event shape. Accepts both the dashboard `ActivityEvent`
 * and the per-campaign activity row — every field is optional so callers
 * never need a type dependency.
 */
export interface CreatorStatusInput extends ResolvableRow {
  canonical_state?: string | null;
  canonical_group?: string | null;
  asset_type?: string | null;
  content_type?: string | null;
  pending?: boolean;
}

const LABEL: Record<CreatorStatusKey, string> = {
  GENERATING: 'Generating',
  WAITING_FOR_VIDEO: 'Waiting For Video',
  VIDEO_UPLOADED: 'Video Uploaded',
  SCHEDULED: 'Scheduled',
  PUBLISHED: 'Published',
  FAILED: 'Failed',
};

const GROUP: Record<CreatorStatusKey, CreatorStatusGroup> = {
  GENERATING: 'draft',
  WAITING_FOR_VIDEO: 'pending',
  VIDEO_UPLOADED: 'ready',
  SCHEDULED: 'scheduled',
  PUBLISHED: 'published',
  FAILED: 'failed',
};

function parseContentObject(c: ResolvableRow['content']): Record<string, unknown> | null {
  if (!c) return null;
  if (typeof c === 'object') return c as Record<string, unknown>;
  try {
    const p = JSON.parse(c);
    return p && typeof p === 'object' ? (p as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Is this calendar item creator-PRODUCED (video/reel/short — system writes
 * only a brief, user uploads the video) vs AI-GENERATED (image/carousel/
 * infographic — system renders it)?
 *
 * Anchored on the supported manual-video predicate; falls back to the
 * `pending` canonical group (the calendar feed only sets `pending` on
 * gated video rows).
 */
export function isCreatorProduced(event: CreatorStatusInput): boolean {
  if (isSupportedManualVideoUpload(event.asset_type ?? event.content_type)) return true;
  const group = String(event.canonical_group ?? '').trim().toLowerCase();
  if (group === 'pending') return true;
  return event.pending === true;
}

/** Resolve the canonical state, preferring an already-attached value. */
function resolveCanonical(event: CreatorStatusInput): CanonicalContentState {
  if (isCanonicalState(event.canonical_state)) return event.canonical_state;
  return resolveCanonicalState(event);
}

/**
 * The single status mapper. Returns the standardized key + a display label
 * + a color group (reused from the canonical badge style buckets).
 */
export function deriveCreatorStatusLabel(
  event: CreatorStatusInput,
): { key: CreatorStatusKey; label: string; group: CreatorStatusGroup } {
  const canonical = resolveCanonical(event);
  const video = isCreatorProduced(event);

  let key: CreatorStatusKey;
  switch (canonical) {
    case CanonicalContentState.PUBLISHED:
      key = 'PUBLISHED';
      break;
    case CanonicalContentState.FAILED:
      key = 'FAILED';
      break;
    case CanonicalContentState.SCHEDULED:
      key = 'SCHEDULED';
      break;
    case CanonicalContentState.PENDING_CREATOR:
      // Awaiting the human-produced video (also covers retryable upload_failed).
      key = video ? 'WAITING_FOR_VIDEO' : 'GENERATING';
      break;
    case CanonicalContentState.READY_FOR_REVIEW:
    case CanonicalContentState.READY_FOR_SCHEDULE:
      // Video: the asset has been uploaded and is heading to a slot.
      // AI: render-done-but-pre-schedule folds into GENERATING→SCHEDULED.
      key = video ? 'VIDEO_UPLOADED' : 'GENERATING';
      break;
    case CanonicalContentState.AI_GENERATING:
    case CanonicalContentState.PLANNED:
    default:
      key = video ? 'WAITING_FOR_VIDEO' : 'GENERATING';
      break;
  }

  // Refine the video pre-schedule sub-state from the creator FSM when the
  // canonical state can't disambiguate (e.g. media_uploaded vs awaiting).
  if (video && (key === 'WAITING_FOR_VIDEO' || key === 'VIDEO_UPLOADED')) {
    const fsm = readLifecycleState(parseContentObject(event.content));
    if (fsm === 'media_uploaded' || fsm === 'ready_for_schedule') key = 'VIDEO_UPLOADED';
    else if (fsm === 'awaiting_media_upload' || fsm === 'upload_failed') key = 'WAITING_FOR_VIDEO';
  }

  return { key, label: LABEL[key], group: GROUP[key] };
}

export interface WorkflowStep {
  label: string;
  done: boolean;
  /** The step currently in progress (rendered with a ⏳-style marker). */
  current?: boolean;
}

/**
 * The progression checklist shown in the drawer. Video items get the
 * 6-step creator workflow; AI items get the 4-step generation workflow.
 */
export function deriveWorkflowChecklist(event: CreatorStatusInput): WorkflowStep[] {
  const { key } = deriveCreatorStatusLabel(event);
  const video = isCreatorProduced(event);

  if (video) {
    const uploaded = key === 'VIDEO_UPLOADED' || key === 'SCHEDULED' || key === 'PUBLISHED';
    const scheduled = key === 'SCHEDULED' || key === 'PUBLISHED';
    const published = key === 'PUBLISHED';
    return [
      { label: 'Daily Plan', done: true },
      { label: 'Video Brief Generated', done: true },
      { label: 'Schedule Reserved', done: true },
      { label: 'Video Uploaded', done: uploaded, current: key === 'WAITING_FOR_VIDEO' },
      { label: 'Scheduled', done: scheduled, current: uploaded && !scheduled },
      { label: 'Published', done: published },
    ];
  }

  const generated = key !== 'GENERATING';
  const scheduled = key === 'SCHEDULED' || key === 'PUBLISHED';
  const published = key === 'PUBLISHED';
  return [
    { label: 'Daily Plan', done: true },
    { label: 'Generated', done: generated, current: key === 'GENERATING' },
    { label: 'Scheduled', done: scheduled, current: generated && !scheduled },
    { label: 'Published', done: published },
  ];
}
