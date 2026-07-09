/** TrendCampaignsCardsBody — verbatim JSX slice (babel-verified: the 443L card grid). */
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

export default function TrendCampaignsCardsBody({ f }: { f: ReturnType<typeof useTrendCampaignsCardsController> }) {
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
    <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 transition-all duration-200 ease-out">
            {rankedEngineCardsWithStatus.length > 0
              ? rankedEngineCardsWithStatus.map(({ card, strategyStatus, isTopPriority, resurfaced }, cardIndex) => {
                  const signals = workspaceSummaryData.cardsWithSignals[cardIndex];
                  const executeCount = workspaceSummaryData.cardsWithSignals.filter((c: any) => c.momentumState === 'execute').length;
                  const upcomingCount = workspaceSummaryData.cardsWithSignals.filter((c: any) => c.journeyState === 'upcoming').length;
                  const executionBadge =
                    signals?.momentumState === 'execute' && executeCount > 0
                      ? {
                          index: workspaceSummaryData.cardsWithSignals.slice(0, cardIndex + 1).filter((c: any) => c.momentumState === 'execute').length,
                          total: executeCount,
                        }
                      : undefined;
                  const upcomingBadge =
                    signals?.journeyState === 'upcoming' && upcomingCount > 0
                      ? {
                          index: workspaceSummaryData.cardsWithSignals.slice(0, cardIndex + 1).filter((c: any) => c.journeyState === 'upcoming').length,
                          total: upcomingCount,
                        }
                      : undefined;
                  return (
                  <div key={card.id} data-card-id={card.id} ref={cardIndex === 0 ? firstCardRef : undefined} className="transition-all duration-200 ease-out">
                    <RecommendationBlueprintCard
                    key={card.id}
                    recommendation={card.recommendation}
                    onRefineRecommendation={async (nextRecommendation) => {
                      setRecommendationRefinements((prev) => ({
                        ...prev,
                        [card.id]: nextRecommendation,
                      }));
                    }}
                    strategyStatus={strategyStatus as StrategyStatus | undefined}
                    viewMode={viewMode as RecommendationCardViewMode | undefined}
                    isTopPriority={isTopPriority}
                    resurfaced={resurfaced}
                    executionBadge={executionBadge}
                    upcomingBadge={upcomingBadge}
                    buildError={cardBuildError[card.id]}
                    fastLoading={fastLoadingCardId === card.id}
                    onBuildCampaignBlueprint={async () => {
                      if (!companyId) {
                        setValidationError('Select a company first.');
                        return;
                      }
                      setValidationError(null);
                      setCardBuildError((prev) => ({ ...prev, [card.id]: '' }));
                      const recommendation = card.recommendation ?? {};
                      const sourceStrategicTheme = buildSourceStrategicTheme(recommendation);
                      const recId = typeof recommendation.id === 'string' ? recommendation.id.trim() : '';

                      if (generatedCampaignId) {
                        const recTopic =
                          (typeof recommendation.polished_title === 'string' ? recommendation.polished_title : null) ??
                          (typeof recommendation.topic === 'string' ? recommendation.topic : '');
                        const assistCtx = await openAssistPanel(recTopic);

                        const executionConfigPayload = buildAiChatExecutionConfig({
                          keyMessages:
                            (typeof recommendation.summary === 'string' && recommendation.summary.trim()
                              ? recommendation.summary
                              : null) ??
                            (typeof recommendation.narrative_direction === 'string' && recommendation.narrative_direction.trim()
                              ? recommendation.narrative_direction
                              : null) ??
                            (typeof recommendation.polished_title === 'string' && recommendation.polished_title.trim()
                              ? recommendation.polished_title
                              : null) ??
                            (typeof recommendation.topic === 'string' ? recommendation.topic : null),
                        });
                        try {
                          const putRes = await fetchWithAuth(
                            `/api/campaigns/${encodeURIComponent(generatedCampaignId)}/source-recommendation`,
                            {
                              method: 'PUT',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                source_recommendation_id: recId || null,
                                source_strategic_theme: sourceStrategicTheme,
                                execution_config: executionConfigPayload,
                                blog_context:    assistCtx.blog_context    ?? null,
                                insight_context: assistCtx.insight_context ?? null,
                                topic_context:   assistCtx.topic_context   ?? null,
                                ai_assist:       assistCtx.ai_assist,
                              }),
                            }
                          );
                          if (!putRes.ok) {
                            const err = await putRes.json().catch(() => ({}));
                            throw new Error(err?.error || 'Failed to save card to campaign');
                          }
                          setCardBuildError((prev) => ({ ...prev, [card.id]: '' }));
                          const createdCampaignId = generatedCampaignId;
                          setGeneratedCampaignId(null);
                          if (recId) {
                            setUsedRecommendationIds((prev) => new Set([...prev, recId]));
                          }
                          const qs = new URLSearchParams({ companyId, fromRecommendation: '1' });
                          if (recId) qs.set('recommendationId', recId);
                          router.push(`/campaign-details/${createdCampaignId}?${qs.toString()}`);
                        } catch (error) {
                          const msg = error instanceof Error ? error.message : 'Failed to save card to campaign';
                          setCardBuildError((prev) => ({ ...prev, [card.id]: msg }));
                        }
                      } else {
                        try {
                          const newCampaignId = crypto.randomUUID();
                          const recTitle =
                            (typeof recommendation.polished_title === 'string' && recommendation.polished_title.trim()
                              ? recommendation.polished_title
                              : null) ??
                            (typeof recommendation.topic === 'string' && recommendation.topic.trim()
                              ? recommendation.topic
                              : 'Exploration Campaign');
                          const recDescription =
                            (typeof recommendation.summary === 'string' && recommendation.summary.trim()
                              ? recommendation.summary
                              : null) ??
                            (typeof recommendation.narrative_direction === 'string' && recommendation.narrative_direction.trim()
                              ? recommendation.narrative_direction
                              : null) ??
                            undefined;

                          const createRes = await fetchWithAuth('/api/campaigns', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              id: newCampaignId,
                              companyId,
                              name: recTitle,
                              description: recDescription,
                              status: 'planning',
                              current_stage: 'planning',
                              build_mode: 'no_context',
                            }),
                          });
                          if (!createRes.ok) throw new Error('Failed to create campaign');
                          const createData = await createRes.json().catch(() => ({}));
                          const stubCampaignId = createData?.campaign?.id ?? newCampaignId;

                          const executionConfigPayload = buildAiChatExecutionConfig({
                            keyMessages:
                              typeof recDescription === 'string' && recDescription.trim()
                                ? recDescription
                                : typeof recTitle === 'string'
                                  ? recTitle
                                  : null,
                          });
                          await fetchWithAuth(
                            `/api/campaigns/${encodeURIComponent(stubCampaignId)}/source-recommendation`,
                            {
                              method: 'PUT',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                source_recommendation_id: recId || null,
                                source_strategic_theme: sourceStrategicTheme,
                                execution_config: executionConfigPayload,
                                blog_context: null,
                                insight_context: null,
                                topic_context: null,
                                ai_assist: true,
                              }),
                            }
                          ).catch(() => { /* non-fatal */ });

                          if (recId) {
                            setUsedRecommendationIds((prev) => new Set([...prev, recId]));
                          }
                          const qs = new URLSearchParams({ companyId, fromRecommendation: '1' });
                          if (recId) qs.set('recommendationId', recId);
                          if (isExecutionFormComplete) qs.set('allPlanningReady', '1');
                          router.push(`/campaign-details/${stubCampaignId}?${qs.toString()}`);
                        } catch (error) {
                          const msg = error instanceof Error ? error.message : 'Failed to start exploration';
                          setCardBuildError((prev) => ({ ...prev, [card.id]: msg }));
                        }
                      }
                    }}
                    onBuildCampaignFast={async (options) => {
                      if (fastLoadingCardId === card.id) return;
                      const outcomeView: BoltOutcomeView = options?.outcomeView ?? 'schedule';
                      const campaignMode = options?.campaignMode ?? 'text_based';
                      const contentFormats = options?.contentFormats ?? ['post'];
                      if (!companyId) {
                        setValidationError('Select a company first.');
                        return;
                      }

                      const boltRec = card.recommendation ?? {};
                      const boltTopic =
                        (typeof boltRec.polished_title === 'string' ? boltRec.polished_title : null) ??
                        (typeof boltRec.topic === 'string' ? boltRec.topic : '');
                      const assistCtx = await openAssistPanel(boltTopic);

                      setValidationError(null);
                      setCardBuildError((prev) => ({ ...prev, [card.id]: '' }));
                      const recommendation = card.recommendation ?? {};
                      const title =
                        (typeof recommendation.polished_title === 'string'
                          ? recommendation.polished_title
                          : null) ??
                        (typeof recommendation.topic === 'string'
                          ? recommendation.topic
                          : 'Campaign');
                      const description =
                        (typeof recommendation.summary === 'string' && recommendation.summary.trim()
                          ? recommendation.summary
                          : null) ??
                        (typeof recommendation.narrative_direction === 'string' &&
                        recommendation.narrative_direction.trim()
                          ? recommendation.narrative_direction
                          : null) ??
                        undefined;
                      const regionsFromCard = Array.isArray(recommendation.regions)
                        ? recommendation.regions
                            .map((value) => String(value || '').trim().toUpperCase())
                            .filter(Boolean)
                        : [];
                      const sourceOpportunityId =
                        (typeof recommendation.id === 'string' && recommendation.id.trim()
                          ? recommendation.id
                          : null) ??
                        (typeof recommendation.snapshot_hash === 'string' &&
                        recommendation.snapshot_hash.trim()
                          ? recommendation.snapshot_hash
                          : null) ??
                        `recommendation:${card.id}`;
                      const sourceStrategicTheme = buildSourceStrategicTheme(recommendation);
                      const recId = typeof recommendation.id === 'string' ? recommendation.id.trim() : '';
                      const durationWeeks = Math.min(4, Math.max(1, options?.durationWeeks ?? 4));
                      const executionConfigPayload =
                        targetAudience &&
                        contentDepth &&
                        frequencyPerWeek &&
                        tentativeStartDate &&
                        campaignGoal &&
                        communicationStyle.length > 0
                          ? {
                              target_audience: targetAudience,
                              professional_segment: professionalSegments[0] ?? null,
                              professional_segments: professionalSegments,
                              communication_style: communicationStyle,
                              content_depth: contentDepth,
                              frequency_per_week: frequencyPerWeek,
                              campaign_duration: durationWeeks,
                              tentative_start: tentativeStartDate.toISOString().split('T')[0],
                              campaign_goal: campaignGoal,
                              // Normalize the UI's display-tier values
                              // ('text_based' | 'creator_dependent') into the
                              // canonical strategy-mode vocabulary the BOLT
                              // pre-execution validator + pipeline expect
                              // ('text' | 'creator' | 'combined'). Default
                              // mirrors the UI default of 'text_based'.
                              campaign_mode: campaignMode === 'creator_dependent' ? 'creator' : 'text',
                              content_formats: contentFormats,
                            }
                          : null;
                      if (!executionConfigPayload) {
                        setValidationError('Complete the execution bar (audience, depth, frequency, start date, goal, style) to use BOLT.');
                        return;
                      }
                      setFastLoadingCardId(card.id);
                      try {
                        const BOLT_EXECUTE_TIMEOUT_MS = 90_000;
                        const controller = new AbortController();
                        const timeoutId = setTimeout(() => controller.abort(), BOLT_EXECUTE_TIMEOUT_MS);
                        let execRes;
                        try {
                          execRes = await fetchWithAuth('/api/bolt/execute', {
                            method: 'POST',
                            signal: controller.signal,
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              companyId,
                              generatedCampaignId: generatedCampaignId ?? null,
                              sourceStrategicTheme,
                              executionConfig: executionConfigPayload,
                              outcomeView,
                              recId: recId || null,
                              title,
                              description,
                              sourceOpportunityId,
                              regionsFromCard,
                              blog_context:    assistCtx.blog_context    ?? null,
                              insight_context: assistCtx.insight_context ?? null,
                              topic_context:   assistCtx.topic_context   ?? null,
                              ai_assist:       assistCtx.ai_assist,
                            }),
                          });
                        } finally {
                          clearTimeout(timeoutId);
                        }
                        if (!execRes.ok) {
                          const err = await execRes.json().catch(() => ({}));
                          throw new Error(err?.error || 'Failed to start BOLT execution');
                        }
                        const execData = await execRes.json().catch(() => ({}));
                        const runId = execData?.run_id;
                        if (!runId) throw new Error('No run_id returned from BOLT execute');

                        if (recId) {
                          setUsedRecommendationIds((prev) => new Set([...prev, recId]));
                        }
                        if (generatedCampaignId) setGeneratedCampaignId(null);

                        setBoltProgress({ stage: 'source-recommendation', status: 'started', progress_percentage: 0 });

                        const POLL_PROGRESS_TIMEOUT_MS = 30_000;
                        const pollProgress = async (): Promise<string | null> => {
                          const progController = new AbortController();
                          const progTimeoutId = setTimeout(() => progController.abort(), POLL_PROGRESS_TIMEOUT_MS);
                          let progRes: Response;
                          try {
                            progRes = await fetchWithAuth(`/api/bolt/progress?run_id=${encodeURIComponent(runId)}`, {
                              signal: progController.signal,
                            });
                          } finally {
                            clearTimeout(progTimeoutId);
                          }
                          if (!progRes.ok) return null;
                          const prog = await progRes.json().catch(() => ({}));
                          if (isMountedRef.current) {
                            setBoltProgress({
                              stage: prog.stage,
                              status: prog.status,
                              progress_percentage: prog.progress_percentage,
                              error_message: prog.error_message,
                              weeks_generated: prog.weeks_generated,
                              daily_slots_created: prog.daily_slots_created,
                              scheduled_posts_created: prog.scheduled_posts_created,
                            });
                          }
                          if (prog.status === 'completed') {
                            return (prog.result_campaign_id as string) || null;
                          }
                          if (prog.status === 'failed') {
                            throw new Error((prog.error_message as string) || 'BOLT execution failed');
                          }
                          return null;
                        };

                        const POLL_INTERVAL_MS = 2500;
                        const POLL_MAX_MS = 5 * 60 * 1000;
                        const pollDeadline = Date.now() + POLL_MAX_MS;
                        let completedCampaignId: string | null = null;
                        while (!completedCampaignId && isMountedRef.current) {
                          if (Date.now() > pollDeadline) {
                            throw new Error('The request took too long. Please try again.');
                          }
                          completedCampaignId = await pollProgress();
                          if (!completedCampaignId) await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
                        }

                        if (!isMountedRef.current) return;
                        if (completedCampaignId) {
                          setFastLoadingCardId(null);
                          setBoltProgress(null);
                          const qs = new URLSearchParams({ companyId });
                          const base = `/campaign-details/${completedCampaignId}`;
                          if (outcomeView === 'week_plan') {
                            router.push(`${base}?mode=fast&${qs.toString()}`);
                          } else if (outcomeView === 'daily_plan') {
                            qs.set('plannerWeek', '1');
                            router.push(`${base}?${qs.toString()}`);
                          } else if (outcomeView === 'schedule') {
                            router.push(`/campaign-calendar/${completedCampaignId}?${qs.toString()}`);
                          } else {
                            router.push(`${base}?mode=fast&${qs.toString()}`);
                          }
                        }
                      } catch (error) {
                        let msg = error instanceof Error ? error.message : 'Failed to run BOLT (Fast Mode)';
                        if (error instanceof Error && error.name === 'AbortError') {
                          msg = 'The request took too long. Please try again.';
                        }
                        if (isMountedRef.current) {
                          setBoltProgress({
                            stage: undefined,
                            status: 'failed',
                            progress_percentage: 0,
                            error_message: msg,
                          });
                          setTimeout(() => {
                            setFastLoadingCardId(null);
                            setBoltProgress(null);
                          }, 4000);
                        }
                        setCardBuildError((prev) => ({ ...prev, [card.id]: msg }));
                      }
                    }}
                    onMarkLongTerm={
                      (typeof card.recommendation?.id === 'string' &&
                        card.recommendation.id.trim() &&
                        !card.recommendation.id.startsWith('engine-') &&
                        fetchWithAuth)
                        ? async () => {
                            const recId = (card.recommendation?.id as string).trim();
                            setRecommendationUserStateMap((prev) => ({ ...prev, [recId]: 'LONG_TERM' }));
                            setRecommendationSignals((prev: any) => prev ? ({ ...prev, longTerm: prev.longTerm + 1 }) : prev);
                            try {
                              const res = await fetchWithAuth!(`/api/recommendations/${encodeURIComponent(recId)}/long-term`, { method: 'POST' });
                              if (!res.ok) throw new Error('Failed to mark long-term');
                            } catch {
                              setRecommendationUserStateMap((prev) => {
                                const next = { ...prev };
                                delete next[recId];
                                return next;
                              });
                              setRecommendationSignals((prev: any) => prev ? ({ ...prev, longTerm: Math.max(0, prev.longTerm - 1) }) : prev);
                            }
                          }
                        : undefined
                    }
                    onArchive={
                      (typeof card.recommendation?.id === 'string' &&
                        card.recommendation.id.trim() &&
                        !card.recommendation.id.startsWith('engine-') &&
                        fetchWithAuth)
                        ? async () => {
                            const recId = (card.recommendation?.id as string).trim();
                            setRecommendationUserStateMap((prev) => ({ ...prev, [recId]: 'ARCHIVED' }));
                            setRecommendationSignals((prev: any) => prev ? ({ ...prev, archived: prev.archived + 1 }) : prev);
                            try {
                              const res = await fetchWithAuth!(`/api/recommendations/${encodeURIComponent(recId)}/archive`, { method: 'POST' });
                              if (!res.ok) throw new Error('Failed to archive');
                            } catch {
                              setRecommendationUserStateMap((prev) => {
                                const next = { ...prev };
                                delete next[recId];
                                return next;
                              });
                              setRecommendationSignals((prev: any) => prev ? ({ ...prev, archived: Math.max(0, prev.archived - 1) }) : prev);
                            }
                          }
                        : undefined
                    }
                    durationWeeksOverride={intelligentMixContext?.duration ?? null}
                    boltTextPreset={boltTextPreset}
                  />
                  </div>
                  );
                })
              : null}
          </div>
    </>
  );
}
