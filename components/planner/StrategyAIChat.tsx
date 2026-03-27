/**
 * Strategy AI Chat
 * Chat interface to modify strategic theme cards using natural language.
 * Sits in the "AI Chat" sub-tab of the Strategy tab.
 */

import { useRef, useState } from 'react';
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

export function StrategyAIChat({ companyId, selectedWeek, onClearSelection }: Props) {
  const { state, setStrategicThemes, setStrategicCard } = usePlannerSession();
  const themes = state.strategic_themes ?? [];
  const selectedTheme = selectedWeek != null ? themes.find((t) => t.week === selectedWeek) : null;
  const [history, setHistory] = useState<ChatTurn[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const scroll = () => setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);

  const handleSend = async () => {
    const text = message.trim();
    if (!text || loading) return;
    if (!companyId) { setError('Select a company first.'); return; }
    if (themes.length === 0) { setError('Generate strategic themes first on the Plan tab, then come here to refine them.'); return; }

    setHistory((h) => [...h, { role: 'user', text }]);
    setMessage('');
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
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Current themes preview */}
      {themes.length > 0 && (
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
        {history.length === 0 && themes.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-8 px-4">
            <Sparkles className="h-8 w-8 text-gray-200 mb-3" />
            <p className="text-xs text-gray-400 leading-relaxed">
              Generate strategic themes on the <strong>Plan</strong> tab first,<br />
              then come back here to refine them with AI.
            </p>
          </div>
        )}

        {history.length === 0 && themes.length > 0 && (
          <div className="text-xs text-gray-400 leading-relaxed py-2">
            <p className="mb-2">Your {themes.length} themes are ready. You can ask me to:</p>
            <ul className="space-y-1 text-gray-400 list-disc list-inside">
              <li>Change a specific week&apos;s theme</li>
              <li>Make all themes focus on a different goal</li>
              <li>Sharpen the narrative arc across the campaign</li>
              <li>Rewrite themes for a different audience</li>
              <li>Add urgency or seasonal context to specific weeks</li>
            </ul>
          </div>
        )}

        {history.map((turn, i) => (
          <div
            key={i}
            className={`text-sm rounded-lg px-3 py-2 max-w-[88%] leading-relaxed ${
              turn.role === 'user'
                ? 'ml-auto bg-indigo-600 text-white'
                : 'bg-gray-100 text-gray-700'
            }`}
          >
            {turn.role === 'assistant' && (
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
            Rethinking themes…
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {error && (
        <p className="flex-shrink-0 text-xs text-red-600 px-4 pb-1">{error}</p>
      )}

      {/* Input */}
      <div className="flex-shrink-0 flex gap-2 items-end px-4 py-3 border-t border-gray-100">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
          placeholder={
            themes.length === 0
              ? 'Generate themes on the Plan tab first…'
              : selectedTheme
              ? `e.g. "Make this more about product education" or "Add urgency for Q4 push"…`
              : 'e.g. "Make week 3 focus on product education" or "Rewrite all for a technical audience"…'
          }
          rows={2}
          disabled={loading || themes.length === 0}
          className="flex-1 min-w-0 px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none disabled:bg-gray-50 disabled:text-gray-400"
        />
        <ChatVoiceButton
          onTranscription={setMessage}
          disabled={loading || themes.length === 0}
          title="Voice input"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={loading || !message.trim() || themes.length === 0}
          title="Send"
          className="flex-shrink-0 p-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
