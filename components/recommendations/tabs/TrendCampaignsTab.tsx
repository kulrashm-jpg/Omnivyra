import React, { useState, useEffect, useRef, useMemo } from 'react';
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
} from '../cards/RecommendationBlueprintCard';
import StrategicWorkspacePanel from '../StrategicWorkspacePanel';
import AIGenerationProgress from '../../AIGenerationProgress';
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
  professional_segment: string | null;
  communication_style: string[];
  content_depth: string;
  content_capacity: string;
  campaign_duration: number;
  tentative_start: string | undefined;
  campaign_goal: string;
};

/** Payload sent to backend and stored for attribution (matches API shape). */
export type StrategicPayload = {
  context_mode: string;
  company_context: Record<string, unknown>;
  selected_offerings: string[];
  selected_aspect: string | null;
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
  longTermEngineIds: Set<string>
): { adjustment: number; resurfaced: boolean } {
  let adjustment = 0;
  let resurfaced = false;
  const rec = card.recommendation ?? {};
  const isLongTerm = longTermEngineIds.has(card.id);
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
  const [selectedAspect, setSelectedAspect] = useState<string | null>(null);
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
  const [archivedEngineIds, setArchivedEngineIds] = useState<Set<string>>(new Set());
  const [strategyStatusPayload, setStrategyStatusPayload] = useState<StrategyStatusPayload | null>(null);
  const [longTermEngineIds, setLongTermEngineIds] = useState<Set<string>>(new Set());
  /** Recommendation snapshot IDs already used by this company to create a campaign (hide from list). */
  const [usedRecommendationIds, setUsedRecommendationIds] = useState<Set<string>>(new Set());
  /** Campaign created when user clicked "Generate Strategic Themes"; card is saved to this campaign when they click "Build Campaign Blueprint". */
  const [generatedCampaignId, setGeneratedCampaignId] = useState<string | null>(null);
  const [fastLoadingCardId, setFastLoadingCardId] = useState<string | null>(null);
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
  const [professionalSegment, setProfessionalSegment] = useState<string | null>(null);
  const [communicationStyle, setCommunicationStyle] = useState<string[]>([]);
  const [contentDepth, setContentDepth] = useState<string | null>(null);
  const [contentCapacity, setContentCapacity] = useState<string | null>(null);
  const [campaignDurationInput, setCampaignDurationInput] = useState<number>(4);
  const [tentativeStartDate, setTentativeStartDate] = useState<Date | undefined>();
  const [campaignGoal, setCampaignGoal] = useState<string | null>(null);
  const [executionCalendarOpen, setExecutionCalendarOpen] = useState(false);
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
      if (archivedEngineIds.has(c.id)) return false;
      const snapshotId = typeof c.recommendation?.id === 'string' ? c.recommendation.id.trim() : '';
      if (snapshotId && usedRecommendationIds.has(snapshotId)) return false;
      return true;
    });
  }, [engineRecommendationCards, archivedEngineIds, usedRecommendationIds]);

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
            : selectedAspect ?? '';
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
  }, [visibleEngineCards, strategyHistory, strategyGuidanceMode, selectedAspect]);

  /** Ranked list: strategic score + progress adjustment, stable sort. Top 2 get isTopPriority; resurfaced get label. */
  const rankedEngineCardsWithStatus = useMemo(() => {
    const withScore = visibleEngineCardsWithStatus.map((item, originalIndex) => {
      const baseScore = getRecommendationPriorityScore(item.card);
      const { adjustment, resurfaced } = getProgressAdjustment(
        item.card,
        item.strategyStatus,
        longTermEngineIds
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
  }, [visibleEngineCardsWithStatus, longTermEngineIds]);

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
        return {
          journeyState,
          confidenceTier,
          momentumState,
          strategyStatus,
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
  }, [contextMode, selectedAspect, selectedFacets, strategicText, primaryCampaignType, secondaryCampaignTypes]);

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

  useEffect(() => {
    const wasSubmitting = prevSubmittingRef.current;
    prevSubmittingRef.current = isSubmitting;
    if (wasSubmitting && !isSubmitting && hasRun && visibleEngineCards.length > 0) {
      requestAnimationFrame(() => {
        themesSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
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

  // Offerings shown only after aspect selection (offerings_by_aspect[selected_aspect]).
  const offeringsForSelectedAspect = useMemo(() => {
    if (!selectedAspect) return [];
    const ids = aspectOfferingsMap[selectedAspect];
    return Array.isArray(ids) ? ids : [];
  }, [selectedAspect, aspectOfferingsMap]);

  const offeringFacetCards = useMemo(() => {
    return offeringsForSelectedAspect.map((id: string) => {
      const title = id.includes(':') ? id.split(':').slice(1).join(':').trim() || id : id;
      return { id, title, description: title };
    });
  }, [offeringsForSelectedAspect]);

  // When aspect changes, keep only selected facets that belong to the new aspect.
  useEffect(() => {
    if (!selectedAspect || selectedFacets.length === 0) return;
    const allowed = aspectOfferingsMap[selectedAspect];
    if (!allowed || allowed.length === 0) return;
    const next = selectedFacets.filter((id) => allowed.includes(id));
    if (next.length !== selectedFacets.length) setSelectedFacets(next);
  }, [selectedAspect, aspectOfferingsMap]);

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
      selected_aspect: selectedAspect,
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
      contentCapacity &&
      campaignDurationInput >= 4 &&
      tentativeStartDate &&
      campaignGoal
    ) {
      base.execution_config = {
        target_audience: targetAudience,
        professional_segment: professionalSegment ?? null,
        communication_style: communicationStyle,
        content_depth: contentDepth,
        content_capacity: contentCapacity,
        campaign_duration: campaignDurationInput,
        tentative_start: tentativeStartDate.toISOString(),
        campaign_goal: campaignGoal,
      };
    }
    return base;
  };

  const isValid = (): boolean => {
    if (contextMode !== 'NONE') return !!companyId;
    return !!(additionalDirection.trim() || selectedAspect || selectedFacets.length >= 1 || strategicText.trim() || (clusterInputs && clusterInputs.length > 0));
  };

  const isExecutionValid =
    !!targetAudience &&
    communicationStyle.length > 0 &&
    !!contentDepth &&
    !!contentCapacity &&
    campaignDurationInput >= 4 &&
    !!tentativeStartDate &&
    !!campaignGoal;

  const handleRun = async () => {
    setValidationError(null);
    if (!companyId) {
      setValidationError('Select a company first.');
      return;
    }
    if (!isExecutionValid) {
      setValidationError('Complete Execution Configuration (audience, style, depth, capacity, duration, start date, goal) before generating themes.');
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
      const recRes = await fetchWithAuth('/api/recommendations/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          objective,
          durationWeeks: 12,
          ...(regionList.length > 0 ? { regions: regionList } : {}),
          strategicPayload: payload,
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
      if (selectedAspect) parts.push(<span key="aspect">• Aspect: {selectedAspect}</span>);
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
    if (selectedAspect) lines.push(<span key="aspect">• Aspect: {selectedAspect}</span>);
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
      <div className="rounded-lg border border-gray-200 p-4">
        <EngineContextPanel
          companyId={companyId}
          fetchWithAuth={fetchWithAuth}
          contextMode={contextMode}
          focusedModules={focusedModules}
          additionalDirection={additionalDirection}
        />
      </div>
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
                <span>{targetAudience ?? '—'}</span>
                <span>{communicationStyle?.length ? communicationStyle.join(', ') : '—'}</span>
                <span>{contentDepth ?? '—'}</span>
                <span>{contentCapacity ?? '—'}</span>
                <span>{campaignDurationInput}w</span>
                <span>{campaignGoal ?? '—'}</span>
                <span>{tentativeStartDate ? tentativeStartDate.toLocaleDateString(undefined, { dateStyle: 'long' }) : '—'}</span>
              </div>
            </div>
          )}
          {!executionCollapsed && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-gray-600" title="Who is the primary audience for this campaign?">Target Audience</label>
              <div className="flex flex-wrap items-center gap-1.5" role="group">
                {['Professionals', 'Entrepreneurs', 'Students', 'SMB', 'Parents'].map((v) => (
                  <button
                    key={v}
                    type="button"
                    title="Who is the primary audience for this campaign?"
                    onClick={() => setTargetAudience(v)}
                    className={`px-2 py-1 text-xs rounded-md border transition-colors ${
                      targetAudience === v ? 'bg-indigo-100 border-indigo-300 text-indigo-800' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {v}
                  </button>
                ))}
                {targetAudience === 'Professionals' && (
                  <select
                    value={professionalSegment ?? ''}
                    onChange={(e) => setProfessionalSegment(e.target.value || null)}
                    title={professionalSegment ? `Segment selected: ${professionalSegment}. This refines recommendations for professional audiences.` : 'Narrow down which type of professionals (optional).'}
                    className={`h-9 min-w-[7rem] rounded-md border px-2 text-sm text-gray-900 ${
                      professionalSegment
                        ? 'border-indigo-400 bg-indigo-50 text-indigo-900 ring-1 ring-indigo-200'
                        : 'border-amber-300 bg-amber-50/80 text-amber-900'
                    }`}
                  >
                    <option value="">Select</option>
                    <option value="Managers">Managers</option>
                    <option value="Job Seekers">Job Seekers</option>
                    <option value="Founders">Founders</option>
                    <option value="Corporate">Corporate</option>
                  </select>
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-gray-600" title="What is the main goal of this campaign?">Campaign Goal</label>
              <div className="flex flex-wrap gap-1" role="group">
                {['Awareness', 'Leads', 'Engagement', 'Product'].map((v) => (
                  <button
                    key={v}
                    type="button"
                    title="What is the main goal of this campaign?"
                    onClick={() => setCampaignGoal(v)}
                    className={`px-2 py-1 text-xs rounded-md border transition-colors ${
                      campaignGoal === v ? 'bg-indigo-100 border-indigo-300 text-indigo-800' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-gray-600" title="How detailed should each piece of content be?">Content Depth</label>
              <div className="flex flex-wrap gap-1" role="group">
                {['Short', 'Medium', 'Long'].map((v) => (
                  <button
                    key={v}
                    type="button"
                    title="How detailed should each piece of content be?"
                    onClick={() => setContentDepth(v)}
                    className={`px-2 py-1 text-xs rounded-md border transition-colors ${
                      contentDepth === v ? 'bg-indigo-100 border-indigo-300 text-indigo-800' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-gray-600" title="How much content can you produce every week?">Content Capacity</label>
              <select
                value={contentCapacity ?? ''}
                onChange={(e) => setContentCapacity(e.target.value || null)}
                title="How much content can you produce every week?"
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
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-gray-600" title="How many weeks will this campaign run?">Campaign Duration (weeks)</label>
              <Input
                type="number"
                min={4}
                value={campaignDurationInput}
                onChange={(e) => setCampaignDurationInput(Math.max(4, parseInt(e.target.value, 10) || 4))}
                className="h-9 text-sm"
                title="How many weeks will this campaign run?"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-gray-600" title="When do you plan to start this campaign?">Start Date</label>
              <div className="relative">
                <button
                  type="button"
                  title="When do you plan to start this campaign?"
                  onClick={() => setExecutionCalendarOpen((o) => !o)}
                  className="w-full h-9 rounded-md border border-gray-200 bg-white px-2 text-sm text-left text-gray-900"
                >
                  {tentativeStartDate ? tentativeStartDate.toLocaleDateString(undefined, { dateStyle: 'medium' }) : 'Pick date'}
                </button>
                {executionCalendarOpen && (
                  <>
                    <div className="fixed inset-0 z-10" aria-hidden onClick={() => setExecutionCalendarOpen(false)} />
                    <div className="absolute z-20 mt-1 left-0 p-2 rounded-lg border border-gray-200 bg-white shadow-lg">
                      <input
                        type="date"
                        value={tentativeStartDate?.toISOString().slice(0, 10) ?? ''}
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
            <div className="space-y-1.5 md:col-span-2">
              <label className="block text-xs font-medium text-gray-600" title="Tone and style of your content (pick up to 2).">Communication Style (max 2)</label>
              <div className="flex flex-wrap gap-2">
                {['Professional', 'Conversational', 'Educational', 'Inspirational'].map((v) => {
                  const checked = communicationStyle.includes(v);
                  return (
                    <label key={v} className="inline-flex items-center gap-1.5 cursor-pointer text-sm" title="Tone and style of your content (pick up to 2).">
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
          )}
        </div>
      </div>
      <StrategicAspectSelector
        aspects={aspects}
        selectedAspect={selectedAspect}
        onChange={setSelectedAspect}
      />
      <OfferingFacetSelector
        selectedAspect={selectedAspect}
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
      <StrategicConsole
        value={strategicText}
        onChange={setStrategicText}
        mode={contextMode}
      />
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
      <div>
        <button
          type="button"
          onClick={handleRun}
          disabled={isSubmitting || !isExecutionValid}
          className="px-6 py-3 text-base font-medium rounded-lg bg-indigo-600 text-white disabled:opacity-50"
        >
          {isSubmitting ? 'Generating…' : 'Generate Strategic Themes'}
        </button>
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
          {visibleEngineCards.length > 0 && (
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
          )}
          {rankedEngineCardsWithStatus.length > 0 && (
            <>
              <StrategicWorkspacePanel
                flowState={strategicFlowState}
                cardsWithSignals={workspaceSummaryData.cardsWithSignals}
                strategyStatusPayload={strategyStatusPayload ?? undefined}
              />
              <StrategicFlowSummary state={strategicFlowState} />
            </>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 transition-all duration-200 ease-out">
            {rankedEngineCardsWithStatus.length > 0
              ? rankedEngineCardsWithStatus.map(({ card, strategyStatus, isTopPriority, resurfaced }) => (
                  <div key={card.id} className="transition-all duration-200 ease-out">
                    <RecommendationBlueprintCard
                    key={card.id}
                    recommendation={card.recommendation}
                    strategyStatus={strategyStatus}
                    viewMode={viewMode}
                    isTopPriority={isTopPriority}
                    resurfaced={resurfaced}
                    fastLoading={fastLoadingCardId === card.id}
                    onBuildCampaignBlueprint={async () => {
                      if (!companyId) {
                        setValidationError('Select a company first.');
                        return;
                      }
                      setValidationError(null);
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
                            contentCapacity &&
                            campaignDurationInput >= 4 &&
                            tentativeStartDate &&
                            campaignGoal &&
                            communicationStyle.length > 0
                              ? {
                                  target_audience: targetAudience,
                                  professional_segment: professionalSegment ?? null,
                                  communication_style: communicationStyle,
                                  content_depth: contentDepth,
                                  content_capacity: contentCapacity,
                                  campaign_duration: campaignDurationInput,
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
                          createdCampaignId = generatedCampaignId;
                          setGeneratedCampaignId(null);
                        } else {
                          // Fallback: create a new campaign (e.g. if Generate didn't create one).
                          const campaignId = uuidv4();
                          const executionConfigPayload =
                            targetAudience &&
                            contentDepth &&
                            contentCapacity &&
                            campaignDurationInput >= 4 &&
                            tentativeStartDate &&
                            campaignGoal &&
                            communicationStyle.length > 0
                              ? {
                                  target_audience: targetAudience,
                                  professional_segment: professionalSegment ?? null,
                                  communication_style: communicationStyle,
                                  content_depth: contentDepth,
                                  content_capacity: contentCapacity,
                                  campaign_duration: campaignDurationInput,
                                  tentative_start: tentativeStartDate.toISOString(),
                                  campaign_goal: campaignGoal,
                                }
                              : null;
                          const response = await fetchWithAuth('/api/campaigns', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              id: campaignId,
                              companyId,
                              name: title,
                              description,
                              status: 'planning',
                              current_stage: 'planning',
                              build_mode: 'no_context',
                              source_opportunity_id: sourceOpportunityId,
                              recommendation_id: recId || null,
                              target_regions: regionsFromCard.length > 0 ? regionsFromCard : undefined,
                              context_payload:
                                Object.keys(contextPayload).length > 0 ? contextPayload : undefined,
                              source_strategic_theme: sourceStrategicTheme,
                              execution_config: executionConfigPayload,
                              planning_context: {
                                context_mode: contextMode,
                                focused_modules:
                                  contextMode === 'FOCUSED' && focusedModules.length > 0
                                    ? focusedModules
                                    : undefined,
                                additional_direction: additionalDirection.trim() || undefined,
                              },
                            }),
                          });
                          if (!response.ok) {
                            const err = await response.json().catch(() => ({}));
                            throw new Error(err?.error || 'Failed to create campaign');
                          }
                          const data = await response.json().catch(() => ({}));
                          createdCampaignId =
                            data?.campaign?.id && typeof data.campaign.id === 'string'
                              ? data.campaign.id
                              : campaignId;
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
                        setValidationError(
                          error instanceof Error
                            ? error.message
                            : 'Failed to open campaign pre-planning flow'
                        );
                      }
                    }}
                    onBuildCampaignFast={async () => {
                      if (fastLoadingCardId === card.id) return;
                      if (!companyId) {
                        setValidationError('Select a company first.');
                        return;
                      }
                      setValidationError(null);
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
                      const executionConfigPayload =
                        targetAudience &&
                        contentDepth &&
                        contentCapacity &&
                        campaignDurationInput >= 4 &&
                        tentativeStartDate &&
                        campaignGoal &&
                        communicationStyle.length > 0
                          ? {
                              target_audience: targetAudience,
                              professional_segment: professionalSegment ?? null,
                              communication_style: communicationStyle,
                              content_depth: contentDepth,
                              content_capacity: contentCapacity,
                              campaign_duration: campaignDurationInput,
                              tentative_start: tentativeStartDate.toISOString().split('T')[0],
                              campaign_goal: campaignGoal,
                            }
                          : null;
                      if (!executionConfigPayload) {
                        setValidationError('Complete the execution bar (audience, depth, capacity, duration ≥4, start date, goal, style) to use BOLT.');
                        return;
                      }
                      setFastLoadingCardId(card.id);
                      try {
                        let createdCampaignId: string;
                        if (generatedCampaignId) {
                          const putRes = await fetchWithAuth(
                            `/api/campaigns/${encodeURIComponent(generatedCampaignId)}/source-recommendation`,
                            {
                              method: 'PUT',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                source_recommendation_id: recId || null,
                                source_strategic_theme: sourceStrategicTheme,
                                execution_config: executionConfigPayload,
                                mode: 'fast',
                              }),
                            }
                          );
                          if (!putRes.ok) {
                            const err = await putRes.json().catch(() => ({}));
                            throw new Error(err?.error || 'Failed to save card to campaign');
                          }
                          createdCampaignId = generatedCampaignId;
                          setGeneratedCampaignId(null);
                        } else {
                          const campaignId = uuidv4();
                          const response = await fetchWithAuth('/api/campaigns', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              id: campaignId,
                              companyId,
                              name: title,
                              description,
                              status: 'planning',
                              current_stage: 'planning',
                              build_mode: 'no_context',
                              source_opportunity_id: sourceOpportunityId,
                              recommendation_id: recId || null,
                              target_regions: regionsFromCard.length > 0 ? regionsFromCard : undefined,
                              source_strategic_theme: sourceStrategicTheme,
                              execution_config: executionConfigPayload,
                              mode: 'fast',
                            }),
                          });
                          if (!response.ok) {
                            const err = await response.json().catch(() => ({}));
                            throw new Error(err?.error || 'Failed to create campaign');
                          }
                          const data = await response.json().catch(() => ({}));
                          createdCampaignId =
                            data?.campaign?.id && typeof data.campaign.id === 'string'
                              ? data.campaign.id
                              : campaignId;
                        }
                        if (recId) {
                          setUsedRecommendationIds((prev) => new Set([...prev, recId]));
                        }
                        if (!createdCampaignId) {
                          throw new Error('Campaign ID missing before Fast Mode planning.');
                        }
                        const campaignRes = await fetchWithAuth(
                          `/api/campaigns?type=campaign&campaignId=${encodeURIComponent(createdCampaignId)}&companyId=${encodeURIComponent(companyId)}`
                        );
                        const campaignData = await campaignRes.json();
                        const prefilledPlanning = campaignData.prefilledPlanning ?? {};
                        const recommendationContextFromCampaign = campaignData.recommendationContext ?? null;
                        const conversationHistory = [
                          { type: 'user' as const, message: 'Yes, generate my full 12-week plan now.' },
                        ];
                        const planRes = await fetchWithAuth('/api/campaigns/ai/plan', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            campaignId: createdCampaignId,
                            companyId,
                            context: 'campaign-planning',
                            conversationHistory,
                            prefilledPlanning,
                            recommendationContext: recommendationContextFromCampaign,
                            forceFreshPlanningThread: true,
                          }),
                        });
                        if (!planRes.ok) {
                          console.error('Fast Mode plan failed', {
                            campaignId: createdCampaignId,
                            status: planRes.status,
                          });
                          if (isMountedRef.current) {
                            setFastLoadingCardId(null);
                          }
                          router.push(`/campaign-details/${createdCampaignId}`);
                          return;
                        }
                        await new Promise((resolve) => setTimeout(resolve, 250));
                        if (isMountedRef.current) {
                          setFastLoadingCardId(null);
                        }
                        router.push(`/campaign-details/${createdCampaignId}?mode=fast`);
                      } catch (error) {
                        if (isMountedRef.current) {
                          setFastLoadingCardId(null);
                        }
                        setValidationError(
                          error instanceof Error
                            ? error.message
                            : 'Failed to run BOLT (Fast Mode)'
                        );
                      }
                    }}
                    onMarkLongTerm={() =>
                      setLongTermEngineIds((prev) => {
                        const next = new Set(prev);
                        next.add(card.id);
                        return next;
                      })
                    }
                    onArchive={() =>
                      setArchivedEngineIds((prev) => {
                        const next = new Set(prev);
                        next.add(card.id);
                        return next;
                      })
                    }
                  />
                  </div>
                ))
              : null}
          </div>
          {visibleEngineCards.length === 0 && (
            <div className="text-sm text-gray-500 py-6 text-center">
              No enriched recommendation cards available yet. Run the engine to load blueprint-ready cards.
            </div>
          )}
          {longTermEngineIds.size > 0 && (
            <div className="text-xs text-gray-500">
              Marked long-term: {longTermEngineIds.size}
            </div>
          )}
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
