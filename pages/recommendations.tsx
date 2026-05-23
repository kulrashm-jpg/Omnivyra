import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../components/CompanyContext';
import { fetchWithAuth } from '../components/community-ai/fetchWithAuth';
import VoiceNotesComponent from '../components/VoiceNotesComponent';
import {
  buildTrendSourceCounts,
  getConfidenceLabel,
  hasNoExternalSignals,
  shouldShowNoveltyWarning,
} from '../backend/services/recommendationUiExplainability';
import TrendCampaignsTab from '../components/recommendations/tabs/TrendCampaignsTab';
import NextStrategicDirection from '../components/campaigns/NextStrategicDirection';
import { useRecommendationViewMode } from '../components/recommendations/hooks/useRecommendationViewMode';
import ActiveLeadsTab from '../components/recommendations/tabs/ActiveLeadsTab';
import MarketPulseTab from '../components/recommendations/tabs/MarketPulseTab';
import RecommendationStatusWidget from '../components/recommendations/RecommendationStatusWidget';
import StrategySignalsWidget from '../components/dashboard/StrategySignalsWidget';
import {
  type TrendSignal,
  type RecommendationEngineResult,
  type DetectedOpportunity,
  type TrendSourceLegendItem,
  type ExternalApiOption,
  OPPORTUNITY_TAB_TYPES,
  TREND_SOURCE_LEGEND,
} from './recommendations.types';

type IntelligentMixState = import('./command-center/intelligent-mix-strategy').IntelligentMixState;

import { useRecommendationsState } from '../hooks/useRecommendationsState';
import RecommendationsContent from '../components/RecommendationsContent';

export default function RecommendationsPage() {
  const d = useRecommendationsState();
  const { showLoadingState, showNoCompanyState } = d;

  if (showLoadingState) {
    return <div className='min-h-screen bg-gray-50'><div className='p-6 text-gray-500'>Loading company context...</div></div>;
  }
  if (showNoCompanyState) {
    return <div className='min-h-screen bg-gray-50'><div className='p-6 text-gray-500'>Select a company to view recommendations.</div></div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <RecommendationsContent d={d} />
    </div>
  );
}
