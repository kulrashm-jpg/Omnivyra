import React, { useState, useEffect } from 'react';
import { 
  ArrowLeft, 
  Calendar, 
  Target, 
  BarChart3, 
  Plus,
  CheckCircle,
  Clock,
  TrendingUp,
  FileText,
  Video,
  Image,
  Mic,
  Users,
  Share2,
  Eye,
  Heart,
  MessageCircle,
  Download,
  Filter,
  Search,
  MoreVertical,
  ChevronRight,
  Sparkles,
  X,
  Edit,
  Trash2,
  MoreHorizontal
} from 'lucide-react';

interface Campaign {
  id: string;
  name: string;
  status: string;
  userId: string;
  createdAt: string;
  progress: number;
}

interface WeekPlan {
  id: string;
  week: number;
  status: string;
  theme: string;
  contentFocus: string;
  targetAudience: string;
  keyMessaging: string;
  contentTypes: string[];
  platformStrategy: string;
  callToAction: string;
  successMetrics: any;
  createdAt: string;
  aiContent?: any;
  dailyContent?: any;
  platforms?: string[];
  aiSuggestions?: string[];
}

interface CampaignOverview {
  totalWeeks: number;
  completedWeeks: number;
  campaigns: Campaign[];
  plans: WeekPlan[];
}

export default function CampaignPlanningHierarchical() {
  const [overview, setOverview] = useState<CampaignOverview | null>(null);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedWeek, setSelectedWeek] = useState<WeekPlan | null>(null);
  const [selectedDay, setSelectedDay] = useState<any>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [showWeekDetail, setShowWeekDetail] = useState(false);
  const [showDayDetail, setShowDayDetail] = useState(false);
  const [weeklyPlans, setWeeklyPlans] = useState<any[]>([]);
  const [showAIEnhancement, setShowAIEnhancement] = useState(false);
  const [selectedWeekForAI, setSelectedWeekForAI] = useState<number | null>(null);
  const [showDailyPlanCreation, setShowDailyPlanCreation] = useState(false);
  const [selectedWeekForDaily, setSelectedWeekForDaily] = useState<number | null>(null);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const id = urlParams.get('campaignId');
    setCampaignId(id);
    
    if (id) {
      fetchCampaignOverview(id);
      fetchWeeklyPlans(id);
    }
  }, []);

  const fetchCampaignOverview = async (id: string) => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/campaigns/hierarchical-navigation?campaignId=${id}&action=get-overview`);
      if (response.ok) {
        const data = await response.json();

        setOverview(data.overview);
      } else {
        console.error('Failed to fetch campaign overview');
      }
    } catch (error) {
      console.error('Error fetching campaign overview:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchWeeklyPlans = async (campaignId: string) => {
    try {
      const response = await fetch(`/api/campaigns/get-weekly-plans?campaignId=${campaignId}`);
      if (response.ok) {
        const data = await response.json();
        console.log('Weekly plans loaded:', data);
        setWeeklyPlans(data);
      } else {
        console.error('Failed to fetch weekly plans');
      }
    } catch (error) {
      console.error('Error fetching weekly plans:', error);
    }
  };

  const handleAIEnhancement = (weekNumber: number) => {
    setSelectedWeekForAI(weekNumber);
    setShowAIEnhancement(true);
  };

  const handleDailyPlanCreation = (weekNumber: number) => {
    setSelectedWeekForDaily(weekNumber);
    setShowDailyPlanCreation(true);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-100 text-green-800 border-green-200';
      case 'pending': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'in-progress': return 'bg-blue-100 text-blue-800 border-blue-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getWeekIcon = (week: number) => {
    const icons = [
      Plus, Target, Users, TrendingUp, Share2, Eye, Heart, MessageCircle,
      Download, Filter, Search, MoreVertical
    ];
    const Icon = icons[(week - 1) % icons.length];
    return <Icon className="w-4 h-4" />;
  };

  const handleWeekClick = (plan: WeekPlan) => {
    setSelectedWeek(plan);
  };

  const handleCreateNewPlan = () => {
    if (campaignId) {
      window.location.href = `/campaign-planning?campaignId=${campaignId}&openAI=true`;
    }
  };

  const handleAIEnhanceWeek = async (weekPlan: WeekPlan) => {
    try {
      // Generate detailed daily structure for this week
      const requestBody = {
        week: weekPlan.week,
        theme: weekPlan.theme,
        contentFocus: weekPlan.contentFocus,
        targetAudience: weekPlan.targetAudience,
        campaignId: campaignId
      };

      const response = await fetch('/api/campaigns/generate-weekly-structure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (response.ok) {
        const result = await response.json();
        // Update the week with generated structure
        console.log('Generated weekly structure:', result);
        
        // Show success and refresh
        alert(`✅ Generated 7-day content structure for Week ${weekPlan.week}!`);
        fetchCampaignOverview(campaignId!);
        setShowWeekDetail(false);
      } else {
        throw new Error('Failed to generate structures');
      }
    } catch (error) {
      console.error('Error generating weekly structure:', error);
      alert('❌ Failed to generate daily content structure. Please try again.');
    }
  };

  const handleDailyPlanning = (weekPlan: WeekPlan) => {
    // Open daily planning interface for this specific week
    const dailyPlanningUrl = `/daily-planning?campaignId=${campaignId}&week=${weekPlan.week}`;
    
    // Check if daily planning page exists, if not navigate to campaign planning with parameters
    window.open(dailyPlanningUrl, '_blank') || (window.location.href = `/campaign-planning?campaignId=${campaignId}&week=${weekPlan.week}&tab=daily`);
    
    setShowWeekDetail(false);
  };

  const getAllPlatforms = () => {
    return ['LinkedIn', 'Facebook', 'Instagram', 'Twitter', 'YouTube', 'TikTok'];
  };

  const getRecommendedPlatforms = (contentType: string) => {
    const recommendations: { [key: string]: string[] } = {
      'Educational Content': ['LinkedIn', 'Facebook', 'YouTube'],
      'Visual Content': ['Instagram', 'Facebook', 'TikTok'],
      'Quick Tips': ['Twitter', 'LinkedIn'],
      'Long-form': ['LinkedIn', 'YouTube', 'Facebook'],
      'Behind-the-scenes': ['Instagram', 'TikTok', 'Facebook']
    };
    return recommendations[contentType] || ['LinkedIn', 'Facebook'];
  };

  const addPlatform = (platform: string) => {
    // This would be implemented to add platform to selected day content
    console.log('Adding platform:', platform);
  };

  const removePlatform = (platform: string) => {
    // This would be implemented to remove platform from selected day content
    console.log('Removing platform:', platform);
  };


  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading 12-week campaign plan...</p>
        </div>
      </div>
    );
  }

  if (!overview || !campaignId) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Campaign Not Found</h1>
          <p className="text-gray-600 mb-6">The requested campaign could not be found.</p>
          <button 
            onClick={() => window.location.href = '/campaigns'}
            className="bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 text-white px-6 py-3 rounded-lg font-medium transition-all duration-200"
          >
            ← Back to Campaigns
          </button>
        </div>
      </div>
    );
  }

  const campaign = overview.campaigns[0];

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => window.location.href = '/campaigns'}
              className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
              Back to Campaigns
            </button>
            
            <div>
              <h1 className="text-2xl font-bold text-gray-900">12-Week Campaign Plan</h1>
              <p className="text-gray-600">Campaign: {campaign?.name}</p>
              <div className="flex items-center gap-4 mt-2">
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(campaign?.status || 'planning')}`}>
                  {campaign?.status || 'Planning'}
                </span>
                <span className="text-sm text-gray-500">
                  {overview.completedWeeks} of {overview.totalWeeks} weeks completed
                </span>
              </div>
            </div>
          </div>
          
          <div className="flex gap-4">
            <button 
              onClick={handleCreateNewPlan}
              className="bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 text-white px-4 py-2 rounded-lg font-medium transition-all duration-200 flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Add Week Plan
            </button>
            
            <button className="bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-lg font-medium transition-all duration-200 flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              AI Assistant
            </button>
          </div>
        </div>

        {/* Progress Overview */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-8">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Campaign Progress</h2>
            <div className="text-sm text-gray-600">
              {Math.round((overview.completedWeeks / overview.totalWeeks) * 100)}% Complete
            </div>
          </div>
          
          <div className="w-full bg-gray-200 rounded-full h-3 mb-4">
            <div 
              className="bg-gradient-to-r from-purple-500 to-violet-600 h-3 rounded-full transition-all duration-300"
              style={{ width: `${(overview.completedWeeks / overview.totalWeeks) * 100}%` }}
            />
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">{overview.totalWeeks}</div>
              <div className="text-sm text-gray-600">Total Weeks</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">{overview.completedWeeks}</div>
              <div className="text-sm text-gray-600">Completed</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-yellow-600">{overview.plans.length - overview.completedWeeks}</div>
              <div className="text-sm text-gray-600">Pending</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">{overview.plans.length}</div>
              <div className="text-sm text-gray-600">Plans Created</div>
            </div>
          </div>
        </div>

        {/* 12-Week Grid */}
        <div className="mb-8">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold text-gray-900">12-Week Content Plan</h2>
            
            <div className="flex gap-2">
              <select 
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
              >
                <option value="all">All Weeks</option>
                <option value="completed">Completed</option>
                <option value="pending">Pending</option>
                <option value="in-progress">In Progress</option>
              </select>
            </div>
          </div>

          {weeklyPlans.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
              <Calendar className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">No Weekly Plans Created</h3>
              <p className="text-gray-600 mb-6">Start building your campaign content strategy</p>
              <button 
                onClick={handleCreateNewPlan}
                className="bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 text-white px-6 py-3 rounded-lg font-medium transition-all duration-200 flex items-center gap-2 mx-auto"
              >
                <Plus className="w-5 h-5" />
                Create Week Plan
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {Array.from({ length: overview?.totalWeeks ?? weeklyPlans.length || 12 }, (_, index) => {
                const weekNumber = index + 1;
                const plan = weeklyPlans.find(p => p.weekNumber === weekNumber);
                const isSelected = selectedWeek?.week === weekNumber;
                
                return (
                  <div
                    key={weekNumber}
                    className={`bg-white rounded-lg shadow-sm border transition-all duration-200 ${
                      isSelected ? 'border-purple-300 shadow-md' : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    {/* Week Header */}
                    <div 
                      className="p-4 cursor-pointer"
                      onClick={() => {
                        if (plan) {
                          setSelectedWeek(plan);
                          setShowWeekDetail(true);
                        }
                      }}
                    >
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-3">
                          {getWeekIcon(weekNumber)}
                          <div>
                            <span className="font-semibold text-gray-900">Week {weekNumber}</span>
                            {plan ? (
                              <>
                                <div className="text-sm font-medium text-gray-700 mt-1">
                                  {plan.theme || `Week ${weekNumber} Theme`}
                                </div>
                                <div className="text-xs text-gray-500 mt-1">
                                  {plan.focusArea || plan.contentFocus || 'Setup weekly content focus...'}
                                </div>
                                {plan.aiContent && (Array.isArray(plan.aiContent) ? plan.aiContent.length > 0 : Object.keys(plan.aiContent).length > 0) && (
                                  <div className="text-xs text-blue-600 mt-1">
                                    ✓ AI Content Generated
                                  </div>
                                )}
                                {plan.aiSuggestions && plan.aiSuggestions.length > 0 && (
                                  <div className="text-xs text-purple-600 mt-1">
                                    ✓ {plan.aiSuggestions.length} AI Suggestions
                                  </div>
                                )}
                                {plan.dailyContent && Object.keys(plan.dailyContent).length > 0 && (
                                  <div className="text-xs text-green-600 mt-1">
                                    ✓ Daily Structure Ready
                                  </div>
                                )}
                              </>
                            ) : (
                              <>
                                <div className="text-sm font-medium text-gray-700 mt-1">
                                  Week {weekNumber} Theme
                                </div>
                                <div className="text-xs text-gray-500 mt-1">
                                  To be planned
                                </div>
                                <div className="text-xs text-orange-600 mt-1">
                                  Click "Plan Week" to get started
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          {plan ? (
                            <>
                              <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(plan.status)}`}>
                                {plan.status}
                              </span>
                              
                              {/* AI Enhancement Button */}
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAIEnhancement(weekNumber);
                                }}
                                className="flex items-center gap-1 px-2 py-1 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 transition-colors text-xs"
                                title="AI Enhance Week"
                              >
                                <Sparkles className="w-3 h-3" />
                                [+]
                              </button>
                              
                              {/* Daily Plan Creation Button */}
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDailyPlanCreation(weekNumber);
                                }}
                                className="flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors text-xs"
                                title="Create Daily Plan"
                              >
                                <Calendar className="w-3 h-3" />
                                Daily
                              </button>
                              
                              {/* View Days Button */}
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setShowWeekDetail(true);
                                  setSelectedWeek(plan);
                                }}
                                className="flex items-center gap-1 text-sm text-gray-600 hover:text-purple-700"
                              >
                                <ChevronRight className="w-3 h-3" />
                              </button>
                            </>
                          ) : (
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                if (campaignId) {
                                  window.location.href = `/campaign-planning?campaignId=${campaignId}&week=${weekNumber}&openAI=true`;
                                }
                              }}
                              className="flex items-center gap-1 text-sm text-gray-500 hover:text-purple-600"
                            >
                              <Plus className="w-4 h-4" />
                              Plan Week
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Week Days (shows when expanded) */}
                    {isSelected && selectedWeek && (
                      <div className="border-t border-gray-100">
                        <div className="p-4">
                          <h4 className="text-sm font-medium text-gray-700 mb-3">7-Day Content Plan</h4>
                          <div className="grid grid-cols-7 gap-2">
                            {Array.from({ length: 7 }, (_, dayIndex) => {
                              const dayNumber = dayIndex + 1;
                              const dayData = selectedWeek.contentTypes || [];
                              const hasContent = dayNumber <= dayData.length;
                              
                              return (
                                <button
                                  key={dayNumber}
                                  onClick={() => {
                                    setSelectedDay({
                                      week: weekNumber,
                                      day: dayNumber,
                                      content: dayData[dayIndex - 1] || null,
                                      theme: selectedWeek.theme
                                    });
                                    setShowDayDetail(true);
                                  }}
                                  className={`p-3 rounded-lg border text-center transition-all ${
                                    hasContent 
                                      ? 'bg-purple-50 border-purple-200 hover:bg-purple-100' 
                                      : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                                  }`}
                                >
                                  <div className="text-xs font-medium text-gray-600">Day {dayNumber}</div>
                                  <div className="text-xs mt-1 text-gray-500">
                                    {hasContent ? (
                                      <span className="text-purple-600">●</span>
                                    ) : (
                                      <span className="text-gray-400">○</span>
                                    )}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                          
                          <div className="flex justify-end mt-3">
                            <button className="text-sm text-purple-600 hover:text-purple-700 flex items-center gap-1">
                              <Sparkles className="w-3 h-3" />
                              AI Enhance Week
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <button 
              onClick={() => window.open(`/analytics?campaignId=${campaignId}`, '_blank')}
              className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <div className="p-2 bg-green-100 rounded-lg">
                <BarChart3 className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <div className="font-medium text-gray-900">View Analytics</div>
                <div className="text-sm text-gray-600">Performance metrics</div>
              </div>
            </button>
            
            <button 
              onClick={() => window.open(`/audience-insights?campaignId=${campaignId}`, '_blank')}
              className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <div className="p-2 bg-blue-100 rounded-lg">
                <Users className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <div className="font-medium text-gray-900">Target Audience</div>
                <div className="text-sm text-gray-600">Audience insights</div>
              </div>
            </button>
            
            <button 
              onClick={() => window.open(`/content-calendar?campaignId=${campaignId}`, '_blank')}
              className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <div className="p-2 bg-purple-100 rounded-lg">
                <FileText className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <div className="font-medium text-gray-900">Content Calendar</div>
                <div className="text-sm text-gray-600">Schedule content</div>
              </div>
            </button>
          </div>
        </div>

        {/* Week Detail Modal */}
        {showWeekDetail && selectedWeek && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-lg max-w-4xl w-full mx-4 max-h-[80vh] overflow-y-auto">
              <div className="p-6">
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <h2 className="text-xl font-semibold text-gray-900">Week {selectedWeek.week}</h2>
                    <p className="text-gray-600 mt-1">{selectedWeek.theme}</p>
                  </div>
                  <button 
                    onClick={() => setShowWeekDetail(false)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-6 h-6" />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <h3 className="text-lg font-medium text-gray-900 mb-3">Week Overview</h3>
                    <div className="space-y-3">
                      <div>
                        <label className="text-sm font-medium text-gray-700">Content Focus</label>
                        <p className="text-gray-600">{selectedWeek.contentFocus}</p>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-gray-700">Target Audience</label>
                        <p className="text-gray-600">{selectedWeek.targetAudience}</p>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-gray-700">Key Messaging</label>
                        <p className="text-gray-600">{selectedWeek.keyMessaging}</p>
                      </div>
                      {selectedWeek.platforms && (
                        <div>
                          <label className="text-sm font-medium text-gray-700">Platforms</label>
                          <div className="flex flex-wrap gap-2 mt-1">
                            {selectedWeek.platforms.map((platform: string, index: number) => (
                              <span key={index} className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs">
                                {platform}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-lg font-medium text-gray-900 mb-3">Content Plan</h3>
                    <div className="space-y-2">
                      {selectedWeek.contentTypes?.map((contentType: string, index: number) => (
                        <div key={index} className="flex items-center gap-2 p-2 bg-gray-50 rounded">
                          <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                          <span className="text-sm text-gray-700">{contentType}</span>
                        </div>
                      ))}
                    </div>
                    
                    {/* AI Generated Content Preview */}
                    {selectedWeek.aiContent && (Array.isArray(selectedWeek.aiContent) ? selectedWeek.aiContent.length > 0 : Object.keys(selectedWeek.aiContent).length > 0) && (
                      <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <h4 className="text-sm font-medium text-blue-900 mb-2">AI Generated Content</h4>
                        <div className="text-xs text-blue-800">
                          {typeof selectedWeek.aiContent === 'string' 
                            ? selectedWeek.aiContent.substring(0, 200) + '...'
                            : Array.isArray(selectedWeek.aiContent)
                            ? selectedWeek.aiContent.join(', ')
                            : 'Content structure generated by AI'
                          }
                        </div>
                      </div>
                    )}

                    {/* AI Suggestions */}
                    {selectedWeek.aiSuggestions && selectedWeek.aiSuggestions.length > 0 && (
                      <div className="mt-4 p-3 bg-purple-50 border border-purple-200 rounded-lg">
                        <h4 className="text-sm font-medium text-purple-900 mb-2">AI Suggestions</h4>
                        <div className="space-y-1">
                          {selectedWeek.aiSuggestions.map((suggestion: string, index: number) => (
                            <div key={index} className="text-xs text-purple-800 flex items-center gap-2">
                              <span className="w-1 h-1 bg-purple-500 rounded-full"></span>
                              {suggestion}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    <div className="space-y-3 mt-4">
                      <button 
                        onClick={() => handleAIEnhanceWeek(selectedWeek)}
                        className="w-full bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 text-white px-4 py-2 rounded-lg font-medium transition-all duration-200 flex items-center justify-center gap-2"
                      >
                        <Sparkles className="w-4 h-4" />
                        AI Generate Daily Content Structure
                      </button>
                      
                      <button 
                        onClick={() => handleDailyPlanning(selectedWeek)}
                        className="w-full border border-purple-300 text-purple-600 hover:bg-purple-50 px-4 py-2 rounded-lg font-medium transition-all duration-200 flex items-center justify-center gap-2"
                      >
                        <Calendar className="w-4 h-4" />
                        Plan Daily Content Calendar
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Day Detail Modal */}
        {showDayDetail && selectedDay && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-lg max-w-2xl w-full mx-4">
              <div className="p-6">
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <h2 className="text-xl font-semibold text-gray-900">Week {selectedDay.week}, Day {selectedDay.day}</h2>
                    <p className="text-gray-600 mt-1">{selectedDay.theme}</p>
                  </div>
                  <button 
                    onClick={() => setShowDayDetail(false)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-6 h-6" />
                  </button>
                </div>

                <div className="mb-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Content Type</label>
                      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <p className="text-sm text-blue-800 font-medium">{selectedDay.content?.contentType || 'Educational Content'}</p>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Platforms</label>
                      <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                        <div className="flex gap-2 flex-wrap">
                          {['LinkedIn', 'Twitter', 'Facebook', 'Instagram'].map((platform, index) => (
                            <span key={index} className="px-2 py-1 bg-purple-100 text-purple-700 rounded text-xs">
                              {platform}
                            </span>
                          ))}
                        </div>
                        <p className="text-xs text-gray-500 mt-2">Platforms will be configured in daily planning</p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Content Plan</label>
                    {selectedDay.content ? (
                      <div className="p-4 bg-purple-50 border border-purple-200 rounded-lg">
                        <h4 className="font-medium text-purple-900 mb-2">{selectedDay.content.title}</h4>
                        <p className="text-sm text-purple-800 mb-2">{selectedDay.content.description}</p>
                        <div className="flex gap-2 mt-2">
                          {selectedDay.content.keywords?.map((keyword: string, index: number) => (
                            <span key={index} className="px-2 py-1 bg-purple-100 text-purple-700 rounded text-xs">
                              #{keyword}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="p-4 border-2 border-dashed border-gray-300 rounded-lg text-center">
                        <p className="text-gray-500">No detailed plan for this day</p>
                        <p className="text-xs text-gray-400 mt-1">Use "AI Generate Content" to create a plan</p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex gap-3">
                  <button className="flex-1 bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 text-white px-4 py-2 rounded-lg font-medium transition-all duration-200 flex items-center justify-center gap-2">
                    <Sparkles className="w-4 h-4" />
                    AI Generate Content
                  </button>
                  <button className="flex-1 border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-lg font-semibold transition-all duration-200">
                    Schedule Post
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* AI Enhancement Modal */}
        {showAIEnhancement && selectedWeekForAI && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 w-full max-w-2xl mx-4">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold">AI Enhance Week {selectedWeekForAI}</h3>
                <button 
                  onClick={() => setShowAIEnhancement(false)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Current Week Plan</label>
                  <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                    {weeklyPlans.find(p => p.weekNumber === selectedWeekForAI) ? (
                      <>
                        <p><strong>Theme:</strong> {weeklyPlans.find(p => p.weekNumber === selectedWeekForAI)?.theme}</p>
                        <p><strong>Focus:</strong> {weeklyPlans.find(p => p.weekNumber === selectedWeekForAI)?.focusArea}</p>
                        <p><strong>Key Messaging:</strong> {weeklyPlans.find(p => p.weekNumber === selectedWeekForAI)?.keyMessaging}</p>
                      </>
                    ) : (
                      <p className="text-gray-500">No plan data available</p>
                    )}
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">AI Enhancement Request</label>
                  <textarea
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    rows={4}
                    placeholder="Describe how you'd like to enhance this week's plan..."
                  />
                </div>
                
                <div className="flex justify-end gap-3">
                  <button 
                    onClick={() => setShowAIEnhancement(false)}
                    className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
                  >
                    Cancel
                  </button>
                  <button 
                    className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2"
                  >
                    <Sparkles className="w-4 h-4" />
                    Enhance with AI
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Daily Plan Creation Modal */}
        {showDailyPlanCreation && selectedWeekForDaily && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 w-full max-w-4xl mx-4 max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold">Create Daily Plan for Week {selectedWeekForDaily}</h3>
                <button 
                  onClick={() => setShowDailyPlanCreation(false)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="space-y-6">
                {/* Week Overview */}
                <div className="bg-gray-50 p-4 rounded-lg">
                  <h4 className="font-medium mb-2">Week {selectedWeekForDaily} Overview</h4>
                  {weeklyPlans.find(p => p.weekNumber === selectedWeekForDaily) ? (
                    <>
                      <p><strong>Theme:</strong> {weeklyPlans.find(p => p.weekNumber === selectedWeekForDaily)?.theme}</p>
                      <p><strong>Focus:</strong> {weeklyPlans.find(p => p.weekNumber === selectedWeekForDaily)?.focusArea}</p>
                      <p><strong>Content Types:</strong> {weeklyPlans.find(p => p.weekNumber === selectedWeekForDaily)?.contentTypes?.join(', ')}</p>
                    </>
                  ) : (
                    <p className="text-gray-500">No plan data available</p>
                  )}
                </div>

                {/* Daily Planning Form */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Content Types */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Content Types</label>
                    <div className="space-y-2">
                      {['Post', 'Story', 'Video', 'Article', 'Live Stream', 'Reel', 'Carousel'].map(type => (
                        <label key={type} className="flex items-center">
                          <input type="checkbox" className="mr-2" />
                          <span className="text-sm">{type}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Social Platforms */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Social Platforms</label>
                    <div className="space-y-2">
                      {['LinkedIn', 'Twitter', 'Facebook', 'Instagram', 'YouTube', 'TikTok'].map(platform => (
                        <label key={platform} className="flex items-center">
                          <input type="checkbox" className="mr-2" />
                          <span className="text-sm">{platform}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Frequency Settings */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Posting Frequency</label>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Posts per day</label>
                      <input type="number" min="1" max="10" defaultValue="2" className="w-full p-2 border border-gray-300 rounded" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Stories per day</label>
                      <input type="number" min="0" max="20" defaultValue="3" className="w-full p-2 border border-gray-300 rounded" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Videos per week</label>
                      <input type="number" min="0" max="7" defaultValue="2" className="w-full p-2 border border-gray-300 rounded" />
                    </div>
                  </div>
                </div>

                {/* Daily Schedule Preview */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Daily Schedule Preview</label>
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <div className="grid grid-cols-7 gap-2 text-xs">
                      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
                        <div key={day} className="text-center">
                          <div className="font-medium mb-1">{day}</div>
                          <div className="space-y-1">
                            <div className="bg-blue-100 text-blue-800 px-1 py-0.5 rounded">Post</div>
                            <div className="bg-purple-100 text-purple-800 px-1 py-0.5 rounded">Story</div>
                            <div className="bg-green-100 text-green-800 px-1 py-0.5 rounded">Video</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex justify-end gap-3">
                  <button 
                    onClick={() => setShowDailyPlanCreation(false)}
                    className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
                  >
                    Cancel
                  </button>
                  <button 
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
                  >
                    <Calendar className="w-4 h-4" />
                    Generate Daily Plan
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
