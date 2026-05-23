import { DecisionResult } from '../omnivyreClient';
import { CampaignValidation } from '../../lib/validation/campaignValidator';
import { PaidRecommendation } from '../../lib/ads/paidAmplificationEngine';
import { CapacityValidationResult } from '../capacityFrequencyValidationGateway';

export type CampaignAiMode = 'generate_plan' | 'refine_day' | 'platform_customize';

export interface RecommendationContext {
  target_regions?: string[] | null;
  context_payload?: Record<string, unknown> | null;
  source_opportunity_id?: string | null;
}

export interface ConversationMessage {
  type: 'user' | 'ai';
  message: string;
}

export interface OptimizationContext {
  roiScore: number;
  headlines: string[];
}

export interface CampaignAiPlanInput {
  campaignId: string;
  mode: CampaignAiMode;
  message: string;
  durationWeeks?: number;
  targetDay?: string;
  platforms?: string[];
  conversationHistory?: ConversationMessage[];
  recommendationContext?: RecommendationContext | null;
  optimizationContext?: OptimizationContext | null;
  currentPlan?: { weeks: any[] };
  scopeWeeks?: number[] | null;
  chatContext?: string;
  vetScope?: { selectedWeeks: number[]; areasByWeek?: Record<number, string[]> };
  collectedPlanningContext?: Record<string, unknown>;
  autopilot?: boolean;
  variantMetadata?: Record<string, unknown>;
  account_context?: import('./../../types/accountContext').AccountContext | null;
  previous_performance_insights?: import('./../../lib/performance/performanceAnalyzer').PerformanceInsight | null;
  previous_campaign_context?: {
    validation?: import('./../../lib/validation/campaignValidator').CampaignValidation | null;
    paid_recommendation?: import('./../../lib/ads/paidAmplificationEngine').PaidRecommendation | null;
    performance_insights?: import('./../../lib/performance/performanceAnalyzer').PerformanceInsight | null;
    captured_at?: string | null;
  } | null;
  /**
   * Optional progress observer invoked at key internal milestones during
   * generate_plan. Fired only on the happy path so callers (BOLT pipeline)
   * can surface intra-stage progress to the UI — purely advisory, errors
   * thrown inside the callback are swallowed by the orchestrator. Known
   * substage keys: 'context' | 'drafting' | 'scoring' | 'refining'.
   */
  onSubStage?: (substage: string) => void;
}

export interface CampaignAiPlanResult {
  mode: CampaignAiMode;
  snapshot_hash: string;
  omnivyre_decision: DecisionResult;
  validation_result?: CapacityValidationResult | null;
  plan?: {
    weeks: Array<{
      week: number;
      theme: string;
      daily: Array<{
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
      }>;
    }>;
  };
  day?: {
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
  platform_content?: {
    day: string;
    platforms: Record<string, string>;
  };
  conversationalResponse?: string;
  raw_plan_text: string;
  campaign_validation?: CampaignValidation | null;
  paid_recommendation?: PaidRecommendation | null;
  autopilot_result?: {
    total_items: number;
    generated_masters: number;
    generated_variants: number;
    scheduled_items: number;
    skipped_locked: number;
    skipped_missing_media: number;
  };
}
