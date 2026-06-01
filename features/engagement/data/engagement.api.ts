type BulkIgnoreArgs = {
  organizationId: string;
  threadIds: string[];
};

type LikeMessageArgs = {
  organizationId: string;
  messageId: string;
  platform: string;
};

export function bulkIgnoreEngagementThreads(args: BulkIgnoreArgs): Promise<Response> {
  return fetch('/api/engagement/thread/bulk-ignore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      organization_id: args.organizationId,
      thread_ids: args.threadIds,
    }),
  });
}

export function likeEngagementMessage(args: LikeMessageArgs): Promise<Response> {
  return fetch('/api/engagement/like', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      organization_id: args.organizationId,
      message_id: args.messageId,
      platform: args.platform,
    }),
  });
}

// ---------------------------------------------------------------------------
// Collaboration layer (Batch 2): assignment, reply soft-lock, activity timeline.
// All attribution is server-derived from the session; the client only chooses
// the assignee for assignment.
// ---------------------------------------------------------------------------

export type CompanyMember = {
  user_id: string;
  name?: string | null;
  email?: string | null;
  role?: string | null;
  status?: string | null;
};

export type ThreadEvent = {
  id: string;
  event_type: string;
  actor_user_id: string | null;
  actor_name: string | null;
  assignee_user_id: string | null;
  assignee_name: string | null;
  created_at: string;
};

export async function fetchCompanyMembers(organizationId: string): Promise<CompanyMember[]> {
  const res = await fetch(`/api/company/users?companyId=${encodeURIComponent(organizationId)}`, {
    credentials: 'include',
  });
  if (!res.ok) return [];
  const body = await res.json().catch(() => ({}));
  return Array.isArray(body?.users) ? (body.users as CompanyMember[]) : [];
}

export function assignEngagementThread(args: {
  organizationId: string;
  threadId: string;
  assigneeUserId: string | null;
}): Promise<Response> {
  return fetch('/api/engagement/thread/assign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      organization_id: args.organizationId,
      thread_id: args.threadId,
      assignee_user_id: args.assigneeUserId,
    }),
  });
}

export async function fetchThreadEvents(args: {
  organizationId: string;
  threadId: string;
}): Promise<ThreadEvent[]> {
  const params = new URLSearchParams({
    organization_id: args.organizationId,
    thread_id: args.threadId,
  });
  const res = await fetch(`/api/engagement/thread/events?${params.toString()}`, {
    credentials: 'include',
  });
  if (!res.ok) return [];
  const body = await res.json().catch(() => ({}));
  return Array.isArray(body?.events) ? (body.events as ThreadEvent[]) : [];
}

export type ReplyLockState = {
  locked: boolean;
  held_by: string | null;
  expires_at?: string | null;
};

export async function reqReplyLock(args: {
  organizationId: string;
  threadId: string;
  action: 'acquire' | 'release' | 'heartbeat';
  force?: boolean;
}): Promise<ReplyLockState | null> {
  try {
    const res = await fetch('/api/engagement/thread/reply-lock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        organization_id: args.organizationId,
        thread_id: args.threadId,
        action: args.action,
        force: args.force ?? false,
      }),
    });
    if (!res.ok) return null;
    const body = await res.json().catch(() => ({}));
    return {
      locked: Boolean(body?.locked),
      held_by: body?.held_by ?? null,
      expires_at: body?.expires_at ?? null,
    };
  } catch {
    return null;
  }
}
