/**
 * PHASE STATUS-OVERLAY-PARITY — single display-layer status-overlay authority.
 *
 * The audit proved the underlying authority model is correct: `scheduled_posts.status`
 * is authoritative, `daily_content_plans.content_status` is the derived creator-FSM
 * mirror, and `resolveCanonicalState` (lib/shared/contentLifecycle.ts) already merges
 * them into a canonical group/label that Dashboard + Calendar consume.
 *
 * The ONLY display divergences were: (1) Dashboard applies an "overdue" overlay that
 * the Campaign Calendar dropped, and (2) the workspace read the raw column instead of
 * the canonical resolver. This module is the ONE place that owns:
 *   - the overdue determination (ported verbatim from the Dashboard rule), and
 *   - the canonical-group → display-group mapping (with the overdue overlay applied).
 *
 * Presentation only: reads already-resolved status signals; never writes status,
 * never schedules, never touches the FSM. Pure + testable (inject `nowMs`).
 */

export type OverlayGroup =
  | 'overdue'
  | 'published'
  | 'scheduled'
  | 'ready'
  | 'pending'
  | 'failed'
  | 'draft';

export interface OverdueInput {
  /** scheduled_posts.status (published rows are never overdue). */
  status?: string | null;
  /** Activity date (YYYY-MM-DD or ISO). */
  date?: string | null;
  /** scheduled_for ISO timestamp. */
  scheduledFor?: string | null;
  /** Server-computed fallback flag (activity-events.is_overdue). */
  isOverdue?: boolean | null;
  /** Injectable clock for tests; defaults to Date.now(). */
  nowMs?: number;
}

/** Local YYYY-MM-DD key (mirrors the Dashboard `formatDateKey` semantics). */
function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Verbatim port of the Dashboard `isCalendarEventOverdue` rule so every surface
 * agrees on what "overdue" means. Published rows are never overdue.
 */
export function isActivityOverdue(input: OverdueInput): boolean {
  const status = String(input.status ?? '').trim().toLowerCase();
  if (status === 'published') return false;

  const nowMs = input.nowMs ?? Date.now();
  const todayKey = dateKey(new Date(nowMs));
  const eventDateKey = String(input.date ?? '').slice(0, 10);
  if (eventDateKey) {
    if (eventDateKey < todayKey) return true;
    if (eventDateKey > todayKey) return false;
  }

  if (input.scheduledFor) {
    const at = new Date(input.scheduledFor);
    if (Number.isFinite(at.getTime())) return at.getTime() < nowMs;
  }

  return Boolean(input.isOverdue);
}

export interface OverlayInput {
  /** Canonical group from resolveCanonicalState → CANONICAL_BADGE.group. */
  canonicalGroup?: string | null;
  /** Raw scheduled_posts.status fallback (when canonicalGroup is absent). */
  status?: string | null;
  /** Result of isActivityOverdue — the caller decides the clock. */
  overdue: boolean;
}

/**
 * Map the canonical group (+ overdue overlay) to ONE display group, applied
 * identically by Dashboard, Calendar, and Workspace. Precedence:
 *   published (terminal, never overdue) → failed → overdue overlay → scheduled
 *   → ready → pending → draft.
 */
export function resolveOverlayGroup(input: OverlayInput): OverlayGroup {
  const g = String(input.canonicalGroup ?? '').trim().toLowerCase();
  const s = String(input.status ?? '').trim().toLowerCase();

  if (g === 'published' || s === 'published' || s === 'publishing') return 'published';
  if (g === 'failed' || s === 'failed') return 'failed';
  if (input.overdue) return 'overdue';
  if (g === 'scheduled' || s === 'scheduled') return 'scheduled';
  if (g === 'ready') return 'ready';
  if (g === 'pending') return 'pending';
  if (g === 'draft' || s === 'draft' || s === 'pending') return 'draft';
  return 'scheduled';
}

/** Human label for a display group (single vocabulary across surfaces). */
export const OVERLAY_GROUP_LABELS: Record<OverlayGroup, string> = {
  overdue: 'Overdue',
  published: 'Published',
  scheduled: 'Scheduled',
  ready: 'Ready',
  pending: 'Pending upload',
  failed: 'Failed',
  draft: 'Draft',
};
