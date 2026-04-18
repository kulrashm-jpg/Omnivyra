import React, { useState, useEffect, useRef, useMemo } from 'react';
import ReactDOM from 'react-dom';
import TrendCampaignsHistoryDrawer from './TrendCampaignsHistoryDrawer';
import TrendCampaignsRecommendationCards from './TrendCampaignsRecommendationCards';
import {
  CampaignAssistPanel,
  EMPTY_ASSIST_CONTEXT,
  type AssistContext,
} from '../../campaigns/CampaignAssistPanel';
import { useRouter } from 'next/router';

import type { OpportunityTabProps } from './types';
import EngineContextPanel from '../EngineContextPanel';
import UnifiedContextModeSelector, { type ContextMode, type FocusModule } from '../engine-framework/UnifiedContextModeSelector';
import StrategicAspectSelector from '../engine-framework/StrategicAspectSelector';
import EngineJobStatusPanel from '../../engines/EngineJobStatusPanel';
import { useEngineJobPolling } from '../../../hooks/useEngineJobPolling';
import OfferingFacetSelector from '../engine-framework/OfferingFacetSelector';
import StrategicConsole from '../engine-framework/StrategicConsole';
import RecommendationBlueprintCard, {
  getConfidenceTierForRecommendation,
  getJourneyState,
  getDecisionMomentumState,
  type BoltOutcomeView,
} from '../cards/RecommendationBlueprintCard';
import StrategicWorkspacePanel from '../StrategicWorkspacePanel';
import AIGenerationProgress from '../../AIGenerationProgress';
import BOLTProgressModal, { type BOLTProgress } from '../../BOLTProgressModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { TARGET_AUDIENCE_CATEGORIES, PROFESSIONAL_SEGMENTS } from '../../../lib/audienceCategories';
import { buildSourceStrategicTheme } from '../../../lib/recommendationStrategicCard';


import {
  TYPE,
  TREND_CLUSTER_PAYLOAD_BRIDGE,
  PULSE_TOPIC_BRIDGE,
  type ClusterInput,
  type PulseTopicBridge,
  type ExecutionConfig,
  type StrategicPayload,
  type StrategyStatusForProgress,
  type StrategicFlowState,
  type CardSignals,
  ISO_COUNTRIES,
  safeParseClusterPayload,
  matchCountry,
  tokenToIsoCode,
  regionInputToIsoCodes,
  getRecommendationPriorityScore,
  getProgressAdjustment,
  getStrategicFlowState,
  FLOW_SUMMARY_MESSAGES,
  StrategicFlowSummary,
} from './TrendCampaignsTabHelpers';
import type { StrategyStatusPayload } from '../../strategy/StrategyIntelligencePanel';




export function useTrendCampaignsCore(props: OpportunityTabProps) {
  const { companyId, regions, engineRecommendations, fetchWithAuth, strategicIntents, onStrategicIntentsChange, viewMode, campaignId, initialBlogId, intelligentMixContext: intelligentMixProp } = props;
  const router = useRouter();

  // Extended Intelligent Mix context type (includes optional campaign focus fields added later)
  type IntelligentMixContextWithFocus = import('@/pages/command-center/intelligent-mix-strategy').IntelligentMixState & {
    communicationStyle?: string[];
    primaryCampaignType?: PrimaryCampaignTypeId;
    secondaryCampaignTypes?: SecondaryOptionId[];
  };

  // ── Intelligent Mix context: from prop or sessionStorage ─────────────────
  const intelligentMixContext = React.useMemo(() => {
    if (intelligentMixProp) return intelligentMixProp;
    try {
      const raw = sessionStorage.getItem('intelligent-mix-strategy-state');
      if (raw) {
        const q = router.query as Record<string, string | undefined>;
        // Only apply if arriving via intelligentMix=1 query param (not on every visit)
        if (q.intelligentMix === '1') return JSON.parse(raw) as import('@/pages/command-center/intelligent-mix-strategy').IntelligentMixState;
      }
    } catch { /* ignore */ }
    return null;
  }, [intelligentMixProp, router.isReady, router.query.intelligentMix]);

  // ── BOLT (Text) preset from setup page query params ──────────────────────
  const boltTextPreset = React.useMemo(() => {
    if (!router.isReady) return undefined;
    const q = router.query as Record<string, string | string[] | undefined>;
    if (typeof q.boltText !== 'string' || q.boltText !== '1') return undefined;
    const format = (typeof q.format === 'string' ? q.format : 'post') as import('../cards/RecommendationBlueprintCard').BoltContentFormat;
    const duration = Math.min(4, Math.max(1, parseInt(typeof q.duration === 'string' ? q.duration : '2', 10)));
    const outcomeView = (['week_plan', 'daily_plan', 'schedule'].includes(typeof q.outcomeView === 'string' ? q.outcomeView : '')
      ? q.outcomeView as import('../cards/RecommendationBlueprintCard').BoltOutcomeView
      : 'week_plan');
    return { outcomeView, durationWeeks: duration, contentFormat: format };
  }, [router.isReady, router.query.boltText, router.query.format, router.query.duration, router.query.outcomeView]);
  // ─────────────────────────────────────────────────────────────────────────

  const [hasRun, setHasRun] = useState(false);
  const [contextMode, setContextMode] = useState<ContextMode>('FULL');
  const [focusedModules, setFocusedModules] = useState<FocusModule[]>([]);
  const [additionalDirection, setAdditionalDirection] = useState('');
  const [clusterInputs, setClusterInputs] = useState<ClusterInput[] | undefined>(undefined);
  const [selectedAspects, setSelectedAspects] = useState<string[]>([]);
  const [selectedFacets, setSelectedFacets] = useState<string[]>([]);
  const [strategicText, setStrategicText] = useState('');
  /** Campaign focus: one primary, optional secondaries (hierarchical). */
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
  // Job history (strategic memory): last 5 runs. Future: diffing when same pillars+regions re-run; optional per-company daily call budget at scale.
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [jobHistory, setJobHistory] = useState<{ jobId: string; status: string; regions: string[]; confidence_index: number | null; created_at: string }[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const clusterBridgeConsumedRef = useRef(false);
  const pulseBridgeConsumedRef = useRef(false);
  const regionInputRef = useRef<HTMLInputElement>(null);
  const themesSectionRef = useRef<HTMLDivElement>(null);
  const firstCardRef = useRef<HTMLDivElement | null>(null);
  const prevSubmittingRef = useRef(false);
  const [regionDropdownOpen, setRegionDropdownOpen] = useState(false);
  const [strategicConfig, setStrategicConfig] = useState<{
    strategic_aspects: string[];
    aspect_offerings_map: Record<string, string[]>;
    offerings_by_aspect?: Record<string, string[]>;
    strategic_objectives?: string[];
  } | null>(null);
  const [generatedEngineRecommendations, setGeneratedEngineRecommendations] = useState<
    Array<Record<string, unknown>>
  >([]);
  const [recommendationRefinements, setRecommendationRefinements] = useState<
    Record<string, Record<string, unknown>>
  >({});
  const [strategyStatusPayload, setStrategyStatusPayload] = useState<StrategyStatusPayload | null>(null);
  /** Recommendation snapshot id -> state (ACTIVE | ARCHIVED | LONG_TERM). From API + optimistic updates. */
  const [recommendationUserStateMap, setRecommendationUserStateMap] = useState<Record<string, string>>({});
  const [recommendationSignals, setRecommendationSignals] = useState<{
    archived: number;
    longTerm: number;
    adopted: number;
    totalRecommendations: number;
    adoptionRate: number;
  } | null>(null);
  /** Recommendation snapshot IDs already used by this company to create a campaign (hide from list). */
  const [usedRecommendationIds, setUsedRecommendationIds] = useState<Set<string>>(new Set());
  /** Campaign created when user clicked "Generate Strategic Themes"; card is saved to this campaign when they click "Build Campaign Blueprint". */
  const [generatedCampaignId, setGeneratedCampaignId] = useState<string | null>(null);
  const [fastLoadingCardId, setFastLoadingCardId] = useState<string | null>(null);
  /** BOLT run progress (stage, percentage) for progress modal. */
  const [boltProgress, setBoltProgress] = useState<BOLTProgress | null>(null);
  /** Per-card error when "Start this campaign" / "Build Campaign Blueprint" fails (shown on the card, not near Generate Themes). */
  const [cardBuildError, setCardBuildError] = useState<Record<string, string>>({});

  // ── Campaign Assist Panel ─────────────────────────────────────────────────
  const [assistPanelOpen,  setAssistPanelOpen]  = useState(false);
  const [assistTopic,      setAssistTopic]      = useState('');
  // Resolver for the Promise returned by openAssistPanel()
  const assistResolverRef  = useRef<((ctx: AssistContext) => void) | null>(null);
  // Tracks whether the blog-prefill auto-open has already fired for the current initialBlogId
  const blogPrefillFiredRef = useRef<string | null>(null);
  // Context pre-set by the standalone (blog-flow) panel open — consumed by next openAssistPanel() call
  const pendingAssistContextRef = useRef<AssistContext | null>(null);

  // Auto-open assist panel when arriving from blog → campaign flow
  useEffect(() => {
    if (!initialBlogId || blogPrefillFiredRef.current === initialBlogId) return;
    blogPrefillFiredRef.current = initialBlogId;
    assistResolverRef.current = null; // standalone mode — no pending promise
    setAssistTopic('');
    setAssistPanelOpen(true);
  }, [initialBlogId]);

  /** Opens the assist panel and resolves with the user's context choice.
   *  If the user pre-set context via the blog-flow panel, returns it immediately. */


  /** "Skip for now" — resolve with empty context so existing flow proceeds unchanged. */
  // ─────────────────────────────────────────────────────────────────────────

  const isMountedRef = useRef(true);
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  /** User-selectable strategy guidance: which momentum signals to emphasize (no backend). */
  const [strategyGuidanceMode, setStrategyGuidanceMode] = useState<'balanced' | 'continue' | 'expand'>('balanced');
  /** Expandable drift details (progressive reveal). Once expanded, stays open until refresh. */
  const [showStrategyDetails, setShowStrategyDetails] = useState(false);
  /** Transient hint shown after strategy mode change (clears after 1.5s). */
  const [modeHint, setModeHint] = useState<string | null>(null);
  /** Used for confidence meter soft fade (0.85 → 1 when concentration changes). */
  const [meterReveal, setMeterReveal] = useState(false);
  const prevConcentrationRef = useRef<number | undefined>(undefined);
  /** Intelligence source for campaign generation: hybrid (default), api, or llm. */
  const [insightSource, setInsightSource] = useState<'hybrid' | 'api' | 'llm'>('hybrid');
  /** Strategy history for journey badges (continuation/expansion); only set when campaigns_count > 0. */
  const [strategyHistory, setStrategyHistory] = useState<{
    campaigns_count: number;
    aspect_counts: Record<string, number>;
    dominant_aspects: string[];
    underused_aspects: string[];
    strategy_momentum: {
      dominant_streak_aspect: string | null;
      dominant_streak_count: number;
      diversification_score: number;
    } | null;
  } | null>(null);
  // Execution Configuration (compact bar) — mandatory before theme generation
  const [executionCollapsed, setExecutionCollapsed] = useState(false);
  const [targetAudience, setTargetAudience] = useState<string | null>(null);
  const [professionalSegments, setProfessionalSegments] = useState<string[]>([]);
  const [professionalDropdownOpen, setProfessionalDropdownOpen] = useState(false);
  const professionalDropdownRef = useRef<HTMLDivElement>(null);
  const professionalTriggerRef = useRef<HTMLButtonElement>(null);
  const professionalPortalRef = useRef<HTMLDivElement>(null);
  const [professionalDropdownRect, setProfessionalDropdownRect] = useState<{ top: number; left: number } | null>(null);
  const [showMissingFieldsMessage, setShowMissingFieldsMessage] = useState(false);
  const executionSectionRefs = useRef<Record<string, HTMLDivElement | null>>({
    targetAudience: null,
    campaignGoal: null,
    frequencyPerWeek: null,
    startDate: null,
    communicationStyle: null,
  });
  const [communicationStyle, setCommunicationStyle] = useState<string[]>([]);
  const [contentDepth, setContentDepth] = useState<string | null>(null);
  const [frequencyPerWeek, setFrequencyPerWeek] = useState<string | null>(null);
  const [tentativeStartDate, setTentativeStartDate] = useState<Date | undefined>();
  const [campaignGoal, setCampaignGoal] = useState<string | null>(null);
  const [executionCalendarOpen, setExecutionCalendarOpen] = useState(false);
  // Whether the execution config was pre-filled from Intelligent Mix (controls banner + hiding duplicate fields)
  const [mixPreFilled, setMixPreFilled] = useState(false);
  const [showStrategicSetupEditor, setShowStrategicSetupEditor] = useState(false);
  const autoRunIntelligentMixRef = useRef(false);

  // Tracks whether we've already applied the Intelligent Mix context — prevents re-running when
  // intelligentMixContext reference changes (JSON.parse returns a new object each useMemo call).
  const appliedMixSignatureRef = useRef<string | null>(null);
  const intelligentMixSignature = useMemo(() => {
    if (!intelligentMixContext) return null;
    try {
      return JSON.stringify(intelligentMixContext);
    } catch {
      return '__unserializable_mix_context__';
    }
  }, [intelligentMixContext]);

  // Pre-fill execution config from Intelligent Mix context on mount (runs only once).
  // Deps are stable primitives — NOT the intelligentMixContext object which gets a new reference on
  // every parent render (parent passes JSON.parse result as IIFE, creating a new object each time).
  useEffect(() => {
    if (!intelligentMixContext || !intelligentMixSignature) return;
    if (appliedMixSignatureRef.current === intelligentMixSignature) return;
    appliedMixSignatureRef.current = intelligentMixSignature;
    let appliedAnyPrefill = false;
    // target_audience — use first audience item
    if (intelligentMixContext.audience?.length && !targetAudience) {
      setTargetAudience(intelligentMixContext.audience[0]);
      appliedAnyPrefill = true;
    }
    // campaign_goal — derive from primary campaign type
    const ctx = intelligentMixContext as IntelligentMixContextWithFocus;
    if (ctx.primaryCampaignType && !campaignGoal) {
      const label = ctx.primaryCampaignType;
      // Map engine IDs to display labels for campaignGoal field
      const goalMap: Record<string, string> = {
        brand_awareness: 'Awareness',
        lead_generation: 'Leads',
        engagement_growth: 'Engagement',
        product_promotion: 'Product',
        authority_positioning: 'Awareness',
        network_expansion: 'Awareness',
        personal_brand_promotion: 'Awareness',
        third_party: 'Awareness',
      };
      if (label) {
        setCampaignGoal(goalMap[label] ?? 'Awareness');
        appliedAnyPrefill = true;
      }
    }
    // frequency — total per week across all formats
    if (!frequencyPerWeek) {
      const textTotal = (intelligentMixContext.textFormats ?? []).reduce(
        (s, f) => s + (intelligentMixContext.textFrequency?.[f] ?? 1), 0
      );
      const creatorTotal = (intelligentMixContext.creatorFormats ?? []).reduce(
        (s, f) => s + (intelligentMixContext.creatorFrequency?.[f] ?? 1), 0
      );
      const total = textTotal + creatorTotal;
      if (total > 0) {
        setFrequencyPerWeek(`${total}/w`);
        appliedAnyPrefill = true;
      }
    }
    // start date
    if (intelligentMixContext.startDate && !tentativeStartDate) {
      setTentativeStartDate(new Date(intelligentMixContext.startDate + 'T00:00:00'));
      appliedAnyPrefill = true;
    }
    // communication style
    if (ctx.communicationStyle?.length && communicationStyle.length === 0) {
      setCommunicationStyle(ctx.communicationStyle);
      appliedAnyPrefill = true;
    }
    // campaign focus — guarded to avoid overwriting user edits
    const canApplyPrimaryPrefill =
      ctx.primaryCampaignType &&
      primaryCampaignType === 'brand_awareness' &&
      secondaryCampaignTypes.length === 0 &&
      primaryCampaignType !== ctx.primaryCampaignType;
    if (canApplyPrimaryPrefill) {
      setPrimaryCampaignType(ctx.primaryCampaignType);
      appliedAnyPrefill = true;
    }
    if (ctx.secondaryCampaignTypes?.length && secondaryCampaignTypes.length === 0) {
      setSecondaryCampaignTypes(ctx.secondaryCampaignTypes);
      appliedAnyPrefill = true;
    }
    if (ctx.contextMode && contextMode === 'FULL') {
      setContextMode(ctx.contextMode);
      appliedAnyPrefill = true;
    }
    if (ctx.focusedModules?.length && focusedModules.length === 0) {
      setFocusedModules(ctx.focusedModules);
      appliedAnyPrefill = true;
    }
    if (ctx.additionalDirection && !additionalDirection.trim()) {
      setAdditionalDirection(ctx.additionalDirection);
      appliedAnyPrefill = true;
    }
    if (ctx.selectedAspects?.length && selectedAspects.length === 0) {
      setSelectedAspects(ctx.selectedAspects);
      appliedAnyPrefill = true;
    }
    if (ctx.selectedFacets?.length && selectedFacets.length === 0) {
      setSelectedFacets(ctx.selectedFacets);
      appliedAnyPrefill = true;
    }
    if (ctx.strategicText && !strategicText.trim()) {
      setStrategicText(ctx.strategicText);
      appliedAnyPrefill = true;
    }
    if (ctx.regionsInput && !regionInput.trim()) {
      setRegionInput(ctx.regionsInput);
      appliedAnyPrefill = true;
    }
    if (appliedAnyPrefill || !mixPreFilled) {
      setExecutionCollapsed(true);
      setMixPreFilled(true);
    }
    if (ctx.autoGenerateThemes) {
      setShowStrategicSetupEditor(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intelligentMixContext, intelligentMixSignature]);

  useEffect(() => {
    if (!professionalDropdownOpen) {
      setProfessionalDropdownRect(null);
      return;
    }
    const run = () => {
      const el = professionalTriggerRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        setProfessionalDropdownRect({ top: r.bottom + 4, left: r.left });
      }
    };
    run();
    const t = requestAnimationFrame(run);
    return () => cancelAnimationFrame(t);
  }, [professionalDropdownOpen]);

  useEffect(() => {
    if (!professionalDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const inTrigger = professionalDropdownRef.current?.contains(target);
      const inPortal = professionalPortalRef.current?.contains(target);
      if (!inTrigger && !inPortal) setProfessionalDropdownOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [professionalDropdownOpen]);

  const engineRecommendationSource =
    generatedEngineRecommendations.length > 0 ? generatedEngineRecommendations : (engineRecommendations ?? []);
  const engineRecommendationCards = useMemo<Array<{ id: string; recommendation: Record<string, unknown> }>>(() => {
    if (!Array.isArray(engineRecommendationSource) || engineRecommendationSource.length === 0) return [];
    return engineRecommendationSource.map((raw, index) => {
      const rec = (raw ?? {}) as Record<string, unknown>;
      const topic = typeof rec.topic === 'string' ? rec.topic : '';
      const polishedTitle = typeof rec.polished_title === 'string' ? rec.polished_title : '';
      const idBase =
        (typeof rec.snapshot_hash === 'string' && rec.snapshot_hash) ||
        (typeof rec.id === 'string' && rec.id) ||
        `${topic || polishedTitle || 'rec'}-${index}`;
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

  /** Cards with effective strategyStatus; sorted by mode (continue → continuation first, expand → expansion first, balanced → original order). */
  const visibleEngineCardsWithStatus = useMemo(() => {
    const hasHistory = strategyHistory && strategyHistory.campaigns_count > 0;
    const getStatus = (card: { id: string; recommendation: Record<string, unknown> }): 'continuation' | 'expansion' | 'neutral' | 'momentum_expand' | undefined => {
      if (!hasHistory) return undefined;
      const aspect =
        (typeof card.recommendation?.aspect === 'string' && card.recommendation.aspect.trim())
          ? card.recommendation.aspect
          : (typeof card.recommendation?.selected_aspect === 'string' && card.recommendation.selected_aspect.trim())
            ? card.recommendation.selected_aspect
            : selectedAspects[0] ?? '';
      if (!aspect) return 'neutral';
      const momentum = strategyHistory!.strategy_momentum;
      const rawContinuation = strategyHistory!.dominant_aspects.includes(aspect);
      const rawExpansion = strategyHistory!.underused_aspects.includes(aspect);
      const rawMomentumExpand = !!(momentum && momentum.dominant_streak_count >= 2 && rawExpansion);
      if (strategyGuidanceMode === 'continue') {
        return rawContinuation ? 'continuation' : 'neutral';
      }
      if (strategyGuidanceMode === 'expand') {
        if (rawMomentumExpand || rawExpansion) return 'expansion';
        return 'neutral';
      }
      if (rawMomentumExpand) return 'momentum_expand';
      if (rawContinuation) return 'continuation';
      if (rawExpansion) return 'expansion';
      return 'neutral';
    };
    const withStatus = visibleEngineCards.map((card) => ({
      card,
      strategyStatus: getStatus(card),
    }));
    if (strategyGuidanceMode === 'continue') {
      return [...withStatus].sort((a, b) => {
        const p = (s: typeof a.strategyStatus) => (s === 'continuation' ? 0 : 1);
        return p(a.strategyStatus) - p(b.strategyStatus);
      });
    }
    if (strategyGuidanceMode === 'expand') {
      return [...withStatus].sort((a, b) => {
        const p = (s: typeof a.strategyStatus) =>
          s === 'expansion' || s === 'momentum_expand' ? 0 : 1;
        return p(a.strategyStatus) - p(b.strategyStatus);
      });
    }
    return withStatus;
  }, [visibleEngineCards, strategyHistory, strategyGuidanceMode, selectedAspects]);

  /** Ranked list: strategic score + progress adjustment, stable sort. Top 2 get isTopPriority; resurfaced get label. */
  const rankedEngineCardsWithStatus = useMemo(() => {
    const withScore = visibleEngineCardsWithStatus.map((item, originalIndex) => {
      const baseScore = getRecommendationPriorityScore(item.card);
      const { adjustment, resurfaced } = getProgressAdjustment(
        item.card,
        item.strategyStatus,
        recommendationUserStateMap
      );
      return {
        ...item,
        score: baseScore + adjustment,
        originalIndex,
        resurfaced,
      };
    });
    withScore.sort((a, b) => {
      const d = b.score - a.score;
      if (d !== 0) return d;
      return a.originalIndex - b.originalIndex;
    });
    return withScore.map((item, index) => ({
      card: item.card,
      strategyStatus: item.strategyStatus,
      isTopPriority: index < 2,
      resurfaced: item.resurfaced,
    }));
  }, [visibleEngineCardsWithStatus, recommendationUserStateMap]);

  /** List-level strategic flow + workspace signals. Narrative only; no backend. */
  const workspaceSummaryData = useMemo(() => {
    const cardsWithSignals: CardSignals[] = rankedEngineCardsWithStatus.map(
      ({ card, strategyStatus, isTopPriority, resurfaced }) => {
        const journeyState = getJourneyState({
          strategyStatus,
          isTopPriority,
          resurfaced,
        });
        const confidenceTier = getConfidenceTierForRecommendation(card.recommendation);
        const momentumState = getDecisionMomentumState({
          confidenceTier,
          journeyState,
          strategyStatus,
        });
        const rec = card.recommendation ?? {};
        const cardTitle =
          (typeof rec.polished_title === 'string' && rec.polished_title.trim()
            ? rec.polished_title
            : null) ??
          (typeof rec.topic === 'string' && rec.topic.trim() ? rec.topic : null) ??
          'Opportunity';
        return {
          journeyState,
          confidenceTier,
          momentumState,
          strategyStatus,
          cardId: card.id,
          cardTitle,
        };
      }
    );
    const flowState = getStrategicFlowState(cardsWithSignals);
    return { flowState, cardsWithSignals };
  }, [rankedEngineCardsWithStatus]);

  const strategicFlowState = workspaceSummaryData.flowState;
  const highlightedState =
    typeof router.query.state === 'string' && (router.query.state === 'ARCHIVED' || router.query.state === 'LONG_TERM')
      ? router.query.state
      : null;

  /** Suggested strategy mode from momentum (deterministic, no backend). Shown only when campaigns_count >= 2. */
  const suggestedStrategyMode = useMemo((): 'balanced' | 'continue' | 'expand' | null => {
    if (!strategyHistory || strategyHistory.campaigns_count < 2) return null;
    const momentum = strategyHistory.strategy_momentum;
    if (!momentum) return null;
    const { dominant_streak_count, diversification_score } = momentum;
    if (dominant_streak_count >= 2) return 'expand';
    if (diversification_score >= 0.6) return 'continue';
    return 'balanced';
  }, [strategyHistory]);

  /** Short explanation for suggested mode (deterministic, from existing strategy_momentum only). */
  const suggestedStrategyExplanation = useMemo(() => {
    if (!strategyHistory) return null;
    const momentum = strategyHistory.strategy_momentum;
    if (!momentum) return null;
    const { dominant_streak_count, diversification_score } = momentum;
    if (suggestedStrategyMode === 'expand' && dominant_streak_count >= 2) {
      return `Your last ${dominant_streak_count} campaigns focused on the same strategy. Expanding helps diversify your direction.`;
    }
    if (suggestedStrategyMode === 'continue' && diversification_score >= 0.6) {
      return `Your recent campaigns already cover multiple strategies. Continuing strengthens your current momentum.`;
    }
    if (suggestedStrategyMode === 'balanced') {
      return `Your strategy usage is balanced. Keeping a mixed approach is recommended.`;
    }
    return null;
  }, [strategyHistory, suggestedStrategyMode]);

  /** Strategy drift: advisory when recent campaigns span too many directions (frontend-only, deterministic). */
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

  /** When drift exists: recommend stabilizing toward strongest aspect (advisory only, deterministic). */
  const stabilizationRecommendation = useMemo(() => {
    if (!strategyDrift?.hasDrift || !strategyHistory) return null;
    const aspectCounts = strategyHistory.aspect_counts ?? {};
    const entries = Object.entries(aspectCounts);
    if (entries.length === 0) return null;
    const [topAspect, topCount] = entries.sort((a, b) => b[1] - a[1])[0];
    if (topCount <= 1) return null;
    return { aspect: topAspect, count: topCount };
  }, [strategyDrift, strategyHistory]);

  /** Focus label for confidence meter — uses existing strategyDrift.concentration, no new calculations. */
  const strategyFocusLabel =
    strategyDrift?.concentration != null
      ? strategyDrift.concentration > 0.7
        ? 'Strong Focus'
        : strategyDrift.concentration >= 0.5
        ? 'Moderate'
        : 'Fragmented'
      : null;

  /** Soft fade when concentration value changes (opacity 0.85 → 1). */
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

  const hierarchicalPayload = useMemo(
    () => buildHierarchicalPayload(primaryCampaignType, secondaryCampaignTypes),
    [primaryCampaignType, secondaryCampaignTypes]
  );
  const dilutionSeverity = useMemo(
    () =>
      primaryCampaignType && secondaryCampaignTypes.length > 0
        ? getDilutionSeverity(primaryCampaignType, secondaryCampaignTypes)
        : 'none',
    [primaryCampaignType, secondaryCampaignTypes]
  );


  /** Set strategy mode and show transient micro-confirmation (no toast). */

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
  }>(
    jobId,
    jobId ? `/api/recommendations/job/${jobId}` : null,
    fetchWithAuth,
    { enabled: !!jobId }
  );

  useEffect(() => {
    if (!polledJob) return;
    if (polledJob.status) setJobStatus(polledJob.status as typeof jobStatus);
    if (polledJob.status === 'COMPLETED' || polledJob.status === 'COMPLETED_WITH_WARNINGS') {
      const cr = polledJob.consolidated_result;
      setConsolidatedResult(
        cr
          ? {
              global_opportunities: cr.global_opportunities ?? [],
              region_specific_insights: cr.region_specific_insights ?? {},
              execution_priority_order: cr.execution_priority_order ?? [],
              consolidated_risks: cr.consolidated_risks ?? [],
              strategic_summary: cr.strategic_summary ?? '',
              confidence_index: cr.confidence_index,
            }
          : null
      );
    }
    if (polledJob.status === 'FAILED' && polledJob.error) {
      setJobError(polledJob.error);
    }
  }, [polledJob]);

  useEffect(() => {
    setValidationError(null);
  }, [contextMode, selectedAspects, selectedFacets, strategicText, primaryCampaignType, secondaryCampaignTypes]);

  useEffect(() => {
    if (typeof window === 'undefined' || pulseBridgeConsumedRef.current) return;
    const raw = localStorage.getItem(PULSE_TOPIC_BRIDGE);
    if (!raw) return;
    pulseBridgeConsumedRef.current = true;
    try {
      const parsed = JSON.parse(raw) as PulseTopicBridge;
      if (!parsed?.topic) return;
      try {
        localStorage.removeItem(PULSE_TOPIC_BRIDGE);
      } catch {
        /* ignore */
      }
      const template = `Topic from Market Pulse: ${parsed.topic}
Narrative phase: ${parsed.narrative_phase ?? '—'}
Momentum score: ${parsed.momentum_score != null ? (parsed.momentum_score * 100).toFixed(0) + '%' : '—'}
Generate strategic campaign pillars to capture this opportunity.`;
      setStrategicText(template);
      if (Array.isArray(parsed.regions) && parsed.regions.length > 0) {
        setRegionInput(parsed.regions.join(', '));
      }
    } catch {
      /* ignore */
    }
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
    const template = `Emerging demand detected in: ${first.problem_domain}
Intent intensity: ${first.avg_intent_score}
Urgency level: ${first.avg_urgency_score}
Signal count: ${first.signal_count}
Priority index: ${first.priority_score}

Generate strategic campaign pillars to capture this demand.`;
    setStrategicText(template);
  }, [router.query?.cluster_payload, router.isReady]);

  // After generation: scroll to top two cards (or results section when empty)
  useEffect(() => {
    const wasSubmitting = prevSubmittingRef.current;
    prevSubmittingRef.current = isSubmitting;
    if (!wasSubmitting || isSubmitting || !hasRun) return;
    requestAnimationFrame(() => {
      if (visibleEngineCards.length > 0) {
        // Hop to first card so top two are visible
        firstCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        // Empty result: scroll to cards section so user sees the empty state
        (cardsSectionRef.current ?? document.getElementById('recommendation-cards'))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }, [isSubmitting, hasRun, visibleEngineCards.length]);

  // When opening with #cards (e.g. from Content Architect hub), scroll to recommendation cards section
  const cardsSectionRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash;
    if (hash !== '#cards') return;
    const el = cardsSectionRef.current ?? document.getElementById('recommendation-cards');
    if (el) {
      const t = setTimeout(() => {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
      return () => clearTimeout(t);
    }
  }, [companyId]);

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
    if (!companyId || !fetchWithAuth) {
      setRecommendationUserStateMap({});
      return;
    }
    fetchWithAuth(`/api/recommendations/user-state-map?companyId=${encodeURIComponent(companyId)}`)
      .then((res) => (res.ok ? res.json() : {}))
      .then((data) => (typeof data === 'object' && data !== null ? data : {}))
      .then(setRecommendationUserStateMap)
      .catch(() => setRecommendationUserStateMap({}));
  }, [companyId, fetchWithAuth]);

  useEffect(() => {
    if (!companyId) {
      setUsedRecommendationIds(new Set());
      return;
    }
    fetchWithAuth(`/api/recommendations/used-by-company?companyId=${encodeURIComponent(companyId)}`)
      .then((res) => (res.ok ? res.json() : { usedRecommendationIds: [] }))
      .then((data) =>
        setUsedRecommendationIds(
          new Set(Array.isArray(data?.usedRecommendationIds) ? data.usedRecommendationIds : [])
        )
      )
      .catch(() => setUsedRecommendationIds(new Set()));
  }, [companyId, fetchWithAuth]);

  useEffect(() => {
    if (!companyId) {
      setStrategyHistory(null);
      return;
    }
    fetchWithAuth(`/api/recommendations/strategy-history?companyId=${encodeURIComponent(companyId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && typeof data.campaigns_count === 'number' && data.campaigns_count > 0) {
          const sm = data.strategy_momentum && typeof data.strategy_momentum === 'object';
          const aspect_counts = data.aspect_counts && typeof data.aspect_counts === 'object' ? data.aspect_counts : {};
          setStrategyHistory({
            campaigns_count: data.campaigns_count,
            aspect_counts,
            dominant_aspects: Array.isArray(data.dominant_aspects) ? data.dominant_aspects : [],
            underused_aspects: Array.isArray(data.underused_aspects) ? data.underused_aspects : [],
            strategy_momentum: sm
              ? {
                  dominant_streak_aspect: data.strategy_momentum.dominant_streak_aspect ?? null,
                  dominant_streak_count: typeof data.strategy_momentum.dominant_streak_count === 'number' ? data.strategy_momentum.dominant_streak_count : 0,
                  diversification_score: typeof data.strategy_momentum.diversification_score === 'number' ? data.strategy_momentum.diversification_score : 0,
                }
              : null,
          });
        } else {
          setStrategyHistory(null);
        }
      })
      .catch(() => setStrategyHistory(null));
  }, [companyId, fetchWithAuth]);

  useEffect(() => {
    if (!campaignId?.trim() || !fetchWithAuth) {
      setStrategyStatusPayload(null);
      return;
    }
    fetchWithAuth(`/api/campaigns/${encodeURIComponent(campaignId)}/strategy-status`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setStrategyStatusPayload(data ?? null))
      .catch(() => setStrategyStatusPayload(null));
  }, [campaignId, fetchWithAuth]);

  useEffect(() => {
    if (!companyId || !fetchWithAuth) {
      setRecommendationUserStateMap({});
      setRecommendationSignals(null);
      return;
    }
    let cancelled = false;
    fetchWithAuth(`/api/recommendations/user-state-map?companyId=${encodeURIComponent(companyId)}`)
      .then((res) => (res.ok ? res.json() : {}))
      .then((data) => {
        if (cancelled) return;
        setRecommendationUserStateMap(data && typeof data === 'object' ? data as Record<string, string> : {});
      })
      .catch(() => {
        if (!cancelled) setRecommendationUserStateMap({});
      });
    fetchWithAuth(`/api/recommendations/strategy-signals?companyId=${encodeURIComponent(companyId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        setRecommendationSignals(data && typeof data === 'object'
          ? {
              archived: Number((data as any).archived) || 0,
              longTerm: Number((data as any).longTerm) || 0,
              adopted: Number((data as any).adopted) || 0,
              totalRecommendations: Number((data as any).totalRecommendations) || 0,
              adoptionRate: Number((data as any).adoptionRate) || 0,
            }
          : null);
      })
      .catch(() => {
        if (!cancelled) setRecommendationSignals(null);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, fetchWithAuth]);



  // Load company-specific strategic config from backend (aspects + offerings_by_aspect). No frontend derivation.
  useEffect(() => {
    if (!companyId) {
      setStrategicConfig(null);
      return;
    }
    let cancelled = false;
    fetchWithAuth(`/api/company-profile?companyId=${encodeURIComponent(companyId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        const config = data?.recommendation_strategic_config;
        const map = config?.offerings_by_aspect ?? config?.aspect_offerings_map;
        if (config && Array.isArray(config.strategic_aspects) && typeof map === 'object') {
          const sortAz = (a: string, b: string) => a.trim().toLowerCase().localeCompare(b.trim().toLowerCase(), undefined, { sensitivity: 'base' });
          const sortedAspects = [...config.strategic_aspects].sort(sortAz);
          const sortedMap: Record<string, string[]> = {};
          for (const [k, v] of Object.entries(map ?? {})) {
            sortedMap[k] = Array.isArray(v) ? [...v].sort(sortAz) : [];
          }
          setStrategicConfig({
            strategic_aspects: sortedAspects,
            aspect_offerings_map: sortedMap,
            offerings_by_aspect: sortedMap,
            strategic_objectives: Array.isArray(config.strategic_objectives) ? [...config.strategic_objectives].sort(sortAz) : undefined,
          });
        } else {
          setStrategicConfig(null);
        }
      })
      .catch(() => {
        if (!cancelled) setStrategicConfig(null);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, fetchWithAuth]);

  const aspects = strategicConfig?.strategic_aspects ?? [];
  const aspectOfferingsMap = strategicConfig?.aspect_offerings_map ?? strategicConfig?.offerings_by_aspect ?? {};

  // Offerings from all selected aspects (OR: union of offerings).
  const offeringsForSelectedAspect = useMemo(() => {
    if (selectedAspects.length === 0) return [];
    const seen = new Set<string>();
    for (const aspect of selectedAspects) {
      const ids = aspectOfferingsMap[aspect];
      if (Array.isArray(ids)) ids.forEach((id) => seen.add(id));
    }
    return Array.from(seen);
  }, [selectedAspects, aspectOfferingsMap]);

  const offeringFacetCards = useMemo(() => {
    return offeringsForSelectedAspect.map((id: string) => {
      const title = id.includes(':') ? id.split(':').slice(1).join(':').trim() || id : id;
      return { id, title, description: title };
    });
  }, [offeringsForSelectedAspect]);

  // When aspects change, keep only facets that belong to any selected aspect.
  useEffect(() => {
    if (selectedAspects.length === 0 || selectedFacets.length === 0) return;
    const allowed = new Set<string>();
    for (const aspect of selectedAspects) {
      const ids = aspectOfferingsMap[aspect];
      if (Array.isArray(ids)) ids.forEach((id) => allowed.add(id));
    }
    const next = selectedFacets.filter((id) => allowed.has(id));
    if (next.length !== selectedFacets.length) setSelectedFacets(next);
  }, [selectedAspects, aspectOfferingsMap]);



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
    return {
      completed: hasAudience && hasGoal && hasFrequency && hasStartDate && hasStyle,
      completedCount: [hasAudience, hasGoal, hasFrequency, hasStartDate, hasStyle].filter(Boolean).length,
      missing,
    };
  }, [targetAudience, campaignGoal, frequencyPerWeek, tentativeStartDate, communicationStyle]);

  useEffect(() => {
    if (requiredExecutionFields.completed) {
      setShowMissingFieldsMessage(false);
    } else if (mixPreFilled) {
      // Fields are missing even though Intelligent Mix pre-filled — show the config so user can complete them
      setExecutionCollapsed(false);
    }
  }, [requiredExecutionFields.completed, mixPreFilled]);

  const isExecutionFormComplete = requiredExecutionFields.completed;
  const isExecutionValid = isExecutionFormComplete;
  const hasStrategicMixPrefill = Boolean(
    intelligentMixContext &&
    (
      (intelligentMixContext as IntelligentMixContextWithFocus).contextMode ||
      (intelligentMixContext as IntelligentMixContextWithFocus).strategicText ||
      (intelligentMixContext as IntelligentMixContextWithFocus).selectedAspects?.length ||
      (intelligentMixContext as IntelligentMixContextWithFocus).selectedFacets?.length ||
      (intelligentMixContext as IntelligentMixContextWithFocus).regionsInput
    )
  );


  const executionFieldKeyToLabel: Record<string, string> = {
    targetAudience: 'Target Audience',
    campaignGoal: 'Campaign Goal',
    frequencyPerWeek: 'Frequency per week',
    startDate: 'Start Date',
    communicationStyle: 'Communication Style',
  };



  const campaignFocusLabels = useMemo(() => {
    const primaryLabel = PRIMARY_OPTIONS.find((o) => o.id === primaryCampaignType)?.label ?? '';
    const secondaryLabels = isPersonalBrandPrimary(primaryCampaignType)
      ? secondaryCampaignTypes
          .map((id) => PERSONAL_BRAND_SECONDARY_GROUPS.flatMap((g) => g.options).find((o) => o.id === id)?.label)
          .filter(Boolean) as string[]
      : secondaryCampaignTypes
          .map((id) => getSecondaryOptionsForPrimary(primaryCampaignType).find((o) => o.id === id)?.label)
          .filter(Boolean) as string[];
    return [primaryLabel, ...secondaryLabels].filter(Boolean);
  }, [primaryCampaignType, secondaryCampaignTypes]);

  useEffect(() => {
    if (onStrategicIntentsChange && campaignFocusLabels.length > 0) {
      onStrategicIntentsChange(campaignFocusLabels);
    }
  }, [campaignFocusLabels, onStrategicIntentsChange]);



  const modeIndicatorLabel =
    contextMode === 'FULL'
      ? 'Using full company context for recommendations.'
      : contextMode === 'FOCUSED' && focusedModules.length > 0
        ? `Focused on: ${focusedModules.join(', ')}.`
        : contextMode === 'NONE'
          ? 'No company context; use research direction below.'
          : 'Context: ' + contextMode;

  const showNoCompanyMessage = !companyId;


  return {
    showNoCompanyMessage,
    additionalDirection,
    appliedMixSignatureRef,
    archivedEngineCards,
    aspectOfferingsMap,
    aspects,
    assistPanelOpen,
    assistResolverRef,
    assistTopic,
    autoRunIntelligentMixRef,
    blogPrefillFiredRef,
    boltProgress,
    boltTextPreset,
    campaignFocusLabels,
    campaignGoal,
    campaignId,
    cardBuildError,
    cardsSectionRef,
    clusterBridgeConsumedRef,
    clusterInputs,
    communicationStyle,
    companyId,
    consolidatedResult,
    contentDepth,
    contextMode,
    customAngle,
    customPillars,
    customTitle,
    dilutionSeverity,
    engineRecommendationCards,
    engineRecommendationSource,
    engineRecommendations,
    executionCalendarOpen,
    executionCollapsed,
    executionSectionRefs,
    fastLoadingCardId,
    fetchWithAuth,
    firstCardRef,
    focusedModules,
    frequencyPerWeek,
    generatedCampaignId,
    generatedEngineRecommendations,
    hasRun,
    hasStrategicMixPrefill,
    hierarchicalPayload,
    highlightedState,
    historyDrawerOpen,
    historyLoading,
    initialBlogId,
    insightSource,
    intelligentMixContext,
    intelligentMixSignature,
    isExecutionFormComplete,
    isExecutionValid,
    isMountedRef,
    isSubmitting,
    jobError,
    jobHistory,
    jobId,
    jobRegionCount,
    jobStatus,
    lastStrategicPayload,
    longTermEngineCards,
    meterReveal,
    mixPreFilled,
    modeHint,
    modeIndicatorLabel,
    offeringFacetCards,
    offeringsForSelectedAspect,
    onStrategicIntentsChange,
    pendingAssistContextRef,
    prevConcentrationRef,
    prevSubmittingRef,
    primaryCampaignType,
    professionalDropdownOpen,
    professionalDropdownRect,
    professionalDropdownRef,
    professionalPortalRef,
    professionalSegments,
    professionalTriggerRef,
    pulseBridgeConsumedRef,
    rankedEngineCardsWithStatus,
    recommendationRefinements,
    recommendationSignals,
    recommendationUserStateMap,
    regionDropdownOpen,
    regionInput,
    regionInputRef,
    regionWarning,
    regions,
    requiredExecutionFields,
    router,
    secondaryCampaignTypes,
    selectedAspects,
    selectedFacets,
    setAdditionalDirection,
    setAssistPanelOpen,
    setAssistTopic,
    setBoltProgress,
    setCampaignGoal,
    setCardBuildError,
    setClusterInputs,
    setCommunicationStyle,
    setConsolidatedResult,
    setContentDepth,
    setContextMode,
    setCustomAngle,
    setCustomPillars,
    setCustomTitle,
    setExecutionCalendarOpen,
    setExecutionCollapsed,
    setFastLoadingCardId,
    setFocusedModules,
    setFrequencyPerWeek,
    setGeneratedCampaignId,
    setGeneratedEngineRecommendations,
    setHasRun,
    setHistoryDrawerOpen,
    setHistoryLoading,
    setInsightSource,
    setIsSubmitting,
    setJobError,
    setJobHistory,
    setJobId,
    setJobRegionCount,
    setJobStatus,
    setLastStrategicPayload,
    setMeterReveal,
    setMixPreFilled,
    setModeHint,
    setPrimaryCampaignType,
    setProfessionalDropdownOpen,
    setProfessionalDropdownRect,
    setProfessionalSegments,
    setRecommendationRefinements,
    setRecommendationSignals,
    setRecommendationUserStateMap,
    setRegionDropdownOpen,
    setRegionInput,
    setRegionWarning,
    setSecondaryCampaignTypes,
    setSelectedAspects,
    setSelectedFacets,
    setShowAddCustomForm,
    setShowMissingFieldsMessage,
    setShowStrategicSetupEditor,
    setShowStrategyDetails,
    setStrategicConfig,
    setStrategicText,
    setStrategyGuidanceMode,
    setStrategyHistory,
    setStrategyStatusPayload,
    setTargetAudience,
    setTentativeStartDate,
    setUsedRecommendationIds,
    setValidationError,
    showAddCustomForm,
    showMissingFieldsMessage,
    showStrategicSetupEditor,
    showStrategyDetails,
    stabilizationRecommendation,
    strategicConfig,
    strategicFlowState,
    strategicIntents,
    strategicText,
    strategyDrift,
    strategyFocusLabel,
    strategyGuidanceMode,
    strategyHistory,
    strategyStatusPayload,
    suggestedStrategyExplanation,
    suggestedStrategyMode,
    targetAudience,
    tentativeStartDate,
    themesSectionRef,
    usedRecommendationIds,
    validationError,
    viewMode,
    visibleEngineCards,
    visibleEngineCardsWithStatus,
    workspaceSummaryData,
  };

  return {
    polledJob,
    additionalDirection,
    appliedMixSignatureRef,
    archivedEngineCards,
    aspectOfferingsMap,
    aspects,
    assistPanelOpen,
    assistResolverRef,
    assistTopic,
    autoRunIntelligentMixRef,
    blogPrefillFiredRef,
    boltProgress,
    boltTextPreset,
    campaignFocusLabels,
    campaignGoal,
    campaignId,
    cardBuildError,
    cardsSectionRef,
    clusterBridgeConsumedRef,
    clusterInputs,
    communicationStyle,
    companyId,
    consolidatedResult,
    contentDepth,
    contextMode,
    customAngle,
    customPillars,
    customTitle,
    dilutionSeverity,
    engineRecommendationCards,
    engineRecommendationSource,
    engineRecommendations,
    executionCalendarOpen,
    executionCollapsed,
    executionFieldKeyToLabel,
    executionSectionRefs,
    fastLoadingCardId,
    fetchWithAuth,
    firstCardRef,
    focusedModules,
    frequencyPerWeek,
    generatedCampaignId,
    generatedEngineRecommendations,
    hasRun,
    hasStrategicMixPrefill,
    hierarchicalPayload,
    highlightedState,
    historyDrawerOpen,
    historyLoading,
    initialBlogId,
    insightSource,
    intelligentMixContext,
    intelligentMixSignature,
    isExecutionFormComplete,
    isExecutionValid,
    isMountedRef,
    isSubmitting,
    jobError,
    jobHistory,
    jobId,
    jobRegionCount,
    jobStatus,
    lastStrategicPayload,
    longTermEngineCards,
    meterReveal,
    mixPreFilled,
    modeHint,
    modeIndicatorLabel,
    offeringFacetCards,
    offeringsForSelectedAspect,
    onStrategicIntentsChange,
    pendingAssistContextRef,
    prevConcentrationRef,
    prevSubmittingRef,
    primaryCampaignType,
    professionalDropdownOpen,
    professionalDropdownRect,
    professionalDropdownRef,
    professionalPortalRef,
    professionalSegments,
    professionalTriggerRef,
    pulseBridgeConsumedRef,
    rankedEngineCardsWithStatus,
    recommendationRefinements,
    recommendationSignals,
    recommendationUserStateMap,
    regionDropdownOpen,
    regionInput,
    regionInputRef,
    regionWarning,
    regions,
    requiredExecutionFields,
    router,
    secondaryCampaignTypes,
    selectedAspects,
    selectedFacets,
    setAdditionalDirection,
    setAssistPanelOpen,
    setAssistTopic,
    setBoltProgress,
    setCampaignGoal,
    setCardBuildError,
    setClusterInputs,
    setCommunicationStyle,
    setConsolidatedResult,
    setContentDepth,
    setContextMode,
    setCustomAngle,
    setCustomPillars,
    setCustomTitle,
    setExecutionCalendarOpen,
    setExecutionCollapsed,
    setFastLoadingCardId,
    setFocusedModules,
    setFrequencyPerWeek,
    setGeneratedCampaignId,
    setGeneratedEngineRecommendations,
    setHasRun,
    setHistoryDrawerOpen,
    setHistoryLoading,
    setInsightSource,
    setIsSubmitting,
    setJobError,
    setJobHistory,
    setJobId,
    setJobRegionCount,
    setJobStatus,
    setLastStrategicPayload,
    setMeterReveal,
    setMixPreFilled,
    setModeHint,
    setPrimaryCampaignType,
    setProfessionalDropdownOpen,
    setProfessionalDropdownRect,
    setProfessionalSegments,
    setRecommendationRefinements,
    setRecommendationSignals,
    setRecommendationUserStateMap,
    setRegionDropdownOpen,
    setRegionInput,
    setRegionWarning,
    setSecondaryCampaignTypes,
    setSelectedAspects,
    setSelectedFacets,
    setShowAddCustomForm,
    setShowMissingFieldsMessage,
    setShowStrategicSetupEditor,
    setShowStrategyDetails,
    setStrategicConfig,
    setStrategicText,
    setStrategyGuidanceMode,
    setStrategyHistory,
    setStrategyStatusPayload,
    setTargetAudience,
    setTentativeStartDate,
    setUsedRecommendationIds,
    setValidationError,
    showAddCustomForm,
    showMissingFieldsMessage,
    showNoCompanyMessage,
    showStrategicSetupEditor,
    showStrategyDetails,
    stabilizationRecommendation,
    strategicConfig,
    strategicFlowState,
    strategicIntents,
    strategicText,
    strategyDrift,
    strategyFocusLabel,
    strategyGuidanceMode,
    strategyHistory,
    strategyStatusPayload,
    suggestedStrategyExplanation,
    suggestedStrategyMode,
    targetAudience,
    tentativeStartDate,
    themesSectionRef,
    usedRecommendationIds,
    validationError,
    viewMode,
    visibleEngineCards,
    visibleEngineCardsWithStatus,
    workspaceSummaryData,
  };
}
