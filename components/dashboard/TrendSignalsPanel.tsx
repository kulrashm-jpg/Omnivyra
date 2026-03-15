/**
 * TrendSignalsPanel
 * Displays trend signals: topic, signal_strength, discussion_growth.
 */

import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

export interface TrendSignalItem {
  topic: string;
  signal_strength: number;
  discussion_growth: number;
}

export interface TrendSignalsPanelProps {
  signals: TrendSignalItem[];
  loading?: boolean;
  className?: string;
}

function formatPct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function TrendSignalsPanel({
  signals,
  loading = false,
  className = '',
}: TrendSignalsPanelProps) {
  if (loading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Trend Signals</CardTitle>
          <p className="text-sm text-slate-600">Loading…</p>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 animate-pulse">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 rounded bg-slate-100" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (signals.length === 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Trend Signals</CardTitle>
          <p className="text-sm text-slate-600">No trend signals yet.</p>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Trend Signals</CardTitle>
        <p className="text-sm text-slate-600">
          {signals.length} topic{signals.length !== 1 ? 's' : ''}
        </p>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {signals.map((s, idx) => (
            <li
              key={idx}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3"
            >
              <span className="font-medium text-slate-900 capitalize">{s.topic.replace(/_/g, ' ')}</span>
              <div className="flex items-center gap-4 text-sm text-slate-600">
                <span>Strength: {formatPct(s.signal_strength)}</span>
                <span>Growth: {formatPct(s.discussion_growth)}</span>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
