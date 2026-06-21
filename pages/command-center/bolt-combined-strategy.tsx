/**
 * Command Center → BOLT (Combined) Strategy Builder
 *
 * Combines text-based formats (post, article, newsletter, short_story, white_paper)
 * and creator-dependent formats (video, reel, carousel, image, podcast, short, story)
 * in a single campaign. AI plans across both, pipeline runs in combined mode.
 *
 * View options: Week Plan, Daily Plan, Schedule (same as BOLT Text).
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import { getSelectableAudienceLabels } from '../../lib/shared/audience/audienceRegistry';
import { COMBINED_DURATION_OPTIONS, MAX_CAMPAIGN_DURATION_WEEKS } from '../../lib/shared/campaignDuration';
import { getSupportedPlatformsForFormat } from '../../lib/shared/bolt/contentPlatformAssignment';
import { buildAssignmentExplanation, buildAssignmentDecisions } from '../../lib/shared/intelligence/assignmentExplanation';
import { AssignmentSummary } from '../../components/bolt/AssignmentSummary';
import { ProgressCard } from '../../components/bolt/ProgressCard';
import { useCompanyContext } from '../../components/CompanyContext';
import { fetchWithAuth } from '../../components/community-ai/fetchWithAuth';
import { BoltCampaignChat } from '../../components/bolt/BoltCampaignChat';
import type { BoltStrategyCard } from '../api/bolt/strategy-cards';
import type { BOLTProgress } from '../../components/BOLTProgressModal';
import BoltPlatformPicker from '../../components/bolt/BoltPlatformPicker';
import { useBoltPlatformPicker } from '../../hooks/useBoltPlatformPicker';
import PageLoader from '../../components/PageLoader';

// BOLT Text set. Newsletter / white paper (true long-form) are excluded — they
// route through the long-form engine, not BOLT.
type TextFormat    = 'post' | 'tweet' | 'article' | 'poll' | 'short_story';
// BOLT Creator set (bolt_creator_eligible). 'story' is standalone-only (not a
// first-class BOLT Creator format) and is excluded here.
type CreatorFormat = 'video' | 'reel' | 'carousel' | 'image' | 'podcast' | 'short' | 'infographic';
type AnyFormat     = TextFormat | CreatorFormat;
type ThemeSource   = 'hybrid' | 'api' | 'ai';
type OutcomeView   = 'week_plan' | 'daily_plan' | 'schedule';
type SharingMode   = 'shared' | 'unique' | 'ai';

const BOLT_STATE_KEY = 'bolt-combined-strategy-state';

const VIEW_OPTIONS: { value: OutcomeView; label: string; icon: string; hint: string }[] = [
  { value: 'week_plan',  label: 'Week Plan',  icon: '📋', hint: 'High-level weekly content blueprint' },
  { value: 'daily_plan', label: 'Daily Plan',  icon: '📅', hint: 'Break the plan into day-by-day actions' },
  { value: 'schedule',   label: 'Schedule',   icon: '🗓️', hint: 'Auto-schedule text posts to your calendar' },
];

const TEXT_FORMATS: { value: TextFormat; label: string; icon: string; hint: string }[] = [
  { value: 'post',        label: 'Post',        icon: '✍️', hint: 'Short-form social post' },
  { value: 'tweet',       label: 'Tweet',       icon: '🐦', hint: 'X / Twitter post' },
  { value: 'article',     label: 'Article',     icon: '📄', hint: 'Thought leadership piece' },
  { value: 'poll',        label: 'Poll',        icon: '📊', hint: 'Engagement poll' },
  { value: 'short_story', label: 'Short Story', icon: '📖', hint: 'Narrative-driven content' },
];

const CREATOR_FORMATS: { value: CreatorFormat; label: string; icon: string; hint: string }[] = [
  { value: 'video',    label: 'Video',    icon: '🎬', hint: 'Long-form video content' },
  { value: 'reel',     label: 'Reel',     icon: '🎥', hint: 'Short vertical video (15–90s)' },
  { value: 'carousel', label: 'Carousel', icon: '🖼️', hint: 'Multi-slide visual story' },
  { value: 'image',    label: 'Image',    icon: '📸', hint: 'Static photo or graphic' },
  { value: 'podcast',     label: 'Podcast',     icon: '🎙️', hint: 'Audio episode or clip' },
  { value: 'short',       label: 'Short',       icon: '⚡', hint: 'YouTube / TikTok short' },
  { value: 'infographic', label: 'Infographic', icon: '📊', hint: 'Data-driven visual graphic' },
];

// Phase 6C-4A: Intelligent Mix is the extended-planning surface → full 1–12 range.
const DURATION_OPTIONS = COMBINED_DURATION_OPTIONS;

// Tone vocabulary — kept in sync with the AI Architect's suggested_tone list
// (campaign-chat.ts) so applied suggestions map onto these chips.
const TONE_OPTIONS = [
  'Professional', 'Conversational', 'Educational', 'Analytical',
  'Bold', 'Inspirational', 'Authoritative', 'Friendly',
];

const GOAL_OPTIONS = [
  'Brand Awareness', 'Lead Generation', 'Thought Leadership',
  'Product Launch', 'Community Growth', 'Engagement',
];

// Intelligent Mix (combined) is the advanced audience-planning surface — it
// exposes CORE + PROFESSIONAL + INDUSTRY groups from the canonical authority.
// Legacy core stays first (display order stable); new groups append.
const AUDIENCE_OPTIONS = getSelectableAudienceLabels({ includeGroups: ['professional', 'industry'] });

const STRATEGIC_FOCUS_OPTIONS = [
  'Content Marketing', 'SEO / Organic', 'Social Media', 'Email Marketing',
  'Brand Storytelling', 'Product Education', 'Community Building',
  'Data & Insights', 'Influencer Amplification', 'Competitive Positioning',
];

const INTELLIGENCE_SOURCES: { value: ThemeSource; label: string; desc: string }[] = [
  { value: 'hybrid', label: 'Hybrid Intelligence', desc: 'Trend signals + AI reasoning' },
  { value: 'api',    label: 'API Intelligence',     desc: 'Platform signals & market data' },
  { value: 'ai',     label: 'AI Strategic Engine',  desc: 'Pure AI strategic planning' },
];

const CARD_THEMES = [
  { gradient: 'from-violet-600 to-purple-600',  lightBg: 'bg-violet-50', badge: 'bg-violet-100 text-violet-700', accent: 'text-violet-600', ring: 'ring-violet-500', border: 'border-violet-200', weekDot: 'bg-violet-400', btn: 'bg-violet-600 hover:bg-violet-700' },
  { gradient: 'from-purple-600 to-fuchsia-600',  lightBg: 'bg-purple-50', badge: 'bg-purple-100 text-purple-700', accent: 'text-purple-600', ring: 'ring-purple-500', border: 'border-purple-200', weekDot: 'bg-purple-400', btn: 'bg-purple-600 hover:bg-purple-700' },
  { gradient: 'from-fuchsia-600 to-pink-600',    lightBg: 'bg-fuchsia-50', badge: 'bg-fuchsia-100 text-fuchsia-700', accent: 'text-fuchsia-600', ring: 'ring-fuchsia-500', border: 'border-fuchsia-200', weekDot: 'bg-fuchsia-400', btn: 'bg-fuchsia-600 hover:bg-fuchsia-700' },
];

type Suggestion = { id: string; topic: string; suggested_campaign_title: string; opportunity_score: number | null; suggested_duration: number };

/* ─── Tag input ─────────────────────────────────────────────────────────────── */
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
      className="flex flex-wrap gap-2 min-h-[42px] w-full border border-gray-200 rounded-xl px-3 py-2 cursor-text focus-within:ring-2 focus-within:ring-violet-300"
      onClick={() => ref.current?.focus()}
    >
      {tags.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 text-xs bg-violet-100 text-violet-800 px-2.5 py-1 rounded-full font-medium">
          {t}
          <button type="button" onClick={() => onChange(tags.filter((x) => x !== t))} className="text-violet-500 hover:text-violet-800">×</button>
        </span>
      ))}
      <input
        ref={ref} value={input} onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } if (e.key === 'Backspace' && !input && tags.length) onChange(tags.slice(0, -1)); }}
        onBlur={add}
        placeholder={tags.length === 0 ? placeholder : ''}
        className="flex-1 min-w-[120px] text-sm outline-none bg-transparent placeholder:text-gray-300"
      />
    </div>
  );
}

/* ─── BOLT stage pipeline ───────────────────────────────────────────────────── */
const BOLT_PIPELINE: { stage: string; label: string }[] = [
  { stage: 'source-recommendation',     label: 'Analysing signals' },
  { stage: 'ai/plan',                   label: 'Creating campaign plan' },
  { stage: 'commit-plan',               label: 'Saving blueprint' },
  { stage: 'generate-weekly-structure', label: 'Building daily activities' },
  { stage: 'schedule-structured-plan',  label: 'Scheduling content' },
];

/* ─── Inline BOLT progress — shared ProgressCard renderer (6H-B) ───────────── */
function CardBoltProgress({ progress, startedAt }: { progress: BOLTProgress; theme: typeof CARD_THEMES[0]; startedAt: number }) {
  return (
    <ProgressCard progress={progress} pipeline={BOLT_PIPELINE} startedAt={startedAt} dotClass="bg-violet-500" />
  );
}

/* ─── Strategy Card ─────────────────────────────────────────────────────────── */
function StrategyCard({ card, index, selected, boltProgress, execStartedAt, anyExecuting, onSelect }: {
  card: BoltStrategyCard; index: number; selected: boolean;
  boltProgress: BOLTProgress | null; execStartedAt: number;
  anyExecuting: boolean; onSelect: () => void;
}) {
  const theme = CARD_THEMES[index % CARD_THEMES.length];
  const isRunningThis = selected && boltProgress !== null;

  return (
    <div className={`relative flex flex-col rounded-2xl border-2 overflow-hidden transition-all duration-200 shadow-sm
      ${isRunningThis ? `${theme.ring} ring-2 border-transparent shadow-lg` : selected ? `${theme.ring} ring-2 border-transparent` : anyExecuting ? `${theme.border} opacity-50` : `${theme.border} hover:border-transparent hover:${theme.ring} hover:ring-2 hover:shadow-lg`}`}>

      <div className={`bg-gradient-to-r ${theme.gradient} px-5 pt-4 pb-5`}>
        <div className="flex items-center justify-between gap-3 mb-3">
          <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-white/20 text-white tracking-widest uppercase">Strategy {index + 1}</span>
          <div className="flex items-center gap-1.5">
            {isRunningThis && <span className="flex items-center gap-1 text-xs font-bold bg-white/90 text-violet-700 px-2.5 py-1 rounded-full">⚡ Running</span>}
            {selected && !isRunningThis && <span className="flex items-center gap-1 text-xs font-bold bg-white text-violet-700 px-2.5 py-1 rounded-full">✓ Selected</span>}
          </div>
        </div>
        <h3 className="text-lg font-bold text-white leading-tight mb-1" title={card.title}>{card.title}</h3>
        {card.summary && <p className="text-xs text-white/80 leading-relaxed mb-3">{card.summary}</p>}
        <div className="flex flex-wrap gap-1.5 mt-1">
          {(card.campaignGoals?.length ? card.campaignGoals : card.campaignGoal ? [card.campaignGoal] : []).map((cg) => (
            <span key={cg} className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/15 text-white/90">🎯 {cg}</span>
          ))}
          {card.targetAudience && <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/15 text-white/90">👥 {card.targetAudience.split(',')[0].trim()}</span>}
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/15 text-white/90">📆 {card.duration}w</span>
        </div>
        {card.phaseLabels.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2.5">
            {card.phaseLabels.map((label, i) => <span key={i} className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/25 text-white">{label}</span>)}
          </div>
        )}
      </div>

      {!isRunningThis && (
        <div className="flex-1 px-5 py-4 space-y-3 bg-white">
          <p className={`text-[10px] font-bold uppercase tracking-widest ${theme.accent} mb-1`}>Weekly Arc</p>
          {card.weekThemes.map((wt) => (
            <div key={wt.week} className="flex items-start gap-3">
              <span className={`flex-shrink-0 w-5 h-5 rounded-full ${theme.weekDot} flex items-center justify-center text-[10px] font-bold text-white mt-0.5`}>{wt.week}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                  {wt.phase_label && <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${theme.badge}`}>{wt.phase_label}</span>}
                  <span className="text-xs font-semibold text-gray-800 leading-snug">{wt.title}</span>
                </div>
                {wt.objective && <p className="text-[10px] text-gray-500 leading-relaxed mt-0.5">{wt.objective}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      {isRunningThis && boltProgress && <CardBoltProgress progress={boltProgress} theme={theme} startedAt={execStartedAt} />}

      {!isRunningThis && (
        <div className="px-5 pb-5 pt-3 bg-white border-t border-gray-100">
          <button type="button" onClick={onSelect} disabled={anyExecuting}
            className={`w-full py-2.5 text-xs font-bold rounded-xl transition-all disabled:opacity-40 ${theme.btn} text-white`}>
            {selected ? '✓ Selected — Click to Re-select' : 'Select This Strategy →'}
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── Main page ─────────────────────────────────────────────────────────────── */
export default function BoltCombinedStrategyPage() {
  const router = useRouter();
  const { selectedCompanyId: companyId, isLoading, authChecked, isAuthenticated, user } = useCompanyContext();

  const [topic, setTopic] = useState('');
  const [description, setDescription] = useState('');
  const [goals, setGoals] = useState<string[]>([]);
  const [tone, setTone] = useState<string[]>([]);
  const [audience, setAudience] = useState<string[]>([]);
  const [strategicFocus, setStrategicFocus] = useState<string[]>([]);
  const [offerings, setOfferings] = useState<string[]>([]);

  // Text formats
  const [textFormats, setTextFormats] = useState<TextFormat[]>([]);
  const [textFrequency, setTextFrequency] = useState<Partial<Record<TextFormat, number>>>({});

  // Creator formats
  const [creatorFormats, setCreatorFormats] = useState<CreatorFormat[]>([]);
  const [creatorFrequency, setCreatorFrequency] = useState<Partial<Record<CreatorFormat, number>>>({});

  const [duration, setDuration] = useState(4);
  const [themeSource, setThemeSource] = useState<ThemeSource>('hybrid');
  const [sharingMode, setSharingMode] = useState<SharingMode>('ai');
  const [campaignStartDate, setCampaignStartDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  // Round-6: capability-aware platform picker (strategy-mix = registry union;
  // fail-closed on unknowns; emits canonical platform.capability.filtered log).
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const platformPicker = useBoltPlatformPicker(companyId, 'strategy-mix');
  const togglePlatform = (p: string) =>
    setSelectedPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  // Auto-select the platforms that are CONNECTED (platformPicker.supported =
  // registry-union of connected accounts) AND can run the selected content
  // formats (capability authority). When no format is chosen yet, all connected
  // platforms are eligible. Manual selections are preserved; selection only
  // resets to the full eligible set when every prior pick became ineligible.
  const contentFormatsKey = [...textFormats, ...creatorFormats].slice().sort().join(',');
  useEffect(() => {
    if (platformPicker.loading || platformPicker.supported.length === 0) return;
    const formats = [...textFormats, ...creatorFormats];
    const eligibleSet = new Set<string>();
    if (formats.length === 0) {
      platformPicker.supported.forEach((p) => eligibleSet.add(p.toLowerCase()));
    } else {
      for (const fmt of formats) {
        for (const p of getSupportedPlatformsForFormat(fmt)) eligibleSet.add(p.toLowerCase());
      }
    }
    const eligible = platformPicker.supported.filter((p) => eligibleSet.has(p.toLowerCase()));
    setSelectedPlatforms((prev) => {
      const filtered = prev.filter((p) => eligible.includes(p));
      return filtered.length > 0 ? filtered : eligible;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platformPicker.loading, platformPicker.supported, contentFormatsKey]);

  // Content formats aligned to CONNECTED platforms (per the API-integration
  // capability registry). A format is selectable only when at least one
  // connected platform can actually publish it — reuses the canonical
  // getSupportedPlatformsForFormat authority (capability + format exclusivity,
  // e.g. tweet → X-only, reel/short → creator platforms, youtube → video).
  // While the picker is still loading (or nothing is connected yet) we don't
  // over-disable — the platform picker shows its own empty/connect state.
  const formatCapable = useMemo(() => {
    const map: Record<string, boolean> = {};
    const connected = platformPicker.supported;
    // Align to the SELECTED platforms — so deselecting X disables the X-exclusive
    // Tweet (tweet → X-only). Fall back to all connected platforms only when the
    // user hasn't narrowed the selection yet, so we don't over-disable on load.
    const effective = selectedPlatforms.length > 0 ? selectedPlatforms : connected;
    const gating = !platformPicker.loading && connected.length > 0;
    for (const f of [...TEXT_FORMATS, ...CREATOR_FORMATS]) {
      map[f.value] = gating ? getSupportedPlatformsForFormat(f.value, effective).length > 0 : true;
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platformPicker.loading, platformPicker.supported, selectedPlatforms]);

  // Keep format selections aligned to the SELECTED platforms: when a platform is
  // deselected, drop any selected format no longer supported by the remaining
  // selection (e.g. deselect X → Tweet, which is X-exclusive, is removed). Pure
  // removal — never re-adds a format — so it converges with the format→platform
  // auto-select effect above. Skipped when nothing is selected (handled by the
  // connected-fallback in formatCapable).
  useEffect(() => {
    if (platformPicker.loading || selectedPlatforms.length === 0) return;
    const supported = (fmt: AnyFormat) =>
      getSupportedPlatformsForFormat(fmt, selectedPlatforms).length > 0;
    setTextFormats((prev) => {
      const next = prev.filter(supported);
      return next.length === prev.length ? prev : next;
    });
    setCreatorFormats((prev) => {
      const next = prev.filter(supported);
      return next.length === prev.length ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlatforms, platformPicker.loading]);

  // Phase 6G-2 — read-only assignment explainability (Intelligent Mix only).
  const [showDecisions, setShowDecisions] = useState(false);
  const assignmentExplanation = useMemo(
    () => buildAssignmentExplanation({
      selectedPlatforms,
      selectedFormats: [...textFormats, ...creatorFormats],
      isCombined: true,
    }),
    [selectedPlatforms, textFormats, creatorFormats],
  );
  useEffect(() => {
    const d = assignmentExplanation.diagnostics;
    if (d.assignment_explanations_generated > 0) {
      console.info('[bolt/assignment-explanation]', JSON.stringify(d)); // counts only
    }
  }, [assignmentExplanation]);

  // Flat per-pair decisions (6G-2 refined) — same authority, drives the panel.
  const assignmentDecisions = useMemo(
    () => buildAssignmentDecisions({
      selectedPlatforms,
      selectedFormats: [...textFormats, ...creatorFormats],
      isCombined: true,
    }),
    [selectedPlatforms, textFormats, creatorFormats],
  );

  const [outcomeView, setOutcomeView] = useState<OutcomeView>('week_plan');

  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [showChat, setShowChat] = useState(false);

  const [cards, setCards] = useState<BoltStrategyCard[]>([]);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [executing, setExecuting] = useState(false);
  const [execProgress, setExecProgress] = useState<BOLTProgress | null>(null);
  const [execStartedAt, setExecStartedAt] = useState(0);
  const [execError, setExecError] = useState<string | null>(null);
  const [confirmingCard, setConfirmingCard] = useState<BoltStrategyCard | null>(null);

  const cardsRef = useRef<HTMLDivElement>(null);

  // Restore from sessionStorage
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(BOLT_STATE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s.topic)           setTopic(s.topic);
      if (s.description)     setDescription(s.description);
      if (s.goals)           setGoals(s.goals);
      if (s.tone)            setTone(s.tone);
      if (s.audience)        setAudience(s.audience);
      if (s.strategicFocus)  setStrategicFocus(s.strategicFocus);
      if (s.offerings)       setOfferings(s.offerings);
      if (s.textFormats)     setTextFormats(s.textFormats);
      if (s.textFrequency)   setTextFrequency(s.textFrequency);
      if (s.creatorFormats)  setCreatorFormats(s.creatorFormats);
      if (s.creatorFrequency) setCreatorFrequency(s.creatorFrequency);
      if (s.duration)        setDuration(s.duration);
      if (s.themeSource)     setThemeSource(s.themeSource);
      if (s.sharingMode)     setSharingMode(s.sharingMode);
      if (s.outcomeView)     setOutcomeView(s.outcomeView);
      if (s.campaignStartDate) setCampaignStartDate(s.campaignStartDate);
      if (s.cards)           setCards(s.cards);
      if (s.hasGenerated)    setHasGenerated(s.hasGenerated);
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist to sessionStorage
  useEffect(() => {
    try {
      sessionStorage.setItem(BOLT_STATE_KEY, JSON.stringify({
        topic, description, goals, tone, audience, strategicFocus, offerings,
        textFormats, textFrequency, creatorFormats, creatorFrequency,
        duration, themeSource, sharingMode, outcomeView, campaignStartDate,
        cards, hasGenerated,
      }));
    } catch {}
  }, [topic, description, goals, tone, audience, strategicFocus, offerings, textFormats, textFrequency, creatorFormats, creatorFrequency, duration, themeSource, sharingMode, outcomeView, campaignStartDate, cards, hasGenerated]);

  useEffect(() => { if (authChecked && !user?.userId) router.replace('/login'); }, [authChecked, user?.userId, router]);

  useEffect(() => {
    if (!companyId) return;
    setSuggestionsLoading(true);
    fetchWithAuth('/api/planner/suggest-campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyId }) })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data?.suggestions) setSuggestions(data.suggestions as Suggestion[]); })
      .catch(() => {})
      .finally(() => setSuggestionsLoading(false));
  }, [companyId]);

  if (!authChecked || isLoading) return <PageLoader message="Loading BOLT…" />;
  if (!user?.userId) return <PageLoader message="Redirecting…" statuses={[]} />;

  function toggleGoal(g: string) { setGoals((p) => p.includes(g) ? p.filter((x) => x !== g) : [...p, g]); }
  function toggleTone(t: string) { setTone((p) => p.includes(t) ? p.filter((x) => x !== t) : [...p, t]); }
  function toggleFocus(f: string) { setStrategicFocus((p) => p.includes(f) ? p.filter((x) => x !== f) : [...p, f]); }
  function toggleAudience(a: string) { setAudience((p) => p.includes(a) ? p.filter((x) => x !== a) : [...p, a]); }

  function toggleTextFormat(f: TextFormat) {
    setTextFormats((prev) => {
      if (prev.includes(f)) { setTextFrequency((fq) => { const n = { ...fq }; delete n[f]; return n; }); return prev.filter((x) => x !== f); }
      if (prev.length >= 3) return prev;
      setTextFrequency((fq) => ({ ...fq, [f]: fq[f] ?? 3 }));
      return [...prev, f];
    });
  }
  function toggleCreatorFormat(f: CreatorFormat) {
    setCreatorFormats((prev) => {
      if (prev.includes(f)) { setCreatorFrequency((fq) => { const n = { ...fq }; delete n[f]; return n; }); return prev.filter((x) => x !== f); }
      if (prev.length >= 2) return prev;
      setCreatorFrequency((fq) => ({ ...fq, [f]: fq[f] ?? 3 }));
      return [...prev, f];
    });
  }
  function setTextFreq(f: TextFormat, delta: number) { setTextFrequency((p) => ({ ...p, [f]: Math.min(7, Math.max(1, (p[f] ?? 3) + delta)) })); }
  function setCreatorFreq(f: CreatorFormat, delta: number) { setCreatorFrequency((p) => ({ ...p, [f]: Math.min(7, Math.max(1, (p[f] ?? 3) + delta)) })); }

  function applySuggestion(s: Suggestion) { setTopic(s.suggested_campaign_title || s.topic); setDuration(s.suggested_duration || 4); }

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

    const allFormats: AnyFormat[] = [...textFormats, ...creatorFormats];
    const allFrequency: Partial<Record<AnyFormat, number>> = { ...textFrequency, ...creatorFrequency };
    const totalFrequency = allFormats.reduce((sum, f) => sum + (allFrequency[f] ?? 3), 0);
    const campaignDuration = Math.min(MAX_CAMPAIGN_DURATION_WEEKS, Math.max(1, Math.round(duration)));

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
      blueprint: { duration_weeks: duration, progression_summary: card.phaseLabels.join(' → ') },
      formats: allFormats,
    };

    const executionConfig = {
      target_audience: audience.join(', ') || 'General audience',
      content_depth: 'standard',
      frequency_per_week: totalFrequency,
      format_frequency: Object.fromEntries(allFormats.map((f) => [f, allFrequency[f] ?? 3])),
      campaign_duration: campaignDuration,
      tentative_start: campaignStartDate || new Date().toISOString().split('T')[0],
      campaign_goal: combinedGoal,
      campaign_goals: goals,
      campaign_description: description.trim() || card.summary,
      campaign_mode: 'combined',
      communication_style: tone.length > 0 ? tone.map((t) => t.toLowerCase()) : ['professional', 'visual'],
      content_formats: allFormats,
      text_formats: textFormats,
      creator_formats: creatorFormats,
      cross_platform_sharing: sharingMode === 'shared' ? { enabled: true } : sharingMode === 'unique' ? { enabled: false } : true,
    };

    try {
      const execRes = await fetchWithAuth('/api/bolt/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, sourceStrategicTheme, executionConfig, outcomeView, title: card.title, description: card.summary }),
      });

      if (!execRes.ok) {
        const err = await execRes.json().catch(() => ({}));
        throw new Error((err as { error?: string })?.error || 'Failed to start BOLT execution');
      }

      const execData = await execRes.json();
      const runId = (execData as { run_id?: string })?.run_id;
      if (!runId) throw new Error('No run_id returned from BOLT');

      const POLL_INTERVAL_MS = 2500;
      const DEADLINE = Date.now() + 15 * 60 * 1000; // 15 min — includes scheduling
      let completedCampaignId: string | null = null;
      let done = false;

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
          failed_stage?: string; failed_stage_label?: string; error_code?: string;
        };

        if (!mounted) return;
        setExecProgress({
          stage: prog.stage, status: prog.status,
          progress_percentage: prog.progress_percentage ?? 0,
          weeks_generated: prog.weeks_generated, daily_slots_created: prog.daily_slots_created,
          // 6H-D failure explainability — carried through so a failed status keeps WHERE + WHY.
          error_message: prog.error_message,
          failed_stage: prog.failed_stage, failed_stage_label: prog.failed_stage_label, error_code: prog.error_code,
        });

        if (prog.status === 'completed') { completedCampaignId = prog.result_campaign_id ?? null; done = true; }
        else if (prog.status === 'failed' || prog.status === 'aborted') throw new Error(prog.error_message || 'BOLT execution failed');
      }

      if (!mounted) return;
      try { sessionStorage.removeItem(BOLT_STATE_KEY); } catch {}
      setExecuting(false);
      setExecProgress(null);

      if (!completedCampaignId) { router.push('/command-center/campaigns'); return; }

      const qs = new URLSearchParams({ companyId: companyId ?? '' });
      if (outcomeView === 'daily_plan') {
        router.push(`/campaign-daily-plan/${completedCampaignId}?${qs.toString()}`);
      } else if (outcomeView === 'schedule') {
        router.push(`/campaign-calendar/${completedCampaignId}?${qs.toString()}`);
      } else {
        router.push(`/campaign-details/${completedCampaignId}?mode=fast&${qs.toString()}`);
      }
    } catch (err) {
      if (!mounted) return;
      const msg = err instanceof Error ? err.message : 'Something went wrong';
      // Preserve the rich failed state (stage/code) already set by the poll loop;
      // only synthesize a minimal failure for exception paths (network/timeout).
      setExecProgress((prev) => (prev && prev.status === 'failed') ? prev : { status: 'failed', progress_percentage: 0, error_message: msg });
      setExecuting(false);
      setTimeout(() => { if (!mounted) return; setExecProgress(null); setSelectedIds([]); setExecError(msg); }, 4000);
    }

    return () => { mounted = false; };
  }

  async function handleGenerate() {
    if (!topic.trim()) return;
    setGenerating(true);
    setGenError(null);
    setSelectedIds([]);
    const allFormats = [...textFormats, ...creatorFormats];
    try {
      const res = await fetch('/api/bolt/strategy-cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId, topic: topic.trim(), goals, tone,
          description: description.trim() || undefined,
          goal: goals.length > 0 ? goals.join(', ') : undefined,
          audience: audience.join(', '), strategicFocus, offerings,
          contentFormat: allFormats[0] ?? 'post', duration, themeSource,
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
  const allFormats = [...textFormats, ...creatorFormats];
  const allFrequency: Partial<Record<AnyFormat, number>> = { ...textFrequency, ...creatorFrequency };

  // Phase 6 — apply a full AI Campaign Blueprint into the form using existing
  // setters only. Only fields the AI returned are written (existing input for
  // omitted fields is preserved); formats are filtered to this page's
  // supported values so nothing unschedulable lands in the form.
  const applyCampaignBlueprint = (s: {
    topic: string;
    description?: string;
    goals?: string[];
    tone?: string[];
    audience?: string;
    strategicFocus?: string[];
    platforms?: string[];
    textFormats?: string[];
    creatorFormats?: string[];
    duration?: number;
    outcomeView?: string;
  }) => {
    if (s.topic) setTopic(s.topic);
    if (s.description) setDescription(s.description);
    // Map suggested goals/audience onto the form's chip vocabularies so they
    // VISIBLY select (the chips render `goals.includes(label)` against the fixed
    // GOAL_OPTIONS / AUDIENCE_OPTIONS). Case-insensitive; for the free-text
    // audience, a chip is selected when its label appears in the suggestion.
    // Unmatched suggestions are skipped (no chip exists) rather than stored as
    // invisible phantom state that would skew the "N selected" counter.
    const normLabel = (x: string) => x.trim().toLowerCase();
    if (s.goals && s.goals.length > 0) {
      const matchedGoals = GOAL_OPTIONS.filter((opt) => s.goals!.some((g) => normLabel(g) === normLabel(opt)));
      if (matchedGoals.length > 0) setGoals(matchedGoals);
    }
    if (s.tone && s.tone.length > 0) {
      const matchedTone = TONE_OPTIONS.filter((opt) => s.tone!.some((t) => normLabel(t) === normLabel(opt)));
      if (matchedTone.length > 0) setTone(matchedTone);
    }
    if (s.audience) {
      const free = normLabel(s.audience);
      const matchedAudience = AUDIENCE_OPTIONS.filter(
        (opt) => free === normLabel(opt) || free.includes(normLabel(opt)),
      );
      if (matchedAudience.length > 0) setAudience(matchedAudience);
    }
    if (s.strategicFocus && s.strategicFocus.length > 0) setStrategicFocus(s.strategicFocus);
    if (s.platforms && s.platforms.length > 0) setSelectedPlatforms(s.platforms);
    const validText = new Set(TEXT_FORMATS.map((f) => f.value));
    const validCreator = new Set(CREATOR_FORMATS.map((f) => f.value));
    if (s.textFormats && s.textFormats.length > 0) {
      const tf = s.textFormats.filter((f): f is TextFormat => validText.has(f as TextFormat));
      if (tf.length > 0) setTextFormats(tf);
    }
    if (s.creatorFormats && s.creatorFormats.length > 0) {
      const cf = s.creatorFormats.filter((f): f is CreatorFormat => validCreator.has(f as CreatorFormat));
      if (cf.length > 0) setCreatorFormats(cf);
    }
    if (typeof s.duration === 'number' && s.duration >= 1) setDuration(s.duration);
    if (s.outcomeView && (['week_plan', 'daily_plan', 'schedule'] as string[]).includes(s.outcomeView)) {
      setOutcomeView(s.outcomeView as OutcomeView);
    }
  };

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
            <span className="text-3xl">🔀</span>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Intelligent Mix Campaign Builder</h1>
              <p className="text-sm font-medium text-gray-600">Text + Creator Campaign</p>
            </div>
            <span className="ml-auto rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">AI + Creator</span>
          </div>
          <p className="text-gray-500 text-sm">Run text-based AI content and creator-dependent media in a single coordinated campaign.</p>
        </div>

        {/* Two-column layout */}
        <div className="flex gap-5 items-start">

          {/* LEFT: Form */}
          <div className="flex-1 min-w-0 bg-white rounded-2xl border border-gray-200 shadow-sm divide-y divide-gray-100">

            {/* Topic */}
            <div className="p-5">
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1">Campaign Topic <span className="text-red-400">*</span></label>
              <p className="text-xs text-gray-400 mb-2">What is this campaign about?</p>
              <textarea value={topic} onChange={(e) => setTopic(e.target.value)} rows={3}
                placeholder="e.g. Q3 product launch combining thought leadership posts and behind-the-scenes videos…"
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-400 placeholder:text-gray-300" />
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mt-4 mb-1">Description</label>
              <p className="text-xs text-gray-400 mb-2">A 1–2 sentence campaign blurb (optional).</p>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
                placeholder="e.g. A focused push delivering actionable insights to help marketing teams execute with clarity…"
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-400 placeholder:text-gray-300" />
            </div>

            {/* Goal + Audience */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-0 divide-y sm:divide-y-0 sm:divide-x divide-gray-100">
              <div className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide">Campaign Goal</label>
                  {goals.length > 0 && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">{goals.length} selected</span>}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {GOAL_OPTIONS.map((g) => (
                    <button key={g} type="button" onClick={() => toggleGoal(g)}
                      className={`text-xs px-2.5 py-1.5 rounded-full border-2 font-medium transition-all ${goals.includes(g) ? 'border-violet-400 bg-violet-100 text-violet-900' : 'border-gray-200 text-gray-600 hover:border-violet-200 hover:bg-violet-50/40'}`}>
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
                      className={`text-xs px-2.5 py-1.5 rounded-full border-2 font-medium transition-all ${audience.includes(a) ? 'border-violet-400 bg-violet-100 text-violet-900' : 'border-gray-200 text-gray-600 hover:border-violet-300 hover:bg-violet-50'}`}>
                      {audience.includes(a) && '✓ '}{a}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Tone */}
            <div className="p-5">
              <div className="flex items-center justify-between mb-3">
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide">Tone</label>
                {tone.length > 0 && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">{tone.length} selected</span>}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {TONE_OPTIONS.map((t) => (
                  <button key={t} type="button" onClick={() => toggleTone(t)}
                    className={`text-xs px-2.5 py-1.5 rounded-full border-2 font-medium transition-all ${tone.includes(t) ? 'border-violet-400 bg-violet-100 text-violet-900' : 'border-gray-200 text-gray-600 hover:border-violet-300 hover:bg-violet-50'}`}>
                    {tone.includes(t) && '✓ '}{t}
                  </button>
                ))}
              </div>
            </div>

            {/* Strategic Focus */}
            <div className="p-5">
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1">Strategic Focus</label>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {STRATEGIC_FOCUS_OPTIONS.map((f) => (
                  <button key={f} type="button" onClick={() => toggleFocus(f)}
                    className={`text-xs px-2.5 py-1.5 rounded-full border-2 font-medium transition-all ${strategicFocus.includes(f) ? 'border-violet-400 bg-violet-100 text-violet-900' : 'border-gray-200 text-gray-600 hover:border-violet-300 hover:bg-violet-50'}`}>
                    {strategicFocus.includes(f) && '✓ '}{f}
                  </button>
                ))}
              </div>
            </div>

            {/* Offerings */}
            <div className="p-5">
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1">Offerings / Products</label>
              <p className="text-xs text-gray-400 mb-2">Type and press Enter.</p>
              <TagInput tags={offerings} onChange={setOfferings} placeholder="e.g. SaaS Tool, Brand Story, Tutorial Series…" />
            </div>

            {/* Content Formats — two columns: text left, creator right */}
            <div className="p-5">
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-3">Content Formats</label>
              <div className="grid grid-cols-2 gap-4">
                {/* Text */}
                <div>
                  <p className="text-[10px] font-bold text-amber-600 uppercase tracking-wide mb-2">✍️ Text <span className="font-normal text-gray-400">(max 3)</span></p>
                  <div className="flex flex-col gap-1.5">
                    {TEXT_FORMATS.map((fmt) => {
                      const sel = textFormats.includes(fmt.value);
                      const capable = formatCapable[fmt.value] !== false;
                      return (
                        <div key={fmt.value} className="flex flex-col gap-0.5">
                          <button type="button" onClick={() => toggleTextFormat(fmt.value)}
                            disabled={!sel && (textFormats.length >= 3 || !capable)}
                            title={!capable ? `No connected platform supports ${fmt.label}. Connect a compatible platform to enable it.` : fmt.hint}
                            className={`flex items-center gap-2 text-xs px-2.5 py-2 rounded-xl border-2 font-medium transition-all text-left disabled:opacity-40 ${sel ? 'border-amber-400 bg-amber-50 text-amber-900' : 'border-gray-200 text-gray-600 hover:border-amber-300 hover:bg-amber-50/40'}`}>
                            <span>{fmt.icon}</span>{fmt.label}
                          </button>
                          {sel && (
                            <div className="flex items-center gap-1.5 pl-1">
                              <span className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">×/wk</span>
                              <button type="button" onClick={() => setTextFreq(fmt.value, -1)} className="w-5 h-5 rounded-full border border-gray-300 text-gray-500 hover:bg-gray-100 flex items-center justify-center text-xs font-bold">−</button>
                              <span className="text-xs font-bold text-amber-700 w-4 text-center">{textFrequency[fmt.value] ?? 3}</span>
                              <button type="button" onClick={() => setTextFreq(fmt.value, 1)} className="w-5 h-5 rounded-full border border-gray-300 text-gray-500 hover:bg-gray-100 flex items-center justify-center text-xs font-bold">+</button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                {/* Creator */}
                <div>
                  <p className="text-[10px] font-bold text-blue-600 uppercase tracking-wide mb-2">🎬 Creator <span className="font-normal text-gray-400">(max 2)</span></p>
                  <div className="flex flex-col gap-1.5">
                    {CREATOR_FORMATS.map((fmt) => {
                      const sel = creatorFormats.includes(fmt.value);
                      const capable = formatCapable[fmt.value] !== false;
                      return (
                        <div key={fmt.value} className="flex flex-col gap-0.5">
                          <button type="button" onClick={() => toggleCreatorFormat(fmt.value)}
                            disabled={!sel && (creatorFormats.length >= 2 || !capable)}
                            title={!capable ? `No connected platform supports ${fmt.label}. Connect a compatible platform to enable it.` : fmt.hint}
                            className={`flex items-center gap-2 text-xs px-2.5 py-2 rounded-xl border-2 font-medium transition-all text-left disabled:opacity-40 ${sel ? 'border-blue-400 bg-blue-50 text-blue-900' : 'border-gray-200 text-gray-600 hover:border-blue-300 hover:bg-blue-50/40'}`}>
                            <span>{fmt.icon}</span>{fmt.label}
                          </button>
                          {sel && (
                            <div className="flex items-center gap-1.5 pl-1">
                              <span className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">×/wk</span>
                              <button type="button" onClick={() => setCreatorFreq(fmt.value, -1)} className="w-5 h-5 rounded-full border border-gray-300 text-gray-500 hover:bg-gray-100 flex items-center justify-center text-xs font-bold">−</button>
                              <span className="text-xs font-bold text-blue-700 w-4 text-center">{creatorFrequency[fmt.value] ?? 3}</span>
                              <button type="button" onClick={() => setCreatorFreq(fmt.value, 1)} className="w-5 h-5 rounded-full border border-gray-300 text-gray-500 hover:bg-gray-100 flex items-center justify-center text-xs font-bold">+</button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* Duration + Intelligence Source */}
            <div className="grid grid-cols-2 divide-x divide-gray-100">
              <div className="p-5">
                <label htmlFor="combined-duration" className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-3">Duration</label>
                <select
                  id="combined-duration"
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className="w-full py-2 px-3 text-sm font-semibold rounded-xl border-2 border-gray-200 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-400">
                  {DURATION_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div className="p-5">
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-3">Intelligence Source</label>
                <div className="flex flex-col gap-1.5">
                  {INTELLIGENCE_SOURCES.map((src) => (
                    <button key={src.value} type="button" onClick={() => setThemeSource(src.value)}
                      className={`flex flex-col items-start text-left px-2.5 py-2 rounded-xl border-2 transition-all ${themeSource === src.value ? 'border-violet-400 bg-violet-50 text-violet-900' : 'border-gray-200 text-gray-600 hover:border-violet-300 hover:bg-violet-50/40'}`}>
                      <span className="text-xs font-semibold">{src.label}</span>
                      <span className="text-[10px] text-gray-400 mt-0.5">{src.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Content Sharing */}
            <div className="px-5 pt-4 pb-4 border-t border-gray-100">
              <div className="flex items-center gap-2 mb-2">
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide">Content Sharing</label>
                <span className="text-[10px] text-gray-400">— how content is distributed across platforms</span>
              </div>
              <div className="flex gap-2">
                {([
                  { value: 'shared' as SharingMode, label: 'Shared',     icon: '🔗', hint: 'Same post on all platforms' },
                  { value: 'unique' as SharingMode, label: 'Unique',     icon: '✦',  hint: 'Distinct content per platform' },
                  { value: 'ai'     as SharingMode, label: 'AI Decides', icon: '🤖', hint: 'AI chooses best mix' },
                ] as const).map((opt) => (
                  <button key={opt.value} type="button" onClick={() => setSharingMode(opt.value)}
                    className={`flex-1 flex flex-col items-center gap-0.5 px-2 py-2.5 rounded-xl border-2 text-center transition-all ${sharingMode === opt.value ? 'border-violet-400 bg-violet-50 text-violet-900' : 'border-gray-200 text-gray-600 hover:border-violet-300 hover:bg-violet-50/40'}`}>
                    <span className="text-base leading-none">{opt.icon}</span>
                    <span className="text-[11px] font-bold mt-1">{opt.label}</span>
                    <span className="text-[9px] text-gray-400 leading-tight">{opt.hint}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Platforms — capability-aware picker (Round-6: strategy-mix = registry union) */}
            <div className="px-5 pt-4 pb-4 border-t border-gray-100">
              <BoltPlatformPicker
                accent="violet"
                loading={platformPicker.loading}
                blocked={platformPicker.blocked}
                supported={platformPicker.supported}
                hidden={platformPicker.hidden}
                selected={selectedPlatforms}
                onToggle={togglePlatform}
                hint="Strategy Mix targets every connected platform that's registered for publishing."
                emptyMessage="No registered platforms connected yet. Connect your social accounts to enable Strategy Mix."
              />
            </div>

            {/* Assignment Summary — read-only explainability (6G-2). What was
                supported / restricted / removed, and why (canonical authority). */}
            {assignmentDecisions.length > 0 && (
              <div className="px-5 pt-4 pb-4 border-t border-gray-100">
                <button type="button" onClick={() => setShowDecisions((v) => !v)}
                  className="w-full flex items-center justify-between text-left">
                  <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Assignment Summary</span>
                  <span className="text-gray-400 text-xs">{showDecisions ? '▲' : '▼'}</span>
                </button>
                {showDecisions && (
                  <div className="mt-3">
                    <AssignmentSummary decisions={assignmentDecisions} />
                  </div>
                )}
              </div>
            )}

            {/* Campaign Start Date */}
            <div className="px-5 pt-4 pb-4 border-t border-gray-100">
              <div className="flex items-center gap-2 mb-2">
                <label htmlFor="combined-start-date" className="block text-xs font-semibold text-gray-700 uppercase tracking-wide">Campaign Start Date</label>
                <span className="text-[10px] text-gray-400">— when should the campaign begin?</span>
              </div>
              <input id="combined-start-date" type="date" value={campaignStartDate}
                min={new Date().toISOString().split('T')[0]}
                onChange={(e) => setCampaignStartDate(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white" />
            </div>

            {/* View In */}
            <div className="px-5 pt-4 pb-2 border-t border-gray-100">
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">View In</label>
              <div className="flex gap-2">
                {VIEW_OPTIONS.map((opt) => (
                  <label key={opt.value} className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input type="radio" name="combinedOutcomeView" value={opt.value}
                      checked={outcomeView === opt.value} onChange={() => setOutcomeView(opt.value)}
                      className="accent-violet-500 w-3.5 h-3.5" />
                    <span className={`text-xs font-medium ${outcomeView === opt.value ? 'text-violet-700' : 'text-gray-600'}`}>{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Generate */}
            <div className="p-5 bg-violet-50/60 rounded-b-2xl">
              <button type="button" onClick={handleGenerate} disabled={!canGenerate || generating}
                className={`w-full py-3 text-sm font-bold rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 ${canGenerate && !generating ? 'bg-violet-500 hover:bg-violet-600 text-white' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}>
                {generating ? (
                  <><svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>Generating Strategy Cards…</>
                ) : hasGenerated ? '🔀 Regenerate Intelligent Mix Cards' : '🔀 Generate Intelligent Mix Cards'}
              </button>
              {!canGenerate && !generating && <p className="text-xs text-gray-400 text-center mt-2">Enter a campaign topic to get started</p>}
            </div>
          </div>

          {/* RIGHT: Suggestions + Chat */}
          <div className="w-[36%] flex-shrink-0 flex flex-col gap-4">
            <div className="bg-white rounded-2xl border border-violet-200 shadow-sm overflow-hidden">
              <div className="px-4 pt-4 pb-3 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wide">Campaign Suggestions</h3>
                {suggestionsLoading && <div className="animate-spin h-3.5 w-3.5 border-2 border-violet-400 border-t-transparent rounded-full" />}
              </div>
              {suggestions.length > 0 ? (
                <div className="divide-y divide-gray-50">
                  {suggestions.slice(0, 4).map((s) => (
                    <button key={s.id} type="button" onClick={() => applySuggestion(s)}
                      className="w-full text-left px-4 py-3 hover:bg-violet-50/60 transition-colors group">
                      <div className="text-xs font-semibold text-gray-800 group-hover:text-violet-700 leading-snug">{s.suggested_campaign_title || s.topic}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] text-gray-400">{s.suggested_duration}w</span>
                        {s.opportunity_score != null && <span className="text-[10px] font-semibold text-violet-600">{Math.round(s.opportunity_score * 100)}% match</span>}
                      </div>
                    </button>
                  ))}
                </div>
              ) : !suggestionsLoading ? (
                <p className="text-xs text-gray-400 px-4 py-4">No suggestions yet — enter a topic above.</p>
              ) : null}
            </div>

            <div className="bg-white rounded-2xl border border-violet-200 shadow-sm overflow-hidden">
              <button type="button" onClick={() => setShowChat((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-violet-50/40 transition-colors">
                <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">AI Campaign Chat</span>
                <span className="text-gray-400 text-xs">{showChat ? '▲' : '▼'}</span>
              </button>
              {showChat && companyId && (
                <div className="border-t border-gray-100">
                  <BoltCampaignChat
                    companyId={companyId}
                    // Parity context with BOLT Text / Creator — the shared
                    // /api/bolt/campaign-chat endpoint folds these into the
                    // grounding prompt so suggestions are company-, strategy-,
                    // and execution-aware (not generic clarification questions).
                    context={{
                      topic,
                      description,
                      goals,
                      tone,
                      audience: audience.join(', '),
                      strategicFocus,
                      selectedPlatforms,
                      selectedFormats: [...textFormats, ...creatorFormats],
                      formatFrequency: { ...textFrequency, ...creatorFrequency },
                      duration,
                      outcomeView,
                    }}
                    requestBlueprint
                    onApplySuggestion={applyCampaignBlueprint}
                  />
                </div>
              )}
            </div>

            {genError && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{genError}</div>
            )}
            {execError && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{execError}</div>
            )}
          </div>
        </div>

        {/* Strategy Cards */}
        {hasGenerated && (
          <div ref={cardsRef} className="space-y-4">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-bold text-gray-900">Choose Your Strategy</h2>
              <span className="text-xs text-gray-500">{cards.length} options generated</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {cards.map((card, idx) => (
                <StrategyCard
                  key={card.id} card={card} index={idx}
                  selected={selectedIds.includes(card.id)}
                  boltProgress={selectedIds.includes(card.id) ? execProgress : null}
                  execStartedAt={execStartedAt} anyExecuting={executing}
                  onSelect={() => handleCardSelect(card.id)}
                />
              ))}
            </div>
            {executing && (
              <p className="text-xs text-center text-gray-400 mt-2">
                {outcomeView === 'schedule' ? '🔀 BOLT is building your campaign — hang tight.' : '🔀 BOLT is crafting your combined campaign.'}
              </p>
            )}
          </div>
        )}

      </div>
    </div>

    {/* Confirm Modal */}
    {confirmingCard && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4 py-6">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-full overflow-hidden">
          <div className="bg-gradient-to-r from-violet-500 to-purple-600 px-6 py-4 flex-shrink-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg">🔀</span>
              <h2 className="text-white font-bold text-base">Confirm BOLT Launch</h2>
            </div>
            <p className="text-violet-100 text-xs">Review your inputs before launching. BOLT will build exactly this.</p>
          </div>

          <div className="overflow-y-auto flex-1">
            <div className="px-6 pt-5 pb-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Strategy</p>
              <p className="text-sm font-bold text-gray-900 leading-snug">{confirmingCard.title}</p>
              {confirmingCard.summary && <p className="text-xs text-gray-500 mt-1 leading-relaxed">{confirmingCard.summary}</p>}
            </div>

            <div className="px-6 py-3 space-y-3">
              {/* Content Plan */}
              <div className="bg-violet-50 rounded-xl p-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-violet-600 mb-2">Content Plan</p>
                {allFormats.length > 0 ? (
                  <div className="space-y-1.5">
                    {textFormats.length > 0 && (
                      <p className="text-[10px] font-bold text-amber-600 uppercase tracking-wide">✍️ Text</p>
                    )}
                    {textFormats.map((fmt) => {
                      const meta = TEXT_FORMATS.find((f) => f.value === fmt);
                      const freq = textFrequency[fmt] ?? 3;
                      return (
                        <div key={fmt} className="flex items-center justify-between text-xs">
                          <span className="text-gray-700 font-medium">{meta?.icon} {meta?.label ?? fmt}</span>
                          <span className="text-amber-700 font-bold">{freq}×/wk × {duration}wk = <strong>{freq * duration}</strong></span>
                        </div>
                      );
                    })}
                    {creatorFormats.length > 0 && (
                      <p className="text-[10px] font-bold text-blue-600 uppercase tracking-wide mt-2">🎬 Creator</p>
                    )}
                    {creatorFormats.map((fmt) => {
                      const meta = CREATOR_FORMATS.find((f) => f.value === fmt);
                      const freq = creatorFrequency[fmt] ?? 3;
                      return (
                        <div key={fmt} className="flex items-center justify-between text-xs">
                          <span className="text-gray-700 font-medium">{meta?.icon} {meta?.label ?? fmt}</span>
                          <span className="text-blue-700 font-bold">{freq}×/wk × {duration}wk = <strong>{freq * duration}</strong></span>
                        </div>
                      );
                    })}
                    <div className="border-t border-violet-200 pt-1.5 mt-1.5 flex justify-between text-xs font-bold">
                      <span className="text-gray-600">Total</span>
                      <span className="text-violet-800">
                        {allFormats.reduce((s, f) => s + (allFrequency[f] ?? 3), 0)}×/wk × {duration}wk = {allFormats.reduce((s, f) => s + (allFrequency[f] ?? 3) * duration, 0)} pieces
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-gray-500">No formats selected — AI will decide the mix.</p>
                )}
              </div>

              {/* Summary grid */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">Goals</p>
                  {goals.length > 0 ? goals.map((g) => <p key={g} className="text-gray-700 font-medium">🎯 {g}</p>) : <p className="text-gray-400 italic">None selected</p>}
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">Audience</p>
                  {audience.length > 0 ? <p className="text-gray-700 font-medium">👥 {audience.slice(0, 2).join(', ')}{audience.length > 2 ? ` +${audience.length - 2}` : ''}</p> : <p className="text-gray-400 italic">Not specified</p>}
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
                  <p className="text-gray-700 font-medium">{outcomeView === 'daily_plan' ? '📅 Daily Plan' : outcomeView === 'schedule' ? '🗓️ Schedule' : '📋 Week Plan'}</p>
                </div>
                <div className="bg-violet-50 rounded-xl p-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-violet-400 mb-1.5">Mode</p>
                  <p className="text-violet-700 font-medium">🔀 Text + Creator</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">Sharing</p>
                  <p className="text-gray-700 font-medium">{sharingMode === 'shared' ? '🔗 Shared' : sharingMode === 'unique' ? '✦ Unique' : '🤖 AI decides'}</p>
                </div>
              </div>

              {(goals.length === 0 || audience.length === 0 || allFormats.length === 0) && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 text-xs text-yellow-800">
                  <strong>⚠️ Some inputs are not set:</strong>
                  <ul className="mt-1 space-y-0.5 list-disc list-inside">
                    {goals.length === 0 && <li>No goal selected — AI will choose a default</li>}
                    {audience.length === 0 && <li>No audience selected — AI will target a general audience</li>}
                    {allFormats.length === 0 && <li>No format selected — AI will decide the mix</li>}
                  </ul>
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-3 px-6 pb-6 pt-2 flex-shrink-0 border-t border-gray-100">
            <button type="button" onClick={() => setConfirmingCard(null)}
              className="flex-1 py-2.5 text-sm font-semibold rounded-xl border-2 border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
              ← Go Back
            </button>
            <button type="button" onClick={handleConfirmLaunch}
              className="flex-1 py-2.5 text-sm font-bold rounded-xl bg-violet-500 hover:bg-violet-600 text-white transition-colors">
              Confirm &amp; Launch ⚡
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
