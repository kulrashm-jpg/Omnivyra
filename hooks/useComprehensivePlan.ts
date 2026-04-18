import { useState, useEffect } from 'react';

export interface ContentPillar {
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

export interface PlatformStrategy {
  platform: string;
  contentFrequency: {
    posts: number;
    stories: number;
    reels: number;
    videos: number;
    tweets: number;
  };
  optimalPostingTimes: {
    [key: string]: string[];
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

export interface WeeklyPlan {
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

export interface DailyPlan {
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

export interface CampaignStrategy {
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

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

const defaultStrategy: CampaignStrategy = {
  objective: '',
  targetAudience: '',
  keyPlatforms: [],
  campaignPhases: {},
  contentPillars: [],
  contentFrequency: {},
  visualIdentity: { colors: [], fonts: [], templates: [] },
  voiceTone: '',
  overallGoals: {
    totalImpressions: 0,
    totalEngagements: 0,
    followerGrowth: 0,
    ugcSubmissions: 0,
    playlistAdds: 0,
    websiteTraffic: 0,
  },
  weeklyKpis: { impressions: 0, engagements: 0, followerGrowth: 0, ugcSubmissions: 0 },
  hashtagStrategy: { branded: [], industry: [], trending: [] },
};

export function useComprehensivePlan(
  campaignId: string,
  campaignData: any,
  onSave: (data: any) => void
) {
  const [isLoading, setIsLoading] = useState(false);
  const [campaignStrategy, setCampaignStrategy] = useState<CampaignStrategy>(defaultStrategy);
  const [weeklyPlans, setWeeklyPlans] = useState<WeeklyPlan[]>([]);
  const [dailyPlans, setDailyPlans] = useState<DailyPlan[]>([]);
  const [platformStrategies, setPlatformStrategies] = useState<PlatformStrategy[]>([]);
  const [aiProvider, setAiProvider] = useState<'gpt-4' | 'claude' | 'demo'>('demo');

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

  const loadCampaignData = async () => {
    setIsLoading(true);
    try {
      const strategyResponse = await fetch(`/api/campaigns/strategy?campaignId=${campaignId}`);
      if (strategyResponse.ok) {
        const strategyData = await strategyResponse.json();
        setCampaignStrategy(strategyData);
      }

      const weeklyResponse = await fetch(`/api/campaigns/get-weekly-plans?campaignId=${campaignId}`);
      if (weeklyResponse.ok) {
        const weeklyData = await weeklyResponse.json();
        const plans = Array.isArray(weeklyData?.plans) ? weeklyData.plans : (Array.isArray(weeklyData) ? weeklyData : []);
        setWeeklyPlans(plans);
      }

      const platformResponse = await fetch(`/api/campaigns/platform-strategies?campaignId=${campaignId}`);
      if (platformResponse.ok) {
        const platformData = await platformResponse.json();
        setPlatformStrategies(platformData);
      }

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

  useEffect(() => {
    loadCampaignData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  const generateAIContent = async (type: string, context: any, options?: { skipLoading?: boolean }) => {
    if (!options?.skipLoading) setIsLoading(true);
    try {
      const response = await fetch('/api/ai/generate-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, context, provider: aiProvider, campaignId }),
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

  const handleGenerateContentPillars = async (onDone?: () => void) => {
    onDone?.();
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
        body: JSON.stringify({ campaignId, strategy: campaignStrategy }),
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
        previousWeeks: weeklyPlans.slice(0, weekNumber - 1),
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
          ugcSubmissions: 25,
        },
        contentGuidelines: aiContent.guidelines || '',
        hashtagSuggestions: aiContent.hashtags || [],
        status: 'planned',
        completionPercentage: 0,
      };

      setWeeklyPlans(prev => [...prev.filter(w => w.weekNumber !== weekNumber), newWeeklyPlan]);
    } catch (error) {
      console.error('Error generating weekly plan:', error);
    } finally {
      setIsLoading(false);
    }
  };

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

  return {
    isLoading,
    campaignStrategy,
    setCampaignStrategy,
    weeklyPlans,
    setWeeklyPlans,
    dailyPlans,
    setDailyPlans,
    platformStrategies,
    aiProvider,
    setAiProvider,
    handleGenerateContentPillars,
    handleSaveStrategy,
    handleGenerateWeeklyPlan,
    handleGenerateAllDaysForWeek,
  };
}
