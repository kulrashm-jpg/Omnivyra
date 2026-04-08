/**
 * EngagementCopilot — action-first assistant for the selected conversation.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { InboxThread } from '@/hooks/useEngagementInbox';
import type { EngagementMessage } from '@/hooks/useEngagementMessages';

export interface AIEngagementAssistantProps {
  thread: InboxThread | null;
  messages: EngagementMessage[];
  organizationId: string | null;
  items?: InboxThread[];
  onSelectThread?: (threadId: string) => void;
  onFilterByAuthor?: (authorName: string, platform: string) => void;
  className?: string;
}

type Opportunity = {
  id: string;
  opportunity_type: string;
  confidence_score: number;
  priority_score: number;
};

type Lead = {
  thread_id: string;
  author_name: string | null;
  lead_intent: string;
  lead_score: number;
  confidence_score: number | null;
};

type Strategy = {
  strategy_type: string;
  engagement_score: number;
  confidence_score: number;
};

type ReplyIntelligence = {
  sample_reply: string;
  engagement_score: number;
  reply_category?: string;
};

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
      for (const match of matches) {
        const key = match.toLowerCase();
        themes.set(key, (themes.get(key) ?? 0) + 1);
      }
    }
  }

  const repeatedThemes = [...themes.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([word]) => `Theme: "${word}" mentioned multiple times`);

  return [...opportunities, ...repeatedThemes];
}

export const AIEngagementAssistant = React.memo(function AIEngagementAssistant({
  thread,
  messages,
  organizationId,
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

  const contentOpportunities = useMemo(() => extractContentOpportunities(messages), [messages]);

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
        ? allLeads.filter((lead: { thread_id: string }) => lead.thread_id === thread.thread_id)
        : [];
      setLeads(
        threadLeads.map(
          (lead: {
            author_name?: string;
            lead_intent?: string;
            lead_score?: number;
            confidence_score?: number;
          }) => ({
            thread_id: thread!.thread_id,
            author_name: lead.author_name ?? null,
            lead_intent: lead.lead_intent ?? 'unknown',
            lead_score: lead.lead_score ?? 0,
            confidence_score: lead.confidence_score ?? null,
          })
        )
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
      const res = await fetch(`/api/engagement/strategies?${params.toString()}`, {
        credentials: 'include',
      });
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

  const [sectionOpen, setSectionOpen] = useState<Record<string, boolean>>({
    opportunity: true,
    leads: true,
    strategy: true,
    replies: true,
    content: true,
  });

  useEffect(() => {
    if (!thread || !organizationId) {
      setOpportunities([]);
      setLeads([]);
      setStrategies([]);
      setReplies([]);
      return;
    }
    void fetchOpportunities();
    void fetchLeads();
    void fetchStrategies();
    void fetchReplies();
  }, [thread?.thread_id, organizationId, fetchOpportunities, fetchLeads, fetchStrategies, fetchReplies]);

  const toggleSection = useCallback((key: string) => {
    setSectionOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  if (!thread) {
    return (
      <div
        className={`flex h-full flex-col items-center justify-center border-l border-slate-200 bg-slate-50 p-6 text-slate-500 ${className}`}
      >
        <p className="text-center text-sm">Select a conversation to open the engagement copilot.</p>
      </div>
    );
  }

  const MAX_ITEMS = 5;

  const SectionCard = ({
    id,
    title,
    count,
    loading,
    error,
    empty,
    children,
  }: {
    id: string;
    title: string;
    count: number;
    loading?: boolean;
    error?: string | null;
    empty?: boolean;
    children: React.ReactNode;
  }) => {
    const isOpen = sectionOpen[id] ?? true;
    return (
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <button
          type="button"
          onClick={() => toggleSection(id)}
          className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-slate-50"
        >
          <span className="text-sm font-medium text-slate-800">{title}</span>
          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-700">
            {count}
          </span>
        </button>
        {isOpen && (
          <div className="border-t border-slate-100 p-3">
            {loading && <div className="text-sm text-slate-500">Loading...</div>}
            {!loading && error && <div className="text-sm text-amber-700">{error}</div>}
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
    <div className={`flex h-full flex-col overflow-hidden border-l border-slate-200 bg-slate-50 ${className}`}>
      <div className="shrink-0 border-b border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-800">Engagement Copilot</h3>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        <SectionCard
          id="opportunity"
          title="Next Best Opportunities"
          count={opportunities.length}
          loading={opportunitiesLoading}
          error={opportunitiesError}
          empty={opportunities.length === 0}
        >
          <div className="space-y-2">
            {opportunities.slice(0, MAX_ITEMS).map((opportunity) => (
              <div key={opportunity.id} className="rounded border border-slate-100 bg-slate-50 p-2 text-sm">
                <div className="font-medium text-slate-700">
                  {opportunity.opportunity_type.replace(/_/g, ' ')}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  Confidence {Math.round(opportunity.confidence_score * 100)}% · Priority{' '}
                  {opportunity.priority_score.toFixed(1)}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          id="leads"
          title="Lead Signals"
          count={leads.length}
          loading={leadsLoading}
          error={leadsError}
          empty={leads.length === 0}
        >
          <div className="space-y-2">
            {leads.slice(0, MAX_ITEMS).map((lead, index) => (
              <div key={`${lead.thread_id}-${index}`} className="rounded border border-slate-100 bg-slate-50 p-2 text-sm">
                <div className="font-medium text-slate-700">{lead.author_name ?? 'Unknown'}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {lead.lead_intent} ·{' '}
                  {lead.confidence_score != null
                    ? `${Math.round(lead.confidence_score * 100)}% confidence`
                    : `Score ${lead.lead_score}`}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          id="strategy"
          title="Recommended Strategy"
          count={strategies.length}
          loading={strategiesLoading}
          error={strategiesError}
          empty={strategies.length === 0}
        >
          <div className="space-y-2">
            {strategies.slice(0, MAX_ITEMS).map((strategy, index) => (
              <div key={`${strategy.strategy_type}-${index}`} className="rounded border border-slate-100 bg-slate-50 p-2 text-sm">
                <div className="font-medium text-slate-700">
                  {strategy.strategy_type.replace(/_/g, ' ')}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  Engagement {strategy.engagement_score.toFixed(1)} · Confidence{' '}
                  {strategy.confidence_score.toFixed(1)}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          id="replies"
          title="High-Performing Replies"
          count={replies.length}
          loading={repliesLoading}
          error={repliesError}
          empty={replies.length === 0}
        >
          <div className="space-y-2">
            {replies.slice(0, MAX_ITEMS).map((reply, index) => (
              <div key={`${reply.reply_category ?? 'reply'}-${index}`} className="rounded border border-slate-100 bg-slate-50 p-2 text-sm">
                <div className="line-clamp-3 text-slate-700">{(reply.sample_reply ?? '').slice(0, 180)}</div>
                <div className="mt-1 text-xs text-slate-500">
                  Score {reply.engagement_score.toFixed(1)}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          id="content"
          title="Conversation-Derived Content Ideas"
          count={contentOpportunities.length}
          empty={contentOpportunities.length === 0}
        >
          <div className="space-y-2">
            {contentOpportunities.slice(0, MAX_ITEMS).map((item, index) => (
              <div key={`${item}-${index}`} className="rounded border border-slate-100 bg-slate-50 p-2 text-sm text-slate-700">
                {item}
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
});
