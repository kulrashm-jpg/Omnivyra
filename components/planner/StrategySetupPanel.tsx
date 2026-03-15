/**
 * Strategy Setup Panel
 * Part of two-row planner layout: Context Mode, Goal, Audience, Message/CTA,
 * Opportunity Suggestions, Strategic Themes.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { usePlannerSession, type StrategicThemeEntry } from './plannerSessionStore';
import EngineContextPanel from '../recommendations/EngineContextPanel';
import UnifiedContextModeSelector, {
  type ContextMode,
  type FocusModule,
} from '../recommendations/engine-framework/UnifiedContextModeSelector';
import { Sparkles, Loader2, Palette, RotateCcw, Trash2 } from 'lucide-react';
import { MultiSelectDropdown } from '../ui/dropdown';

const TO_UNIFIED: Record<string, ContextMode> = {
  full_company_context: 'FULL',
  minimal: 'FOCUSED',
  none: 'NONE',
};
const TO_PLANNER: Record<'FULL' | 'FOCUSED' | 'NONE', 'full_company_context' | 'minimal' | 'none'> = {
  FULL: 'full_company_context',
  FOCUSED: 'minimal',
  NONE: 'none',
};

const TARGET_AUDIENCE_OPTIONS = [
  'B2B Marketers',
  'Founders / Entrepreneurs',
  'Marketing Leaders',
  'Sales Teams',
  'Product Managers',
  'Developers',
  'General Consumers',
] as const;

function toAudienceArray(val: string | string[] | undefined | null): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val.filter((s) => typeof s === 'string' && s.trim());
  const s = String(val).trim();
  if (!s) return [];
  return s.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
}

export interface StrategySetupPanelProps {
  companyId?: string | null;
  campaignId?: string | null;
  recommendation_context?: Record<string, unknown> | null;
  opportunity_context?: Record<string, unknown> | null;
  onOpportunityApplied?: () => void;
}

export function StrategySetupPanel({
  companyId,
  campaignId,
  recommendation_context,
  opportunity_context,
  onOpportunityApplied,
}: StrategySetupPanelProps) {
  const {
    state,
    setIdeaSpine,
    setStrategyContext,
    setStrategicThemes,
    clearStrategicThemes,
    setSourceIds,
    setCampaignDesign,
    setPlannerEntryMode,
  } = usePlannerSession();
  const strat = state.execution_plan?.strategy_context;
  const recommendedAudience = state.recommended_audience ?? null;

  const targetAudienceList = toAudienceArray(strat?.target_audience);
  const keyMessage = (strat as { key_message?: string } | null)?.key_message ?? '';

  const applyAudience = (audience: string[]) => {
    const base = strat ?? { duration_weeks: 12, platforms: [], posting_frequency: {}, content_mix: [], campaign_goal: '', target_audience: '' };
    setStrategyContext({ ...base, target_audience: audience });
  };

  const handleContextModeChange = useCallback(
    (mode: 'FULL' | 'FOCUSED' | 'NONE') => {
      const plannerMode = TO_PLANNER[mode];
      setCampaignDesign({ company_context_mode: plannerMode, trend_context: null });
    },
    [setCampaignDesign]
  );

  const handleModulesChange = useCallback(
    (modules: FocusModule[]) => {
      setCampaignDesign({ focus_modules: modules });
    },
    [setCampaignDesign]
  );

  const fetchWithAuth = useCallback((input: RequestInfo, init?: RequestInit) => {
    return fetch(input, { ...init, credentials: 'include' });
  }, []);

  const companyContextMode = state.campaign_design?.company_context_mode ?? 'full_company_context';
  const focusModules = (state.campaign_design?.focus_modules ?? []) as FocusModule[];
  const contextMode = TO_UNIFIED[companyContextMode] ?? 'FULL';

  const [themesLoading, setThemesLoading] = useState(false);
  const [generatedThemes, setGeneratedThemes] = useState<StrategicThemeEntry[]>([]);
  const [themesError, setThemesError] = useState<string | null>(null);

  const spine = state.campaign_design?.idea_spine ?? state.idea_spine;
  const stratForThemes = state.execution_plan?.strategy_context ?? state.strategy_context;
  const hasIdeaForThemes = Boolean((spine?.refined_title ?? spine?.title ?? '').trim()) || Boolean((spine?.refined_description ?? spine?.description ?? '').trim());

  const handleGenerateThemes = async () => {
    if (!companyId || !hasIdeaForThemes) {
      setThemesError(!companyId ? 'Select a company first.' : 'Complete Campaign Context (idea/title and description) first.');
      return;
    }
    setThemesLoading(true);
    setThemesError(null);
    setGeneratedThemes([]);
    try {
      const res = await fetch('/api/planner/generate-themes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          companyId,
          idea_spine: spine,
          strategy_context: stratForThemes,
          trend_context: state.campaign_design?.trend_context ?? state.trend_context ?? undefined,
          duration_weeks: stratForThemes?.duration_weeks ?? 6,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to generate themes');
      const raw = Array.isArray(data?.themes) ? data.themes : [];
      const themes: StrategicThemeEntry[] = raw
        .map((t: unknown, i: number) => {
          if (t && typeof t === 'object' && 'week' in t && 'title' in t)
            return { week: Number((t as { week: unknown }).week) || i + 1, title: String((t as { title: unknown }).title ?? '') };
          if (typeof t === 'string') return { week: i + 1, title: t };
          return null;
        })
        .filter((x): x is StrategicThemeEntry => x !== null && x.title.trim() !== '');
      setGeneratedThemes(themes);
    } catch (e) {
      setThemesError(e instanceof Error ? e.message : 'Could not generate themes');
    } finally {
      setThemesLoading(false);
    }
  };

  const handleApplyThemes = () => {
    const themes = generatedThemes.length > 0 ? generatedThemes : (state.strategic_themes ?? []);
    if (themes.length > 0) {
      setStrategicThemes(themes);
      setGeneratedThemes([]);
    }
  };

  const appliedThemes = state.strategic_themes ?? [];
  const displayThemes = generatedThemes.length > 0 ? generatedThemes : appliedThemes;

  const handleThemeChange = (weekIndex: number, value: string) => {
    if (generatedThemes.length > 0) {
      setGeneratedThemes((prev) => prev.map((t, i) => (i === weekIndex ? { ...t, title: value } : t)));
    } else {
      const current = state.strategic_themes ?? [];
      const next = current.map((t, i) => (i === weekIndex ? { ...t, title: value } : t));
      setStrategicThemes(next);
    }
  };

  const hasRecommendations = (recommendedAudience?.length ?? 0) > 0;

  return (
    <div className="flex flex-col h-full overflow-y-auto p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Context Mode</h3>
        <UnifiedContextModeSelector
          mode={contextMode}
          modules={focusModules}
          additionalDirection=""
          onModeChange={handleContextModeChange}
          onModulesChange={handleModulesChange}
          onAdditionalDirectionChange={() => {}}
          skipStorageSync
          showTrendOption={false}
        />
        {contextMode === 'FOCUSED' && companyId && (
          <div className="mt-2">
            <EngineContextPanel
              companyId={companyId}
              fetchWithAuth={fetchWithAuth}
              contextMode="FOCUSED"
              focusedModules={focusModules}
              additionalDirection=""
            />
          </div>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Target Audience</h3>
        <MultiSelectDropdown
          options={TARGET_AUDIENCE_OPTIONS.map((v) => ({ value: v, label: v }))}
          values={targetAudienceList}
          onChange={applyAudience}
          placeholder="Select target audience…"
          className="w-full border border-gray-300 rounded-lg"
        />
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Message / CTA</h3>
        <input
          type="text"
          value={keyMessage}
          onChange={(e) => {
            const base = strat ?? { duration_weeks: 12, platforms: [], posting_frequency: {}, content_mix: [], campaign_goal: '', target_audience: '' };
            setStrategyContext({ ...base, key_message: e.target.value });
          }}
          placeholder="Key message or call-to-action"
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white"
        />
      </div>

      {hasRecommendations && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-indigo-700 mb-2">
            <Sparkles className="h-3.5 w-3.5" />
            Recommended based on campaign theme
          </div>
          <div className="space-y-2">
            {recommendedAudience?.length ? (
              <button
                type="button"
                onClick={() => {
                  const merged = [...new Set([...targetAudienceList, ...recommendedAudience])];
                  applyAudience(merged);
                }}
                className="block w-full text-left px-3 py-2 rounded border border-indigo-200 bg-white text-sm text-indigo-800 hover:bg-indigo-50 transition-colors"
              >
                <span className="text-gray-500 text-xs">Recommended Audience:</span> {recommendedAudience.join(', ')}
              </button>
            ) : null}
          </div>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-2">
          <Palette className="h-4 w-4 text-indigo-600" />
          Strategic Themes
        </h3>
        <p className="text-xs text-gray-500 mb-2">
          Generate weekly themes for your campaign, then apply them before building the skeleton.
        </p>
        <div className="space-y-2 mb-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleGenerateThemes}
            disabled={themesLoading || !companyId || !hasIdeaForThemes}
            className="px-3 py-2 text-sm rounded-lg bg-indigo-100 text-indigo-700 hover:bg-indigo-200 disabled:opacity-50 flex items-center gap-2"
          >
            {themesLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Generate Themes
          </button>
          {displayThemes.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => { setGeneratedThemes([]); handleGenerateThemes(); }}
                disabled={themesLoading || !companyId || !hasIdeaForThemes}
                className="px-3 py-2 text-sm rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 flex items-center gap-2"
              >
                <RotateCcw className="h-4 w-4" />
                Regenerate
              </button>
              <button
                type="button"
                onClick={() => { clearStrategicThemes(); setGeneratedThemes([]); }}
                className="px-3 py-2 text-sm rounded-lg border border-red-200 bg-white text-red-600 hover:bg-red-50 flex items-center gap-2"
              >
                <Trash2 className="h-4 w-4" />
                Clear
              </button>
              <button
                type="button"
                onClick={handleApplyThemes}
                className="px-3 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
              >
                Apply Themes
              </button>
            </>
          )}
        </div>
        {themesError && <p className="text-xs text-red-600 mb-2">{themesError}</p>}
        {displayThemes.length > 0 && (
          <div className="space-y-2">
            {displayThemes.map((theme, i) => (
              <div key={theme.week} className="flex items-center gap-2">
                <span className="text-xs font-medium text-gray-600 shrink-0 w-14">Week {theme.week}</span>
                <input
                  type="text"
                  value={theme.title}
                  onChange={(e) => handleThemeChange(i, e.target.value)}
                  placeholder={`Theme for week ${theme.week}`}
                  className="flex-1 min-w-0 px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white"
                />
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
