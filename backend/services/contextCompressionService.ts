/**
 * AI Context Compression Layer
 * Produces compact summaries for downstream LLM calls instead of full context objects.
 * Reduces token usage by replacing companyPerformanceInsights, strategyMemory, full theme objects.
 */

/** Strategy learning profile formatted for weekly plan prompts. Maps from StrategyProfile. */
export type StrategyLearningProfileForPrompt = {
  high_performing_formats: string[];
  high_performing_topics: string[];
  weak_formats: string[];
  historical_engagement_patterns?: Record<string, number>;
};

export type CampaignContext = {
  topic: string;
  tone: string;
  themes: string[];
  top_platforms: string[];
  top_content_types: string[];
  /** Platforms available to the company (from BOLT/UI). When set, weekly plan must choose only from these. */
  eligible_platforms?: string[];
  /** Ordered strategic theme progression for weekly planning (e.g. Awareness, Authority, Engagement, Conversion). */
  strategic_themes?: string[];
  /** Campaign duration in weeks; used to map weeks to themes when theme_count < duration. */
  campaign_duration_weeks?: number;
  /** Historical performance signals for optimization; do not override strategic theme progression. */
  strategy_learning_profile?: StrategyLearningProfileForPrompt;
  /** Execution inputs for planning guidance (audience, depth, goal). Optional; backward compatible. */
  target_audience?: string;
  content_depth?: string;
  campaign_goal?: string;
};

export type CampaignContextInput = {
  topic?: string;
  tone?: string;
  themes?: string[] | Array<{ topicTitle?: string; title?: string; topic?: string }>;
  companyPerformanceInsights?: {
    high_performing_platforms?: Array<{ value: string }>;
    high_performing_content_types?: Array<{ value: string }>;
  };
  strategyMemory?: { preferred_platforms?: string[]; preferred_content_types?: string[] };
  strategyLearningProfile?: {
    preferred_platform_weights?: Record<string, number>;
    preferred_content_type_ratios?: Record<string, number>;
  };
  eligiblePlatforms?: string[];
  /** Execution inputs for planning guidance. Optional; backward compatible. */
  target_audience?: string;
  content_depth?: string;
  campaign_goal?: string;
};

const TOP_N = 3;
const DEFAULT_TONE = 'professional';

function normalizePlatform(s: string): string {
  return String(s ?? '').trim().toLowerCase().replace(/^twitter$/, 'x') || '';
}

function extractThemes(input: CampaignContextInput['themes']): string[] {
  if (!input?.length) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of input) {
    const s = typeof t === 'string' ? t.trim() : String((t as any)?.topicTitle ?? (t as any)?.title ?? (t as any)?.topic ?? '').trim();
    if (s && !seen.has(s.toLowerCase())) {
      seen.add(s.toLowerCase());
      out.push(s);
    }
  }
  return out;
}

function extractTopPlatforms(input: CampaignContextInput): string[] {
  const platforms = new Set<string>();

  if (input.strategyMemory?.preferred_platforms?.length) {
    for (const p of input.strategyMemory.preferred_platforms.slice(0, TOP_N)) {
      const n = normalizePlatform(p);
      if (n) platforms.add(n);
    }
  }

  if (input.strategyLearningProfile?.preferred_platform_weights) {
    const sorted = Object.entries(input.strategyLearningProfile.preferred_platform_weights)
      .sort(([, a], [, b]) => b - a)
      .slice(0, TOP_N)
      .map(([k]) => normalizePlatform(k))
      .filter(Boolean);
    for (const p of sorted) platforms.add(p);
  }

  if (input.companyPerformanceInsights?.high_performing_platforms?.length) {
    for (const p of input.companyPerformanceInsights.high_performing_platforms.slice(0, TOP_N)) {
      const n = normalizePlatform(p.value);
      if (n) platforms.add(n);
    }
  }

  if (input.eligiblePlatforms?.length) {
    for (const p of input.eligiblePlatforms.slice(0, TOP_N)) {
      const n = normalizePlatform(p);
      if (n) platforms.add(n);
    }
  }

  return Array.from(platforms);
}

function extractTopContentTypes(input: CampaignContextInput): string[] {
  const types = new Set<string>();

  if (input.strategyMemory?.preferred_content_types?.length) {
    for (const c of input.strategyMemory.preferred_content_types.slice(0, TOP_N)) {
      const n = String(c ?? '').trim().toLowerCase();
      if (n) types.add(n);
    }
  }

  if (input.strategyLearningProfile?.preferred_content_type_ratios) {
    const sorted = Object.entries(input.strategyLearningProfile.preferred_content_type_ratios)
      .sort(([, a], [, b]) => b - a)
      .slice(0, TOP_N)
      .map(([k]) => String(k).trim().toLowerCase())
      .filter(Boolean);
    for (const c of sorted) types.add(c);
  }

  if (input.companyPerformanceInsights?.high_performing_content_types?.length) {
    for (const c of input.companyPerformanceInsights.high_performing_content_types.slice(0, TOP_N)) {
      const n = String(c.value ?? '').trim().toLowerCase();
      if (n) types.add(n);
    }
  }

  return Array.from(types);
}

/**
 * Build compact campaign context from rich inputs.
 * Removes unused fields; outputs deterministic, minimal structure for LLM reuse.
 */
export function buildCampaignContext(input: CampaignContextInput): CampaignContext {
  const topic = String(input.topic ?? '').trim() || 'Campaign theme';
  const tone = String(input.tone ?? '').trim() || DEFAULT_TONE;
  const themes = extractThemes(input.themes);
  const top_platforms = extractTopPlatforms(input);
  const top_content_types = extractTopContentTypes(input);

  const result: CampaignContext = {
    topic,
    tone,
    themes,
    top_platforms,
    top_content_types,
  };
  if (input.eligiblePlatforms?.length) {
    result.eligible_platforms = input.eligiblePlatforms.map((p) => normalizePlatform(p)).filter(Boolean);
  }
  if (typeof input.target_audience === 'string' && input.target_audience.trim()) {
    result.target_audience = input.target_audience.trim();
  }
  if (typeof input.content_depth === 'string' && input.content_depth.trim()) {
    result.content_depth = input.content_depth.trim();
  }
  if (typeof input.campaign_goal === 'string' && input.campaign_goal.trim()) {
    result.campaign_goal = input.campaign_goal.trim();
  }
  return result;
}

/**
 * In-memory cache for campaign run context. Keyed by campaignId.
 * Avoid recomputing when multiple steps run for the same campaign.
 */
const campaignExecutionContext = new Map<string, CampaignContext>();

export function getCampaignContext(campaignId: string): CampaignContext | null {
  return campaignExecutionContext.get(campaignId) ?? null;
}

export function setCampaignContext(campaignId: string, context: CampaignContext): void {
  campaignExecutionContext.set(campaignId, context);
}

export function clearCampaignContext(campaignId: string): void {
  campaignExecutionContext.delete(campaignId);
}

/**
 * Format StrategyProfile (from campaign strategy learner) for weekly plan prompts.
 * Use historical performance signals as optimization guidance; do not override strategic theme progression.
 */
export function formatStrategyProfileForPrompt(profile: {
  preferred_platform_weights?: Record<string, number>;
  preferred_content_type_ratios?: Record<string, number>;
  preferred_theme_patterns?: string[];
  underperforming_patterns?: Array<{ type: 'platform' | 'content_type' | 'theme'; value: string }>;
}): StrategyLearningProfileForPrompt {
  const high_performing_formats =
    profile.preferred_content_type_ratios != null
      ? Object.entries(profile.preferred_content_type_ratios)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 5)
          .map(([k]) => k)
      : [];
  const high_performing_topics = profile.preferred_theme_patterns ?? [];
  const weak_formats =
    profile.underperforming_patterns?.filter((p) => p.type === 'content_type').map((p) => p.value) ?? [];
  const historical_engagement_patterns = profile.preferred_platform_weights ?? undefined;
  return {
    high_performing_formats,
    high_performing_topics,
    weak_formats,
    historical_engagement_patterns,
  };
}
