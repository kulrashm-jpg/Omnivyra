/** Part 1/2 of BoltCreatorView.tsx — verbatim split (barrel preserved; importers unchanged). */
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

export const VIEW_OPTIONS: { value: OutcomeView; label: string; icon: string; hint: string }[] = [
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
export const CONTENT_FORMATS: { value: CreatorContentFormat; label: string; icon: string; hint: string }[] = [
  { value: 'video',       label: 'Video',       icon: '🎬', hint: 'Long-form video content' },
  { value: 'reel',        label: 'Reel',        icon: '🎥', hint: 'Short vertical video (15–90s)' },
  { value: 'short',       label: 'Short',       icon: '⚡', hint: 'YouTube / TikTok short' },
  { value: 'carousel',    label: 'Carousel',    icon: '🖼️', hint: 'Multi-slide visual story' },
  { value: 'image',       label: 'Image',       icon: '📸', hint: 'Static photo or graphic' },
  { value: 'infographic', label: 'Infographic', icon: '📊', hint: 'Visual explainer asset' },
];

export const DURATION_OPTIONS = BOLT_DURATION_OPTIONS;

export const GOAL_OPTIONS = [
  'Brand Awareness', 'Lead Generation', 'Thought Leadership',
  'Product Launch', 'Community Growth', 'Engagement',
];

export const AUDIENCE_OPTIONS = CORE_AUDIENCE_LABELS;

export const STRATEGIC_FOCUS_OPTIONS = [
  'Content Marketing', 'SEO / Organic', 'Social Media', 'Email Marketing',
  'Brand Storytelling', 'Product Education', 'Community Building',
  'Data & Insights', 'Influencer Amplification', 'Competitive Positioning',
];

export const INTELLIGENCE_SOURCES: { value: ThemeSource; label: string; desc: string }[] = [
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
export function TagInput({ tags, onChange, placeholder }: { tags: string[]; onChange: (t: string[]) => void; placeholder?: string }) {
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
export function StrategyCard({
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
export function DelayedStrategyGenerationProgress({ startedAt }: { startedAt: number | null }) {
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
