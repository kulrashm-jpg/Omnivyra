/**
 * ThreadView — conversation history + action bar (Reply, Like, Ignore).
 * Composes ConversationView. ResponsePatternManager temporarily disabled.
 */

import React from 'react';
import { ConversationView } from './ConversationView';
import type { EngagementMessage } from '@/hooks/useEngagementMessages';
import type { InboxThread } from '@/hooks/useEngagementInbox';

export interface ThreadViewProps {
  thread: InboxThread | null;
  messages: EngagementMessage[];
  loading?: boolean;
  organizationId: string;
  onRefresh?: () => void;
  onReplySent?: () => void;
  onLike?: (messageId: string, platform: string) => void;
  onIgnore?: (threadId: string) => void;
  onMarkResolved?: () => void;
  className?: string;
}

export const ThreadView = React.memo(function ThreadView({
  thread,
  messages,
  loading = false,
  organizationId,
  onRefresh,
  onReplySent,
  onLike,
  onIgnore,
  onMarkResolved,
  className = '',
}: ThreadViewProps) {
  return (
    <ConversationView
      thread={thread}
      messages={messages}
      loading={loading}
      organizationId={organizationId}
      onRefresh={onRefresh}
      onReplySent={onReplySent}
      onLike={onLike}
      onIgnore={onIgnore}
      onMarkResolved={onMarkResolved}
      className={className}
    />
  );
});
