/**
 * ContentInsightsPanel — extracts potential content opportunities from conversations.
 * Client-side analysis of messages; no API calls.
 */

import React, { useMemo } from 'react';
import type { EngagementMessage } from '@/hooks/useEngagementMessages';

const MAX_ITEMS = 5;
const MAX_MESSAGES_SCAN = 100;

const QUESTION_PATTERNS = /\b(how|why|what|best way|recommend)\b/i;
const PROBLEM_WORDS = /\b(problem|issue|struggling|help|looking for)\b/gi;
const FEATURE_PHRASES = /\b(feature request|wish it had|would be nice)\b/i;

export interface ContentInsightsPanelProps {
  messages: EngagementMessage[];
  className?: string;
}

type InsightItem = { snippet: string; frequency: number };

export const ContentInsightsPanel = React.memo(function ContentInsightsPanel({
  messages,
  className = '',
}: ContentInsightsPanelProps) {
  const insights = useMemo(() => {
    const questions: InsightItem[] = [];
    const problemCount = new Map<string, number>();
    const featureSnippets: InsightItem[] = [];
    const limited = messages.slice(-MAX_MESSAGES_SCAN);

    for (const msg of limited) {
      const content = (msg.content ?? '').toString().trim();
      if (!content || content.length < 10) continue;

      if (QUESTION_PATTERNS.test(content)) {
        const snippet = content.slice(0, 100).trim();
        if (snippet) {
          const existing = questions.find((q) => q.snippet === snippet);
          if (existing) existing.frequency += 1;
          else questions.push({ snippet, frequency: 1 });
        }
      }

      const problemMatches = content.match(PROBLEM_WORDS);
      if (problemMatches) {
        for (const m of problemMatches) {
          const key = m.toLowerCase();
          problemCount.set(key, (problemCount.get(key) ?? 0) + 1);
        }
      }

      if (FEATURE_PHRASES.test(content)) {
        const snippet = content.slice(0, 100).trim();
        if (snippet) {
          const existing = featureSnippets.find((f) => f.snippet === snippet);
          if (existing) existing.frequency += 1;
          else featureSnippets.push({ snippet, frequency: 1 });
        }
      }
    }

    const questionTrends = [...questions]
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, MAX_ITEMS);

    const commonProblems = [...problemCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_ITEMS)
      .map(([word, freq]) => ({ snippet: `"${word}"`, frequency: freq }));

    const featureRequestsSorted = [...featureSnippets]
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, MAX_ITEMS);

    return {
      questionTrends,
      commonProblems,
      featureRequests: featureRequestsSorted,
    };
  }, [messages]);

  const { questionTrends, commonProblems, featureRequests } = insights;

  const InsightCard = ({ item }: { item: InsightItem }) => (
    <div className="rounded border border-slate-100 bg-slate-50 p-2 text-sm">
      <p className="text-slate-700 line-clamp-2">{item.snippet}</p>
      <span className="text-xs text-slate-500">
        {item.frequency} {item.frequency === 1 ? 'time' : 'times'}
      </span>
    </div>
  );

  return (
    <div className={`space-y-3 ${className}`}>
      <div>
        <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
          Question Trends
        </h4>
        <div className="space-y-2">
          {questionTrends.length === 0 ? (
            <div className="text-sm text-slate-500">No question patterns detected.</div>
          ) : (
            questionTrends.map((item, i) => <InsightCard key={i} item={item} />)
          )}
        </div>
      </div>

      <div>
        <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
          Common Problems
        </h4>
        <div className="space-y-2">
          {commonProblems.length === 0 ? (
            <div className="text-sm text-slate-500">No repeated problem keywords.</div>
          ) : (
            commonProblems.map((item, i) => <InsightCard key={i} item={item} />)
          )}
        </div>
      </div>

      <div>
        <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
          Feature Requests
        </h4>
        <div className="space-y-2">
          {featureRequests.length === 0 ? (
            <div className="text-sm text-slate-500">No feature request phrases found.</div>
          ) : (
            featureRequests.map((item, i) => <InsightCard key={i} item={item} />)
          )}
        </div>
      </div>
    </div>
  );
});
