import React from 'react';
import type { QuickPickConfig } from './types';
import { getEligiblePlatformPlanningTypeOptions } from './planningCatalog';

type PlatformSelections = Record<string, string[]>;

export interface QuickPickPlatformContentTypesPanelProps {
  config: QuickPickConfig;
  isBusy: boolean;
  quickPickBackButton: React.ReactNode;
  sendMessage: (override?: string) => Promise<void>;
  submitQuickPickAnswer: (config: QuickPickConfig) => void;
  quickCustomizeMode: boolean;
  setQuickCustomizeMode: React.Dispatch<React.SetStateAction<boolean>>;
  quickCustomizeText: string;
  setQuickCustomizeText: React.Dispatch<React.SetStateAction<string>>;
  planningSelectedPlatforms: string[];
  platformLabels: Record<string, string>;
  platformContentTypeOptions: Record<string, string[]>;
  eligiblePlanningTypes: Set<string>;
  quickPlatformContentTypes: PlatformSelections;
  setQuickPlatformContentTypes: React.Dispatch<React.SetStateAction<PlatformSelections>>;
  setHideQuickPickPanel: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectedQuickOptions: React.Dispatch<React.SetStateAction<string[]>>;
}

export function QuickPickPlatformContentTypesPanel({
  config,
  isBusy,
  quickPickBackButton,
  sendMessage,
  submitQuickPickAnswer,
  quickCustomizeMode,
  setQuickCustomizeMode,
  quickCustomizeText,
  setQuickCustomizeText,
  planningSelectedPlatforms,
  platformLabels,
  platformContentTypeOptions,
  eligiblePlanningTypes,
  quickPlatformContentTypes,
  setQuickPlatformContentTypes,
  setHideQuickPickPanel,
  setSelectedQuickOptions,
}: QuickPickPlatformContentTypesPanelProps): React.ReactNode {
  const platforms = planningSelectedPlatforms || [];
  const hasPlatforms = platforms.length > 0;
  const hasAnySelection = platforms.some((platform) => {
    const allowed = getEligiblePlatformPlanningTypeOptions({
      platform,
      platformContentTypeOptions,
      eligible: eligiblePlanningTypes,
    });
    return (quickPlatformContentTypes[platform] || []).some((selection) => allowed.includes(selection));
  });

  return (
    <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
      {quickPickBackButton}
      <div className="text-xs text-gray-600 mb-2">
        For each platform, pick the content types you&apos;ll use. Next we&apos;ll set how often
        (aligned with your capacity).
      </div>
      {quickCustomizeMode ? (
        <div className="mb-2 rounded-md border border-gray-200 bg-white p-2">
          <div className="text-xs text-gray-600 mb-2">Tailored input (optional).</div>
          <textarea
            value={quickCustomizeText}
            onChange={(e) => setQuickCustomizeText(e.target.value)}
            placeholder='Example: "LinkedIn: posts, articles; Instagram: reels"'
            className="w-full min-h-[72px] mb-2 px-3 py-2 border border-gray-300 rounded-md text-sm"
            disabled={isBusy}
          />
        </div>
      ) : !hasPlatforms ? (
        <div className="text-xs text-gray-500">
          (No platforms detected yet. Please answer the platforms question first, or click
          Customize and type your answer.)
        </div>
      ) : (
        <div className="space-y-3 mb-2">
          {platforms.map((platform) => {
            const platformName = platformLabels[platform] || platform;
            const options = getEligiblePlatformPlanningTypeOptions({
              platform,
              platformContentTypeOptions,
              eligible: eligiblePlanningTypes,
            });
            const selected = quickPlatformContentTypes[platform] || [];
            return (
              <div key={platform} className="bg-white border border-gray-200 rounded-md p-2">
                <div className="text-xs font-medium text-gray-700 mb-2">{platformName}</div>
                <div className="flex flex-wrap gap-2">
                  {options.map((option) => {
                    const isSelected = selected.includes(option);
                    return (
                      <button
                        key={option}
                        type="button"
                        disabled={isBusy}
                        onClick={() => {
                          setQuickPlatformContentTypes((prev) => {
                            const current = prev[platform] || [];
                            const next = current.includes(option)
                              ? current.filter((value) => value !== option)
                              : [...current, option];
                            return { ...prev, [platform]: next };
                          });
                        }}
                        className={`px-2.5 py-1.5 rounded-full text-xs border transition-colors ${
                          isSelected
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : 'bg-white text-gray-700 border-gray-300 hover:border-indigo-400'
                        }`}
                        title={option}
                      >
                        {option}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={isBusy}
          onClick={() => {
            setQuickCustomizeText('');
            setSelectedQuickOptions([]);
            setQuickCustomizeMode((prev) => !prev);
          }}
          className="px-2.5 py-1.5 rounded-full text-xs border transition-colors bg-white text-gray-700 border-gray-300 hover:border-amber-400"
        >
          {quickCustomizeMode ? 'Back to options' : 'Customize'}
        </button>
        {quickCustomizeMode ? (
          <button
            type="button"
            disabled={isBusy || !quickCustomizeText.trim()}
            onClick={() => {
              const text = quickCustomizeText.trim();
              if (!text) return;
              setHideQuickPickPanel(true);
              void sendMessage(text);
            }}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-indigo-600 text-white disabled:opacity-50"
          >
            Submit custom
          </button>
        ) : (
          <button
            type="button"
            disabled={isBusy || !hasAnySelection}
            onClick={() => submitQuickPickAnswer(config)}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-indigo-600 text-white disabled:opacity-50"
          >
            Submit selection
          </button>
        )}
      </div>
    </div>
  );
}
