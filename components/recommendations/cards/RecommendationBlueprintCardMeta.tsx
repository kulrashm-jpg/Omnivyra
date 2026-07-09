/** Part 1/2 of RecommendationBlueprintCard.tsx — verbatim split (barrel preserved; importers unchanged). */
import React, { useMemo, useState, useRef, useEffect } from 'react';
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

// BOLT creates campaigns of 4 weeks or less. (A previously-dead local
// BOLT_DURATION_OPTIONS list was removed in 6C-2; duration options now live in
// lib/shared/campaignDuration — SHORT_CAMPAIGN_DURATIONS.)

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

export type RecommendationBlueprintCardProps = {
  recommendation: Record<string, unknown>;
  onRefineRecommendation?: (recommendation: Record<string, unknown>) => Promise<void> | void;
  onBuildCampaignBlueprint?: () => Promise<void> | void;
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
  /** When true, BOLT fast-build is in progress for this specific card. */
  fastLoading?: boolean;
  /** Trigger fast (BOLT) campaign build with options. */
  onBuildCampaignFast?: (options?: { outcomeView?: BoltOutcomeView; campaignMode?: BoltCampaignMode; contentFormats?: BoltContentFormat[]; durationWeeks?: number }) => Promise<void> | void;
  /** When set, card was initiated from the BOLT (Text) setup page with preset options. */
  boltTextPreset?: { outcomeView: BoltOutcomeView; durationWeeks: number; contentFormat: BoltContentFormat } | undefined;
  /**
   * When set, this card was initiated from the BOLT (Text) setup page.
   * Hides the Campaign Mode / dropdown UI and shows a single "⚡ BOLT (Text)" button
   * that fires immediately with the preset options.
   */
  /** Optional duration override from the current flow (e.g. Intelligent Mix selected weeks). */
  durationWeeksOverride?: number | null;
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

export function RecommendationJourneyLabel(props: { state: Exclude<JourneyState, null> }) {
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
export function RecommendationNarrativeLine(props: { state: Exclude<JourneyState, null> }) {
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
export function getStrategicMemoryState(props: {
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
export function RecommendationStrategicMemoryLine(props: { state: Exclude<StrategicMemoryState, null> }) {
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
export function getIntentForecastState(props: {
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
export function RecommendationIntentForecastLine(props: { state: Exclude<IntentForecastState, null> }) {
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
export function RecommendationMomentumCue(props: { state: Exclude<MomentumState, null> }) {
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
export function sanitizeTopicForDisplay(s: string | null | undefined): string {
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

export function getTransformationSummary(
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

export function getConfidenceTier(
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

export function StrategicCardRefinementEditor(props: {
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

