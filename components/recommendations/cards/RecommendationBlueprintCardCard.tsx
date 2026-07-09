/** Part 2/2 of RecommendationBlueprintCard.tsx — verbatim split (barrel preserved; importers unchanged). */
import React, { useMemo, useState, useRef, useEffect } from 'react';
import {
  applyRecommendationStrategicCardDraft,
  buildRecommendationStrategicCard,
  buildRecommendationStrategicCardDraft,
  type RecommendationStrategicCardDraft,
} from '@/lib/recommendationStrategicCard';

import { type RecommendationBlueprintCardProps, getJourneyState, RecommendationJourneyLabel, RecommendationNarrativeLine, getStrategicMemoryState, RecommendationStrategicMemoryLine, getIntentForecastState, RecommendationIntentForecastLine, getDecisionMomentumState, RecommendationMomentumCue, sanitizeTopicForDisplay, getTransformationSummary, type ConfidenceTier, getConfidenceTier, StrategicCardRefinementEditor } from './RecommendationBlueprintCardMeta';

function readNumber(obj: Record<string, unknown> | null | undefined, key: string): number | null {
  if (!obj) return null;
  const value = obj[key];
  return typeof value === 'number' && isFinite(value) ? value : null;
}

function readText(obj: Record<string, unknown> | null | undefined, key: string): string | null {
  if (!obj) return null;
  const value = obj[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Exported for UI-level priority ranking (e.g. TrendCampaignsTab). Single source of truth for tier from recommendation data. */
export function getConfidenceTierForRecommendation(
  rec: Record<string, unknown> | null | undefined
): ConfidenceTier {
  if (!rec || typeof rec !== 'object') return 'low';
  const finalAlignmentScore = readNumber(rec, 'final_alignment_score') ?? readNumber(rec, 'finalAlignmentScore');
  const strategyModifier = readNumber(rec, 'strategy_modifier');
  const diamondType = readText(rec, 'diamond_type');
  const polishFlags = (rec.polish_flags as Record<string, unknown> | undefined) ?? undefined;
  return getConfidenceTier(finalAlignmentScore, strategyModifier, diamondType, polishFlags);
}

function getConfidencePhrase(tier: ConfidenceTier): string {
  switch (tier) {
    case 'high':
      return 'High confidence: this looks like a strong campaign choice right now.';
    case 'medium':
      return 'Medium confidence: this has real potential, but review the angle before you commit.';
    case 'low':
    default:
      return 'Early-stage opportunity: worth exploring, but better to test before you build heavily.';
  }
}

function getConfidenceBannerTone(tier: ConfidenceTier): string {
  switch (tier) {
    case 'high':
      return 'border-slate-300';
    case 'medium':
      return 'border-slate-200';
    case 'low':
    default:
      return 'border-slate-100';
  }
}

function getPrimaryActionLabel(tier: ConfidenceTier): string {
  switch (tier) {
    case 'high':
      return 'Start This Campaign';
    case 'medium':
      return 'Build Campaign Blueprint';
    case 'low':
    default:
      return 'Explore This Strategy';
  }
}


/** AI confidence framing banner — visible in both FULL and MINIMAL. Uses existing card data only. */
function RecommendationConfidenceBanner(props: {
  transformationLine: string;
  confidenceLine: string;
  tier: ConfidenceTier;
}) {
  const { transformationLine, confidenceLine, tier } = props;
  const toneClass = getConfidenceBannerTone(tier);
  return (
    <div
      className={`mt-4 rounded-lg border bg-slate-50 px-4 py-3 ${toneClass}`}
      role="region"
      aria-label="AI recommendation summary"
    >
      <div className="flex gap-3">
        <span className="text-lg leading-none text-slate-500" aria-hidden>
          💎
        </span>
        <div className="min-w-0 flex-1 space-y-1 text-sm">
          <div className="font-semibold text-slate-800">Why This Campaign Is Worth Considering</div>
          <div className="text-slate-700">{transformationLine}</div>
          <div className="text-slate-600">{confidenceLine}</div>
        </div>
      </div>
    </div>
  );
}

export default function RecommendationBlueprintCard(props: RecommendationBlueprintCardProps) {
  const {
    recommendation,
    onRefineRecommendation,
    onBuildCampaignBlueprint,
    onMarkLongTerm,
    onArchive,
    strategyStatus,
    viewMode = 'FULL',
    isTopPriority,
    resurfaced,
    executionBadge,
    upcomingBadge,
    buildError,
    durationWeeksOverride,
  } = props;
  const [expanded, setExpanded] = useState(false);
  const [minimized, setMinimized] = useState(true);
  const [busy, setBusy] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [refinementDraft, setRefinementDraft] = useState<RecommendationStrategicCardDraft | null>(null);
  const isMinimal = viewMode === 'MINIMAL';
  const journeyState = getJourneyState({ strategyStatus, isTopPriority, resurfaced });
  const memoryState = getStrategicMemoryState({ strategyStatus, isTopPriority, resurfaced });
  const confidenceTier = useMemo(
    () => getConfidenceTierForRecommendation(recommendation ?? {}),
    [recommendation]
  );
  const forecastState = useMemo(
    () =>
      getIntentForecastState({
        journeyState,
        confidenceTier,
        strategyStatus,
      }),
    [journeyState, confidenceTier, strategyStatus]
  );
  const momentumState = useMemo(
    () =>
      getDecisionMomentumState({
        confidenceTier,
        journeyState,
        strategyStatus,
      }),
    [confidenceTier, journeyState, strategyStatus]
  );
  const primaryButtonEmphasis =
    momentumState === 'execute' ? 'font-semibold' : 'font-medium';

  const rec = recommendation ?? {};
  const canExecuteRecommendationActions =
    recommendation && typeof recommendation.id === 'string' && recommendation.id.trim().length > 0;
  const strategicCard = buildRecommendationStrategicCard(rec);
  const polishFlags = (rec.polish_flags as Record<string, unknown> | undefined) ?? null;

  const core = strategicCard.core;
  const strategicContext = strategicCard.strategic_context;
  const intelligenceBlock = strategicCard.intelligence;
  const signals = strategicCard.signals;
  const executionBlock = strategicCard.execution;
  const snapshotBlock = strategicCard.company_context_snapshot;
  const blueprint = strategicCard.blueprint;
  const displayDurationWeeks =
    typeof durationWeeksOverride === 'number' && Number.isFinite(durationWeeksOverride) && durationWeeksOverride > 0
      ? Math.floor(durationWeeksOverride)
      : blueprint.duration_weeks;

  const openRefinement = () => {
    setRefinementDraft(buildRecommendationStrategicCardDraft(rec));
    setIsRefining(true);
    if (minimized) setMinimized(false);
  };

  const closeRefinement = () => {
    setIsRefining(false);
    setRefinementDraft(null);
  };

  const badges = useMemo(() => {
    const values: string[] = [];
    if (signals.diamond_type === 'authority_elevated' || polishFlags?.authority_elevated === true) {
      values.push('Authority Opportunity');
    }
    if (signals.diamond_type === 'diamond_candidate' || polishFlags?.diamond_candidate === true) {
      values.push('Diamond Candidate');
    }
    const angle = (intelligenceBlock.campaign_angle || '').toLowerCase();
    if (angle.includes('convert') || angle.includes('conversion')) {
      values.push('Conversion Driver');
    }
    return values;
  }, [signals.diamond_type, polishFlags, intelligenceBlock.campaign_angle]);

  const hasStrategicContext =
    !!strategicContext.aspect ||
    strategicContext.facets.length > 0 ||
    strategicContext.audience_personas.length > 0 ||
    strategicContext.messaging_hooks.length > 0;
  const hasIntelligence =
    !!intelligenceBlock.problem_being_solved ||
    !!intelligenceBlock.gap_being_filled ||
    !!intelligenceBlock.why_now ||
    !!intelligenceBlock.authority_reason ||
    !!intelligenceBlock.expected_transformation ||
    !!intelligenceBlock.campaign_angle;
  const hasSnapshot =
    !!snapshotBlock.core_problem_statement ||
    snapshotBlock.pain_symptoms.length > 0 ||
    !!snapshotBlock.desired_transformation ||
    snapshotBlock.authority_domains.length > 0 ||
    !!snapshotBlock.brand_voice ||
    !!snapshotBlock.brand_positioning ||
    !!snapshotBlock.reader_emotion_target ||
    !!snapshotBlock.narrative_flow_seed ||
    !!snapshotBlock.recommended_cta_style;
  const hasExecution =
    !!executionBlock.execution_stage ||
    !!executionBlock.stage_objective ||
    !!executionBlock.psychological_goal ||
    !!executionBlock.momentum_level;

  const run = async (fn?: () => Promise<void> | void) => {
    if (!fn || busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const saveRefinement = async () => {
    if (!onRefineRecommendation || !refinementDraft) return;
    await run(async () => {
      await onRefineRecommendation(applyRecommendationStrategicCardDraft(rec, refinementDraft));
      closeRefinement();
    });
  };

  const hasMinimalProblemTransformation =
    !!intelligenceBlock.problem_being_solved || !!intelligenceBlock.expected_transformation;
  const hasMinimalWhyNow = !!intelligenceBlock.why_now;
  const hasMinimalExecution =
    !!executionBlock.execution_stage || !!executionBlock.stage_objective;
  const hasMinimalBlueprint =
    blueprint.duration_weeks != null || blueprint.primary_recommendations.length > 0;

  /** Display-safe title: prefer polished_title, always sanitize to strip "Business Report 2026", ":." etc. */
  const displayTopic = (() => {
    const raw = core.polished_title || core.topic;
    if (!raw || !raw.trim()) return null;
    const sanitized = sanitizeTopicForDisplay(raw);
    return sanitized || raw.trim();
  })();
  const confidenceBannerContent = useMemo(() => {
    const transformationLine = getTransformationSummary(
      intelligenceBlock.problem_being_solved,
      intelligenceBlock.expected_transformation,
      core.summary,
      core.topic,
      displayTopic ?? undefined
    );
    const confidenceLine = getConfidencePhrase(confidenceTier);
    return { transformationLine, confidenceLine, tier: confidenceTier };
  }, [
    intelligenceBlock.problem_being_solved,
    intelligenceBlock.expected_transformation,
    core.summary,
    core.topic,
    core.polished_title,
    displayTopic,
    confidenceTier,
  ]);

  if (isMinimal) {
    return (
      <div className="rounded-xl p-6 shadow-sm border border-gray-200 bg-white hover:shadow-md">
        <section>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-gray-800 mb-1">Core Theme</h4>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold text-gray-900">
                  {displayTopic || core.polished_title || core.topic || 'Strategic recommendation'}
                </h3>
                {strategyStatus === 'continuation' && (
                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-800" title="Aligns with your dominant strategy">
                    ⭐ Continue Strategy
                  </span>
                )}
                {strategyStatus === 'expansion' && (
                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-800" title="Underused strategy area">
                    🌱 Expand Strategy
                  </span>
                )}
                {strategyStatus === 'momentum_expand' && (
                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-indigo-100 text-indigo-800" title="Diversification recommended after repeated focus">
                    ⚡ Strategic Expansion Recommended
                  </span>
                )}
                {isTopPriority && (
                  <span className="inline-flex items-center text-xs text-slate-500 font-medium" title="AI-suggested priority">
                    ⭐ AI Priority
                  </span>
                )}
                {resurfaced && (
                  <span className="inline-flex items-center text-xs text-slate-400 font-medium" title="Re-surfaced based on progress">
                    ↺ Re-surfaced Opportunity
                  </span>
                )}
                {journeyState && <RecommendationJourneyLabel state={journeyState} />}
                {executionBadge && (
                  <span className="inline-flex items-center text-xs text-slate-600 font-medium" title="This card is one of your execution-ready opportunities">
                    📍 One of {executionBadge.total} opportunit{executionBadge.total === 1 ? 'y' : 'ies'} ready for execution ({executionBadge.index} of {executionBadge.total})
                  </span>
                )}
                {upcomingBadge && (
                  <span className="inline-flex items-center text-xs text-slate-600 font-medium" title="This card is one of your strategic directions forming">
                    ↗ One of {upcomingBadge.total} strategic direction{upcomingBadge.total === 1 ? '' : 's'} forming ({upcomingBadge.index} of {upcomingBadge.total})
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setMinimized((v) => !v)}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              {minimized ? 'Expand' : 'Collapse'}
            </button>
          </div>
          {core.summary ? (
            <p className="mt-2 text-sm text-gray-700 whitespace-pre-wrap break-words">{core.summary}</p>
          ) : null}
        </section>

        <RecommendationConfidenceBanner
          transformationLine={confidenceBannerContent.transformationLine}
          confidenceLine={confidenceBannerContent.confidenceLine}
          tier={confidenceBannerContent.tier}
        />
        {journeyState && <RecommendationNarrativeLine state={journeyState} />}
        {memoryState && <RecommendationStrategicMemoryLine state={memoryState} />}
        {forecastState && <RecommendationIntentForecastLine state={forecastState} />}

        {!minimized && hasMinimalProblemTransformation && (
          <section className="mt-4 pt-4 border-t border-gray-200">
            <h4 className="text-sm font-semibold text-gray-800 mb-2">Decision brief</h4>
            <div className="text-sm text-gray-700 space-y-2">
              {intelligenceBlock.problem_being_solved ? (
                <div>
                  <div className="text-gray-500 font-medium mb-0.5">Current challenge</div>
                  <div className="whitespace-pre-wrap break-words">
                    {intelligenceBlock.problem_being_solved}
                  </div>
                </div>
              ) : null}
              {intelligenceBlock.expected_transformation ? (
                <div>
                  <div className="text-gray-500 font-medium mb-0.5">Expected outcome</div>
                  <div className="whitespace-pre-wrap break-words">
                    {intelligenceBlock.expected_transformation}
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        )}

        {!minimized && hasMinimalWhyNow && (
          <section className="mt-4 pt-4 border-t border-gray-200">
            <h4 className="text-sm font-semibold text-gray-800 mb-2">Why now</h4>
            <p className="text-sm text-gray-700 whitespace-pre-wrap break-words">
              {intelligenceBlock.why_now}
            </p>
          </section>
        )}

        {!minimized && hasMinimalExecution && (
          <section className="mt-4 pt-4 border-t border-gray-200">
            <h4 className="text-sm font-semibold text-gray-800 mb-2">Execution stage</h4>
            <div className="text-sm text-gray-700 space-y-1">
              {executionBlock.execution_stage ? (
                <div>
                  <span className="text-gray-500 font-medium">Stage:</span> {executionBlock.execution_stage}
                </div>
              ) : null}
              {executionBlock.stage_objective ? (
                <div>
                  <span className="text-gray-500 font-medium">Objective:</span>{' '}
                  <span className="whitespace-pre-wrap break-words">{executionBlock.stage_objective}</span>
                </div>
              ) : null}
            </div>
          </section>
        )}

        {!minimized && hasMinimalBlueprint && (
          <section className="mt-4 pt-4 border-t border-gray-200">
            <h4 className="text-sm font-semibold text-gray-800 mb-2">Campaign preview</h4>
            <div className="text-sm text-gray-700 space-y-1">
              {displayDurationWeeks != null ? (
                <div>
                  <span className="text-gray-500 font-medium">Duration:</span> {displayDurationWeeks} weeks
                </div>
              ) : null}
              {blueprint.primary_recommendations.length > 0 ? (
                <div>
                  <span className="text-gray-500 font-medium">Primary:</span>{' '}
                  {blueprint.primary_recommendations.join(', ')}
                </div>
              ) : null}
            </div>
          </section>
        )}

        <section className="mt-4 pt-4 border-t border-gray-200">
          <h4 className="text-sm font-semibold text-gray-800 mb-2">Actions</h4>
          {buildError && (
            <p className="text-sm text-red-600 mb-2" role="alert">
              {buildError}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => run(onBuildCampaignBlueprint)}
              disabled={busy || !onBuildCampaignBlueprint}
              className={`px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white disabled:opacity-50 ${primaryButtonEmphasis}`}
            >
              {getPrimaryActionLabel(confidenceBannerContent.tier)}
            </button>
            <button
              type="button"
              onClick={() => (isRefining ? closeRefinement() : openRefinement())}
              disabled={busy || !onRefineRecommendation}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-indigo-200 text-indigo-700 bg-indigo-50 disabled:opacity-50"
            >
              {isRefining ? 'Close Refine' : 'Refine Card'}
            </button>
            <button
              type="button"
              onClick={() => run(onMarkLongTerm)}
              disabled={busy || !onMarkLongTerm || !canExecuteRecommendationActions}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 disabled:opacity-50"
            >
              Mark Long-Term
            </button>
            <button
              type="button"
              onClick={() => run(onArchive)}
              disabled={busy || !onArchive || !canExecuteRecommendationActions}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-600 disabled:opacity-50"
            >
              Archive
            </button>
          </div>
        </section>

        {isRefining && refinementDraft ? (
          <StrategicCardRefinementEditor
            draft={refinementDraft}
            saving={busy}
            onChange={setRefinementDraft}
            onCancel={closeRefinement}
            onSave={saveRefinement}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="rounded-xl p-6 shadow-sm border border-gray-200 bg-white hover:shadow-md">
      <section>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-gray-800 mb-1">Core Theme</h4>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold text-gray-900">
                {displayTopic || core.polished_title || core.topic || 'Strategic recommendation'}
              </h3>
              {strategyStatus === 'continuation' && (
                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-800" title="Aligns with your dominant strategy">
                  ⭐ Continue Strategy
                </span>
              )}
              {strategyStatus === 'expansion' && (
                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-800" title="Underused strategy area">
                  🌱 Expand Strategy
                </span>
              )}
              {strategyStatus === 'momentum_expand' && (
                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-indigo-100 text-indigo-800" title="Diversification recommended after repeated focus">
                  ⚡ Strategic Expansion Recommended
                </span>
              )}
              {isTopPriority && (
                <span className="inline-flex items-center text-xs text-slate-500 font-medium" title="AI-suggested priority">
                  ⭐ AI Priority
                </span>
              )}
              {resurfaced && (
                <span className="inline-flex items-center text-xs text-slate-400 font-medium" title="Re-surfaced based on progress">
                  ↺ Re-surfaced Opportunity
                </span>
              )}
              {journeyState && <RecommendationJourneyLabel state={journeyState} />}
              {executionBadge && (
                <span className="inline-flex items-center text-xs text-slate-600 font-medium" title="This card is one of your execution-ready opportunities">
                  📍 One of {executionBadge.total} opportunit{executionBadge.total === 1 ? 'y' : 'ies'} ready for execution ({executionBadge.index} of {executionBadge.total})
                </span>
              )}
              {upcomingBadge && (
                <span className="inline-flex items-center text-xs text-slate-600 font-medium" title="This card is one of your strategic directions forming">
                  ↗ One of {upcomingBadge.total} strategic direction{upcomingBadge.total === 1 ? '' : 's'} forming ({upcomingBadge.index} of {upcomingBadge.total})
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMinimized((v) => !v)}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            {minimized ? 'Maximize' : 'Minimize'}
          </button>
        </div>
        {core.summary ? <p className="mt-2 text-sm text-gray-700 whitespace-pre-wrap break-words">{core.summary}</p> : null}
        {!minimized ? (
          <div className="mt-2 text-sm text-gray-600 space-y-1">
            {core.estimated_reach != null ? <div><span className="text-gray-500 font-medium">Estimated Reach:</span> {core.estimated_reach}</div> : null}
            {core.formats.length > 0 ? <div><span className="text-gray-500 font-medium">Formats:</span> {core.formats.join(', ')}</div> : null}
            {core.regions.length > 0 ? <div><span className="text-gray-500 font-medium">Regions:</span> {core.regions.join(', ')}</div> : null}
          </div>
        ) : null}
      </section>

      <RecommendationConfidenceBanner
        transformationLine={confidenceBannerContent.transformationLine}
        confidenceLine={confidenceBannerContent.confidenceLine}
        tier={confidenceBannerContent.tier}
      />
      {journeyState && <RecommendationNarrativeLine state={journeyState} />}
      {memoryState && <RecommendationStrategicMemoryLine state={memoryState} />}
      {forecastState && <RecommendationIntentForecastLine state={forecastState} />}
      {momentumState && <RecommendationMomentumCue state={momentumState} />}

      {!minimized && hasStrategicContext && (
        <section className="mt-4 pt-4 border-t border-gray-200">
          <h4 className="text-sm font-semibold text-gray-800 mb-2">Strategic Context</h4>
          <div className="text-sm text-gray-700 space-y-1">
            {strategicContext.aspect ? <div><span className="text-gray-500 font-medium">Aspect:</span> {strategicContext.aspect}</div> : null}
            {strategicContext.facets.length > 0 ? <div><span className="text-gray-500 font-medium">Facets:</span> {strategicContext.facets.join(', ')}</div> : null}
            {strategicContext.audience_personas.length > 0 ? <div><span className="text-gray-500 font-medium">Audience Personas:</span> {strategicContext.audience_personas.join(', ')}</div> : null}
            {strategicContext.messaging_hooks.length > 0 ? <div><span className="text-gray-500 font-medium">Messaging Hooks:</span> <span className="whitespace-pre-wrap break-words">{strategicContext.messaging_hooks.join(', ')}</span></div> : null}
          </div>
        </section>
      )}

      {!minimized && hasIntelligence && (
        <section className="mt-4 pt-4 border-t border-gray-200">
          <h4 className="text-sm font-semibold text-gray-800 mb-2">Why The AI Likes This Direction</h4>
          <div className="text-sm text-gray-700 space-y-1">
            {intelligenceBlock.problem_being_solved ? <div><span className="text-gray-500 font-medium">Problem:</span> <span className="whitespace-pre-wrap break-words">{intelligenceBlock.problem_being_solved}</span></div> : null}
            {intelligenceBlock.gap_being_filled ? <div><span className="text-gray-500 font-medium">Gap:</span> <span className="whitespace-pre-wrap break-words">{intelligenceBlock.gap_being_filled}</span></div> : null}
            {intelligenceBlock.why_now ? <div><span className="text-gray-500 font-medium">Why Now:</span> <span className="whitespace-pre-wrap break-words">{intelligenceBlock.why_now}</span></div> : null}
            {intelligenceBlock.authority_reason ? <div><span className="text-gray-500 font-medium">Authority Reason:</span> <span className="whitespace-pre-wrap break-words">{intelligenceBlock.authority_reason}</span></div> : null}
            {intelligenceBlock.expected_transformation ? <div><span className="text-gray-500 font-medium">Expected Transformation:</span> <span className="whitespace-pre-wrap break-words">{intelligenceBlock.expected_transformation}</span></div> : null}
            {intelligenceBlock.campaign_angle ? <div><span className="text-gray-500 font-medium">Campaign Angle:</span> <span className="whitespace-pre-wrap break-words">{intelligenceBlock.campaign_angle}</span></div> : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {signals.diamond_type ? <span className="inline-flex items-center rounded-full px-2 py-0.5 font-medium bg-violet-100 text-violet-800">{signals.diamond_type}</span> : null}
            {signals.strategy_mode ? <span className="inline-flex items-center rounded-full px-2 py-0.5 font-medium bg-blue-100 text-blue-800">{signals.strategy_mode}</span> : null}
            {signals.final_alignment_score != null ? <span className="inline-flex items-center rounded-full px-2 py-0.5 font-medium bg-emerald-100 text-emerald-800">Final alignment {signals.final_alignment_score.toFixed(4)}</span> : null}
            {signals.strategy_modifier != null ? <span className="inline-flex items-center rounded-full px-2 py-0.5 font-medium bg-amber-100 text-amber-800">Modifier {signals.strategy_modifier.toFixed(4)}</span> : null}
          </div>
        </section>
      )}

      {!minimized && hasSnapshot && (
        <section className="mt-4 pt-4 border-t border-gray-200">
          <h4 className="text-sm font-semibold text-gray-800 mb-2">Company Context Snapshot</h4>
          <div className="text-sm text-gray-700 space-y-1">
            {snapshotBlock.brand_voice ? <div><span className="text-gray-500 font-medium">Brand Voice:</span> <span className="whitespace-pre-wrap break-words">{snapshotBlock.brand_voice}</span></div> : null}
            {snapshotBlock.brand_positioning ? <div><span className="text-gray-500 font-medium">Positioning:</span> <span className="whitespace-pre-wrap break-words">{snapshotBlock.brand_positioning}</span></div> : null}
            {snapshotBlock.reader_emotion_target ? <div><span className="text-gray-500 font-medium">Reader Emotion Target:</span> <span className="whitespace-pre-wrap break-words">{snapshotBlock.reader_emotion_target}</span></div> : null}
            {snapshotBlock.narrative_flow_seed ? <div><span className="text-gray-500 font-medium">Narrative Flow Seed:</span> <span className="whitespace-pre-wrap break-words">{snapshotBlock.narrative_flow_seed}</span></div> : null}
            {snapshotBlock.recommended_cta_style ? <div><span className="text-gray-500 font-medium">Recommended CTA Style:</span> <span className="whitespace-pre-wrap break-words">{snapshotBlock.recommended_cta_style}</span></div> : null}
            {snapshotBlock.core_problem_statement ? <div><span className="text-gray-500 font-medium">Core Problem:</span> <span className="whitespace-pre-wrap break-words">{snapshotBlock.core_problem_statement}</span></div> : null}
            {snapshotBlock.pain_symptoms.length > 0 ? <div><span className="text-gray-500 font-medium">Pain Symptoms:</span> <span className="whitespace-pre-wrap break-words">{snapshotBlock.pain_symptoms.join(', ')}</span></div> : null}
            {snapshotBlock.desired_transformation ? <div><span className="text-gray-500 font-medium">Desired Transformation:</span> <span className="whitespace-pre-wrap break-words">{snapshotBlock.desired_transformation}</span></div> : null}
            {snapshotBlock.authority_domains.length > 0 ? <div><span className="text-gray-500 font-medium">Authority Domains:</span> <span className="whitespace-pre-wrap break-words">{snapshotBlock.authority_domains.join(', ')}</span></div> : null}
          </div>
        </section>
      )}

      {!minimized && hasExecution && (
        <section className="mt-4 pt-4 border-t border-gray-200">
          <h4 className="text-sm font-semibold text-gray-800 mb-2">How You Would Use This Campaign</h4>
          <div className="text-sm text-gray-700 space-y-1">
            {executionBlock.execution_stage ? <div><span className="text-gray-500 font-medium">Stage:</span> {executionBlock.execution_stage}</div> : null}
            {executionBlock.stage_objective ? <div><span className="text-gray-500 font-medium">Stage Objective:</span> <span className="whitespace-pre-wrap break-words">{executionBlock.stage_objective}</span></div> : null}
            {executionBlock.psychological_goal ? <div><span className="text-gray-500 font-medium">Psychological Goal:</span> <span className="whitespace-pre-wrap break-words">{executionBlock.psychological_goal}</span></div> : null}
            {executionBlock.momentum_level ? <div><span className="text-gray-500 font-medium">Momentum:</span> {executionBlock.momentum_level}</div> : null}
          </div>
        </section>
      )}

      {badges.length > 0 && (
        <section className="mt-4 pt-4 border-t border-gray-200">
          <h4 className="text-sm font-semibold text-gray-800 mb-2">Strategic Badges</h4>
          <div className="flex flex-wrap gap-2">
            {badges.map((badge) => (
              <span key={badge} className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-700">
                {badge}
              </span>
            ))}
          </div>
        </section>
      )}

      {!minimized && (displayDurationWeeks != null || blueprint.progression_summary || blueprint.primary_recommendations.length > 0 || blueprint.supporting_recommendations.length > 0) && (
        <section className="mt-4 pt-4 border-t border-gray-200">
          <h4 className="text-sm font-semibold text-gray-800 mb-2">What This Could Turn Into</h4>
          <div className="text-sm text-gray-700 space-y-1">
            {displayDurationWeeks != null ? <div><span className="text-gray-500 font-medium">Duration:</span> {displayDurationWeeks} weeks</div> : null}
            {blueprint.progression_summary ? <div><span className="text-gray-500 font-medium">Progression:</span> <span className="whitespace-pre-wrap break-words">{blueprint.progression_summary}</span></div> : null}
            {blueprint.primary_recommendations.length > 0 ? <div><span className="text-gray-500 font-medium">Primary:</span> {blueprint.primary_recommendations.join(', ')}</div> : null}
            {blueprint.supporting_recommendations.length > 0 ? <div><span className="text-gray-500 font-medium">Supporting:</span> {blueprint.supporting_recommendations.join(', ')}</div> : null}
          </div>
        </section>
      )}

      <section className="mt-4 pt-4 border-t border-gray-200">
        <h4 className="text-sm font-semibold text-gray-800 mb-2">Actions</h4>
        {buildError && (
          <p className="text-sm text-red-600 mb-2" role="alert">
            {buildError}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => run(onBuildCampaignBlueprint)}
            disabled={busy || !onBuildCampaignBlueprint}
            className={`px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white disabled:opacity-50 ${primaryButtonEmphasis}`}
          >
            {getPrimaryActionLabel(confidenceBannerContent.tier)}
          </button>
          <button
            type="button"
            onClick={() => (isRefining ? closeRefinement() : openRefinement())}
            disabled={busy || !onRefineRecommendation}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-indigo-200 text-indigo-700 bg-indigo-50 disabled:opacity-50"
          >
            {isRefining ? 'Close Refine' : 'Refine Card'}
          </button>
          <button
            type="button"
            onClick={() => run(onMarkLongTerm)}
            disabled={busy || !onMarkLongTerm || !canExecuteRecommendationActions}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 disabled:opacity-50"
          >
            Mark Long-Term
          </button>
          <button
            type="button"
            onClick={() => run(onArchive)}
            disabled={busy || !onArchive || !canExecuteRecommendationActions}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-600 disabled:opacity-50"
          >
            Archive
          </button>
        </div>
      </section>

      {isRefining && refinementDraft ? (
        <StrategicCardRefinementEditor
          draft={refinementDraft}
          saving={busy}
          onChange={setRefinementDraft}
          onCancel={closeRefinement}
          onSave={saveRefinement}
        />
      ) : null}

      {!minimized && expanded && (
        <details open className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <summary className="cursor-pointer text-sm font-semibold text-gray-800">Expandable Details</summary>
          <div className="mt-2 text-sm text-gray-700 whitespace-pre-wrap break-words">
            {core.summary || 'No additional details available.'}
          </div>
        </details>
      )}
    </div>
  );
}

