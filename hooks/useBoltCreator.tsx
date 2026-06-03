/**
 * Command Center → BOLT (Creator) Strategy Builder
 *
 * Creator-dependent campaigns: video, reel, carousel, image, podcast, short, story.
 * View options: Weekly Plan and Daily Plan only (no auto-schedule — human creator produces content).
 */

import React, { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../components/CompanyContext';
import { fetchWithAuth } from '../components/community-ai/fetchWithAuth';
import { BoltCampaignChat } from '../components/bolt/BoltCampaignChat';
import type { BoltStrategyCard } from '../pages/api/bolt/strategy-cards';
import type { BOLTProgress } from '../components/BOLTProgressModal';
import { readCampaignSourcePayload } from '../lib/content/launchCampaignFromContent';
import { saveCampaignResume } from '../lib/campaignResumeStore';
import { useBoltPlatformPicker } from './useBoltPlatformPicker';
import { CREATOR_FORMAT_CAPABILITY, type CreatorContentFormat } from '../lib/shared/bolt/creatorFormatCapability';
import { platformSupportsCapability } from '../lib/shared/social/platformCapabilities';
import {
  getCreatorGovernance,
  isAttachmentRequiredFormat,
  isAutonomousRenderableFormat,
  isDailyPlanOnlyFormat,
  isGuidanceOnlyFormat,
  supportsAutonomousExecution,
} from '../lib/shared/creatorGovernanceRegistry';
type ThemeSource = 'hybrid' | 'api' | 'ai';
type OutcomeView = 'week_plan' | 'daily_plan' | 'schedule';

const VIEW_OPTIONS: { value: OutcomeView; label: string; icon: string; hint: string }[] = [
  { value: 'week_plan',  label: 'Week Plan',  icon: '📋', hint: 'High-level weekly content blueprint' },
  { value: 'daily_plan', label: 'Daily Plan',  icon: '📅', hint: 'Break the plan into day-by-day actions' },
  { value: 'schedule',   label: 'Schedule',   icon: 'Cal', hint: 'Generate and schedule autonomous creator assets when all selected formats support it' },
];

const BOLT_STATE_KEY = 'bolt-creator-strategy-state';

/**
 * RULE: the campaign start date can never be a previous day. A stale value
 * (restored draft / config carried over from an earlier session) is clamped
 * forward to today. The backend scheduler independently enforces a
 * >= now + 1h floor on every post; this keeps the UI and the submitted
 * payload consistent so the user never sees or sends a past start date.
 */
function clampStartDateToToday(value: string | null | undefined): string {
  const today = new Date().toISOString().split('T')[0];
  const v = String(value ?? '').slice(0, 10);
  return v && v >= today ? v : today;
}

function progSafeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

// Round-7 Phase 2: cross-platform-sharing eligibility moved to
// `lib/shared/bolt/crossPlatformSharing.ts` — see that module for the
// (non-capability) rationale.

// Canonical list of formats offered on the BOLT Creator builder. Kept in
// sync with the rendered list in components/BoltCreatorView.tsx. Used here
// to sanitize a restored sessionStorage selection.
const CONTENT_FORMATS: { value: CreatorContentFormat; label: string; icon: string; hint: string }[] = [
  { value: 'video',       label: 'Video',       icon: '🎬', hint: 'Long-form video content' },
  { value: 'reel',        label: 'Reel',        icon: '🎥', hint: 'Short vertical video (15–90s)' },
  { value: 'short',       label: 'Short',       icon: '⚡', hint: 'YouTube / TikTok short' },
  { value: 'carousel',    label: 'Carousel',    icon: '🖼️', hint: 'Multi-slide visual story' },
  { value: 'image',       label: 'Image',       icon: '📸', hint: 'Static photo or graphic' },
  { value: 'infographic', label: 'Infographic', icon: '📊', hint: 'Visual explainer asset' },
];
const ALLOWED_CREATOR_FORMATS = new Set<CreatorContentFormat>(CONTENT_FORMATS.map((f) => f.value));

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

/* ─── BOLT stage pipeline (creator — no schedule stages) ─────────────────── */
const BOLT_PIPELINE: { stage: string; label: string }[] = [
  { stage: 'source-recommendation',    label: 'Preparing week plan' },
  { stage: 'ai/plan',                  label: 'Creating week plan' },
  { stage: 'commit-plan',              label: 'Saving blueprint' },
  { stage: 'generate-weekly-structure', label: 'Creating daily activity plan' },
  { stage: 'creator-asset-generation', label: 'Generating creator assets' },
];

function stageIndex(stage: string | undefined): number {
  if (!stage) return -1;
  const exact = BOLT_PIPELINE.findIndex((s) => s.stage === stage);
  if (exact !== -1) return exact;
  if (stage.startsWith('generate-weekly-structure')) return 3;
  if (stage.startsWith('render-creator')) return 4;
  return -1;
}

function formatElapsed(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${min}m ${s}s` : `${min}m`;
}

/* ─── Inline BOLT progress tracker ──────────────────────────────────────── */
function CardBoltProgress({ progress, theme, startedAt }: {
  progress: BOLTProgress;
  theme: typeof CARD_THEMES[0];
  startedAt: number;
}) {
  const [elapsedMs, setElapsedMs] = useState(Date.now() - startedAt);
  useEffect(() => {
    const id = setInterval(() => setElapsedMs(Date.now() - startedAt), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  const currentIdx = stageIndex(progress.stage);
  const pct = Math.min(100, Math.max(0, progress.progress_percentage ?? 0));
  const isFailed = progress.status === 'failed';

  return (
    <div className="px-4 pb-4 pt-3 bg-white border-t border-gray-100">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {isFailed ? (
            <span className="w-4 h-4 flex-shrink-0 text-red-500">✕</span>
          ) : (
            <svg className="animate-spin w-4 h-4 text-blue-500 flex-shrink-0" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
          )}
          <span className="text-xs font-bold text-gray-800">{isFailed ? 'BOLT failed' : '⚡ BOLT running'}</span>
        </div>
        <span className="text-[11px] text-gray-400">{formatElapsed(elapsedMs)}</span>
      </div>
      <div className="space-y-1.5 mb-3">
        {BOLT_PIPELINE.map((step, i) => {
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
      {isFailed && progress.error_message && (
        <p className="text-[11px] text-red-600 mt-2 leading-snug">{progress.error_message}</p>
      )}
    </div>
  );
}

/* ─── Strategy Card ──────────────────────────────────────────────────────── */
function StrategyCard({
  card, index, selected, boltProgress, execStartedAt, anyExecuting, onSelect,
}: {
  card: BoltStrategyCard; index: number; selected: boolean;
  boltProgress: BOLTProgress | null; execStartedAt: number;
  anyExecuting: boolean; onSelect: () => void;
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
        <CardBoltProgress progress={boltProgress} theme={theme} startedAt={execStartedAt} />
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

export function useBoltCreator() {
  const router = useRouter();
  const { selectedCompanyId: companyId, isAdmin, isLoading, authChecked, isAuthenticated, user } = useCompanyContext();

  // Form inputs
  const [topic, setTopic] = useState('');
  const [goals, setGoals] = useState<string[]>([]);
  const [audience, setAudience] = useState<string[]>([]);
  const [strategicFocus, setStrategicFocus] = useState<string[]>([]);

  // ── AI Chat memory + suggestion-apply (parity with BOLT Text) ─────────
  // The shared BoltCampaignChat now supports a full Campaign Brief
  // suggestion shape (topic + description + goals[] + tone[] + audience)
  // and a persistent memory of accepted directions. BOLT Creator's form
  // currently exposes only topic / goals / audience as input fields, so
  // we apply ONLY those — description / tone returned by the AI are
  // stored in memory (so the prompt knows what the user accepted) but
  // not auto-injected anywhere visible. When/if Creator gets dedicated
  // Description + Tone fields, just wire setters in below.
  type AcceptedSuggestion = {
    topic: string;
    description?: string;
    goals?: string[];
    tone?: string[];
    audience?: string;
    acceptedAt: string;
  };
  const MAX_ACCEPTED_SUGGESTIONS = 8;
  const CAMPAIGN_MEMORY_VERSION = 1;
  const [acceptedSuggestions, setAcceptedSuggestions] = useState<AcceptedSuggestion[]>([]);
  const [memoryUpdatedAt, setMemoryUpdatedAt] = useState<string | null>(null);
  const [offerings, setOfferings] = useState<string[]>([]);
  const [contentFormats, setContentFormats] = useState<CreatorContentFormat[]>([]);
  const [formatFrequency, setFormatFrequency] = useState<Partial<Record<CreatorContentFormat, number>>>({});
  const [duration, setDuration] = useState(4);
  const [themeSource, setThemeSource] = useState<ThemeSource>('hybrid');
  // Round-6: capability-aware platform picker (creator capability).
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const platformPicker = useBoltPlatformPicker(companyId, 'bolt-creator');
  const togglePlatform = (p: string) =>
    setSelectedPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  useEffect(() => {
    if (platformPicker.loading || platformPicker.supported.length === 0) return;
    setSelectedPlatforms((prev) => {
      const filtered = prev.filter((p) => platformPicker.supported.includes(p));
      return filtered.length > 0 ? filtered : platformPicker.supported;
    });
  }, [platformPicker.loading, platformPicker.supported]);

  // ── Format-aware platform reconciliation ──────────────────────────────────
  // The per-format picker in BoltCreatorView visually hides platforms that
  // can't publish any of the currently-selected formats (e.g. YouTube when
  // only `image` is selected). The view's `selected={selectedPlatforms.filter(
  // ...)}` only filters the DISPLAY, leaving the underlying state with the
  // now-incompatible platforms still selected. That's the source of the
  // "instagram, youtube, facebook for an image campaign" → constraint-violation
  // we just hit: YouTube was hidden but never deselected, then sent to the
  // executor as a chosen platform.
  //
  // This effect prunes `selectedPlatforms` to the union of platforms that
  // can publish AT LEAST ONE of the currently-selected formats' canonical
  // capabilities. Runs whenever the user changes content formats.
  useEffect(() => {
    if (contentFormats.length === 0) return;
    const caps = Array.from(
      new Set(
        contentFormats
          .map((f) => CREATOR_FORMAT_CAPABILITY[f as CreatorContentFormat])
          .filter(Boolean),
      ),
    );
    if (caps.length === 0) return;
    setSelectedPlatforms((prev) => {
      const next = prev.filter((p) => caps.some((c) => platformSupportsCapability(p, c)));
      // Prevent state churn — only commit when something actually changed.
      return next.length === prev.length && next.every((p, i) => p === prev[i]) ? prev : next;
    });
  }, [contentFormats]);

  const [campaignStartDate, setCampaignStartDate] = useState<string>(
    () => new Date().toISOString().split('T')[0]
  );

  // Right panel
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [showChat, setShowChat] = useState(false);

  // Generation
  const [cards, setCards] = useState<BoltStrategyCard[]>([]);
  const [generating, setGenerating] = useState(false);
  const [generationStartedAt, setGenerationStartedAt] = useState<number | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // View selector
  const [outcomeView, setOutcomeView] = useState<OutcomeView>('week_plan');
  const hasAttachmentRequiredFormats = contentFormats.some((format) => isAttachmentRequiredFormat(format));
  const hasAutonomousRenderableFormats = contentFormats.some((format) => isAutonomousRenderableFormat(format));
  // Schedule is offered ONLY when EVERY selected format is autonomous-
  // renderable (Carousel/Image/Infographic). A single video-type format
  // (Video/Reel/Short) — even mixed with an autonomous one — caps the
  // campaign at Daily Plan: those rows need a human-uploaded media URL in
  // the Activity Workspace before they can be scheduled.
  const supportsScheduling =
    contentFormats.length > 0 &&
    contentFormats.every((format) => isAutonomousRenderableFormat(format));
  const supportsAutonomousCreatorExecution =
    contentFormats.length > 0 &&
    contentFormats.some((format) => supportsAutonomousExecution(format));
  // Telemetry / UI hint surface (no veto): `hasGuidanceOnlyFormats` is now
  // an alias for `hasAttachmentRequiredFormats`. The legacy `guidance_only`
  // flag is no longer true for the four attachment-required formats after
  // the per-row eligibility refactor, so the UI consumer (BoltCreatorView)
  // needs the new signal to render the mixed-mode helper copy correctly.
  // The legacy helpers stay imported for ad-hoc callers that haven't
  // migrated.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _legacyGuidanceFlag = contentFormats.some((format) => isGuidanceOnlyFormat(format) || isDailyPlanOnlyFormat(format));
  const hasGuidanceOnlyFormats = hasAttachmentRequiredFormats;

  useEffect(() => {
    if (!supportsScheduling && outcomeView === 'schedule') {
      setOutcomeView('daily_plan');
    }
  }, [supportsScheduling, outcomeView]);

  // BOLT execution
  const [executing, setExecuting] = useState(false);
  const [execProgress, setExecProgress] = useState<BOLTProgress | null>(null);
  const [execStartedAt, setExecStartedAt] = useState(0);
  const [execError, setExecError] = useState<string | null>(null);

  // Confirmation modal
  const [confirmingCard, setConfirmingCard] = useState<BoltStrategyCard | null>(null);

  const cardsRef = useRef<HTMLDivElement>(null);
  const sourceContentToken = typeof router.query.sourceContentToken === 'string' ? router.query.sourceContentToken : null;
  const sourcePayload = readCampaignSourcePayload(sourceContentToken);

  // Restore from sessionStorage
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(BOLT_STATE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s.topic)             setTopic(s.topic);
      if (s.goals)             setGoals(s.goals);
      if (s.audience)          setAudience(s.audience);
      if (s.strategicFocus)    setStrategicFocus(s.strategicFocus);
      if (s.offerings)         setOfferings(s.offerings);
      // Drop any format no longer offered on this builder (e.g. a stale
      // banner/pdf/slider selection saved before the lane refactor).
      if (Array.isArray(s.contentFormats)) {
        setContentFormats(s.contentFormats.filter((f: CreatorContentFormat) => ALLOWED_CREATOR_FORMATS.has(f)));
      }
      if (s.formatFrequency)   setFormatFrequency(s.formatFrequency);
      if (s.duration)          setDuration(s.duration);
      if (s.themeSource)       setThemeSource(s.themeSource);
      if (s.cards)             setCards(s.cards);
      if (s.hasGenerated)      setHasGenerated(s.hasGenerated);
      if (s.outcomeView)       setOutcomeView(s.outcomeView);
      if (s.campaignStartDate) setCampaignStartDate(clampStartDateToToday(s.campaignStartDate));
      if (s.selectedPlatforms) setSelectedPlatforms(s.selectedPlatforms);

      // Campaign Memory restore — same shape BOLT Text uses. Fails soft
      // if the stored payload pre-dates this addition (old sessions just
      // start with an empty memory).
      if (
        s.campaignMemory &&
        typeof s.campaignMemory === 'object' &&
        Array.isArray(s.campaignMemory.acceptedSuggestions)
      ) {
        const cleaned: AcceptedSuggestion[] = s.campaignMemory.acceptedSuggestions
          .filter((entry: unknown): entry is AcceptedSuggestion =>
            !!entry && typeof entry === 'object' && typeof (entry as { topic?: unknown }).topic === 'string'
          )
          .slice(0, MAX_ACCEPTED_SUGGESTIONS);
        setAcceptedSuggestions(cleaned);
        if (typeof s.campaignMemory.updatedAt === 'string') {
          setMemoryUpdatedAt(s.campaignMemory.updatedAt);
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (!sourcePayload) return;
    setTopic((prev) => prev.trim() ? prev : sourcePayload.suggestedTopic);
    setGoals((prev) => (prev.length > 0 ? prev : ['Brand Awareness']));
  }, [sourcePayload]);

  // Persist to sessionStorage
  useEffect(() => {
    try {
      sessionStorage.setItem(BOLT_STATE_KEY, JSON.stringify({
        topic, goals, audience, strategicFocus, offerings,
        contentFormats, formatFrequency, duration, themeSource,
        cards, hasGenerated, outcomeView, campaignStartDate, selectedPlatforms,
        // Same memory shape BOLT Text persists — versioned so future
        // shape migrations can branch on it.
        campaignMemory: {
          version: CAMPAIGN_MEMORY_VERSION,
          updatedAt: memoryUpdatedAt,
          acceptedSuggestions,
        },
      }));
    } catch {}
  }, [topic, goals, audience, strategicFocus, offerings, contentFormats, formatFrequency, duration, themeSource, cards, hasGenerated, outcomeView, campaignStartDate, selectedPlatforms, acceptedSuggestions, memoryUpdatedAt]);

  useEffect(() => {
    if (authChecked && !user?.userId) router.replace('/login');
  }, [authChecked, user?.userId, router]);

  useEffect(() => {
    if (!companyId) return;
    setSuggestionsLoading(true);
    fetchWithAuth('/api/planner/suggest-campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId }),
    })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data?.suggestions) setSuggestions(data.suggestions as Suggestion[]); })
      .catch(() => {})
      .finally(() => setSuggestionsLoading(false));
  }, [companyId]);

  const _ef1 = !authChecked || isLoading;
  const _ef2 = !user?.userId;

  function toggleGoal(g: string) { setGoals((p) => p.includes(g) ? p.filter((x) => x !== g) : [...p, g]); }

  /**
   * Apply an AI Chat suggestion (parity with BOLT Text). The shared
   * BoltCampaignChat passes a full Campaign Brief shape — we apply the
   * fields Creator's form actually exposes and ALWAYS record the
   * acceptance in memory so subsequent chat turns build on / diversify
   * accepted directions instead of restarting ideation.
   *
   * Description and tone are not auto-applied today (Creator's form
   * doesn't surface them). They're still stored in memory so the AI
   * sees what the user accepted and respects the direction.
   */
  function applyChatSuggestion(suggestion: {
    topic: string;
    description?: string;
    goals?: string[];
    tone?: string[];
    audience?: string;
  }) {
    if (suggestion.topic) setTopic(suggestion.topic);
    if (Array.isArray(suggestion.goals) && suggestion.goals.length > 0) setGoals(suggestion.goals);
    // Creator's audience is multi-select chips, while the AI returns a
    // free-form string. Split on commas / semicolons so a comma-separated
    // suggestion ("Series-A SaaS founders, HR leaders") populates two chips.
    if (typeof suggestion.audience === 'string' && suggestion.audience.trim()) {
      const tokens = suggestion.audience
        .split(/[,;]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (tokens.length > 0) setAudience(tokens);
    }

    setAcceptedSuggestions((prev) => {
      const entry: AcceptedSuggestion = {
        topic: suggestion.topic,
        description: suggestion.description?.trim() || undefined,
        goals: Array.isArray(suggestion.goals) && suggestion.goals.length > 0 ? suggestion.goals : undefined,
        tone: Array.isArray(suggestion.tone) && suggestion.tone.length > 0 ? suggestion.tone : undefined,
        audience: suggestion.audience?.trim() || undefined,
        acceptedAt: new Date().toISOString(),
      };
      // De-dupe on topic — repeated acceptance of the same suggestion
      // doesn't fill memory with identical entries. Newest wins.
      const filtered = prev.filter((p) => p.topic !== entry.topic);
      return [...filtered, entry].slice(-MAX_ACCEPTED_SUGGESTIONS);
    });
    setMemoryUpdatedAt(new Date().toISOString());
  }

  /** "Reset AI Direction" — clears conversational memory without touching
   *  the user's form fields. The chat clears its own local history. */
  function resetCampaignMemory() {
    setAcceptedSuggestions([]);
    setMemoryUpdatedAt(new Date().toISOString());
  }
  function toggleFocus(f: string) { setStrategicFocus((p) => p.includes(f) ? p.filter((x) => x !== f) : [...p, f]); }
  function toggleAudience(a: string) { setAudience((p) => p.includes(a) ? p.filter((x) => x !== a) : [...p, a]); }

  function toggleFormat(f: CreatorContentFormat) {
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

  function setFreq(f: CreatorContentFormat, delta: number) {
    setFormatFrequency((prev) => ({ ...prev, [f]: Math.min(7, Math.max(1, (prev[f] ?? 3) + delta)) }));
  }

  function applySuggestion(s: Suggestion) {
    setTopic(s.suggested_campaign_title || s.topic);
    setDuration(s.suggested_duration || 4);
  }

  function handleCardSelect(id: string) {
    if (executing) return;
    const card = cards.find((c) => c.id === id);
    if (!card) return;
    setConfirmingCard(card);
  }

  async function handleConfirmLaunch() {
    const card = confirmingCard;
    if (!card || executing) return;
    if (outcomeView === 'schedule' && !supportsScheduling) {
      setExecError('Schedule is disabled because one or more selected creator formats are daily-plan-only or unsupported for autonomous scheduling.');
      setConfirmingCard(null);
      return;
    }
    setConfirmingCard(null);

    setSelectedIds([card.id]);
    setExecError(null);
    setExecuting(true);
    setExecStartedAt(Date.now());
    setExecProgress({ stage: 'source-recommendation', status: 'started', progress_percentage: 0 });

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

    const campaignDuration = Math.min(4, Math.max(1, Math.round(duration)));
    const totalFrequency = contentFormats.reduce((sum, f) => sum + (formatFrequency[f] ?? 3), 0);

    const executionConfig = {
      target_audience: audience.join(', ') || 'General audience',
      content_depth: 'standard',
      frequency_per_week: totalFrequency,
      format_frequency: Object.fromEntries(contentFormats.map((f) => [f, formatFrequency[f] ?? 3])),
      campaign_duration: campaignDuration,
      tentative_start: clampStartDateToToday(campaignStartDate),
      campaign_goal: combinedGoal,
      campaign_goals: goals,
      campaign_mode: 'creator',
      communication_style: ['visual'],
      content_formats: contentFormats,
      selected_platforms: selectedPlatforms,
      creator_governance: Object.fromEntries(contentFormats.map((format) => [format, getCreatorGovernance(format)])),
      // Content Sharing UI removed — default to AI-decide (the prior
      // default). `true` = let AI decide cross-platform sharing based on
      // per-format compatibility. Downstream consumers already handle this.
      cross_platform_sharing: true,
    };

    try {
      const execRes = await fetchWithAuth('/api/bolt/execute', {
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

      const POLL_INTERVAL_MS = 2500;
      const DEADLINE = Date.now() + (outcomeView === 'schedule' ? 15 : 6) * 60 * 1000;
      let completedCampaignId: string | null = null;
      let done = false;
      let lastProgress: BOLTProgress | null = null;

      while (!done) {
        if (Date.now() > DEADLINE) throw new Error('The request took too long. Please try again.');
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        if (!mounted) return;

        const progRes = await fetchWithAuth(`/api/bolt/progress?run_id=${encodeURIComponent(runId)}`);
        if (!progRes.ok) continue;

        const prog = await progRes.json().catch(() => ({})) as {
          stage?: string; progress_percentage?: number; status?: string;
          result_campaign_id?: string; error_message?: string;
          weeks_generated?: number; daily_slots_created?: number;
        };

        if (!mounted) return;

        const nextProgress: BOLTProgress = {
          stage: prog.stage,
          status: prog.status,
          progress_percentage: prog.progress_percentage ?? 0,
          weeks_generated: prog.weeks_generated,
          daily_slots_created: prog.daily_slots_created,
        };
        lastProgress = nextProgress;
        setExecProgress(nextProgress);

        if (prog.status === 'completed') { completedCampaignId = prog.result_campaign_id ?? null; done = true; }
        else if (prog.status === 'failed' || prog.status === 'aborted') {
          throw new Error(prog.error_message || 'BOLT execution failed');
        }
      }

      if (!mounted) return;
      try { sessionStorage.removeItem(BOLT_STATE_KEY); } catch {}

      const completionStage =
        outcomeView === 'schedule'
          ? 'schedule'
          : outcomeView === 'daily_plan'
            ? 'creator-asset-generation'
            : 'generate-weekly-structure';
      setExecProgress({
        stage: completionStage,
        status: 'completed',
        progress_percentage: 100,
        weeks_generated: progSafeNumber(lastProgress?.weeks_generated),
        daily_slots_created: progSafeNumber(lastProgress?.daily_slots_created),
      });
      await new Promise((r) => setTimeout(r, 1400));
      if (!mounted) return;

      setExecuting(false);
      setExecProgress(null);

      if (!completedCampaignId) { router.push('/command-center/campaigns'); return; }

      const qs = new URLSearchParams({ companyId: companyId ?? '' });
      if (outcomeView === 'daily_plan') {
        saveCampaignResume(completedCampaignId, 'campaign-daily-plan', { companyId: companyId ?? '' });
        router.push(`/campaign-daily-plan/${completedCampaignId}?${qs.toString()}`);
      } else if (outcomeView === 'schedule') {
        // Land on the dashboard's Calendar tab (the global calendar), not the
        // per-campaign "attached" /campaign-calendar/[id] view. The dashboard
        // deep-links to its calendar via ?tab=calendar (useDashboardState).
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
    setGenerationStartedAt(Date.now());
    setGenError(null);
    // Starting fresh — clear any stale BOLT launch/run error from a prior
    // attempt so regenerating/generating creator cards doesn't surface an
    // error banner for a run that's no longer relevant.
    setExecError(null);
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
          contentFormat: contentFormats[0] ?? 'video',
          contentFormats,
          formatFrequency: Object.fromEntries(contentFormats.map((f) => [f, formatFrequency[f] ?? 3])),
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
      setGenerationStartedAt(null);
    }
  }

  const canGenerate = topic.trim().length > 2;


  return {
    _ef1,
    _ef2,
    acceptedSuggestions,
    memoryUpdatedAt,
    resetCampaignMemory,
    applyChatSuggestion,
    applySuggestion,
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
    availablePlatforms: platformPicker.supported,
    platformHidden: platformPicker.hidden,
    platformsLoading: platformPicker.loading,
    platformBlocked: platformPicker.blocked,
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
  };
}
