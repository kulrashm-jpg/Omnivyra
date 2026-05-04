import React, { useState, useEffect, useCallback, useRef } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { 
  ArrowLeft, 
  Calendar, 
  Target, 
  Plus, 
  Save, 
  CheckCircle,
  AlertCircle,
  Clock,
  TrendingUp,
  FileText,
  Image,
  Video,
  Mic,
  Loader2,
  X,
  Sparkles,
  Eye,
  BarChart3,
  Users,
  Hash,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Settings,
  GripVertical,
  RotateCcw,
  Activity,
} from 'lucide-react';
import CampaignAIChat from '../components/CampaignAIChat';
import AIGenerationProgress from '../components/AIGenerationProgress';
import { useCompanyContext } from '../components/CompanyContext';
import { apiFetch } from '@/lib/apiFetch';
import { GovernanceStatusCard } from '../components/governance/GovernanceStatusCard';
import { GovernanceAnalyticsCard } from '../components/governance/GovernanceAnalyticsCard';
import { GovernanceExplanationPanel, deriveFromEvent } from '../components/governance/GovernanceExplanationPanel';
import { GovernanceTimeline } from '../components/governance/GovernanceTimeline';
import { PreemptionHistory } from '../components/governance/PreemptionHistory';
import { TradeOffSuggestionList } from '../components/governance/TradeOffSuggestionList';
import { truncateMeaningfulTitle } from '../lib/ui/truncateMeaningfulTitle';
import { getExecutionIntelligence } from '../utils/getExecutionIntelligence';
import { isCreatorDependentContentType } from '../utils/contentTaxonomy';
import { getFormatLineForContentType, getIntentLabelForContentType, toneForUserDisplay } from '../utils/formatLineForContentType';
import PlatformIcon from '../components/ui/PlatformIcon';
import { getViewMode } from '../utils/getViewMode';
import { VIEW_RULES } from '../utils/viewVisibilityMatrix';
import {
  saveWizardState,
  loadWizardState,
  clearWizardState,
  defaultQuestionnaireAnswers,
  type QuestionnaireAnswers,
  type PrePlanningResult,
} from '../utils/campaignWizardStorage';
import { ENABLE_UNIFIED_CAMPAIGN_WIZARD } from '../config/featureFlags';
import { useCampaignWizard, createCampaignWizardStore } from '../store/campaignWizardStore';
import { hydrateWizardFromSnapshot, exportWizardToSaveWizardStatePayload, exportWizardToPlanningContext } from '../lib/wizard/campaignWizardAdapter';
import { useCampaignResume } from './useCampaignResume';
import { PLATFORM_LABELS } from '../backend/constants/platforms';

import type { Campaign, WeeklyPlan, DailyPlan, ReadinessResponse, GateResponse, GateRequiredAction, DiagnosticSummary, ViralityAssessmentResponse, RecommendationSummary, PerformanceSummary } from '../pages/campaign-details/types';
import { useCampaignDetailsCore } from './useCampaignDetailsCore';
import { useCampaignDetailsHandlers } from './useCampaignDetailsHandlers';

export function useCampaignDetailsState() {
  const core = useCampaignDetailsCore();
  const handlers = useCampaignDetailsHandlers(core);
  return { ...core, ...handlers };
}
