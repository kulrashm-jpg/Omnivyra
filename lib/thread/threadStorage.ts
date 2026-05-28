import type { ThreadGenerationPayload, ThreadSessionPayload } from './threadFlow';

export type ThreadPublishLink = {
  scheduledPostId: string;
  platform: string;
  updatedAt?: string;
};

export type ThreadContinuationReplyDraft = {
  threadId: string;
  text: string;
  createdAt: string;
};

function hasStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
}

export function createThreadSessionToken(): string {
  return `thread_session_${Date.now()}`;
}

export function createThreadReplyDraftToken(): string {
  return `thread_continue_reply_${Date.now()}`;
}

export function getThreadResultKey(sessionToken: string): string {
  return `thread_result_${sessionToken}`;
}

export function getThreadPublishKey(sessionToken: string): string {
  return `thread_publish_${sessionToken}`;
}

export function readThreadStorage<T>(key: string): T | null {
  if (!hasStorage() || !key) return null;
  const raw = sessionStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    sessionStorage.removeItem(key);
    return null;
  }
}

export function writeThreadStorage(key: string, value: unknown): void {
  if (!hasStorage() || !key) return;
  sessionStorage.setItem(key, JSON.stringify(value));
}

export function removeThreadStorage(key: string): void {
  if (!hasStorage() || !key) return;
  sessionStorage.removeItem(key);
}

export function loadThreadSession(sessionToken: string): ThreadSessionPayload | null {
  return readThreadStorage<ThreadSessionPayload>(sessionToken);
}

export function saveThreadSession(sessionToken: string, payload: ThreadSessionPayload): void {
  writeThreadStorage(sessionToken, payload);
}

export function loadThreadResult(sessionToken: string): ThreadGenerationPayload | null {
  return readThreadStorage<ThreadGenerationPayload>(getThreadResultKey(sessionToken));
}

export function saveThreadResult(sessionToken: string, payload: ThreadGenerationPayload): void {
  writeThreadStorage(getThreadResultKey(sessionToken), payload);
}

export function loadThreadPublishLink(sessionToken: string): ThreadPublishLink | null {
  return readThreadStorage<ThreadPublishLink>(getThreadPublishKey(sessionToken));
}

export function saveThreadPublishLink(sessionToken: string, payload: ThreadPublishLink): void {
  writeThreadStorage(getThreadPublishKey(sessionToken), payload);
}

export function clearThreadPublishLink(sessionToken: string): void {
  removeThreadStorage(getThreadPublishKey(sessionToken));
}

/**
 * G2 — per-node thread attachment assignments.
 *
 * Maps each node position (0-indexed) → array of CreatorAttachment IDs that
 * the user has distributed to that node from the thread-level attached assets
 * list. Stored separately from session/result so:
 *   - old sessions hydrate unchanged (loadThreadNodeAttachments returns null)
 *   - the thread-level attached assets remain the single source of truth for
 *     attachment data (this map only stores ID pointers, not full assets)
 *   - removing an attachment at the thread level doesn't require touching
 *     this map — render-time resolution simply skips IDs that no longer
 *     correspond to a thread-level asset
 */
export type ThreadNodeAttachmentMap = Record<number, string[]>;

export function getThreadNodeAttachmentsKey(sessionToken: string): string {
  return `thread_node_attachments_${sessionToken}`;
}

export function loadThreadNodeAttachments(sessionToken: string): ThreadNodeAttachmentMap | null {
  if (!sessionToken) return null;
  return readThreadStorage<ThreadNodeAttachmentMap>(getThreadNodeAttachmentsKey(sessionToken));
}

export function saveThreadNodeAttachments(sessionToken: string, map: ThreadNodeAttachmentMap): void {
  if (!sessionToken) return;
  writeThreadStorage(getThreadNodeAttachmentsKey(sessionToken), map);
}

