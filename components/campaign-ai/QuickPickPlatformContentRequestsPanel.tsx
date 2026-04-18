import React from 'react';
import type { QuickPickConfig } from './types';
import {
  getAllSupportedContentTypeKeysForPlatform,
  isEligiblePlanningType,
  prettyContentTypeLabel,
} from './planningCatalog';

type RequestsByPlatform = Record<string, Record<string, string>>;

export interface QuickPickPlatformContentRequestsPanelProps {
  config: QuickPickConfig;
  isBusy: boolean;
  quickPickBackButton: React.ReactNode;
  submitQuickPickAnswer: (config: QuickPickConfig) => void;
  quickCustomizeMode: boolean;
  setQuickCustomizeMode: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectedQuickOptions: React.Dispatch<React.SetStateAction<string[]>>;
  planningSelectedPlatforms: string[];
  platformLabels: Record<string, string>;
  platformContentTypeOptions: Record<string, string[]>;
  platformContentTypeRawOptions: Record<string, string[]>;
  eligiblePlanningTypes: Set<string>;
  hasEffectiveCatalog: boolean;
  planningPlatformContentRequests: RequestsByPlatform;
  setPlanningPlatformContentRequests: React.Dispatch<React.SetStateAction<RequestsByPlatform>>;
  planningCrossPlatformSharingEnabled: boolean;
  setPlanningCrossPlatformSharingEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  planningCrossPlatformScheduleMode: 'ai_recommended' | 'staggered' | 'same_time';
  setPlanningCrossPlatformScheduleMode: React.Dispatch<
    React.SetStateAction<'ai_recommended' | 'staggered' | 'same_time'>
  >;
  planningExclusiveCampaigns: Array<Record<string, unknown>>;
  planningAvailableCountsOverride: Record<string, number> | null;
  planningCapacityCountsOverride: Record<string, number> | null;
  prefilledPlanning: Record<string, unknown> | null;
  collectedPlanningContext: Record<string, unknown> | null;
  planningPlatformContentTypePrefs: Record<string, string[]> | null;
  showAllPlatformRequestTypes: Record<string, boolean>;
  setShowAllPlatformRequestTypes: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  quickCustomPlatform: string;
  setQuickCustomPlatform: React.Dispatch<React.SetStateAction<string>>;
  quickCustomContentType: string;
  setQuickCustomContentType: React.Dispatch<React.SetStateAction<string>>;
  quickCustomContentCount: string;
  setQuickCustomContentCount: React.Dispatch<React.SetStateAction<string>>;
}

function sumOverrideCounts(value: Record<string, number> | null): number {
  return value ? Object.values(value).reduce((a, b) => a + (Number(b) || 0), 0) : 0;
}

function coerceLegacyCountsTotal(value: unknown): { total: number; known: boolean } {
  if (!value) return { total: 0, known: false };
  if (typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown> & { breakdown?: Record<string, unknown>; _declared_none?: boolean };
    const num = (item: unknown) => {
      const n = typeof item === 'number' ? item : Number(item);
      return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
    };
    const baseTotal = num(obj.post) + num(obj.video) + num(obj.blog) + num(obj.story) + num(obj.thread);
    const breakdownTotal: number = obj.breakdown ? (Object.values(obj.breakdown) as unknown[]).reduce((sum: number, item: unknown) => sum + num(item), 0) as number : 0;
    return { total: baseTotal + breakdownTotal, known: baseTotal > 0 || breakdownTotal > 0 || Boolean(obj._declared_none) };
  }
  return { total: 0, known: false };
}

function normalizeCustomTypeKey(label: string): string {
  const value = String(label || '').trim().toLowerCase();
  if (!value) return '';
  if (value.includes('white')) return 'white_papers';
  return value.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32);
}

export function QuickPickPlatformContentRequestsPanel({
  config,
  isBusy,
  quickPickBackButton,
  submitQuickPickAnswer,
  quickCustomizeMode,
  setQuickCustomizeMode,
  setSelectedQuickOptions,
  planningSelectedPlatforms,
  platformLabels,
  platformContentTypeOptions,
  platformContentTypeRawOptions,
  eligiblePlanningTypes,
  hasEffectiveCatalog,
  planningPlatformContentRequests,
  setPlanningPlatformContentRequests,
  planningCrossPlatformSharingEnabled,
  setPlanningCrossPlatformSharingEnabled,
  planningCrossPlatformScheduleMode,
  setPlanningCrossPlatformScheduleMode,
  planningExclusiveCampaigns,
  planningAvailableCountsOverride,
  planningCapacityCountsOverride,
  prefilledPlanning,
  collectedPlanningContext,
  planningPlatformContentTypePrefs,
  showAllPlatformRequestTypes,
  setShowAllPlatformRequestTypes,
  quickCustomPlatform,
  setQuickCustomPlatform,
  quickCustomContentType,
  setQuickCustomContentType,
  quickCustomContentCount,
  setQuickCustomContentCount,
}: QuickPickPlatformContentRequestsPanelProps): React.ReactNode {
  const platforms = planningSelectedPlatforms || [];
  const hasPlatforms = platforms.length > 0;
  const hasAnyRequest = Object.values(planningPlatformContentRequests || {}).some((byType) =>
    Object.values(byType || {}).some((value) => Number(String(value || '').replace(/\D/g, '').slice(0, 2)) > 0)
  );
  const availableLegacy = coerceLegacyCountsTotal(
    (prefilledPlanning as any)?.available_content ?? (collectedPlanningContext as any)?.available_content
  );
  const capacityLegacy = coerceLegacyCountsTotal(
    (prefilledPlanning as any)?.weekly_capacity ??
      (prefilledPlanning as any)?.content_capacity ??
      (collectedPlanningContext as any)?.weekly_capacity ??
      (collectedPlanningContext as any)?.content_capacity
  );
  const exclusiveTotal = (planningExclusiveCampaigns || []).reduce((sum, row) => {
    const n = Number(String(row?.count_per_week ?? '').replace(/\D/g, '').slice(0, 2));
    return sum + (Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);
  }, 0);
  const supplyTotal =
    (sumOverrideCounts(planningAvailableCountsOverride) || availableLegacy.total) +
    Math.max(0, (sumOverrideCounts(planningCapacityCountsOverride) || capacityLegacy.total) - exclusiveTotal);
  const hasKnownSupply =
    sumOverrideCounts(planningCapacityCountsOverride) > 0 ||
    capacityLegacy.known ||
    sumOverrideCounts(planningAvailableCountsOverride) > 0 ||
    availableLegacy.known ||
    exclusiveTotal > 0;
  const cleanedRequests = Object.entries(planningPlatformContentRequests || {}).reduce((acc, [platform, byType]) => {
    const nextByType = Object.entries(byType || {}).reduce((inner, [contentType, raw]) => {
      if (!isEligiblePlanningType(prettyContentTypeLabel(contentType), eligiblePlanningTypes)) return inner;
      const n = Number(String(raw || '').replace(/\D/g, '').slice(0, 2));
      if (!Number.isFinite(n) || n <= 0) return inner;
      inner[contentType] = String(Math.min(99, Math.max(1, Math.floor(n))));
      return inner;
    }, {} as Record<string, string>);
    if (Object.keys(nextByType).length > 0) acc[platform] = nextByType;
    return acc;
  }, {} as RequestsByPlatform);
  const perTypePerPlatform: Record<string, Record<string, number>> = {};
  let postingsTotal = 0;
  Object.entries(cleanedRequests).forEach(([platform, byType]) => {
    Object.entries(byType).forEach(([contentType, raw]) => {
      const count = Number(String(raw || '').replace(/\D/g, '').slice(0, 2)) || 0;
      if (!contentType || count <= 0) return;
      postingsTotal += count;
      perTypePerPlatform[contentType] = perTypePerPlatform[contentType] || {};
      perTypePerPlatform[contentType][platform] = (perTypePerPlatform[contentType][platform] || 0) + count;
    });
  });
  const uniqueTotal = Object.values(perTypePerPlatform).reduce((sum, byPlatform) => {
    const counts = Object.values(byPlatform);
    if (!counts.length) return sum;
    return sum + (planningCrossPlatformSharingEnabled ? Math.max(...counts) : counts.reduce((a, b) => a + b, 0));
  }, 0);
  const isValid = uniqueTotal > 0 && (!hasKnownSupply || uniqueTotal <= supplyTotal);

  return (
    <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
      {quickPickBackButton}
      <div className="text-xs text-gray-600 mb-2">Set the per-platform frequency for the configured platforms below.</div>
      <div className="mb-2 rounded-md border border-gray-200 bg-white p-2">
        <div className="text-xs font-medium text-gray-700 mb-2">(1) Frequency per content type - match or adjust to your capacity</div>
        <div className="text-[11px] text-gray-500 mb-2">Set how many of each type you want per week for each configured platform.</div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-gray-700 mt-3 pt-2 border-t border-gray-100">
          <span className="font-medium text-gray-700">(2) Can one content piece be shared across platforms?</span>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={planningCrossPlatformSharingEnabled} disabled={isBusy} onChange={(e) => setPlanningCrossPlatformSharingEnabled(e.target.checked)} />
            <span>Yes - one piece shared across platforms</span>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-gray-700 mt-2">
          <span className="font-medium text-gray-700">(3) Publish same day or staggered?</span>
          <select
            value={planningCrossPlatformScheduleMode}
            disabled={isBusy}
            onChange={(e) => setPlanningCrossPlatformScheduleMode(e.target.value as 'ai_recommended' | 'staggered' | 'same_time')}
            className="rounded border border-gray-200 px-2 py-1 text-xs"
          >
            <option value="ai_recommended">Let AI decide</option>
            <option value="staggered">Staggered (different days)</option>
            <option value="same_time">Same day on all platforms</option>
          </select>
          <span className="text-gray-500">
            Unique pieces/week: <span className="font-semibold text-gray-800">{uniqueTotal}</span> • Platform postings/week: <span className="font-semibold text-gray-800">{postingsTotal}</span> • Supply/week: <span className="font-semibold text-gray-800">{supplyTotal}</span>
          </span>
        </div>
      </div>
      {!hasEffectiveCatalog ? <div className="text-xs text-red-600 mb-2">Platform intelligence catalog is required (DB-driven).</div> : null}
      {!hasPlatforms ? (
        <div className="text-xs text-gray-500">(No platforms detected yet. Please answer the platforms question first, or click Customize and type your answer.)</div>
      ) : (
        <div className="space-y-3 mb-2">
          {quickCustomizeMode ? (
            <div className="rounded-md border border-gray-200 bg-white p-2">
              <div className="text-xs text-gray-600 mb-2">Add a custom content type (optional).</div>
              <div className="flex flex-wrap items-center gap-2">
                <select value={quickCustomPlatform || platforms[0] || ''} disabled={isBusy} onChange={(e) => setQuickCustomPlatform(e.target.value)} className="rounded border border-gray-200 px-2 py-1.5 text-xs">
                  {platforms.map((platform) => <option key={platform} value={platform}>{platformLabels[platform] || platform}</option>)}
                </select>
                <input type="text" value={quickCustomContentType} onChange={(e) => setQuickCustomContentType(e.target.value)} placeholder="Content type (e.g., White Papers)" className="flex-1 min-w-[180px] px-2 py-1.5 border border-gray-300 rounded-md text-sm" disabled={isBusy} />
                <input type="text" inputMode="numeric" maxLength={2} value={quickCustomContentCount} onChange={(e) => setQuickCustomContentCount(e.target.value.replace(/\D/g, '').slice(0, 2))} placeholder="0" className="w-20 px-2 py-1.5 border border-gray-300 rounded-md text-sm" disabled={isBusy} />
                <button
                  type="button"
                  disabled={isBusy || !normalizeCustomTypeKey(quickCustomContentType) || !(Number(quickCustomContentCount) > 0)}
                  onClick={() => {
                    const platform = String(quickCustomPlatform || platforms[0] || '').trim();
                    const key = normalizeCustomTypeKey(quickCustomContentType);
                    const n = Number(quickCustomContentCount);
                    if (!platform || !key || !Number.isFinite(n) || n <= 0) return;
                    setPlanningPlatformContentRequests((prev) => ({ ...(prev || {}), [platform]: { ...(prev?.[platform] || {}), [key]: String(Math.min(99, Math.max(0, Math.floor(n)))) } }));
                    setQuickCustomContentCount('');
                  }}
                  className="px-3 py-1.5 text-xs font-medium rounded-md bg-white text-gray-700 border border-gray-300 hover:border-indigo-400 disabled:opacity-50"
                >
                  Add
                </button>
              </div>
            </div>
          ) : null}
          {platforms.map((platform) => {
            const byType = planningPlatformContentRequests?.[platform] || {};
            const selectedKeys = Object.keys(byType).filter((contentType) => String(byType[contentType] ?? '').replace(/\D/g, '').length > 0);
            const showAll = Boolean(showAllPlatformRequestTypes?.[platform]);
            const prefs = planningPlatformContentTypePrefs?.[platform] || null;
            const allowed = prefs?.length ? new Set(prefs.map((item) => String(item || '').toLowerCase().trim()).filter(Boolean)) : null;
            const effectiveTypes = getAllSupportedContentTypeKeysForPlatform(platform, platformContentTypeRawOptions, platformContentTypeOptions).filter((contentType) => {
              if (allowed) return allowed.has(String(contentType || '').toLowerCase().trim());
              return isEligiblePlanningType(prettyContentTypeLabel(contentType), eligiblePlanningTypes);
            });
            const visibleTypes = selectedKeys.length > 0 && !showAll ? effectiveTypes.filter((contentType) => selectedKeys.includes(contentType)) : effectiveTypes;
            return (
              <div key={platform} className="bg-white border border-gray-200 rounded-md p-2">
                <div className="text-xs font-medium text-gray-700 mb-2">{platformLabels[platform] || platform}</div>
                {selectedKeys.length > 0 ? (
                  <button type="button" disabled={isBusy} onClick={() => setShowAllPlatformRequestTypes((prev) => ({ ...(prev || {}), [platform]: !showAll }))} className="mb-2 px-2 py-1 text-xs rounded border border-gray-300 text-gray-700 hover:border-indigo-400">
                    {showAll ? 'Show only selected' : 'Add more types'}
                  </button>
                ) : null}
                {visibleTypes.length === 0 ? (
                  <div className="text-xs text-gray-500">No content types available for this platform.</div>
                ) : (
                  <div className="space-y-2">
                    {visibleTypes.map((contentType) => {
                      const value = String(byType?.[contentType] ?? '');
                      const checked = value.replace(/\D/g, '').length > 0;
                      const checkboxId = `platform-${platform}-${contentType}-cb-panel`;
                      return (
                        <div key={contentType} className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-2 py-2">
                          <input
                            id={checkboxId}
                            type="checkbox"
                            checked={checked}
                            disabled={isBusy}
                            onChange={(e) => {
                              const nextChecked = e.target.checked;
                              setPlanningPlatformContentRequests((prev) => {
                                const current = { ...(prev?.[platform] || {}) };
                                if (!nextChecked) delete current[contentType];
                                else if (!current[contentType]) current[contentType] = '1';
                                return { ...(prev || {}), [platform]: current };
                              });
                            }}
                          />
                          <label htmlFor={checkboxId} className="text-xs text-gray-700 w-44 shrink-0 cursor-pointer select-none">{prettyContentTypeLabel(contentType)}</label>
                          <input
                            type="text"
                            inputMode="numeric"
                            maxLength={2}
                            value={value}
                            onChange={(e) => {
                              const digits = e.target.value.replace(/\D/g, '').slice(0, 2);
                              setPlanningPlatformContentRequests((prev) => {
                                const current = { ...(prev?.[platform] || {}) };
                                if (!digits) delete current[contentType];
                                else current[contentType] = digits;
                                return { ...(prev || {}), [platform]: current };
                              });
                            }}
                            placeholder="0"
                            className="w-16 px-2 py-1.5 border border-gray-300 rounded-md text-sm"
                            disabled={isBusy || !checked}
                          />
                          <span className="text-xs text-gray-500">/week</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {!hasKnownSupply && uniqueTotal > 0 ? <div className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">Supply/week is unknown here. You can still submit expectations and validate later once capacity is available.</div> : null}
      <div className="flex flex-wrap items-center gap-2">
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
          disabled={isBusy || !hasEffectiveCatalog || !hasPlatforms || !hasAnyRequest || !isValid}
          onClick={() => submitQuickPickAnswer(config)}
          className="px-3 py-1.5 text-xs font-medium rounded-md bg-indigo-600 text-white disabled:opacity-50"
        >
          Submit selection
        </button>
      </div>
    </div>
  );
}
