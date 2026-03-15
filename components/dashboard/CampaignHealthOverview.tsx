/**
 * CampaignHealthOverview
 * Displays campaign health for each campaign. Sort by health_score ASC.
 */

import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

export interface CampaignHealthItem {
  campaign_id: string;
  campaign_name: string;
  health_score: number;
  health_status: string;
  issue_count: number;
}

export interface CampaignHealthOverviewProps {
  items: CampaignHealthItem[];
  loading?: boolean;
  className?: string;
}

export function CampaignHealthOverview({
  items,
  loading = false,
  className = '',
}: CampaignHealthOverviewProps) {
  const sorted = [...items].sort((a, b) => a.health_score - b.health_score);

  if (loading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Campaign Health Overview</CardTitle>
          <p className="text-sm text-slate-600">Loading…</p>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 animate-pulse">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 rounded bg-slate-100" />
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
          <CardTitle>Campaign Health Overview</CardTitle>
          <p className="text-sm text-slate-600">No campaign health reports yet.</p>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Campaign Health Overview</CardTitle>
        <p className="text-sm text-slate-600">
          {sorted.length} campaign{sorted.length !== 1 ? 's' : ''} — sorted by health score (lowest first)
        </p>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {sorted.map((item) => (
            <li
              key={item.campaign_id}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3"
            >
              <span className="font-medium text-slate-900">{item.campaign_name}</span>
              <div className="flex items-center gap-4">
                <span className="text-sm text-slate-600">{item.issue_count} issues</span>
                <span className="text-sm font-medium capitalize text-slate-700">{item.health_status}</span>
                <span className="text-sm font-semibold text-slate-900">{item.health_score}</span>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
