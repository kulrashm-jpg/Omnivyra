/**
 * AISuggestionPanel - AI reply suggestions from GET /api/engagement/suggestions.
 * Displays three suggestions with "Use Reply" and selected-option refinement.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { recordEngagementEvent } from '@/lib/engagementTelemetry';

export type Suggestion = {
  id: string;
  text: string;
  explanation_tag?: string;
};

export interface AISuggestionPanelProps {
  messageId: string | null;
  organizationId: string;
  threadId?: string | null;
  onSelectSuggestion: (text: string) => void;
  onExecuted?: () => void;
  visible?: boolean;
  className?: string;
}

async function fetchSuggestions(
  organizationId: string,
  messageId: string
): Promise<Suggestion[]> {
  const params = new URLSearchParams({
    message_id: messageId,
    organization_id: organizationId,
    organizationId: organizationId,
  });
  const res = await fetch(`/api/engagement/suggestions?${params.toString()}`, {
    credentials: 'include',
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error || res.statusText || 'Failed to load suggestions');
  }
  if (json?.error) {
    throw new Error(json.error);
  }
  const list = Array.isArray(json?.suggestions) ? json.suggestions : [];
  return list
    .map((s: { id?: string; text?: string; explanation_tag?: string }) => ({
      id: s.id ?? `sug-${Math.random().toString(36).slice(2)}`,
      text: String(s.text ?? '').trim(),
      explanation_tag: s.explanation_tag,
    }))
    .filter((s: Suggestion) => s.text.length > 0);
}

export const AISuggestionPanel = React.memo(function AISuggestionPanel({
  messageId,
  organizationId,
  threadId,
  onSelectSuggestion,
  visible = true,
  className = '',
}: AISuggestionPanelProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selectedSuggestionId, setSelectedSuggestionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refinePrompt, setRefinePrompt] = useState('');
  const [refining, setRefining] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);

  const loadSuggestions = useCallback(async () => {
    if (!messageId?.trim() || !organizationId?.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const list = await fetchSuggestions(organizationId, messageId);
      setSuggestions(list);
      setSelectedSuggestionId(list[0]?.id ?? null);
      setRefinePrompt('');
      setRefineError(null);
      if (list.length === 0) {
        setError('AI returned no suggestions for this message.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load suggestions');
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, [messageId, organizationId]);

  useEffect(() => {
    if (!messageId?.trim() || !organizationId?.trim()) {
      setSuggestions([]);
      setSelectedSuggestionId(null);
      setError(null);
      setRefinePrompt('');
      setRefineError(null);
      return;
    }
    loadSuggestions();
  }, [messageId, organizationId, loadSuggestions]);

  const selectedSuggestion = useMemo(
    () => suggestions.find((suggestion) => suggestion.id === selectedSuggestionId) ?? null,
    [suggestions, selectedSuggestionId]
  );

  const handleUseReply = useCallback(
    (text: string) => {
      void recordEngagementEvent('ai_suggestion_used', {
        organization_id: organizationId,
        thread_id: threadId ?? undefined,
        metadata: { message_id: messageId ?? undefined },
      });
      onSelectSuggestion(text);
    },
    [organizationId, threadId, messageId, onSelectSuggestion]
  );

  const handleRefineSelected = useCallback(async () => {
    if (!selectedSuggestion || !refinePrompt.trim()) return;
    if (!threadId?.trim()) {
      setRefineError('Thread context is required to refine this reply.');
      return;
    }

    setRefining(true);
    setRefineError(null);
    try {
      const res = await fetch('/api/engagement/refine-suggestion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          organization_id: organizationId,
          thread_id: threadId,
          draft: selectedSuggestion.text,
          instruction: refinePrompt.trim(),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error || body?.message || 'Failed to refine reply');
      }
      const refined = String(body?.refined ?? '').trim();
      if (!refined) throw new Error('AI returned an empty refinement');

      setSuggestions((current) =>
        current.map((suggestion) =>
          suggestion.id === selectedSuggestion.id
            ? { ...suggestion, text: refined, explanation_tag: 'refined' }
            : suggestion
        )
      );
      setRefinePrompt('');
    } catch (err) {
      setRefineError(err instanceof Error ? err.message : 'Failed to refine reply');
    } finally {
      setRefining(false);
    }
  }, [organizationId, refinePrompt, selectedSuggestion, threadId]);

  if (!visible) return null;

  if (loading) {
    return (
      <div className={`rounded-lg border border-slate-200 bg-slate-50 p-4 ${className}`}>
        <h4 className="text-sm font-medium text-slate-800 mb-2">AI Suggestions</h4>
        <div className="space-y-2 animate-pulse">
          <div className="h-12 rounded bg-slate-200" />
          <div className="h-12 rounded bg-slate-200" />
          <div className="h-12 rounded bg-slate-200" />
        </div>
      </div>
    );
  }

  if (suggestions.length === 0) {
    return (
      <div className={`rounded-lg border border-slate-200 bg-slate-50 p-4 ${className}`}>
        <h4 className="text-sm font-medium text-slate-800 mb-2">AI Suggestions</h4>
        <p className="text-sm text-slate-500">
          {error ?? 'No AI suggestions available for this message yet.'}
        </p>
        <button
          type="button"
          onClick={loadSuggestions}
          className="mt-2 text-sm text-blue-600 hover:text-blue-800"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className={`rounded-lg border border-slate-200 bg-slate-50 p-4 ${className}`}>
      <h4 className="text-sm font-medium text-slate-800 mb-2">AI Suggestions</h4>
      <div className="space-y-2">
        {suggestions.map((s) => {
          const selected = s.id === selectedSuggestionId;
          return (
            <div
              key={s.id}
              className={`flex cursor-pointer items-start justify-between gap-2 rounded border p-2 transition ${
                selected
                  ? 'border-blue-300 bg-blue-50 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.18)]'
                  : 'border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50/40'
              }`}
            >
              <button
                type="button"
                onClick={() => setSelectedSuggestionId(s.id)}
                className="min-w-0 flex-1 text-left"
              >
                <div className="mb-1 flex items-center gap-2">
                  {selected ? (
                    <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                      Selected
                    </span>
                  ) : null}
                  {s.explanation_tag && (
                    <span className="text-xs text-slate-500">{s.explanation_tag}</span>
                  )}
                </div>
                <p className="text-sm text-slate-800">{s.text}</p>
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setSelectedSuggestionId(s.id);
                  handleUseReply(s.text);
                }}
                className="shrink-0 px-2 py-1 text-sm font-medium text-blue-600 hover:text-blue-800"
              >
                Use Reply
              </button>
            </div>
          );
        })}
      </div>

      <div className="mt-4 border-t border-slate-200 pt-3">
        <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
          Refine with AI
        </label>
        <textarea
          value={refinePrompt}
          onChange={(event) => setRefinePrompt(event.target.value)}
          disabled={!selectedSuggestion}
          rows={2}
          placeholder="Example: make it warmer, shorter, or ask for the resume first"
          className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-slate-100"
        />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void handleRefineSelected()}
            disabled={refining || !selectedSuggestion || !refinePrompt.trim()}
            className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {refining ? 'Refining...' : 'Refine reply'}
          </button>
          {selectedSuggestion ? (
            <span className="text-xs text-slate-500">Refines the selected suggestion.</span>
          ) : null}
        </div>
        {refineError ? (
          <p className="mt-2 text-sm text-red-600">{refineError}</p>
        ) : null}
      </div>

      <button
        type="button"
        onClick={loadSuggestions}
        className="mt-3 text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50"
      >
        Regenerate
      </button>
    </div>
  );
});
