/**
 * EngagementCopilot - triage assistant for the selected conversation.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { InboxThread } from '@/hooks/useEngagementInbox';
import type { EngagementMessage } from '@/hooks/useEngagementMessages';
import { apiFetch } from '@/lib/apiFetch';

export interface AIEngagementAssistantProps {
  thread: InboxThread | null;
  messages: EngagementMessage[];
  organizationId: string | null;
  recommendedThread?: InboxThread | null;
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

type Strategy = {
  strategy_type: string;
  engagement_score: number;
  confidence_score: number;
};

const ACTIVE_LEADS_ROUTE = '/command-center/active-leads';

function toActionLabel(opportunityType: string | undefined): string {
  if (!opportunityType) return 'Reply with a clear next step';
  return opportunityType.replace(/_/g, ' ');
}

function buildWhyThisMatters(args: {
  thread: InboxThread;
  opportunity?: Opportunity | null;
  strategy?: Strategy | null;
  messages: EngagementMessage[];
}): string {
  if (args.thread.customer_question) {
    return 'This thread includes a direct question, so speed and clarity matter more than a long response.';
  }
  if (args.thread.lead_detected) {
    return 'Buyer-intent signals are present here, so the reply can influence whether this turns into a stronger follow-up.';
  }
  if (args.thread.negative_feedback) {
    return 'Negative sentiment is visible, so the response should reduce friction before the conversation escalates.';
  }
  if (args.opportunity) {
    return `AI detected a ${toActionLabel(args.opportunity.opportunity_type)} moment in this thread.`;
  }
  if (args.strategy) {
    return `The best-fit response style right now is ${args.strategy.strategy_type.replace(/_/g, ' ')}.`;
  }
  if (args.messages.length > 1) {
    return 'There is enough thread context here to give a specific reply instead of a generic one.';
  }
  return 'Start with a short reply that acknowledges the conversation and moves it forward.';
}

export const AIEngagementAssistant = React.memo(function AIEngagementAssistant({
  thread,
  messages,
  organizationId,
  recommendedThread = null,
  onSelectThread,
  className = '',
}: AIEngagementAssistantProps) {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Right rail is now guidance-only. Reply drafting lives inside the
  // conversation pane's AI Suggestions block where the operator can pick
  // and refine one concrete option.
  const fetchThreadContext = useCallback(async () => {
    if (!organizationId || !thread?.thread_id) {
      setOpportunities([]);
      setStrategies([]);
      return;
    }
    try {
      const opportunityUrl = `/api/engagement/opportunities?thread_id=${encodeURIComponent(thread.thread_id)}&organization_id=${encodeURIComponent(organizationId)}`;
      let strategyUrl = '';
      if (thread.classification_category) {
        const params = new URLSearchParams({
          organization_id: organizationId,
          classification: thread.classification_category,
          sentiment: (thread.sentiment ?? 'neutral').toString(),
        });
        strategyUrl = `/api/engagement/strategies?${params.toString()}`;
      }
      const requests = [apiFetch(opportunityUrl)];
      if (strategyUrl) requests.push(apiFetch(strategyUrl));

      const responses = await Promise.all(requests);
      const firstFailure = responses.find((response) => !response.ok);
      if (firstFailure) throw new Error(firstFailure.statusText || 'Failed to load engagement context');

      const payloads = await Promise.all(responses.map((response) => response.json()));
      setOpportunities(payloads[0]?.opportunities ?? []);
      setStrategies(strategyUrl ? payloads[1]?.strategies ?? [] : []);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to load engagement copilot');
      setOpportunities([]);
      setStrategies([]);
    }
  }, [
    organizationId,
    thread?.thread_id,
    thread?.classification_category,
    thread?.sentiment,
  ]);

  useEffect(() => {
    void fetchThreadContext();
  }, [fetchThreadContext]);

  const topOpportunity = opportunities[0] ?? null;
  const topStrategy = strategies[0] ?? null;

  const nextAction = useMemo(() => {
    if (!thread) return 'Select a thread to see the next action.';
    if (thread.customer_question) return 'Reply with a direct answer and one concrete next step.';
    if (thread.negative_feedback) return 'Acknowledge the concern and de-escalate before offering help.';
    if (topOpportunity) return `Act on: ${toActionLabel(topOpportunity.opportunity_type)}.`;
    if (thread.lead_detected) return 'Reply clearly, then review the thread in Active Leads for follow-up.';
    return 'Send a short reply that keeps the conversation moving.';
  }, [thread, topOpportunity]);

  const whyThisMatters = useMemo(() => {
    if (!thread) return 'Select a thread to see why it matters.';
    return buildWhyThisMatters({
      thread,
      opportunity: topOpportunity,
      strategy: topStrategy,
      messages,
    });
  }, [messages, thread, topOpportunity, topStrategy]);

  if (!thread) {
    return (
      <div className={`flex h-full flex-col items-center justify-center border-l border-slate-200 bg-slate-50 p-6 text-slate-500 ${className}`}>
        <div className="max-w-xs text-center">
          <p className="text-sm font-medium text-slate-700">AI assistant will help once you select a conversation</p>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Open a thread from the queue to get reply guidance, next actions, and context.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex h-full flex-col overflow-hidden border-l border-slate-200 bg-slate-50 ${className}`}>
      <div className="shrink-0 border-b border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-800">AI Triage Copilot</h3>
        <p className="mt-1 text-xs text-slate-500">Next action and why this thread matters.</p>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {thread.lead_detected ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <div className="font-medium">Lead signal detected</div>
            <p className="mt-1 text-xs text-amber-900/80">
              Keep the conversation moving here, then use Active Leads for qualification and follow-up planning.
            </p>
            <button
              type="button"
              onClick={() => window.location.assign(ACTIVE_LEADS_ROUTE)}
              className="mt-3 text-xs font-medium text-indigo-700 hover:text-indigo-900"
            >
              View in Active Leads
            </button>
          </div>
        ) : null}

        {recommendedThread && recommendedThread.thread_id !== thread.thread_id ? (
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-900">
            <div className="font-medium">Recommended next thread</div>
            <p className="mt-1 text-xs text-indigo-900/80">
              If you finish this conversation, the next best item is {recommendedThread.author_name || recommendedThread.author_username || 'the recommended thread'}.
            </p>
            {onSelectThread ? (
              <button
                type="button"
                onClick={() => onSelectThread(recommendedThread.thread_id)}
                className="mt-3 text-xs font-medium text-indigo-700 hover:text-indigo-900"
              >
                Jump to recommended thread
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Next Action</div>
          <p className="mt-3 text-sm leading-6 text-slate-700">{nextAction}</p>
          {topOpportunity ? (
            <p className="mt-2 text-xs text-slate-500">
              Priority {topOpportunity.priority_score.toFixed(1)} · Confidence {Math.round(topOpportunity.confidence_score * 100)}%
            </p>
          ) : null}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Why This Matters</div>
          <p className="mt-3 text-sm leading-6 text-slate-700">{whyThisMatters}</p>
          {topStrategy ? (
            <p className="mt-2 text-xs text-slate-500">
              Suggested tone: {topStrategy.strategy_type.replace(/_/g, ' ')}
            </p>
          ) : null}
        </div>

        {error ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
});
