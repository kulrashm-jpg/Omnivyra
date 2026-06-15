/**
 * Phase 2A — Per-row scheduling-lane classifier (INERT INFRASTRUCTURE).
 *
 * Deterministic, pure, side-effect-free classification of a single
 * content row into a scheduling lane. This is the row-level routing
 * INTELLIGENCE for Intelligent Mix campaigns.
 *
 * ────────────────────────────────────────────────────────────────────────
 * IMPORTANT — NOT WIRED INTO EXECUTION (Phase 2A boundary):
 *   Nothing in the live scheduler/pipeline imports this module. The
 *   scheduler still routes at the CAMPAIGN level via `usesUnifiedMediaFlow`
 *   (`executionProfile === 'creator'`). Activating row-level routing — i.e.
 *   making the scheduler consult `classifyRowLane` — is Phase 2B. Until
 *   then this is read-only diagnostic capability with zero runtime effect.
 * ────────────────────────────────────────────────────────────────────────
 *
 * Design (lowest-risk):
 *   - Composes the EXISTING registries rather than introducing a new
 *     taxonomy: intent_type (canonical family flag on daily_content_plans),
 *     `classifyContentType` (BOLT-text vs creator_autonomous vs video_brief),
 *     and `getRowSchedulingEligibility` (per-row autonomous / attachment /
 *     text-only / unsupported + lifecycle readiness).
 *   - Independent of campaign mode: a row is classified purely from its own
 *     fields, so the same row routes identically regardless of whether the
 *     campaign is text / creator / combined / creator_dependent.
 *   - No DB reads, no DB writes, no scheduler interaction.
 */

import { classifyContentType } from '../contentTypeClassification';
import {
  getRowSchedulingEligibility,
  normalizeCreatorFormat,
  type CreatorLifecycleState,
} from '../creatorGovernanceRegistry';

/** The lane a row would be scheduled through under row-level routing. */
export type SchedulingLane =
  | 'TEXT'                // Omnivyra-generated text → text scheduling lane
  | 'CREATOR_AUTONOMOUS'  // Group A asset (image/carousel/…) → render + schedule
  | 'CREATOR_ATTACHMENT'  // Group B asset with media uploaded & ready → schedulable
  | 'VIDEO_WAITING'       // Group B asset awaiting a user-uploaded media URL
  | 'INELIGIBLE';         // unrecognized / unsupported → held, never scheduled

/**
 * Input row shape. Mirrors the relevant `daily_content_plans` columns. The
 * lifecycle / upload fields live in the row's `content` JSON in the DB; this
 * type accepts them either flattened OR nested under `content` and prefers
 * the flattened value when both are present.
 */
export interface RoutableRow {
  intent_type?: unknown;
  content_type?: unknown;
  asset_type?: unknown;
  content_status?: unknown;
  /** daily_content_plans.content JSON (may hold lifecycle/upload fields). */
  content?: unknown;
  creator_lifecycle_state?: unknown;
  uploaded_media_url?: unknown;
  upload_validation?: unknown;
}

export interface RowRoutingDecision {
  lane: SchedulingLane;
  /** Machine-readable explanation of why this lane was chosen. */
  reason: string;
  /** Resolved content family for the row. */
  intent: 'text' | 'creator' | 'unknown';
  /** Normalized content type used for classification (or null). */
  contentType: string | null;
  /** Pass-through diagnostics from getRowSchedulingEligibility (creator rows). */
  creatorLifecycle?: 'autonomous' | 'attachment_required' | 'unsupported' | 'text_only';
  canScheduleNow?: boolean;
  requiresUpload?: boolean;
  currentState?: CreatorLifecycleState | 'unknown';
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Prefer a flat field, falling back to the same key inside `content` JSON. */
function pick(row: RoutableRow, key: keyof RoutableRow): unknown {
  const flat = row[key];
  if (flat !== undefined && flat !== null && flat !== '') return flat;
  const content = asRecord(row.content);
  return content[key as string];
}

/**
 * Classify a single row into a scheduling lane. Pure & deterministic.
 *
 * Resolution order:
 *   1. intent_type === 'creator' (authoritative family flag) → creator branch
 *   2. intent_type === 'text'                                → TEXT
 *   3. no/unknown intent_type → infer family from content_type
 *
 * Creator branch uses getRowSchedulingEligibility to split into
 * autonomous / attachment(ready) / video-waiting / text-like / ineligible.
 */
export function classifyRowLane(row: RoutableRow | null | undefined): RowRoutingDecision {
  const r = row ?? {};
  const contentTypeRaw = asString(r.content_type) || asString(asRecord(r.content).content_type);
  const contentType = contentTypeRaw ? normalizeCreatorFormat(contentTypeRaw) : null;
  const intentRaw = asString(r.intent_type).toLowerCase();

  // ── Resolve content family (mode-independent) ──────────────────────────
  let intent: 'text' | 'creator' | 'unknown';
  if (intentRaw === 'creator') intent = 'creator';
  else if (intentRaw === 'text') intent = 'text';
  else {
    // No explicit intent — infer from the content type via the canonical
    // build-mode classifier.
    const build = classifyContentType(contentTypeRaw);
    if (build.mode === 'bolt_text') intent = 'text';
    else if (build.mode === 'creator_autonomous' || build.mode === 'video_brief') intent = 'creator';
    else intent = 'unknown';
  }

  if (intent === 'text') {
    return { lane: 'TEXT', reason: 'text_intent', intent, contentType };
  }

  if (intent === 'unknown') {
    return { lane: 'INELIGIBLE', reason: 'unrecognized_content_family', intent, contentType };
  }

  // ── Creator row → per-row eligibility (autonomous / attachment / …) ─────
  const eligibility = getRowSchedulingEligibility({
    content_type: contentTypeRaw,
    content_status: pick(r, 'content_status'),
    creator_lifecycle_state: pick(r, 'creator_lifecycle_state'),
    uploaded_media_url: pick(r, 'uploaded_media_url'),
    upload_validation: pick(r, 'upload_validation'),
  });

  const base = {
    intent,
    contentType,
    creatorLifecycle: eligibility.lifecycle,
    canScheduleNow: eligibility.can_schedule_now,
    requiresUpload: eligibility.requires_upload,
    currentState: eligibility.current_state,
  } as const;

  switch (eligibility.lifecycle) {
    case 'autonomous':
      return { lane: 'CREATOR_AUTONOMOUS', reason: eligibility.reason, ...base };
    case 'attachment_required':
      // Awaiting (or invalid/incomplete) upload → video-waiting; otherwise
      // media is present and the row is an attachment ready to schedule.
      return eligibility.can_schedule_now
        ? { lane: 'CREATOR_ATTACHMENT', reason: eligibility.reason, ...base }
        : { lane: 'VIDEO_WAITING', reason: eligibility.reason, ...base };
    case 'text_only':
      // Text-like creator rows (e.g. post_with_asset) ride the text lane.
      return { lane: 'TEXT', reason: `creator_text_like:${eligibility.reason}`, ...base };
    case 'unsupported':
    default:
      return { lane: 'INELIGIBLE', reason: eligibility.reason, ...base };
  }
}

/** Convenience: classify a batch of rows. Pure. */
export function classifyRowLanes(rows: Array<RoutableRow | null | undefined>): RowRoutingDecision[] {
  return (Array.isArray(rows) ? rows : []).map((row) => classifyRowLane(row));
}

/** Result of partitioning rows into scheduler-dispatch buckets. */
export interface LanePartition<T> {
  /** CREATOR_AUTONOMOUS | CREATOR_ATTACHMENT | VIDEO_WAITING → creator path. */
  creatorLane: T[];
  /** TEXT → text path. */
  textLane: T[];
  /** INELIGIBLE → dispatched to neither (skipped). */
  ineligible: T[];
}

/**
 * Partition rows into the three dispatch buckets used by row-level routing.
 * Pure; preserves the input element type. The video-waiting lane is folded
 * into `creatorLane` on purpose: the creator scheduling path's EXISTING
 * per-row eligibility decides schedule-vs-hold, so video rows that lack a
 * validated upload are held there rather than via separate hold logic.
 */
export function partitionRowsByLane<T extends RoutableRow>(rows: T[] | null | undefined): LanePartition<T> {
  const creatorLane: T[] = [];
  const textLane: T[] = [];
  const ineligible: T[] = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const lane = classifyRowLane(row).lane;
    if (lane === 'TEXT') textLane.push(row);
    else if (lane === 'INELIGIBLE') ineligible.push(row);
    else creatorLane.push(row);
  }
  return { creatorLane, textLane, ineligible };
}
