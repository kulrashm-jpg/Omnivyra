import React, { useState } from 'react';
import {
  type AnalyticsSummary,
  type CampaignHealthSummary,
  type CompanyData,
} from '@/pages/super-admin.types';
import {
  BarChart3,
  Activity,
  Eye,
  TrendingUp,
  AlertCircle,
  CheckCircle,
  Key,
} from 'lucide-react';

interface AnalyticsTabProps {
  isLoadingAnalytics: boolean;
  analyticsSummary: AnalyticsSummary | null;
  campaignHealth: CampaignHealthSummary | null;
  isLoadingCampaignHealth: boolean;
  canShowExternalApisTab: boolean;
  externalApisHealth: { healthy: number; warning: number; failed: number; status: string } | null;
  companies: CompanyData[];
  onNavigateToApis: () => void;
}

export default function AnalyticsTab({
  isLoadingAnalytics,
  analyticsSummary,
  campaignHealth,
  isLoadingCampaignHealth,
  canShowExternalApisTab,
  externalApisHealth,
  companies,
  onNavigateToApis,
}: AnalyticsTabProps) {
  const [analyticsSubTab, setAnalyticsSubTab] = useState<'overview' | 'campaign-health'>('overview');

  return (
    <div className="space-y-6">
      {/* Analytics sub-tabs */}
      <div className="flex gap-2 bg-white rounded-lg p-2 w-fit border border-slate-200 shadow-sm">
        {([{ id: 'overview', label: 'Overview' }, { id: 'campaign-health', label: 'Campaign Health' }] as const).map((sub) => (
          <button
            key={sub.id}
            onClick={() => setAnalyticsSubTab(sub.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${analyticsSubTab === sub.id ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'}`}
          >
            {sub.label}
          </button>
        ))}
      </div>

      {analyticsSubTab === 'overview' && <><div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white rounded-lg shadow-sm p-6 border border-slate-200 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-100 rounded-lg"><BarChart3 className="h-6 w-6 text-blue-600" /></div>
            <div>
              <p className="text-sm text-slate-600">Total Posts</p>
              <p className="text-2xl font-bold text-slate-900">
                {isLoadingAnalytics ? '—' : (analyticsSummary?.total_posts ?? 0).toLocaleString()}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6 border border-slate-200 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-emerald-100 rounded-lg"><Activity className="h-6 w-6 text-emerald-600" /></div>
            <div>
              <p className="text-sm text-slate-600">Total Engagement</p>
              <p className="text-2xl font-bold text-slate-900">
                {isLoadingAnalytics ? '—' : (analyticsSummary?.total_engagement ?? 0).toLocaleString()}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6 border border-slate-200 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-amber-100 rounded-lg"><Eye className="h-6 w-6 text-amber-600" /></div>
            <div>
              <p className="text-sm text-slate-600">Total Reach</p>
              <p className="text-2xl font-bold text-slate-900">
                {isLoadingAnalytics ? '—' : (analyticsSummary?.total_reach ?? 0).toLocaleString()}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6 border border-slate-200 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-purple-100 rounded-lg"><TrendingUp className="h-6 w-6 text-purple-600" /></div>
            <div>
              <p className="text-sm text-slate-600">Avg Engagement Rate</p>
              <p className="text-2xl font-bold text-slate-900">
                {isLoadingAnalytics ? '—' : `${(analyticsSummary?.avg_engagement_rate ?? 0).toFixed(2)}%`}
              </p>
            </div>
          </div>
        </div>
      </div>

      {canShowExternalApisTab && (
        <button
          onClick={onNavigateToApis}
          className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
            externalApisHealth?.status === 'healthy'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100'
              : externalApisHealth != null
              ? 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100'
              : 'bg-slate-100 border-slate-200 text-slate-800 hover:bg-slate-200'
          }`}
        >
          <Key className="h-4 w-4" />
          {externalApisHealth != null
            ? `External APIs: ${externalApisHealth.status === 'healthy' ? 'HEALTHY' : 'ATTENTION REQUIRED'}`
            : 'API Configuration'}
        </button>
      )}

      <div className="bg-white rounded-lg shadow-sm border border-slate-200">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 rounded-t-lg">
          <h3 className="text-lg font-bold text-slate-900">Platform Performance</h3>
          <p className="text-sm text-slate-600 mt-1">Aggregated engagement and reach across all published posts.</p>
        </div>
        <div className="overflow-x-auto">
          {isLoadingAnalytics ? (
            <div className="px-6 py-8 text-sm text-slate-600">Loading analytics…</div>
          ) : analyticsSummary?.platforms?.length ? (
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Platform</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Posts</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Engagement</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Reach</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Avg Rate</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-200">
                {analyticsSummary.platforms.map((row) => (
                  <tr key={row.platform} className="hover:bg-slate-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900 capitalize">{row.platform}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">{row.total_posts.toLocaleString()}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">{row.total_engagement.toLocaleString()}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">{row.total_reach.toLocaleString()}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">{row.avg_engagement_rate.toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="px-6 py-8 text-sm text-slate-600">No analytics data available yet.</div>
          )}
        </div>
      </div>
      </>}

      {analyticsSubTab === 'campaign-health' && <>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="bg-white rounded-lg shadow-sm p-6 border border-slate-200 hover:shadow-md transition-shadow">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-blue-100 rounded-lg"><BarChart3 className="h-6 w-6 text-blue-600" /></div>
              <div>
                <p className="text-sm text-slate-600">Total Campaigns</p>
                <p className="text-2xl font-bold text-slate-900">
                  {isLoadingCampaignHealth ? '—' : (campaignHealth?.total_campaigns ?? 0).toLocaleString()}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6 border border-slate-200 hover:shadow-md transition-shadow">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-emerald-100 rounded-lg"><Activity className="h-6 w-6 text-emerald-600" /></div>
              <div>
                <p className="text-sm text-slate-600">Active Campaigns</p>
                <p className="text-2xl font-bold text-slate-900">
                  {isLoadingCampaignHealth ? '—' : (campaignHealth?.active_campaigns ?? 0).toLocaleString()}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6 border border-slate-200 hover:shadow-md transition-shadow">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-purple-100 rounded-lg"><CheckCircle className="h-6 w-6 text-purple-600" /></div>
              <div>
                <p className="text-sm text-slate-600">Approved Strategies</p>
                <p className="text-2xl font-bold text-slate-900">
                  {isLoadingCampaignHealth ? '—' : (campaignHealth?.approved_strategies ?? 0).toLocaleString()}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6 border border-slate-200 hover:shadow-md transition-shadow">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-amber-100 rounded-lg"><AlertCircle className="h-6 w-6 text-amber-600" /></div>
              <div>
                <p className="text-sm text-slate-600">Pending Re-Approval</p>
                <p className="text-2xl font-bold text-slate-900">
                  {isLoadingCampaignHealth ? '—' : (campaignHealth?.reapproval_required_count ?? 0).toLocaleString()}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-slate-200">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 rounded-t-lg">
            <h3 className="text-lg font-bold text-slate-900">Campaigns by Company</h3>
            <p className="text-sm text-slate-600 mt-1">Strategy approval health across tenants.</p>
          </div>
          <div className="overflow-x-auto">
            {isLoadingCampaignHealth ? (
              <div className="px-6 py-8 text-sm text-slate-600">Loading campaign health…</div>
            ) : campaignHealth?.campaigns_by_company?.length ? (
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Company</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Campaign Count</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Active</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Re-Approval Required</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {campaignHealth.campaigns_by_company.map((row) => {
                    const companyName = companies.find((c) => c.id === row.company_id)?.name || row.company_id;
                    return (
                      <tr key={row.company_id}>
                        <td className="px-6 py-4 text-sm text-slate-900">{companyName}</td>
                        <td className="px-6 py-4 text-sm text-slate-900">{row.total_campaigns}</td>
                        <td className="px-6 py-4 text-sm text-slate-900">{row.active_campaigns}</td>
                        <td className="px-6 py-4 text-sm text-slate-900">{row.reapproval_required}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="px-6 py-8 text-sm text-slate-600">No campaign health data available yet.</div>
            )}
          </div>
        </div>
      </>}
    </div>
  );
}
