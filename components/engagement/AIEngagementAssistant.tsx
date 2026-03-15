/**
 * AIEngagementAssistant — right panel in Engagement Command Center.
 * Connects to backend intelligence: opportunities, leads, strategies, reply intelligence.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { InboxThread } from '@/hooks/useEngagementInbox';
import type { EngagementMessage } from '@/hooks/useEngagementMessages';
import { NetworkExpansionPanel } from '@/components/engagement/NetworkExpansionPanel';
import { InfluencerPanel } from '@/components/engagement/InfluencerPanel';
import { InsightPanel } from '@/components/engagement/InsightPanel';
import { BuyerIntentPanel } from '@/components/engagement/BuyerIntentPanel';
import { ContentInsightsPanel } from '@/components/engagement/ContentInsightsPanel';
import { ContentOpportunitiesPanel, type ContentOpportunity } from '@/components/engagement/ContentOpportunitiesPanel';

export interface AIEngagementAssistantProps {
  thread: InboxThread | null;
  messages: EngagementMessage[];
  organizationId: string | null;
  items?: InboxThread[];
  onSelectThread?: (threadId: string) => void;
  onFilterByAuthor?: (authorName: string, platform: string) => void;
  className?: string;
}

type Opportunity = { id: string; opportunity_type: string; confidence_score: number; priority_score: number };
type Lead = { thread_id: string; author_name: string | null; lead_intent: string; lead_score: number; confidence_score: number | null };
type Strategy = { strategy_type: string; engagement_score: number; confidence_score: number };
type ReplyIntelligence = { sample_reply: string; engagement_score: number; reply_category?: string };

const QUESTION_PATTERNS = /\b(how|what|when|where|why|which|who|can you|does it|is there)\b|\?/i;
const THEME_WORDS = /\b(problem|issue|question|help|recommend|suggest|best|comparison|compare|versus|vs)\b/gi;

function extractContentOpportunities(messages: EngagementMessage[]): string[] {
  const opportunities: string[] = [];
  const themes = new Map<string, number>();

  for (const msg of messages) {
    const content = (msg.content ?? '').toString().trim();
    if (!content || content.length < 10) continue;

    if (QUESTION_PATTERNS.test(content)) {
      const q = content.slice(0, 120).trim();
      if (q && !opportunities.includes(q)) opportunities.push(q);
    }

    const matches = content.match(THEME_WORDS);
    if (matches) {
      for (const m of matches) {
        const key = m.toLowerCase();
        themes.set(key, (themes.get(key) ?? 0) + 1);
      }
    }
  }

  const repeatedThemes = [...themes.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([word]) => `Theme: "${word}" mentioned multiple times`);

  return [...opportunities, ...repeatedThemes];
}

export const AIEngagementAssistant = React.memo(function AIEngagementAssistant({
  thread,
  messages,
  organizationId,
  items = [],
  onSelectThread,
  onFilterByAuthor,
  className = '',
}: AIEngagementAssistantProps) {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [opportunitiesLoading, setOpportunitiesLoading] = useState(false);
  const [opportunitiesError, setOpportunitiesError] = useState<string | null>(null);

  const [leads, setLeads] = useState<Lead[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [leadsError, setLeadsError] = useState<string | null>(null);

  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [strategiesLoading, setStrategiesLoading] = useState(false);
  const [strategiesError, setStrategiesError] = useState<string | null>(null);

  const [replies, setReplies] = useState<ReplyIntelligence[]>([]);
  const [repliesLoading, setRepliesLoading] = useState(false);
  const [repliesError, setRepliesError] = useState<string | null>(null);

  const [influencerCount, setInfluencerCount] = useState(0);
  const [insightCount, setInsightCount] = useState(0);
  const [buyerIntentCount, setBuyerIntentCount] = useState(0);
  const [contentOpportunitiesData, setContentOpportunitiesData] = useState<ContentOpportunity[]>([]);
  const [contentOpportunitiesLoading, setContentOpportunitiesLoading] = useState(false);
  const [contentOpportunitiesError, setContentOpportunitiesError] = useState<string | null>(null);

  const [opportunityInsights, setOpportunityInsights] = useState<{
    top_performing_opportunity_type: string;
    highest_approval_opportunity_type: string;
    topics_generating_campaigns: string[];
  } | null>(null);
  const [opportunityInsightsLoading, setOpportunityInsightsLoading] = useState(false);

  const contentOpportunities = useMemo(() => extractContentOpportunities(messages), [messages]);

  const networkSignalsCount = useMemo(() => {
    const HIGH = 50;
    const ids = new Set<string>();
    [...items].sort((a, b) => (b.message_count ?? 0) - (a.message_count ?? 0)).slice(0, 5).forEach((t) => ids.add(t.thread_id));
    [...items].sort((a, b) => {
      const ta = a.latest_message_time ? new Date(a.latest_message_time).getTime() : 0;
      const tb = b.latest_message_time ? new Date(b.latest_message_time).getTime() : 0;
      return tb - ta;
    }).slice(0, 5).forEach((t) => ids.add(t.thread_id));
    items.filter((t) => t.lead_detected || (t.lead_score ?? 0) > 0).slice(0, 5).forEach((t) => ids.add(t.thread_id));
    items.filter((t) => (t.priority_score ?? 0) >= HIGH).sort((a, b) => (b.priority_score ?? 0) - (a.priority_score ?? 0)).slice(0, 5).forEach((t) => ids.add(t.thread_id));
    return ids.size;
  }, [items]);

  const contentInsightsCount = useMemo(() => {
    const Q = /\b(how|why|what|best way|recommend)\b/i;
    const P = /\b(problem|issue|struggling|help|looking for)\b/gi;
    const F = /\b(feature request|wish it had|would be nice)\b/i;
    const qSet = new Set<string>();
    const pMap = new Map<string, number>();
    const fSet = new Set<string>();
    for (const msg of messages) {
      const c = (msg.content ?? '').toString().trim();
      if (!c || c.length < 10) continue;
      if (Q.test(c)) qSet.add(c.slice(0, 100).trim());
      const pm = c.match(P);
      if (pm) for (const x of pm) pMap.set(x.toLowerCase(), (pMap.get(x.toLowerCase()) ?? 0) + 1);
      if (F.test(c)) fSet.add('f' + c.slice(0, 100).trim());
    }
    return Math.min(15, qSet.size + pMap.size + fSet.size);
  }, [messages]);

  const fetchOpportunities = useCallback(async () => {
    if (!organizationId || !thread?.thread_id) {
      setOpportunitiesLoading(false);
      return;
    }
    setOpportunitiesLoading(true);
    setOpportunitiesError(null);
    try {
      const res = await fetch(
        `/api/engagement/opportunities?thread_id=${encodeURIComponent(thread.thread_id)}&organization_id=${encodeURIComponent(organizationId)}`,
        { credentials: 'include' }
      );
      if (!res.ok) throw new Error(res.statusText);
      const json = await res.json();
      setOpportunities(json.opportunities ?? []);
    } catch (e) {
      setOpportunitiesError((e as Error).message);
      setOpportunities([]);
    } finally {
      setOpportunitiesLoading(false);
    }
  }, [organizationId, thread?.thread_id]);

  const fetchLeads = useCallback(async () => {
    if (!organizationId) {
      setLeadsLoading(false);
      return;
    }
    setLeadsLoading(true);
    setLeadsError(null);
    try {
      const res = await fetch(
        `/api/engagement/leads?organization_id=${encodeURIComponent(organizationId)}`,
        { credentials: 'include' }
      );
      if (!res.ok) throw new Error(res.statusText);
      const json = await res.json();
      const allLeads = json.leads ?? [];
      const threadLeads = thread?.thread_id
        ? allLeads.filter((l: { thread_id: string }) => l.thread_id === thread.thread_id)
        : [];
      setLeads(
        threadLeads.map((l: { author_name?: string; lead_intent?: string; lead_score?: number; confidence_score?: number }) => ({
          thread_id: thread!.thread_id,
          author_name: l.author_name ?? null,
          lead_intent: l.lead_intent ?? 'unknown',
          lead_score: l.lead_score ?? 0,
          confidence_score: l.confidence_score ?? null,
        }))
      );
    } catch (e) {
      setLeadsError((e as Error).message);
      setLeads([]);
    } finally {
      setLeadsLoading(false);
    }
  }, [organizationId, thread?.thread_id]);

  const fetchStrategies = useCallback(async () => {
    if (!organizationId || !thread?.classification_category) {
      setStrategiesLoading(false);
      setStrategies([]);
      return;
    }
    setStrategiesLoading(true);
    setStrategiesError(null);
    try {
      const params = new URLSearchParams({
        organization_id: organizationId,
        classification: thread.classification_category,
        sentiment: (thread.sentiment ?? 'neutral').toString(),
      });
      const res = await fetch(`/api/engagement/strategies?${params.toString()}`, { credentials: 'include' });
      if (!res.ok) throw new Error(res.statusText);
      const json = await res.json();
      setStrategies(json.strategies ?? []);
    } catch (e) {
      setStrategiesError((e as Error).message);
      setStrategies([]);
    } finally {
      setStrategiesLoading(false);
    }
  }, [organizationId, thread?.classification_category, thread?.sentiment]);

  const fetchReplies = useCallback(async () => {
    if (!organizationId) {
      setRepliesLoading(false);
      return;
    }
    setRepliesLoading(true);
    setRepliesError(null);
    try {
      let url = `/api/engagement/reply-intelligence?organization_id=${encodeURIComponent(organizationId)}`;
      if (thread?.classification_category) {
        url += `&classification_category=${encodeURIComponent(thread.classification_category)}`;
      }
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error(res.statusText);
      const json = await res.json();
      setReplies(json.replies ?? []);
    } catch (e) {
      setRepliesError((e as Error).message);
      setReplies([]);
    } finally {
      setRepliesLoading(false);
    }
  }, [organizationId, thread?.classification_category]);

  const fetchContentOpportunities = useCallback(async () => {
    if (!organizationId) {
      setContentOpportunitiesLoading(false);
      return;
    }
    setContentOpportunitiesLoading(true);
    setContentOpportunitiesError(null);
    try {
      const params = new URLSearchParams({
        organization_id: organizationId,
        window_hours: '72',
      });
      const res = await fetch(`/api/engagement/content-opportunities?${params.toString()}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(res.statusText);
      const json = await res.json();
      setContentOpportunitiesData(json.opportunities ?? []);
    } catch (e) {
      setContentOpportunitiesError((e as Error).message);
      setContentOpportunitiesData([]);
    } finally {
      setContentOpportunitiesLoading(false);
    }
  }, [organizationId]);

  const fetchOpportunityInsights = useCallback(async () => {
    if (!organizationId) {
      setOpportunityInsights(null);
      return;
    }
    setOpportunityInsightsLoading(true);
    try {
      const res = await fetch(
        `/api/engagement/opportunity-insights?organization_id=${encodeURIComponent(organizationId)}`,
        { credentials: 'include' }
      );
      if (!res.ok) throw new Error(res.statusText);
      const json = await res.json();
      setOpportunityInsights(json);
    } catch {
      setOpportunityInsights(null);
    } finally {
      setOpportunityInsightsLoading(false);
    }
  }, [organizationId]);

  const [sectionOpen, setSectionOpen] = useState<Record<string, boolean>>({
    opportunity: true,
    leads: true,
    strategy: true,
    replies: true,
    content: true,
    network: true,
    influencers: true,
    engagement_insights: true,
    buyer_intent: true,
    insights: true,
    content_opportunities: true,
    opportunity_insights: true,
  });

  useEffect(() => {
    if (!thread || !organizationId) {
      setOpportunities([]);
      setLeads([]);
      setStrategies([]);
      setReplies([]);
      setContentOpportunitiesData([]);
      return;
    }
    void fetchOpportunities();
    void fetchLeads();
    void fetchStrategies();
    void fetchReplies();
    void fetchContentOpportunities();
    void fetchOpportunityInsights();
  }, [thread?.thread_id, organizationId, fetchOpportunities, fetchLeads, fetchStrategies, fetchReplies, fetchContentOpportunities, fetchOpportunityInsights]);

  const toggleSection = useCallback((key: string) => {
    setSectionOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  if (!thread) {
    return (
      <div
        className={`flex flex-col h-full items-center justify-center p-6 text-slate-500 bg-slate-50 border-l border-slate-200 ${className}`}
      >
        <p className="text-sm text-center">Select a conversation to view AI insights.</p>
      </div>
    );
  }

  const MAX_ITEMS = 5;

  const SectionCard = ({
    id,
    icon,
    title,
    count,
    loading,
    error,
    empty,
    children,
  }: {
    id: string;
    icon: string;
    title: string;
    count: number;
    loading?: boolean;
    error?: string | null;
    empty?: boolean;
    children: React.ReactNode;
  }) => {
    const isOpen = sectionOpen[id] ?? true;
    return (
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
        <button
          type="button"
          onClick={() => toggleSection(id)}
          className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-slate-50"
        >
          <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
            <span>{icon}</span>
            {title}
          </span>
          <span className="text-xs bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full">
            {count}
          </span>
        </button>
        {isOpen && (
          <div className="border-t border-slate-100 p-3">
            {loading && <div className="text-sm text-slate-500">Loading…</div>}
            {!loading && error && (
              <div className="text-sm text-amber-700">{error}</div>
            )}
            {!loading && !error && empty && (
              <div className="text-sm text-slate-500">No signals detected for this conversation.</div>
            )}
            {!loading && !error && !empty && children}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={`flex flex-col h-full bg-slate-50 border-l border-slate-200 overflow-hidden ${className}`}>
      <div className="shrink-0 p-4 border-b border-slate-200 bg-white">
        <h3 className="text-sm font-semibold text-slate-800">AI Engagement Assistant</h3>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <SectionCard
          id="opportunity"
          icon="⚡"
          title="Opportunity Signals"
          count={opportunities.length}
          loading={opportunitiesLoading}
          error={opportunitiesError}
          empty={opportunities.length === 0}
        >
          <div className="space-y-2">
            {opportunities.slice(0, MAX_ITEMS).map((o) => (
              <div key={o.id} className="rounded border border-slate-100 bg-slate-50 p-2 text-sm">
                <div className="font-medium text-slate-700">{o.opportunity_type.replace(/_/g, ' ')}</div>
                <div className="text-xs text-slate-500">
                  Confidence: {(o.confidence_score * 100).toFixed(0)}% · Priority: {o.priority_score.toFixed(1)}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          id="leads"
          icon="🎯"
          title="Potential Leads"
          count={leads.length}
          loading={leadsLoading}
          error={leadsError}
          empty={leads.length === 0}
        >
          <div className="space-y-2">
            {leads.slice(0, MAX_ITEMS).map((l, i) => (
              <div key={i} className="rounded border border-slate-100 bg-slate-50 p-2 text-sm">
                <div className="font-medium text-slate-700">{l.author_name ?? 'Unknown'}</div>
                <div className="text-xs text-slate-500">
                  {l.lead_intent} · {l.confidence_score != null ? `${(l.confidence_score * 100).toFixed(0)}%` : `Score: ${l.lead_score}`}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          id="strategy"
          icon="🧠"
          title="Recommended Strategy"
          count={strategies.length}
          loading={strategiesLoading}
          error={strategiesError}
          empty={strategies.length === 0}
        >
          <div className="space-y-2">
            {strategies.slice(0, MAX_ITEMS).map((s, i) => (
              <div key={i} className="rounded border border-slate-100 bg-slate-50 p-2 text-sm">
                <div className="font-medium text-slate-700">{s.strategy_type.replace(/_/g, ' ')}</div>
                <div className="text-xs text-slate-500">
                  Engagement: {s.engagement_score.toFixed(1)} · Confidence: {s.confidence_score.toFixed(1)}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          id="replies"
          icon="⭐"
          title="High-Performing Replies"
          count={replies.length}
          loading={repliesLoading}
          error={repliesError}
          empty={replies.length === 0}
        >
          <div className="space-y-2">
            {replies.slice(0, MAX_ITEMS).map((r, i) => (
              <div key={i} className="rounded border border-slate-100 bg-slate-50 p-2 text-sm">
                <div className="text-slate-700 line-clamp-2">{(r.sample_reply ?? '').slice(0, 150)}</div>
                <div className="text-xs text-slate-500 mt-1">Score: {r.engagement_score.toFixed(1)}</div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          id="content"
          icon="💡"
          title="Content Opportunities"
          count={contentOpportunities.length}
          empty={contentOpportunities.length === 0}
        >
          <div className="space-y-2">
            {contentOpportunities.slice(0, MAX_ITEMS).map((c, i) => (
              <div key={i} className="rounded border border-slate-100 bg-slate-50 p-2 text-sm text-slate-700">
                {c}
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          id="network"
          icon="🌐"
          title="Network Expansion"
          count={networkSignalsCount}
          empty={networkSignalsCount === 0}
        >
          <NetworkExpansionPanel
            items={items}
            onViewConversation={onSelectThread}
          />
        </SectionCard>

        <SectionCard
          id="influencers"
          icon="⭐"
          title="Influencers to Engage"
          count={influencerCount}
          empty={false}
        >
          <InfluencerPanel
            organizationId={organizationId}
            limit={5}
            onCountChange={setInfluencerCount}
            onOpenThreadListFilteredByAuthor={
              onFilterByAuthor
                ? (_, authorName, platform) => onFilterByAuthor(authorName, platform)
                : undefined
            }
          />
        </SectionCard>

        <SectionCard
          id="engagement_insights"
          icon="📊"
          title="Insights"
          count={insightCount}
          empty={false}
        >
          <InsightPanel
            organizationId={organizationId}
            limit={5}
            onCountChange={setInsightCount}
            onOpenConversation={onSelectThread}
          />
        </SectionCard>

        <SectionCard
          id="buyer_intent"
          icon="🎯"
          title="Buyer Intent Accounts"
          count={buyerIntentCount}
          empty={false}
        >
          <BuyerIntentPanel
            organizationId={organizationId}
            limit={5}
            onCountChange={setBuyerIntentCount}
            onOpenDiscussion={onFilterByAuthor ? (authorName, platform) => onFilterByAuthor(authorName, platform) : undefined}
          />
        </SectionCard>

        <SectionCard
          id="insights"
          icon="📊"
          title="Content Insights"
          count={contentInsightsCount}
          empty={contentInsightsCount === 0}
        >
          <ContentInsightsPanel messages={messages} />
        </SectionCard>

        <SectionCard
          id="content_opportunities"
          icon="📝"
          title="Content Opportunities"
          count={contentOpportunitiesData.length}
          loading={contentOpportunitiesLoading}
          error={contentOpportunitiesError}
          empty={contentOpportunitiesData.length === 0}
        >
          <ContentOpportunitiesPanel
            opportunities={contentOpportunitiesData}
            organizationId={organizationId}
            loading={contentOpportunitiesLoading}
            error={contentOpportunitiesError}
            onRefresh={fetchContentOpportunities}
          />
        </SectionCard>

        <SectionCard
          id="opportunity_insights"
          icon="📈"
          title="Opportunity Insights"
          count={
            opportunityInsights
              ? (opportunityInsights.topics_generating_campaigns?.length ?? 0) +
                (opportunityInsights.top_performing_opportunity_type ? 1 : 0) +
                (opportunityInsights.highest_approval_opportunity_type ? 1 : 0)
              : 0
          }
          loading={opportunityInsightsLoading}
          empty={
            !opportunityInsights ||
            (!opportunityInsights.top_performing_opportunity_type &&
              !opportunityInsights.highest_approval_opportunity_type &&
              (opportunityInsights.topics_generating_campaigns?.length ?? 0) === 0)
          }
        >
          <div className="space-y-2">
            {opportunityInsights?.top_performing_opportunity_type && (
              <div className="rounded border border-slate-100 bg-slate-50 p-2 text-sm">
                <div className="text-xs text-slate-500">Top performing type</div>
                <div className="font-medium text-slate-700">
                  {opportunityInsights.top_performing_opportunity_type.replace(/_/g, ' ')}
                </div>
              </div>
            )}
            {opportunityInsights?.highest_approval_opportunity_type && (
              <div className="rounded border border-slate-100 bg-slate-50 p-2 text-sm">
                <div className="text-xs text-slate-500">Highest approval rate</div>
                <div className="font-medium text-slate-700">
                  {opportunityInsights.highest_approval_opportunity_type.replace(/_/g, ' ')}
                </div>
              </div>
            )}
            {(opportunityInsights?.topics_generating_campaigns?.length ?? 0) > 0 && (
              <div className="rounded border border-slate-100 bg-slate-50 p-2 text-sm">
                <div className="text-xs text-slate-500">Topics generating campaigns</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {opportunityInsights.topics_generating_campaigns.slice(0, 5).map((t, i) => (
                    <span key={i} className="text-xs bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </SectionCard>
      </div>
    </div>
  );
});
