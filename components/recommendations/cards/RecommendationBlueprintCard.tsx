import React, { useMemo, useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

export type StrategyStatus = 'continuation' | 'expansion' | 'neutral' | 'momentum_expand';

/** Where to show the outcome after BOLT. Default = campaign_schedule (auto-schedule as per campaign date). */
export type BoltOutcomeView = 'week_plan' | 'daily_plan' | 'repurpose' | 'schedule' | 'campaign_schedule';

/** BOLT creates campaigns of 4 weeks or less. */
const BOLT_DURATION_OPTIONS = [
  { value: 1, label: '1 week' },
  { value: 2, label: '2 weeks' },
  { value: 3, label: '3 weeks' },
  { value: 4, label: '4 weeks' },
] as const;

const BOLT_OUTCOME_OPTIONS: { value: BoltOutcomeView; label: string }[] = [
  { value: 'week_plan', label: 'Week Plan' },
  { value: 'daily_plan', label: 'Daily Plan' },
  { value: 'repurpose', label: 'Repurpose' },
  { value: 'schedule', label: 'Schedule' },
  { value: 'campaign_schedule', label: 'Schedule as per campaign date' },
];

/** Role-based view: FULL = all sections (Content Architect, Super Admin); MINIMAL = decision-focused (company users). */
export type RecommendationCardViewMode = 'FULL' | 'MINIMAL';

/** Returns true for roles that see the full strategic recommendation card. */
export function isFullRecommendationView(role: string | null): boolean {
  if (!role || typeof role !== 'string') return false;
  const r = role.toUpperCase();
  return r === 'CONTENT_ARCHITECT' || r === 'SUPER_ADMIN';
}

type RecommendationBlueprintCardProps = {
  recommendation: Record<string, unknown>;
  onBuildCampaignBlueprint?: () => Promise<void> | void;
  /** Receives outcomeView and durationWeeks (1–4). campaign_schedule = none checked (auto-schedule per campaign date). */
  onBuildCampaignFast?: (options?: { outcomeView?: BoltOutcomeView; durationWeeks?: number }) => Promise<void> | void;
  /** When true, BOLT is in progress for this card (show loading, disable button). */
  fastLoading?: boolean;
  onMarkLongTerm?: () => Promise<void> | void;
  onArchive?: () => Promise<void> | void;
  /** Journey signal: show small badge (only when campaigns_count > 0). */
  strategyStatus?: StrategyStatus;
  /** FULL = all sections (default); MINIMAL = decision-focused card only. */
  viewMode?: RecommendationCardViewMode;
  /** When true, show subtle "AI Priority" label in header (top 1–2 in ranked list). */
  isTopPriority?: boolean;
  /** When true, show subtle "Re-surfaced Opportunity" label (progress-aware boost applied). */
  resurfaced?: boolean;
  /** When set, show "One of N opportunities ready for execution (K of N)" on the card. */
  executionBadge?: { index: number; total: number };
  /** When set, show "One of N strategic directions forming (K of N)" on the card. */
  upcomingBadge?: { index: number; total: number };
  /** Error message when "Start this campaign" / "Build Campaign Blueprint" failed (shown on card). */
  buildError?: string;
};

export type JourneyState = 'past' | 'current' | 'upcoming' | null;

/** One journey label per card: past (in progress), current (focus), or upcoming (resurfaced). */
/** Exported for list-level flow summary (e.g. TrendCampaignsTab). */
export function getJourneyState(props: {
  strategyStatus?: StrategyStatus;
  isTopPriority?: boolean;
  resurfaced?: boolean;
}): JourneyState {
  const { strategyStatus, isTopPriority, resurfaced } = props;
  if (strategyStatus === 'continuation' || strategyStatus === 'expansion') return 'past';
  if (isTopPriority) return 'current';
  if (resurfaced) return 'upcoming';
  return null;
}

const JOURNEY_LABELS: Record<Exclude<JourneyState, null>, { text: string; className: string }> = {
  past: { text: '✓ In Progress', className: 'text-slate-400' },
  current: { text: '● Current Focus', className: 'text-slate-500 font-medium' },
  upcoming: { text: '↗ Upcoming Opportunity', className: 'text-slate-400' },
};

function RecommendationJourneyLabel(props: { state: Exclude<JourneyState, null> }) {
  const { text, className } = JOURNEY_LABELS[props.state];
  return (
    <span className={`inline-flex items-center text-xs ${className}`} title="Journey position">
      {text}
    </span>
  );
}

const NARRATIVE_BY_STATE: Record<Exclude<JourneyState, null>, string> = {
  past: 'Building on your current direction, this recommendation extends the strategy forward.',
  current: 'Based on your current momentum, this is the strongest next strategic focus.',
  upcoming: 'As your strategy progresses, this is positioned as a strong upcoming opportunity.',
};

/** AI narrative continuity — one sentence explaining why this recommendation appears now. Presentation only. */
function RecommendationNarrativeLine(props: { state: Exclude<JourneyState, null> }) {
  const sentence = NARRATIVE_BY_STATE[props.state];
  if (!sentence) return null;
  return (
    <p className="mt-2 text-sm text-slate-500 italic" role="status">
      {sentence}
    </p>
  );
}

type StrategicMemoryState = 'reinforcement' | 'momentum' | 'emerging' | null;

/** One strategic memory line per card: why this recommendation gains relevance now. Derived from existing props only. */
function getStrategicMemoryState(props: {
  strategyStatus?: StrategyStatus;
  isTopPriority?: boolean;
  resurfaced?: boolean;
}): StrategicMemoryState {
  const { strategyStatus, isTopPriority, resurfaced } = props;
  if (strategyStatus === 'continuation' || strategyStatus === 'expansion') return 'reinforcement';
  if (isTopPriority) return 'momentum';
  if (resurfaced) return 'emerging';
  return null;
}

const STRATEGIC_MEMORY_MESSAGES: Record<Exclude<StrategicMemoryState, null>, string> = {
  reinforcement:
    "Because you're already moving in this direction, the AI sees strong strategic continuity here.",
  momentum:
    'This opportunity is elevated because it aligns with your current momentum.',
  emerging:
    'This has gained strength as your recent strategy signals evolved.',
};

/** AI strategic memory — one sentence quiet commentary. Presentation only. */
function RecommendationStrategicMemoryLine(props: { state: Exclude<StrategicMemoryState, null> }) {
  const sentence = STRATEGIC_MEMORY_MESSAGES[props.state];
  if (!sentence) return null;
  return (
    <p className="mt-2 text-xs text-slate-400 italic" role="status">
      {sentence}
    </p>
  );
}

type IntentForecastState = 'momentum' | 'progression' | 'continuity' | null;

/** One intent forecast per card: what likely comes next if user acts. Derived from existing signals only. */
function getIntentForecastState(props: {
  journeyState: JourneyState;
  confidenceTier: ConfidenceTier;
  strategyStatus?: StrategyStatus;
}): IntentForecastState {
  const { journeyState, confidenceTier, strategyStatus } = props;
  const isPastOrContinuity =
    journeyState === 'past' ||
    strategyStatus === 'continuation' ||
    strategyStatus === 'expansion';
  if (isPastOrContinuity) return 'continuity';
  if (journeyState === 'current' && confidenceTier === 'high') return 'momentum';
  if (journeyState === 'upcoming' || confidenceTier === 'medium') return 'progression';
  return null;
}

const INTENT_FORECAST_MESSAGES: Record<Exclude<IntentForecastState, null>, string> = {
  momentum:
    'If executed now, this is likely to accelerate momentum toward conversion-focused activity.',
  progression:
    'If you explore this next, it will likely become a stronger strategic focus as your campaign progresses.',
  continuity:
    'Continuing along this path will likely deepen consistency and strengthen long-term positioning.',
};

/** AI intent forecast — one sentence gentle prediction. Presentation only. */
function RecommendationIntentForecastLine(props: { state: Exclude<IntentForecastState, null> }) {
  const sentence = INTENT_FORECAST_MESSAGES[props.state];
  if (!sentence) return null;
  return (
    <p className="mt-2 text-xs text-slate-400 italic" role="status">
      {sentence}
    </p>
  );
}

export type MomentumState = 'execute' | 'plan' | 'consistent' | null;

/** Exported for list-level flow summary (e.g. TrendCampaignsTab). Decision momentum from existing signals only. */
export function getDecisionMomentumState(props: {
  confidenceTier: ConfidenceTier;
  journeyState: JourneyState;
  strategyStatus?: StrategyStatus;
}): MomentumState {
  const { confidenceTier, journeyState, strategyStatus } = props;
  const isContinuationOrExpansion =
    strategyStatus === 'continuation' || strategyStatus === 'expansion';
  if (journeyState === 'past' || isContinuationOrExpansion) return 'consistent';
  if (confidenceTier === 'high' && journeyState === 'current' && !isContinuationOrExpansion) {
    return 'execute';
  }
  if (confidenceTier === 'medium' || journeyState === 'upcoming') return 'plan';
  return null;
}

const MOMENTUM_CUE_MESSAGES: Record<Exclude<MomentumState, null>, string> = {
  execute: 'AI suggests strong execution momentum.',
  plan: 'AI suggests planning momentum.',
  consistent: 'AI suggests maintaining strategic consistency.',
};

/** AI decision momentum cue — whisper-level guidance. Presentation only. */
function RecommendationMomentumCue(props: { state: Exclude<MomentumState, null> }) {
  const sentence = MOMENTUM_CUE_MESSAGES[props.state];
  if (!sentence) return null;
  return (
    <p className="mt-2 text-xs text-slate-400 italic" role="status">
      {sentence}
    </p>
  );
}

const readText = (obj: Record<string, unknown> | null | undefined, key: string): string | null => {
  if (!obj) return null;
  const value = obj[key];
  return typeof value === 'string' && value.trim() ? value : null;
};

const readNumber = (obj: Record<string, unknown> | null | undefined, key: string): number | null => {
  if (!obj) return null;
  const value = obj[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
};

const readList = (obj: Record<string, unknown> | null | undefined, key: string): string[] => {
  if (!obj) return [];
  const value = obj[key];
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === 'string' ? v.trim() : String(v).trim()))
    .filter(Boolean);
};

const readTopicList = (obj: Record<string, unknown> | null | undefined, key: string): string[] => {
  if (!obj) return [];
  const value = obj[key];
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (item && typeof item === 'object' && typeof (item as { topic?: unknown }).topic === 'string') {
        return (item as { topic: string }).topic.trim();
      }
      return null;
    })
    .filter((v): v is string => !!v);
};

const MAX_BANNER_SNIPPET = 80;

function getTransformationSummary(
  problem: string | null,
  transformation: string | null,
  summaryFallback: string | null
): string {
  const truncate = (s: string) =>
    s.length <= MAX_BANNER_SNIPPET ? s : s.slice(0, MAX_BANNER_SNIPPET).trim() + '…';
  if (problem && transformation) {
    return `Designed to move your audience from ${truncate(problem)} → ${truncate(transformation)}`;
  }
  if (problem) {
    return `Designed to address: ${truncate(problem)}. Clear audience progress and momentum.`;
  }
  if (transformation) {
    return `Designed to achieve: ${truncate(transformation)}.`;
  }
  if (summaryFallback) {
    return summaryFallback.length <= MAX_BANNER_SNIPPET * 2
      ? summaryFallback
      : summaryFallback.slice(0, MAX_BANNER_SNIPPET).trim() + '…';
  }
  return 'Designed to create clear audience progress and momentum.';
}

export type ConfidenceTier = 'high' | 'medium' | 'low';

function getConfidenceTier(
  finalAlignmentScore: number | null,
  strategyModifier: number | null,
  diamondType: string | null,
  polishFlags: Record<string, unknown> | null | undefined
): ConfidenceTier {
  const diamondCandidate =
    diamondType === 'diamond_candidate' ||
    diamondType === 'authority_elevated' ||
    polishFlags?.diamond_candidate === true ||
    polishFlags?.authority_elevated === true;
  if (diamondCandidate) return 'high';
  const score = finalAlignmentScore ?? 0;
  if (score >= 0.6) return 'high';
  if (score >= 0.35 || (strategyModifier != null && strategyModifier > 0)) return 'medium';
  return 'low';
}

/** Exported for UI-level priority ranking (e.g. TrendCampaignsTab). Single source of truth for tier from recommendation data. */
export function getConfidenceTierForRecommendation(
  rec: Record<string, unknown> | null | undefined
): ConfidenceTier {
  if (!rec || typeof rec !== 'object') return 'low';
  const finalAlignmentScore = readNumber(rec, 'final_alignment_score') ?? readNumber(rec, 'finalAlignmentScore');
  const strategyModifier = readNumber(rec, 'strategy_modifier');
  const diamondType = readText(rec, 'diamond_type');
  const polishFlags = (rec.polish_flags as Record<string, unknown> | undefined) ?? undefined;
  return getConfidenceTier(finalAlignmentScore, strategyModifier, diamondType, polishFlags);
}

function getConfidencePhrase(tier: ConfidenceTier): string {
  switch (tier) {
    case 'high':
      return 'High confidence — strong strategic alignment detected.';
    case 'medium':
      return 'Moderate confidence — strong potential with clear execution direction.';
    case 'low':
    default:
      return 'Early-stage opportunity — recommended for exploration and testing.';
  }
}

function getConfidenceBannerTone(tier: ConfidenceTier): string {
  switch (tier) {
    case 'high':
      return 'border-slate-300';
    case 'medium':
      return 'border-slate-200';
    case 'low':
    default:
      return 'border-slate-100';
  }
}

function getPrimaryActionLabel(tier: ConfidenceTier): string {
  switch (tier) {
    case 'high':
      return 'Start This Campaign';
    case 'medium':
      return 'Build Campaign Blueprint';
    case 'low':
    default:
      return 'Explore This Strategy';
  }
}

function getExpandActionLabel(tier: ConfidenceTier): string {
  return tier === 'low' ? 'Explore Strategy Details' : 'Expand Theme Strategy';
}

/** AI confidence framing banner — visible in both FULL and MINIMAL. Uses existing card data only. */
function RecommendationConfidenceBanner(props: {
  transformationLine: string;
  confidenceLine: string;
  tier: ConfidenceTier;
}) {
  const { transformationLine, confidenceLine, tier } = props;
  const toneClass = getConfidenceBannerTone(tier);
  return (
    <div
      className={`mt-4 rounded-lg border bg-slate-50 px-4 py-3 ${toneClass}`}
      role="region"
      aria-label="AI recommendation summary"
    >
      <div className="flex gap-3">
        <span className="text-lg leading-none text-slate-500" aria-hidden>
          💎
        </span>
        <div className="min-w-0 flex-1 space-y-1 text-sm">
          <div className="font-semibold text-slate-800">Recommended Campaign Direction</div>
          <div className="text-slate-700">{transformationLine}</div>
          <div className="text-slate-600">{confidenceLine}</div>
        </div>
      </div>
    </div>
  );
}

export default function RecommendationBlueprintCard(props: RecommendationBlueprintCardProps) {
  const { recommendation, onBuildCampaignBlueprint, onBuildCampaignFast, fastLoading, onMarkLongTerm, onArchive, strategyStatus, viewMode = 'FULL', isTopPriority, resurfaced, executionBadge, upcomingBadge, buildError } = props;
  const [expanded, setExpanded] = useState(false);
  const [minimized, setMinimized] = useState(true);
  const [busy, setBusy] = useState(false);
  const [boltMenuOpen, setBoltMenuOpen] = useState(false);
  const [boltOutcomeView, setBoltOutcomeView] = useState<BoltOutcomeView>('campaign_schedule');
  const [boltDurationWeeks, setBoltDurationWeeks] = useState<number>(4);
  const boltMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!boltMenuOpen) return;
    const onOutside = (e: MouseEvent) => {
      if (boltMenuRef.current && !boltMenuRef.current.contains(e.target as Node)) {
        setBoltMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [boltMenuOpen]);
  const isMinimal = viewMode === 'MINIMAL';
  const journeyState = getJourneyState({ strategyStatus, isTopPriority, resurfaced });
  const memoryState = getStrategicMemoryState({ strategyStatus, isTopPriority, resurfaced });
  const confidenceTier = useMemo(
    () => getConfidenceTierForRecommendation(recommendation ?? {}),
    [recommendation]
  );
  const forecastState = useMemo(
    () =>
      getIntentForecastState({
        journeyState,
        confidenceTier,
        strategyStatus,
      }),
    [journeyState, confidenceTier, strategyStatus]
  );
  const momentumState = useMemo(
    () =>
      getDecisionMomentumState({
        confidenceTier,
        journeyState,
        strategyStatus,
      }),
    [confidenceTier, journeyState, strategyStatus]
  );
  const primaryButtonEmphasis =
    momentumState === 'execute' ? 'font-semibold' : 'font-medium';

  const rec = recommendation ?? {};
  const intelligence = (rec.intelligence as Record<string, unknown> | undefined) ?? null;
  const execution = (rec.execution as Record<string, unknown> | undefined) ?? null;
  const snapshot = (rec.company_context_snapshot as Record<string, unknown> | undefined) ?? null;
  const polishFlags = (rec.polish_flags as Record<string, unknown> | undefined) ?? null;

  const core = {
    topic: readText(rec, 'topic'),
    polished_title: readText(rec, 'polished_title'),
    summary: readText(rec, 'summary') ?? readText(rec, 'narrative_direction'),
    estimated_reach: readNumber(rec, 'estimated_reach') ?? readNumber(rec, 'volume'),
    formats: readList(rec, 'formats'),
    regions: readList(rec, 'regions'),
  };

  const strategicContext = {
    aspect: readText(rec, 'aspect') ?? readText(rec, 'selected_aspect'),
    facets: readList(rec, 'facets'),
    audience_personas: readList(rec, 'audience_personas'),
    messaging_hooks: readList(rec, 'messaging_hooks'),
  };

  const intelligenceBlock = {
    problem_being_solved: readText(intelligence, 'problem_being_solved'),
    gap_being_filled: readText(intelligence, 'gap_being_filled'),
    why_now: readText(intelligence, 'why_now'),
    authority_reason: readText(intelligence, 'authority_reason'),
    expected_transformation: readText(intelligence, 'expected_transformation'),
    campaign_angle: readText(intelligence, 'campaign_angle'),
  };

  const signals = {
    diamond_type: readText(rec, 'diamond_type'),
    strategy_mode: readText(rec, 'strategy_mode'),
    final_alignment_score:
      readNumber(rec, 'final_alignment_score') ?? readNumber(rec, 'finalAlignmentScore'),
    strategy_modifier: readNumber(rec, 'strategy_modifier'),
  };

  const executionBlock = {
    execution_stage:
      readText(execution, 'execution_stage') ?? readText(rec, 'execution_stage'),
    stage_objective:
      readText(execution, 'stage_objective') ?? readText(rec, 'stage_objective'),
    psychological_goal:
      readText(execution, 'psychological_goal') ?? readText(rec, 'psychological_goal'),
    momentum_level:
      readText(execution, 'momentum_level') ?? readText(rec, 'momentum_level'),
  };

  const snapshotBlock = {
    core_problem_statement: readText(snapshot, 'core_problem_statement'),
    pain_symptoms: readList(snapshot, 'pain_symptoms'),
    desired_transformation: readText(snapshot, 'desired_transformation'),
    authority_domains: readList(snapshot, 'authority_domains'),
    brand_voice: readText(snapshot, 'brand_voice'),
    brand_positioning: readText(snapshot, 'brand_positioning'),
    reader_emotion_target: readText(snapshot, 'reader_emotion_target'),
    narrative_flow_seed: readText(snapshot, 'narrative_flow_seed'),
    recommended_cta_style: readText(snapshot, 'recommended_cta_style'),
  };

  const blueprint = {
    duration_weeks: readNumber(rec, 'duration_weeks'),
    progression_summary: readText(rec, 'progression_summary'),
    primary_recommendations: readTopicList(rec, 'primary_recommendations'),
    supporting_recommendations: readTopicList(rec, 'supporting_recommendations'),
  };

  const badges = useMemo(() => {
    const values: string[] = [];
    if (signals.diamond_type === 'authority_elevated' || polishFlags?.authority_elevated === true) {
      values.push('Authority Opportunity');
    }
    if (signals.diamond_type === 'diamond_candidate' || polishFlags?.diamond_candidate === true) {
      values.push('Diamond Candidate');
    }
    const angle = (intelligenceBlock.campaign_angle || '').toLowerCase();
    if (angle.includes('convert') || angle.includes('conversion')) {
      values.push('Conversion Driver');
    }
    return values;
  }, [signals.diamond_type, polishFlags, intelligenceBlock.campaign_angle]);

  const hasStrategicContext =
    !!strategicContext.aspect ||
    strategicContext.facets.length > 0 ||
    strategicContext.audience_personas.length > 0 ||
    strategicContext.messaging_hooks.length > 0;
  const hasIntelligence =
    !!intelligenceBlock.problem_being_solved ||
    !!intelligenceBlock.gap_being_filled ||
    !!intelligenceBlock.why_now ||
    !!intelligenceBlock.authority_reason ||
    !!intelligenceBlock.expected_transformation ||
    !!intelligenceBlock.campaign_angle;
  const hasSnapshot =
    !!snapshotBlock.core_problem_statement ||
    snapshotBlock.pain_symptoms.length > 0 ||
    !!snapshotBlock.desired_transformation ||
    snapshotBlock.authority_domains.length > 0 ||
    !!snapshotBlock.brand_voice ||
    !!snapshotBlock.brand_positioning ||
    !!snapshotBlock.reader_emotion_target ||
    !!snapshotBlock.narrative_flow_seed ||
    !!snapshotBlock.recommended_cta_style;
  const hasExecution =
    !!executionBlock.execution_stage ||
    !!executionBlock.stage_objective ||
    !!executionBlock.psychological_goal ||
    !!executionBlock.momentum_level;

  const run = async (fn?: () => Promise<void> | void) => {
    if (!fn || busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const hasMinimalProblemTransformation =
    !!intelligenceBlock.problem_being_solved || !!intelligenceBlock.expected_transformation;
  const hasMinimalWhyNow = !!intelligenceBlock.why_now;
  const hasMinimalExecution =
    !!executionBlock.execution_stage || !!executionBlock.stage_objective;
  const hasMinimalBlueprint =
    blueprint.duration_weeks != null || blueprint.primary_recommendations.length > 0;

  const confidenceBannerContent = useMemo(() => {
    const transformationLine = getTransformationSummary(
      intelligenceBlock.problem_being_solved,
      intelligenceBlock.expected_transformation,
      core.summary
    );
    const confidenceLine = getConfidencePhrase(confidenceTier);
    return { transformationLine, confidenceLine, tier: confidenceTier };
  }, [
    intelligenceBlock.problem_being_solved,
    intelligenceBlock.expected_transformation,
    core.summary,
    confidenceTier,
  ]);

  if (isMinimal) {
    return (
      <div className="rounded-xl p-6 shadow-sm border border-gray-200 bg-white hover:shadow-md">
        <section>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-gray-800 mb-1">Core Theme</h4>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold text-gray-900">
                  {core.polished_title || core.topic || 'Strategic recommendation'}
                </h3>
                {strategyStatus === 'continuation' && (
                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-800" title="Aligns with your dominant strategy">
                    ⭐ Continue Strategy
                  </span>
                )}
                {strategyStatus === 'expansion' && (
                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-800" title="Underused strategy area">
                    🌱 Expand Strategy
                  </span>
                )}
                {strategyStatus === 'momentum_expand' && (
                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-indigo-100 text-indigo-800" title="Diversification recommended after repeated focus">
                    ⚡ Strategic Expansion Recommended
                  </span>
                )}
                {isTopPriority && (
                  <span className="inline-flex items-center text-xs text-slate-500 font-medium" title="AI-suggested priority">
                    ⭐ AI Priority
                  </span>
                )}
                {resurfaced && (
                  <span className="inline-flex items-center text-xs text-slate-400 font-medium" title="Re-surfaced based on progress">
                    ↺ Re-surfaced Opportunity
                  </span>
                )}
                {journeyState && <RecommendationJourneyLabel state={journeyState} />}
                {executionBadge && (
                  <span className="inline-flex items-center text-xs text-slate-600 font-medium" title="This card is one of your execution-ready opportunities">
                    📍 One of {executionBadge.total} opportunit{executionBadge.total === 1 ? 'y' : 'ies'} ready for execution ({executionBadge.index} of {executionBadge.total})
                  </span>
                )}
                {upcomingBadge && (
                  <span className="inline-flex items-center text-xs text-slate-600 font-medium" title="This card is one of your strategic directions forming">
                    ↗ One of {upcomingBadge.total} strategic direction{upcomingBadge.total === 1 ? '' : 's'} forming ({upcomingBadge.index} of {upcomingBadge.total})
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setMinimized((v) => !v)}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              {minimized ? 'Expand' : 'Collapse'}
            </button>
          </div>
          {core.summary ? (
            <p className="mt-2 text-sm text-gray-700 whitespace-pre-wrap break-words">{core.summary}</p>
          ) : null}
        </section>

        <RecommendationConfidenceBanner
          transformationLine={confidenceBannerContent.transformationLine}
          confidenceLine={confidenceBannerContent.confidenceLine}
          tier={confidenceBannerContent.tier}
        />
        {journeyState && <RecommendationNarrativeLine state={journeyState} />}
        {memoryState && <RecommendationStrategicMemoryLine state={memoryState} />}
        {forecastState && <RecommendationIntentForecastLine state={forecastState} />}

        {!minimized && hasMinimalProblemTransformation && (
          <section className="mt-4 pt-4 border-t border-gray-200">
            <h4 className="text-sm font-semibold text-gray-800 mb-2">Decision brief</h4>
            <div className="text-sm text-gray-700 space-y-2">
              {intelligenceBlock.problem_being_solved ? (
                <div>
                  <div className="text-gray-500 font-medium mb-0.5">Current challenge</div>
                  <div className="whitespace-pre-wrap break-words">
                    {intelligenceBlock.problem_being_solved}
                  </div>
                </div>
              ) : null}
              {intelligenceBlock.expected_transformation ? (
                <div>
                  <div className="text-gray-500 font-medium mb-0.5">Expected outcome</div>
                  <div className="whitespace-pre-wrap break-words">
                    {intelligenceBlock.expected_transformation}
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        )}

        {!minimized && hasMinimalWhyNow && (
          <section className="mt-4 pt-4 border-t border-gray-200">
            <h4 className="text-sm font-semibold text-gray-800 mb-2">Why now</h4>
            <p className="text-sm text-gray-700 whitespace-pre-wrap break-words">
              {intelligenceBlock.why_now}
            </p>
          </section>
        )}

        {!minimized && hasMinimalExecution && (
          <section className="mt-4 pt-4 border-t border-gray-200">
            <h4 className="text-sm font-semibold text-gray-800 mb-2">Execution stage</h4>
            <div className="text-sm text-gray-700 space-y-1">
              {executionBlock.execution_stage ? (
                <div>
                  <span className="text-gray-500 font-medium">Stage:</span> {executionBlock.execution_stage}
                </div>
              ) : null}
              {executionBlock.stage_objective ? (
                <div>
                  <span className="text-gray-500 font-medium">Objective:</span>{' '}
                  <span className="whitespace-pre-wrap break-words">{executionBlock.stage_objective}</span>
                </div>
              ) : null}
            </div>
          </section>
        )}

        {!minimized && hasMinimalBlueprint && (
          <section className="mt-4 pt-4 border-t border-gray-200">
            <h4 className="text-sm font-semibold text-gray-800 mb-2">Campaign preview</h4>
            <div className="text-sm text-gray-700 space-y-1">
              {blueprint.duration_weeks != null ? (
                <div>
                  <span className="text-gray-500 font-medium">Duration:</span> {blueprint.duration_weeks} weeks
                </div>
              ) : null}
              {blueprint.primary_recommendations.length > 0 ? (
                <div>
                  <span className="text-gray-500 font-medium">Primary:</span>{' '}
                  {blueprint.primary_recommendations.join(', ')}
                </div>
              ) : null}
            </div>
          </section>
        )}

        <section className="mt-4 pt-4 border-t border-gray-200">
          <h4 className="text-sm font-semibold text-gray-800 mb-2">Actions</h4>
          {buildError && (
            <p className="text-sm text-red-600 mb-2" role="alert">
              {buildError}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => run(onBuildCampaignBlueprint)}
              disabled={busy || !onBuildCampaignBlueprint}
              className={`px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white disabled:opacity-50 ${primaryButtonEmphasis}`}
            >
              {getPrimaryActionLabel(confidenceBannerContent.tier)}
            </button>
            <div className="relative" ref={boltMenuRef}>
              <button
                type="button"
                title="Choose duration (1–4 weeks) and where to see the outcome"
                onClick={() => (boltMenuOpen ? setBoltMenuOpen(false) : setBoltMenuOpen(true))}
                disabled={busy || fastLoading || !onBuildCampaignFast}
                className="min-w-[110px] h-[36px] px-4 py-2 text-sm font-medium rounded-lg border border-amber-400 bg-amber-50 text-amber-800 hover:bg-amber-100 disabled:opacity-50 transition flex items-center justify-center gap-1"
              >
                {fastLoading ? '⚡ Generating Plan…' : '⚡ BOLT'}
                <ChevronDown className={`h-4 w-4 transition ${boltMenuOpen ? 'rotate-180' : ''}`} />
              </button>
              {boltMenuOpen && (
                <div className="absolute left-0 top-full mt-1 z-50 min-w-[220px] rounded-lg border border-gray-200 bg-white shadow-lg py-2">
                  <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Campaign duration (1–4 weeks)
                  </div>
                  {BOLT_DURATION_OPTIONS.map((opt) => (
                    <label
                      key={opt.value}
                      className="flex items-center gap-2 px-3 py-2 hover:bg-amber-50 cursor-pointer"
                    >
                      <input
                        type="radio"
                        name="boltDuration"
                        checked={boltDurationWeeks === opt.value}
                        onChange={() => setBoltDurationWeeks(opt.value)}
                        className="rounded-full border-amber-400 text-amber-600 focus:ring-amber-500"
                      />
                      <span className="text-sm text-gray-700">{opt.label}</span>
                    </label>
                  ))}
                  <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider border-t border-gray-100 mt-1 pt-2">
                    Where to see the outcome
                  </div>
                  {BOLT_OUTCOME_OPTIONS.map((opt) => (
                    <label
                      key={opt.value}
                      className="flex items-center gap-2 px-3 py-2 hover:bg-amber-50 cursor-pointer"
                    >
                      <input
                        type="radio"
                        name="boltOutcome"
                        checked={boltOutcomeView === opt.value}
                        onChange={() => setBoltOutcomeView(opt.value)}
                        className="rounded-full border-amber-400 text-amber-600 focus:ring-amber-500"
                      />
                      <span className="text-sm text-gray-700">{opt.label}</span>
                    </label>
                  ))}
                  <div className="border-t border-gray-100 mt-2 pt-2 px-2">
                    <button
                      type="button"
                      onClick={() => {
                        run(() => onBuildCampaignFast?.({ outcomeView: boltOutcomeView, durationWeeks: boltDurationWeeks }));
                        setBoltMenuOpen(false);
                      }}
                      disabled={busy || fastLoading || !onBuildCampaignFast}
                      className="w-full py-2 text-sm font-medium rounded-md bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
                    >
                      Run BOLT
                    </button>
                  </div>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                if (minimized) {
                  setMinimized(false);
                  setExpanded(true);
                } else {
                  setExpanded((v) => !v);
                }
              }}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-indigo-600 text-indigo-600 hover:bg-indigo-50"
            >
              {getExpandActionLabel(confidenceBannerContent.tier)}
            </button>
            <button
              type="button"
              onClick={() => run(onMarkLongTerm)}
              disabled={busy || !onMarkLongTerm}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 disabled:opacity-50"
            >
              Mark Long-Term
            </button>
            <button
              type="button"
              onClick={() => run(onArchive)}
              disabled={busy || !onArchive}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-600 disabled:opacity-50"
            >
              Archive
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="rounded-xl p-6 shadow-sm border border-gray-200 bg-white hover:shadow-md">
      <section>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-gray-800 mb-1">Core Theme</h4>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold text-gray-900">
                {core.polished_title || core.topic || 'Strategic recommendation'}
              </h3>
              {strategyStatus === 'continuation' && (
                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-800" title="Aligns with your dominant strategy">
                  ⭐ Continue Strategy
                </span>
              )}
              {strategyStatus === 'expansion' && (
                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-800" title="Underused strategy area">
                  🌱 Expand Strategy
                </span>
              )}
              {strategyStatus === 'momentum_expand' && (
                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-indigo-100 text-indigo-800" title="Diversification recommended after repeated focus">
                  ⚡ Strategic Expansion Recommended
                </span>
              )}
              {isTopPriority && (
                <span className="inline-flex items-center text-xs text-slate-500 font-medium" title="AI-suggested priority">
                  ⭐ AI Priority
                </span>
              )}
              {resurfaced && (
                <span className="inline-flex items-center text-xs text-slate-400 font-medium" title="Re-surfaced based on progress">
                  ↺ Re-surfaced Opportunity
                </span>
              )}
              {journeyState && <RecommendationJourneyLabel state={journeyState} />}
              {executionBadge && (
                <span className="inline-flex items-center text-xs text-slate-600 font-medium" title="This card is one of your execution-ready opportunities">
                  📍 One of {executionBadge.total} opportunit{executionBadge.total === 1 ? 'y' : 'ies'} ready for execution ({executionBadge.index} of {executionBadge.total})
                </span>
              )}
              {upcomingBadge && (
                <span className="inline-flex items-center text-xs text-slate-600 font-medium" title="This card is one of your strategic directions forming">
                  ↗ One of {upcomingBadge.total} strategic direction{upcomingBadge.total === 1 ? '' : 's'} forming ({upcomingBadge.index} of {upcomingBadge.total})
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMinimized((v) => !v)}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            {minimized ? 'Maximize' : 'Minimize'}
          </button>
        </div>
        {core.summary ? <p className="mt-2 text-sm text-gray-700 whitespace-pre-wrap break-words">{core.summary}</p> : null}
        {!minimized ? (
          <div className="mt-2 text-sm text-gray-600 space-y-1">
            {core.estimated_reach != null ? <div><span className="text-gray-500 font-medium">Estimated Reach:</span> {core.estimated_reach}</div> : null}
            {core.formats.length > 0 ? <div><span className="text-gray-500 font-medium">Formats:</span> {core.formats.join(', ')}</div> : null}
            {core.regions.length > 0 ? <div><span className="text-gray-500 font-medium">Regions:</span> {core.regions.join(', ')}</div> : null}
          </div>
        ) : null}
      </section>

      <RecommendationConfidenceBanner
        transformationLine={confidenceBannerContent.transformationLine}
        confidenceLine={confidenceBannerContent.confidenceLine}
        tier={confidenceBannerContent.tier}
      />
      {journeyState && <RecommendationNarrativeLine state={journeyState} />}
      {memoryState && <RecommendationStrategicMemoryLine state={memoryState} />}
      {forecastState && <RecommendationIntentForecastLine state={forecastState} />}
      {momentumState && <RecommendationMomentumCue state={momentumState} />}

      {!minimized && hasStrategicContext && (
        <section className="mt-4 pt-4 border-t border-gray-200">
          <h4 className="text-sm font-semibold text-gray-800 mb-2">Strategic Context</h4>
          <div className="text-sm text-gray-700 space-y-1">
            {strategicContext.aspect ? <div><span className="text-gray-500 font-medium">Aspect:</span> {strategicContext.aspect}</div> : null}
            {strategicContext.facets.length > 0 ? <div><span className="text-gray-500 font-medium">Facets:</span> {strategicContext.facets.join(', ')}</div> : null}
            {strategicContext.audience_personas.length > 0 ? <div><span className="text-gray-500 font-medium">Audience Personas:</span> {strategicContext.audience_personas.join(', ')}</div> : null}
            {strategicContext.messaging_hooks.length > 0 ? <div><span className="text-gray-500 font-medium">Messaging Hooks:</span> <span className="whitespace-pre-wrap break-words">{strategicContext.messaging_hooks.join(', ')}</span></div> : null}
          </div>
        </section>
      )}

      {!minimized && hasIntelligence && (
        <section className="mt-4 pt-4 border-t border-gray-200">
          <h4 className="text-sm font-semibold text-gray-800 mb-2">Diamond Intelligence</h4>
          <div className="text-sm text-gray-700 space-y-1">
            {intelligenceBlock.problem_being_solved ? <div><span className="text-gray-500 font-medium">Problem:</span> <span className="whitespace-pre-wrap break-words">{intelligenceBlock.problem_being_solved}</span></div> : null}
            {intelligenceBlock.gap_being_filled ? <div><span className="text-gray-500 font-medium">Gap:</span> <span className="whitespace-pre-wrap break-words">{intelligenceBlock.gap_being_filled}</span></div> : null}
            {intelligenceBlock.why_now ? <div><span className="text-gray-500 font-medium">Why Now:</span> <span className="whitespace-pre-wrap break-words">{intelligenceBlock.why_now}</span></div> : null}
            {intelligenceBlock.authority_reason ? <div><span className="text-gray-500 font-medium">Authority Reason:</span> <span className="whitespace-pre-wrap break-words">{intelligenceBlock.authority_reason}</span></div> : null}
            {intelligenceBlock.expected_transformation ? <div><span className="text-gray-500 font-medium">Expected Transformation:</span> <span className="whitespace-pre-wrap break-words">{intelligenceBlock.expected_transformation}</span></div> : null}
            {intelligenceBlock.campaign_angle ? <div><span className="text-gray-500 font-medium">Campaign Angle:</span> <span className="whitespace-pre-wrap break-words">{intelligenceBlock.campaign_angle}</span></div> : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {signals.diamond_type ? <span className="inline-flex items-center rounded-full px-2 py-0.5 font-medium bg-violet-100 text-violet-800">{signals.diamond_type}</span> : null}
            {signals.strategy_mode ? <span className="inline-flex items-center rounded-full px-2 py-0.5 font-medium bg-blue-100 text-blue-800">{signals.strategy_mode}</span> : null}
            {signals.final_alignment_score != null ? <span className="inline-flex items-center rounded-full px-2 py-0.5 font-medium bg-emerald-100 text-emerald-800">Final alignment {signals.final_alignment_score.toFixed(4)}</span> : null}
            {signals.strategy_modifier != null ? <span className="inline-flex items-center rounded-full px-2 py-0.5 font-medium bg-amber-100 text-amber-800">Modifier {signals.strategy_modifier.toFixed(4)}</span> : null}
          </div>
        </section>
      )}

      {!minimized && hasSnapshot && (
        <section className="mt-4 pt-4 border-t border-gray-200">
          <h4 className="text-sm font-semibold text-gray-800 mb-2">Company Context Snapshot</h4>
          <div className="text-sm text-gray-700 space-y-1">
            {snapshotBlock.brand_voice ? <div><span className="text-gray-500 font-medium">Brand Voice:</span> <span className="whitespace-pre-wrap break-words">{snapshotBlock.brand_voice}</span></div> : null}
            {snapshotBlock.brand_positioning ? <div><span className="text-gray-500 font-medium">Positioning:</span> <span className="whitespace-pre-wrap break-words">{snapshotBlock.brand_positioning}</span></div> : null}
            {snapshotBlock.reader_emotion_target ? <div><span className="text-gray-500 font-medium">Reader Emotion Target:</span> <span className="whitespace-pre-wrap break-words">{snapshotBlock.reader_emotion_target}</span></div> : null}
            {snapshotBlock.narrative_flow_seed ? <div><span className="text-gray-500 font-medium">Narrative Flow Seed:</span> <span className="whitespace-pre-wrap break-words">{snapshotBlock.narrative_flow_seed}</span></div> : null}
            {snapshotBlock.recommended_cta_style ? <div><span className="text-gray-500 font-medium">Recommended CTA Style:</span> <span className="whitespace-pre-wrap break-words">{snapshotBlock.recommended_cta_style}</span></div> : null}
            {snapshotBlock.core_problem_statement ? <div><span className="text-gray-500 font-medium">Core Problem:</span> <span className="whitespace-pre-wrap break-words">{snapshotBlock.core_problem_statement}</span></div> : null}
            {snapshotBlock.pain_symptoms.length > 0 ? <div><span className="text-gray-500 font-medium">Pain Symptoms:</span> <span className="whitespace-pre-wrap break-words">{snapshotBlock.pain_symptoms.join(', ')}</span></div> : null}
            {snapshotBlock.desired_transformation ? <div><span className="text-gray-500 font-medium">Desired Transformation:</span> <span className="whitespace-pre-wrap break-words">{snapshotBlock.desired_transformation}</span></div> : null}
            {snapshotBlock.authority_domains.length > 0 ? <div><span className="text-gray-500 font-medium">Authority Domains:</span> <span className="whitespace-pre-wrap break-words">{snapshotBlock.authority_domains.join(', ')}</span></div> : null}
          </div>
        </section>
      )}

      {!minimized && hasExecution && (
        <section className="mt-4 pt-4 border-t border-gray-200">
          <h4 className="text-sm font-semibold text-gray-800 mb-2">Execution Stage</h4>
          <div className="text-sm text-gray-700 space-y-1">
            {executionBlock.execution_stage ? <div><span className="text-gray-500 font-medium">Stage:</span> {executionBlock.execution_stage}</div> : null}
            {executionBlock.stage_objective ? <div><span className="text-gray-500 font-medium">Stage Objective:</span> <span className="whitespace-pre-wrap break-words">{executionBlock.stage_objective}</span></div> : null}
            {executionBlock.psychological_goal ? <div><span className="text-gray-500 font-medium">Psychological Goal:</span> <span className="whitespace-pre-wrap break-words">{executionBlock.psychological_goal}</span></div> : null}
            {executionBlock.momentum_level ? <div><span className="text-gray-500 font-medium">Momentum:</span> {executionBlock.momentum_level}</div> : null}
          </div>
        </section>
      )}

      {badges.length > 0 && (
        <section className="mt-4 pt-4 border-t border-gray-200">
          <h4 className="text-sm font-semibold text-gray-800 mb-2">Strategic Badges</h4>
          <div className="flex flex-wrap gap-2">
            {badges.map((badge) => (
              <span key={badge} className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-700">
                {badge}
              </span>
            ))}
          </div>
        </section>
      )}

      {!minimized && (blueprint.duration_weeks != null || blueprint.progression_summary || blueprint.primary_recommendations.length > 0 || blueprint.supporting_recommendations.length > 0) && (
        <section className="mt-4 pt-4 border-t border-gray-200">
          <h4 className="text-sm font-semibold text-gray-800 mb-2">Campaign Blueprint Preview</h4>
          <div className="text-sm text-gray-700 space-y-1">
            {blueprint.duration_weeks != null ? <div><span className="text-gray-500 font-medium">Duration:</span> {blueprint.duration_weeks} weeks</div> : null}
            {blueprint.progression_summary ? <div><span className="text-gray-500 font-medium">Progression:</span> <span className="whitespace-pre-wrap break-words">{blueprint.progression_summary}</span></div> : null}
            {blueprint.primary_recommendations.length > 0 ? <div><span className="text-gray-500 font-medium">Primary:</span> {blueprint.primary_recommendations.join(', ')}</div> : null}
            {blueprint.supporting_recommendations.length > 0 ? <div><span className="text-gray-500 font-medium">Supporting:</span> {blueprint.supporting_recommendations.join(', ')}</div> : null}
          </div>
        </section>
      )}

      <section className="mt-4 pt-4 border-t border-gray-200">
        <h4 className="text-sm font-semibold text-gray-800 mb-2">Actions</h4>
        {buildError && (
          <p className="text-sm text-red-600 mb-2" role="alert">
            {buildError}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => run(onBuildCampaignBlueprint)}
            disabled={busy || !onBuildCampaignBlueprint}
            className={`px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white disabled:opacity-50 ${primaryButtonEmphasis}`}
          >
            {getPrimaryActionLabel(confidenceBannerContent.tier)}
          </button>
          <div className="relative" ref={boltMenuRef}>
            <button
              type="button"
              title="Choose duration (1–4 weeks) and where to see the outcome"
              onClick={() => (boltMenuOpen ? setBoltMenuOpen(false) : setBoltMenuOpen(true))}
              disabled={busy || fastLoading || !onBuildCampaignFast}
              className="min-w-[110px] h-[36px] px-4 py-2 text-sm font-medium rounded-lg border border-amber-400 bg-amber-50 text-amber-800 hover:bg-amber-100 disabled:opacity-50 transition flex items-center justify-center gap-1"
            >
              {fastLoading ? '⚡ Generating Plan…' : '⚡ BOLT'}
              <ChevronDown className={`h-4 w-4 transition ${boltMenuOpen ? 'rotate-180' : ''}`} />
            </button>
            {boltMenuOpen && (
              <div className="absolute left-0 top-full mt-1 z-50 min-w-[220px] rounded-lg border border-gray-200 bg-white shadow-lg py-2">
                <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Campaign duration (1–4 weeks)
                </div>
                {BOLT_DURATION_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className="flex items-center gap-2 px-3 py-2 hover:bg-amber-50 cursor-pointer"
                  >
                    <input
                      type="radio"
                      name="boltDurationAlt"
                      checked={boltDurationWeeks === opt.value}
                      onChange={() => setBoltDurationWeeks(opt.value)}
                      className="rounded-full border-amber-400 text-amber-600 focus:ring-amber-500"
                    />
                    <span className="text-sm text-gray-700">{opt.label}</span>
                  </label>
                ))}
                <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider border-t border-gray-100 mt-1 pt-2">
                  Where to see the outcome
                </div>
                {BOLT_OUTCOME_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className="flex items-center gap-2 px-3 py-2 hover:bg-amber-50 cursor-pointer"
                  >
                    <input
                      type="radio"
                      name="boltOutcomeAlt"
                      checked={boltOutcomeView === opt.value}
                      onChange={() => setBoltOutcomeView(opt.value)}
                      className="rounded-full border-amber-400 text-amber-600 focus:ring-amber-500"
                    />
                    <span className="text-sm text-gray-700">{opt.label}</span>
                  </label>
                ))}
                <div className="border-t border-gray-100 mt-2 pt-2 px-2">
                  <button
                    type="button"
                    onClick={() => {
                      run(() => onBuildCampaignFast?.({ outcomeView: boltOutcomeView, durationWeeks: boltDurationWeeks }));
                      setBoltMenuOpen(false);
                    }}
                    disabled={busy || fastLoading || !onBuildCampaignFast}
                    className="w-full py-2 text-sm font-medium rounded-md bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
                  >
                    Run BOLT
                  </button>
                </div>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              if (minimized) {
                setMinimized(false);
                setExpanded(true);
              } else {
                setExpanded((v) => !v);
              }
            }}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-indigo-600 text-indigo-600 hover:bg-indigo-50"
          >
            {getExpandActionLabel(confidenceBannerContent.tier)}
          </button>
          <button
            type="button"
            onClick={() => run(onMarkLongTerm)}
            disabled={busy || !onMarkLongTerm}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 disabled:opacity-50"
          >
            Mark Long-Term
          </button>
          <button
            type="button"
            onClick={() => run(onArchive)}
            disabled={busy || !onArchive}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-600 disabled:opacity-50"
          >
            Archive
          </button>
        </div>
      </section>

      {!minimized && expanded && (
        <details open className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <summary className="cursor-pointer text-sm font-semibold text-gray-800">Expandable Details</summary>
          <div className="mt-2 text-sm text-gray-700 whitespace-pre-wrap break-words">
            {core.summary || 'No additional details available.'}
          </div>
        </details>
      )}
    </div>
  );
}

