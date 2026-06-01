/**
 * Engagement thread activity events — collaboration timeline (Batch 2).
 *
 * Append-only log of who did what on an engagement thread (assigned /
 * unassigned / replied / resolved / ignored). Reads power the per-thread
 * activity timeline in the Command Center. Insert errors are surfaced to
 * callers so collaboration persistence failures are observable.
 *
 * thread_id is always the engagement_threads.id (uuid).
 */

import { supabase } from '../db/supabaseClient';

export type ThreadEventType =
  | 'assigned'
  | 'unassigned'
  | 'replied'
  | 'resolved'
  | 'ignored'
  | 'unignored';

export async function recordThreadEvent(params: {
  organizationId: string;
  threadId: string | null | undefined;
  actorUserId: string | null | undefined;
  eventType: ThreadEventType;
  detail?: Record<string, unknown>;
}): Promise<void> {
  const { organizationId, threadId, actorUserId, eventType, detail } = params;
  if (!organizationId || !threadId) return;
  const { error } = await supabase.from('engagement_thread_events').insert({
    organization_id: organizationId,
    thread_id: threadId,
    actor_user_id: actorUserId ?? null,
    event_type: eventType,
    detail: detail ?? {},
  });
  if (error) {
    throw new Error(`engagement_thread_event_insert_failed:${error.message}`);
  }
}

/** Convenience: record the same event for many threads (bulk actions). */
export async function recordThreadEvents(params: {
  organizationId: string;
  threadIds: string[];
  actorUserId: string | null | undefined;
  eventType: ThreadEventType;
  detail?: Record<string, unknown>;
}): Promise<void> {
  const { organizationId, threadIds, actorUserId, eventType, detail } = params;
  if (!organizationId || !Array.isArray(threadIds) || threadIds.length === 0) return;
  const rows = threadIds.map((threadId) => ({
    organization_id: organizationId,
    thread_id: threadId,
    actor_user_id: actorUserId ?? null,
    event_type: eventType,
    detail: detail ?? {},
  }));
  const { error } = await supabase.from('engagement_thread_events').insert(rows);
  if (error) {
    throw new Error(`engagement_thread_event_bulk_insert_failed:${error.message}`);
  }
}
