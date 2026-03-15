/**
 * CorrelationPanel — displays correlated signals in a graph-like view.
 */

import React, { useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { CorrelationResult, CorrelatedSignalPair } from '@/hooks/useIntelligenceDashboard';

const TYPE_LABELS: Record<string, string> = {
  topic_similarity: 'Topic Similarity',
  temporal_proximity: 'Temporal Proximity',
  competitor_overlap: 'Competitor Overlap',
  shared_entities: 'Shared Entities',
};

function formatScore(score: number): string {
  return `${Math.round(score * 100)}%`;
}

function CorrelationEdge({ pair }: { pair: CorrelatedSignalPair }) {
  const topicA = pair.topic_a?.slice(0, 40) || `Signal ${pair.signal_a_id.slice(0, 8)}`;
  const topicB = pair.topic_b?.slice(0, 40) || `Signal ${pair.signal_b_id.slice(0, 8)}`;

  return (
    <div className="flex flex-col items-center gap-0.5 py-2 px-3 rounded-lg border border-slate-200 bg-slate-50/50 hover:bg-slate-100/50 transition-colors">
      <span className="text-xs font-medium text-slate-700 truncate max-w-[200px] text-center" title={pair.topic_a || undefined}>
        {topicA}
      </span>
      <span className="text-slate-400">↔</span>
      <span className="text-xs font-medium text-slate-700 truncate max-w-[200px] text-center" title={pair.topic_b || undefined}>
        {topicB}
      </span>
      <Badge variant="outline" className="mt-1 text-[10px]">
        {formatScore(pair.correlation_score)}
      </Badge>
    </div>
  );
}

export interface CorrelationPanelProps {
  correlations: CorrelationResult[];
  loading?: boolean;
  emptyMessage?: string;
  className?: string;
}

export const CorrelationPanel = React.memo(function CorrelationPanel({
  correlations,
  loading = false,
  emptyMessage = 'No signal correlations in the selected window.',
  className = '',
}: CorrelationPanelProps) {
  const byType = useMemo(() => {
    const map = new Map<string, CorrelationResult[]>();
    for (const c of correlations) {
      const key = c.correlation_type || 'other';
      const arr = map.get(key) ?? [];
      arr.push(c);
      map.set(key, arr);
    }
    return map;
  }, [correlations]);

  if (loading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Signal Correlations</CardTitle>
          <p className="text-sm text-slate-600">Loading correlations…</p>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 animate-pulse">
            <div className="h-32 rounded-lg bg-slate-100" />
            <div className="h-24 rounded-lg bg-slate-100" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (correlations.length === 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Signal Correlations</CardTitle>
          <p className="text-sm text-slate-600">{emptyMessage}</p>
        </CardHeader>
      </Card>
    );
  }

  const totalPairs = correlations.reduce((sum, c) => sum + (c.correlated_signals?.length ?? 0), 0);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Signal Correlations</CardTitle>
        <p className="text-sm text-slate-600">
          {totalPairs} correlated pair{totalPairs !== 1 ? 's' : ''} across {correlations.length} type
          {correlations.length !== 1 ? 's' : ''}
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {Array.from(byType.entries()).map(([type, results]) => (
            <section key={type}>
              <h4 className="text-sm font-medium text-slate-700 mb-2">
                {TYPE_LABELS[type] || type.replace(/_/g, ' ')}
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {results.flatMap((r) =>
                  (r.correlated_signals ?? []).slice(0, 8).map((pair, i) => (
                    <CorrelationEdge key={`${r.correlation_type}-${i}`} pair={pair} />
                  ))
                )}
              </div>
            </section>
          ))}
        </div>
      </CardContent>
    </Card>
  );
});
