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
}

export interface PlanningParseInput {
  companyId: string;
  rawOutput: string;
}
