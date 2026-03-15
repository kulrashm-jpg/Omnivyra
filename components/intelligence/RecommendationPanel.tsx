/**
 * RecommendationPanel — displays strategic recommendations sorted by confidence.
 */

import React, { useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { StrategicRecommendation, RecommendationType } from '@/hooks/useIntelligenceDashboard';

const TYPE_LABELS: Record<RecommendationType, string> = {
  content_opportunity: 'Content Opportunity',
  product_opportunity: 'Product Opportunity',
  marketing_opportunity: 'Marketing Opportunity',
  competitive_opportunity: 'Competitive Opportunity',
};

const TYPE_ICONS: Record<RecommendationType, string> = {
  content_opportunity: '📝',
  product_opportunity: '📦',
  marketing_opportunity: '📢',
  competitive_opportunity: '🎯',
};

function formatConfidence(score: number): string {
  return `${Math.round(score * 100)}%`;
}

export interface RecommendationPanelProps {
  recommendations: StrategicRecommendation[];
  loading?: boolean;
  emptyMessage?: string;
  className?: string;
}

export const RecommendationPanel = React.memo(function RecommendationPanel({
  recommendations,
  loading = false,
  emptyMessage = 'No strategic recommendations yet. Opportunities will generate recommendations.',
  className = '',
}: RecommendationPanelProps) {
  const sorted = useMemo(
    () => [...recommendations].sort((a, b) => b.confidence_score - a.confidence_score),
    [recommendations]
  );

  if (loading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Strategic Recommendations</CardTitle>
          <p className="text-sm text-slate-600">Loading recommendations…</p>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 animate-pulse">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 rounded-lg bg-slate-100" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (sorted.length === 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Strategic Recommendations</CardTitle>
          <p className="text-sm text-slate-600">{emptyMessage}</p>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Strategic Recommendations</CardTitle>
        <p className="text-sm text-slate-600">
          {sorted.length} recommended action{sorted.length !== 1 ? 's' : ''}
        </p>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {sorted.map((rec, idx) => (
            <li
              key={idx}
              className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:border-slate-300 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg" aria-hidden>
                      {TYPE_ICONS[rec.recommendation_type]}
                    </span>
                    <Badge variant="secondary" className="text-xs">
                      {TYPE_LABELS[rec.recommendation_type]}
                    </Badge>
                  </div>
                  <p className="text-sm font-medium text-slate-800">{rec.action_summary}</p>
                  {rec.supporting_signals.length > 0 && (
                    <p className="mt-1 text-xs text-slate-500">
                      {rec.supporting_signals.length} supporting signal
                      {rec.supporting_signals.length !== 1 ? 's' : ''}
                    </p>
                  )}
                </div>
                <Badge variant="outline" className="shrink-0">
                  {formatConfidence(rec.confidence_score)}
                </Badge>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
});
