import React from 'react';
import { Plus, Target, Play, Edit3, CheckCircle, MoreHorizontal, Loader2, Trash2, Link2, FileText, ChevronRight, Brain, Eye, Calendar, Users, Settings } from 'lucide-react';
import PlatformIcon from '../ui/PlatformIcon';
import { getPlatformLabel } from '../../utils/platformIcons';
import CampaignProgress from './CampaignProgress';
import type { useDashboardState } from '../hooks/useDashboardState';
import EmptyState from '../shared/EmptyState';
import ExamplePreview from '../shared/ExamplePreview';
import { trackActivationEvent } from '../../lib/analytics/activationEvents';

type DashboardState = ReturnType<typeof useDashboardState>;

export default function DashboardOverviewSection({ d }: { d: DashboardState }) {
  const {
    router, campaigns, filteredCampaigns, stageFilter, setStageFilter,
    CAMPAIGN_STAGES, campaignProgress, stageAvailability,
    canCreateCampaign, canScheduleContent, handleViewCampaign, handleExpandToWeekPlans,
    expandingCampaignId, handleDeleteCampaign, pendingDeleteCampaignId,
    setPendingDeleteCampaignId, isDeletingCampaign, confirmDeleteCampaign,
    getStageLabel, buildPlanningWorkspaceUrl, selectedCompanyId,
    isLoadingData, openIntelligenceTab, setActiveTab,
  } = d;

  return (
    <>
            {/* Campaigns List Section */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="p-5 border-b border-gray-100">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-gray-900">Recent Campaigns</h2>
                  <button 
                    onClick={() => setActiveTab('campaigns')}
                    className="text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-2"
                  >
                    View All
                    <Eye className="h-4 w-4" />
                  </button>
                </div>
              </div>
              
              <div className="overflow-x-auto">
                {isLoadingData ? (
                  <div className="flex justify-center items-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                    <span className="ml-2 text-gray-600">Loading campaigns...</span>
                  </div>
                ) : campaigns.length === 0 ? (
                  <div className="p-6">
                    <EmptyState
                      tone="first-time"
                      illustration={<Target className="h-6 w-6" />}
                      title="Generate your first insight"
                      description="Start with one guided insight so you can immediately see where the clearest growth opportunity is."
                      primaryAction={{
                        label: 'Generate your first insight',
                        onClick: () => {
                          trackActivationEvent('empty_state_primary_clicked', {
                            accountId: selectedCompanyId,
                            context: 'dashboard_insight',
                          });
                          setActiveTab('intelligence');
                          openIntelligenceTab?.('market-pulse');
                        },
                      }}
                      secondaryAction={{
                        label: 'Try with sample data',
                        onClick: () => {
                          trackActivationEvent('sample_used', {
                            accountId: selectedCompanyId,
                            context: 'dashboard_insight',
                          });
                          window.location.href = '/campaigns?sample=1';
                        },
                      }}
                      examplePreview={<ExamplePreview variant="insight" />}
                    />
                  </div>
                ) : (
                  <div className="space-y-4">
                    {campaigns.slice(0, 3).map((campaign) => (
                      <div
                        key={campaign.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => handleViewCampaign(campaign.id)}
                        onKeyDown={(e) => e.key === 'Enter' && handleViewCampaign(campaign.id)}
                        className="bg-white rounded-xl p-5 border border-gray-200 hover:border-indigo-200 hover:shadow-sm transition-all duration-150 cursor-pointer"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2 mb-4">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="p-2 rounded-lg bg-indigo-50 shrink-0">
                              <Play className="h-4 w-4 text-indigo-600" />
                            </div>
                            <div className="min-w-0">
                              <h3 className="font-semibold text-gray-900 truncate">{campaign.name}</h3>
                              <p className="text-xs text-gray-500 font-mono">ID: {campaign.id}</p>
                              <p className="text-sm text-gray-600">
                                {campaign.start_date ? new Date(campaign.start_date).toLocaleDateString() : 'Not scheduled'} - {campaign.end_date ? new Date(campaign.end_date).toLocaleDateString() : 'Not scheduled'}
                              </p>
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleViewCampaign(campaign.id);
                              }}
                              className="px-3 py-1 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 transition-colors"
                            >
                              {getStageLabel(campaign.current_stage || campaign.status, campaign.duration_weeks)}
                            </button>
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
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                            <span className="text-sm text-gray-600">Platforms:</span>
                            <span className="text-sm font-medium">Multiple</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                            <span className="text-sm text-gray-600">Stage:</span>
                            <span className="text-sm font-medium">{getStageLabel(campaign.current_stage || campaign.status, campaign.duration_weeks)}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                            <span className="text-sm text-gray-600">Created:</span>
                            <span className="text-sm font-medium">{campaign.created_at ? new Date(campaign.created_at).toLocaleDateString() : 'Recently'}</span>
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
                            <CampaignProgress campaignId={campaign.id} companyId={selectedCompanyId} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
                
            {/* Quick Actions */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-stretch">
              <div data-tour-id="company-profile-card" className="bg-white border border-gray-200 border-l-4 border-l-indigo-500 rounded-xl p-5 flex flex-col h-full min-h-[180px] shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 bg-indigo-50 rounded-lg">
                    <Users className="h-5 w-5 text-indigo-600" />
                  </div>
                  <h3 className="text-base font-semibold text-gray-900 leading-snug">Company Profile</h3>
                </div>
                <p className="text-sm text-gray-500 mb-4 flex-1">
                  Start here to define your company intelligence profile
                </p>
                <button
                  onClick={() => window.location.href = '/company-profile'}
                  className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                >
                  Open Profile
                </button>
              </div>
              <div data-tour-id="api-connections-card" className="bg-white border border-gray-200 border-l-4 border-l-slate-500 rounded-xl p-5 flex flex-col h-full min-h-[180px] shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 bg-slate-50 rounded-lg">
                    <Settings className="h-5 w-5 text-slate-600" />
                  </div>
                  <h3 className="text-base font-semibold text-gray-900 leading-snug">API Connections</h3>
                </div>
                <p className="text-sm text-gray-500 mb-4 flex-1">
                  Connect social platforms and configure trend, community &amp; image APIs
                </p>
                <button
                  onClick={() => window.location.href = '/social-platforms'}
                  className="bg-slate-50 hover:bg-slate-100 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                >
                  Manage Connections
                </button>
              </div>
              <div data-tour-id="recommendations-card" className="bg-white border border-gray-200 border-l-4 border-l-emerald-500 rounded-xl p-5 flex flex-col h-full min-h-[180px] shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 bg-emerald-50 rounded-lg">
                    <Brain className="h-5 w-5 text-emerald-600" />
                  </div>
                  <h3 className="text-base font-semibold text-gray-900 leading-snug">Intelligence Hub</h3>
                </div>
                <p className="text-sm text-gray-500 mb-4 flex-1 leading-relaxed">
                  Bring together strategic intelligence, market pulse, and active leads in one place
                </p>
                <button
                  onClick={() => openIntelligenceTab('market-pulse')}
                  className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                >
                  Open Intelligence
                </button>
              </div>
              <div className="bg-white border border-gray-200 border-l-4 border-l-green-500 rounded-xl p-5 flex flex-col h-full min-h-[180px] shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 bg-green-50 rounded-lg">
                    <Calendar className="h-5 w-5 text-green-600" />
                  </div>
                  <h3 className="text-base font-semibold text-gray-900 leading-snug">Schedule Content</h3>
                </div>
                <p className="text-sm text-gray-500 mb-4 flex-1">Plan and schedule your content calendar</p>
                <button
                  onClick={() => setActiveTab('calendar')}
                  disabled={!canScheduleContent}
                  title={
                    canScheduleContent ? '' : 'You do not have permission to schedule content.'
                  }
                  className="bg-green-50 hover:bg-green-100 text-green-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                >
                  Schedule Now
                </button>
              </div>
            </div>
    </>
  );
}
