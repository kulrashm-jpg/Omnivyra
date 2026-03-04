import React, { useState, useEffect } from 'react';
import { 
  ArrowLeft, 
  BarChart3, 
  TrendingUp, 
  Users, 
  Eye, 
  Heart, 
  MessageCircle,
  Share2,
  Calendar,
  Target,
  RefreshCw
} from 'lucide-react';
import { useCompanyContext } from '../components/CompanyContext';
import Header from '../components/Header';

export default function Analytics() {
  const { selectedCompanyId } = useCompanyContext();
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [analyticsData, setAnalyticsData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const id = urlParams.get('campaignId');
    setCampaignId(id);
    
    if (id && selectedCompanyId) {
      fetchAnalyticsData(id, selectedCompanyId);
    } else if (selectedCompanyId) {
      fetchAnalyticsData(null, selectedCompanyId);
    } else {
      setIsLoading(false);
    }
  }, [selectedCompanyId]);

  const fetchAnalyticsData = async (id: string | null, companyId: string) => {
    setIsLoading(true);
    try {
      setError(null);

      if (id) {
        const response = await fetch(`/api/campaigns/metrics?campaignId=${encodeURIComponent(id)}`, {
          credentials: 'include',
        });
        if (!response.ok) {
          setAnalyticsData(null);
          setError('Failed to load analytics');
          return;
        }
        const json = await response.json();
        const agg = json?.data?.aggregated ?? {};
        const totalReach = Number(agg.totalReach) || 0;
        const totalEngagement =
          (Number(agg.totalLikes) || 0) + (Number(agg.totalComments) || 0) + (Number(agg.totalShares) || 0);
        const totalConversions = Number(agg.totalConversions) || 0;

        const weeklyBreakdown = (() => {
          const wb = agg.weeklyBreakdown ?? {};
          return Object.entries(wb)
            .map(([weekNum, row]: [string, any]) => ({
              week: parseInt(weekNum, 10) || 0,
              reach: Number(row?.impressions ?? row?.reach ?? 0) || 0,
              engagement: Number(row?.engagements ?? row?.engagement ?? 0) || 0,
              conversions: Number(row?.conversions ?? 0) || 0,
            }))
            .sort((a, b) => a.week - b.week);
        })();

        const platformBreakdown = (() => {
          const pb = agg.platformBreakdown ?? {};
          const out: Record<string, { reach: number; engagement: number; conversions: number }> = {};
          for (const [platform, row] of Object.entries(pb) as [string, any][]) {
            out[platform] = {
              reach: Number(row?.impressions ?? row?.reach ?? 0) || 0,
              engagement: Number(row?.engagements ?? row?.engagement ?? 0) || 0,
              conversions: Number(row?.conversions ?? 0) || 0,
            };
          }
          return out;
        })();

        setAnalyticsData({
          totalReach,
          totalEngagement,
          totalConversions,
          weeklyBreakdown,
          platformBreakdown,
        });
        return;
      }

      const response = await fetch('/api/analytics/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          campaignId: undefined,
          timeframe: 'quarter',
        }),
      });
      if (!response.ok) {
        setAnalyticsData(null);
        setError('Failed to load analytics');
        return;
      }
      const data = await response.json();
      setAnalyticsData(data);
    } catch (error) {
      console.error('Error fetching analytics:', error);
      setAnalyticsData(null);
      setError('Failed to load analytics');
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 animate-spin text-purple-500 mx-auto mb-4" />
          <p className="text-gray-600">Loading analytics...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50">
      <Header />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => window.history.back()}
              className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
              Back to Campaign
            </button>
            
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Campaign Analytics</h1>
              <p className="text-gray-600">Performance metrics and insights</p>
            </div>
          </div>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-blue-100 rounded-lg">
                <Eye className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <div className="text-2xl font-bold text-gray-900">
                  {analyticsData?.totalReach?.toLocaleString?.() || '0'}
                </div>
                <div className="text-sm text-gray-600">Total Reach</div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-green-100 rounded-lg">
                <Heart className="w-6 h-6 text-green-600" />
              </div>
              <div>
                <div className="text-2xl font-bold text-gray-900">
                  {analyticsData?.totalEngagement?.toLocaleString?.() || '0'}
                </div>
                <div className="text-sm text-gray-600">Total Engagement</div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-purple-100 rounded-lg">
                <Target className="w-6 h-6 text-purple-600" />
              </div>
              <div>
                <div className="text-2xl font-bold text-gray-900">
                  {analyticsData?.totalConversions?.toLocaleString?.() || '0'}
                </div>
                <div className="text-sm text-gray-600">Total Conversions</div>
              </div>
            </div>
          </div>
        </div>

        {/* Weekly Breakdown */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Weekly Performance</h2>
          <div className="space-y-3">
            {(analyticsData?.weeklyBreakdown || []).map((week: any, index: number) => (
              <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center text-purple-600 font-semibold">
                    {week.week}
                  </div>
                  <span className="font-medium text-gray-900">Week {week.week}</span>
                </div>
                <div className="flex items-center gap-6 text-sm">
                  <div className="text-center">
                    <div className="font-semibold text-blue-600">{week.reach.toLocaleString()}</div>
                    <div className="text-gray-500">Reach</div>
                  </div>
                  <div className="text-center">
                    <div className="font-semibold text-green-600">{week.engagement.toLocaleString()}</div>
                    <div className="text-gray-500">Engagement</div>
                  </div>
                  <div className="text-center">
                    <div className="font-semibold text-purple-600">{week.conversions}</div>
                    <div className="text-gray-500">Conversions</div>
                  </div>
                </div>
              </div>
            ))}
            {(!analyticsData?.weeklyBreakdown || analyticsData.weeklyBreakdown.length === 0) && (
              <div className="text-sm text-gray-600">No analytics data yet.</div>
            )}
          </div>
        </div>

        {/* Platform Breakdown */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Platform Performance</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Object.entries(analyticsData?.platformBreakdown || {}).map(([platform, data]: [string, any]) => (
              <div key={platform} className="p-4 border border-gray-200 rounded-lg">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 bg-gray-100 rounded flex items-center justify-center">
                    <span className="text-xs font-semibold text-gray-600">
                      {platform.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <span className="font-medium text-gray-900 capitalize">{platform}</span>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Reach:</span>
                    <span className="font-semibold text-blue-600">{data.reach.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Engagement:</span>
                    <span className="font-semibold text-green-600">{data.engagement.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Conversions:</span>
                    <span className="font-semibold text-purple-600">{data.conversions}</span>
                  </div>
                </div>
              </div>
            ))}
            {Object.keys(analyticsData?.platformBreakdown || {}).length === 0 && (
              <div className="text-sm text-gray-600">No platform analytics yet.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}