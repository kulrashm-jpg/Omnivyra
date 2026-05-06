/**
 * useMessageActions — message-row side effects extracted from ConversationView.
 *
 * Phase 35-C-2 (Option B): all fetch + confirm/alert plumbing for
 * per-message actions lives here, so MessageItem can be a pure UI
 * component with onCancelQueued / onRetry / onMarkSelf / onLike /
 * onReply callbacks only.
 *
 * Behaviour preserved verbatim from the inline handlers in
 * ConversationView.tsx — no logic change. The window.confirm /
 * window.alert calls remain part of the action surface (they're how
 * the UI today asks for confirmation and surfaces errors).
 */

import { useCallback } from 'react';
import type { EngagementMessage } from '@/hooks/useEngagementMessages';

export interface UseMessageActionsParams {
  organizationId: string;
  onLike?: (messageId: string, platform: string) => void;
  /**
   * Consumer-side callback that owns the reply-target state. Typically
   * sets replyingTo + showSuggestions in the parent (ConversationView).
   */
  onReplyTo?: (message: EngagementMessage) => void;
  onRetryQueuedDelivery?: (actionId: string) => Promise<{ message?: string } | void>;
  onReplySent?: () => void;
}

export interface UseMessageActionsReturn {
  cancelQueued: (actionId: string) => Promise<void>;
  retryQueued: (actionId: string) => Promise<void>;
  markSelf: (messageId: string) => Promise<void>;
  like: (message: EngagementMessage) => void;
  replyTo: (message: EngagementMessage) => void;
}

export function useMessageActions(params: UseMessageActionsParams): UseMessageActionsReturn {
  const { organizationId, onLike, onReplyTo, onRetryQueuedDelivery, onReplySent } = params;

  const cancelQueued = useCallback(
    async (actionId: string) => {
      if (!actionId) return;
      if (typeof window !== 'undefined' && !window.confirm('Cancel this queued reply? You can rewrite and send a new one after.')) {
        return;
      }
      try {
        const res = await fetch('/api/engagement/cancel-queued', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            organization_id: organizationId,
            action_id: actionId,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          window.alert(body?.error ?? 'Failed to cancel queued reply');
          return;
        }
        onReplySent?.();
      } catch (e) {
        window.alert((e as Error)?.message ?? 'Failed to cancel queued reply');
      }
    },
    [organizationId, onReplySent]
  );

  const retryQueued = useCallback(
    async (actionId: string) => {
      if (!actionId || !onRetryQueuedDelivery) return;
      try {
        const result = await onRetryQueuedDelivery(actionId);
        if (result && 'message' in result && result.message) {
          window.alert(result.message);
        }
      } catch (e) {
        window.alert((e as Error)?.message ?? 'Failed to retry queued delivery');
      }
    },
    [onRetryQueuedDelivery]
  );

  const markSelf = useCallback(
    async (messageId: string) => {
      if (typeof window !== 'undefined' && !window.confirm('Mark this message as sent by you? It will drop from "Needs Response".')) {
        return;
      }
      try {
        const res = await fetch('/api/engagement/message/mark-self', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            organization_id: organizationId,
            message_id: messageId,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          window.alert(body?.error ?? 'Failed to mark message as sent by you');
          return;
        }
        onReplySent?.();
      } catch (e) {
        window.alert((e as Error)?.message ?? 'Failed to mark message');
      }
    },
    [organizationId, onReplySent]
  );

  const like = useCallback(
    (message: EngagementMessage) => {
      if (!onLike) return;
      onLike(message.id, message.platform ?? '');
    },
    [onLike]
  );

  const replyTo = useCallback(
    (message: EngagementMessage) => {
      onReplyTo?.(message);
    },
    [onReplyTo]
  );

  return { cancelQueued, retryQueued, markSelf, like, replyTo };
}
