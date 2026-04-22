/**
 * AISuggestionPanel - AI reply suggestions from GET /api/engagement/suggestions.
 * Displays minimum 3 suggestions with "Use Reply" button.
 */

import React, { useState, useEffect, useCallback } from 'react';
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSuggestions = useCallback(async () => {
    if (!messageId?.trim() || !organizationId?.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const list = await fetchSuggestions(organizationId, messageId);
      setSuggestions(list);
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
      setError(null);
      return;
    }
    loadSuggestions();
  }, [messageId, organizationId, loadSuggestions]);

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
        {suggestions.map((s) => (
          <div
            key={s.id}
            className="flex items-center justify-between gap-2 rounded border border-slate-200 bg-white p-2"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm text-slate-800 line-clamp-3">{s.text}</p>
              {s.explanation_tag && (
                <span className="text-xs text-slate-500 mt-0.5 block">{s.explanation_tag}</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => handleUseReply(s.text)}
              className="shrink-0 text-sm font-medium text-blue-600 hover:text-blue-800 px-2 py-1"
            >
              Use Reply
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={loadSuggestions}
        className="mt-2 text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50"
      >
        Regenerate
      </button>
    </div>
  );
});
