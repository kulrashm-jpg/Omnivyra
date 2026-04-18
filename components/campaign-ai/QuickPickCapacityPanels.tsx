import React from 'react';
import type { QuickPickConfig } from './types';
import { canonicalPlanningTypeLabel } from './planningCatalog';
import { getContentCapacityOptionsForMode } from '../../utils/contentCapacityOptions';

type ShowAllTypeCounters = Record<'available_content' | 'content_capacity', boolean>;

export interface QuickPickCapacityPanelsProps {
  config: QuickPickConfig;
  isBusy: boolean;
  hideQuickPickPanel: boolean;
  quickPickBackButton: React.ReactNode;
  sendMessage: (override?: string) => Promise<void>;
  submitQuickPickAnswer: (config: QuickPickConfig) => void;
  showAllTypeCounters: ShowAllTypeCounters;
  setShowAllTypeCounters: React.Dispatch<React.SetStateAction<ShowAllTypeCounters>>;
  quickCapacityCounts: Record<string, string>;
  setQuickCapacityCounts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  quickCustomizeMode: boolean;
  setQuickCustomizeMode: React.Dispatch<React.SetStateAction<boolean>>;
  quickCustomizeText: string;
  setQuickCustomizeText: React.Dispatch<React.SetStateAction<string>>;
  quickCustomContentType: string;
  setQuickCustomContentType: React.Dispatch<React.SetStateAction<string>>;
  quickCustomContentCount: string;
  setQuickCustomContentCount: React.Dispatch<React.SetStateAction<string>>;
  quickDateYear: string;
  setQuickDateYear: React.Dispatch<React.SetStateAction<string>>;
  quickDateMonth: string;
  setQuickDateMonth: React.Dispatch<React.SetStateAction<string>>;
  quickDateDay: string;
  setQuickDateDay: React.Dispatch<React.SetStateAction<string>>;
  planningSelectedPlatforms: string[];
  prefilledPlanning: Record<string, unknown> | null;
  collectedPlanningContext: Record<string, unknown> | null;
  quickCapacityCreationMode: '' | 'manual' | 'ai-assisted' | 'full-ai';
  setQuickCapacityCreationMode: React.Dispatch<React.SetStateAction<'' | 'manual' | 'ai-assisted' | 'full-ai'>>;
  setSelectedQuickOptions: React.Dispatch<React.SetStateAction<string[]>>;
}

function normalizePlatformList(
  planningSelectedPlatforms: string[],
  prefilledPlanning: Record<string, unknown> | null,
  collectedPlanningContext: Record<string, unknown> | null
): string[] {
  if (planningSelectedPlatforms.length > 0) {
    return planningSelectedPlatforms.map((p) => p.toLowerCase().trim()).filter(Boolean);
  }
  const raw = (prefilledPlanning as any)?.platforms ?? (collectedPlanningContext as any)?.platforms;
  if (Array.isArray(raw)) return raw.map((p: any) => String(p ?? '').toLowerCase().trim()).filter(Boolean);
  const s = typeof raw === 'string' ? raw : '';
  return s
    .split(/[,;]+/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
    .map((x) => (x === 'twitter' ? 'x' : x));
}

export function CampaignAIQuickPickCapacityPanels({
  config,
  isBusy,
  hideQuickPickPanel,
  quickPickBackButton,
  sendMessage,
  submitQuickPickAnswer,
  showAllTypeCounters,
  setShowAllTypeCounters,
  quickCapacityCounts,
  setQuickCapacityCounts,
  quickCustomizeMode,
  setQuickCustomizeMode,
  quickCustomizeText,
  setQuickCustomizeText,
  quickCustomContentType,
  setQuickCustomContentType,
  quickCustomContentCount,
  setQuickCustomContentCount,
  quickDateYear,
  setQuickDateYear,
  quickDateMonth,
  setQuickDateMonth,
  quickDateDay,
  setQuickDateDay,
  planningSelectedPlatforms,
  prefilledPlanning,
  collectedPlanningContext,
  quickCapacityCreationMode,
  setQuickCapacityCreationMode,
  setSelectedQuickOptions,
}: QuickPickCapacityPanelsProps): React.ReactNode {
  if (!config || hideQuickPickPanel) return null;

  if (config.key === 'available_content') {
    const showAll = Boolean(showAllTypeCounters.available_content);
    const visibleOptions = showAll ? config.options : config.options.slice(0, 10);
    const hasAnyInput = Object.values(quickCapacityCounts).some((v) => {
      const n = Number(String(v).trim());
      return Number.isFinite(n) && n > 0;
    });
    const canSubmit = hasAnyInput;
    const customKeys = Object.keys(quickCapacityCounts).filter((k) => {
      if (config.options.includes(k)) return false;
      const n = Number(String(quickCapacityCounts[k] ?? '').trim());
      return Number.isFinite(n) && n > 0;
    });
    return (
      <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
        {quickPickBackButton}
        <div className="text-xs text-gray-600 mb-2">Enter counts for any existing content you already have. If none, click <span className="font-semibold">None</span>.</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
          {visibleOptions.map((option) => (
            <label key={option} className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-2 py-2">
              <span className="text-xs text-gray-700 w-20 shrink-0">{option}</span>
              <input
                type="text"
                inputMode="numeric"
                maxLength={3}
                value={quickCapacityCounts[option] ?? ''}
                onChange={(e) => {
                  const value = e.target.value.replace(/\D/g, '').slice(0, 3);
                  setQuickCapacityCounts((prev) => ({ ...prev, [option]: value }));
                }}
                placeholder="0"
                className="w-16 px-2 py-1.5 border border-gray-300 rounded-md text-sm"
                disabled={isBusy}
              />
            </label>
          ))}
        </div>
        {quickCustomizeMode ? (
          <div className="mb-2 rounded-md border border-gray-200 bg-white p-2">
            <div className="text-xs text-gray-600 mb-2">Add another content type (optional).</div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={quickCustomContentType}
                onChange={(e) => setQuickCustomContentType(e.target.value)}
                placeholder="Content type (e.g., White Papers)"
                className="flex-1 min-w-[180px] px-2 py-1.5 border border-gray-300 rounded-md text-sm"
                disabled={isBusy}
              />
              <input
                type="text"
                inputMode="numeric"
                maxLength={3}
                value={quickCustomContentCount}
                onChange={(e) => setQuickCustomContentCount(e.target.value.replace(/\D/g, '').slice(0, 3))}
                placeholder="0"
                className="w-20 px-2 py-1.5 border border-gray-300 rounded-md text-sm"
                disabled={isBusy}
              />
              <button
                type="button"
                disabled={isBusy || !canonicalPlanningTypeLabel(quickCustomContentType).trim() || !(Number(quickCustomContentCount) > 0)}
                onClick={() => {
                  const label = canonicalPlanningTypeLabel(quickCustomContentType).trim();
                  const n = Number(quickCustomContentCount);
                  if (!label || !Number.isFinite(n) || n <= 0) return;
                  setQuickCapacityCounts((prev) => {
                    const curr = Number(String(prev[label] ?? '0').trim());
                    const next = (Number.isFinite(curr) ? curr : 0) + Math.floor(n);
                    return { ...prev, [label]: String(Math.min(999, Math.max(0, next))) };
                  });
                  setQuickCustomContentCount('');
                }}
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-white text-gray-700 border border-gray-300 hover:border-indigo-400 disabled:opacity-50"
              >
                Add
              </button>
            </div>
            {customKeys.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {customKeys.map((k) => (
                  <button
                    key={k}
                    type="button"
                    disabled={isBusy}
                    onClick={() => {
                      setQuickCapacityCounts((prev) => {
                        const next = { ...prev };
                        delete next[k];
                        return next;
                      });
                    }}
                    className="px-2 py-1 rounded-full text-xs border border-gray-200 bg-gray-50 text-gray-700 hover:border-rose-300"
                    title="Remove"
                  >
                    {k}: {quickCapacityCounts[k]}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {config.options.length > 10 ? (
            <button
              type="button"
              disabled={isBusy}
              onClick={() => setShowAllTypeCounters((prev) => ({ ...prev, available_content: !prev.available_content }))}
              className="px-2.5 py-1.5 rounded-full text-xs border transition-colors bg-white text-gray-700 border-gray-300 hover:border-indigo-400"
            >
              {showAll ? 'Show fewer types' : 'Show all types'}
            </button>
          ) : null}
          <button
            type="button"
            disabled={isBusy}
            onClick={async () => {
              setQuickCustomizeMode(false);
              await sendMessage('No');
            }}
            className="px-2.5 py-1.5 rounded-full text-xs border transition-colors bg-white text-gray-700 border-gray-300 hover:border-emerald-400"
          >
            None
          </button>
          <button
            type="button"
            disabled={isBusy}
            onClick={() => {
              setSelectedQuickOptions([]);
              setQuickCustomContentType('');
              setQuickCustomContentCount('');
              setQuickCustomizeMode((prev) => !prev);
            }}
            className="px-2.5 py-1.5 rounded-full text-xs border transition-colors bg-white text-gray-700 border-gray-300 hover:border-amber-400"
          >
            {quickCustomizeMode ? 'Done' : 'Customize'}
          </button>
          <button
            type="button"
            disabled={isBusy || !canSubmit}
            onClick={() => submitQuickPickAnswer(config)}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-indigo-600 text-white disabled:opacity-50"
          >
            Submit
          </button>
        </div>
      </div>
    );
  }

  if (config.key === 'tentative_start') {
    const canSubmitDate = quickDateYear.trim().length === 4 && quickDateMonth.trim().length >= 1 && quickDateDay.trim().length >= 1;
    return (
      <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
        {quickPickBackButton}
        <div className="text-xs text-gray-600 mb-2">Select date fields and submit (YYYY-MM-DD).</div>
        <div className="flex flex-wrap items-center gap-2">
          <input type="text" inputMode="numeric" maxLength={4} value={quickDateYear} onChange={(e) => setQuickDateYear(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="YYYY" className="w-24 px-2 py-2 border border-gray-300 rounded-md text-sm" disabled={isBusy} />
          <span className="text-gray-500">-</span>
          <input type="text" inputMode="numeric" maxLength={2} value={quickDateMonth} onChange={(e) => setQuickDateMonth(e.target.value.replace(/\D/g, '').slice(0, 2))} placeholder="MM" className="w-16 px-2 py-2 border border-gray-300 rounded-md text-sm" disabled={isBusy} />
          <span className="text-gray-500">-</span>
          <input type="text" inputMode="numeric" maxLength={2} value={quickDateDay} onChange={(e) => setQuickDateDay(e.target.value.replace(/\D/g, '').slice(0, 2))} placeholder="DD" className="w-16 px-2 py-2 border border-gray-300 rounded-md text-sm" disabled={isBusy} />
          <button type="button" disabled={isBusy || !canSubmitDate} onClick={() => submitQuickPickAnswer(config)} className="px-3 py-2 text-xs font-medium rounded-md bg-indigo-600 text-white disabled:opacity-50">
            Submit
          </button>
        </div>
      </div>
    );
  }

  if (config.key === 'content_capacity') {
    const platformsForCapacity = normalizePlatformList(planningSelectedPlatforms, prefilledPlanning, collectedPlanningContext);
    const effectiveOptions = getContentCapacityOptionsForMode(
      quickCapacityCreationMode as 'manual' | 'ai-assisted' | 'full-ai' | '',
      config.options,
      platformsForCapacity
    );
    const showAll = Boolean(showAllTypeCounters.content_capacity);
    const visibleOptions = showAll ? effectiveOptions : effectiveOptions.slice(0, 10);
    const hasPreparation = !!quickCapacityCreationMode;
    const hasCapacityInput = Object.values(quickCapacityCounts).some((v) => {
      const n = Number(String(v).trim());
      return Number.isFinite(n) && n > 0;
    });
    const customKeys = Object.keys(quickCapacityCounts).filter((k) => {
      if (effectiveOptions.includes(k)) return false;
      const n = Number(String(quickCapacityCounts[k] ?? '').trim());
      return Number.isFinite(n) && n > 0;
    });
    return (
      <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
        {quickPickBackButton}
        <div className="text-xs text-gray-600 mb-2"><strong>(1) How will you create?</strong> Pick one: Manual, AIâ€‘assisted, or Full AI.</div>
        <div className="text-xs font-medium text-gray-700 mb-1.5">Your choice</div>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          {(['manual', 'ai-assisted', 'full-ai'] as const).map((mode) => {
            const selected = quickCapacityCreationMode === mode;
            const label = mode === 'manual' ? 'Manual' : mode === 'ai-assisted' ? 'AIâ€‘assisted' : 'Full AI';
            return (
              <button key={mode} type="button" disabled={isBusy} onClick={() => setQuickCapacityCreationMode((prev) => (prev === mode ? '' : mode))} className={`px-2.5 py-1.5 rounded-full text-xs border transition-colors ${selected ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-300 hover:border-indigo-400'}`}>
                {label}
              </button>
            );
          })}
        </div>
        <div className="text-xs font-medium text-gray-700 mb-1.5">(2) How many per week? (e.g. 2 posts, 1 video)</div>
        {!hasPreparation ? (
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 mb-2">Pick an option above first, then add your counts.</div>
        ) : null}
        <div className={`gap-2 mb-2 ${!hasPreparation ? 'opacity-60 pointer-events-none' : ''}`}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {visibleOptions.map((option) => (
              <label key={option} className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-2 py-2">
                <span className="text-xs text-gray-700 w-20 shrink-0">{option}</span>
                <input type="text" inputMode="numeric" maxLength={2} value={quickCapacityCounts[option] ?? ''} onChange={(e) => { const value = e.target.value.replace(/\D/g, '').slice(0, 2); setQuickCapacityCounts((prev) => ({ ...prev, [option]: value })); }} placeholder="0" className="w-16 px-2 py-1.5 border border-gray-300 rounded-md text-sm" disabled={isBusy} />
                <span className="text-xs text-gray-500">/week</span>
              </label>
            ))}
          </div>
        </div>
        {quickCustomizeMode ? (
          <div className="mb-2 rounded-md border border-gray-200 bg-white p-2">
            <div className="text-xs text-gray-600 mb-2">Add another content type (optional).</div>
            <div className="flex flex-wrap items-center gap-2">
              <input type="text" value={quickCustomContentType} onChange={(e) => setQuickCustomContentType(e.target.value)} placeholder="Content type (e.g., White Papers)" className="flex-1 min-w-[180px] px-2 py-1.5 border border-gray-300 rounded-md text-sm" disabled={isBusy} />
              <input type="text" inputMode="numeric" maxLength={2} value={quickCustomContentCount} onChange={(e) => setQuickCustomContentCount(e.target.value.replace(/\D/g, '').slice(0, 2))} placeholder="0" className="w-20 px-2 py-1.5 border border-gray-300 rounded-md text-sm" disabled={isBusy} />
              <button type="button" disabled={isBusy || !canonicalPlanningTypeLabel(quickCustomContentType).trim() || !(Number(quickCustomContentCount) > 0)} onClick={() => {
                const label = canonicalPlanningTypeLabel(quickCustomContentType).trim();
                const n = Number(quickCustomContentCount);
                if (!label || !Number.isFinite(n) || n <= 0) return;
                setQuickCapacityCounts((prev) => {
                  const curr = Number(String(prev[label] ?? '0').trim());
                  const next = (Number.isFinite(curr) ? curr : 0) + Math.floor(n);
                  return { ...prev, [label]: String(Math.min(99, Math.max(0, next))) };
                });
                setQuickCustomContentCount('');
              }} className="px-3 py-1.5 text-xs font-medium rounded-md bg-white text-gray-700 border border-gray-300 hover:border-indigo-400 disabled:opacity-50">
                Add
              </button>
            </div>
            {customKeys.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {customKeys.map((k) => (
                  <button key={k} type="button" disabled={isBusy} onClick={() => {
                    setQuickCapacityCounts((prev) => {
                      const next = { ...prev };
                      delete next[k];
                      return next;
                    });
                  }} className="px-2 py-1 rounded-full text-xs border border-gray-200 bg-gray-50 text-gray-700 hover:border-rose-300" title="Remove">
                    {k}: {quickCapacityCounts[k]}/week
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {effectiveOptions.length > 10 ? (
            <button type="button" disabled={isBusy} onClick={() => setShowAllTypeCounters((prev) => ({ ...prev, content_capacity: !prev.content_capacity }))} className="px-2.5 py-1.5 rounded-full text-xs border transition-colors bg-white text-gray-700 border-gray-300 hover:border-indigo-400">
              {showAll ? 'Show fewer types' : 'Show all types'}
            </button>
          ) : null}
          <button type="button" disabled={isBusy} onClick={() => {
            setQuickCustomizeText('');
            setSelectedQuickOptions([]);
            setQuickCustomContentType('');
            setQuickCustomContentCount('');
            setQuickCustomizeMode((prev) => !prev);
          }} className="px-2.5 py-1.5 rounded-full text-xs border transition-colors bg-white text-gray-700 border-gray-300 hover:border-amber-400">
            {quickCustomizeMode ? 'Done' : 'Customize'}
          </button>
          <button type="button" disabled={isBusy || !hasPreparation || !hasCapacityInput} onClick={() => submitQuickPickAnswer(config)} className="px-3 py-1.5 text-xs font-medium rounded-md bg-indigo-600 text-white disabled:opacity-50">
            Submit selection
          </button>
        </div>
      </div>
    );
  }

  return null;
}
