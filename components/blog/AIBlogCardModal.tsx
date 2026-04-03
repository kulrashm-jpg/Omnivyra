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
  Lightbulb, Target, Zap, Mic, MicOff,
} from 'lucide-react';
import { fetchWithAuth } from '../community-ai/fetchWithAuth';

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
  onCardCreated?: (card: BlogCardPreview) => void;
}

const INTENT_OPTIONS = [
  { value: 'awareness', label: 'Awareness — introduce a concept', icon: Lightbulb },
  { value: 'authority', label: 'Authority — establish expertise', icon: Target },
  { value: 'conversion', label: 'Conversion — drive action', icon: Zap },
  { value: 'retention', label: 'Retention — deepen practice', icon: Target },
];

// ── Modal ─────────────────────────────────────────────────────────────────────

export default function AIBlogCardModal({
  isOpen,
  onClose,
  companyId,
  companyName,
  companyContext,
  existingTopics = [],
  writingStyleGuide = '',
  onCardCreated,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 1,
      type: 'ai',
      message: `Hi! I'm here to help you create an amazing blog card for ${companyName}. What topic or problem would you like to write about?`,
      timestamp: new Date().toLocaleTimeString(),
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [conversationPhase, setConversationPhase] = useState<'topic' | 'intent' | 'details' | 'preview'>('topic');
  const [cardPreview, setCardPreview] = useState<BlogCardPreview | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [cardAwaitingConfirmation, setCardAwaitingConfirmation] = useState(false);
  const recognitionRef = useRef<any>(null);
  const transcriptRef = useRef('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

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
          conversation: conversationHistory,
          metadata: {
            companyName,
            companyContext,
            existingTopics,
            currentPhase: conversationPhase,
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
          message: `Perfect! I've created a strategic blog card based on our conversation. Here's the recommendation:\n\n**Topic:** ${cardPreview.topic}\n**Intent:** ${cardPreview.intent}\n**Audience:** ${cardPreview.audience}\n**Reason:** ${cardPreview.reason}\n\nWould you like to save this card?`,
          timestamp: new Date().toLocaleTimeString(),
        };
        setMessages((prev) => [...prev, previewMessage]);
      } else {
        // AI is asking the next question - add to conversation
        const aiText = data.nextQuestion || 'What else would you like to tell me about this blog topic?';
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
        onCardCreated(cardPreview);
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
    } finally {
      setIsSaving(false);
    }
  };

  const handleQuickIntent = (intent: string) => {
    const intentText = `I want to write from a ${intent} perspective.`;
    setInput(intentText);
  };

  const stopVoiceRecording = () => {
    if (recognitionRef.current && isRecording) {
      try {
        recognitionRef.current.stop();
      } catch (_) {}
      recognitionRef.current = null;
      setIsRecording(false);
    }
  };

  const startVoiceRecording = async () => {
    console.log('🎤 startVoiceRecording called');
    
    // Kill any existing recognition
    if (recognitionRef.current) {
      console.log('🔪 Aborting existing recognition...');
      try {
        recognitionRef.current.stop();
      } catch (_) {}
      recognitionRef.current = null;
    }

    // Small delay to ensure cleanup
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    console.log('Speech API available:', !!SpeechRecognition);
    
    if (!SpeechRecognition) {
      console.error('❌ No SpeechRecognition API');
      setVoiceError('Voice input not supported. Use Chrome or Edge.');
      return;
    }

    console.log('🔨 Creating NEW speech recognition...');
    setVoiceError(null);
    transcriptRef.current = '';
    setIsRecording(true);

    try {
      const recognition = new SpeechRecognition();
      console.log('✅ New recognition object created');
      
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      const SILENCE_TIMEOUT_MS = 3500;
      let silenceTimerRef: ReturnType<typeof setTimeout> | null = null;

      const clearSilenceTimer = () => {
        if (silenceTimerRef) {
          clearTimeout(silenceTimerRef);
          silenceTimerRef = null;
        }
      };

      const resetSilenceTimer = () => {
        clearSilenceTimer();
        silenceTimerRef = setTimeout(() => {
          console.log('⏱️ Silence timeout - stopping recognition');
          if (recognitionRef.current === recognition) {
            try {
              recognition.stop();
            } catch (_) {}
          }
        }, SILENCE_TIMEOUT_MS);
      };

      resetSilenceTimer();

      recognition.onstart = () => {
        console.log('✅ ONSTART FIRED - listening for audio');
      };

      recognition.onresult = (event: any) => {
        console.log('📝 ONRESULT FIRED - transcript coming in');
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const t = event.results[i][0]?.transcript?.trim();
          if (!t) continue;
          console.log(`  "${t}" (final: ${event.results[i].isFinal})`);
          if (event.results[i].isFinal) {
            transcriptRef.current = transcriptRef.current
              ? `${transcriptRef.current} ${t}`
              : t;
          } else {
            interim = interim ? `${interim} ${t}` : t;
          }
        }
        const full = `${transcriptRef.current} ${interim}`.trim();
        console.log(`  Final: "${full}"`);
        setInput(full);
        resetSilenceTimer();
      };

      recognition.onerror = (event: any) => {
        console.error('❌ ONERROR FIRED:', event.error, event.message);
        clearSilenceTimer();
        if (event.error === 'not-allowed') {
          setVoiceError('Microphone access denied. Enable in browser settings.');
        } else if (event.error === 'no-speech') {
          setVoiceError('No speech detected. Please speak into your microphone.');
        } else if (event.error !== 'aborted') {
          setVoiceError(event.message || `Voice error: ${event.error}`);
        }
        setIsRecording(false);
      };

      recognition.onend = () => {
        console.log('🛑 ONEND FIRED');
        clearSilenceTimer();
        recognitionRef.current = null;
        setIsRecording(false);
      };

      recognitionRef.current = recognition;
      console.log('📍 Ref stored. Calling start()...');
      recognition.start();
      console.log('✔️ start() called - should see onstart next');
    } catch (err) {
      console.error('❌ Exception:', err);
      setVoiceError('Could not start voice recording.');
      setIsRecording(false);
    }
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
              <h2 className="font-bold text-gray-900">Create Custom Blog Card</h2>
              <p className="text-xs text-gray-500 mt-0.5">AI-assisted topic refinement for {companyName}</p>
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
          {conversationPhase === 'intent' && !isLoading && (
            <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-gray-100">
              {INTENT_OPTIONS.map(({ value, label, icon: Icon }) => (
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

          {/* Loading indicator */}
          {isLoading && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />
              </div>
              <div className="px-3 py-2 rounded-lg bg-gray-100 text-gray-500 text-sm">
                Thinking...
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
              {voiceError && (
                <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{voiceError}</p>
              )}
              <div className="flex gap-2 items-center">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && !isLoading && !isRecording) {
                      sendMessage();
                    }
                  }}
                  placeholder="Describe your blog idea or ask for suggestions..."
                  disabled={isLoading}
                  className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-gray-100 disabled:cursor-not-allowed"
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (isRecording) {
                      stopVoiceRecording();
                    } else {
                      startVoiceRecording();
                    }
                  }}
                  disabled={isLoading}
                  title={isRecording ? 'Stop recording' : 'Start voice recording'}
                  className={`p-2.5 rounded-lg transition-colors shrink-0 cursor-pointer ${
                    isRecording
                      ? 'bg-red-100 text-red-600 animate-pulse'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {isRecording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </button>
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

          {/* Tips */}
          {conversationPhase === 'topic' && (
            <p className="text-xs text-gray-500">
              💡 Tip: Describe a problem your audience faces or a topic they're asking about
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
