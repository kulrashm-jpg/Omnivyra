/**
 * The ONE canonical content lifecycle.
 *
 * Ordered states, an allowed-transition map with `canTransition(from, to)`, and
 * `mapLegacyStatus(source, rawStatus)` adapters that fold every existing status
 * vocabulary onto the canonical lifecycle. These are PURE functions — no db, no
 * side effects — so they are safe to share between server, worker, and client.
 *
 * Canonical order (DEFAULT_LIFECYCLE):
 *   draft → generated → edited → approved → adapted → scheduled → published → archived
 *
 * The transition map is intentionally permissive within that forward spine
 * (regeneration, re-edit, and un-schedule are real product actions) while still
 * rejecting nonsensical jumps. `archived` is reachable from every active state
 * and can be restored to `draft`.
 *
 * WRITER-EXEC-005 Wave 4 (ADDITIVE): a 'quality_reviewed' gate is introduced
 * between 'edited' and 'approved' (see EXTENDED_LIFECYCLE + the new transitions
 * in ALLOWED_TRANSITIONS). `DEFAULT_LIFECYCLE` is intentionally left as the
 * original 8-state ordering so existing consumers / snapshots stay stable;
 * callers that want the Wave-4 ordering read EXTENDED_LIFECYCLE. All new
 * behavior is expressed through the transition map + type, which is the only
 * thing `canTransition` consults.
 */

import type { ContentLifecycleStatus } from './canonicalContent';

/**
 * Canonical ordered lifecycle. Index = nominal forward progression.
 *
 * NOTE: kept as the original 8-state ordering for backward compatibility (the
 * Wave-1 contract + tests assert this exact array). The Wave-4 'quality_reviewed'
 * gate lives in EXTENDED_LIFECYCLE and in ALLOWED_TRANSITIONS — it is a valid
 * lifecycle state everywhere `canTransition` is used.
 */
export const DEFAULT_LIFECYCLE: readonly ContentLifecycleStatus[] = [
  'draft',
  'generated',
  'edited',
  'approved',
  'adapted',
  'scheduled',
  'published',
  'archived',
] as const;

/**
 * Wave-4 ordered lifecycle — DEFAULT_LIFECYCLE with the additive
 * 'quality_reviewed' gate inserted between 'edited' and 'approved'. This is the
 * ordering surfaces should render for the human/AI editorial flow:
 *   draft → generated → edited → quality_reviewed → approved → adapted →
 *   scheduled → published → archived
 */
export const EXTENDED_LIFECYCLE: readonly ContentLifecycleStatus[] = [
  'draft',
  'generated',
  'edited',
  'quality_reviewed',
  'approved',
  'adapted',
  'scheduled',
  'published',
  'archived',
] as const;

/**
 * Allowed transitions. A status maps to the set of statuses it may move to.
 * Self-transitions (from === to) are NOT transitions and are rejected by
 * `canTransition` regardless of this map.
 */
export const ALLOWED_TRANSITIONS: Readonly<
  Record<ContentLifecycleStatus, readonly ContentLifecycleStatus[]>
> = {
  draft: ['generated', 'edited', 'archived'],
  generated: ['edited', 'approved', 'adapted', 'scheduled', 'archived'],
  // Wave 4 (ADDITIVE): 'edited' may now advance into the quality-review gate.
  // All pre-existing 'edited' transitions are preserved unchanged.
  edited: ['generated', 'quality_reviewed', 'approved', 'adapted', 'scheduled', 'archived'],
  // Wave 4 (ADDITIVE): the quality-review gate. It can be approved (advance),
  // sent back to 'edited' (revise), or archived (like every active state).
  quality_reviewed: ['edited', 'approved', 'archived'],
  approved: ['edited', 'adapted', 'scheduled', 'archived'],
  adapted: ['edited', 'approved', 'scheduled', 'archived'],
  scheduled: ['edited', 'approved', 'published', 'archived'],
  published: ['edited', 'archived'],
  // Terminal, except an explicit restore back into the active spine.
  archived: ['draft'],
};

/** True iff `to` is a distinct, allowed next state from `from`. */
export function canTransition(
  from: ContentLifecycleStatus,
  to: ContentLifecycleStatus,
): boolean {
  if (from === to) return false;
  const next = ALLOWED_TRANSITIONS[from];
  if (!next) return false;
  return next.includes(to);
}

/** Legacy status sources that predate the canonical spine. */
export type LegacyStatusSource =
  | 'scheduled_post'
  | 'campaign'
  | 'creator_asset'
  | 'workspace_fsm';

/**
 * Per-source adapter tables. Each maps a source's raw status vocabulary onto
 * the canonical lifecycle. Unknown values fall through to `mapLegacyStatus`'s
 * safe default ('draft') with a warning.
 */
const LEGACY_STATUS_MAPS: Record<
  LegacyStatusSource,
  Record<string, ContentLifecycleStatus>
> = {
  // scheduled_posts: draft / scheduled / publishing / published / failed.
  scheduled_post: {
    draft: 'draft',
    scheduled: 'scheduled',
    // In-flight publish — the item is still committed to a schedule slot.
    publishing: 'scheduled',
    published: 'published',
    // A failed publish stays "scheduled" (awaiting retry); the lifecycle has
    // no failure terminal in Wave 1.
    failed: 'scheduled',
  },
  // campaign items: draft / pending / approved / scheduled / published.
  campaign: {
    draft: 'draft',
    // Generated and awaiting approval.
    pending: 'generated',
    // Wave 4 (ADDITIVE): a campaign item under editorial quality review.
    in_review: 'quality_reviewed',
    quality_reviewed: 'quality_reviewed',
    approved: 'approved',
    scheduled: 'scheduled',
    published: 'published',
  },
  // creator_assets: awaiting_media_upload / media_uploaded / ready_for_schedule / scheduled.
  creator_asset: {
    awaiting_media_upload: 'generated',
    media_uploaded: 'edited',
    ready_for_schedule: 'approved',
    scheduled: 'scheduled',
  },
  // workspace_fsm (the inert client FSM being retired):
  // planned / queued / generating / needs-review / approved / published / failed.
  workspace_fsm: {
    planned: 'draft',
    queued: 'draft',
    generating: 'draft',
    'needs-review': 'generated',
    // Wave 4 (ADDITIVE): the retired FSM's post-review quality gate.
    'quality-review': 'quality_reviewed',
    quality_reviewed: 'quality_reviewed',
    approved: 'approved',
    published: 'published',
    // Failed generation drops back to draft for another attempt.
    failed: 'draft',
  },
};

/**
 * Map a legacy status onto the canonical lifecycle. Normalizes case/whitespace.
 * Unknown/empty values default to 'draft' (the safest active state) and warn.
 */
export function mapLegacyStatus(
  source: LegacyStatusSource,
  rawStatus: string | null | undefined,
): ContentLifecycleStatus {
  const table = LEGACY_STATUS_MAPS[source];
  if (!table) {
    console.warn('[contentLifecycle][unknown-legacy-source]', { source });
    return 'draft';
  }
  const key = String(rawStatus ?? '').trim().toLowerCase();
  const mapped = table[key];
  if (!mapped) {
    console.warn('[contentLifecycle][unknown-legacy-status]', { source, rawStatus });
    return 'draft';
  }
  return mapped;
}
