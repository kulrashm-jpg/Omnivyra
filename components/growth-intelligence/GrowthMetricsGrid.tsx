/**
 * Displays key metrics: Published Posts, Publishing Success, Engagement Rate,
 * Community Actions, Opportunities Activated.
 * Pure UI. Uses GrowthSummary from lib/intelligence/growthIntelligenceTypes.
 */

import React from 'react';
import type { GrowthSummary } from '@/lib/intelligence/growthIntelligenceTypes';

export interface GrowthMetricsGridProps {
  summary: GrowthSummary;
  className?: string;
}

interface MetricItem {
  label: string;
  value: string | number;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function GrowthMetricsGrid({ summary, className = '' }: GrowthMetricsGridProps) {
  const metrics: MetricItem[] = [
    { label: 'Published Posts', value: summary.contentVelocity.publishedPosts },
    { label: 'Publishing Success', value: formatPercent(summary.publishing.successRate) },
    { label: 'Engagement Rate', value: `${summary.engagement.engagementRate}%` },
    { label: 'Community Actions', value: summary.community.executedActions },
    { label: 'Opportunities Activated', value: summary.opportunities.campaignsFromOpportunities },
  ];

  return (
    <div className={`p-4 rounded-xl shadow-sm border border-slate-100 ${className}`}>
      <h4 className="text-sm font-medium text-slate-700 mb-3">Key Metrics</h4>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3" role="grid">
        {metrics.map(({ label, value }) => (
          <div
            key={label}
            className="p-2 rounded-lg bg-slate-50 border border-slate-100"
            role="gridcell"
          >
            <div className="text-xs text-slate-500 truncate">{label}</div>
            <div className="text-lg font-semibold text-slate-900 mt-0.5">{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
