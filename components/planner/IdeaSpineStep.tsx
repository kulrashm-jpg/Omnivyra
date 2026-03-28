/**
 * Idea Spine Step
 * Collects campaign idea spine from free text, recommendation, or opportunity context.
 * Supports AI refinement via "Refine with AI" button.
 */

import React, { useEffect, useState } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import { usePlannerSession, type IdeaSpine } from './plannerSessionStore';
import { fetchWithAuth } from '../community-ai/fetchWithAuth';

export interface IdeaSpineStepProps {
  /** Prefilled from recommendation context */
  recommendation_context?: Record<string, unknown> | null;
  /** Prefilled from opportunity context */
  opportunity_context?: Record<string, unknown> | null;
  /** Prefilled initial idea (e.g. from URL) */
  initial_idea?: string | null;
  /** Company ID for profile context in AI refinement */
  companyId?: string | null;
  onComplete?: (output: IdeaSpine) => void;
}

export function IdeaSpineStep({
  recommendation_context,
  opportunity_context,
  initial_idea,
  companyId,
  onComplete,
}: IdeaSpineStepProps) {
  const { state, setIdeaSpine } = usePlannerSession();
  const spine = state.campaign_design?.idea_spine;
  const [title, setTitle] = useState(spine?.title ?? '');
  const [description, setDescription] = useState(spine?.description ?? '');
  const [origin, setOrigin] = useState<IdeaSpine['origin']>(
    spine?.origin ?? 'direct'
  );
  const [sourceId, setSourceId] = useState<string | null>(spine?.source_id ?? null);
  const [selectedAngle, setSelectedAngle] = useState<string | null>(spine?.selected_angle ?? null);
  const [refining, setRefining] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);
  const [normalizedAngles, setNormalizedAngles] = useState<string[]>([]);

  useEffect(() => {
    if (recommendation_context) {
      const t =
        (recommendation_context.polished_title as string) ??
        (recommendation_context.trend_topic as string) ??
        (recommendation_context.topic as string) ??
        '';
      const d = (recommendation_context.summary as string) ?? '';
      setTitle(t);
      setDescription(d);
      setOrigin('recommendation');
      setSourceId((recommendation_context.id as string) ?? null);
    } else if (opportunity_context) {
      const t = (opportunity_context.title as string) ?? '';
      const d = (opportunity_context.summary as string) ?? '';
      setTitle(t);
      setDescription(d);
      setOrigin('opportunity');
      setSourceId((opportunity_context.id as string) ?? null);
    } else if (initial_idea) {
      setDescription(initial_idea);
      setTitle(initial_idea.slice(0, 100));
      setOrigin('direct');
      setSourceId(null);
    }
  }, [recommendation_context, opportunity_context, initial_idea]);

  const handleRefine = async () => {
    const ideaText = description.trim() || title.trim();
    if (!ideaText) {
      setRefineError('Enter an idea in the description or title first.');
      return;
    }
    setRefining(true);
    setRefineError(null);
    try {
      const res = await fetchWithAuth('/api/campaign-planner/refine-idea', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idea_text: ideaText,
          companyId: companyId || undefined,
          recommendation_context: recommendation_context || undefined,
          opportunity_context: opportunity_context || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Refinement failed');
      setTitle(data.refined_title ?? title);
      setDescription(data.refined_description ?? description);
      setNormalizedAngles(Array.isArray(data.normalized_angles) ? data.normalized_angles : []);
    } catch (e) {
      setRefineError(e instanceof Error ? e.message : 'Failed to refine idea');
    } finally {
      setRefining(false);
    }
  };

  const handleSave = () => {
    const validAngle =
      selectedAngle && normalizedAngles.includes(selectedAngle) ? selectedAngle : undefined;
    const output: IdeaSpine = {
      title: title.trim() || 'New campaign idea',
      description: description.trim(),
      origin,
      source_id: sourceId,
      raw_input: description.trim() || undefined,
      refined_title: title.trim() || undefined,
      refined_description: description.trim() || undefined,
      selected_angle: validAngle ?? undefined,
    };
    setIdeaSpine(output);
    onComplete?.(output);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Campaign Idea</h2>
        <p className="text-sm text-gray-500 mt-1">
          Capture the core idea for your campaign. This becomes the foundation for your strategy.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Title *</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Q2 Thought Leadership on AI Productivity"
          className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe your campaign idea, goals, or context..."
          rows={4}
          className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
        />
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <button
          type="button"
          onClick={handleRefine}
          disabled={refining || (!description.trim() && !title.trim())}
          className="px-4 py-2 rounded-xl border-2 border-indigo-200 text-indigo-700 font-medium hover:bg-indigo-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {refining ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Refining...
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              Refine with AI
            </>
          )}
        </button>
        {refineError && (
          <span className="text-sm text-red-600">{refineError}</span>
        )}
      </div>

      {normalizedAngles.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Campaign direction (required)</label>
          <div className="flex flex-wrap gap-2">
            {normalizedAngles.map((angle) => (
              <button
                key={angle}
                type="button"
                onClick={() =>
                  setSelectedAngle(selectedAngle === angle ? null : angle)
                }
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border-2 transition-colors ${
                  selectedAngle === angle
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                    : 'border-gray-200 hover:border-gray-300 text-gray-700'
                }`}
              >
                {angle.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
        </div>
      )}

      {(recommendation_context || opportunity_context) && (
        <p className="text-xs text-gray-500">
          Origin: {origin === 'recommendation' ? 'Recommendation' : 'Opportunity'}
          {sourceId && ` (ID: ${sourceId.slice(0, 8)}...)`}
        </p>
      )}

      <button
        onClick={handleSave}
        disabled={!title.trim() || (normalizedAngles.length > 0 && !selectedAngle)}
        className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Continue
      </button>
    </div>
  );
}
