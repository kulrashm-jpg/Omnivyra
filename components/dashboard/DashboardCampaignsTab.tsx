import React, { useState } from 'react';
import { Plus, Target, Play, Edit3, MoreHorizontal, Loader2, Trash2, ChevronRight, Calendar, FileText, LayoutGrid, List } from 'lucide-react';
import PlatformIcon from '../ui/PlatformIcon';
import { getPlatformLabel } from '../../utils/platformIcons';
import CampaignProgress from './CampaignProgress';
import type { useDashboardState } from '../hooks/useDashboardState';
import EmptyState from '../shared/EmptyState';
import ExamplePreview from '../shared/ExamplePreview';
import { trackActivationEvent } from '../../lib/analytics/activationEvents';

type DashboardState = ReturnType<typeof useDashboardState>;

export default function DashboardCampaignsTab({ d }: { d: DashboardState }) {
  const {
    router, campaigns, filteredCampaigns, stageFilter, setStageFilter,
    CAMPAIGN_STAGES, campaignProgress, stageAvailability,
    canCreateCampaign, handleViewCampaign, handleExpandToWeekPlans,
    expandingCampaignId, handleDeleteCampaign, pendingDeleteCampaignId,
    setPendingDeleteCampaignId, isDeletingCampaign, confirmDeleteCampaign,
    getStageLabel, buildPlanningWorkspaceUrl,
    isLoadingData, selectedCompanyId,
  } = d;

  const [viewMode, setViewMode] = useState<'card' | 'list'>('card');

  return (
          <div className="space-y-8">
            {/* Campaigns Header */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl sm:text-3xl font-bold text-gray-900">All Campaigns</h2>
                <p className="text-gray-600 mt-1">Manage and track all your content campaigns</p>
              </div>
              <div className="flex items-center gap-3">
                {/* Card / List toggle */}
                <div className="flex items-center rounded-lg border border-gray-200 p-0.5 bg-white">
                  <button
                    onClick={() => setViewMode('card')}
                    className={`p-2 rounded-md transition-colors ${viewMode === 'card' ? 'bg-indigo-100 text-indigo-700' : 'text-gray-400 hover:text-gray-600'}`}
                    title="Card view"
                  >
                    <LayoutGrid className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setViewMode('list')}
                    className={`p-2 rounded-md transition-colors ${viewMode === 'list' ? 'bg-indigo-100 text-indigo-700' : 'text-gray-400 hover:text-gray-600'}`}
                    title="List view"
                  >
                    <List className="h-4 w-4" />
                  </button>
                </div>
                <button
                  onClick={() => window.location.href = '/campaign-planner?mode=direct'}
                  disabled={!canCreateCampaign}
                  title={
                    canCreateCampaign ? '' : 'You do not have permission to create campaigns.'
                  }
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg font-medium transition-colors flex items-center gap-2 disabled:opacity-50 shadow-sm"
                >
                  <Plus className="h-5 w-5" />
                  Create Campaign
                </button>
              </div>
            </div>

            {/* Stage Filter */}
            {campaigns.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {CAMPAIGN_STAGES.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setStageFilter(s.id)}
                    className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                      stageFilter === s.id
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            ) : null}

            {/* Campaigns List */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
              {isLoadingData ? (
                <div className="flex justify-center items-center py-16">
                  <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                  <span className="ml-2 text-gray-600">Loading campaigns...</span>
                </div>
              ) : filteredCampaigns.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    tone={campaigns.length === 0 ? 'first-time' : 'no-results'}
                    illustration={<Target className="h-6 w-6" />}
                    title={
                      campaigns.length === 0
                        ? 'Launch your first campaign'
                        : 'No results found'
                    }
                    description={
                      campaigns.length === 0
                        ? 'Start one campaign to see planning progress, weekly output, and channel execution all in one place.'
                        : `Nothing matches the ${CAMPAIGN_STAGES.find((s) => s.id === stageFilter)?.label ?? stageFilter} filter right now.`
                    }
                    primaryAction={{
                      label: campaigns.length === 0 ? 'Launch your first campaign' : 'Clear filters',
                      onClick: () => {
                        trackActivationEvent('empty_state_primary_clicked', {
                          accountId: selectedCompanyId,
                          context: 'campaigns_list',
                          meta: { stageFilter },
                        });
                        if (campaigns.length === 0) {
                          window.location.href = '/campaign-planner?mode=direct';
                          return;
                        }
                        setStageFilter('all');
                      },
                    }}
                    secondaryAction={
                      campaigns.length === 0
                        ? {
                            label: 'Try with sample data',
                            onClick: () => {
                              trackActivationEvent('sample_used', {
                                accountId: selectedCompanyId,
                                context: 'campaigns_list',
                              });
                              window.location.href = '/campaigns?sample=1';
                            },
                          }
                        : undefined
                    }
                    examplePreview={campaigns.length === 0 ? <ExamplePreview variant="campaign" /> : undefined}
                  />
                </div>
              ) : (
                <div className="p-4 sm:p-6">
                  {viewMode === 'list' ? (
                    /* ── List View ── */
                    <div className="divide-y divide-gray-100">
                      {filteredCampaigns.map((campaign) => (
                        <div
                          key={campaign.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => handleViewCampaign(campaign.id)}
                          onKeyDown={(e) => e.key === 'Enter' && handleViewCampaign(campaign.id)}
                          className="flex items-center justify-between gap-4 py-3 px-2 hover:bg-gray-50 rounded-lg cursor-pointer transition-colors"
                        >
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div className="p-2 rounded-lg bg-indigo-50 shrink-0">
                              <Target className="h-4 w-4 text-indigo-600" />
                            </div>
                            <div className="min-w-0">
                              <h3 className="text-sm font-semibold text-gray-900 truncate">{campaign.name}</h3>
                              <p className="text-xs text-gray-500">
                                {campaign.start_date ? new Date(campaign.start_date).toLocaleDateString() : 'Not scheduled'}
                                {campaign.duration_weeks ? ` · ${campaign.duration_weeks}w` : ''}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-xs px-2 py-1 rounded-full bg-indigo-50 text-indigo-700 font-medium">
                              {getStageLabel(campaign.current_stage || campaign.status, campaign.duration_weeks)}
                            </span>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDeleteCampaign(campaign.id); }}
                              className="p-1.5 hover:bg-red-100 rounded-lg transition-colors text-gray-400 hover:text-red-600"
                              title="Delete"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                  /* ── Card View ── */
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                    {filteredCampaigns.map((campaign) => (
                      <div
                        key={campaign.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => handleViewCampaign(campaign.id)}
                        onKeyDown={(e) => e.key === 'Enter' && handleViewCampaign(campaign.id)}
                        className="bg-white rounded-xl p-5 border border-gray-200 hover:border-indigo-200 hover:shadow-sm transition-all duration-150 cursor-pointer"
                      >
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-3">
                            <div className="p-3 rounded-lg bg-indigo-50">
                              <Target className="h-6 w-6 text-indigo-600" />
                            </div>
                            <div>
                              <h3 className="text-lg font-semibold text-gray-900">{campaign.name}</h3>
                              <p className="text-xs text-gray-500 font-mono mt-0.5">ID: {campaign.id}</p>
                              <p className="text-gray-600 mt-1">{campaign.description || 'No description available'}</p>
                              <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
                                <span>Created: {campaign.created_at ? new Date(campaign.created_at).toLocaleDateString() : 'Recently'}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                        
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleViewCampaign(campaign.id);
                              }}
                              className="px-4 py-2 rounded-full text-sm font-medium bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 transition-colors"
                            >
                              {getStageLabel(campaign.current_stage || campaign.status, campaign.duration_weeks)}
                            </button>
                          <div className="flex flex-wrap items-center gap-2">
                            <a
                              href={`/campaign-details/${campaign.id}${selectedCompanyId ? `?companyId=${encodeURIComponent(selectedCompanyId)}` : ''}`}
                              onClick={(e) => e.stopPropagation()}
                              className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                              title="Week plan"
                            >
                              <Calendar className="h-4 w-4 text-slate-600" />
                            </a>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                window.location.href = buildPlanningWorkspaceUrl(campaign.id);
                              }}
                              className="p-2 hover:bg-indigo-100 rounded-lg transition-colors"
                              title="View submitted plan"
                            >
                              <FileText className="h-4 w-4 text-indigo-600" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteCampaign(campaign.id);
                              }}
                              className="p-2 hover:bg-red-100 rounded-lg transition-colors"
                              title="Delete Campaign"
                            >
                              <Trash2 className="h-4 w-4 text-red-600" />
                            </button>
                          </div>
                        </div>
                        {pendingDeleteCampaignId === campaign.id && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 flex items-center justify-between gap-3 mb-4"
                          >
                            <span>Delete this campaign? This cannot be undone.</span>
                            <div className="flex items-center gap-2">
                              <button type="button" onClick={(e) => { e.stopPropagation(); setPendingDeleteCampaignId(null); }} className="px-3 py-1.5 rounded border border-amber-300 bg-white hover:bg-amber-100">Cancel</button>
                              <button type="button" onClick={(e) => { e.stopPropagation(); confirmDeleteCampaign(e); }} disabled={isDeletingCampaign} className="px-3 py-1.5 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed">{(isDeletingCampaign ? 'Deleting…' : 'Delete')}</button>
                            </div>
                          </div>
                        )}
                        <div className="grid grid-cols-1 gap-4 mb-4">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                            <span className="text-sm text-gray-600">Start Date:</span>
                            <span className="text-sm font-medium">{campaign.start_date ? new Date(campaign.start_date).toLocaleDateString() : 'Not set'}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                            <span className="text-sm text-gray-600">End Date:</span>
                            <span className="text-sm font-medium">{campaign.end_date ? new Date(campaign.end_date).toLocaleDateString() : 'Not set'}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                            <span className="text-sm text-gray-600">Stage:</span>
                            <span className="text-sm font-medium">{getStageLabel(campaign.current_stage || campaign.status, campaign.duration_weeks)}</span>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-1.5 mb-4">
                          <a
                            href={`/campaign-details/${campaign.id}${selectedCompanyId ? `?companyId=${encodeURIComponent(selectedCompanyId)}` : ''}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs px-2 py-1 rounded bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200"
                          >
                            Week plan
                          </a>
                        {(stageAvailability[campaign.id]?.stages && Object.values(stageAvailability[campaign.id].stages).some(Boolean)) && (
                            <>
                            {stageAvailability[campaign.id].stages.twelveWeekPlan && (
                              <a
                                href={buildPlanningWorkspaceUrl(campaign.id)}
                                onClick={(e) => e.stopPropagation()}
                                className="text-xs px-2 py-1 rounded bg-indigo-100 text-indigo-700 hover:bg-indigo-200"
                              >
                                {campaign.duration_weeks ? `${campaign.duration_weeks} Week` : 'Blueprint'}
                              </a>
                            )}
                            {stageAvailability[campaign.id].stages.twelveWeekPlan && !stageAvailability[campaign.id].stages.detailedWeekPlans && (
                              <button
                                onClick={(e) => handleExpandToWeekPlans(campaign.id, e)}
                                disabled={expandingCampaignId === campaign.id}
                                className="text-xs px-2 py-1 rounded bg-purple-100 text-purple-700 hover:bg-purple-200 disabled:opacity-50"
                              >
                                {expandingCampaignId === campaign.id ? 'Expanding…' : 'Expand to Week Plans'}
                              </button>
                            )}
                            {(stageAvailability[campaign.id].stages.detailedWeekPlans || stageAvailability[campaign.id].stages.dailyPlans) && (
                              <a
                                href={buildPlanningWorkspaceUrl(campaign.id)}
                                onClick={(e) => e.stopPropagation()}
                                className="text-xs px-2 py-1 rounded bg-purple-100 text-purple-700 hover:bg-purple-200"
                              >
                                Weekly & Daily
                              </a>
                            )}
                            {stageAvailability[campaign.id].stages.aiEnrichedWeeks && (
                              <span className="text-xs px-2 py-1 rounded bg-violet-100 text-violet-700">AI Enriched</span>
                            )}
                            {stageAvailability[campaign.id].stages.schedule && (
                              <a
                                href={`/campaign-details/${campaign.id}${selectedCompanyId ? `?companyId=${encodeURIComponent(selectedCompanyId)}` : ''}`}
                                onClick={(e) => e.stopPropagation()}
                                className="text-xs px-2 py-1 rounded bg-green-100 text-green-700 hover:bg-green-200"
                              >
                                Scheduled
                              </a>
                            )}
                            </>
                        )}
                        </div>
                        
                        <div className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-600">Progress</span>
                          </div>
                          <CampaignProgress campaignId={campaign.id} companyId={selectedCompanyId} />
                        </div>
                      </div>
                    ))}
                  </div>
                  )}
                </div>
              )}
            </div>
          </div>
  );
}
