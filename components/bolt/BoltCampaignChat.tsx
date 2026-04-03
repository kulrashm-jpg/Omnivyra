/**
 * BoltCampaignChat
 * AI chat panel for brainstorming/refining campaign topics in the BOLT strategy builder.
 * Built on the same structure as StrategyAIChat — uses ChatVoiceButton + fetchWithAuth.
 */

import { useRef, useState } from 'react';
import { Loader2, Send, Sparkles } from 'lucide-react';
import { fetchWithAuth } from '../community-ai/fetchWithAuth';
import ChatVoiceButton from '../ChatVoiceButton';

interface ChatTurn { role: 'user' | 'assistant'; text: string; }

interface BoltChatContext {
  topic?: string;
  goal?: string;
  audience?: string;
  strategicFocus?: string[];
  duration?: number;
}

interface Props {
  companyId?: string | null;
  context: BoltChatContext;
  onApplyTopic?: (topic: string) => void;
}

const STARTER_HINTS = [
  'Suggest a campaign topic for my goal',
  'Help me make my topic more specific',
  'What angle should I take?',
  'Give me a trending campaign idea',
];

export function BoltCampaignChat({ companyId, context, onApplyTopic }: Props) {
  const [history, setHistory] = useState<ChatTurn[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const scroll = () => setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);

  const handleSend = async (overrideText?: string) => {
    const text = (overrideText ?? message).trim();
    if (!text || loading) return;
    if (!companyId) { setError('No company selected.'); return; }

    setHistory((h) => [...h, { role: 'user', text }]);
    setMessage('');
    setLoading(true);
    setError(null);
    scroll();

    try {
      const res = await fetchWithAuth('/api/bolt/campaign-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          message: text,
          history: history.slice(-8),
          context,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Request failed');

      const reply: string = data.reply ?? 'Here are some ideas…';
      const suggestedTopic: string | null = data.suggested_topic ?? null;

      setHistory((h) => [...h, { role: 'assistant', text: reply, ...(suggestedTopic ? { suggestedTopic } : {}) } as ChatTurn & { suggestedTopic?: string }]);
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
          const withTopic = turn as ChatTurn & { suggestedTopic?: string };
          return (
            <div key={i} className={`flex ${turn.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`text-xs rounded-xl px-3 py-2.5 max-w-[88%] leading-relaxed ${
                turn.role === 'user'
                  ? 'bg-indigo-600 text-white rounded-br-sm'
                  : 'bg-gray-100 text-gray-800 rounded-bl-sm'
              }`}>
                {turn.text}
                {turn.role === 'assistant' && withTopic.suggestedTopic && onApplyTopic && (
                  <button
                    type="button"
                    onClick={() => onApplyTopic(withTopic.suggestedTopic!)}
                    className="block mt-2 text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 underline text-left"
                  >
                    Use &ldquo;{withTopic.suggestedTopic}&rdquo; as topic →
                  </button>
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
