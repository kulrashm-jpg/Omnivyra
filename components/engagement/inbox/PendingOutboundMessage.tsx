/**
 * PendingOutboundMessage — pure UI for a queued outbound DM that the
 * Chrome extension hasn't delivered yet.
 *
 * Phase 35-D-1 extraction from MessageItem. Renders the dimmed
 * self-message bubble with claimed/active status badges and Cancel /
 * Retry delivery buttons. NO fetch, NO state, NO mutation — actions
 * are callback props injected by the consumer (typically MessageItem
 * → useMessageActions).
 */

import React from 'react';
import type { EngagementMessage } from '@/hooks/useEngagementMessages';

export interface PendingOutboundMessageProps {
  message: EngagementMessage;
  showRetryQueued?: boolean;
  onCancelQueued?: (actionId: string) => void;
  onRetry?: (actionId: string) => void;
}

export const PendingOutboundMessage = React.memo(function PendingOutboundMessage({
  message: msg,
  showRetryQueued = true,
  onCancelQueued,
  onRetry,
}: PendingOutboundMessageProps) {
  const claimedAndActive =
    msg.pending_action_claimed === true && msg.pending_action_lease_expired !== true;
  const statusLabel = claimedAndActive
    ? 'Handed to LinkedIn - awaiting delivery'
    : 'Queued - not yet delivered';
  const statusDetail = claimedAndActive
    ? 'Omnivyra has handed this to the LinkedIn tab. Waiting for LinkedIn to report the send result.'
    : 'Will be sent when the LinkedIn tab is open and the Omnivyra extension claims the action.';

  return (
    <div key={msg.id} className="my-2 ml-auto max-w-[80%]">
      <div
        className={`rounded-2xl border px-3 py-2 ${
          claimedAndActive ? 'border-blue-200 bg-blue-50' : 'border-amber-200 bg-amber-50'
        }`}
      >
        <div
          className={`flex items-center gap-2 text-[11px] uppercase tracking-wide ${
            claimedAndActive ? 'text-blue-800' : 'text-amber-800'
          }`}
        >
          <span>{statusLabel}</span>
        </div>
        <p className="mt-1 text-sm text-slate-800 whitespace-pre-wrap">{msg.content || '(empty)'}</p>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
          <span>{statusDetail}</span>
          {showRetryQueued && msg.pending_action_id && onRetry && !claimedAndActive && (
            <button
              type="button"
              onClick={() => onRetry(msg.pending_action_id as string)}
              className="font-medium text-blue-700 hover:text-blue-900 underline-offset-2 hover:underline"
            >
              Retry delivery
            </button>
          )}
          {!claimedAndActive && onCancelQueued && (
            <button
              type="button"
              onClick={() => msg.pending_action_id && onCancelQueued(msg.pending_action_id)}
              className="font-medium text-amber-900 hover:text-amber-700 underline-offset-2 hover:underline"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
});
