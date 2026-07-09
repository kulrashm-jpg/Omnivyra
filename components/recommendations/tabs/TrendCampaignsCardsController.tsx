/** useTrendCampaignsCardsController — logic of TrendCampaignsRecommendationCards, verbatim. */
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

export function useTrendCampaignsCardsController(props: TrendCampaignsRecommendationCardsProps) {
  const {
    companyId, fetchWithAuth, router, viewMode, initialBlogId, intelligentMixContext,
    hasRun, isSubmitting, isExecutionFormComplete, handleRunClick,
    visibleEngineCards, rankedEngineCardsWithStatus, archivedEngineCards, longTermEngineCards,
    consolidatedResult, workspaceSummaryData,
    customPillars: _customPillars, showAddCustomForm, setShowAddCustomForm, customTitle, setCustomTitle,
    customAngle, setCustomAngle, handleAddCustomPillar,
    strategyDrift, strategyFocusLabel, meterReveal, modeHint, strategyGuidanceMode,
    setStrategyModeWithHint, showStrategyDetails, setShowStrategyDetails,
    suggestedStrategyMode, suggestedStrategyExplanation, stabilizationRecommendation,
    strategicFlowState, strategyStatusPayload,
    recommendationUserStateMap, setRecommendationUserStateMap,
    recommendationSignals, setRecommendationSignals,
    setRecommendationRefinements, usedRecommendationIds: _usedRecommendationIds, setUsedRecommendationIds,
    cardBuildError, setCardBuildError, setValidationError,
    boltTextPreset, boltProgress, setBoltProgress, fastLoadingCardId, setFastLoadingCardId,
    generatedCampaignId, setGeneratedCampaignId,
    assistPanelOpen, assistTopic, openAssistPanel, handleAssistConfirm, handleAssistSkip,
    targetAudience, tentativeStartDate, campaignGoal, frequencyPerWeek, contentDepth,
    communicationStyle, professionalSegments, buildAiChatExecutionConfig,
    jobId, jobStatus, jobError, polledJob,
    highlightedState,
    cardsSectionRef, themesSectionRef, firstCardRef, isMountedRef,
  } = props;

  return {
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
  };
}
