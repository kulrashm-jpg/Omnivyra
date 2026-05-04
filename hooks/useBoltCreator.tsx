/**
 * Command Center → BOLT (Creator) Strategy Builder
 *
 * Creator-dependent campaigns: video, reel, carousel, image, podcast, short, story.
 * View options: Weekly Plan and Daily Plan only (no auto-schedule — human creator produces content).
 */

import React, { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../components/CompanyContext';
import { apiFetch } from '@/lib/apiFetch';
import { BoltCampaignChat } from '../components/bolt/BoltCampaignChat';
import type { BoltStrategyCard } from '../pages/api/bolt/strategy-cards';
import type { BOLTProgress } from '../components/BOLTProgressModal';
import { readCampaignSourcePayload } from '../lib/content/launchCampaignFromContent';

type CreatorContentFormat = 'video' | 'reel' | 'carousel' | 'image' | 'podcast' | 'short' | 'story';
type ThemeSource = 'hybrid' | 'api' | 'ai';
type OutcomeView = 'week_plan' | 'daily_plan';
type SharingMode = 'shared' | 'unique' | 'ai';

const VIEW_OPTIONS: { value: OutcomeView; label: string; icon: string; hint: string }[] = [
  { value: 'week_plan',  label: 'Week Plan',  icon: '📋', hint: 'High-level weekly content blueprint' },
  { value: 'daily_plan', label: 'Daily Plan',  icon: '📅', hint: 'Break the plan into day-by-day actions' },
];

const BOLT_STATE_KEY = 'bolt-creator-strategy-state';

// Creator formats that appear on 2+ platforms in CONTENT_PLATFORM_AFFINITY — eligible for cross-platform sharing
const FORMATS_SUPPORTING_CROSS_PLATFORM = new Set<CreatorContentFormat>(['video', 'reel', 'short', 'story', 'carousel']);

const CONTENT_FORMATS: { value: CreatorContentFormat; label: string; icon: string; hint: string }[] = [
  { value: 'video',    label: 'Video',    icon: '🎬', hint: 'Long-form video content' },
  { value: 'reel',     label: 'Reel',     icon: '🎥', hint: 'Short vertical video (15–90s)' },
  { value: 'carousel', label: 'Carousel', icon: '🖼️', hint: 'Multi-slide visual story' },
  { value: 'image',    label: 'Image',    icon: '📸', hint: 'Static photo or graphic' },
  { value: 'podcast',  label: 'Podcast',  icon: '🎙️', hint: 'Audio episode or clip' },
  { value: 'short',    label: 'Short',    icon: '⚡', hint: 'YouTube / TikTok short' },
  { value: 'story',    label: 'Story',    icon: '📱', hint: '24hr ephemeral story format' },
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
];

function stageIndex(stage: string | undefined): number {
  if (!stage) return -1;
  const exact = BOLT_PIPELINE.findIndex((s) => s.stage === stage);
  if (exact !== -1) return exact;
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
  const [offerings, setOfferings] = useState<string[]>([]);
  const [contentFormats, setContentFormats] = useState<CreatorContentFormat[]>([]);
  const [formatFrequency, setFormatFrequency] = useState<Partial<Record<CreatorContentFormat, number>>>({});
  const [duration, setDuration] = useState(4);
  const [themeSource, setThemeSource] = useState<ThemeSource>('hybrid');
  const [sharingMode, setSharingMode] = useState<SharingMode>('ai');
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
  const [genError, setGenError] = useState<string | null>(null);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // View selector
  const [outcomeView, setOutcomeView] = useState<OutcomeView>('week_plan');

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
      if (s.contentFormats)    setContentFormats(s.contentFormats);
      if (s.formatFrequency)   setFormatFrequency(s.formatFrequency);
      if (s.duration)          setDuration(s.duration);
      if (s.themeSource)       setThemeSource(s.themeSource);
      if (s.sharingMode)       setSharingMode(s.sharingMode);
      if (s.cards)             setCards(s.cards);
      if (s.hasGenerated)      setHasGenerated(s.hasGenerated);
      if (s.outcomeView)       setOutcomeView(s.outcomeView);
      if (s.campaignStartDate) setCampaignStartDate(s.campaignStartDate);
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
        cards, hasGenerated, outcomeView, sharingMode, campaignStartDate,
      }));
    } catch {}
  }, [topic, goals, audience, strategicFocus, offerings, contentFormats, formatFrequency, duration, themeSource, cards, hasGenerated, outcomeView, sharingMode, campaignStartDate]);

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

  const _ef1 = !authChecked || isLoading;
  const _ef2 = !user?.userId;

  function toggleGoal(g: string) { setGoals((p) => p.includes(g) ? p.filter((x) => x !== g) : [...p, g]); }
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
      tentative_start: campaignStartDate || new Date().toISOString().split('T')[0],
      campaign_goal: combinedGoal,
      campaign_goals: goals,
      campaign_mode: 'creator',
      communication_style: ['visual'],
      content_formats: contentFormats,
      cross_platform_sharing: sharingMode === 'shared'
        ? { enabled: true }
        : sharingMode === 'unique'
          ? { enabled: false }
          : true, // 'ai' → let AI decide based on format compatibility
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

      const POLL_INTERVAL_MS = 2500;
      const DEADLINE = Date.now() + 6 * 60 * 1000; // 6 min — no AI content gen needed
      let completedCampaignId: string | null = null;
      let done = false;

      while (!done) {
        if (Date.now() > DEADLINE) throw new Error('The request took too long. Please try again.');
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        if (!mounted) return;

        const progRes = await apiFetch(`/api/bolt/progress?run_id=${encodeURIComponent(runId)}`);
        if (!progRes.ok) continue;

        const prog = await progRes.json().catch(() => ({})) as {
          stage?: string; progress_percentage?: number; status?: string;
          result_campaign_id?: string; error_message?: string;
          weeks_generated?: number; daily_slots_created?: number;
        };

        if (!mounted) return;

        setExecProgress({
          stage: prog.stage,
          status: prog.status,
          progress_percentage: prog.progress_percentage ?? 0,
          weeks_generated: prog.weeks_generated,
          daily_slots_created: prog.daily_slots_created,
        });

        if (prog.status === 'completed') { completedCampaignId = prog.result_campaign_id ?? null; done = true; }
        else if (prog.status === 'failed' || prog.status === 'aborted') {
          throw new Error(prog.error_message || 'BOLT execution failed');
        }
      }

      if (!mounted) return;
      try { sessionStorage.removeItem(BOLT_STATE_KEY); } catch {}
      setExecuting(false);
      setExecProgress(null);

      if (!completedCampaignId) { router.push('/command-center/campaigns'); return; }

      const qs = new URLSearchParams({ companyId: companyId ?? '' });
      if (outcomeView === 'daily_plan') {
        router.push(`/campaign-daily-plan/${completedCampaignId}?${qs.toString()}`);
      } else {
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
          contentFormat: contentFormats[0] ?? 'video',
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
    isAdmin,
    isAuthenticated,
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
