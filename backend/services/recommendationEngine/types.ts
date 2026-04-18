import type { TrendSignalNormalized } from '../trendProcessingService';
import type { CompanyStrategyDNA } from '../companyStrategyDNAService';

/** Optional strategic selection from Trend tab; influences filtering, ranking, and card generation. */
export type StrategicPayloadInput = {
  selected_aspect?: string | null;
  /** Multiple aspects; treated as OR (recommendations match any). */
  selected_aspects?: string[];
  selected_offerings?: string[];
  strategic_text?: string;
  context_mode?: string;
  /** Hierarchical campaign focus: mapped core types for recommendation engine (from Campaign Focus flow). */
  mapped_core_types?: string[];
  primary_campaign_type?: string;
  context?: 'business' | 'personal' | 'third_party';
  /** Execution config from Trend execution bar; campaign_duration aligns theme count with campaign length. */
  execution_config?: {
    campaign_duration?: number;
    target_audience?: string;
    communication_style?: string[];
    content_depth?: string;
    frequency_per_week?: number;
    tentative_start?: string;
    campaign_goal?: string;
  } | null;
  /** Cluster inputs from pulse/cluster flow; problem_domain used for alignment. */
  cluster_inputs?: Array<{ problem_domain?: string; [key: string]: unknown }>;
  /** Focused modules when context_mode is FOCUSED. */
  focused_modules?: string[];
  /** Additional strategic direction. */
  additional_direction?: string;
  [key: string]: unknown;
};

/** Strategy momentum (repetitive usage, diversification). */
export type StrategyMomentumInput = {
  dominant_streak_aspect: string | null;
  dominant_streak_count: number;
  diversification_score: number;
};

/** Strategy history for journey context (optional; does not affect ranking). */
export type StrategyMemoryInput = {
  campaigns_count: number;
  aspect_counts: Record<string, number>;
  intent_tag_counts: Record<string, number>;
  dominant_aspects: string[];
  underused_aspects: string[];
  strategy_momentum?: StrategyMomentumInput | null;
};

export type InsightSource = 'api' | 'llm' | 'hybrid';

export type RecommendationEngineInput = {
  companyId: string;
  campaignId?: string | null;
  objective?: string;
  durationWeeks?: number;
  userId?: string | null;
  simulate?: boolean;
  selectedApiIds?: string[] | null;
  /** Multi-region: run external APIs per region and merge. Empty = use profile geo only. */
  regions?: string[];
  /** If false, use only stored company profile (skip website crawling / social discovery). */
  enrichmentEnabled?: boolean;
  /** Optional strategic selection; added to context tokens for prompts only (no ranking change). */
  strategicPayload?: StrategicPayloadInput | null;
  /** Optional strategy history (continuation/expansion); context only, no ranking change. */
  strategyMemory?: StrategyMemoryInput | null;
  /** api=external APIs only; llm=strategic themes from DB; hybrid=combine both. Default hybrid. */
  insightSource?: InsightSource;
};

export type PersonaSummary = {
  personas: string[];
  tone?: string | null;
  platform_preferences: string[];
};

export type ScenarioOutcomes = {
  best_case: number;
  worst_case: number;
  likely_case: number;
};

export type ScoringAdjustments = {
  base_confidence: number;
  adjusted_confidence: number;
  persona_fit: number;
  budget_fit: number;
  competitor_gap: number;
};

export type RecommendationEngineResult = {
  trends_used: TrendSignalNormalized[];
  trends_ignored: TrendSignalNormalized[];
  weekly_plan: any[];
  daily_plan: any[];
  confidence_score: number;
  explanation: string;
  sources: string[];
  persona_summary?: PersonaSummary;
  scenario_outcomes?: ScenarioOutcomes;
  scoring_adjustments?: ScoringAdjustments;
  signal_quality?: {
    external_api_health_snapshot: any;
    cache_hits: any;
    rate_limited_sources: string[];
    signal_confidence_summary: { average: number; min: number; max: number } | null;
  };
  omnivyra_metadata?: {
    decision_id?: string;
    confidence?: number;
    explanation?: string;
    placeholders?: string[];
    contract_version?: string;
  };
  omnivyra_learning?: {
    status: 'sent' | 'failed' | 'skipped';
    error?: string;
  };
  omnivyra_status?: {
    status: 'healthy' | 'degraded' | 'down' | 'disabled';
    confidence?: number;
    contract_version?: string;
    latency_ms?: number;
    fallback_reason?: string | null;
    last_error?: string | null;
    endpoint?: string | null;
  };
  novelty_score?: number;
  /** When multiple regions selected. */
  global_disclaimer?: string;
  /** EXTERNAL = from APIs; PROFILE_ONLY = no external signals. */
  signals_source?: 'EXTERNAL' | 'PROFILE_ONLY';
  /** Canonical company context (when profile available). */
  company_context?: import('../companyContextService').CompanyContext;
  /** Deterministic strategy interpretation from company profile. */
  strategy_dna?: CompanyStrategyDNA;
  /** Read-only analysis of strategy strengths/weaknesses from recommendations. */
  strategy_feedback?: import('../recommendationStrategyFeedbackService').StrategyFeedback;
  /** Strategic execution ladder (sequencing only, no ranking change). */
  strategy_sequence?: import('../recommendationSequencingService').StrategySequence;
  /** Deterministic blueprint from strategy_sequence when duration known. */
  campaign_blueprint?: import('../recommendationBlueprintService').CampaignBlueprint | null;
  /** Validation result with issues and corrected blueprint. */
  campaign_blueprint_validation?: import('../recommendationBlueprintValidationService').BlueprintValidationResult;
  /** Corrected blueprint (validated version). */
  campaign_blueprint_validated?: import('../recommendationBlueprintService').CampaignBlueprint | null;
  /** Execution-safe blueprint (validated only; never raw). Use for execution flows. */
  execution_blueprint_resolved?: import('../recommendationBlueprintService').CampaignBlueprint | null;
  /** When execution_blueprint_resolved is set: "validated_blueprint". */
  execution_source?: 'validated_blueprint';
};
