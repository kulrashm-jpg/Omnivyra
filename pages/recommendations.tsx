import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../components/CompanyContext';
import Header from '../components/Header';
import { supabase } from '../utils/supabaseClient';
import { fetchWithAuth } from '../components/community-ai/fetchWithAuth';
import VoiceNotesComponent from '../components/VoiceNotesComponent';
import {
  buildTrendSourceCounts,
  getConfidenceLabel,
  hasNoExternalSignals,
  shouldShowNoveltyWarning,
} from '../backend/services/recommendationUiExplainability';
import TrendCampaignsTab from '../components/recommendations/tabs/TrendCampaignsTab';
import NextStrategicDirection from '../components/campaigns/NextStrategicDirection';
import { useRecommendationViewMode } from '../components/recommendations/hooks/useRecommendationViewMode';
import ActiveLeadsTab from '../components/recommendations/tabs/ActiveLeadsTab';
import MarketPulseTab from '../components/recommendations/tabs/MarketPulseTab';
import RecommendationStatusWidget from '../components/recommendations/RecommendationStatusWidget';
import StrategySignalsWidget from '../components/dashboard/StrategySignalsWidget';

type TrendSignal = {
  topic: string;
  source?: string;
  sources?: string[];
  geo?: string;
  velocity?: number;
  sentiment?: number;
  volume?: number;
  frequency?: number;
  platform_tag?: string;
};

type RecommendationEngineResult = {
  trends_used: TrendSignal[];
  trends_ignored: TrendSignal[];
  weekly_plan: Array<{
    week_number: number;
    theme: string;
    trend_influence?: string[];
    platforms?: string[];
  }>;
  daily_plan: Array<{
    date: string;
    platform: string;
    content_type: string;
    topic: string;
    CTA?: string;
  }>;
  confidence_score: number;
  explanation: string;
  sources: string[];
  persona_summary?: {
    personas: string[];
    tone?: string | null;
    platform_preferences: string[];
  };
  scenario_outcomes?: {
    best_case: number;
    worst_case: number;
    likely_case: number;
  };
  scoring_adjustments?: {
    base_confidence: number;
    adjusted_confidence: number;
    persona_fit: number;
    budget_fit: number;
    competitor_gap: number;
  };
  signal_quality?: {
    external_api_health_snapshot?: Array<{
      api_source_id: string;
      health_score: number;
      avg_latency_ms: number;
    }>;
    cache_hits?: { hits: number; misses: number };
    rate_limited_sources?: string[];
    signal_confidence_summary?: { average: number; min: number; max: number } | null;
  };
  omnivyra_metadata?: {
    decision_id?: string;
    confidence?: number;
    explanation?: string;
    placeholders?: string[];
  };
  novelty_score?: number;
  omnivyra_learning?: {
    status: 'sent' | 'failed' | 'skipped';
    error?: string;
  };
  omnivyra_status?: {
    status: 'healthy' | 'degraded' | 'down' | 'disabled';
    confidence?: number;
    contract_version?: string;
    latency_ms?: number;
    fallback_reason?: string | null;
    last_error?: string | null;
    endpoint?: string | null;
  };
  chat_meta?: {
    trend_explanations?: Array<{
      topic: string;
      explanations: string[];
    }>;
  };
  opportunity_analysis?: {
    relevance_score?: number;
    narrative_angle?: string;
    content_mix?: string[];
    risk_level?: string;
    confidence?: number;
  };
};

type DetectedOpportunity = {
  topic: string;
  category?: string | null;
  confidence?: number | null;
  source?: string | null;
  risk_level?: string | null;
  priority_score?: number | null;
  trend_classification?: string | null;
  trend_reasoning?: string | null;
  growth_opportunity_score?: number | null;
};

type TrendSourceLegendItem = {
  key: string;
  label: string;
  description: string;
  badgeClass: string;
};

type ExternalApiOption = {
  id: string;
  name: string;
  is_global_preset?: boolean | null;
  company_id?: string | null;
};

const OPPORTUNITY_TAB_TYPES: { type: string; label: string }[] = [
  { type: 'TREND', label: 'Trend Campaigns' },
  { type: 'LEAD', label: 'Active Leads' },
  { type: 'PULSE', label: 'Market Pulse' },
];

export default function RecommendationsPage() {
  const router = useRouter();
  const {
    user,
    companies,
    selectedCompanyId,
    selectedCompanyName,
    setSelectedCompanyId,
    isLoading: isCompanyLoading,
    userRole,
    hasPermission,
  } = useCompanyContext();
  const viewMode = useRecommendationViewMode();
  const [engineResult, setEngineResult] = useState<RecommendationEngineResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<Array<{ id: string; name: string; status: string }>>([]);
  const [isCampaignLoading, setIsCampaignLoading] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('');
  const [selectedCampaignName, setSelectedCampaignName] = useState<string>('');
  const [campaignIdLocked, setCampaignIdLocked] = useState(false);
  const [autoGenerated, setAutoGenerated] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const [lastRefreshSource, setLastRefreshSource] = useState<string | null>(null);
  const [simulateScenarios, setSimulateScenarios] = useState(false);
  const [expandedTrendKey, setExpandedTrendKey] = useState<string | null>(null);
  const [availableApis, setAvailableApis] = useState<ExternalApiOption[]>([]);
  const [selectedApiIds, setSelectedApiIds] = useState<string[]>([]);
  const [isApiLoading, setIsApiLoading] = useState(false);
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<'all' | 'shortlisted' | 'discarded'>(
    'all'
  );
  const [recommendationStates, setRecommendationStates] = useState<Record<string, string>>({});
  const [recommendationDetails, setRecommendationDetails] = useState<
    Record<
      string,
      { state: string; actor_user_id: string | null; created_at: string | null; snapshot_hash?: string | null }
    >
  >({});
  const [recommendationSummaries, setRecommendationSummaries] = useState<
    Record<
      string,
      {
        shortlisted_count: number;
        discarded_count: number;
        active_count: number;
        priority_score?: number;
        priority_bucket?: 'High' | 'Medium' | 'Low';
        last_admin_decision?: { state: string; actor_user_id: string | null; created_at: string | null };
        last_discarded?: { actor_user_id: string | null; created_at: string | null };
      }
    >
  >({});
  const [recommendationBySnapshot, setRecommendationBySnapshot] = useState<Record<string, string>>(
    {}
  );
  const [manualTopic, setManualTopic] = useState('');
  const [manualNarrative, setManualNarrative] = useState('');
  const [manualObjective, setManualObjective] = useState('');
  const [manualPlatformPreference, setManualPlatformPreference] = useState('');
  const [isSubmittingManual, setIsSubmittingManual] = useState(false);
  const [stateError, setStateError] = useState<string | null>(null);
  const [sortByPriority, setSortByPriority] = useState(true);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [detectedOpportunities, setDetectedOpportunities] = useState<DetectedOpportunity[]>([]);
  const [detectedLoading, setDetectedLoading] = useState(false);
  const [detectedError, setDetectedError] = useState<string | null>(null);
  const [dismissedOpportunities, setDismissedOpportunities] = useState<Set<string>>(new Set());
  const [detectedPlaybooks, setDetectedPlaybooks] = useState<Record<string, any>>({});
  const [detectedPlaybookLoading, setDetectedPlaybookLoading] = useState<Record<string, boolean>>(
    {}
  );
  const [detectedPlaybookOpen, setDetectedPlaybookOpen] = useState<Set<string>>(new Set());
  const [detectedReasoningOpen, setDetectedReasoningOpen] = useState<Set<string>>(new Set());
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [generatorModalTarget, setGeneratorModalTarget] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<any | null>(null);
  const [previewRecommendationId, setPreviewRecommendationId] = useState<string | null>(null);
  const [previewSnapshotHash, setPreviewSnapshotHash] = useState<string | null>(null);
  const [previewPriorityBucket, setPreviewPriorityBucket] = useState<string | null>(null);
  const [previewCurrentState, setPreviewCurrentState] = useState<string | null>(null);
  const [previewOpinionNote, setPreviewOpinionNote] = useState('');
  const [previewConfidenceRating, setPreviewConfidenceRating] = useState<number | ''>('');
  const [previewConfidence, setPreviewConfidence] = useState<number | null>(null);
  const [previewContentFrequency, setPreviewContentFrequency] = useState<any | null>(null);
  const [selectedRecommendations, setSelectedRecommendations] = useState<Set<string>>(new Set());
  const [groupPreviewOpen, setGroupPreviewOpen] = useState(false);
  const [groupPreviewLoading, setGroupPreviewLoading] = useState(false);
  const [groupPreviewError, setGroupPreviewError] = useState<string | null>(null);
  const [groupPreview, setGroupPreview] = useState<any | null>(null);
  const [groupAssignments, setGroupAssignments] = useState<Record<string, string>>({});
  const [groupNames, setGroupNames] = useState<Record<string, string>>({});
  const [isCreatingGroupedCampaign, setIsCreatingGroupedCampaign] = useState(false);
  const [groupSortMode, setGroupSortMode] = useState<
    | 'reach'
    | 'complexity'
    | 'lead'
    | 'priority'
    | 'urgency'
    | 'revenue'
    | 'leads'
    | 'roi'
    | 'reliability'
  >('reach');
  const [activeOpportunityTab, setActiveOpportunityTab] = useState<string>('TREND');
  const [prefillBlogId, setPrefillBlogId] = useState<string | null>(null);
  const [opportunityRegions, setOpportunityRegions] = useState<string>('');
  const [trendStrategicIntents, setTrendStrategicIntents] = useState<string[]>([]);
  const [engineOverrides, setEngineOverrides] = useState<Record<string, string>>({});
  const isAdmin = useMemo(() => user?.role === 'admin', [user]);
  const canManageRecommendationState = useMemo(() => {
    const role = (userRole || '').toUpperCase();
    return ['COMPANY_ADMIN', 'CONTENT_CREATOR', 'SUPER_ADMIN'].includes(role);
  }, [userRole]);
  const canSeeDetectedOpportunities = useMemo(() => {
    const role = (userRole || '').toUpperCase();
    return ['COMPANY_ADMIN', 'CONTENT_CREATOR', 'CONTENT_MANAGER', 'SUPER_ADMIN'].includes(role);
  }, [userRole]);
  const canGenerateDetectedPlaybook = useMemo(() => {
    const role = (userRole || '').toUpperCase();
    return ['COMPANY_ADMIN', 'CONTENT_MANAGER'].includes(role);
  }, [userRole]);
  const canGroupRecommendations = useMemo(() => {
    const role = (userRole || '').toUpperCase();
    return ['COMPANY_ADMIN', 'CONTENT_MANAGER'].includes(role);
  }, [userRole]);
  const recommendedThisWeek = useMemo(() => {
    const withPriority = detectedOpportunities.map((item) => {
      const score = typeof item.priority_score === 'number' ? item.priority_score : 0;
      const bucket = score >= 0.6 ? 'High' : score >= 0.35 ? 'Medium' : 'Low';
      return { ...item, priority_bucket: bucket };
    });
    const sortFn = (a: any, b: any) => {
      if (b.priority_score !== a.priority_score) return b.priority_score - a.priority_score;
      const aMomentum = a.trend_classification === 'Momentum' ? 1 : 0;
      const bMomentum = b.trend_classification === 'Momentum' ? 1 : 0;
      return bMomentum - aMomentum;
    };
    const high = withPriority.filter((item) => item.priority_bucket === 'High').sort(sortFn);
    const medium = withPriority.filter((item) => item.priority_bucket === 'Medium').sort(sortFn);
    const selected = [...high, ...medium].slice(0, 3);
    return selected;
  }, [detectedOpportunities]);
  const detectedTopicSources = useMemo(() => {
    const map = new Map<string, Set<string>>();
    detectedOpportunities.forEach((item) => {
      const key = String(item.topic || '').toLowerCase().trim();
      if (!key) return;
      if (!map.has(key)) {
        map.set(key, new Set());
      }
      if (item.source) {
        map.get(key)?.add(String(item.source));
      }
    });
    return map;
  }, [detectedOpportunities]);
  const trendExplanationMap = useMemo(() => {
    const map = new Map<string, string[]>();
    const explanations = engineResult?.chat_meta?.trend_explanations || [];
    explanations.forEach((entry) => {
      const key = entry.topic?.trim().toLowerCase();
      if (!key || map.has(key)) return;
      map.set(key, entry.explanations || []);
    });
    return map;
  }, [engineResult?.chat_meta?.trend_explanations]);

  // Sync URL params when router is ready (e.g. opening from Content Architect "Open recommendation cards" link)
  useEffect(() => {
    if (!router.isReady) return;
    const query = router.query as Record<string, string | string[] | undefined>;
    const queryCompanyId = typeof query.companyId === 'string' ? query.companyId.trim() : '';
    const queryTab = typeof query.tab === 'string' ? query.tab.toUpperCase() : '';
    const queryCampaignId = typeof query.campaignId === 'string' ? query.campaignId.trim() : '';
    const queryBlogId = typeof query.blog_id === 'string' ? query.blog_id.trim() : '';
    if (queryCompanyId && selectedCompanyId !== queryCompanyId) {
      setSelectedCompanyId(queryCompanyId);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('selected_company_id', queryCompanyId);
        window.localStorage.setItem('company_id', queryCompanyId);
      }
    }
    if (queryTab && ['TREND', 'LEAD', 'PULSE'].includes(queryTab)) {
      setActiveOpportunityTab(queryTab);
    }
    if (queryCampaignId) {
      setSelectedCampaignId(queryCampaignId);
      setCampaignIdLocked(true);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('selected_campaign_id', queryCampaignId);
      }
    }
    // Blog → Campaign flow: pre-fill assist panel with the originating blog
    if (queryBlogId) {
      setPrefillBlogId(queryBlogId);
      setActiveOpportunityTab('TREND');
    }
  }, [router.isReady, router.query.companyId, router.query.tab, router.query.campaignId, router.query.blog_id]);

  useEffect(() => {
    if (!selectedCompanyId) {
      setCampaigns([]);
      setSelectedCampaignId('');
      setSelectedCampaignName('');
      return;
    }
    // Do not overwrite campaign from URL when opened via Content Architect link (campaignIdLocked)
    if (campaignIdLocked) return;
    const stored = typeof window !== 'undefined'
      ? window.localStorage.getItem('selected_campaign_id') || ''
      : '';
    if (stored && stored !== selectedCampaignId) {
      setSelectedCampaignId(stored);
    }
  }, [selectedCompanyId, campaignIdLocked]);

  useEffect(() => {
    if (!selectedCompanyId || !selectedCampaignId) {
      setDetectedOpportunities([]);
      setDismissedOpportunities(new Set());
      return;
    }
    fetchDetectedOpportunities();
  }, [selectedCompanyId, selectedCampaignId, canSeeDetectedOpportunities]);

  const toggleApiSelection = (apiId: string) => {
    setSelectedApiIds((prev) =>
      prev.includes(apiId) ? prev.filter((id) => id !== apiId) : [...prev, apiId]
    );
  };

  useEffect(() => {
    if (!selectedCompanyId) return;
    const loadCampaigns = async () => {
      setIsCampaignLoading(true);
      try {
        const response = await fetchWithAuth(`/api/campaigns?companyId=${encodeURIComponent(selectedCompanyId)}`);
        if (!response.ok) {
          throw new Error('Failed to load campaigns');
        }
        const data = await response.json();
        const list = (data.campaigns || []).map((item: any) => ({
          id: item.id,
          name: item.name || `Campaign ${item.id}`,
          status: item.status || 'planning',
        }));
        setCampaigns(list);
        const matched = list.find((item) => item.id === selectedCampaignId);
        if (matched) {
          setSelectedCampaignName(matched.name);
        } else if (!campaignIdLocked) {
          setSelectedCampaignId('');
          setSelectedCampaignName('');
        }
      } catch (error) {
        console.error('Unable to load campaigns');
        setCampaigns([]);
      } finally {
        setIsCampaignLoading(false);
      }
    };
    loadCampaigns();
  }, [selectedCompanyId, campaignIdLocked]);

  const handleOpportunityPromote = async (opportunityId: string) => {
    if (!selectedCompanyId) return;
    const res = await fetchWithAuth(`/api/opportunities/${opportunityId}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'PROMOTED', companyId: selectedCompanyId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const message = err?.error || 'Failed to promote';
      const e = new Error(message) as Error & { status?: number };
      e.status = res.status;
      throw e;
    }
    const data = await res.json();
    const campaignId = data?.campaignId ?? data?.campaign_id;
    if (campaignId) {
      const params = new URLSearchParams({ companyId: selectedCompanyId });
      window.location.href = `/campaign-details/${campaignId}?${params.toString()}`;
    }
  };

  const handleOpportunityAction = async (
    opportunityId: string,
    action: string,
    opts?: { scheduled_for?: string }
  ) => {
    if (!selectedCompanyId) {
      throw new Error('companyId required');
    }
    const res = await fetchWithAuth(`/api/opportunities/${opportunityId}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, companyId: selectedCompanyId, ...opts }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error || 'Action failed');
    }
  };

  useEffect(() => {
    const loadApiDefaults = async () => {
      if (!selectedCompanyId) {
        setAvailableApis([]);
        setSelectedApiIds([]);
        return;
      }
      try {
        setIsApiLoading(true);
        const response = await fetchWithAuth(
          `/api/external-apis/access?companyId=${encodeURIComponent(selectedCompanyId)}`
        );
        if (!response.ok) {
          setAvailableApis([]);
          setSelectedApiIds([]);
          return;
        }
        const data = await response.json();
        setAvailableApis(data.availableApis || []);
        setSelectedApiIds(Array.isArray(data.companyDefaultApis) ? data.companyDefaultApis : []);
      } catch {
        setAvailableApis([]);
        setSelectedApiIds([]);
      } finally {
        setIsApiLoading(false);
      }
    };
    loadApiDefaults();
  }, [selectedCompanyId]);

  // User-initiated only: no automatic recommendation generation when campaign is selected.
  // Recommendations are generated only via explicit "Generate".

  useEffect(() => {
    if (!selectedCampaignId) return;
    const match = campaigns.find((campaign) => campaign.id === selectedCampaignId);
    if (match) {
      setSelectedCampaignName(match.name);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('selected_campaign_id', selectedCampaignId);
      }
      console.log('SELECTED_CAMPAIGN', {
        companyId: selectedCompanyId,
        campaignId: selectedCampaignId,
        campaignName: match.name,
      });
    }
  }, [selectedCampaignId, campaigns, selectedCompanyId]);

  const generateRecommendations = async (manualContext?: {
    type?: string;
    topic?: string;
    narrative?: string;
    objective?: string;
    platform_preferences?: string[];
    source?: string;
  }): Promise<RecommendationEngineResult | null> => {
    if (!selectedCompanyId) {
      setErrorMessage('Please select a company first.');
      return null;
    }
    try {
      setIsLoading(true);
      setErrorMessage(null);
      setExpandedTrendKey(null);
      const response = await fetchWithAuth('/api/recommendations/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: selectedCompanyId,
          campaignId: selectedCampaignId || null,
          simulate: simulateScenarios,
          chat: true,
          selected_api_ids: selectedApiIds,
          ...(manualContext ? { manual_context: manualContext } : {}),
        }),
      });
      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        const detail = errBody?.detail ?? errBody?.error;
        throw new Error(typeof detail === 'string' ? detail : 'Failed to generate recommendations');
      }
      const data = await response.json();
      setEngineResult(data);
      setLastRefresh(new Date().toLocaleString());
      setLastRefreshSource(
        manualContext?.type === 'opportunity'
          ? 'opportunity'
          : manualContext?.type === 'detected_opportunity'
          ? 'detected_opportunity'
          : 'manual'
      );
      return data;
    } catch (error) {
      console.error('Error generating recommendations:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Failed to generate recommendations.');
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  const refreshRecommendations = async () => {
    if (!selectedCompanyId) {
      setErrorMessage('Please select a company first.');
      return;
    }
    if (!hasPermission('GENERATE_RECOMMENDATIONS')) {
      setErrorMessage('You do not have permission to refresh recommendations.');
      return;
    }
    try {
      setIsLoading(true);
      setErrorMessage(null);
      const response = await fetchWithAuth('/api/recommendations/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'company',
          companyId: selectedCompanyId,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        const message =
          data?.error ||
          (response.status ? `Failed to refresh recommendations (${response.status}).` : null) ||
          'Failed to refresh recommendations.';
        throw new Error(message);
      }
      setLastRefresh(new Date().toLocaleString());
      setLastRefreshSource('profile_update');
      await generateRecommendations();
    } catch (error) {
      console.error('Error refreshing recommendations:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Failed to refresh recommendations.');
      setIsLoading(false);
    }
  };

  const fetchDetectedOpportunities = async () => {
    if (!selectedCompanyId || !selectedCampaignId || !canSeeDetectedOpportunities) return;
    try {
      setDetectedLoading(true);
      setDetectedError(null);
      const params = new URLSearchParams({
        companyId: selectedCompanyId,
        campaignId: selectedCampaignId,
      });
      const response = await fetch(`/api/recommendations/detected-opportunities?${params.toString()}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const msg = data?.error || data?.message || `Failed to load detected opportunities (${response.status})`;
        console.error('Detected opportunities API error:', response.status, msg, data);
        setDetectedError(msg);
        setDetectedOpportunities([]);
        return;
      }
      setDetectedOpportunities(Array.isArray(data?.opportunities) ? data.opportunities : []);
    } catch (error) {
      console.error('Error loading detected opportunities:', error);
      setDetectedError('Failed to load detected opportunities.');
      setDetectedOpportunities([]);
    } finally {
      setDetectedLoading(false);
    }
  };

  const fetchStateMap = async () => {
    if (!selectedCompanyId) return;
    try {
      const snapshotHashes =
        engineResult?.trends_used?.map((t) => (t as { snapshot_hash?: string }).snapshot_hash).filter(Boolean) || [];
      const params = new URLSearchParams({ companyId: selectedCompanyId });
      if (snapshotHashes.length > 0) {
        params.set('snapshot_hashes', snapshotHashes.join(','));
      }
      const response = await fetch(`/api/recommendations/state-map?${params.toString()}`);
      if (!response.ok) {
        setRecommendationStates({});
        setRecommendationDetails({});
        setRecommendationBySnapshot({});
        return;
      }
      const data = await response.json();
      setRecommendationStates(data?.states || {});
      setRecommendationDetails(data?.details || {});
      setRecommendationSummaries(data?.summaries || {});
      setRecommendationBySnapshot(data?.recommendations || {});
    } catch (error) {
      console.error('Error loading recommendation states:', error);
      setRecommendationStates({});
      setRecommendationDetails({});
      setRecommendationSummaries({});
      setRecommendationBySnapshot({});
    }
  };

  const resolveRecommendationIdBySnapshot = async (snapshotHash: string) => {
    if (recommendationBySnapshot[snapshotHash]) {
      return recommendationBySnapshot[snapshotHash];
    }
    if (!selectedCompanyId) return null;
    try {
      const params = new URLSearchParams({
        companyId: selectedCompanyId,
        snapshot_hashes: snapshotHash,
      });
      const response = await fetch(`/api/recommendations/state-map?${params.toString()}`);
      if (!response.ok) return null;
      const data = await response.json();
      const mapping = data?.recommendations || {};
      if (mapping) {
        setRecommendationStates((prev) => ({ ...prev, ...(data?.states || {}) }));
        setRecommendationDetails((prev) => ({ ...prev, ...(data?.details || {}) }));
        setRecommendationSummaries((prev) => ({ ...prev, ...(data?.summaries || {}) }));
        setRecommendationBySnapshot((prev) => ({ ...prev, ...mapping }));
      }
      return mapping?.[snapshotHash] || null;
    } catch (error) {
      console.error('Error resolving recommendation id:', error);
      return null;
    }
  };

  const evaluateDetectedOpportunity = async (
    opportunity: DetectedOpportunity,
    options?: { state?: 'shortlisted' | 'discarded' }
  ) => {
    const data = await generateRecommendations({
      type: 'detected_opportunity',
      topic: opportunity.topic,
      source: opportunity.source || undefined,
    });
    if (!data) return;
    const match = (data.trends_used || []).find(
      (trend: any) => String(trend.topic || '').toLowerCase() === opportunity.topic.toLowerCase()
    );
    const snapshotHash = (match as { snapshot_hash?: string } | undefined)?.snapshot_hash;
    if (snapshotHash && options?.state) {
      const recommendationId = await resolveRecommendationIdBySnapshot(String(snapshotHash));
      if (recommendationId) {
        await updateRecommendationState(recommendationId, options.state);
      }
    }
  };

  const openPreviewForDetectedOpportunity = async (opportunity: DetectedOpportunity) => {
    if (!selectedCompanyId) {
      setPreviewError('Select a company to preview.');
      return;
    }
    try {
      setPreviewError(null);
      setPreviewLoading(true);
      setPreviewModalOpen(true);
      setPreviewRecommendationId(null);
      setPreviewSnapshotHash(null);
      setPreviewPriorityBucket(null);
      setPreviewCurrentState(null);
      setPreviewOpinionNote('');
      setPreviewConfidenceRating('');
      setPreviewConfidence(null);
      setPreviewContentFrequency(null);
      const previewResponse = await fetch(`/api/recommendations/manual/preview-strategy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: selectedCompanyId,
          preview_context: {
            topic: opportunity.topic,
            source: opportunity.source || null,
            category: opportunity.category || null,
          },
        }),
      });
      if (!previewResponse.ok) {
        throw new Error('Failed to generate preview');
      }
      const data = await previewResponse.json();
      setPreviewData(data?.preview || null);
      setPreviewConfidence(typeof data?.confidence === 'number' ? data.confidence : null);
      setPreviewContentFrequency(data?.content_frequency ?? null);
    } catch (error) {
      console.error('Error generating detected preview:', error);
      setPreviewError('Failed to generate preview.');
    } finally {
      setPreviewLoading(false);
    }
  };

  const dismissDetectedOpportunity = (key: string) => {
    setDismissedOpportunities((prev) => new Set([...Array.from(prev), key]));
  };

  const toggleDetectedReasoning = (key: string) => {
    setDetectedReasoningOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleDetectedPlaybook = async (key: string, opportunity: DetectedOpportunity) => {
    if (!canGenerateDetectedPlaybook) return;
    if (detectedPlaybooks[key]) {
      setDetectedPlaybookOpen((prev) => {
        const next = new Set(prev);
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }
        return next;
      });
      return;
    }
    try {
      setDetectedPlaybookLoading((prev) => ({ ...prev, [key]: true }));
      let previewResponse: Response | null = null;
      const match = (engineResult?.trends_used || []).find(
        (trend: any) => String(trend.topic || '').toLowerCase() === opportunity.topic.toLowerCase()
      );
      const snapshotHash = (match as { snapshot_hash?: string } | undefined)?.snapshot_hash;
      const recommendationId = snapshotHash ? recommendationBySnapshot[snapshotHash] : null;
      if (recommendationId) {
        previewResponse = await fetch(
          `/api/recommendations/${encodeURIComponent(recommendationId)}/preview-strategy`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          }
        );
      } else {
        previewResponse = await fetch(`/api/recommendations/manual/preview-strategy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            company_id: selectedCompanyId,
            preview_context: {
              topic: opportunity.topic,
              category: opportunity.category || null,
              source: opportunity.source || null,
              priority_bucket: opportunity.priority_score ?? null,
              trend_classification: opportunity.trend_classification || null,
            },
          }),
        });
      }
      if (!previewResponse?.ok) {
        throw new Error('Failed to generate playbook');
      }
      const data = await previewResponse.json();
      setDetectedPlaybooks((prev) => ({ ...prev, [key]: data?.preview || null }));
      setDetectedPlaybookOpen((prev) => new Set([...Array.from(prev), key]));
    } catch (error) {
      console.error('Error generating playbook:', error);
    } finally {
      setDetectedPlaybookLoading((prev) => ({ ...prev, [key]: false }));
    }
  };

  const updateRecommendationState = async (recommendationId: string, state: string) => {
    if (!recommendationId) return;
    try {
      setStateError(null);
      const response = await fetch(`/api/recommendations/${recommendationId}/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state }),
      });
      if (!response.ok) {
        setStateError('Failed to update recommendation state.');
        return;
      }
      await fetchStateMap();
    } catch (error) {
      console.error('Error updating recommendation state:', error);
      setStateError('Failed to update recommendation state.');
    }
  };

  const handleCreateCampaignFromRecommendation = async (recommendationId?: string) => {
    if (!recommendationId) {
      setErrorMessage('Recommendation ID not available.');
      return;
    }
    try {
      setIsLoading(true);
      const response = await fetch(`/api/recommendations/${recommendationId}/create-campaign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ durationWeeks: 12 }),
      });
      if (!response.ok) {
        throw new Error('Failed to create campaign');
      }
      const data = await response.json();
      if (data?.campaign_id) {
        const qs = new URLSearchParams();
        if (selectedCompanyId) qs.set('companyId', selectedCompanyId);
        qs.set('fromRecommendation', '1');
        qs.set('recommendationId', recommendationId);
        window.location.href = `/campaign-details/${data.campaign_id}?${qs.toString()}`;
      }
    } catch (error) {
      console.error('Error creating campaign:', error);
      setErrorMessage('Failed to create campaign.');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePreparePlanFromRecommendation = async (
    recommendationId?: string,
    _snapshotHash?: string | null,
    options?: { draft?: boolean; priorityBucket?: string }
  ) => {
    if (!recommendationId) {
      setErrorMessage('Recommendation context not available.');
      return;
    }
    try {
      setDraftError(null);
      setIsLoading(true);
      const response = await fetch(`/api/recommendations/${recommendationId}/create-campaign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          durationWeeks: options?.draft ? 6 : 12,
          priority_bucket: options?.priorityBucket ?? null,
        }),
      });
      if (!response.ok) {
        throw new Error('Failed to create campaign from recommendation');
      }
      const data = await response.json();
      if (data?.campaign_id) {
        const qs = new URLSearchParams();
        if (selectedCompanyId) qs.set('companyId', selectedCompanyId);
        qs.set('fromRecommendation', '1');
        qs.set('recommendationId', recommendationId);
        window.location.href = `/campaign-details/${data.campaign_id}?${qs.toString()}`;
      }
    } catch (error) {
      console.error('Error creating plan from recommendation:', error);
      setDraftError('Failed to create plan from recommendation.');
    } finally {
      setIsLoading(false);
    }
  };

  const openPreviewForRecommendation = async (
    recommendationId?: string,
    snapshotHash?: string | null,
    currentState?: string | null,
    priorityBucket?: string | null
  ) => {
    if (!recommendationId || !snapshotHash) {
      setDraftError('Preview unavailable for this recommendation.');
      return;
    }
    try {
      setPreviewError(null);
      setPreviewLoading(true);
      setPreviewModalOpen(true);
      setPreviewRecommendationId(recommendationId);
      setPreviewSnapshotHash(snapshotHash);
      setPreviewPriorityBucket(priorityBucket || null);
      setPreviewCurrentState(currentState || null);
      setPreviewOpinionNote('');
      setPreviewConfidenceRating('');
      setPreviewConfidence(null);
      setPreviewContentFrequency(null);
      const response = await fetch(`/api/recommendations/${recommendationId}/preview-strategy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        throw new Error('Failed to generate preview');
      }
      const data = await response.json();
      setPreviewData(data?.preview || null);
      setPreviewConfidence(typeof data?.confidence === 'number' ? data.confidence : null);
      setPreviewContentFrequency(data?.content_frequency ?? null);
      if (data?.snapshot_hash) {
        setPreviewSnapshotHash(String(data.snapshot_hash));
      }
      setPreviewRecommendationId(String(data?.recommendation_id || recommendationId));
    } catch (error) {
      console.error('Error generating preview:', error);
      setPreviewError('Failed to generate preview.');
    } finally {
      setPreviewLoading(false);
    }
  };

  const regeneratePreview = async () => {
    if (!previewRecommendationId) return;
    try {
      setPreviewError(null);
      setPreviewLoading(true);
      const response = await fetch(
        `/api/recommendations/${previewRecommendationId}/preview-strategy`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ preview_overrides: previewData || null }),
        }
      );
      if (!response.ok) {
        throw new Error('Failed to regenerate preview');
      }
      const data = await response.json();
      setPreviewData(data?.preview || null);
      setPreviewConfidence(typeof data?.confidence === 'number' ? data.confidence : null);
      setPreviewContentFrequency(data?.content_frequency ?? null);
    } catch (error) {
      console.error('Error regenerating preview:', error);
      setPreviewError('Failed to regenerate preview.');
    } finally {
      setPreviewLoading(false);
    }
  };

  const savePreviewOpinion = async () => {
    if (!previewRecommendationId || !previewCurrentState) {
      return;
    }
    try {
      const response = await fetch(`/api/recommendations/${previewRecommendationId}/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state: previewCurrentState,
          opinion_note: previewOpinionNote || null,
          confidence_rating:
            typeof previewConfidenceRating === 'number' ? previewConfidenceRating : null,
        }),
      });
      if (!response.ok) {
        throw new Error('Failed to save opinion');
      }
      await fetchStateMap();
    } catch (error) {
      console.error('Error saving opinion:', error);
    }
  };

  const acceptPreviewAndDraftPlan = async () => {
    if (!previewRecommendationId || !previewSnapshotHash) {
      setPreviewError('Preview context missing.');
      return;
    }
    try {
      setPreviewError(null);
      setPreviewLoading(true);
      const response = await fetch(`/api/recommendations/${previewRecommendationId}/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state: 'shortlisted',
          opinion_note: previewOpinionNote || null,
          confidence_rating:
            typeof previewConfidenceRating === 'number' ? previewConfidenceRating : null,
          accept_preview: true,
        }),
      });
      if (!response.ok) {
        throw new Error('Failed to accept preview');
      }
      if (typeof window !== 'undefined' && previewData) {
        window.sessionStorage.setItem(
          `recommendation_preview_${previewSnapshotHash}`,
          JSON.stringify({
            ...previewData,
            recommendation_id: previewRecommendationId,
            snapshot_hash: previewSnapshotHash,
            confidence: previewConfidence,
            content_frequency: previewContentFrequency,
          })
        );
      }
      setPreviewModalOpen(false);
      await handlePreparePlanFromRecommendation(previewRecommendationId, previewSnapshotHash, {
        draft: true,
        priorityBucket: previewPriorityBucket || undefined,
      });
    } catch (error) {
      console.error('Error accepting preview:', error);
      setPreviewError('Failed to accept preview.');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleManualSubmit = async () => {
    if (!manualTopic.trim() && !manualNarrative.trim() && !manualObjective.trim()) {
      setErrorMessage('Enter a topic, narrative, or objective to continue.');
      return;
    }
    try {
      setIsSubmittingManual(true);
      await generateRecommendations({
        type: 'opportunity',
        topic: manualTopic.trim() || undefined,
        narrative: manualNarrative.trim() || undefined,
        objective: manualObjective.trim() || undefined,
        platform_preferences: manualPlatformPreference
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      });
    } finally {
      setIsSubmittingManual(false);
    }
  };

  const toggleRecommendationSelection = (snapshotHash?: string | null) => {
    if (!snapshotHash) return;
    setSelectedRecommendations((prev) => {
      const next = new Set(prev);
      if (next.has(snapshotHash)) {
        next.delete(snapshotHash);
      } else {
        next.add(snapshotHash);
      }
      return next;
    });
  };

  const getSelectedRecommendationPayload = () => {
    const selected = Array.from(selectedRecommendations);
    return (engineResult?.trends_used || [])
      .filter((trend: any) => selected.includes(trend.snapshot_hash))
      .map((trend: any) => {
        const snapshotHash = trend.snapshot_hash;
        const recommendationId = snapshotHash ? recommendationBySnapshot[snapshotHash] : undefined;
        const summary = recommendationId ? recommendationSummaries[recommendationId] : undefined;
        return {
          id: recommendationId || null,
          snapshot_hash: snapshotHash,
          topic: trend.topic,
          priority_score: summary?.priority_score ?? null,
          trend_classification: summary?.priority_bucket ? summary.priority_bucket : null,
          category: trend.category ?? null,
        };
      })
      .filter((item: any) => item.snapshot_hash);
  };

  const openGroupPreview = async () => {
    if (!selectedCompanyId) return;
    const selectedPayload = getSelectedRecommendationPayload();
    if (selectedPayload.length < 2) return;
    try {
      setGroupPreviewError(null);
      setGroupPreviewLoading(true);
      const response = await fetch('/api/recommendations/group-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: selectedCompanyId,
          selected_recommendations: selectedPayload,
        }),
      });
      if (!response.ok) {
        throw new Error('Failed to generate grouping preview');
      }
      const data = await response.json();
      setGroupPreview(data);
      const assignments: Record<string, string> = {};
      const names: Record<string, string> = {};
      (data?.groups || []).forEach((group: any) => {
        const groupId = group.group_id || `group_${Math.random().toString(36).slice(2, 8)}`;
        names[groupId] = group.theme_name || 'Group';
        (group.recommendations || []).forEach((hash: string) => {
          assignments[hash] = groupId;
        });
      });
      selectedPayload.forEach((item: any) => {
        if (!assignments[item.snapshot_hash]) {
          const fallback = Object.keys(names)[0] || `group_${Math.random().toString(36).slice(2, 8)}`;
          if (!names[fallback]) names[fallback] = 'Group';
          assignments[item.snapshot_hash] = fallback;
        }
      });
      setGroupAssignments(assignments);
      setGroupNames(names);
      setGroupPreviewOpen(true);
    } catch (error) {
      console.error('Group preview failed', error);
      setGroupPreviewError('Failed to generate grouping preview.');
      setGroupPreviewOpen(true);
    } finally {
      setGroupPreviewLoading(false);
    }
  };

  const addGroup = () => {
    const groupId = `group_${Math.random().toString(36).slice(2, 8)}`;
    setGroupNames((prev) => ({ ...prev, [groupId]: 'New Group' }));
  };

  const removeEmptyGroup = (groupId: string) => {
    const hasMembers = Object.values(groupAssignments).some((id) => id === groupId);
    if (hasMembers) return;
    setGroupNames((prev) => {
      const next = { ...prev };
      delete next[groupId];
      return next;
    });
  };

  const confirmGroupedCampaign = async () => {
    if (!selectedCompanyId) return;
    const selectedPayload = getSelectedRecommendationPayload();
    if (selectedPayload.length < 2) return;
    try {
      setIsCreatingGroupedCampaign(true);
      const grouped: Record<string, string[]> = {};
      Object.entries(groupAssignments).forEach(([hash, groupId]) => {
        if (!grouped[groupId]) grouped[groupId] = [];
        grouped[groupId].push(hash);
      });
      const groups = Object.entries(grouped).map(([groupId, hashes]) => ({
        group_id: groupId,
        theme_name: groupNames[groupId] || 'Group',
        recommendations: hashes,
        rationale:
          groupPreview?.groups?.find((grp: any) => grp.group_id === groupId)?.rationale || null,
      }));
      const response = await fetch('/api/recommendations/create-campaign-from-group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: selectedCompanyId,
          selected_recommendations: selectedPayload,
          groups,
          suggested_platform_mix: groupPreview?.suggested_platform_mix || [],
          suggested_frequency: groupPreview?.suggested_frequency || {},
        }),
      });
      if (!response.ok) {
        throw new Error('Failed to create grouped campaign');
      }
      const data = await response.json();
      if (typeof window !== 'undefined' && data?.campaign_id) {
        window.sessionStorage.setItem(
          `recommendation_grouping_${data.campaign_id}`,
          JSON.stringify({
            groups,
            suggested_platform_mix: groupPreview?.suggested_platform_mix || [],
            suggested_frequency: groupPreview?.suggested_frequency || {},
          })
        );
      }
      setSelectedRecommendations(new Set());
      setGroupPreviewOpen(false);
      if (data?.campaign_id) {
        const params = selectedCompanyId ? `?companyId=${encodeURIComponent(selectedCompanyId)}&grouped=1` : '?grouped=1';
        window.location.href = `/campaign-details/${data.campaign_id}${params}`;
      }
    } catch (error) {
      console.error('Grouped campaign failed', error);
      setGroupPreviewError('Failed to create grouped campaign.');
    } finally {
      setIsCreatingGroupedCampaign(false);
    }
  };
  const confidencePercent = engineResult?.confidence_score ?? 0;
  const confidenceRatio = Math.max(0, Math.min(1, confidencePercent / 100));
  const confidenceMeta = getConfidenceLabel(confidenceRatio);
  const noExternalSignals = hasNoExternalSignals(engineResult?.omnivyra_metadata?.placeholders);
  const showNoveltyWarning = shouldShowNoveltyWarning(engineResult?.novelty_score);
  const trendCounts = buildTrendSourceCounts(engineResult?.trends_used || []);
  const trendSourceLegend: TrendSourceLegendItem[] = [
    {
      key: 'youtube',
      label: 'YouTube',
      description: 'YouTube Data API trend signals.',
      badgeClass: 'bg-red-100 text-red-700',
    },
    {
      key: 'newsapi',
      label: 'NewsAPI',
      description: 'NewsAPI headlines and breaking topics.',
      badgeClass: 'bg-blue-100 text-blue-700',
    },
    {
      key: 'reddit',
      label: 'Reddit',
      description: 'Reddit community trend signals.',
      badgeClass: 'bg-orange-100 text-orange-700',
    },
    {
      key: 'serpapi',
      label: 'SerpAPI',
      description: 'SerpAPI Google Trends signals.',
      badgeClass: 'bg-green-100 text-green-700',
    },
    {
      key: 'omnivyra',
      label: 'OmniVyra',
      description: 'OmniVyra intelligence curated trends.',
      badgeClass: 'bg-purple-100 text-purple-700',
    },
  ];
  const omnivyraStatus = engineResult?.omnivyra_status;
  useEffect(() => {
    if (!selectedCompanyId || !engineResult?.trends_used?.length) {
      setRecommendationStates({});
      setRecommendationDetails({});
      setRecommendationSummaries({});
      setRecommendationBySnapshot({});
      return;
    }
    fetchStateMap();
  }, [selectedCompanyId, engineResult?.trends_used]);
  const omnivyraStatusColor =
    omnivyraStatus?.status === 'healthy'
      ? 'bg-green-100 text-green-700'
      : omnivyraStatus?.status === 'degraded'
      ? 'bg-yellow-100 text-yellow-700'
      : omnivyraStatus?.status === 'down'
      ? 'bg-red-100 text-red-700'
      : 'bg-gray-100 text-gray-700';

  if (isCompanyLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <div className="p-6 text-gray-500">Loading company context...</div>
      </div>
    );
  }

  if (!selectedCompanyId) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <div className="p-6 text-gray-500">Select a company to view recommendations.</div>
      </div>
    );
  }

  const setEngineOverride = (engineType: string, value: string) => {
    setEngineOverrides((prev) => ({ ...prev, [engineType]: value }));
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <Header />
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Recommendation Hub: engine-based workspace. Strategy Signals on left. */}
        <section className="flex flex-col lg:flex-row gap-6">
          {selectedCompanyId && (
            <aside className="lg:w-56 shrink-0 order-first">
              <StrategySignalsWidget companyId={selectedCompanyId} fetchWithAuth={fetchWithAuth} />
              {selectedCampaignId && (
                <NextStrategicDirection
                  campaignId={selectedCampaignId}
                  campaignName={selectedCampaignName || undefined}
                  className="mt-4"
                />
              )}
            </aside>
          )}
          <div className="flex-1 min-w-0">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-3">
            <h2 className="text-xl font-semibold text-gray-900">Recommendation Hub</h2>
            {selectedCompanyId && (
              <RecommendationStatusWidget companyId={selectedCompanyId} fetchWithAuth={fetchWithAuth} />
            )}
          </div>
          <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-3 mb-3">
            {OPPORTUNITY_TAB_TYPES.map(({ type, label }) => (
              <button
                key={type}
                type="button"
                onClick={() => setActiveOpportunityTab(type)}
                className={`px-3 py-2 rounded-lg text-sm font-medium ${
                  activeOpportunityTab === type
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="min-h-[120px] pt-2">
            {activeOpportunityTab === 'TREND' && (
              <TrendCampaignsTab
                companyId={selectedCompanyId}
                regions={
                  opportunityRegions.trim()
                    ? opportunityRegions.split(',').map((r) => r.trim()).filter(Boolean)
                    : undefined
                }
                engineRecommendations={(engineResult?.trends_used as Array<Record<string, unknown>> | undefined) ?? []}
                onPromote={handleOpportunityPromote}
                onAction={handleOpportunityAction}
                fetchWithAuth={fetchWithAuth}
                overrideText={engineOverrides['TREND'] ?? ''}
                onOverrideChange={(v) => setEngineOverride('TREND', v)}
                strategicIntents={trendStrategicIntents}
                onStrategicIntentsChange={setTrendStrategicIntents}
                viewMode={viewMode}
                campaignId={selectedCampaignId || null}
                initialBlogId={prefillBlogId}
              />
            )}
            {activeOpportunityTab === 'LEAD' && (
              <ActiveLeadsTab
                companyId={selectedCompanyId}
                onPromote={handleOpportunityPromote}
                onAction={handleOpportunityAction}
                fetchWithAuth={fetchWithAuth}
                onSwitchTab={setActiveOpportunityTab}
                overrideText={engineOverrides['LEAD'] ?? ''}
                onOverrideChange={(v) => setEngineOverride('LEAD', v)}
              />
            )}
            {activeOpportunityTab === 'PULSE' && (
              <MarketPulseTab
                companyId={selectedCompanyId}
                regions={
                  opportunityRegions.trim()
                    ? opportunityRegions.split(',').map((r) => r.trim()).filter(Boolean)
                    : undefined
                }
                onPromote={handleOpportunityPromote}
                onAction={handleOpportunityAction}
                fetchWithAuth={fetchWithAuth}
                onSwitchTab={setActiveOpportunityTab}
                overrideText={engineOverrides['PULSE'] ?? ''}
                onOverrideChange={(v) => setEngineOverride('PULSE', v)}
              />
            )}
          </div>
          </div>
        </section>

        {generatorModalTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="max-w-2xl w-full rounded-xl bg-white shadow-xl border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Quick content generator</h3>
                <button
                  onClick={() => setGeneratorModalTarget(null)}
                  className="text-gray-500 hover:text-gray-700"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
              <p className="text-sm text-gray-600">
                Generator: <span className="font-medium text-gray-900">{generatorModalTarget}</span>
              </p>
              <p className="text-xs text-gray-500 mt-2">
                Integrate your existing quick-content generator here.
              </p>
              <div className="mt-4 flex justify-end">
                <button
                  onClick={() => setGeneratorModalTarget(null)}
                  className="px-3 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {previewModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="max-w-2xl w-full rounded-xl bg-white shadow-xl border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Strategy Preview</h3>
                <button
                  onClick={() => {
                    setPreviewModalOpen(false);
                    setPreviewData(null);
                    setPreviewError(null);
                  }}
                  className="text-gray-500 hover:text-gray-700"
                >
                  ✕
                </button>
              </div>

              {previewLoading && (
                <div className="text-sm text-gray-500">Generating preview...</div>
              )}
              {previewError && (
                <div className="text-sm text-red-600 mb-3">{previewError}</div>
              )}

              {previewData && (
                <div className="space-y-3 text-sm text-gray-700">
                  <div>
                    <div className="text-xs text-gray-500">Confidence</div>
                    <div className="font-medium text-gray-900">
                      {typeof previewConfidence === 'number' ? previewConfidence : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Platform Mix</div>
                    <div className="font-medium text-gray-900">
                      {Array.isArray(previewData.platform_mix)
                        ? previewData.platform_mix.join(', ')
                        : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Content Mix</div>
                    <div className="font-medium text-gray-900">
                      {Array.isArray(previewData.content_mix)
                        ? previewData.content_mix.join(', ')
                        : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Weekly Frequency</div>
                    <div className="font-medium text-gray-900 whitespace-pre-wrap">
                      {previewData.frequency_plan
                        ? JSON.stringify(previewData.frequency_plan, null, 2)
                        : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Content Frequency</div>
                    <div className="font-medium text-gray-900 whitespace-pre-wrap">
                      {previewContentFrequency
                        ? JSON.stringify(previewContentFrequency, null, 2)
                        : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Reuse Strategy</div>
                    <div className="font-medium text-gray-900">
                      {Array.isArray(previewData.reuse_plan)
                        ? previewData.reuse_plan.join(', ')
                        : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Narrative Direction</div>
                    <div className="font-medium text-gray-900 whitespace-pre-wrap">
                      {previewData.narrative_direction || '—'}
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-4 space-y-3">
                <div>
                  <label className="block text-xs text-gray-500">Opinion note</label>
                  <textarea
                    value={previewOpinionNote}
                    onChange={(event) => setPreviewOpinionNote(event.target.value)}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    rows={3}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500">Confidence rating (1-5)</label>
                  <select
                    value={previewConfidenceRating}
                    onChange={(event) =>
                      setPreviewConfidenceRating(
                        event.target.value ? Number(event.target.value) : ''
                      )
                    }
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="">Select</option>
                    {[1, 2, 3, 4, 5].map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  onClick={regeneratePreview}
                  disabled={previewLoading}
                  className="px-3 py-2 text-xs rounded-lg border border-gray-300"
                >
                  Regenerate Preview
                </button>
                <button
                  onClick={savePreviewOpinion}
                  disabled={previewLoading || !previewRecommendationId}
                  className="px-3 py-2 text-xs rounded-lg border border-gray-300"
                >
                  Add Opinion
                </button>
                <button
                  onClick={acceptPreviewAndDraftPlan}
                  disabled={previewLoading || !previewRecommendationId || !previewSnapshotHash}
                  className="px-3 py-2 text-xs rounded-lg bg-emerald-600 text-white"
                >
                  Accept Preview
                </button>
                {!previewRecommendationId && (
                  <div className="text-xs text-gray-500">
                    Evaluate with AI to enable opinions and drafting.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {groupPreviewOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="max-w-4xl w-full rounded-xl bg-white shadow-xl border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Group Recommendations</h3>
                <button
                  onClick={() => setGroupPreviewOpen(false)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  ✕
                </button>
              </div>
              {groupPreviewError && (
                <div className="mb-3 text-sm text-red-600">{groupPreviewError}</div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div className="space-y-3">
                  <div className="text-xs font-semibold text-gray-700">Groups</div>
                  {Object.entries(groupNames)
                    .sort((a, b) => {
                      const aGroup = groupPreview?.groups?.find((grp: any) => grp.group_id === a[0]) || {};
                      const bGroup = groupPreview?.groups?.find((grp: any) => grp.group_id === b[0]) || {};
                      if (groupSortMode === 'reach') {
                        const rank = (value: string) =>
                          value === 'High' ? 3 : value === 'Medium' ? 2 : value === 'Low' ? 1 : 0;
                        return rank(bGroup.expected_reach) - rank(aGroup.expected_reach);
                      }
                      if (groupSortMode === 'lead') {
                        const rank = (value: string) =>
                          value === 'High' ? 3 : value === 'Medium' ? 2 : value === 'Low' ? 1 : 0;
                        return rank(bGroup.expected_lead_potential) - rank(aGroup.expected_lead_potential);
                      }
                      if (groupSortMode === 'priority') {
                        const aPriority =
                          typeof aGroup.go_live_priority === 'number' ? aGroup.go_live_priority : 999;
                        const bPriority =
                          typeof bGroup.go_live_priority === 'number' ? bGroup.go_live_priority : 999;
                        return aPriority - bPriority;
                      }
                      if (groupSortMode === 'urgency') {
                        const aDays =
                          typeof aGroup.execution_window?.recommended_start_within_days === 'number'
                            ? aGroup.execution_window.recommended_start_within_days
                            : 999;
                        const bDays =
                          typeof bGroup.execution_window?.recommended_start_within_days === 'number'
                            ? bGroup.execution_window.recommended_start_within_days
                            : 999;
                        return aDays - bDays;
                      }
                      if (groupSortMode === 'revenue') {
                        const aRevenue = aGroup.growth_forecast?.estimated_revenue_30d?.max ?? 0;
                        const bRevenue = bGroup.growth_forecast?.estimated_revenue_30d?.max ?? 0;
                        return bRevenue - aRevenue;
                      }
                      if (groupSortMode === 'leads') {
                        const aLeads = aGroup.growth_forecast?.estimated_leads_30d?.max ?? 0;
                        const bLeads = bGroup.growth_forecast?.estimated_leads_30d?.max ?? 0;
                        return bLeads - aLeads;
                      }
                      if (groupSortMode === 'roi') {
                        const complexityRank = (value: string) =>
                          value === 'Low' ? 3 : value === 'Medium' ? 2 : value === 'High' ? 1 : 0;
                        const aRevenue = aGroup.growth_forecast?.estimated_revenue_30d?.max ?? 0;
                        const bRevenue = bGroup.growth_forecast?.estimated_revenue_30d?.max ?? 0;
                        const aComplex = complexityRank(aGroup.execution_complexity);
                        const bComplex = complexityRank(bGroup.execution_complexity);
                        const aScore = aComplex ? aRevenue / aComplex : aRevenue;
                        const bScore = bComplex ? bRevenue / bComplex : bRevenue;
                        return bScore - aScore;
                      }
                      if (groupSortMode === 'reliability') {
                        const aConfidence =
                          aGroup.growth_forecast?.forecast_confidence_band?.confidence_percentage_range?.max ?? 0;
                        const bConfidence =
                          bGroup.growth_forecast?.forecast_confidence_band?.confidence_percentage_range?.max ?? 0;
                        return bConfidence - aConfidence;
                      }
                      const rank = (value: string) =>
                        value === 'Low' ? 3 : value === 'Medium' ? 2 : value === 'High' ? 1 : 0;
                      return rank(bGroup.execution_complexity) - rank(aGroup.execution_complexity);
                    })
                    .map(([groupId, name]) => {
                    const groupData = groupPreview?.groups?.find((grp: any) => grp.group_id === groupId) || {};
                    return (
                    <div key={groupId} className="border rounded-lg p-3">
                      <input
                        value={name}
                        onChange={(event) =>
                          setGroupNames((prev) => ({ ...prev, [groupId]: event.target.value }))
                        }
                        className="w-full border border-gray-200 rounded px-2 py-1 text-xs"
                      />
                      <div className="mt-2 flex flex-wrap gap-2 text-[10px]">
                        {typeof groupData.go_live_priority === 'number' && (
                          <span className="rounded-full bg-indigo-600 px-2 py-1 text-white">
                            #{groupData.go_live_priority}
                          </span>
                        )}
                        {groupData.execution_window?.urgency_level && (
                          <span className="rounded-full bg-red-100 px-2 py-1 text-red-700">
                            Urgency: {groupData.execution_window.urgency_level}
                          </span>
                        )}
                        {typeof groupData.execution_window?.recommended_start_within_days === 'number' && (
                          <span className="rounded-full bg-rose-100 px-2 py-1 text-rose-700">
                            Start within {groupData.execution_window.recommended_start_within_days} days
                          </span>
                        )}
                        {groupData.expected_reach && (
                          <span className="rounded-full bg-emerald-100 px-2 py-1 text-emerald-700">
                            Reach: {groupData.expected_reach}
                          </span>
                        )}
                        {groupData.expected_engagement && (
                          <span className="rounded-full bg-blue-100 px-2 py-1 text-blue-700">
                            Engagement: {groupData.expected_engagement}
                          </span>
                        )}
                        {groupData.execution_complexity && (
                          <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-800">
                            Complexity: {groupData.execution_complexity}
                          </span>
                        )}
                        {groupData.expected_lead_potential && (
                          <span className="rounded-full bg-purple-100 px-2 py-1 text-purple-700">
                            Lead Potential: {groupData.expected_lead_potential}
                          </span>
                        )}
                      </div>
                      {groupData.priority_rationale && (
                        <div className="mt-2 text-[11px] text-gray-600">
                          {groupData.priority_rationale}
                        </div>
                      )}
                      {groupData.execution_window?.timing_rationale && (
                        <div className="mt-1 text-[11px] text-gray-500">
                          {groupData.execution_window.timing_rationale}
                        </div>
                      )}
                      {groupData.growth_forecast && (
                        <div className="mt-3 text-[11px] text-gray-600 space-y-2">
                          <div>
                            Estimated Leads: {groupData.growth_forecast.estimated_leads_30d?.min ?? '—'}–
                            {groupData.growth_forecast.estimated_leads_30d?.max ?? '—'}
                          </div>
                          <div>
                            Estimated Revenue: {groupData.growth_forecast.estimated_revenue_30d?.min ?? '—'}–
                            {groupData.growth_forecast.estimated_revenue_30d?.max ?? '—'}{' '}
                            {groupData.growth_forecast.estimated_revenue_30d?.currency || 'INR'}
                          </div>
                          {(() => {
                            const band = groupData.growth_forecast.forecast_confidence_band;
                            if (!band) {
                              return null;
                            }
                            const level = band.level || 'Low';
                            const minRange = band.confidence_percentage_range?.min ?? 0;
                            const maxRange = band.confidence_percentage_range?.max ?? 0;
                            const barValue = Math.max(0, Math.min(100, maxRange));
                            const barClass =
                              level === 'High'
                                ? 'bg-green-500'
                                : level === 'Medium'
                                ? 'bg-amber-500'
                                : 'bg-red-500';
                            return (
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span
                                    className={`rounded-full px-2 py-1 text-[10px] ${
                                      level === 'High'
                                        ? 'bg-green-100 text-green-700'
                                        : level === 'Medium'
                                        ? 'bg-amber-100 text-amber-700'
                                        : 'bg-red-100 text-red-700'
                                    }`}
                                  >
                                    Forecast Confidence: {level}
                                  </span>
                                  <span className="text-[10px] text-gray-500">
                                    {minRange}%–{maxRange}%
                                  </span>
                                </div>
                                <div className="h-2 w-full rounded bg-gray-100">
                                  <div className={`h-2 rounded ${barClass}`} style={{ width: `${barValue}%` }} />
                                </div>
                                {Array.isArray(band.drivers) && band.drivers.length > 0 && (
                                  <div className="text-[10px] text-gray-500">
                                    Key drivers: {band.drivers.join(', ')}
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                          {Array.isArray(groupData.growth_forecast.recommended_budget_allocation) && (
                            <div>
                              <div className="text-[10px] text-gray-500 mb-1">Budget Split</div>
                              <div className="space-y-1">
                                {groupData.growth_forecast.recommended_budget_allocation.map(
                                  (item: any) => (
                                    <div key={item.platform} className="flex items-center gap-2">
                                      <div className="w-20 text-[10px] text-gray-600">
                                        {item.platform}
                                      </div>
                                      <div className="flex-1 h-2 bg-gray-100 rounded">
                                        <div
                                          className="h-2 bg-indigo-500 rounded"
                                          style={{ width: `${Math.min(100, item.percentage || 0)}%` }}
                                        />
                                      </div>
                                      <div className="text-[10px] text-gray-600 w-10 text-right">
                                        {item.percentage ?? 0}%
                                      </div>
                                    </div>
                                  )
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      <div className="mt-2 text-[11px] text-gray-500">
                        {groupData?.rationale || '—'}
                      </div>
                      <button
                        onClick={() => removeEmptyGroup(groupId)}
                        className="mt-2 text-[10px] text-red-600"
                      >
                        Remove empty group
                      </button>
                    </div>
                  )})}
                  <button
                    onClick={addGroup}
                    className="px-2 py-1 text-xs rounded border border-gray-300"
                  >
                    Add Group
                  </button>
                </div>
                <div className="space-y-3">
                  <div className="text-xs font-semibold text-gray-700">Recommendations</div>
                  {getSelectedRecommendationPayload().map((item: any) => (
                    <div key={item.snapshot_hash} className="border rounded-lg p-3">
                      <div className="text-xs font-semibold text-gray-900">{item.topic}</div>
                      <div className="mt-2">
                        <label className="text-[10px] text-gray-500">Group</label>
                        <select
                          value={groupAssignments[item.snapshot_hash] || ''}
                          onChange={(event) =>
                            setGroupAssignments((prev) => ({
                              ...prev,
                              [item.snapshot_hash]: event.target.value,
                            }))
                          }
                          className="mt-1 w-full border border-gray-200 rounded px-2 py-1 text-xs"
                        >
                          <option value="">Unassigned</option>
                          {Object.entries(groupNames).map(([groupId, name]) => (
                            <option key={groupId} value={groupId}>
                              {name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-gray-600">
                <span className="text-xs font-semibold text-gray-700">Sort groups by:</span>
                <button
                  onClick={() => setGroupSortMode('reach')}
                  className={`px-2 py-1 rounded border ${
                    groupSortMode === 'reach' ? 'bg-indigo-600 text-white' : 'border-gray-300'
                  }`}
                >
                  Highest reach
                </button>
                <button
                  onClick={() => setGroupSortMode('lead')}
                  className={`px-2 py-1 rounded border ${
                    groupSortMode === 'lead' ? 'bg-indigo-600 text-white' : 'border-gray-300'
                  }`}
                >
                  Highest lead potential
                </button>
                <button
                  onClick={() => setGroupSortMode('priority')}
                  className={`px-2 py-1 rounded border ${
                    groupSortMode === 'priority' ? 'bg-indigo-600 text-white' : 'border-gray-300'
                  }`}
                >
                  Recommended launch order
                </button>
                <button
                  onClick={() => setGroupSortMode('urgency')}
                  className={`px-2 py-1 rounded border ${
                    groupSortMode === 'urgency' ? 'bg-indigo-600 text-white' : 'border-gray-300'
                  }`}
                >
                  Most time sensitive
                </button>
                <button
                  onClick={() => setGroupSortMode('revenue')}
                  className={`px-2 py-1 rounded border ${
                    groupSortMode === 'revenue' ? 'bg-indigo-600 text-white' : 'border-gray-300'
                  }`}
                >
                  Highest revenue
                </button>
                <button
                  onClick={() => setGroupSortMode('leads')}
                  className={`px-2 py-1 rounded border ${
                    groupSortMode === 'leads' ? 'bg-indigo-600 text-white' : 'border-gray-300'
                  }`}
                >
                  Highest leads
                </button>
                <button
                  onClick={() => setGroupSortMode('roi')}
                  className={`px-2 py-1 rounded border ${
                    groupSortMode === 'roi' ? 'bg-indigo-600 text-white' : 'border-gray-300'
                  }`}
                >
                  Best ROI
                </button>
                <button
                  onClick={() => setGroupSortMode('reliability')}
                  className={`px-2 py-1 rounded border ${
                    groupSortMode === 'reliability' ? 'bg-indigo-600 text-white' : 'border-gray-300'
                  }`}
                >
                  Most reliable forecast
                </button>
                <button
                  onClick={() => setGroupSortMode('complexity')}
                  className={`px-2 py-1 rounded border ${
                    groupSortMode === 'complexity' ? 'bg-indigo-600 text-white' : 'border-gray-300'
                  }`}
                >
                  Lowest complexity
                </button>
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  onClick={confirmGroupedCampaign}
                  disabled={isCreatingGroupedCampaign}
                  className="px-3 py-2 text-xs rounded bg-indigo-600 text-white disabled:opacity-50"
                >
                  {isCreatingGroupedCampaign ? 'Creating...' : 'Confirm & Create Campaign'}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900">External API Selection</h2>
          <p className="text-xs text-gray-500 mt-1">
            Defaults come from company settings. You can override per request.
          </p>
          {isApiLoading ? (
            <div className="text-xs text-gray-500 mt-3">Loading API defaults...</div>
          ) : (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-gray-700">
              {availableApis.length === 0 && (
                <div className="text-xs text-gray-500">No external APIs configured.</div>
              )}
              {availableApis.map((api) => (
                <label
                  key={api.id}
                  className="flex items-center gap-2 border rounded-lg px-3 py-2"
                >
                  <input
                    type="checkbox"
                    checked={selectedApiIds.includes(api.id)}
                    onChange={() => toggleApiSelection(api.id)}
                    disabled={!selectedCompanyId}
                  />
                  <span className="font-semibold">{api.name}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                    {api.is_global_preset ? 'Global (Virality)' : 'Tenant-Provided'}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        {errorMessage && (
          <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg p-3">
            {errorMessage}
          </div>
        )}
        {noExternalSignals && (
          <div className="bg-yellow-50 border border-yellow-200 text-yellow-900 text-sm rounded-lg p-3">
            Not enough trend data available. Using fallback strategy.
          </div>
        )}
        {showNoveltyWarning && (
          <div className="bg-orange-50 border border-orange-200 text-orange-900 text-sm rounded-lg p-3">
            ⚠️ Some themes were regenerated to avoid repeating past campaigns.
            <div className="text-xs text-orange-800 mt-1">
              Campaign memory detected overlap. Confidence adjusted accordingly.
            </div>
          </div>
        )}

        <div className="space-y-4">
          {engineResult ? (
            <>
              <div className="bg-white rounded-lg shadow p-6 space-y-4">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">Recommendation Overview</h2>
                    <p className="text-sm text-gray-500">{engineResult.explanation}</p>
                  </div>
                  <div className="w-full md:w-64">
                    <div className="text-xs text-gray-500 mb-1">Confidence</div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-indigo-500"
                        style={{ width: `${confidencePercent}%` }}
                      />
                    </div>
                    <div className={`text-xs mt-1 ${confidenceMeta.className}`}>
                      {confidenceMeta.label} • {confidencePercent}%
                    </div>
                  </div>
                </div>
                <div className="text-xs text-gray-600">
                  Sources: {engineResult.sources?.length ? engineResult.sources.join(', ') : '—'}
                </div>
              </div>

              {(engineResult.persona_summary || engineResult.scoring_adjustments) && (
                <div className="bg-white rounded-lg shadow p-6">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">Persona & Scoring</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-gray-700">
                    <div className="border rounded-lg p-3">
                      <div className="font-semibold text-gray-900">Persona Summary</div>
                      <div className="mt-2 text-xs text-gray-600">
                        Personas:{' '}
                        {engineResult.persona_summary?.personas?.length
                          ? engineResult.persona_summary.personas.join(', ')
                          : '—'}
                      </div>
                      <div className="text-xs text-gray-600 mt-1">
                        Tone: {engineResult.persona_summary?.tone || '—'}
                      </div>
                      <div className="text-xs text-gray-600 mt-1">
                        Preferred platforms:{' '}
                        {engineResult.persona_summary?.platform_preferences?.length
                          ? engineResult.persona_summary.platform_preferences.join(', ')
                          : '—'}
                      </div>
                    </div>
                    <div className="border rounded-lg p-3">
                      <div className="font-semibold text-gray-900">Scoring Adjustments</div>
                      <div className="mt-2 text-xs text-gray-600">
                        Base confidence: {engineResult.scoring_adjustments?.base_confidence ?? '—'}
                      </div>
                      <div className="text-xs text-gray-600">
                        Adjusted confidence: {engineResult.scoring_adjustments?.adjusted_confidence ?? '—'}
                      </div>
                      <div className="text-xs text-gray-600">
                        Persona fit: {engineResult.scoring_adjustments?.persona_fit ?? '—'}
                      </div>
                      <div className="text-xs text-gray-600">
                        Budget fit: {engineResult.scoring_adjustments?.budget_fit ?? '—'}
                      </div>
                      <div className="text-xs text-gray-600">
                        Competitor gap: {engineResult.scoring_adjustments?.competitor_gap ?? '—'}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {engineResult.scenario_outcomes && (
                <div className="bg-white rounded-lg shadow p-6">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">Scenario Outcomes</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-gray-700">
                    <div className="border rounded-lg p-3">
                      <div className="text-gray-500">Best case</div>
                      <div className="text-lg font-semibold text-gray-900">
                        {engineResult.scenario_outcomes.best_case}%
                      </div>
                    </div>
                    <div className="border rounded-lg p-3">
                      <div className="text-gray-500">Likely case</div>
                      <div className="text-lg font-semibold text-gray-900">
                        {engineResult.scenario_outcomes.likely_case}%
                      </div>
                    </div>
                    <div className="border rounded-lg p-3">
                      <div className="text-gray-500">Worst case</div>
                      <div className="text-lg font-semibold text-gray-900">
                        {engineResult.scenario_outcomes.worst_case}%
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Trend Sources</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-gray-700">
                  {trendSourceLegend.map((item) => (
                    <div
                      key={item.key}
                      className="flex items-center justify-between border rounded-lg px-3 py-2"
                      title={item.description}
                    >
                      <span className="font-medium">{item.label}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[11px] ${item.badgeClass}`}>
                        {(trendCounts as any)[item.key] || 0} trends
                      </span>
                    </div>
                  ))}
                  <div
                    className="flex items-center justify-between border rounded-lg px-3 py-2"
                    title="Trends ignored due to relevance or duplication."
                  >
                    <span className="font-medium">Ignored</span>
                    <span className="px-2 py-0.5 rounded-full text-[11px] bg-gray-100 text-gray-700">
                      {engineResult.trends_ignored.length} trends
                    </span>
                  </div>
                </div>
              </div>

              {engineResult.signal_quality && (
                <div className="bg-white rounded-lg shadow p-6">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">Signal Quality</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-gray-700">
                    <div className="border rounded-lg p-3">
                      <div className="font-semibold text-gray-900">API Health</div>
                      <div className="mt-2 space-y-1">
                        {(engineResult.signal_quality.external_api_health_snapshot || []).map((item) => {
                          const score = item.health_score ?? 0;
                          const status =
                            score >= 0.75 ? 'bg-green-100 text-green-700' : score >= 0.4 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700';
                          return (
                            <div key={item.api_source_id} className="flex items-center justify-between">
                              <span className="text-xs text-gray-600">{item.api_source_id}</span>
                              <span className={`px-2 py-0.5 rounded-full text-[11px] ${status}`}>
                                {(score * 100).toFixed(0)}%
                              </span>
                            </div>
                          );
                        })}
                        {(engineResult.signal_quality.external_api_health_snapshot || []).length === 0 && (
                          <div className="text-xs text-gray-500">No API health data.</div>
                        )}
                      </div>
                    </div>
                    <div className="border rounded-lg p-3">
                      <div className="font-semibold text-gray-900">Cache & Rate Limit</div>
                      <div className="mt-2 text-xs text-gray-600">
                        Cache hits: {engineResult.signal_quality.cache_hits?.hits ?? 0}
                      </div>
                      <div className="text-xs text-gray-600">
                        Cache misses: {engineResult.signal_quality.cache_hits?.misses ?? 0}
                      </div>
                      <div className="mt-2 text-xs text-gray-600">
                        Rate-limited sources:{' '}
                        {engineResult.signal_quality.rate_limited_sources?.length
                          ? engineResult.signal_quality.rate_limited_sources.join(', ')
                          : 'None'}
                      </div>
                      <div className="mt-2 text-xs text-gray-600">
                        Signal confidence avg:{' '}
                        {engineResult.signal_quality.signal_confidence_summary?.average ?? '—'}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {omnivyraStatus && (
                <div className="bg-white rounded-lg shadow p-6">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">OmniVyra Status</h3>
                  <div className="flex items-center gap-2 text-xs text-gray-700">
                    <span className={`px-2 py-0.5 rounded-full ${omnivyraStatusColor}`}>
                      {omnivyraStatus.status}
                    </span>
                    <span>Endpoint: {omnivyraStatus.endpoint || '—'}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-gray-600">
                    <div>Confidence: {omnivyraStatus.confidence ?? '—'}</div>
                    <div>Contract version: {omnivyraStatus.contract_version ?? '—'}</div>
                    <div>Latency: {omnivyraStatus.latency_ms ?? '—'} ms</div>
                    <div>Last error: {omnivyraStatus.last_error ?? '—'}</div>
                    <div>Fallback reason: {omnivyraStatus.fallback_reason ?? '—'}</div>
                  </div>
                </div>
              )}

              {engineResult.omnivyra_metadata && (
                <div className="bg-white rounded-lg shadow p-6">
                  <details className="text-sm text-gray-700">
                    <summary className="cursor-pointer text-sm font-semibold text-gray-900">
                      Why these recommendations?
                    </summary>
                    <div className="mt-2 text-sm text-gray-600">
                      {engineResult.omnivyra_metadata.explanation || 'OmniVyra explanation not available.'}
                    </div>
                    <div className="mt-2 text-xs text-gray-500">
                      Decision ID: {engineResult.omnivyra_metadata.decision_id || '—'}
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      Confidence: {engineResult.omnivyra_metadata.confidence ?? '—'}
                    </div>
                    {engineResult.omnivyra_metadata.placeholders?.length ? (
                      <div className="mt-2 text-xs text-gray-500">
                        Placeholders: {engineResult.omnivyra_metadata.placeholders.join(', ')}
                      </div>
                    ) : null}
                  </details>
                </div>
              )}

              {engineResult.omnivyra_learning && (
                <div className="bg-white rounded-lg shadow p-6">
                  <h3 className="text-sm font-semibold text-gray-900 mb-2">
                    Learning sent to OmniVyra
                  </h3>
                  <div className="text-xs text-gray-700">
                    {engineResult.omnivyra_learning.status === 'sent' && '✅ Sent'}
                    {engineResult.omnivyra_learning.status === 'failed' && '⚠️ Failed'}
                    {engineResult.omnivyra_learning.status === 'skipped' && '⏭ Skipped (flag off)'}
                  </div>
                  {engineResult.omnivyra_learning.error && (
                    <div className="text-xs text-red-600 mt-1">
                      {engineResult.omnivyra_learning.error}
                    </div>
                  )}
                </div>
              )}

              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Trend Recommendations</h3>
                <div className="flex flex-wrap gap-2">
                  {engineResult.trends_used.map((trend, index) => (
                    <div key={`${trend.topic}-${index}`} className="flex flex-col">
                      <div className="text-xs bg-indigo-50 text-indigo-700 px-2 py-1 rounded-full flex items-center gap-2">
                        <span>{trend.topic}</span>
                        {trendExplanationMap.has(trend.topic.trim().toLowerCase()) ? (
                          <button
                            type="button"
                            onClick={() => {
                              const key = `${trend.topic}-${index}`;
                              setExpandedTrendKey((prev) => (prev === key ? null : key));
                            }}
                            className="text-[10px] text-indigo-500 hover:text-indigo-700"
                            aria-expanded={expandedTrendKey === `${trend.topic}-${index}`}
                            aria-label="Toggle explanation"
                          >
                            Context
                          </button>
                        ) : null}
                      </div>
                      {expandedTrendKey === `${trend.topic}-${index}` ? (
                        <ul className="mt-1 text-[11px] text-gray-500 list-disc pl-4 space-y-1">
                          {(trendExplanationMap.get(trend.topic.trim().toLowerCase()) || []).map(
                            (explanation, idx) => (
                              <li key={`${trend.topic}-${index}-exp-${idx}`}>{explanation}</li>
                            )
                          )}
                        </ul>
                      ) : null}
                    </div>
                  ))}
                  {engineResult.trends_used.length === 0 && (
                    <span className="text-xs text-gray-500">No external trends used.</span>
                  )}
                </div>
              </div>

              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Trends Ignored</h3>
                <div className="flex flex-wrap gap-2">
                  {engineResult.trends_ignored.map((trend, index) => (
                    <span
                      key={`${trend.topic}-${index}`}
                      className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded-full"
                    >
                      {trend.topic}
                    </span>
                  ))}
                  {engineResult.trends_ignored.length === 0 && (
                    <span className="text-xs text-gray-500">No ignored trends.</span>
                  )}
                </div>
              </div>

              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Strategy Recommendations</h3>
                <div className="space-y-3 text-sm text-gray-700">
                  {engineResult.weekly_plan.map((week) => (
                    <div key={`week-${week.week_number}`} className="border rounded-lg p-3">
                      <div className="font-semibold text-gray-900">
                        Week {week.week_number}: {week.theme}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        Trends: {(week.trend_influence || []).join(', ') || '—'}
                      </div>
                      <div className="text-xs text-gray-500">
                        Platforms: {(week.platforms || []).join(', ') || '—'}
                      </div>
                    </div>
                  ))}
                  {engineResult.weekly_plan.length === 0 && (
                    <div className="text-xs text-gray-500">Weekly plan not available.</div>
                  )}
                </div>
              </div>

              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Daily Plan</h3>
                <div className="space-y-2 text-sm text-gray-700">
                  {engineResult.daily_plan.slice(0, 14).map((day, index) => (
                    <div key={`day-${index}`} className="flex items-center justify-between border-b pb-2">
                      <div>
                        <div className="font-medium text-gray-900">{day.date}</div>
                        <div className="text-xs text-gray-500">
                          {day.platform} • {day.content_type}
                        </div>
                      </div>
                      <div className="text-xs text-gray-600 text-right max-w-xs">
                        {day.topic}
                      </div>
                    </div>
                  ))}
                  {engineResult.daily_plan.length === 0 && (
                    <div className="text-xs text-gray-500">Daily plan not available.</div>
                  )}
                  {engineResult.daily_plan.length > 14 && (
                    <div className="text-xs text-gray-500">
                      Showing first 14 entries. Generate the campaign for full plan.
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            !isLoading && <div className="text-sm text-gray-500">No recommendations yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}
