import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/router';
import {
  getConfidenceTierForRecommendation,
  getJourneyState,
  getDecisionMomentumState,
} from '../cards/RecommendationBlueprintCard';
import { useEngineJobPolling } from '../../../hooks/useEngineJobPolling';
import {
  PRIMARY_OPTIONS,
  PERSONAL_BRAND_SECONDARY_GROUPS,
  getSecondaryOptionsForPrimary,
  isPersonalBrandPrimary,
  buildHierarchicalPayload,
  getDilutionSeverity,
  type PrimaryCampaignTypeId,
  type SecondaryOptionId,
} from '../../../lib/campaignTypeHierarchy';
import {
  type ClusterInput,
  type StrategicPayload,
  type StrategyStatusForProgress,
  type CardSignals,
  type StrategicFlowState,
  type PulseTopicBridge,
  TREND_CLUSTER_PAYLOAD_BRIDGE,
  PULSE_TOPIC_BRIDGE,
  safeParseClusterPayload,
  regionInputToIsoCodes,
} from '../types/trend';
import type { ContextMode, FocusModule } from '../engine-framework/UnifiedContextModeSelector';
import type { StrategyStatusPayload } from '../../strategy/StrategyIntelligencePanel';
import type { BOLTProgress } from '../../BOLTProgressModal';
import type { BoltOutcomeView } from '../cards/RecommendationBlueprintCard';
import { buildSourceStrategicTheme } from '../../../lib/recommendationStrategicCard';

export type IntelligentMixContextWithFocus = import('@/pages/command-center/intelligent-mix-strategy').IntelligentMixState & {
  communicationStyle?: string[];
  primaryCampaignType?: PrimaryCampaignTypeId;
  secondaryCampaignTypes?: SecondaryOptionId[];
  contextMode?: ContextMode;
  focusedModules?: FocusModule[];
  additionalDirection?: string;
  selectedAspects?: string[];
  selectedFacets?: string[];
  strategicText?: string;
  regionsInput?: string;
  autoGenerateThemes?: boolean;
};

function getRecommendationPriorityScore(card: { id: string; recommendation: Record<string, unknown> }): number {
  const rec = card.recommendation ?? {};
  const tier = getConfidenceTierForRecommendation(rec);
  let score = tier === 'high' ? 100 : tier === 'medium' ? 60 : 20;
  const polishFlags = rec.polish_flags as Record<string, unknown> | undefined;
  if (polishFlags?.diamond_candidate === true) score += 20;
  if (polishFlags?.authority_elevated === true) score += 15;
  const strategyModifier =
    typeof rec.strategy_modifier === 'number' && Number.isFinite(rec.strategy_modifier)
      ? rec.strategy_modifier
      : null;
  if (strategyModifier != null && strategyModifier > 0) score += 10;
  const finalAlignmentScore =
    typeof rec.final_alignment_score === 'number' && Number.isFinite(rec.final_alignment_score)
      ? rec.final_alignment_score
      : typeof (rec as { finalAlignmentScore?: number }).finalAlignmentScore === 'number' &&
          Number.isFinite((rec as { finalAlignmentScore: number }).finalAlignmentScore)
        ? (rec as { finalAlignmentScore: number }).finalAlignmentScore
        : null;
  if (finalAlignmentScore != null) score += finalAlignmentScore * 20;
  const execution = (rec.execution as Record<string, unknown> | undefined) ?? rec;
  const executionStage =
    (typeof execution?.execution_stage === 'string' && execution.execution_stage.trim()) ||
    (typeof (rec as { execution_stage?: string }).execution_stage === 'string' &&
      (rec as { execution_stage: string }).execution_stage.trim());
  const stageLower = executionStage ? String(executionStage).toLowerCase() : '';
  if (stageLower.includes('conversion') || stageLower.includes('action') || stageLower.includes('consideration')) {
    score += 15;
  }
  return score;
}

function getProgressAdjustment(
  card: { id: string; recommendation: Record<string, unknown> },
  strategyStatus: StrategyStatusForProgress,
  longTermSource: Set<string> | Record<string, string>
): { adjustment: number; resurfaced: boolean } {
  let adjustment = 0;
  let resurfaced = false;
  const rec = card.recommendation ?? {};
  const recId = typeof rec.id === 'string' ? rec.id.trim() : null;
  const isLongTerm =
    typeof longTermSource === 'object' && !(longTermSource instanceof Set)
      ? !!(recId && longTermSource[recId] === 'LONG_TERM')
      : longTermSource.has(card.id);
  const isContinuationOrExpansion =
    strategyStatus === 'continuation' || strategyStatus === 'expansion';

  if (isContinuationOrExpansion) adjustment -= 25;
  if (isLongTerm) adjustment -= 40;

  const tier = getConfidenceTierForRecommendation(rec);
  if (tier === 'high' && !isContinuationOrExpansion && !isLongTerm) {
    adjustment += 15;
    resurfaced = true;
  }

  const execution = (rec.execution as Record<string, unknown> | undefined) ?? rec;
  const executionStage =
    (typeof execution?.execution_stage === 'string' && execution.execution_stage.trim()) ||
    (typeof (rec as { execution_stage?: string }).execution_stage === 'string' &&
      (rec as { execution_stage: string }).execution_stage.trim());
  const stageLower = executionStage ? String(executionStage).toLowerCase() : '';

  if (stageLower.includes('education') || stageLower.includes('awareness')) adjustment += 5;
  if ((stageLower.includes('conversion') || stageLower.includes('action')) && !isContinuationOrExpansion) adjustment += 10;

  return { adjustment, resurfaced };
}

function getStrategicFlowState(cards: CardSignals[]): StrategicFlowState {
  if (cards.length === 0) return 'default';
  const pastCount = cards.filter((c) => c.journeyState === 'past').length;
  const currentCount = cards.filter((c) => c.journeyState === 'current').length;
  const upcomingCount = cards.filter((c) => c.journeyState === 'upcoming').length;
  const continuationOrExpansionCount = cards.filter(
    (c) => c.strategyStatus === 'continuation' || c.strategyStatus === 'expansion'
  ).length;
  const currentWithHighOrMedium = cards.some(
    (c) => c.journeyState === 'current' && (c.confidenceTier === 'high' || c.confidenceTier === 'medium')
  );
  const planCount = cards.filter((c) => c.momentumState === 'plan').length;
  const majority = cards.length / 2;

  if (continuationOrExpansionCount >= majority || pastCount >= majority) return 'consolidation';
  if (pastCount >= 1 && currentCount >= 1 && currentWithHighOrMedium) return 'expansion';
  const topMomentum = cards[0]?.momentumState;
  const strongPast = pastCount >= majority || continuationOrExpansionCount >= majority;
  if (topMomentum === 'execute' && !strongPast) return 'momentum';
  if (upcomingCount >= majority || planCount >= majority) return 'exploration';
  return 'default';
}

export type UseTrendCampaignsOptions = {
  companyId: string | null;
  engineRecommendations?: Array<Record<string, unknown>>;
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>;
  intelligentMixContext?: import('@/pages/command-center/intelligent-mix-strategy').IntelligentMixState | null;
  campaignId?: string | null;
  strategicIntents?: string[];
  onStrategicIntentsChange?: (intents: string[]) => void;
};

export function useTrendCampaigns(opts: UseTrendCampaignsOptions) {
  const {
    companyId,
    engineRecommendations,
    fetchWithAuth,
    intelligentMixContext: intelligentMixProp,
    campaignId,
    onStrategicIntentsChange,
  } = opts;
  const router = useRouter();

  const intelligentMixContext = useMemo(() => {
    if (intelligentMixProp) return intelligentMixProp as IntelligentMixContextWithFocus;
    try {
      const raw = sessionStorage.getItem('intelligent-mix-strategy-state');
      if (raw) {
        const q = router.query as Record<string, string | undefined>;
        if (q.intelligentMix === '1') return JSON.parse(raw) as IntelligentMixContextWithFocus;
      }
    } catch { /* ignore */ }
    return null;
  }, [intelligentMixProp, router.isReady, router.query.intelligentMix]);

  const boltTextPreset = useMemo(() => {
    if (!router.isReady) return undefined;
    const q = router.query as Record<string, string | string[] | undefined>;
    if (typeof q.boltText !== 'string' || q.boltText !== '1') return undefined;
    const format = (typeof q.format === 'string' ? q.format : 'post') as import('../cards/RecommendationBlueprintCard').BoltContentFormat;
    const duration = Math.min(4, Math.max(1, parseInt(typeof q.duration === 'string' ? q.duration : '2', 10)));
    const outcomeView = (['week_plan', 'daily_plan', 'schedule'].includes(typeof q.outcomeView === 'string' ? q.outcomeView : '')
      ? q.outcomeView as BoltOutcomeView
      : 'week_plan');
    return { outcomeView, durationWeeks: duration, contentFormat: format };
  }, [router.isReady, router.query.boltText, router.query.format, router.query.duration, router.query.outcomeView]);

  const [hasRun, setHasRun] = useState(false);
  const [contextMode, setContextMode] = useState<ContextMode>('FULL');
  const [focusedModules, setFocusedModules] = useState<FocusModule[]>([]);
  const [additionalDirection, setAdditionalDirection] = useState('');
  const [clusterInputs, setClusterInputs] = useState<ClusterInput[] | undefined>(undefined);
  const [selectedAspects, setSelectedAspects] = useState<string[]>([]);
  const [selectedFacets, setSelectedFacets] = useState<string[]>([]);
  const [strategicText, setStrategicText] = useState('');
  const [primaryCampaignType, setPrimaryCampaignType] = useState<PrimaryCampaignTypeId>('brand_awareness');
  const [secondaryCampaignTypes, setSecondaryCampaignTypes] = useState<SecondaryOptionId[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [lastStrategicPayload, setLastStrategicPayload] = useState<StrategicPayload | null>(null);
  const [customPillars, setCustomPillars] = useState<Array<{ id: string; title: string; summary: string | null }>>([]);
  const [showAddCustomForm, setShowAddCustomForm] = useState(false);
  const [customTitle, setCustomTitle] = useState('');
  const [customAngle, setCustomAngle] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [regionInput, setRegionInput] = useState('');
  const [regionWarning, setRegionWarning] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<'idle' | 'PENDING' | 'RUNNING' | 'COMPLETED' | 'COMPLETED_WITH_WARNINGS' | 'FAILED'>('idle');
  const [jobError, setJobError] = useState<string | null>(null);
  const [jobRegionCount, setJobRegionCount] = useState(0);
  const [consolidatedResult, setConsolidatedResult] = useState<{
    global_opportunities: { title: string; summary?: string; rationale?: string; regions?: string[] }[];
    region_specific_insights: Record<string, { cultural_considerations: string; competitive_pressure: string }>;
    execution_priority_order: string[];
    consolidated_risks: string[];
    strategic_summary: string;
    confidence_index?: number;
  } | null>(null);
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [jobHistory, setJobHistory] = useState<{ jobId: string; status: string; regions: string[]; confidence_index: number | null; created_at: string }[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const clusterBridgeConsumedRef = useRef(false);
  const pulseBridgeConsumedRef = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => { isMountedRef.current = false; };
  }, []);

  const [regionDropdownOpen, setRegionDropdownOpen] = useState(false);
  const [strategicConfig, setStrategicConfig] = useState<{
    strategic_aspects: string[];
    aspect_offerings_map: Record<string, string[]>;
    offerings_by_aspect?: Record<string, string[]>;
    strategic_objectives?: string[];
  } | null>(null);
  const [generatedEngineRecommendations, setGeneratedEngineRecommendations] = useState<Array<Record<string, unknown>>>([]);
  const [recommendationRefinements, setRecommendationRefinements] = useState<Record<string, Record<string, unknown>>>({});
  const [strategyStatusPayload, setStrategyStatusPayload] = useState<StrategyStatusPayload | null>(null);
  const [recommendationUserStateMap, setRecommendationUserStateMap] = useState<Record<string, string>>({});
  const [recommendationSignals, setRecommendationSignals] = useState<{
    archived: number; longTerm: number; adopted: number; totalRecommendations: number; adoptionRate: number;
  } | null>(null);
  const [usedRecommendationIds, setUsedRecommendationIds] = useState<Set<string>>(new Set());
  const [generatedCampaignId, setGeneratedCampaignId] = useState<string | null>(null);
  const [fastLoadingCardId, setFastLoadingCardId] = useState<string | null>(null);
  const [boltProgress, setBoltProgress] = useState<BOLTProgress | null>(null);
  const [cardBuildError, setCardBuildError] = useState<Record<string, string>>({});
  const [strategyGuidanceMode, setStrategyGuidanceMode] = useState<'balanced' | 'continue' | 'expand'>('balanced');
  const [showStrategyDetails, setShowStrategyDetails] = useState(false);
  const [modeHint, setModeHint] = useState<string | null>(null);
  const [meterReveal, setMeterReveal] = useState(false);
  const prevConcentrationRef = useRef<number | undefined>(undefined);
  const [insightSource, setInsightSource] = useState<'hybrid' | 'api' | 'llm'>('hybrid');
  const [strategyHistory, setStrategyHistory] = useState<{
    campaigns_count: number;
    aspect_counts: Record<string, number>;
    dominant_aspects: string[];
    underused_aspects: string[];
    strategy_momentum: { dominant_streak_aspect: string | null; dominant_streak_count: number; diversification_score: number; } | null;
  } | null>(null);
  const [executionCollapsed, setExecutionCollapsed] = useState(false);
  const [targetAudience, setTargetAudience] = useState<string | null>(null);
  const [professionalSegments, setProfessionalSegments] = useState<string[]>([]);
  const [communicationStyle, setCommunicationStyle] = useState<string[]>([]);
  const [contentDepth, setContentDepth] = useState<string | null>(null);
  const [frequencyPerWeek, setFrequencyPerWeek] = useState<string | null>(null);
  const [tentativeStartDate, setTentativeStartDate] = useState<Date | undefined>();
  const [campaignGoal, setCampaignGoal] = useState<string | null>(null);
  const [mixPreFilled, setMixPreFilled] = useState(false);
  const [showStrategicSetupEditor, setShowStrategicSetupEditor] = useState(false);
  const autoRunIntelligentMixRef = useRef(false);
  const appliedMixSignatureRef = useRef<string | null>(null);

  const intelligentMixSignature = useMemo(() => {
    if (!intelligentMixContext) return null;
    try { return JSON.stringify(intelligentMixContext); } catch { return '__unserializable_mix_context__'; }
  }, [intelligentMixContext]);

  useEffect(() => {
    if (!intelligentMixContext || !intelligentMixSignature) return;
    if (appliedMixSignatureRef.current === intelligentMixSignature) return;
    appliedMixSignatureRef.current = intelligentMixSignature;
    let appliedAnyPrefill = false;
    const ctx = intelligentMixContext as IntelligentMixContextWithFocus;
    if (ctx.audience?.length && !targetAudience) { setTargetAudience(ctx.audience[0]); appliedAnyPrefill = true; }
    if (ctx.primaryCampaignType && !campaignGoal) {
      const goalMap: Record<string, string> = {
        brand_awareness: 'Awareness', lead_generation: 'Leads', engagement_growth: 'Engagement',
        product_promotion: 'Product', authority_positioning: 'Awareness', network_expansion: 'Awareness',
        personal_brand_promotion: 'Awareness', third_party: 'Awareness',
      };
      if (ctx.primaryCampaignType) { setCampaignGoal(goalMap[ctx.primaryCampaignType] ?? 'Awareness'); appliedAnyPrefill = true; }
    }
    if (!frequencyPerWeek) {
      const textTotal = (ctx.textFormats ?? []).reduce((s, f) => s + (ctx.textFrequency?.[f] ?? 1), 0);
      const creatorTotal = (ctx.creatorFormats ?? []).reduce((s, f) => s + (ctx.creatorFrequency?.[f] ?? 1), 0);
      const total = textTotal + creatorTotal;
      if (total > 0) { setFrequencyPerWeek(`${total}/w`); appliedAnyPrefill = true; }
    }
    if (ctx.startDate && !tentativeStartDate) { setTentativeStartDate(new Date(ctx.startDate + 'T00:00:00')); appliedAnyPrefill = true; }
    if (ctx.communicationStyle?.length && communicationStyle.length === 0) { setCommunicationStyle(ctx.communicationStyle); appliedAnyPrefill = true; }
    const canApplyPrimaryPrefill = ctx.primaryCampaignType && primaryCampaignType === 'brand_awareness' && secondaryCampaignTypes.length === 0 && primaryCampaignType !== ctx.primaryCampaignType;
    if (canApplyPrimaryPrefill) { setPrimaryCampaignType(ctx.primaryCampaignType!); appliedAnyPrefill = true; }
    if (ctx.secondaryCampaignTypes?.length && secondaryCampaignTypes.length === 0) { setSecondaryCampaignTypes(ctx.secondaryCampaignTypes); appliedAnyPrefill = true; }
    if (ctx.contextMode && contextMode === 'FULL') { setContextMode(ctx.contextMode); appliedAnyPrefill = true; }
    if (ctx.focusedModules?.length && focusedModules.length === 0) { setFocusedModules(ctx.focusedModules); appliedAnyPrefill = true; }
    if (ctx.additionalDirection && !additionalDirection.trim()) { setAdditionalDirection(ctx.additionalDirection); appliedAnyPrefill = true; }
    if (ctx.selectedAspects?.length && selectedAspects.length === 0) { setSelectedAspects(ctx.selectedAspects); appliedAnyPrefill = true; }
    if (ctx.selectedFacets?.length && selectedFacets.length === 0) { setSelectedFacets(ctx.selectedFacets); appliedAnyPrefill = true; }
    if (ctx.strategicText && !strategicText.trim()) { setStrategicText(ctx.strategicText); appliedAnyPrefill = true; }
    if (ctx.regionsInput && !regionInput.trim()) { setRegionInput(ctx.regionsInput); appliedAnyPrefill = true; }
    if (appliedAnyPrefill || !mixPreFilled) { setExecutionCollapsed(true); setMixPreFilled(true); }
    if (ctx.autoGenerateThemes) setShowStrategicSetupEditor(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intelligentMixContext, intelligentMixSignature]);

  const engineRecommendationSource = generatedEngineRecommendations.length > 0 ? generatedEngineRecommendations : (engineRecommendations ?? []);

  const engineRecommendationCards = useMemo<Array<{ id: string; recommendation: Record<string, unknown> }>>(() => {
    if (!Array.isArray(engineRecommendationSource) || engineRecommendationSource.length === 0) return [];
    return engineRecommendationSource.map((raw, index) => {
      const rec = (raw ?? {}) as Record<string, unknown>;
      const topic = typeof rec.topic === 'string' ? rec.topic : '';
      const polishedTitle = typeof rec.polished_title === 'string' ? rec.polished_title : '';
      const idBase = (typeof rec.snapshot_hash === 'string' && rec.snapshot_hash) || (typeof rec.id === 'string' && rec.id) || `${topic || polishedTitle || 'rec'}-${index}`;
      const cardId = `engine-${idBase}`;
      return { id: cardId, recommendation: recommendationRefinements[cardId] ?? rec };
    });
  }, [engineRecommendationSource, recommendationRefinements]);

  const visibleEngineCards = useMemo(() => {
    return engineRecommendationCards.filter((c) => {
      const snapshotId = typeof c.recommendation?.id === 'string' ? c.recommendation.id.trim() : '';
      if (snapshotId && recommendationUserStateMap[snapshotId] === 'ARCHIVED') return false;
      if (snapshotId && recommendationUserStateMap[snapshotId] === 'LONG_TERM') return false;
      if (snapshotId && usedRecommendationIds.has(snapshotId)) return false;
      return true;
    });
  }, [engineRecommendationCards, recommendationUserStateMap, usedRecommendationIds]);

  const archivedEngineCards = useMemo(() => {
    return engineRecommendationCards.filter((c) => {
      const snapshotId = typeof c.recommendation?.id === 'string' ? c.recommendation.id.trim() : '';
      return !!snapshotId && recommendationUserStateMap[snapshotId] === 'ARCHIVED';
    });
  }, [engineRecommendationCards, recommendationUserStateMap]);

  const longTermEngineCards = useMemo(() => {
    return engineRecommendationCards.filter((c) => {
      const snapshotId = typeof c.recommendation?.id === 'string' ? c.recommendation.id.trim() : '';
      return !!snapshotId && recommendationUserStateMap[snapshotId] === 'LONG_TERM';
    });
  }, [engineRecommendationCards, recommendationUserStateMap]);

  const visibleEngineCardsWithStatus = useMemo(() => {
    const hasHistory = strategyHistory && strategyHistory.campaigns_count > 0;
    const getStatus = (card: { id: string; recommendation: Record<string, unknown> }): 'continuation' | 'expansion' | 'neutral' | 'momentum_expand' | undefined => {
      if (!hasHistory) return undefined;
      const aspect =
        (typeof card.recommendation?.aspect === 'string' && card.recommendation.aspect.trim() ? card.recommendation.aspect : null) ??
        (typeof card.recommendation?.selected_aspect === 'string' && card.recommendation.selected_aspect.trim() ? card.recommendation.selected_aspect : null) ??
        selectedAspects[0] ?? '';
      if (!aspect) return 'neutral';
      const momentum = strategyHistory!.strategy_momentum;
      const rawContinuation = strategyHistory!.dominant_aspects.includes(aspect);
      const rawExpansion = strategyHistory!.underused_aspects.includes(aspect);
      const rawMomentumExpand = !!(momentum && momentum.dominant_streak_count >= 2 && rawExpansion);
      if (strategyGuidanceMode === 'continue') return rawContinuation ? 'continuation' : 'neutral';
      if (strategyGuidanceMode === 'expand') { if (rawMomentumExpand || rawExpansion) return 'expansion'; return 'neutral'; }
      if (rawMomentumExpand) return 'momentum_expand';
      if (rawContinuation) return 'continuation';
      if (rawExpansion) return 'expansion';
      return 'neutral';
    };
    const withStatus = visibleEngineCards.map((card) => ({ card, strategyStatus: getStatus(card) }));
    if (strategyGuidanceMode === 'continue') return [...withStatus].sort((a, b) => { const p = (s: typeof a.strategyStatus) => (s === 'continuation' ? 0 : 1); return p(a.strategyStatus) - p(b.strategyStatus); });
    if (strategyGuidanceMode === 'expand') return [...withStatus].sort((a, b) => { const p = (s: typeof a.strategyStatus) => s === 'expansion' || s === 'momentum_expand' ? 0 : 1; return p(a.strategyStatus) - p(b.strategyStatus); });
    return withStatus;
  }, [visibleEngineCards, strategyHistory, strategyGuidanceMode, selectedAspects]);

  const rankedEngineCardsWithStatus = useMemo(() => {
    const withScore = visibleEngineCardsWithStatus.map((item, originalIndex) => {
      const baseScore = getRecommendationPriorityScore(item.card);
      const { adjustment, resurfaced } = getProgressAdjustment(item.card, item.strategyStatus, recommendationUserStateMap);
      return { ...item, score: baseScore + adjustment, originalIndex, resurfaced };
    });
    withScore.sort((a, b) => { const d = b.score - a.score; if (d !== 0) return d; return a.originalIndex - b.originalIndex; });
    return withScore.map((item, index) => ({ card: item.card, strategyStatus: item.strategyStatus, isTopPriority: index < 2, resurfaced: item.resurfaced }));
  }, [visibleEngineCardsWithStatus, recommendationUserStateMap]);

  const workspaceSummaryData = useMemo(() => {
    const cardsWithSignals: CardSignals[] = rankedEngineCardsWithStatus.map(({ card, strategyStatus, isTopPriority, resurfaced }) => {
      const journeyState = getJourneyState({ strategyStatus, isTopPriority, resurfaced });
      const confidenceTier = getConfidenceTierForRecommendation(card.recommendation);
      const momentumState = getDecisionMomentumState({ confidenceTier, journeyState, strategyStatus });
      const rec = card.recommendation ?? {};
      const cardTitle = (typeof rec.polished_title === 'string' && rec.polished_title.trim() ? rec.polished_title : null) ?? (typeof rec.topic === 'string' && rec.topic.trim() ? rec.topic : null) ?? 'Opportunity';
      return { journeyState, confidenceTier, momentumState, strategyStatus, cardId: card.id, cardTitle };
    });
    const flowState = getStrategicFlowState(cardsWithSignals);
    return { flowState, cardsWithSignals };
  }, [rankedEngineCardsWithStatus]);

  const suggestedStrategyMode = useMemo((): 'balanced' | 'continue' | 'expand' | null => {
    if (!strategyHistory || strategyHistory.campaigns_count < 2) return null;
    const momentum = strategyHistory.strategy_momentum;
    if (!momentum) return null;
    const { dominant_streak_count, diversification_score } = momentum;
    if (dominant_streak_count >= 2) return 'expand';
    if (diversification_score >= 0.6) return 'continue';
    return 'balanced';
  }, [strategyHistory]);

  const suggestedStrategyExplanation = useMemo(() => {
    if (!strategyHistory) return null;
    const momentum = strategyHistory.strategy_momentum;
    if (!momentum) return null;
    const { dominant_streak_count, diversification_score } = momentum;
    if (suggestedStrategyMode === 'expand' && dominant_streak_count >= 2) return `Your last ${dominant_streak_count} campaigns focused on the same strategy. Expanding helps diversify your direction.`;
    if (suggestedStrategyMode === 'continue' && diversification_score >= 0.6) return `Your recent campaigns already cover multiple strategies. Continuing strengthens your current momentum.`;
    if (suggestedStrategyMode === 'balanced') return `Your strategy usage is balanced. Keeping a mixed approach is recommended.`;
    return null;
  }, [strategyHistory, suggestedStrategyMode]);

  const strategyDrift = useMemo(() => {
    if (!strategyHistory || strategyHistory.campaigns_count < 3) return null;
    const aspectCounts = strategyHistory.aspect_counts ?? {};
    const total = strategyHistory.campaigns_count;
    const uniqueAspects = Object.keys(aspectCounts).length;
    const values = Object.values(aspectCounts);
    const concentration = values.length > 0 && total > 0 ? Math.max(...values) / total : 0;
    const hasDrift = uniqueAspects >= 3 && concentration < 0.5;
    return { hasDrift, uniqueAspects, concentration };
  }, [strategyHistory]);

  const stabilizationRecommendation = useMemo(() => {
    if (!strategyDrift?.hasDrift || !strategyHistory) return null;
    const aspectCounts = strategyHistory.aspect_counts ?? {};
    const entries = Object.entries(aspectCounts);
    if (entries.length === 0) return null;
    const [topAspect, topCount] = entries.sort((a, b) => b[1] - a[1])[0];
    if (topCount <= 1) return null;
    return { aspect: topAspect, count: topCount };
  }, [strategyDrift, strategyHistory]);

  const strategyFocusLabel = strategyDrift?.concentration != null
    ? strategyDrift.concentration > 0.7 ? 'Strong Focus' : strategyDrift.concentration >= 0.5 ? 'Moderate' : 'Fragmented'
    : null;

  useEffect(() => {
    const c = strategyDrift?.concentration;
    if (c === undefined || c === null) return;
    if (prevConcentrationRef.current !== undefined && prevConcentrationRef.current !== c) {
      setMeterReveal(true);
      prevConcentrationRef.current = c;
      const t = setTimeout(() => setMeterReveal(false), 200);
      return () => clearTimeout(t);
    }
    prevConcentrationRef.current = c;
  }, [strategyDrift?.concentration]);

  const hierarchicalPayload = useMemo(() => buildHierarchicalPayload(primaryCampaignType, secondaryCampaignTypes), [primaryCampaignType, secondaryCampaignTypes]);
  const dilutionSeverity = useMemo(() => primaryCampaignType && secondaryCampaignTypes.length > 0 ? getDilutionSeverity(primaryCampaignType, secondaryCampaignTypes) : 'none', [primaryCampaignType, secondaryCampaignTypes]);

  const selectPrimary = (id: PrimaryCampaignTypeId) => { setPrimaryCampaignType(id); setSecondaryCampaignTypes([]); };
  const toggleSecondary = (id: SecondaryOptionId) => {
    if (primaryCampaignType === 'third_party') return;
    setSecondaryCampaignTypes((prev) => { const has = prev.includes(id); return has ? prev.filter((t) => t !== id) : [...prev, id]; });
  };

  const setStrategyModeWithHint = (mode: 'balanced' | 'continue' | 'expand') => {
    setStrategyGuidanceMode(mode);
    const hints: Record<string, string> = { balanced: 'Showing both continuation and expansion options.', continue: 'Prioritizing themes aligned with your current strategy.', expand: 'Prioritizing expansion themes.' };
    setModeHint(hints[mode]);
    setTimeout(() => setModeHint(null), 1500);
  };

  const { job: polledJob } = useEngineJobPolling<{
    status?: string;
    progress_stage?: string | null;
    confidence_index?: number;
    consolidated_result?: {
      global_opportunities?: { title: string; summary?: string; rationale?: string; regions?: string[] }[];
      region_specific_insights?: Record<string, { cultural_considerations: string; competitive_pressure: string }>;
      execution_priority_order?: string[];
      consolidated_risks?: string[];
      strategic_summary?: string;
      confidence_index?: number;
    } | null;
    error?: string | null;
    created_at?: string;
  }>(jobId, jobId ? `/api/recommendations/job/${jobId}` : null, fetchWithAuth, { enabled: !!jobId });

  useEffect(() => {
    if (!polledJob) return;
    if (polledJob.status) setJobStatus(polledJob.status as typeof jobStatus);
    if (polledJob.status === 'COMPLETED' || polledJob.status === 'COMPLETED_WITH_WARNINGS') {
      const cr = polledJob.consolidated_result;
      setConsolidatedResult(cr ? { global_opportunities: cr.global_opportunities ?? [], region_specific_insights: cr.region_specific_insights ?? {}, execution_priority_order: cr.execution_priority_order ?? [], consolidated_risks: cr.consolidated_risks ?? [], strategic_summary: cr.strategic_summary ?? '', confidence_index: cr.confidence_index } : null);
    }
    if (polledJob.status === 'FAILED' && polledJob.error) setJobError(polledJob.error);
  }, [polledJob]);

  useEffect(() => { setValidationError(null); }, [contextMode, selectedAspects, selectedFacets, strategicText, primaryCampaignType, secondaryCampaignTypes]);

  useEffect(() => {
    if (typeof window === 'undefined' || pulseBridgeConsumedRef.current) return;
    const raw = localStorage.getItem(PULSE_TOPIC_BRIDGE);
    if (!raw) return;
    pulseBridgeConsumedRef.current = true;
    try {
      const parsed = JSON.parse(raw) as PulseTopicBridge;
      if (!parsed?.topic) return;
      try { localStorage.removeItem(PULSE_TOPIC_BRIDGE); } catch { /* ignore */ }
      const template = `Topic from Market Pulse: ${parsed.topic}\nNarrative phase: ${parsed.narrative_phase ?? '—'}\nMomentum score: ${parsed.momentum_score != null ? (parsed.momentum_score * 100).toFixed(0) + '%' : '—'}\nGenerate strategic campaign pillars to capture this opportunity.`;
      setStrategicText(template);
      if (Array.isArray(parsed.regions) && parsed.regions.length > 0) setRegionInput(parsed.regions.join(', '));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || clusterBridgeConsumedRef.current) return;
    const queryRaw = typeof router.query?.cluster_payload === 'string' ? router.query.cluster_payload : null;
    const storageRaw = localStorage.getItem(TREND_CLUSTER_PAYLOAD_BRIDGE);
    const raw = queryRaw ?? storageRaw;
    if (!raw) return;
    clusterBridgeConsumedRef.current = true;
    const decoded = queryRaw ? (() => { try { return decodeURIComponent(queryRaw); } catch { return raw; } })() : raw;
    const parsed = safeParseClusterPayload(decoded);
    try { localStorage.removeItem(TREND_CLUSTER_PAYLOAD_BRIDGE); } catch { /* ignore */ }
    if (queryRaw && router.isReady) {
      const q = { ...router.query };
      delete q.cluster_payload;
      router.replace({ pathname: router.pathname, query: q }, undefined, { shallow: true });
    }
    if (!parsed || !Array.isArray(parsed.cluster_inputs) || parsed.cluster_inputs.length === 0) return;
    const inputs = parsed.cluster_inputs;
    setClusterInputs(inputs);
    setContextMode('NONE');
    const first = inputs[0];
    const template = `Emerging demand detected in: ${first.problem_domain}\nIntent intensity: ${first.avg_intent_score}\nUrgency level: ${first.avg_urgency_score}\nSignal count: ${first.signal_count}\nPriority index: ${first.priority_score}\n\nGenerate strategic campaign pillars to capture this demand.`;
    setStrategicText(template);
  }, [router.query?.cluster_payload, router.isReady]);

  useEffect(() => {
    if (!historyDrawerOpen || !companyId) return;
    setHistoryLoading(true);
    fetchWithAuth(`/api/recommendations/job/history?companyId=${encodeURIComponent(companyId)}&limit=5`)
      .then((res) => (res.ok ? res.json() : { jobs: [] }))
      .then((data) => setJobHistory(Array.isArray(data?.jobs) ? data.jobs : []))
      .catch(() => setJobHistory([]))
      .finally(() => setHistoryLoading(false));
  }, [historyDrawerOpen, companyId, fetchWithAuth]);

  useEffect(() => {
    if (!companyId || !fetchWithAuth) { setRecommendationUserStateMap({}); return; }
    fetchWithAuth(`/api/recommendations/user-state-map?companyId=${encodeURIComponent(companyId)}`).then((res) => (res.ok ? res.json() : {})).then((data) => (typeof data === 'object' && data !== null ? data : {})).then(setRecommendationUserStateMap).catch(() => setRecommendationUserStateMap({}));
  }, [companyId, fetchWithAuth]);

  useEffect(() => {
    if (!companyId) { setUsedRecommendationIds(new Set()); return; }
    fetchWithAuth(`/api/recommendations/used-by-company?companyId=${encodeURIComponent(companyId)}`).then((res) => (res.ok ? res.json() : { usedRecommendationIds: [] })).then((data) => setUsedRecommendationIds(new Set(Array.isArray(data?.usedRecommendationIds) ? data.usedRecommendationIds : []))).catch(() => setUsedRecommendationIds(new Set()));
  }, [companyId, fetchWithAuth]);

  useEffect(() => {
    if (!companyId) { setStrategyHistory(null); return; }
    fetchWithAuth(`/api/recommendations/strategy-history?companyId=${encodeURIComponent(companyId)}`).then((res) => (res.ok ? res.json() : null)).then((data) => {
      if (data && typeof data.campaigns_count === 'number' && data.campaigns_count > 0) {
        const sm = data.strategy_momentum && typeof data.strategy_momentum === 'object';
        setStrategyHistory({ campaigns_count: data.campaigns_count, aspect_counts: data.aspect_counts && typeof data.aspect_counts === 'object' ? data.aspect_counts : {}, dominant_aspects: Array.isArray(data.dominant_aspects) ? data.dominant_aspects : [], underused_aspects: Array.isArray(data.underused_aspects) ? data.underused_aspects : [], strategy_momentum: sm ? { dominant_streak_aspect: data.strategy_momentum.dominant_streak_aspect ?? null, dominant_streak_count: typeof data.strategy_momentum.dominant_streak_count === 'number' ? data.strategy_momentum.dominant_streak_count : 0, diversification_score: typeof data.strategy_momentum.diversification_score === 'number' ? data.strategy_momentum.diversification_score : 0 } : null });
      } else { setStrategyHistory(null); }
    }).catch(() => setStrategyHistory(null));
  }, [companyId, fetchWithAuth]);

  useEffect(() => {
    if (!campaignId?.trim() || !fetchWithAuth) { setStrategyStatusPayload(null); return; }
    fetchWithAuth(`/api/campaigns/${encodeURIComponent(campaignId)}/strategy-status`).then((res) => (res.ok ? res.json() : null)).then((data) => setStrategyStatusPayload(data ?? null)).catch(() => setStrategyStatusPayload(null));
  }, [campaignId, fetchWithAuth]);

  useEffect(() => {
    if (!companyId || !fetchWithAuth) { setRecommendationUserStateMap({}); setRecommendationSignals(null); return; }
    let cancelled = false;
    fetchWithAuth(`/api/recommendations/user-state-map?companyId=${encodeURIComponent(companyId)}`).then((res) => (res.ok ? res.json() : {})).then((data) => { if (cancelled) return; setRecommendationUserStateMap(data && typeof data === 'object' ? data as Record<string, string> : {}); }).catch(() => { if (!cancelled) setRecommendationUserStateMap({}); });
    fetchWithAuth(`/api/recommendations/strategy-signals?companyId=${encodeURIComponent(companyId)}`).then((res) => (res.ok ? res.json() : null)).then((data) => { if (cancelled) return; setRecommendationSignals(data && typeof data === 'object' ? { archived: Number((data as any).archived) || 0, longTerm: Number((data as any).longTerm) || 0, adopted: Number((data as any).adopted) || 0, totalRecommendations: Number((data as any).totalRecommendations) || 0, adoptionRate: Number((data as any).adoptionRate) || 0 } : null); }).catch(() => { if (!cancelled) setRecommendationSignals(null); });
    return () => { cancelled = true; };
  }, [companyId, fetchWithAuth]);

  useEffect(() => {
    if (!companyId) { setStrategicConfig(null); return; }
    let cancelled = false;
    fetchWithAuth(`/api/company-profile?companyId=${encodeURIComponent(companyId)}`).then((res) => (res.ok ? res.json() : null)).then((data) => {
      if (cancelled) return;
      const config = data?.recommendation_strategic_config;
      const map = config?.offerings_by_aspect ?? config?.aspect_offerings_map;
      if (config && Array.isArray(config.strategic_aspects) && typeof map === 'object') {
        const sortAz = (a: string, b: string) => a.trim().toLowerCase().localeCompare(b.trim().toLowerCase(), undefined, { sensitivity: 'base' });
        const sortedAspects = [...config.strategic_aspects].sort(sortAz);
        const sortedMap: Record<string, string[]> = {};
        for (const [k, v] of Object.entries(map ?? {})) { sortedMap[k] = Array.isArray(v) ? [...v].sort(sortAz) : []; }
        setStrategicConfig({ strategic_aspects: sortedAspects, aspect_offerings_map: sortedMap, offerings_by_aspect: sortedMap, strategic_objectives: Array.isArray(config.strategic_objectives) ? [...config.strategic_objectives].sort(sortAz) : undefined });
      } else { setStrategicConfig(null); }
    }).catch(() => { if (!cancelled) setStrategicConfig(null); });
    return () => { cancelled = true; };
  }, [companyId, fetchWithAuth]);

  const aspects = strategicConfig?.strategic_aspects ?? [];
  const aspectOfferingsMap = strategicConfig?.aspect_offerings_map ?? strategicConfig?.offerings_by_aspect ?? {};

  const offeringsForSelectedAspect = useMemo(() => {
    if (selectedAspects.length === 0) return [];
    const seen = new Set<string>();
    for (const aspect of selectedAspects) { const ids = aspectOfferingsMap[aspect]; if (Array.isArray(ids)) ids.forEach((id) => seen.add(id)); }
    return Array.from(seen);
  }, [selectedAspects, aspectOfferingsMap]);

  const offeringFacetCards = useMemo(() => {
    return offeringsForSelectedAspect.map((id: string) => { const title = id.includes(':') ? id.split(':').slice(1).join(':').trim() || id : id; return { id, title, description: title }; });
  }, [offeringsForSelectedAspect]);

  useEffect(() => {
    if (selectedAspects.length === 0 || selectedFacets.length === 0) return;
    const allowed = new Set<string>();
    for (const aspect of selectedAspects) { const ids = aspectOfferingsMap[aspect]; if (Array.isArray(ids)) ids.forEach((id) => allowed.add(id)); }
    const next = selectedFacets.filter((id) => allowed.has(id));
    if (next.length !== selectedFacets.length) setSelectedFacets(next);
  }, [selectedAspects, aspectOfferingsMap]);

  const fetchProfile = async (): Promise<Record<string, unknown> | null> => {
    if (!companyId) return null;
    const res = await fetchWithAuth(`/api/company-profile?companyId=${encodeURIComponent(companyId)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.profile ?? null;
  };

  const buildStrategicPayload = async (): Promise<StrategicPayload> => {
    const profile = await fetchProfile();
    const companyContext: Record<string, unknown> = {};
    if (contextMode === 'FULL' && profile) {
      companyContext.brand_voice = profile.brand_voice;
      companyContext.icp = profile.ideal_customer_profile;
      companyContext.positioning = profile.brand_positioning;
      companyContext.themes = profile.content_themes;
      companyContext.geography = profile.geography;
    }
    const regions = regionInputToIsoCodes(regionInput);
    const base: StrategicPayload = {
      context_mode: contextMode,
      company_context: companyContext,
      selected_offerings: selectedFacets,
      selected_aspect: selectedAspects[0] ?? null,
      selected_aspects: selectedAspects.length > 0 ? selectedAspects : undefined,
      strategic_text: strategicText,
      strategic_intents: campaignFocusLabels.length > 0 ? campaignFocusLabels : undefined,
      regions: regions.length > 0 ? regions : undefined,
      cluster_inputs: clusterInputs?.length ? clusterInputs : undefined,
      focused_modules: contextMode === 'FOCUSED' && focusedModules.length > 0 ? focusedModules : undefined,
      additional_direction: additionalDirection.trim() || undefined,
      primary_campaign_type: hierarchicalPayload.primary_campaign_type,
      secondary_campaign_types: hierarchicalPayload.secondary_campaign_types,
      context: hierarchicalPayload.context,
      mapped_core_types: hierarchicalPayload.mapped_core_types,
    };
    if (targetAudience && communicationStyle.length > 0 && contentDepth && frequencyPerWeek && tentativeStartDate && campaignGoal) {
      base.execution_config = { target_audience: targetAudience, professional_segment: professionalSegments[0] ?? null, professional_segments: professionalSegments, communication_style: communicationStyle, content_depth: contentDepth, frequency_per_week: frequencyPerWeek, tentative_start: tentativeStartDate.toISOString(), campaign_goal: campaignGoal };
    }
    return base;
  };

  const isValid = (): boolean => {
    if (contextMode !== 'NONE') return !!companyId;
    return !!(additionalDirection.trim() || selectedAspects.length >= 1 || selectedFacets.length >= 1 || strategicText.trim() || (clusterInputs && clusterInputs.length > 0));
  };

  const requiredExecutionFields = useMemo(() => {
    const hasAudience = !!targetAudience;
    const hasGoal = !!campaignGoal;
    const hasFrequency = !!frequencyPerWeek;
    const hasStartDate = !!tentativeStartDate;
    const hasStyle = communicationStyle.length > 0;
    const missing: string[] = [];
    if (!hasAudience) missing.push('Target Audience');
    if (!hasGoal) missing.push('Campaign Goal');
    if (!hasFrequency) missing.push('Frequency per week');
    if (!hasStartDate) missing.push('Start Date');
    if (!hasStyle) missing.push('Communication Style');
    return { completed: hasAudience && hasGoal && hasFrequency && hasStartDate && hasStyle, completedCount: [hasAudience, hasGoal, hasFrequency, hasStartDate, hasStyle].filter(Boolean).length, missing };
  }, [targetAudience, campaignGoal, frequencyPerWeek, tentativeStartDate, communicationStyle]);

  const isExecutionFormComplete = requiredExecutionFields.completed;
  const isExecutionValid = isExecutionFormComplete;

  const hasStrategicMixPrefill = Boolean(intelligentMixContext && ((intelligentMixContext as IntelligentMixContextWithFocus).contextMode || (intelligentMixContext as IntelligentMixContextWithFocus).strategicText || (intelligentMixContext as IntelligentMixContextWithFocus).selectedAspects?.length || (intelligentMixContext as IntelligentMixContextWithFocus).selectedFacets?.length || (intelligentMixContext as IntelligentMixContextWithFocus).regionsInput));

  const buildAiChatExecutionConfig = (options?: { keyMessages?: string | null; campaignDuration?: number }) => {
    if (!isExecutionFormComplete || !targetAudience || !frequencyPerWeek || !tentativeStartDate || !campaignGoal) return null;
    const resolvedDuration = options?.campaignDuration ?? ((intelligentMixContext as { duration?: number } | null)?.duration ?? 4);
    const trimmedKeyMessage = typeof options?.keyMessages === 'string' ? options.keyMessages.trim() : '';
    return { target_audience: targetAudience, professional_segment: professionalSegments[0] ?? null, professional_segments: professionalSegments, communication_style: communicationStyle, content_depth: contentDepth ?? null, frequency_per_week: frequencyPerWeek, tentative_start: tentativeStartDate.toISOString(), campaign_goal: campaignGoal, available_content: 'none', content_capacity: `${frequencyPerWeek} posts per week`, action_expectation: campaignGoal, exclusive_campaigns: 'none', campaign_duration: resolvedDuration, intelligent_mix_prefill: true, ...(trimmedKeyMessage ? { key_messages: trimmedKeyMessage.slice(0, 200) } : {}) };
  };

  const campaignFocusLabels = useMemo(() => {
    const primaryLabel = PRIMARY_OPTIONS.find((o) => o.id === primaryCampaignType)?.label ?? '';
    const secondaryLabels = isPersonalBrandPrimary(primaryCampaignType) ? secondaryCampaignTypes.map((id) => PERSONAL_BRAND_SECONDARY_GROUPS.flatMap((g) => g.options).find((o) => o.id === id)?.label).filter(Boolean) as string[] : secondaryCampaignTypes.map((id) => getSecondaryOptionsForPrimary(primaryCampaignType).find((o) => o.id === id)?.label).filter(Boolean) as string[];
    return [primaryLabel, ...secondaryLabels].filter(Boolean);
  }, [primaryCampaignType, secondaryCampaignTypes]);

  useEffect(() => {
    if (onStrategicIntentsChange && campaignFocusLabels.length > 0) onStrategicIntentsChange(campaignFocusLabels);
  }, [campaignFocusLabels, onStrategicIntentsChange]);

  const handleViewIntelligence = async (id: string) => {
    try {
      const res = await fetchWithAuth(`/api/recommendations/job/${id}`);
      if (!res.ok) return;
      const data = await res.json();
      setConsolidatedResult(data.consolidated_result ?? null);
      setHistoryDrawerOpen(false);
    } catch { /* ignore */ }
  };

  const handleAddCustomPillar = () => {
    if (!customTitle.trim()) return;
    const id = `custom-${Date.now()}`;
    setCustomPillars((prev) => [...prev, { id, title: customTitle.trim(), summary: customAngle.trim() || null }]);
    setCustomTitle('');
    setCustomAngle('');
    setShowAddCustomForm(false);
  };

  const handleRun = async () => {
    setValidationError(null);
    if (!companyId) { setValidationError('Select a company first.'); return; }
    if (!isExecutionValid) { setValidationError('Complete Execution Configuration (audience, style, depth, frequency, start date, goal) before generating themes.'); return; }
    if (contextMode === 'NONE' && !additionalDirection.trim()) { setValidationError('Please provide research direction when using No Company Context.'); return; }
    setIsSubmitting(true);
    try {
      const payload = await buildStrategicPayload();
      setLastStrategicPayload(payload);
      const regionList = regionInputToIsoCodes(regionInput);
      const objective = (payload.mapped_core_types?.length ? payload.mapped_core_types[0] : primaryCampaignType === 'third_party' ? 'third_party' : primaryCampaignType) ?? 'brand_awareness';
      const durationFromExec = payload.execution_config && typeof payload.execution_config === 'object' && typeof (payload.execution_config as { campaign_duration?: number }).campaign_duration === 'number' && (payload.execution_config as { campaign_duration: number }).campaign_duration >= 4 && (payload.execution_config as { campaign_duration: number }).campaign_duration <= 12 ? (payload.execution_config as { campaign_duration: number }).campaign_duration : 12;
      const recRes = await fetchWithAuth('/api/recommendations/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyId, objective, durationWeeks: durationFromExec, ...(regionList.length > 0 ? { regions: regionList } : {}), strategicPayload: payload, insight_source: insightSource }) });
      if (!recRes.ok) {
        const recErr = await recRes.json().catch(() => ({}));
        const code = recErr?.error;
        const friendlyMessage = code === 'FORBIDDEN_ROLE' ? "You don't have permission to generate themes. Company Admin or Content Creator role is required for this company." : code === 'COMPANY_SCOPE_VIOLATION' || code === 'Access denied to company' ? "You don't have access to this company. Select a company you belong to." : code === 'CAMPAIGN_NOT_IN_COMPANY' ? "The selected campaign doesn't belong to this company." : null;
        const base = friendlyMessage ?? code ?? 'Recommendation engine request failed';
        const detail = recErr?.detail && !friendlyMessage ? ` (${recErr.detail})` : '';
        throw new Error(`${base}${detail}`);
      }
      const recData = await recRes.json().catch(() => null);
      const trends = Array.isArray(recData?.trends_used) ? recData.trends_used : [];
      setGeneratedEngineRecommendations(trends as Array<Record<string, unknown>>);
      setRecommendationRefinements({});
      if (trends.length === 0) {
        setValidationError('Engine returned no recommendations for this input. Adjust context/objective and try again.');
      } else {
        setExecutionCollapsed(true);
        try {
          const newCampaignId = crypto.randomUUID();
          const createRes = await fetchWithAuth('/api/campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: newCampaignId, companyId, name: 'Campaign from themes', description: 'Select a card and click Build Campaign Blueprint to set the strategic theme.', status: 'planning', current_stage: 'planning', build_mode: 'no_context' }) });
          if (createRes.ok) { const createData = await createRes.json().catch(() => ({})); setGeneratedCampaignId(createData?.campaign?.id ?? newCampaignId); }
        } catch (_) { setGeneratedCampaignId(null); }
      }
    } catch (e) { setValidationError(e instanceof Error ? e.message : 'Failed to generate themes'); }
    finally { setHasRun(true); setIsSubmitting(false); }
  };

  return {
    // State
    hasRun, contextMode, setContextMode, focusedModules, setFocusedModules, additionalDirection, setAdditionalDirection,
    clusterInputs, selectedAspects, setSelectedAspects, selectedFacets, setSelectedFacets, strategicText, setStrategicText,
    primaryCampaignType, secondaryCampaignTypes, selectPrimary, toggleSecondary,
    validationError, setValidationError, isSubmitting, regionInput, setRegionInput, regionWarning, setRegionWarning,
    jobId, jobStatus, jobError, jobRegionCount, consolidatedResult, historyDrawerOpen, setHistoryDrawerOpen,
    jobHistory, historyLoading,
    regionDropdownOpen, setRegionDropdownOpen,
    generatedEngineRecommendations, recommendationRefinements, setRecommendationRefinements,
    strategyStatusPayload, recommendationUserStateMap, setRecommendationUserStateMap,
    recommendationSignals, setRecommendationSignals, usedRecommendationIds, setUsedRecommendationIds,
    generatedCampaignId, setGeneratedCampaignId, fastLoadingCardId, setFastLoadingCardId,
    boltProgress, setBoltProgress, cardBuildError, setCardBuildError,
    strategyGuidanceMode, setStrategyModeWithHint, showStrategyDetails, setShowStrategyDetails,
    modeHint, meterReveal, insightSource, setInsightSource,
    strategyHistory,
    executionCollapsed, setExecutionCollapsed, targetAudience, setTargetAudience,
    professionalSegments, setProfessionalSegments,
    communicationStyle, setCommunicationStyle, contentDepth, setContentDepth,
    frequencyPerWeek, setFrequencyPerWeek, tentativeStartDate, setTentativeStartDate,
    campaignGoal, setCampaignGoal, mixPreFilled, setMixPreFilled,
    showStrategicSetupEditor, setShowStrategicSetupEditor,
    // Derived
    aspects, aspectOfferingsMap, offeringFacetCards,
    hierarchicalPayload, dilutionSeverity,
    visibleEngineCards, archivedEngineCards, longTermEngineCards,
    rankedEngineCardsWithStatus, workspaceSummaryData,
    strategicFlowState: workspaceSummaryData.flowState,
    suggestedStrategyMode, suggestedStrategyExplanation,
    strategyDrift, stabilizationRecommendation, strategyFocusLabel,
    campaignFocusLabels,
    requiredExecutionFields, isExecutionFormComplete, isExecutionValid, hasStrategicMixPrefill,
    // Functions
    handleRun, handleAddCustomPillar, handleViewIntelligence,
    buildAiChatExecutionConfig, buildSourceStrategicTheme,
    isValid,
    // Misc
    intelligentMixContext, boltTextPreset,
    polledJob, isMountedRef,
    // Custom pillar form
    customPillars, showAddCustomForm, setShowAddCustomForm, customTitle, setCustomTitle, customAngle, setCustomAngle,
    lastStrategicPayload,
  };
}
