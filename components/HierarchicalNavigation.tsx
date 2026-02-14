import React, { useState, useEffect } from 'react';
import { 
  Calendar, 
  ArrowRight, 
  Plus, 
  Edit3, 
  CheckCircle, 
  Clock,
  Users,
  TrendingUp,
  Eye,
  RefreshCw,
  Sparkles,
  Target
} from 'lucide-react';

interface TwelveWeekOverviewProps {
  campaignId: string;
  onWeekSelect: (weekNumber: number) => void;
}

interface WeekDetailViewProps {
  campaignId: string;
  weekNumber: number;
  onDaySelect: (day: string) => void;
  onBack: () => void;
}

interface DayDetailViewProps {
  campaignId: string;
  weekNumber: number;
  day: string;
  onBack: () => void;
}

export function TwelveWeekOverview({ campaignId, onWeekSelect }: TwelveWeekOverviewProps) {
  const [weeks, setWeeks] = useState<any[]>([]);
  const [overview, setOverview] = useState<{ totalWeeks?: number; plans?: any[] } | null>(null);
  const [campaignSummary, setCampaignSummary] = useState<any>(null);
  const [performanceData, setPerformanceData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasPlan, setHasPlan] = useState(false);
  const [showCreatePlan, setShowCreatePlan] = useState(false);
  const [showPlanList, setShowPlanList] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<any>(null);
  const [allPlans, setAllPlans] = useState<any[]>([]);

  useEffect(() => {
    loadCampaignData();
  }, [campaignId]);

  const loadCampaignData = async () => {
    try {
      // Load all campaign plans for this campaign
      const plansResponse = await fetch(`/api/campaigns/12week-plans?campaignId=${campaignId}`);
      if (plansResponse.ok) {
        const plansData = await plansResponse.json();
        setAllPlans(plansData.plans || []);
      }

      // Load weeks data and overview (includes totalWeeks from blueprint)
      const weeksResponse = await fetch(`/api/campaigns/hierarchical-navigation?action=get-overview&campaignId=${campaignId}`);
      if (weeksResponse.ok) {
        const weeksData = await weeksResponse.json();
        const ov = weeksData.overview || {};
        setOverview(ov);
        setWeeks(ov.plans || weeksData.weeks || []);
      }

      // Load campaign summary
      const summaryResponse = await fetch(`/api/campaigns/campaign-summary?campaignId=${campaignId}`);
      if (summaryResponse.ok) {
        const summaryData = await summaryResponse.json();
        setCampaignSummary(summaryData);
      }

      // Load performance data
      const performanceResponse = await fetch(`/api/campaigns/performance-data?campaignId=${campaignId}`);
      if (performanceResponse.ok) {
        const performanceData = await performanceResponse.json();
        setPerformanceData(performanceData);
      }

    } catch (error) {
      console.error('Error loading campaign data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Check if campaign has a plan after data is loaded
  useEffect(() => {
    setHasPlan(allPlans.length > 0);
  }, [allPlans]);

  const getWeekStatus = (week: any) => {
    if (week.contentCount === 0) return 'draft';
    if (week.contentCount < 5) return 'partial';
    return 'complete';
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'complete': return 'bg-green-500';
      case 'partial': return 'bg-yellow-500';
      default: return 'bg-gray-400';
    }
  };

  const getWeekStartDate = (weekNumber: number) => {
    // Calculate start date based on campaign start date
    const campaignStartDate = campaignSummary?.startDate ? new Date(campaignSummary.startDate) : new Date();
    const weekStartDate = new Date(campaignStartDate);
    weekStartDate.setDate(campaignStartDate.getDate() + (weekNumber - 1) * 7);
    
    return weekStartDate.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric' 
    });
  };

  const selectPlan = (plan: any) => {
    setSelectedPlan(plan);
    setShowPlanList(false);
    // Load specific plan data
    loadPlanData(plan.id);
  };

  const loadPlanData = async (planId: string) => {
    try {
      const response = await fetch(`/api/campaigns/12week-plans/${planId}?campaignId=${campaignId}`);
      if (response.ok) {
        const planData = await response.json();
        setWeeks(planData.weeks || []);
        setCampaignSummary(planData.summary || null);
        setPerformanceData(planData.performance || null);
      }
    } catch (error) {
      console.error('Error loading plan data:', error);
    }
  };

  const backToPlanList = () => {
    setShowPlanList(true);
    setSelectedPlan(null);
  };

  if (isLoading) {
    return (
      <div className="p-8 text-center">
        <RefreshCw className="w-8 h-8 animate-spin text-orange-500 mx-auto mb-4" />
        <p className="text-gray-600">Loading 12-week overview...</p>
      </div>
    );
  }

  // Show plan list if no plan is selected
  if (showPlanList) {
    return (
      <div className="p-6">
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">12-Week Plans</h2>
              <p className="text-gray-600">Select a plan to view or create a new one</p>
            </div>
            
            <button
              onClick={() => setShowCreatePlan(true)}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-lg hover:from-blue-600 hover:to-indigo-700 transition-all duration-200 font-medium shadow-md hover:shadow-lg transform hover:scale-105"
            >
              <Plus className="w-4 h-4" />
              Create New Plan
            </button>
          </div>
        </div>

        {/* Plans List */}
        {allPlans.length > 0 ? (
          <div className="space-y-4">
            {allPlans.map((plan, index) => (
              <div key={plan.id} className="bg-white border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center text-white font-bold">
                        {index + 1}
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900">{plan.name || `12-Week Plan ${index + 1}`}</h3>
                        <p className="text-sm text-gray-600">
                          Created: {new Date(plan.created_at).toLocaleDateString()} • 
                          Start Date: {plan.start_date ? new Date(plan.start_date).toLocaleDateString() : 'Not set'}
                        </p>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                      <div className="text-center">
                        <div className="text-2xl font-bold text-blue-600">{plan.weeks_count || 12}</div>
                        <div className="text-sm text-gray-600">Weeks</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-green-600">{plan.content_count || 0}</div>
                        <div className="text-sm text-gray-600">Content Items</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-purple-600">{plan.platforms_count || 0}</div>
                        <div className="text-sm text-gray-600">Platforms</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-orange-600">{plan.status || 'Draft'}</div>
                        <div className="text-sm text-gray-600">Status</div>
                      </div>
                    </div>
                    
                    {plan.description && (
                      <p className="text-sm text-gray-700 mb-4">{plan.description}</p>
                    )}
                  </div>
                  
                  <div className="ml-6">
                    <button
                      onClick={() => selectPlan(plan)}
                      className="px-6 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors font-medium shadow-md hover:shadow-lg transform hover:scale-105"
                    >
                      View Plan
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <Calendar className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-gray-900 mb-2">No 12-Week Plans Yet</h3>
            <p className="text-gray-600 mb-6">
              Create your first 12-week campaign plan to get started with content planning and tracking.
            </p>
            
            <button
              onClick={() => setShowCreatePlan(true)}
              className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-lg hover:from-blue-600 hover:to-indigo-700 transition-all duration-200 font-medium shadow-md hover:shadow-lg transform hover:scale-105 mx-auto"
            >
              <Sparkles className="w-5 h-5" />
              Create Plan with AI
            </button>
          </div>
        )}

        {/* Create Plan Modal */}
        {showCreatePlan && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-lg mx-4">
              <div className="text-center mb-6">
                <h3 className="text-xl font-bold text-gray-900 mb-2">Create 12-Week Plan</h3>
                <p className="text-gray-600">Work with AI to create your campaign plan</p>
              </div>
              
              <div className="space-y-4">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h4 className="font-semibold text-blue-900 mb-2">How it works:</h4>
                  <ol className="text-sm text-blue-800 space-y-1">
                    <li>1. Chat with AI about your campaign goals</li>
                    <li>2. AI will suggest a 12-week content plan</li>
                    <li>3. Review and commit to the plan</li>
                    <li>4. Select your campaign start date</li>
                    <li>5. Plan is created and ready to use</li>
                  </ol>
                </div>
                
                <div className="flex space-x-3">
                  <button
                    onClick={() => setShowCreatePlan(false)}
                    className="flex-1 px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      setShowCreatePlan(false);
                      window.location.href = `/campaign-planning?campaignId=${campaignId}&openAI=true`;
                    }}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Start with AI
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  const durationWeeks = weeks.length > 0 ? weeks.length : (overview?.totalWeeks ?? 12);
  const displayWeeks = hasPlan ? weeks : Array.from({ length: durationWeeks }, (_, i) => ({
    weekNumber: i + 1,
    theme: `Week ${i + 1} - Planning`,
    contentCount: 0,
    platforms: [],
    status: 'draft'
  }));

  return (
    <div className="p-6">
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <button
              onClick={backToPlanList}
              className="flex items-center text-gray-600 hover:text-gray-800 transition-colors mb-2"
            >
              <ArrowRight className="w-4 h-4 mr-2 rotate-180" />
              Back to Plans
            </button>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              {selectedPlan?.name || 'Campaign Overview'}
            </h2>
            <p className="text-gray-600">
              {hasPlan ? 'Click on any week to view detailed content planning' : 'Create your campaign plan to get started'}
            </p>
          </div>
          
          {!hasPlan && (
            <button
              onClick={() => setShowCreatePlan(true)}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-lg hover:from-blue-600 hover:to-indigo-700 transition-all duration-200 font-medium shadow-md hover:shadow-lg transform hover:scale-105"
            >
              <Sparkles className="w-4 h-4" />
              Create Plan with AI
            </button>
          )}
        </div>
      </div>

      {/* Campaign Summary */}
      {campaignSummary && (
        <div className="mb-8 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-blue-900 mb-4 flex items-center">
            <Target className="w-5 h-5 mr-2" />
            Campaign Summary
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-lg p-4 shadow-sm">
              <h4 className="font-semibold text-gray-900 mb-2">Objective</h4>
              <p className="text-sm text-gray-600">{campaignSummary.objective || 'Build brand awareness and drive user acquisition'}</p>
            </div>
            <div className="bg-white rounded-lg p-4 shadow-sm">
              <h4 className="font-semibold text-gray-900 mb-2">Target Audience</h4>
              <p className="text-sm text-gray-600">{campaignSummary.audience || 'Professionals and businesses in target industry'}</p>
            </div>
            <div className="bg-white rounded-lg p-4 shadow-sm">
              <h4 className="font-semibold text-gray-900 mb-2">Content Focus</h4>
              <p className="text-sm text-gray-600">{campaignSummary.contentFocus || 'Educational content and thought leadership'}</p>
            </div>
            <div className="bg-white rounded-lg p-4 shadow-sm">
              <h4 className="font-semibold text-gray-900 mb-2">Target Metrics</h4>
              <p className="text-sm text-gray-600">{campaignSummary.targetMetrics || 'Engagement, reach, and conversions'}</p>
            </div>
          </div>
        </div>
      )}

      {/* Performance Overview */}
      {performanceData && (
        <div className="mb-8 bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-green-900 mb-4 flex items-center">
            <TrendingUp className="w-5 h-5 mr-2" />
            Performance Overview
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-lg p-4 shadow-sm text-center">
              <div className="text-2xl font-bold text-green-600">{performanceData.totalReach || '0'}</div>
              <div className="text-sm text-gray-600">Total Reach</div>
            </div>
            <div className="bg-white rounded-lg p-4 shadow-sm text-center">
              <div className="text-2xl font-bold text-blue-600">{performanceData.totalEngagement || '0'}</div>
              <div className="text-sm text-gray-600">Total Engagement</div>
            </div>
            <div className="bg-white rounded-lg p-4 shadow-sm text-center">
              <div className="text-2xl font-bold text-purple-600">{performanceData.totalConversions || '0'}</div>
              <div className="text-sm text-gray-600">Total Conversions</div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {displayWeeks.map((week, index) => {
          const status = getWeekStatus(week);
          const startDate = getWeekStartDate(week.weekNumber);
          
          return (
            <div
              key={week.weekNumber}
              onClick={() => hasPlan ? onWeekSelect(week.weekNumber) : setShowCreatePlan(true)}
              className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer group"
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900">Week {week.weekNumber}</h3>
                <div className={`w-3 h-3 rounded-full ${getStatusColor(status)}`}></div>
              </div>
              
              <div className="space-y-2">
                <div className="text-sm text-gray-600">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    <span>{startDate}</span>
                  </div>
                </div>
                
                <div className="text-sm text-gray-600">
                  <div className="flex items-center gap-2">
                    <Target className="w-4 h-4" />
                    <span>{week?.theme || `Week ${week.weekNumber} Theme`}</span>
                  </div>
                </div>
                
                <div className="text-sm text-gray-500">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4" />
                    <span>{week?.contentCount || 0} content items</span>
                  </div>
                </div>
                
                <div className="text-sm text-gray-500">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    <span>{week?.platforms?.length || 0} platforms</span>
                  </div>
                </div>

                {/* Performance indicators */}
                {week?.performance && (
                  <div className="text-xs text-gray-500 bg-gray-50 px-2 py-1 rounded">
                    <div className="flex justify-between">
                      <span>Reach: {week.performance.reach || '0'}</span>
                      <span>Engagement: {week.performance.engagement || '0'}</span>
                    </div>
                  </div>
                )}
              </div>
              
              <div className="mt-4 flex items-center text-orange-600 text-sm font-medium group-hover:text-orange-700">
                <span>View Details</span>
                <ArrowRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-8 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <h4 className="font-semibold text-blue-900 mb-2">Legend</h4>
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-green-500"></div>
            <span className="text-blue-800">Complete</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
            <span className="text-blue-800">Partial</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-gray-400"></div>
            <span className="text-blue-800">Draft</span>
          </div>
        </div>
      </div>

      {/* Create Plan Modal */}
      {showCreatePlan && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-lg mx-4">
            <div className="text-center mb-6">
              <h3 className="text-xl font-bold text-gray-900 mb-2">Create 12-Week Plan</h3>
              <p className="text-gray-600">Work with AI to create your campaign plan</p>
            </div>
            
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="font-semibold text-blue-900 mb-2">How it works:</h4>
                <ol className="text-sm text-blue-800 space-y-1">
                  <li>1. Chat with AI about your campaign goals</li>
                  <li>2. AI will suggest a 12-week content plan</li>
                  <li>3. Review and commit to the plan</li>
                  <li>4. Select your campaign start date</li>
                  <li>5. Plan is created and ready to use</li>
                </ol>
              </div>
              
              <div className="flex space-x-3">
                <button
                  onClick={() => setShowCreatePlan(false)}
                  className="flex-1 px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setShowCreatePlan(false);
                    window.location.href = `/campaign-planning?campaignId=${campaignId}&openAI=true`;
                  }}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Start with AI
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function WeekDetailView({ campaignId, weekNumber, onDaySelect, onBack }: WeekDetailViewProps) {
  const [weekData, setWeekData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadWeekData();
  }, [campaignId, weekNumber]);

  const loadWeekData = async () => {
    try {
      const response = await fetch(`/api/campaigns/hierarchical-navigation?action=get-week&campaignId=${campaignId}&weekNumber=${weekNumber}`);
      if (response.ok) {
        const data = await response.json();
        setWeekData(data);
      }
    } catch (error) {
      console.error('Error loading week data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  if (isLoading) {
    return (
      <div className="p-8 text-center">
        <RefreshCw className="w-8 h-8 animate-spin text-orange-500 mx-auto mb-4" />
        <p className="text-gray-600">Loading week {weekNumber} details...</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <button
            onClick={onBack}
            className="flex items-center text-gray-600 hover:text-gray-800 transition-colors mb-2"
          >
            <ArrowRight className="w-4 h-4 mr-2 rotate-180" />
            Back to Overview
          </button>
          <h2 className="text-2xl font-bold text-gray-900">Week {weekNumber}</h2>
          <p className="text-gray-600">{weekData?.theme || `Week ${weekNumber} Theme`}</p>
        </div>
        
        <div className="text-right">
          <div className="text-sm text-gray-500">Content Items</div>
          <div className="text-2xl font-bold text-orange-600">{weekData?.contentCount || 0}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {days.map(day => {
          const dayContent = weekData?.dailyContent?.[day] || [];
          
          return (
            <div
              key={day}
              onClick={() => onDaySelect(day)}
              className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer group"
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900">{day}</h3>
                <div className="text-sm text-gray-500">{dayContent.length} items</div>
              </div>
              
              <div className="space-y-2">
                {dayContent.slice(0, 3).map((content: any, index: number) => (
                  <div key={index} className="text-sm text-gray-600 bg-gray-50 px-2 py-1 rounded">
                    {content.platform}: {content.type}
                  </div>
                ))}
                {dayContent.length > 3 && (
                  <div className="text-xs text-gray-500">+{dayContent.length - 3} more...</div>
                )}
              </div>
              
              <div className="mt-4 flex items-center text-orange-600 text-sm font-medium group-hover:text-orange-700">
                <span>View Day</span>
                <ArrowRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
        <h4 className="font-semibold text-orange-900 mb-2">Week Focus</h4>
        <p className="text-orange-800">{weekData?.focusArea || `Focus area for week ${weekNumber}`}</p>
      </div>
    </div>
  );
}

export function DayDetailView({ campaignId, weekNumber, day, onBack }: DayDetailViewProps) {
  const [dayData, setDayData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadDayData();
  }, [campaignId, weekNumber, day]);

  const loadDayData = async () => {
    try {
      const response = await fetch(`/api/campaigns/hierarchical-navigation?action=get-day&campaignId=${campaignId}&weekNumber=${weekNumber}&day=${day}`);
      if (response.ok) {
        const data = await response.json();
        setDayData(data);
      }
    } catch (error) {
      console.error('Error loading day data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-8 text-center">
        <RefreshCw className="w-8 h-8 animate-spin text-orange-500 mx-auto mb-4" />
        <p className="text-gray-600">Loading {day} content...</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <button
            onClick={onBack}
            className="flex items-center text-gray-600 hover:text-gray-800 transition-colors mb-2"
          >
            <ArrowRight className="w-4 h-4 mr-2 rotate-180" />
            Back to Week {weekNumber}
          </button>
          <h2 className="text-2xl font-bold text-gray-900">{day}</h2>
          <p className="text-gray-600">Week {weekNumber} • {dayData?.contentCount || 0} content items</p>
        </div>
        
        <button className="flex items-center px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors">
          <Plus className="w-4 h-4 mr-2" />
          Add Content
        </button>
      </div>

      <div className="space-y-4">
        {dayData?.contentItems?.map((content: any, index: number) => (
          <div key={index} className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-orange-100 rounded-lg flex items-center justify-center">
                  <span className="text-orange-600 font-semibold text-sm">
                    {content.platform?.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">{content.title || `${content.platform} Content`}</h3>
                  <p className="text-sm text-gray-600">{content.type}</p>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                  content.status === 'published' ? 'bg-green-100 text-green-800' :
                  content.status === 'scheduled' ? 'bg-blue-100 text-blue-800' :
                  'bg-gray-100 text-gray-800'
                }`}>
                  {content.status || 'draft'}
                </span>
                <button className="p-1 hover:bg-gray-100 rounded">
                  <Edit3 className="w-4 h-4 text-gray-600" />
                </button>
              </div>
            </div>
            
            <p className="text-gray-700 mb-3">{content.description || 'No description available'}</p>
            
            <div className="flex items-center gap-4 text-sm text-gray-500">
              <div className="flex items-center gap-1">
                <Clock className="w-4 h-4" />
                <span>{content.scheduledTime || 'Not scheduled'}</span>
              </div>
              <div className="flex items-center gap-1">
                <Users className="w-4 h-4" />
                <span>{content.platform}</span>
              </div>
            </div>
          </div>
        )) || (
          <div className="text-center py-8">
            <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No Content Yet</h3>
            <p className="text-gray-600 mb-4">This day doesn't have any content planned yet.</p>
            <button className="flex items-center px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors mx-auto">
              <Plus className="w-4 h-4 mr-2" />
              Add Content
            </button>
          </div>
        )}
      </div>
    </div>
  );
}