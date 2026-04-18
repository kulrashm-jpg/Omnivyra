import React from 'react';
import type { ProgressiveStyleConfig, QuickPickConfig } from './types';
import { prettyContentTypeLabel } from './planningCatalog';

type ExclusiveCampaignRow = Record<string, unknown>;

export interface QuickPickExclusiveCampaignsPanelProps {
  config: QuickPickConfig;
  isBusy: boolean;
  quickPickBackButton: React.ReactNode;
  quickCustomizeMode: boolean;
  setQuickCustomizeMode: React.Dispatch<React.SetStateAction<boolean>>;
  quickCustomizeText: string;
  setQuickCustomizeText: React.Dispatch<React.SetStateAction<string>>;
  setSelectedQuickOptions: React.Dispatch<React.SetStateAction<string[]>>;
  setHideQuickPickPanel: React.Dispatch<React.SetStateAction<boolean>>;
  sendMessage: (override?: string) => Promise<void>;
  submitQuickPickAnswer: (config: QuickPickConfig) => void;
  planningSelectedPlatforms: string[];
  platformContentTypeRawOptions: Record<string, string[]>;
  platformLabels: Record<string, string>;
  hasEffectiveCatalog: boolean;
  planningExclusiveCampaigns: ExclusiveCampaignRow[];
  setPlanningExclusiveCampaigns: React.Dispatch<React.SetStateAction<ExclusiveCampaignRow[]>>;
}

export function QuickPickExclusiveCampaignsPanel({
  config,
  isBusy,
  quickPickBackButton,
  quickCustomizeMode,
  setQuickCustomizeMode,
  quickCustomizeText,
  setQuickCustomizeText,
  setSelectedQuickOptions,
  setHideQuickPickPanel,
  sendMessage,
  submitQuickPickAnswer,
  planningSelectedPlatforms,
  platformContentTypeRawOptions,
  platformLabels,
  hasEffectiveCatalog,
  planningExclusiveCampaigns,
  setPlanningExclusiveCampaigns,
}: QuickPickExclusiveCampaignsPanelProps): React.ReactNode {
  const platforms =
    planningSelectedPlatforms && planningSelectedPlatforms.length > 0
      ? planningSelectedPlatforms
      : Object.keys(platformContentTypeRawOptions || {});
  const hasPlatforms = platforms.length > 0;
  const canAdd = hasPlatforms && hasEffectiveCatalog;
  const addRow = () => {
    const firstPlatform = platforms[0] || '';
    const firstType = firstPlatform ? platformContentTypeRawOptions[firstPlatform]?.[0] || '' : '';
    setPlanningExclusiveCampaigns((prev) => [
      ...(prev || []),
      { platform: firstPlatform, content_type: firstType, count_per_week: '1' },
    ]);
  };

  return (
    <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
      {quickPickBackButton}
      <div className="text-xs text-gray-600 mb-2">
        Add any platform-exclusive campaigns (per week). If none, submit without adding rows.
      </div>
      {!hasEffectiveCatalog ? (
        <div className="text-xs text-red-600 mb-2">
          Platform intelligence catalog is required (DB-driven). Please ensure platform tables are available.
        </div>
      ) : null}
      {!hasPlatforms ? (
        <div className="text-xs text-gray-500">
          (No platforms detected yet. Please answer the platforms question first, or click Customize and type your answer.)
        </div>
      ) : (
        <div className="space-y-2 mb-2">
          {(planningExclusiveCampaigns || []).map((row, idx) => {
            const platform = String((row as any)?.platform ?? '');
            const rawTypes = platformContentTypeRawOptions[platform] || [];
            return (
              <div key={idx} className="grid grid-cols-1 sm:grid-cols-3 gap-2 bg-white border border-gray-200 rounded-md p-2">
                <select
                  value={platform}
                  disabled={isBusy}
                  onChange={(e) => {
                    const nextPlatform = e.target.value;
                    const nextType = nextPlatform ? platformContentTypeRawOptions[nextPlatform]?.[0] || '' : '';
                    setPlanningExclusiveCampaigns((prev) => {
                      const copy = [...(prev || [])];
                      copy[idx] = { ...(copy[idx] as any), platform: nextPlatform, content_type: nextType };
                      return copy as any;
                    });
                  }}
                  className="rounded border border-gray-200 px-2 py-2 text-xs"
                >
                  {platforms.map((platformOption) => (
                    <option key={platformOption} value={platformOption}>
                      {platformLabels[platformOption] || platformOption}
                    </option>
                  ))}
                </select>
                <select
                  value={String((row as any)?.content_type ?? '')}
                  disabled={isBusy || !platform}
                  onChange={(e) => {
                    const nextType = e.target.value;
                    setPlanningExclusiveCampaigns((prev) => {
                      const copy = [...(prev || [])];
                      copy[idx] = { ...(copy[idx] as any), content_type: nextType };
                      return copy as any;
                    });
                  }}
                  className="rounded border border-gray-200 px-2 py-2 text-xs"
                >
                  {rawTypes.map((contentType) => (
                    <option key={contentType} value={contentType}>
                      {prettyContentTypeLabel(contentType)}
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={2}
                    value={String((row as any)?.count_per_week ?? '')}
                    disabled={isBusy}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/\D/g, '').slice(0, 2);
                      setPlanningExclusiveCampaigns((prev) => {
                        const copy = [...(prev || [])];
                        copy[idx] = { ...(copy[idx] as any), count_per_week: digits };
                        return copy as any;
                      });
                    }}
                    placeholder="0"
                    className="w-16 px-2 py-1.5 border border-gray-300 rounded-md text-sm"
                  />
                  <span className="text-xs text-gray-500">/week</span>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => {
                      setPlanningExclusiveCampaigns((prev) => (prev || []).filter((_, i) => i !== idx));
                    }}
                    className="ml-auto px-2 py-1 text-xs rounded border border-gray-300 text-gray-600 hover:border-red-400"
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {quickCustomizeMode ? (
        <div className="mb-2 rounded-md border border-gray-200 bg-white p-2">
          <div className="text-xs text-gray-600 mb-2">Tailored input (optional).</div>
          <textarea
            value={quickCustomizeText}
            onChange={(e) => setQuickCustomizeText(e.target.value)}
            placeholder='Example: "LinkedIn: webinars 1/week; YouTube: long videos 1/week"'
            className="w-full min-h-[72px] px-3 py-2 border border-gray-300 rounded-md text-sm"
            disabled={isBusy}
          />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={isBusy || !canAdd}
          onClick={addRow}
          className="px-2.5 py-1.5 rounded-full text-xs border transition-colors bg-white text-gray-700 border-gray-300 hover:border-indigo-400"
        >
          Add exclusive campaign
        </button>
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
            disabled={isBusy || ((planningExclusiveCampaigns?.length ?? 0) > 0 && (!hasEffectiveCatalog || !hasPlatforms))}
            onClick={() => submitQuickPickAnswer(config)}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-indigo-600 text-white disabled:opacity-50"
          >
            Submit
          </button>
        )}
      </div>
    </div>
  );
}

export interface QuickPickProgressiveStylePanelProps {
  config: QuickPickConfig & { progressiveStyle: ProgressiveStyleConfig };
  isBusy: boolean;
  quickPickBackButton: React.ReactNode;
  quickPickPrimaryStyles: string[];
  setQuickPickPrimaryStyles: React.Dispatch<React.SetStateAction<string[]>>;
  quickPickSecondaryModifiers: string[];
  setQuickPickSecondaryModifiers: React.Dispatch<React.SetStateAction<string[]>>;
  submitQuickPickAnswer: (config: QuickPickConfig) => void;
}

export function QuickPickProgressiveStylePanel({
  config,
  isBusy,
  quickPickBackButton,
  quickPickPrimaryStyles,
  setQuickPickPrimaryStyles,
  quickPickSecondaryModifiers,
  setQuickPickSecondaryModifiers,
  submitQuickPickAnswer,
}: QuickPickProgressiveStylePanelProps): React.ReactNode {
  const { primaryOptions, secondaryByPrimary, primaryTooltips, secondaryTooltips } = config.progressiveStyle;
  const selectedPrimaries = quickPickPrimaryStyles;
  const secondaries = quickPickSecondaryModifiers;
  let compatibleSecondaries =
    selectedPrimaries.length > 0
      ? Array.from(new Set(selectedPrimaries.flatMap((primary) => secondaryByPrimary[primary] ?? [])))
      : [];
  if (config.key === 'communication_style' && selectedPrimaries.includes('Simple & easy')) {
    compatibleSecondaries = compatibleSecondaries.filter((option) => option !== 'Deep & thoughtful');
  }
  const isCta = config.key === 'action_expectation';
  const primaryLabel = isCta
    ? 'Choose one or more primary CTA intents.'
    : 'Choose one or more primary communication directions.';
  const modifiersLabel = isCta ? 'Select actions (optional):' : 'Select modifiers (optional):';

  return (
    <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
      {quickPickBackButton}
      {config.helperText ? (
        <div className="text-xs text-gray-600 mb-2 pb-2 border-b border-gray-200">{config.helperText}</div>
      ) : null}
      {selectedPrimaries.length === 0 ? (
        <>
          <div className="text-xs text-gray-600 mb-2">{primaryLabel}</div>
          <div className="flex flex-wrap gap-2 mb-2">
            {primaryOptions.map((option) => {
              const selected = selectedPrimaries.includes(option);
              return (
                <button
                  key={option}
                  type="button"
                  disabled={isBusy}
                  title={primaryTooltips?.[option]}
                  onClick={() => {
                    setQuickPickPrimaryStyles((prev) =>
                      prev.includes(option) ? prev.filter((primary) => primary !== option) : [...prev, option]
                    );
                  }}
                  className={`px-2.5 py-1.5 rounded-full text-xs border transition-colors ${
                    selected
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-indigo-400 hover:bg-indigo-50'
                  }`}
                >
                  {option}
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <div className="text-xs text-gray-600 mb-2">
            Primary: <span className="font-medium text-gray-800">{selectedPrimaries.join(', ')}</span>
          </div>
          <div className="flex flex-wrap gap-2 mb-2">
            {primaryOptions.map((option) => {
              const selected = selectedPrimaries.includes(option);
              return (
                <button
                  key={option}
                  type="button"
                  disabled={isBusy}
                  title={primaryTooltips?.[option]}
                  onClick={() => {
                    const next = selected
                      ? selectedPrimaries.filter((primary) => primary !== option)
                      : [...selectedPrimaries, option];
                    setQuickPickPrimaryStyles(next);
                    if (next.length === 0) {
                      setQuickPickSecondaryModifiers([]);
                    } else {
                      let nextCompatible = Array.from(new Set(next.flatMap((primary) => secondaryByPrimary[primary] ?? [])));
                      if (config.key === 'communication_style' && next.includes('Simple & easy')) {
                        nextCompatible = nextCompatible.filter((secondary) => secondary !== 'Deep & thoughtful');
                      }
                      setQuickPickSecondaryModifiers((prev) => prev.filter((secondary) => nextCompatible.includes(secondary)));
                    }
                  }}
                  className={`px-2.5 py-1.5 rounded-full text-xs border transition-colors ${
                    selected
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-indigo-400'
                  }`}
                >
                  {option}
                </button>
              );
            })}
            <button
              type="button"
              disabled={isBusy}
              onClick={() => {
                setQuickPickPrimaryStyles([]);
                setQuickPickSecondaryModifiers([]);
              }}
              className="px-2.5 py-1.5 rounded-full text-xs border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
            >
              Clear primary
            </button>
          </div>
          {compatibleSecondaries.length > 0 ? (
            <>
              <div className="text-xs text-gray-600 mb-1 mt-2">{modifiersLabel}</div>
              <div className="flex flex-wrap gap-2 mb-2">
                {compatibleSecondaries.map((option) => {
                  const selected = secondaries.includes(option);
                  return (
                    <button
                      key={option}
                      type="button"
                      disabled={isBusy}
                      title={secondaryTooltips?.[option]}
                      onClick={() => {
                        setQuickPickSecondaryModifiers((prev) =>
                          prev.includes(option)
                            ? prev.filter((secondary) => secondary !== option)
                            : [...prev, option]
                        );
                      }}
                      className={`px-2.5 py-1.5 rounded-full text-xs border transition-colors ${
                        selected
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white text-gray-700 border-gray-300 hover:border-indigo-400'
                      }`}
                    >
                      {option}
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}
          <button
            type="button"
            disabled={isBusy}
            onClick={() => submitQuickPickAnswer(config)}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-indigo-600 text-white disabled:opacity-50"
          >
            Submit selection
          </button>
        </>
      )}
    </div>
  );
}

export interface QuickPickGenericPanelProps {
  config: QuickPickConfig;
  isBusy: boolean;
  quickPickBackButton: React.ReactNode;
  selectedQuickOptions: string[];
  setSelectedQuickOptions: React.Dispatch<React.SetStateAction<string[]>>;
  quickCustomizeMode: boolean;
  setQuickCustomizeMode: React.Dispatch<React.SetStateAction<boolean>>;
  quickCustomizeText: string;
  setQuickCustomizeText: React.Dispatch<React.SetStateAction<string>>;
  submitQuickPickAnswer: (config: QuickPickConfig) => void;
}

export function QuickPickGenericPanel({
  config,
  isBusy,
  quickPickBackButton,
  selectedQuickOptions,
  setSelectedQuickOptions,
  quickCustomizeMode,
  setQuickCustomizeMode,
  quickCustomizeText,
  setQuickCustomizeText,
  submitQuickPickAnswer,
}: QuickPickGenericPanelProps): React.ReactNode {
  return (
    <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
      {quickPickBackButton}
      <div className="text-xs text-gray-600 mb-2">
        {config.helperText ?? (config.multi ? 'Select one or more, then submit.' : 'Pick one, then submit.')}
      </div>
      <div className="flex flex-wrap gap-2 mb-2">
        {config.options.map((option) => {
          const selected = selectedQuickOptions.includes(option);
          const tooltip = config.optionTooltips?.[option] ?? config.optionDescriptions?.[option];
          return (
            <button
              key={option}
              type="button"
              disabled={isBusy}
              title={tooltip}
              onClick={() => {
                if (config.multi) {
                  setSelectedQuickOptions((prev) =>
                    prev.includes(option) ? prev.filter((value) => value !== option) : [...prev, option]
                  );
                } else {
                  setSelectedQuickOptions([option]);
                  setQuickCustomizeMode(false);
                  setQuickCustomizeText('');
                }
              }}
              className={`px-2.5 py-1.5 rounded-full text-xs border transition-colors ${
                selected
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:border-indigo-400'
              }`}
            >
              {option}
            </button>
          );
        })}
        <button
          type="button"
          disabled={isBusy}
          onClick={() => {
            setQuickCustomizeText('');
            setQuickCustomizeMode((prev) => !prev);
          }}
          className={`px-2.5 py-1.5 rounded-full text-xs border transition-colors ${
            quickCustomizeMode
              ? 'bg-amber-500 text-white border-amber-500'
              : 'bg-white text-gray-700 border-gray-300 hover:border-amber-400'
          }`}
        >
          {quickCustomizeMode ? 'Back to options' : 'Customize'}
        </button>
      </div>
      {quickCustomizeMode ? (
        <input
          type="text"
          value={quickCustomizeText}
          onChange={(e) => setQuickCustomizeText(e.target.value)}
          placeholder={config.key === 'campaign_duration' ? 'e.g., 6 weeks' : 'Add custom option(s)'}
          className="w-full mb-2 px-3 py-2 border border-gray-300 rounded-md text-sm"
          disabled={isBusy}
        />
      ) : null}
      <button
        type="button"
        disabled={
          isBusy ||
          (!quickCustomizeMode && selectedQuickOptions.length === 0) ||
          (quickCustomizeMode && !quickCustomizeText.trim() && selectedQuickOptions.length === 0)
        }
        onClick={() => submitQuickPickAnswer(config)}
        className="px-3 py-1.5 text-xs font-medium rounded-md bg-indigo-600 text-white disabled:opacity-50"
      >
        Submit selection
      </button>
    </div>
  );
}
