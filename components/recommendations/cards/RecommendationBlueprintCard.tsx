import React, { useMemo, useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  applyRecommendationStrategicCardDraft,
  buildRecommendationStrategicCard,
  buildRecommendationStrategicCardDraft,
  type RecommendationStrategicCardDraft,
} from '@/lib/recommendationStrategicCard';

export type StrategyStatus = 'continuation' | 'expansion' | 'neutral' | 'momentum_expand';

/** Where BOLT stops. 'schedule' = full run including scheduled posts on calendar. 'campaign_schedule' kept for backward compat (same as 'schedule'). */
export type BoltOutcomeView = 'week_plan' | 'daily_plan' | 'repurpose' | 'schedule' | 'campaign_schedule';

/** Text-based: AI writes all content. Creator-dependent: human creates content, BOLT plans only. */
export type BoltCampaignMode = 'text_based' | 'creator_dependent';

export type BoltContentFormat =
  | 'post' | 'blog' | 'short_story' | 'article' | 'newsletter'
  | 'video' | 'carousel' | 'reel' | 'podcast' | 'infographic';

/** BOLT creates campaigns of 4 weeks or less. */
const BOLT_DURATION_OPTIONS = [
  { value: 1, label: '1 week' },
  { value: 2, label: '2 weeks' },
  { value: 3, label: '3 weeks' },
  { value: 4, label: '4 weeks' },
] as const;

const BOLT_CONTENT_FORMATS: Record<BoltCampaignMode, { value: BoltContentFormat; label: string }[]> = {
  text_based: [
    { value: 'post', label: 'Post' },
    { value: 'blog', label: 'Blog' },
    { value: 'short_story', label: 'Short Story' },
    { value: 'article', label: 'Article' },
    { value: 'newsletter', label: 'Newsletter' },
  ],
  creator_dependent: [
    { value: 'video', label: 'Video' },
    { value: 'carousel', label: 'Carousel' },
    { value: 'reel', label: 'Reel' },
    { value: 'podcast', label: 'Podcast' },
    { value: 'infographic', label: 'Infographic' },
  ],
};

/** Creator-dependent campaigns stop at Daily Plan — content creation requires a human. */
const BOLT_OUTCOME_OPTIONS_BY_MODE: Record<BoltCampaignMode, { value: BoltOutcomeView; label: string; hint?: string }[]> = {
  text_based: [
    { value: 'week_plan', label: 'Week Plan' },
    { value: 'daily_plan', label: 'Daily Plan' },
    { value: 'schedule', label: 'Schedule', hint: 'Posts added to calendar' },
  ],
  creator_dependent: [
    { value: 'week_plan', label: 'Week Plan' },
    { value: 'daily_plan', label: 'Daily Plan', hint: 'Max for creator content' },
  ],
};

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
  onRefineRecommendation?: (recommendation: Record<string, unknown>) => Promise<void> | void;
  onBuildCampaignBlueprint?: () => Promise<void> | void;
  /** Receives outcomeView, durationWeeks, campaignMode and contentFormats from BOLT options. */
  onBuildCampaignFast?: (options?: {
    outcomeView?: BoltOutcomeView;
    durationWeeks?: number;
    campaignMode?: BoltCampaignMode;
    contentFormats?: BoltContentFormat[];
  }) => Promise<void> | void;
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
  /**
   * When set, this card was initiated from the BOLT (Text) setup page.
   * Hides the Campaign Mode / dropdown UI and shows a single "⚡ BOLT (Text)" button
   * that fires immediately with the preset options.
   */
  boltTextPreset?: {
    outcomeView: BoltOutcomeView;
    durationWeeks: number;
    contentFormat: BoltContentFormat;
  };
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
  past: 'This builds on a direction your business is already moving in, so it should feel more familiar to execute.',
  current: 'This looks like the strongest next campaign to pursue if you want to act now.',
  upcoming: 'This is promising, but it may make more sense after your current focus is underway.',
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
    'The AI sees this as a natural continuation of work you already have momentum in.',
  momentum:
    'This is being prioritized because it fits the direction your current activity is already supporting.',
  emerging:
    'This option is becoming more relevant as your recent campaign signals change.',
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
    'If you run this now, it is more likely to move people closer to taking action.',
  progression:
    'If you keep exploring this, it may become a stronger campaign option soon.',
  continuity:
    'Staying on this path should make your messaging feel more consistent over time.',
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
  execute: 'This looks ready to turn into a campaign now.',
  plan: 'This looks worth planning, but not rushing.',
  consistent: 'This supports the direction you are already building.',
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

const MAX_BANNER_SNIPPET = 80;

/** Client-side sanitize for topic/display when backend polish may be missing. Mirrors recommendationPolishService patterns. */
function sanitizeTopicForDisplay(s: string | null | undefined): string {
  if (!s || typeof s !== 'string') return '';
  let t = s.trim();
  if (!t) return '';
  t = t.replace(/\s+Business\s+Report\s+20\d{2}\b/gi, '').trim();
  t = t.replace(/\s*[:\-]\s*\$[\d.]+(?:\s*[Bb]n|\s*\+)?(?:\s+Market\s+Trends[^.]*)?\.?$/gi, '').trim();
  t = t.replace(/[.:,\s]+$/g, '').trim();
  return t || s.trim();
}

/** Truncate at word boundary to avoid awkward cuts like "...cloud" or mid-word fragments. */
function truncateAtWordBoundary(s: string, maxLen: number): string {
  if (!s || typeof s !== 'string') return s;
  const t = s.trim();
  if (t.length <= maxLen) return t;
  const cut = t.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > maxLen * 0.5) return cut.slice(0, lastSpace).trim() + '…';
  return cut.trim() + '…';
}

function getTransformationSummary(
  problem: string | null,
  transformation: string | null,
  summaryFallback: string | null,
  topic: string | null = null,
  /** Prefer this over topic for display (already polished). Use sanitized topic as fallback. */
  displayTitle: string | null = null
): string {
  const truncate = (s: string) => truncateAtWordBoundary(s, MAX_BANNER_SNIPPET);
  const safeTitle = (displayTitle && displayTitle.trim()) || (topic ? sanitizeTopicForDisplay(topic) : '');
  const topicPrefix = safeTitle ? `${safeTitle}: ` : '';
  let base = '';
  if (problem && transformation) {
    base = `Designed to move your audience from ${truncate(problem)} → ${truncate(transformation)}`;
  } else if (problem) {
    base = `Designed to address: ${truncate(problem)}. Clear audience progress and momentum.`;
  } else if (transformation) {
    base = `Designed to achieve: ${truncate(transformation)}.`;
  } else if (summaryFallback) {
    base =
      summaryFallback.length <= MAX_BANNER_SNIPPET * 2
        ? summaryFallback
        : truncateAtWordBoundary(summaryFallback, MAX_BANNER_SNIPPET);
  } else {
    base = 'Designed to create clear audience progress and momentum.';
  }
  return topicPrefix + base;
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

function StrategicCardEditorField(props: {
  label: string;
  value: string;
  multiline?: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const sharedClassName =
    'mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500';
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase tracking-wider text-gray-500">{props.label}</span>
      {props.multiline ? (
        <textarea
          value={props.value}
          rows={3}
          placeholder={props.placeholder}
          onChange={(event) => props.onChange(event.target.value)}
          className={sharedClassName}
        />
      ) : (
        <input
          type="text"
          value={props.value}
          placeholder={props.placeholder}
          onChange={(event) => props.onChange(event.target.value)}
          className={sharedClassName}
        />
      )}
    </label>
  );
}

function StrategicCardRefinementEditor(props: {
  draft: RecommendationStrategicCardDraft;
  saving: boolean;
  onChange: (draft: RecommendationStrategicCardDraft) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const { draft, saving, onChange, onCancel, onSave } = props;
  const update = <K extends keyof RecommendationStrategicCardDraft>(
    section: K,
    field: keyof RecommendationStrategicCardDraft[K],
    value: string
  ) => {
    onChange({
      ...draft,
      [section]: {
        ...draft[section],
        [field]: value,
      },
    });
  };

  return (
    <section className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50/50 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-gray-800">Refine Strategic Card</h4>
          <p className="mt-1 text-xs text-gray-600">
            Adjust the campaign-level strategy before approval. These edits will flow into saved recommendation campaigns too.
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <StrategicCardEditorField
          label="Polished Title"
          value={draft.core.polished_title}
          onChange={(value) => update('core', 'polished_title', value)}
        />
        <StrategicCardEditorField
          label="Topic"
          value={draft.core.topic}
          onChange={(value) => update('core', 'topic', value)}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4">
        <StrategicCardEditorField
          label="Summary"
          value={draft.core.summary}
          multiline
          onChange={(value) => update('core', 'summary', value)}
        />
        <StrategicCardEditorField
          label="Narrative Direction"
          value={draft.core.narrative_direction}
          multiline
          onChange={(value) => update('core', 'narrative_direction', value)}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <StrategicCardEditorField
          label="Aspect"
          value={draft.strategic_context.aspect}
          onChange={(value) => update('strategic_context', 'aspect', value)}
        />
        <StrategicCardEditorField
          label="Estimated Reach"
          value={draft.core.estimated_reach}
          onChange={(value) => update('core', 'estimated_reach', value)}
        />
        <StrategicCardEditorField
          label="Facets"
          value={draft.strategic_context.facets}
          placeholder="Comma-separated"
          onChange={(value) => update('strategic_context', 'facets', value)}
        />
        <StrategicCardEditorField
          label="Audience Personas"
          value={draft.strategic_context.audience_personas}
          placeholder="Comma-separated"
          onChange={(value) => update('strategic_context', 'audience_personas', value)}
        />
        <StrategicCardEditorField
          label="Messaging Hooks"
          value={draft.strategic_context.messaging_hooks}
          placeholder="Comma-separated"
          onChange={(value) => update('strategic_context', 'messaging_hooks', value)}
        />
        <StrategicCardEditorField
          label="Formats"
          value={draft.core.formats}
          placeholder="Comma-separated"
          onChange={(value) => update('core', 'formats', value)}
        />
        <StrategicCardEditorField
          label="Regions"
          value={draft.core.regions}
          placeholder="Comma-separated"
          onChange={(value) => update('core', 'regions', value)}
        />
        <StrategicCardEditorField
          label="Duration Weeks"
          value={draft.blueprint.duration_weeks}
          onChange={(value) => update('blueprint', 'duration_weeks', value)}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <StrategicCardEditorField
          label="Problem Being Solved"
          value={draft.intelligence.problem_being_solved}
          multiline
          onChange={(value) => update('intelligence', 'problem_being_solved', value)}
        />
        <StrategicCardEditorField
          label="Expected Transformation"
          value={draft.intelligence.expected_transformation}
          multiline
          onChange={(value) => update('intelligence', 'expected_transformation', value)}
        />
        <StrategicCardEditorField
          label="Why Now"
          value={draft.intelligence.why_now}
          multiline
          onChange={(value) => update('intelligence', 'why_now', value)}
        />
        <StrategicCardEditorField
          label="Campaign Angle"
          value={draft.intelligence.campaign_angle}
          multiline
          onChange={(value) => update('intelligence', 'campaign_angle', value)}
        />
        <StrategicCardEditorField
          label="Gap Being Filled"
          value={draft.intelligence.gap_being_filled}
          multiline
          onChange={(value) => update('intelligence', 'gap_being_filled', value)}
        />
        <StrategicCardEditorField
          label="Authority Reason"
          value={draft.intelligence.authority_reason}
          multiline
          onChange={(value) => update('intelligence', 'authority_reason', value)}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <StrategicCardEditorField
          label="Execution Stage"
          value={draft.execution.execution_stage}
          onChange={(value) => update('execution', 'execution_stage', value)}
        />
        <StrategicCardEditorField
          label="Momentum Level"
          value={draft.execution.momentum_level}
          onChange={(value) => update('execution', 'momentum_level', value)}
        />
        <StrategicCardEditorField
          label="Stage Objective"
          value={draft.execution.stage_objective}
          multiline
          onChange={(value) => update('execution', 'stage_objective', value)}
        />
        <StrategicCardEditorField
          label="Psychological Goal"
          value={draft.execution.psychological_goal}
          multiline
          onChange={(value) => update('execution', 'psychological_goal', value)}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <StrategicCardEditorField
          label="Progression Summary"
          value={draft.blueprint.progression_summary}
          multiline
          onChange={(value) => update('blueprint', 'progression_summary', value)}
        />
        <StrategicCardEditorField
          label="Primary Recommendations"
          value={draft.blueprint.primary_recommendations}
          multiline
          placeholder="Comma-separated topics"
          onChange={(value) => update('blueprint', 'primary_recommendations', value)}
        />
        <StrategicCardEditorField
          label="Supporting Recommendations"
          value={draft.blueprint.supporting_recommendations}
          multiline
          placeholder="Comma-separated topics"
          onChange={(value) => update('blueprint', 'supporting_recommendations', value)}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <StrategicCardEditorField
          label="Core Problem Statement"
          value={draft.company_context_snapshot.core_problem_statement}
          multiline
          onChange={(value) => update('company_context_snapshot', 'core_problem_statement', value)}
        />
        <StrategicCardEditorField
          label="Desired Transformation"
          value={draft.company_context_snapshot.desired_transformation}
          multiline
          onChange={(value) => update('company_context_snapshot', 'desired_transformation', value)}
        />
        <StrategicCardEditorField
          label="Brand Voice"
          value={draft.company_context_snapshot.brand_voice}
          multiline
          onChange={(value) => update('company_context_snapshot', 'brand_voice', value)}
        />
        <StrategicCardEditorField
          label="Brand Positioning"
          value={draft.company_context_snapshot.brand_positioning}
          multiline
          onChange={(value) => update('company_context_snapshot', 'brand_positioning', value)}
        />
        <StrategicCardEditorField
          label="Reader Emotion Target"
          value={draft.company_context_snapshot.reader_emotion_target}
          multiline
          onChange={(value) => update('company_context_snapshot', 'reader_emotion_target', value)}
        />
        <StrategicCardEditorField
          label="Narrative Flow Seed"
          value={draft.company_context_snapshot.narrative_flow_seed}
          multiline
          onChange={(value) => update('company_context_snapshot', 'narrative_flow_seed', value)}
        />
        <StrategicCardEditorField
          label="Recommended CTA Style"
          value={draft.company_context_snapshot.recommended_cta_style}
          multiline
          onChange={(value) => update('company_context_snapshot', 'recommended_cta_style', value)}
        />
        <StrategicCardEditorField
          label="Pain Symptoms"
          value={draft.company_context_snapshot.pain_symptoms}
          placeholder="Comma-separated"
          onChange={(value) => update('company_context_snapshot', 'pain_symptoms', value)}
        />
        <StrategicCardEditorField
          label="Authority Domains"
          value={draft.company_context_snapshot.authority_domains}
          placeholder="Comma-separated"
          onChange={(value) => update('company_context_snapshot', 'authority_domains', value)}
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Save Refinement
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </section>
  );
}

function readNumber(obj: Record<string, unknown> | null | undefined, key: string): number | null {
  if (!obj) return null;
  const value = obj[key];
  return typeof value === 'number' && isFinite(value) ? value : null;
}

function readText(obj: Record<string, unknown> | null | undefined, key: string): string | null {
  if (!obj) return null;
  const value = obj[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
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
      return 'High confidence: this looks like a strong campaign choice right now.';
    case 'medium':
      return 'Medium confidence: this has real potential, but review the angle before you commit.';
    case 'low':
    default:
      return 'Early-stage opportunity: worth exploring, but better to test before you build heavily.';
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
          <div className="font-semibold text-slate-800">Why This Campaign Is Worth Considering</div>
          <div className="text-slate-700">{transformationLine}</div>
          <div className="text-slate-600">{confidenceLine}</div>
        </div>
      </div>
    </div>
  );
}

export default function RecommendationBlueprintCard(props: RecommendationBlueprintCardProps) {
  const {
    recommendation,
    onRefineRecommendation,
    onBuildCampaignBlueprint,
    onBuildCampaignFast,
    fastLoading,
    onMarkLongTerm,
    onArchive,
    strategyStatus,
    viewMode = 'FULL',
    isTopPriority,
    resurfaced,
    executionBadge,
    upcomingBadge,
    buildError,
    boltTextPreset,
  } = props;
  const [expanded, setExpanded] = useState(false);
  const [minimized, setMinimized] = useState(true);
  const [busy, setBusy] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [refinementDraft, setRefinementDraft] = useState<RecommendationStrategicCardDraft | null>(null);
  const [boltMenuOpen, setBoltMenuOpen] = useState(false);
  const [boltOutcomeView, setBoltOutcomeView] = useState<BoltOutcomeView>('schedule');
  const [boltDurationWeeks, setBoltDurationWeeks] = useState<number>(4);
  const [boltCampaignMode, setBoltCampaignMode] = useState<BoltCampaignMode>('text_based');
  const [boltContentFormats, setBoltContentFormats] = useState<BoltContentFormat[]>(['post']);
  const boltMenuRef = useRef<HTMLDivElement>(null);

  // When switching to creator_dependent, cap outcome at daily_plan; reset formats to first option
  const handleBoltModeChange = (mode: BoltCampaignMode) => {
    setBoltCampaignMode(mode);
    setBoltContentFormats([BOLT_CONTENT_FORMATS[mode][0].value]);
    if (mode === 'creator_dependent' && boltOutcomeView === 'schedule') {
      setBoltOutcomeView('daily_plan');
    }
  };

  const toggleContentFormat = (fmt: BoltContentFormat) => {
    setBoltContentFormats((prev) =>
      prev.includes(fmt)
        ? prev.length > 1 ? prev.filter((f) => f !== fmt) : prev  // keep at least one
        : [...prev, fmt]
    );
  };

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
  const canExecuteRecommendationActions =
    recommendation && typeof recommendation.id === 'string' && recommendation.id.trim().length > 0;
  const strategicCard = buildRecommendationStrategicCard(rec);
  const polishFlags = (rec.polish_flags as Record<string, unknown> | undefined) ?? null;

  const core = strategicCard.core;
  const strategicContext = strategicCard.strategic_context;
  const intelligenceBlock = strategicCard.intelligence;
  const signals = strategicCard.signals;
  const executionBlock = strategicCard.execution;
  const snapshotBlock = strategicCard.company_context_snapshot;
  const blueprint = strategicCard.blueprint;

  const openRefinement = () => {
    setRefinementDraft(buildRecommendationStrategicCardDraft(rec));
    setIsRefining(true);
    if (minimized) setMinimized(false);
  };

  const closeRefinement = () => {
    setIsRefining(false);
    setRefinementDraft(null);
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

  const saveRefinement = async () => {
    if (!onRefineRecommendation || !refinementDraft) return;
    await run(async () => {
      await onRefineRecommendation(applyRecommendationStrategicCardDraft(rec, refinementDraft));
      closeRefinement();
    });
  };

  const hasMinimalProblemTransformation =
    !!intelligenceBlock.problem_being_solved || !!intelligenceBlock.expected_transformation;
  const hasMinimalWhyNow = !!intelligenceBlock.why_now;
  const hasMinimalExecution =
    !!executionBlock.execution_stage || !!executionBlock.stage_objective;
  const hasMinimalBlueprint =
    blueprint.duration_weeks != null || blueprint.primary_recommendations.length > 0;

  /** Display-safe title: prefer polished_title, always sanitize to strip "Business Report 2026", ":." etc. */
  const displayTopic = (() => {
    const raw = core.polished_title || core.topic;
    if (!raw || !raw.trim()) return null;
    const sanitized = sanitizeTopicForDisplay(raw);
    return sanitized || raw.trim();
  })();
  const confidenceBannerContent = useMemo(() => {
    const transformationLine = getTransformationSummary(
      intelligenceBlock.problem_being_solved,
      intelligenceBlock.expected_transformation,
      core.summary,
      core.topic,
      displayTopic ?? undefined
    );
    const confidenceLine = getConfidencePhrase(confidenceTier);
    return { transformationLine, confidenceLine, tier: confidenceTier };
  }, [
    intelligenceBlock.problem_being_solved,
    intelligenceBlock.expected_transformation,
    core.summary,
    core.topic,
    core.polished_title,
    displayTopic,
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
                  {displayTopic || core.polished_title || core.topic || 'Strategic recommendation'}
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
            {/* ── BOLT button: single preset button (from BOLT Text setup page) or full dropdown ── */}
            {boltTextPreset ? (
              <button
                type="button"
                title={`Run BOLT (Text) · ${boltTextPreset.contentFormat} · ${boltTextPreset.durationWeeks}w · ${boltTextPreset.outcomeView}`}
                onClick={() =>
                  run(() =>
                    onBuildCampaignFast?.({
                      outcomeView: boltTextPreset.outcomeView,
                      durationWeeks: boltTextPreset.durationWeeks,
                      campaignMode: 'text_based',
                      contentFormats: [boltTextPreset.contentFormat],
                    })
                  )
                }
                disabled={busy || fastLoading || !onBuildCampaignFast}
                className="min-w-[140px] h-[36px] px-4 py-2 text-sm font-semibold rounded-lg border border-amber-400 bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 transition flex items-center justify-center gap-1.5 shadow-sm"
              >
                {fastLoading ? '⚡ Generating…' : '⚡ BOLT (Text)'}
              </button>
            ) : (
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
                  <div className="absolute left-0 top-full mt-1 z-50 min-w-[260px] rounded-xl border border-gray-200 bg-white shadow-xl py-2">
                    {/* Campaign Mode */}
                    <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Campaign Mode</div>
                    <div className="flex gap-2 px-3 pb-2">
                      {(['text_based', 'creator_dependent'] as BoltCampaignMode[]).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => handleBoltModeChange(mode)}
                          className={`flex-1 py-1.5 text-xs font-medium rounded-md border transition ${
                            boltCampaignMode === mode
                              ? 'bg-amber-500 text-white border-amber-500'
                              : 'bg-white text-gray-600 border-gray-300 hover:border-amber-400'
                          }`}
                        >
                          {mode === 'text_based' ? 'Text Based' : 'Creator'}
                        </button>
                      ))}
                    </div>
                    {/* Content Format */}
                    <div className="px-3 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wider border-t border-gray-100">Content Format</div>
                    <div className="flex flex-wrap gap-1.5 px-3 py-2">
                      {BOLT_CONTENT_FORMATS[boltCampaignMode].map((fmt) => (
                        <button
                          key={fmt.value}
                          type="button"
                          onClick={() => toggleContentFormat(fmt.value)}
                          className={`px-2 py-1 text-xs rounded-full border transition ${
                            boltContentFormats.includes(fmt.value)
                              ? 'bg-amber-100 text-amber-800 border-amber-400'
                              : 'bg-white text-gray-500 border-gray-200 hover:border-amber-300'
                          }`}
                        >
                          {fmt.label}
                        </button>
                      ))}
                    </div>
                    {/* Duration */}
                    <div className="px-3 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wider border-t border-gray-100">Campaign Duration</div>
                    <div className="flex gap-1.5 px-3 py-2">
                      {BOLT_DURATION_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setBoltDurationWeeks(opt.value)}
                          className={`flex-1 py-1 text-xs font-medium rounded-md border transition ${
                            boltDurationWeeks === opt.value
                              ? 'bg-amber-500 text-white border-amber-500'
                              : 'bg-white text-gray-600 border-gray-300 hover:border-amber-400'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    {/* Stop At */}
                    <div className="px-3 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wider border-t border-gray-100">Stop At</div>
                    {BOLT_OUTCOME_OPTIONS_BY_MODE[boltCampaignMode].map((opt) => (
                      <label key={opt.value} className="flex items-center gap-2 px-3 py-1.5 hover:bg-amber-50 cursor-pointer">
                        <input
                          type="radio"
                          name="boltOutcome"
                          checked={boltOutcomeView === opt.value}
                          onChange={() => setBoltOutcomeView(opt.value)}
                          className="rounded-full border-amber-400 text-amber-600 focus:ring-amber-500"
                        />
                        <span className="text-sm text-gray-700">{opt.label}</span>
                        {opt.hint && <span className="text-xs text-gray-400 ml-auto">{opt.hint}</span>}
                      </label>
                    ))}
                    {/* Run */}
                    <div className="border-t border-gray-100 mt-2 pt-2 px-2">
                      <button
                        type="button"
                        onClick={() => {
                          run(() => onBuildCampaignFast?.({ outcomeView: boltOutcomeView, durationWeeks: boltDurationWeeks, campaignMode: boltCampaignMode, contentFormats: boltContentFormats }));
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
            )}
            <button
              type="button"
              onClick={() => (isRefining ? closeRefinement() : openRefinement())}
              disabled={busy || !onRefineRecommendation}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-indigo-200 text-indigo-700 bg-indigo-50 disabled:opacity-50"
            >
              {isRefining ? 'Close Refine' : 'Refine Card'}
            </button>
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
              disabled={busy || !onMarkLongTerm || !canExecuteRecommendationActions}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 disabled:opacity-50"
            >
              Mark Long-Term
            </button>
            <button
              type="button"
              onClick={() => run(onArchive)}
              disabled={busy || !onArchive || !canExecuteRecommendationActions}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-600 disabled:opacity-50"
            >
              Archive
            </button>
          </div>
        </section>

        {isRefining && refinementDraft ? (
          <StrategicCardRefinementEditor
            draft={refinementDraft}
            saving={busy}
            onChange={setRefinementDraft}
            onCancel={closeRefinement}
            onSave={saveRefinement}
          />
        ) : null}
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
                {displayTopic || core.polished_title || core.topic || 'Strategic recommendation'}
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
          <h4 className="text-sm font-semibold text-gray-800 mb-2">Why The AI Likes This Direction</h4>
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
          <h4 className="text-sm font-semibold text-gray-800 mb-2">How You Would Use This Campaign</h4>
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
          <h4 className="text-sm font-semibold text-gray-800 mb-2">What This Could Turn Into</h4>
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
              <div className="absolute left-0 top-full mt-1 z-50 min-w-[260px] rounded-xl border border-gray-200 bg-white shadow-xl py-2">
                {/* Campaign Mode */}
                <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Campaign Mode</div>
                <div className="flex gap-2 px-3 pb-2">
                  {(['text_based', 'creator_dependent'] as BoltCampaignMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => handleBoltModeChange(mode)}
                      className={`flex-1 py-1.5 text-xs font-medium rounded-md border transition ${
                        boltCampaignMode === mode
                          ? 'bg-amber-500 text-white border-amber-500'
                          : 'bg-white text-gray-600 border-gray-300 hover:border-amber-400'
                      }`}
                    >
                      {mode === 'text_based' ? 'Text Based' : 'Creator'}
                    </button>
                  ))}
                </div>
                {/* Content Format */}
                <div className="px-3 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wider border-t border-gray-100">Content Format</div>
                <div className="flex flex-wrap gap-1.5 px-3 py-2">
                  {BOLT_CONTENT_FORMATS[boltCampaignMode].map((fmt) => (
                    <button
                      key={fmt.value}
                      type="button"
                      onClick={() => toggleContentFormat(fmt.value)}
                      className={`px-2 py-1 text-xs rounded-full border transition ${
                        boltContentFormats.includes(fmt.value)
                          ? 'bg-amber-100 text-amber-800 border-amber-400'
                          : 'bg-white text-gray-500 border-gray-200 hover:border-amber-300'
                      }`}
                    >
                      {fmt.label}
                    </button>
                  ))}
                </div>
                {/* Duration */}
                <div className="px-3 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wider border-t border-gray-100">Campaign Duration</div>
                <div className="flex gap-1.5 px-3 py-2">
                  {BOLT_DURATION_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setBoltDurationWeeks(opt.value)}
                      className={`flex-1 py-1 text-xs font-medium rounded-md border transition ${
                        boltDurationWeeks === opt.value
                          ? 'bg-amber-500 text-white border-amber-500'
                          : 'bg-white text-gray-600 border-gray-300 hover:border-amber-400'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {/* Stop At */}
                <div className="px-3 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wider border-t border-gray-100">Stop At</div>
                {BOLT_OUTCOME_OPTIONS_BY_MODE[boltCampaignMode].map((opt) => (
                  <label key={opt.value} className="flex items-center gap-2 px-3 py-1.5 hover:bg-amber-50 cursor-pointer">
                    <input
                      type="radio"
                      name="boltOutcomeAlt"
                      checked={boltOutcomeView === opt.value}
                      onChange={() => setBoltOutcomeView(opt.value)}
                      className="rounded-full border-amber-400 text-amber-600 focus:ring-amber-500"
                    />
                    <span className="text-sm text-gray-700">{opt.label}</span>
                    {opt.hint && <span className="text-xs text-gray-400 ml-auto">{opt.hint}</span>}
                  </label>
                ))}
                {/* Run */}
                <div className="border-t border-gray-100 mt-2 pt-2 px-2">
                  <button
                    type="button"
                    onClick={() => {
                      run(() => onBuildCampaignFast?.({ outcomeView: boltOutcomeView, durationWeeks: boltDurationWeeks, campaignMode: boltCampaignMode, contentFormats: boltContentFormats }));
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
            onClick={() => (isRefining ? closeRefinement() : openRefinement())}
            disabled={busy || !onRefineRecommendation}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-indigo-200 text-indigo-700 bg-indigo-50 disabled:opacity-50"
          >
            {isRefining ? 'Close Refine' : 'Refine Card'}
          </button>
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
            disabled={busy || !onMarkLongTerm || !canExecuteRecommendationActions}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 disabled:opacity-50"
          >
            Mark Long-Term
          </button>
          <button
            type="button"
            onClick={() => run(onArchive)}
            disabled={busy || !onArchive || !canExecuteRecommendationActions}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-600 disabled:opacity-50"
          >
            Archive
          </button>
        </div>
      </section>

      {isRefining && refinementDraft ? (
        <StrategicCardRefinementEditor
          draft={refinementDraft}
          saving={busy}
          onChange={setRefinementDraft}
          onCancel={closeRefinement}
          onSave={saveRefinement}
        />
      ) : null}

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
