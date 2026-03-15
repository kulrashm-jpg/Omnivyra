/**
 * OpportunityRadar — cross-thread opportunity counts in Engagement Command Center header.
 * Fetches from GET /api/engagement/opportunity-radar.
 * Displays horizontal badges; click filters ThreadList by opportunity type.
 */

import React, { useState, useEffect, useCallback } from 'react';

const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export type OpportunityRadarCategory =
  | 'buying_intent'
  | 'competitor_complaints'
  | 'product_comparisons'
  | 'recommendation_requests'
  | 'general_opportunities';

export type OpportunityRadarStats = {
  buying_intent: number;
  competitor_complaints: number;
  product_comparisons: number;
  recommendation_requests: number;
  general_opportunities?: number;
};

const CATEGORY_LABELS: Record<OpportunityRadarCategory, string> = {
  buying_intent: 'Buying Intent',
  competitor_complaints: 'Competitor Complaints',
  product_comparisons: 'Product Comparisons',
  recommendation_requests: 'Recommendation Requests',
  general_opportunities: 'General Opportunities',
};

export interface OpportunityRadarProps {
  organizationId: string | null;
  selectedCategory: OpportunityRadarCategory | null;
  onSelectCategory: (category: OpportunityRadarCategory | null) => void;
  className?: string;
}

async function fetchRadarStats(
  organizationId: string
): Promise<OpportunityRadarStats> {
  const params = new URLSearchParams({
    organization_id: organizationId,
    window_hours: '24',
  });
  const res = await fetch(
    `/api/engagement/opportunity-radar?${params.toString()}`,
    { credentials: 'include' }
  );
  if (!res.ok) throw new Error(res.statusText);
  const json = await res.json();
  return {
    buying_intent: json.buying_intent ?? 0,
    competitor_complaints: json.competitor_complaints ?? 0,
    product_comparisons: json.product_comparisons ?? 0,
    recommendation_requests: json.recommendation_requests ?? 0,
    general_opportunities: json.general_opportunities ?? 0,
  };
}

export const OpportunityRadar = React.memo(function OpportunityRadar({
  organizationId,
  selectedCategory,
  onSelectCategory,
  className = '',
}: OpportunityRadarProps) {
  const [stats, setStats] = useState<OpportunityRadarStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId?.trim()) {
      setStats(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchRadarStats(organizationId);
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!organizationId?.trim()) return;
    const interval = setInterval(load, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [organizationId, load]);

  if (!organizationId) return null;

  if (loading && !stats) {
    return (
      <div
        className={`flex items-center gap-2 mt-2 text-sm text-slate-500 ${className}`}
      >
        <span>Opportunity Radar</span>
        <span className="animate-pulse">Loading…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={`flex items-center gap-2 mt-2 text-sm text-amber-600 ${className}`}
      >
        <span>Opportunity Radar</span>
        <span>{error}</span>
      </div>
    );
  }

  const categories: OpportunityRadarCategory[] = [
    'buying_intent',
    'competitor_complaints',
    'product_comparisons',
    'recommendation_requests',
    'general_opportunities',
  ];

  const totalCount =
    (stats?.buying_intent ?? 0) +
    (stats?.competitor_complaints ?? 0) +
    (stats?.product_comparisons ?? 0) +
    (stats?.recommendation_requests ?? 0) +
    (stats?.general_opportunities ?? 0);

  if (totalCount === 0) {
    return (
      <div
        className={`flex items-center gap-2 mt-2 text-sm text-slate-500 ${className}`}
      >
        <span>Opportunity Radar</span>
        <span>No active opportunity signals.</span>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-wrap items-center gap-2 mt-2 ${className}`}
      role="group"
      aria-label="Opportunity Radar"
    >
      <span className="text-sm font-medium text-slate-700 shrink-0">
        Opportunity Radar
      </span>
      {categories.map((cat) => {
        const count = stats?.[cat] ?? 0;
        const isSelected = selectedCategory === cat;
        return (
          <button
            key={cat}
            type="button"
            onClick={() =>
              onSelectCategory(isSelected ? null : cat)
            }
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
              isSelected
                ? 'border-blue-500 bg-blue-50 text-blue-700'
                : count > 0
                  ? 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  : 'border-slate-200 bg-slate-50 text-slate-400 cursor-default'
            }`}
          >
            {CATEGORY_LABELS[cat]} ({count})
          </button>
        );
      })}
    </div>
  );
});
