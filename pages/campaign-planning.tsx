import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { v4 as uuidv4 } from 'uuid';
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

export default function CampaignPlanning() {
  const router = useRouter();
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
      console.log('Create mode - starting fresh campaign');
      // Don't load any existing campaign, start fresh
      setCampaignId(null);
      setCampaignData({
        id: '',
        name: 'New Campaign',
        timeframe: 'quarter',
        startDate: '',
        endDate: '',
        description: '',
        goals: []
      });
      // Clear any existing campaign data and stop loading
      setIsLoading(false);
      console.log('Create mode initialized - campaignId:', null, 'campaignData:', {
        id: '',
        name: 'New Campaign',
        timeframe: 'quarter',
        startDate: '',
        endDate: '',
        description: '',
        goals: []
      });
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
      const newCampaignId = uuidv4();
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
      notify('error', 'Error generating campaign plan. Please try again.');
    } finally {
      setIsLoading(false);
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
        ? (new URLSearchParams(window.location.search).get('companyId') || window.localStorage.getItem('selected_company_id') || window.localStorage.getItem('company_id'))
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50">
      {notice && (
        <div className="max-w-7xl mx-auto px-6 pt-4">
          <div
            className={`rounded-lg border px-3 py-2 text-sm ${
              notice.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : notice.type === 'error' ? 'border-red-200 bg-red-50 text-red-800'
                : 'border-indigo-200 bg-indigo-50 text-indigo-800'
            }`}
            role="status"
            aria-live="polite"
          >
            {notice.message}
          </div>
        </div>
      )}
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-sm border-b border-gray-200/50 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button 
                onClick={() => window.location.href = '/'}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ArrowLeft className="h-5 w-5 text-gray-600" />
              </button>
              <div>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
                  {isEditMode && campaignData?.name ? `Editing: ${campaignData.name}` : 'Campaign Planning'}
                </h1>
                {isEditMode && campaignId && (
                  <p className="text-xs text-gray-500 font-mono mt-0.5">ID: {campaignId}</p>
                )}
                <p className="text-gray-600 mt-1">
                  {isEditMode && campaignId ? 'Edit this campaign\'s structure, goals, and content' : 'Define your campaign structure and content goals'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {(() => {
                const mode = (router.query?.mode as string) || null;
                
                if (mode === 'create') {
                  // Create mode buttons
                  return (
                    <>
                      <button 
                        onClick={createNewCampaign}
                        disabled={isLoading}
                        className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white px-6 py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 flex items-center gap-2"
                      >
                        {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
                        Create New Campaign
                      </button>
                      
                      {campaignId && (
                        <>
                          <button 
                            onClick={saveCampaign}
                            disabled={isLoading}
                            className="px-4 py-2 text-gray-600 hover:text-gray-900 font-medium transition-colors disabled:opacity-50"
                          >
                            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save Draft'}
                          </button>
                          
                          <button 
                            onClick={generate12WeekPlan}
                            disabled={isLoading || isStrategyLocked || isStrategyStatusLoading}
                            className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors shadow-md flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <Calendar className="h-4 w-4" />
                            Generate Campaign Plan
                          </button>
                          
                          <button 
                            onClick={() => window.location.href = `/campaign-details/${campaignId}`}
                            className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white px-6 py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 flex items-center gap-2"
                          >
                            <Target className="h-5 w-5" />
                            View Campaign Details
                          </button>
                        </>
                      )}
                    </>
                  );
                } else {
                  // Default mode - show create button
                  return (
                    <button 
                      onClick={createNewCampaign}
                      disabled={isLoading}
                      className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white px-6 py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 flex items-center gap-2"
                    >
                      {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
                      Create New Campaign
                    </button>
                  );
                }
              })()}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {recommendationContext && (
          <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-900">
            Generated from shortlisted recommendation.
          </div>
        )}
        {typeof window !== 'undefined' &&
          new URLSearchParams(window.location.search).get('mode') === 'draft' && (
            <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
              Draft created from High-Priority Recommendation — requires Company Admin approval.
            </div>
          )}
        {reapprovalStatus?.status === 'reapproval_required' && (
          <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
            Strategy updated after approval — Company Admin re-approval required.
          </div>
        )}
        {isStrategyProposed && (
          <div className="mb-6 rounded-xl border border-blue-300 bg-blue-50 px-4 py-3 text-blue-900">
            Draft revision created — awaiting approval.
          </div>
        )}
        {recommendationContext && (
          <div className="mb-6 rounded-2xl border border-gray-200 bg-white/80 p-6 shadow-lg">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">
              Recommendation Context
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-700">
              <div>
                <div className="text-xs text-gray-500">Trend Topic</div>
                <div className="font-medium text-gray-900">
                  {recommendationContext.trend_topic || '—'}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Confidence</div>
                <div className="font-medium text-gray-900">
                  {recommendationContext.confidence ?? '—'}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Final Score</div>
                <div className="font-medium text-gray-900">
                  {recommendationContext.final_score ?? '—'}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Platform Mix</div>
                <div className="font-medium text-gray-900">
                  {Array.isArray(recommendationContext.platforms)
                    ? recommendationContext.platforms.join(', ')
                    : '—'}
                </div>
              </div>
              <div className="md:col-span-2">
                <div className="text-xs text-gray-500">Audience</div>
                <div className="font-medium text-gray-900 whitespace-pre-wrap">
                  {recommendationContext.audience ? JSON.stringify(recommendationContext.audience) : '—'}
                </div>
              </div>
              <div className="md:col-span-2">
                <div className="text-xs text-gray-500">Scores</div>
                <div className="font-medium text-gray-900 whitespace-pre-wrap">
                  {recommendationContext.scores ? JSON.stringify(recommendationContext.scores) : '—'}
                </div>
              </div>
            </div>
            {recommendationHash && (
              <div className="mt-3 text-xs text-gray-500">Snapshot: {recommendationHash}</div>
            )}
          </div>
        )}
        {groupedContext && (
          <div className="mb-6 rounded-2xl border border-indigo-200 bg-white/90 p-6 shadow-lg">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Trend Groups</h3>
            <div className="text-sm text-gray-700 space-y-3">
              {(groupedContext.groups || []).map((group: any) => (
                <div key={group.group_id} className="rounded-lg border border-gray-200 p-3">
                  <div className="font-semibold text-gray-900">{group.theme_name || 'Group'}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    {Array.isArray(group.recommendations)
                      ? group.recommendations.join(', ')
                      : '—'}
                  </div>
                </div>
              ))}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-gray-600">
                <div>
                  <div className="text-[10px] text-gray-500">Suggested Platform Mix</div>
                  <div className="font-medium">
                    {Array.isArray(groupedContext.suggested_platform_mix)
                      ? groupedContext.suggested_platform_mix.join(', ')
                      : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-500">Suggested Frequency</div>
                  <div className="font-medium whitespace-pre-wrap">
                    {groupedContext.suggested_frequency
                      ? JSON.stringify(groupedContext.suggested_frequency, null, 2)
                      : '—'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        {isDraftMode && alignedPreview && (
          <div className="mb-6 rounded-2xl border border-emerald-200 bg-white/90 p-6 shadow-lg">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Aligned Strategy Inputs</h3>
              <button
                type="button"
                onClick={regenerateAlignedPreview}
                className="px-3 py-2 text-xs rounded-lg bg-emerald-600 text-white"
              >
                Regenerate campaign plan using updated inputs
              </button>
            </div>
            {alignedPreviewError && (
              <div className="mb-3 text-sm text-red-600">{alignedPreviewError}</div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-700">
              <div className="md:col-span-2">
                <label className="block text-xs text-gray-500">Platform Mix</label>
                <input
                  value={Array.isArray(alignedPreview.platform_mix) ? alignedPreview.platform_mix.join(', ') : ''}
                  onChange={(event) =>
                    setAlignedPreview((prev: any) => ({
                      ...(prev || {}),
                      platform_mix: event.target.value
                        .split(',')
                        .map((value) => value.trim())
                        .filter(Boolean),
                    }))
                  }
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs text-gray-500">Content Mix</label>
                <input
                  value={Array.isArray(alignedPreview.content_mix) ? alignedPreview.content_mix.join(', ') : ''}
                  onChange={(event) =>
                    setAlignedPreview((prev: any) => ({
                      ...(prev || {}),
                      content_mix: event.target.value
                        .split(',')
                        .map((value) => value.trim())
                        .filter(Boolean),
                    }))
                  }
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs text-gray-500">Weekly Frequency (JSON)</label>
                <textarea
                  value={
                    alignedPreview.frequency_plan
                      ? JSON.stringify(alignedPreview.frequency_plan, null, 2)
                      : ''
                  }
                  onChange={(event) => {
                    try {
                      const next = event.target.value ? JSON.parse(event.target.value) : {};
                      setAlignedPreview((prev: any) => ({
                        ...(prev || {}),
                        frequency_plan: next,
                      }));
                    } catch {
                      // keep user input without updating parsed state
                    }
                  }}
                  rows={4}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs text-gray-500">Reuse Strategy</label>
                <input
                  value={Array.isArray(alignedPreview.reuse_plan) ? alignedPreview.reuse_plan.join(', ') : ''}
                  onChange={(event) =>
                    setAlignedPreview((prev: any) => ({
                      ...(prev || {}),
                      reuse_plan: event.target.value
                        .split(',')
                        .map((value) => value.trim())
                        .filter(Boolean),
                    }))
                  }
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs text-gray-500">Narrative Direction</label>
                <textarea
                  value={alignedPreview.narrative_direction || ''}
                  onChange={(event) =>
                    setAlignedPreview((prev: any) => ({
                      ...(prev || {}),
                      narrative_direction: event.target.value,
                    }))
                  }
                  rows={3}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>
          </div>
        )}
        {isStrategyLocked && (
          <div className="mb-6 space-y-4">
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
              Strategy approved. Editing locked by Company Admin.
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white/80 p-6 shadow-lg">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <h3 className="text-lg font-semibold text-gray-900">
                  AI Suggestions (Read Only)
                </h3>
                <button
                  type="button"
                  onClick={reviseStrategyFromSuggestions}
                  disabled={isRevisingStrategy || selectedSuggestionIds.size === 0}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isRevisingStrategy ? 'Revising...' : 'Revise Strategy Using Selected Suggestions'}
                </button>
              </div>
              {reviseError && (
                <div className="mb-3 text-sm text-red-600">{reviseError}</div>
              )}
              {isAiImprovementsLoading && (
                <div className="text-sm text-gray-600">Loading AI suggestions...</div>
              )}
              {!isAiImprovementsLoading && aiImprovementsError && (
                <div className="text-sm text-red-600">{aiImprovementsError}</div>
              )}
              {!isAiImprovementsLoading && !aiImprovementsError && aiImprovements.length === 0 && (
                <div className="text-sm text-gray-600">No AI suggestions available.</div>
              )}
              {!isAiImprovementsLoading && !aiImprovementsError && aiImprovements.length > 0 && (
                <div className="space-y-3">
                  {aiImprovements.map((improvement) => (
                    <div
                      key={improvement.id}
                      className="rounded-xl border border-gray-200 bg-white px-4 py-3"
                    >
                      <label className="flex items-center gap-2 text-sm text-gray-700 mb-2">
                        <input
                          type="checkbox"
                          checked={selectedSuggestionIds.has(improvement.id)}
                          onChange={() => toggleSuggestionSelection(improvement.id)}
                        />
                        Select
                      </label>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 mb-2">
                        <span className="rounded-full bg-gray-100 px-2 py-1">
                          {improvement.improvement_type}
                        </span>
                        {typeof improvement.impact_score === 'number' && (
                          <span className="rounded-full bg-purple-100 px-2 py-1 text-purple-700">
                            Impact {improvement.impact_score}
                          </span>
                        )}
                        <span className="rounded-full bg-blue-100 px-2 py-1 text-blue-700">
                          {improvement.implementation_status || 'pending'}
                        </span>
                        {aiSuggestionContext?.enhancement?.ai_provider && (
                          <span className="rounded-full bg-gray-200 px-2 py-1 text-gray-700">
                            Model {aiSuggestionContext.enhancement.ai_provider}
                          </span>
                        )}
                        {typeof aiSuggestionContext?.enhancement?.confidence_score === 'number' && (
                          <span className="rounded-full bg-emerald-100 px-2 py-1 text-emerald-700">
                            Confidence {aiSuggestionContext.enhancement.confidence_score}
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-gray-800 whitespace-pre-wrap">
                        {improvement.suggestion}
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleSuggestionDetails(improvement.id)}
                        className="mt-3 text-sm text-indigo-600 hover:text-indigo-700"
                      >
                        Why suggested?
                      </button>
                      {expandedSuggestionIds.has(improvement.id) && (
                        <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 space-y-2">
                          {aiSuggestionContext?.enhancement?.improvement_notes && (
                            <div>
                              <div className="font-medium text-gray-800 mb-1">
                                Improvement notes
                              </div>
                              <div className="whitespace-pre-wrap">
                                {aiSuggestionContext.enhancement.improvement_notes}
                              </div>
                            </div>
                          )}
                          {(aiSuggestionContext?.learning?.performance ||
                            aiSuggestionContext?.learning?.metrics) && (
                            <div>
                              <div className="font-medium text-gray-800 mb-1">
                                Recent performance and metrics
                              </div>
                              <div className="space-y-1">
                                {aiSuggestionContext?.learning?.performance &&
                                  Object.entries(aiSuggestionContext.learning.performance)
                                    .slice(0, 6)
                                    .map(([key, value]) => (
                                      <div key={`perf-${key}`}>
                                        {key}: {String(value)}
                                      </div>
                                    ))}
                                {aiSuggestionContext?.learning?.metrics &&
                                  Object.entries(aiSuggestionContext.learning.metrics)
                                    .slice(0, 6)
                                    .map(([key, value]) => (
                                      <div key={`metric-${key}`}>
                                        {key}: {String(value)}
                                      </div>
                                    ))}
                              </div>
                            </div>
                          )}
                          {!aiSuggestionContext?.enhancement?.improvement_notes &&
                            !aiSuggestionContext?.learning?.performance &&
                            !aiSuggestionContext?.learning?.metrics && (
                              <div className="text-gray-600">
                                No additional context available.
                              </div>
                            )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        {campaignId && (
          <div className="mb-6 rounded-2xl border border-gray-200 bg-white/80 p-6 shadow-lg">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Prediction Accuracy</h3>
            </div>
            {isForecastLoading && (
              <div className="text-sm text-gray-600">Loading prediction accuracy...</div>
            )}
            {!isForecastLoading && forecastError && (
              <div className="text-sm text-red-600">{forecastError}</div>
            )}
            {!isForecastLoading && !forecastError && !forecastVsActual && (
              <div className="text-sm text-gray-600">No prediction accuracy data available.</div>
            )}
            {!isForecastLoading && !forecastError && forecastVsActual && (
              <div className="space-y-3 text-sm text-gray-700">
                <div className="flex flex-wrap items-center gap-3">
                  {typeof accuracyPct === 'number' && (
                    <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-700 text-xs">
                      Accuracy {accuracyPct.toFixed(0)}%
                    </span>
                  )}
                  {forecastDelta && (
                    <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700">
                      {forecastDelta.value >= 0 ? 'Over-performed' : 'Under-performed'}{' '}
                      {Math.abs(forecastDelta.value).toFixed(1)}% ({forecastDelta.label})
                    </span>
                  )}
                </div>
                {platformAccuracyEntries.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-gray-600 mb-2">Platform insights</div>
                    <div className="flex flex-wrap gap-2 text-xs">
                      {platformAccuracyEntries.map(([platform, stats]) => {
                        const s = stats as { share_pct?: number; clicks?: number } | undefined;
                        return (
                          <span
                            key={platform}
                            className="rounded-full bg-indigo-50 px-3 py-1 text-indigo-700"
                          >
                            {platform}: {s?.share_pct ?? 0}% ({s?.clicks ?? 0} clicks)
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {campaignId && (
          <div className="mb-6 rounded-2xl border border-gray-200 bg-white/80 p-6 shadow-lg">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h3 className="text-lg font-semibold text-gray-900">AI Optimization Advice</h3>
            </div>
            {isOptimizationLoading && (
              <div className="text-sm text-gray-600">Loading optimization advice...</div>
            )}
            {!isOptimizationLoading && optimizationError && (
              <div className="text-sm text-red-600">{optimizationError}</div>
            )}
            {!isOptimizationLoading && !optimizationError && !optimizationAdvice && (
              <div className="text-sm text-gray-600">No optimization advice available.</div>
            )}
            {!isOptimizationLoading && !optimizationError && optimizationAdvice && (
              <div className="space-y-3 text-sm text-gray-700">
                {Array.isArray(optimizationAdvice.frequency_adjustment) &&
                  optimizationAdvice.frequency_adjustment.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-gray-600 mb-2">
                        Frequency adjustments
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs">
                        {optimizationAdvice.frequency_adjustment.slice(0, 4).map((item: any) => (
                          <span
                            key={`${item.platform}-freq`}
                            className="rounded-full bg-indigo-50 px-3 py-1 text-indigo-700"
                          >
                            {item.recommended_posts_per_week > item.current_posts_per_week
                              ? `Increase ${item.platform} to ${item.recommended_posts_per_week}/wk`
                              : item.recommended_posts_per_week < item.current_posts_per_week
                              ? `Reduce ${item.platform} to ${item.recommended_posts_per_week}/wk`
                              : `Maintain ${item.platform} at ${item.current_posts_per_week}/wk`}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                {Array.isArray(optimizationAdvice.platform_reallocation) &&
                  optimizationAdvice.platform_reallocation.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-gray-600 mb-2">
                        Platform effort signals
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs">
                        {optimizationAdvice.platform_reallocation.slice(0, 4).map((item: any) => (
                          <span
                            key={`${item.platform}-alloc`}
                            className="rounded-full bg-amber-50 px-3 py-1 text-amber-700"
                          >
                            {item.recommended_weight > item.current_weight
                              ? `Boost ${item.platform} allocation`
                              : item.recommended_weight < item.current_weight
                              ? `Reduce ${item.platform} effort`
                              : `Maintain ${item.platform} allocation`}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                {Array.isArray(optimizationAdvice.topic_cluster_boost) &&
                  optimizationAdvice.topic_cluster_boost.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-gray-600 mb-2">
                        Theme cluster focus
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs">
                        {optimizationAdvice.topic_cluster_boost.slice(0, 4).map((item: any) => (
                          <span
                            key={`${item.theme_name}-boost`}
                            className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700"
                          >
                            Boost {item.theme_name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                {platformAdviceEntries.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-gray-600 mb-2">
                      Platform click distribution
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs">
                      {platformAdviceEntries.map(([platform, stats]) => {
                        const s = stats as { share_pct?: number } | undefined;
                        return (
                          <span
                            key={`opt-${platform}`}
                            className="rounded-full bg-gray-100 px-3 py-1 text-gray-700"
                          >
                            {platform}: {s?.share_pct ?? 0}%
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {campaignId && (
          <div className="mb-6 rounded-2xl border border-gray-200 bg-white/80 p-6 shadow-lg">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Viral Topic Intelligence</h3>
            </div>
            {isViralTopicLoading && (
              <div className="text-sm text-gray-600">Loading viral topic intelligence...</div>
            )}
            {!isViralTopicLoading && viralTopicError && (
              <div className="text-sm text-red-600">{viralTopicError}</div>
            )}
            {!isViralTopicLoading && !viralTopicError && !viralTopicMemory && (
              <div className="text-sm text-gray-600">No viral topic intelligence available.</div>
            )}
            {!isViralTopicLoading && !viralTopicError && viralTopicMemory && (
              <div className="space-y-3 text-sm text-gray-700">
                {Array.isArray(viralTopicMemory.high_performing_clusters) &&
                  viralTopicMemory.high_performing_clusters.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-gray-600 mb-2">
                        Top repeatable themes
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs">
                        {viralTopicMemory.high_performing_clusters.slice(0, 5).map((item: any) => (
                          <span
                            key={`${item.theme_name}-repeat`}
                            className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700"
                          >
                            {item.theme_name} · {item.recommended_reuse_frequency || 'reuse cadence'}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                {Array.isArray(viralTopicMemory.declining_clusters) &&
                  viralTopicMemory.declining_clusters.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-gray-600 mb-2">
                        Declining themes
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs">
                        {viralTopicMemory.declining_clusters.slice(0, 5).map((item: any) => (
                          <span
                            key={`${item.theme_name}-decline`}
                            className="rounded-full bg-amber-50 px-3 py-1 text-amber-700"
                          >
                            {item.theme_name}: {item.suggested_action || 'refresh'}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                {Array.isArray(viralTopicMemory.high_performing_clusters) &&
                  viralTopicMemory.high_performing_clusters.length === 0 &&
                  Array.isArray(viralTopicMemory.declining_clusters) &&
                  viralTopicMemory.declining_clusters.length === 0 && (
                    <div className="text-sm text-gray-600">
                      No theme clusters detected yet.
                    </div>
                  )}
              </div>
            )}
          </div>
        )}
        {campaignId && (
          <div className="mb-6 rounded-2xl border border-gray-200 bg-white/80 p-6 shadow-lg">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Lead Conversion Intelligence</h3>
            </div>
            {isLeadIntelLoading && (
              <div className="text-sm text-gray-600">Loading lead conversion intelligence...</div>
            )}
            {!isLeadIntelLoading && leadIntelError && (
              <div className="text-sm text-red-600">{leadIntelError}</div>
            )}
            {!isLeadIntelLoading && !leadIntelError && !leadConversionIntel && (
              <div className="text-sm text-gray-600">No lead conversion intelligence available.</div>
            )}
            {!isLeadIntelLoading && !leadIntelError && leadConversionIntel && (
              <div className="space-y-3 text-sm text-gray-700">
                {Array.isArray(leadConversionIntel.top_converting_platforms) &&
                  leadConversionIntel.top_converting_platforms.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-gray-600 mb-2">
                        Top converting platforms
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs">
                        {leadConversionIntel.top_converting_platforms.slice(0, 5).map((item: any) => (
                          <span
                            key={`${item.platform}-convert`}
                            className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700"
                          >
                            {item.platform}: {item.recommendation}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                {Array.isArray(leadConversionIntel.high_intent_themes) &&
                  leadConversionIntel.high_intent_themes.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-gray-600 mb-2">
                        High intent themes
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs">
                        {leadConversionIntel.high_intent_themes.slice(0, 5).map((item: any) => (
                          <span
                            key={`${item.theme_name}-intent`}
                            className="rounded-full bg-indigo-50 px-3 py-1 text-indigo-700"
                          >
                            {item.theme_name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                {Array.isArray(leadConversionIntel.weak_conversion_areas) &&
                  leadConversionIntel.weak_conversion_areas.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-gray-600 mb-2">
                        Weak conversion areas
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs">
                        {leadConversionIntel.weak_conversion_areas.slice(0, 5).map((item: any) => (
                          <span
                            key={`${item.platform}-${item.theme_name}-weak`}
                            className="rounded-full bg-amber-50 px-3 py-1 text-amber-700"
                          >
                            {item.platform}: {item.theme_name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
              </div>
            )}
          </div>
        )}
        {campaignId && (
          <div className="mb-6 rounded-2xl border border-gray-200 bg-white/80 p-6 shadow-lg">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Campaign Momentum</h3>
            </div>
            {isMomentumLoading && (
              <div className="text-sm text-gray-600">Loading momentum insights...</div>
            )}
            {!isMomentumLoading && momentumError && (
              <div className="text-sm text-red-600">{momentumError}</div>
            )}
            {!isMomentumLoading && !momentumError && !momentumData && (
              <div className="text-sm text-gray-600">No momentum insights available.</div>
            )}
            {!isMomentumLoading && !momentumError && momentumData && (
              <div className="space-y-3 text-sm text-gray-700">
                <button
                  type="button"
                  onClick={() => setStableThemesOpen((prev) => !prev)}
                  className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700"
                >
                  <span>Stable Themes (Baseline Performance)</span>
                  <span className="flex items-center gap-2">
                    <span className="rounded-full bg-gray-200 px-2 py-1 text-[10px] text-gray-700">
                      Stable
                    </span>
                    <span className="text-xs text-gray-500">{stableThemesOpen ? 'Hide' : 'Show'}</span>
                  </span>
                </button>
                {stableThemesOpen && (
                  <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                    {Array.isArray(momentumData.stable_topics) &&
                    momentumData.stable_topics.length > 0 ? (
                      <div className="space-y-2 text-xs text-gray-700">
                        {momentumData.stable_topics.slice(0, 6).map((item: any) => (
                          <div
                            key={`${item.theme_name}-stable`}
                            className="flex flex-wrap items-center gap-3"
                          >
                            <span className="font-semibold text-gray-800">{item.theme_name}</span>
                            <span className="rounded-full bg-gray-100 px-2 py-1">
                              Baseline {item.baseline_clicks ?? 0}
                            </span>
                            <span className="rounded-full bg-gray-100 px-2 py-1">
                              Current {item.current_clicks ?? 0}
                            </span>
                            <span className="rounded-full bg-gray-100 px-2 py-1">
                              Stability {item.stability_score ?? 0}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-gray-500">No stable themes detected.</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {campaignId && (
          <div className="mb-6 rounded-2xl border border-gray-200 bg-white/80 p-6 shadow-lg">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Platform Investment Optimizer</h3>
              <div className="flex flex-wrap gap-2 text-xs">
                <button
                  onClick={() => setPlatformSortMode('roi')}
                  className={`px-3 py-1 rounded border ${
                    platformSortMode === 'roi' ? 'bg-indigo-600 text-white' : 'border-gray-300'
                  }`}
                >
                  Highest ROI
                </button>
                <button
                  onClick={() => setPlatformSortMode('growth')}
                  className={`px-3 py-1 rounded border ${
                    platformSortMode === 'growth' ? 'bg-indigo-600 text-white' : 'border-gray-300'
                  }`}
                >
                  Most Growth Potential
                </button>
                <button
                  onClick={() => setPlatformSortMode('reduce')}
                  className={`px-3 py-1 rounded border ${
                    platformSortMode === 'reduce' ? 'bg-indigo-600 text-white' : 'border-gray-300'
                  }`}
                >
                  Reduce Waste First
                </button>
              </div>
            </div>
            {isPlatformAdviceLoading && (
              <div className="text-sm text-gray-600">Loading platform investment advice...</div>
            )}
            {!isPlatformAdviceLoading && platformAdviceError && (
              <div className="text-sm text-red-600">{platformAdviceError}</div>
            )}
            {!isPlatformAdviceLoading && !platformAdviceError && !platformAdvice && (
              <div className="text-sm text-gray-600">No platform allocation advice available.</div>
            )}
            {!isPlatformAdviceLoading && !platformAdviceError && platformAdvice && (
              <div className="space-y-3 text-sm text-gray-700">
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm text-left text-gray-700">
                    <thead className="text-xs uppercase text-gray-500 border-b">
                      <tr>
                        <th className="px-3 py-2">Platform</th>
                        <th className="px-3 py-2">Recommendation</th>
                        <th className="px-3 py-2">Score</th>
                        <th className="px-3 py-2">Suggested Frequency</th>
                        <th className="px-3 py-2">Rationale</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(platformAdvice.platform_advice || [])
                        .slice()
                        .sort((a: any, b: any) => {
                          if (platformSortMode === 'growth') {
                            return (b.allocation_score ?? 0) - (a.allocation_score ?? 0);
                          }
                          if (platformSortMode === 'reduce') {
                            return (a.allocation_score ?? 0) - (b.allocation_score ?? 0);
                          }
                          return (b.allocation_score ?? 0) - (a.allocation_score ?? 0);
                        })
                        .map((item: any) => (
                          <tr key={item.platform} className="border-b">
                            <td className="px-3 py-2 font-medium">{item.platform}</td>
                            <td className="px-3 py-2">
                              <span
                                className={`rounded-full px-2 py-1 text-xs ${
                                  item.recommendation === 'Increase'
                                    ? 'bg-emerald-50 text-emerald-700'
                                    : item.recommendation === 'Reduce'
                                    ? 'bg-amber-50 text-amber-700'
                                    : 'bg-gray-100 text-gray-600'
                                }`}
                              >
                                {item.recommendation}
                              </span>
                            </td>
                            <td className="px-3 py-2">{item.allocation_score ?? 0}</td>
                            <td className="px-3 py-2">
                              {item.suggested_frequency_delta > 0
                                ? `+${item.suggested_frequency_delta}`
                                : item.suggested_frequency_delta < 0
                                ? `${item.suggested_frequency_delta}`
                                : '0'}
                            </td>
                            <td className="px-3 py-2 text-xs text-gray-600">{item.rationale}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
        {campaignId && (
          <div className="mb-6 rounded-2xl border border-gray-200 bg-white/80 p-6 shadow-lg">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h3 className="text-lg font-semibold text-gray-900">
                Recommended Platform Frequency Changes
              </h3>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={proposeFrequencyRebalance}
                  disabled={isRebalanceLoading}
                  className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-50"
                >
                  {isRebalanceLoading ? 'Preparing...' : 'Generate Proposal'}
                </button>
                <button
                  onClick={() => setShowRebalanceRationale((prev) => !prev)}
                  className="px-3 py-2 rounded-lg border border-gray-300 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  {showRebalanceRationale ? 'Hide Rationale' : 'View Rationale'}
                </button>
              </div>
            </div>
            {rebalanceError && <div className="text-sm text-red-600 mb-3">{rebalanceError}</div>}
            {rebalanceStatus === 'pending' && (
              <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Awaiting approval
              </div>
            )}
            {rebalanceStatus === 'approved' && (
              <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                Rebalance approved and applied.
              </div>
            )}
            {rebalanceStatus === 'rejected' && (
              <div className="mb-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
                Proposal rejected.
              </div>
            )}
            {!rebalanceProposal && !rebalanceStatus && (
              <div className="text-sm text-gray-600">
                Generate a proposal to review recommended platform frequency changes.
              </div>
            )}
            {rebalanceProposal && (
              <div className="space-y-3 text-sm text-gray-700">
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm text-left text-gray-700">
                    <thead className="text-xs uppercase text-gray-500 border-b">
                      <tr>
                        <th className="px-3 py-2">Platform</th>
                        <th className="px-3 py-2">Current</th>
                        <th className="px-3 py-2">Proposed</th>
                        <th className="px-3 py-2">Impact</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(rebalanceProposal.proposed_changes || []).map((item: any) => (
                        <tr key={`rebalance-${item.platform}`} className="border-b">
                          <td className="px-3 py-2 font-medium">{item.platform}</td>
                          <td className="px-3 py-2">{item.current_frequency}</td>
                          <td className="px-3 py-2">{item.recommended_frequency}</td>
                          <td className="px-3 py-2 text-xs text-gray-600">
                            {rebalanceProposal.impact_projection?.expected_reach_delta || '—'} reach /
                            {` ${rebalanceProposal.impact_projection?.expected_leads_delta || '—'} leads`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {showRebalanceRationale && (
                  <div className="space-y-2 text-xs text-gray-600">
                    {(rebalanceProposal.proposed_changes || []).map((item: any) => (
                      <div key={`reason-${item.platform}`}>
                        <span className="font-semibold text-gray-700">{item.platform}:</span>{' '}
                        {item.reason}
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={approveFrequencyRebalance}
                    disabled={isRebalanceLoading || rebalanceStatus === 'approved' || rebalanceStatus === 'rejected'}
                    className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-50"
                  >
                    Approve Changes
                  </button>
                  <button
                    onClick={() => setShowRebalanceRejectModal(true)}
                    disabled={isRebalanceLoading || rebalanceStatus === 'approved' || rebalanceStatus === 'rejected'}
                    className="px-3 py-2 rounded-lg border border-gray-300 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Campaign Details */}
          <div className="lg:col-span-2 space-y-6">
            {/* Basic Information */}
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-200/50 p-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-3">
                <div className="p-2 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-lg">
                  <Target className="h-6 w-6 text-white" />
                </div>
                Campaign Details
              </h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Campaign Name</label>
                  <input
                    type="text"
                    value={campaignData.name}
                    onChange={(e) => setCampaignData({ ...campaignData, name: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200"
                    placeholder="Enter campaign name"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Timeframe</label>
                  <select
                    value={campaignData.timeframe}
                    onChange={(e) => setCampaignData({ ...campaignData, timeframe: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200"
                  >
                    <option value="week">1 Week</option>
                    <option value="month">1 Month</option>
                    <option value="quarter">1 Quarter</option>
                    <option value="year">1 Year</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
                  <input
                    type="date"
                    value={campaignData.startDate}
                    onChange={(e) => setCampaignData({ ...campaignData, startDate: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">End Date</label>
                  <input
                    type="date"
                    value={campaignData.endDate}
                    onChange={(e) => setCampaignData({ ...campaignData, endDate: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200"
                  />
                </div>
              </div>
              
              <div className="mt-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                <textarea
                  value={campaignData.description}
                  onChange={(e) => setCampaignData({ ...campaignData, description: e.target.value })}
                  rows={4}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200"
                  placeholder="Describe your campaign objectives and strategy"
                />
              </div>
            </div>

                {/* AI Program Capture Section */}
                {aiProgram && (
                  <div className="bg-gradient-to-br from-purple-100/80 via-indigo-100/80 to-blue-100/80 backdrop-blur-sm rounded-2xl shadow-lg border border-purple-300/50 p-6">
                    <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-3">
                      <div className="p-2 bg-gradient-to-r from-purple-500 to-indigo-600 rounded-lg">
                        <Target className="h-6 w-6 text-white" />
                      </div>
                      AI-Generated Campaign Program
                    </h2>
                    
                    <div className="bg-white/70 backdrop-blur-sm rounded-xl p-6 border border-gray-200/50 mb-6">
                      <h3 className="text-lg font-semibold text-gray-900 mb-4">Program Overview</h3>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                        <div className="bg-gradient-to-r from-blue-500 to-cyan-600 text-white p-4 rounded-lg">
                          <div className="text-2xl font-bold">12</div>
                          <div className="text-sm opacity-90">Weeks</div>
                        </div>
                        <div className="bg-gradient-to-r from-green-500 to-emerald-600 text-white p-4 rounded-lg">
                          <div className="text-2xl font-bold">{aiProgram.totalContent || '0'}</div>
                          <div className="text-sm opacity-90">Content Pieces</div>
                        </div>
                        <div className="bg-gradient-to-r from-purple-500 to-violet-600 text-white p-4 rounded-lg">
                          <div className="text-2xl font-bold">{aiProgram.platforms?.length || '0'}</div>
                          <div className="text-sm opacity-90">Platforms</div>
                        </div>
                      </div>
                      
                      <div className="space-y-3">
                        <div>
                          <label className="text-sm font-medium text-gray-600">Program Description</label>
                          <div className="text-gray-800 mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap">
                            {aiProgram.description || 'AI-generated campaign content program'}
                          </div>
                        </div>
                        <div>
                          <label className="text-sm font-medium text-gray-600">Target Platforms</label>
                          <div className="flex flex-wrap gap-2 mt-1">
                            {(aiProgram.platforms || ['LinkedIn', 'Facebook', 'Instagram', 'Twitter', 'YouTube', 'TikTok']).map((platform: string) => (
                              <span key={platform} className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-sm">
                                {platform}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Weekly Breakdown */}
                    {aiProgram.weeks && (
                      <div className="space-y-4">
                        <h3 className="text-lg font-semibold text-gray-900">Weekly Breakdown</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {aiProgram.weeks.slice(0, 12).map((week: any, index: number) => (
                            <div 
                              key={index} 
                              onClick={() => openDailyPlanning(week)}
                              className="bg-white/70 backdrop-blur-sm rounded-xl p-4 border border-gray-200/50 hover:shadow-lg hover:border-purple-300 cursor-pointer transition-all duration-200 group"
                            >
                              <div className="flex items-center justify-between mb-3">
                                <h4 className="font-semibold text-gray-900">Week {week.weekNumber}</h4>
                                <div className="flex items-center gap-2">
                                  {week.dailyPlanned && (
                                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                                  )}
                                  <span className="text-sm text-gray-500">{week.theme || 'Content Week'}</span>
                                </div>
                              </div>
                              
                              {/* Show actual dates if available */}
                              {week.dates && (
                                <div className="text-xs text-gray-600 mb-3 bg-gray-100 px-2 py-1 rounded">
                                  {week.dates.startFormatted} - {week.dates.endFormatted}
                                </div>
                              )}
                              
                              <div className="space-y-2">
                                {week.content?.slice(0, 3).map((content: any, contentIndex: number) => (
                                  <div key={contentIndex} className="flex items-center gap-2 text-sm">
                                    <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                                    <span className="text-gray-700">{content.type || 'Post'}</span>
                                    <span className="text-gray-500">•</span>
                                    <span className="text-gray-600">{content.platform || 'LinkedIn'}</span>
                                  </div>
                                ))}
                                {week.content?.length > 3 && (
                                  <div className="text-xs text-gray-500">+{week.content.length - 3} more</div>
                                )}
                              </div>
                              
                              {/* Click indicator */}
                              <div className="mt-3 text-xs text-purple-600 opacity-0 group-hover:opacity-100 transition-opacity">
                                Click to plan daily activities →
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex gap-4 mt-6">
                      <button
                        onClick={organizeProgramIntoGoals}
                        className="bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 text-white px-6 py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 flex items-center gap-2"
                      >
                        <CheckCircle className="h-5 w-5" />
                        Organize into Goals
                      </button>
                      <button
                        onClick={() => setShowProgramCapture(false)}
                        className="bg-gray-500 hover:bg-gray-600 text-white px-6 py-3 rounded-xl font-semibold transition-all duration-200"
                      >
                        Edit Program
                      </button>
                    </div>
                  </div>
                )}

                {/* View Campaign Plan Button */}
                <div className="bg-gradient-to-br from-blue-100/80 via-indigo-100/80 to-purple-100/80 backdrop-blur-sm rounded-2xl shadow-lg border border-blue-300/50 p-6 mb-6">
                  <h2 className="text-2xl font-bold text-gray-900 mb-4 flex items-center gap-3">
                    <div className="p-2 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-lg">
                      <Calendar className="h-6 w-6 text-white" />
                    </div>
                    Campaign Plan Management
                  </h2>
                  
                  {/* Plan Description */}
                  {planDescription ? (
                    <div className="bg-white/60 backdrop-blur-sm rounded-xl p-4 mb-6 border border-blue-200/50">
                      <h3 className="font-semibold text-gray-800 mb-3">Current Plan Description:</h3>
                      <div className="text-gray-700 text-sm leading-relaxed max-h-96 overflow-y-auto whitespace-pre-wrap">
                        {planDescription.split('\n').map((line, index) => {
                          if (line.startsWith('**') && line.endsWith('**')) {
                            return (
                              <div key={index} className="font-semibold text-gray-800 mt-3 mb-2">
                                {line.replace(/\*\*/g, '')}
                              </div>
                            );
                          } else if (line.startsWith('•')) {
                            return (
                              <div key={index} className="ml-4 mb-1">
                                {line}
                              </div>
                            );
                          } else if (line.trim() === '') {
                            return <div key={index} className="mb-2"></div>;
                          } else {
                            return (
                              <div key={index} className="mb-1">
                                {line}
                              </div>
                            );
                          }
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="bg-yellow-50/80 backdrop-blur-sm rounded-xl p-4 mb-6 border border-yellow-200/50">
                      <p className="text-yellow-800 text-sm">
                        <strong>No campaign plan created yet.</strong> Generate a comprehensive content plan to get started.
                      </p>
                    </div>
                  )}
                  
                  <p className="text-gray-700 mb-6">
                    {hasExistingPlan 
                      ? 'Manage your existing campaign content plan with AI-powered refinements and amendments.'
                      : 'Create a comprehensive campaign content plan with AI-powered suggestions and optimizations.'
                    }
                  </p>
                  
                  <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
                      <button
                        onClick={async () => {
                            if (campaignId) {
                              window.location.href = `/campaign-planning-hierarchical?campaignId=${campaignId}`;
                            } else {
                              // Try to load existing campaign first
                              await loadExistingCampaign();
                              if (campaignId) {
                                window.location.href = `/campaign-planning-hierarchical?campaignId=${campaignId}`;
                              } else {
                                notify('info', 'Please create a campaign first');
                              }
                            }
                          }}
                          className="bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white px-8 py-4 rounded-xl font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 flex items-center gap-3"
                        >
                          <Calendar className="h-6 w-6" />
                          View Campaign Plan
                        </button>
                    
                    <button
                      onClick={() => setIsChatOpen(true)}
                      className="bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 text-white px-8 py-4 rounded-xl font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 flex items-center gap-3"
                    >
                      <Sparkles className="h-6 w-6" />
                      {hasExistingPlan ? 'Edit Campaign Plan' : 'Generate New Plan'}
                      </button>
                  </div>
                </div>

            {/* Content Goals Table */}
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-200/50 p-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-3">
                <div className="p-2 bg-gradient-to-r from-green-500 to-emerald-600 rounded-lg">
                  <CheckCircle className="h-6 w-6 text-white" />
                </div>
                Content Goals
              </h2>

              {/* Add New Goal Form */}
              <div className="bg-gradient-to-r from-gray-50 to-white rounded-xl p-6 border border-gray-200/50 mb-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Add New Goal</h3>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Content Type</label>
                    <select
                      value={newGoal.contentType}
                      onChange={(e) => setNewGoal({ ...newGoal, contentType: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200"
                    >
                      <option value="">Select Type</option>
                      {contentTypes.map((type) => (
                        <option key={type.value} value={type.value}>{type.label}</option>
                      ))}
                    </select>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Quantity</label>
                    <input
                      type="number"
                      value={newGoal.quantity}
                      onChange={(e) => setNewGoal({ ...newGoal, quantity: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200"
                      placeholder="10"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Platform</label>
                    <select
                      value={newGoal.platform}
                      onChange={(e) => setNewGoal({ ...newGoal, platform: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200"
                    >
                      <option value="">Select Platform</option>
                      {platforms.map((platform) => (
                        <option key={platform.value} value={platform.value}>{platform.label}</option>
                      ))}
                    </select>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Timeline</label>
                    <input
                      type="text"
                      value={newGoal.timeline}
                      onChange={(e) => setNewGoal({ ...newGoal, timeline: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200"
                      placeholder="Week 1-2"
                    />
                  </div>
                  
                  <div className="flex items-end">
                    <button
                      onClick={addGoal}
                      className="w-full bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white px-4 py-2 rounded-lg font-medium shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 flex items-center justify-center gap-2"
                    >
                      <Plus className="h-4 w-4" />
                      Add
                    </button>
                  </div>
                </div>
              </div>

              {/* Goals Table */}
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-3 px-4 font-semibold text-gray-900">Content Type</th>
                      <th className="text-left py-3 px-4 font-semibold text-gray-900">Quantity</th>
                      <th className="text-left py-3 px-4 font-semibold text-gray-900">Platform</th>
                      <th className="text-left py-3 px-4 font-semibold text-gray-900">Timeline</th>
                      <th className="text-left py-3 px-4 font-semibold text-gray-900">Priority</th>
                      <th className="text-left py-3 px-4 font-semibold text-gray-900">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaignData.goals.map((goal) => {
                      const Icon = getContentTypeIcon(goal.contentType);
                      return (
                        <tr key={goal.id} className="border-b border-gray-100 hover:bg-gray-50/50 transition-colors">
                          <td className="py-4 px-4">
                            <div className="flex items-center gap-3">
                              <div className={`p-2 rounded-lg bg-gradient-to-r ${getContentTypeColor(goal.contentType)}`}>
                                <Icon className="h-4 w-4 text-white" />
                              </div>
                              <span className="font-medium text-gray-900 capitalize">{goal.contentType}</span>
                            </div>
                          </td>
                          <td className="py-4 px-4">
                            <span className="font-semibold text-gray-900">{goal.quantity}</span>
                          </td>
                          <td className="py-4 px-4">
                            <span className={`px-3 py-1 rounded-full text-xs font-medium text-white ${getPlatformColor(goal.platform)}`}>
                              {goal.platform.charAt(0).toUpperCase() + goal.platform.slice(1)}
                            </span>
                          </td>
                          <td className="py-4 px-4">
                            <span className="text-gray-700">{goal.timeline}</span>
                          </td>
                          <td className="py-4 px-4">
                            <span className={`px-3 py-1 rounded-full text-xs font-medium bg-gradient-to-r ${getPriorityColor(goal.priority)} text-white`}>
                              {goal.priority.charAt(0).toUpperCase() + goal.priority.slice(1)}
                            </span>
                          </td>
                          <td className="py-4 px-4">
                            <button
                              onClick={() => removeGoal(goal.id)}
                              className="p-2 hover:bg-red-100 text-red-600 rounded-lg transition-colors"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                
                {campaignData.goals.length === 0 && (
                  <div className="text-center py-12">
                    <div className="p-4 bg-gray-100 rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center">
                      <Target className="h-8 w-8 text-gray-400" />
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">No Goals Added Yet</h3>
                    <p className="text-gray-600">Add your first content goal to get started with campaign planning</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* AI Content Integration Section */}
          {campaignId && aiProgram && (
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-200/50 overflow-hidden">
              <div className="bg-gradient-to-r from-orange-500 to-red-500 text-white p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-bold">AI Content Integration</h2>
                    <p className="text-orange-100 mt-1">Convert AI suggestions into weekly content plans</p>
                  </div>
                  <Sparkles className="h-8 w-8 text-orange-200" />
                </div>
              </div>
              
              <div className="p-6">
                <AIContentIntegration 
                  campaignId={campaignId}
                  aiContent={aiProgram}
                  onContentIntegrated={(weekNumber, content) => {
                    console.log(`Week ${weekNumber} content integrated:`, content);
                    // Optionally refresh the page or show success message
                  }}
                />
              </div>
            </div>
          )}

          {/* Enhanced Planning Interface */}
          {campaignId && (
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-200/50 overflow-hidden">
              <div className="bg-gradient-to-r from-purple-500 to-indigo-600 text-white p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-bold">Enhanced Campaign Planning</h2>
                    <p className="text-purple-100 mt-1">Create content and capture voice notes during planning</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Mic className="h-6 w-6 text-purple-200" />
                    <FileText className="h-6 w-6 text-purple-200" />
                  </div>
                </div>
              </div>
              
              {/* Planning Tabs */}
              <div className="p-6">
                <div className="flex space-x-1 bg-gray-100 rounded-lg p-1 mb-6">
                  {[
                  { id: 'overview', label: 'Campaign Overview', icon: Target },
                  { id: 'content', label: 'Content Creation', icon: FileText },
                  { id: 'voice', label: 'Voice Notes', icon: Mic },
                  { id: 'refinement', label: 'Weekly Refinement', icon: Edit3 }
                  ].map((tab) => {
                    const Icon = tab.icon;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => setActivePlanningTab(tab.id as any)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
                          activePlanningTab === tab.id
                            ? 'bg-white text-purple-600 shadow-sm'
                            : 'text-gray-600 hover:text-gray-900'
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                        {tab.label}
                      </button>
                    );
                  })}
                </div>

                {/* Tab Content */}
                {activePlanningTab === 'overview' && (
                  <div className="space-y-4">
                    <div className="text-center py-8">
                      <Target className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                      <h3 className="text-xl font-semibold text-gray-900 mb-2">Campaign Overview</h3>
                      <p className="text-gray-600 mb-6">Your campaign planning overview and weekly breakdown</p>
                      
                      {/* Action Buttons */}
                      <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-8">
                        <button
                          onClick={() => setActivePlanningTab('refinement')}
                          className="bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white px-6 py-3 rounded-lg font-medium transition-all duration-200 flex items-center gap-2 shadow-md hover:shadow-lg transform hover:scale-105"
                        >
                          <Calendar className="h-5 w-5" />
                          View Campaign Plan
                        </button>
                        
                        <button
                          onClick={() => setIsChatOpen(true)}
                          className="bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 text-white px-6 py-3 rounded-lg font-medium transition-all duration-200 flex items-center gap-2 shadow-md hover:shadow-lg transform hover:scale-105"
                        >
                          <Sparkles className="h-5 w-5" />
                          Generate New Plan
                        </button>
                      </div>

                      {/* Feature Cards */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="bg-gradient-to-r from-blue-500 to-cyan-600 rounded-lg p-4 text-white">
                          <h4 className="font-semibold mb-2">Campaign Plan</h4>
                          <p className="text-sm text-blue-100">AI-generated strategic roadmap</p>
                        </div>
                        <div className="bg-gradient-to-r from-green-500 to-emerald-600 rounded-lg p-4 text-white">
                          <h4 className="font-semibold mb-2">Content Strategy</h4>
                          <p className="text-sm text-green-100">Platform-specific content plans</p>
                        </div>
                        <div className="bg-gradient-to-r from-purple-500 to-violet-600 rounded-lg p-4 text-white">
                          <h4 className="font-semibold mb-2">AI Enhancement</h4>
                          <p className="text-sm text-purple-100">Smart suggestions and optimization</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activePlanningTab === 'content' && (
                  <ContentCreationPanel
                    context="campaign"
                    campaignId={campaignId}
                    onContentSave={(content) => {
                      console.log('Campaign content saved:', content);
                    }}
                  />
                )}

                {activePlanningTab === 'voice' && (
                  <VoiceNotesComponent
                    context="campaign"
                    campaignId={campaignId}
                    onTranscriptionComplete={(transcription) => {
                      console.log('Voice transcription completed:', transcription);
                    }}
                    onSuggestionApply={(suggestion) => {
                      console.log('Voice suggestion applied:', suggestion);
                    }}
                  />
                )}

                {activePlanningTab === 'refinement' && (
                  <div className={isStrategyLocked ? 'pointer-events-none opacity-60' : ''}>
                    <WeeklyRefinementInterface
                      campaignId={campaignId}
                      campaignData={campaignData}
                      onWeekSelect={(weekNumber) => {
                        console.log('Week selected for refinement:', weekNumber);
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* AI Chat Sidebar */}
          <div className="space-y-6">
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-200/50 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-3">
                <div className="p-2 bg-gradient-to-r from-purple-500 to-violet-600 rounded-lg">
                  <Users className="h-5 w-5 text-white" />
                </div>
                AI Assistant
              </h3>
              <p className="text-gray-600 text-sm mb-4">
                Get AI suggestions for your campaign goals and content strategy
              </p>
              <div className="space-y-3">
              <button 
                onClick={() => {
                  console.log('Campaign Planning AI Chat button clicked!');
                  // Generate new campaign ID if not exists
                  if (!campaignId) {
                    const newCampaignId = 'campaign-' + Date.now();
                    console.log('User initiated campaign creation:', newCampaignId);
                    setCampaignId(newCampaignId);
                    
                    // Update campaign data with new ID
                    setCampaignData(prev => ({
                      ...prev,
                      id: newCampaignId,
                      name: prev.name || 'New Campaign'
                    }));
                    
                    // DO NOT update URL to prevent loops
                  }
                  setIsChatOpen(true);
                }}
                className="w-full bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 text-white px-4 py-2 rounded-lg font-medium transition-all duration-200 cursor-pointer"
                style={{ pointerEvents: 'auto', zIndex: 10 }}
              >
                Start AI Chat {!campaignId && <Sparkles className="w-4 h-4 ml-2 inline" />}
              </button>
                
                {campaignId && (
                  <button 
                    onClick={() => {
                      window.location.href = `/campaign-planning-hierarchical?campaignId=${campaignId}`;
                    }}
                    className="w-full bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white px-4 py-2 rounded-lg font-medium transition-all duration-200 cursor-pointer flex items-center justify-center gap-2"
                  >
                    <Calendar className="w-4 h-4" />
                    View 12-Week Plan
                  </button>
                )}
              </div>
            </div>

            <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-200/50 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-3">
                <div className="p-2 bg-gradient-to-r from-blue-500 to-cyan-600 rounded-lg">
                  <TrendingUp className="h-5 w-5 text-white" />
                </div>
                Campaign Summary
              </h3>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-gray-600">Total Goals:</span>
                  <span className="font-semibold text-gray-900">{campaignData.goals.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Content Types:</span>
                  <span className="font-semibold text-gray-900">
                    {[...new Set(campaignData.goals.map(g => g.contentType))].length}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Platforms:</span>
                  <span className="font-semibold text-gray-900">
                    {[...new Set(campaignData.goals.map(g => g.platform))].length}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Total Content:</span>
                  <span className="font-semibold text-gray-900">
                    {campaignData.goals.reduce((sum, goal) => sum + parseInt(goal.quantity || '0'), 0)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showRebalanceRejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Reject Optimization Proposal</h3>
              <button
                onClick={() => setShowRebalanceRejectModal(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>
            <div className="space-y-2 text-sm text-gray-700">
              <div className="text-xs text-gray-500">Why rejecting? (optional)</div>
              <textarea
                value={rebalanceRejectReason}
                onChange={(event) => setRebalanceRejectReason(event.target.value)}
                rows={3}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                placeholder="Add a short reason for rejecting this proposal."
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={rejectFrequencyRebalance}
                disabled={isRebalanceLoading}
                className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
              >
                Reject Proposal
              </button>
              <button
                onClick={() => setShowRebalanceRejectModal(false)}
                className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Campaign-Specific AI Chat Modal */}
          <CampaignAIChat 
            isOpen={isChatOpen}
            onClose={() => setIsChatOpen(false)}
            onMinimize={() => setIsChatOpen(false)}
            context="campaign-planning"
            campaignId={campaignId}
            campaignData={campaignData}
            onProgramGenerated={captureAIProgram}
          />
    </div>
  );
}
