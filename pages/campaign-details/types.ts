// Types for the Campaign Details page

export interface Campaign {
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

export interface WeeklyPlan {
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

export interface DailyPlan {
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

export interface ReadinessResponse {
  campaign_id: string;
  readiness_percentage: number;
  readiness_state: 'not_ready' | 'partial' | 'ready';
  blocking_issues?: Array<{ code: string; message: string }>;
}

export interface GateRequiredAction {
  title: string;
  why: string;
  action: string;
  applies_to_platforms?: string[];
}

export interface GateResponse {
  campaign_id: string;
  gate_decision: 'pass' | 'warn' | 'block';
  reasons: string[];
  required_actions: GateRequiredAction[];
  advisory_notes: string[];
  evaluated_at: string;
}

export interface DiagnosticSummary {
  diagnostic_summary: string;
  diagnostic_confidence: 'low' | 'normal';
}

export interface ViralityAssessmentResponse {
  diagnostics: {
    asset_coverage: DiagnosticSummary;
    platform_opportunity: DiagnosticSummary;
    engagement_readiness: DiagnosticSummary;
  };
}

export interface RecommendationSummary {
  recommendation_id: string;
  trend?: string;
  category?: string;
  audience?: any;
  geo?: any;
  platforms?: any;
  promotion_mode?: string;
}

export interface PerformanceSummary {
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
export default function CampaignDetailsTypesPage() {
  return null;
}
