import { isDmMessageType } from './messageRoles';

export const ACTIONABLE_INBOX_LOOKBACK_DAYS = 60;
export const ACTIONABLE_INBOX_LOOKBACK_MS =
  ACTIONABLE_INBOX_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
export const NEEDS_RESPONSE_VISIBLE_LIMIT = 10;

export type EngagementQueueThread = {
  latest_message_type?: string | null;
  latest_message_direction?: string | null;
  latest_message_author_self?: boolean | null;
  latest_message_time?: string | null;
  has_completed_outbound_action?: boolean | null;
  /**
   * Legacy field name kept for API compatibility. The value now means
   * "a confirmed outbound action covers the latest message", not pending.
   */
  has_pending_outbound_action?: boolean | null;
  unread_count?: number | null;
  priority_score?: number | null;
  triage_priority?: number | null;
};

function parseTimeMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export function latestMessageFromSelf(thread: EngagementQueueThread): boolean {
  return thread.latest_message_direction === 'outgoing'
    || thread.latest_message_author_self === true;
}

export function hasConfirmedOutboundAction(thread: EngagementQueueThread): boolean {
  return thread.has_completed_outbound_action === true
    || thread.has_pending_outbound_action === true;
}

export function isWithinActionableWindow(
  thread: EngagementQueueThread,
  nowMs = Date.now(),
): boolean {
  const ts = parseTimeMs(thread.latest_message_time);
  if (ts === null) return true;
  return ts >= nowMs - ACTIONABLE_INBOX_LOOKBACK_MS;
}

export function isNeedsResponseThread(
  thread: EngagementQueueThread,
  nowMs = Date.now(),
): boolean {
  return isDmMessageType(thread.latest_message_type)
    && !latestMessageFromSelf(thread)
    && !hasConfirmedOutboundAction(thread)
    && isWithinActionableWindow(thread, nowMs);
}

export function isPeopleReactionThread(
  thread: EngagementQueueThread,
  nowMs = Date.now(),
): boolean {
  return thread.latest_message_type === 'comment'
    && !latestMessageFromSelf(thread)
    && !hasConfirmedOutboundAction(thread)
    && isWithinActionableWindow(thread, nowMs);
}

function compareThreadsForAction<T extends EngagementQueueThread>(a: T, b: T): number {
  const recencyA = parseTimeMs(a.latest_message_time) ?? 0;
  const recencyB = parseTimeMs(b.latest_message_time) ?? 0;
  if (recencyB !== recencyA) return recencyB - recencyA;

  const unreadA = (a.unread_count ?? 0) > 0 ? 1 : 0;
  const unreadB = (b.unread_count ?? 0) > 0 ? 1 : 0;
  if (unreadB !== unreadA) return unreadB - unreadA;

  const urgencyA = a.triage_priority ?? a.priority_score ?? 0;
  const urgencyB = b.triage_priority ?? b.priority_score ?? 0;
  return urgencyB - urgencyA;
}

export function sortThreadsForAction<T extends EngagementQueueThread>(items: T[]): T[] {
  return [...items].sort(compareThreadsForAction);
}

export function selectNeedsResponseThreads<T extends EngagementQueueThread>(
  items: T[],
  nowMs = Date.now(),
): T[] {
  return sortThreadsForAction(items.filter((thread) => isNeedsResponseThread(thread, nowMs)));
}

export function selectPeopleReactionThreads<T extends EngagementQueueThread>(
  items: T[],
  nowMs = Date.now(),
): T[] {
  return sortThreadsForAction(items.filter((thread) => isPeopleReactionThread(thread, nowMs)));
}
