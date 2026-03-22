/**
 * Campaign Planning Types
 * Strict input contract for planning generation. Single structure for preview and persisted pipelines.
 */

export interface IdeaSpine {
  refined_title?: string | null;
  refined_description?: string | null;
  selected_angle?: string | null;
  title?: string | null;
  description?: string | null;
}

export interface StrategyContext {
  strategy_schema_version?: number;
  duration_weeks: number;
  platforms: string[];
  posting_frequency: Record<string, number>;
  content_mix?: Record<string, number>;
  campaign_goal?: string | null;
  target_audience?: string | null;
  /** Strategic aspects selected by the user for this campaign (from company profile). */
  selected_aspects?: string[] | null;
  /** Specific offerings selected within the chosen strategic aspects. */
  selected_offerings?: string[] | null;
}

export interface PlanningGenerationInput {
  companyId: string;
  idea_spine: IdeaSpine;
  strategy_context: StrategyContext;
  campaign_direction: string;
  /** Repair flows populate this instead of mutating idea_spine.refined_description. */
  repair_instruction?: string | null;
  /** When provided, use deterministic skeleton instead of full AI. Planner matrix format. */
  platform_content_requests?: Record<string, Record<string, number>> | null;
  /** Campaign type for execution_mode: TEXT→AI, CREATOR→CREATOR, HYBRID→by content_type. */
  campaign_type?: 'TEXT' | 'CREATOR' | 'HYBRID' | null;
  /** Account context for influencing planning behavior based on maturity and performance. */
  account_context?: import('./accountContext').AccountContext | null;
  /** Mapped weekly skeleton: deterministic themes + funnel stages assigned per week. Set by orchestrator, consumed by AI prompt. */
  mapped_weekly_skeleton?: import('../services/strategyMapper').MappedWeeklySkeleton | null;
  /** Performance learnings from previous campaigns — injected into the AI prompt so each campaign improves on the last. */
  previous_performance_insights?: import('../lib/performance/performanceAnalyzer').PerformanceInsight | null;
  /**
   * Full context record from the most recent completed campaign for this company.
   * Combines validation + paid decision + performance memory into one planning signal.
   * When present, takes precedence over previous_performance_insights alone.
   */
  previous_campaign_context?: {
    validation?: import('../lib/validation/campaignValidator').CampaignValidation | null;
    paid_recommendation?: import('../lib/ads/paidAmplificationEngine').PaidRecommendation | null;
    performance_insights?: import('../lib/performance/performanceAnalyzer').PerformanceInsight | null;
    captured_at?: string | null;
  } | null;
  /** Blog posts selected by user in Campaign Assist Panel — used to anchor narrative and topics. */
  blog_context?: {
    blogs: {
      title: string;
      summary: string;
      key_insights: string[];
      tags: string[];
      headings: string[];
    }[];
  } | null;
  /** Manual insights curated by user in Campaign Assist Panel. */
  insight_context?: { insights: string[] } | null;
  /** Topic seeds entered by user in Campaign Assist Panel. */
  topic_context?: { topics: string[] } | null;
  /** When false, AI must strictly follow provided context without creative expansion. */
  ai_assist?: boolean | null;
}

export interface PlanningParseInput {
  companyId: string;
  rawOutput: string;
}
