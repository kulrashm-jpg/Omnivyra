/**
 * Data hook for Strategic Intelligence Dashboard.
 * Fetches opportunities, recommendations, and correlations in parallel.
 */

import { useState, useEffect, useCallback } from 'react';

export type OpportunityType =
  | 'emerging_trend'
  | 'competitor_weakness'
  | 'market_gap'
  | 'customer_pain_signal';

export type SupportingSignal = {
  signal_id: string;
  topic: string | null;
  relevance?: number;
};

export type Opportunity = {
  opportunity_type: OpportunityType;
  opportunity_score: number;
  supporting_signals: SupportingSignal[];
  summary: string;
};

export type RecommendationType =
  | 'content_opportunity'
  | 'product_opportunity'
  | 'marketing_opportunity'
  | 'competitive_opportunity';

export type StrategicRecommendation = {
  recommendation_type: RecommendationType;
  confidence_score: number;
  action_summary: string;
  supporting_signals: Array<{ signal_id: string; topic: string | null }>;
};

export type CorrelatedSignalPair = {
  signal_a_id: string;
  signal_b_id: string;
  correlation_score: number;
  correlation_type: string;
  topic_a: string | null;
  topic_b: string | null;
  detected_at_a: string;
  detected_at_b: string;
};

export type CorrelationResult = {
  correlated_signals: CorrelatedSignalPair[];
  correlation_score: number;
  correlation_type: string;
};

const REFRESH_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

type DashboardState = {
  opportunities: Opportunity[];
  recommendations: StrategicRecommendation[];
  correlations: CorrelationResult[];
  loading: boolean;
  error: string | null;
};

export function useIntelligenceDashboard(
  companyId: string,
  windowHours: number = 24,
  buildGraph: boolean = false
): DashboardState & { refresh: () => Promise<void> } {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [recommendations, setRecommendations] = useState<StrategicRecommendation[]>([]);
  const [correlations, setCorrelations] = useState<CorrelationResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!companyId?.trim()) {
      setOpportunities([]);
      setRecommendations([]);
      setCorrelations([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    const wh = Math.min(168, Math.max(1, windowHours));
    const oppParams = new URLSearchParams({ companyId, windowHours: String(wh) });
    if (buildGraph) oppParams.set('buildGraph', 'true');

    try {
      const [oppRes, recRes, corRes] = await Promise.all([
        fetch(`/api/intelligence/opportunities?${oppParams.toString()}`, { credentials: 'include' }),
        fetch(`/api/intelligence/recommendations?companyId=${encodeURIComponent(companyId)}&windowHours=${wh}${buildGraph ? '&buildGraph=true' : ''}`, { credentials: 'include' }),
        fetch(`/api/intelligence/correlations?companyId=${encodeURIComponent(companyId)}&windowHours=${wh}`, { credentials: 'include' }),
      ]);

      const [oppJson, recJson, corJson] = await Promise.all([
        oppRes.ok ? oppRes.json() : Promise.reject(new Error(oppRes.statusText)),
        recRes.ok ? recRes.json() : Promise.reject(new Error(recRes.statusText)),
        corRes.ok ? corRes.json() : Promise.reject(new Error(corRes.statusText)),
      ]);

      if (oppJson.error) throw new Error(oppJson.error);
      if (recJson.error) throw new Error(recJson.error);
      if (corJson.error) throw new Error(corJson.error);

      setOpportunities(Array.isArray(oppJson.opportunities) ? oppJson.opportunities : []);
      setRecommendations(Array.isArray(recJson.recommendations) ? recJson.recommendations : []);
      setCorrelations(Array.isArray(corJson.correlations) ? corJson.correlations : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch intelligence data');
      setOpportunities([]);
      setRecommendations([]);
      setCorrelations([]);
    } finally {
      setLoading(false);
    }
  }, [companyId, windowHours, buildGraph]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!companyId?.trim()) return;
    const interval = setInterval(fetchData, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [companyId, fetchData]);

  return {
    opportunities,
    recommendations,
    correlations,
    loading,
    error,
    refresh: fetchData,
  };
}
