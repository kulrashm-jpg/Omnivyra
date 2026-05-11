import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../components/CompanyContext';

import { 
  ArrowLeft, 
  Calendar, 
  Target, 
  Plus, 
  Trash2, 
  Edit3, 
  Save, 
  CheckCircle,
  AlertCircle,
  Clock,
  Users,
  TrendingUp,
  FileText,
  Image,
  Video,
  Mic,
  Loader2,
  Sparkles
} from 'lucide-react';
import CampaignAIChat from '../components/CampaignAIChat';
import { fetchWithAuth } from '../components/community-ai/fetchWithAuth';
import AIContentIntegration from '../components/AIContentIntegration';
import ContentCreationPanel from '../components/ContentCreationPanel';
import VoiceNotesComponent from '../components/VoiceNotesComponent';
import WeeklyRefinementInterface from '../components/WeeklyRefinementInterface';


export function useCampaignPlanningState() {
  const router = useRouter();
  const { user } = useCompanyContext();
  const [campaignData, setCampaignData] = useState({
    id: '',
    name: '',
    timeframe: 'quarter',
    startDate: '',
    endDate: '',
    description: '',
    goals: []
  });

  const [newGoal, setNewGoal] = useState({
    contentType: '',
    quantity: '',
    platform: '',
    timeline: '',
    priority: 'medium'
  });

  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [planGenerationStartedAt, setPlanGenerationStartedAt] = useState<number | null>(null);
  const [planGenerationError, setPlanGenerationError] = useState<string | null>(null);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [aiProgram, setAiProgram] = useState<any>(null);
  const [showProgramCapture, setShowProgramCapture] = useState(false);
  const [programStartDate, setProgramStartDate] = useState('');
  const [activePlanningTab, setActivePlanningTab] = useState<'overview' | 'content' | 'voice' | 'refinement'>('overview');
  const [showWeeklyRefinement, setShowWeeklyRefinement] = useState(false);
  const [hasExistingPlan, setHasExistingPlan] = useState(false);
  const [planDescription, setPlanDescription] = useState('');
  const [strategyStatus, setStrategyStatus] = useState<string | null>(null);
  const [isStrategyStatusLoading, setIsStrategyStatusLoading] = useState(false);
  const [reapprovalStatus, setReapprovalStatus] = useState<{
    status: 'none' | 'reapproval_required';
    proposed_version: string | null;
    approved_version: string | null;
    proposed_created_at: string | null;
  } | null>(null);
  const [aiImprovements, setAiImprovements] = useState<any[]>([]);
  const [isAiImprovementsLoading, setIsAiImprovementsLoading] = useState(false);
  const [aiImprovementsError, setAiImprovementsError] = useState<string | null>(null);
  const [aiSuggestionContext, setAiSuggestionContext] = useState<any | null>(null);
  const [expandedSuggestionIds, setExpandedSuggestionIds] = useState<Set<string>>(new Set());
  const [selectedSuggestionIds, setSelectedSuggestionIds] = useState<Set<string>>(new Set());
  const [isRevisingStrategy, setIsRevisingStrategy] = useState(false);
  const [reviseError, setReviseError] = useState<string | null>(null);
  const [forecastVsActual, setForecastVsActual] = useState<any | null>(null);
  const [isForecastLoading, setIsForecastLoading] = useState(false);
  const [forecastError, setForecastError] = useState<string | null>(null);
  const [optimizationAdvice, setOptimizationAdvice] = useState<any | null>(null);
  const [isOptimizationLoading, setIsOptimizationLoading] = useState(false);
  const [optimizationError, setOptimizationError] = useState<string | null>(null);
  const [viralTopicMemory, setViralTopicMemory] = useState<any | null>(null);
  const [isViralTopicLoading, setIsViralTopicLoading] = useState(false);
  const [viralTopicError, setViralTopicError] = useState<string | null>(null);
  const [leadConversionIntel, setLeadConversionIntel] = useState<any | null>(null);
  const [isLeadIntelLoading, setIsLeadIntelLoading] = useState(false);
  const [leadIntelError, setLeadIntelError] = useState<string | null>(null);
  const [momentumData, setMomentumData] = useState<any | null>(null);
  const [isMomentumLoading, setIsMomentumLoading] = useState(false);
  const [momentumError, setMomentumError] = useState<string | null>(null);
  const [stableThemesOpen, setStableThemesOpen] = useState(false);
  const [platformAdvice, setPlatformAdvice] = useState<any | null>(null);
  const [isPlatformAdviceLoading, setIsPlatformAdviceLoading] = useState(false);
  const [platformAdviceError, setPlatformAdviceError] = useState<string | null>(null);
  const [platformSortMode, setPlatformSortMode] = useState<'roi' | 'growth' | 'reduce'>('roi');
  const [rebalanceProposal, setRebalanceProposal] = useState<any | null>(null);
  const [rebalanceStatus, setRebalanceStatus] = useState<'pending' | 'approved' | 'rejected' | null>(null);
  const [rebalanceError, setRebalanceError] = useState<string | null>(null);
  const [isRebalanceLoading, setIsRebalanceLoading] = useState(false);
  const [showRebalanceRationale, setShowRebalanceRationale] = useState(false);
  const [showRebalanceRejectModal, setShowRebalanceRejectModal] = useState(false);
  const [rebalanceRejectReason, setRebalanceRejectReason] = useState('');
  const [recommendationContext, setRecommendationContext] = useState<any | null>(null);
  const [recommendationHash, setRecommendationHash] = useState<string | null>(null);
  const [alignedPreview, setAlignedPreview] = useState<any | null>(null);
  const [alignedPreviewError, setAlignedPreviewError] = useState<string | null>(null);
  const [groupedContext, setGroupedContext] = useState<any | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const notify = (type: 'success' | 'error' | 'info', message: string) => setNotice({ type, message });

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(t);
  }, [notice]);

  // SECURITY: clear all server-fetched campaign state when the authenticated
  // identity changes. Prevents the previous user's campaign drafts/AI outputs
  // from being visible after a sign-out → sign-in in the same tab.
  const previousUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    const currentUserId = user?.userId ?? null;
    const previousUserId = previousUserIdRef.current;
    if (previousUserId && previousUserId !== currentUserId) {
      setCampaignData({ id: '', name: '', timeframe: 'quarter', startDate: '', endDate: '', description: '', goals: [] });
      setCampaignId(null);
      setAiProgram(null);
      setAiImprovements([]);
      setAiImprovementsError(null);
      setAiSuggestionContext(null);
      setExpandedSuggestionIds(new Set());
      setSelectedSuggestionIds(new Set());
      setHasExistingPlan(false);
      setPlanDescription('');
      setStrategyStatus(null);
      setReapprovalStatus(null);
      setForecastVsActual(null);
      setForecastError(null);
      setOptimizationAdvice(null);
      setOptimizationError(null);
      setViralTopicMemory(null);
      setViralTopicError(null);
      setLeadConversionIntel(null);
      setLeadIntelError(null);
      setMomentumData(null);
      setMomentumError(null);
      setPlatformAdvice(null);
      setPlatformAdviceError(null);
      setRebalanceProposal(null);
      setRebalanceStatus(null);
      setRebalanceError(null);
      setRecommendationContext(null);
      setRecommendationHash(null);
      setAlignedPreview(null);
      setAlignedPreviewError(null);
      setGroupedContext(null);
      setPlanGenerationError(null);
      setReviseError(null);
      setNotice(null);
    }
    previousUserIdRef.current = currentUserId;
  }, [user?.userId]);

  const isStrategyLocked = strategyStatus === 'approved';
  const isStrategyProposed = strategyStatus === 'proposed';
  const isDraftMode =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('mode') === 'draft';
  const isEditMode = false;
  const forecastDelta = (() => {
    const variance = forecastVsActual?.variance || {};
    const candidates = [
      { key: 'revenue_delta_pct', label: 'Revenue' },
      { key: 'lead_delta_pct', label: 'Leads' },
      { key: 'reach_delta_pct', label: 'Reach' },
    ];
    for (const candidate of candidates) {
      const value = variance[candidate.key];
      if (typeof value === 'number') {
        return { value, label: candidate.label };
      }
    }
    return null;
  })();
  const accuracyPct =
    forecastDelta && typeof forecastDelta.value === 'number'
      ? Math.max(0, Math.min(100, 100 - Math.abs(forecastDelta.value)))
      : null;
  const platformAccuracyEntries = Object.entries(
    forecastVsActual?.learning_signals?.platform_accuracy || {}
  )
    .sort((a: any, b: any) => (b?.[1]?.share_pct ?? 0) - (a?.[1]?.share_pct ?? 0))
    .slice(0, 4);
  const platformAdviceEntries = Object.entries(
    optimizationAdvice?.learning_signals?.platform_accuracy || {}
  )
    .sort((a: any, b: any) => (b?.[1]?.share_pct ?? 0) - (a?.[1]?.share_pct ?? 0))
    .slice(0, 4);

  // Initialize campaign from URL params or load existing campaign
  useEffect(() => {
    // Only run on client side
    if (typeof window === 'undefined') return;
    
    console.log('useEffect triggered - checking URL params');
    const urlParams = new URLSearchParams(window.location.search);
    const mode = urlParams.get('mode');
    const existingCampaignId = urlParams.get('campaignId') || urlParams.get('id'); // support both for compatibility
    const context = urlParams.get('context');
    const hash = urlParams.get('hash');
    const draftMode = mode === 'draft';
    console.log('URL params:', { mode, existingCampaignId, search: window.location.search });

    if (context === 'recommendation' && hash) {
      const stored = window.sessionStorage.getItem(`recommendation_plan_context_${hash}`);
      const previewStored = window.sessionStorage.getItem(`recommendation_preview_${hash}`);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          setRecommendationContext(parsed?.recommendation_context || null);
          setRecommendationHash(hash);
        } catch {
          setRecommendationContext(null);
          setRecommendationHash(hash);
        }
      } else {
        setRecommendationContext(null);
        setRecommendationHash(hash);
      }
      if (previewStored) {
        try {
          const parsedPreview = JSON.parse(previewStored);
          if (
            parsedPreview &&
            !parsedPreview.frequency_plan &&
            parsedPreview.content_frequency &&
            typeof parsedPreview.content_frequency === 'object'
          ) {
            parsedPreview.frequency_plan = parsedPreview.content_frequency;
          }
          setAlignedPreview(parsedPreview);
        } catch {
          setAlignedPreview(null);
        }
      } else {
        setAlignedPreview(null);
      }
      if (draftMode) {
        setIsLoading(false);
      }
    }

    if (typeof window !== 'undefined' && urlParams.get('grouped') === '1' && existingCampaignId) {
      const grouped = window.sessionStorage.getItem(
        `recommendation_grouping_${existingCampaignId}`
      );
      if (grouped) {
        try {
          setGroupedContext(JSON.parse(grouped));
        } catch {
          setGroupedContext(null);
        }
      }
    }

    if (mode === 'create') {
      // Create mode disabled; redirect to Campaign Planner (canonical creation entry)
      window.location.href = '/campaign-planner?mode=direct';
      return;
    } else if (!existingCampaignId) {
      // No campaignId and not create mode; redirect to planner
      window.location.href = '/campaign-planner?mode=direct';
      return;
    } else if (mode === 'edit') {
      // Edit mode entrypoint removed; send users to campaign details page instead.
      console.warn('Edit mode entrypoint removed, redirecting to campaign details/campaigns');
      if (typeof window !== 'undefined') {
        window.location.href = existingCampaignId ? `/campaign-details/${existingCampaignId}` : '/campaigns';
      }
      return;
    } else if (existingCampaignId) {
      console.log('Loading campaign with ID:', existingCampaignId);
      loadCampaign(existingCampaignId);
    } else {
      console.log('No campaign ID found in URL, checking for existing campaigns');
      loadExistingCampaign();
    }
  }, []);

  useEffect(() => {
    if (!campaignId) {
      setStrategyStatus(null);
      setReapprovalStatus(null);
      setForecastVsActual(null);
      setForecastError(null);
      setOptimizationAdvice(null);
      setOptimizationError(null);
      setViralTopicMemory(null);
      setViralTopicError(null);
      setLeadConversionIntel(null);
      setLeadIntelError(null);
      setMomentumData(null);
      setMomentumError(null);
      setPlatformAdvice(null);
      setPlatformAdviceError(null);
      setRebalanceProposal(null);
      setRebalanceStatus(null);
      setRebalanceError(null);
      return;
    }
    fetchStrategyStatus(campaignId);
    fetchReapprovalStatus(campaignId);
    fetchForecastVsActual(campaignId);
    fetchOptimizationAdvice(campaignId);
    fetchViralTopicMemory(campaignId);
    fetchLeadConversionIntel(campaignId);
    fetchMomentumData(campaignId);
    fetchPlatformAdvice(campaignId);
  }, [campaignId]);

  useEffect(() => {
    if (strategyStatus === 'approved' && campaignId) {
      fetchAiImprovements(campaignId);
    } else {
      setAiImprovements([]);
      setAiImprovementsError(null);
      setAiSuggestionContext(null);
      setExpandedSuggestionIds(new Set());
      setSelectedSuggestionIds(new Set());
      setReviseError(null);
    }
  }, [strategyStatus, campaignId]);

  // Initialize AI chat state based on URL params
  useEffect(() => {
    // Only run on client side
    if (typeof window === 'undefined') return;
    
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('openAI') === 'true') {
      setIsChatOpen(true);
    }
  }, []);

  const createNewCampaign = async () => {
    setIsLoading(true);
    try {
      // Generate proper UUID for campaign ID
      const newCampaignId = crypto.randomUUID();
      console.log('Creating new campaign with ID:', newCampaignId);
      
      // Set campaign data
      setCampaignId(newCampaignId);
      setCampaignData(prev => ({
        ...prev,
        id: newCampaignId,
        name: 'New Campaign',
        description: '',
        timeframe: 'quarter',
        startDate: '',
        endDate: '',
        goals: []
      }));
      
      // Update URL to include the new campaign ID
      const newUrl = `${window.location.pathname}?campaignId=${newCampaignId}`;
      window.history.pushState({}, '', newUrl);
      
      // Start AI chat for campaign planning
      setIsChatOpen(true);
      
      console.log('Campaign created successfully:', newCampaignId);
      
      // Show success message
      notify('success', 'New campaign created! You can now start planning your content strategy.');
      
    } catch (error) {
      console.error('Error creating campaign:', error);
      notify('error', 'Error creating campaign. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const generate12WeekPlan = async () => {
    if (isStrategyLocked) {
      notify('success', 'Strategy approved. Editing locked by Company Admin.');
      return;
    }
    if (!campaignId) {
      notify('info', 'Please create a campaign first');
      return;
    }

    setIsLoading(true);
    setPlanGenerationStartedAt(Date.now());
    setPlanGenerationError(null);
    try {
      console.log('Generating campaign plan for campaign:', campaignId);

      const response = await fetch('/api/campaigns/create-12week-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          startDate: campaignData.startDate || new Date().toISOString().split('T')[0],
          aiContent: campaignData.description || 'Generate comprehensive content marketing plan',
          provider: 'demo'
        })
      });

      if (response.ok) {
        const result = await response.json();
        console.log('Campaign plan generated:', result);
        
        // Check for existing plan after generation
        await checkExistingPlan(campaignId);
        
        // Redirect to campaign details to view the generated plan
        window.location.href = `/campaign-details/${campaignId}`;
      } else {
        throw new Error('Failed to generate campaign plan');
      }
    } catch (error) {
      console.error('Error generating campaign plan:', error);
      const msg = error instanceof Error ? error.message : 'Error generating campaign plan. Please try again.';
      setPlanGenerationError(msg);
      notify('error', 'Error generating campaign plan. Please try again.');
    } finally {
      setIsLoading(false);
      setPlanGenerationStartedAt(null);
    }
  };

  // Check if campaign plan exists and load description
  const checkExistingPlan = async (campaignId: string) => {
    try {
      const response = await fetch(`/api/campaigns/get-weekly-plans?campaignId=${campaignId}`);
      if (response.ok) {
        const data = await response.json();
        console.log('Weekly plans data received:', data);
        const hasPlan = data && data.length > 0;
        setHasExistingPlan(hasPlan);
        
        if (hasPlan) {
          // Generate description from weekly plans
          const description = generatePlanDescription(data);
          console.log('Generated plan description:', description);
          setPlanDescription(description);
        } else {
          setPlanDescription('');
        }
      }
    } catch (error) {
      console.error('Error checking existing plan:', error);
      setHasExistingPlan(false);
      setPlanDescription('');
    }
  };

  const fetchStrategyStatus = async (id: string) => {
    setIsStrategyStatusLoading(true);
    try {
      const response = await fetchWithAuth(`/api/campaigns/${id}/strategy-status`);
      if (!response.ok) {
        setStrategyStatus(null);
        return;
      }
      const data = await response.json();
      setStrategyStatus(data?.status ?? null);
    } catch (error) {
      console.error('Error loading strategy status:', error);
      setStrategyStatus(null);
    } finally {
      setIsStrategyStatusLoading(false);
    }
  };

  const fetchReapprovalStatus = async (id: string) => {
    try {
      const response = await fetchWithAuth(`/api/campaigns/${id}/reapproval-status`);
      if (!response.ok) {
        setReapprovalStatus(null);
        return;
      }
      const data = await response.json();
      setReapprovalStatus(data);
    } catch (error) {
      console.error('Error loading reapproval status:', error);
      setReapprovalStatus(null);
    }
  };

  const fetchAiImprovements = async (id: string) => {
    setIsAiImprovementsLoading(true);
    setAiImprovementsError(null);
    try {
      const response = await fetchWithAuth(`/api/campaigns/${id}/ai-improvements`);
      if (!response.ok) {
        setAiImprovements([]);
        setAiImprovementsError('Failed to load AI suggestions.');
        setAiSuggestionContext(null);
        return;
      }
      const data = await response.json();
      setAiImprovements(Array.isArray(data?.improvements) ? data.improvements : []);
      setAiSuggestionContext(data?.context ?? null);
    } catch (error) {
      console.error('Error loading AI suggestions:', error);
      setAiImprovements([]);
      setAiImprovementsError('Failed to load AI suggestions.');
      setAiSuggestionContext(null);
    } finally {
      setIsAiImprovementsLoading(false);
    }
  };

  const fetchForecastVsActual = async (id: string) => {
    setIsForecastLoading(true);
    setForecastError(null);
    try {
      const response = await fetchWithAuth(`/api/campaigns/${id}/forecast-vs-actual`);
      if (!response.ok) {
        setForecastVsActual(null);
        setForecastError('Failed to load forecast accuracy.');
        return;
      }
      const data = await response.json();
      setForecastVsActual(data || null);
    } catch (error) {
      console.error('Error loading forecast accuracy:', error);
      setForecastVsActual(null);
      setForecastError('Failed to load forecast accuracy.');
    } finally {
      setIsForecastLoading(false);
    }
  };

  const fetchOptimizationAdvice = async (id: string) => {
    setIsOptimizationLoading(true);
    setOptimizationError(null);
    try {
      const response = await fetchWithAuth(`/api/campaigns/${id}/optimization-advice`);
      if (!response.ok) {
        setOptimizationAdvice(null);
        setOptimizationError('Failed to load optimization advice.');
        return;
      }
      const data = await response.json();
      setOptimizationAdvice(data || null);
    } catch (error) {
      console.error('Error loading optimization advice:', error);
      setOptimizationAdvice(null);
      setOptimizationError('Failed to load optimization advice.');
    } finally {
      setIsOptimizationLoading(false);
    }
  };

  const fetchViralTopicMemory = async (id: string) => {
    setIsViralTopicLoading(true);
    setViralTopicError(null);
    try {
      const response = await fetchWithAuth(`/api/campaigns/${id}/viral-topic-memory`);
      if (!response.ok) {
        setViralTopicMemory(null);
        setViralTopicError('Failed to load viral topic memory.');
        return;
      }
      const data = await response.json();
      setViralTopicMemory(data || null);
    } catch (error) {
      console.error('Error loading viral topic memory:', error);
      setViralTopicMemory(null);
      setViralTopicError('Failed to load viral topic memory.');
    } finally {
      setIsViralTopicLoading(false);
    }
  };

  const fetchLeadConversionIntel = async (id: string) => {
    setIsLeadIntelLoading(true);
    setLeadIntelError(null);
    try {
      const response = await fetchWithAuth(`/api/campaigns/${id}/lead-conversion-intelligence`);
      if (!response.ok) {
        setLeadConversionIntel(null);
        setLeadIntelError('Failed to load lead conversion intelligence.');
        return;
      }
      const data = await response.json();
      setLeadConversionIntel(data || null);
    } catch (error) {
      console.error('Error loading lead conversion intelligence:', error);
      setLeadConversionIntel(null);
      setLeadIntelError('Failed to load lead conversion intelligence.');
    } finally {
      setIsLeadIntelLoading(false);
    }
  };

  const fetchMomentumData = async (id: string) => {
    setIsMomentumLoading(true);
    setMomentumError(null);
    try {
      const response = await fetchWithAuth(`/api/campaigns/${id}/momentum-amplifier`);
      if (!response.ok) {
        setMomentumData(null);
        setMomentumError('Failed to load momentum insights.');
        return;
      }
      const data = await response.json();
      setMomentumData(data || null);
    } catch (error) {
      console.error('Error loading momentum insights:', error);
      setMomentumData(null);
      setMomentumError('Failed to load momentum insights.');
    } finally {
      setIsMomentumLoading(false);
    }
  };

  const fetchPlatformAdvice = async (id: string) => {
    setIsPlatformAdviceLoading(true);
    setPlatformAdviceError(null);
    try {
      const response = await fetchWithAuth(`/api/campaigns/${id}/platform-allocation-advice`);
      if (!response.ok) {
        setPlatformAdvice(null);
        setPlatformAdviceError('Failed to load platform allocation advice.');
        return;
      }
      const data = await response.json();
      setPlatformAdvice(data || null);
    } catch (error) {
      console.error('Error loading platform allocation advice:', error);
      setPlatformAdvice(null);
      setPlatformAdviceError('Failed to load platform allocation advice.');
    } finally {
      setIsPlatformAdviceLoading(false);
    }
  };

  const proposeFrequencyRebalance = async () => {
    if (!campaignId) return;
    setIsRebalanceLoading(true);
    setRebalanceError(null);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/propose-frequency-rebalance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        setRebalanceError(errorBody?.error || 'Failed to propose frequency rebalance.');
        return;
      }
      const data = await response.json();
      setRebalanceProposal(data || null);
      setRebalanceStatus('pending');
    } catch (error) {
      console.error('Error proposing rebalance:', error);
      setRebalanceError('Failed to propose frequency rebalance.');
    } finally {
      setIsRebalanceLoading(false);
    }
  };

  const approveFrequencyRebalance = async () => {
    if (!campaignId) return;
    setIsRebalanceLoading(true);
    setRebalanceError(null);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/approve-frequency-rebalance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        setRebalanceError(errorBody?.error || 'Failed to approve rebalance.');
        return;
      }
      await fetchPlatformAdvice(campaignId);
      setRebalanceStatus('approved');
    } catch (error) {
      console.error('Error approving rebalance:', error);
      setRebalanceError('Failed to approve rebalance.');
    } finally {
      setIsRebalanceLoading(false);
    }
  };

  const rejectFrequencyRebalance = async () => {
    if (!campaignId) return;
    setIsRebalanceLoading(true);
    setRebalanceError(null);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/reject-frequency-rebalance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rejection_reason: rebalanceRejectReason || null,
        }),
      });
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        setRebalanceError(errorBody?.error || 'Failed to reject rebalance.');
        return;
      }
      setRebalanceStatus('rejected');
      setShowRebalanceRejectModal(false);
      setRebalanceRejectReason('');
    } catch (error) {
      console.error('Error rejecting rebalance:', error);
      setRebalanceError('Failed to reject rebalance.');
    } finally {
      setIsRebalanceLoading(false);
    }
  };

  const toggleSuggestionDetails = (id: string) => {
    setExpandedSuggestionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSuggestionSelection = (id: string) => {
    setSelectedSuggestionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const reviseStrategyFromSuggestions = async () => {
    if (!campaignId) return;
    if (selectedSuggestionIds.size === 0) {
      notify('info', 'Select at least one suggestion to revise the strategy.');
      return;
    }
    setIsRevisingStrategy(true);
    setReviseError(null);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/revise-strategy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selected_improvement_ids: Array.from(selectedSuggestionIds),
        }),
      });
      if (!response.ok) {
        setReviseError('Failed to revise strategy.');
        return;
      }
      setSelectedSuggestionIds(new Set());
      await fetchStrategyStatus(campaignId);
      await fetchReapprovalStatus(campaignId);
    } catch (error) {
      console.error('Error revising strategy:', error);
      setReviseError('Failed to revise strategy.');
    } finally {
      setIsRevisingStrategy(false);
    }
  };

  const regenerateAlignedPreview = async () => {
    if (!alignedPreview?.recommendation_id) return;
    try {
      setAlignedPreviewError(null);
      const response = await fetch(
        `/api/recommendations/${alignedPreview.recommendation_id}/preview-strategy`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            preview_overrides: {
              platform_mix: alignedPreview.platform_mix ?? [],
              content_mix: alignedPreview.content_mix ?? [],
              frequency_plan:
                alignedPreview.frequency_plan ??
                alignedPreview.content_frequency ??
                {},
              reuse_plan: alignedPreview.reuse_plan ?? [],
              narrative_direction: alignedPreview.narrative_direction ?? '',
            },
          }),
        }
      );
      if (!response.ok) {
        throw new Error('Failed to regenerate preview');
      }
      const data = await response.json();
      if (data?.preview) {
        const updated = {
          ...data.preview,
          recommendation_id: alignedPreview.recommendation_id,
          snapshot_hash: alignedPreview.snapshot_hash,
          content_frequency: data?.content_frequency ?? alignedPreview.content_frequency,
        };
        setAlignedPreview(updated);
        if (typeof window !== 'undefined' && alignedPreview.snapshot_hash) {
          window.sessionStorage.setItem(
            `recommendation_preview_${alignedPreview.snapshot_hash}`,
            JSON.stringify(updated)
          );
        }
      }
    } catch (error) {
      console.error('Error regenerating aligned preview:', error);
      setAlignedPreviewError('Failed to regenerate preview.');
    }
  };

  // Generate comprehensive description from weekly plans
  const generatePlanDescription = (weeklyPlans: any[]) => {
    if (!weeklyPlans || weeklyPlans.length === 0) return '';
    
    console.log('Generating description from weekly plans:', weeklyPlans);
    
    const phases = [...new Set(weeklyPlans.map(plan => plan.phase))];
    const themes = weeklyPlans.map(plan => plan.theme).filter(Boolean);
    const contentTypes = [...new Set(weeklyPlans.flatMap(plan => plan.contentTypes || []))];
    
    console.log('Extracted data:', { phases, themes, contentTypes });
    
    let description = `A comprehensive ${weeklyPlans.length}-week content marketing plan structured across ${phases.length} distinct phases: ${phases.join(', ')}.\n\n`;
    
    // Add phase breakdown
    description += `**Phase Breakdown:**\n`;
    phases.forEach(phase => {
      const phaseWeeks = weeklyPlans.filter(plan => plan.phase === phase);
      description += `• ${phase}: Weeks ${phaseWeeks.map(w => w.weekNumber).join(', ')} (${phaseWeeks.length} weeks)\n`;
    });
    
    description += `\n**Weekly Themes:**\n`;
    weeklyPlans.forEach(plan => {
      description += `• Week ${plan.weekNumber}: ${plan.theme || 'Content Focus'}`;
      if (plan.focusArea) {
        description += ` - ${plan.focusArea}`;
      }
      description += `\n`;
    });
    
    if (contentTypes.length > 0) {
      description += `\n**Content Types:** ${contentTypes.join(', ')}\n`;
    }
    
    // Add key messaging summary
    const keyMessaging = weeklyPlans.map(plan => plan.keyMessaging).filter(Boolean);
    if (keyMessaging.length > 0) {
      description += `\n**Key Messaging Focus:**\n`;
      keyMessaging.slice(0, 5).forEach((msg, index) => {
        description += `• ${msg}\n`;
      });
    }
    
    // Add target metrics summary
    const totalMetrics = weeklyPlans.reduce((acc, plan) => {
      if (plan.targetMetrics) {
        acc.impressions += plan.targetMetrics.impressions || 0;
        acc.engagements += plan.targetMetrics.engagements || 0;
        acc.conversions += plan.targetMetrics.conversions || 0;
        acc.ugcSubmissions += plan.targetMetrics.ugcSubmissions || 0;
      }
      return acc;
    }, { impressions: 0, engagements: 0, conversions: 0, ugcSubmissions: 0 });
    
    if (totalMetrics.impressions > 0) {
      description += `\n**Target Metrics (campaign total):**\n`;
      description += `• Impressions: ${totalMetrics.impressions.toLocaleString()}\n`;
      description += `• Engagements: ${totalMetrics.engagements.toLocaleString()}\n`;
      description += `• Conversions: ${totalMetrics.conversions.toLocaleString()}\n`;
      description += `• UGC Submissions: ${totalMetrics.ugcSubmissions.toLocaleString()}\n`;
    }
    
    console.log('Final generated description:', description);
    return description;
  };

  const loadExistingCampaign = async () => {
    setIsLoading(true);
    try {
      console.log('Checking for existing campaigns...');
      const response = await fetch('/api/campaigns/list');
      
      if (response.ok) {
        const result = await response.json();
        console.log('Campaigns list response:', result);
        
        if (result.success && result.campaigns && result.campaigns.length > 0) {
          // If there's exactly one campaign, load it automatically
          if (result.campaigns.length === 1) {
            const campaign = result.campaigns[0];
            console.log('Found single campaign, loading:', campaign.id);
            setCampaignId(campaign.id);
            setCampaignData(prev => ({
              ...prev,
              id: campaign.id,
              name: campaign.name || 'Campaign ' + campaign.id,
              description: campaign.description || '',
              timeframe: 'quarter',
              startDate: '',
              endDate: '',
              goals: []
            }));
          } else {
            console.log('Multiple campaigns found, user needs to select one');
          }
        } else {
          console.log('No campaigns found');
        }
      } else {
        console.error('Failed to fetch campaigns list:', response.status);
      }
    } catch (error) {
      console.error('Error checking for existing campaigns:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadCampaign = async (id: string) => {
    setIsLoading(true);
    try {
      // Always set the campaign ID from URL params first
      console.log('Setting campaign ID from URL:', id);
      setCampaignId(id);
      const companyId = typeof window !== 'undefined'
        ? (new URLSearchParams(window.location.search).get('companyId') || '')
        : undefined;
      const campaignsUrl = companyId
        ? `/api/campaigns?type=campaign&campaignId=${id}&companyId=${encodeURIComponent(companyId)}`
        : `/api/campaigns?type=campaign&campaignId=${id}`;
      const response = await fetchWithAuth(campaignsUrl);
      console.log('Campaign API response status:', response.status);
      
      if (response.ok) {
        const result = await response.json();
        console.log('Campaign data received:', result);
        
        setCampaignData(prev => ({
          ...prev,
          id: result.campaign.id || id,
          name: result.campaign.name || 'Loading...',
          description: result.campaign.description || '',
          timeframe: result.campaign.timeframe || 'quarter',
          startDate: result.campaign.start_date || '',
          endDate: result.campaign.end_date || ''
        }));
        
        console.log('Campaign data set:', {
          name: result.campaign.name,
          description: result.campaign.description,
          startDate: result.campaign.start_date,
          endDate: result.campaign.end_date
        });
        
        // Check if campaign plan exists
        await checkExistingPlan(id);

        // Load goals (include companyId if available for API)
        const goalsUrl = companyId
          ? `/api/campaigns?type=goals&campaignId=${id}&companyId=${encodeURIComponent(companyId)}`
          : `/api/campaigns?type=goals&campaignId=${id}`;
        const goalsResponse = await fetchWithAuth(goalsUrl);
        if (goalsResponse.ok) {
          const goalsResult = await goalsResponse.json();
          setCampaignData(prev => ({
            ...prev,
            goals: goalsResult.goals.map((goal: any) => ({
              id: goal.id,
              contentType: goal.contentType,
              quantity: goal.quantity.toString(),
              platform: goal.platform,
              timeline: goal.frequency,
              priority: 'medium'
            }))
          }));
        }
      }
      } catch (error) {
        console.error('Error loading campaign:', error);
        // Set basic campaign data even if API fails
        setCampaignData(prev => ({
          ...prev,
          id: id,
          name: 'Campaign ' + id,
          description: '',
          timeframe: 'quarter',
          startDate: '',
          endDate: ''
        }));
      } finally {
        setIsLoading(false);
      }
    };

  const contentTypes = [
    { value: 'article', label: 'Article', icon: FileText, color: 'from-blue-500 to-cyan-600' },
    { value: 'video', label: 'Video', icon: Video, color: 'from-purple-500 to-violet-600' },
    { value: 'image', label: 'Image Post', icon: Image, color: 'from-green-500 to-emerald-600' },
    { value: 'podcast', label: 'Podcast', icon: Mic, color: 'from-orange-500 to-red-600' },
    { value: 'infographic', label: 'Infographic', icon: TrendingUp, color: 'from-pink-500 to-rose-600' }
  ];

  const platforms = [
    { value: 'linkedin', label: 'LinkedIn', color: 'bg-blue-600' },
    { value: 'twitter', label: 'Twitter', color: 'bg-sky-500' },
    { value: 'instagram', label: 'Instagram', color: 'bg-pink-500' },
    { value: 'youtube', label: 'YouTube', color: 'bg-red-600' },
    { value: 'facebook', label: 'Facebook', color: 'bg-blue-700' },
    { value: 'tiktok', label: 'TikTok', color: 'bg-black' }
  ];

  const priorities = [
    { value: 'high', label: 'High', color: 'from-red-500 to-pink-600' },
    { value: 'medium', label: 'Medium', color: 'from-yellow-500 to-orange-600' },
    { value: 'low', label: 'Low', color: 'from-green-500 to-emerald-600' }
  ];

  const addGoal = async () => {
    if (newGoal.contentType && newGoal.quantity && newGoal.platform && newGoal.timeline && campaignId) {
      try {
        const response = await fetch('/api/campaigns', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'goal',
            data: {
              campaignId,
              contentType: newGoal.contentType,
              platform: newGoal.platform,
              quantity: parseInt(newGoal.quantity),
              frequency: newGoal.timeline,
              targetAudience: 'General',
              objectives: ['Engagement', 'Reach'],
              metrics: {
                engagement: 0,
                reach: 0,
                conversions: 0
              }
            }
          })
        });

        if (response.ok) {
          const result = await response.json();
          setCampaignData({
            ...campaignData,
            goals: [...campaignData.goals, { ...newGoal, id: result.goal.id }]
          });
          setNewGoal({
            contentType: '',
            quantity: '',
            platform: '',
            timeline: '',
            priority: 'medium'
          });
        }
      } catch (error) {
        console.error('Error adding goal:', error);
      }
    }
  };

  const removeGoal = async (id: number) => {
    try {
      const response = await fetch('/api/campaigns', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'goal',
          id: id.toString()
        })
      });

      if (response.ok) {
        setCampaignData({
          ...campaignData,
          goals: campaignData.goals.filter(goal => goal.id !== id)
        });
      }
    } catch (error) {
      console.error('Error removing goal:', error);
    }
  };

  const saveCampaign = async () => {
    if (!campaignId) return;
    
    try {
      const response = await fetch('/api/campaigns', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'campaign',
          data: {
            id: campaignId,
            name: campaignData.name,
            description: campaignData.description,
            timeframe: campaignData.timeframe,
            startDate: campaignData.startDate,
            endDate: campaignData.endDate
          }
        })
      });

      if (response.ok) {
        console.log('Campaign saved successfully');
      }
    } catch (error) {
      console.error('Error saving campaign:', error);
    }
  };

  const continueToMarketAnalysis = async () => {
    if (!campaignId) return;
    
    // Save campaign data first
    await saveCampaign();
    
    // Transition to market analysis stage
    try {
      const response = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'stage-transition',
          data: {
            campaignId,
            fromStage: 'planning',
            toStage: 'market-analysis',
            stageData: {
              goals: campaignData.goals,
              campaignDetails: campaignData,
              aiProgram
            }
          }
        })
      });

      if (response.ok) {
        // Navigate to market analysis with campaign ID
        window.location.href = `/market-analysis?campaignId=${campaignId}`;
      }
    } catch (error) {
      console.error('Error transitioning stage:', error);
    }
  };

  const captureAIProgram = (programData: any) => {
    setAiProgram(programData);
    setShowProgramCapture(true);
  };

  const organizeProgramIntoGoals = () => {
    if (!aiProgram) return;

    // Convert AI program into structured goals
    const goals = [];
    
    // Parse campaign program structure
    if (aiProgram.weeks) {
      aiProgram.weeks.forEach((week: any, index: number) => {
        if (week.content) {
          week.content.forEach((content: any) => {
            goals.push({
              contentType: content.type || 'post',
              quantity: '1',
              platform: content.platform || 'linkedin',
              timeline: `Week ${index + 1}`,
              priority: content.priority || 'medium',
              description: content.description || content.topic || '',
              aiGenerated: true,
              weekNumber: index + 1
            });
          });
        }
      });
    }

    // Add goals to campaign
    goals.forEach(goal => {
      setNewGoal(goal);
      addGoal();
    });

    setShowProgramCapture(false);
  };

  const openDailyPlanning = (week: any) => {
    if (!campaignId) return;
    const params = new URLSearchParams();
    params.set('week', String(week?.weekNumber || '1'));
    router.push(`/campaign-calendar/${campaignId}?${params.toString()}`);
  };

  const getContentTypeIcon = (type: string) => {
    const contentType = contentTypes.find(ct => ct.value === type);
    return contentType ? contentType.icon : FileText;
  };

  const getContentTypeColor = (type: string) => {
    const contentType = contentTypes.find(ct => ct.value === type);
    return contentType ? contentType.color : 'from-gray-500 to-slate-600';
  };

  const getPlatformColor = (platform: string) => {
    const platformData = platforms.find(p => p.value === platform);
    return platformData ? platformData.color : 'bg-gray-500';
  };

  const getPriorityColor = (priority: string) => {
    const priorityData = priorities.find(p => p.value === priority);
    return priorityData ? priorityData.color : 'from-gray-500 to-slate-600';
  };


  return {
    accuracyPct,
    activePlanningTab,
    addGoal,
    aiImprovements,
    aiImprovementsError,
    aiProgram,
    aiSuggestionContext,
    alignedPreview,
    alignedPreviewError,
    approveFrequencyRebalance,
    campaignData,
    campaignId,
    captureAIProgram,
    checkExistingPlan,
    contentTypes,
    continueToMarketAnalysis,
    createNewCampaign,
    expandedSuggestionIds,
    fetchAiImprovements,
    fetchForecastVsActual,
    fetchLeadConversionIntel,
    fetchMomentumData,
    fetchOptimizationAdvice,
    fetchPlatformAdvice,
    fetchReapprovalStatus,
    fetchStrategyStatus,
    fetchViralTopicMemory,
    forecastDelta,
    forecastError,
    forecastVsActual,
    generate12WeekPlan,
    generatePlanDescription,
    getContentTypeColor,
    getContentTypeIcon,
    getPlatformColor,
    getPriorityColor,
    groupedContext,
    hasExistingPlan,
    isAiImprovementsLoading,
    isChatOpen,
    isDraftMode,
    isEditMode,
    isForecastLoading,
    isLeadIntelLoading,
    isLoading,
    isMomentumLoading,
    isOptimizationLoading,
    isPlatformAdviceLoading,
    isRebalanceLoading,
    isRevisingStrategy,
    isStrategyLocked,
    isStrategyProposed,
    isStrategyStatusLoading,
    isViralTopicLoading,
    leadConversionIntel,
    leadIntelError,
    loadCampaign,
    loadExistingCampaign,
    momentumData,
    momentumError,
    newGoal,
    notice,
    notify,
    openDailyPlanning,
    optimizationAdvice,
    optimizationError,
    organizeProgramIntoGoals,
    planDescription,
    planGenerationError,
    planGenerationStartedAt,
    platformAccuracyEntries,
    platformAdvice,
    platformAdviceEntries,
    platformAdviceError,
    platformSortMode,
    platforms,
    priorities,
    programStartDate,
    proposeFrequencyRebalance,
    reapprovalStatus,
    rebalanceError,
    rebalanceProposal,
    rebalanceRejectReason,
    rebalanceStatus,
    recommendationContext,
    recommendationHash,
    regenerateAlignedPreview,
    rejectFrequencyRebalance,
    removeGoal,
    reviseError,
    reviseStrategyFromSuggestions,
    router,
    saveCampaign,
    selectedSuggestionIds,
    setActivePlanningTab,
    setAiImprovements,
    setAiImprovementsError,
    setAiProgram,
    setAiSuggestionContext,
    setAlignedPreview,
    setAlignedPreviewError,
    setCampaignData,
    setCampaignId,
    setExpandedSuggestionIds,
    setForecastError,
    setForecastVsActual,
    setGroupedContext,
    setHasExistingPlan,
    setIsAiImprovementsLoading,
    setIsChatOpen,
    setIsForecastLoading,
    setIsLeadIntelLoading,
    setIsLoading,
    setIsMomentumLoading,
    setIsOptimizationLoading,
    setIsPlatformAdviceLoading,
    setIsRebalanceLoading,
    setIsRevisingStrategy,
    setIsStrategyStatusLoading,
    setIsViralTopicLoading,
    setLeadConversionIntel,
    setLeadIntelError,
    setMomentumData,
    setMomentumError,
    setNewGoal,
    setNotice,
    setOptimizationAdvice,
    setOptimizationError,
    setPlanDescription,
    setPlatformAdvice,
    setPlatformAdviceError,
    setPlatformSortMode,
    setProgramStartDate,
    setReapprovalStatus,
    setRebalanceError,
    setRebalanceProposal,
    setRebalanceRejectReason,
    setRebalanceStatus,
    setRecommendationContext,
    setRecommendationHash,
    setReviseError,
    setSelectedSuggestionIds,
    setShowProgramCapture,
    setShowRebalanceRationale,
    setShowRebalanceRejectModal,
    setShowWeeklyRefinement,
    setStableThemesOpen,
    setStrategyStatus,
    setViralTopicError,
    setViralTopicMemory,
    showProgramCapture,
    showRebalanceRationale,
    showRebalanceRejectModal,
    showWeeklyRefinement,
    stableThemesOpen,
    strategyStatus,
    toggleSuggestionDetails,
    toggleSuggestionSelection,
    viralTopicError,
    viralTopicMemory,
  };
}
