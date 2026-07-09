/** TrendCampaignsRecommendationCards — thin composition. */
import React from 'react';
import EmptyState from '../../shared/EmptyState';
import ExamplePreview from '../../shared/ExamplePreview';
import { useRouter } from 'next/router';
import RecommendationBlueprintCard, {
  type BoltOutcomeView,
  type StrategyStatus,
  type RecommendationCardViewMode,
} from '../cards/RecommendationBlueprintCard';
import StrategicWorkspacePanel from '../StrategicWorkspacePanel';
import { StrategicFlowSummary } from './TrendCampaignsTabHelpers';
import BOLTProgressModal, { type BOLTProgress } from '../../BOLTProgressModal';
import {
  CampaignAssistPanel,
  type AssistContext,
} from '../../campaigns/CampaignAssistPanel';
import EngineJobStatusPanel from '../../engines/EngineJobStatusPanel';
import { buildSourceStrategicTheme } from '../../../lib/recommendationStrategicCard';

export interface TrendCampaignsRecommendationCardsProps {
  // Core
  companyId: string | undefined;
  fetchWithAuth: (input: RequestInfo, init?: RequestInit) => Promise<Response>;
  router: ReturnType<typeof useRouter>;
  viewMode?: string;
  initialBlogId?: string | null;
  intelligentMixContext: any;

  // Run state
  hasRun: boolean;
  isSubmitting: boolean;
  isExecutionFormComplete: boolean;
  handleRunClick: () => void;

  // Card data
  visibleEngineCards: Array<{ id: string; recommendation: Record<string, unknown> }>;
  rankedEngineCardsWithStatus: Array<{
    card: { id: string; recommendation: Record<string, unknown> };
    strategyStatus?: string;
    isTopPriority?: boolean;
    resurfaced?: boolean;
  }>;
  archivedEngineCards: Array<{ id: string; recommendation: Record<string, unknown> }>;
  longTermEngineCards: Array<{ id: string; recommendation: Record<string, unknown> }>;
  consolidatedResult: {
    global_opportunities: { title: string; summary?: string; rationale?: string; regions?: string[] }[];
    region_specific_insights: Record<string, { cultural_considerations: string; competitive_pressure: string }>;
    execution_priority_order: string[];
    consolidated_risks: string[];
    strategic_summary: string;
    confidence_index?: number;
  } | null;
  workspaceSummaryData: any;

  // Custom pillar
  customPillars: any[];
  showAddCustomForm: boolean;
  setShowAddCustomForm: (v: boolean | ((prev: boolean) => boolean)) => void;
  customTitle: string;
  setCustomTitle: (v: string) => void;
  customAngle: string;
  setCustomAngle: (v: string) => void;
  handleAddCustomPillar: () => void;

  // Strategy display
  strategyDrift: any;
  strategyFocusLabel: string | null;
  meterReveal: boolean;
  modeHint: string | null;
  strategyGuidanceMode: 'balanced' | 'continue' | 'expand';
  setStrategyModeWithHint: (mode: string) => void;
  showStrategyDetails: boolean;
  setShowStrategyDetails: (v: boolean | ((prev: boolean) => boolean)) => void;
  suggestedStrategyMode: string | null;
  suggestedStrategyExplanation: string | null;
  stabilizationRecommendation: any;
  strategicFlowState: any;
  strategyStatusPayload: any;

  // Recommendation state
  recommendationUserStateMap: Record<string, string>;
  setRecommendationUserStateMap: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  recommendationSignals: any;
  setRecommendationSignals: React.Dispatch<React.SetStateAction<any>>;
  setRecommendationRefinements: React.Dispatch<React.SetStateAction<Record<string, Record<string, unknown>>>>;
  usedRecommendationIds: Set<string>;
  setUsedRecommendationIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  cardBuildError: Record<string, string>;
  setCardBuildError: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setValidationError: React.Dispatch<React.SetStateAction<string | null>>;

  // BOLT
  boltTextPreset: any;
  boltProgress: BOLTProgress | null;
  setBoltProgress: React.Dispatch<React.SetStateAction<BOLTProgress | null>>;
  fastLoadingCardId: string | null;
  setFastLoadingCardId: React.Dispatch<React.SetStateAction<string | null>>;

  // Campaign
  generatedCampaignId: string | null;
  setGeneratedCampaignId: React.Dispatch<React.SetStateAction<string | null>>;

  // Assist panel
  assistPanelOpen: boolean;
  assistTopic: string;
  openAssistPanel: (topic: string) => Promise<AssistContext>;
  handleAssistConfirm: (ctx: AssistContext) => void;
  handleAssistSkip: () => void;

  // Execution form state (for building configs)
  targetAudience: string;
  tentativeStartDate: any;
  campaignGoal: string;
  frequencyPerWeek: string | number;
  contentDepth: string;
  communicationStyle: string[];
  professionalSegments: string[];
  buildAiChatExecutionConfig: (options?: any) => any;

  // Job state
  jobId: string | null;
  jobStatus: string;
  jobError: string | null;
  polledJob: any;

  // Misc
  highlightedState: any;

  // Refs
  cardsSectionRef: React.RefObject<HTMLDivElement>;
  themesSectionRef: React.RefObject<HTMLDivElement>;
  firstCardRef: React.MutableRefObject<HTMLDivElement | null>;
  isMountedRef: React.MutableRefObject<boolean>;
}

import { useTrendCampaignsCardsController } from './TrendCampaignsCardsController';
import TrendCampaignsCardsBody from './TrendCampaignsCardsBody';

export default function TrendCampaignsRecommendationCards(cprops: TrendCampaignsRecommendationCardsProps) {
  const f = useTrendCampaignsCardsController(cprops);
  const {
    props,
    _customPillars, _usedRecommendationIds, archivedEngineCards, assistPanelOpen, assistTopic, boltProgress, boltTextPreset,
    buildAiChatExecutionConfig, campaignGoal, cardBuildError, cardsSectionRef, communicationStyle, companyId, consolidatedResult,
    contentDepth, customAngle, customTitle, fastLoadingCardId, fetchWithAuth, firstCardRef, frequencyPerWeek, generatedCampaignId,
    handleAddCustomPillar, handleAssistConfirm, handleAssistSkip, handleRunClick, hasRun, highlightedState, initialBlogId,
    intelligentMixContext, isExecutionFormComplete, isMountedRef, isSubmitting, jobError, jobId, jobStatus, longTermEngineCards,
    meterReveal, modeHint, openAssistPanel, polledJob, professionalSegments, rankedEngineCardsWithStatus, recommendationSignals,
    recommendationUserStateMap, router, setBoltProgress, setCardBuildError, setCustomAngle, setCustomTitle, setFastLoadingCardId,
    setGeneratedCampaignId, setRecommendationRefinements, setRecommendationSignals, setRecommendationUserStateMap,
    setShowAddCustomForm, setShowStrategyDetails, setStrategyModeWithHint, setUsedRecommendationIds, setValidationError,
    showAddCustomForm, showStrategyDetails, stabilizationRecommendation, strategicFlowState, strategyDrift, strategyFocusLabel,
    strategyGuidanceMode, strategyStatusPayload, suggestedStrategyExplanation, suggestedStrategyMode, targetAudience,
    tentativeStartDate, themesSectionRef, viewMode, visibleEngineCards, workspaceSummaryData
  } = f;
  return (
    <div id="recommendation-cards" ref={cardsSectionRef}>
      {!hasRun && !isSubmitting && (
        <div className="flex justify-center py-12">
          {isExecutionFormComplete ? (
            <div className="max-w-md rounded-2xl border-2 border-indigo-200 bg-indigo-50 p-8 text-center space-y-4">
              <div className="text-4xl">✦</div>
              <div>
                <p className="text-base font-bold text-indigo-900">Ready to build your campaign themes</p>
                <p className="text-sm text-indigo-700 mt-1">All fields complete. Click below to generate AI-powered strategic theme cards aligned to your company direction.</p>
              </div>
              <button
                type="button"
                onClick={handleRunClick}
                disabled={isSubmitting}
                className="px-8 py-3 bg-indigo-600 text-white text-sm font-bold rounded-xl hover:bg-indigo-700 shadow-md hover:shadow-lg transition-all"
              >
                ✦ Generate Strategic Themes
              </button>
            </div>
          ) : (
            <div className="max-w-md rounded-lg border border-gray-200 bg-gray-50/80 p-6 text-center text-sm text-gray-500">
              Complete the required fields above, then click <strong>Generate Strategic Themes</strong> to build campaign pillars aligned with your company direction.
            </div>
          )}
        </div>
      )}
      {(hasRun || visibleEngineCards.length > 0) && !isSubmitting && (
        <div ref={themesSectionRef} className="space-y-6">
          <div className="flex flex-col gap-4">
            <button
              type="button"
              onClick={() => setShowAddCustomForm((v) => !v)}
              className="self-start px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              + Add Custom Pillar
            </button>
            {showAddCustomForm && (
              <div className="rounded-lg border border-gray-200 bg-gray-50/80 p-4 space-y-3">
                <h4 className="text-sm font-semibold text-gray-800">New custom pillar</h4>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Pillar Title</label>
                  <input
                    type="text"
                    value={customTitle}
                    onChange={(e) => setCustomTitle(e.target.value)}
                    placeholder="e.g. Sustainability Leadership"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Strategic Angle</label>
                  <textarea
                    value={customAngle}
                    onChange={(e) => setCustomAngle(e.target.value)}
                    placeholder="Brief angle or narrative"
                    rows={2}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleAddCustomPillar}
                    disabled={!customTitle.trim()}
                    className="px-3 py-1.5 text-sm font-medium rounded-lg bg-indigo-600 text-white disabled:opacity-50"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddCustomForm(false)}
                    className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 text-gray-700"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
          {hasRun && visibleEngineCards.length === 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-6 py-8 text-center">
              <p className="text-sm font-medium text-amber-800">No strategic themes found.</p>
              <p className="mt-2 text-sm text-amber-700">
                Generation complete, but the engine returned no recommendations for this input. Try adjusting your company context, strategic direction, or execution configuration.
              </p>
            </div>
          )}
          {visibleEngineCards.length > 0 && (
            <>
              <div className="rounded-lg border border-green-200 bg-green-50/80 px-4 py-3 text-sm text-green-800">
                {visibleEngineCards.length} strategic theme{visibleEngineCards.length !== 1 ? 's' : ''} generated. Select a card below to build your campaign.
              </div>
              <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-sm transition-all duration-200 ease-out space-y-4 -mx-0 px-0">
              {strategyDrift?.hasDrift && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-4 py-2.5 transition-all duration-200 ease-out">
                  <p className="text-xs text-amber-800">
                    ⚠ Strategy appears fragmented.
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowStrategyDetails((v) => !v)}
                    className="mt-1.5 text-xs text-amber-700 hover:text-amber-900 font-medium flex items-center gap-1"
                  >
                    Why this matters {showStrategyDetails ? '▴' : '▾'}
                  </button>
                  {showStrategyDetails && (
                    <div className="mt-2 pt-2 border-t border-amber-200/60 space-y-1.5 transition-all duration-200 ease-out">
                      {stabilizationRecommendation && (
                        <p className="text-xs font-medium text-amber-900">
                          Strategic focus suggestion: Focus on &quot;{stabilizationRecommendation.aspect}&quot; — your strongest recent strategic direction.
                        </p>
                      )}
                      {suggestedStrategyMode && (
                        <p className="text-xs text-amber-700">
                          Suggested direction may help restore focus.
                        </p>
                      )}
                      {suggestedStrategyMode === 'continue' && stabilizationRecommendation && (
                        <p className="text-xs text-amber-700">
                          Continue mode supports strategic consistency.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
              <div className="rounded-lg border border-gray-200 bg-gray-50/50 px-4 py-3 transition-all duration-200 ease-out">
                {strategyDrift != null && strategyFocusLabel != null && (
                  <div
                    className={`mb-3 transition-opacity duration-200 ease-out ${meterReveal ? 'opacity-[0.85]' : 'opacity-100'}`}
                  >
                    <p className="text-xs font-medium text-gray-600 mb-1">Strategy Focus</p>
                    <div className="flex items-center gap-2">
                      <div className="flex gap-0.5" aria-hidden>
                        {[1, 2, 3, 4, 5].map((i) => {
                          const filled = (strategyDrift.concentration ?? 0) >= (i - 0.5) / 5;
                          return (
                            <span
                              key={i}
                              className={`w-2 h-2.5 rounded-sm ${filled ? 'bg-gray-500' : 'bg-gray-200'}`}
                            />
                          );
                        })}
                      </div>
                      <span className="text-xs text-gray-500">({strategyFocusLabel})</span>
                    </div>
                  </div>
                )}
                <p className="text-xs font-medium text-gray-600 mb-2">Strategy direction</p>
                <div className="flex flex-wrap items-center gap-4">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="strategyGuidance"
                      checked={strategyGuidanceMode === 'balanced'}
                      onChange={() => setStrategyModeWithHint('balanced')}
                      className="text-indigo-600 border-gray-300 focus:ring-indigo-500"
                    />
                    <span className="text-sm text-gray-700">Balanced</span>
                    {suggestedStrategyMode === 'balanced' && (
                      <span className="text-xs font-medium text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">Recommended</span>
                    )}
                  </label>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="strategyGuidance"
                      checked={strategyGuidanceMode === 'continue'}
                      onChange={() => setStrategyModeWithHint('continue')}
                      className="text-indigo-600 border-gray-300 focus:ring-indigo-500"
                    />
                    <span className="text-sm text-gray-700">Continue strategy</span>
                    {suggestedStrategyMode === 'continue' && (
                      <span className="text-xs font-medium text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">Recommended</span>
                    )}
                  </label>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="strategyGuidance"
                      checked={strategyGuidanceMode === 'expand'}
                      onChange={() => setStrategyModeWithHint('expand')}
                      className="text-indigo-600 border-gray-300 focus:ring-indigo-500"
                    />
                    <span className="text-sm text-gray-700">Expand strategy</span>
                    {suggestedStrategyMode === 'expand' && (
                      <span className="text-xs font-medium text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">Recommended</span>
                    )}
                  </label>
                </div>
                {suggestedStrategyMode && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-gray-500">
                      Suggested: {suggestedStrategyMode === 'balanced' ? 'Balanced' : suggestedStrategyMode === 'continue' ? 'Continue Strategy' : 'Expand Strategy'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setStrategyModeWithHint(suggestedStrategyMode)}
                      className="text-xs font-medium text-indigo-600 hover:text-indigo-700 border border-indigo-200 hover:border-indigo-300 rounded px-2 py-1 bg-white"
                    >
                      Apply suggested
                    </button>
                  </div>
                )}
                {suggestedStrategyMode && suggestedStrategyExplanation && (
                  <p className="mt-1.5 text-xs text-gray-500">
                    {suggestedStrategyExplanation}
                  </p>
                )}
                <p className={`mt-2 text-xs text-gray-500 transition-opacity duration-200 ease-out ${modeHint ? 'opacity-100' : ''}`}>
                  {modeHint ?? (
                    <>
                      {strategyGuidanceMode === 'balanced' && 'Showing both continuation and expansion options.'}
                      {strategyGuidanceMode === 'continue' && 'Prioritizing themes aligned with your current strategy.'}
                      {strategyGuidanceMode === 'expand' && 'Prioritizing themes that diversify your strategy.'}
                    </>
                  )}
                </p>
              </div>
            </div>
          </>
        )}
          {rankedEngineCardsWithStatus.length > 0 && (
            <>
              <StrategicWorkspacePanel
                flowState={strategicFlowState}
                cardsWithSignals={workspaceSummaryData.cardsWithSignals}
                strategyStatusPayload={strategyStatusPayload ?? undefined}
                longTermCount={recommendationSignals?.longTerm ?? Object.values(recommendationUserStateMap).filter((s) => s === 'LONG_TERM').length}
                archivedCount={recommendationSignals?.archived ?? Object.values(recommendationUserStateMap).filter((s) => s === 'ARCHIVED').length}
                onOpenLongTerm={() => {
                  const next = new URLSearchParams(router.query as Record<string, string>);
                  next.set('state', 'LONG_TERM');
                  router.replace(`/recommendations?${next.toString()}`, undefined, { shallow: true });
                }}
                onOpenArchived={() => {
                  const next = new URLSearchParams(router.query as Record<string, string>);
                  next.set('state', 'ARCHIVED');
                  router.replace(`/recommendations?${next.toString()}`, undefined, { shallow: true });
                }}
                onScrollToCard={(cardId) => {
                  const el = document.querySelector(`[data-card-id="${cardId}"]`);
                  el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }}
              />
              <StrategicFlowSummary state={strategicFlowState} />
            </>
          )}
      <TrendCampaignsCardsBody f={f} />
          {highlightedState === 'LONG_TERM' && (
            <div className="mt-8 rounded-xl border border-amber-200 bg-amber-50/50 p-5">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h4 className="text-base font-semibold text-amber-900">Strategic Backlog</h4>
                  <p className="text-sm text-amber-800">Ideas parked for later selection are kept here and removed from the active theme list.</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const next = new URLSearchParams(router.query as Record<string, string>);
                    next.delete('state');
                    router.replace(`/recommendations?${next.toString()}`, undefined, { shallow: true });
                  }}
                  className="text-sm font-medium text-amber-700 hover:text-amber-900 underline"
                >
                  Back to active themes
                </button>
              </div>
              {longTermEngineCards.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {longTermEngineCards.map(({ id, recommendation }) => (
                    <RecommendationBlueprintCard
                      key={`long-term-${id}`}
                      recommendation={recommendation}
                      viewMode={viewMode as RecommendationCardViewMode | undefined}
                      durationWeeksOverride={intelligentMixContext?.duration ?? null}
                    />
                  ))}
                </div>
              ) : (
                <div className="text-sm text-amber-800">No long-term ideas are parked right now.</div>
              )}
            </div>
          )}
          {highlightedState === 'ARCHIVED' && (
            <div className="mt-8 rounded-xl border border-slate-200 bg-slate-50 p-5">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h4 className="text-base font-semibold text-slate-900">Archived Ideas</h4>
                  <p className="text-sm text-slate-700">Archived cards are hidden from the active recommendation list and stored here for reference.</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const next = new URLSearchParams(router.query as Record<string, string>);
                    next.delete('state');
                    router.replace(`/recommendations?${next.toString()}`, undefined, { shallow: true });
                  }}
                  className="text-sm font-medium text-slate-700 hover:text-slate-900 underline"
                >
                  Back to active themes
                </button>
              </div>
              {archivedEngineCards.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {archivedEngineCards.map(({ id, recommendation }) => (
                    <RecommendationBlueprintCard
                      key={`archived-${id}`}
                      recommendation={recommendation}
                      viewMode={viewMode as RecommendationCardViewMode | undefined}
                      durationWeeksOverride={intelligentMixContext?.duration ?? null}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState
                  tone="no-results"
                  title="No archived ideas yet"
                  description="Archived recommendations will appear here after you decide which ideas to save for later."
                  primaryAction={{ label: 'Show active ideas', onClick: () => window.scrollTo({ top: 0, behavior: 'smooth' }) }}
                  secondaryAction={{ label: 'Try with sample data', href: '/campaigns?sample=1' }}
                  examplePreview={<ExamplePreview variant="campaign" />}
                />
              )}
            </div>
          )}
          {visibleEngineCards.length === 0 && highlightedState == null && (
            <EmptyState
              title="Generate your first strategic theme"
              description="Run the engine once and it will turn signals into campaign-ready strategic directions you can act on."
              primaryAction={{ label: 'Generate your first insight', onClick: handleRunClick }}
              secondaryAction={{ label: 'Try with sample data', href: '/campaigns?sample=1' }}
              examplePreview={<ExamplePreview variant="campaign" />}
            />
          )}
          {Object.values(recommendationUserStateMap).filter((s) => s === 'LONG_TERM').length > 0 && (
            <div className="text-xs text-gray-500">
              Marked long-term: {Object.values(recommendationUserStateMap).filter((s) => s === 'LONG_TERM').length}
            </div>
          )}
          <BOLTProgressModal open={fastLoadingCardId !== null} progress={boltProgress} />
          <CampaignAssistPanel
            open={assistPanelOpen}
            onClose={handleAssistSkip}
            onConfirm={handleAssistConfirm}
            recommendationTopic={assistTopic}
            initialBlogId={initialBlogId ?? undefined}
          />
          {jobId && (
            <EngineJobStatusPanel
              createdAt={(polledJob as { created_at?: string } | null)?.created_at}
              durationHint="Typically 2–6 min depending on regions"
              status={jobStatus}
              progressStage={polledJob?.progress_stage}
              confidenceIndex={polledJob?.consolidated_result?.confidence_index ?? polledJob?.confidence_index}
              error={polledJob?.error ?? jobError}
            />
          )}
          {consolidatedResult && (
            <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              <h3 className="text-lg font-semibold text-gray-900 px-6 py-4 border-b border-gray-100 bg-gray-50">
                Global Strategic Intelligence
              </h3>
              <div className="p-6 space-y-6">
                {typeof consolidatedResult.confidence_index === 'number' && (
                  <section>
                    <h4 className="text-sm font-semibold text-gray-800 mb-1">Global Confidence</h4>
                    <p
                      className={`text-lg font-medium ${
                        consolidatedResult.confidence_index > 75
                          ? 'text-green-600'
                          : consolidatedResult.confidence_index >= 50
                            ? 'text-yellow-600'
                            : 'text-red-600'
                      }`}
                    >
                      {consolidatedResult.confidence_index}%
                    </p>
                  </section>
                )}
                <section>
                  <h4 className="text-sm font-semibold text-gray-800 mb-2">Executive Summary</h4>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{consolidatedResult.strategic_summary}</p>
                </section>
                <section>
                  <h4 className="text-sm font-semibold text-gray-800 mb-2">Global Opportunities</h4>
                  <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
                    {consolidatedResult.global_opportunities?.length
                      ? consolidatedResult.global_opportunities.map((o, i) => (
                          <li key={i}>
                            <strong>{o.title}</strong>
                            {o.regions?.length ? ` (${o.regions.join(', ')})` : ''}
                            {o.summary ? ` — ${o.summary}` : ''}
                          </li>
                        ))
                      : <li>None identified</li>}
                  </ul>
                </section>
                {Object.keys(consolidatedResult.region_specific_insights ?? {}).length > 0 && (
                  <section>
                    <h4 className="text-sm font-semibold text-gray-800 mb-2">Region Comparison</h4>
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm text-gray-700">
                        <thead>
                          <tr className="border-b border-gray-200">
                            <th className="text-left py-2 pr-4 font-medium">Region</th>
                            <th className="text-left py-2 pr-4 font-medium">Cultural considerations</th>
                            <th className="text-left py-2 font-medium">Competitive pressure</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(consolidatedResult.region_specific_insights).map(([region, insight]) => (
                            <tr key={region} className="border-b border-gray-100">
                              <td className="py-2 pr-4 font-medium">{region}</td>
                              <td className="py-2 pr-4">{insight.cultural_considerations || '—'}</td>
                              <td className="py-2">{insight.competitive_pressure || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}
                {consolidatedResult.consolidated_risks?.length > 0 && (
                  <section>
                    <h4 className="text-sm font-semibold text-gray-800 mb-2">Risk Alerts</h4>
                    <ul className="list-disc list-inside text-sm text-amber-800 space-y-0.5">
                      {consolidatedResult.consolidated_risks.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </section>
                )}
                {consolidatedResult.execution_priority_order?.length > 0 && (
                  <section>
                    <h4 className="text-sm font-semibold text-gray-800 mb-2">Execution Priority Ranking</h4>
                    <p className="text-sm text-gray-700">
                      {consolidatedResult.execution_priority_order.join(' → ')}
                    </p>
                  </section>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
