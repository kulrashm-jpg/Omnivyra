/**
 * Strategy AI Chat
 * Guided assistant for the Strategy tab "AI Chat" sub-tab.
 *
 * Two phases, driven by current session state:
 *  1. FILL THE PLAN — conversational slot-fill of the missing plan pieces
 *     (idea → goal → audience → duration). Answers are written into
 *     idea_spine / strategy_context (the same state the Plan tab reads),
 *     then the user confirms the assembled plan.
 *  2. BUILD / REFINE STRATEGIC CARDS — once confirmed, generate strategic
 *     theme cards via /api/planner/generate-themes, then refine them with
 *     natural language via /api/planner/chat-themes.
 */

import { useEffect, useRef, useState } from 'react';
import { Loader2, Send, Sparkles, RefreshCw, X } from 'lucide-react';
import { usePlannerSession, type StrategicThemeEntry } from './plannerSessionStore';
import { fetchWithAuth } from '../community-ai/fetchWithAuth';
import ChatVoiceButton from '../ChatVoiceButton';

interface ChatTurn { role: 'user' | 'assistant'; text: string; }

interface Props {
  companyId?: string | null;
  selectedWeek?: number | null;
  onClearSelection?: () => void;
}

type Slot = 'idea' | 'goal' | 'audience' | 'content_format' | 'cta' | 'duration';

const SLOT_ORDER: Slot[] = ['idea', 'goal', 'audience', 'content_format', 'cta', 'duration'];

const SLOT_QUESTION: Record<Slot, string> = {
  idea:
    "Let's build your strategy. In a sentence or two, what is this campaign about?",
  goal:
    'What is the primary goal? e.g. Brand Awareness, Lead Generation, Product Education, Product Launch, or Thought Leadership.',
  audience:
    'Who is the target audience? e.g. B2B Marketers, Founders, Marketing Leaders, or Developers.',
  content_format:
    'Which content formats (pick up to 2)? e.g. Short-form Video, Carousel Post, Newsletter / Email, Thread, Static Image.',
  cta:
    'What is the key message or call-to-action for the campaign?',
  duration:
    'How many weeks should the campaign run? (e.g. 4)',
};

function toFormatList(val: unknown): string[] {
  if (Array.isArray(val)) return val.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim());
  if (typeof val === 'string') return val.split(/[,;/]| and /i).map((x) => x.trim()).filter(Boolean);
  return [];
}

function toAudienceList(val: string | string[] | undefined | null): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val.filter((s) => typeof s === 'string' && s.trim());
  return String(val).split(/[,;]/).map((x) => x.trim()).filter(Boolean);
}

const AFFIRMATIVE = /^\s*(y|yes|yep|yeah|ok|okay|sure|go|proceed|generate|build( it)?|do it|sounds good|confirm(ed)?|let'?s go|👍)\s*[!.]*\s*$/i;

export function StrategyAIChat({ companyId, selectedWeek, onClearSelection }: Props) {
  const { state, setStrategicThemes, setStrategicCard, setIdeaSpine, setStrategyContext } = usePlannerSession();
  const themes = state.strategic_themes ?? [];
  const selectedTheme = selectedWeek != null ? themes.find((t) => t.week === selectedWeek) : null;
  const [history, setHistory] = useState<ChatTurn[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planConfirmed, setPlanConfirmed] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const scroll = () => setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);

  // ── Plan completeness, derived from session state ──────────────────────────
  const idea = state.idea_spine;
  const strat = state.strategy_context;
  const ideaText =
    (idea?.refined_title || idea?.title || '').trim() ||
    (idea?.refined_description || idea?.description || '').trim();
  const goalText = (strat?.campaign_goal || '').trim();
  const audienceFilled = toAudienceList(strat?.target_audience).length > 0;
  const contentFormatsFilled =
    toFormatList((strat as { content_formats?: unknown } | null)?.content_formats).length > 0;
  const ctaText = ((strat as { key_message?: string } | null)?.key_message || '').trim();
  const durationWeeks = Number(strat?.duration_weeks || 0);

  const filled: Record<Slot, boolean> = {
    idea: !!ideaText,
    goal: !!goalText,
    audience: audienceFilled,
    content_format: contentFormatsFilled,
    cta: !!ctaText,
    duration: durationWeeks > 0,
  };
  const nextSlot: Slot | null = SLOT_ORDER.find((s) => !filled[s]) ?? null;
  const planComplete = nextSlot === null;
  const hasThemes = themes.length > 0;

  // Phase: collect missing plan → confirm assembled plan → build/refine cards
  const phase: 'collect' | 'confirm' | 'cards' = hasThemes
    ? 'cards'
    : planComplete && planConfirmed
      ? 'cards'
      : planComplete
        ? 'confirm'
        : 'collect';

  // Seed the opening question once (after session state has hydrated).
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    if (hasThemes) { seededRef.current = true; return; }
    if (history.length > 0) { seededRef.current = true; return; }
    if (phase === 'collect' && nextSlot) {
      seededRef.current = true;
      setHistory([{ role: 'assistant', text: SLOT_QUESTION[nextSlot] }]);
    } else if (phase === 'confirm') {
      seededRef.current = true;
      setHistory([{ role: 'assistant', text: planSummary() + '\n\nReply "generate" to build your strategic theme cards, or tell me what to change (e.g. "goal: lead generation").' }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, nextSlot, hasThemes, history.length]);

  function planSummary(): string {
    const aud = toAudienceList(strat?.target_audience).join(', ');
    const fmts = toFormatList((strat as { content_formats?: unknown } | null)?.content_formats).join(', ');
    return [
      "Here's your plan:",
      `• Idea: ${ideaText || '—'}`,
      `• Goal: ${goalText || '—'}`,
      `• Audience: ${aud || '—'}`,
      `• Content formats: ${fmts || '—'}`,
      `• Message / CTA: ${ctaText || '—'}`,
      `• Duration: ${durationWeeks > 0 ? `${durationWeeks} weeks` : '—'}`,
    ].join('\n');
  }

  // Write a single slot into session state. Returns false if the value is unusable.
  function applySlot(slot: Slot, raw: string): boolean {
    const value = raw.trim();
    if (!value) return false;
    if (slot === 'idea') {
      const firstSentence = value.split(/(?<=[.!?])\s/)[0] ?? value;
      const title = (firstSentence.length > 90 ? firstSentence.slice(0, 90).trim() : firstSentence).trim();
      setIdeaSpine({
        title: title || value.slice(0, 90),
        description: value,
        origin: idea?.origin ?? 'direct',
        raw_input: value,
        selected_angle: idea?.selected_angle ?? null,
      });
      return true;
    }
    if (slot === 'goal') {
      setStrategyContext({ campaign_goal: value });
      return true;
    }
    if (slot === 'audience') {
      const list = toAudienceList(value);
      setStrategyContext({ target_audience: list.length > 1 ? list : value });
      return true;
    }
    if (slot === 'content_format') {
      const formats = toFormatList(value).slice(0, 2); // form allows up to 2
      if (formats.length === 0) return false;
      // content_formats is read by CampaignContextBar but not on the typed
      // StrategyContext — write it the same way the form does.
      setStrategyContext({ content_formats: formats } as never);
      return true;
    }
    if (slot === 'cta') {
      setStrategyContext({ key_message: value });
      return true;
    }
    // duration
    const n = parseInt(value.replace(/[^\d]/g, ''), 10);
    if (!Number.isFinite(n) || n <= 0) return false;
    setStrategyContext({ duration_weeks: Math.min(24, n) });
    return true;
  }

  // Explicit "field: value" override, allowed at any point in the plan phase.
  function parseFieldOverride(text: string): { slot: Slot; value: string } | null {
    const m = text.match(/^\s*(idea|goal|audience|content[_ ]?format|formats?|cta|message|duration)\s*[:\-]\s*(.+)$/is);
    if (!m) return null;
    const raw = m[1].toLowerCase().replace(/\s+/g, '_');
    const slot: Slot =
      raw === 'content_format' || raw === 'format' || raw === 'formats'
        ? 'content_format'
        : raw === 'cta' || raw === 'message'
          ? 'cta'
          : (raw as Slot);
    return { slot, value: m[2].trim() };
  }

  async function generateCards() {
    if (!companyId) { setError('Select a company first.'); return; }
    setLoading(true);
    setError(null);
    scroll();
    try {
      const body: Record<string, unknown> = {
        companyId,
        theme_source: 'ai',
        duration_weeks: durationWeeks || 4,
        strategy_context: strat
          ? {
              ...strat,
              duration_weeks: strat.duration_weeks ?? durationWeeks ?? 4,
              target_audience: Array.isArray(strat.target_audience)
                ? strat.target_audience.filter(Boolean)
                : strat.target_audience,
            }
          : { duration_weeks: durationWeeks || 4 },
        idea_spine: state.idea_spine,
        trend_context: state.trend_context,
      };
      const res = await fetchWithAuth('/api/planner/generate-themes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Generation failed');
      const raw: StrategicThemeEntry[] = Array.isArray(data.themes) ? data.themes : [];
      const cleaned = raw.filter((t) => typeof t.week === 'number' && typeof t.title === 'string');
      if (cleaned.length === 0) throw new Error('No themes were generated. Try refining the plan.');
      if (data?.strategic_card && typeof data.strategic_card === 'object' && !Array.isArray(data.strategic_card)) {
        setStrategicCard(data.strategic_card);
      }
      setStrategicThemes(cleaned);
      setHistory((h) => [
        ...h,
        { role: 'assistant', text: `Built ${cleaned.length} strategic theme cards from your plan. Now tell me how to refine them — e.g. "make week 3 about product education" or "sharpen the narrative arc".` },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not generate strategic cards');
    } finally {
      setLoading(false);
      scroll();
    }
  }

  async function refineThemes(text: string) {
    setLoading(true);
    setError(null);
    scroll();
    try {
      const res = await fetchWithAuth('/api/planner/chat-themes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          message: text,
          current_themes: themes,
          history: history.slice(-6),
          strategy_context: state.strategy_context ?? null,
          idea_spine: state.idea_spine ?? null,
          selected_week: selectedWeek ?? null,
          strategic_card: state.strategic_card ?? null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Request failed');
      const updatedThemes: StrategicThemeEntry[] = data.themes ?? themes;
      const reply: string = data.reply ?? 'Themes updated.';
      if (data?.strategic_card && typeof data.strategic_card === 'object' && !Array.isArray(data.strategic_card)) {
        setStrategicCard(data.strategic_card);
      }
      setStrategicThemes(updatedThemes);
      setHistory((h) => [...h, { role: 'assistant', text: reply }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setHistory((h) => h.slice(0, -1));
    } finally {
      setLoading(false);
      scroll();
    }
  }

  const handleSend = async () => {
    const text = message.trim();
    if (!text || loading) return;
    if (!companyId) { setError('Select a company first.'); return; }

    setHistory((h) => [...h, { role: 'user', text }]);
    setMessage('');
    setError(null);
    scroll();

    // ── Phase: refine existing cards ─────────────────────────────────────────
    if (phase === 'cards') {
      await refineThemes(text);
      return;
    }

    // ── Field override ("goal: ...") works in collect & confirm ─────────────
    const override = parseFieldOverride(text);
    if (override) {
      const ok = applySlot(override.slot, override.value);
      if (!ok) {
        setHistory((h) => [...h, { role: 'assistant', text: `I couldn't read that ${override.slot}. Please try again.` }]);
        return;
      }
      // Recompute happens on next render; ask whatever is still missing.
      setHistory((h) => [
        ...h,
        { role: 'assistant', text: `Updated ${override.slot}. ${nextQuestionAfterMutation(override.slot)}` },
      ]);
      return;
    }

    // ── Phase: confirm assembled plan ────────────────────────────────────────
    if (phase === 'confirm') {
      if (AFFIRMATIVE.test(text)) {
        await generateCards();
      } else {
        setHistory((h) => [
          ...h,
          { role: 'assistant', text: 'To change something, use e.g. "goal: lead generation" or "audience: founders". Reply "generate" when the plan looks right.' },
        ]);
      }
      return;
    }

    // ── Phase: collect the current missing slot ──────────────────────────────
    if (nextSlot) {
      const ok = applySlot(nextSlot, text);
      if (!ok) {
        setHistory((h) => [...h, { role: 'assistant', text: `I couldn't read that. ${SLOT_QUESTION[nextSlot]}` }]);
        return;
      }
      setHistory((h) => [...h, { role: 'assistant', text: nextQuestionAfterMutation(nextSlot) }]);
    }
  };

  // After a slot is written, the derived `filled`/`nextSlot` above are stale
  // for this render; recompute what to ask next from scratch.
  function nextQuestionAfterMutation(justSet: Slot): string {
    const recomputed: Record<Slot, boolean> = {
      idea: !!ideaText || justSet === 'idea',
      goal: !!goalText || justSet === 'goal',
      audience: audienceFilled || justSet === 'audience',
      content_format: contentFormatsFilled || justSet === 'content_format',
      cta: !!ctaText || justSet === 'cta',
      duration: durationWeeks > 0 || justSet === 'duration',
    };
    const next = SLOT_ORDER.find((s) => !recomputed[s]) ?? null;
    if (next) return SLOT_QUESTION[next];
    return planSummary() + '\n\nReply "generate" to build your strategic theme cards, or change a field (e.g. "audience: developers").';
  }

  const inputPlaceholder =
    phase === 'cards'
      ? selectedTheme
        ? `e.g. "Make this more about product education" or "Add urgency for Q4 push"…`
        : 'e.g. "Make week 3 focus on product education" or "Rewrite all for a technical audience"…'
      : phase === 'confirm'
        ? 'Reply "generate", or change a field e.g. "goal: lead generation"…'
        : nextSlot
          ? 'Type your answer…'
          : 'Type a message…';

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Current themes preview */}
      {hasThemes && (
        <div className="flex-shrink-0 px-4 pt-3 pb-2 border-b border-gray-100 bg-gray-50">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <Sparkles className="h-3 w-3" />
            Current Themes ({themes.length} weeks) — live preview
          </p>
          <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
            {themes.map((t) => (
              <div key={t.week} className="flex items-baseline gap-2">
                <span className="text-[10px] font-semibold text-indigo-500 w-12 flex-shrink-0">Wk {t.week}</span>
                <span className="text-xs text-gray-700 leading-snug">{t.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Plan progress (while building the plan) */}
      {!hasThemes && (
        <div className="flex-shrink-0 px-4 pt-3 pb-2 border-b border-gray-100 bg-gray-50">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <Sparkles className="h-3 w-3" />
            Building your plan
          </p>
          <div className="flex flex-wrap gap-1.5">
            {SLOT_ORDER.map((s) => (
              <span
                key={s}
                className={`text-[10px] px-2 py-0.5 rounded-full border ${
                  filled[s]
                    ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                    : 'bg-white border-gray-200 text-gray-400'
                }`}
              >
                {filled[s] ? '✓ ' : ''}{s[0].toUpperCase() + s.slice(1)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Selected card banner */}
      {selectedTheme && (
        <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 bg-indigo-50 border-b border-indigo-100">
          <span className="text-[10px] font-semibold text-indigo-600 uppercase tracking-wide">Editing</span>
          <span className="text-xs font-medium text-indigo-800 truncate flex-1">
            Week {selectedTheme.week} — {selectedTheme.title || 'Untitled'}
          </span>
          <button
            type="button"
            onClick={onClearSelection}
            title="Clear selection (chat will affect all themes)"
            className="flex-shrink-0 text-indigo-400 hover:text-indigo-600"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Chat history */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 min-h-0">
        {history.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-8 px-4">
            <Sparkles className="h-8 w-8 text-gray-200 mb-3" />
            <p className="text-xs text-gray-400 leading-relaxed">
              I'll help you complete the plan, then build your strategic theme cards.
            </p>
          </div>
        )}

        {history.map((turn, i) => (
          <div
            key={i}
            className={`text-sm rounded-lg px-3 py-2 max-w-[88%] leading-relaxed whitespace-pre-wrap ${
              turn.role === 'user'
                ? 'ml-auto bg-indigo-600 text-white'
                : 'bg-gray-100 text-gray-700'
            }`}
          >
            {turn.role === 'assistant' && hasThemes && (
              <div className="flex items-center gap-1 mb-1 text-[10px] font-semibold text-indigo-500 uppercase tracking-wide">
                <RefreshCw className="h-2.5 w-2.5" /> Themes updated
              </div>
            )}
            {turn.text}
          </div>
        ))}

        {loading && (
          <div className="bg-gray-100 text-gray-500 text-sm rounded-lg px-3 py-2 flex items-center gap-2 max-w-[88%]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {phase === 'cards' && hasThemes ? 'Rethinking themes…' : phase === 'confirm' ? 'Building strategic cards…' : 'Working…'}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {error && (
        <p className="flex-shrink-0 text-xs text-red-600 px-4 pb-1">{error}</p>
      )}

      {/* Confirm action button (plan ready, not yet generated) */}
      {phase === 'confirm' && !loading && (
        <div className="flex-shrink-0 px-4 pb-2">
          <button
            type="button"
            onClick={() => void generateCards()}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700"
          >
            <Sparkles className="h-4 w-4" />
            Generate Strategic Cards
          </button>
        </div>
      )}

      {/* Input */}
      <div className="flex-shrink-0 flex gap-2 items-end px-4 py-3 border-t border-gray-100">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
          placeholder={inputPlaceholder}
          rows={2}
          disabled={loading}
          className="flex-1 min-w-0 px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none disabled:bg-gray-50 disabled:text-gray-400"
        />
        <ChatVoiceButton
          onTranscription={setMessage}
          disabled={loading}
          title="Voice input"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={loading || !message.trim()}
          title="Send"
          className="flex-shrink-0 p-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
