/**
 * InboxDashboard — top-level layout: PlatformTabs, ThreadList, ThreadView.
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { PlatformTabs } from '@/components/engagement/PlatformTabs';
import { ThreadList } from '@/components/engagement/ThreadList';
import { ThreadView } from '@/components/engagement/ThreadView';
import { AIEngagementAssistant } from '@/components/engagement/AIEngagementAssistant';
import { WorkQueueSummary } from '@/components/engagement/WorkQueueSummary';
import { useEngagementInbox } from '@/hooks/useEngagementInbox';
import { usePlatformCounts } from '@/hooks/usePlatformCounts';
import { useWorkQueue } from '@/hooks/useWorkQueue';
import { useCompanyIntegrations } from '@/hooks/useCompanyIntegrations';
import { useEngagementMessages } from '@/hooks/useEngagementMessages';
import type { InboxThread } from '@/hooks/useEngagementInbox';
import { recordEngagementEvent } from '@/lib/engagementTelemetry';

type EngagementReadiness = {
  connected_platforms: string[];
  active_social_accounts: number;
  published_posts: number;
  ingestion_candidates: number;
  raw_comments: number;
  messages: number;
  threads: number;
  blockers: string[];
};

export interface InboxDashboardProps {
  organizationId: string;
  className?: string;
}

export function InboxDashboard({
  organizationId,
  className = '',
}: InboxDashboardProps) {
  const router = useRouter();
  const [selectedPlatform, setSelectedPlatform] = useState<string>('all');
  const [selectedThread, setSelectedThread] = useState<InboxThread | null>(null);
  const [mobileTab, setMobileTab] = useState<'threads' | 'conversation' | 'assistant'>('threads');
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false);
  const [authorFilter, setAuthorFilter] = useState<{ authorName: string; platform: string } | null>(
    null
  );
  const [readiness, setReadiness] = useState<EngagementReadiness | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [readinessError, setReadinessError] = useState<string | null>(null);

  const filters = useMemo(
    () => ({
      platform: selectedPlatform && selectedPlatform !== 'all' ? selectedPlatform : undefined,
      priority: undefined as 'high' | 'medium' | 'low' | undefined,
    }),
    [selectedPlatform]
  );

  const { counts, loading: countsLoading, error: countsError, refresh: refreshCounts } = usePlatformCounts(organizationId);
  const { workQueue, loading: workQueueLoading, error: workQueueError, refresh: refreshWorkQueue } = useWorkQueue(organizationId);
  const { platforms: integrations } = useCompanyIntegrations(organizationId);
  const { items, loading, error, refresh } = useEngagementInbox(organizationId, filters);
  const { messages, loading: messagesLoading, refresh: refreshMessages } = useEngagementMessages(
    organizationId,
    selectedThread?.thread_id ?? null
  );

  const threadIdFromUrl = typeof router.query.thread === 'string' ? router.query.thread : null;

  const filteredItems = useMemo((): InboxThread[] => {
    if (!authorFilter) return items;
    return items.filter(
      (t) =>
        (t.author_name === authorFilter.authorName ||
          t.author_username === authorFilter.authorName) &&
        t.platform === authorFilter.platform
    );
  }, [items, authorFilter]);

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

  const fetchReadiness = useCallback(async () => {
    if (!organizationId) {
      setReadiness(null);
      setReadinessError(null);
      setReadinessLoading(false);
      return;
    }

    setReadinessLoading(true);
    setReadinessError(null);
    try {
      const params = new URLSearchParams({
        organization_id: organizationId,
        organizationId: organizationId,
      });
      const res = await fetch(`/api/engagement/readiness?${params.toString()}`, {
        credentials: 'include',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || body.message || 'Failed to load engagement readiness');
      }
      setReadiness(body as EngagementReadiness);
    } catch (err) {
      setReadiness(null);
      setReadinessError(err instanceof Error ? err.message : 'Failed to load engagement readiness');
    } finally {
      setReadinessLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void fetchReadiness();
  }, [fetchReadiness]);

  const handleSelectThread = useCallback(
    (thread: InboxThread) => {
      setSelectedThread(thread);
      router.replace(
        { pathname: '/engagement', query: { thread: thread.thread_id } },
        undefined,
        { shallow: true }
      );
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
    [router, organizationId]
  );

  const handleSelectThreadById = useCallback(
    (threadId: string) => {
      const t = items.find((x) => x.thread_id === threadId);
      if (t) {
        handleSelectThread(t);
        setMobileTab('conversation');
      }
    },
    [items, handleSelectThread]
  );

  const handleSelectPlatform = useCallback(
    (platform: string) => {
      setSelectedThread(null);
      setSelectedPlatform(platform);
      router.replace({ pathname: '/engagement' }, undefined, { shallow: true });
    },
    [router]
  );

  const handleRefresh = useCallback(() => {
    refresh();
    refreshCounts();
    refreshWorkQueue();
    fetchReadiness();
  }, [refresh, refreshCounts, refreshWorkQueue, fetchReadiness]);

  const totalThreads = useMemo(
    () => Object.values(counts).reduce((sum, entry) => sum + (entry?.thread_count ?? 0), 0),
    [counts]
  );
  const connectedLabels = useMemo(
    () => integrations.map((integration) => integration.label),
    [integrations]
  );
  const showReadinessEmptyState =
    !loading && !authorFilter && filteredItems.length === 0;
  const platformScopeLabel = selectedPlatform === 'all'
    ? 'all connected platforms'
    : integrations.find((integration) => integration.platform === selectedPlatform)?.label || selectedPlatform;
  const captureChecklist = useMemo(() => {
    const base = [
      'Comments and replies on published posts from connected platforms',
      'Thread-level inbox items grouped by platform, priority, and conversation type',
      'AI-assisted response suggestions, lead signals, and next-action guidance',
    ];
    if (connectedLabels.length > 0) {
      return base.map((item, index) =>
        index === 0 ? `${item}. Current connection scope: ${connectedLabels.join(', ')}.` : item
      );
    }
    return base;
  }, [connectedLabels]);
  const testChecklist = useMemo(() => {
    if (connectedLabels.length === 0) {
      return [
        'Connect at least one social account in Social Platforms.',
        'Publish a post from the connected workspace so the platform creates a real post ID.',
        'Create an external comment or reply on that published post, then refresh this page.',
      ];
    }

    return [
      `Publish one post from ${connectedLabels[0]} using this workspace connection.`,
      'Add a real external comment or reply on that post from another account.',
      'Refresh Engagement Center and confirm the thread appears under All and the platform tab.',
      'Open the thread and verify AI recommendations, reply, and like actions are available.',
    ];
  }, [connectedLabels]);
  const readinessBlockers = readiness?.blockers ?? [];
  const topStatusMessage = readinessLoading
    ? 'Checking engagement readiness...'
    : readinessError
      ? readinessError
      : readinessBlockers[0] || null;

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
  }, [organizationId, selectedThread, refresh, refreshCounts, refreshWorkQueue, refreshMessages]);

  const handleReplySent = useCallback(() => {
    refresh();
    refreshCounts();
    refreshWorkQueue();
    refreshMessages();
  }, [refresh, refreshCounts, refreshWorkQueue, refreshMessages]);

  const handleLike = useCallback(
    async (messageId: string, platform: string) => {
      if (!organizationId) return;
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
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || res.statusText);
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
          setAiDrawerOpen((o) => !o);
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
  }, [
    filteredItems,
    selectedThread,
    messages,
    handleSelectThread,
    handleLike,
  ]);

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
        router.replace({ pathname: '/engagement' }, undefined, { shallow: true });
        refresh();
        refreshCounts();
        refreshWorkQueue();
      } catch (err) {
        console.error('[engagement] ignore failed:', err);
      }
    },
    [organizationId, refresh, refreshCounts, refreshWorkQueue, router]
  );

  if (!organizationId) {
    return (
      <div className={`flex flex-col h-full items-center justify-center p-8 text-slate-500 ${className}`}>
        Select a company to view the engagement inbox.
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full ${className}`}>
      <header className="shrink-0 px-4 py-3 border-b border-slate-200 bg-white">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Engagement Center</h1>
            <p className="mt-1 text-sm text-slate-600">
              Manage conversations, replies, and next actions from your connected platforms.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/engagement/leads" className="text-sm text-blue-600 hover:text-blue-800">
              Potential Leads
            </Link>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={loading || countsLoading || workQueueLoading}
              className="text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50"
            >
              Refresh
            </button>
          </div>
        </div>
        <PlatformTabs
          counts={counts}
          selectedPlatform={selectedPlatform}
          onSelectPlatform={handleSelectPlatform}
          workQueue={workQueue}
          platforms={integrations.map((i) => i.platform)}
          loading={countsLoading || workQueueLoading}
          className="mt-3"
        />
        {error && (
          <div className="mt-2 p-2 rounded bg-red-50 text-red-700 text-sm" role="alert">
            {error}
          </div>
        )}
        {!error && (countsError || workQueueError) && (
          <div className="mt-2 p-2 rounded bg-amber-50 text-amber-800 text-sm" role="status">
            {countsError || workQueueError}
          </div>
        )}
      </header>

      <WorkQueueSummary workQueue={workQueue} loading={workQueueLoading} />

      {/* Mobile tab bar (< 768px) */}
      <div className="md:hidden shrink-0 flex border-b border-slate-200 bg-white">
        <button
          type="button"
          onClick={() => setMobileTab('threads')}
          className={`flex-1 px-4 py-2 text-sm font-medium ${
            mobileTab === 'threads' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-600'
          }`}
        >
          Threads
        </button>
        <button
          type="button"
          onClick={() => setMobileTab('conversation')}
          className={`flex-1 px-4 py-2 text-sm font-medium ${
            mobileTab === 'conversation' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-600'
          }`}
        >
          Conversation
        </button>
        <button
          type="button"
          onClick={() => setMobileTab('assistant')}
          className={`flex-1 px-4 py-2 text-sm font-medium ${
            mobileTab === 'assistant' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-600'
          }`}
        >
          AI
        </button>
      </div>

      <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
        {/* ThreadList - hidden on mobile when other tab selected; 25% on md, 30% on lg */}
        <section
          className={`flex flex-col overflow-hidden border-r border-slate-200 bg-white ${
            mobileTab !== 'threads' ? 'hidden md:flex' : 'flex'
          } md:flex-[0_0_30%] md:min-w-0 md:max-w-[360px]`}
        >
          <ThreadList
            items={filteredItems}
            loading={loading}
            selectedThreadId={selectedThread?.thread_id}
            onSelectThread={(t) => {
              handleSelectThread(t);
              setMobileTab('conversation');
            }}
            emptyMessage={
              authorFilter
                ? `No threads from ${authorFilter.authorName} on ${authorFilter.platform}.`
                : 'No threads in inbox.'
            }
            emptyState={
              showReadinessEmptyState ? (
                <div className="w-full max-w-md rounded-xl border border-slate-200 bg-slate-50 p-4 text-left text-sm text-slate-600 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-slate-900">
                        Engagement is connected, but no activity has reached the inbox yet.
                      </h3>
                      <p className="mt-1 text-sm text-slate-600">
                        The current view is scoped to {platformScopeLabel}. Once real engagement is pulled in, the thread list will populate here.
                      </p>
                    </div>
                    <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-700 border border-slate-200">
                      {totalThreads} thread{totalThreads === 1 ? '' : 's'}
                    </span>
                  </div>

                  {topStatusMessage && (
                    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      {topStatusMessage}
                    </div>
                  )}

                  <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg bg-white p-3 border border-slate-200">
                      <div className="text-slate-500">Connected Accounts</div>
                      <div className="mt-1 text-lg font-semibold text-slate-900">
                        {readiness?.active_social_accounts ?? integrations.length}
                      </div>
                    </div>
                    <div className="rounded-lg bg-white p-3 border border-slate-200">
                      <div className="text-slate-500">Published Posts</div>
                      <div className="mt-1 text-lg font-semibold text-slate-900">
                        {readiness?.published_posts ?? 0}
                      </div>
                    </div>
                    <div className="rounded-lg bg-white p-3 border border-slate-200">
                      <div className="text-slate-500">Raw Comments</div>
                      <div className="mt-1 text-lg font-semibold text-slate-900">
                        {readiness?.raw_comments ?? 0}
                      </div>
                    </div>
                    <div className="rounded-lg bg-white p-3 border border-slate-200">
                      <div className="text-slate-500">Unified Threads</div>
                      <div className="mt-1 text-lg font-semibold text-slate-900">
                        {readiness?.threads ?? totalThreads}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      What This Captures Today
                    </div>
                    <ul className="mt-2 space-y-2 text-sm text-slate-700">
                      {captureChecklist.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="mt-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Best Validation Flow
                    </div>
                    <ol className="mt-2 space-y-2 text-sm text-slate-700 list-decimal list-inside">
                      {testChecklist.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ol>
                  </div>

                  {readinessBlockers.length > 1 && (
                    <div className="mt-4">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Remaining Gaps
                      </div>
                      <ul className="mt-2 space-y-2 text-sm text-slate-700">
                        {readinessBlockers.slice(1).map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : undefined
            }
            authorFilter={authorFilter}
            onClearAuthorFilter={authorFilter ? () => setAuthorFilter(null) : undefined}
          />
        </section>

        {/* ThreadView / Conversation - tablet: 75%, desktop: 45%; mobile: tab */}
        <section
          className={`relative flex flex-col overflow-hidden bg-slate-50 border-r border-slate-200 ${
            mobileTab !== 'conversation' ? 'hidden md:flex' : 'flex'
          } md:flex-[0_0_45%] md:min-w-0`}
        >
          <ThreadView
            thread={selectedThread}
            messages={messages}
            loading={messagesLoading && messages.length === 0}
            organizationId={organizationId}
            onRefresh={refreshMessages}
            onReplySent={handleReplySent}
            onLike={handleLike}
            onIgnore={handleIgnore}
            onMarkResolved={handleMarkResolved}
          />
        </section>

        {/* AI Assistant - desktop lg: 25% panel; md: drawer overlay; mobile: tab */}
        <>
          <section
            className={`hidden lg:flex flex-col overflow-hidden bg-slate-50 border-l border-slate-200 shrink-0 flex-[0_0_25%] min-w-[200px] ${
              mobileTab !== 'assistant' ? '' : ''
            }`}
          >
            <AIEngagementAssistant
              thread={selectedThread}
              messages={messages}
              organizationId={organizationId}
              items={items}
              onSelectThread={handleSelectThreadById}
              onFilterByAuthor={(authorName, platform) => {
                setAuthorFilter({ authorName, platform });
                setMobileTab('threads');
              }}
            />
          </section>
          {/* Tablet AI drawer trigger */}
          <div className="hidden md:flex lg:hidden shrink-0 border-l border-slate-200 items-center px-2">
            <button
              type="button"
              onClick={() => setAiDrawerOpen(!aiDrawerOpen)}
              className="p-2 text-sm text-slate-600 hover:bg-slate-100 rounded"
            >
              Copilot {aiDrawerOpen ? '▼' : '▶'}
            </button>
          </div>
          {/* Tablet AI drawer overlay */}
          {aiDrawerOpen && (
            <div
              className="hidden md:block lg:hidden fixed inset-0 z-50"
              aria-modal
            >
              <div
                className="absolute inset-0 bg-black/30"
                onClick={() => setAiDrawerOpen(false)}
              />
              <div className="absolute right-0 top-0 bottom-0 w-full max-w-sm bg-white shadow-xl flex flex-col">
                <div className="shrink-0 flex items-center justify-between p-3 border-b border-slate-200">
                  <span className="font-medium">Engagement Copilot</span>
                  <button
                    type="button"
                    onClick={() => setAiDrawerOpen(false)}
                    className="p-1 text-slate-500 hover:text-slate-700"
                  >
                    ✕
                  </button>
                </div>
                <div className="flex-1 overflow-hidden">
                <AIEngagementAssistant
                  thread={selectedThread}
                  messages={messages}
                  organizationId={organizationId}
                  items={items}
                  onSelectThread={handleSelectThreadById}
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
        {/* Mobile: AI panel when tab selected */}
        <section
          className={`md:hidden flex flex-col overflow-hidden bg-slate-50 ${
            mobileTab !== 'assistant' ? 'hidden' : 'flex'
          }`}
        >
          <AIEngagementAssistant
            thread={selectedThread}
            messages={messages}
            organizationId={organizationId}
            items={items}
            onSelectThread={handleSelectThreadById}
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
