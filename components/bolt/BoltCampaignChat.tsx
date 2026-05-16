/**
 * BoltCampaignChat
 * AI chat panel for brainstorming/refining campaign topics in the BOLT strategy builder.
 * Built on the same structure as StrategyAIChat — uses ChatVoiceButton + fetchWithAuth.
 */

import { useRef, useState } from 'react';
import { Loader2, Send, Sparkles } from 'lucide-react';
import { fetchWithAuth } from '../community-ai/fetchWithAuth';
import ChatVoiceButton from '../ChatVoiceButton';

interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
  suggestedTopic?: string;
  suggestedDescription?: string;
  suggestedGoals?: string[];
  suggestedTone?: string[];
  suggestedAudience?: string;
}

interface BoltChatContext {
  topic?: string;
  description?: string;
  goals?: string[];
  goal?: string;        // back-compat with older callers
  tone?: string[];
  audience?: string;
  strategicFocus?: string[];
  duration?: number;
  // Execution-awareness signals — let the AI suggest within constraints
  // the planner can actually execute (e.g. don't suggest video-first themes
  // when only LinkedIn-text formats are selected).
  selectedPlatforms?: string[];
  selectedFormats?: string[];
  formatFrequency?: Record<string, number>;
  outcomeView?: string; // 'week_plan' | 'daily_plan' | 'schedule'
}

interface AcceptedSuggestionPayload {
  topic: string;
  description?: string;
  goals?: string[];
  tone?: string[];
  audience?: string;
  acceptedAt: string;
}

interface Props {
  companyId?: string | null;
  context: BoltChatContext;
  /**
   * Applies the AI's full Campaign Brief suggestion. Only fields the AI
   * actually returned get applied — omitted fields leave the user's existing
   * input alone, so a topic-only suggestion never wipes out a manually-typed
   * description / goals / tone / audience.
   */
  onApplySuggestion?: (suggestion: {
    topic: string;
    description?: string;
    goals?: string[];
    tone?: string[];
    audience?: string;
  }) => void;
  /** Persisted memory of suggestions the user accepted in this campaign draft. */
  acceptedSuggestions?: AcceptedSuggestionPayload[];
  /** Clears acceptedSuggestions in the parent and the local chat history. */
  onResetMemory?: () => void;
}

const STARTER_HINTS = [
  'Suggest a campaign topic for my goal',
  'Help me make my topic more specific',
  'What angle should I take?',
  'Give me a trending campaign idea',
];

export function BoltCampaignChat({
  companyId,
  context,
  onApplySuggestion,
  acceptedSuggestions,
  onResetMemory,
}: Props) {
  const [history, setHistory] = useState<ChatTurn[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scroll = () => setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);

  const handleSend = async (overrideText?: string) => {
    const text = (overrideText ?? message).trim();
    if (!text || loading) return;
    if (!companyId) { setError('No company selected.'); return; }

    // Clear input FIRST, then update history — prevents stale closure keeping old text
    setMessage('');
    if (inputRef.current) inputRef.current.value = '';
    setHistory((h) => [...h, { role: 'user', text }]);
    setLoading(true);
    setError(null);
    scroll();

    // Passed-over = suggestions we showed earlier in THIS chat session that
    // the user didn't accept (their topic isn't in acceptedSuggestions).
    // Derived per-send rather than tracked statefully; that keeps the chat
    // logic stateless and avoids spurious "passed over" flags on refresh.
    const acceptedTopics = new Set((acceptedSuggestions ?? []).map((s) => s.topic));
    const passedOver = history
      .filter((turn) =>
        turn.role === 'assistant' && turn.suggestedTopic && !acceptedTopics.has(turn.suggestedTopic)
      )
      .slice(-5)
      .map((turn) => ({
        topic: turn.suggestedTopic!,
        // We don't send the full passed-over Brief — just enough for the
        // AI to recognise "you already showed this, don't repeat it".
        description_clip: turn.suggestedDescription ? turn.suggestedDescription.slice(0, 140) : undefined,
      }));

    try {
      const res = await fetchWithAuth('/api/bolt/campaign-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          message: text,
          history: history.slice(-8),
          context,
          // Campaign Memory grounding — see /api/bolt/campaign-chat for how
          // these get folded into the system prompt with token budgeting.
          accepted_suggestions: (acceptedSuggestions ?? []).slice(-5),
          passed_over_suggestions: passedOver,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Request failed');

      const reply: string = data.reply ?? 'Here are some ideas…';
      const suggestedTopic: string | null = data.suggested_topic ?? null;
      const suggestedDescription: string | null = data.suggested_description ?? null;
      const suggestedGoals: string[] = Array.isArray(data.suggested_goals) ? data.suggested_goals : [];
      const suggestedTone: string[] = Array.isArray(data.suggested_tone) ? data.suggested_tone : [];
      const suggestedAudience: string | null = data.suggested_audience ?? null;

      setHistory((h) => [
        ...h,
        {
          role: 'assistant',
          text: reply,
          // Brief fields are only meaningful alongside a topic (API enforces
          // this pairing — we mirror it defensively on the client).
          ...(suggestedTopic ? { suggestedTopic } : {}),
          ...(suggestedTopic && suggestedDescription ? { suggestedDescription } : {}),
          ...(suggestedTopic && suggestedGoals.length > 0 ? { suggestedGoals } : {}),
          ...(suggestedTopic && suggestedTone.length > 0 ? { suggestedTone } : {}),
          ...(suggestedTopic && suggestedAudience ? { suggestedAudience } : {}),
        },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setHistory((h) => h.slice(0, -1));
    } finally {
      setLoading(false);
      scroll();
    }
  };

  // Reset both the on-screen chat AND the parent's accepted-suggestions
  // memory. Brief fields (topic / description / goals / tone / audience)
  // are deliberately NOT touched — spec: "keep campaign fields intact".
  const handleResetMemory = () => {
    setHistory([]);
    setError(null);
    onResetMemory?.();
  };

  const hasAnyMemory = history.length > 0 || (acceptedSuggestions?.length ?? 0) > 0;

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* Memory toolbar — only shown when there's something to reset, so it
          stays invisible on a fresh empty chat. */}
      {hasAnyMemory && (
        <div className="flex-shrink-0 flex items-center justify-between px-4 py-1.5 border-b border-gray-100 bg-gray-50/50">
          <span className="text-[10px] text-gray-500">
            {(acceptedSuggestions?.length ?? 0) > 0
              ? `${acceptedSuggestions!.length} accepted direction${acceptedSuggestions!.length > 1 ? 's' : ''} remembered`
              : 'Chat in progress'}
          </span>
          <button
            type="button"
            onClick={handleResetMemory}
            className="text-[10px] text-gray-500 hover:text-red-600 underline"
            title="Clear AI memory and chat history (Brief fields stay)"
          >
            Reset AI direction
          </button>
        </div>
      )}

      {/* Chat history */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
        {history.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-6 px-3">
            <Sparkles className="h-7 w-7 text-indigo-200 mb-3" />
            <p className="text-xs text-gray-400 leading-relaxed mb-4">
              Ask AI to suggest a campaign topic, refine your idea, or brainstorm angles.
            </p>
            <div className="flex flex-wrap gap-1.5 justify-center">
              {STARTER_HINTS.map((hint) => (
                <button
                  key={hint}
                  type="button"
                  onClick={() => handleSend(hint)}
                  className="text-[11px] px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 transition-colors"
                >
                  {hint}
                </button>
              ))}
            </div>
          </div>
        )}

        {history.map((turn, i) => {
          return (
            <div key={i} className={`flex ${turn.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`text-xs rounded-xl px-3 py-2.5 max-w-[88%] leading-relaxed ${
                turn.role === 'user'
                  ? 'bg-indigo-600 text-white rounded-br-sm'
                  : 'bg-gray-100 text-gray-800 rounded-bl-sm'
              }`}>
                {turn.text}
                {turn.role === 'assistant' && turn.suggestedTopic && onApplySuggestion && (
                  <div className="mt-2.5 pt-2.5 border-t border-gray-200/70 space-y-1.5">
                    {/* Preview card — shows the entire Campaign Brief the
                        button will paste so the user can see every field
                        before committing. Each section renders only when the
                        AI actually returned that field — partial briefs are
                        allowed. */}
                    <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-400">
                      Suggested topic
                    </div>
                    <div className="text-[12px] font-semibold text-gray-900 leading-snug">
                      {turn.suggestedTopic}
                    </div>
                    {turn.suggestedDescription && (
                      <>
                        <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-400 pt-1">
                          Suggested description
                        </div>
                        <div className="text-[11px] text-gray-700 leading-relaxed">
                          {turn.suggestedDescription}
                        </div>
                      </>
                    )}
                    {turn.suggestedGoals && turn.suggestedGoals.length > 0 && (
                      <>
                        <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-400 pt-1">
                          Suggested goals
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {turn.suggestedGoals.map((g) => (
                            <span key={g} className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700">{g}</span>
                          ))}
                        </div>
                      </>
                    )}
                    {turn.suggestedTone && turn.suggestedTone.length > 0 && (
                      <>
                        <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-400 pt-1">
                          Suggested tone
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {turn.suggestedTone.map((t) => (
                            <span key={t} className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700">{t}</span>
                          ))}
                        </div>
                      </>
                    )}
                    {turn.suggestedAudience && (
                      <>
                        <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-400 pt-1">
                          Suggested audience
                        </div>
                        <div className="text-[11px] text-gray-700 leading-snug">
                          {turn.suggestedAudience}
                        </div>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        onApplySuggestion({
                          topic: turn.suggestedTopic!,
                          // Only pass fields the AI actually returned. The
                          // hook's applyChatSuggestion does the same guarding
                          // again so existing user input is preserved.
                          ...(turn.suggestedDescription ? { description: turn.suggestedDescription } : {}),
                          ...(turn.suggestedGoals && turn.suggestedGoals.length > 0 ? { goals: turn.suggestedGoals } : {}),
                          ...(turn.suggestedTone && turn.suggestedTone.length > 0 ? { tone: turn.suggestedTone } : {}),
                          ...(turn.suggestedAudience ? { audience: turn.suggestedAudience } : {}),
                        })
                      }
                      className="mt-1.5 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-indigo-600 text-white text-[11px] font-semibold hover:bg-indigo-700 transition-colors"
                    >
                      Use this →
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 text-gray-500 text-xs rounded-xl rounded-bl-sm px-3 py-2.5 flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Thinking…
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {error && (
        <p className="flex-shrink-0 text-xs text-red-600 px-4 pb-1">{error}</p>
      )}

      {/* Input */}
      <div className="flex-shrink-0 flex gap-2 items-end px-3 py-3 border-t border-gray-100">
        <textarea
          ref={inputRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), void handleSend())}
          placeholder="Ask AI to help refine your campaign topic…"
          rows={2}
          disabled={loading}
          className="flex-1 min-w-0 px-3 py-2 border border-gray-300 rounded-lg text-xs resize-none disabled:bg-gray-50 disabled:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-300"
        />
        <ChatVoiceButton
          onTranscription={setMessage}
          disabled={loading}
          title="Voice input"
        />
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={loading || !message.trim()}
          title="Send"
          className="flex-shrink-0 p-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
