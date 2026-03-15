import React, { useState, useEffect } from 'react';
import { 
  Calendar, 
  Target, 
  TrendingUp, 
  Users, 
  BarChart3, 
  Plus, 
  Edit3, 
  Save, 
  CheckCircle,
  AlertCircle,
  Clock,
  Sparkles,
  Eye,
  Settings,
  Download,
  Upload,
  RefreshCw,
  Zap,
  Brain,
  Rocket,
  Star,
  Heart,
  MessageCircle,
  Share,
  ExternalLink,
  Hash,
  Image,
  Video,
  FileText,
  Mic,
  Loader2,
  ChevronDown,
  ChevronRight,
  Filter,
  Search
} from 'lucide-react';

interface ContentPillar {
  id: string;
  name: string;
  description: string;
  percentage: number;
  contentTypes: string[];
  platforms: string[];
  hashtagCategories: string[];
  visualStyle: {
    colors: string[];
    fonts: string[];
    templates: string[];
  };
}

interface PlatformStrategy {
  platform: string;
  contentFrequency: {
    posts: number;
    stories: number;
    reels: number;
    videos: number;
    tweets: number;
  };
  optimalPostingTimes: {
    [key: string]: string[]; // day -> times
  };
  contentTypes: string[];
  characterLimits: {
    posts: number;
    stories: number;
    tweets: number;
  };
  targetMetrics: {
    impressions: number;
    engagements: number;
    followers: number;
  };
}

interface WeeklyPlan {
  weekNumber: number;
  phase: string;
  theme: string;
  focusArea: string;
  keyMessaging: string;
  contentTypes: string[];
  platformStrategy: PlatformStrategy[];
  callToAction: string;
  targetMetrics: {
    impressions: number;
    engagements: number;
    conversions: number;
    ugcSubmissions: number;
  };
  contentGuidelines: string;
  hashtagSuggestions: string[];
  status: 'planned' | 'in_progress' | 'completed';
  completionPercentage: number;
}

interface DailyPlan {
  id: string;
  weekNumber: number;
  dayOfWeek: string;
  date: string;
  platform: string;
  contentType: string;
  title: string;
  content: string;
  description: string;
  mediaRequirements: {
    type: string;
    dimensions: string;
    aspectRatio: string;
  };
  hashtags: string[];
  callToAction: string;
  optimalPostingTime: string;
  targetMetrics: {
    impressions: number;
    engagements: number;
    clicks: number;
  };
  status: 'planned' | 'scheduled' | 'published' | 'completed';
  priority: 'low' | 'medium' | 'high';
}

interface CampaignStrategy {
  objective: string;
  targetAudience: string;
  keyPlatforms: string[];
  campaignPhases: {
    [key: string]: {
      name: string;
      weeks: number[];
      description: string;
    };
  };
  contentPillars: ContentPillar[];
  contentFrequency: {
    [platform: string]: {
      posts: number;
      stories: number;
      reels: number;
      videos: number;
      tweets: number;
    };
  };
  visualIdentity: {
    colors: string[];
    fonts: string[];
    templates: string[];
  };
  voiceTone: string;
  overallGoals: {
    totalImpressions: number;
    totalEngagements: number;
    followerGrowth: number;
    ugcSubmissions: number;
    playlistAdds: number;
    websiteTraffic: number;
  };
  weeklyKpis: {
    impressions: number;
    engagements: number;
    followerGrowth: number;
    ugcSubmissions: number;
  };
  hashtagStrategy: {
    branded: string[];
    industry: string[];
    trending: string[];
  };
}

interface ComprehensivePlanningInterfaceProps {
  campaignId: string;
  campaignData: any;
  onSave: (data: any) => void;
}

export default function ComprehensivePlanningInterface({ 
  campaignId, 
  campaignData, 
  onSave 
}: ComprehensivePlanningInterfaceProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'strategy' | 'weekly' | 'daily' | 'metrics' | 'templates'>('overview');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [showAIModal, setShowAIModal] = useState(false);
  const [aiProvider, setAiProvider] = useState<'gpt-4' | 'claude' | 'demo'>('demo');

  // State for comprehensive planning data
  const [campaignStrategy, setCampaignStrategy] = useState<CampaignStrategy>({
    objective: '',
    targetAudience: '',
    keyPlatforms: [],
    campaignPhases: {},
    contentPillars: [],
    contentFrequency: {},
    visualIdentity: {
      colors: [],
      fonts: [],
      templates: []
    },
    voiceTone: '',
    overallGoals: {
      totalImpressions: 0,
      totalEngagements: 0,
      followerGrowth: 0,
      ugcSubmissions: 0,
      playlistAdds: 0,
      websiteTraffic: 0
    },
    weeklyKpis: {
      impressions: 0,
      engagements: 0,
      followerGrowth: 0,
      ugcSubmissions: 0
    },
    hashtagStrategy: {
      branded: [],
      industry: [],
      trending: []
    }
  });

  const [weeklyPlans, setWeeklyPlans] = useState<WeeklyPlan[]>([]);
  const [dailyPlans, setDailyPlans] = useState<DailyPlan[]>([]);
  const [platformStrategies, setPlatformStrategies] = useState<PlatformStrategy[]>([]);

  // Load existing data
  useEffect(() => {
    loadCampaignData();
  }, [campaignId]);

  const loadCampaignData = async () => {
    setIsLoading(true);
    try {
      // Load campaign strategy
      const strategyResponse = await fetch(`/api/campaigns/strategy?campaignId=${campaignId}`);
      if (strategyResponse.ok) {
        const strategyData = await strategyResponse.json();
        setCampaignStrategy(strategyData);
      }

      // Load weekly plans
      const weeklyResponse = await fetch(`/api/campaigns/get-weekly-plans?campaignId=${campaignId}`);
      if (weeklyResponse.ok) {
        const weeklyData = await weeklyResponse.json();
        const plans = Array.isArray(weeklyData?.plans) ? weeklyData.plans : (Array.isArray(weeklyData) ? weeklyData : []);
        setWeeklyPlans(plans);
      }

      // Load platform strategies
      const platformResponse = await fetch(`/api/campaigns/platform-strategies?campaignId=${campaignId}`);
      if (platformResponse.ok) {
        const platformData = await platformResponse.json();
        setPlatformStrategies(platformData);
      }

      // Load daily plans
      const dailyResponse = await fetch(`/api/campaigns/daily-plans?campaignId=${campaignId}`);
      if (dailyResponse.ok) {
        const dailyData = await dailyResponse.json();
        const mapped: DailyPlan[] = (Array.isArray(dailyData) ? dailyData : []).map((p: any) => ({
          id: String(p.id ?? `day-${p.weekNumber}-${p.dayOfWeek}`),
          weekNumber: p.weekNumber ?? 1,
          dayOfWeek: p.dayOfWeek ?? 'Monday',
          date: p.date ?? '',
          platform: p.platform ?? 'instagram',
          contentType: p.contentType ?? p.content_type ?? 'post',
          title: p.title ?? '',
          content: p.content ?? '',
          description: p.description ?? '',
          mediaRequirements: p.mediaRequirements ?? { type: 'image', dimensions: '1080x1080', aspectRatio: '1:1' },
          hashtags: p.hashtags ?? [],
          callToAction: p.cta ?? '',
          optimalPostingTime: p.scheduledTime ?? p.optimalPostingTime ?? '09:00',
          targetMetrics: p.targetMetrics ?? { impressions: 1000, engagements: 50, clicks: 10 },
          status: p.status ?? 'planned',
          priority: (p.priority ?? 'medium') as 'low' | 'medium' | 'high',
        }));
        setDailyPlans(mapped);
      }
    } catch (error) {
      console.error('Error loading campaign data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const generateAIContent = async (type: string, context: any, options?: { skipLoading?: boolean }) => {
    if (!options?.skipLoading) setIsLoading(true);
    try {
      const response = await fetch('/api/ai/generate-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          context,
          provider: aiProvider,
          campaignId
        })
      });

      if (response.ok) {
        const result = await response.json();
        return result.content;
      }
    } catch (error) {
      console.error('Error generating AI content:', error);
    } finally {
      if (!options?.skipLoading) setIsLoading(false);
    }
  };

  const handleGenerateContentPillars = async () => {
    setShowAIModal(false);
    const content = await generateAIContent('content_pillars', {
      objective: campaignStrategy.objective,
      targetAudience: campaignStrategy.targetAudience,
      keyPlatforms: campaignStrategy.keyPlatforms,
    });
    if (content?.pillars && Array.isArray(content.pillars)) {
      const pillars: ContentPillar[] = content.pillars.map((p: any, i: number) => ({
        id: p.id || `pillar-${i + 1}`,
        name: p.name || `Pillar ${i + 1}`,
        description: p.description || '',
        percentage: p.percentage ?? 20,
        contentTypes: p.contentTypes || ['post', 'story'],
        platforms: p.platforms || campaignStrategy.keyPlatforms,
        hashtagCategories: p.hashtagCategories || [],
        visualStyle: p.visualStyle || { colors: [], fonts: [], templates: [] },
      }));
      setCampaignStrategy(prev => ({ ...prev, contentPillars: pillars }));
    }
  };

  const handleSaveStrategy = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/campaigns/save-strategy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          strategy: campaignStrategy
        })
      });

      if (response.ok) {
        onSave(campaignStrategy);
      }
    } catch (error) {
      console.error('Error saving strategy:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateWeeklyPlan = async (weekNumber: number) => {
    setIsLoading(true);
    try {
      const aiContent = await generateAIContent('weekly_plan', {
        weekNumber,
        campaignStrategy,
        previousWeeks: weeklyPlans.slice(0, weekNumber - 1)
      });

      const newWeeklyPlan: WeeklyPlan = {
        weekNumber,
        phase: aiContent.phase || 'Foundation',
        theme: aiContent.theme || `Week ${weekNumber} Theme`,
        focusArea: aiContent.focusArea || `Week ${weekNumber} Focus`,
        keyMessaging: aiContent.keyMessaging || '',
        contentTypes: aiContent.contentTypes || ['post', 'story', 'video'],
        platformStrategy: platformStrategies,
        callToAction: aiContent.callToAction || '',
        targetMetrics: aiContent.targetMetrics || {
          impressions: 5000,
          engagements: 300,
          conversions: 50,
          ugcSubmissions: 25
        },
        contentGuidelines: aiContent.guidelines || '',
        hashtagSuggestions: aiContent.hashtags || [],
        status: 'planned',
        completionPercentage: 0
      };

      setWeeklyPlans(prev => [...prev.filter(w => w.weekNumber !== weekNumber), newWeeklyPlan]);
    } catch (error) {
      console.error('Error generating weekly plan:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

  const computeDayDate = (weekNumber: number, dayOfWeek: string): string => {
    const startDate = (campaignData as { start_date?: string })?.start_date;
    if (!startDate || !/^\d{4}-\d{2}-\d{2}/.test(startDate)) {
      const d = new Date();
      d.setDate(d.getDate() + (weekNumber - 1) * 7 + DAYS_OF_WEEK.indexOf(dayOfWeek as typeof DAYS_OF_WEEK[number]));
      return d.toISOString().split('T')[0];
    }
    const base = new Date(startDate.replace(/T.*/, 'T00:00:00'));
    const dayIndex = DAYS_OF_WEEK.indexOf(dayOfWeek as typeof DAYS_OF_WEEK[number]);
    base.setDate(base.getDate() + (weekNumber - 1) * 7 + dayIndex);
    return base.toISOString().split('T')[0];
  };

  /** Uses shared API: single call generates 7 days and persists to daily_content_plans */
  const handleGenerateAllDaysForWeek = async (weekNumber: number) => {
    if (!campaignId) return;
    setIsLoading(true);
    try {
      const saveRes = await fetch('/api/campaigns/generate-ai-daily-plans', {
        credentials: 'include',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          weekNumber,
          companyId: (campaignData as { company_id?: string })?.company_id,
          provider: 'demo',
        }),
      });
      if (!saveRes.ok) {
        const err = await saveRes.json().catch(() => ({}));
        console.warn('Generate AI daily plans failed:', err?.error || saveRes.statusText);
        return;
      }
      const data = await saveRes.json().catch(() => ({}));
      const rowsInserted = data?.rowsInserted ?? 0;
      if (rowsInserted > 0) {
        const res = await fetch(`/api/campaigns/daily-plans?campaignId=${encodeURIComponent(campaignId)}`);
        if (res.ok) {
          const loaded = await res.json().catch(() => []);
          const plansArray = Array.isArray(loaded) ? loaded : loaded?.plans ?? [];
          const forWeek = plansArray.filter((p: any) => Number(p.weekNumber ?? p.week_number) === weekNumber);
          const mapped: DailyPlan[] = forWeek.map((p: any) => ({
            id: p.id ?? `day-${weekNumber}-${p.dayOfWeek ?? p.day_of_week}`,
            weekNumber,
            dayOfWeek: p.dayOfWeek ?? p.day_of_week ?? 'Monday',
            date: p.date ?? computeDayDate(weekNumber, p.dayOfWeek ?? p.day_of_week ?? 'Monday'),
            platform: (p.platform || 'linkedin').toLowerCase(),
            contentType: (p.contentType ?? p.content_type ?? 'post').toLowerCase(),
            title: p.title ?? p.topic ?? '',
            content: p.content ?? '',
            description: p.description ?? '',
            mediaRequirements: { type: 'image', dimensions: '1080x1080', aspectRatio: '1:1' },
            hashtags: p.hashtags ?? [],
            callToAction: p.cta ?? '',
            optimalPostingTime: p.scheduledTime ?? p.scheduled_time ?? '09:00',
            targetMetrics: p.targetMetrics ?? { impressions: 1000, engagements: 50, clicks: 10 },
            status: 'planned',
            priority: 'medium',
          }));
          setDailyPlans(prev => [...prev.filter(d => d.weekNumber !== weekNumber), ...mapped]);
        }
      }
    } catch (error) {
      console.error('Error generating all days:', error);
    } finally {
      setIsLoading(false);
    }
  };

  /** Uses shared API: generates full week and persists to daily_content_plans (single-day UI triggers full week gen) */
  const handleGenerateDailyPlan = async (weekNumber: number, _dayOfWeek: string) => {
    await handleGenerateAllDaysForWeek(weekNumber);
  };

  const renderOverviewTab = () => (
    <div className="space-y-8">
      <div className="bg-indigo-50 border border-indigo-200 text-indigo-800 text-sm rounded-lg p-4">
        Planning boundary: Virality produces plans, signals, and priorities only. Community-AI
        executes via playbooks; credentials, APIs, and automation logic do not flow upstream.
      </div>
      {/* Campaign Overview */}
      <div className="bg-white rounded-xl p-6 shadow-sm border">
        <h3 className="text-xl font-semibold mb-4">Campaign Overview</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Objective</label>
            <textarea
              value={campaignStrategy.objective}
              onChange={(e) => setCampaignStrategy(prev => ({ ...prev, objective: e.target.value }))}
              className="w-full p-3 border rounded-lg"
              rows={3}
              placeholder="Build brand awareness and audience engagement for Drishiq using existing music catalog"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Target Audience</label>
            <textarea
              value={campaignStrategy.targetAudience}
              onChange={(e) => setCampaignStrategy(prev => ({ ...prev, targetAudience: e.target.value }))}
              className="w-full p-3 border rounded-lg"
              rows={3}
              placeholder="Music lovers, indie music fans, playlist curators, emerging artists"
            />
          </div>
        </div>
      </div>

      {/* Content Pillars */}
      <div className="bg-white rounded-xl p-6 shadow-sm border">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-semibold">Content Pillars</h3>
          <button
            onClick={() => setShowAIModal(true)}
            className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-4 py-2 rounded-lg flex items-center gap-2"
          >
            <Sparkles className="h-4 w-4" />
            AI Generate
          </button>
        </div>
        <div className="space-y-4">
          {campaignStrategy.contentPillars.map((pillar, index) => (
            <div key={pillar.id} className="border rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-medium">{pillar.name}</h4>
                <span className="text-sm text-gray-500">{pillar.percentage}%</span>
              </div>
              <p className="text-sm text-gray-600 mb-2">{pillar.description}</p>
              <div className="flex flex-wrap gap-2">
                {pillar.contentTypes.map(type => (
                  <span key={type} className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded">
                    {type}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Platform Strategy */}
      <div className="bg-white rounded-xl p-6 shadow-sm border">
        <h3 className="text-xl font-semibold mb-4">Platform Strategy</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {platformStrategies.map((strategy) => (
            <div key={strategy.platform} className="border rounded-lg p-4">
              <h4 className="font-medium capitalize mb-2">{strategy.platform}</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Posts/week:</span>
                  <span>{strategy.contentFrequency.posts}</span>
                </div>
                <div className="flex justify-between">
                  <span>Stories/week:</span>
                  <span>{strategy.contentFrequency.stories}</span>
                </div>
                <div className="flex justify-between">
                  <span>Target Impressions:</span>
                  <span>{strategy.targetMetrics.impressions.toLocaleString()}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderWeeklyTab = () => (
    <div className="space-y-6">
      {/* Campaign weeks overview */}
      <div className="bg-white rounded-xl p-6 shadow-sm border">
        <h3 className="text-xl font-semibold mb-4">Content Plan</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: weeklyPlans.length || 12 }, (_, i) => i + 1).map(weekNumber => {
            const weekPlan = weeklyPlans.find(w => w.weekNumber === weekNumber);
            return (
              <div
                key={weekNumber}
                className={`border rounded-lg p-4 cursor-pointer transition-all ${
                  selectedWeek === weekNumber ? 'border-blue-500 bg-blue-50' : 'hover:border-gray-300'
                }`}
                onClick={() => setSelectedWeek(selectedWeek === weekNumber ? null : weekNumber)}
              >
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium">Week {weekNumber}</h4>
                  {weekPlan ? (
                    <CheckCircle className="h-5 w-5 text-green-500" />
                  ) : (
                    <Plus className="h-5 w-5 text-gray-400" />
                  )}
                </div>
                {weekPlan ? (
                  <div>
                    <p className="text-sm font-medium text-gray-900">{weekPlan.theme}</p>
                    <p className="text-xs text-gray-600">{weekPlan.focusArea}</p>
                    <div className="mt-2">
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div 
                          className="bg-blue-500 h-2 rounded-full transition-all"
                          style={{ width: `${weekPlan.completionPercentage}%` }}
                        ></div>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">{weekPlan.completionPercentage}% Complete</p>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleGenerateWeeklyPlan(weekNumber);
                    }}
                    className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
                  >
                    <Sparkles className="h-3 w-3" />
                    Generate Plan
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected Week Details */}
      {selectedWeek && (
        <div className="bg-white rounded-xl p-6 shadow-sm border">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-semibold">Week {selectedWeek} Details</h3>
            <button
              onClick={() => handleGenerateWeeklyPlan(selectedWeek)}
              className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-4 py-2 rounded-lg flex items-center gap-2"
            >
              <Sparkles className="h-4 w-4" />
              AI Enhance
            </button>
          </div>
          
          {(() => {
            const weekPlan = weeklyPlans.find(w => w.weekNumber === selectedWeek);
            if (!weekPlan) return <p className="text-gray-500">No plan generated yet</p>;
            
            return (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Theme</label>
                    <input
                      type="text"
                      value={weekPlan.theme}
                      onChange={(e) => setWeeklyPlans(prev => prev.map(w => 
                        w.weekNumber === selectedWeek ? { ...w, theme: e.target.value } : w
                      ))}
                      className="w-full p-3 border rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Phase</label>
                    <select
                      value={weekPlan.phase}
                      onChange={(e) => setWeeklyPlans(prev => prev.map(w => 
                        w.weekNumber === selectedWeek ? { ...w, phase: e.target.value } : w
                      ))}
                      className="w-full p-3 border rounded-lg"
                    >
                      <option value="Foundation">Foundation & Discovery</option>
                      <option value="Growth">Growth & Momentum</option>
                      <option value="Consolidation">Consolidation & Amplification</option>
                      <option value="Sustain">Sustain & Scale</option>
                    </select>
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Focus Area</label>
                  <textarea
                    value={weekPlan.focusArea}
                    onChange={(e) => setWeeklyPlans(prev => prev.map(w => 
                      w.weekNumber === selectedWeek ? { ...w, focusArea: e.target.value } : w
                    ))}
                    className="w-full p-3 border rounded-lg"
                    rows={3}
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Key Messaging</label>
                  <textarea
                    value={weekPlan.keyMessaging}
                    onChange={(e) => setWeeklyPlans(prev => prev.map(w => 
                      w.weekNumber === selectedWeek ? { ...w, keyMessaging: e.target.value } : w
                    ))}
                    className="w-full p-3 border rounded-lg"
                    rows={3}
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Target Metrics</label>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Impressions</label>
                      <input
                        type="number"
                        value={weekPlan.targetMetrics.impressions}
                        onChange={(e) => setWeeklyPlans(prev => prev.map(w => 
                          w.weekNumber === selectedWeek ? { 
                            ...w, 
                            targetMetrics: { ...w.targetMetrics, impressions: parseInt(e.target.value) }
                          } : w
                        ))}
                        className="w-full p-2 border rounded"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Engagements</label>
                      <input
                        type="number"
                        value={weekPlan.targetMetrics.engagements}
                        onChange={(e) => setWeeklyPlans(prev => prev.map(w => 
                          w.weekNumber === selectedWeek ? { 
                            ...w, 
                            targetMetrics: { ...w.targetMetrics, engagements: parseInt(e.target.value) }
                          } : w
                        ))}
                        className="w-full p-2 border rounded"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Conversions</label>
                      <input
                        type="number"
                        value={weekPlan.targetMetrics.conversions}
                        onChange={(e) => setWeeklyPlans(prev => prev.map(w => 
                          w.weekNumber === selectedWeek ? { 
                            ...w, 
                            targetMetrics: { ...w.targetMetrics, conversions: parseInt(e.target.value) }
                          } : w
                        ))}
                        className="w-full p-2 border rounded"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">UGC Submissions</label>
                      <input
                        type="number"
                        value={weekPlan.targetMetrics.ugcSubmissions}
                        onChange={(e) => setWeeklyPlans(prev => prev.map(w => 
                          w.weekNumber === selectedWeek ? { 
                            ...w, 
                            targetMetrics: { ...w.targetMetrics, ugcSubmissions: parseInt(e.target.value) }
                          } : w
                        ))}
                        className="w-full p-2 border rounded"
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );

  const renderDailyTab = () => (
    <div className="space-y-6">
      {/* Daily Planning Calendar */}
      <div className="bg-white rounded-xl p-6 shadow-sm border">
        <h3 className="text-xl font-semibold mb-4">Daily Content Planning</h3>
        
        {selectedWeek ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-lg font-medium">Week {selectedWeek} - Daily Breakdown</h4>
              <button
                onClick={() => handleGenerateAllDaysForWeek(selectedWeek)}
                className="bg-gradient-to-r from-blue-500 to-cyan-500 text-white px-4 py-2 rounded-lg flex items-center gap-2"
              >
                <Sparkles className="h-4 w-4" />
                Generate All Days
              </button>
            </div>
            
            <div className="grid grid-cols-7 gap-4">
              {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => {
                const dayPlan = dailyPlans.find(d => d.weekNumber === selectedWeek && d.dayOfWeek === day);
                return (
                  <div
                    key={day}
                    className={`border rounded-lg p-3 cursor-pointer transition-all ${
                      selectedDay === day ? 'border-blue-500 bg-blue-50' : 'hover:border-gray-300'
                    }`}
                    onClick={() => setSelectedDay(selectedDay === day ? null : day)}
                  >
                    <h5 className="font-medium text-sm mb-2">{day}</h5>
                    {dayPlan ? (
                      <div className="space-y-1">
                        <p className="text-xs text-gray-600">{dayPlan.platform}</p>
                        <p className="text-xs text-gray-600">{dayPlan.contentType}</p>
                        <div className="w-full bg-gray-200 rounded-full h-1">
                          <div className="bg-green-500 h-1 rounded-full w-full"></div>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleGenerateDailyPlan(selectedWeek, day);
                        }}
                        className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
                      >
                        <Plus className="h-3 w-3" />
                        Plan
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="text-gray-500 text-center py-8">Select a week to view daily planning</p>
        )}
      </div>

      {/* Selected Day Details */}
      {selectedDay && selectedWeek && (
        <div className="bg-white rounded-xl p-6 shadow-sm border">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-semibold">Week {selectedWeek} - {selectedDay}</h3>
            <button
              onClick={() => handleGenerateDailyPlan(selectedWeek, selectedDay)}
              className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-4 py-2 rounded-lg flex items-center gap-2"
            >
              <Sparkles className="h-4 w-4" />
              AI Enhance
            </button>
          </div>
          
          {(() => {
            const dayPlan = dailyPlans.find(d => d.weekNumber === selectedWeek && d.dayOfWeek === selectedDay);
            if (!dayPlan) return <p className="text-gray-500">No plan generated yet</p>;
            
            return (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Platform</label>
                    <select
                      value={dayPlan.platform}
                      onChange={(e) => setDailyPlans(prev => prev.map(d => 
                        d.id === dayPlan.id ? { ...d, platform: e.target.value } : d
                      ))}
                      className="w-full p-3 border rounded-lg"
                    >
                      <option value="instagram">Instagram</option>
                      <option value="tiktok">TikTok</option>
                      <option value="youtube">YouTube</option>
                      <option value="twitter">Twitter/X</option>
                      <option value="facebook">Facebook</option>
                      <option value="linkedin">LinkedIn</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Content Type</label>
                    <select
                      value={dayPlan.contentType}
                      onChange={(e) => setDailyPlans(prev => prev.map(d => 
                        d.id === dayPlan.id ? { ...d, contentType: e.target.value } : d
                      ))}
                      className="w-full p-3 border rounded-lg"
                    >
                      <option value="post">Post</option>
                      <option value="story">Story</option>
                      <option value="reel">Reel</option>
                      <option value="video">Video</option>
                      <option value="tweet">Tweet</option>
                      <option value="thread">Thread</option>
                    </select>
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Title</label>
                  <input
                    type="text"
                    value={dayPlan.title}
                    onChange={(e) => setDailyPlans(prev => prev.map(d => 
                      d.id === dayPlan.id ? { ...d, title: e.target.value } : d
                    ))}
                    className="w-full p-3 border rounded-lg"
                    placeholder="Engaging title for your content"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Content</label>
                  <textarea
                    value={dayPlan.content}
                    onChange={(e) => setDailyPlans(prev => prev.map(d => 
                      d.id === dayPlan.id ? { ...d, content: e.target.value } : d
                    ))}
                    className="w-full p-3 border rounded-lg"
                    rows={4}
                    placeholder="Write your content here..."
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Hashtags</label>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {dayPlan.hashtags.map((hashtag, index) => (
                      <span key={index} className="px-2 py-1 bg-blue-100 text-blue-800 text-sm rounded">
                        #{hashtag}
                      </span>
                    ))}
                  </div>
                  <input
                    type="text"
                    placeholder="Add hashtags (comma separated)"
                    className="w-full p-3 border rounded-lg"
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        const input = e.target as HTMLInputElement;
                        const newHashtags = input.value.split(',').map(tag => tag.trim()).filter(tag => tag);
                        setDailyPlans(prev => prev.map(d => 
                          d.id === dayPlan.id ? { ...d, hashtags: [...d.hashtags, ...newHashtags] } : d
                        ));
                        input.value = '';
                      }
                    }}
                  />
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Optimal Posting Time</label>
                    <input
                      type="time"
                      value={dayPlan.optimalPostingTime}
                      onChange={(e) => setDailyPlans(prev => prev.map(d => 
                        d.id === dayPlan.id ? { ...d, optimalPostingTime: e.target.value } : d
                      ))}
                      className="w-full p-3 border rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Priority</label>
                    <select
                      value={dayPlan.priority}
                      onChange={(e) => setDailyPlans(prev => prev.map(d => 
                        d.id === dayPlan.id ? { ...d, priority: e.target.value as 'low' | 'medium' | 'high' } : d
                      ))}
                      className="w-full p-3 border rounded-lg"
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
                    <select
                      value={dayPlan.status}
                      onChange={(e) => setDailyPlans(prev => prev.map(d => 
                        d.id === dayPlan.id ? { ...d, status: e.target.value as any } : d
                      ))}
                      className="w-full p-3 border rounded-lg"
                    >
                      <option value="planned">Planned</option>
                      <option value="scheduled">Scheduled</option>
                      <option value="published">Published</option>
                      <option value="completed">Completed</option>
                    </select>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );

  const renderMetricsTab = () => (
    <div className="space-y-6">
      {/* Overall Campaign Goals */}
      <div className="bg-white rounded-xl p-6 shadow-sm border">
        <h3 className="text-xl font-semibold mb-4">Campaign Goals & KPIs</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="text-center">
            <div className="text-3xl font-bold text-blue-600 mb-2">
              {campaignStrategy.overallGoals.totalImpressions.toLocaleString()}
            </div>
            <div className="text-sm text-gray-600">Total Impressions</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-green-600 mb-2">
              {campaignStrategy.overallGoals.totalEngagements.toLocaleString()}
            </div>
            <div className="text-sm text-gray-600">Total Engagements</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-purple-600 mb-2">
              {campaignStrategy.overallGoals.followerGrowth.toLocaleString()}
            </div>
            <div className="text-sm text-gray-600">Follower Growth</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-orange-600 mb-2">
              {campaignStrategy.overallGoals.ugcSubmissions.toLocaleString()}
            </div>
            <div className="text-sm text-gray-600">UGC Submissions</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-red-600 mb-2">
              {campaignStrategy.overallGoals.playlistAdds.toLocaleString()}
            </div>
            <div className="text-sm text-gray-600">Playlist Adds</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-indigo-600 mb-2">
              {campaignStrategy.overallGoals.websiteTraffic.toLocaleString()}
            </div>
            <div className="text-sm text-gray-600">Website Traffic</div>
          </div>
        </div>
      </div>

      {/* Weekly Progress */}
      <div className="bg-white rounded-xl p-6 shadow-sm border">
        <h3 className="text-xl font-semibold mb-4">Weekly Progress</h3>
        <div className="space-y-4">
          {weeklyPlans.map(week => (
            <div key={week.weekNumber} className="border rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-medium">Week {week.weekNumber} - {week.theme}</h4>
                <span className="text-sm text-gray-500">{week.completionPercentage}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
                <div 
                  className="bg-blue-500 h-2 rounded-full transition-all"
                  style={{ width: `${week.completionPercentage}%` }}
                ></div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-gray-500">Impressions:</span>
                  <span className="ml-2 font-medium">{week.targetMetrics.impressions.toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-gray-500">Engagements:</span>
                  <span className="ml-2 font-medium">{week.targetMetrics.engagements.toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-gray-500">Conversions:</span>
                  <span className="ml-2 font-medium">{week.targetMetrics.conversions.toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-gray-500">UGC:</span>
                  <span className="ml-2 font-medium">{week.targetMetrics.ugcSubmissions.toLocaleString()}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Comprehensive Content Planning</h1>
              <p className="text-gray-600 mt-1">Strategic campaign content marketing plan</p>
            </div>
            <div className="flex items-center gap-4">
              <button
                onClick={handleSaveStrategy}
                disabled={isLoading}
                className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white px-6 py-3 rounded-lg font-medium flex items-center gap-2 hover:from-indigo-600 hover:to-purple-700 transition-all"
              >
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save Strategy
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="flex space-x-1 bg-white rounded-xl p-1 shadow-sm border mb-6">
          {[
            { id: 'overview', label: 'Overview', icon: BarChart3 },
            { id: 'strategy', label: 'Strategy', icon: Target },
            { id: 'weekly', label: 'Weekly Plans', icon: Calendar },
            { id: 'daily', label: 'Daily Plans', icon: Clock },
            { id: 'metrics', label: 'Metrics', icon: TrendingUp },
            { id: 'templates', label: 'Templates', icon: FileText }
          ].map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
                  activeTab === tab.id
                    ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-lg'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tab Content */}
        <div className="bg-white rounded-xl shadow-sm border">
          {activeTab === 'overview' && renderOverviewTab()}
          {activeTab === 'strategy' && renderOverviewTab()}
          {activeTab === 'weekly' && renderWeeklyTab()}
          {activeTab === 'daily' && renderDailyTab()}
          {activeTab === 'metrics' && renderMetricsTab()}
          {activeTab === 'templates' && (
            <div className="p-6">
              <h3 className="text-xl font-semibold mb-4">Content Templates</h3>
              <p className="text-gray-500">Template management coming soon...</p>
            </div>
          )}
        </div>
      </div>

      {/* AI Modal */}
      {showAIModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-semibold mb-4">AI Content Generation</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">AI Provider</label>
                <select
                  value={aiProvider}
                  onChange={(e) => setAiProvider(e.target.value as any)}
                  className="w-full p-3 border rounded-lg"
                >
                  <option value="demo">Demo AI (Free Testing)</option>
                  <option value="gpt-4">GPT-4 (OpenAI)</option>
                  <option value="claude">Claude 3.5 (Anthropic)</option>
                </select>
              </div>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowAIModal(false)}
                  className="px-4 py-2 text-gray-600 hover:text-gray-800"
                >
                  Cancel
                </button>
                <button
                  onClick={handleGenerateContentPillars}
                  className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-4 py-2 rounded-lg"
                >
                  Generate
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}



