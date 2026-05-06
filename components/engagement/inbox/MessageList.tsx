/**
 * MessageList — renders the message tree using MessageItem.
 *
 * Phase 35-C-2 extraction. Pure presentational; the consumer
 * (ConversationView) supplies the action callbacks via useMessageActions.
 */

import React from 'react';
import type { EngagementMessage } from '@/hooks/useEngagementMessages';
import { MessageItem } from './MessageItem';

export interface MessageListProps {
  messages: Array<EngagementMessage & { children?: EngagementMessage[] }>;
  threadAuthor?: string | null;
  showRetryQueued?: boolean;

  onCancelQueued?: (actionId: string) => void;
  onRetry?: (actionId: string) => void;
  onMarkSelf?: (messageId: string) => void;
  onLike?: (message: EngagementMessage) => void;
  onReply?: (message: EngagementMessage) => void;
}

export const MessageList = React.memo(function MessageList({
  messages,
  threadAuthor = null,
  showRetryQueued = true,
  onCancelQueued,
  onRetry,
  onMarkSelf,
  onLike,
  onReply,
}: MessageListProps) {
  return (
    <>
      {messages.map((msg) => (
        <MessageItem
          key={msg.id}
          message={msg}
          depth={0}
          threadAuthor={threadAuthor}
          showRetryQueued={showRetryQueued}
          onCancelQueued={onCancelQueued}
          onRetry={onRetry}
          onMarkSelf={onMarkSelf}
          onLike={onLike}
          onReply={onReply}
        />
      ))}
    </>
  );
});
