/**
 * CampaignAttributionPanel
 * Shows which intelligence source triggered each campaign.
 * Displays breakdown: opportunity, trend, strategic_insight, manual
 */

import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export type OriginSource = 'opportunity' | 'trend' | 'strategic_insight' | 'manual';

export interface CampaignAttributionData {
  campaign_id: string;
  campaign_name: string;
  origin_source: OriginSource | string;
}

export interface CampaignAttributionBreakdown {
  opportunity: number;
  trend: number;
  strategic_insight: number;
  manual: number;
}

const ORIGIN_LABELS: Record<string, string> = {
  opportunity: 'Opportunity',
  trend: 'Trend',
  strategic_insight: 'Strategic Insight',
  manual: 'Manual',
};

const ORIGIN_COLORS: Record<string, string> = {
  opportunity: 'bg-emerald-100 text-emerald-800',
  trend: 'bg-blue-100 text-blue-800',
  strategic_insight: 'bg-purple-100 text-purple-800',
  manual: 'bg-slate-100 text-slate-700',
};

export interface CampaignAttributionPanelProps {
  attribution?: CampaignAttributionBreakdown | null;
  campaigns?: CampaignAttributionData[] | null;
  loading?: boolean;
  className?: string;
}

export function CampaignAttributionPanel({
  attribution,
  campaigns = [],
  loading = false,
  className = '',
}: CampaignAttributionPanelProps) {
  if (loading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Campaign Attribution</CardTitle>
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

  const total =
    (attribution?.opportunity ?? 0) +
    (attribution?.trend ?? 0) +
    (attribution?.strategic_insight ?? 0) +
    (attribution?.manual ?? 0);

  if (total === 0 && (!campaigns || campaigns.length === 0)) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Campaign Attribution</CardTitle>
          <p className="text-sm text-slate-600">
            No campaign attribution data yet. Attribution is set when campaigns are created from opportunities, trends, or strategic insights.
          </p>
        </CardHeader>
      </Card>
    );
  }

  const breakdown = attribution ?? {
    opportunity: 0,
    trend: 0,
    strategic_insight: 0,
    manual: 0,
  };

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Campaign Attribution</CardTitle>
        <p className="text-sm text-slate-600">
          Intelligence source that triggered each campaign
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          {(['opportunity', 'trend', 'strategic_insight', 'manual'] as const).map((key) => (
            <div
              key={key}
              className="rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2 text-center"
            >
              <div className="text-2xl font-semibold text-slate-900">{breakdown[key] ?? 0}</div>
              <div className="text-xs text-slate-600">{ORIGIN_LABELS[key]}</div>
            </div>
          ))}
        </div>
        {campaigns && campaigns.length > 0 && (
          <ul className="space-y-2">
            {campaigns.map((c) => (
              <li
                key={c.campaign_id}
                className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-2"
              >
                <span className="font-medium text-slate-900 truncate">{c.campaign_name}</span>
                <Badge
                  variant="secondary"
                  className={`text-xs shrink-0 ${ORIGIN_COLORS[c.origin_source] ?? 'bg-slate-100 text-slate-700'}`}
                >
                  {ORIGIN_LABELS[c.origin_source] ?? c.origin_source}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
