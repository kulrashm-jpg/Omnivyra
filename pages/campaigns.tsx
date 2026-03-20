import React, { useState, useEffect } from 'react';
import { Plus, Calendar, Target, BarChart3, Clock, ArrowRight, Trash2 } from 'lucide-react';
import { useCompanyContext } from '../components/CompanyContext';
import Header from '../components/Header';
import { fetchWithAuth } from '../components/community-ai/fetchWithAuth';
import { getStageLabelWithDuration } from '../backend/types/CampaignStage';
import { navigateToCampaign } from '../lib/campaignResumeStore';

interface Campaign {
  id: string;
  name: string;
  description: string;
  status: string;
  current_stage: string;
  timeframe: string;
  start_date: string;
  end_date: string;
  created_at: string;
  stats: {
    goals: number;
    weeklyPlans: number;
    dailyPlans: number;
    totalContent: number;
  };
}

export default function CampaignsList() {
  const { selectedCompanyId } = useCompanyContext();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [reapprovalMap, setReapprovalMap] = useState<Record<string, boolean>>({});
  const [stageFilter, setStageFilter] = useState<string>('all');
  const [notice, setNotice] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [pendingDeleteCampaignId, setPendingDeleteCampaignId] = useState<string | null>(null);
  const [isDeletingCampaign, setIsDeletingCampaign] = useState(false);
  const filteredCampaigns = stageFilter === 'all'
    ? campaigns
    : campaigns.filter((c) => (c.current_stage || c.status) === stageFilter);

  const notify = (type: 'success' | 'error' | 'info', message: string) => setNotice({ type, message });

  useEffect(() => {
    if (!selectedCompanyId) {
      setIsLoading(false);
      return;
    }
    fetchCampaigns();
  }, [selectedCompanyId]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

   const fetchCampaigns = async () => {
    setIsLoading(true);
    try {
      if (!selectedCompanyId) return;
      const response = await fetch(`/api/campaigns?companyId=${encodeURIComponent(selectedCompanyId)}`);
      if (response.ok) {
        const data = await response.json();
        setCampaigns(data.campaigns || []);
        const ids = (data.campaigns || []).map((campaign: Campaign) => campaign.id).filter(Boolean);
        await fetchReapprovalStatuses(ids);
      } else {
        console.error('Failed to fetch campaigns');
      }
    } catch (error) {
      console.error('Error fetching campaigns:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchReapprovalStatuses = async (campaignIds: string[]) => {
    if (campaignIds.length === 0) {
      setReapprovalMap({});
      return;
    }
    try {
      const results = await Promise.all(
        campaignIds.map(async (id) => {
          const response = await fetch(`/api/campaigns/${id}/reapproval-status`);
          if (!response.ok) return [id, false] as const;
          const data = await response.json();
          return [id, data?.status === 'reapproval_required'] as const;
        })
      );
      const nextMap = results.reduce<Record<string, boolean>>((acc, [id, value]) => {
        acc[id] = value;
        return acc;
      }, {});
      setReapprovalMap(nextMap);
    } catch (error) {
      console.error('Error fetching reapproval statuses:', error);
      setReapprovalMap({});
    }
  };

  const handleCampaignClick = (campaignId: string) => {
    navigateToCampaign(campaignId, selectedCompanyId);
  };

  const handleDeleteCampaign = async (campaignId: string, e: React.MouseEvent) => {
    e.stopPropagation();

    if (!selectedCompanyId) {
      notify('error', 'Please select a company before deleting campaigns.');
      return;
    }

    setPendingDeleteCampaignId(campaignId);
  };

  const confirmDeleteCampaign = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    e?.preventDefault();
    if (!pendingDeleteCampaignId) return;
    if (!selectedCompanyId) {
      notify('error', 'Please select a company before deleting campaigns.');
      setPendingDeleteCampaignId(null);
      return;
    }
    setIsDeletingCampaign(true);
    try {
      const deleteUrl = `/api/admin/delete-campaign?companyId=${encodeURIComponent(selectedCompanyId)}`;
      const deleteResponse = await fetchWithAuth(deleteUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: pendingDeleteCampaignId,
          companyId: selectedCompanyId,
          ipAddress: '127.0.0.1',
          userAgent: navigator.userAgent
        })
      });

      const deleteResult = deleteResponse.ok ? await deleteResponse.json() : {};
      if (deleteResponse.ok && deleteResult.success) {
        notify('success', 'Campaign deleted successfully.');
        await fetchCampaigns();
      } else {
        notify('error', `Delete failed: ${deleteResult.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error deleting campaign:', error);
      notify('error', `Failed to delete campaign: ${error instanceof Error ? error.message : 'Please try again.'}`);
    } finally {
      setIsDeletingCampaign(false);
      setPendingDeleteCampaignId(null);
    }
  };

  const stageColors: Record<string, string> = {
    planning: 'bg-blue-50 text-blue-700 border border-blue-200',
    twelve_week_plan: 'bg-indigo-50 text-indigo-700 border border-indigo-200',
    daily_plan: 'bg-amber-50 text-amber-700 border border-amber-200',
    charting: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
    schedule: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
    active: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
    completed: 'bg-gray-50 text-gray-600 border border-gray-200',
    paused: 'bg-yellow-50 text-yellow-700 border border-yellow-200',
    cancelled: 'bg-red-50 text-red-700 border border-red-200',
  };
  const getStageLabel = (stage: string, durationWeeks?: number | null) =>
    getStageLabelWithDuration(stage, durationWeeks);

  const statCards = [
    { label: 'Total Campaigns', value: campaigns.length, icon: Target, bg: 'bg-indigo-50', color: 'text-indigo-600' },
    { label: 'Active', value: campaigns.filter(c => c.status === 'active').length, icon: Calendar, bg: 'bg-emerald-50', color: 'text-emerald-600' },
    { label: 'Total Content', value: campaigns.reduce((sum, c) => sum + (c.stats?.totalContent ?? 0), 0), icon: BarChart3, bg: 'bg-violet-50', color: 'text-violet-600' },
    { label: 'Planning', value: campaigns.filter(c => c.status === 'planning').length, icon: Clock, bg: 'bg-amber-50', color: 'text-amber-600' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {notice && (
          <div
            className={`mb-4 rounded-lg border px-4 py-3 text-sm font-medium ${
              notice.type === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : notice.type === 'error'
                  ? 'border-red-200 bg-red-50 text-red-800'
                  : 'border-indigo-200 bg-indigo-50 text-indigo-800'
            }`}
            role="status"
            aria-live="polite"
          >
            {notice.message}
          </div>
        )}

        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-8">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Campaign Planning</h1>
            <p className="text-sm text-gray-500 mt-1">Manage your marketing campaigns and content strategy</p>
          </div>
          <button
            onClick={() => window.location.href = '/campaign-planner?mode=direct'}
            className="inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg font-medium text-sm transition-colors shadow-sm w-full sm:w-auto"
          >
            <Plus className="w-4 h-4" />
            New Campaign
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {statCards.map(({ label, value, icon: Icon, bg, color }) => (
            <div key={label} className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${bg}`}>
                  <Icon className={`w-5 h-5 ${color}`} />
                </div>
                <div>
                  <p className="text-xs text-gray-500 font-medium">{label}</p>
                  <p className="text-xl font-bold text-gray-900">{value}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Stage Filter */}
        <div className="flex flex-wrap gap-2 mb-5">
          {[
            { id: 'all', label: 'All' },
            { id: 'planning', label: 'Planning' },
            { id: 'twelve_week_plan', label: 'Week Plan' },
            { id: 'daily_plan', label: 'Daily Plan' },
            { id: 'schedule', label: 'Schedule' },
          ].map((s) => (
            <button
              key={s.id}
              onClick={() => setStageFilter(s.id)}
              className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-colors ${
                stageFilter === s.id
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Campaigns Table */}
        {isLoading ? (
          <div className="text-center py-16">
            <div className="animate-spin rounded-full h-10 w-10 border-2 border-indigo-600 border-t-transparent mx-auto"></div>
            <p className="mt-4 text-sm text-gray-500">Loading campaigns...</p>
          </div>
        ) : filteredCampaigns.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 text-center py-16 shadow-sm">
            <Target className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-base font-semibold text-gray-900 mb-1">
              {campaigns.length === 0 ? 'No Campaigns Yet' : 'No campaigns in this stage'}
            </h3>
            <p className="text-sm text-gray-500 mb-6">
              {campaigns.length === 0
                ? 'Create your first campaign to get started with content planning'
                : 'Try selecting "All" or another stage'}
            </p>
            {campaigns.length === 0 ? (
              <button
                onClick={() => window.location.href = '/campaign-planner?mode=direct'}
                className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg font-medium text-sm transition-colors mx-auto"
              >
                <Plus className="w-4 h-4" />
                Create Your First Campaign
              </button>
            ) : (
              <button
                onClick={() => setStageFilter('all')}
                className="inline-flex items-center gap-2 bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 px-5 py-2.5 rounded-lg font-medium text-sm transition-colors mx-auto"
              >
                View All Campaigns
              </button>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            {/* Table Header — hidden on mobile, shown on sm+ */}
            <div className="hidden sm:block px-4 sm:px-6 py-3 border-b border-gray-100 bg-gray-50">
              <div className="grid grid-cols-12 gap-4 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                <div className="col-span-4">Campaign</div>
                <div className="col-span-2">Status</div>
                <div className="col-span-2 hidden md:block">Content</div>
                <div className="col-span-2 hidden md:block">Created</div>
                <div className="col-span-2 md:col-span-1 hidden sm:block">Progress</div>
                <div className="col-span-2 md:col-span-1 text-right">Actions</div>
              </div>
            </div>

            {/* Campaign Rows */}
            <div className="divide-y divide-gray-100">
              {filteredCampaigns.map((campaign) => (
                <div
                  key={campaign.id}
                  className="px-4 sm:px-6 py-4 hover:bg-indigo-50/30 transition-colors cursor-pointer group"
                  onClick={() => handleCampaignClick(campaign.id)}
                >
                  {/* Mobile layout: stacked card */}
                  <div className="sm:hidden flex flex-col gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-semibold text-gray-900 truncate group-hover:text-indigo-700 transition-colors">
                          {campaign.name}
                        </h3>
                        <p className="text-xs text-gray-400 truncate mt-0.5">
                          {campaign.description || 'No description'}
                        </p>
                      </div>
                      <div className="flex gap-1 items-center shrink-0">
                        {pendingDeleteCampaignId === campaign.id ? (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900"
                          >
                            <span className="whitespace-nowrap">Delete?</span>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setPendingDeleteCampaignId(null); }}
                              disabled={isDeletingCampaign}
                              className="px-2 py-0.5 rounded border border-amber-300 bg-white hover:bg-amber-100 disabled:opacity-60 text-xs"
                            >No</button>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); confirmDeleteCampaign(e); }}
                              disabled={isDeletingCampaign}
                              className="px-2 py-0.5 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-60 text-xs"
                            >{isDeletingCampaign ? '...' : 'Yes'}</button>
                          </div>
                        ) : (
                          <>
                            <button
                              onClick={(e) => handleDeleteCampaign(campaign.id, e)}
                              className="text-gray-300 hover:text-red-500 transition-colors p-1.5 rounded hover:bg-red-50"
                              title="Delete Campaign"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleCampaignClick(campaign.id); }}
                              className="text-gray-300 hover:text-indigo-600 transition-colors p-1.5 rounded hover:bg-indigo-50"
                              title="Open Campaign"
                            >
                              <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${stageColors[campaign.current_stage || campaign.status] || 'bg-gray-50 text-gray-600 border border-gray-200'}`}>
                        {getStageLabel(campaign.current_stage || campaign.status)}
                      </span>
                      {reapprovalMap[campaign.id] && (
                        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                          Re-Approval
                        </span>
                      )}
                      <span className="text-xs text-gray-500 capitalize bg-gray-50 px-2 py-0.5 rounded-md border border-gray-100">
                        {campaign.timeframe}
                      </span>
                      <span className="text-xs text-gray-500"><span className="font-semibold text-gray-700">{campaign.stats?.totalContent ?? 0}</span> items</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                        <div
                          className="bg-indigo-500 h-1.5 rounded-full transition-all"
                          style={{ width: `${Math.min(((campaign.stats?.weeklyPlans ?? 0) / 12) * 100, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-400 shrink-0">
                        {Math.round(((campaign.stats?.weeklyPlans ?? 0) / 12) * 100)}%
                      </span>
                    </div>
                  </div>

                  {/* Desktop layout: grid row */}
                  <div className="hidden sm:grid grid-cols-12 gap-4 items-center">
                    {/* Campaign Name */}
                    <div className="col-span-4">
                      <h3 className="text-sm font-semibold text-gray-900 truncate group-hover:text-indigo-700 transition-colors">
                        {campaign.name}
                      </h3>
                      <p className="text-xs text-gray-400 truncate mt-0.5">
                        {campaign.description || 'No description'}
                      </p>
                    </div>

                    {/* Status */}
                    <div className="col-span-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${stageColors[campaign.current_stage || campaign.status] || 'bg-gray-50 text-gray-600 border border-gray-200'}`}>
                          {getStageLabel(campaign.current_stage || campaign.status)}
                        </span>
                        {reapprovalMap[campaign.id] && (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                            Re-Approval
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Content Stats */}
                    <div className="col-span-2 hidden md:block">
                      <div className="flex gap-3 text-xs text-gray-500">
                        <span><span className="font-semibold text-gray-700">{campaign.stats?.weeklyPlans ?? 0}</span> weeks</span>
                        <span><span className="font-semibold text-gray-700">{campaign.stats?.totalContent ?? 0}</span> items</span>
                      </div>
                    </div>

                    {/* Created Date */}
                    <div className="col-span-2 hidden md:block">
                      <span className="text-xs text-gray-500">
                        {new Date(campaign.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    </div>

                    {/* Progress */}
                    <div className="col-span-2 md:col-span-1">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                          <div
                            className="bg-indigo-500 h-1.5 rounded-full transition-all"
                            style={{ width: `${Math.min(((campaign.stats?.weeklyPlans ?? 0) / 12) * 100, 100)}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-400 shrink-0 w-7 text-right">
                          {Math.round(((campaign.stats?.weeklyPlans ?? 0) / 12) * 100)}%
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="col-span-2 md:col-span-1 flex justify-end gap-1 items-center">
                      {pendingDeleteCampaignId === campaign.id ? (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900"
                        >
                          <span className="whitespace-nowrap">Delete?</span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setPendingDeleteCampaignId(null); }}
                              disabled={isDeletingCampaign}
                              className="px-2 py-0.5 rounded border border-amber-300 bg-white hover:bg-amber-100 disabled:opacity-60 text-xs"
                            >
                              No
                            </button>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); confirmDeleteCampaign(e); }}
                              disabled={isDeletingCampaign}
                              className="px-2 py-0.5 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-60 text-xs"
                            >
                              {isDeletingCampaign ? '...' : 'Yes'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={(e) => handleDeleteCampaign(campaign.id, e)}
                            className="text-gray-300 hover:text-red-500 transition-colors p-1.5 rounded hover:bg-red-50"
                            title="Delete Campaign"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleCampaignClick(campaign.id); }}
                            className="text-gray-300 hover:text-indigo-600 transition-colors p-1.5 rounded hover:bg-indigo-50"
                            title="Open Campaign"
                          >
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
