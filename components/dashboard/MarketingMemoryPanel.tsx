/**
 * MarketingMemoryPanel
 * Displays top performing content formats, top narratives, and audience engagement patterns.
 */

import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Brain } from 'lucide-react';

export interface TopContentFormat {
  format: string;
  avg_engagement?: number;
}

export interface TopNarrative {
  narrative: string;
  engagement_score?: number;
}

export interface MarketingMemoryPanelProps {
  top_content_formats?: TopContentFormat[];
  top_narratives?: TopNarrative[];
  audience_patterns?: string[];
  loading?: boolean;
  className?: string;
}

export function MarketingMemoryPanel({
  top_content_formats = [],
  top_narratives = [],
  audience_patterns = [],
  loading = false,
  className = '',
}: MarketingMemoryPanelProps) {
  if (loading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            Marketing Memory
          </CardTitle>
          <p className="text-sm text-slate-600">Loading…</p>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 animate-pulse">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-10 rounded bg-slate-100" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const hasData = top_content_formats.length > 0 || top_narratives.length > 0 || audience_patterns.length > 0;

  if (!hasData) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            Marketing Memory
          </CardTitle>
          <p className="text-sm text-slate-600">
            No learned patterns yet. Memory builds as campaigns run and performance is analyzed.
          </p>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="h-5 w-5" />
          Marketing Memory
        </CardTitle>
        <p className="text-sm text-slate-600">
          Learnings from past campaign performance
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {top_content_formats.length > 0 && (
          <section>
            <h4 className="text-sm font-semibold text-slate-700 mb-2">Top Content Formats</h4>
            <ul className="space-y-1.5">
              {top_content_formats.map((f, idx) => (
                <li
                  key={idx}
                  className="flex items-center justify-between rounded border border-slate-100 bg-slate-50 px-3 py-2 text-sm"
                >
                  <span className="font-medium text-slate-800 capitalize">{String(f.format).replace(/_/g, ' ')}</span>
                  {typeof f.avg_engagement === 'number' && (
                    <span className="text-slate-600">{Math.round(f.avg_engagement * 100)}% avg engagement</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        {top_narratives.length > 0 && (
          <section>
            <h4 className="text-sm font-semibold text-slate-700 mb-2">Top Narratives</h4>
            <ul className="space-y-1.5">
              {top_narratives.map((n, idx) => (
                <li
                  key={idx}
                  className="flex items-center justify-between rounded border border-slate-100 bg-slate-50 px-3 py-2 text-sm"
                >
                  <span className="font-medium text-slate-800 capitalize">{String(n.narrative).replace(/_/g, ' ')}</span>
                  {typeof n.engagement_score === 'number' && (
                    <span className="text-slate-600">Score: {Math.round(n.engagement_score)}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        {audience_patterns.length > 0 && (
          <section>
            <h4 className="text-sm font-semibold text-slate-700 mb-2">Audience Engagement Patterns</h4>
            <div className="flex flex-wrap gap-2">
              {audience_patterns.map((p, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center rounded-full bg-violet-100 px-3 py-0.5 text-xs font-medium text-violet-800"
                >
                  {p}
                </span>
              ))}
            </div>
          </section>
        )}
      </CardContent>
    </Card>
  );
}