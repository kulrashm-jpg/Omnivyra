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
import CampaignAIChat from '../../components/CampaignAIChat';
import AIGenerationProgress from '../../components/AIGenerationProgress';
import { useCompanyContext } from '../../components/CompanyContext';
import { fetchWithAuth } from '../../components/community-ai/fetchWithAuth';
import { GovernanceStatusCard } from '../../components/governance/GovernanceStatusCard';
import { GovernanceAnalyticsCard } from '../../components/governance/GovernanceAnalyticsCard';
import { GovernanceExplanationPanel, deriveFromEvent } from '../../components/governance/GovernanceExplanationPanel';
import { GovernanceTimeline } from '../../components/governance/GovernanceTimeline';
import { PreemptionHistory } from '../../components/governance/PreemptionHistory';
import { TradeOffSuggestionList } from '../../components/governance/TradeOffSuggestionList';
import { truncateMeaningfulTitle } from '../../lib/ui/truncateMeaningfulTitle';
import { getExecutionIntelligence } from '../../utils/getExecutionIntelligence';
import { isCreatorDependentContentType } from '../../utils/contentTaxonomy';
import { getFormatLineForContentType, getIntentLabelForContentType, toneForUserDisplay } from '../../utils/formatLineForContentType';
import PlatformIcon from '../../components/ui/PlatformIcon';
import { getViewMode } from '../../utils/getViewMode';
import { VIEW_RULES } from '../../utils/viewVisibilityMatrix';
import {
  saveWizardState,
  loadWizardState,
  clearWizardState,
  defaultQuestionnaireAnswers,
  type QuestionnaireAnswers,
  type PrePlanningResult,
} from '../../utils/campaignWizardStorage';
import { ENABLE_UNIFIED_CAMPAIGN_WIZARD } from '../../config/featureFlags';
import { useCampaignWizard, createCampaignWizardStore } from '../../store/campaignWizardStore';
import { hydrateWizardFromSnapshot, exportWizardToSaveWizardStatePayload, exportWizardToPlanningContext } from '../../lib/wizard/campaignWizardAdapter';
import { useCampaignResume } from '../../hooks/useCampaignResume';
import { PLATFORM_LABELS } from '../../lib/shared/platforms';

interface Campaign {
  id: string;
  name: string;
  description: string;
  status: string;
  current_stage: string;
  start_date: string;
  end_date: string;
  created_at: string;
  weekly_themes: any[];
  duration_weeks?: number | null;
  blueprint_status?: string | null;
}

interface WeeklyPlan {
  weekNumber: number;
  phase: string;
  theme: string;
  focusArea: string;
  keyMessaging: string;
  contentTypes: string[];
  targetMetrics: {
    impressions: number;
    engagements: number;
    conversions: number;
    ugcSubmissions: number;
  };
  status: string;
  completionPercentage: number;
  weeklyContextCapsule?: {
    campaignTheme?: string;
    primaryPainPoint?: string;
    desiredTransformation?: string;
    campaignStage?: string;
    psychologicalGoal?: string;
    momentum?: string;
    audienceProfile?: string;
    weeklyIntent?: string;
    toneGuidance?: string;
    successOutcome?: string;
  } | null;
  topics?: Array<{
    topicTitle?: string;
    topicContext?: {
      writingIntent?: string;
      topicTitle?: string;
    };
    contentTypeGuidance?: {
      primaryFormat?: string;
      maxWordTarget?: number;
      platformWithHighestLimit?: string;
      adaptationRequired?: boolean;
    };
    whoAreWeWritingFor?: string;
    whatProblemAreWeAddressing?: string;
    whatShouldReaderLearn?: string;
    desiredAction?: string;
    narrativeStyle?: string;
    topicExecution?: {
      platformTargets?: string[];
      contentType?: string;
      ctaType?: string;
      kpiFocus?: string;
    };
  }>;
}

interface DailyPlan {
  id: string;
  weekNumber: number;
  dayOfWeek: string;
  platform: string;
  contentType: string;
  title: string;
  content: string;
  description?: string;
  topic?: string;
  introObjective?: string;
  summary?: string;
  objective?: string;
  keyPoints?: string[];
  cta?: string;
  brandVoice?: string;
  themeLinkage?: string;
  formatNotes?: string;
  hashtags: string[];
  scheduledTime?: string;
  status: string;
  dailyObject?: Record<string, unknown>;
}

interface ReadinessResponse {
  campaign_id: string;
  readiness_percentage: number;
  readiness_state: 'not_ready' | 'partial' | 'ready';
  blocking_issues?: Array<{ code: string; message: string }>;
}

interface GateRequiredAction {
  title: string;
  why: string;
  action: string;
  applies_to_platforms?: string[];
}

interface GateResponse {
  campaign_id: string;
  gate_decision: 'pass' | 'warn' | 'block';
  reasons: string[];
  required_actions: GateRequiredAction[];
  advisory_notes: string[];
  evaluated_at: string;
}

interface DiagnosticSummary {
  diagnostic_summary: string;
  diagnostic_confidence: 'low' | 'normal';
}

interface ViralityAssessmentResponse {
  diagnostics: {
    asset_coverage: DiagnosticSummary;
    platform_opportunity: DiagnosticSummary;
    engagement_readiness: DiagnosticSummary;
  };
}

interface RecommendationSummary {
  recommendation_id: string;
  trend?: string;
  category?: string;
  audience?: any;
  geo?: any;
  platforms?: any;
  promotion_mode?: string;
}

interface PerformanceSummary {
  campaign_id: string;
  impressions: number;
  likes: number;
  shares: number;
  comments: number;
  clicks: number;
  engagement_rate: number;
  expected_reach?: number | null;
  accuracy_score: number;
  recommendation_confidence?: number | null;
  last_collected_at?: string | null;
}


import { useCampaignDetailsState } from '../../hooks/useCampaignDetailsState';
import CampaignDetailsContent from '../../components/CampaignDetailsContent';
import PageLoader from '../../components/PageLoader';
export default function CampaignDetailsPage() {
  const d = useCampaignDetailsState();
  if (d._ef1) return <PageLoader message="Loading campaign…" />;
  if (d._ef2) return <PageLoader message="Loading campaign…" />;
  if (d._ef3) return <PageLoader message="Loading campaign…" />;
  if (d._ef4) return <PageLoader message="Loading campaign…" />;
  if (d._ef5) return <PageLoader message="Loading campaign…" />;
  return <CampaignDetailsContent d={d} />;
}

