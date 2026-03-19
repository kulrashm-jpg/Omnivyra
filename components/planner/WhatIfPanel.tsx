/**
 * What If? Scenario Simulator Panel
 * Lets the CMO adjust frequency, platforms, content mix, and ads toggle
 * and immediately see how the validation score and paid recommendation change.
 * Entirely client-side — no API calls, <50ms recompute.
 */

import React, { useMemo, useState } from 'react';
import { useDebounce } from '../../lib/hooks/useDebounce';
import { ChevronDown, ChevronUp, FlaskConical, Minus, Plus, TrendingDown, TrendingUp } from 'lucide-react';
import { simulateScenario } from '../../backend/lib/simulation/scenarioSimulator';
import type {
  SimulatorBasePlan,
  SimulatorStrategyContext,
} from '../../backend/lib/simulation/scenarioSimulator';
import type { CampaignValidation } from '../../backend/lib/validation/campaignValidator';
import type { PaidRecommendation } from '../../backend/lib/ads/paidAmplificationEngine';
import type { AccountContext } from '../../backend/types/accountContext';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const RISK_COLOR: Record<string, string> = {
  LOW: 'text-emerald-700',
  MEDIUM: 'text-amber-700',
  HIGH: 'text-red-700',
};

const REC_COLOR: Record<string, string> = {
  NOT_NEEDED: 'text-gray-600',
  TEST: 'text-amber-700',
  SCALE: 'text-emerald-700',
};

function DeltaBadge({ value }: { value: number }) {
  if (value === 0) return <span className="text-xs text-gray-400">—</span>;
  const positive = value > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${positive ? 'text-emerald-600' : 'text-red-600'}`}>
      {positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {positive ? `+${value}` : value}
    </span>
  );
}

function FrequencySlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const STEPS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
  const idx = STEPS.indexOf(value);
  const label = value === 1.0 ? '1× (unchanged)' : `${value}×`;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-600 font-medium">Posting Frequency</span>
        <span className="font-semibold text-indigo-700">{label}</span>
      </div>
      <input
        type="range"
        min={0}
        max={STEPS.length - 1}
        step={1}
        value={idx < 0 ? 2 : idx}
        onChange={(e) => onChange(STEPS[Number(e.target.value)])}
        className="w-full h-1.5 rounded-full accent-indigo-600 cursor-pointer"
      />
      <div className="flex justify-between text-[10px] text-gray-400">
        <span>0.5×</span><span>1×</span><span>2×</span>
      </div>
    </div>
  );
}

function PlatformToggle({
  platform,
  active,
  onToggle,
}: {
  platform: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
        active
          ? 'bg-indigo-600 text-white border-indigo-600'
          : 'bg-white text-gray-600 border-gray-300 hover:border-indigo-400'
      }`}
    >
      {platform}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const ALL_PLATFORMS = ['LinkedIn', 'Instagram', 'Twitter', 'Facebook', 'YouTube', 'TikTok'];
const CONTENT_TYPES = ['post', 'video', 'carousel', 'story', 'thread', 'blog', 'short'];

interface WhatIfPanelProps {
  basePlan: SimulatorBasePlan;
  baseValidation: CampaignValidation;
  basePaidRecommendation: PaidRecommendation;
  strategyContext: SimulatorStrategyContext;
  accountContext?: AccountContext | null;
}

export function WhatIfPanel({
  basePlan,
  baseValidation,
  basePaidRecommendation,
  strategyContext,
  accountContext,
}: WhatIfPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [frequencyMultiplier, setFrequencyMultiplier] = useState(1.0);
  const [activePlatforms, setActivePlatforms] = useState<Set<string>>(
    new Set(strategyContext.platforms)
  );
  const [activeContentTypes, setActiveContentTypes] = useState<Set<string>>(
    new Set(Object.keys(strategyContext.content_mix ?? {}).length > 0
      ? Object.keys(strategyContext.content_mix!)
      : CONTENT_TYPES.slice(0, 2))
  );
  const [adsEnabled, setAdsEnabled] = useState<boolean | undefined>(undefined); // undefined = auto

  // Debounce the slider value so useMemo doesn't recompute on every drag tick.
  // The raw value still drives the slider label instantly; only the simulation lags by 120 ms.
  const debouncedFrequencyMultiplier = useDebounce(frequencyMultiplier, 120);

  // Derive adds/removes from the base platforms
  const basePlatformSet = useMemo(() => new Set(strategyContext.platforms), [strategyContext.platforms]);

  const addPlatform = useMemo(
    () => [...activePlatforms].filter((p) => !basePlatformSet.has(p)),
    [activePlatforms, basePlatformSet]
  );
  const removePlatform = useMemo(
    () => [...basePlatformSet].filter((p) => !activePlatforms.has(p)),
    [activePlatforms, basePlatformSet]
  );

  // Determine if any scenario lever is changed from baseline
  const isChanged =
    frequencyMultiplier !== 1.0 ||
    addPlatform.length > 0 ||
    removePlatform.length > 0 ||
    adsEnabled !== undefined;

  // Simulate — memoized so it only reruns when inputs change.
  // Uses debouncedFrequencyMultiplier (not the live slider value) so rapid slider
  // drag does not trigger a recompute on every animation frame — only after 120 ms
  // of inactivity. The slider label still updates instantly from frequencyMultiplier.
  const simOutput = useMemo(() => {
    if (!isChanged) return null;
    try {
      // Build content mix override from active content types across active platforms
      const contentMixOverride =
        activeContentTypes.size > 0
          ? [...activePlatforms].map((platform) => ({
              platform,
              contentTypes: [...activeContentTypes],
            }))
          : undefined;

      return simulateScenario({
        base_plan: basePlan,
        base_validation: baseValidation,
        base_paid_recommendation: basePaidRecommendation,
        account_context: accountContext ?? null,
        strategy_context: strategyContext,
        scenario: {
          frequencyMultiplier: debouncedFrequencyMultiplier,
          addPlatform: addPlatform.length > 0 ? addPlatform : undefined,
          removePlatform: removePlatform.length > 0 ? removePlatform : undefined,
          contentMixOverride,
          enableAds: adsEnabled,
        },
      });
    } catch {
      return null;
    }
  }, [
    isChanged,
    debouncedFrequencyMultiplier, // debounced — not the raw slider value
    addPlatform,
    removePlatform,
    activeContentTypes,
    activePlatforms,
    adsEnabled,
    basePlan,
    baseValidation,
    basePaidRecommendation,
    accountContext,
    strategyContext,
  ]);

  function togglePlatform(platform: string) {
    setActivePlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(platform)) {
        // Don't allow removing all platforms
        if (next.size <= 1) return prev;
        next.delete(platform);
      } else {
        next.add(platform);
      }
      return next;
    });
  }

  function toggleContentType(ct: string) {
    setActiveContentTypes((prev) => {
      const next = new Set(prev);
      if (next.has(ct)) {
        if (next.size <= 1) return prev;
        next.delete(ct);
      } else {
        next.add(ct);
      }
      return next;
    });
  }

  function resetAll() {
    setFrequencyMultiplier(1.0);
    setActivePlatforms(new Set(strategyContext.platforms));
    setActiveContentTypes(
      new Set(Object.keys(strategyContext.content_mix ?? {}).length > 0
        ? Object.keys(strategyContext.content_mix!)
        : CONTENT_TYPES.slice(0, 2))
    );
    setAdsEnabled(undefined);
  }

  const sim = simOutput;
  const confChange = sim?.delta.confidenceChange ?? 0;

  return (
    <div className="rounded-xl border border-violet-200 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div
        className="px-4 py-3 bg-gradient-to-r from-violet-50 to-purple-50 border-b border-violet-100 flex items-center justify-between cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-violet-500" />
          <div>
            <h3 className="text-sm font-semibold text-gray-900">What If? Simulator</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {isChanged && sim
                ? `Score: ${baseValidation.confidenceScore} → ${sim.updatedValidation.confidenceScore}  (${confChange >= 0 ? '+' : ''}${confChange})`
                : 'Change levers below to test scenarios instantly'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isChanged && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); resetAll(); }}
              className="text-xs text-violet-600 hover:text-violet-800 underline"
            >
              Reset
            </button>
          )}
          {expanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
        </div>
      </div>

      {expanded && (
        <div className="p-4 space-y-5">
          {/* Controls */}
          <div className="space-y-4">
            {/* Frequency slider */}
            <FrequencySlider value={frequencyMultiplier} onChange={setFrequencyMultiplier} />

            {/* Platform toggles */}
            <div>
              <p className="text-xs font-medium text-gray-600 mb-2">Platforms</p>
              <div className="flex flex-wrap gap-1.5">
                {ALL_PLATFORMS.map((p) => (
                  <PlatformToggle
                    key={p}
                    platform={p}
                    active={activePlatforms.has(p)}
                    onToggle={() => togglePlatform(p)}
                  />
                ))}
              </div>
            </div>

            {/* Content type mix */}
            <div>
              <p className="text-xs font-medium text-gray-600 mb-2">Content Types</p>
              <div className="flex flex-wrap gap-1.5">
                {CONTENT_TYPES.map((ct) => (
                  <button
                    key={ct}
                    type="button"
                    onClick={() => toggleContentType(ct)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors capitalize ${
                      activeContentTypes.has(ct)
                        ? 'bg-violet-600 text-white border-violet-600'
                        : 'bg-white text-gray-600 border-gray-300 hover:border-violet-400'
                    }`}
                  >
                    {ct}
                  </button>
                ))}
              </div>
            </div>

            {/* Ads toggle */}
            <div>
              <p className="text-xs font-medium text-gray-600 mb-2">Paid Ads</p>
              <div className="flex gap-2">
                {(['auto', 'on', 'off'] as const).map((mode) => {
                  const isActive =
                    mode === 'auto' ? adsEnabled === undefined
                    : mode === 'on' ? adsEnabled === true
                    : adsEnabled === false;
                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setAdsEnabled(mode === 'auto' ? undefined : mode === 'on')}
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors capitalize ${
                        isActive
                          ? 'bg-violet-600 text-white border-violet-600'
                          : 'bg-white text-gray-600 border-gray-300 hover:border-violet-400'
                      }`}
                    >
                      {mode === 'auto' ? 'Auto' : mode === 'on' ? 'Force ON' : 'Force OFF'}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Comparison table */}
          {sim ? (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Scenario Result</p>

              <div className="overflow-hidden rounded-lg border border-gray-100">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 text-left">
                      <th className="px-3 py-2 font-medium">Metric</th>
                      <th className="px-3 py-2 font-medium">Current</th>
                      <th className="px-3 py-2 font-medium">Simulated</th>
                      <th className="px-3 py-2 font-medium">Delta</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    <tr>
                      <td className="px-3 py-2 text-gray-700 font-medium">Confidence</td>
                      <td className="px-3 py-2 font-bold text-gray-900">{baseValidation.confidenceScore}</td>
                      <td className="px-3 py-2 font-bold text-gray-900">{sim.updatedValidation.confidenceScore}</td>
                      <td className="px-3 py-2"><DeltaBadge value={sim.delta.confidenceChange} /></td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 text-gray-700 font-medium">Risk</td>
                      <td className={`px-3 py-2 font-semibold ${RISK_COLOR[baseValidation.riskLevel] ?? ''}`}>{baseValidation.riskLevel}</td>
                      <td className={`px-3 py-2 font-semibold ${RISK_COLOR[sim.updatedValidation.riskLevel] ?? ''}`}>{sim.updatedValidation.riskLevel}</td>
                      <td className="px-3 py-2 text-xs text-gray-500">{sim.delta.riskChange}</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 text-gray-700 font-medium">Reach</td>
                      <td className="px-3 py-2 text-gray-700">{baseValidation.expectedOutcome.reachEstimate}</td>
                      <td className="px-3 py-2 text-gray-700">{sim.updatedValidation.expectedOutcome.reachEstimate}</td>
                      <td className="px-3 py-2 text-xs text-gray-400">—</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 text-gray-700 font-medium">Engagement</td>
                      <td className="px-3 py-2 text-gray-600 max-w-[80px] truncate">{baseValidation.expectedOutcome.engagementEstimate.split(' — ')[0]}</td>
                      <td className="px-3 py-2 text-gray-600 max-w-[80px] truncate">{sim.updatedValidation.expectedOutcome.engagementEstimate.split(' — ')[0]}</td>
                      <td className="px-3 py-2 text-xs text-gray-400">—</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 text-gray-700 font-medium">Ads</td>
                      <td className={`px-3 py-2 font-semibold ${REC_COLOR[basePaidRecommendation.overallRecommendation] ?? ''}`}>{basePaidRecommendation.overallRecommendation}</td>
                      <td className={`px-3 py-2 font-semibold ${REC_COLOR[sim.updatedPaidRecommendation.overallRecommendation] ?? ''}`}>{sim.updatedPaidRecommendation.overallRecommendation}</td>
                      <td className="px-3 py-2 text-xs text-gray-400">
                        {basePaidRecommendation.overallRecommendation !== sim.updatedPaidRecommendation.overallRecommendation ? '↕' : '—'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Delta summary */}
              {sim.delta.impactChange.length > 0 && (
                <div className="rounded-lg bg-violet-50 px-3 py-2.5 space-y-1">
                  <p className="text-xs font-semibold text-violet-700 mb-1">What changed</p>
                  {sim.delta.impactChange.map((line, i) => {
                    const positive = line.startsWith('+') || line.includes('improved') || line.includes('reduced') || line.includes('SCALE') || line.includes('LOW');
                    return (
                      <div key={i} className="flex items-start gap-1.5 text-xs">
                        <span className={`mt-0.5 font-bold ${positive ? 'text-emerald-600' : 'text-red-500'}`}>
                          {positive ? '↑' : '↓'}
                        </span>
                        <span className="text-gray-700">{line}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Issues diff */}
              {sim.updatedValidation.issues.length !== baseValidation.issues.length && (
                <p className="text-xs text-gray-500">
                  Issues: {baseValidation.issues.length} → {sim.updatedValidation.issues.length}
                  {sim.updatedValidation.issues.length < baseValidation.issues.length
                    ? <span className="text-emerald-600 ml-1">({baseValidation.issues.length - sim.updatedValidation.issues.length} resolved)</span>
                    : <span className="text-red-500 ml-1">({sim.updatedValidation.issues.length - baseValidation.issues.length} new)</span>}
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-lg bg-gray-50 px-4 py-3 text-xs text-gray-500 text-center">
              Adjust a lever above to see the simulated impact.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
