'use client';

import { useState } from 'react';
import { ArrowRight, Loader2, RefreshCw, Sparkles, Wand2 } from 'lucide-react';
import type { ContentSuggestion } from '../../lib/content/contentSuggestionContract';

/**
 * P1.6 — "Suggest with AI".
 *
 * Renders ONE concrete recommendation and three actions: Accept & Continue,
 * Revise, and Suggest another. It deliberately does not host a conversation —
 * the failure mode this replaces is a chat that keeps asking the user what they
 * want to write about.
 *
 * `onAccept` hands the suggestion back to the host page, which feeds it into the
 * EXISTING generation flow. This component never calls a generation endpoint,
 * which is what keeps "Revise" from producing final content.
 */

type Props = {
  companyId: string;
  contentType: string;
  formatLabel?: string;
  /** Context only — never makes the master draft platform-specific. */
  platform?: string;
  objective?: string;
  accentClassName?: string;
  onAccept: (suggestion: ContentSuggestion) => void | Promise<void>;
};

type Phase = 'idle' | 'loading' | 'ready' | 'accepting';

export default function SuggestWithAIPanel({
  companyId,
  contentType,
  formatLabel,
  platform,
  objective,
  accentClassName = 'text-violet-700',
  onAccept,
}: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [suggestion, setSuggestion] = useState<ContentSuggestion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revising, setRevising] = useState(false);
  const [revisionInstruction, setRevisionInstruction] = useState('');
  const [revisionIndex, setRevisionIndex] = useState(0);

  const busy = phase === 'loading' || phase === 'accepting';

  const requestSuggestion = async (instruction?: string) => {
    if (!companyId || busy) return;
    setPhase('loading');
    setError(null);
    const nextRevisionIndex = instruction ? revisionIndex + 1 : 0;

    try {
      const response = await fetch('/api/content/suggest', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId,
          content_type: contentType,
          format_label: formatLabel,
          platform,
          objective,
          revision_instruction: instruction || undefined,
          previous_suggestion: instruction ? suggestion : undefined,
          revision_index: instruction ? nextRevisionIndex : undefined,
        }),
      });

      const data = (await response.json().catch(() => null)) as { suggestion?: ContentSuggestion; error?: string } | null;
      if (!response.ok || !data?.suggestion) {
        throw new Error(data?.error || 'Could not generate a suggestion right now.');
      }

      setSuggestion(data.suggestion);
      setRevisionIndex(nextRevisionIndex);
      setRevising(false);
      setRevisionInstruction('');
      setPhase('ready');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not generate a suggestion right now.');
      setPhase(suggestion ? 'ready' : 'idle');
    }
  };

  const acceptSuggestion = async () => {
    if (!suggestion || busy) return;
    setPhase('accepting');
    setError(null);
    try {
      await onAccept(suggestion);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not continue with this suggestion.');
      setPhase('ready');
    }
  };

  const signals = suggestion?.context_used;
  const signalSummary = signals
    ? [
        signals.company_profile ? 'company profile' : '',
        signals.engagement_signals > 0
          ? `${signals.engagement_signals} engagement signal${signals.engagement_signals === 1 ? '' : 's'}`
          : '',
        signals.campaign_context ? 'campaign context' : '',
        signals.user_input ? 'your input' : '',
      ].filter(Boolean)
    : [];

  return (
    <div
      data-testid="suggest-with-ai-panel"
      className="mt-4 rounded-2xl border border-violet-200 bg-white/90 p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold text-gray-900">
            <Sparkles className="h-4 w-4 text-violet-500" />
            Suggest with AI
          </h3>
          <p className="mt-1 text-sm text-gray-600">
            Let AI read your company context and engagement signals and recommend what to publish next.
            You can accept it, revise it, or ask for another.
          </p>
        </div>

        {!suggestion ? (
          <button
            type="button"
            data-testid="suggest-with-ai-trigger"
            onClick={() => void requestSuggestion()}
            disabled={busy || !companyId}
            className="inline-flex items-center gap-2 rounded-xl border border-violet-300 bg-white px-4 py-2.5 text-sm font-semibold text-violet-700 transition hover:bg-violet-50 disabled:opacity-50"
          >
            {phase === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            {phase === 'loading' ? 'Thinking…' : 'Suggest with AI'}
          </button>
        ) : null}
      </div>

      {error ? (
        <p data-testid="suggest-with-ai-error" className="mt-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}

      {suggestion ? (
        <div data-testid="suggest-with-ai-suggestion" className="mt-4 space-y-3">
          <div className="rounded-xl border border-violet-100 bg-violet-50/60 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-violet-500">Recommended</p>
            <p className="mt-1 text-base font-semibold text-gray-900">{suggestion.topic}</p>
            <p className="mt-2 text-sm leading-6 text-gray-700">{suggestion.brief}</p>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <Detail label="Angle" value={suggestion.angle} />
            <Detail label="Objective" value={suggestion.objective} />
            <Detail label="Audience" value={suggestion.audience} />
          </div>

          <div className="rounded-xl border border-gray-100 bg-gray-50/80 px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400">Why this</p>
            <p className="mt-1 text-sm text-gray-700">{suggestion.reason}</p>
            {/* Only signals actually used are named — no claim of history or
                graph coverage that does not exist yet. */}
            <p className="mt-2 text-xs text-gray-500">
              {signalSummary.length > 0
                ? `Based on: ${signalSummary.join(' · ')}`
                : 'Based on the selected content type only — no company or engagement signals were available.'}
            </p>
          </div>

          {suggestion.revision ? (
            <p data-testid="suggest-with-ai-revision-note" className="text-xs text-violet-600">
              Revision {suggestion.revision.revision_index}: “{suggestion.revision.instruction}”
            </p>
          ) : null}

          {revising ? (
            <div data-testid="suggest-with-ai-revise-form" className="rounded-xl border border-violet-100 bg-white p-3">
              <label className="text-xs font-semibold text-gray-700" htmlFor="suggest-revision">
                What should change?
              </label>
              <input
                id="suggest-revision"
                data-testid="suggest-with-ai-revision-input"
                type="text"
                value={revisionInstruction}
                onChange={(event) => setRevisionInstruction(event.target.value)}
                placeholder="e.g. make it more provocative, focus on founders, make it educational"
                className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  data-testid="suggest-with-ai-revise-submit"
                  onClick={() => void requestSuggestion(revisionInstruction.trim())}
                  disabled={busy || !revisionInstruction.trim()}
                  className="rounded-full bg-violet-600 px-3.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {phase === 'loading' ? 'Revising…' : 'Update suggestion'}
                </button>
                <button
                  type="button"
                  onClick={() => { setRevising(false); setRevisionInstruction(''); }}
                  className="rounded-full bg-white px-3.5 py-1.5 text-xs font-semibold text-gray-600 ring-1 ring-gray-200"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
            <button
              type="button"
              data-testid="suggest-with-ai-accept"
              onClick={() => void acceptSuggestion()}
              disabled={busy}
              className={`inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:opacity-50`}
            >
              {phase === 'accepting' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Accept &amp; Continue
              <ArrowRight className="h-4 w-4" />
            </button>

            <button
              type="button"
              data-testid="suggest-with-ai-revise"
              onClick={() => setRevising(true)}
              disabled={busy}
              className={`inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold ${accentClassName} disabled:opacity-50`}
            >
              Revise
            </button>

            <button
              type="button"
              data-testid="suggest-with-ai-another"
              onClick={() => void requestSuggestion()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-600 disabled:opacity-50"
            >
              <RefreshCw className="h-4 w-4" />
              Suggest another
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/80 px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400">{label}</p>
      <p className="mt-1 text-sm text-gray-700">{value}</p>
    </div>
  );
}
