/**
 * Company-level Growth Intelligence overview.
 * Uses useCompanyGrowthSummary hook. Renders score, campaign count, breakdown.
 */

import React from 'react';
import { useCompanyGrowthSummary } from '@/hooks/useGrowthIntelligence';
import { GrowthScoreCard } from './GrowthScoreCard';
import { GrowthScoreBreakdown } from './GrowthScoreBreakdown';
import { GrowthMetricsGrid } from './GrowthMetricsGrid';
import type { GrowthSummary } from '@/lib/intelligence/growthIntelligenceTypes';

export interface CompanyGrowthOverviewProps {
  companyId: string;
  className?: string;
}

export function CompanyGrowthOverview({ companyId, className = '' }: CompanyGrowthOverviewProps) {
  const { summary, loading, error } = useCompanyGrowthSummary(companyId);

  if (!companyId?.trim()) {
    return (
      <div className={`p-4 rounded-xl border border-slate-200 bg-slate-50 text-slate-500 ${className}`}>
        Select a company to view growth overview.
      </div>
    );
  }

  if (loading) {
    return (
      <div
        className={`p-6 rounded-xl border border-slate-200 bg-slate-50 animate-pulse ${className}`}
        aria-busy="true"
      >
        <div className="h-8 w-32 bg-slate-200 rounded mb-4" />
        <div className="h-4 w-full bg-slate-200 rounded mb-2" />
        <div className="h-4 w-3/4 bg-slate-200 rounded" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={`p-4 rounded-xl border border-red-200 bg-red-50 text-red-700 ${className}`}
        role="alert"
      >
        {error}
      </div>
    );
  }

  if (!summary) return null;

  const summaryAsGrowth: GrowthSummary = {
    companyId: summary.companyId,
    contentVelocity: summary.contentVelocity,
    publishing: summary.publishing,
    engagement: summary.engagement,
    community: summary.community,
    opportunities: summary.opportunities,
    growthScore: summary.growthScore,
    scoreBreakdown: summary.scoreBreakdown,
  };

  return (
    <div className={`space-y-4 ${className}`}>
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1 min-w-0">
          <GrowthScoreCard summary={summaryAsGrowth} />
        </div>
        <div className="text-sm text-slate-600 flex items-center">
          <span className="font-medium">{summary.campaignCount}</span>
          <span className="ml-1">campaigns</span>
        </div>
      </div>

      <GrowthMetricsGrid summary={summaryAsGrowth} />

      <GrowthScoreBreakdown breakdown={summary.scoreBreakdown} />
    </div>
  );
}
