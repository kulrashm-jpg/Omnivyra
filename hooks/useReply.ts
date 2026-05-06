/**
 * useReply — orchestration of /api/engagement/reply dispatches.
 *
 * Phase 35-B extraction of handleExecuteReply + handleRetryQueuedDelivery
 * from InboxDashboard.tsx. The orchestrator no longer owns this logic;
 * it now passes its dependencies into this hook and consumes the
 * resulting callbacks.
 *
 * IMPORTANT: state ownership did NOT move. replyText / aiDraftId /
 * sending / error live in the components that own the textarea (today
 * that's ReplyComposer). This hook only owns the dispatch flow:
 *   - branch on api vs browser-mode
 *   - handle queued/extension polling
 *   - cancel unclaimed actions on failure
 *   - call back into refresh hooks
 *
 * NO LOGIC CHANGE from the original implementation; only mechanical
 * lift into an injectable hook so the orchestrator stays small.
 */

import { useCallback } from 'react';
import { isDmMessageType } from '@/lib/engagement/messageRoles';
import { resolveEngagementCapability } from '@/lib/engagementCapabilities';
import {
  cancelUnclaimedQueuedAction,
  waitForBrowserActionTerminalStatus,
} from '@/components/engagement/inbox/helpers';
import type {
  EngagementActionStatus,
  ExtensionCommandPollResult,
} from '@/components/engagement/inbox/helpers';

export interface ExecuteReplyArgs {
  threadId: string;
  messageId: string;
  platform: string;
  replyText: string;
  messageType?: string | null;
}

export interface ExecuteReplyResult {
  mode: string;
  platform: string;
  message: string;
}

export interface UseReplyDeps {
  organizationId: string;
  getBrowserPlatformState: (platform: string) => { browserEnabled?: boolean } | null | undefined;
  hideThreadAfterResponse: (threadId: string) => void;
  bootstrapExtensionAuth: () => Promise<void>;
  pollExtensionCommandsNow: () => Promise<unknown>;
  refresh: () => unknown;
  refreshMessages: () => unknown;
  refreshCounts: () => unknown;
  refreshWorkQueue: () => unknown;
}

export function useReply(deps: UseReplyDeps) {
  const {
    organizationId,
    getBrowserPlatformState,
    hideThreadAfterResponse,
    bootstrapExtensionAuth,
    pollExtensionCommandsNow,
    refresh,
    refreshMessages,
    refreshCounts,
    refreshWorkQueue,
  } = deps;

  const executeReply = useCallback(
    async ({
      threadId,
      messageId,
      platform,
      replyText,
      messageType,
    }: ExecuteReplyArgs): Promise<ExecuteReplyResult> => {
      // DMs and comment-replies route through the same /api/engagement/reply
      // endpoint, but the capability key differs: 'dm' vs 'reply'. The
      // server picks the action_type from message_type itself; this client
      // check is just a fast-fail so we don't POST when the platform is
      // unsupported for the action.
      const isDm = isDmMessageType(messageType);
      const capabilityAction = isDm ? 'dm' : 'reply';
      const capability = resolveEngagementCapability(platform, capabilityAction);
      if (capability.status !== 'api_verified') {
        throw new Error(
          capability.reason ?? `${isDm ? 'DM' : 'Reply'} is not supported on ${platform}.`
        );
      }

      const niceLabel = platform === 'twitter' ? 'X' : platform.charAt(0).toUpperCase() + platform.slice(1);
      const browserPlatformState = getBrowserPlatformState(platform);

      const res = await fetch('/api/engagement/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          organization_id: organizationId,
          thread_id: threadId,
          message_id: messageId,
          reply_text: replyText,
          platform,
        }),
      });

      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        status?: string;
        mode?: string;
        confirmed?: boolean;
        platform_id?: string | null;
        success?: boolean;
        message?: string;
        action_id?: string | null;
      };
      if (!res.ok && res.status !== 202) {
        throw new Error(json.error || res.statusText || 'Failed to send reply');
      }
      // Server contract: 'executed' = platform confirmed; 'queued' = handed
      // off to the Chrome extension for browser-mode delivery (DMs).
      // Anything else is a failure.
      const isQueued = json.status === 'queued' || json.mode === 'browser';
      if (json.success !== true || (json.status !== 'executed' && !isQueued)) {
        throw new Error(json.error || 'Platform did not confirm the reply was sent');
      }

      if (isQueued) {
        if (browserPlatformState?.browserEnabled === false) {
          await cancelUnclaimedQueuedAction(organizationId, json.action_id);
          await Promise.allSettled([refreshMessages(), refresh(), refreshCounts(), refreshWorkQueue()]);
          return {
            mode: 'browser_failed',
            platform,
            message: `${isDm ? 'DM' : 'Reply'} was queued, but browser delivery is disabled for ${niceLabel}.`,
          };
        }

        try {
          await bootstrapExtensionAuth();
          const firstPoll = await pollExtensionCommandsNow() as ExtensionCommandPollResult;
          await new Promise((resolve) => window.setTimeout(resolve, 1800));
          const secondPoll = await pollExtensionCommandsNow() as ExtensionCommandPollResult;
          const actionStatus: EngagementActionStatus | null = json.action_id
            ? await waitForBrowserActionTerminalStatus(organizationId, json.action_id)
            : null;
          await Promise.allSettled([refreshMessages(), refresh(), refreshCounts(), refreshWorkQueue()]);
          if (actionStatus?.status === 'executed' && actionStatus.confirmed) {
            hideThreadAfterResponse(threadId);
            return {
              mode: 'browser_dispatched',
              platform,
              message: `${isDm ? 'DM' : 'Reply'} confirmed on ${niceLabel}.`,
            };
          }
          if (actionStatus?.status === 'failed' || actionStatus?.status === 'blocked' || actionStatus?.status === 'skipped') {
            return {
              mode: 'browser_failed',
              platform,
              message: `${isDm ? 'DM' : 'Reply'} was not delivered on ${niceLabel}: ${actionStatus.error || actionStatus.status}.`,
            };
          }
          if (actionStatus?.status === 'sent_unverified') {
            return {
              mode: 'browser_unverified',
              platform,
              message: `${isDm ? 'DM' : 'Reply'} ran in the ${niceLabel} tab, but ${niceLabel} did not confirm delivery.`,
            };
          }
          const commandCount = Math.max(Number(firstPoll?.commandCount ?? 0), Number(secondPoll?.commandCount ?? 0));
          const dispatchedCount = Math.max(Number(firstPoll?.dispatchedCount ?? 0), Number(secondPoll?.dispatchedCount ?? 0));
          const claimedByExtension =
            Boolean(actionStatus?.claimed || actionStatus?.dispatch_lease_id)
            && actionStatus?.lease_expired !== true;
          if (!claimedByExtension && dispatchedCount === 0) {
            await cancelUnclaimedQueuedAction(organizationId, json.action_id);
            await Promise.allSettled([refreshMessages(), refresh(), refreshCounts(), refreshWorkQueue()]);
          }
          if (claimedByExtension) {
            return {
              mode: 'browser_pending',
              platform,
              message: `${isDm ? 'DM' : 'Reply'} was claimed by Omnivyra and is still waiting for ${niceLabel} to report delivery. Keep ${niceLabel} Messaging open and refresh in a moment.`,
            };
          }
          return {
            mode: 'browser_failed',
            platform,
            message:
              commandCount > 0 && dispatchedCount === 0
                ? `Omnivyra found the queued ${isDm ? 'DM' : 'reply'}, but no ${niceLabel} tab accepted it. Open the ${niceLabel} Messaging thread and try Send again.`
                : `${isDm ? 'DM' : 'Reply'} was queued, but the Omnivyra extension did not claim it. Keep ${niceLabel} Messaging open and try Send again.`,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unable to wake the Omnivyra extension';
          await cancelUnclaimedQueuedAction(organizationId, json.action_id);
          await Promise.allSettled([refreshMessages(), refresh(), refreshCounts(), refreshWorkQueue()]);
          return {
            mode: 'browser_failed',
            platform,
            message: `${isDm ? 'DM' : 'Reply'} was queued, but delivery could not start: ${message}`,
          };
        }
      }
      hideThreadAfterResponse(threadId);
      await Promise.allSettled([refreshMessages(), refresh(), refreshCounts(), refreshWorkQueue()]);
      const message =
        json.confirmed && json.platform_id
          ? `Reply confirmed by ${niceLabel} (id: ${json.platform_id}).`
          : `Reply sent to ${niceLabel}. Awaiting platform confirmation.`;
      return {
        mode: json.confirmed ? 'api_confirmed' : 'api_sent',
        platform,
        message,
      };
    },
    [
      bootstrapExtensionAuth,
      getBrowserPlatformState,
      hideThreadAfterResponse,
      organizationId,
      pollExtensionCommandsNow,
      refresh,
      refreshCounts,
      refreshMessages,
      refreshWorkQueue,
    ]
  );

  const retryQueuedDelivery = useCallback(
    async (actionId: string): Promise<{ message: string }> => {
      await bootstrapExtensionAuth();
      const pollResult = await pollExtensionCommandsNow() as ExtensionCommandPollResult;
      await new Promise((resolve) => window.setTimeout(resolve, 1800));
      const actionStatus: EngagementActionStatus | null = await waitForBrowserActionTerminalStatus(organizationId, actionId);
      await Promise.allSettled([refreshMessages(), refresh(), refreshCounts(), refreshWorkQueue()]);

      if (actionStatus?.status === 'executed' && actionStatus.confirmed) {
        return { message: 'Queued reply delivered and confirmed on LinkedIn.' };
      }
      if (actionStatus?.status === 'failed' || actionStatus?.status === 'blocked' || actionStatus?.status === 'skipped') {
        return { message: `Queued reply was not delivered: ${actionStatus.error || actionStatus.status}.` };
      }
      if (actionStatus?.status === 'sent_unverified') {
        return { message: 'The extension ran the reply, but LinkedIn did not confirm delivery.' };
      }
      if ((actionStatus?.claimed || actionStatus?.dispatch_lease_id) && actionStatus?.lease_expired !== true) {
        return {
          message: 'The extension claimed this queued reply and is still waiting for LinkedIn to report delivery. Keep LinkedIn Messaging open and refresh in a moment.',
        };
      }

      const commandCount = Number(pollResult?.commandCount ?? 0);
      const dispatchedCount = Number(pollResult?.dispatchedCount ?? 0);
      if (pollResult?.success === false || pollResult?.error) {
        return { message: `Extension poll failed: ${pollResult.error || pollResult.message || 'unknown error'}.` };
      }
      if (commandCount > 0 && dispatchedCount === 0) {
        return {
          message: 'Omnivyra found the queued command, but no LinkedIn tab accepted it. Refresh the LinkedIn Messaging tab and try Retry delivery again.',
        };
      }
      if (commandCount === 0) {
        return {
          message: 'The extension poll completed, but it did not receive any queued commands from the backend.',
        };
      }
      return {
        message: 'Delivery was triggered and is still in progress. Wait a moment, then refresh the LinkedIn thread.',
      };
    },
    [bootstrapExtensionAuth, organizationId, pollExtensionCommandsNow, refresh, refreshCounts, refreshMessages, refreshWorkQueue]
  );

  return { executeReply, retryQueuedDelivery };
}
