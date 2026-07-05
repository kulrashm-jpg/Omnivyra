/**
 * Command Center → BOLT (Creator) Strategy Builder
 *
 * Creator-dependent campaigns: video, reel, carousel, image, podcast, short, story.
 * View options: Weekly Plan and Daily Plan only (no auto-schedule — human creator produces content).
 */

import React, { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/router';
import { getProgressPipeline, resolveCanonicalStageIndex, type ProgressStep } from '../lib/shared/bolt/progressModel';
import { useCompanyContext } from './CompanyContext';
import { CORE_AUDIENCE_LABELS } from '../lib/shared/audience/audienceRegistry';
import { BOLT_DURATION_OPTIONS } from '../lib/shared/campaignDuration';
import { fetchWithAuth } from './community-ai/fetchWithAuth';
import { BoltCampaignChat } from './bolt/BoltCampaignChat';
import type { BoltStrategyCard } from '../pages/api/bolt/strategy-cards';
import type { BOLTProgress } from './BOLTProgressModal';
import { readCampaignSourcePayload } from '../lib/content/launchCampaignFromContent';
import BoltPlatformPicker from './bolt/BoltPlatformPicker';
import {
  CREATOR_FORMAT_CAPABILITY,
  type CreatorContentFormat,
} from '../lib/shared/bolt/creatorFormatCapability';
import { platformSupportsCapability } from '../lib/shared/social/platformCapabilities';
type ThemeSource = 'hybrid' | 'api' | 'ai';
type OutcomeView = 'week_plan' | 'daily_plan' | 'schedule';

const VIEW_OPTIONS: { value: OutcomeView; label: string; icon: string; hint: string }[] = [
  { value: 'week_plan',  label: 'Week Plan',  icon: '📋', hint: 'High-level weekly content blueprint' },
  { value: 'daily_plan', label: 'Daily Plan',  icon: '📅', hint: 'Break the plan into day-by-day actions' },
  { value: 'schedule',   label: 'Schedule',   icon: 'Cal', hint: 'Available only when every selected creator format is schedulable' },
];

const BOLT_STATE_KEY = 'bolt-creator-strategy-state';

// Round-7 Phase 2: cross-platform-sharing eligibility moved to
// `lib/shared/bolt/crossPlatformSharing.ts` (single source of truth).

// Two lanes (see useBoltCreator `supportsScheduling`):
//   • Video / Reel / Short  → attachment-required, capped at Daily Plan
//     (human uploads media URL per row in the Activity Workspace).
//   • Carousel / Image / Infographic → autonomous, can run through to Schedule.
// Banner / PDF / Slider stay in the governance registry for other surfaces
// but are intentionally not offered on this builder.
const CONTENT_FORMATS: { value: CreatorContentFormat; label: string; icon: string; hint: string }[] = [
  { value: 'video',       label: 'Video',       icon: '🎬', hint: 'Long-form video content' },
  { value: 'reel',        label: 'Reel',        icon: '🎥', hint: 'Short vertical video (15–90s)' },
  { value: 'short',       label: 'Short',       icon: '⚡', hint: 'YouTube / TikTok short' },
  { value: 'carousel',    label: 'Carousel',    icon: '🖼️', hint: 'Multi-slide visual story' },
  { value: 'image',       label: 'Image',       icon: '📸', hint: 'Static photo or graphic' },
  { value: 'infographic', label: 'Infographic', icon: '📊', hint: 'Visual explainer asset' },
];

const DURATION_OPTIONS = BOLT_DURATION_OPTIONS;

const GOAL_OPTIONS = [
  'Brand Awareness', 'Lead Generation', 'Thought Leadership',
  'Product Launch', 'Community Growth', 'Engagement',
];

const AUDIENCE_OPTIONS = CORE_AUDIENCE_LABELS;

const STRATEGIC_FOCUS_OPTIONS = [
  'Content Marketing', 'SEO / Organic', 'Social Media', 'Email Marketing',
  'Brand Storytelling', 'Product Education', 'Community Building',
  'Data & Insights', 'Influencer Amplification', 'Competitive Positioning',
];

const INTELLIGENCE_SOURCES: { value: ThemeSource; label: string; desc: string }[] = [
  { value: 'hybrid', label: 'Hybrid Intelligence', desc: 'Trend signals + AI reasoning' },
  { value: 'api', label: 'API Intelligence', desc: 'Platform signals & market data' },
  { value: 'ai', label: 'AI Strategic Engine', desc: 'Pure AI strategic planning' },
];

const CARD_THEMES = [
  { gradient: 'from-blue-600 to-indigo-600',   lightBg: 'bg-blue-50',   badge: 'bg-blue-100 text-blue-700',   accent: 'text-blue-600',   ring: 'ring-blue-500',   border: 'border-blue-200',   weekDot: 'bg-blue-400',   btn: 'bg-blue-600 hover:bg-blue-700' },
  { gradient: 'from-indigo-600 to-violet-600',  lightBg: 'bg-indigo-50', badge: 'bg-indigo-100 text-indigo-700', accent: 'text-indigo-600', ring: 'ring-indigo-500', border: 'border-indigo-200', weekDot: 'bg-indigo-400', btn: 'bg-indigo-600 hover:bg-indigo-700' },
  { gradient: 'from-violet-600 to-purple-600',  lightBg: 'bg-violet-50', badge: 'bg-violet-100 text-violet-700', accent: 'text-violet-600', ring: 'ring-violet-500', border: 'border-violet-200', weekDot: 'bg-violet-400', btn: 'bg-violet-600 hover:bg-violet-700' },
];

type Suggestion = {
  id: string;
  topic: string;
  suggested_campaign_title: string;
  opportunity_score: number | null;
  suggested_duration: number;
};

/* ─── Tag input ───────────────────────────────────────────────────────────── */
function TagInput({ tags, onChange, placeholder }: { tags: string[]; onChange: (t: string[]) => void; placeholder?: string }) {
  const [input, setInput] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  function add() {
    const v = input.trim();
    if (v && !tags.includes(v)) onChange([...tags, v]);
    setInput('');
  }
  return (
    <div
      className="flex flex-wrap gap-2 min-h-[42px] w-full border border-gray-200 rounded-xl px-3 py-2 cursor-text focus-within:ring-2 focus-within:ring-blue-300"
      onClick={() => ref.current?.focus()}
    >
      {tags.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 text-xs bg-blue-100 text-blue-800 px-2.5 py-1 rounded-full font-medium">
          {t}
          <button type="button" onClick={() => onChange(tags.filter((x) => x !== t))} className="text-blue-500 hover:text-blue-800">×</button>
        </span>
      ))}
      <input
        ref={ref}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); }
          if (e.key === 'Backspace' && !input && tags.length) onChange(tags.slice(0, -1));
        }}
        onBlur={add}
        placeholder={tags.length === 0 ? placeholder : ''}
        className="flex-1 min-w-[120px] text-sm outline-none bg-transparent placeholder:text-gray-300"
      />
    </div>
  );
}

/* ─── BOLT stage pipeline — single canonical authority (PROGRESS-PARITY) ──── */
const BOLT_PIPELINE = getProgressPipeline('CREATOR');

function stageIndexInPipeline(
  stage: string | undefined,
  pipeline: ProgressStep[] = BOLT_PIPELINE,
): number {
  return resolveCanonicalStageIndex(stage, pipeline);
}

function stageIndex(stage: string | undefined): number {
  return stageIndexInPipeline(stage, BOLT_PIPELINE);
}

function formatElapsed(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${min}m ${s}s` : `${min}m`;
}

/* ─── Inline BOLT progress tracker ──────────────────────────────────────── */
function CardBoltProgress({ progress, theme, startedAt, outcomeView }: {
  progress: BOLTProgress;
  theme: typeof CARD_THEMES[0];
  startedAt: number;
  outcomeView: OutcomeView;
}) {
  const [elapsedMs, setElapsedMs] = useState(Date.now() - startedAt);
  useEffect(() => {
    const id = setInterval(() => setElapsedMs(Date.now() - startedAt), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  const pipeline = BOLT_PIPELINE;
  const isCompleted = progress.status === 'completed';
  // When completed, push currentIdx beyond the last visible stage so
  // every step shows ✓ — matches the Week Plan UX expectation that
  // "100% done" means every stage in the tracker is checked.
  const currentIdx = isCompleted ? pipeline.length : stageIndexInPipeline(progress.stage, pipeline);
  const pct = isCompleted ? 100 : Math.min(100, Math.max(0, progress.progress_percentage ?? 0));
  const isFailed = progress.status === 'failed';

  return (
    <div className="px-4 pb-4 pt-3 bg-white border-t border-gray-100">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {isFailed ? (
            <span className="w-4 h-4 flex-shrink-0 text-red-500">✕</span>
          ) : isCompleted ? (
            <span className="w-4 h-4 flex-shrink-0 text-green-500 font-bold text-[13px]">✓</span>
          ) : (
            <svg className="animate-spin w-4 h-4 text-blue-500 flex-shrink-0" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
          )}
          <span className="text-xs font-bold text-gray-800">{isFailed ? 'BOLT failed' : isCompleted ? 'BOLT complete' : 'BOLT running'}</span>
        </div>
        <span className="text-[11px] text-gray-400">{formatElapsed(elapsedMs)}</span>
      </div>
      <div className="space-y-1.5 mb-3">
        {pipeline.map((step, i) => {
          const isDone    = currentIdx > i;
          const isCurrent = currentIdx === i;
          const isPending = currentIdx < i;
          return (
            <div key={step.stage} className="flex items-center gap-2">
              <div className={`flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold
                ${isFailed && isCurrent ? 'bg-red-500 text-white'
                  : isDone    ? 'bg-blue-500 text-white'
                  : isCurrent ? `bg-gradient-to-br ${theme.gradient} text-white animate-pulse`
                  : 'bg-gray-100 text-gray-400'}`}>
                {isDone ? '✓' : isCurrent && !isFailed ? '…' : i + 1}
              </div>
              <span className={`text-[11px] font-medium ${isDone ? 'text-gray-400 line-through' : isCurrent ? 'text-gray-800' : 'text-gray-300'}`}>
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full bg-gradient-to-r ${theme.gradient} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
      {isCompleted && (
        <p className="mt-2 text-[11px] font-semibold text-green-600">
          Done. Opening the next screen...
        </p>
      )}
      {isFailed && progress.error_message && (
        <p className="text-[11px] text-red-600 mt-2 leading-snug">{progress.error_message}</p>
      )}
    </div>
  );
}

/* ─── Strategy Card ──────────────────────────────────────────────────────── */
function StrategyCard({
  card, index, selected, boltProgress, execStartedAt, anyExecuting, outcomeView, onSelect,
}: {
  card: BoltStrategyCard; index: number; selected: boolean;
  boltProgress: BOLTProgress | null; execStartedAt: number;
  anyExecuting: boolean; outcomeView: OutcomeView; onSelect: () => void;
}) {
  const theme = CARD_THEMES[index % CARD_THEMES.length];
  const isRunningThis = selected && boltProgress !== null;

  return (
    <div className={`relative flex flex-col rounded-2xl border-2 overflow-hidden transition-all duration-200 shadow-sm
      ${isRunningThis ? `${theme.ring} ring-2 border-transparent shadow-lg`
      : selected      ? `${theme.ring} ring-2 border-transparent`
      : anyExecuting  ? `${theme.border} opacity-50`
      : `${theme.border} hover:border-transparent hover:${theme.ring} hover:ring-2 hover:shadow-lg`}`}>

      {/* Coloured header band */}
      <div className={`bg-gradient-to-r ${theme.gradient} px-5 pt-4 pb-5`}>
        <div className="flex items-center justify-between gap-3 mb-3">
          <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-white/20 text-white tracking-widest uppercase">
            Strategy {index + 1}
          </span>
          <div className="flex items-center gap-1.5">
            {isRunningThis && (
              <span className="flex items-center gap-1 text-xs font-bold bg-white/90 text-blue-700 px-2.5 py-1 rounded-full">⚡ Running</span>
            )}
            {selected && !isRunningThis && (
              <span className="flex items-center gap-1 text-xs font-bold bg-white text-indigo-700 px-2.5 py-1 rounded-full">✓ Selected</span>
            )}
          </div>
        </div>
        <h3 className="text-lg font-bold text-white leading-tight mb-1" title={card.title}>{card.title}</h3>
        {card.summary && <p className="text-xs text-white/80 leading-relaxed mb-3">{card.summary}</p>}
        <div className="flex flex-wrap gap-1.5 mt-1">
          {card.campaignGoals && card.campaignGoals.length > 0
            ? card.campaignGoals.map((cg) => (
                <span key={cg} className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/15 text-white/90">🎯 {cg}</span>
              ))
            : card.campaignGoal && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/15 text-white/90">🎯 {card.campaignGoal}</span>
              )}
          {card.targetAudience && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/15 text-white/90">👥 {card.targetAudience.split(',')[0].trim()}</span>
          )}
          {card.contentFormat && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/15 text-white/90">🎬 {card.contentFormat.replace('_', ' ')}</span>
          )}
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/15 text-white/90">📆 {card.duration}w</span>
        </div>
        {card.phaseLabels.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2.5">
            {card.phaseLabels.map((label, i) => (
              <span key={i} className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/25 text-white">{label}</span>
            ))}
          </div>
        )}
      </div>

      {/* Weekly arc */}
      {!isRunningThis && (
        <div className="flex-1 px-5 py-4 space-y-3 bg-white">
          <p className={`text-[10px] font-bold uppercase tracking-widest ${theme.accent} mb-1`}>Weekly Arc</p>
          {card.weekThemes.map((wt) => (
            <div key={wt.week} className="flex items-start gap-3">
              <span className={`flex-shrink-0 w-5 h-5 rounded-full ${theme.weekDot} flex items-center justify-center text-[10px] font-bold text-white mt-0.5`}>{wt.week}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                  {wt.phase_label && (
                    <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${theme.badge}`}>{wt.phase_label}</span>
                  )}
                  <span className="text-xs font-semibold text-gray-800 leading-snug">{wt.title}</span>
                </div>
                {wt.objective && <p className="text-[10px] text-gray-500 leading-relaxed mt-0.5">{wt.objective}</p>}
                {(wt.content_focus || wt.cta_focus) && (
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                    {wt.content_focus && <span className="text-[9px] text-gray-400"><span className="font-semibold text-gray-500">Content:</span> {wt.content_focus}</span>}
                    {wt.cta_focus && <span className="text-[9px] text-gray-400"><span className="font-semibold text-gray-500">CTA:</span> {wt.cta_focus}</span>}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {isRunningThis && boltProgress && (
        <CardBoltProgress progress={boltProgress} theme={theme} startedAt={execStartedAt} outcomeView={outcomeView} />
      )}

      {/* CTA */}
      {!isRunningThis && (
        <div className="px-5 pb-5 pt-3 bg-white border-t border-gray-100">
          <button
            type="button"
            onClick={onSelect}
            disabled={anyExecuting}
            className={`w-full py-2.5 text-xs font-bold rounded-xl transition-all disabled:opacity-40 ${theme.btn} text-white`}
          >
            {selected ? '✓ Selected — Click to Re-select' : 'Select This Strategy →'}
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── Main page ──────────────────────────────────────────────────────────── */
function DelayedStrategyGenerationProgress({ startedAt }: { startedAt: number | null }) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!startedAt) return;
    const tick = () => setElapsedMs(Date.now() - startedAt);
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);

  if (!startedAt || elapsedMs < 4000) return null;

  const steps = [
    { label: 'Reading campaign inputs', at: 0 },
    { label: 'Building distinct strategy angles', at: 4000 },
    { label: 'Drafting weekly arcs', at: 9000 },
    { label: 'Checking format mix and frequency', at: 14000 },
  ];
  const currentIndex = steps.reduce((idx, step, i) => elapsedMs >= step.at ? i : idx, 0);
  const pct = Math.min(90, 18 + Math.floor(elapsedMs / 1000) * 4);

  return (
    <div className="mb-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-bold text-blue-900">Still working on your strategy cards</p>
        <span className="text-[11px] font-semibold text-blue-500">{formatElapsed(elapsedMs)}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white">
        <div className="h-full rounded-full bg-blue-500 transition-all duration-700" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-2 grid gap-1 sm:grid-cols-2">
        {steps.map((step, i) => (
          <div key={step.label} className={`flex items-center gap-1.5 text-[11px] ${i <= currentIndex ? 'text-blue-800' : 'text-blue-300'}`}>
            <span className={`h-3.5 w-3.5 rounded-full border flex items-center justify-center text-[9px] ${i < currentIndex ? 'border-blue-500 bg-blue-500 text-white' : i === currentIndex ? 'border-blue-500 bg-white' : 'border-blue-200 bg-white'}`}>
              {i < currentIndex ? '✓' : i + 1}
            </span>
            {step.label}
          </div>
        ))}
      </div>
    </div>
  );
}

import type { useBoltCreator } from '../hooks/useBoltCreator';
type S = ReturnType<typeof useBoltCreator>;
export default function BoltCreatorView({ d }: { d: S }) {
  const {
    _ef1,
    _ef2,
    acceptedSuggestions,
    applyChatSuggestion,
    applySuggestion,
    resetCampaignMemory,
    audience,
    authChecked,
    campaignStartDate,
    canGenerate,
    cards,
    cardsRef,
    confirmingCard,
    contentFormats,
    duration,
    execError,
    execProgress,
    execStartedAt,
    executing,
    formatFrequency,
    generationStartedAt,
    genError,
    generating,
    goals,
    handleCardSelect,
    handleConfirmLaunch,
    handleGenerate,
    hasGenerated,
    isAdmin,
    isAuthenticated,
    isLoading,
    offerings,
    outcomeView,
    hasGuidanceOnlyFormats,
    supportsScheduling,
    supportsAutonomousCreatorExecution,
    router,
    companyId,
    selectedIds,
    setAudience,
    setCampaignStartDate,
    setCards,
    setConfirmingCard,
    setContentFormats,
    setDuration,
    setExecError,
    setExecProgress,
    setExecStartedAt,
    setExecuting,
    setFormatFrequency,
    setFreq,
    setGenError,
    setGenerating,
    setGoals,
    setHasGenerated,
    setOfferings,
    setOutcomeView,
    setSelectedIds,
    setShowChat,
    setStrategicFocus,
    setSuggestions,
    setSuggestionsLoading,
    setThemeSource,
    setTopic,
    selectedPlatforms,
    togglePlatform,
    availablePlatforms,
    platformHidden,
    platformsLoading,
    platformBlocked,
    showChat,
    sourceContentToken,
    sourcePayload,
    strategicFocus,
    suggestions,
    suggestionsLoading,
    themeSource,
    toggleAudience,
    toggleFocus,
    toggleFormat,
    toggleGoal,
    topic,
    user,
  } = d;

  // Opening a collapsed panel should carry the user TO the revealed actionable
  // content, not just toggle it out of view below the fold.
  const chatRef = useRef<HTMLDivElement>(null);

    return (
    <>
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 py-8 px-3 sm:px-4 lg:px-6">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Back */}
        <button onClick={() => router.push('/command-center/campaigns')}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800 transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
          Back to Campaign Modes
        </button>

        {/* Header */}
        <div>
          <div className="flex items-center gap-3 mb-1">
            <span className="text-3xl">🎬</span>
            <div>
              <h1 className="text-xl font-bold text-gray-900">BOLT (Creator) Strategy Builder</h1>
              <p className="text-sm font-medium text-gray-600">Creator-Dependent Campaign</p>
            </div>
            <span className="ml-auto rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">Creator Required</span>
          </div>
          <p className="text-gray-500 text-sm">Plan your video, visual, and multimedia campaign. BOLT builds the strategy — your team creates the content.</p>
        </div>

        {/* ── Top two-column: Form | Suggestions + Chat ── */}
        {sourcePayload && (
          <div className="rounded-2xl border border-gray-200 bg-blue-50/60 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-700">Source Content Loaded</p>
            <p className="mt-1 text-sm font-semibold text-gray-900">{sourcePayload.title}</p>
            <p className="mt-1 text-xs text-gray-600">
              We prefilled the campaign topic from this {sourcePayload.contentType}. You can now adapt it for creator-led execution.
            </p>
          </div>
        )}
        <div className="flex gap-5 items-start">

          {/* LEFT: Form */}
          <div className="flex-1 min-w-0 bg-white rounded-2xl border border-gray-200 shadow-sm divide-y divide-gray-100">

            {/* Campaign Topic */}
            <div className="p-5">
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1">
                Campaign Topic <span className="text-red-400">*</span>
              </label>
              <p className="text-xs text-gray-400 mb-2">What is this campaign about?</p>
              <textarea
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                rows={3}
                placeholder="e.g. Behind-the-scenes product launch series for our new SaaS tool…"
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-400 placeholder:text-gray-300"
              />
            </div>

            {/* Goal + Audience */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-0 divide-y sm:divide-y-0 sm:divide-x divide-gray-100">
              <div className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide">Campaign Goal</label>
                  {goals.length > 0 && (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{goals.length} selected</span>
                  )}
                </div>
                <p className="text-xs text-gray-400 mb-2">Select all that apply.</p>
                <div className="flex flex-wrap gap-1.5">
                  {GOAL_OPTIONS.map((g) => (
                    <button key={g} type="button" onClick={() => toggleGoal(g)}
                      className={`text-xs px-2.5 py-1.5 rounded-full border-2 font-medium transition-all ${
                        goals.includes(g) ? 'border-blue-400 bg-blue-100 text-blue-900' : 'border-gray-200 text-gray-600 hover:border-blue-200 hover:bg-blue-50/40'
                      }`}>
                      {goals.includes(g) && '✓ '}{g}
                    </button>
                  ))}
                </div>
              </div>
              <div className="p-5">
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1">Target Audience</label>
                <p className="text-xs text-gray-400 mb-3">Who should this campaign reach?</p>
                <div className="flex flex-wrap gap-1.5">
                  {AUDIENCE_OPTIONS.map((a) => (
                    <button key={a} type="button" onClick={() => toggleAudience(a)}
                      className={`text-xs px-2.5 py-1.5 rounded-full border-2 font-medium transition-all ${
                        audience.includes(a) ? 'border-blue-400 bg-blue-100 text-blue-900' : 'border-gray-200 text-gray-600 hover:border-blue-300 hover:bg-blue-50'
                      }`}>
                      {audience.includes(a) && '✓ '}{a}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Strategic Focus */}
            <div className="p-5">
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1">Strategic Focus</label>
              <p className="text-xs text-gray-400 mb-3">Select all angles that should guide this campaign.</p>
              <div className="flex flex-wrap gap-1.5">
                {STRATEGIC_FOCUS_OPTIONS.map((f) => (
                  <button key={f} type="button" onClick={() => toggleFocus(f)}
                    className={`text-xs px-2.5 py-1.5 rounded-full border-2 font-medium transition-all ${
                      strategicFocus.includes(f) ? 'border-blue-400 bg-blue-100 text-blue-900' : 'border-gray-200 text-gray-600 hover:border-blue-300 hover:bg-blue-50'
                    }`}>
                    {strategicFocus.includes(f) && '✓ '}{f}
                  </button>
                ))}
              </div>
            </div>

            {/* Offerings */}
            <div className="p-5">
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1">Offerings / Products</label>
              <p className="text-xs text-gray-400 mb-2">What should BOLT highlight? Type and press Enter.</p>
              <TagInput tags={offerings} onChange={setOfferings} placeholder="e.g. Product Demo, Brand Story, Tutorial Series…" />
            </div>

            {/* Format + Duration + Source */}
            <div className="grid grid-cols-3 divide-x divide-gray-100">
              <div className="p-5">
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1">
                  Content Format <span className="font-normal text-gray-400">(max 2)</span>
                </label>
                <div className="flex flex-col gap-1.5 mt-2">
                  {CONTENT_FORMATS.map((fmt) => {
                    const selected = contentFormats.includes(fmt.value);
                    const freq = formatFrequency[fmt.value] ?? 3;
                    return (
                      <div key={fmt.value} className="flex flex-col gap-1">
                        <button type="button" onClick={() => toggleFormat(fmt.value)}
                          disabled={!selected && contentFormats.length >= 2}
                          title={fmt.hint}
                          className={`flex items-center gap-2 text-xs px-2.5 py-2 rounded-xl border-2 font-medium transition-all text-left disabled:opacity-40 ${
                            selected ? 'border-blue-400 bg-blue-50 text-blue-900' : 'border-gray-200 text-gray-600 hover:border-blue-300 hover:bg-blue-50/40'
                          }`}>
                          <span>{fmt.icon}</span>{fmt.label}
                        </button>
                        {selected && (
                          <div className="flex items-center gap-1.5 pl-1 pb-0.5">
                            <span className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">×/wk</span>
                            <button type="button" onClick={() => setFreq(fmt.value, -1)}
                              className="w-5 h-5 rounded-full border border-gray-300 text-gray-500 hover:bg-gray-100 flex items-center justify-center text-xs font-bold leading-none">−</button>
                            <span className="text-xs font-bold text-blue-700 w-4 text-center">{freq}</span>
                            <button type="button" onClick={() => setFreq(fmt.value, 1)}
                              className="w-5 h-5 rounded-full border border-gray-300 text-gray-500 hover:bg-gray-100 flex items-center justify-center text-xs font-bold leading-none">+</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="p-5">
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-3">Duration</label>
                <div className="flex flex-col gap-1.5">
                  {DURATION_OPTIONS.map((opt) => (
                    <button key={opt.value} type="button" onClick={() => setDuration(opt.value)}
                      className={`py-2 text-xs font-semibold rounded-xl border-2 transition-all ${
                        duration === opt.value ? 'border-blue-400 bg-blue-500 text-white' : 'border-gray-200 bg-white text-gray-600 hover:border-blue-300'
                      }`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="p-5">
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-3">Intelligence Source</label>
                <div className="flex flex-col gap-1.5">
                  {INTELLIGENCE_SOURCES.map((src) => (
                    <button key={src.value} type="button" onClick={() => setThemeSource(src.value)}
                      className={`flex flex-col items-start text-left px-2.5 py-2 rounded-xl border-2 transition-all ${
                        themeSource === src.value ? 'border-blue-400 bg-blue-50 text-blue-900' : 'border-gray-200 text-gray-600 hover:border-blue-300 hover:bg-blue-50/40'
                      }`}>
                      <span className="text-xs font-semibold">{src.label}</span>
                      <span className="text-[10px] text-gray-400 mt-0.5">{src.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Platforms — re-filtered per the formats the user has selected.
                Map: format → capability (CREATOR_FORMAT_CAPABILITY) → registry
                lookup. Without this the picker only honors the coarse
                'creator' capability and hides LinkedIn/FB/Pinterest/Reddit
                for banner/image/PDF campaigns those platforms support. */}
            <div className="px-5 pt-4 pb-4 border-t border-gray-100">
              {(() => {
                const derivedCapabilities = contentFormats.length > 0
                  ? Array.from(new Set(
                      contentFormats
                        .map((f) => CREATOR_FORMAT_CAPABILITY[f as CreatorContentFormat])
                        .filter(Boolean),
                    ))
                  : null;
                const allConnected = [
                  ...availablePlatforms,
                  ...(platformHidden ?? []).map((h) => h.platform),
                ];
                let effectiveSupported = availablePlatforms;
                let effectiveHidden = platformHidden ?? [];
                if (derivedCapabilities && derivedCapabilities.length > 0) {
                  const existingReasons = new Map(
                    (platformHidden ?? []).map((h) => [h.platform, h.reason]),
                  );
                  const sup: string[] = [];
                  const hid: { platform: string; reason: string }[] = [];
                  const seen = new Set<string>();
                  for (const p of allConnected) {
                    if (seen.has(p)) continue;
                    seen.add(p);
                    const supports = derivedCapabilities.some((c) => platformSupportsCapability(p, c));
                    if (supports) sup.push(p);
                    else hid.push({
                      platform: p,
                      reason: existingReasons.get(p) ?? `${p} does not support the selected format(s).`,
                    });
                  }
                  effectiveSupported = sup;
                  effectiveHidden = hid;
                }
                return (
                  <BoltPlatformPicker
                    accent="indigo"
                    loading={platformsLoading}
                    blocked={platformBlocked}
                    supported={effectiveSupported}
                    hidden={effectiveHidden}
                    selected={selectedPlatforms.filter((p) => effectiveSupported.includes(p))}
                    onToggle={togglePlatform}
                    emptyMessage={
                      contentFormats.length > 0
                        ? 'None of your connected platforms support the selected format(s). Try a different content type or connect more platforms.'
                        : 'No creator-compatible platforms connected yet. Connect Instagram, TikTok, YouTube, or Facebook to target specific platforms.'
                    }
                  />
                );
              })()}
            </div>

            {/* Campaign Start Date */}
            <div className="px-5 pt-4 pb-4 border-t border-gray-100">
              <div className="flex items-center gap-2 mb-2">
                <label htmlFor="creator-start-date" className="block text-xs font-semibold text-gray-700 uppercase tracking-wide">Campaign Start Date</label>
                <span className="text-[10px] text-gray-400">— when should activity planning begin?</span>
              </div>
              <input
                id="creator-start-date"
                type="date"
                value={campaignStartDate}
                min={new Date().toISOString().split('T')[0]}
                onChange={(e) => setCampaignStartDate(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
              />
            </div>

            {/* View In */}
            <div className="px-5 pt-4 pb-2 border-t border-gray-100">
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">View In</label>
              <div className="flex gap-2">
                {/* Schedule is offered only when every selected format is
                    autonomous (Carousel/Image/Infographic). Any video-type
                    format caps the campaign at Daily Plan, so we hide the
                    Schedule option entirely rather than show it disabled. */}
                {VIEW_OPTIONS.filter((opt) => opt.value !== 'schedule' || supportsScheduling).map((opt) => {
                  const disabled = opt.value === 'schedule' && !supportsScheduling;
                  return (
                  <label key={opt.value} className={`flex items-center gap-1.5 select-none ${disabled ? 'cursor-not-allowed opacity-45' : 'cursor-pointer'}`}>
                    <input
                      type="radio"
                      name="outcomeView"
                      value={opt.value}
                      checked={outcomeView === opt.value}
                      disabled={disabled}
                      onChange={() => !disabled && setOutcomeView(opt.value)}
                      className="accent-blue-500 w-3.5 h-3.5"
                    />
                    <span className={`text-xs font-medium ${outcomeView === opt.value ? 'text-blue-700' : 'text-gray-600'}`}>{opt.label}</span>
                  </label>
                  );
                })}
              </div>
              {hasGuidanceOnlyFormats && supportsAutonomousCreatorExecution && (
                <p className="mt-2 text-[11px] leading-snug text-blue-700">
                  Mixed-mode campaign: autonomous formats will render and schedule normally; attachment-required formats will hold per row pending media upload.
                </p>
              )}
              {hasGuidanceOnlyFormats && !supportsAutonomousCreatorExecution && (
                <p className="mt-2 text-[11px] leading-snug text-blue-700">
                  Attachment-required formats selected. BOLT will produce theme treatments + creator guidance per row; scheduling unlocks per row after media upload.
                </p>
              )}
              {!hasGuidanceOnlyFormats && contentFormats.length > 0 && supportsAutonomousCreatorExecution && (
                <p className="mt-2 text-[11px] leading-snug text-emerald-700">
                  Selected formats support autonomous creator execution.
                </p>
              )}
            </div>

            {/* Generate button */}
            <div className="p-5 bg-blue-50/60 rounded-b-2xl">
              <button type="button" onClick={handleGenerate} disabled={!canGenerate || generating}
                className={`w-full py-3 text-sm font-bold rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 ${
                  canGenerate && !generating ? 'bg-blue-500 hover:bg-blue-600 text-white' : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                }`}>
                {generating ? (
                  <><svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>Generating Strategy Cards…</>
                ) : hasGenerated ? '🎬 Regenerate BOLT Creator Cards' : '🎬 Generate BOLT Creator Cards'}
              </button>
              {!canGenerate && !generating && (
                <p className="text-xs text-gray-400 text-center mt-2">Enter a campaign topic to get started</p>
              )}
            </div>
          </div>

          {/* RIGHT: Suggestions + AI Chat */}
          <div className="w-[36%] flex-shrink-0 flex flex-col gap-4">

            {/* Suggestions */}
            <div className="bg-white rounded-2xl border border-blue-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-gray-800 uppercase tracking-wide">Campaign Suggestions</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">Click any to pre-fill your topic</p>
                </div>
                {suggestionsLoading && (
                  <svg className="animate-spin w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                )}
              </div>
              <div className="p-3 space-y-2 max-h-72 overflow-y-auto">
                {suggestionsLoading && suggestions.length === 0 && (
                  <p className="text-xs text-gray-400 py-4 text-center">Loading suggestions…</p>
                )}
                {!suggestionsLoading && suggestions.length === 0 && (
                  <p className="text-xs text-gray-400 py-4 text-center">No suggestions available yet.</p>
                )}
                {suggestions.map((s) => (
                  <button key={s.id} type="button" onClick={() => applySuggestion(s)}
                    className="w-full text-left rounded-xl border border-blue-100 bg-blue-50/60 hover:bg-blue-100/70 hover:border-blue-300 transition-all p-3 group">
                    <p className="text-xs font-semibold text-blue-900 line-clamp-2">{s.suggested_campaign_title}</p>
                    <p className="text-[11px] text-gray-500 mt-1 line-clamp-1">{s.topic}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-[10px] bg-white border border-blue-200 text-blue-700 px-2 py-0.5 rounded-full font-medium">{s.suggested_duration}w</span>
                      {s.opportunity_score !== null && <span className="text-[10px] text-gray-400">Score: {s.opportunity_score}</span>}
                      <span className="ml-auto text-[10px] text-blue-600 font-medium opacity-0 group-hover:opacity-100 transition-opacity">Use this →</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* AI Chat */}
            <div ref={chatRef} className="bg-white rounded-2xl border border-indigo-200 shadow-sm overflow-hidden scroll-mt-24">
              <button type="button" onClick={() => {
                  const next = !showChat;
                  setShowChat(next);
                  // On open, bring the chat window (with its option buttons) into view —
                  // mirrors the strategy-cards scroll pattern; 150ms lets the panel mount.
                  if (next) setTimeout(() => chatRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
                }}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-indigo-50/50 transition-colors">
                <div className="flex items-center gap-2">
                  <span className="text-base">💬</span>
                  <div className="text-left">
                    <p className="text-xs font-bold text-gray-800">AI Chat — Refine Your Topic</p>
                    <p className="text-[11px] text-gray-400">Ask AI to suggest or improve campaign ideas</p>
                  </div>
                </div>
                <span className="text-gray-400 text-sm">{showChat ? '▲' : '▼'}</span>
              </button>
              {showChat && (
                <div className="border-t border-gray-100 flex flex-col" style={{ height: '320px' }}>
                  <BoltCampaignChat
                    companyId={companyId}
                    // Full context shape — same one BOLT Text passes. The shared
                    // /api/bolt/campaign-chat endpoint uses these to (a) auto-fetch
                    // the company profile, (b) avoid suggesting formats / platforms
                    // the planner can't execute, and (c) build on previously
                    // accepted directions.
                    context={{
                      topic,
                      goals,
                      audience: audience.join(', '),
                      strategicFocus,
                      duration,
                      selectedPlatforms,
                      selectedFormats: contentFormats,
                      formatFrequency,
                      outcomeView,
                    }}
                    onApplySuggestion={applyChatSuggestion}
                    acceptedSuggestions={acceptedSuggestions}
                    onResetMemory={resetCampaignMemory}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Strategy Cards ── */}
        {(hasGenerated || generating) && (
          <div ref={cardsRef}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-gray-900">
                  {generating ? 'Generating your strategy options…' : `${cards.length} Strategy Options`}
                </h2>
                <p className="text-sm text-gray-400 mt-0.5">
                  {generating ? 'BOLT is crafting unique campaign angles for you.' : executing ? 'BOLT is building your campaign — hang tight.' : 'Select a strategy to launch BOLT in the chosen view.'}
                </p>
              </div>
              {hasGenerated && !generating && (
                <button type="button" onClick={handleGenerate}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-blue-300 text-blue-700 hover:bg-blue-50 transition-colors">
                  ↺ Regenerate
                </button>
              )}
            </div>

            {genError && (
              <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700 mb-4">
                <strong>Error:</strong> {genError}
              </div>
            )}

            {generating && (
              <DelayedStrategyGenerationProgress startedAt={generationStartedAt} />
            )}

            {generating && (
              <div className="grid grid-cols-3 gap-5">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="rounded-2xl border-2 border-gray-100 bg-white overflow-hidden animate-pulse">
                    <div className="h-32 bg-gray-100" />
                    <div className="p-5 space-y-3">
                      <div className="h-3 bg-gray-100 rounded w-3/4" />
                      <div className="h-2 bg-gray-100 rounded w-full" />
                      <div className="h-2 bg-gray-100 rounded w-5/6" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {execError && (
              <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700 mb-4">
                <strong>BOLT Error:</strong> {execError}
              </div>
            )}

            {!generating && cards.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {cards.map((card, i) => (
                  <StrategyCard
                    key={card.id}
                    card={card}
                    index={i}
                    selected={selectedIds.includes(card.id)}
                    boltProgress={selectedIds.includes(card.id) ? execProgress : null}
                    execStartedAt={execStartedAt}
                    anyExecuting={executing}
                    outcomeView={outcomeView}
                    onSelect={() => handleCardSelect(card.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

      </div>
    </div>

    {/* ── Confirmation modal ── */}
    {confirmingCard && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4 py-6">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-full overflow-hidden">
          {/* Header — sticky */}
          <div className="bg-gradient-to-r from-blue-500 to-indigo-600 px-6 py-4 flex-shrink-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg">🎬</span>
              <h2 className="text-white font-bold text-base">Confirm BOLT Launch</h2>
            </div>
            <p className="text-blue-100 text-xs">Review your inputs before we start. BOLT will build exactly this.</p>
          </div>

          {/* Scrollable body */}
          <div className="overflow-y-auto flex-1">

          {/* Strategy */}
          <div className="px-6 pt-5 pb-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Strategy</p>
            <p className="text-sm font-bold text-gray-900 leading-snug">{confirmingCard.title}</p>
            {confirmingCard.summary && <p className="text-xs text-gray-500 mt-1 leading-relaxed">{confirmingCard.summary}</p>}
          </div>

          {/* Execution plan */}
          <div className="px-6 py-3 space-y-3">
            {/* Content formats */}
            <div className="bg-blue-50 rounded-xl p-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-blue-600 mb-2">Content Plan</p>
              {contentFormats.length > 0 ? (
                <div className="space-y-1.5">
                  {contentFormats.map((fmt) => {
                    const fmtMeta = CONTENT_FORMATS.find((f) => f.value === fmt);
                    const freq = formatFrequency[fmt] ?? 3;
                    const total = freq * duration;
                    return (
                      <div key={fmt} className="flex items-center justify-between text-xs">
                        <span className="text-gray-700 font-medium">{fmtMeta?.icon} {fmtMeta?.label ?? fmt}</span>
                        <span className="text-blue-700 font-bold">{freq}×/wk × {duration}wk = <strong>{total} pieces</strong></span>
                      </div>
                    );
                  })}
                  <div className="border-t border-blue-200 pt-1.5 mt-1.5 flex justify-between text-xs font-bold">
                    <span className="text-gray-600">Total</span>
                    <span className="text-blue-800">
                      {contentFormats.reduce((s, f) => s + (formatFrequency[f] ?? 3), 0)}×/wk ×
                      {' '}{duration}wk = {contentFormats.reduce((s, f) => s + (formatFrequency[f] ?? 3) * duration, 0)} pieces
                    </span>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-gray-500">No format selected — AI will decide content types.</p>
              )}
            </div>

            {/* Summary grid */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">Goals</p>
                {goals.length > 0
                  ? goals.map((g) => <p key={g} className="text-gray-700 font-medium">🎯 {g}</p>)
                  : <p className="text-gray-400 italic">None selected</p>}
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">Audience</p>
                {audience.length > 0
                  ? <p className="text-gray-700 font-medium">👥 {audience.slice(0, 2).join(', ')}{audience.length > 2 ? ` +${audience.length - 2}` : ''}</p>
                  : <p className="text-gray-400 italic">Not specified</p>}
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">Duration</p>
                <p className="text-gray-700 font-medium">📆 {duration} week{duration !== 1 ? 's' : ''}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">Start Date</p>
                <p className="text-gray-700 font-medium">🗓️ {campaignStartDate || 'Today'}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">Output</p>
                <p className="text-gray-700 font-medium">
                  {outcomeView === 'daily_plan' ? '📅 Daily Plan' : '📋 Week Plan'}
                </p>
              </div>
              <div className="bg-blue-50 rounded-xl p-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-blue-400 mb-1.5">Mode</p>
                <p className="text-blue-700 font-medium">🎬 Creator Required</p>
              </div>
            </div>

            {(goals.length === 0 || audience.length === 0 || contentFormats.length === 0) && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 text-xs text-yellow-800">
                <strong>⚠️ Some inputs are not set:</strong>
                <ul className="mt-1 space-y-0.5 list-disc list-inside">
                  {goals.length === 0 && <li>No campaign goal selected — AI will choose a default</li>}
                  {audience.length === 0 && <li>No audience selected — AI will target a general audience</li>}
                  {contentFormats.length === 0 && <li>No content format selected — AI will decide the mix</li>}
                </ul>
              </div>
            )}
          </div>

          </div>{/* end scrollable body */}

          {/* Actions — pinned at bottom */}
          <div className="flex gap-3 px-6 pb-6 pt-2 flex-shrink-0 border-t border-gray-100">
            <button type="button" onClick={() => setConfirmingCard(null)}
              className="flex-1 py-2.5 text-sm font-semibold rounded-xl border-2 border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
              ← Go Back
            </button>
            <button type="button" onClick={handleConfirmLaunch}
              className="flex-1 py-2.5 text-sm font-bold rounded-xl bg-blue-500 hover:bg-blue-600 text-white transition-colors">
              Confirm &amp; Launch ⚡
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
