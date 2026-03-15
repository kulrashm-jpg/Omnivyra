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
    if (!selectedCompanyId) return;
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
        
        // Only show real campaigns from database
        // No auto-creation of dummy campaigns
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

      const deleteResult = await deleteResponse.json();
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
    planning: 'bg-blue-100 text-blue-800',
    twelve_week_plan: 'bg-indigo-100 text-indigo-800',
    daily_plan: 'bg-amber-100 text-amber-800',
    charting: 'bg-teal-100 text-teal-800',
    schedule: 'bg-green-100 text-green-800',
    active: 'bg-green-100 text-green-800',
    completed: 'bg-gray-100 text-gray-800',
    paused: 'bg-yellow-100 text-yellow-800',
    cancelled: 'bg-red-100 text-red-800',
  };
  const getStageLabel = (stage: string, durationWeeks?: number | null) =>
    getStageLabelWithDuration(stage, durationWeeks);

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50">
      <Header />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {notice && (
          <div
            className={`mb-4 rounded-lg border px-3 py-2 text-sm ${
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
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Campaign Planning</h1>
            <p className="text-gray-600 mt-2">Manage your marketing campaigns and content strategy</p>
          </div>
          
          <button 
            onClick={() => window.location.href = '/campaign-planner?mode=direct'}
            className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white px-6 py-3 rounded-lg font-medium transition-all duration-200 flex items-center gap-2"
          >
            <Plus className="w-5 h-5" />
            Create New Campaign
          </button>
        </div>

        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Target className="w-6 h-6 text-blue-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm text-gray-600">Total Campaigns</p>
                <p className="text-2xl font-bold text-gray-900">{campaigns.length}</p>
              </div>
            </div>
          </div>
          
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center">
              <div className="p-2 bg-green-100 rounded-lg">
                <Calendar className="w-6 h-6 text-green-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm text-gray-600">Active Campaigns</p>
                <p className="text-2xl font-bold text-gray-900">
                  {campaigns.filter(c => c.status === 'active').length}
                </p>
              </div>
            </div>
          </div>
          
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center">
              <div className="p-2 bg-purple-100 rounded-lg">
                <BarChart3 className="w-6 h-6 text-purple-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm text-gray-600">Total Content</p>
                <p className="text-2xl font-bold text-gray-900">
                  {campaigns.reduce((sum, c) => sum + (c.stats?.totalContent ?? 0), 0)}
                </p>
              </div>
            </div>
          </div>
          
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center">
              <div className="p-2 bg-yellow-100 rounded-lg">
                <Clock className="w-6 h-6 text-yellow-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm text-gray-600">Planning</p>
                <p className="text-2xl font-bold text-gray-900">
                  {campaigns.filter(c => c.status === 'planning').length}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Stage Filter */}
        <div className="flex flex-wrap gap-2 mb-6">
          {[
            { id: 'all', label: 'All' },
            { id: 'planning', label: 'Planning' },
            { id: 'twelve_week_plan', label: '12 Week Plan' },
            { id: 'daily_plan', label: 'Daily Plan' },
            { id: 'charting', label: 'Charting' },
            { id: 'schedule', label: 'Schedule' },
          ].map((s) => (
            <button
              key={s.id}
              onClick={() => setStageFilter(s.id)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                stageFilter === s.id
                  ? 'bg-gradient-to-r from-purple-500 to-violet-600 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Campaigns List */}
        {isLoading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading campaigns...</p>
          </div>
        ) : filteredCampaigns.length === 0 ? (
          <div className="text-center py-12">
            <Target className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-gray-900 mb-2">{campaigns.length === 0 ? 'No Campaigns Yet' : 'No campaigns in this stage'}</h3>
            <p className="text-gray-600 mb-6">{campaigns.length === 0 ? 'Create your first campaign to get started with content planning' : 'Try selecting "All" or another stage'}</p>
            {campaigns.length === 0 ? (
              <button 
                onClick={() => window.location.href = '/campaign-planner?mode=direct'}
                className="bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 text-white px-6 py-3 rounded-lg font-medium transition-all duration-200 flex items-center gap-2 mx-auto"
              >
                <Plus className="w-5 h-5" />
                Create Your First Campaign
              </button>
            ) : (
              <button 
                onClick={() => setStageFilter('all')}
                className="bg-white border border-purple-500 text-purple-600 hover:bg-purple-50 px-6 py-3 rounded-lg font-medium transition-all duration-200 flex items-center gap-2 mx-auto"
              >
                View All Campaigns
              </button>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            {/* Table Header */}
            <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 rounded-t-lg">
              <div className="grid grid-cols-12 gap-4 items-center text-sm font-medium text-gray-700">
                <div className="col-span-3">Campaign Name</div>
                <div className="col-span-2">Status</div>
                <div className="col-span-1">Type</div>
                <div className="col-span-2">Content</div>
                <div className="col-span-2">Created</div>
                <div className="col-span-1">Progress</div>
                <div className="col-span-1">Actions</div>
              </div>
            </div>

            {/* Campaign Rows */}
            <div className="divide-y divide-gray-200">
              {filteredCampaigns.map((campaign, index) => (
                <div 
                  key={campaign.id}
                  className="px-6 py-4 hover:bg-gray-50 transition-colors cursor-pointer"
                  onClick={() => handleCampaignClick(campaign.id)}
                >
                  <div className="grid grid-cols-12 gap-4 items-center">
                    {/* Campaign Name */}
                    <div className="col-span-3">
                      <div className="flex flex-col">
                        <h3 className="text-sm font-semibold text-gray-900 truncate">
                          {campaign.name}
                        </h3>
                        <p className="text-xs text-gray-500 truncate">
                          ID: <code className="text-gray-600">{campaign.id}</code>
                        </p>
                        <p className="text-xs text-gray-400 truncate">
                          {campaign.description || 'No description'}
                        </p>
                      </div>
                    </div>

                    {/* Status */}
                    <div className="col-span-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${stageColors[campaign.current_stage || campaign.status] || 'bg-gray-100 text-gray-800'}`}>
                          {getStageLabel(campaign.current_stage || campaign.status)}
                        </span>
                        {reapprovalMap[campaign.id] && (
                          <span className="inline-flex px-2 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                            Re-Approval Required
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Type */}
                    <div className="col-span-1">
                      <span className="text-sm text-gray-600 capitalize">
                        {campaign.timeframe}
                      </span>
                    </div>

                    {/* Content Stats */}
                    <div className="col-span-2">
                      <div className="flex gap-4 text-sm">
                        <span className="text-gray-600">
                          <span className="font-medium">{campaign.stats?.weeklyPlans ?? 0}</span> weeks
                        </span>
                        <span className="text-gray-600">
                          <span className="font-medium">{campaign.stats?.totalContent ?? 0}</span> content
                        </span>
                      </div>
                    </div>

                    {/* Created Date */}
                    <div className="col-span-2">
                      <div className="text-sm text-gray-600">
                        {new Date(campaign.created_at).toLocaleDateString()}
                      </div>
                    </div>

                    {/* Progress */}
                    <div className="col-span-1">
                      <div className="flex items-center gap-2">
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div 
                            className="bg-blue-600 h-2 rounded-full"
                            style={{ width: `${Math.min(((campaign.stats?.weeklyPlans ?? 0) / 12) * 100, 100)}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-600 w-8">
                          {Math.round(((campaign.stats?.weeklyPlans ?? 0) / 12) * 100)}%
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="col-span-1 flex justify-end gap-2 items-center">
                      {pendingDeleteCampaignId === campaign.id ? (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900"
                        >
                          <span className="whitespace-nowrap">Delete? This cannot be undone.</span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setPendingDeleteCampaignId(null); }}
                              disabled={isDeletingCampaign}
                              className="px-2 py-1 rounded border border-amber-300 bg-white hover:bg-amber-100 disabled:opacity-60 text-xs"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); confirmDeleteCampaign(e); }}
                              disabled={isDeletingCampaign}
                              className="px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed text-xs"
                            >
                              {isDeletingCampaign ? 'Deleting…' : 'Delete'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <button 
                            onClick={(e) => handleDeleteCampaign(campaign.id, e)}
                            className="text-gray-400 hover:text-red-600 transition-colors p-1 rounded hover:bg-red-50"
                            title="Delete Campaign"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={(e) => { e.stopPropagation(); handleCampaignClick(campaign.id); }}
                            className="text-gray-400 hover:text-purple-600 transition-colors p-1 rounded hover:bg-purple-50"
                            title="View Campaign"
                          >
                            <ArrowRight className="w-4 h-4" />
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
