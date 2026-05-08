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
  return fetch('/api/engagement/ignore', {
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
