/**
 * AIBlogCardModal
 *
 * AI-assisted blog card creation modal for Blog Intelligence.
 * Users describe what they want to write, AI refines it into a structured recommendation card.
 *
 * Features:
 * - Chat-based iterative refinement (topic, intent, audience, style)
 * - AI generates a preview card recommendation
 * - User can save and add to recommendations list
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  X, Send, Loader2, Sparkles, CheckCircle2, ArrowRight,
  Lightbulb, Target, Zap,
} from 'lucide-react';
import { fetchWithAuth } from '../community-ai/fetchWithAuth';
import ChatVoiceButton from '../ChatVoiceButton';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: number;
  type: 'user' | 'ai';
  message: string;
  timestamp: string;
}

interface BlogCardPreview {
  topic: string;
  intent: 'awareness' | 'authority' | 'conversion' | 'retention';
  audience?: string;
  reason?: string;
  priority?: 'high' | 'medium' | 'low';
  tone?: string;
  writingStyle?: string;
  relatedTopics?: string[];
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  companyId: string;
  companyName: string;
  companyContext: string;
  existingTopics?: string[];
  writingStyleGuide?: string;
  onCardCreated?: (card: BlogCardPreview) => void | Promise<void>;
  contentLabel?: string;
  contentType?: string;
  contentModeLabel?: string;
}

const INTENT_OPTIONS = [
  { value: 'awareness', label: 'Awareness — introduce a concept', icon: Lightbulb },
  { value: 'authority', label: 'Authority — establish expertise', icon: Target },
  { value: 'conversion', label: 'Conversion — drive action', icon: Zap },
  { value: 'retention', label: 'Retention — deepen practice', icon: Target },
];

// ── Modal ─────────────────────────────────────────────────────────────────────

const STORY_DIRECTION_OPTIONS = [
  { value: 'launch moment', label: 'Launch moment', icon: Zap },
  { value: 'customer moment', label: 'Customer moment', icon: Target },
  { value: 'founder lesson', label: 'Founder lesson', icon: Lightbulb },
  { value: 'team turning point', label: 'Team turning point', icon: Sparkles },
];

export default function AIBlogCardModal({
  isOpen,
  onClose,
  companyId,
  companyName,
  companyContext,
  existingTopics = [],
  writingStyleGuide = '',
  onCardCreated,
  contentLabel = 'blog',
  contentType = 'blog',
  contentModeLabel,
}: Props) {
  const normalizedCompanyName = companyName?.trim() || 'your company';
  const normalizedContentType = contentType.trim().toLowerCase();
  const isStory = normalizedContentType === 'story';
  const openingMessage = (() => {
    if (normalizedContentType === 'post') {
      return `Tell me the post angle, launch, or insight you want to share. I'll use ${normalizedCompanyName} context and keep this quick.`;
    }

    if (isStory) {
      return `Tell me the story moment, launch, customer situation, or turning point you want to shape. I'll use ${normalizedCompanyName}'s company context for audience, positioning, and point of view.`;
    }

    return `Tell me the ${contentLabel} idea or topic you want to shape. I'll use ${normalizedCompanyName}'s company context for audience, positioning, and strategic fit.`;
  })();
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 1,
      type: 'ai',
      message: openingMessage,
      timestamp: new Date().toLocaleTimeString(),
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  // Elapsed-seconds tracker for the in-flight AI call. Drives the
  // extended progress UI that swaps in once the request crosses 5s so
  // the user sees a reason to wait instead of a static "Thinking…".
  const [elapsedSec, setElapsedSec] = useState(0);
  const [conversationPhase, setConversationPhase] = useState<'topic' | 'intent' | 'details' | 'preview'>('topic');
  const [cardPreview, setCardPreview] = useState<BlogCardPreview | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [cardAwaitingConfirmation, setCardAwaitingConfirmation] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (!isOpen) return;
    setMessages([
      {
        id: 1,
        type: 'ai',
        message: openingMessage,
        timestamp: new Date().toLocaleTimeString(),
      },
    ]);
    setInput('');
    setConversationPhase('topic');
    setCardPreview(null);
    setCardAwaitingConfirmation(false);
  }, [isOpen, openingMessage]);

  // Tick the elapsed-seconds counter while a request is in flight.
  // Resets to 0 the moment loading flips off so the next call starts fresh.
  useEffect(() => {
    if (!isLoading) {
      setElapsedSec(0);
      return;
    }
    const startedAt = Date.now();
    const tick = () => setElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
    const interval = setInterval(tick, 500);
    return () => clearInterval(interval);
  }, [isLoading]);

  if (!isOpen) return null;

  const sendMessage = async () => {
    if (!input.trim()) return;

    const userMessage: ChatMessage = {
      id: Date.now(),
      type: 'user',
      message: input,
      timestamp: new Date().toLocaleTimeString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      console.log('📤 Sending message to blog-card-chat API:', input);
      
      // Build conversation history for context
      const conversationHistory = messages.map((m) => ({
        role: m.type === 'user' ? 'user' : 'assistant',
        content: m.message,
      }));

      const response = await fetchWithAuth('/api/ai/blog-card-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: input,
          companyId,
          contentType,
          conversation: conversationHistory,
          metadata: {
            companyName,
            companyContext,
            existingTopics,
            currentPhase: conversationPhase,
            contentLabel,
            contentModeLabel,
            useCompanyContextDefaults: true,
            avoidRedundantQuestions: true,
          },
        }),
      });

      console.log('📥 API response status:', response.status);

      if (response.status === 401) {
        throw new Error('Your session has expired. Please refresh the page and log back in.');
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('❌ API Error:', errorData);
        throw new Error(errorData.error || `API error: ${response.status}`);
      }

      const data = await response.json();

      // Check if the AI has generated a complete card preview
      if (data.done && data.card) {
        const cardPreview: BlogCardPreview = {
          topic: data.card.topic,
          intent: data.card.intent,
          audience: data.card.audience,
          reason: data.card.reason,
          priority: data.card.priority,
          tone: data.card.tone,
          writingStyle: data.card.writingStyle,
          relatedTopics: data.card.relatedTopics,
        };
        setCardPreview(cardPreview);
        setCardAwaitingConfirmation(true);

        const previewMessage: ChatMessage = {
          id: Date.now() + 1,
          type: 'ai',
          message: `Perfect! I've created a strategic ${contentLabel} card based on our conversation. Here's the recommendation:\n\n**Topic:** ${cardPreview.topic}\n**Intent:** ${cardPreview.intent}\n**Audience:** ${cardPreview.audience}\n**Reason:** ${cardPreview.reason}\n\nWould you like to save this card?`,
          timestamp: new Date().toLocaleTimeString(),
        };
        setMessages((prev) => [...prev, previewMessage]);
      } else {
        // AI is asking the next question - add to conversation
        const aiText = data.nextQuestion || `What else would you like to tell me about this ${contentLabel} topic?`;
        const aiMessage: ChatMessage = {
          id: Date.now() + 1,
          type: 'ai',
          message: aiText,
          timestamp: new Date().toLocaleTimeString(),
        };
        setMessages((prev) => [...prev, aiMessage]);

        // Auto-advance phase based on conversation progress
        if (conversationPhase === 'topic' && messages.length >= 3) {
          setConversationPhase('intent');
        } else if (conversationPhase === 'intent' && messages.length >= 5) {
          setConversationPhase('details');
        } else if (conversationPhase === 'details' && messages.length >= 7) {
          setConversationPhase('preview');
        }
      }
    } catch (err) {
      console.error('Chat error:', err);
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      const errorMessage: ChatMessage = {
        id: Date.now() + 1,
        type: 'ai',
        message: `⚠️ ${errorMsg}`,
        timestamp: new Date().toLocaleTimeString(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveCard = async () => {
    if (!cardPreview) return;

    setIsSaving(true);
    try {
      // Call parent callback to add the card
      if (onCardCreated) {
        await onCardCreated(cardPreview);
      }

      // Show success and prepare to close
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now(),
          type: 'ai',
          message: `Perfect! I've added "${cardPreview.topic}" to your recommendations. You can now start writing or refine it further!`,
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);

      // Reset states
      setCardAwaitingConfirmation(false);
      setCardPreview(null);

      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err) {
      console.error('Error saving card:', err);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now(),
          type: 'ai',
          message: err instanceof Error ? `Unable to continue: ${err.message}` : 'Unable to continue with this card right now.',
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
    } finally {
      setIsSaving(false);
    }
  };

  const handleQuickIntent = (intent: string) => {
    const intentText = isStory
      ? `Shape this as a ${intent} using the company context for audience and point of view.`
      : `I want to write from a ${intent} perspective.`;
    setInput(intentText);
  };


  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] rounded-2xl border border-gray-200 bg-white shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-100">
              <Sparkles className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <h2 className="font-bold text-gray-900">Create Custom {contentLabel.charAt(0).toUpperCase() + contentLabel.slice(1)} Card</h2>
              <p className="text-xs text-gray-500 mt-0.5">AI-assisted topic refinement for {normalizedCompanyName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            type="button"
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Chat messages */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-3 ${msg.type === 'user' ? 'flex-row-reverse' : ''}`}
            >
              {msg.type === 'ai' && (
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                  <Sparkles className="h-4 w-4 text-blue-600" />
                </div>
              )}
              <div
                className={`px-3 py-2 rounded-lg text-sm max-w-sm ${
                  msg.type === 'user'
                    ? 'bg-blue-600 text-white rounded-br-none'
                    : 'bg-gray-100 text-gray-900 rounded-bl-none'
                }`}
              >
                <p className="break-words">{msg.message}</p>
              </div>
            </div>
          ))}

          {/* Quick intent buttons (show during intent phase) */}
          {conversationPhase === 'intent' && normalizedContentType !== 'post' && !isLoading && (
            <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-gray-100">
              {(isStory ? STORY_DIRECTION_OPTIONS : INTENT_OPTIONS).map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => handleQuickIntent(value)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-colors text-xs font-medium text-gray-700"
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* Loading indicator. Static "Thinking…" for the first 2s;
              richer progress tracker (stage label + elapsed timer +
              progress bar) once the request crosses the 2s threshold
              so the user sees the call is still active. */}
          {isLoading && elapsedSec < 2 && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />
              </div>
              <div className="px-3 py-2 rounded-lg bg-gray-100 text-gray-500 text-sm">
                Thinking...
              </div>
            </div>
          )}

          {isLoading && elapsedSec >= 2 && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />
              </div>
              <div className="flex-1 max-w-sm rounded-lg bg-gray-50 border border-gray-200 px-3 py-2.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-gray-700">
                    {elapsedSec < 15
                      ? 'Analyzing company context…'
                      : elapsedSec < 30
                        ? 'Refining topic structure…'
                        : elapsedSec < 60
                          ? 'Polishing the recommendation…'
                          : 'Still working — this is taking longer than usual…'}
                  </p>
                  <span className="text-[10px] tabular-nums text-gray-500 shrink-0">
                    {elapsedSec}s
                  </span>
                </div>
                {/* Indeterminate progress bar — purely visual signal that
                    work is in progress (we don't have streaming progress
                    from the API). Capped width grows with elapsed time
                    so longer waits feel like measurable progress. */}
                <div className="h-1 rounded-full bg-gray-200 overflow-hidden">
                  <div
                    className="h-full bg-blue-600 transition-all duration-500 ease-out"
                    style={{
                      width: `${Math.min(95, 25 + elapsedSec * 2)}%`,
                    }}
                  />
                </div>
                {elapsedSec >= 30 && (
                  <p className="text-[11px] text-gray-500">
                    The AI is still composing your recommendation. You can keep waiting or close this dialog and try again.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Card preview (show when awaiting confirmation) */}
          {cardPreview && cardAwaitingConfirmation && (
            <div className="mt-4 p-4 rounded-xl border border-blue-200 bg-blue-50">
              <div className="flex items-start gap-2 mb-3">
                <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h3 className="font-bold text-gray-900">{cardPreview.topic}</h3>
                  <p className="text-xs text-gray-600 mt-1">{cardPreview.reason}</p>
                </div>
              </div>

              <div className="space-y-2 text-xs mb-4">
                {cardPreview.intent && (
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-600">Intent:</span>
                    <span className="px-2 py-1 rounded bg-white text-gray-700 capitalize">
                      {cardPreview.intent}
                    </span>
                  </div>
                )}
                {cardPreview.priority && (
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-600">Priority:</span>
                    <span
                      className={`px-2 py-1 rounded text-white capitalize ${
                        cardPreview.priority === 'high'
                          ? 'bg-red-500'
                          : cardPreview.priority === 'medium'
                          ? 'bg-amber-500'
                          : 'bg-gray-400'
                      }`}
                    >
                      {cardPreview.priority}
                    </span>
                  </div>
                )}
                {cardPreview.audience && (
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-600">Target Audience:</span>
                    <span className="text-gray-700">{cardPreview.audience}</span>
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleSaveCard}
                  disabled={isSaving}
                  className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white rounded-lg py-2 font-semibold transition-colors flex items-center justify-center gap-2 text-sm"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Confirm & Add
                </button>
                <button
                  onClick={() => {
                    setCardAwaitingConfirmation(false);
                    setCardPreview(null);
                    setConversationPhase('details');
                  }}
                  className="flex-1 px-3 py-2 border border-gray-300 hover:bg-gray-50 rounded-lg font-medium transition-colors text-sm"
                >
                  Revise
                </button>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div className="shrink-0 border-t border-gray-200 px-6 py-4 space-y-2">
          {cardAwaitingConfirmation ? (
            // Show empty when awaiting confirmation - the buttons above handle it
            <div />
          ) : (
            <div className="space-y-2">
              <div className="flex gap-2 items-center">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && !isLoading) {
                      sendMessage();
                    }
                  }}
                  placeholder={isStory ? 'Describe the moment, customer situation, launch, or turning point...' : `Describe your ${contentLabel} idea or ask for suggestions...`}
                  disabled={isLoading}
                  className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-gray-100 disabled:cursor-not-allowed"
                />
                <ChatVoiceButton
                  onTranscription={(t) => setInput(t)}
                  disabled={isLoading}
                  context="blog"
                  className="p-2.5 rounded-lg transition-colors shrink-0 bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    sendMessage();
                  }}
                  disabled={isLoading || !input.trim()}
                  type="button"
                  title="Send message"
                  className="p-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white transition-colors shrink-0 disabled:cursor-not-allowed"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {conversationPhase === 'topic' && isStory && (
            <p className="text-xs text-gray-500">
              Tip: Give the story moment. Company context will supply audience, positioning, and strategic point of view.
            </p>
          )}

          {/* Tips */}
          {conversationPhase === 'topic' && !isStory && (
            <p className="text-xs text-gray-500">
              💡 Tip: Describe a problem your audience faces or a topic they're asking about
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
