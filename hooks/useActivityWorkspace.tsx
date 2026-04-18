import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { getAiLookingAheadMessage } from '@/lib/aiLookingAheadMessage';
import { getAiStrategicConfidence } from '@/lib/aiStrategicConfidence';
import { getViewMode } from '@/utils/getViewMode';
import { VIEW_RULES } from '@/utils/viewVisibilityMatrix';
import { useCompanyContext } from '@/components/CompanyContext';
import { apiFetch } from '@/lib/apiFetch';
import { useActivityWorkspaceContentOps } from './useActivityWorkspaceContentOps';
import { useActivityWorkspaceRefinementOps } from './useActivityWorkspaceRefinementOps';
import { useActivityWorkspacePersistence } from './useActivityWorkspacePersistence';
import { useActivityWorkspaceDerivedState } from './useActivityWorkspaceDerivedState';
import { useActivityWorkspacePlatformState } from './useActivityWorkspacePlatformState';
import type { ScheduleItem } from '../types/activityWorkspace';
import { asObject, type WorkspacePayload, type RefineChatMessage } from '@/lib/activity-workspace/shared';

export function useActivityWorkspace() {
  const router = useRouter();
  const { user, selectedCompanyId } = useCompanyContext();
  const queryWorkspaceKey = useMemo(() => String((Array.isArray(router.query.workspaceKey) ? router.query.workspaceKey[0] : router.query.workspaceKey) || '').trim(), [router.query.workspaceKey]);
  const queryCampaignId = useMemo(() => String((Array.isArray(router.query.campaignId) ? router.query.campaignId[0] : router.query.campaignId) || '').trim(), [router.query.campaignId]);
  const queryExecutionId = useMemo(() => String((Array.isArray(router.query.executionId) ? router.query.executionId[0] : router.query.executionId) || '').trim(), [router.query.executionId]);
  const workspaceKey = useMemo(() => (queryWorkspaceKey ? queryWorkspaceKey : queryCampaignId && queryExecutionId ? `activity-workspace-${queryCampaignId}-${queryExecutionId}` : ''), [queryWorkspaceKey, queryCampaignId, queryExecutionId]);

  const [payload, setPayload] = useState<WorkspacePayload | null>(null);
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isGeneratingMaster, setIsGeneratingMaster] = useState(false);
  const [isGeneratingVariants, setIsGeneratingVariants] = useState(false);
  const [latestMasterContent, setLatestMasterContent] = useState<Record<string, unknown> | null>(null);
  const [repurposingByScheduleId, setRepurposingByScheduleId] = useState<Record<string, boolean>>({});
  const [isHydratingContext, setIsHydratingContext] = useState(false);
  const [hasTriedHydration, setHasTriedHydration] = useState(false);
  const [showRefineByScheduleId, setShowRefineByScheduleId] = useState<Record<string, boolean>>({});
  const [isRefiningByScheduleId, setIsRefiningByScheduleId] = useState<Record<string, boolean>>({});
  const [refineInputByScheduleId, setRefineInputByScheduleId] = useState<Record<string, string>>({});
  const [refineMessagesByScheduleId, setRefineMessagesByScheduleId] = useState<Record<string, RefineChatMessage[]>>({});
  const [finalizedByScheduleId, setFinalizedByScheduleId] = useState<Record<string, boolean>>({});
  const [schedulingByScheduleId, setSchedulingByScheduleId] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [systemBlockExpanded, setSystemBlockExpanded] = useState(false);
  const [masterContentExpanded, setMasterContentExpanded] = useState(false);
  const [selectedVariantTab, setSelectedVariantTab] = useState<string>('');
  const [platformRulesByPlatform, setPlatformRulesByPlatform] = useState<Record<string, { guidelines: string[] }>>({});
  const [improvingSuggestionKey, setImprovingSuggestionKey] = useState<string | null>(null);
  const [improvedByScheduleId, setImprovedByScheduleId] = useState<Record<string, boolean>>({});
  const [isAutoImprovingByScheduleId, setIsAutoImprovingByScheduleId] = useState<Record<string, boolean>>({});
  const [autoAppliedByScheduleId, setAutoAppliedByScheduleId] = useState<Record<string, boolean>>({});
  const [imageByScheduleId, setImageByScheduleId] = useState<Record<string, { url: string; thumb: string; attribution: string } | null>>({});
  const [showImagePickerByScheduleId, setShowImagePickerByScheduleId] = useState<Record<string, boolean>>({});
  const [strategicMemoryProfile, setStrategicMemoryProfile] = useState<{
    campaign_id: string;
    action_acceptance_rate: Record<string, number>;
    platform_confidence_average: Record<string, number>;
    total_events: number;
  } | null>(null);
  const [showAddVariantForm, setShowAddVariantForm] = useState(false);
  const [addVariantContentType, setAddVariantContentType] = useState('');
  const [connectedPlatforms, setConnectedPlatforms] = useState<Set<string>>(new Set());
  const [addVariantPlatform, setAddVariantPlatform] = useState('');
  const [activityTab, setActivityTab] = useState<'content' | 'community_responses' | 'discussion'>('content');
  const [communitySignals, setCommunitySignals] = useState<Array<{
    id: string;
    author?: string | null;
    content?: string | null;
    platform: string;
    signal_type: string;
    engagement_score: number;
    detected_at: string;
    conversation_url?: string | null;
  }>>([]);
  const [communitySignalsLoading, setCommunitySignalsLoading] = useState(false);
  const notify = (type: 'success' | 'error' | 'info', message: string) => setNotice({ type, message });
  const normalizeKey = (value: unknown) => String(value || '').trim().toLowerCase();

  const {
    confidenceByPlatform,
    fetchPlatformRules,
    getVariantIntelligenceStatus,
    platformVariants,
    schedulePlatformsKey,
    selectedScheduleId,
    variantStatusDot,
    variantStatusLabel,
    variantTabPlatforms,
  } = useActivityWorkspacePlatformState({
    payload,
    schedules,
    finalizedByScheduleId,
    selectedVariantTab,
    platformRulesByPlatform,
    strategicMemoryProfile,
    normalizeKey,
    setPlatformRulesByPlatform,
    setSelectedVariantTab,
  });

  useEffect(() => {
    if (activityTab !== 'community_responses' || !payload?.campaignId) {
      setCommunitySignals([]);
      return;
    }
    const companyId = payload.companyId || payload.campaignId;
    const activityId = payload.activityId || queryExecutionId;
    if (!companyId) return;
    let cancelled = false;
    setCommunitySignalsLoading(true);
    const params = new URLSearchParams({ companyId });
    if (payload.campaignId) params.set('campaignId', payload.campaignId);
    if (activityId) params.set('activityId', activityId);
    apiFetch(`/api/engagement/campaign-signals?${params}`)
      .then((r) => (r.ok ? r.json() : { signals: [] }))
      .then((data) => {
        if (!cancelled) setCommunitySignals(data?.signals ?? []);
      })
      .catch(() => { if (!cancelled) setCommunitySignals([]); })
      .finally(() => { if (!cancelled) setCommunitySignalsLoading(false); });
    return () => { cancelled = true; };
  }, [activityTab, payload?.campaignId, payload?.companyId, payload?.activityId, queryExecutionId]);
  useEffect(() => {
    const companyId = String(payload?.companyId || '').trim();
    if (!companyId) return;
    let cancelled = false;
    apiFetch(`/api/social-accounts/status?companyId=${encodeURIComponent(companyId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.accounts) return;
        const connected = new Set<string>(
          (data.accounts as Array<{ platform_key: string; connected: boolean }>)
            .filter((a) => a.connected)
            .map((a) => a.platform_key)
        );
        setConnectedPlatforms(connected);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [payload?.companyId]);

  useEffect(() => {
    const campaignId = payload?.campaignId ?? '';
    if (!campaignId) {
      setStrategicMemoryProfile(null);
      return;
    }
    let cancelled = false;
    apiFetch(`/api/intelligence/strategic-memory?campaignId=${encodeURIComponent(campaignId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((profile) => {
        if (!cancelled && profile) setStrategicMemoryProfile(profile);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [payload?.campaignId]);

  const aiPreviewMessage = useMemo(() => getAiLookingAheadMessage(payload ?? null), [payload]);
  const viewMode = getViewMode(user?.role);
  const aiConfidenceMessage = useMemo(() => getAiStrategicConfidence(payload ?? null), [payload]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(t);
  }, [notice]);

  const {
    allContentTypesForAdd,
    allPlatformOptions,
    buildMarketingSupportForVariant,
    buildScheduleRows,
    contentType,
    contentTypeOptionsByPlatform,
    creatorAsset,
    creatorCard,
    creatorHasMasterSource,
    dailyRaw,
    effectiveProblemAddressed,
    effectiveWhatReaderLearns,
    executionMode,
    getAddablePlatformsForType,
    getContentTypeOptionsForPlatform,
    hasCreatorAsset,
    hasMasterGenerated,
    intent,
    isCreatorActivity,
    isDailyTopicView,
    isVideoContentTypeForValue,
    labelize,
    masterContent,
    masterContentFromPayload,
    nestedBrief,
    nestedIntent,
    normalizeComparableText,
    platformOptions,
    suggestedPlatforms,
    topicText,
    videoContentTypes,
    writerBrief,
  } = useActivityWorkspaceDerivedState({
    payload,
    latestMasterContent,
    schedules,
    normalizeKey,
  });

  const buildMarketingSupport = buildMarketingSupportForVariant;
  const buildScheduleRowsFromExecutionItem = buildScheduleRows;
  const getAddablePlatformsForContentType = getAddablePlatformsForType;
  const getContentTypeOptions = getContentTypeOptionsForPlatform;
  const isVideoContentType = isVideoContentTypeForValue;

  const { didInitialLoadRef: _didInitialLoad } = useActivityWorkspacePersistence({
    routerIsReady: router.isReady,
    workspaceKey,
    queryCampaignId,
    queryExecutionId,
    queryWorkspaceKey,
    payload,
    schedules,
    isLoaded,
    hasTriedHydration,
    isHydratingContext,
    setPayload,
    setSchedules,
    setIsLoaded,
    setHasTriedHydration,
    setIsHydratingContext,
    setFinalizedByScheduleId,
    buildScheduleRows,
    normalizeKey,
    normalizeComparableText,
  });

  const updateSchedule = (id: string, updates: Partial<ScheduleItem>) => {
    setSchedules((prev) => prev.map((item) => (item.id === id ? { ...item, ...updates } : item)));
    if (Object.prototype.hasOwnProperty.call(updates, 'platform') || Object.prototype.hasOwnProperty.call(updates, 'contentType')) {
      setFinalizedByScheduleId((prev) => ({ ...prev, [id]: false }));
    }
  };

  const addScheduleRow = () => {
    const first = schedules[0];
    const preferred = normalizeKey(first?.platform);
    const platform =
      (preferred && suggestedPlatforms.includes(preferred) ? preferred : null) ||
      suggestedPlatforms[0] ||
      'linkedin';
    const contentType = normalizeKey(first?.contentType) || getContentTypeOptionsForPlatform(platform)[0];
    const row: ScheduleItem = {
      id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      platform,
      contentType,
      date: first?.date || '',
      time: first?.time || '09:00',
      status: 'planned',
      title: payload?.title,
      description: payload?.description,
    };
    setSchedules((prev) => [...prev, row]);
  };

  const removeScheduleRow = (id: string) => {
    setSchedules((prev) => prev.filter((row) => row.id !== id));
  };

  const findVariantForSchedule = (item: ScheduleItem) => {
    const targetPlatform = normalizeKey(item.platform);
    const targetType = normalizeKey(item.contentType);
    return (
      platformVariants.find(
        (variant) =>
          normalizeKey(variant.platform) === targetPlatform &&
          normalizeKey(variant.content_type) === targetType
      ) ||
      platformVariants.find((variant) => normalizeKey(variant.platform) === targetPlatform) ||
      null
    );
  };

  const {
    buildActivityRequestPayload,
    upsertVariantForSchedule,
    handleRefineWithAi,
    finalizeRepurposeForSchedule,
    scheduleFinalizedContent,
    saveAndSendBack,
    getBackToWeekPlanUrl,
    handleBackToWeekPlan,
  } = useActivityWorkspaceRefinementOps({
    payload,
    schedules,
    platformVariants,
    workspaceKey,
    queryCampaignId,
    selectedCompanyId,
    connectedPlatforms,
    router,
    normalizeKey,
    labelize,
    notify,
    updateSchedule,
    setPayload,
    setConnectedPlatforms,
    setIsRefiningByScheduleId,
    setRefineMessagesByScheduleId,
    setRefineInputByScheduleId,
    setFinalizedByScheduleId,
    setSchedulingByScheduleId,
    refineInputByScheduleId,
    findVariantForSchedule,
  });

  const {
    handleGenerateMasterContent,
    onGenerateVariants,
    handleRepurposeForPlatform,
    handleRepurposeAll,
    handleCreatorAssetSaved,
    handleGenerateCreatorPromotion,
  } = useActivityWorkspaceContentOps({
    payload,
    schedules,
    selectedCompanyId,
    queryCampaignId,
    masterContent,
    creatorAsset,
    platformVariants,
    normalizeKey,
    notify,
    setIsGeneratingMaster,
    setIsGeneratingVariants,
    setLatestMasterContent,
    setPayload,
    setRepurposingByScheduleId,
    setFinalizedByScheduleId,
    setShowRefineByScheduleId,
    updateSchedule,
    findVariantForSchedule,
  });
  const _ef2 = !isLoaded;

  const _ef1 = !payload;

  return {
    _didInitialLoad,
    _ef1,
    _ef2,
    activityTab,
    addScheduleRow,
    addVariantContentType,
    addVariantPlatform,
    aiConfidenceMessage,
    aiPreviewMessage,
    allContentTypesForAdd,
    allPlatformOptions,
    autoAppliedByScheduleId,
    buildActivityRequestPayload,
    buildMarketingSupport,
    buildScheduleRowsFromExecutionItem,
    communitySignals,
    communitySignalsLoading,
    confidenceByPlatform,
    connectedPlatforms,
    contentType,
    contentTypeOptionsByPlatform,
    creatorAsset,
    creatorCard,
    creatorHasMasterSource,
    dailyRaw,
    effectiveProblemAddressed,
    effectiveWhatReaderLearns,
    executionMode,
    fetchPlatformRules,
    finalizeRepurposeForSchedule,
    finalizedByScheduleId,
    findVariantForSchedule,
    getAddablePlatformsForContentType,
    getBackToWeekPlanUrl,
    getContentTypeOptions,
    getVariantIntelligenceStatus,
    handleBackToWeekPlan,
    handleCreatorAssetSaved,
    handleGenerateCreatorPromotion,
    handleGenerateMasterContent,
    handleRefineWithAi,
    handleRepurposeAll,
    handleRepurposeForPlatform,
    hasCreatorAsset,
    hasMasterGenerated,
    hasTriedHydration,
    imageByScheduleId,
    improvedByScheduleId,
    improvingSuggestionKey,
    intent,
    isAutoImprovingByScheduleId,
    isCreatorActivity,
    isDailyTopicView,
    isGeneratingMaster,
    isGeneratingVariants,
    isHydratingContext,
    isLoaded,
    isRefiningByScheduleId,
    isVideoContentType,
    labelize,
    latestMasterContent,
    masterContent,
    masterContentExpanded,
    masterContentFromPayload,
    nestedBrief,
    nestedIntent,
    normalizeComparableText,
    normalizeKey,
    notice,
    notify,
    onGenerateVariants,
    payload,
    platformOptions,
    platformRulesByPlatform,
    platformVariants,
    queryCampaignId,
    queryExecutionId,
    queryWorkspaceKey,
    refineInputByScheduleId,
    refineMessagesByScheduleId,
    removeScheduleRow,
    repurposingByScheduleId,
    router,
    saveAndSendBack,
    scheduleFinalizedContent,
    schedulePlatformsKey,
    schedules,
    schedulingByScheduleId,
    selectedCompanyId,
    selectedScheduleId,
    selectedVariantTab,
    setActivityTab,
    setAddVariantContentType,
    setAddVariantPlatform,
    setAutoAppliedByScheduleId,
    setCommunitySignals,
    setCommunitySignalsLoading,
    setConnectedPlatforms,
    setFinalizedByScheduleId,
    setHasTriedHydration,
    setImageByScheduleId,
    setImprovedByScheduleId,
    setImprovingSuggestionKey,
    setIsAutoImprovingByScheduleId,
    setIsGeneratingMaster,
    setIsGeneratingVariants,
    setIsHydratingContext,
    setIsLoaded,
    setIsRefiningByScheduleId,
    setLatestMasterContent,
    setMasterContentExpanded,
    setNotice,
    setPayload,
    setPlatformRulesByPlatform,
    setRefineInputByScheduleId,
    setRefineMessagesByScheduleId,
    setRepurposingByScheduleId,
    setSchedules,
    setSchedulingByScheduleId,
    setSelectedVariantTab,
    setShowAddVariantForm,
    setShowImagePickerByScheduleId,
    setShowRefineByScheduleId,
    setStrategicMemoryProfile,
    setSystemBlockExpanded,
    showAddVariantForm,
    showImagePickerByScheduleId,
    showRefineByScheduleId,
    strategicMemoryProfile,
    suggestedPlatforms,
    systemBlockExpanded,
    topicText,
    updateSchedule,
    upsertVariantForSchedule,
    user,
    variantStatusDot,
    variantStatusLabel,
    variantTabPlatforms,
    videoContentTypes,
    viewMode,
    workspaceKey,
    writerBrief,
  };
}


