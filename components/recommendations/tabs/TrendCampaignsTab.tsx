import React, { useState, useEffect, useRef, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { useRouter } from 'next/router';
import { v4 as uuidv4 } from 'uuid';
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

const TYPE = 'TREND';

export type ClusterInput = {
  problem_domain: string;
  signal_count: number;
  avg_intent_score: number;
  avg_urgency_score: number;
  priority_score: number;
};

const TREND_CLUSTER_PAYLOAD_BRIDGE = 'trend_cluster_payload_bridge';
const PULSE_TOPIC_BRIDGE = 'pulse_topic_bridge';

export type PulseTopicBridge = {
  topic: string;
  regions: string[];
  narrative_phase: string | null;
  momentum_score: number | null;
};

function safeParseClusterPayload(raw: string): { cluster_inputs?: ClusterInput[]; context_mode?: string } | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { cluster_inputs?: unknown }).cluster_inputs)) {
      return parsed as { cluster_inputs: ClusterInput[]; context_mode?: string };
    }
    return null;
  } catch {
    return null;
  }
}

/** Execution configuration (UX compact bar); injected into strategic payload. */
export type ExecutionConfig = {
  target_audience: string;
  /** Single segment for backward compatibility (first of professional_segments). */
  professional_segment: string | null;
  /** Multiple professional segments when Target Audience is Professionals. */
  professional_segments: string[];
  communication_style: string[];
  content_depth: string;
  /** Desired posting frequency per week (e.g. "5/w"). Capacity is collected in AI Chat. */
  frequency_per_week: string;
  campaign_duration?: number;
  tentative_start: string | undefined;
  campaign_goal: string;
};

/** Payload sent to backend and stored for attribution (matches API shape). */
export type StrategicPayload = {
  context_mode: string;
  company_context: Record<string, unknown>;
  selected_offerings: string[];
  selected_aspect: string | null;
  /** Multiple aspects; treated as OR (recommendations match any). */
  selected_aspects?: string[];
  strategic_text: string;
  strategic_intents?: string[];
  regions?: string[];
  cluster_inputs?: ClusterInput[];
  focused_modules?: string[];
  additional_direction?: string;
  /** Hierarchical campaign focus: primary + secondaries → mapped core types for engine. */
  primary_campaign_type?: PrimaryCampaignTypeId;
  secondary_campaign_types?: SecondaryOptionId[];
  context?: 'business' | 'personal' | 'third_party';
  mapped_core_types?: string[];
  /** Execution configuration from compact bar (Phase 1 UX). */
  execution_config?: ExecutionConfig;
};

/** Country name → ISO 2-letter code for autocomplete and resolution. */
const ISO_COUNTRIES = [
  { name: 'India', code: 'IN' },
  { name: 'United States', code: 'US' },
  { name: 'United Kingdom', code: 'GB' },
  { name: 'Germany', code: 'DE' },
  { name: 'France', code: 'FR' },
  { name: 'Canada', code: 'CA' },
  { name: 'Australia', code: 'AU' },
  { name: 'Singapore', code: 'SG' },
  { name: 'UAE', code: 'AE' },
  { name: 'Japan', code: 'JP' },
  { name: 'Indonesia', code: 'ID' },
  { name: 'Italy', code: 'IT' },
  { name: 'Spain', code: 'ES' },
  { name: 'Brazil', code: 'BR' },
  { name: 'Mexico', code: 'MX' },
  { name: 'Netherlands', code: 'NL' },
  { name: 'South Korea', code: 'KR' },
  { name: 'China', code: 'CN' },
  { name: 'Hong Kong', code: 'HK' },
  { name: 'Ireland', code: 'IE' },
  { name: 'New Zealand', code: 'NZ' },
  { name: 'South Africa', code: 'ZA' },
  { name: 'Sweden', code: 'SE' },
  { name: 'Norway', code: 'NO' },
  { name: 'Denmark', code: 'DK' },
  { name: 'Finland', code: 'FI' },
  { name: 'Poland', code: 'PL' },
  { name: 'Belgium', code: 'BE' },
  { name: 'Switzerland', code: 'CH' },
  { name: 'Austria', code: 'AT' },
  { name: 'Portugal', code: 'PT' },
  { name: 'Greece', code: 'GR' },
  { name: 'Turkey', code: 'TR' },
  { name: 'Israel', code: 'IL' },
  { name: 'Saudi Arabia', code: 'SA' },
  { name: 'Malaysia', code: 'MY' },
  { name: 'Thailand', code: 'TH' },
  { name: 'Philippines', code: 'PH' },
  { name: 'Vietnam', code: 'VN' },
  { name: 'Argentina', code: 'AR' },
  { name: 'Chile', code: 'CL' },
  { name: 'Colombia', code: 'CO' },
  { name: 'Egypt', code: 'EG' },
  { name: 'Nigeria', code: 'NG' },
  { name: 'Kenya', code: 'KE' },
  { name: 'Pakistan', code: 'PK' },
  { name: 'Bangladesh', code: 'BD' },
  { name: 'Sri Lanka', code: 'LK' },
  { name: 'Russia', code: 'RU' },
  { name: 'Ukraine', code: 'UA' },
  { name: 'Czech Republic', code: 'CZ' },
  { name: 'Romania', code: 'RO' },
  { name: 'Hungary', code: 'HU' },
];

function matchCountry(query: string, country: { name: string; code: string }): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return (
    country.name.toLowerCase().includes(q) ||
    country.code.toLowerCase() === q
  );
}

/** Resolve a single token (code or country name) to ISO code. */
function tokenToIsoCode(token: string): string {
  const t = token.trim();
  if (t.length === 2) {
    const byCode = ISO_COUNTRIES.find((c) => c.code.toLowerCase() === t.toLowerCase());
    if (byCode) return byCode.code.toUpperCase();
  }
  const byName = ISO_COUNTRIES.find((c) => c.name.toLowerCase() === t.toLowerCase());
  if (byName) return byName.code.toUpperCase();
  const startsWith = ISO_COUNTRIES.find((c) => c.name.toLowerCase().startsWith(t.toLowerCase()));
  if (startsWith) return startsWith.code.toUpperCase();
  return t.toUpperCase();
}

/** Parse region input and return list of ISO codes (resolve country names to codes). */
function regionInputToIsoCodes(regionInput: string): string[] {
  const parts = regionInput.split(',').map((r) => r.trim()).filter(Boolean);
  return parts.map(tokenToIsoCode);
}

/** UI-level priority score from existing recommendation signals only. Used for presentation order; does not mutate data. */
function getRecommendationPriorityScore(card: { id: string; recommendation: Record<string, unknown> }): number {
  const rec = card.recommendation ?? {};
  const tier = getConfidenceTierForRecommendation(rec);
  let score =
    tier === 'high' ? 100 : tier === 'medium' ? 60 : 20;
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

type StrategyStatusForProgress = 'continuation' | 'expansion' | 'neutral' | 'momentum_expand' | undefined;

/** Progress-aware adjustment from existing UI state. Does not mutate data. */
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

  if (isContinuationOrExpansion) {
    adjustment -= 25;
  }
  if (isLongTerm) {
    adjustment -= 40;
  }

  const tier = getConfidenceTierForRecommendation(rec);
  if (
    tier === 'high' &&
    !isContinuationOrExpansion &&
    !isLongTerm
  ) {
    adjustment += 15;
    resurfaced = true;
  }

  const execution = (rec.execution as Record<string, unknown> | undefined) ?? rec;
  const executionStage =
    (typeof execution?.execution_stage === 'string' && execution.execution_stage.trim()) ||
    (typeof (rec as { execution_stage?: string }).execution_stage === 'string' &&
      (rec as { execution_stage: string }).execution_stage.trim());
  const stageLower = executionStage ? String(executionStage).toLowerCase() : '';

  if (stageLower.includes('education') || stageLower.includes('awareness')) {
    adjustment += 5;
  }
  if (
    (stageLower.includes('conversion') || stageLower.includes('action')) &&
    !isContinuationOrExpansion
  ) {
    adjustment += 10;
  }

  return { adjustment, resurfaced };
}

type StrategicFlowState =
  | 'expansion'
  | 'momentum'
  | 'exploration'
  | 'consolidation'
  | 'default';

type CardSignals = {
  journeyState: ReturnType<typeof getJourneyState>;
  confidenceTier: 'high' | 'medium' | 'low';
  momentumState: ReturnType<typeof getDecisionMomentumState>;
  strategyStatus: StrategyStatusForProgress;
  /** For workspace panel: show which cards are in "execute" / "upcoming" lists. */
  cardId?: string;
  cardTitle?: string;
};

/** List-level flow state from existing per-card signals. Narrative aggregation only. */
function getStrategicFlowState(cards: CardSignals[]): StrategicFlowState {
  if (cards.length === 0) return 'default';
  const pastCount = cards.filter((c) => c.journeyState === 'past').length;
  const currentCount = cards.filter((c) => c.journeyState === 'current').length;
  const upcomingCount = cards.filter((c) => c.journeyState === 'upcoming').length;
  const continuationOrExpansionCount = cards.filter(
    (c) =>
      c.strategyStatus === 'continuation' ||
      c.strategyStatus === 'expansion'
  ).length;
  const currentWithHighOrMedium = cards.some(
    (c) => c.journeyState === 'current' && (c.confidenceTier === 'high' || c.confidenceTier === 'medium')
  );
  const planCount = cards.filter((c) => c.momentumState === 'plan').length;
  const majority = cards.length / 2;

  if (continuationOrExpansionCount >= majority || pastCount >= majority) {
    return 'consolidation';
  }
  if (pastCount >= 1 && currentCount >= 1 && currentWithHighOrMedium) {
    return 'expansion';
  }
  const topMomentum = cards[0]?.momentumState;
  const strongPast = pastCount >= majority || continuationOrExpansionCount >= majority;
  if (topMomentum === 'execute' && !strongPast) {
    return 'momentum';
  }
  if (upcomingCount >= majority || planCount >= majority) {
    return 'exploration';
  }
  return 'default';
}

const FLOW_SUMMARY_MESSAGES: Record<StrategicFlowState, string> = {
  expansion:
    'Your strategy is expanding from established momentum into a strong active focus.',
  momentum:
    'Your strategy shows strong forward momentum — this is a good time to execute on priority opportunities.',
  exploration:
    'Your strategy is in exploration mode — focus on shaping direction before committing heavily.',
  consolidation:
    'Your strategy is consolidating — maintaining consistency will strengthen long-term positioning.',
  default:
    'Your strategy contains multiple opportunities — focus on current priorities while monitoring upcoming directions.',
};

function StrategicFlowSummary(props: { state: StrategicFlowState }) {
  const message = FLOW_SUMMARY_MESSAGES[props.state];
  return (
    <div
      className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3"
      role="status"
    >
      <p className="text-sm text-slate-600">{message}</p>
    </div>
  );
}

import type { StrategyStatusPayload } from '../../strategy/StrategyIntelligencePanel';

export default function TrendCampaignsTab(props: OpportunityTabProps) {
  const { companyId, regions, engineRecommendations, fetchWithAuth, strategicIntents, onStrategicIntentsChange, viewMode, campaignId } = props;
  const router = useRouter();
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
  const [strategyStatusPayload, setStrategyStatusPayload] = useState<StrategyStatusPayload | null>(null);
  /** Recommendation snapshot id -> state (ACTIVE | ARCHIVED | LONG_TERM). From API + optimistic updates. */
  const [recommendationUserStateMap, setRecommendationUserStateMap] = useState<Record<string, string>>({});
  /** Recommendation snapshot IDs already used by this company to create a campaign (hide from list). */
  const [usedRecommendationIds, setUsedRecommendationIds] = useState<Set<string>>(new Set());
  /** Campaign created when user clicked "Generate Strategic Themes"; card is saved to this campaign when they click "Build Campaign Blueprint". */
  const [generatedCampaignId, setGeneratedCampaignId] = useState<string | null>(null);
  const [fastLoadingCardId, setFastLoadingCardId] = useState<string | null>(null);
  /** BOLT run progress (stage, percentage) for progress modal. */
  const [boltProgress, setBoltProgress] = useState<BOLTProgress | null>(null);
  /** Per-card error when "Start this campaign" / "Build Campaign Blueprint" fails (shown on the card, not near Generate Themes). */
  const [cardBuildError, setCardBuildError] = useState<Record<string, string>>({});
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
      return { id: `engine-${idBase}`, recommendation: rec };
    });
  }, [engineRecommendationSource]);
  const visibleEngineCards = useMemo(() => {
    return engineRecommendationCards.filter((c) => {
      const snapshotId = typeof c.recommendation?.id === 'string' ? c.recommendation.id.trim() : '';
      if (snapshotId && recommendationUserStateMap[snapshotId] === 'ARCHIVED') return false;
      if (snapshotId && usedRecommendationIds.has(snapshotId)) return false;
      return true;
    });
  }, [engineRecommendationCards, recommendationUserStateMap, usedRecommendationIds]);

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

  const selectPrimary = (id: PrimaryCampaignTypeId) => {
    setPrimaryCampaignType(id);
    setSecondaryCampaignTypes([]);
  };
  const toggleSecondary = (id: SecondaryOptionId) => {
    if (primaryCampaignType === 'third_party') return;
    setSecondaryCampaignTypes((prev) => {
      const has = prev.includes(id);
      return has ? prev.filter((t) => t !== id) : [...prev, id];
    });
  };

  /** Set strategy mode and show transient micro-confirmation (no toast). */
  const setStrategyModeWithHint = (mode: 'balanced' | 'continue' | 'expand') => {
    setStrategyGuidanceMode(mode);
    const hints: Record<string, string> = {
      balanced: 'Showing both continuation and expansion options.',
      continue: 'Prioritizing themes aligned with your current strategy.',
      expand: 'Prioritizing expansion themes.',
    };
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

  const handleViewIntelligence = async (id: string) => {
    try {
      const res = await fetchWithAuth(`/api/recommendations/job/${id}`);
      if (!res.ok) return;
      const data = await res.json();
      setConsolidatedResult(data.consolidated_result ?? null);
      setHistoryDrawerOpen(false);
    } catch {
      // ignore
    }
  };

  const fetchProfile = async (): Promise<Record<string, unknown> | null> => {
    if (!companyId) return null;
    const res = await fetchWithAuth(`/api/company-profile?companyId=${encodeURIComponent(companyId)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.profile ?? null;
  };

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
    if (
      targetAudience &&
      communicationStyle.length > 0 &&
      contentDepth &&
      frequencyPerWeek &&
      tentativeStartDate &&
      campaignGoal
    ) {
      base.execution_config = {
        target_audience: targetAudience,
        professional_segment: professionalSegments[0] ?? null,
        professional_segments: professionalSegments,
        communication_style: communicationStyle,
        content_depth: contentDepth,
        frequency_per_week: frequencyPerWeek,
        tentative_start: tentativeStartDate.toISOString(),
        campaign_goal: campaignGoal,
      };
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
    return {
      completed: hasAudience && hasGoal && hasFrequency && hasStartDate && hasStyle,
      completedCount: [hasAudience, hasGoal, hasFrequency, hasStartDate, hasStyle].filter(Boolean).length,
      missing,
    };
  }, [targetAudience, campaignGoal, frequencyPerWeek, tentativeStartDate, communicationStyle]);

  useEffect(() => {
    if (requiredExecutionFields.completed) setShowMissingFieldsMessage(false);
  }, [requiredExecutionFields.completed]);

  const isExecutionFormComplete = requiredExecutionFields.completed;
  const isExecutionValid = isExecutionFormComplete;

  const executionFieldKeyToLabel: Record<string, string> = {
    targetAudience: 'Target Audience',
    campaignGoal: 'Campaign Goal',
    frequencyPerWeek: 'Frequency per week',
    startDate: 'Start Date',
    communicationStyle: 'Communication Style',
  };

  const focusFirstMissingExecutionField = () => {
    const order = ['targetAudience', 'campaignGoal', 'frequencyPerWeek', 'startDate', 'communicationStyle'] as const;
    for (const key of order) {
      if (requiredExecutionFields.missing.includes(executionFieldKeyToLabel[key])) {
        const el = executionSectionRefs.current[key];
        if (el) {
          setShowMissingFieldsMessage(true);
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }
      }
    }
  };

  const handleRunClick = () => {
    if (!isExecutionFormComplete && !isSubmitting) {
      setShowMissingFieldsMessage(true);
      focusFirstMissingExecutionField();
      return;
    }
    handleRun();
  };

  const handleRun = async () => {
    setValidationError(null);
    setShowMissingFieldsMessage(false);
    if (!companyId) {
      setValidationError('Select a company first.');
      return;
    }
    if (!isExecutionValid) {
      setValidationError('Complete Execution Configuration (audience, style, depth, frequency, start date, goal) before generating themes.');
      return;
    }
    if (contextMode === 'NONE' && !additionalDirection.trim()) {
      setValidationError('Please provide research direction when using No Company Context.');
      return;
    }
    setIsSubmitting(true);
    setValidationError(null);
    try {
      const payload = await buildStrategicPayload();
      setLastStrategicPayload(payload);
      const regionList = regionInputToIsoCodes(regionInput);
      const objective =
        (payload.mapped_core_types?.length
          ? payload.mapped_core_types[0]
          : primaryCampaignType === 'third_party'
            ? 'third_party'
            : primaryCampaignType) ?? 'brand_awareness';
      const durationFromExec =
        payload.execution_config &&
        typeof payload.execution_config === 'object' &&
        typeof (payload.execution_config as { campaign_duration?: number }).campaign_duration === 'number' &&
        (payload.execution_config as { campaign_duration: number }).campaign_duration >= 4 &&
        (payload.execution_config as { campaign_duration: number }).campaign_duration <= 12
          ? (payload.execution_config as { campaign_duration: number }).campaign_duration
          : 12;
      const recRes = await fetchWithAuth('/api/recommendations/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          objective,
          durationWeeks: durationFromExec,
          ...(regionList.length > 0 ? { regions: regionList } : {}),
          strategicPayload: payload,
          insight_source: insightSource,
        }),
      });
      if (!recRes.ok) {
        const recErr = await recRes.json().catch(() => ({}));
        const code = recErr?.error;
        const friendlyMessage =
          code === 'FORBIDDEN_ROLE'
            ? 'You don’t have permission to generate themes. Company Admin or Content Creator role is required for this company.'
            : code === 'COMPANY_SCOPE_VIOLATION' || code === 'Access denied to company'
            ? 'You don’t have access to this company. Select a company you belong to.'
            : code === 'CAMPAIGN_NOT_IN_COMPANY'
            ? 'The selected campaign doesn’t belong to this company.'
            : null;
        const base = friendlyMessage ?? code ?? 'Recommendation engine request failed';
        const detail = recErr?.detail && !friendlyMessage ? ` (${recErr.detail})` : '';
        throw new Error(`${base}${detail}`);
      }
      const recData = await recRes.json().catch(() => null);
      const trends = Array.isArray(recData?.trends_used) ? recData.trends_used : [];
      setGeneratedEngineRecommendations(trends as Array<Record<string, unknown>>);
      if (trends.length === 0) {
        setValidationError('Engine returned no recommendations for this input. Adjust context/objective and try again.');
      } else {
        setExecutionCollapsed(true);
        // Create a campaign when themes are generated so "Build Campaign Blueprint" saves the card to this campaign.
        try {
          const newCampaignId = uuidv4();
          const createRes = await fetchWithAuth('/api/campaigns', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: newCampaignId,
              companyId,
              name: 'Campaign from themes',
              description: 'Select a card and click Build Campaign Blueprint to set the strategic theme.',
              status: 'planning',
              current_stage: 'planning',
              build_mode: 'no_context',
            }),
          });
          if (createRes.ok) {
            const createData = await createRes.json().catch(() => ({}));
            const id = createData?.campaign?.id ?? newCampaignId;
            setGeneratedCampaignId(id);
          }
        } catch (_) {
          // If draft campaign creation fails, Build Campaign Blueprint will create a new campaign as before.
          setGeneratedCampaignId(null);
        }
      }
    } catch (e) {
      setValidationError(e instanceof Error ? e.message : 'Failed to generate themes');
    } finally {
      setHasRun(true);
      setIsSubmitting(false);
    }
  };

  const handleAddCustomPillar = () => {
    if (!customTitle.trim()) return;
    const id = `custom-${Date.now()}`;
    setCustomPillars((prev) => [
      ...prev,
      {
        id,
        title: customTitle.trim(),
        summary: customAngle.trim() || null,
        problem_domain: null,
        region_tags: null,
        conversion_score: null,
        status: 'ACTIVE',
        scheduled_for: null,
        first_seen_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
        payload: {},
        isCustom: true,
      },
    ]);
    setCustomTitle('');
    setCustomAngle('');
    setShowAddCustomForm(false);
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

  const intentSummaryContent = (): { type: 'summary' | 'warning'; text: React.ReactNode } => {
    if (contextMode === 'NONE') {
      if (!additionalDirection.trim())
        return { type: 'warning', text: 'Please provide research direction when using No Company Context.' };
      const parts: React.ReactNode[] = [];
      if (additionalDirection.trim()) parts.push(<span key="dir">• Research direction: &quot;{additionalDirection.slice(0, 80)}{additionalDirection.length > 80 ? '…' : ''}&quot;</span>);
      if (selectedAspects.length > 0) parts.push(<span key="aspect">• Aspects (OR): {selectedAspects.join(', ')}</span>);
      if (selectedFacets.length > 0) parts.push(<span key="offerings">• Offerings: {selectedFacets.map((id) => id.split(':').slice(1).join(':') || id).join(', ')}</span>);
      if (campaignFocusLabels.length > 0) parts.push(<span key="focus">• Campaign focus: {campaignFocusLabels.join(', ')}</span>);
      if (strategicText.trim()) parts.push(<span key="strategic">• Strategic text: &quot;{strategicText.slice(0, 60)}…&quot;</span>);
      const regionList = regionInputToIsoCodes(regionInput);
      if (regionList.length) parts.push(<span key="regions">• Regions: {regionList.join(', ')}</span>);
      return { type: 'summary', text: <>No company context:<div className="mt-1 space-y-0.5">{parts}</div></> };
    }
    const list = selectedFacets.length ? selectedFacets.map((id) => id.split(':').slice(1).join(':') || id).slice(0, 5) : [];
    const lines: React.ReactNode[] = [<span key="ctx">Context: {contextMode}</span>];
    if (list.length) lines.push(<span key="offerings">• Offerings: {list.join(', ')}</span>);
    if (selectedAspects.length > 0) lines.push(<span key="aspect">• Aspects (OR): {selectedAspects.join(', ')}</span>);
    if (campaignFocusLabels.length > 0) lines.push(<span key="focus">• Campaign focus: {campaignFocusLabels.join(', ')}</span>);
    if (strategicText.trim()) lines.push(<span key="direction">• Direction: &quot;{strategicText.slice(0, 80)}…&quot;</span>);
    const regionList = regionInputToIsoCodes(regionInput);
    if (regionList.length) lines.push(<span key="regions">• Regions: {regionList.join(', ')}</span>);
    return { type: 'summary', text: <div className="space-y-0.5">{lines}</div> };
  };

  const intentSummary = intentSummaryContent();

  const modeIndicatorLabel =
    contextMode === 'FULL'
      ? 'Using full company context for recommendations.'
      : contextMode === 'FOCUSED' && focusedModules.length > 0
        ? `Focused on: ${focusedModules.join(', ')}.`
        : contextMode === 'NONE'
          ? 'No company context; use research direction below.'
          : 'Context: ' + contextMode;

  if (!companyId) {
    return (
      <div className="text-sm text-gray-500 py-4">Select a company to view strategic themes.</div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-gray-900">Strategic Theme Builder</h2>
          <p className="mt-1 text-sm text-gray-600">
            Build scalable campaign pillars around high-impact themes.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setHistoryDrawerOpen(true)}
          className="shrink-0 px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
        >
          Job History
        </button>
      </header>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-lg border border-gray-200 p-4 space-y-4">
          <EngineContextPanel
            companyId={companyId}
            fetchWithAuth={fetchWithAuth}
            contextMode={contextMode}
            focusedModules={focusedModules}
            additionalDirection={additionalDirection}
          />
          <UnifiedContextModeSelector
            mode={contextMode}
            modules={focusedModules}
            additionalDirection={additionalDirection}
            onModeChange={setContextMode}
            onModulesChange={setFocusedModules}
            onAdditionalDirectionChange={setAdditionalDirection}
            requireDirectionWhenNone={true}
          />
          <div className="rounded-lg border border-gray-200 bg-gray-50/50 px-4 py-3 text-sm text-gray-700">
            {modeIndicatorLabel}
          </div>
        </div>
        <div className="rounded-lg border border-gray-200 p-4">
          <StrategicConsole
            value={strategicText}
            onChange={setStrategicText}
            mode={contextMode}
          />
        </div>
      </div>
      <div className="border rounded-xl p-4 space-y-4 bg-muted/20">
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-semibold">Execution Configuration</h3>
          {executionCollapsed ? (
            <Button variant="ghost" size="sm" onClick={() => setExecutionCollapsed(false)}>
              Edit
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExecutionCollapsed(true)}
              className="text-muted-foreground"
            >
              Collapse
            </Button>
          )}
        </div>
        <div className="relative min-h-[240px] transition-all duration-200">
          {executionCollapsed && (
            <div className="absolute inset-0 flex items-center">
              <div className="text-xs text-muted-foreground flex flex-wrap gap-2">
                <span>
                  {targetAudience ?? '—'}
                  {targetAudience === 'Professionals' && professionalSegments.length > 0 && ` (${professionalSegments.join(', ')})`}
                </span>
                <span>{communicationStyle?.length ? communicationStyle.join(', ') : '—'}</span>
                <span>{contentDepth ?? '—'}</span>
                <span>{frequencyPerWeek ?? '—'}</span>
                <span>{campaignGoal ?? '—'}</span>
                <span>{tentativeStartDate ? tentativeStartDate.toLocaleDateString(undefined, { dateStyle: 'long' }) : '—'}</span>
              </div>
            </div>
          )}
          {!executionCollapsed && (
          <>
          <div className="space-y-4">
            <div className="flex items-center justify-between text-xs text-gray-600">
              <span>Setup Progress</span>
              <span className="font-medium">{requiredExecutionFields.completedCount} / 5 required fields completed</span>
            </div>
            {/* Row 1: Target Audience (left) | Start Date (right) */}
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div
                ref={(el) => { executionSectionRefs.current.targetAudience = el; }}
                className={`space-y-2 min-w-0 rounded-lg border p-3 transition-colors ${!targetAudience ? 'border-red-300 bg-red-50' : 'border-transparent bg-transparent'}`}
              >
                <label className="block text-xs font-medium text-gray-600" title="Who is the primary audience for this campaign?">
                  Target Audience <span className="text-red-500">*</span>
                </label>
                <div className="flex flex-wrap items-center gap-2" role="group">
                {TARGET_AUDIENCE_CATEGORIES.map((v) => (
                  <button
                    key={v}
                    type="button"
                    title="Who is the primary audience for this campaign?"
                    onClick={() => setTargetAudience(v)}
                    className={`shrink-0 px-3 py-1.5 text-xs rounded-md border transition-colors whitespace-nowrap ${
                      targetAudience === v ? 'bg-indigo-100 border-indigo-300 text-indigo-800' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {v}
                  </button>
                ))}
                {targetAudience === 'Professionals' && (
                  <div className="relative shrink-0" ref={professionalDropdownRef}>
                    <button
                      ref={professionalTriggerRef}
                      type="button"
                      onClick={() => setProfessionalDropdownOpen((o) => !o)}
                      title={professionalSegments.length > 0 ? `Segments: ${professionalSegments.join(', ')}` : 'Narrow down which types of professionals (optional).'}
                      className={`h-9 min-w-[12rem] max-w-[22rem] rounded-md border px-3 text-sm text-left text-gray-900 flex items-center justify-between gap-2 whitespace-nowrap ${
                        professionalSegments.length > 0
                          ? 'border-indigo-400 bg-indigo-50 text-indigo-900 ring-1 ring-indigo-200'
                          : 'border-amber-300 bg-amber-50/80 text-amber-900'
                      }`}
                    >
                      <span className="truncate min-w-0">
                        {professionalSegments.length > 0 ? professionalSegments.join(', ') : 'Select'}
                      </span>
                      <span className="shrink-0 text-gray-500">{professionalDropdownOpen ? '▴' : '▾'}</span>
                    </button>
                    {professionalDropdownOpen && professionalDropdownRect && typeof document !== 'undefined' && ReactDOM.createPortal(
                      <div
                        ref={professionalPortalRef}
                        className="fixed z-[9999] min-w-[12rem] rounded-md border border-gray-200 bg-white py-1 shadow-xl"
                        role="listbox"
                        style={{ top: professionalDropdownRect.top, left: professionalDropdownRect.left }}
                      >
                        <div className="flex flex-nowrap gap-x-4 gap-y-1 px-3 py-2">
                          {PROFESSIONAL_SEGMENTS.map((opt) => (
                            <label
                              key={opt}
                              className="flex items-center gap-2 whitespace-nowrap text-sm text-gray-900 hover:bg-gray-50 cursor-pointer rounded px-1.5 py-1"
                              role="option"
                            >
                              <input
                                type="checkbox"
                                checked={professionalSegments.includes(opt)}
                                onChange={() => {
                                  setProfessionalSegments((prev) =>
                                    prev.includes(opt) ? prev.filter((s) => s !== opt) : [...prev, opt]
                                  );
                                }}
                                className="h-4 w-4 shrink-0 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                              />
                              {opt}
                            </label>
                          ))}
                        </div>
                      </div>,
                      document.body
                    )}
                  </div>
                )}
              </div>
              </div>
              <div
                ref={(el) => { executionSectionRefs.current.startDate = el; }}
                className={`space-y-1.5 shrink-0 rounded-lg border p-3 transition-colors ${!tentativeStartDate ? 'border-red-300 bg-red-50' : 'border-transparent bg-transparent'}`}
              >
                <label className="block text-xs font-medium text-gray-600" title="When do you plan to start this campaign?">
                  Start Date <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <button
                    type="button"
                    title="When do you plan to start this campaign?"
                    onClick={() => setExecutionCalendarOpen((o) => !o)}
                    className="h-9 min-w-[8rem] rounded-md border border-gray-200 bg-white px-3 text-sm text-left text-gray-900"
                  >
                    {tentativeStartDate ? tentativeStartDate.toLocaleDateString(undefined, { dateStyle: 'medium' }) : 'Pick date'}
                  </button>
                  {executionCalendarOpen && (
                    <>
                      <div className="fixed inset-0 z-[100]" aria-hidden onClick={() => setExecutionCalendarOpen(false)} />
                      <div className="absolute z-[101] right-0 top-full mt-1 p-2 rounded-lg border border-gray-200 bg-white shadow-lg">
                        <input
                          type="date"
                          value={tentativeStartDate?.toISOString().slice(0, 10) ?? ''}
                          min={new Date().toISOString().split('T')[0]}
                          onChange={(e) => {
                            const v = e.target.value;
                            setTentativeStartDate(v ? new Date(v) : undefined);
                          }}
                          className="border border-gray-200 rounded px-2 py-1 text-sm"
                        />
                        <Button variant="ghost" size="sm" onClick={() => setExecutionCalendarOpen(false)} className="mt-2 w-full">
                          Done
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              </div>
              </div>
            </div>
            <div className="flex flex-nowrap items-end gap-4 overflow-x-auto pb-1">
              <div
                ref={(el) => { executionSectionRefs.current.campaignGoal = el; }}
                className={`space-y-1.5 shrink-0 rounded-lg border p-3 transition-colors ${!campaignGoal ? 'border-red-300 bg-red-50' : 'border-transparent bg-transparent'}`}
              >
              <label className="block text-xs font-medium text-gray-600" title="What is the main goal of this campaign?">
                Campaign Goal <span className="text-red-500">*</span>
              </label>
              <div className="flex flex-nowrap gap-1.5" role="group">
                {['Awareness', 'Leads', 'Engagement', 'Product'].map((v) => (
                  <button
                    key={v}
                    type="button"
                    title="What is the main goal of this campaign?"
                    onClick={() => setCampaignGoal(v)}
                    className={`shrink-0 px-2.5 py-1 text-xs rounded-md border transition-colors whitespace-nowrap ${
                      campaignGoal === v ? 'bg-indigo-100 border-indigo-300 text-indigo-800' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
              </div>
              <div className="space-y-1.5 shrink-0">
                <label className="block text-xs font-medium text-gray-600" title="How detailed should each piece of content be?">Content Depth</label>
                <div className="flex flex-nowrap gap-1.5" role="group">
                {['Short', 'Medium', 'Long'].map((v) => (
                  <button
                    key={v}
                    type="button"
                    title="How detailed should each piece of content be?"
                    onClick={() => setContentDepth(v)}
                    className={`shrink-0 px-2.5 py-1 text-xs rounded-md border transition-colors whitespace-nowrap ${
                      contentDepth === v ? 'bg-indigo-100 border-indigo-300 text-indigo-800' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
              </div>
              <div
                ref={(el) => { executionSectionRefs.current.frequencyPerWeek = el; }}
                className={`space-y-1.5 shrink-0 w-24 rounded-lg border p-3 transition-colors ${!frequencyPerWeek ? 'border-red-300 bg-red-50' : 'border-transparent bg-transparent'}`}
              >
                <label className="block text-xs font-medium text-gray-600" title="How many posts/pieces do you want to send per week?">
                  Frequency per week <span className="text-red-500">*</span>
                </label>
                <select
                  value={frequencyPerWeek ?? ''}
                  onChange={(e) => setFrequencyPerWeek(e.target.value || null)}
                  title="How many posts/pieces do you want to send per week?"
                  className="w-full h-9 rounded-md border border-gray-200 bg-white px-2 text-sm text-gray-900"
                >
                  <option value="">Select</option>
                  <option value="1/w">1/w</option>
                  <option value="2/w">2/w</option>
                  <option value="3/w">3/w</option>
                  <option value="5/w">5/w</option>
                  <option value="Daily">Daily</option>
                </select>
              </div>
              <div
                ref={(el) => { executionSectionRefs.current.communicationStyle = el; }}
                className={`space-y-1.5 shrink-0 min-w-[12rem] rounded-lg border p-3 transition-colors ${communicationStyle.length === 0 ? 'border-red-300 bg-red-50' : 'border-transparent bg-transparent'}`}
              >
              <label className="block text-xs font-medium text-gray-600" title="Tone and style of your content (pick up to 2).">
                Communication Style (max 2) <span className="text-red-500">*</span>
              </label>
              <div className="flex flex-nowrap gap-2">
                {['Professional', 'Conversational', 'Educational', 'Inspirational'].map((v) => {
                  const checked = communicationStyle.includes(v);
                  return (
                    <label key={v} className="inline-flex items-center gap-1.5 cursor-pointer text-xs whitespace-nowrap" title="Tone and style of your content (pick up to 2).">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setCommunicationStyle((prev) => {
                            if (prev.includes(v)) return prev.filter((x) => x !== v);
                            if (prev.length >= 2) return prev;
                            return [...prev, v];
                          });
                        }}
                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span>{v}</span>
                    </label>
                  );
                })}
              </div>
              </div>
            </div>
          </>
          )}
        </div>
      </div>
      <StrategicAspectSelector
        aspects={aspects}
        selectedAspects={selectedAspects}
        onAspectsChange={setSelectedAspects}
      />
      <OfferingFacetSelector
        selectedAspect={selectedAspects.length > 0 ? selectedAspects[0] : null}
        offerings={offeringFacetCards}
        selectedFacets={selectedFacets}
        onChange={setSelectedFacets}
        mode={contextMode}
      />
      <div className="rounded-lg border border-gray-200 p-4 space-y-4">
        <h3 className="text-sm font-semibold text-gray-800">Campaign focus &amp; goals</h3>
        <p className="text-xs text-gray-500">
          Choose one primary focus; optional supporting goals appear below.
        </p>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-2">Campaign focus (choose one)</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {PRIMARY_OPTIONS.map((opt) => {
              const selected = primaryCampaignType === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => selectPrimary(opt.id)}
                  className={`rounded-xl border-2 px-4 py-3 text-left text-sm font-medium transition-colors ${
                    selected
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-800'
                      : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
        {primaryCampaignType && primaryCampaignType !== 'third_party' && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">Supporting goals (optional)</label>
            <p className="text-xs text-gray-500 mb-2">Add compatible objectives for this run.</p>
            {isPersonalBrandPrimary(primaryCampaignType) ? (
              <div className="space-y-4">
                {PERSONAL_BRAND_SECONDARY_GROUPS.map((group) => (
                  <div key={group.label}>
                    <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{group.label}</span>
                    <div className="flex flex-wrap gap-2 mt-1.5">
                      {group.options.map((opt) => {
                        const selected = secondaryCampaignTypes.includes(opt.id);
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => toggleSecondary(opt.id)}
                            className={`px-3 py-1.5 text-sm font-medium rounded-lg border ${
                              selected ? 'bg-indigo-100 border-indigo-300 text-indigo-800' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {getSecondaryOptionsForPrimary(primaryCampaignType).map((opt) => {
                  const selected = secondaryCampaignTypes.includes(opt.id);
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => toggleSecondary(opt.id)}
                      className={`px-3 py-1.5 text-sm font-medium rounded-lg border ${
                        selected ? 'bg-indigo-100 border-indigo-300 text-indigo-800' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {primaryCampaignType === 'third_party' && (
          <p className="text-sm text-gray-600 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
            Third-party campaign: no further options. Recommendations will be generic collaboration/distribution-focused.
          </p>
        )}
        {dilutionSeverity !== 'none' && (
          <div
            className={`rounded-lg border px-3 py-2 text-sm ${
              dilutionSeverity === 'caution' ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-indigo-200 bg-indigo-50 text-indigo-800'
            }`}
            role="status"
          >
            These goals may dilute campaign focus. Consider selecting a primary campaign focus.
          </div>
        )}
      </div>
      <div className="rounded-lg border border-gray-200 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-800">Geographic Targeting (Optional)</h3>
        <div className="relative">
          <label className="block text-xs text-gray-500 mb-1">Target Regions (type country name or ISO code, comma separated)</label>
          <input
            ref={regionInputRef}
            type="text"
            value={regionInput}
            onChange={(e) => {
              setRegionInput(e.target.value);
              setRegionDropdownOpen(true);
              const parts = e.target.value.split(',').map((r) => r.trim()).filter(Boolean);
              const invalid = parts.filter((p) => p.length !== 2 && !ISO_COUNTRIES.some((c) => matchCountry(p, c)));
              setRegionWarning(invalid.length > 0 ? 'Some codes are not 2-letter ISO codes; generation will still run.' : null);
            }}
            onFocus={() => {
              const parts = regionInput.split(',').map((r) => r.trim()).filter(Boolean);
              const last = parts[parts.length - 1] ?? '';
              if (last.length >= 2 && ISO_COUNTRIES.some((c) => matchCountry(last, c))) setRegionDropdownOpen(true);
            }}
            onBlur={() => {
              setTimeout(() => setRegionDropdownOpen(false), 150);
            }}
            placeholder="e.g. India, US, Germany or IN, US, DE"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            autoComplete="off"
          />
          {regionDropdownOpen && (() => {
            const parts = regionInput.split(',').map((r) => r.trim()).filter(Boolean);
            const lastToken = (parts[parts.length - 1] ?? '').trim();
            const isAlreadyCode = lastToken.length === 2 && ISO_COUNTRIES.some((c) => c.code.toLowerCase() === lastToken.toLowerCase());
            const matches = lastToken.length >= 2 && !isAlreadyCode
              ? ISO_COUNTRIES.filter((c) => matchCountry(lastToken, c)).slice(0, 8)
              : [];
            if (matches.length === 0) return null;
            return (
              <ul
                className="absolute z-10 mt-1 w-full border border-gray-200 rounded-lg bg-white shadow-lg divide-y divide-gray-100 max-h-48 overflow-auto"
                role="listbox"
              >
                {matches.map((c) => (
                  <li key={c.code}>
                    <button
                      type="button"
                      role="option"
                      onClick={() => {
                        const prev = parts.slice(0, -1);
                        const next = [...prev, c.code];
                        setRegionInput(next.join(', '));
                        setRegionDropdownOpen(false);
                        setRegionWarning(null);
                      }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 text-gray-800"
                    >
                      {c.name} → <span className="font-medium text-indigo-600">{c.code}</span>
                    </button>
                  </li>
                ))}
              </ul>
            );
          })()}
          <p className="mt-1 text-xs text-gray-500">
            Type a country name (e.g. India, United States) and pick from the list to get the ISO code, or enter codes directly (IN, US, GB). Leave empty to use company default geography.
          </p>
          {regionWarning && <p className="mt-1 text-xs text-red-600">{regionWarning}</p>}
        </div>
      </div>
      <div className="rounded-lg border border-gray-200 bg-gray-50/50 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-800 mb-2">Strategic Intent Summary</h3>
        {intentSummary.type === 'warning' ? (
          <p className="text-sm text-amber-700">{intentSummary.text}</p>
        ) : (
          <div className="text-sm text-gray-700">{intentSummary.text}</div>
        )}
      </div>
      <div className="space-y-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Intelligence Source</label>
          <select
            value={insightSource}
            onChange={(e) => setInsightSource(e.target.value as 'hybrid' | 'api' | 'llm')}
            className="w-full max-w-xs border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
          >
            <option value="hybrid">Hybrid Intelligence</option>
            <option value="api">API Intelligence</option>
            <option value="llm">AI Strategic Engine</option>
          </select>
        </div>
        <button
          type="button"
          onClick={handleRunClick}
          disabled={isSubmitting || !isExecutionFormComplete}
          className={`px-6 py-3 text-base font-medium rounded-lg ${
            isSubmitting || !isExecutionFormComplete
              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
              : 'bg-indigo-600 text-white hover:bg-indigo-700'
          }`}
        >
          {isSubmitting ? 'Generating…' : !isExecutionFormComplete ? 'Complete Required Fields' : 'Generate Strategic Themes'}
        </button>
        {showMissingFieldsMessage && requiredExecutionFields.missing.length > 0 && (
          <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            <p className="font-medium">Missing Inputs:</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              {requiredExecutionFields.missing.map((label) => (
                <li key={label}>• {label}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {validationError && <div className="text-sm text-red-600">{validationError}</div>}
      <div id="recommendation-cards" ref={cardsSectionRef}>
      {!hasRun && !isSubmitting && (
        <div className="flex justify-center py-12">
          <div className="max-w-md rounded-lg border border-gray-200 bg-gray-50/80 p-6 text-center text-sm text-gray-700">
            No strategic themes generated yet. Click &quot;Generate Strategic Themes&quot; to build campaign pillars aligned with your company direction.
          </div>
        </div>
      )}
      {(hasRun || visibleEngineCards.length > 0) && !isSubmitting && (
        <div ref={themesSectionRef} className="space-y-6">
          <div className="flex flex-col gap-4">
            <button
              type="button"
              onClick={() => setShowAddCustomForm((v) => !v)}
              className="self-start px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              + Add Custom Pillar
            </button>
            {showAddCustomForm && (
              <div className="rounded-lg border border-gray-200 bg-gray-50/80 p-4 space-y-3">
                <h4 className="text-sm font-semibold text-gray-800">New custom pillar</h4>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Pillar Title</label>
                  <input
                    type="text"
                    value={customTitle}
                    onChange={(e) => setCustomTitle(e.target.value)}
                    placeholder="e.g. Sustainability Leadership"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Strategic Angle</label>
                  <textarea
                    value={customAngle}
                    onChange={(e) => setCustomAngle(e.target.value)}
                    placeholder="Brief angle or narrative"
                    rows={2}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleAddCustomPillar}
                    disabled={!customTitle.trim()}
                    className="px-3 py-1.5 text-sm font-medium rounded-lg bg-indigo-600 text-white disabled:opacity-50"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddCustomForm(false)}
                    className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 text-gray-700"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
          {hasRun && visibleEngineCards.length === 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-6 py-8 text-center">
              <p className="text-sm font-medium text-amber-800">No strategic themes found.</p>
              <p className="mt-2 text-sm text-amber-700">
                Generation complete, but the engine returned no recommendations for this input. Try adjusting your company context, strategic direction, or execution configuration.
              </p>
            </div>
          )}
          {visibleEngineCards.length > 0 && (
            <>
              <div className="rounded-lg border border-green-200 bg-green-50/80 px-4 py-3 text-sm text-green-800">
                {visibleEngineCards.length} strategic theme{visibleEngineCards.length !== 1 ? 's' : ''} generated. Select a card below to build your campaign.
              </div>
              <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-sm transition-all duration-200 ease-out space-y-4 -mx-0 px-0">
              {strategyDrift?.hasDrift && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-4 py-2.5 transition-all duration-200 ease-out">
                  <p className="text-xs text-amber-800">
                    ⚠ Strategy appears fragmented.
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowStrategyDetails((v) => !v)}
                    className="mt-1.5 text-xs text-amber-700 hover:text-amber-900 font-medium flex items-center gap-1"
                  >
                    Why this matters {showStrategyDetails ? '▴' : '▾'}
                  </button>
                  {showStrategyDetails && (
                    <div className="mt-2 pt-2 border-t border-amber-200/60 space-y-1.5 transition-all duration-200 ease-out">
                      {stabilizationRecommendation && (
                        <p className="text-xs font-medium text-amber-900">
                          Strategic focus suggestion: Focus on &quot;{stabilizationRecommendation.aspect}&quot; — your strongest recent strategic direction.
                        </p>
                      )}
                      {suggestedStrategyMode && (
                        <p className="text-xs text-amber-700">
                          Suggested direction may help restore focus.
                        </p>
                      )}
                      {suggestedStrategyMode === 'continue' && stabilizationRecommendation && (
                        <p className="text-xs text-amber-700">
                          Continue mode supports strategic consistency.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
              <div className="rounded-lg border border-gray-200 bg-gray-50/50 px-4 py-3 transition-all duration-200 ease-out">
                {strategyDrift != null && strategyFocusLabel != null && (
                  <div
                    className={`mb-3 transition-opacity duration-200 ease-out ${meterReveal ? 'opacity-[0.85]' : 'opacity-100'}`}
                  >
                    <p className="text-xs font-medium text-gray-600 mb-1">Strategy Focus</p>
                    <div className="flex items-center gap-2">
                      <div className="flex gap-0.5" aria-hidden>
                        {[1, 2, 3, 4, 5].map((i) => {
                          const filled = (strategyDrift.concentration ?? 0) >= (i - 0.5) / 5;
                          return (
                            <span
                              key={i}
                              className={`w-2 h-2.5 rounded-sm ${filled ? 'bg-gray-500' : 'bg-gray-200'}`}
                            />
                          );
                        })}
                      </div>
                      <span className="text-xs text-gray-500">({strategyFocusLabel})</span>
                    </div>
                  </div>
                )}
                <p className="text-xs font-medium text-gray-600 mb-2">Strategy direction</p>
                <div className="flex flex-wrap items-center gap-4">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="strategyGuidance"
                      checked={strategyGuidanceMode === 'balanced'}
                      onChange={() => setStrategyModeWithHint('balanced')}
                      className="text-indigo-600 border-gray-300 focus:ring-indigo-500"
                    />
                    <span className="text-sm text-gray-700">Balanced</span>
                    {suggestedStrategyMode === 'balanced' && (
                      <span className="text-xs font-medium text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">Recommended</span>
                    )}
                  </label>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="strategyGuidance"
                      checked={strategyGuidanceMode === 'continue'}
                      onChange={() => setStrategyModeWithHint('continue')}
                      className="text-indigo-600 border-gray-300 focus:ring-indigo-500"
                    />
                    <span className="text-sm text-gray-700">Continue strategy</span>
                    {suggestedStrategyMode === 'continue' && (
                      <span className="text-xs font-medium text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">Recommended</span>
                    )}
                  </label>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="strategyGuidance"
                      checked={strategyGuidanceMode === 'expand'}
                      onChange={() => setStrategyModeWithHint('expand')}
                      className="text-indigo-600 border-gray-300 focus:ring-indigo-500"
                    />
                    <span className="text-sm text-gray-700">Expand strategy</span>
                    {suggestedStrategyMode === 'expand' && (
                      <span className="text-xs font-medium text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">Recommended</span>
                    )}
                  </label>
                </div>
                {suggestedStrategyMode && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-gray-500">
                      Suggested: {suggestedStrategyMode === 'balanced' ? 'Balanced' : suggestedStrategyMode === 'continue' ? 'Continue Strategy' : 'Expand Strategy'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setStrategyModeWithHint(suggestedStrategyMode)}
                      className="text-xs font-medium text-indigo-600 hover:text-indigo-700 border border-indigo-200 hover:border-indigo-300 rounded px-2 py-1 bg-white"
                    >
                      Apply suggested
                    </button>
                  </div>
                )}
                {suggestedStrategyMode && suggestedStrategyExplanation && (
                  <p className="mt-1.5 text-xs text-gray-500">
                    {suggestedStrategyExplanation}
                  </p>
                )}
                <p className={`mt-2 text-xs text-gray-500 transition-opacity duration-200 ease-out ${modeHint ? 'opacity-100' : ''}`}>
                  {modeHint ?? (
                    <>
                      {strategyGuidanceMode === 'balanced' && 'Showing both continuation and expansion options.'}
                      {strategyGuidanceMode === 'continue' && 'Prioritizing themes aligned with your current strategy.'}
                      {strategyGuidanceMode === 'expand' && 'Prioritizing themes that diversify your strategy.'}
                    </>
                  )}
                </p>
              </div>
            </div>
          </>
        )}
          {rankedEngineCardsWithStatus.length > 0 && (
            <>
              <StrategicWorkspacePanel
                flowState={strategicFlowState}
                cardsWithSignals={workspaceSummaryData.cardsWithSignals}
                strategyStatusPayload={strategyStatusPayload ?? undefined}
                onScrollToCard={(cardId) => {
                  const el = document.querySelector(`[data-card-id="${cardId}"]`);
                  el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }}
              />
              <StrategicFlowSummary state={strategicFlowState} />
            </>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 transition-all duration-200 ease-out">
            {rankedEngineCardsWithStatus.length > 0
              ? rankedEngineCardsWithStatus.map(({ card, strategyStatus, isTopPriority, resurfaced }, cardIndex) => {
                  const signals = workspaceSummaryData.cardsWithSignals[cardIndex];
                  const executeCount = workspaceSummaryData.cardsWithSignals.filter((c) => c.momentumState === 'execute').length;
                  const upcomingCount = workspaceSummaryData.cardsWithSignals.filter((c) => c.journeyState === 'upcoming').length;
                  const executionBadge =
                    signals?.momentumState === 'execute' && executeCount > 0
                      ? {
                          index: workspaceSummaryData.cardsWithSignals.slice(0, cardIndex + 1).filter((c) => c.momentumState === 'execute').length,
                          total: executeCount,
                        }
                      : undefined;
                  const upcomingBadge =
                    signals?.journeyState === 'upcoming' && upcomingCount > 0
                      ? {
                          index: workspaceSummaryData.cardsWithSignals.slice(0, cardIndex + 1).filter((c) => c.journeyState === 'upcoming').length,
                          total: upcomingCount,
                        }
                      : undefined;
                  return (
                  <div key={card.id} data-card-id={card.id} ref={cardIndex === 0 ? firstCardRef : undefined} className="transition-all duration-200 ease-out">
                    <RecommendationBlueprintCard
                    key={card.id}
                    recommendation={card.recommendation}
                    strategyStatus={strategyStatus}
                    viewMode={viewMode}
                    isTopPriority={isTopPriority}
                    resurfaced={resurfaced}
                    executionBadge={executionBadge}
                    upcomingBadge={upcomingBadge}
                    buildError={cardBuildError[card.id]}
                    fastLoading={fastLoadingCardId === card.id}
                    onBuildCampaignBlueprint={async () => {
                      if (!companyId) {
                        setValidationError('Select a company first.');
                        return;
                      }
                      setValidationError(null);
                      setCardBuildError((prev) => ({ ...prev, [card.id]: '' }));
                      const recommendation = card.recommendation ?? {};
                      const title =
                        (typeof recommendation.polished_title === 'string'
                          ? recommendation.polished_title
                          : null) ??
                        (typeof recommendation.topic === 'string'
                          ? recommendation.topic
                          : 'Campaign');
                      const description =
                        (typeof recommendation.summary === 'string' && recommendation.summary.trim()
                          ? recommendation.summary
                          : null) ??
                        (typeof recommendation.narrative_direction === 'string' &&
                        recommendation.narrative_direction.trim()
                          ? recommendation.narrative_direction
                          : null) ??
                        undefined;

                      const contextPayload: Record<string, unknown> = {};
                      if (Array.isArray(recommendation.formats)) {
                        contextPayload.formats = recommendation.formats;
                      }
                      if (typeof recommendation.estimated_reach === 'number') {
                        contextPayload.reach_estimate = recommendation.estimated_reach;
                      } else if (typeof recommendation.volume === 'number') {
                        contextPayload.reach_estimate = recommendation.volume;
                      }

                      const regionsFromCard = Array.isArray(recommendation.regions)
                        ? recommendation.regions
                            .map((value) => String(value || '').trim().toUpperCase())
                            .filter(Boolean)
                        : [];
                      const sourceOpportunityId =
                        (typeof recommendation.id === 'string' && recommendation.id.trim()
                          ? recommendation.id
                          : null) ??
                        (typeof recommendation.snapshot_hash === 'string' &&
                        recommendation.snapshot_hash.trim()
                          ? recommendation.snapshot_hash
                          : null) ??
                        `recommendation:${card.id}`;
                      const sourceStrategicTheme = {
                        topic: recommendation.topic ?? recommendation.polished_title ?? title,
                        polished_title: recommendation.polished_title ?? recommendation.topic ?? title,
                        summary: recommendation.summary ?? recommendation.narrative_direction ?? description,
                        intelligence: recommendation.intelligence ?? undefined,
                        execution: recommendation.execution ?? undefined,
                        company_context_snapshot: recommendation.company_context_snapshot ?? undefined,
                        duration_weeks: recommendation.duration_weeks ?? undefined,
                        progression_summary: recommendation.progression_summary ?? undefined,
                        primary_recommendations: recommendation.primary_recommendations ?? undefined,
                        supporting_recommendations: recommendation.supporting_recommendations ?? undefined,
                        estimated_reach: recommendation.estimated_reach ?? recommendation.volume ?? undefined,
                        formats: recommendation.formats ?? undefined,
                        regions: recommendation.regions ?? undefined,
                      };
                      const recId = typeof recommendation.id === 'string' ? recommendation.id.trim() : '';
                      try {
                        let createdCampaignId: string;
                        if (generatedCampaignId) {
                          // Save this card to the campaign created at "Generate Strategic Themes".
                          const executionConfigPayload =
                            targetAudience &&
                            contentDepth &&
                            frequencyPerWeek &&
                            tentativeStartDate &&
                            campaignGoal &&
                            communicationStyle.length > 0
                              ? {
                                  target_audience: targetAudience,
                                professional_segment: professionalSegments[0] ?? null,
                                professional_segments: professionalSegments,
                                communication_style: communicationStyle,
                                content_depth: contentDepth,
                                frequency_per_week: frequencyPerWeek,
                                tentative_start: tentativeStartDate.toISOString(),
                                campaign_goal: campaignGoal,
                              }
                              : null;
                          const putRes = await fetchWithAuth(
                            `/api/campaigns/${encodeURIComponent(generatedCampaignId)}/source-recommendation`,
                            {
                              method: 'PUT',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                source_recommendation_id: recId || null,
                                source_strategic_theme: sourceStrategicTheme,
                                execution_config: executionConfigPayload,
                              }),
                            }
                          );
                          if (!putRes.ok) {
                            const err = await putRes.json().catch(() => ({}));
                            throw new Error(err?.error || 'Failed to save card to campaign');
                          }
                          setCardBuildError((prev) => ({ ...prev, [card.id]: '' }));
                          createdCampaignId = generatedCampaignId;
                          setGeneratedCampaignId(null);
                        } else {
                          // No pre-created campaign; navigate to Campaign Planner (canonical creation entry)
                          const recIdForPlanner = recId || (typeof card.id === 'string' ? card.id : '');
                          const qs = new URLSearchParams({ companyId });
                          if (recIdForPlanner) qs.set('recommendationId', recIdForPlanner);
                          router.push(`/campaign-planner?${qs.toString()}`);
                          return;
                        }
                        if (recId) {
                          setUsedRecommendationIds((prev) => new Set([...prev, recId]));
                        }
                        const qs = new URLSearchParams({
                          companyId,
                          fromRecommendation: '1',
                        });
                        if (recId) qs.set('recommendationId', recId);
                        router.push(`/campaign-details/${createdCampaignId}?${qs.toString()}`);
                      } catch (error) {
                        const msg = error instanceof Error ? error.message : 'Failed to save card to campaign';
                        setCardBuildError((prev) => ({ ...prev, [card.id]: msg }));
                      }
                    }}
                    onBuildCampaignFast={async (options) => {
                      if (fastLoadingCardId === card.id) return;
                      const outcomeView: BoltOutcomeView = options?.outcomeView ?? 'schedule';
                      const campaignMode = options?.campaignMode ?? 'text_based';
                      const contentFormats = options?.contentFormats ?? ['post'];
                      if (!companyId) {
                        setValidationError('Select a company first.');
                        return;
                      }
                      setValidationError(null);
                      setCardBuildError((prev) => ({ ...prev, [card.id]: '' }));
                      const recommendation = card.recommendation ?? {};
                      const title =
                        (typeof recommendation.polished_title === 'string'
                          ? recommendation.polished_title
                          : null) ??
                        (typeof recommendation.topic === 'string'
                          ? recommendation.topic
                          : 'Campaign');
                      const description =
                        (typeof recommendation.summary === 'string' && recommendation.summary.trim()
                          ? recommendation.summary
                          : null) ??
                        (typeof recommendation.narrative_direction === 'string' &&
                        recommendation.narrative_direction.trim()
                          ? recommendation.narrative_direction
                          : null) ??
                        undefined;
                      const regionsFromCard = Array.isArray(recommendation.regions)
                        ? recommendation.regions
                            .map((value) => String(value || '').trim().toUpperCase())
                            .filter(Boolean)
                        : [];
                      const sourceOpportunityId =
                        (typeof recommendation.id === 'string' && recommendation.id.trim()
                          ? recommendation.id
                          : null) ??
                        (typeof recommendation.snapshot_hash === 'string' &&
                        recommendation.snapshot_hash.trim()
                          ? recommendation.snapshot_hash
                          : null) ??
                        `recommendation:${card.id}`;
                      const sourceStrategicTheme = {
                        topic: recommendation.topic ?? recommendation.polished_title ?? title,
                        polished_title: recommendation.polished_title ?? recommendation.topic ?? title,
                        summary: recommendation.summary ?? recommendation.narrative_direction ?? description,
                        intelligence: recommendation.intelligence ?? undefined,
                        execution: recommendation.execution ?? undefined,
                        company_context_snapshot: recommendation.company_context_snapshot ?? undefined,
                        duration_weeks: recommendation.duration_weeks ?? undefined,
                        progression_summary: recommendation.progression_summary ?? undefined,
                        primary_recommendations: recommendation.primary_recommendations ?? undefined,
                        supporting_recommendations: recommendation.supporting_recommendations ?? undefined,
                        estimated_reach: recommendation.estimated_reach ?? recommendation.volume ?? undefined,
                        formats: recommendation.formats ?? undefined,
                        regions: recommendation.regions ?? undefined,
                      };
                      const recId = typeof recommendation.id === 'string' ? recommendation.id.trim() : '';
                      const durationWeeks = Math.min(4, Math.max(1, options?.durationWeeks ?? 4));
                      const executionConfigPayload =
                        targetAudience &&
                        contentDepth &&
                        frequencyPerWeek &&
                        tentativeStartDate &&
                        campaignGoal &&
                        communicationStyle.length > 0
                          ? {
                              target_audience: targetAudience,
                              professional_segment: professionalSegments[0] ?? null,
                              professional_segments: professionalSegments,
                              communication_style: communicationStyle,
                              content_depth: contentDepth,
                              frequency_per_week: frequencyPerWeek,
                              campaign_duration: durationWeeks,
                              tentative_start: tentativeStartDate.toISOString().split('T')[0],
                              campaign_goal: campaignGoal,
                              campaign_mode: campaignMode,
                              content_formats: contentFormats,
                            }
                          : null;
                      if (!executionConfigPayload) {
                        setValidationError('Complete the execution bar (audience, depth, frequency, start date, goal, style) to use BOLT.');
                        return;
                      }
                      setFastLoadingCardId(card.id);
                      try {
                        const BOLT_EXECUTE_TIMEOUT_MS = 90_000;
                        const controller = new AbortController();
                        const timeoutId = setTimeout(() => controller.abort(), BOLT_EXECUTE_TIMEOUT_MS);
                        let execRes;
                        try {
                          execRes = await fetchWithAuth('/api/bolt/execute', {
                            method: 'POST',
                            signal: controller.signal,
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              companyId,
                              generatedCampaignId: generatedCampaignId ?? null,
                              sourceStrategicTheme,
                              executionConfig: executionConfigPayload,
                              outcomeView,
                              recId: recId || null,
                              title,
                              description,
                              sourceOpportunityId,
                              regionsFromCard,
                            }),
                          });
                        } finally {
                          clearTimeout(timeoutId);
                        }
                        if (!execRes.ok) {
                          const err = await execRes.json().catch(() => ({}));
                          throw new Error(err?.error || 'Failed to start BOLT execution');
                        }
                        const execData = await execRes.json().catch(() => ({}));
                        const runId = execData?.run_id;
                        if (!runId) throw new Error('No run_id returned from BOLT execute');

                        if (recId) {
                          setUsedRecommendationIds((prev) => new Set([...prev, recId]));
                        }
                        if (generatedCampaignId) setGeneratedCampaignId(null);

                        setBoltProgress({ stage: 'source-recommendation', status: 'started', progress_percentage: 0 });

                        const POLL_PROGRESS_TIMEOUT_MS = 30_000; // 30s per poll to avoid stuck progress fetch
                        const pollProgress = async (): Promise<string | null> => {
                          const progController = new AbortController();
                          const progTimeoutId = setTimeout(() => progController.abort(), POLL_PROGRESS_TIMEOUT_MS);
                          let progRes: Response;
                          try {
                            progRes = await fetchWithAuth(`/api/bolt/progress?run_id=${encodeURIComponent(runId)}`, {
                              signal: progController.signal,
                            });
                          } finally {
                            clearTimeout(progTimeoutId);
                          }
                          if (!progRes.ok) return null;
                          const prog = await progRes.json().catch(() => ({}));
                          if (isMountedRef.current) {
                            setBoltProgress({
                              stage: prog.stage,
                              status: prog.status,
                              progress_percentage: prog.progress_percentage,
                              error_message: prog.error_message,
                              weeks_generated: prog.weeks_generated,
                              daily_slots_created: prog.daily_slots_created,
                              scheduled_posts_created: prog.scheduled_posts_created,
                            });
                          }
                          if (prog.status === 'completed') {
                            return (prog.result_campaign_id as string) || null;
                          }
                          if (prog.status === 'failed') {
                            throw new Error((prog.error_message as string) || 'BOLT execution failed');
                          }
                          return null;
                        };

                        const POLL_INTERVAL_MS = 2500;
                        const POLL_MAX_MS = 5 * 60 * 1000; // 5 min max wait for worker
                        const pollDeadline = Date.now() + POLL_MAX_MS;
                        let completedCampaignId: string | null = null;
                        while (!completedCampaignId && isMountedRef.current) {
                          if (Date.now() > pollDeadline) {
                            throw new Error('The request took too long. Please try again.');
                          }
                          completedCampaignId = await pollProgress();
                          if (!completedCampaignId) await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
                        }

                        if (!isMountedRef.current) return;
                        if (completedCampaignId) {
                          setFastLoadingCardId(null);
                          setBoltProgress(null);
                          const qs = new URLSearchParams({ companyId });
                          const base = `/campaign-details/${completedCampaignId}`;
                          if (outcomeView === 'week_plan') {
                            router.push(`${base}?mode=fast&${qs.toString()}`);
                          } else if (outcomeView === 'daily_plan') {
                            // Show week 1's daily breakdown on the campaign details page
                            qs.set('plannerWeek', '1');
                            router.push(`${base}?${qs.toString()}`);
                          } else if (outcomeView === 'schedule') {
                            router.push(`/campaign-calendar/${completedCampaignId}?${qs.toString()}`);
                          } else {
                            router.push(`${base}?mode=fast&${qs.toString()}`);
                          }
                        }
                      } catch (error) {
                        let msg = error instanceof Error ? error.message : 'Failed to run BOLT (Fast Mode)';
                        if (error instanceof Error && error.name === 'AbortError') {
                          msg = 'The request took too long. Please try again.';
                        }
                        if (isMountedRef.current) {
                          setBoltProgress({
                            stage: undefined,
                            status: 'failed',
                            progress_percentage: 0,
                            error_message: msg,
                          });
                          setTimeout(() => {
                            setFastLoadingCardId(null);
                            setBoltProgress(null);
                          }, 4000);
                        }
                        setCardBuildError((prev) => ({ ...prev, [card.id]: msg }));
                      }
                    }}
                    onMarkLongTerm={
                      (typeof card.recommendation?.id === 'string' &&
                        card.recommendation.id.trim() &&
                        !card.recommendation.id.startsWith('engine-') &&
                        fetchWithAuth)
                        ? async () => {
                            const recId = (card.recommendation?.id as string).trim();
                            setRecommendationUserStateMap((prev) => ({ ...prev, [recId]: 'LONG_TERM' }));
                            try {
                              const res = await fetchWithAuth!(`/api/recommendations/${encodeURIComponent(recId)}/long-term`, { method: 'POST' });
                              if (!res.ok) throw new Error('Failed to mark long-term');
                            } catch (e) {
                              setRecommendationUserStateMap((prev) => {
                                const next = { ...prev };
                                delete next[recId];
                                return next;
                              });
                            }
                          }
                        : undefined
                    }
                    onArchive={
                      (typeof card.recommendation?.id === 'string' &&
                        card.recommendation.id.trim() &&
                        !card.recommendation.id.startsWith('engine-') &&
                        fetchWithAuth)
                        ? async () => {
                            const recId = (card.recommendation?.id as string).trim();
                            setRecommendationUserStateMap((prev) => ({ ...prev, [recId]: 'ARCHIVED' }));
                            try {
                              const res = await fetchWithAuth!(`/api/recommendations/${encodeURIComponent(recId)}/archive`, { method: 'POST' });
                              if (!res.ok) throw new Error('Failed to archive');
                            } catch (e) {
                              setRecommendationUserStateMap((prev) => {
                                const next = { ...prev };
                                delete next[recId];
                                return next;
                              });
                            }
                          }
                        : undefined
                    }
                  />
                  </div>
                  );
                })
              : null}
          </div>
          {visibleEngineCards.length === 0 && (
            <div className="text-sm text-gray-500 py-6 text-center">
              No enriched recommendation cards available yet. Run the engine to load blueprint-ready cards.
            </div>
          )}
          {Object.values(recommendationUserStateMap).filter((s) => s === 'LONG_TERM').length > 0 && (
            <div className="text-xs text-gray-500">
              Marked long-term: {Object.values(recommendationUserStateMap).filter((s) => s === 'LONG_TERM').length}
            </div>
          )}
          <BOLTProgressModal open={fastLoadingCardId !== null} progress={boltProgress} />
          {jobId && (
            <EngineJobStatusPanel
              createdAt={(polledJob as { created_at?: string } | null)?.created_at}
              durationHint="Typically 2–6 min depending on regions"
              status={jobStatus}
              progressStage={polledJob?.progress_stage}
              confidenceIndex={polledJob?.consolidated_result?.confidence_index ?? polledJob?.confidence_index}
              error={polledJob?.error ?? jobError}
            />
          )}
          {consolidatedResult && (
            <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              <h3 className="text-lg font-semibold text-gray-900 px-6 py-4 border-b border-gray-100 bg-gray-50">
                Global Strategic Intelligence
              </h3>
              <div className="p-6 space-y-6">
                {typeof consolidatedResult.confidence_index === 'number' && (
                  <section>
                    <h4 className="text-sm font-semibold text-gray-800 mb-1">Global Confidence</h4>
                    <p
                      className={`text-lg font-medium ${
                        consolidatedResult.confidence_index > 75
                          ? 'text-green-600'
                          : consolidatedResult.confidence_index >= 50
                            ? 'text-yellow-600'
                            : 'text-red-600'
                      }`}
                    >
                      {consolidatedResult.confidence_index}%
                    </p>
                  </section>
                )}
                <section>
                  <h4 className="text-sm font-semibold text-gray-800 mb-2">Executive Summary</h4>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{consolidatedResult.strategic_summary}</p>
                </section>
                <section>
                  <h4 className="text-sm font-semibold text-gray-800 mb-2">Global Opportunities</h4>
                  <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
                    {consolidatedResult.global_opportunities?.length
                      ? consolidatedResult.global_opportunities.map((o, i) => (
                          <li key={i}>
                            <strong>{o.title}</strong>
                            {o.regions?.length ? ` (${o.regions.join(', ')})` : ''}
                            {o.summary ? ` — ${o.summary}` : ''}
                          </li>
                        ))
                      : <li>None identified</li>}
                  </ul>
                </section>
                {Object.keys(consolidatedResult.region_specific_insights ?? {}).length > 0 && (
                  <section>
                    <h4 className="text-sm font-semibold text-gray-800 mb-2">Region Comparison</h4>
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm text-gray-700">
                        <thead>
                          <tr className="border-b border-gray-200">
                            <th className="text-left py-2 pr-4 font-medium">Region</th>
                            <th className="text-left py-2 pr-4 font-medium">Cultural considerations</th>
                            <th className="text-left py-2 font-medium">Competitive pressure</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(consolidatedResult.region_specific_insights).map(([region, insight]) => (
                            <tr key={region} className="border-b border-gray-100">
                              <td className="py-2 pr-4 font-medium">{region}</td>
                              <td className="py-2 pr-4">{insight.cultural_considerations || '—'}</td>
                              <td className="py-2">{insight.competitive_pressure || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}
                {consolidatedResult.consolidated_risks?.length > 0 && (
                  <section>
                    <h4 className="text-sm font-semibold text-gray-800 mb-2">Risk Alerts</h4>
                    <ul className="list-disc list-inside text-sm text-amber-800 space-y-0.5">
                      {consolidatedResult.consolidated_risks.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </section>
                )}
                {consolidatedResult.execution_priority_order?.length > 0 && (
                  <section>
                    <h4 className="text-sm font-semibold text-gray-800 mb-2">Execution Priority Ranking</h4>
                    <p className="text-sm text-gray-700">
                      {consolidatedResult.execution_priority_order.join(' → ')}
                    </p>
                  </section>
                )}
              </div>
            </div>
          )}
        </div>
      )}
      </div>
      {isSubmitting && (
        <div className="py-6">
          <AIGenerationProgress
            isActive={true}
            message="Generating strategic themes…"
            expectedSeconds={50}
          />
        </div>
      )}

      {historyDrawerOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/20"
            aria-hidden
            onClick={() => setHistoryDrawerOpen(false)}
          />
          <div className="fixed top-0 right-0 bottom-0 z-50 w-full max-w-md bg-white shadow-xl flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Strategic Memory — Last 5 runs</h3>
              <button
                type="button"
                onClick={() => setHistoryDrawerOpen(false)}
                className="p-2 rounded-lg text-gray-500 hover:bg-gray-100"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {historyLoading ? (
                <p className="text-sm text-gray-500">Loading…</p>
              ) : jobHistory.length === 0 ? (
                <p className="text-sm text-gray-500">No past runs yet. Generate recommendations to build history.</p>
              ) : (
                <ul className="space-y-3">
                  {jobHistory.map((job) => (
                    <li
                      key={job.jobId}
                      className="rounded-lg border border-gray-200 p-3 bg-gray-50/50"
                    >
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span
                          className={`text-xs font-medium px-2 py-0.5 rounded ${
                            job.status === 'COMPLETED' || job.status === 'COMPLETED_WITH_WARNINGS'
                              ? 'bg-green-100 text-green-800'
                              : job.status === 'FAILED'
                                ? 'bg-red-100 text-red-800'
                                : 'bg-gray-200 text-gray-700'
                          }`}
                        >
                          {job.status}
                        </span>
                        {typeof job.confidence_index === 'number' && (
                          <span className="text-xs text-gray-600">
                            Confidence: {job.confidence_index}%
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mb-1">
                        {new Date(job.created_at).toLocaleString()}
                      </p>
                      {job.regions?.length > 0 && (
                        <p className="text-xs text-gray-600 mb-2">
                          Regions: {job.regions.join(', ')}
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={() => handleViewIntelligence(job.jobId)}
                        disabled={job.status === 'PENDING' || job.status === 'RUNNING'}
                        className="w-full mt-1 px-3 py-1.5 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                      >
                        View Intelligence
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
