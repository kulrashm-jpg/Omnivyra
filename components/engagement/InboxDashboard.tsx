/**
 * InboxDashboard - top-level layout: PlatformTabs, ThreadList, ThreadView.
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
import EmptyState from '@/components/shared/EmptyState';
import ExamplePreview from '@/components/shared/ExamplePreview';
import { trackActivationEvent } from '@/lib/analytics/activationEvents';

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

  const {
    counts,
    loading: countsLoading,
    error: countsError,
    refresh: refreshCounts,
  } = usePlatformCounts(organizationId);
  const {
    workQueue,
    loading: workQueueLoading,
    error: workQueueError,
    refresh: refreshWorkQueue,
  } = useWorkQueue(organizationId);
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
        organizationId,
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
  const actionableThreads = workQueue.total_actionable_threads ?? 0;
  const highPriorityThreads = useMemo(
    () =>
      (workQueue.platforms ?? []).reduce(
        (sum, platform) => sum + (platform.high_priority_threads ?? 0),
        0
      ),
    [workQueue]
  );
  const connectedPlatformsCount = integrations.length;
  const showReadinessEmptyState = !loading && !authorFilter && filteredItems.length === 0;
  const platformScopeLabel =
    selectedPlatform === 'all'
      ? 'all connected platforms'
      : integrations.find((integration) => integration.platform === selectedPlatform)?.label ||
        selectedPlatform;
  const readinessBlockers = readiness?.blockers ?? [];
  const topStatusMessage = readinessLoading
    ? 'Checking engagement readiness...'
    : readinessError
      ? readinessError
      : readinessBlockers[0] || null;
  const hasConnectedAccounts = (readiness?.active_social_accounts ?? integrations.length) > 0;
  const hasPublishedPosts = (readiness?.published_posts ?? 0) > 0;

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
            <div className="max-w-3xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-blue-700">
                Engagement Command Center
              </p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
                Stay ahead of conversations that need action
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                Review live replies, spot high-priority threads, and move from triage to response
                without leaving the workspace.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/engagement/leads"
                className="inline-flex items-center rounded-full border border-blue-200 bg-white px-4 py-2 text-sm font-medium text-blue-700 shadow-sm transition hover:border-blue-300 hover:bg-blue-50"
              >
                View Potential Leads
              </Link>
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

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Open Threads
              </p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{filteredItems.length}</p>
              <p className="mt-1 text-sm text-slate-600">
                active conversation{filteredItems.length === 1 ? '' : 's'} in the current view
              </p>
            </div>
            <div className="rounded-2xl border border-blue-200 bg-blue-50/90 px-4 py-3 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-700">
                Need Response
              </p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{actionableThreads}</p>
              <p className="mt-1 text-sm text-blue-900/80">
                thread{actionableThreads === 1 ? '' : 's'} waiting in the action queue
              </p>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50/90 px-4 py-3 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700">
                High Priority
              </p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{highPriorityThreads}</p>
              <p className="mt-1 text-sm text-amber-900/80">
                conversation{highPriorityThreads === 1 ? '' : 's'} deserve faster follow-up
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Connected Platforms
              </p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{connectedPlatformsCount}</p>
              <p className="mt-1 text-sm text-slate-600">
                platform{connectedPlatformsCount === 1 ? '' : 's'} feeding this inbox
              </p>
            </div>
          </div>
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
        {error && (
          <div className="mt-2 rounded bg-red-50 p-2 text-sm text-red-700" role="alert">
            {error}
          </div>
        )}
        {!error && (countsError || workQueueError) && (
          <div className="mt-2 rounded bg-amber-50 p-2 text-sm text-amber-800" role="status">
            {countsError || workQueueError}
          </div>
        )}
      </header>

      <WorkQueueSummary workQueue={workQueue} loading={workQueueLoading} />

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

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        <section
          className={`flex flex-col overflow-hidden border-r border-slate-200 bg-white ${
            mobileTab !== 'threads' ? 'hidden md:flex' : 'flex'
          } md:min-w-0 md:max-w-[360px] md:flex-[0_0_30%]`}
        >
          <ThreadList
            items={filteredItems}
            loading={loading}
            selectedThreadId={selectedThread?.thread_id}
            onSelectThread={(thread) => {
              handleSelectThread(thread);
              setMobileTab('conversation');
            }}
            emptyMessage={
              authorFilter
                ? `No threads from ${authorFilter.authorName} on ${authorFilter.platform}.`
                : 'No threads in inbox.'
            }
            emptyState={
              showReadinessEmptyState ? (
                <div className="w-full max-w-2xl space-y-4">
                  <EmptyState
                    tone={hasConnectedAccounts && hasPublishedPosts ? 'partial' : 'first-time'}
                    title={
                      hasConnectedAccounts
                        ? hasPublishedPosts
                          ? 'You are almost there'
                          : 'Create your first post'
                        : 'Track your first interaction'
                    }
                    description={
                      hasConnectedAccounts
                        ? hasPublishedPosts
                          ? `The inbox is scoped to ${platformScopeLabel}. Publish one real post, then refresh to pull the first live conversation into this workspace.`
                          : 'Your channels are connected. Publish one post and the first replies will start flowing into the inbox here.'
                        : 'Connect a social account first so comments, replies, and lead signals can flow into one place.'
                    }
                    primaryAction={{
                      label: hasConnectedAccounts
                        ? hasPublishedPosts
                          ? 'Refresh inbox'
                          : 'Create your first post'
                        : 'Connect your first channel',
                      onClick: () => {
                        trackActivationEvent('empty_state_primary_clicked', {
                          accountId: organizationId,
                          context: 'engagement_inbox',
                          meta: {
                            connected_accounts: readiness?.active_social_accounts ?? integrations.length,
                            published_posts: readiness?.published_posts ?? 0,
                          },
                        });
                        if (!hasConnectedAccounts) {
                          router.push('/social-platforms');
                          return;
                        }
                        if (!hasPublishedPosts) {
                          router.push('/content-studio?sample=1');
                          return;
                        }
                        handleRefresh();
                      },
                    }}
                    secondaryAction={{
                      label: 'Try with sample data',
                      onClick: () => {
                        trackActivationEvent('sample_used', {
                          accountId: organizationId,
                          context: 'engagement_inbox',
                        });
                        router.push('/engagement/leads?sample=1');
                      },
                    }}
                    examplePreview={<ExamplePreview variant="engagement" />}
                  />

                  {topStatusMessage ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      {topStatusMessage}
                    </div>
                  ) : null}

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                      <div className="text-slate-500">Connected Accounts</div>
                      <div className="mt-1 text-lg font-semibold text-slate-900">
                        {readiness?.active_social_accounts ?? integrations.length}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                      <div className="text-slate-500">Published Posts</div>
                      <div className="mt-1 text-lg font-semibold text-slate-900">
                        {readiness?.published_posts ?? 0}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                      <div className="text-slate-500">Raw Comments</div>
                      <div className="mt-1 text-lg font-semibold text-slate-900">
                        {readiness?.raw_comments ?? 0}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                      <div className="text-slate-500">Unified Threads</div>
                      <div className="mt-1 text-lg font-semibold text-slate-900">
                        {readiness?.threads ?? totalThreads}
                      </div>
                    </div>
                  </div>
                </div>
              ) : undefined
            }
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
            onRefresh={refreshMessages}
            onReplySent={handleReplySent}
            onLike={handleLike}
            onIgnore={handleIgnore}
            onMarkResolved={handleMarkResolved}
          />
        </section>

        <>
          <section className="hidden min-w-[200px] shrink-0 flex-[0_0_25%] flex-col overflow-hidden border-l border-slate-200 bg-slate-50 lg:flex">
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

        <section
          className={`flex flex-col overflow-hidden bg-slate-50 md:hidden ${
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
