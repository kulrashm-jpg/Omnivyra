/**
 * Command Center → BOLT (Text) Strategy Builder
 *
 * Layout:
 *   Top two-column: Left = form inputs | Right = suggestions + AI chat
 *   Below (full-width): Generated strategy cards in 3-column grid + confirm modal
 */

import React, { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../components/CompanyContext';
import { apiFetch } from '@/lib/apiFetch';
import { BoltCampaignChat } from '../components/bolt/BoltCampaignChat';
import type { BoltStrategyCard } from '../pages/api/bolt/strategy-cards';
import type { BOLTProgress } from '../components/BOLTProgressModal';
import { saveCampaignResume } from '../lib/campaignResumeStore';
import { readCampaignSourcePayload } from '../lib/content/launchCampaignFromContent';

type ContentFormat = 'post' | 'tweet' | 'short_story' | 'article' | 'poll';
type ThemeSource = 'hybrid' | 'api' | 'ai';
type OutcomeView = 'week_plan' | 'daily_plan' | 'schedule';
type SharingMode = 'shared' | 'unique' | 'ai';

const VIEW_OPTIONS: { value: OutcomeView; label: string; icon: string; hint: string }[] = [
  { value: 'week_plan',  label: 'Week Plan',  icon: '📋', hint: 'High-level weekly content blueprint' },
  { value: 'daily_plan', label: 'Daily Plan',  icon: '📅', hint: 'Break the plan into day-by-day actions' },
  { value: 'schedule',   label: 'Schedule',   icon: '🗓️', hint: 'Auto-schedule posts to your calendar' },
];

const BOLT_STATE_KEY = 'bolt-text-strategy-state';

const CONTENT_FORMATS: { value: ContentFormat; label: string; icon: string }[] = [
  { value: 'post',        label: 'Post',        icon: '📝' },
  { value: 'tweet',       label: 'Tweet',       icon: '💬' },
  { value: 'short_story', label: 'Short Story', icon: '📖' },
  { value: 'article',     label: 'Article',     icon: '🗞️' },
  { value: 'poll',        label: 'Poll Post',   icon: '📊' },
];

const DURATION_OPTIONS = [
  { value: 1, label: '1 Week' },
  { value: 2, label: '2 Weeks' },
  { value: 3, label: '3 Weeks' },
  { value: 4, label: '4 Weeks' },
];

const GOAL_OPTIONS = [
  'Brand Awareness', 'Lead Generation', 'Thought Leadership',
  'Product Launch', 'Community Growth', 'Engagement',
];

const AUDIENCE_OPTIONS = [
  'B2B Marketers', 'Founders / Entrepreneurs', 'Marketing Leaders',
  'Sales Teams', 'Product Managers', 'Developers', 'General Consumers',
];

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
  {
    gradient: 'from-indigo-600 to-violet-600',
    lightBg: 'bg-indigo-50',
    badge: 'bg-indigo-100 text-indigo-700',
    accent: 'text-indigo-600',
    ring: 'ring-indigo-500',
    border: 'border-indigo-200',
    weekDot: 'bg-indigo-400',
    btn: 'bg-indigo-600 hover:bg-indigo-700',
  },
  {
    gradient: 'from-violet-600 to-fuchsia-600',
    lightBg: 'bg-violet-50',
    badge: 'bg-violet-100 text-violet-700',
    accent: 'text-violet-600',
    ring: 'ring-violet-500',
    border: 'border-violet-200',
    weekDot: 'bg-violet-400',
    btn: 'bg-violet-600 hover:bg-violet-700',
  },
  {
    gradient: 'from-sky-600 to-cyan-500',
    lightBg: 'bg-sky-50',
    badge: 'bg-sky-100 text-sky-700',
    accent: 'text-sky-600',
    ring: 'ring-sky-500',
    border: 'border-sky-200',
    weekDot: 'bg-sky-400',
    btn: 'bg-sky-600 hover:bg-sky-700',
  },
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
      className="flex flex-wrap gap-2 min-h-[42px] w-full border border-gray-200 rounded-xl px-3 py-2 cursor-text focus-within:ring-2 focus-within:ring-amber-300"
      onClick={() => ref.current?.focus()}
    >
      {tags.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 text-xs bg-amber-100 text-amber-800 px-2.5 py-1 rounded-full font-medium">
          {t}
          <button type="button" onClick={() => onChange(tags.filter((x) => x !== t))} className="text-amber-500 hover:text-amber-800">×</button>
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

/* ─── BOLT stage pipeline (mirrors BOLTProgressModal stages) ─────────────── */
const BOLT_PIPELINE: { stage: string; label: string }[] = [
  { stage: 'source-recommendation', label: 'Preparing week plan' },
  { stage: 'ai/plan',               label: 'Creating week plan' },
  { stage: 'commit-plan',           label: 'Saving blueprint' },
  { stage: 'generate-weekly-structure', label: 'Creating daily plans' },
  { stage: 'schedule-structured-plan', label: 'Building activity workspace' },
  { stage: 'schedule-creating-content', label: 'Creating content' },
  { stage: 'schedule-repurposing-content', label: 'Repurposing content' },
  { stage: 'schedule-writing-posts', label: 'Scheduling posts' },
];

function stageIndex(stage: string | undefined): number {
  if (!stage) return -1;
  const exact = BOLT_PIPELINE.findIndex((s) => s.stage === stage);
  if (exact !== -1) return exact;
  // sub-stages like generate-weekly-structure-week-1
  if (stage.startsWith('generate-weekly-structure')) return 3;
  return -1;
}

function formatElapsed(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${min}m ${s}s` : `${min}m`;
}

type ContentJobProgress = {
  total: number; done: number; failed: number; active: number;
  posts_scheduled: number; estimated_seconds_remaining: number | null;
  is_complete: boolean;
};

/* ─── Inline BOLT progress tracker (shown inside the card) ──────────────── */
function CardBoltProgress({ progress, theme, startedAt, contentJobs }: {
  progress: BOLTProgress;
  theme: typeof CARD_THEMES[0];
  startedAt: number;
  contentJobs?: ContentJobProgress | null;
}) {
  const [elapsedMs, setElapsedMs] = useState(Date.now() - startedAt);

  useEffect(() => {
    const id = setInterval(() => setElapsedMs(Date.now() - startedAt), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  const isCompleted = progress.status === 'completed';
  const isFailed    = progress.status === 'failed';
  // When completed, treat currentIdx as beyond the last stage so every step shows ✓
  const currentIdx  = isCompleted ? BOLT_PIPELINE.length : stageIndex(progress.stage);
  const pct         = isCompleted ? 100 : Math.min(100, Math.max(0, progress.progress_percentage ?? 0));

  return (
    <div className="px-4 pb-4 pt-3 bg-white border-t border-gray-100">
      {/* Header row */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {isFailed ? (
            <span className="w-4 h-4 flex-shrink-0 text-red-500">✕</span>
          ) : isCompleted ? (
            <span className="w-4 h-4 flex-shrink-0 text-green-500 font-bold text-[13px]">✓</span>
          ) : (
            <svg className="animate-spin w-4 h-4 text-amber-500 flex-shrink-0" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
          )}
          <span className="text-xs font-bold text-gray-800">
            {isFailed ? 'BOLT failed' : isCompleted ? 'BOLT complete!' : '⚡ BOLT running'}
          </span>
        </div>
        <span className="text-[11px] text-gray-400">{formatElapsed(elapsedMs)}</span>
      </div>

      {/* Stage pipeline */}
      <div className="space-y-1.5 mb-3">
        {BOLT_PIPELINE.map((step, i) => {
          const isDone    = currentIdx > i;
          const isCurrent = !isCompleted && currentIdx === i;
          return (
            <div key={step.stage} className="flex items-center gap-2">
              {/* dot */}
              <div className={`flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold
                ${isDone    ? `${theme.weekDot} text-white`
                : isCurrent ? 'border-2 border-amber-400 bg-amber-50'
                : 'border border-gray-200 bg-gray-50'}`}>
                {isDone ? '✓' : isCurrent
                  ? <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                  : null}
              </div>
              {/* label */}
              <span className={`text-[11px] leading-tight
                ${isDone    ? 'text-gray-400 line-through'
                : isCurrent ? 'text-gray-900 font-semibold'
                : 'text-gray-300'}`}>
                {step.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Content job progress (queue-based, shown when workers are active) */}
      {contentJobs && contentJobs.total > 0 && (
        <div className="mb-3 bg-gray-50 rounded-lg p-2.5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-semibold text-gray-700">
              {contentJobs.is_complete
                ? `${contentJobs.done} of ${contentJobs.total} topics scheduled`
                : contentJobs.done === 0
                  ? `Scheduling ${contentJobs.total} topics…`
                  : `${contentJobs.done} of ${contentJobs.total} topics scheduled`}
            </span>
            {!contentJobs.is_complete && contentJobs.estimated_seconds_remaining != null && (
              <span className="text-[10px] text-gray-400">
                ~{contentJobs.estimated_seconds_remaining < 60
                  ? `${contentJobs.estimated_seconds_remaining}s`
                  : `${Math.ceil(contentJobs.estimated_seconds_remaining / 60)}m`} remaining
              </span>
            )}
          </div>
          {/* Topic progress bar */}
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${contentJobs.is_complete ? 'bg-green-500' : 'bg-amber-400'}`}
              style={{ width: `${contentJobs.total > 0 ? Math.round((contentJobs.done / contentJobs.total) * 100) : 0}%` }}
            />
          </div>
          {/* Stats row */}
          <div className="flex gap-3 mt-1.5">
            {contentJobs.posts_scheduled > 0 && (
              <span className="text-[10px] text-green-600 font-medium">{contentJobs.posts_scheduled} posts live</span>
            )}
            {contentJobs.active > 0 && (
              <span className="text-[10px] text-amber-600">{contentJobs.active} generating</span>
            )}
            {contentJobs.failed > 0 && (
              <span className="text-[10px] text-red-500">{contentJobs.failed} failed</span>
            )}
          </div>
        </div>
      )}

      {/* Progress bar */}
      {!isFailed && (
        <div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${isCompleted ? 'bg-green-500' : 'bg-amber-500'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex justify-between mt-1">
            {isCompleted && (!contentJobs || contentJobs.is_complete || contentJobs.total === 0) ? (
              <span className="text-[10px] text-green-600 font-medium">Heading to calendar…</span>
            ) : isCompleted && contentJobs && !contentJobs.is_complete ? (
              <span className="text-[10px] text-amber-600 font-medium">Workers scheduling remaining posts…</span>
            ) : (
              <span className="text-[10px] text-gray-400">{pct}%</span>
            )}
            {!isCompleted && progress.weeks_generated != null && progress.weeks_generated > 0 && (
              <span className="text-[10px] text-amber-600">
                {progress.weeks_generated}w generated
                {(progress.daily_slots_created ?? 0) > 0 ? ` · ${progress.daily_slots_created} slots` : ''}
              </span>
            )}
            {isCompleted && (progress.scheduled_posts_created ?? 0) > 0 && (!contentJobs || contentJobs.total === 0) && (
              <span className="text-[10px] text-green-600">
                {progress.scheduled_posts_created} posts scheduled
              </span>
            )}
          </div>
        </div>
      )}

      {isFailed && progress.error_message && (
        <p className="text-[11px] text-red-600 mt-1">{progress.error_message}</p>
      )}
    </div>
  );
}

/* ─── Redesigned Strategy Card ────────────────────────────────────────────── */
function StrategyCard({
  card,
  index,
  selected,
  boltProgress,
  execStartedAt,
  anyExecuting,
  contentJobProgress,
  onSelect,
}: {
  card: BoltStrategyCard;
  index: number;
  selected: boolean;
  boltProgress: BOLTProgress | null;
  execStartedAt: number;
  anyExecuting: boolean;
  contentJobProgress?: ContentJobProgress | null;
  onSelect: () => void;
}) {
  const theme = CARD_THEMES[index % CARD_THEMES.length];
  const isRunningThis = selected && boltProgress !== null;

  return (
    <div className={`relative flex flex-col rounded-2xl border-2 overflow-hidden transition-all duration-200 shadow-sm
      ${isRunningThis ? `${theme.ring} ring-2 border-transparent shadow-lg`
      : selected      ? `${theme.ring} ring-2 border-transparent`
      : anyExecuting  ? `${theme.border} opacity-50`
      : `${theme.border} hover:border-transparent hover:${theme.ring} hover:ring-2 hover:shadow-lg`}`}>

      {/* Coloured header band — heading + description + details */}
      <div className={`bg-gradient-to-r ${theme.gradient} px-5 pt-4 pb-5`}>
        {/* Row: badge + status */}
        <div className="flex items-center justify-between gap-3 mb-3">
          <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-white/20 text-white tracking-widest uppercase">
            Strategy {index + 1}
          </span>
          <div className="flex items-center gap-1.5">
            {isRunningThis && (
              <span className="flex items-center gap-1 text-xs font-bold bg-white/90 text-amber-700 px-2.5 py-1 rounded-full">
                ⚡ Running
              </span>
            )}
            {selected && !isRunningThis && (
              <span className="flex items-center gap-1 text-xs font-bold bg-white text-indigo-700 px-2.5 py-1 rounded-full">
                ✓ Selected
              </span>
            )}
          </div>
        </div>

        {/* Heading — short editorial title */}
        <h3 className="text-lg font-bold text-white leading-tight mb-1">{card.title}</h3>

        {/* Description — campaign arc overview */}
        {card.summary && (
          <p className="text-xs text-white/80 leading-relaxed mb-3">{card.summary}</p>
        )}

        {/* Details row — goal + audience + format */}
        <div className="flex flex-wrap gap-1.5 mt-1">
          {card.campaignGoals && card.campaignGoals.length > 0
            ? card.campaignGoals.map((cg) => (
                <span key={cg} className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/15 text-white/90">
                  🎯 {cg}
                </span>
              ))
            : card.campaignGoal && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/15 text-white/90">
                  🎯 {card.campaignGoal}
                </span>
              )
          }
          {card.targetAudience && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/15 text-white/90">
              👥 {card.targetAudience.split(',')[0].trim()}
            </span>
          )}
          {card.contentFormat && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/15 text-white/90">
              📄 {card.contentFormat.replace('_', ' ')}
            </span>
          )}
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/15 text-white/90">
            📆 {card.duration}w
          </span>
        </div>

        {/* Phase arc badges */}
        {card.phaseLabels.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2.5">
            {card.phaseLabels.map((label, i) => (
              <span key={i} className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/25 text-white">
                {label}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Weekly arc — always shown; collapses to status-only while running */}
      <div className={`flex-1 px-5 py-4 bg-white ${isRunningThis ? 'border-t border-gray-100' : ''}`}>
        <div className="flex items-center justify-between mb-2">
          <p className={`text-[10px] font-bold uppercase tracking-widest ${theme.accent}`}>Weekly Arc</p>
          {/* Live week counter while running */}
          {isRunningThis && boltProgress && (boltProgress as any).weeks_generated != null && (
            <span className="text-[10px] text-amber-600 font-semibold">
              {(boltProgress as any).weeks_generated}/{card.duration} weeks built
            </span>
          )}
        </div>
        <div className="space-y-2.5">
          {card.weekThemes.map((wt) => {
            // Derive per-week status from BOLT progress
            const weeksBuilt: number = isRunningThis && boltProgress
              ? ((boltProgress as any).weeks_generated ?? 0)
              : 0;
            const isCompleted = !isRunningThis && boltProgress === null ? false
              : isRunningThis ? wt.week <= weeksBuilt
              : false;
            const isCurrent = isRunningThis && wt.week === weeksBuilt + 1;
            const isPending = isRunningThis && wt.week > weeksBuilt + 1;

            return (
              <div key={wt.week} className={`flex items-start gap-3 rounded-lg px-2 py-1.5 transition-colors ${
                isCurrent ? 'bg-amber-50 border border-amber-200'
                  : isCompleted ? 'bg-emerald-50/60'
                  : ''
              }`}>
                {/* Week number dot — shows check when done, spinner when active */}
                <div className="flex-shrink-0 mt-0.5">
                  {isCompleted ? (
                    <span className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center text-[10px] font-bold text-white">✓</span>
                  ) : isCurrent ? (
                    <span className="w-5 h-5 rounded-full bg-amber-400 flex items-center justify-center">
                      <svg className="animate-spin w-3 h-3 text-white" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                      </svg>
                    </span>
                  ) : (
                    <span className={`w-5 h-5 rounded-full ${isPending ? 'bg-gray-200' : theme.weekDot} flex items-center justify-center text-[10px] font-bold ${isPending ? 'text-gray-400' : 'text-white'}`}>
                      {wt.week}
                    </span>
                  )}
                </div>

                <div className={`flex-1 min-w-0 ${isPending ? 'opacity-40' : ''}`}>
                  {/* Phase label + status badge + title */}
                  <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                    {wt.phase_label && (
                      <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${
                        isCompleted ? 'bg-emerald-100 text-emerald-700'
                          : isCurrent ? 'bg-amber-100 text-amber-700'
                          : theme.badge
                      }`}>
                        {wt.phase_label}
                      </span>
                    )}
                    {isCompleted && (
                      <span className="text-[9px] font-semibold text-emerald-600 px-1.5 py-0.5 rounded-full bg-emerald-100">
                        Plan ready
                      </span>
                    )}
                    {isCurrent && (
                      <span className="text-[9px] font-semibold text-amber-700 px-1.5 py-0.5 rounded-full bg-amber-100 animate-pulse">
                        Building…
                      </span>
                    )}
                    <span className={`text-xs font-semibold leading-snug ${isCompleted ? 'text-emerald-900' : 'text-gray-800'}`}>
                      {wt.title}
                    </span>
                  </div>

                  {/* Objective — hide for pending weeks to keep it compact */}
                  {!isPending && wt.objective && (
                    <p className="text-[10px] text-gray-500 leading-relaxed mt-0.5">{wt.objective}</p>
                  )}

                  {/* Content focus + CTA — only when not running or week is done */}
                  {(!isRunningThis || isCompleted) && (wt.content_focus || wt.cta_focus) && (
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                      {wt.content_focus && (
                        <span className="text-[9px] text-gray-400">
                          <span className="font-semibold text-gray-500">Content:</span> {wt.content_focus}
                        </span>
                      )}
                      {wt.cta_focus && (
                        <span className="text-[9px] text-gray-400">
                          <span className="font-semibold text-gray-500">CTA:</span> {wt.cta_focus}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Inline BOLT progress — shown only on the executing card */}
      {isRunningThis && boltProgress && (
        <CardBoltProgress
          progress={boltProgress}
          theme={theme}
          startedAt={execStartedAt}
          contentJobs={contentJobProgress}
        />
      )}

      {/* CTA — hidden while running */}
      {!isRunningThis && (
        <div className="px-5 pb-5 pt-3 bg-white">
          <button
            type="button"
            onClick={onSelect}
            disabled={anyExecuting}
            className={`w-full py-2.5 text-sm font-bold rounded-xl text-white transition-all ${theme.btn} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            Review &amp; Launch →
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── Main page ───────────────────────────────────────────────────────────── */

export function useBoltStrategy() {
  const router = useRouter();
  const { user, authChecked, isLoading, selectedCompanyId: companyId } = useCompanyContext();

  // Form inputs
  const [topic, setTopic] = useState('');
  const [goals, setGoals] = useState<string[]>([]);
  const [audience, setAudience] = useState<string[]>([]);
  const [strategicFocus, setStrategicFocus] = useState<string[]>([]);
  const [offerings, setOfferings] = useState<string[]>([]);
  const [contentFormats, setContentFormats] = useState<ContentFormat[]>([]);
  const [formatFrequency, setFormatFrequency] = useState<Partial<Record<ContentFormat, number>>>({});
  const [duration, setDuration] = useState(4);
  const [themeSource, setThemeSource] = useState<ThemeSource>('hybrid');

  // Right panel
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [showChat, setShowChat] = useState(false);

  // Generation
  const [cards, setCards] = useState<BoltStrategyCard[]>([]);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Content sharing mode
  const [sharingMode, setSharingMode] = useState<SharingMode>('ai');

  // Campaign-level platform selection — user picks which connected platforms
  // this campaign should target. Defaults to all BOLT-eligible platforms configured
  // at company admin level once loaded.
  const [availablePlatforms, setAvailablePlatforms] = useState<string[]>([]);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [platformsLoading, setPlatformsLoading] = useState(false);

  // Campaign start date (YYYY-MM-DD) — defaults to today
  const [campaignStartDate, setCampaignStartDate] = useState<string>(
    () => new Date().toISOString().split('T')[0]
  );

  // View selector
  const [outcomeView, setOutcomeView] = useState<OutcomeView>('week_plan');

  // BOLT execution
  const [executing, setExecuting] = useState(false);
  const [execProgress, setExecProgress] = useState<BOLTProgress | null>(null);
  const [execStartedAt, setExecStartedAt] = useState(0);
  const [execError, setExecError] = useState<string | null>(null);
  // Queue-based content job progress (schedule outcome with 10+ platforms)
  const [contentJobProgress, setContentJobProgress] = useState<{
    total: number; done: number; failed: number; active: number;
    posts_scheduled: number; estimated_seconds_remaining: number | null;
    is_complete: boolean;
  } | null>(null);

  // Confirmation step — set before launching BOLT
  const [confirmingCard, setConfirmingCard] = useState<BoltStrategyCard | null>(null);

  const cardsRef = useRef<HTMLDivElement>(null);
  const sourceContentToken = typeof router.query.sourceContentToken === 'string' ? router.query.sourceContentToken : null;
  const sourcePayload = readCampaignSourcePayload(sourceContentToken);

  // ── Restore state from sessionStorage on mount ──
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(BOLT_STATE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s.topic)          setTopic(s.topic);
      if (s.goals)          setGoals(s.goals);
      else if (s.goal)      setGoals([s.goal]); // backward compat with old single-goal state
      if (s.audience)       setAudience(s.audience);
      if (s.strategicFocus) setStrategicFocus(s.strategicFocus);
      if (s.offerings)      setOfferings(s.offerings);
      if (s.contentFormats)  setContentFormats(s.contentFormats);
      if (s.formatFrequency) setFormatFrequency(s.formatFrequency);
      if (s.duration)        setDuration(s.duration);
      if (s.themeSource)    setThemeSource(s.themeSource);
      if (s.cards)          setCards(s.cards);
      if (s.hasGenerated)   setHasGenerated(s.hasGenerated);
      if (s.outcomeView)        setOutcomeView(s.outcomeView);
      if (s.sharingMode)        setSharingMode(s.sharingMode);
      if (s.campaignStartDate)  setCampaignStartDate(s.campaignStartDate);
      if (Array.isArray(s.selectedPlatforms)) setSelectedPlatforms(s.selectedPlatforms);
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!sourcePayload) return;
    setTopic((prev) => prev.trim() ? prev : sourcePayload.suggestedTopic);
    if (sourcePayload.targetWordCount && sourcePayload.targetWordCount >= 1600) {
      setGoals((prev) => (prev.length > 0 ? prev : ['Thought Leadership']));
    }
  }, [sourcePayload]);

  // ── Persist state to sessionStorage on every change ──
  useEffect(() => {
    try {
      sessionStorage.setItem(BOLT_STATE_KEY, JSON.stringify({
        topic, goals, audience, strategicFocus, offerings,
        contentFormats, formatFrequency, duration, themeSource, cards, hasGenerated, outcomeView, sharingMode, campaignStartDate, selectedPlatforms,
      }));
    } catch {}
  }, [topic, goals, audience, strategicFocus, offerings, contentFormats, formatFrequency, duration, themeSource, cards, hasGenerated, outcomeView, sharingMode, campaignStartDate, selectedPlatforms]);

  useEffect(() => {
    if (authChecked && !user?.userId) router.replace('/login');
  }, [authChecked, user?.userId, router]);

  useEffect(() => {
    if (!companyId) return;
    setSuggestionsLoading(true);
    apiFetch('/api/planner/suggest-campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId }),
    })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data?.suggestions) setSuggestions(data.suggestions as Suggestion[]); })
      .catch(() => {})
      .finally(() => setSuggestionsLoading(false));
  }, [companyId]);

  // Load BOLT-eligible connected platforms for the campaign picker.
  // On first load, default selectedPlatforms = all available (nothing deselected).
  // Restored state from sessionStorage is preserved and filtered to the current
  // available set (in case platforms were disconnected since last session).
  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    setPlatformsLoading(true);
    apiFetch(`/api/bolt/available-platforms?companyId=${encodeURIComponent(companyId)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data?.platforms) ? (data.platforms as string[]) : [];
        setAvailablePlatforms(list);
        setSelectedPlatforms((prev) => {
          const filtered = prev.filter((p) => list.includes(p));
          return filtered.length > 0 ? filtered : list;
        });
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setPlatformsLoading(false); });
    return () => { cancelled = true; };
  }, [companyId]);

  function togglePlatform(p: string) {
    setSelectedPlatforms((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]);
  }

  const _ef1 = !authChecked || isLoading;
  const _ef2 = !user?.userId;

  function toggleGoal(g: string) {
    setGoals((prev) => prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]);
  }
  function toggleFocus(f: string) {
    setStrategicFocus((prev) => prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]);
  }
  function toggleAudience(a: string) {
    setAudience((prev) => prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]);
  }
  function toggleFormat(f: ContentFormat) {
    setContentFormats((prev) => {
      if (prev.includes(f)) {
        setFormatFrequency((fq) => { const next = { ...fq }; delete next[f]; return next; });
        return prev.filter((x) => x !== f);
      }
      if (prev.length >= 2) return prev;
      setFormatFrequency((fq) => ({ ...fq, [f]: fq[f] ?? 3 }));
      return [...prev, f];
    });
  }

  function setFreq(f: ContentFormat, delta: number) {
    setFormatFrequency((prev) => ({
      ...prev,
      [f]: Math.min(7, Math.max(1, (prev[f] ?? 3) + delta)),
    }));
  }

  function applySuggestion(s: Suggestion) {
    setTopic(s.suggested_campaign_title || s.topic);
    setDuration(s.suggested_duration || 4);
  }

  // Clicking a card opens the confirmation modal — execution happens only after user confirms
  function handleCardSelect(id: string) {
    if (executing) return;
    const card = cards.find((c) => c.id === id);
    if (!card) return;
    setConfirmingCard(card);
  }

  // Called only when user clicks "Confirm & Launch" in the confirmation modal
  async function handleConfirmLaunch() {
    const card = confirmingCard;
    if (!card || executing) return;
    setConfirmingCard(null);

    setSelectedIds([card.id]);
    setExecError(null);
    setExecuting(true);
    setExecStartedAt(Date.now());
    setExecProgress({ stage: 'source-recommendation', status: 'started', progress_percentage: 0 });

    // isMounted guard — prevents state updates / navigation after unmount
    let mounted = true;

    const combinedGoal = goals.length > 0 ? goals.join(' + ') : 'Brand Awareness';

    const sourceStrategicTheme = {
      schema_type: 'recommendation_strategic_card',
      schema_version: 1,
      topic: card.title,
      polished_title: card.title,
      summary: card.summary,
      strategic_context: {
        aspect: combinedGoal,
        facets: strategicFocus,
        audience_personas: audience,
        messaging_hooks: [],
        campaign_goals: goals,
      },
      intelligence: { campaign_angle: card.angle },
      blueprint: {
        duration_weeks: duration,
        progression_summary: card.phaseLabels.join(' → '),
      },
      formats: contentFormats,
    };

    // campaign_duration must be integer 1–4 (pipeline validates this strictly)
    const campaignDuration = Math.min(4, Math.max(1, Math.round(duration)));

    const totalFrequency = contentFormats.reduce((sum, f) => sum + (formatFrequency[f] ?? 3), 0);
    const executionConfig = {
      target_audience: audience.join(', ') || 'General audience',
      content_depth: 'standard',
      frequency_per_week: totalFrequency,
      format_frequency: Object.fromEntries(contentFormats.map((f) => [f, formatFrequency[f] ?? 3])),
      campaign_duration: campaignDuration,
      tentative_start: campaignStartDate || new Date().toISOString().split('T')[0],
      campaign_goal: combinedGoal,
      campaign_goals: goals,
      campaign_mode: 'fast',
      communication_style: ['professional'],
      content_formats: contentFormats,
      cross_platform_sharing: sharingMode === 'shared'
        ? { enabled: true }
        : sharingMode === 'unique'
          ? { enabled: false }
          : true, // 'ai' → let AI decide
      // User-picked platforms for this campaign (subset of company's connected platforms).
      // Omitted when empty so the pipeline falls back to all eligible platforms.
      ...(selectedPlatforms.length > 0 ? { selected_platforms: selectedPlatforms } : {}),
    };

    try {
      const execRes = await apiFetch('/api/bolt/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          sourceStrategicTheme,
          executionConfig,
          outcomeView,
          title: card.title,
          description: card.summary,
        }),
      });

      if (!execRes.ok) {
        const err = await execRes.json().catch(() => ({}));
        throw new Error((err as { error?: string })?.error || 'Failed to start BOLT execution');
      }

      const execData = await execRes.json();
      const runId = (execData as { run_id?: string })?.run_id;
      if (!runId) throw new Error('No run_id returned from BOLT');

      // ── Poll /api/bolt/progress until status is completed or failed ──────
      // Exit is driven by status, NOT by campaignId being non-null, so a null
      // result_campaign_id on completion doesn't cause an infinite loop.
      const POLL_INTERVAL_MS = 2500;
      // Schedule outcome triggers AI content generation for all activities — allow extra time
      const timeoutMinutes = outcomeView === 'schedule' ? 15 : 6;
      const DEADLINE = Date.now() + timeoutMinutes * 60 * 1000;
      let completedCampaignId: string | null = null;
      let done = false;

      while (!done) {
        if (Date.now() > DEADLINE) throw new Error('The request took too long. Please try again.');
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        if (!mounted) return; // component unmounted — stop silently

        const progRes = await apiFetch(`/api/bolt/progress?run_id=${encodeURIComponent(runId)}`);
        if (!progRes.ok) continue; // transient network error — keep polling

        const prog = await progRes.json().catch(() => ({})) as {
          stage?: string;
          progress_percentage?: number;
          status?: string;
          result_campaign_id?: string;
          error_message?: string;
          weeks_generated?: number;
          daily_slots_created?: number;
          scheduled_posts_created?: number;
        };

        if (!mounted) return;

        setExecProgress({
          stage: prog.stage,
          status: prog.status,
          progress_percentage: prog.progress_percentage ?? 0,
          weeks_generated: prog.weeks_generated,
          daily_slots_created: prog.daily_slots_created,
          scheduled_posts_created: prog.scheduled_posts_created,
        });

        if (prog.status === 'completed') {
          completedCampaignId = prog.result_campaign_id ?? null;
          done = true;
        } else if (prog.status === 'failed' || prog.status === 'aborted') {
          throw new Error(prog.error_message || 'BOLT execution failed');
        }
      }

      if (!mounted) return;

      try { sessionStorage.removeItem(BOLT_STATE_KEY); } catch {}

      // BOLT Text uses the inline block processor — content generation and
      // scheduled_posts creation happen synchronously within the pipeline.
      // No async worker polling needed. Brief pause so user sees completion state.
      if (outcomeView === 'schedule') {
        setExecProgress({ stage: 'schedule-writing-posts', status: 'completed', progress_percentage: 100 });
        if (mounted) await new Promise((r) => setTimeout(r, 2000));
        if (!mounted) return;
      }

      setExecuting(false);
      setExecProgress(null);

      if (!completedCampaignId) {
        // Pipeline completed but no campaign ID — shouldn't happen, fall back to campaigns list
        router.push('/command-center/campaigns');
        return;
      }

      const qs = new URLSearchParams({ companyId: companyId ?? '' });
      if (outcomeView === 'week_plan') {
        saveCampaignResume(completedCampaignId, 'campaign-details', { companyId: companyId ?? '', mode: 'fast' });
        router.push(`/campaign-details/${completedCampaignId}?mode=fast&${qs.toString()}`);
      } else if (outcomeView === 'daily_plan') {
        saveCampaignResume(completedCampaignId, 'campaign-daily-plan', { companyId: companyId ?? '' });
        router.push(`/campaign-daily-plan/${completedCampaignId}?${qs.toString()}`);
      } else if (outcomeView === 'schedule') {
        saveCampaignResume(completedCampaignId, 'campaign-calendar', { companyId: companyId ?? '' });
        router.push(`/dashboard?tab=calendar&${qs.toString()}`);
      } else {
        saveCampaignResume(completedCampaignId, 'campaign-details', { companyId: companyId ?? '', mode: 'fast' });
        router.push(`/campaign-details/${completedCampaignId}?mode=fast&${qs.toString()}`);
      }
    } catch (err) {
      if (!mounted) return;
      const msg = err instanceof Error ? err.message : 'Something went wrong';
      setExecProgress({ status: 'failed', progress_percentage: 0, error_message: msg });
      setExecuting(false);
      setTimeout(() => {
        if (!mounted) return;
        setExecProgress(null);
        setSelectedIds([]);
        setExecError(msg);
      }, 4000);
    }

    return () => { mounted = false; };
  }

  async function handleGenerate() {
    if (!topic.trim()) return;
    setGenerating(true);
    setGenError(null);
    setSelectedIds([]);
    try {
      const res = await fetch('/api/bolt/strategy-cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          topic: topic.trim(),
          goals,
          goal: goals.length > 0 ? goals.join(', ') : undefined,
          audience: audience.join(', '),
          strategicFocus,
          offerings,
          contentFormat: contentFormats[0] ?? 'post',
          duration,
          themeSource,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to generate strategy cards');
      setCards(data.cards ?? []);
      setHasGenerated(true);
      setTimeout(() => cardsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setGenerating(false);
    }
  }

  const canGenerate = topic.trim().length > 2;


  return {
    _ef1,
    _ef2,
    applySuggestion,
    audience,
    authChecked,
    campaignStartDate,
    canGenerate,
    cards,
    cardsRef,
    confirmingCard,
    contentFormats,
    contentJobProgress,
    duration,
    execError,
    execProgress,
    execStartedAt,
    executing,
    formatFrequency,
    genError,
    generating,
    goals,
    handleCardSelect,
    handleConfirmLaunch,
    handleGenerate,
    hasGenerated,
    isLoading,
    offerings,
    outcomeView,
    router,
    companyId,
    selectedIds,
    setAudience,
    setCampaignStartDate,
    setCards,
    setConfirmingCard,
    setContentFormats,
    setContentJobProgress,
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
    setSharingMode,
    setShowChat,
    setStrategicFocus,
    setSuggestions,
    setSuggestionsLoading,
    setThemeSource,
    setTopic,
    sharingMode,
    showChat,
    availablePlatforms,
    selectedPlatforms,
    setSelectedPlatforms,
    togglePlatform,
    platformsLoading,
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
  };
}
