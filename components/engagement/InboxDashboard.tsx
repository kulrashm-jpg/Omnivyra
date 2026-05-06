/**
 * InboxDashboard - top-level layout: PlatformTabs, ThreadList, ThreadView.
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import {
  NEEDS_RESPONSE_VISIBLE_LIMIT,
  selectNeedsResponseThreads,
  selectPeopleReactionThreads,
} from '@/lib/engagement/queueRules';
import { PlatformTabs } from '@/components/engagement/PlatformTabs';
import { PlatformHealthStrip } from '@/components/engagement/PlatformHealthStrip';
import { useEngagementPlatformHealth } from '@/hooks/useEngagementPlatformHealth';
import { ExtensionStatusPanel } from '@/components/engagement/ExtensionStatusPanel';
import { LinkedInOperationsPanel } from '@/components/engagement/LinkedInOperationsPanel';
import { BrowserOperationsPanel } from '@/components/engagement/BrowserOperationsPanel';
import { ThreadList } from '@/components/engagement/ThreadList';
import { ThreadView } from '@/components/engagement/ThreadView';
import { AIEngagementAssistant } from '@/components/engagement/AIEngagementAssistant';
import { InboxLayout } from '@/components/engagement/inbox/InboxLayout';
import { useEngagementInbox } from '@/hooks/useEngagementInbox';
import { usePlatformCounts } from '@/hooks/usePlatformCounts';
import { useWorkQueue } from '@/hooks/useWorkQueue';
import { useCompanyIntegrations } from '@/hooks/useCompanyIntegrations';
import { useExtensionBridge } from '@/hooks/useExtensionBridge';
import { useEngagementPlatformPreferences } from '@/hooks/useEngagementPlatformPreferences';
import { useEngagementMessages } from '@/hooks/useEngagementMessages';
import { useLinkedInEngagementWorkspace } from '@/hooks/useLinkedInEngagementWorkspace';
import { useReply } from '@/hooks/useReply';
import type { InboxThread } from '@/hooks/useEngagementInbox';
import { trackEngagementEvent } from '@/lib/engagementTelemetry';
import { EVENTS } from '@/analytics/events';
import { normalizePlatform } from '@/utils/platformIcons';
import { isBrowserAssistRuntimeEnabled } from '@/lib/featureFlags';
import { resolveEngagementCapability } from '@/lib/engagementCapabilities';
import type { ThreadQueueGroup } from './threadQueueModel';
import {
  filterThreadsForQueue,
  getRecommendedThread,
  getThreadQueueCounts,
} from './threadQueueModel';
import {
  PLATFORM_SYNC_SETTLE_DELAYS_MS,
  BACKGROUND_PLATFORM_SYNC_INTERVAL_MS,
  EXTENSION_SYNC_PLATFORM_SET,
  SERVER_SYNC_PLATFORM_SET,
  GENERIC_BROWSER_ASSIST_PLATFORM_SET,
  requestServerPlatformSync,
  readServerPlatformSyncStatus,
} from './inbox/helpers';
import type {
  PlatformSyncTrustState,
  ServerPlatformSyncStart,
} from './inbox/helpers';

const RECOMMENDATION_TTL_MS = 12 * 60 * 1000;
const RECOMMENDATION_FADE_WINDOW_MS = 2 * 60 * 1000;

export interface InboxDashboardProps {
  organizationId: string;
  className?: string;
}

function InboxDashboardComponent({
  organizationId,
  className = '',
}: InboxDashboardProps) {
  const router = useRouter();
  const browserAssistEnabled = isBrowserAssistRuntimeEnabled();
  const [selectedPlatform, setSelectedPlatform] = useState<string>('all');
  const [selectedThread, setSelectedThread] = useState<InboxThread | null>(null);
  const [mobileTab, setMobileTab] = useState<'threads' | 'conversation' | 'assistant'>('threads');
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false);
  const [activeQueueFilter, setActiveQueueFilter] = useState<ThreadQueueGroup | 'all' | 'People Reacted'>('Needs Response');
  const [recommendedThreadId, setRecommendedThreadId] = useState<string | null>(null);
  const [recommendationSetAt, setRecommendationSetAt] = useState<number | null>(null);
  const [recommendationIsFading, setRecommendationIsFading] = useState(false);
  const [recommendationSeed, setRecommendationSeed] = useState(0);
  const [authorFilter, setAuthorFilter] = useState<{ authorName: string; platform: string } | null>(
    null
  );
  // Switching primary tab is the user's signal that they want fresh data
  // for that view — kick a re-fetch. Skips first mount (the inbox load
  // already runs there) and avoids a double-fetch on initial render.
  const isFirstFilterRender = useRef(true);
  const [browserAssistError, setBrowserAssistError] = useState<string | null>(null);
  const [browserAssistBusyPlatform, setBrowserAssistBusyPlatform] = useState<string | null>(null);
  const [browserAssistStatusByPlatform, setBrowserAssistStatusByPlatform] = useState<Record<string, string | null>>({});
  const [browserAssistErrorByPlatform, setBrowserAssistErrorByPlatform] = useState<Record<string, string | null>>({});
  const [linkedInSurfaceActionBusy, setLinkedInSurfaceActionBusy] = useState<'sales_navigator' | 'recruiter' | null>(null);
  const [linkedInSurfaceActionStatus, setLinkedInSurfaceActionStatus] = useState<string | null>(null);
  const [platformSyncTrust, setPlatformSyncTrust] = useState<PlatformSyncTrustState>({
    status: 'idle',
    lastSyncedAt: null,
    message: null,
  });
  const attemptedExtensionAuthRef = useRef<string | null>(null);
  const initialPlatformSyncKeyRef = useRef<string | null>(null);
  const lastPlatformSyncAtRef = useRef<number>(0);
  // Clear the "already-attempted" lock whenever the user returns to the tab
  // or refocuses the window. The lock prevents redundant retries during a
  // single page session, but it also prevents recovery from a transient
  // initial failure (e.g. SW cold start, content-script not yet injected).
  // On focus/visibility we know the user is engaging — let the auto-bootstrap
  // try again from a clean slate.
  useEffect(() => {
    const clearLock = () => { attemptedExtensionAuthRef.current = null; };
    const onVisibility = () => { if (document.visibilityState === 'visible') clearLock(); };
    window.addEventListener('focus', clearLock);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', clearLock);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const filters = useMemo(
    () => ({
      platform: selectedPlatform && selectedPlatform !== 'all' ? selectedPlatform : undefined,
      priority: undefined as 'high' | 'medium' | 'low' | undefined,
    }),
    [selectedPlatform]
  );

  const {
    counts,
    loading: countsLoading,
    refresh: refreshCounts,
  } = usePlatformCounts(organizationId);
  const {
    workQueue,
    loading: workQueueLoading,
    refresh: refreshWorkQueue,
  } = useWorkQueue(organizationId);
  const { platforms: integrations } = useCompanyIntegrations(organizationId);
  const connectedPlatformSlugs = useMemo(
    () => Array.from(
      new Set(
        integrations
          .map((integration) => normalizePlatform(integration.platform))
          .filter(Boolean)
      )
    ),
    [integrations]
  );
  // Per-platform health (API / RPA / Extension / Publish adapter + ingress).
  // Renders as a compact strip under the platform tabs so the operator
  // can tell at a glance whether a given platform's selected actions
  // will actually execute. Read-only; no mutation of tokens or sessions.
  const {
    platforms: platformHealth,
    loading: platformHealthLoading,
    refresh: refreshPlatformHealth,
  } = useEngagementPlatformHealth(organizationId);
  const {
    status: extensionStatus,
    auth: extensionAuth,
    loading: extensionLoading,
    error: extensionError,
    refresh: refreshExtension,
    mergedPlatforms,
    updatingPlatform: updatingBrowserPlatform,
    authenticating: extensionAuthenticating,
    setBrowserPlatformEnabled,
    authenticateExtensionViaClaimCode,
    pollExtensionCommandsNow,
    triggerPlatformSync,
    executePlatformAction
  } = useExtensionBridge(integrations.map((integration) => integration.platform));
  const {
    preferenceMap: workspacePreferenceMap,
    loading: workspacePreferencesLoading,
    refresh: refreshWorkspacePreferences,
    updatingPlatform: updatingWorkspacePlatform,
    setPlatformEnabled: setWorkspacePlatformEnabled,
  } = useEngagementPlatformPreferences(organizationId);
  const { items, loading, error, refresh, patchThread } = useEngagementInbox(organizationId, filters);
  useEffect(() => {
    if (isFirstFilterRender.current) {
      isFirstFilterRender.current = false;
      return;
    }
    refresh();
  }, [activeQueueFilter, refresh]);
  const {
    messages,
    loading: messagesLoading,
    refresh: refreshMessages,
  } = useEngagementMessages(
    organizationId,
    selectedThread?.thread_id ?? null,
    selectedThread?.sibling_thread_ids ?? []
  );
  const hasLinkedInConnection = useMemo(
    () => integrations.some((integration) => normalizePlatform(integration.platform) === 'linkedin'),
    [integrations]
  );
  const {
    overview: linkedinOverview,
    loading: linkedinOverviewLoading,
    syncing: linkedinSyncing,
    error: linkedinOverviewError,
    lastSyncResult: linkedinLastSyncResult,
    refresh: refreshLinkedInOverview,
    syncNow: syncLinkedInNow,
  } = useLinkedInEngagementWorkspace(organizationId, hasLinkedInConnection);

  const threadIdFromUrl = typeof router.query.thread === 'string' ? router.query.thread : null;

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

  const filteredItems = useMemo((): InboxThread[] => {
    if (!authorFilter) return items;
    return items.filter(
      (t) =>
        (t.author_name === authorFilter.authorName ||
          t.author_username === authorFilter.authorName) &&
        t.platform === authorFilter.platform
    );
  }, [items, authorFilter]);
  // Split filteredItems into the two universes the UI cares about:
  //   - dmThreads:      DMs and direct conversations (Needs Response domain)
  //   - postThreads:    activity on the user's posts (People Reaction domain)
  // Doing the split once here keeps the count badges consistent with what's
  // actually shown in each tab.
  // "Needs response" rule: only DMs where the *other party* sent the last
  // message AND the user hasn't already queued an outbound reply through
  // the engagement pipeline. If the user already replied (outgoing or
  // author_self=true on the latest, OR an in-flight community_ai_actions
  // row exists), the thread drops out of the queue until the counterparty
  // sends something new — otherwise the operator sees their own replies
  // sitting in the inbox waiting for action that's already been taken.
  const dmThreads = useMemo(
    () => selectNeedsResponseThreads(filteredItems),
    [filteredItems]
  );
  // People Reaction visibility rules (operator-defined):
  //   1. Only comment threads where someone else wrote the latest comment.
  //      The window is rolling — every fetch advances "now," so when the
  //      user signs back in after a gap they see whatever's actionable in
  //      the current 60-day slice rather than an unbounded backlog.
  //   2. Hide once the latest visible comment is self-authored or a reply
  //      action for that thread has already been completed.
  //
  // Note: Date.now() lives INSIDE the useMemo, not in deps, otherwise the
  // ms-level drift on every render would re-create the array reference,
  // invalidate visibleQueueItems, fire the recommendation useEffect, and
  // trigger an infinite re-render loop ("Maximum update depth exceeded").
  const postThreads = useMemo(
    () => selectPeopleReactionThreads(filteredItems),
    [filteredItems]
  );

  const needsResponseQueueItems = useMemo(
    () => filterThreadsForQueue(dmThreads, 'Needs Response').slice(0, NEEDS_RESPONSE_VISIBLE_LIMIT),
    [dmThreads]
  );
  const visibleQueueItems = useMemo(() => {
    if (activeQueueFilter === 'People Reacted') return postThreads;
    // Needs Response / High Priority / Waiting / Done are DM-domain views;
    // run queue grouping only over DM threads so post threads never leak
    // into the priority queues.
    return activeQueueFilter === 'Needs Response'
      ? needsResponseQueueItems
      : filterThreadsForQueue(dmThreads, activeQueueFilter).slice(0, NEEDS_RESPONSE_VISIBLE_LIMIT);
  }, [activeQueueFilter, dmThreads, needsResponseQueueItems, postThreads]);

  const peopleReactedCount = postThreads.length;

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

  const getBrowserActionPlatform = useCallback((platform: string) => {
    const normalized = normalizePlatform(platform);
    return normalized === 'twitter' ? 'x' : normalized;
  }, []);

  const syncableBrowserPlatforms = useMemo(
    () => Array.from(
      new Set(
        connectedPlatformSlugs
          .map((platform) => getBrowserActionPlatform(platform))
          .filter((platform) => EXTENSION_SYNC_PLATFORM_SET.has(platform))
      )
    ),
    [connectedPlatformSlugs, getBrowserActionPlatform]
  );

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

  // Counts must mirror what the user actually sees in the Needs Response
  // tab: DM threads where the other party replied last. Computing from
  // filteredItems would inflate the badge with post threads (now under
  // People Reaction) and self-replied DMs that we already filter out.
  const queueCounts = useMemo(() => getThreadQueueCounts(needsResponseQueueItems), [needsResponseQueueItems]);

  // Per-platform counts for the platform tabs. These are derived client-side
  // from the same filtered universes the rest of the UI uses, so the tab
  // badge for each platform = (DMs needing attention + posts with reactions)
  // and matches what the user sees when they click that platform tab.
  // Server-side `counts` is ignored here because it doesn't apply the
  // "I-replied-last" or DM/post split filters.
  const platformCounts = useMemo(() => {
    type Tier = 'low' | 'medium' | 'high';
    const tierFromScore = (score: number): Tier => {
      if (score >= 60) return 'high';
      if (score >= 30) return 'medium';
      return 'low';
    };
    const tierRank: Record<Tier, number> = { low: 0, medium: 1, high: 2 };
    const next: Record<string, { thread_count: number; unread_count: number; max_priority_tier: Tier }> = {};
    const all = [...needsResponseQueueItems, ...postThreads];
    for (const t of all) {
      const slug = (t.platform || '').toLowerCase().trim();
      if (!slug) continue;
      const cell = next[slug] ?? { thread_count: 0, unread_count: 0, max_priority_tier: 'low' as Tier };
      cell.thread_count += 1;
      cell.unread_count += t.unread_count ?? 0;
      const tier = tierFromScore(Number(t.priority_score ?? 0));
      if (tierRank[tier] > tierRank[cell.max_priority_tier]) cell.max_priority_tier = tier;
      next[slug] = cell;
    }
    return next;
  }, [needsResponseQueueItems, postThreads]);

  // Client-side workQueue replaces the server's stale per-platform actionable
  // counts. Same filtered universe as platformCounts: actionable_threads =
  // # of (DMs needing attention + posts with reactions) for that platform.
  // The orange badge on the platform tabs reads from this.
  const clientWorkQueue = useMemo(() => {
    const byPlatform: Record<string, { actionable_threads: number; high_priority_threads: number }> = {};
    for (const t of needsResponseQueueItems) {
      const slug = (t.platform || '').toLowerCase().trim();
      if (!slug) continue;
      const cell = byPlatform[slug] ?? { actionable_threads: 0, high_priority_threads: 0 };
      cell.actionable_threads += 1;
      const isHigh = (t.triage_priority ?? 0) >= 7 || (t.priority_score ?? 0) >= 60;
      if (isHigh) cell.high_priority_threads += 1;
      byPlatform[slug] = cell;
    }
    for (const t of postThreads) {
      const slug = (t.platform || '').toLowerCase().trim();
      if (!slug) continue;
      const cell = byPlatform[slug] ?? { actionable_threads: 0, high_priority_threads: 0 };
      cell.actionable_threads += 1;
      byPlatform[slug] = cell;
    }
    return {
      platforms: Object.entries(byPlatform).map(([platform, v]) => ({
        platform,
        actionable_threads: v.actionable_threads,
        high_priority_threads: v.high_priority_threads,
      })),
    };
  }, [needsResponseQueueItems, postThreads]);
  const recommendedThreadInScope = useMemo(
    () => filteredItems.find((thread) => thread.thread_id === recommendedThreadId) ?? null,
    [filteredItems, recommendedThreadId]
  );
  const recommendedThread = useMemo(
    () => visibleQueueItems.find((thread) => thread.thread_id === recommendedThreadId) ?? null,
    [visibleQueueItems, recommendedThreadId]
  );
  const actionableThreads = queueCounts.needsResponse;
  const connectedPlatformsCount = connectedPlatformSlugs.length;
  const connectedPlatformSet = useMemo(
    () => new Set(connectedPlatformSlugs),
    [connectedPlatformSlugs]
  );
  const connectedPlatformHealth = useMemo(
    () => platformHealth.filter((platform) => connectedPlatformSet.has(normalizePlatform(platform.platform))),
    [connectedPlatformSet, platformHealth]
  );
  const extensionPanelPlatforms = useMemo(() => {
    return connectedPlatformSlugs.map((platform) => {
      const extensionPlatform = mergedPlatforms.find((entry) => entry.platform === platform);

      return {
        platform,
        connected: true,
        browserEnabled: extensionPlatform?.browserEnabled ?? true,
        hasOpenTab: extensionPlatform?.hasOpenTab ?? false,
        openTabCount: extensionPlatform?.openTabCount ?? 0,
        hasMessagingTab: extensionPlatform?.hasMessagingTab ?? false,
        hasFeedTab: extensionPlatform?.hasFeedTab ?? false,
        hasSalesNavigatorTab: extensionPlatform?.hasSalesNavigatorTab ?? false,
        hasRecruiterTab: extensionPlatform?.hasRecruiterTab ?? false,
        workspaceEnabled: workspacePreferenceMap[platform] ?? true,
      };
    });
  }, [connectedPlatformSlugs, mergedPlatforms, workspacePreferenceMap]);
  const updatingExtensionPlatform = updatingWorkspacePlatform || updatingBrowserPlatform;
  const linkedInBrowserState = extensionPanelPlatforms.find((platform) => platform.platform === 'linkedin');
  const genericBrowserPlatforms = useMemo(
    () =>
      extensionPanelPlatforms.filter((platform) =>
        GENERIC_BROWSER_ASSIST_PLATFORM_SET.has(platform.platform)
      ),
    [extensionPanelPlatforms]
  );
  const getBrowserPlatformState = useCallback(
    (platform: string) => {
      const browserPlatform = getBrowserActionPlatform(platform);
      return extensionPanelPlatforms.find((entry) => entry.platform === browserPlatform) ?? null;
    },
    [extensionPanelPlatforms, getBrowserActionPlatform]
  );

  const requiresVerifiedBrowserReply = useCallback((platform: string) => {
    return ['linkedin', 'facebook', 'instagram', 'x'].includes(getBrowserActionPlatform(platform));
  }, [getBrowserActionPlatform]);

  const getVerifiedReplyRequirementMessage = useCallback((platform: string) => {
    const normalized = getBrowserActionPlatform(platform);
    if (normalized === 'linkedin') {
      return 'LinkedIn DM and comment replies require a verified browser-assisted send. Open LinkedIn Messaging for DMs, or the relevant LinkedIn conversation surface, before sending.';
    }
    if (normalized === 'facebook') {
      return 'Facebook replies and message actions require a verified browser-assisted send. Open Messenger or the relevant Facebook conversation surface before sending.';
    }
    if (normalized === 'instagram') {
      return 'Instagram replies and direct-message actions require a verified browser-assisted send. Open Instagram Direct or the relevant thread before sending.';
    }
    if (normalized === 'x') {
      return 'X replies and direct-message actions require a verified browser-assisted send. Open X Messages or the relevant reply surface before sending.';
    }
    return `${normalized} engagement actions require a verified browser-assisted send before Omnivyra can trust them.`;
  }, [getBrowserActionPlatform]);
  const extensionUserLabel =
    extensionAuth?.user?.email ||
    extensionAuth?.user?.name ||
    extensionAuth?.userId ||
    null;
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

  const queueEmptyState = useMemo(() => {
    if (hasBlockingError) {
      return (
        <div className="mx-auto w-full max-w-sm rounded-2xl border border-red-200 bg-red-50 p-5 text-center">
          <h3 className="text-base font-semibold text-red-900">We&apos;re having trouble loading your conversations.</h3>
          <p className="mt-2 text-sm leading-6 text-red-800">{error}</p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={handleRefresh}
              className="rounded-full bg-red-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-800"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => router.push('/social-platforms')}
              className="rounded-full border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-900 transition hover:bg-red-100"
            >
              Reconnect platform
            </button>
          </div>
        </div>
      );
    }

    if (showNoActivityState) {
      return (
        <div className="mx-auto w-full max-w-sm rounded-2xl border border-slate-200 bg-slate-50 p-5 text-center">
          <h3 className="text-base font-semibold text-slate-900">No conversations yet</h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Once people reply to your posts or messages, they&apos;ll appear here.
          </p>
        </div>
      );
    }

    if (showSyncUnverifiedState) {
      return (
        <div className="mx-auto w-full max-w-sm rounded-2xl border border-amber-200 bg-amber-50 p-5 text-center">
          <h3 className="text-base font-semibold text-amber-950">
            Checking latest messages
          </h3>
          <p className="mt-2 text-sm leading-6 text-amber-900">
            {platformSyncTrust.message
              || 'Omnivyra is refreshing the browser inbox before showing the queue.'}
          </p>
          <button
            type="button"
            onClick={handleRefresh}
            className="mt-4 rounded-full bg-amber-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-800"
          >
            Check latest messages
          </button>
        </div>
      );
    }

    if (showAllCaughtUpState) {
      return (
        <div className="mx-auto w-full max-w-sm rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center">
          <h3 className="text-base font-semibold text-emerald-900">All caught up 🎉</h3>
          <p className="mt-2 text-sm leading-6 text-emerald-800">
            You&apos;re up to date. We&apos;ll surface new conversations here.
          </p>
        </div>
      );
    }

    return undefined;
  }, [
    error,
    handleRefresh,
    hasBlockingError,
    platformSyncTrust.message,
    platformSyncTrust.status,
    router,
    showAllCaughtUpState,
    showNoActivityState,
    showSyncUnverifiedState,
  ]);

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

  const handleToggleExtensionPlatform = useCallback(
    async (platform: string, enabled: boolean) => {
      await setWorkspacePlatformEnabled(platform, enabled);
      await setBrowserPlatformEnabled(platform, enabled);
    },
    [setBrowserPlatformEnabled, setWorkspacePlatformEnabled]
  );

  const bootstrapExtensionAuth = useCallback(async () => {
    if (!organizationId || !extensionStatus?.runtimeId || extensionError) return false;
    if (extensionAuth?.isAuthenticated) {
      attemptedExtensionAuthRef.current = null;
      return true;
    }

    const attemptKey = `${organizationId}:${extensionStatus.runtimeId}`;
    if (attemptedExtensionAuthRef.current === attemptKey) return false;
    attemptedExtensionAuthRef.current = attemptKey;

    try {
      await authenticateExtensionViaClaimCode(organizationId);
      attemptedExtensionAuthRef.current = null;
      return true;
    } catch (authError) {
      attemptedExtensionAuthRef.current = null;
      console.warn('[engagement] extension auto-auth failed:', authError);
      return false;
    }
  }, [
    authenticateExtensionViaClaimCode,
    extensionAuth?.isAuthenticated,
    extensionError,
    extensionStatus?.runtimeId,
    organizationId,
  ]);

  const handleRefreshExtensionPanel = useCallback(() => {
    void refreshExtension();
    void refreshWorkspacePreferences();
    void refreshLinkedInOverview();
    void bootstrapExtensionAuth();
  }, [bootstrapExtensionAuth, refreshExtension, refreshWorkspacePreferences, refreshLinkedInOverview]);

  // ── Reply orchestration extracted to hooks/useReply.ts (Phase 35-B) ──
  // The hook owns the dispatch flow (api/browser-mode branching, queued
  // delivery polling, cancel-on-failure) and calls back into refresh
  // hooks. State (replyText, aiDraftId, sending, error) stays in the
  // consumers (ReplyComposer / ConversationView).
  const { executeReply: handleExecuteReply, retryQueuedDelivery: handleRetryQueuedDelivery } = useReply({
    organizationId,
    getBrowserPlatformState,
    hideThreadAfterResponse,
    bootstrapExtensionAuth: async () => {
      await bootstrapExtensionAuth();
    },
    pollExtensionCommandsNow,
    refresh,
    refreshMessages,
    refreshCounts,
    refreshWorkQueue,
  });

  const handleSyncLinkedIn = useCallback(async () => {
    await syncLinkedInNow();
    refresh();
    refreshCounts();
    refreshWorkQueue();
  }, [refresh, refreshCounts, refreshWorkQueue, syncLinkedInNow]);

  const handleRunLinkedInBrowserAssist = useCallback(async () => {
    setBrowserAssistError(null);
    setLinkedInSurfaceActionStatus(null);
    try {
      await bootstrapExtensionAuth();
      await triggerPlatformSync('linkedin');
      const settleDelays = [1200, 2500, 4500];

      for (const delay of settleDelays) {
        await new Promise((resolve) => window.setTimeout(resolve, delay));
        await refreshLinkedInOverview();
        refresh();
        refreshCounts();
        refreshWorkQueue();
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'LinkedIn browser assist is not available right now';
      setBrowserAssistError(message);
    }
  }, [bootstrapExtensionAuth, triggerPlatformSync, refreshLinkedInOverview, refresh, refreshCounts, refreshWorkQueue]);

  const handleRunPlatformBrowserAssist = useCallback(
    async (platform: string) => {
      const browserActionPlatform = getBrowserActionPlatform(platform);
      setBrowserAssistBusyPlatform(browserActionPlatform);
      setBrowserAssistStatusByPlatform((current) => ({ ...current, [browserActionPlatform]: null }));
      setBrowserAssistErrorByPlatform((current) => ({ ...current, [browserActionPlatform]: null }));
      try {
        await bootstrapExtensionAuth();
        await triggerPlatformSync(browserActionPlatform);
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
        await Promise.allSettled([
          refresh(),
          refreshCounts(),
          refreshWorkQueue(),
          refreshMessages(),
        ]);
        setBrowserAssistStatusByPlatform((current) => ({
          ...current,
          [browserActionPlatform]: `${browserActionPlatform === 'x' ? 'X' : browserActionPlatform.charAt(0).toUpperCase() + browserActionPlatform.slice(1)} browser assist ran successfully.`,
        }));
      } catch (error) {
        const message =
          error instanceof Error ? error.message : `${browserActionPlatform} browser assist is not available right now`;
        setBrowserAssistErrorByPlatform((current) => ({
          ...current,
          [browserActionPlatform]: message,
        }));
      } finally {
        setBrowserAssistBusyPlatform(null);
      }
    },
    [bootstrapExtensionAuth, getBrowserActionPlatform, refresh, refreshCounts, refreshMessages, refreshWorkQueue, triggerPlatformSync]
  );

  const handleCaptureLinkedInSurface = useCallback(
    async (surface: 'sales_navigator' | 'recruiter') => {
      setBrowserAssistError(null);
      setLinkedInSurfaceActionStatus(null);
      setLinkedInSurfaceActionBusy(surface);
      try {
        const browserState = getBrowserPlatformState('linkedin');
        const surfaceReady =
          surface === 'sales_navigator'
            ? browserState?.hasSalesNavigatorTab
            : browserState?.hasRecruiterTab;

        if (!surfaceReady) {
          throw new Error(
            surface === 'sales_navigator'
              ? 'Open Sales Navigator to capture lead workflows'
              : 'Open Recruiter to capture candidate workflows'
          );
        }

        await bootstrapExtensionAuth();
        // Direct platform action dispatch is disabled in the hardened
        // bridge. Sales Navigator / Recruiter capture is deferred until
        // the server-issued command path for those surfaces ships.
        void executePlatformAction;
        setLinkedInSurfaceActionStatus(
          surface === 'sales_navigator'
            ? 'Sales Navigator capture is deferred until server-issued command dispatch ships for this surface.'
            : 'Recruiter capture is deferred until server-issued command dispatch ships for this surface.',
        );

        await Promise.allSettled([
          refresh(),
          refreshCounts(),
          refreshWorkQueue(),
          refreshLinkedInOverview(),
        ]);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'LinkedIn advanced surface capture is not available right now';
        setBrowserAssistError(message);
      } finally {
        setLinkedInSurfaceActionBusy(null);
      }
    },
    [
      bootstrapExtensionAuth,
      executePlatformAction,
      getBrowserPlatformState,
      refresh,
      refreshCounts,
      refreshLinkedInOverview,
      refreshWorkQueue,
    ]
  );

  useEffect(() => {
    // Extension auth (claim-code redemption → HMAC secret) is required for
    // EVERY /api/extension/* call: DM/comment scraping, command polling,
    // platform health, etc. It is NOT specific to the browser-assist
    // feature, so we don't gate the bootstrap on browserAssistEnabled.
    // Without this, the SW never gets an HMAC secret and every signed
    // POST returns SIGNATURE_UNAVAILABLE.
    if (!organizationId || !extensionStatus?.runtimeId || extensionError) return;
    if (extensionAuth?.isAuthenticated) {
      attemptedExtensionAuthRef.current = null;
      return;
    }

    const attemptKey = `${organizationId}:${extensionStatus.runtimeId}`;
    if (attemptedExtensionAuthRef.current === attemptKey) {
      return;
    }
    void bootstrapExtensionAuth();
  }, [
    browserAssistEnabled,
    bootstrapExtensionAuth,
    extensionAuth?.isAuthenticated,
    extensionError,
    extensionStatus?.runtimeId,
    organizationId,
  ]);

  useEffect(() => {
    if (!organizationId || !extensionStatus?.runtimeId || extensionError) return;
    if (syncableBrowserPlatforms.length === 0) return;

    const syncKey = `${organizationId}:${extensionStatus.runtimeId}:${syncableBrowserPlatforms.join(',')}`;
    if (initialPlatformSyncKeyRef.current === syncKey) return;

    let cancelled = false;
    initialPlatformSyncKeyRef.current = syncKey;

    void (async () => {
      const authenticated = await bootstrapExtensionAuth();
      if (!authenticated || cancelled) {
        if (!cancelled) initialPlatformSyncKeyRef.current = null;
        return;
      }
      await runPlatformSyncAndRefresh(syncableBrowserPlatforms);
    })().catch((syncError) => {
      initialPlatformSyncKeyRef.current = null;
      console.warn('[engagement] initial platform inbox sync failed:', syncError);
    });

    return () => {
      cancelled = true;
    };
  }, [
    bootstrapExtensionAuth,
    extensionError,
    extensionStatus?.runtimeId,
    organizationId,
    runPlatformSyncAndRefresh,
    syncableBrowserPlatforms,
  ]);

  useEffect(() => {
    if (!organizationId || syncableBrowserPlatforms.length === 0) return;

    const runIfDue = () => {
      if (Date.now() - lastPlatformSyncAtRef.current < BACKGROUND_PLATFORM_SYNC_INTERVAL_MS) return;
      void (async () => {
        const authenticated = await bootstrapExtensionAuth();
        if (!authenticated) return;
        await runPlatformSyncAndRefresh(syncableBrowserPlatforms);
      })().catch((syncError) => {
        console.warn('[engagement] scheduled platform inbox sync failed:', syncError);
      });
    };

    const intervalId = window.setInterval(runIfDue, BACKGROUND_PLATFORM_SYNC_INTERVAL_MS);
    const onFocus = () => runIfDue();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') runIfDue();
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [bootstrapExtensionAuth, organizationId, runPlatformSyncAndRefresh, syncableBrowserPlatforms]);

  const handleLike = useCallback(
    async (messageId: string, platform: string) => {
      if (!organizationId) return;

      // Capability gate (synchronous; no fetch needed). Reporting via
      // setBrowserAssistError so the user sees an inline message instead
      // of throwing — Next.js 16's dev overlay otherwise turns any throw
      // here into a fullscreen "Runtime Error" page even if it's caught.
      const capability = resolveEngagementCapability(platform, 'like');
      if (capability.status !== 'api_verified') {
        setBrowserAssistError(capability.reason ?? `Like is not supported on ${platform}.`);
        return;
      }

      try {
        const res = await fetch('/api/engagement/like', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            organization_id: organizationId,
            message_id: messageId,
            platform,
          }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
          code?: string;
          status?: string;
          confirmed?: boolean;
          platform_id?: string | null;
          success?: boolean;
        };

        if (!res.ok || json.status !== 'executed' || json.success !== true) {
          // Surface the server's reason inline. No throw — Next.js dev
          // overlay would intercept it as a runtime error otherwise.
          const reason = json.error
            || (json.code === 'PLACEHOLDER_TARGET'
              ? 'Demo seed row — real LinkedIn URN required to like.'
              : 'Platform did not confirm the like.');
          console.warn('[engagement] like rejected:', { code: json.code, reason });
          setBrowserAssistError(reason);
          return;
        }

        // Observability distinction: confirmed like vs sent-but-unconfirmed.
        if (!json.confirmed) {
          console.info('[engagement] like accepted by platform but no id returned', {
            messageId,
            platform,
          });
        }
        refreshMessages();
      } catch (err) {
        // Network-level error or JSON parse failure — same inline path.
        console.error('[engagement] like network error:', err);
        setBrowserAssistError(
          err instanceof Error ? err.message : 'Like request failed'
        );
      }
    },
    [organizationId, refreshMessages]
  );

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
        const res = await fetch('/api/engagement/thread/bulk-ignore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            organization_id: organizationId,
            thread_ids: threadIds,
          }),
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

  if (!organizationId) {
    return (
      <div className={`flex h-full flex-col items-center justify-center p-8 text-slate-500 ${className}`}>
        Select a company to view the engagement inbox.
      </div>
    );
  }

  return (
    <div className={`flex h-full flex-col ${className}`}>
      <header className="shrink-0 border-b border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.10),_transparent_38%),linear-gradient(180deg,_#ffffff_0%,_#f8fbff_100%)] px-4 py-4">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-blue-700">
                Engagement Command Center
              </p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
                Queue-first engagement triage
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                Work the conversations that need action, handle replies, and keep cross-platform activity moving from one shared workspace.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 self-start">
              <button
                type="button"
                onClick={handleRefresh}
                disabled={loading || countsLoading || workQueueLoading}
                className="inline-flex items-center rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Refresh Workspace
              </button>
            </div>
          </div>

          {/* Primary view-mode tabs (Needs Response | People Reaction) used
              to live here, but they're duplicated by the sticky tabs at
              the top of the left column (where the user actually scrolls).
              Removed to declutter the header area. */}

          {/* Secondary priority filters — only relevant inside Needs Response.
              Hidden in People Reaction mode where threads are organised by
              post, not priority. */}
          {activeQueueFilter !== 'People Reacted' && (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white/90 px-3 py-3 shadow-sm">
              <button
                type="button"
                onClick={() => setActiveQueueFilter('Needs Response')}
                aria-pressed={activeQueueFilter === 'Needs Response'}
                className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm ${activeQueueFilter === 'Needs Response' ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-900'}`}
              >
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-700">Needs response</span>
                <span className="text-base font-semibold text-slate-900">{actionableThreads}</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveQueueFilter('all')}
                aria-pressed={activeQueueFilter === 'all'}
                className={`inline-flex items-center gap-2 rounded-full bg-white px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-200 ${activeQueueFilter === 'all' ? 'ring-2 ring-indigo-200' : ''}`}
              >
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Platforms</span>
                <span className="text-base font-semibold text-slate-900">{connectedPlatformsCount}</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveQueueFilter('all')}
                aria-pressed={activeQueueFilter === 'all'}
                className={`inline-flex items-center gap-2 rounded-full bg-white px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-200 ${activeQueueFilter === 'all' ? 'ring-2 ring-indigo-200' : ''}`}
              >
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Visible threads</span>
                <span className="text-base font-semibold text-slate-900">{dmThreads.length + postThreads.length}</span>
              </button>
            </div>
          )}

          {/* Browser-assist runtime surfaces are gated by a hard-off feature
              flag. They describe capabilities (DM / messaging / Sales Navigator /
              Recruiter capture) that require a Chrome extension that does not
              ship today. Kept in the tree behind the flag so the architecture
              is preserved without misleading production users. */}
          {browserAssistEnabled && (
            <>
              <ExtensionStatusPanel
                loading={extensionLoading || workspacePreferencesLoading || extensionAuthenticating}
                error={extensionError}
                authenticated={Boolean(extensionAuth?.isAuthenticated)}
                orgId={extensionAuth?.orgId ?? null}
                userLabel={extensionUserLabel}
                runtimeId={extensionStatus?.runtimeId ?? null}
                version={extensionStatus?.version ?? null}
                platforms={extensionPanelPlatforms}
                updatingPlatform={updatingExtensionPlatform}
                authenticating={extensionAuthenticating}
                onRefresh={handleRefreshExtensionPanel}
                onTogglePlatform={handleToggleExtensionPlatform}
                onConnect={async () => {
                  if (!organizationId) return;
                  await authenticateExtensionViaClaimCode(organizationId);
                }}
              />

              {hasLinkedInConnection ? (
                <LinkedInOperationsPanel
                  loading={linkedinOverviewLoading}
                  syncing={linkedinSyncing}
                  surfaceActionBusy={linkedInSurfaceActionBusy}
                  error={browserAssistError || linkedinOverviewError}
                  surfaceActionStatus={linkedInSurfaceActionStatus}
                  overview={linkedinOverview}
                  lastSyncResult={linkedinLastSyncResult}
                  extensionAuthenticated={Boolean(extensionAuth?.isAuthenticated)}
                  browserAssistAvailable={Boolean(linkedInBrowserState?.browserEnabled)}
                  browserTabOpen={Boolean(linkedInBrowserState?.hasOpenTab)}
                  browserMessagingTabOpen={Boolean(linkedInBrowserState?.hasMessagingTab)}
                  browserFeedTabOpen={Boolean(linkedInBrowserState?.hasFeedTab)}
                  browserSalesNavigatorTabOpen={Boolean(linkedInBrowserState?.hasSalesNavigatorTab)}
                  browserRecruiterTabOpen={Boolean(linkedInBrowserState?.hasRecruiterTab)}
                  onRefresh={refreshLinkedInOverview}
                  onSyncNow={handleSyncLinkedIn}
                  onRunBrowserAssist={linkedInBrowserState?.browserEnabled ? handleRunLinkedInBrowserAssist : null}
                  onCaptureSalesNavigator={
                    linkedInBrowserState?.browserEnabled ? () => handleCaptureLinkedInSurface('sales_navigator') : null
                  }
                  onCaptureRecruiter={
                    linkedInBrowserState?.browserEnabled ? () => handleCaptureLinkedInSurface('recruiter') : null
                  }
                />
              ) : null}

              <BrowserOperationsPanel
                loading={extensionLoading || extensionAuthenticating}
                authenticated={Boolean(extensionAuth?.isAuthenticated)}
                platforms={genericBrowserPlatforms}
                busyPlatform={browserAssistBusyPlatform}
                statusByPlatform={browserAssistStatusByPlatform}
                errorByPlatform={browserAssistErrorByPlatform}
                onRunBrowserAssist={handleRunPlatformBrowserAssist}
              />
            </>
          )}
        </div>

        <PlatformTabs
          counts={platformCounts}
          selectedPlatform={selectedPlatform}
          onSelectPlatform={handleSelectPlatform}
          workQueue={clientWorkQueue as typeof workQueue}
          platforms={connectedPlatformSlugs}
          loading={countsLoading || workQueueLoading}
          className="mt-4"
        />

        {/*
          Status strip for the selected platform: overall dot, per-mechanism
          badges (API / RPA / Ext / Publish × reply / like / DM / post), and
          ingress summary (polling / webhook / extension_events). When the
          "All" tab is selected, renders a compact row of per-platform dots
          instead of the full grid.
        */}
        <PlatformHealthStrip
          platforms={connectedPlatformHealth}
          selectedPlatform={selectedPlatform}
          organizationId={organizationId}
          onSelectPlatform={handleSelectPlatform}
          onHealthRefresh={refreshPlatformHealth}
          loading={platformHealthLoading}
          className="mt-3"
        />
      </header>

      <div className="shrink-0 border-b border-slate-200 bg-white md:hidden">
        <div className="flex">
          <button
            type="button"
            onClick={() => setMobileTab('threads')}
            className={`flex-1 px-4 py-2 text-sm font-medium ${
              mobileTab === 'threads' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-slate-600'
            }`}
          >
            Threads
          </button>
          <button
            type="button"
            onClick={() => setMobileTab('conversation')}
            className={`flex-1 px-4 py-2 text-sm font-medium ${
              mobileTab === 'conversation'
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-slate-600'
            }`}
          >
            Conversation
          </button>
          <button
            type="button"
            onClick={() => setMobileTab('assistant')}
            className={`flex-1 px-4 py-2 text-sm font-medium ${
              mobileTab === 'assistant'
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-slate-600'
            }`}
          >
            AI
          </button>
        </div>
      </div>

      <InboxLayout
        mobileTab={mobileTab}
        aiDrawerOpen={aiDrawerOpen}
        onAiDrawerToggle={() => setAiDrawerOpen(!aiDrawerOpen)}
        onAiDrawerClose={() => setAiDrawerOpen(false)}
        threadList={(
          <>
            {/* Sticky primary view-mode tabs at the top of the left column.
                These are duplicated from the page header so they stay visible
                when the user scrolls the thread list. Two tabs cover the two
                fundamental triage modes (DMs vs reactions on your posts). */}
            <div className="sticky top-0 z-10 flex shrink-0 border-b border-slate-200 bg-white">
              <button
                type="button"
                onClick={() => setActiveQueueFilter('Needs Response')}
                aria-pressed={activeQueueFilter !== 'People Reacted'}
                className={`flex flex-1 items-center justify-center gap-2 border-b-2 px-3 py-3 text-sm font-semibold transition ${activeQueueFilter !== 'People Reacted' ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-transparent text-slate-600 hover:bg-slate-50'}`}
              >
                <span>📥 Needs Response</span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${activeQueueFilter !== 'People Reacted' ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700'}`}>
                  {actionableThreads}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setActiveQueueFilter('People Reacted')}
                aria-pressed={activeQueueFilter === 'People Reacted'}
                className={`flex flex-1 items-center justify-center gap-2 border-b-2 px-3 py-3 text-sm font-semibold transition ${activeQueueFilter === 'People Reacted' ? 'border-emerald-600 bg-emerald-50 text-emerald-700' : 'border-transparent text-slate-600 hover:bg-slate-50'}`}
              >
                <span>💬 People Reaction</span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${activeQueueFilter === 'People Reacted' ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-700'}`}>
                  {peopleReactedCount}
                </span>
              </button>
            </div>
            <ThreadList
              items={visibleQueueItems}
              loading={loading}
              selectedThreadId={selectedThread?.thread_id}
              recommendedThreadId={recommendedThread?.thread_id ?? null}
              recommendationIsFading={recommendationIsFading}
              activeFilter={activeQueueFilter}
              onSelectThread={(thread) => {
                handleSelectThread(thread);
                setMobileTab('conversation');
              }}
              emptyMessage={
                authorFilter
                  ? `No threads from ${authorFilter.authorName} on ${authorFilter.platform}.`
                  : activeQueueFilter === 'all'
                    ? 'No threads in inbox.'
                    : `No threads in ${activeQueueFilter.toLowerCase()} right now.`
              }
              emptyState={queueEmptyState}
              authorFilter={authorFilter}
              onClearAuthorFilter={authorFilter ? () => setAuthorFilter(null) : undefined}
            />
          </>
        )}
        conversation={(
          <ThreadView
            thread={selectedThread}
            messages={messages}
            loading={messagesLoading && messages.length === 0}
            organizationId={organizationId}
            emptyStateTitle={conversationEmptyState.title}
            emptyStateDescription={conversationEmptyState.description}
            onRefresh={refreshMessages}
            onReplySent={handleReplySent}
            onExecuteReply={handleExecuteReply}
            onLike={handleLike}
            onIgnore={handleIgnore}
            onMarkResolved={handleMarkResolved}
            onRetryQueuedDelivery={handleRetryQueuedDelivery}
          />
        )}
        rightPanelDesktop={(
          <AIEngagementAssistant
            thread={selectedThread}
            messages={messages}
            organizationId={organizationId}
            recommendedThread={recommendedThread}
            onSelectThread={(threadId) => {
              handleSelectThreadById(threadId);
              setMobileTab('threads');
            }}
            onFilterByAuthor={(authorName, platform) => {
              setAuthorFilter({ authorName, platform });
              setMobileTab('threads');
            }}
          />
        )}
        rightPanelDrawer={(
          <AIEngagementAssistant
            thread={selectedThread}
            messages={messages}
            organizationId={organizationId}
            recommendedThread={recommendedThread}
            onSelectThread={(threadId) => {
              handleSelectThreadById(threadId);
              setMobileTab('threads');
            }}
            onFilterByAuthor={(authorName, platform) => {
              setAuthorFilter({ authorName, platform });
              setMobileTab('threads');
              setAiDrawerOpen(false);
            }}
            className="h-full border-0"
          />
        )}
        rightPanelMobile={(
          <AIEngagementAssistant
            thread={selectedThread}
            messages={messages}
            organizationId={organizationId}
            recommendedThread={recommendedThread}
            onSelectThread={(threadId) => {
              handleSelectThreadById(threadId);
              setMobileTab('threads');
            }}
            onFilterByAuthor={(authorName, platform) => {
              setAuthorFilter({ authorName, platform });
              setMobileTab('threads');
            }}
          />
        )}
      />
    </div>
  );
}

export const InboxDashboard = React.memo(InboxDashboardComponent);
