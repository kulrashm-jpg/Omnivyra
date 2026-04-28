/**
 * Shared types and constants for RecommendationsPage.
 */

export type TrendSignal = {
  topic: string;
  source?: string;
  sources?: string[];
  geo?: string;
  velocity?: number;
  sentiment?: number;
  volume?: number;
  frequency?: number;
  platform_tag?: string;
};

export type RecommendationEngineResult = {
  trends_used: TrendSignal[];
  trends_ignored: TrendSignal[];
  weekly_plan: Array<{
    week_number: number;
    theme: string;
    trend_influence?: string[];
    platforms?: string[];
  }>;
  daily_plan: Array<{
    date: string;
    platform: string;
    content_type: string;
    topic: string;
    CTA?: string;
  }>;
  confidence_score: number;
  explanation: string;
  sources: string[];
  persona_summary?: {
    personas: string[];
    tone?: string | null;
    platform_preferences: string[];
  };
  scenario_outcomes?: {
    best_case: number;
    worst_case: number;
    likely_case: number;
  };
  scoring_adjustments?: {
    base_confidence: number;
    adjusted_confidence: number;
    persona_fit: number;
    budget_fit: number;
    competitor_gap: number;
  };
  signal_quality?: {
    external_api_health_snapshot?: Array<{
      api_source_id: string;
      health_score: number;
      avg_latency_ms: number;
    }>;
    cache_hits?: { hits: number; misses: number };
    rate_limited_sources?: string[];
    signal_confidence_summary?: { average: number; min: number; max: number } | null;
  };
  omnivyra_metadata?: {
    decision_id?: string;
    confidence?: number;
    explanation?: string;
    placeholders?: string[];
  };
  novelty_score?: number;
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
  chat_meta?: {
    trend_explanations?: Array<{
      topic: string;
      explanations: string[];
    }>;
  };
  opportunity_analysis?: {
    relevance_score?: number;
    narrative_angle?: string;
    content_mix?: string[];
    risk_level?: string;
    confidence?: number;
  };
};

export type DetectedOpportunity = {
  topic: string;
  category?: string | null;
  confidence?: number | null;
  source?: string | null;
  risk_level?: string | null;
  priority_score?: number | null;
  trend_classification?: string | null;
  trend_reasoning?: string | null;
  growth_opportunity_score?: number | null;
};

export type TrendSourceLegendItem = {
  key: string;
  label: string;
  description: string;
  badgeClass: string;
};

export type ExternalApiOption = {
  id: string;
  name: string;
  is_global_preset?: boolean | null;
  company_id?: string | null;
};

export const OPPORTUNITY_TAB_TYPES: { type: string; label: string }[] = [
  { type: 'TREND', label: 'Trend Campaigns' },
];

export const TREND_SOURCE_LEGEND: TrendSourceLegendItem[] = [
  { key: 'youtube',   label: 'YouTube',   description: 'YouTube Data API trend signals.',              badgeClass: 'bg-red-100 text-red-700' },
  { key: 'newsapi',   label: 'NewsAPI',   description: 'NewsAPI headlines and breaking topics.',        badgeClass: 'bg-blue-100 text-blue-700' },
  { key: 'reddit',    label: 'Reddit',    description: 'Reddit community trend signals.',               badgeClass: 'bg-orange-100 text-orange-700' },
  { key: 'serpapi',   label: 'SerpAPI',   description: 'SerpAPI Google Trends signals.',               badgeClass: 'bg-green-100 text-green-700' },
  { key: 'omnivyra',  label: 'Omnivyra',  description: 'Omnivyra intelligence curated trends.',        badgeClass: 'bg-purple-100 text-purple-700' },
];
export default function RecommendationsTypesPage() {
  return null;
}
