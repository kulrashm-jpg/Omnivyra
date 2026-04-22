/**
 * InboxDashboard - top-level layout: PlatformTabs, ThreadList, ThreadView.
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { PlatformTabs } from '@/components/engagement/PlatformTabs';
import { ExtensionStatusPanel } from '@/components/engagement/ExtensionStatusPanel';
import { LinkedInOperationsPanel } from '@/components/engagement/LinkedInOperationsPanel';
import { BrowserOperationsPanel } from '@/components/engagement/BrowserOperationsPanel';
import { ThreadList } from '@/components/engagement/ThreadList';
import { ThreadView } from '@/components/engagement/ThreadView';
import { AIEngagementAssistant } from '@/components/engagement/AIEngagementAssistant';
import { useEngagementInbox } from '@/hooks/useEngagementInbox';
import { usePlatformCounts } from '@/hooks/usePlatformCounts';
import { useWorkQueue } from '@/hooks/useWorkQueue';
import { useCompanyIntegrations } from '@/hooks/useCompanyIntegrations';
import { useExtensionBridge } from '@/hooks/useExtensionBridge';
import { useEngagementPlatformPreferences } from '@/hooks/useEngagementPlatformPreferences';
import { useEngagementMessages } from '@/hooks/useEngagementMessages';
import { useLinkedInEngagementWorkspace } from '@/hooks/useLinkedInEngagementWorkspace';
import type { InboxThread } from '@/hooks/useEngagementInbox';
import { recordEngagementEvent } from '@/lib/engagementTelemetry';
import { getAuthToken } from '@/utils/getAuthToken';
import { apiFetch } from '@/lib/apiFetch';
import { getSupabaseBrowser } from '@/lib/supabaseBrowser';
import { normalizePlatform } from '@/utils/platformIcons';
import { isBrowserAssistRuntimeEnabled } from '@/lib/featureFlags';
import { resolveEngagementCapability } from '@/lib/engagementCapabilities';
import type { ThreadQueueGroup } from './threadQueueModel';
import {
  filterThreadsForQueue,
  getRecommendedThread,
  getThreadQueueCounts,
  getThreadQueueGroup,
} from './threadQueueModel';

const RECOMMENDATION_TTL_MS = 12 * 60 * 1000;
const RECOMMENDATION_FADE_WINDOW_MS = 2 * 60 * 1000;

export interface InboxDashboardProps {
  organizationId: string;
  className?: string;
}

export function InboxDashboard({
  organizationId,
  className = '',
}: InboxDashboardProps) {
  const router = useRouter();
  const browserAssistEnabled = isBrowserAssistRuntimeEnabled();
  const [selectedPlatform, setSelectedPlatform] = useState<string>('all');
  const [selectedThread, setSelectedThread] = useState<InboxThread | null>(null);
  const [mobileTab, setMobileTab] = useState<'threads' | 'conversation' | 'assistant'>('threads');
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false);
  const [activeQueueFilter, setActiveQueueFilter] = useState<ThreadQueueGroup | 'all'>('Needs Response');
  const [recommendedThreadId, setRecommendedThreadId] = useState<string | null>(null);
  const [recommendationSetAt, setRecommendationSetAt] = useState<number | null>(null);
  const [recommendationIsFading, setRecommendationIsFading] = useState(false);
  const [recommendationSeed, setRecommendationSeed] = useState(0);
  const [authorFilter, setAuthorFilter] = useState<{ authorName: string; platform: string } | null>(
    null
  );
  const [browserAssistError, setBrowserAssistError] = useState<string | null>(null);
  const [browserAssistBusyPlatform, setBrowserAssistBusyPlatform] = useState<string | null>(null);
  const [browserAssistStatusByPlatform, setBrowserAssistStatusByPlatform] = useState<Record<string, string | null>>({});
  const [browserAssistErrorByPlatform, setBrowserAssistErrorByPlatform] = useState<Record<string, string | null>>({});
  const [linkedInSurfaceActionBusy, setLinkedInSurfaceActionBusy] = useState<'sales_navigator' | 'recruiter' | null>(null);
  const [linkedInSurfaceActionStatus, setLinkedInSurfaceActionStatus] = useState<string | null>(null);
  const attemptedExtensionAuthRef = useRef<string | null>(null);

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
    authenticateExtensionSession,
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
  const {
    messages,
    loading: messagesLoading,
    refresh: refreshMessages,
    addOptimisticMessage,
  } = useEngagementMessages(
    organizationId,
    selectedThread?.thread_id ?? null
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
  const visibleQueueItems = useMemo(
    () => filterThreadsForQueue(filteredItems, activeQueueFilter),
    [filteredItems, activeQueueFilter]
  );

  useEffect(() => {
    if (!threadIdFromUrl || items.length === 0) return;
    const match = items.find((t) => t.thread_id === threadIdFromUrl);
    if (match) setSelectedThread(match);
  }, [threadIdFromUrl, items]);

  useEffect(() => {
    if (!selectedThread) return;
    const stillInFilter = filteredItems.some((t) => t.thread_id === selectedThread.thread_id);
    if (!stillInFilter) setSelectedThread(null);
  }, [selectedThread, filteredItems]);

  const handleSelectThread = useCallback(
    (thread: InboxThread) => {
      setSelectedThread(thread);
      replaceEngagementRoute({ thread: thread.thread_id });
      void recordEngagementEvent('thread_opened', {
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
        void recordEngagementEvent('lead_detected', {
          organization_id: organizationId,
          thread_id: thread.thread_id,
          metadata: {
            platform: thread.platform,
            classification_category: thread.classification_category ?? undefined,
          },
        });
      }
    },
    [organizationId, replaceEngagementRoute]
  );

  const handleSelectThreadById = useCallback(
    (threadId: string) => {
      const thread = items.find((entry) => entry.thread_id === threadId);
      if (thread) {
        handleSelectThread(thread);
        setMobileTab('conversation');
      }
    },
    [items, handleSelectThread]
  );

  const handleSelectPlatform = useCallback(
    (platform: string) => {
      setSelectedThread(null);
      setSelectedPlatform(platform);
      replaceEngagementRoute();
    },
    [replaceEngagementRoute]
  );

  const handleRefresh = useCallback(() => {
    setBrowserAssistError(null);
    refresh();
    refreshCounts();
    refreshWorkQueue();
    refreshLinkedInOverview();
    setRecommendationSeed((current) => current + 1);
  }, [refresh, refreshCounts, refreshWorkQueue, refreshLinkedInOverview]);

  const queueCounts = useMemo(() => getThreadQueueCounts(filteredItems), [filteredItems]);
  const recommendedThreadInScope = useMemo(
    () => filteredItems.find((thread) => thread.thread_id === recommendedThreadId) ?? null,
    [filteredItems, recommendedThreadId]
  );
  const recommendedThread = useMemo(
    () => visibleQueueItems.find((thread) => thread.thread_id === recommendedThreadId) ?? null,
    [visibleQueueItems, recommendedThreadId]
  );
  const actionableThreads = queueCounts.needsResponse;
  const highPriorityThreads = queueCounts.highPriority;
  const waitingThreads = queueCounts.waiting;
  const connectedPlatformsCount = integrations.length;
  const extensionPanelPlatforms = useMemo(() => {
    const connectedPlatforms = integrations
      .map((integration) => normalizePlatform(integration.platform))
      .filter(Boolean);

    return connectedPlatforms.map((platform) => {
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
  }, [integrations, mergedPlatforms, workspacePreferenceMap]);
  const updatingExtensionPlatform = updatingWorkspacePlatform || updatingBrowserPlatform;
  const linkedInBrowserState = extensionPanelPlatforms.find((platform) => platform.platform === 'linkedin');
  const genericBrowserPlatforms = useMemo(
    () =>
      extensionPanelPlatforms.filter((platform) =>
        ['facebook', 'instagram', 'x', 'twitter'].includes(platform.platform)
      ),
    [extensionPanelPlatforms]
  );
  const getBrowserActionPlatform = useCallback((platform: string) => {
    const normalized = normalizePlatform(platform);
    return normalized === 'twitter' ? 'x' : normalized;
  }, []);
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
    return `${normalized} engagement actions require a verified browser-assisted send before OmniVyra can trust them.`;
  }, [getBrowserActionPlatform]);
  const extensionUserLabel =
    extensionAuth?.user?.email ||
    extensionAuth?.user?.name ||
    extensionAuth?.userId ||
    null;
  const hasAnyThreads = filteredItems.length > 0;
  const hasActionRequired = actionableThreads + highPriorityThreads + waitingThreads > 0;
  const hasBlockingError = Boolean(error);
  const showNoActivityState = !loading && !hasBlockingError && !authorFilter && !hasAnyThreads;
  const showAllCaughtUpState = !loading && !hasBlockingError && !authorFilter && hasAnyThreads && !hasActionRequired;

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
  }, [error, handleRefresh, hasBlockingError, router, showAllCaughtUpState, showNoActivityState]);

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
  }, [hasBlockingError, showAllCaughtUpState, showNoActivityState]);

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

    const isMarkedRead = (recommendedThreadInScope.unread_count ?? 0) <= 0;
    const isStillActionable = getThreadQueueGroup(recommendedThreadInScope) === 'Needs Response';
    if (!isMarkedRead && isStillActionable) return;

    setRecommendedThreadId(null);
    setRecommendationSetAt(null);
    setRecommendationIsFading(false);
  }, [recommendedThreadId, recommendedThreadInScope]);

  const handleMarkResolved = useCallback(() => {
    if (organizationId && selectedThread) {
      void recordEngagementEvent('opportunity_resolved', {
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

  const handleReplySent = useCallback(() => {
    refresh();
    refreshCounts();
    refreshWorkQueue();
    refreshMessages();
  }, [refresh, refreshCounts, refreshWorkQueue, refreshMessages]);

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
    attemptedExtensionAuthRef.current = attemptKey;

    const {
      data: { session },
    } = await getSupabaseBrowser().auth.getSession();

    let sessionToken = await getAuthToken();
    let userId = session?.user?.id ?? null;
    let expiresAt = session?.expires_at ? session.expires_at * 1000 : undefined;

    if (!sessionToken) {
      try {
        const params = new URLSearchParams({
          organization_id: organizationId,
          organizationId,
        });
        const sessionResponse = await apiFetch(`/api/extension/session?${params.toString()}`);
        const sessionBody = await sessionResponse.json().catch(() => ({}));
        if (!sessionResponse.ok || !sessionBody?.data?.sessionToken) {
          throw new Error(sessionBody.error || sessionBody.message || 'Unable to create extension session');
        }

        sessionToken = sessionBody.data.sessionToken;
        userId = sessionBody.data.userId || userId;
        expiresAt = sessionBody.data.expiresAt || expiresAt;
      } catch (sessionError) {
        attemptedExtensionAuthRef.current = null;
        console.warn('[engagement] extension session bootstrap failed:', sessionError);
        return false;
      }
    }

    if (!sessionToken || !userId) {
      attemptedExtensionAuthRef.current = null;
      return false;
    }

    try {
      await authenticateExtensionSession({
        userId,
        orgId: organizationId,
        sessionToken,
        apiBaseUrl: window.location.origin,
        expiresAt,
        user: {
          id: userId,
          name:
            (session?.user?.user_metadata?.full_name as string | undefined) ||
            (session?.user?.user_metadata?.name as string | undefined) ||
            null,
          email: session?.user?.email ?? null,
        },
      });
      return true;
    } catch (authError) {
      attemptedExtensionAuthRef.current = null;
      console.warn('[engagement] extension auto-auth failed:', authError);
      return false;
    }
  }, [
    authenticateExtensionSession,
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

  const getPreferredReplyMessage = useCallback(() => {
    if (messages.length === 0) return null;

    const sorted = [...messages].sort((a, b) => {
      const ta = new Date(a.platform_created_at ?? a.created_at ?? 0).getTime();
      const tb = new Date(b.platform_created_at ?? b.created_at ?? 0).getTime();
      return tb - ta;
    });

    return (
      sorted.find((message) => {
        const content = (message.content ?? '').trim();
        if (!content) return false;
        return !/^you\s*:/i.test(content);
      }) ??
      sorted[0] ??
      null
    );
  }, [messages]);

  const handleExecuteReply = useCallback(
    async ({
      threadId,
      messageId,
      platform,
      replyText,
    }: {
      threadId: string;
      messageId: string;
      platform: string;
      replyText: string;
    }) => {
      // All user-initiated reply sends go through the same API path. The
      // route rejects unsupported (platform, action) pairs at the boundary;
      // we trust its contract (status === 'executed' + platform response)
      // and do not push optimistic messages — success is only confirmed when
      // the platform acknowledges.
      const capability = resolveEngagementCapability(platform, 'reply');
      if (capability.status !== 'api_verified') {
        throw new Error(capability.reason ?? `Replies are not supported on ${platform}.`);
      }

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
        confirmed?: boolean;
        platform_id?: string | null;
        success?: boolean;
      };
      if (!res.ok) {
        throw new Error(json.error || res.statusText || 'Failed to send reply');
      }
      if (json.status !== 'executed' || json.success !== true) {
        throw new Error(json.error || 'Platform did not confirm the reply was sent');
      }

      await Promise.allSettled([refreshMessages(), refresh(), refreshCounts(), refreshWorkQueue()]);

      const niceLabel = platform === 'twitter' ? 'X' : platform.charAt(0).toUpperCase() + platform.slice(1);
      // Three visible states aligned to the server contract:
      //   confirmed + platform_id → "Confirmed by <platform> (id: …)"
      //   executed without id     → "Sent to <platform>. Awaiting confirmation."
      //   anything else thrown above as an error.
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
    [organizationId, refresh, refreshCounts, refreshMessages, refreshWorkQueue]
  );

  const handleSyncLinkedIn = useCallback(async () => {
    await syncLinkedInNow();
    refresh();
    refreshCounts();
    refreshWorkQueue();
  }, [refresh, refreshCounts, refreshWorkQueue, syncLinkedInNow]);

  const handleUseSuggestedReply = useCallback(
    (replyText: string) => {
      if (!selectedThread || typeof window === 'undefined') return;

      const token = `engagement-reply-${selectedThread.thread_id}-${Date.now()}`;
      sessionStorage.setItem(
        token,
        JSON.stringify({
          threadId: selectedThread.thread_id,
          text: replyText,
        })
      );

      setMobileTab('conversation');
      replaceEngagementRoute({
        thread: selectedThread.thread_id,
        prefill_reply: token,
      });
    },
    [replaceEngagementRoute, selectedThread]
  );

  const handleSendSuggestedReply = useCallback(
    async (replyText: string) => {
      if (!selectedThread) {
        throw new Error('Select a thread before sending a suggested reply');
      }

      const targetMessage = getPreferredReplyMessage();
      if (!targetMessage) {
        throw new Error('No target message is available for this thread');
      }

      setMobileTab('conversation');
      return await handleExecuteReply({
        threadId: selectedThread.thread_id,
        messageId: targetMessage.id,
        platform: targetMessage.platform ?? selectedThread.platform,
        replyText,
      });
    },
    [getPreferredReplyMessage, handleExecuteReply, selectedThread]
  );

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
    if (!browserAssistEnabled) return;
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

  const handleLike = useCallback(
    async (messageId: string, platform: string) => {
      if (!organizationId) return;
      try {
        const capability = resolveEngagementCapability(platform, 'like');
        if (capability.status !== 'api_verified') {
          throw new Error(capability.reason ?? `Like is not supported on ${platform}.`);
        }

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
          status?: string;
          confirmed?: boolean;
          platform_id?: string | null;
          success?: boolean;
        };
        if (!res.ok) {
          throw new Error(json.error || res.statusText || 'Failed to like message');
        }
        if (json.status !== 'executed' || json.success !== true) {
          throw new Error(json.error || 'Platform did not confirm the like was applied');
        }
        // We don't show a toast for likes, but the log distinction matters
        // for observability: confirmed like vs sent-but-unconfirmed like.
        if (!json.confirmed) {
          console.info('[engagement] like accepted by platform but no id returned', {
            messageId,
            platform,
          });
        }
        refreshMessages();
      } catch (err) {
        console.error('[engagement] like failed:', err);
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
            ? filteredItems.findIndex((t) => t.thread_id === selectedThread.thread_id)
            : -1;
          const next = idx < filteredItems.length - 1 ? filteredItems[idx + 1] : null;
          if (next) {
            handleSelectThread(next);
            setMobileTab('conversation');
          }
          break;
        }
        case 'k': {
          const idx = selectedThread
            ? filteredItems.findIndex((t) => t.thread_id === selectedThread.thread_id)
            : 0;
          const prev = idx > 0 ? filteredItems[idx - 1] : filteredItems[0] ?? null;
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
  }, [filteredItems, selectedThread, messages, handleSelectThread, handleLike]);

  const handleIgnore = useCallback(
    async (threadId: string) => {
      if (!organizationId) return;
      try {
        const res = await fetch('/api/engagement/thread/ignore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            organization_id: organizationId,
            thread_id: threadId,
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
      }
    },
    [organizationId, refresh, refreshCounts, refreshWorkQueue, replaceEngagementRoute]
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
              onClick={() => setActiveQueueFilter('High Priority')}
              aria-pressed={activeQueueFilter === 'High Priority'}
              className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm ${activeQueueFilter === 'High Priority' ? 'bg-amber-500 text-white' : 'bg-amber-50 text-amber-900'}`}
            >
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-700">High priority</span>
              <span className="text-base font-semibold text-slate-900">{highPriorityThreads}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveQueueFilter('Waiting')}
              aria-pressed={activeQueueFilter === 'Waiting'}
              className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm ${activeQueueFilter === 'Waiting' ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-700'}`}
            >
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Waiting</span>
              <span className="text-base font-semibold text-slate-900">{waitingThreads}</span>
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
              <span className="text-base font-semibold text-slate-900">{filteredItems.length}</span>
            </button>
          </div>

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
                onRefresh={handleRefreshExtensionPanel}
                onTogglePlatform={handleToggleExtensionPlatform}
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
          counts={counts}
          selectedPlatform={selectedPlatform}
          onSelectPlatform={handleSelectPlatform}
          workQueue={workQueue}
          platforms={integrations.map((integration) => integration.platform)}
          loading={countsLoading || workQueueLoading}
          className="mt-4"
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

      <div className="flex min-h-[56vh] flex-1 flex-col overflow-visible md:min-h-[60vh] md:flex-row lg:h-[calc(100vh-20rem)]">
        <section
          className={`flex flex-col overflow-hidden border-r border-slate-200 bg-white ${
            mobileTab !== 'threads' ? 'hidden md:flex' : 'flex'
          } md:min-w-0 md:max-w-[360px] md:flex-[0_0_30%]`}
        >
          <ThreadList
            items={filteredItems}
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
        </section>

        <section
          className={`relative flex flex-col overflow-hidden border-r border-slate-200 bg-slate-50 ${
            mobileTab !== 'conversation' ? 'hidden md:flex' : 'flex'
          } md:min-w-0 md:flex-[0_0_45%]`}
        >
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
          />
        </section>

        <>
          <section className="hidden min-w-[240px] shrink-0 flex-[0_0_25%] flex-col overflow-hidden border-l border-slate-200 bg-slate-50 lg:flex">
            <AIEngagementAssistant
              thread={selectedThread}
              messages={messages}
              organizationId={organizationId}
              recommendedThread={recommendedThread}
              onUseSuggestedReply={handleUseSuggestedReply}
              onSendSuggestedReply={handleSendSuggestedReply}
              onSelectThread={(threadId) => {
                handleSelectThreadById(threadId);
                setMobileTab('threads');
              }}
              onFilterByAuthor={(authorName, platform) => {
                setAuthorFilter({ authorName, platform });
                setMobileTab('threads');
              }}
            />
          </section>

          <div className="hidden shrink-0 items-center border-l border-slate-200 px-2 md:flex lg:hidden">
            <button
              type="button"
              onClick={() => setAiDrawerOpen(!aiDrawerOpen)}
              className="rounded px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
            >
              Copilot {aiDrawerOpen ? 'Hide' : 'Open'}
            </button>
          </div>

          {aiDrawerOpen && (
            <div className="fixed inset-0 z-50 hidden md:block lg:hidden" aria-modal>
              <div
                className="absolute inset-0 bg-black/30"
                onClick={() => setAiDrawerOpen(false)}
              />
              <div className="absolute right-0 top-0 bottom-0 flex w-full max-w-sm flex-col bg-white shadow-xl">
                <div className="flex items-center justify-between border-b border-slate-200 p-3">
                  <span className="font-medium">Engagement Copilot</span>
                  <button
                    type="button"
                    onClick={() => setAiDrawerOpen(false)}
                    className="p-1 text-slate-500 hover:text-slate-700"
                  >
                    Close
                  </button>
                </div>
                <div className="flex-1 overflow-hidden">
                  <AIEngagementAssistant
                    thread={selectedThread}
                    messages={messages}
                    organizationId={organizationId}
                    recommendedThread={recommendedThread}
                    onUseSuggestedReply={handleUseSuggestedReply}
                    onSendSuggestedReply={handleSendSuggestedReply}
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
                </div>
              </div>
            </div>
          )}
        </>

        <section
          className={`flex flex-col overflow-hidden bg-slate-50 md:hidden ${
            mobileTab !== 'assistant' ? 'hidden' : 'flex'
          }`}
        >
          <AIEngagementAssistant
            thread={selectedThread}
            messages={messages}
            organizationId={organizationId}
            recommendedThread={recommendedThread}
            onUseSuggestedReply={handleUseSuggestedReply}
            onSendSuggestedReply={handleSendSuggestedReply}
            onSelectThread={(threadId) => {
              handleSelectThreadById(threadId);
              setMobileTab('threads');
            }}
            onFilterByAuthor={(authorName, platform) => {
              setAuthorFilter({ authorName, platform });
              setMobileTab('threads');
            }}
          />
        </section>
      </div>
    </div>
  );
}
