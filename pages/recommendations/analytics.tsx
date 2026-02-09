import React, { useEffect, useMemo, useState } from 'react';
import Header from '../../components/Header';
import { useCompanyContext } from '../../components/CompanyContext';
import { supabase } from '../../utils/supabaseClient';

type RecommendationAnalytics = {
  totals: {
    recommendations_count: number;
    campaigns_created: number;
    avg_confidence: number;
    avg_accuracy: number;
  };
  by_platform: Array<{ platform: string; count: number; avg_confidence: number; avg_accuracy: number }>;
  by_trend_source: Array<{ source: string; count: number; avg_score: number }>;
  by_policy: Array<{ policy_id: string; name: string; usage_count: number; avg_confidence: number }>;
  timeline: Array<{ date: string; count: number; avg_confidence: number }>;
};

export default function RecommendationsAnalyticsPage() {
  const { selectedCompanyId, isLoading: isCompanyLoading } = useCompanyContext();
  const [analytics, setAnalytics] = useState<RecommendationAnalytics | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const loadAnalytics = async () => {
      if (!selectedCompanyId) {
        setAnalytics(null);
        return;
      }
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        const response = await fetch(
          `/api/recommendations/analytics?companyId=${encodeURIComponent(selectedCompanyId)}`,
          {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          }
        );
        if (!response.ok) {
          const data = await response.json().catch(() => null);
          const msg =
            data?.error === 'FORBIDDEN_ROLE'
              ? "You don't have permission to view analytics. Try signing in again or contact your administrator."
              : data?.error || 'Failed to load analytics';
          throw new Error(msg);
        }
        const data = await response.json();
        setAnalytics(data);
      } catch (error: any) {
        setAnalytics(null);
        setErrorMessage(error?.message || 'Failed to load analytics.');
      } finally {
        setIsLoading(false);
      }
    };
    loadAnalytics();
  }, [selectedCompanyId]);

  const successRate = useMemo(() => {
    if (!analytics) return '—';
    return `${Math.round((analytics.totals.avg_accuracy || 0) * 100)}%`;
  }, [analytics]);

  if (isCompanyLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <div className="p-6 text-gray-500">Loading company context...</div>
      </div>
    );
  }

  if (!selectedCompanyId) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <div className="p-6 text-gray-500">Select a company to view analytics.</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <Header />
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Recommendation Analytics</h1>
          <p className="text-sm text-gray-600">
            Trend usage, confidence, feedback, and success rate for recommendation outputs.
          </p>
        </div>

        {errorMessage && (
          <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg p-3">
            {errorMessage}
          </div>
        )}

        {isLoading && <div className="text-sm text-gray-500">Loading analytics...</div>}

        {analytics && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-white rounded-lg shadow p-4">
                <div className="text-xs text-gray-500">Recommendations</div>
                <div className="text-lg font-semibold text-gray-900">
                  {analytics.totals.recommendations_count}
                </div>
              </div>
              <div className="bg-white rounded-lg shadow p-4">
                <div className="text-xs text-gray-500">Avg confidence</div>
                <div className="text-lg font-semibold text-gray-900">
                  {analytics.totals.avg_confidence}
                </div>
              </div>
              <div className="bg-white rounded-lg shadow p-4">
                <div className="text-xs text-gray-500">Feedback (avg accuracy)</div>
                <div className="text-lg font-semibold text-gray-900">
                  {analytics.totals.avg_accuracy}
                </div>
              </div>
              <div className="bg-white rounded-lg shadow p-4">
                <div className="text-xs text-gray-500">Success rate</div>
                <div className="text-lg font-semibold text-gray-900">{successRate}</div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-sm font-semibold text-gray-900 mb-3">Trends Used</h2>
              <div className="space-y-2 text-xs text-gray-700">
                {analytics.by_trend_source.map((source) => (
                  <div key={source.source} className="flex items-center justify-between">
                    <span>{source.source}</span>
                    <span>
                      {source.count} • Avg score {source.avg_score}
                    </span>
                  </div>
                ))}
                {analytics.by_trend_source.length === 0 && (
                  <div className="text-xs text-gray-500">No trend sources recorded.</div>
                )}
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-sm font-semibold text-gray-900 mb-3">Confidence Over Time</h2>
              <div className="space-y-2 text-xs text-gray-700">
                {analytics.timeline.map((entry) => (
                  <div key={entry.date} className="flex items-center justify-between">
                    <span>{entry.date}</span>
                    <span>
                      {entry.count} recs • Avg confidence {entry.avg_confidence}
                    </span>
                  </div>
                ))}
                {analytics.timeline.length === 0 && (
                  <div className="text-xs text-gray-500">No timeline data yet.</div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
