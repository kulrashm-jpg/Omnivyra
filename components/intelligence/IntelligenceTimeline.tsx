/**
 * IntelligenceTimeline — shows recent signals contributing to insights.
 */

import React, { useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import type {
  Opportunity,
  StrategicRecommendation,
  CorrelationResult,
  CorrelatedSignalPair,
} from '@/hooks/useIntelligenceDashboard';

export type TimelineEntry = {
  id: string;
  topic: string;
  detected_at: string;
  related_opportunity: string | null;
  source: 'correlation' | 'opportunity' | 'recommendation';
};

export interface IntelligenceTimelineProps {
  opportunities: Opportunity[];
  recommendations: StrategicRecommendation[];
  correlations: CorrelationResult[];
  loading?: boolean;
  emptyMessage?: string;
  className?: string;
  maxItems?: number;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export const IntelligenceTimeline = React.memo(function IntelligenceTimeline({
  opportunities,
  recommendations,
  correlations,
  loading = false,
  emptyMessage = 'No recent signals contributing to insights.',
  className = '',
  maxItems = 20,
}: IntelligenceTimelineProps) {
  const entries = useMemo((): TimelineEntry[] => {
    const out: TimelineEntry[] = [];

    for (const c of correlations) {
      for (const pair of c.correlated_signals ?? []) {
        const dtA = pair.detected_at_a;
        const dtB = pair.detected_at_b;
        if (pair.topic_a) {
          out.push({
            id: `${pair.signal_a_id}-a`,
            topic: pair.topic_a,
            detected_at: dtA,
            related_opportunity: null,
            source: 'correlation',
          });
        }
        if (pair.topic_b) {
          out.push({
            id: `${pair.signal_b_id}-b`,
            topic: pair.topic_b,
            detected_at: dtB,
            related_opportunity: null,
            source: 'correlation',
          });
        }
      }
    }

    for (const opp of opportunities) {
      for (const s of opp.supporting_signals) {
        if (s.topic) {
          out.push({
            id: `opp-${opp.opportunity_type}-${s.signal_id}`,
            topic: s.topic,
            detected_at: new Date().toISOString(),
            related_opportunity: opp.summary,
            source: 'opportunity',
          });
        }
      }
    }

    for (const rec of recommendations) {
      for (const s of rec.supporting_signals) {
        if (s.topic) {
          out.push({
            id: `rec-${rec.recommendation_type}-${s.signal_id}`,
            topic: s.topic,
            detected_at: new Date().toISOString(),
            related_opportunity: rec.action_summary,
            source: 'recommendation',
          });
        }
      }
    }

    out.sort((a, b) => new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime());

    const seen = new Set<string>();
    const deduped: TimelineEntry[] = [];
    for (const e of out) {
      const key = `${e.topic}-${e.source}`;
      if (deduped.length >= maxItems) break;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(e);
    }
    return deduped;
  }, [opportunities, recommendations, correlations, maxItems]);

  if (loading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Intelligence Activity Timeline</CardTitle>
          <p className="text-sm text-slate-600">Loading timeline…</p>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 animate-pulse">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-12 rounded bg-slate-100" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (entries.length === 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Intelligence Activity Timeline</CardTitle>
          <p className="text-sm text-slate-600">{emptyMessage}</p>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Intelligence Activity Timeline</CardTitle>
        <p className="text-sm text-slate-600">Recent signals contributing to insights</p>
      </CardHeader>
      <CardContent>
        <ul className="space-y-0 border-l-2 border-slate-200 pl-4 ml-1">
          {entries.map((e, idx) => (
            <li key={e.id} className="relative pb-4 last:pb-0">
              <span
                className="absolute -left-[21px] top-1.5 w-2 h-2 rounded-full bg-slate-400"
                aria-hidden
              />
              <div className="text-xs text-slate-500">{formatDate(e.detected_at)}</div>
              <p className="text-sm font-medium text-slate-800 truncate max-w-full" title={e.topic}>
                {e.topic}
              </p>
              {e.related_opportunity && (
                <p className="text-xs text-slate-600 mt-0.5 truncate max-w-full" title={e.related_opportunity}>
                  → {e.related_opportunity}
                </p>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
});
