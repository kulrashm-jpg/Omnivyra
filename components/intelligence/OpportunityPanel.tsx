/**
 * OpportunityPanel — displays opportunity cards grouped by type.
 */

import React, { useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { Opportunity, OpportunityType } from '@/hooks/useIntelligenceDashboard';

const TYPE_LABELS: Record<OpportunityType, string> = {
  emerging_trend: 'Emerging Trend',
  competitor_weakness: 'Competitor Weakness',
  market_gap: 'Market Gap',
  customer_pain_signal: 'Customer Pain Signal',
};

const TYPE_COLORS: Record<OpportunityType, string> = {
  emerging_trend: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  competitor_weakness: 'bg-amber-50 border-amber-200 text-amber-800',
  market_gap: 'bg-blue-50 border-blue-200 text-blue-800',
  customer_pain_signal: 'bg-rose-50 border-rose-200 text-rose-800',
};

function formatScore(score: number): string {
  return `${Math.round(score * 100)}%`;
}

export interface OpportunityPanelProps {
  opportunities: Opportunity[];
  loading?: boolean;
  emptyMessage?: string;
  className?: string;
}

export const OpportunityPanel = React.memo(function OpportunityPanel({
  opportunities,
  loading = false,
  emptyMessage = 'No opportunities detected in the selected window.',
  className = '',
}: OpportunityPanelProps) {
  const grouped = useMemo(() => {
    const sorted = [...opportunities].sort((a, b) => b.opportunity_score - a.opportunity_score);
    const groups: Record<OpportunityType, Opportunity[]> = {
      emerging_trend: [],
      competitor_weakness: [],
      market_gap: [],
      customer_pain_signal: [],
    };
    for (const o of sorted) {
      if (groups[o.opportunity_type]) groups[o.opportunity_type].push(o);
    }
    return groups;
  }, [opportunities]);

  if (loading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Emerging Opportunities</CardTitle>
          <p className="text-sm text-slate-600">Loading opportunities…</p>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 animate-pulse">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 rounded-lg bg-slate-100" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const totalCount = opportunities.length;
  if (totalCount === 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Emerging Opportunities</CardTitle>
          <p className="text-sm text-slate-600">{emptyMessage}</p>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Emerging Opportunities</CardTitle>
        <p className="text-sm text-slate-600">
          {totalCount} opportunity{totalCount !== 1 ? 'ies' : ''} detected
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {(Object.keys(grouped) as OpportunityType[]).map(
          (type) =>
            grouped[type].length > 0 && (
              <section key={type}>
                <h4 className="text-sm font-medium text-slate-700 mb-2">{TYPE_LABELS[type]}</h4>
                <div className="space-y-2">
                  {grouped[type].map((opp, idx) => (
                    <div
                      key={`${type}-${idx}`}
                      className={`rounded-lg border p-4 ${TYPE_COLORS[type]}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-medium">{opp.summary}</p>
                        <Badge variant="outline" className="shrink-0">
                          {formatScore(opp.opportunity_score)}
                        </Badge>
                      </div>
                      {opp.supporting_signals.length > 0 && (
                        <ul className="mt-2 text-xs text-slate-600 space-y-0.5">
                          {opp.supporting_signals.slice(0, 3).map((s, i) => (
                            <li key={i}>
                              • {s.topic || `Signal ${s.signal_id.slice(0, 8)}`}
                            </li>
                          ))}
                          {opp.supporting_signals.length > 3 && (
                            <li>+{opp.supporting_signals.length - 3} more</li>
                          )}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )
        )}
      </CardContent>
    </Card>
  );
});
