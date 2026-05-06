/**
 * useInboxOrchestrator — Phase 35-D-6.
 *
 * Final orchestration collapse. Owns the engagement-inbox business
 * logic that was previously inline in InboxDashboard:
 *
 *   - runPlatformSyncAndRefresh + handleRefresh (the sync workflow
 *     that hits the per-platform extension/server sync paths and
 *     drives platformSyncTrust state transitions)
 *   - recommendation lifecycle (TTL, fade window, seed-driven refresh,
 *     read-cleared dismissal — 3 useEffects + their state)
 *   - thread selection / persistence (URL <-> selectedThread sync,
 *     queue-change persistence, handleSelectThread family,
 *     handleSelectPlatform, handleIgnore, handleMarkResolved,
 *     hideThreadAfterResponse, handleReplySent)
 *   - keyboard shortcuts (j/k navigation, r focus reply, e toggle AI
 *     drawer, l like latest)
 *   - empty-state DERIVATION (booleans + conversationEmptyState data;
 *     queueEmptyState JSX stays in the component because the rule is
 *     "no JSX moves into hooks")
 *
 * Selection STATE (selectedThread, selectedPlatform, mobileTab, etc.)
 * stays in InboxDashboard because it must be declared before
 * useEngagementMessages — and the orchestrator's keyboard effect
 * consumes `messages`, so the orchestrator runs AFTER messages exists.
 * The orchestrator borrows the setters as deps; ownership stays with
 * the component.
 *
 * After this hook, InboxDashboard is composition root: it wires hooks
 * together and emits JSX. It is not a state manager, not an effect
 * owner, not a handler container.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MutableRefObject,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { NextRouter } from 'next/router';
import { trackEngagementEvent } from '@/lib/engagementTelemetry';
import { EVENTS } from '@/analytics/events';
import { bulkIgnoreEngagementThreads } from '@/features/engagement/data/engagement.api';
import {
  PLATFORM_SYNC_SETTLE_DELAYS_MS,
  BACKGROUND_PLATFORM_SYNC_INTERVAL_MS,
  EXTENSION_SYNC_PLATFORM_SET,
  SERVER_SYNC_PLATFORM_SET,
  requestServerPlatformSync,
  readServerPlatformSyncStatus,
  type ServerPlatformSyncStart,
  type PlatformSyncTrustState,
} from '@/components/engagement/inbox/helpers';
import { getRecommendedThread } from '@/components/engagement/threadQueueModel';
import type { InboxThread } from '@/hooks/useEngagementInbox';

// =====================================================================
// Constants — verbatim from InboxDashboard
// =====================================================================

const RECOMMENDATION_TTL_MS = 12 * 60 * 1000;
const RECOMMENDATION_FADE_WINDOW_MS = 2 * 60 * 1000;

// =====================================================================
// Deps interface
// =====================================================================

export interface UseInboxOrchestratorDeps {
  organizationId: string;
  router: NextRouter;

  // From useEngagementInbox
  items: InboxThread[];
  error: string | null;
  loading: boolean;
  refresh: () => unknown;
  patchThread: (threadId: string, mutator: (thread: InboxThread) => InboxThread) => void;

  // From useEngagementMessages — keyboard shortcuts need messages
  messages: Array<{
    id: string;
    platform?: string | null;
    platform_created_at?: string | null;
    created_at?: string | null;
  }>;
  refreshMessages: () => unknown;

  // Sibling data hooks
  refreshCounts: () => unknown;
  refreshWorkQueue: () => unknown;

  // From useBrowserAssistData — runPlatformSyncAndRefresh body uses these
  pollExtensionCommandsNow: () => Promise<unknown>;
  triggerPlatformSync: (platform: string) => Promise<unknown> | unknown;
  refreshLinkedInOverview: () => Promise<unknown> | unknown;

  // From useBrowserAssistState — runPlatformSyncAndRefresh + handleRefresh mutate these
  setBrowserAssistError: (value: string | null) => void;
  platformSyncTrust: PlatformSyncTrustState;
  setPlatformSyncTrust: Dispatch<SetStateAction<PlatformSyncTrustState>>;
  attemptedExtensionAuthRef: MutableRefObject<string | null>;
  lastPlatformSyncAtRef: MutableRefObject<number>;

  // Component state (kept outside orchestrator due to execution-order)
  selectedPlatform: string;
  setSelectedPlatform: Dispatch<SetStateAction<string>>;
  selectedThread: InboxThread | null;
  setSelectedThread: Dispatch<SetStateAction<InboxThread | null>>;
  setMobileTab: Dispatch<SetStateAction<'threads' | 'conversation' | 'assistant'>>;
  setAiDrawerOpen: Dispatch<SetStateAction<boolean>>;
  authorFilter: { authorName: string; platform: string } | null;
  threadIdFromUrl: string | null;

  // Derived in component
  filteredItems: InboxThread[];
  visibleQueueItems: InboxThread[];
  actionableThreads: number;
  syncableBrowserPlatforms: string[];
  getBrowserActionPlatform: (platform: string) => string;

  // Engagement actions defined in component (handleLike kept there to
  // avoid scope creep — it's not in the user's listed extraction set)
  handleLike: (messageId: string, platform: string) => void;
}

// =====================================================================
// Hook
// =====================================================================

export function useInboxOrchestrator(deps: UseInboxOrchestratorDeps) {
  const {
    organizationId,
    router,
    items,
    error,
    loading,
    refresh,
    patchThread,
    messages,
    refreshMessages,
    refreshCounts,
    refreshWorkQueue,
    pollExtensionCommandsNow,
    triggerPlatformSync,
    refreshLinkedInOverview,
    setBrowserAssistError,
    platformSyncTrust,
    setPlatformSyncTrust,
    attemptedExtensionAuthRef,
    lastPlatformSyncAtRef,
    selectedPlatform,
    setSelectedPlatform,
    selectedThread,
    setSelectedThread,
    setMobileTab,
    setAiDrawerOpen,
    authorFilter,
    threadIdFromUrl,
    filteredItems,
    visibleQueueItems,
    actionableThreads,
    syncableBrowserPlatforms,
    getBrowserActionPlatform,
    handleLike,
  } = deps;

  // ── Recommendation state ──
  const [recommendedThreadId, setRecommendedThreadId] = useState<string | null>(null);
  const [recommendationSetAt, setRecommendationSetAt] = useState<number | null>(null);
  const [recommendationIsFading, setRecommendationIsFading] = useState(false);
  const [recommendationSeed, setRecommendationSeed] = useState(0);

  // ── Route helper ──
  const replaceEngagementRoute = useCallback(
    (query?: Record<string, string>) => {
      const params = new URLSearchParams();
      if (query) {
        for (const [key, value] of Object.entries(query)) {
          if (value) {
            params.set(key, value);
          }
        }
      }

      const nextAsPath = params.toString() ? `/engagement?${params.toString()}` : '/engagement';
      if (router.asPath === nextAsPath) {
        return;
      }

      void router.replace(
        {
          pathname: '/engagement',
          query,
        },
        undefined,
        { shallow: true }
      );
    },
    [router]
  );

  // ── Recommendation memos ──
  const recommendedThreadInScope = useMemo(
    () => filteredItems.find((thread) => thread.thread_id === recommendedThreadId) ?? null,
    [filteredItems, recommendedThreadId]
  );
  const recommendedThread = useMemo(
    () => visibleQueueItems.find((thread) => thread.thread_id === recommendedThreadId) ?? null,
    [visibleQueueItems, recommendedThreadId]
  );

  // ── URL → thread sync ──
  useEffect(() => {
    if (!threadIdFromUrl) return;
    const match = visibleQueueItems.find((t) => t.thread_id === threadIdFromUrl);
    if (match) {
      setSelectedThread(match);
      return;
    }

    if (loading && visibleQueueItems.length === 0) return;
    const nextThread = visibleQueueItems[0] ?? null;
    if (selectedThread?.thread_id !== nextThread?.thread_id) {
      setSelectedThread(nextThread);
    }
    replaceEngagementRoute(nextThread ? { thread: nextThread.thread_id } : undefined);
  }, [threadIdFromUrl, visibleQueueItems, replaceEngagementRoute, selectedThread?.thread_id, loading]);

  // ── Queue persistence: keep selectedThread valid as queue changes ──
  useEffect(() => {
    if (!selectedThread) return;
    const stillVisible = visibleQueueItems.find((t) => t.thread_id === selectedThread.thread_id);
    if (stillVisible) {
      if (selectedThread !== stillVisible) setSelectedThread(stillVisible);
      return;
    }

    const nextThread = visibleQueueItems[0] ?? null;
    setSelectedThread(nextThread);
    replaceEngagementRoute(nextThread ? { thread: nextThread.thread_id } : undefined);
  }, [selectedThread, visibleQueueItems, replaceEngagementRoute]);

  // ── Thread selection handlers ──
  const handleSelectThread = useCallback(
    (thread: InboxThread) => {
      setSelectedThread(thread);
      replaceEngagementRoute({ thread: thread.thread_id });
      // Refresh on click. The inbox row carries last-known stats from the
      // most recent scrape; clicking is the user's signal that they want
      // current numbers. Cheap: hits the inbox API which is just a DB read.
      // For post threads the banner re-renders with whatever the last
      // scrape persisted; future improvement is to also kick a re-scrape
      // through the extension here.
      refresh();
    void trackEngagementEvent(EVENTS.ENGAGEMENT_THREAD_OPENED, {
        organization_id: organizationId,
        thread_id: thread.thread_id,
        metadata: {
          platform: thread.platform,
          classification_category: thread.classification_category ?? undefined,
          sentiment: thread.sentiment ?? undefined,
          lead_detected: thread.lead_detected ?? undefined,
        },
      });
      if (thread.lead_detected) {
    void trackEngagementEvent(EVENTS.ENGAGEMENT_LEAD_DETECTED, {
          organization_id: organizationId,
          thread_id: thread.thread_id,
          metadata: {
            platform: thread.platform,
            classification_category: thread.classification_category ?? undefined,
          },
        });
      }
    },
    [organizationId, replaceEngagementRoute, refresh]
  );

  const handleSelectThreadById = useCallback(
    (threadId: string) => {
      const thread = visibleQueueItems.find((entry) => entry.thread_id === threadId);
      if (thread) {
        handleSelectThread(thread);
        setMobileTab('conversation');
      }
    },
    [visibleQueueItems, handleSelectThread]
  );

  const handleSelectPlatform = useCallback(
    (platform: string) => {
      setSelectedThread(null);
      setSelectedPlatform(platform);
      replaceEngagementRoute();
    },
    [replaceEngagementRoute]
  );

  // ── runPlatformSyncAndRefresh ──
  const runPlatformSyncAndRefresh = useCallback(
    async (platforms: string[]) => {
      const uniquePlatforms = Array.from(new Set(platforms)).filter((platform) =>
        EXTENSION_SYNC_PLATFORM_SET.has(platform)
      );
      if (uniquePlatforms.length === 0) return;

      setPlatformSyncTrust((current) => ({
        status: 'syncing',
        lastSyncedAt: current.lastSyncedAt,
        message: 'Checking latest platform messages...',
      }));

      const serverSyncPlatforms = organizationId
        ? uniquePlatforms.filter((platform) => SERVER_SYNC_PLATFORM_SET.has(platform))
        : [];
      const directSyncPlatforms = uniquePlatforms.filter((platform) => !SERVER_SYNC_PLATFORM_SET.has(platform));
      const confirmedPlatforms = new Set<string>();
      const failedPlatforms = new Set<string>();
      const pendingServerPlatforms = new Set<string>();
      let serverSync: ServerPlatformSyncStart | null = null;

      if (serverSyncPlatforms.length > 0 && organizationId) {
        try {
          serverSync = await requestServerPlatformSync(organizationId, serverSyncPlatforms);
          for (const platform of serverSyncPlatforms) pendingServerPlatforms.add(platform);
          void pollExtensionCommandsNow().catch((pollError) => {
            console.warn('[engagement] extension command wakeup failed:', pollError);
          });
          void Promise.allSettled(serverSyncPlatforms.map((platform) => triggerPlatformSync(platform))).then((results) => {
            if (results.some((result) => result.status === 'rejected')) {
              console.warn('[engagement] direct platform sync wakeup did not confirm for every server-queued platform');
            }
          });
        } catch (syncError) {
          console.warn('[engagement] server platform sync queue failed:', syncError);
          for (const platform of serverSyncPlatforms) failedPlatforms.add(platform);
        }
      }

      if (directSyncPlatforms.length > 0) {
        const results = await Promise.allSettled(directSyncPlatforms.map((platform) => triggerPlatformSync(platform)));
        directSyncPlatforms.forEach((platform, index) => {
          if (results[index]?.status === 'fulfilled') confirmedPlatforms.add(platform);
          else failedPlatforms.add(platform);
        });
      }

      const refreshAll = () => {
        void refresh();
        void refreshCounts();
        void refreshWorkQueue();
        void refreshLinkedInOverview();
      };

      if (serverSync && serverSyncPlatforms.length > 0 && organizationId) {
        const actionIds = serverSync.commands.map((command) => command.id).filter(Boolean);
        for (const delay of PLATFORM_SYNC_SETTLE_DELAYS_MS) {
          await new Promise((resolve) => window.setTimeout(resolve, delay));
          refreshAll();

          try {
            const status = await readServerPlatformSyncStatus({
              organizationId,
              platforms: serverSyncPlatforms,
              requestedAt: serverSync.requested_at,
              actionIds,
            });
            for (const platform of serverSyncPlatforms) {
              const platformStatus = status.platforms?.[platform];
              if (platformStatus?.fresh) {
                confirmedPlatforms.add(platform);
                pendingServerPlatforms.delete(platform);
              } else if (platformStatus?.failed_action) {
                failedPlatforms.add(platform);
                pendingServerPlatforms.delete(platform);
              }
            }
            if (serverSyncPlatforms.every((platform) => confirmedPlatforms.has(platform))) break;
          } catch (statusError) {
            console.warn('[engagement] server platform sync status failed:', statusError);
          }
        }
      } else {
        for (const delay of PLATFORM_SYNC_SETTLE_DELAYS_MS) {
          await new Promise((resolve) => window.setTimeout(resolve, delay));
          refreshAll();
        }
      }

      if (confirmedPlatforms.size === 0 && pendingServerPlatforms.size === 0) {
        setPlatformSyncTrust({
          status: 'failed',
          lastSyncedAt: null,
          message: `Latest inbox check could not be started for ${uniquePlatforms.join(', ')}.`,
        });
        return;
      }

      const syncedAt = Date.now();
      lastPlatformSyncAtRef.current = syncedAt;
      const unconfirmedServerPlatforms = serverSyncPlatforms.filter((platform) => !confirmedPlatforms.has(platform));
      if (unconfirmedServerPlatforms.length > 0) {
        const failedServerPlatforms = unconfirmedServerPlatforms.filter((platform) => failedPlatforms.has(platform));
        setPlatformSyncTrust({
          status: failedServerPlatforms.length > 0 ? 'failed' : 'syncing',
          lastSyncedAt: null,
          message:
            failedServerPlatforms.length > 0
              ? `Still checking ${failedServerPlatforms.join(', ')} messages. Keep the platform inbox open, then use Check latest messages to retry now.`
              : `Inbox refresh requested for ${unconfirmedServerPlatforms.join(', ')}. The queue will update as soon as the browser extension sends the latest messages.`,
        });
        return;
      }

      const successfulPlatforms = Array.from(confirmedPlatforms);
      const failedPlatformList = Array.from(failedPlatforms);
      setPlatformSyncTrust({
        status: failedPlatformList.length > 0 || pendingServerPlatforms.size > 0 ? 'warning' : 'fresh',
        lastSyncedAt: syncedAt,
        message:
          failedPlatformList.length > 0 || pendingServerPlatforms.size > 0
            ? `Fresh sync confirmed for ${successfulPlatforms.join(', ')}. Still checking ${[
                ...Array.from(pendingServerPlatforms),
                ...failedPlatformList,
              ].join(', ')}.`
            : `Fresh sync confirmed for ${successfulPlatforms.join(', ')}.`,
      });
    },
    [
      organizationId,
      pollExtensionCommandsNow,
      refresh,
      refreshCounts,
      refreshLinkedInOverview,
      refreshWorkQueue,
      triggerPlatformSync,
    ]
  );

  const handleRefresh = useCallback(async () => {
    setBrowserAssistError(null);
    void refresh();
    void refreshCounts();
    void refreshWorkQueue();
    void refreshLinkedInOverview();
    setRecommendationSeed((current) => current + 1);
    // Clear the per-attempt auth lockout. The auto-auth useEffect (which
    // is declared later in the file but registered before user clicks)
    // will see the cleared ref on the next render — triggered by the
    // state changes above — and re-attempt the redemption. We don't call
    // bootstrapExtensionAuth() directly here because it's declared below
    // and JS TDZ would reject it from inside this useCallback.
    attemptedExtensionAuthRef.current = null;

    const platformsToSync =
      selectedPlatform && selectedPlatform !== 'all'
        ? syncableBrowserPlatforms.filter((platform) => platform === getBrowserActionPlatform(selectedPlatform))
        : syncableBrowserPlatforms;

    if (platformsToSync.length > 0) {
      await runPlatformSyncAndRefresh(platformsToSync);
    }
  }, [
    getBrowserActionPlatform,
    refresh,
    refreshCounts,
    refreshLinkedInOverview,
    refreshWorkQueue,
    runPlatformSyncAndRefresh,
    selectedPlatform,
    syncableBrowserPlatforms,
  ]);

  // ── Recommendation lifecycle effects ──
  useEffect(() => {
    const nextRecommended = getRecommendedThread(visibleQueueItems);
    setRecommendedThreadId(nextRecommended?.thread_id ?? null);
    setRecommendationSetAt(nextRecommended ? Date.now() : null);
    setRecommendationIsFading(false);
  }, [recommendationSeed, visibleQueueItems]);

  useEffect(() => {
    if (!recommendedThreadId || recommendationSetAt == null) {
      setRecommendationIsFading(false);
      return;
    }

    const age = Date.now() - recommendationSetAt;
    if (age >= RECOMMENDATION_TTL_MS) {
      setRecommendedThreadId(null);
      setRecommendationSetAt(null);
      setRecommendationIsFading(false);
      return;
    }

    const fadeDelay = Math.max(RECOMMENDATION_TTL_MS - RECOMMENDATION_FADE_WINDOW_MS - age, 0);
    const expiryDelay = Math.max(RECOMMENDATION_TTL_MS - age, 0);

    if (age >= RECOMMENDATION_TTL_MS - RECOMMENDATION_FADE_WINDOW_MS) {
      setRecommendationIsFading(true);
    }

    const fadeTimer = window.setTimeout(() => {
      setRecommendationIsFading(true);
    }, fadeDelay);
    const expiryTimer = window.setTimeout(() => {
      setRecommendedThreadId(null);
      setRecommendationSetAt(null);
      setRecommendationIsFading(false);
    }, expiryDelay);

    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(expiryTimer);
    };
  }, [recommendedThreadId, recommendationSetAt]);

  useEffect(() => {
    if (!recommendedThreadInScope || recommendedThreadId == null) return;

    // The thread leaving the upstream gate (otherPartyRepliedLast)
    // already drops it out of recommendedThreadInScope, so the only
    // remaining "stop highlighting" signal here is the unread badge
    // having cleared. Was previously double-checked via
    // getThreadQueueGroup() === 'Needs Response', now redundant since
    // every dmThread is in that single bucket.
    const isMarkedRead = (recommendedThreadInScope.unread_count ?? 0) <= 0;
    if (!isMarkedRead) return;

    setRecommendedThreadId(null);
    setRecommendationSetAt(null);
    setRecommendationIsFading(false);
  }, [recommendedThreadId, recommendedThreadInScope]);

  // ── Resolution / response handlers ──
  const handleMarkResolved = useCallback(() => {
    if (organizationId && selectedThread) {
    void trackEngagementEvent(EVENTS.ENGAGEMENT_OPPORTUNITY_RESOLVED, {
        organization_id: organizationId,
        thread_id: selectedThread.thread_id,
        metadata: {
          platform: selectedThread.platform,
          classification_category: selectedThread.classification_category ?? undefined,
        },
      });
    }
    refresh();
    refreshCounts();
    refreshWorkQueue();
    refreshMessages();
    setRecommendationSeed((current) => current + 1);
  }, [organizationId, selectedThread, refresh, refreshCounts, refreshWorkQueue, refreshMessages]);

  const hideThreadAfterResponse = useCallback((threadId: string) => {
    patchThread(threadId, (thread) => ({
      ...thread,
      has_completed_outbound_action: true,
      has_pending_outbound_action: true,
      latest_message_direction: 'outgoing',
      latest_message_author_self: true,
      unread_count: 0,
    }));

    if (selectedThread?.thread_id === threadId) {
      const nextThread = visibleQueueItems.find((thread) => thread.thread_id !== threadId) ?? null;
      setSelectedThread(nextThread);
      replaceEngagementRoute(nextThread ? { thread: nextThread.thread_id } : undefined);
    }
  }, [patchThread, replaceEngagementRoute, selectedThread?.thread_id, visibleQueueItems]);

  const handleReplySent = useCallback(() => {
    if (selectedThread) {
      hideThreadAfterResponse(selectedThread.thread_id);
    }
    refresh();
    refreshCounts();
    refreshWorkQueue();
    refreshMessages();
  }, [hideThreadAfterResponse, refresh, refreshCounts, refreshWorkQueue, refreshMessages, selectedThread]);

  // ── Empty state derivation (booleans + conversation copy; queueEmptyState JSX stays in component) ──
  const hasAnyThreads = filteredItems.length > 0;
  const hasActionRequired = actionableThreads > 0;
  const hasBlockingError = Boolean(error);
  const requiresFreshPlatformSync = syncableBrowserPlatforms.length > 0;
  const platformSyncFreshEnough =
    !requiresFreshPlatformSync
    || (
      platformSyncTrust.status === 'fresh'
      && platformSyncTrust.lastSyncedAt !== null
      && Date.now() - platformSyncTrust.lastSyncedAt < BACKGROUND_PLATFORM_SYNC_INTERVAL_MS
    );
  const showSyncUnverifiedState =
    !loading
    && !hasBlockingError
    && !authorFilter
    && !hasActionRequired
    && !platformSyncFreshEnough;
  const showNoActivityState = !loading && !hasBlockingError && !authorFilter && !showSyncUnverifiedState && !hasAnyThreads;
  const showAllCaughtUpState = !loading && !hasBlockingError && !authorFilter && !showSyncUnverifiedState && hasAnyThreads && !hasActionRequired;

  const conversationEmptyState = useMemo(() => {
    if (hasBlockingError) {
      return {
        title: "We're having trouble loading your conversations.",
        description: 'Retry the workspace to pull the latest engagement threads.',
      };
    }
    if (showNoActivityState) {
      return {
        title: 'No conversations yet',
        description: "Once people reply to your posts or messages, they'll appear here.",
      };
    }
    if (showSyncUnverifiedState) {
      return {
        title: 'Checking latest messages',
        description:
          platformSyncTrust.message
          || 'Omnivyra is refreshing the browser inbox before showing the queue.',
      };
    }
    if (showAllCaughtUpState) {
      return {
        title: 'All caught up 🎉',
        description: "You're up to date. We'll surface new conversations here.",
      };
    }
    return {
      title: 'Select a conversation to start',
      description: 'Choose a thread from the queue to review context and respond.',
    };
  }, [
    hasBlockingError,
    platformSyncTrust.message,
    platformSyncTrust.status,
    showAllCaughtUpState,
    showNoActivityState,
    showSyncUnverifiedState,
  ]);

  // ── Ignore handler ──
  const handleIgnore = useCallback(
    async (threadId: string) => {
      if (!organizationId) return;
      const threadToDrop =
        selectedThread?.thread_id === threadId
          ? selectedThread
          : items.find((thread) => thread.thread_id === threadId) ?? null;
      const threadIds = Array.from(
        new Set([
          threadId,
          ...((threadToDrop?.sibling_thread_ids ?? []).filter(Boolean)),
        ])
      );
      if (
        typeof window !== 'undefined'
        && !window.confirm('Drop this conversation from Omnivyra? It will no longer appear in Needs Response.')
      ) {
        return;
      }
      try {
        const res = await bulkIgnoreEngagementThreads({
          organizationId,
          threadIds,
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || res.statusText);
        setSelectedThread(null);
        replaceEngagementRoute();
        refresh();
        refreshCounts();
        refreshWorkQueue();
        setRecommendationSeed((current) => current + 1);
      } catch (err) {
        console.error('[engagement] ignore failed:', err);
        if (typeof window !== 'undefined') {
          window.alert(err instanceof Error ? err.message : 'Failed to drop conversation');
        }
      }
    },
    [items, organizationId, refresh, refreshCounts, refreshWorkQueue, replaceEngagementRoute, selectedThread]
  );

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;

      const key = e.key.toLowerCase();
      switch (key) {
        case 'j': {
          const idx = selectedThread
            ? visibleQueueItems.findIndex((t) => t.thread_id === selectedThread.thread_id)
            : -1;
          const next = idx < visibleQueueItems.length - 1 ? visibleQueueItems[idx + 1] : null;
          if (next) {
            handleSelectThread(next);
            setMobileTab('conversation');
          }
          break;
        }
        case 'k': {
          const idx = selectedThread
            ? visibleQueueItems.findIndex((t) => t.thread_id === selectedThread.thread_id)
            : 0;
          const prev = idx > 0 ? visibleQueueItems[idx - 1] : visibleQueueItems[0] ?? null;
          if (prev) {
            handleSelectThread(prev);
            setMobileTab('conversation');
          }
          break;
        }
        case 'r':
          window.dispatchEvent(new CustomEvent('engagement:focus-reply'));
          break;
        case 'e':
          setMobileTab('assistant');
          setAiDrawerOpen((open) => !open);
          break;
        case 'l': {
          if (messages.length > 0) {
            const latest = [...messages].sort((a, b) => {
              const ta = new Date(a.platform_created_at ?? a.created_at ?? 0).getTime();
              const tb = new Date(b.platform_created_at ?? b.created_at ?? 0).getTime();
              return tb - ta;
            })[0];
            if (latest) handleLike(latest.id, latest.platform ?? '');
          }
          break;
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [visibleQueueItems, selectedThread, messages, handleSelectThread, handleLike]);

  // ── Public surface ──
  return {
    runPlatformSyncAndRefresh,
    handleRefresh,
    replaceEngagementRoute,

    recommendationState: {
      recommendedThreadId,
      recommendedThread,
      recommendedThreadInScope,
      recommendationIsFading,
    },

    keyboardHandlers: {} as Record<string, never>,

    threadState: {
      handleSelectThread,
      handleSelectThreadById,
      handleSelectPlatform,
      handleIgnore,
      handleMarkResolved,
      hideThreadAfterResponse,
      handleReplySent,
    },

    emptyState: {
      hasBlockingError,
      hasActionRequired,
      hasAnyThreads,
      showSyncUnverifiedState,
      showNoActivityState,
      showAllCaughtUpState,
      conversationEmptyState,
    },
  };
}
