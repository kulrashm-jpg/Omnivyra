/**
 * InboxDashboard — top-level layout: PlatformTabs, ThreadList, ThreadView.
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { PlatformTabs } from '@/components/engagement/PlatformTabs';
import { OpportunityRadar, type OpportunityRadarCategory } from '@/components/engagement/OpportunityRadar';
import { ThreadList } from '@/components/engagement/ThreadList';
import { ThreadView } from '@/components/engagement/ThreadView';
import { AIEngagementAssistant } from '@/components/engagement/AIEngagementAssistant';
import { WorkQueueSummary } from '@/components/engagement/WorkQueueSummary';
import { ConversationMonitorHeader } from '@/components/engagement/ConversationMonitorHeader';
import { TrendingTopicsPanel, type TrendingTopic } from '@/components/engagement/TrendingTopicsPanel';
import { TopicPlaybookPanel } from '@/components/engagement/TopicPlaybookPanel';
import { useEngagementInbox } from '@/hooks/useEngagementInbox';
import { usePlatformCounts } from '@/hooks/usePlatformCounts';
import { useWorkQueue } from '@/hooks/useWorkQueue';
import { useCompanyIntegrations } from '@/hooks/useCompanyIntegrations';
import { useEngagementMessages } from '@/hooks/useEngagementMessages';
import type { InboxThread } from '@/hooks/useEngagementInbox';
import { recordEngagementEvent } from '@/lib/engagementTelemetry';

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
  const [selectedOpportunityCategory, setSelectedOpportunityCategory] = useState<OpportunityRadarCategory | null>(null);
  const [selectedTopic, setSelectedTopic] = useState<TrendingTopic | null>(null);
  const [mobileTab, setMobileTab] = useState<'threads' | 'conversation' | 'assistant'>('threads');
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false);
  const [trendingTopicsCount, setTrendingTopicsCount] = useState(0);
  const [authorFilter, setAuthorFilter] = useState<{ authorName: string; platform: string } | null>(
    null
  );

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
    let list = items;
    if (authorFilter) {
      list = list.filter(
        (t) =>
          (t.author_name === authorFilter.authorName ||
            t.author_username === authorFilter.authorName) &&
          t.platform === authorFilter.platform
      );
    }
    if (!selectedOpportunityCategory) return list;
    return list.filter((t) => {
      const cat = (t.classification_category ?? '').toLowerCase();
      switch (selectedOpportunityCategory) {
        case 'buying_intent':
          return t.lead_detected || (t.lead_score ?? 0) > 0;
        case 'competitor_complaints':
          return cat === 'competitor_complaint' || cat === 'problem_discussion';
        case 'product_comparisons':
          return cat === 'product_comparison';
        case 'recommendation_requests':
          return cat === 'recommendation_request';
        case 'general_opportunities':
          return (
            t.opportunity_indicator &&
            !t.lead_detected &&
            (t.lead_score ?? 0) <= 0 &&
            cat !== 'competitor_complaint' &&
            cat !== 'problem_discussion' &&
            cat !== 'product_comparison' &&
            cat !== 'recommendation_request'
          );
        default:
          return true;
      }
    });
  }, [items, selectedOpportunityCategory, authorFilter]);

  useEffect(() => {
    if (!threadIdFromUrl || items.length === 0) return;
    const match = items.find((t) => t.thread_id === threadIdFromUrl);
    if (match) setSelectedThread(match);
  }, [threadIdFromUrl, items]);

  useEffect(() => {
    if ((!selectedOpportunityCategory && !selectedTopic) || !selectedThread) return;
    const stillInFilter = filteredItems.some((t) => t.thread_id === selectedThread.thread_id);
    if (!stillInFilter) setSelectedThread(null);
  }, [selectedOpportunityCategory, selectedTopic, selectedThread, filteredItems]);

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
  }, [refresh, refreshCounts, refreshWorkQueue]);

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
          <h1 className="text-xl font-semibold text-slate-900">Engagement Command Center</h1>
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
        <OpportunityRadar
          organizationId={organizationId}
          selectedCategory={selectedOpportunityCategory}
          onSelectCategory={setSelectedOpportunityCategory}
        />
        {error && (
          <div className="mt-2 p-2 rounded bg-red-50 text-red-700 text-sm" role="alert">
            {error}
          </div>
        )}
      </header>

      <WorkQueueSummary workQueue={workQueue} loading={workQueueLoading} />

      <ConversationMonitorHeader
        items={filteredItems}
        loading={loading}
        trendingTopicsCount={trendingTopicsCount}
      />

      <TrendingTopicsPanel
        organizationId={organizationId}
        selectedTopic={selectedTopic}
        onSelectTopic={setSelectedTopic}
        windowHours={24}
        onTopicsLoaded={(topics) => setTrendingTopicsCount(topics.length)}
      />

      <TopicPlaybookPanel
        organizationId={organizationId}
        selectedTopic={selectedTopic}
      />

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
                : selectedTopic
                  ? 'No threads match this topic.'
                  : selectedOpportunityCategory
                    ? 'No threads match this opportunity filter.'
                    : 'No threads in inbox.'
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
              AI Insights {aiDrawerOpen ? '▼' : '▶'}
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
                  <span className="font-medium">AI Engagement Assistant</span>
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
