/**
 * MessageItem — router that picks the right message component and
 * handles recursion for nested replies.
 *
 * Phase 35-D-1: split from a single 231-line component into a thin
 * router. Render branches live in dedicated files; this file just
 * picks one and threads children recursively.
 */

import React from 'react';
import type { EngagementMessage } from '@/hooks/useEngagementMessages';
import { PendingOutboundMessage } from './PendingOutboundMessage';
import { StandardMessage } from './StandardMessage';

export interface MessageItemProps {
  message: EngagementMessage & { children?: EngagementMessage[] };
  depth?: number;
  threadAuthor?: string | null;
  showRetryQueued?: boolean;

  onCancelQueued?: (actionId: string) => void;
  onRetry?: (actionId: string) => void;
  onMarkSelf?: (messageId: string) => void;
  onLike?: (message: EngagementMessage) => void;
  onReply?: (message: EngagementMessage) => void;
}

export const MessageItem = React.memo(function MessageItem(props: MessageItemProps) {
  const { message: msg, depth = 0, threadAuthor = null, showRetryQueued = true } = props;

  if (msg.is_pending_outbound) {
    return (
      <PendingOutboundMessage
        message={msg}
        showRetryQueued={showRetryQueued}
        onCancelQueued={props.onCancelQueued}
        onRetry={props.onRetry}
      />
    );
  }

  return (
    <StandardMessage
      message={msg}
      depth={depth}
      threadAuthor={threadAuthor}
      onMarkSelf={props.onMarkSelf}
      onLike={props.onLike}
      onReply={props.onReply}
    >
      {(msg.children ?? []).map((child) => (
        <MessageItem
          key={child.id}
          message={child as EngagementMessage & { children?: EngagementMessage[] }}
          depth={depth + 1}
          threadAuthor={threadAuthor}
          showRetryQueued={showRetryQueued}
          onCancelQueued={props.onCancelQueued}
          onRetry={props.onRetry}
          onMarkSelf={props.onMarkSelf}
          onLike={props.onLike}
          onReply={props.onReply}
        />
      ))}
    </StandardMessage>
  );
});
