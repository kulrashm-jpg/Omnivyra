export interface ChatMessage {
  id: number;
  type: 'user' | 'ai';
  message: string;
  timestamp: string;
  attachments?: string[];
  provider?: string;
  campaignId?: string;
}

export interface CampaignLearning {
  campaignId: string;
  campaignName: string;
  goals: any[];
  performance: {
    engagement: number;
    reach: number;
    conversions: number;
    actualResults: any[];
  };
  learnings: string[];
  improvements: string[];
}

export interface RecommendationContext {
  target_regions?: string[] | null;
  context_payload?: Record<string, unknown> | null;
  source_opportunity_id?: string | null;
  topic_from_card?: string | null;
}

export interface AIChatProps {
  isOpen: boolean;
  onClose: () => void;
  onMinimize: () => void;
  context?: string;
  companyId?: string;
  campaignId?: string;
  campaignData?: any;
  recommendationContext?: RecommendationContext | null;
  onProgramGenerated?: (program: any) => void;
  governanceLocked?: boolean;
  optimizationContext?: { roiScore: number; headlines: string[] };
  prefilledPlanning?: Record<string, unknown> | null;
  initialPlan?: { weeks: any[] } | null;
  standalone?: boolean;
  vetScope?: { selectedWeeks: number[]; areasByWeek?: Record<number, string[]> };
  collectedPlanningContext?: Record<string, unknown> | null;
  forceFreshPlanningThread?: boolean;
  onBackToRecommendation?: () => void;
}

export type AIProvider = 'gpt' | 'claude' | 'demo';

export type ProgressiveStyleConfig = {
  primaryOptions: string[];
  secondaryByPrimary: Record<string, string[]>;
  primaryTooltips?: Record<string, string>;
  secondaryTooltips?: Record<string, string>;
};

export type QuickPickConfig = {
  key:
    | 'campaign_duration' | 'target_audience' | 'available_content' | 'audience_professional_segment'
    | 'communication_style' | 'action_expectation' | 'content_depth' | 'topic_continuity'
    | 'platforms' | 'platform_content_types' | 'platform_content_requests' | 'exclusive_campaigns'
    | 'campaign_types' | 'success_metrics' | 'tentative_start' | 'content_capacity'
    | 'cross_platform_sharing' | 'capacity_override' | 'key_messages';
  multi: boolean;
  options: string[];
  progressiveStyle?: ProgressiveStyleConfig;
  helperText?: string;
  optionDescriptions?: Record<string, string>;
  optionTooltips?: Record<string, string>;
};

export const CAMPAIGN_AI_PROVIDER_KEY = 'virality-campaign-ai-provider';

export function getStoredProvider(): AIProvider {
  if (typeof window === 'undefined') return 'claude';
  const s = localStorage.getItem(CAMPAIGN_AI_PROVIDER_KEY);
  if (s === 'gpt' || s === 'claude' || s === 'demo') return s;
  return 'claude';
}

export type StructuredDay = {
  day: string;
  objective: string;
  content: string;
  platforms: Record<string, string>;
  hashtags?: string[];
  seo_keywords?: string[];
  meta_title?: string;
  meta_description?: string;
  hook?: string;
  cta?: string;
  best_time?: string;
  effort_score?: number;
  success_projection?: number;
};

export type StructuredWeek = {
  week: number;
  theme?: string;
  daily?: StructuredDay[];
  phase_label?: string;
  topics_to_cover?: string[];
  primary_objective?: string;
  platform_allocation?: Record<string, number>;
  content_type_mix?: string[];
  cta_type?: string;
  total_weekly_content_count?: number;
  weekly_kpi_focus?: string;
  platform_content_breakdown?: Record<string, Array<{ type: string; count: number; topic?: string; topics?: string[]; platforms?: string[] }>>;
  platform_topics?: Record<string, string[]>;
  weeklyContextCapsule?: {
    audienceProfile?: string;
    weeklyIntent?: string;
    toneGuidance?: string;
    campaignStage?: string;
    psychologicalGoal?: string;
  };
  topics?: Array<{
    topicTitle?: string;
    whoAreWeWritingFor?: string;
    whatProblemAreWeAddressing?: string;
    whatShouldReaderLearn?: string;
    desiredAction?: string;
    narrativeStyle?: string;
    topicContext?: { writingIntent?: string };
    contentTypeGuidance?: { primaryFormat?: string; maxWordTarget?: number; platformWithHighestLimit?: string };
  }>;
  resolved_postings?: Array<{
    posting_id?: string;
    posting_order?: number;
    execution_id?: string;
    platform?: string;
    content_type?: string;
    progression_step?: number;
    global_progression_index?: number;
    narrative_position?: string;
    narrative_role?: string;
    format_validation_warning?: boolean;
    alignment_reason?: string[];
    writer_content_brief?: { format_requirements?: { format_family?: string } };
  }>;
  summary?: string;
  objectives?: string[];
  goals?: string[];
  suggested_days_to_post?: string[];
};

export type StructuredPlan = {
  weeks: StructuredWeek[];
  format?: 'blueprint' | 'legacy';
};

export type RefinedDay = {
  week: number;
  day: string;
  objective: string;
  content: string;
  platforms: Record<string, string>;
  hashtags?: string[];
  seo_keywords?: string[];
  meta_title?: string;
  meta_description?: string;
  hook?: string;
  cta?: string;
  best_time?: string;
  effort_score?: number;
  success_projection?: number;
};

export type PlatformCustomization = {
  day: string;
  platforms: Record<string, string>;
};

export type AiHistoryEntry = {
  snapshot_hash: string;
  omnivyre_decision: any;
  structured_plan: StructuredPlan;
  scheduled_posts: Array<{
    id: string;
    platform: string;
    content: string;
    scheduled_for: string;
    status: string;
    created_at: string;
  }>;
  created_at: string;
};
