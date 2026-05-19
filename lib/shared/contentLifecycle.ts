/**
 * CANONICAL CONTENT LIFECYCLE — single read-authority for daily_content_plans.
 *
 * Problem this solves (audit Round 1, gap "inconsistent state handling"):
 *   `daily_content_plans` carries THREE overlapping state notions —
 *     - `content_status`            (free-text TEXT column, no DB enum)
 *     - `content.creator_lifecycle_state` (creatorLifecycleStateMachine FSM)
 *     - render states               (creator_render_* substrate)
 *   APIs + the calendar each re-derived status ad-hoc → inconsistent UI.
 *
 * This module is a NON-BREAKING unifying layer. It does NOT replace the
 * existing FSM (`creatorLifecycleStateMachine.ts`) or the governance
 * registry — those keep owning the write-side creator transitions. It
 * adds ONE canonical vocabulary + a resolver so every reader (APIs,
 * calendar) maps to the same 8 states. No DB migration. No consumer is
 * forced to change; callers opt in by reading `resolveCanonicalState`.
 *
 * Backward compatibility:
 *   - `normalizeContentStatus()` maps ANY legacy free-text value (incl.
 *     creator lifecycle + render values) → canonical.
 *   - `toLegacyContentStatus()` maps canonical → a legacy string safe to
 *     write to the free-text `content_status` column (no CHECK exists).
 *   - Unknown / null inputs resolve to PLANNED (never throws).
 */

import { readLifecycleState, type CreatorLifecycleStateExt } from './creatorLifecycleStateMachine';

/** The 8 canonical lifecycle states (audit Round-1 spec). */
export enum CanonicalContentState {
  PLANNED = 'PLANNED',
  AI_GENERATING = 'AI_GENERATING',
  PENDING_CREATOR = 'PENDING_CREATOR',
  READY_FOR_REVIEW = 'READY_FOR_REVIEW',
  READY_FOR_SCHEDULE = 'READY_FOR_SCHEDULE',
  SCHEDULED = 'SCHEDULED',
  PUBLISHED = 'PUBLISHED',
  FAILED = 'FAILED',
}

export type CanonicalContentStateKey = keyof typeof CanonicalContentState;

const ALL_CANONICAL = new Set<string>(Object.values(CanonicalContentState));

export function isCanonicalState(v: unknown): v is CanonicalContentState {
  return typeof v === 'string' && ALL_CANONICAL.has(v);
}

/**
 * Legacy free-text → canonical. Covers every value the audit found in
 * use across `backend/` (`content_status`), the creator FSM
 * (`creator_lifecycle_state`), and the render substrate. Case/space
 * insensitive. Anything unrecognised → PLANNED (safe default, never throws).
 */
const LEGACY_TO_CANONICAL: Record<string, CanonicalContentState> = {
  // ── plan / text lane ──────────────────────────────────────────────
  planned: CanonicalContentState.PLANNED,
  pending: CanonicalContentState.PLANNED,
  draft: CanonicalContentState.PLANNED,
  // ── AI generation in flight ───────────────────────────────────────
  generating: CanonicalContentState.AI_GENERATING,
  generating_master: CanonicalContentState.AI_GENERATING,
  generating_variants: CanonicalContentState.AI_GENERATING,
  ai_generating: CanonicalContentState.AI_GENERATING,
  rendering: CanonicalContentState.AI_GENERATING,
  processing: CanonicalContentState.AI_GENERATING,
  // ── pending creator (human asset required) ────────────────────────
  awaiting_media_upload: CanonicalContentState.PENDING_CREATOR,
  guidance_ready: CanonicalContentState.PENDING_CREATOR, // legacy alias
  pending_creator: CanonicalContentState.PENDING_CREATOR,
  handed_to_human: CanonicalContentState.PENDING_CREATOR,
  upload_failed: CanonicalContentState.PENDING_CREATOR, // retryable, still pending the asset
  // ── review ────────────────────────────────────────────────────────
  generated: CanonicalContentState.READY_FOR_REVIEW,
  media_uploaded: CanonicalContentState.READY_FOR_REVIEW,
  ready: CanonicalContentState.READY_FOR_REVIEW,
  approved: CanonicalContentState.READY_FOR_REVIEW,
  needs_review: CanonicalContentState.READY_FOR_REVIEW,
  ready_for_review: CanonicalContentState.READY_FOR_REVIEW,
  // ── ready to schedule ─────────────────────────────────────────────
  ready_for_schedule: CanonicalContentState.READY_FOR_SCHEDULE,
  render_ready: CanonicalContentState.READY_FOR_SCHEDULE,
  // ── scheduled ─────────────────────────────────────────────────────
  scheduled: CanonicalContentState.SCHEDULED,
  // ── published (terminal success) ──────────────────────────────────
  published: CanonicalContentState.PUBLISHED,
  finalized: CanonicalContentState.PUBLISHED,
  completed: CanonicalContentState.PUBLISHED,
  // ── failed (terminal failure) ─────────────────────────────────────
  failed: CanonicalContentState.FAILED,
  stale: CanonicalContentState.FAILED,
  render_failed: CanonicalContentState.FAILED,
  failed_render: CanonicalContentState.FAILED,
  failed_moderation_pre: CanonicalContentState.FAILED,
  failed_moderation_post: CanonicalContentState.FAILED,
  failed_provider_exhausted: CanonicalContentState.FAILED,
  failed_timeout: CanonicalContentState.FAILED,
  cancelled: CanonicalContentState.FAILED,
};

/** Map a single legacy/free-text status string → canonical (never throws). */
export function normalizeContentStatus(
  raw: string | null | undefined,
): CanonicalContentState {
  if (!raw) return CanonicalContentState.PLANNED;
  const k = String(raw).trim().toLowerCase();
  if (ALL_CANONICAL.has(k.toUpperCase())) {
    return k.toUpperCase() as CanonicalContentState;
  }
  return LEGACY_TO_CANONICAL[k] ?? CanonicalContentState.PLANNED;
}

/**
 * Backward-compat mapper canonical → a legacy `content_status` string.
 * The DB column is free-text with no CHECK (see creatorLifecycleStateMachine
 * header), so these values are safe to persist and keep existing readers
 * (that still match legacy strings) working.
 */
const CANONICAL_TO_LEGACY: Record<CanonicalContentState, string> = {
  [CanonicalContentState.PLANNED]: 'planned',
  [CanonicalContentState.AI_GENERATING]: 'generating',
  [CanonicalContentState.PENDING_CREATOR]: 'awaiting_media_upload',
  [CanonicalContentState.READY_FOR_REVIEW]: 'generated',
  [CanonicalContentState.READY_FOR_SCHEDULE]: 'ready_for_schedule',
  [CanonicalContentState.SCHEDULED]: 'scheduled',
  [CanonicalContentState.PUBLISHED]: 'published',
  [CanonicalContentState.FAILED]: 'failed',
};

export function toLegacyContentStatus(state: CanonicalContentState): string {
  return CANONICAL_TO_LEGACY[state] ?? 'planned';
}

/**
 * SINGLE SOURCE OF TRUTH resolver (item 2). Given a daily_content_plans
 * row, derive the one canonical state by precedence — strongest signal
 * wins, so the three overlapping notions can never disagree for readers:
 *
 *   1. publish proof   (published_at / status published)        → PUBLISHED
 *   2. scheduled        (scheduled_post_id present / SCHEDULED)  → SCHEDULED
 *   3. creator FSM      (content.creator_lifecycle_state)        → mapped
 *   4. content_status   (free-text column)                       → normalized
 *   5. default                                                   → PLANNED
 *
 * Pure function. Never throws. Accepts loose shapes so any caller
 * (API rows, calendar rows) can use it without a type dependency.
 */
export interface ResolvableRow {
  content_status?: string | null;
  scheduled_post_id?: string | null;
  published_at?: string | null;
  scheduled_post_status?: string | null; // joined scheduled_posts.status, if available
  content?: Record<string, unknown> | string | null;
}

function parseContent(c: ResolvableRow['content']): Record<string, unknown> | null {
  if (!c) return null;
  if (typeof c === 'object') return c as Record<string, unknown>;
  try {
    const p = JSON.parse(c);
    return p && typeof p === 'object' ? (p as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function resolveCanonicalState(row: ResolvableRow): CanonicalContentState {
  // 1. Publish proof is terminal-strongest.
  const sps = String(row.scheduled_post_status ?? '').trim().toLowerCase();
  if (row.published_at || sps === 'published') return CanonicalContentState.PUBLISHED;
  if (sps === 'failed') return CanonicalContentState.FAILED;

  // 2. Scheduled — a real scheduled_posts link OR an explicit scheduled status.
  if (row.scheduled_post_id) return CanonicalContentState.SCHEDULED;

  // 3. Creator FSM lifecycle state (authoritative for creator/attachment rows).
  const content = parseContent(row.content);
  const fsm = readLifecycleState(content) as CreatorLifecycleStateExt | null;
  if (fsm) {
    const mapped = LEGACY_TO_CANONICAL[fsm];
    if (mapped) return mapped;
  }

  // 4. Free-text content_status column (normalized + backward compatible).
  return normalizeContentStatus(row.content_status);
}

// ── Canonical transition validator (item 2) ──────────────────────────────
// Coarse-grained legality at canonical granularity. The fine-grained
// creator sub-state legality stays owned by creatorLifecycleStateMachine
// (no duplication). This guards API/calendar-driven canonical moves.

const CANONICAL_TRANSITIONS: Record<CanonicalContentState, ReadonlyArray<CanonicalContentState>> = {
  [CanonicalContentState.PLANNED]: [
    CanonicalContentState.AI_GENERATING,
    CanonicalContentState.PENDING_CREATOR,
    CanonicalContentState.READY_FOR_REVIEW,
    CanonicalContentState.FAILED,
  ],
  [CanonicalContentState.AI_GENERATING]: [
    CanonicalContentState.READY_FOR_REVIEW,
    CanonicalContentState.READY_FOR_SCHEDULE,
    CanonicalContentState.PENDING_CREATOR,
    CanonicalContentState.FAILED,
  ],
  [CanonicalContentState.PENDING_CREATOR]: [
    CanonicalContentState.READY_FOR_REVIEW,
    CanonicalContentState.READY_FOR_SCHEDULE,
    CanonicalContentState.PENDING_CREATOR, // re-upload / retry
    CanonicalContentState.FAILED,
  ],
  [CanonicalContentState.READY_FOR_REVIEW]: [
    CanonicalContentState.READY_FOR_SCHEDULE,
    CanonicalContentState.PENDING_CREATOR, // sent back / re-upload
    CanonicalContentState.FAILED,
  ],
  [CanonicalContentState.READY_FOR_SCHEDULE]: [
    CanonicalContentState.SCHEDULED,
    CanonicalContentState.PENDING_CREATOR, // replace media
    CanonicalContentState.FAILED,
  ],
  [CanonicalContentState.SCHEDULED]: [
    CanonicalContentState.PUBLISHED,
    CanonicalContentState.READY_FOR_SCHEDULE, // retime
    CanonicalContentState.PENDING_CREATOR, // replace media
    CanonicalContentState.FAILED, // publish-time failure
  ],
  [CanonicalContentState.PUBLISHED]: [], // terminal
  [CanonicalContentState.FAILED]: [
    CanonicalContentState.PLANNED, // explicit retry/regenerate
    CanonicalContentState.PENDING_CREATOR,
    CanonicalContentState.READY_FOR_SCHEDULE,
  ],
};

export function canTransitionCanonical(
  from: CanonicalContentState | null | undefined,
  to: CanonicalContentState,
): boolean {
  if (!from) return true; // initial entry
  if (from === to) return true; // idempotent re-write
  return CANONICAL_TRANSITIONS[from]?.includes(to) ?? false;
}

export class CanonicalTransitionError extends Error {
  readonly statusCode = 409;
  readonly code = 'CANONICAL_LIFECYCLE_TRANSITION_INVALID';
  readonly from: CanonicalContentState | null;
  readonly to: CanonicalContentState;
  constructor(from: CanonicalContentState | null, to: CanonicalContentState) {
    super(`Invalid canonical content transition: ${from ?? 'null'} → ${to}`);
    this.name = 'CanonicalTransitionError';
    this.from = from;
    this.to = to;
  }
}

export function assertCanonicalTransition(
  from: CanonicalContentState | null | undefined,
  to: CanonicalContentState,
): void {
  if (!canTransitionCanonical(from, to)) {
    throw new CanonicalTransitionError(from ?? null, to);
  }
}

/**
 * Badge view-model for UI consumption (no redesign, no new style system).
 *
 * Prefers the already-normalized canonical semantics carried on the raw
 * calendar event (`canonical_label` + `canonical_group`) and maps the
 * group onto an EXISTING execution-status style bucket so the current
 * badge classes/colors are reused verbatim. Falls back deterministically
 * to the legacy `[execution_status]` rendering when canonical fields are
 * absent (older payloads / other feeds) — never returns empty/null text,
 * never changes historical rendering.
 *
 * `styleKey` is fed straight into the existing
 * getExecutionStatusBadgeClasses/Background helpers.
 */
export function canonicalBadgeView(
  rawItem: Record<string, unknown> | null | undefined,
  legacyExecutionStatus: string | null | undefined,
): { text: string; styleKey: string; canonical: boolean } {
  const cl = rawItem && typeof rawItem === 'object' ? (rawItem as Record<string, unknown>).canonical_label : undefined;
  const cg = rawItem && typeof rawItem === 'object' ? (rawItem as Record<string, unknown>).canonical_group : undefined;
  if (typeof cl === 'string' && cl.trim() && typeof cg === 'string') {
    // canonical_group → existing ExecutionStatus style bucket (reuse only).
    const STYLE: Record<string, string> = {
      pending: 'PENDING',     // gray — Awaiting Video Upload
      ready: 'IN_PROGRESS',   // yellow — AI asset ready
      scheduled: 'SCHEDULED', // purple
      published: 'FINALIZED', // green
      failed: 'PENDING',      // no failed color in the design system; text stays distinct ("Failed")
      draft: 'PENDING',       // gray — planned / AI generating
    };
    return { text: cl.trim(), styleKey: STYLE[cg] ?? 'PENDING', canonical: true };
  }
  const legacy = String(legacyExecutionStatus ?? 'PENDING').trim() || 'PENDING';
  return { text: `[${legacy}]`, styleKey: legacy, canonical: false };
}

/**
 * Job-level badge view-model — semantic PARITY with the activity-level
 * `canonicalBadgeView` using only fields a job object actually carries
 * (`status: 'ready'|'blocked'`, legacy `execution_status`). No canonical
 * label exists per-job (no content_type/canonical signal there), so we
 * do NOT fabricate video/AI wording — we provide a consistent shared
 * code path + the one genuinely derivable improvement: an explicit
 * "Failed" text for `blocked` jobs (text-distinct, no new style).
 * Everything else falls back to the deterministic legacy rendering,
 * identical to activity-level fallback. Never empty/null.
 */
export function canonicalJobBadgeView(
  job: { status?: string | null; execution_status?: string | null } | null | undefined,
): { text: string; styleKey: string; canonical: boolean } {
  if (job && String(job.status ?? '').trim().toLowerCase() === 'blocked') {
    // No dedicated failed color in the design system → reuse neutral
    // bucket; distinction is the explicit text (mandatory per spec).
    return { text: 'Failed', styleKey: 'PENDING', canonical: true };
  }
  // Same fallback path as activity-level (no canonical fields on a job).
  return canonicalBadgeView(null, job?.execution_status);
}

/**
 * Single deterministic mapper: legacy `ExecutionStatus`
 * (PENDING|IN_PROGRESS|FINALIZED|SCHEDULED) → canonical badge group.
 * The ONE place that defines "is this scheduled/terminal" for counter
 * and stage logic, so execution_status-driven views and canonical views
 * can never drift. Legacy-safe: unknown/missing → 'draft' (never throws,
 * never inflates pending/blocked).
 */
export function executionStatusToCanonicalGroup(
  status: string | null | undefined,
): 'pending' | 'ready' | 'scheduled' | 'published' | 'failed' | 'draft' {
  switch (String(status ?? '').trim().toUpperCase()) {
    case 'SCHEDULED': return 'scheduled';
    case 'FINALIZED': return 'published';
    case 'IN_PROGRESS': return 'draft';
    case 'PENDING': return 'draft';
    default: return 'draft';
  }
}

/**
 * UI helpers: compact badge + human label per state.
 *
 * Semantic alignment:
 *  - `pending` group is RESERVED for genuine manual video-upload tasks
 *    (PENDING_CREATOR) — label normalized to video-upload wording (no
 *    generic "pending"/"creator pending"). The calendar API additionally
 *    gates this on a supported manual-video content type, so AI assets
 *    can never carry it.
 *  - AI-generated assets that are ready use the distinct `ready` group
 *    (NOT `pending`) so they are never counted/rendered as pending.
 *  - `failed` = real blocker only (failed validation/dependency/publish).
 */
export const CANONICAL_BADGE: Record<CanonicalContentState, { short: string; label: string; group: 'pending' | 'ready' | 'scheduled' | 'published' | 'failed' | 'draft' }> = {
  [CanonicalContentState.PLANNED]: { short: '·', label: 'Planned', group: 'draft' },
  [CanonicalContentState.AI_GENERATING]: { short: '…', label: 'AI Generating', group: 'draft' },
  [CanonicalContentState.PENDING_CREATOR]: { short: 'V', label: 'Awaiting Video Upload', group: 'pending' },
  [CanonicalContentState.READY_FOR_REVIEW]: { short: 'R', label: 'AI Asset — Ready for Review', group: 'ready' },
  [CanonicalContentState.READY_FOR_SCHEDULE]: { short: 'S', label: 'AI Asset — Ready to Schedule', group: 'ready' },
  [CanonicalContentState.SCHEDULED]: { short: '✓', label: 'Scheduled', group: 'scheduled' },
  [CanonicalContentState.PUBLISHED]: { short: '✓✓', label: 'Published', group: 'published' },
  [CanonicalContentState.FAILED]: { short: '!', label: 'Failed', group: 'failed' },
};
