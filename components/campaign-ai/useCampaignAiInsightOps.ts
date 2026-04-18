import { useEffect, useState } from 'react';

type CampaignAiInsightTab =
  | 'chat'
  | 'history'
  | 'audit'
  | 'execution'
  | 'content'
  | 'performance'
  | 'memory'
  | 'business'
  | 'platform';

type UseCampaignAiInsightOpsParams = {
  activeTab: CampaignAiInsightTab;
  campaignId?: string;
  resolvedCompanyId: string;
  onError: (message: string) => void;
  loadContentAssets: (campaignId: string) => Promise<void>;
  setHealthReport: (value: any) => void;
};

export function useCampaignAiInsightOps({
  activeTab,
  campaignId,
  resolvedCompanyId,
  onError,
  loadContentAssets,
  setHealthReport,
}: UseCampaignAiInsightOpsParams) {
  const [analyticsReport, setAnalyticsReport] = useState<any>(null);
  const [learningInsights, setLearningInsights] = useState<any>(null);
  const [isPerformanceLoading, setIsPerformanceLoading] = useState(false);
  const [performanceWeekNumber, setPerformanceWeekNumber] = useState<number>(1);
  const [campaignMemory, setCampaignMemory] = useState<any>(null);
  const [memoryOverlap, setMemoryOverlap] = useState<any>(null);
  const [forecastReport, setForecastReport] = useState<any>(null);
  const [roiReport, setRoiReport] = useState<any>(null);
  const [businessReport, setBusinessReport] = useState<any>(null);
  const [isBusinessLoading, setIsBusinessLoading] = useState(false);
  const [platformIntelAssetId, setPlatformIntelAssetId] = useState('');
  const [platformIntelPlatform, setPlatformIntelPlatform] = useState('linkedin');
  const [platformIntelContentType, setPlatformIntelContentType] = useState('text');
  const [platformIntelData, setPlatformIntelData] = useState<any>(null);
  const [isPlatformIntelLoading, setIsPlatformIntelLoading] = useState(false);

  const ensureCompanyId = (): boolean => {
    if (!resolvedCompanyId) {
      onError('Please select or create a campaign first.');
      return false;
    }
    return true;
  };

  const loadPerformanceInsights = async (id: string) => {
    try {
      setIsPerformanceLoading(true);
      if (!ensureCompanyId()) return;
      const analyticsResponse = await fetch('/api/analytics/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: resolvedCompanyId,
          campaignId: id,
          timeframe: 'latest',
        }),
      });
      if (analyticsResponse.ok) {
        const data = await analyticsResponse.json();
        setAnalyticsReport(data);
      } else {
        setAnalyticsReport(null);
      }
      const learningResponse = await fetch('/api/learning/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: resolvedCompanyId,
          campaignId: id,
        }),
      });
      if (learningResponse.ok) {
        const data = await learningResponse.json();
        setLearningInsights(data);
      } else {
        setLearningInsights(null);
      }
    } catch (error) {
      console.error('Error loading analytics/learning:', error);
      setAnalyticsReport(null);
      setLearningInsights(null);
    } finally {
      setIsPerformanceLoading(false);
    }
  };

  const handleApplyInsightsToWeek = async () => {
    if (!campaignId) return;
    try {
      const response = await fetch('/api/campaigns/optimize-week', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          weekNumber: performanceWeekNumber,
          reason: 'Apply learning insights',
        }),
      });
      if (!response.ok) {
        throw new Error('Failed to apply insights');
      }
      const data = await response.json();
      if (data.health_report) {
        setHealthReport(data.health_report);
      }
    } catch (error) {
      console.error('Error applying insights:', error);
      onError('Failed to apply insights.');
    }
  };

  const loadCampaignMemory = async (id: string) => {
    try {
      if (!ensureCompanyId()) return;
      const response = await fetch('/api/campaigns/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: resolvedCompanyId,
          campaignId: id,
        }),
      });
      if (!response.ok) {
        throw new Error('Failed to load campaign memory');
      }
      const data = await response.json();
      setCampaignMemory(data);
      const overlapResponse = await fetch('/api/campaigns/validate-uniqueness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: resolvedCompanyId,
          campaignId: id,
          proposedPlan: {
            themes: data.pastThemes,
            topics: data.pastTopics,
            hooks: data.pastHooks,
            messages: data.pastContentSummaries,
          },
        }),
      });
      if (overlapResponse.ok) {
        const overlapData = await overlapResponse.json();
        setMemoryOverlap(overlapData);
      } else {
        setMemoryOverlap(null);
      }
    } catch (error) {
      console.error('Error loading campaign memory:', error);
      setCampaignMemory(null);
      setMemoryOverlap(null);
    }
  };

  const loadBusinessReports = async (id: string) => {
    try {
      setIsBusinessLoading(true);
      if (!ensureCompanyId()) return;
      const forecastResponse = await fetch('/api/campaigns/forecast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: resolvedCompanyId, campaignId: id }),
      });
      if (forecastResponse.ok) {
        setForecastReport(await forecastResponse.json());
      }
      const roiResponse = await fetch('/api/campaigns/roi-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: id, costInputs: {} }),
      });
      if (roiResponse.ok) {
        setRoiReport(await roiResponse.json());
      }
      const businessResponse = await fetch('/api/campaigns/business-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: resolvedCompanyId, campaignId: id }),
      });
      if (businessResponse.ok) {
        setBusinessReport(await businessResponse.json());
      }
    } catch (error) {
      console.error('Error loading business reports:', error);
      setForecastReport(null);
      setRoiReport(null);
      setBusinessReport(null);
    } finally {
      setIsBusinessLoading(false);
    }
  };

  const handlePlatformIntel = async () => {
    if (!platformIntelAssetId) {
      onError('Select a content asset to format.');
      return;
    }
    try {
      setIsPlatformIntelLoading(true);
      if (!ensureCompanyId()) return;
      const response = await fetch('/api/platform/format-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: resolvedCompanyId,
          contentAssetId: platformIntelAssetId,
          platform: platformIntelPlatform,
          contentType: platformIntelContentType,
        }),
      });
      if (!response.ok) {
        throw new Error('Failed to format content');
      }
      const data = await response.json();
      setPlatformIntelData(data);
    } catch (error) {
      console.error('Error formatting platform content:', error);
      setPlatformIntelData(null);
      onError('Failed to format content.');
    } finally {
      setIsPlatformIntelLoading(false);
    }
  };

  const handleTrackingLinkClick = async (trackingUrl: string, platform: string) => {
    try {
      await fetch('/api/tracking/link-click', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tracking_url: trackingUrl,
          campaign_id: campaignId,
          platform,
        }),
      });
    } catch (error) {
      console.error('Tracking link click failed', error);
    } finally {
      window.location.href = trackingUrl;
    }
  };

  useEffect(() => {
    if (activeTab === 'performance' && campaignId) {
      loadPerformanceInsights(campaignId);
    }
  }, [activeTab, campaignId, performanceWeekNumber]);

  useEffect(() => {
    if (activeTab === 'memory' && campaignId) {
      loadCampaignMemory(campaignId);
    }
  }, [activeTab, campaignId]);

  useEffect(() => {
    if (activeTab === 'business' && campaignId) {
      loadBusinessReports(campaignId);
    }
  }, [activeTab, campaignId]);

  useEffect(() => {
    if (activeTab === 'platform' && campaignId) {
      setPlatformIntelData(null);
      loadContentAssets(campaignId);
    }
  }, [activeTab, campaignId]);

  return {
    analyticsReport,
    learningInsights,
    isPerformanceLoading,
    performanceWeekNumber,
    setPerformanceWeekNumber,
    campaignMemory,
    memoryOverlap,
    forecastReport,
    roiReport,
    businessReport,
    isBusinessLoading,
    platformIntelAssetId,
    setPlatformIntelAssetId,
    platformIntelPlatform,
    setPlatformIntelPlatform,
    platformIntelContentType,
    setPlatformIntelContentType,
    platformIntelData,
    isPlatformIntelLoading,
    handlePlatformIntel,
    handleTrackingLinkClick,
    handleApplyInsightsToWeek,
  };
}
