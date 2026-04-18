import React, { useState, useEffect, useRef, useMemo } from 'react';
import ReactDOM from 'react-dom';
import TrendCampaignsHistoryDrawer from './TrendCampaignsHistoryDrawer';
import TrendCampaignsRecommendationCards from './TrendCampaignsRecommendationCards';
import {
  CampaignAssistPanel,
  EMPTY_ASSIST_CONTEXT,
  type AssistContext,
} from '../../campaigns/CampaignAssistPanel';
import { useRouter } from 'next/router';

import type { OpportunityTabProps } from './types';
import EngineContextPanel from '../EngineContextPanel';
import UnifiedContextModeSelector, { type ContextMode, type FocusModule } from '../engine-framework/UnifiedContextModeSelector';
import StrategicAspectSelector from '../engine-framework/StrategicAspectSelector';
import EngineJobStatusPanel from '../../engines/EngineJobStatusPanel';
import { useEngineJobPolling } from '../../../hooks/useEngineJobPolling';
import OfferingFacetSelector from '../engine-framework/OfferingFacetSelector';
import StrategicConsole from '../engine-framework/StrategicConsole';
import RecommendationBlueprintCard, {
  getConfidenceTierForRecommendation,
  getJourneyState,
  getDecisionMomentumState,
  type BoltOutcomeView,
} from '../cards/RecommendationBlueprintCard';
import StrategicWorkspacePanel from '../StrategicWorkspacePanel';
import AIGenerationProgress from '../../AIGenerationProgress';
import BOLTProgressModal, { type BOLTProgress } from '../../BOLTProgressModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  PRIMARY_OPTIONS,
  PERSONAL_BRAND_SECONDARY_GROUPS,
  getSecondaryOptionsForPrimary,
  isPersonalBrandPrimary,
  buildHierarchicalPayload,
  getDilutionSeverity,
  type PrimaryCampaignTypeId,
  type SecondaryOptionId,
} from '../../../lib/campaignTypeHierarchy';
import { TARGET_AUDIENCE_CATEGORIES, PROFESSIONAL_SEGMENTS } from '../../../lib/audienceCategories';
import { buildSourceStrategicTheme } from '../../../lib/recommendationStrategicCard';


import {
  TYPE,
  TREND_CLUSTER_PAYLOAD_BRIDGE,
  PULSE_TOPIC_BRIDGE,
  type ClusterInput,
  type PulseTopicBridge,
  type ExecutionConfig,
  type StrategicPayload,
  type StrategyStatusForProgress,
  type StrategicFlowState,
  type CardSignals,
  ISO_COUNTRIES,
  safeParseClusterPayload,
  matchCountry,
  tokenToIsoCode,
  regionInputToIsoCodes,
  getRecommendationPriorityScore,
  getProgressAdjustment,
  getStrategicFlowState,
  FLOW_SUMMARY_MESSAGES,
  StrategicFlowSummary,
} from './TrendCampaignsTabHelpers';
import type { StrategyStatusPayload } from '../../strategy/StrategyIntelligencePanel';



import { useTrendCampaignsCore } from './useTrendCampaignsCore';
import { useTrendCampaignsHandlers } from './useTrendCampaignsHandlers';

export function useTrendCampaignsState(props: OpportunityTabProps) {
  const core = useTrendCampaignsCore(props);
  const handlers = useTrendCampaignsHandlers(core);
  return { ...core, ...handlers };
}
