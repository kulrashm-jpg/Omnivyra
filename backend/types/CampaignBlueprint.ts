/**
 * Canonical weekly plan model for unifying all planning flows.
 * Strategic blueprint level only — no daily structure.
 */

export interface CampaignBlueprint {
  campaign_id: string;
  duration_weeks: number;
  weeks: CampaignBlueprintWeek[];
  /** Short strategic narrative (e.g. "This campaign begins by raising awareness..."). */
  campaign_strategy_summary?: string;
}

export interface PlatformContentBreakdownItem {
  type: string;
  count: number;
  topic?: string;
  topics?: string[];
  platforms?: string[];
}

export interface WeeklyContextCapsule {
  campaignTheme: string;
  primaryPainPoint: string;
  desiredTransformation: string;
  campaignStage: string;
  psychologicalGoal: string;
  momentum: string;
  audienceProfile: string;
  weeklyIntent: string;
  toneGuidance: string;
  successOutcome: string;
}

export interface TopicContext {
  topicTitle: string;
  topicGoal: string;
  audienceAngle: string;
  painPointFocus: string;
  transformationIntent: string;
  messagingAngle: string;
  expectedOutcome: string;
  recommendedContentTypes: string[];
  platformPriority: string[];
  writingIntent: string;
}

export interface TopicContentTypeGuidance {
  primaryFormat: string;
  maxWordTarget: number;
  platformWithHighestLimit: string;
  adaptationRequired: true;
}

export interface WeeklyTopicWritingBrief {
  topicTitle: string;
  topicContext: TopicContext;
  whoAreWeWritingFor: string;
  whatProblemAreWeAddressing: string;
  whatShouldReaderLearn: string;
  desiredAction: string;
  approximateDepth: string;
  narrativeStyle: string;
  contentTypeGuidance: TopicContentTypeGuidance;
}

/** Dynamic extras per week: summary, objectives, days_to_post, etc. Keys added at runtime. */
export type WeekExtras = Record<string, unknown>;

export interface CampaignBlueprintWeek {
  week_number: number;
  phase_label: string;
  primary_objective: string;
  topics_to_cover?: string[];
  weeklyContextCapsule?: WeeklyContextCapsule;
  topics?: WeeklyTopicWritingBrief[];
  platform_allocation: Record<string, number>;
  content_type_mix: string[];
  cta_type: string;
  weekly_kpi_focus: string;
  platform_content_breakdown?: Record<string, PlatformContentBreakdownItem[]>;
  platform_topics?: Record<string, string[]>;
  /**
   * Deterministic execution units (additive).
   * Each execution_item has topic_slots; each slot may have optional master_content_id (one slot = one logical content piece).
   * Scheduling fields (topic_code, content_code, scheduled_day, scheduled_time, etc.) are assigned by weeklyScheduleAllocator.
   * Kept as `any` here to avoid tight coupling across services.
   */
  execution_items?: any[];
  posting_execution_map?: any[];
  resolved_postings?: any[];
  /** Flexible key-value store for AI/UI additions: summary, objectives, days_to_post, etc. */
  week_extras?: WeekExtras;
  /** Phase 5: Distribution insights from contentDistributionIntelligence (read-only recommendations). */
  distribution_insights?: Array<{ type: string; severity: string; message: string; recommendation?: string }>;
}
