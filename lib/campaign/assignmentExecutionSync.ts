/**
 * Strategic Mix P5 — Execution Lifecycle Synchronization (the reducer).
 *
 * The execution engine is the canonical execution authority; assignments are
 * the canonical planning entity. This module folds EXISTING execution events
 * (derived from the engine's own records — scheduled_posts, plan rows,
 * campaign completion; never a second tracker) onto the assignment list:
 *
 *   materialized → scheduled → publishing → published → archived
 *
 * Guarantees:
 *  - deterministic: events are sorted (occurred_at, then a fixed type rank)
 *    before folding, so any arrival order converges to the same state
 *  - idempotent: replaying the same events is a no-op (object identity is
 *    preserved for untouched assignments)
 *  - forward-only: transitions ride advanceAssignmentStatus — out-of-order
 *    or repeated events can never regress a state
 *  - failure is separate: publish_failed sets `execution_failure` and never
 *    destroys lifecycle; a later publish_completed clears it
 *  - ownership: ONLY execution-owned fields are written (status via advance,
 *    scheduled_post_id, execution_failure, execution_synced_at). Planning
 *    fields (asset, placement, notes, ordering) are never touched.
 */

import {
  advanceAssignmentStatus,
  type AssignmentStatus,
  type CampaignAssignment,
} from './campaignAssignments';

export type ExecutionEventType =
  | 'scheduled_post_created'
  | 'scheduling_completed'
  | 'publish_started'
  | 'publish_completed'
  | 'publish_failed'
  | 'archive_completed';

export interface ExecutionEvent {
  type: ExecutionEventType;
  /** The EXISTING execution identifier (daily_content_plans.execution_id) —
   *  the same id assignments store as structure_id. */
  execution_id: string;
  /** The EXISTING scheduled post identifier, when the event carries one. */
  scheduled_post_id?: string | null;
  campaign_id?: string | null;
  occurred_at?: string | null;
  error_message?: string | null;
  error_code?: string | null;
}

/** Target lifecycle state per event. publish_failed maps to NO state — the
 *  failure is represented separately, lifecycle is preserved. */
const EVENT_TARGET: Record<ExecutionEventType, AssignmentStatus | null> = {
  scheduled_post_created: 'scheduled',
  scheduling_completed: 'scheduled',
  publish_started: 'publishing',
  publish_completed: 'published',
  publish_failed: null,
  archive_completed: 'archived',
};

/** Fixed per-type rank — the deterministic tiebreak when timestamps are
 *  missing or equal (mirrors the real pipeline order). */
const EVENT_RANK: Record<ExecutionEventType, number> = {
  scheduled_post_created: 1,
  scheduling_completed: 1,
  publish_started: 2,
  publish_failed: 3,
  publish_completed: 4,
  archive_completed: 5,
};

function sortEvents(events: ExecutionEvent[]): ExecutionEvent[] {
  return [...events].sort((a, b) => {
    const ta = a.occurred_at ?? '';
    const tb = b.occurred_at ?? '';
    if (ta !== tb) return ta < tb ? -1 : 1;
    return EVENT_RANK[a.type] - EVENT_RANK[b.type];
  });
}

export interface ExecutionSyncResult {
  assignments: CampaignAssignment[];
  /** Ids whose execution state actually changed (empty on pure replays). */
  changed_ids: string[];
}

/**
 * Fold execution events onto the assignment list. Pure; input never mutated.
 * Events match assignments by execution id (structure_id) first, then by an
 * already-synced scheduled_post_id (recovery when a plan re-derives slots).
 */
export function applyExecutionEvents(
  assignments: CampaignAssignment[],
  events: ExecutionEvent[],
  ctx?: { now?: string },
): ExecutionSyncResult {
  if (!Array.isArray(events) || events.length === 0) {
    return { assignments, changed_ids: [] };
  }
  const ordered = sortEvents(events);
  const now = ctx?.now ?? new Date().toISOString();
  const changed = new Set<string>();

  const next = assignments.map((assignment) => {
    const mine = ordered.filter(
      (e) =>
        e.execution_id === assignment.structure_id ||
        (assignment.scheduled_post_id != null && e.scheduled_post_id === assignment.scheduled_post_id),
    );
    if (mine.length === 0) return assignment;

    // Fold in deterministic order: status target, post id, failure state.
    let target: AssignmentStatus | null = null;
    let targetRank = -1;
    let scheduledPostId = assignment.scheduled_post_id ?? null;
    let failure = assignment.execution_failure ?? null;

    for (const event of mine) {
      const eventTarget = EVENT_TARGET[event.type];
      if (eventTarget) {
        const rank = EVENT_RANK[event.type];
        if (rank > targetRank) {
          target = eventTarget;
          targetRank = rank;
        }
      }
      if (event.scheduled_post_id) scheduledPostId = event.scheduled_post_id;
      if (event.type === 'publish_failed') {
        failure = {
          message: event.error_message ?? null,
          code: event.error_code ?? null,
          occurred_at: event.occurred_at ?? null,
          scheduled_post_id: event.scheduled_post_id ?? null,
        };
      } else if (event.type === 'publish_completed' || event.type === 'archive_completed') {
        // A later success supersedes the failure (retry landed). The sort
        // above makes "later" deterministic even without timestamps.
        failure = null;
      }
    }

    // Compute the synced copy; preserve object identity when nothing changed
    // (idempotent replay — repeated events are safe by construction).
    let out = assignment;
    if (target) {
      const advanced = advanceAssignmentStatus([out], out.id, target, { now })[0];
      if (advanced.status !== out.status) out = advanced;
    }
    const failureChanged = JSON.stringify(failure ?? null) !== JSON.stringify(assignment.execution_failure ?? null);
    const postIdChanged = (scheduledPostId ?? null) !== (assignment.scheduled_post_id ?? null);
    if (failureChanged || postIdChanged || out !== assignment) {
      out = {
        ...out,
        ...(scheduledPostId != null ? { scheduled_post_id: scheduledPostId } : {}),
        ...(failure != null ? { execution_failure: failure } : {}),
        execution_synced_at: now,
        updated_at: now,
      };
      if (failure == null && assignment.execution_failure != null) {
        // clearing must remove the field explicitly
        out = { ...out, execution_failure: null };
      }
      changed.add(assignment.id);
      return out;
    }
    return assignment;
  });

  return changed.size === 0
    ? { assignments, changed_ids: [] }
    : { assignments: next, changed_ids: Array.from(changed) };
}

/* ── Event derivation from EXISTING execution records ──────────────────────
 * The engine's canonical records (scheduled_posts + daily_content_plans +
 * campaign completion) are the durable result of the execution events this
 * phase consumes. Deriving the event list from them means assignment state
 * is ALWAYS re-derivable — no duplicate lifecycle tracking, no polling, no
 * timers; the derivation runs when a user opens the workspace. Pure so the
 * API route stays a thin tenant-guarded reader. */

export interface ExecutionPlanRowFact {
  execution_id: string | null;
  scheduled_post_id: string | null;
  content_status: string | null;
}

export interface ScheduledPostFact {
  id: string;
  status: string | null;
  error_message: string | null;
  error_code: string | null;
  published_at: string | null;
}

export function deriveExecutionEvents(params: {
  campaignId: string;
  planRows: ExecutionPlanRowFact[];
  posts: ScheduledPostFact[];
  campaignCompleted: boolean;
}): ExecutionEvent[] {
  const { campaignId, planRows, posts, campaignCompleted } = params;
  const postById = new Map(posts.map((p) => [p.id, p]));
  const events: ExecutionEvent[] = [];

  for (const row of planRows) {
    const executionId = typeof row.execution_id === 'string' && row.execution_id.trim() ? row.execution_id : null;
    if (!executionId) continue;
    const post = row.scheduled_post_id ? postById.get(row.scheduled_post_id) : undefined;
    const status = (post?.status ?? '').toLowerCase();

    if (post) {
      // A post reference exists — the POST's status is authoritative, even
      // over a stale plan-row status. Cancelled/draft/blocked → no events.
      if (!status || status === 'cancelled' || status === 'draft' || status === 'blocked') continue;
      events.push({ type: 'scheduled_post_created', execution_id: executionId, scheduled_post_id: post.id, campaign_id: campaignId });
      if (status === 'publishing') {
        events.push({ type: 'publish_started', execution_id: executionId, scheduled_post_id: post.id, campaign_id: campaignId });
      } else if (status === 'published') {
        events.push({ type: 'publish_completed', execution_id: executionId, scheduled_post_id: post.id, campaign_id: campaignId, occurred_at: post.published_at ?? null });
        if (campaignCompleted) {
          events.push({ type: 'archive_completed', execution_id: executionId, scheduled_post_id: post.id, campaign_id: campaignId });
        }
      } else if (status === 'failed') {
        events.push({
          type: 'publish_failed', execution_id: executionId, scheduled_post_id: post.id, campaign_id: campaignId,
          error_message: post.error_message ?? null, error_code: post.error_code ?? null,
        });
      }
    } else if ((row.content_status ?? '').toLowerCase() === 'scheduled') {
      // Row-level scheduling completed even if the post row is unreadable.
      events.push({ type: 'scheduling_completed', execution_id: executionId, scheduled_post_id: row.scheduled_post_id ?? null, campaign_id: campaignId });
    }
  }
  return events;
}
