import type { DecisionResult } from '../omnivyreClient';
import type { CapacityValidationResult } from '../capacityFrequencyValidationGateway';
import type { CampaignValidation } from '../../lib/validation/campaignValidator';
import type { PaidRecommendation } from '../../lib/ads/paidAmplificationEngine';

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
  /** Stage 35: ROI + optimization headlines for AI context injection */
  optimizationContext?: OptimizationContext | null;
  /** When refining an existing plan, pass the current plan so AI can apply changes */
  currentPlan?: { weeks: any[] };
  /** Scope to specific weeks (1-based) — only modify these weeks; null/empty = all weeks */
  scopeWeeks?: number[] | null;
  /** Chat context (e.g. campaign-recommendations) for consultation-style flows */
  chatContext?: string;
  /** Pre-selected weeks and areas when opening from recommendations page */
  vetScope?: { selectedWeeks: number[]; areasByWeek?: Record<number, string[]> };
  /** Client-collected planning context (form state, pre-planning result) — merged with prefilled to avoid re-asking */
  collectedPlanningContext?: Record<string, unknown>;
  /** Optional one-click orchestration: generation + adaptation + scheduling */
  autopilot?: boolean;
  /** Variant-scoped observability metadata supplied by adapters. */
  variantMetadata?: Record<string, unknown>;
  /** Account context for planning influence (maturity, performance, recommendations) */
  account_context?: import('./../../types/accountContext').AccountContext | null;
  /** Performance learnings from a previous campaign — fed forward into the AI prompt so each campaign improves on the last. */
  previous_performance_insights?: import('./../../lib/performance/performanceAnalyzer').PerformanceInsight | null;
  /**
   * Full context record from the most recent completed campaign.
   * Richer than previous_performance_insights alone — includes validation + paid decision + execution results.
   */
  previous_campaign_context?: {
    validation?: import('./../../lib/validation/campaignValidator').CampaignValidation | null;
    paid_recommendation?: import('./../../lib/ads/paidAmplificationEngine').PaidRecommendation | null;
    performance_insights?: import('./../../lib/performance/performanceAnalyzer').PerformanceInsight | null;
    captured_at?: string | null;
  } | null;
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
  /** Deterministic plan quality gate: confidence score, risk, outcomes, issues, suggestions. */
  campaign_validation?: CampaignValidation | null;
  /** Deterministic paid amplification decision: should we run ads, when, how much, why. */
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

export type DeliverableType = 'post' | 'video' | 'blog' | 'carousel' | 'story' | 'thread' | 'short';
export type PlanDeliverables = {
  videos: number;
  posts: number;
  blogs: number;
  stories?: number;
};
export type PlanSkeleton = {
  durationWeeks: number;
  weeklySlots: Array<{
    weekNumber: number;
    requiredDeliverables: PlanDeliverables;
  }>;
};

export type AlignmentSuggestion = {
  weekNumber: number;
  suggestion: string;
};

export type AlignmentEvaluation = {
  alignmentScore: number;
  progressionScore: number;
  diversityScore: number;
  platformAlignmentScore: number;
  psychologicalFitScore: number;
  issues: string[];
  suggestedAdjustments: AlignmentSuggestion[];
  parseFailed?: boolean;
};

export const ALIGNMENT_ACCEPT_THRESHOLD = 70;

export type WeeklyAlignmentProfile = {
  score: number;
  progressionWeak: boolean;
  diversityWeak: boolean;
  platformWeak: boolean;
  psychologicalWeak: boolean;
};

export type WeeklyWritingContextInput = {
  structured: { weeks: any[] };
  recommendationContext?: RecommendationContext | null;
  prefilledPlanning?: Record<string, unknown> | null;
  campaignStage?: string | null;
  psychologicalGoal?: string | null;
  momentum?: string | null;
  alignment?: AlignmentEvaluation | null;
  /** Phase 2B — authoritative brand voice (BrandRuntime) when a brand_identity
   *  row exists; undefined otherwise so the legacy tone chain is unchanged. */
  brandVoiceOverride?: string;
};

export type CampaignAiRuntimeContext = {
  snapshot: any;
  snapshot_hash: string;
  diagnostics: any;
  omnivyreDecision: import('../omnivyreClient').DecisionResult;
  platformStrategies: any[];
  companyContext?: string | null;
  forcedContextBlock?: string | null;
  strategyDNA?: ReturnType<typeof import('../companyStrategyDNAService').buildCompanyStrategyDNA> | null;
  campaignIntentSummary?: {
    types: string[];
    weights: Record<string, number>;
    primary_type: string;
  } | null;
  baselineContext?: BaselineContextResult;
  prefilledPlanning?: Record<string, unknown>;
  planSkeleton?: PlanSkeleton | null;
  campaignStage?: string | null;
  psychologicalGoal?: string | null;
  momentum?: string | null;
  qaState?: {
    answeredKeys: string[];
    userConfirmed: boolean;
    nextQuestion: { key: string; question: string } | null;
    readyToGenerate?: boolean;
    allRequiredAnswered?: boolean;
    missingRequiredKeys?: string[];
  };
  distributionStrategy?: import('../planningIntelligenceService').DistributionStrategy;
  distributionReason?: string;
  fastPath?: boolean;
  strategyMemory?: { preferred_tone?: string | null; preferred_platforms?: string[] } | null;
  strategyLearningProfile?: import('../campaignStrategyLearner').StrategyProfile | null;
  strategyLearningFromCache?: boolean;
  campaignContext?: import('../contextCompressionService').CampaignContext | null;
  companyId?: string | null;
  assistContext?: {
    blog_context?: { blogs: { title: string; summary: string; key_insights: string[]; tags: string[]; headings: string[] }[] } | null;
    insight_context?: { insights: string[] } | null;
    topic_context?: { topics: string[] } | null;
    ai_assist?: boolean | null;
  } | null;
};

export type DeterministicWriterContentBrief = {
  title: string;
  tone: string;
  intent_type: string;
  core_message: string;
  key_points: string[];
  must_include: string[];
  avoid: string[];
  cta_instruction: string;
  structure_hint: string;
  progression_note: string;
  format_requirements?: {
    format_family: string;
    required_assets: string[];
    structure_template: string[];
    platform_considerations: string[];
    production_notes: string[];
  };
};

export type DailyExecutionSourceType = 'planned' | 'manual';

export type DailyExecutionItem = {
  execution_id: string;
  source_type: DailyExecutionSourceType;
  campaign_id?: string;
  week_number?: number;
  platform: string;
  content_type: string;
  topic?: string;
  title?: string;
  content?: string;
  intent?: Record<string, unknown>;
  writer_content_brief?: Record<string, unknown>;
  narrative_role?: string;
  progression_step?: number;
  global_progression_index?: number;
  status: 'draft';
  scheduled_time?: string;
  /** Stable id for one logical content piece (optional, backward compatible). */
  master_content_id?: string;
  /** Execution ownership (enrichment-only). Frozen type prevents accidental values like "CREATOR" or "AUTO". */
  execution_mode?: import('../executionModeInference').ExecutionMode;
  /** When CREATOR_REQUIRED or CONDITIONAL_AI: structured guidance for creator (title, objective, formatHint, etc.). */
  creator_instruction?: Record<string, unknown>;
  master_content?: {
    id: string;
    generated_at: string;
    content: string;
    generation_status: 'pending' | 'generated' | 'failed';
    generation_source: 'ai';
  };
  platform_variants?: Array<{
    platform: string;
    content_type: string;
    generated_content: string;
    generation_status: 'pending' | 'generated' | 'failed';
    locked_variant: boolean;
    generation_overrides?: Record<string, unknown>;
  }>;
};

export interface BaselineContext {
  stage: string;
  scope: string;
  expectedBaseline: number;
  actualFollowers: number;
  ratio: number;
  status: 'underdeveloped' | 'aligned' | 'strong';
  primaryPlatform: string;
}

export type BaselineContextResult = BaselineContext | { unavailable: true };
