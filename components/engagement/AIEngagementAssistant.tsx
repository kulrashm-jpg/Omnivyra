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
  onUseSuggestedReply?: (replyText: string) => void;
  onSendSuggestedReply?: (replyText: string) => Promise<{ mode?: string; platform?: string; message?: string } | void>;
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

type ReplyIntelligence = {
  sample_reply: string;
  engagement_score: number;
};

type Suggestion = {
  id: string;
  text: string;
  explanation_tag?: string;
};

const ACTIVE_LEADS_ROUTE = '/dashboard/intelligence?intelTab=active-leads';

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
  onUseSuggestedReply,
  onSendSuggestedReply,
  className = '',
}: AIEngagementAssistantProps) {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [replies, setReplies] = useState<ReplyIntelligence[]>([]);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refinePrompt, setRefinePrompt] = useState('');
  const [refinedReply, setRefinedReply] = useState<string | null>(null);
  const [refining, setRefining] = useState(false);
  const [sendingSuggestedReply, setSendingSuggestedReply] = useState(false);
  const [suggestedReplyStatus, setSuggestedReplyStatus] = useState<string | null>(null);

  const targetMessageId = useMemo(() => {
    const sorted = [...messages].sort((a, b) => {
      const ta = new Date(a.platform_created_at ?? a.created_at ?? 0).getTime();
      const tb = new Date(b.platform_created_at ?? b.created_at ?? 0).getTime();
      return tb - ta;
    });

    const inbound = sorted.find((message) => {
      const content = (message.content ?? '').trim();
      if (!content) return false;
      return !/^you\s*:/i.test(content);
    });

    return inbound?.id ?? thread?.latest_message_id ?? sorted[0]?.id ?? null;
  }, [messages, thread?.latest_message_id]);

  const fetchSignals = useCallback(async () => {
    if (!organizationId || !thread?.thread_id) {
      setOpportunities([]);
      setReplies([]);
      setStrategies([]);
      setSuggestions([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
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
      let replyUrl = `/api/engagement/reply-intelligence?organization_id=${encodeURIComponent(organizationId)}`;
      if (thread.classification_category) {
        replyUrl += `&classification_category=${encodeURIComponent(thread.classification_category)}`;
      }
      const suggestionUrl = targetMessageId
        ? `/api/engagement/suggestions?${new URLSearchParams({
            message_id: targetMessageId,
            organization_id: organizationId,
            organizationId: organizationId,
          }).toString()}`
        : null;

      const requests = [
        apiFetch(opportunityUrl),
        apiFetch(replyUrl),
      ];
      if (strategyUrl) {
        requests.push(apiFetch(strategyUrl));
      }
      if (suggestionUrl) {
        requests.push(apiFetch(suggestionUrl));
      }

      const responses = await Promise.all(requests);
      const firstFailure = responses.find((response) => !response.ok);
      if (firstFailure) {
        throw new Error(firstFailure.statusText || 'Failed to load engagement signals');
      }

      const payloads = await Promise.all(responses.map((response) => response.json()));
      setOpportunities(payloads[0]?.opportunities ?? []);
      setReplies(payloads[1]?.replies ?? []);
      const strategyPayloadIndex = strategyUrl ? 2 : -1;
      const suggestionPayloadIndex = suggestionUrl ? (strategyUrl ? 3 : 2) : -1;
      setStrategies(strategyPayloadIndex >= 0 ? payloads[strategyPayloadIndex]?.strategies ?? [] : []);
      setSuggestions(
        suggestionPayloadIndex >= 0 && Array.isArray(payloads[suggestionPayloadIndex]?.suggestions)
          ? payloads[suggestionPayloadIndex].suggestions
          : []
      );
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to load engagement copilot');
      setOpportunities([]);
      setReplies([]);
      setStrategies([]);
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, [
    organizationId,
    targetMessageId,
    thread?.thread_id,
    thread?.classification_category,
    thread?.sentiment,
  ]);

  useEffect(() => {
    void fetchSignals();
  }, [fetchSignals]);

  const topOpportunity = opportunities[0] ?? null;
  const topReply = replies[0] ?? null;
  const topStrategy = strategies[0] ?? null;
  const topSuggestion = suggestions[0] ?? null;
  const displayedReply = refinedReply ?? topSuggestion?.text ?? topReply?.sample_reply ?? null;

  useEffect(() => {
    setRefinedReply(null);
    setRefinePrompt('');
    setSuggestedReplyStatus(null);
  }, [thread?.thread_id, topSuggestion?.text, topReply?.sample_reply]);

  useEffect(() => {
    if (!suggestedReplyStatus) return;
    const timer = window.setTimeout(() => setSuggestedReplyStatus(null), 5000);
    return () => window.clearTimeout(timer);
  }, [suggestedReplyStatus]);

  const handleRefineReply = useCallback(async () => {
    if (!organizationId || !thread?.thread_id || !displayedReply || !refinePrompt.trim()) {
      return;
    }

    setRefining(true);
    setError(null);
    try {
      const response = await apiFetch('/api/engagement/refine-suggestion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organization_id: organizationId,
          thread_id: thread.thread_id,
          draft: displayedReply,
          instruction: refinePrompt.trim(),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || body.message || 'Failed to refine reply');
      }
      setRefinedReply(String(body.refined || '').trim());
    } catch (refineError) {
      setError(refineError instanceof Error ? refineError.message : 'Failed to refine reply');
    } finally {
      setRefining(false);
    }
  }, [displayedReply, organizationId, refinePrompt, thread?.thread_id]);

  const handleSendSuggestedReply = useCallback(async () => {
    if (!displayedReply || !onSendSuggestedReply || sendingSuggestedReply) {
      return;
    }

    setSendingSuggestedReply(true);
    setError(null);
    setSuggestedReplyStatus(null);
    try {
      const result = await onSendSuggestedReply(displayedReply);
      const resultMessage = result && typeof result === 'object' ? result.message : null;
      setSuggestedReplyStatus(
        resultMessage || 'Suggested reply submitted. It may take a few seconds to reflect on the platform.'
      );
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Failed to send suggested reply');
    } finally {
      setSendingSuggestedReply(false);
    }
  }, [displayedReply, onSendSuggestedReply, sendingSuggestedReply]);

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
        <p className="mt-1 text-xs text-slate-500">Suggested reply, next action, and why this thread matters.</p>
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
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Suggested Reply</div>
          {loading ? (
            <p className="mt-3 text-sm text-slate-500">Loading reply guidance...</p>
          ) : displayedReply ? (
            <>
              <p className="mt-3 text-sm leading-6 text-slate-700">{displayedReply}</p>
              {refinedReply ? (
                <p className="mt-2 text-xs text-indigo-600">Refined with AI chat</p>
              ) : topSuggestion?.explanation_tag ? (
                <p className="mt-2 text-xs text-slate-500">{topSuggestion.explanation_tag.trim()}</p>
              ) : topReply?.engagement_score ? (
                <p className="mt-2 text-xs text-slate-500">Engagement score {topReply.engagement_score.toFixed(1)}</p>
              ) : null}
              <div className="mt-4 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  {onUseSuggestedReply ? (
                    <button
                      type="button"
                      onClick={() => {
                        onUseSuggestedReply(displayedReply);
                        setSuggestedReplyStatus('Suggested reply inserted into the composer.');
                      }}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                    >
                      Use reply
                    </button>
                  ) : null}
                  {onSendSuggestedReply ? (
                    <button
                      type="button"
                      onClick={() => void handleSendSuggestedReply()}
                      disabled={sendingSuggestedReply}
                      className="rounded-full bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {sendingSuggestedReply ? 'Sending...' : 'Send now'}
                    </button>
                  ) : null}
                </div>
                {suggestedReplyStatus ? (
                  <p className="text-xs text-emerald-700">{suggestedReplyStatus}</p>
                ) : null}
                <label className="block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Refine With AI
                </label>
                <textarea
                  value={refinePrompt}
                  onChange={(event) => setRefinePrompt(event.target.value)}
                  placeholder="Example: make this sharper, shorter, more consultative"
                  rows={2}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleRefineReply()}
                    disabled={refining || !refinePrompt.trim()}
                    className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {refining ? 'Refining...' : 'Refine reply'}
                  </button>
                  {refinedReply ? (
                    <button
                      type="button"
                      onClick={() => setRefinedReply(null)}
                      className="text-xs font-medium text-slate-600 hover:text-slate-800"
                    >
                      Reset
                    </button>
                  ) : null}
                </div>
              </div>
            </>
          ) : (
            <p className="mt-3 text-sm text-slate-500">No suggested reply yet. Open the reply composer to generate one.</p>
          )}
        </div>

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
