/**
 * AI Content Improvement Suggestions Panel
 *
 * Shows quick-apply improvement suggestions for the current content brief.
 * - Quick-win buttons visible upfront (1-click apply)
 * - Expandable "Modify with AI" panel for detailed suggestions
 * - Each suggestion can be applied directly to update the content
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Sparkles, ChevronDown, ChevronUp, Check, Zap, Target, Type, Search, MessageSquare, Loader2 } from 'lucide-react';
import { fetchWithAuth } from '../community-ai/fetchWithAuth';

type Suggestion = {
  id: string;
  category: 'hook' | 'structure' | 'engagement' | 'seo' | 'cta' | 'tone';
  title: string;
  description: string;
  before: string;
  after: string;
  impact: 'high' | 'medium' | 'low';
  applyField: string;
};

type SuggestionData = {
  suggestions: Suggestion[];
  overallScore: number;
  quickWins: string[];
};

interface AISuggestionPanelProps {
  companyId: string | undefined;
  topic: string;
  objective: string;
  targetAudience: string;
  contentType: string;
  platform: string;
  hook?: string;
  keyPoints?: string[];
  cta?: string;
  narrativeStyle?: string;
  onApplySuggestion?: (field: string, value: string) => void;
}

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  hook: Zap,
  structure: Type,
  engagement: MessageSquare,
  seo: Search,
  cta: Target,
  tone: Sparkles,
};

const IMPACT_COLORS: Record<string, string> = {
  high: 'bg-red-50 text-red-700 border-red-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low: 'bg-blue-50 text-blue-700 border-blue-200',
};

export default function AISuggestionPanel({
  companyId,
  topic,
  objective,
  targetAudience,
  contentType,
  platform,
  hook,
  keyPoints,
  cta,
  narrativeStyle,
  onApplySuggestion,
}: AISuggestionPanelProps) {
  const [data, setData] = useState<SuggestionData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [panelMinimized, setPanelMinimized] = useState(false);
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());

  const fetchSuggestions = useCallback(async () => {
    if (!companyId || !topic) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth('/api/ai/content-suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          topic,
          objective,
          targetAudience,
          contentType,
          platform,
          hook,
          keyPoints,
          cta,
          narrativeStyle,
        }),
      });
      if (!res.ok) throw new Error('Failed to get suggestions');
      const result = await res.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, [companyId, topic, objective, targetAudience, contentType, platform, hook, keyPoints, cta, narrativeStyle]);

  // Auto-fetch on mount
  useEffect(() => {
    if (topic && companyId) fetchSuggestions();
  }, [topic, companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleApply = (suggestion: Suggestion) => {
    if (onApplySuggestion) {
      onApplySuggestion(suggestion.applyField, suggestion.after);
    }
    setAppliedIds((prev) => new Set([...prev, suggestion.id]));
  };

  if (!topic) return null;

  const highImpact = data?.suggestions.filter((s) => s.impact === 'high') ?? [];
  const otherSuggestions = data?.suggestions.filter((s) => s.impact !== 'high') ?? [];

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      {/* Header — always visible, clickable to minimize/expand */}
      <button
        type="button"
        onClick={() => data && setPanelMinimized((v) => !v)}
        className="w-full px-5 py-3 flex items-center justify-between border-b border-gray-100 hover:bg-gray-50 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-violet-100">
            <Sparkles className="h-4 w-4 text-violet-600" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900">AI Improvement Suggestions</h3>
            {data && !loading && (
              <p className="text-[11px] text-gray-500">
                Content score: <span className="font-semibold">{data.overallScore}/10</span>
                {' · '}{data.suggestions.length} suggestions
                {panelMinimized && appliedIds.size > 0 && ` · ${appliedIds.size} applied ✓`}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!data && !loading && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); fetchSuggestions(); }}
              onKeyDown={(e) => e.key === 'Enter' && (e.stopPropagation(), fetchSuggestions())}
              className="text-xs px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 font-medium transition-colors cursor-pointer"
            >
              Analyze Content
            </span>
          )}
          {data && !panelMinimized && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); fetchSuggestions(); }}
              onKeyDown={(e) => e.key === 'Enter' && (e.stopPropagation(), fetchSuggestions())}
              className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 font-medium transition-colors cursor-pointer"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Refresh'}
            </span>
          )}
          {data && (
            panelMinimized ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronUp className="h-4 w-4 text-gray-400" />
          )}
        </div>
      </button>

      {!panelMinimized && loading && !data && (
        <div className="px-5 py-6 flex items-center justify-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Analyzing your content...
        </div>
      )}

      {!panelMinimized && error && (
        <div className="px-5 py-3 text-xs text-red-600 bg-red-50">{error}</div>
      )}

      {!panelMinimized && data && (
        <>
          {/* Quick Wins — always visible as pill buttons */}
          {data.quickWins.length > 0 && (
            <div className="px-5 py-3 flex flex-wrap gap-2 border-b border-gray-50">
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide self-center mr-1">Quick wins:</span>
              {data.quickWins.map((win, i) => (
                <span key={i} className="text-[11px] px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium">
                  {win}
                </span>
              ))}
            </div>
          )}

          {/* High-impact suggestions — always visible as apply buttons */}
          {highImpact.length > 0 && (
            <div className="px-5 py-3 space-y-2">
              {highImpact.map((s) => {
                const Icon = CATEGORY_ICONS[s.category] ?? Sparkles;
                const isApplied = appliedIds.has(s.id);
                return (
                  <div key={s.id} className="flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-violet-50 to-indigo-50 border border-violet-100">
                    <div className="p-1 rounded-md bg-violet-100 shrink-0 mt-0.5">
                      <Icon className="h-3.5 w-3.5 text-violet-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-semibold text-gray-900">{s.title}</p>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-bold uppercase ${IMPACT_COLORS[s.impact]}`}>
                          {s.impact}
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-600 mt-0.5">{s.description}</p>
                      {s.after && s.after !== s.before && (
                        <div className="mt-2 p-2 rounded-md bg-white border border-gray-100 text-[11px] text-gray-700">
                          <span className="font-medium text-violet-600">Suggestion:</span> {s.after}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleApply(s)}
                      disabled={isApplied}
                      className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                        isApplied
                          ? 'bg-emerald-100 text-emerald-700 cursor-default'
                          : 'bg-violet-600 text-white hover:bg-violet-700'
                      }`}
                    >
                      {isApplied ? (
                        <span className="flex items-center gap-1"><Check className="h-3 w-3" /> Applied</span>
                      ) : (
                        'Apply'
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Expandable section for all other suggestions */}
          {otherSuggestions.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="w-full px-5 py-2.5 flex items-center justify-between text-left text-xs font-medium text-gray-600 hover:bg-gray-50 border-t border-gray-100 transition-colors"
              >
                <span className="flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-violet-500" />
                  {expanded ? 'Hide' : 'Show'} {otherSuggestions.length} more suggestions
                </span>
                {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
              {expanded && (
                <div className="px-5 pb-4 space-y-2">
                  {otherSuggestions.map((s) => {
                    const Icon = CATEGORY_ICONS[s.category] ?? Sparkles;
                    const isApplied = appliedIds.has(s.id);
                    return (
                      <div key={s.id} className="flex items-start gap-3 p-3 rounded-lg border border-gray-100 hover:border-gray-200 transition-colors">
                        <div className="p-1 rounded-md bg-gray-100 shrink-0 mt-0.5">
                          <Icon className="h-3.5 w-3.5 text-gray-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-xs font-semibold text-gray-800">{s.title}</p>
                            <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-bold uppercase ${IMPACT_COLORS[s.impact]}`}>
                              {s.impact}
                            </span>
                          </div>
                          <p className="text-[11px] text-gray-500 mt-0.5">{s.description}</p>
                          {s.after && s.after !== s.before && (
                            <div className="mt-1.5 text-[11px] text-gray-600">
                              <span className="font-medium">→</span> {s.after}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleApply(s)}
                          disabled={isApplied}
                          className={`shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                            isApplied
                              ? 'bg-emerald-50 text-emerald-600 cursor-default'
                              : 'bg-gray-100 text-gray-700 hover:bg-violet-100 hover:text-violet-700'
                          }`}
                        >
                          {isApplied ? <Check className="h-3 w-3" /> : 'Apply'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
