import React, { useEffect, useState } from 'react';

type AnalyticsData = {
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

export default function RecommendationAnalyticsPage() {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [companyId, setCompanyId] = useState('');

  const loadAnalytics = async () => {
    try {
      setIsLoading(true);
      setErrorMessage(null);
      const params = new URLSearchParams();
      if (fromDate) params.set('fromDate', fromDate);
      if (toDate) params.set('toDate', toDate);
      if (campaignId) params.set('campaignId', campaignId);
      if (companyId) params.set('companyId', companyId);
      const response = await fetch(`/api/recommendations/analytics?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to load analytics');
      const data = await response.json();
      setAnalytics(data);
    } catch (error) {
      console.error('Failed to load analytics', error);
      setErrorMessage('Failed to load analytics.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAnalytics();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Recommendation Analytics</h1>
          <p className="text-sm text-gray-600">
            System performance, confidence, platform usage, and policy impact over time.
          </p>
        </div>

        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Filters</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
            <div>
              <label className="block text-xs text-gray-500">From</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500">To</label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500">Campaign ID</label>
              <input
                value={campaignId}
                onChange={(e) => setCampaignId(e.target.value)}
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="campaign-id"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500">Company ID</label>
              <input
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="company-id"
              />
            </div>
          </div>
          <button
            onClick={loadAnalytics}
            disabled={isLoading}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm disabled:opacity-50"
          >
            {isLoading ? 'Loading...' : 'Apply Filters'}
          </button>
        </div>

        {errorMessage && (
          <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg p-3">
            {errorMessage}
          </div>
        )}

        {analytics && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-white rounded-lg shadow p-4">
                <div className="text-xs text-gray-500">Total recommendations</div>
                <div className="text-2xl font-semibold">{analytics.totals.recommendations_count}</div>
              </div>
              <div className="bg-white rounded-lg shadow p-4">
                <div className="text-xs text-gray-500">Avg confidence</div>
                <div className="text-2xl font-semibold">{analytics.totals.avg_confidence}</div>
              </div>
              <div className="bg-white rounded-lg shadow p-4">
                <div className="text-xs text-gray-500">Avg accuracy</div>
                <div className="text-2xl font-semibold">{analytics.totals.avg_accuracy}</div>
              </div>
              <div className="bg-white rounded-lg shadow p-4">
                <div className="text-xs text-gray-500">Campaigns created</div>
                <div className="text-2xl font-semibold">{analytics.totals.campaigns_created}</div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Recommendations over time</h2>
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500">
                    <th className="py-2 pr-4">Date</th>
                    <th className="py-2 pr-4">Count</th>
                    <th className="py-2">Avg Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.timeline.map((row) => (
                    <tr key={row.date} className="border-t">
                      <td className="py-2 pr-4">{row.date}</td>
                      <td className="py-2 pr-4">{row.count}</td>
                      <td className="py-2">{row.avg_confidence}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Platform breakdown</h2>
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500">
                    <th className="py-2 pr-4">Platform</th>
                    <th className="py-2 pr-4">Count</th>
                    <th className="py-2 pr-4">Avg Confidence</th>
                    <th className="py-2">Avg Accuracy</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.by_platform.map((row) => (
                    <tr key={row.platform} className="border-t">
                      <td className="py-2 pr-4">{row.platform}</td>
                      <td className="py-2 pr-4">{row.count}</td>
                      <td className="py-2 pr-4">{row.avg_confidence}</td>
                      <td className="py-2">{row.avg_accuracy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Policy usage</h2>
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500">
                    <th className="py-2 pr-4">Policy</th>
                    <th className="py-2 pr-4">Usage count</th>
                    <th className="py-2">Avg confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.by_policy.map((row) => (
                    <tr key={row.policy_id} className="border-t">
                      <td className="py-2 pr-4">{row.name}</td>
                      <td className="py-2 pr-4">{row.usage_count}</td>
                      <td className="py-2">{row.avg_confidence}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Trend source mix</h2>
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500">
                    <th className="py-2 pr-4">Source</th>
                    <th className="py-2 pr-4">Count</th>
                    <th className="py-2">Avg score</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.by_trend_source.map((row) => (
                    <tr key={row.source} className="border-t">
                      <td className="py-2 pr-4">{row.source}</td>
                      <td className="py-2 pr-4">{row.count}</td>
                      <td className="py-2">{row.avg_score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
