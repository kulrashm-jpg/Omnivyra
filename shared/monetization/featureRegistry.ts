export type ChargeMode = 'free' | 'fixed_credits' | 'metered_usage' | 'token_priced' | 'bundled' | 'internal';
export type CreditSource = 'purchased' | 'subscription' | 'promotional' | 'system' | 'incentive' | 'free_trial';
export type TransactionPhase = 'hold' | 'confirm' | 'release' | 'grant' | 'expire' | 'expire_incentive';
export type PricingStrategy = 'credit_cost_config' | 'action_pricing_config' | 'llm_model_pricing' | 'none';
export type PlanTier = 'free' | 'starter' | 'growth' | 'pro' | 'enterprise';

export const CREDIT_ACTIONS = [
  'ai_reply',
  'auto_post',
  'content_rewrite',
  'content_basic',
  'content_generation',
  'reply_generation',
  'trend_analysis',
  'market_insight_manual',
  'campaign_creation',
  'website_audit',
  'prediction',
  'insight_generation',
  'pattern_detection',
  'market_positioning',
  'competitor_signals',
  'lead_detection',
  'daily_insight_scan',
  'campaign_optimization',
  'optimization_loop',
  'portfolio_decision',
  'strategy_evolution',
  'voice_per_minute',
  'deep_analysis',
  'full_strategy',
  'campaign_generation',
] as const;

export type CreditAction = typeof CREDIT_ACTIONS[number];

export type ReportCategory = 'snapshot' | 'performance' | 'growth';
export type ReportType = 'content_readiness' | 'competitor_analysis' | 'gap_analysis' | 'performance_intelligence';

export interface MonetizationFeatureRegistryEntry {
  feature_key: string;
  category:
    | 'reports'
    | 'campaigns'
    | 'creator_content'
    | 'intelligence'
    | 'engagement_center'
    | 'ai_generation'
    | 'automation'
    | 'external_usage'
    | 'internal';
  display_name: string;
  display_group: string;
  display_color: string;
  charge_mode: ChargeMode;
  pricing_strategy: PricingStrategy;
  usage_metering_enabled: boolean;
  requires_credit_hold: boolean;
  plan_eligible: boolean;
  enforcement_eligible: boolean;
  visible_to_customer: boolean;
  internal_only: boolean;
  report_type_mapping?: {
    requested_type?: 'free' | 'premium';
    report_category?: ReportCategory;
    report_type?: ReportType;
    plan_tier?: PlanTier;
  };
  process_type_mapping?: string[];
  pricing_keys: {
    action_key?: CreditAction | string;
    credit_cost_config?: CreditAction | string;
    action_pricing_config?: string;
    usage_action_key?: string;
  };
}

const BASE_FEATURES: MonetizationFeatureRegistryEntry[] = [
  {
    feature_key: 'reports.snapshot',
    category: 'reports',
    display_name: 'Digital Authority Snapshot',
    display_group: 'Audits',
    display_color: 'bg-amber-400',
    charge_mode: 'fixed_credits',
    pricing_strategy: 'credit_cost_config',
    usage_metering_enabled: true,
    requires_credit_hold: true,
    plan_eligible: true,
    enforcement_eligible: true,
    visible_to_customer: true,
    internal_only: false,
    report_type_mapping: {
      requested_type: 'free',
      report_category: 'snapshot',
      report_type: 'content_readiness',
      plan_tier: 'free',
    },
    pricing_keys: {
      action_key: 'website_audit',
      credit_cost_config: 'website_audit',
      action_pricing_config: 'website_audit',
      usage_action_key: 'website_audit',
    },
  },
  {
    feature_key: 'reports.performance_intelligence',
    category: 'reports',
    display_name: 'Performance Intelligence Report',
    display_group: 'Deep Analysis',
    display_color: 'bg-violet-600',
    charge_mode: 'fixed_credits',
    pricing_strategy: 'credit_cost_config',
    usage_metering_enabled: true,
    requires_credit_hold: true,
    plan_eligible: true,
    enforcement_eligible: true,
    visible_to_customer: true,
    internal_only: false,
    report_type_mapping: {
      requested_type: 'premium',
      report_category: 'performance',
      report_type: 'performance_intelligence',
      plan_tier: 'pro',
    },
    pricing_keys: {
      action_key: 'deep_analysis',
      credit_cost_config: 'deep_analysis',
      action_pricing_config: 'deep_analysis',
      usage_action_key: 'deep_analysis',
    },
  },
  {
    feature_key: 'reports.market_growth_intelligence',
    category: 'reports',
    display_name: 'Market Growth Intelligence Report',
    display_group: 'Campaigns',
    display_color: 'bg-violet-500',
    charge_mode: 'fixed_credits',
    pricing_strategy: 'credit_cost_config',
    usage_metering_enabled: true,
    requires_credit_hold: true,
    plan_eligible: true,
    enforcement_eligible: true,
    visible_to_customer: true,
    internal_only: false,
    report_type_mapping: {
      requested_type: 'premium',
      report_category: 'growth',
      report_type: 'competitor_analysis',
      plan_tier: 'enterprise',
    },
    pricing_keys: {
      action_key: 'full_strategy',
      credit_cost_config: 'full_strategy',
      action_pricing_config: 'full_strategy',
      usage_action_key: 'full_strategy',
    },
  },
  {
    feature_key: 'campaigns.creation',
    category: 'campaigns',
    display_name: 'Campaign Creation',
    display_group: 'Campaigns',
    display_color: 'bg-violet-500',
    charge_mode: 'fixed_credits',
    pricing_strategy: 'credit_cost_config',
    usage_metering_enabled: true,
    requires_credit_hold: true,
    plan_eligible: true,
    enforcement_eligible: true,
    visible_to_customer: true,
    internal_only: false,
    process_type_mapping: ['generateCampaignPlan', 'parsePlanToWeeks'],
    pricing_keys: {
      action_key: 'campaign_generation',
      credit_cost_config: 'campaign_generation',
      action_pricing_config: 'campaign_generation',
      usage_action_key: 'campaign_generation',
    },
  },
  {
    feature_key: 'campaigns.optimization',
    category: 'campaigns',
    display_name: 'Campaign Optimization',
    display_group: 'Campaigns',
    display_color: 'bg-violet-500',
    charge_mode: 'fixed_credits',
    pricing_strategy: 'credit_cost_config',
    usage_metering_enabled: true,
    requires_credit_hold: true,
    plan_eligible: true,
    enforcement_eligible: true,
    visible_to_customer: true,
    internal_only: false,
    process_type_mapping: ['generateCampaignRecommendations', 'optimizeWeek'],
    pricing_keys: {
      action_key: 'campaign_optimization',
      credit_cost_config: 'campaign_optimization',
      action_pricing_config: 'campaign_optimization',
      usage_action_key: 'campaign_optimization',
    },
  },
  {
    feature_key: 'creator_content.basic_generation',
    category: 'creator_content',
    display_name: 'Content Generation',
    display_group: 'Content Generation',
    display_color: 'bg-blue-400',
    charge_mode: 'fixed_credits',
    pricing_strategy: 'credit_cost_config',
    usage_metering_enabled: true,
    requires_credit_hold: true,
    plan_eligible: true,
    enforcement_eligible: true,
    visible_to_customer: true,
    internal_only: false,
    process_type_mapping: [
      'generateContentBlueprint',
      'generateContentForDay',
      'generateDailyPlan',
      'generateDailyDistributionPlan',
      'creator_execution_blueprint_image',
      'creator_execution_blueprint_carousel',
      'creator_execution_blueprint_video',
      'blogGeneration',
      'blockEnrich',
    ],
    pricing_keys: {
      action_key: 'content_basic',
      credit_cost_config: 'content_basic',
      action_pricing_config: 'content_basic',
      usage_action_key: 'content_basic',
    },
  },
  {
    feature_key: 'creator_content.rewrite',
    category: 'creator_content',
    display_name: 'Content Rewrite',
    display_group: 'Content Generation',
    display_color: 'bg-blue-400',
    charge_mode: 'fixed_credits',
    pricing_strategy: 'credit_cost_config',
    usage_metering_enabled: true,
    requires_credit_hold: true,
    plan_eligible: true,
    enforcement_eligible: true,
    visible_to_customer: true,
    internal_only: false,
    process_type_mapping: [
      'regenerateContent',
      'generatePlatformVariants',
      'refineCampaignIdea',
      'parsePlatformCustomization',
      'creator_marketing_packaging',
      'blogRepurpose',
      'blogOptimization',
      'refineProblemTransformation',
    ],
    pricing_keys: {
      action_key: 'content_rewrite',
      credit_cost_config: 'content_rewrite',
      action_pricing_config: 'content_rewrite',
      usage_action_key: 'content_rewrite',
    },
  },
  {
    feature_key: 'ai_generation.master_content',
    category: 'ai_generation',
    display_name: 'Master Content Generation',
    display_group: 'Content Generation',
    display_color: 'bg-blue-400',
    charge_mode: 'token_priced',
    pricing_strategy: 'llm_model_pricing',
    usage_metering_enabled: true,
    requires_credit_hold: true,
    plan_eligible: true,
    enforcement_eligible: true,
    visible_to_customer: true,
    internal_only: false,
    process_type_mapping: ['generateMasterContent'],
    pricing_keys: {
      action_key: 'content_generation',
      credit_cost_config: 'content_generation',
      action_pricing_config: 'content_generation',
      usage_action_key: 'content_generation',
    },
  },
  {
    feature_key: 'intelligence.insight_generation',
    category: 'intelligence',
    display_name: 'Insight Generation',
    display_group: 'Insights & Trends',
    display_color: 'bg-blue-500',
    charge_mode: 'fixed_credits',
    pricing_strategy: 'credit_cost_config',
    usage_metering_enabled: true,
    requires_credit_hold: true,
    plan_eligible: true,
    enforcement_eligible: true,
    visible_to_customer: true,
    internal_only: false,
    process_type_mapping: [
      'generateContentIdeas',
      'generateRecommendation',
      'prePlanningExplanation',
      'suggestDuration',
      'parseRefinedDay',
    ],
    pricing_keys: {
      action_key: 'insight_generation',
      credit_cost_config: 'insight_generation',
      action_pricing_config: 'insight_generation',
      usage_action_key: 'insight_generation',
    },
  },
  {
    feature_key: 'intelligence.strategy_evolution',
    category: 'intelligence',
    display_name: 'Strategy Evolution',
    display_group: 'Insights & Trends',
    display_color: 'bg-blue-500',
    charge_mode: 'fixed_credits',
    pricing_strategy: 'credit_cost_config',
    usage_metering_enabled: true,
    requires_credit_hold: true,
    plan_eligible: true,
    enforcement_eligible: true,
    visible_to_customer: true,
    internal_only: false,
    process_type_mapping: ['generateAdditionalStrategicThemes'],
    pricing_keys: {
      action_key: 'strategy_evolution',
      credit_cost_config: 'strategy_evolution',
      action_pricing_config: 'strategy_evolution',
      usage_action_key: 'strategy_evolution',
    },
  },
  {
    feature_key: 'engagement.reply_generation',
    category: 'engagement_center',
    display_name: 'AI Reply',
    display_group: 'AI Replies',
    display_color: 'bg-emerald-400',
    charge_mode: 'fixed_credits',
    pricing_strategy: 'credit_cost_config',
    usage_metering_enabled: true,
    requires_credit_hold: true,
    plan_eligible: true,
    enforcement_eligible: true,
    visible_to_customer: true,
    internal_only: false,
    process_type_mapping: [
      'chatModeration',
      'extractPlannerCommands',
      'conversationTriage',
      'conversationMemorySummary',
      'responseGeneration',
      'runDiagnosticPrompt',
      'sentiment_classification',
    ],
    pricing_keys: {
      action_key: 'ai_reply',
      credit_cost_config: 'ai_reply',
      action_pricing_config: 'ai_reply',
      usage_action_key: 'ai_reply',
    },
  },
  {
    feature_key: 'engagement.community_reply',
    category: 'engagement_center',
    display_name: 'Community Reply',
    display_group: 'AI Replies',
    display_color: 'bg-emerald-400',
    charge_mode: 'fixed_credits',
    pricing_strategy: 'credit_cost_config',
    usage_metering_enabled: true,
    requires_credit_hold: true,
    plan_eligible: true,
    enforcement_eligible: true,
    visible_to_customer: true,
    internal_only: false,
    process_type_mapping: ['reply_generation'],
    pricing_keys: {
      action_key: 'reply_generation',
      credit_cost_config: 'reply_generation',
      action_pricing_config: 'reply_generation',
      usage_action_key: 'reply_generation',
    },
  },
  {
    feature_key: 'automation.community_execution',
    category: 'automation',
    display_name: 'Auto Post',
    display_group: 'AI Replies',
    display_color: 'bg-emerald-400',
    charge_mode: 'fixed_credits',
    pricing_strategy: 'credit_cost_config',
    usage_metering_enabled: true,
    requires_credit_hold: true,
    plan_eligible: true,
    enforcement_eligible: true,
    visible_to_customer: true,
    internal_only: false,
    process_type_mapping: ['community_execution'],
    pricing_keys: {
      action_key: 'auto_post',
      credit_cost_config: 'auto_post',
      action_pricing_config: 'auto_post',
      usage_action_key: 'auto_post',
    },
  },
  {
    feature_key: 'external.api_request',
    category: 'external_usage',
    display_name: 'External API Request',
    display_group: 'Internal Usage',
    display_color: 'bg-gray-400',
    charge_mode: 'metered_usage',
    pricing_strategy: 'action_pricing_config',
    usage_metering_enabled: true,
    requires_credit_hold: false,
    plan_eligible: true,
    enforcement_eligible: true,
    visible_to_customer: false,
    internal_only: true,
    process_type_mapping: ['external_api_request'],
    pricing_keys: {
      action_key: 'external_api',
      action_pricing_config: 'external_api',
      usage_action_key: 'external_api',
    },
  },
  {
    feature_key: 'external.embedding_generation',
    category: 'external_usage',
    display_name: 'Embedding Generation',
    display_group: 'Internal Usage',
    display_color: 'bg-gray-400',
    charge_mode: 'metered_usage',
    pricing_strategy: 'llm_model_pricing',
    usage_metering_enabled: true,
    requires_credit_hold: false,
    plan_eligible: true,
    enforcement_eligible: true,
    visible_to_customer: false,
    internal_only: true,
    process_type_mapping: ['embedding_generation'],
    pricing_keys: {
      action_key: 'embedding',
      action_pricing_config: 'embedding',
      usage_action_key: 'embedding',
    },
  },
  {
    feature_key: 'internal.blog_analytics_insight',
    category: 'internal',
    display_name: 'Blog Analytics Insight',
    display_group: 'Internal Usage',
    display_color: 'bg-gray-400',
    charge_mode: 'internal',
    pricing_strategy: 'action_pricing_config',
    usage_metering_enabled: true,
    requires_credit_hold: false,
    plan_eligible: false,
    enforcement_eligible: false,
    visible_to_customer: false,
    internal_only: true,
    process_type_mapping: ['blogAnalyticsInsight'],
    pricing_keys: {
      action_key: 'blogAnalyticsInsight',
      action_pricing_config: 'blogAnalyticsInsight',
      usage_action_key: 'blogAnalyticsInsight',
    },
  },
  {
    feature_key: 'internal.profile_enrichment',
    category: 'internal',
    display_name: 'Profile Enrichment',
    display_group: 'Internal Usage',
    display_color: 'bg-gray-400',
    charge_mode: 'internal',
    pricing_strategy: 'action_pricing_config',
    usage_metering_enabled: true,
    requires_credit_hold: false,
    plan_eligible: false,
    enforcement_eligible: false,
    visible_to_customer: false,
    internal_only: true,
    process_type_mapping: ['profileEnrichment'],
    pricing_keys: {
      action_key: 'profile_enrichment',
      action_pricing_config: 'profile_enrichment',
      usage_action_key: 'profile_enrichment',
    },
  },
  {
    feature_key: 'internal.profile_extraction',
    category: 'internal',
    display_name: 'Profile Extraction',
    display_group: 'Internal Usage',
    display_color: 'bg-gray-400',
    charge_mode: 'internal',
    pricing_strategy: 'action_pricing_config',
    usage_metering_enabled: true,
    requires_credit_hold: false,
    plan_eligible: false,
    enforcement_eligible: false,
    visible_to_customer: false,
    internal_only: true,
    process_type_mapping: ['profileExtraction'],
    pricing_keys: {
      action_key: 'profile_extraction',
      action_pricing_config: 'profile_extraction',
      usage_action_key: 'profile_extraction',
    },
  },
];

const SIMPLE_CREDIT_FEATURES: Record<CreditAction, Omit<MonetizationFeatureRegistryEntry, 'pricing_keys'>> = {
  trend_analysis: feature('intelligence.trend_analysis', 'intelligence', 'Trend Analysis', 'Insights & Trends', 'bg-blue-500'),
  market_insight_manual: feature('intelligence.market_insight_manual', 'intelligence', 'Market Insight', 'Insights & Trends', 'bg-blue-500'),
  campaign_creation: feature('campaigns.manual_creation', 'campaigns', 'Campaign Creation', 'Campaigns', 'bg-violet-500'),
  prediction: feature('campaigns.prediction', 'campaigns', 'Campaign Prediction', 'Campaigns', 'bg-violet-500'),
  pattern_detection: feature('intelligence.pattern_detection', 'intelligence', 'Pattern Detection', 'Insights & Trends', 'bg-blue-500'),
  market_positioning: feature('intelligence.market_positioning', 'intelligence', 'Market Positioning', 'Insights & Trends', 'bg-blue-500'),
  competitor_signals: feature('intelligence.competitor_signals', 'intelligence', 'Competitor Signals', 'Insights & Trends', 'bg-blue-500'),
  lead_detection: feature('intelligence.lead_detection', 'intelligence', 'Lead Detection', 'Lead Detection', 'bg-amber-500'),
  daily_insight_scan: feature('intelligence.daily_scan', 'intelligence', 'Daily Insight Scan', 'Insights & Trends', 'bg-blue-500'),
  optimization_loop: feature('campaigns.optimization_loop', 'campaigns', 'Optimization Loop', 'Campaigns', 'bg-violet-500'),
  portfolio_decision: feature('campaigns.portfolio_decision', 'campaigns', 'Portfolio Decision', 'Campaigns', 'bg-violet-500'),
  voice_per_minute: feature('ai_generation.voice', 'ai_generation', 'Voice Generation', 'Voice', 'bg-violet-400'),
  website_audit: feature('reports.website_audit', 'reports', 'Website Audit', 'Audits', 'bg-amber-400'),
  deep_analysis: feature('reports.deep_analysis', 'reports', 'Deep Analysis', 'Deep Analysis', 'bg-violet-600'),
  full_strategy: feature('reports.full_strategy', 'reports', 'Full Strategy', 'Campaigns', 'bg-violet-500'),
  ai_reply: feature('engagement.ai_reply', 'engagement_center', 'AI Reply', 'AI Replies', 'bg-emerald-400'),
  auto_post: feature('automation.auto_post', 'automation', 'Auto Post', 'AI Replies', 'bg-emerald-400'),
  content_rewrite: feature('creator_content.content_rewrite', 'creator_content', 'Content Rewrite', 'Content Generation', 'bg-blue-400'),
  content_basic: feature('creator_content.content_basic', 'creator_content', 'Content Generation', 'Content Generation', 'bg-blue-400'),
  content_generation: feature('ai_generation.content_generation', 'ai_generation', 'Content Generation', 'Content Generation', 'bg-blue-400'),
  reply_generation: feature('engagement.reply_generation_legacy', 'engagement_center', 'Reply Generation', 'AI Replies', 'bg-emerald-400'),
  campaign_optimization: feature('campaigns.campaign_optimization', 'campaigns', 'Campaign Optimization', 'Campaigns', 'bg-violet-500'),
  strategy_evolution: feature('intelligence.strategy_evolution_legacy', 'intelligence', 'Strategy Evolution', 'Insights & Trends', 'bg-blue-500'),
  campaign_generation: feature('campaigns.campaign_generation', 'campaigns', 'Campaign Generation', 'Campaigns', 'bg-violet-500'),
  insight_generation: feature('intelligence.insight_generation_legacy', 'intelligence', 'Insight Generation', 'Insights & Trends', 'bg-blue-500'),
};

function feature(
  feature_key: string,
  category: MonetizationFeatureRegistryEntry['category'],
  display_name: string,
  display_group: string,
  display_color: string,
): Omit<MonetizationFeatureRegistryEntry, 'pricing_keys'> {
  return {
    feature_key,
    category,
    display_name,
    display_group,
    display_color,
    charge_mode: 'fixed_credits',
    pricing_strategy: 'credit_cost_config',
    usage_metering_enabled: true,
    requires_credit_hold: true,
    plan_eligible: true,
    enforcement_eligible: true,
    visible_to_customer: true,
    internal_only: false,
  };
}

const simpleEntries = CREDIT_ACTIONS
  .filter((actionKey) => !BASE_FEATURES.some((entry) => entry.pricing_keys.action_key === actionKey))
  .map((actionKey) => ({
    ...SIMPLE_CREDIT_FEATURES[actionKey],
    pricing_keys: {
      action_key: actionKey,
      credit_cost_config: actionKey,
      action_pricing_config: actionKey,
      usage_action_key: actionKey,
    },
  }));

export const MONETIZATION_FEATURE_REGISTRY = [...BASE_FEATURES, ...simpleEntries] as const;

export interface FeatureResolutionInput {
  feature_key?: string | null;
  action_key?: string | null;
  pricing_key?: string | null;
  process_type?: string | null;
  requested_type?: 'free' | 'premium' | string | null;
  report_category?: ReportCategory | string | null;
  report_type?: ReportType | string | null;
}

export interface FeatureResolution {
  feature: MonetizationFeatureRegistryEntry;
  feature_key: string;
  action_key: string | null;
  pricing_key: string | null;
  pricing_strategy: PricingStrategy;
  charge_mode: ChargeMode;
  plan_tier: PlanTier | null;
  legacy_input: FeatureResolutionInput;
}

export function getFeatureByKey(featureKey: string): MonetizationFeatureRegistryEntry | null {
  return MONETIZATION_FEATURE_REGISTRY.find((entry) => entry.feature_key === featureKey) ?? null;
}

export function resolveFeatureFromActionKey(actionKey: string): MonetizationFeatureRegistryEntry | null {
  return MONETIZATION_FEATURE_REGISTRY.find((entry) =>
    entry.pricing_keys.action_key === actionKey ||
    entry.pricing_keys.credit_cost_config === actionKey ||
    entry.pricing_keys.action_pricing_config === actionKey ||
    entry.pricing_keys.usage_action_key === actionKey,
  ) ?? null;
}

export function resolveFeatureFromProcessType(processType: string): MonetizationFeatureRegistryEntry | null {
  return MONETIZATION_FEATURE_REGISTRY.find((entry) =>
    entry.process_type_mapping?.includes(processType),
  ) ?? null;
}

export function resolveFeatureFromReport(input: {
  requested_type?: string | null;
  report_category?: string | null;
  report_type?: string | null;
}): MonetizationFeatureRegistryEntry | null {
  return MONETIZATION_FEATURE_REGISTRY.find((entry) => {
    const mapping = entry.report_type_mapping;
    if (!mapping) return false;
    const categoryMatch = input.report_category ? mapping.report_category === input.report_category : true;
    const reportTypeMatch = input.report_type ? mapping.report_type === input.report_type : true;
    const requestedTypeMatch =
      input.requested_type && !input.report_category && !input.report_type
        ? mapping.requested_type === input.requested_type
        : true;
    return categoryMatch && reportTypeMatch && requestedTypeMatch;
  }) ?? null;
}

export function resolveMonetizationFeature(input: FeatureResolutionInput): FeatureResolution | null {
  const feature =
    (input.feature_key ? getFeatureByKey(input.feature_key) : null) ||
    (input.action_key ? resolveFeatureFromActionKey(input.action_key) : null) ||
    (input.pricing_key ? resolveFeatureFromActionKey(input.pricing_key) : null) ||
    (input.process_type ? resolveFeatureFromProcessType(input.process_type) : null) ||
    resolveFeatureFromReport({
      requested_type: input.requested_type,
      report_category: input.report_category,
      report_type: input.report_type,
    });

  if (!feature) return null;
  const actionKey = feature.pricing_keys.action_key ?? feature.pricing_keys.usage_action_key ?? null;
  const pricingKey =
    feature.pricing_keys.credit_cost_config ??
    feature.pricing_keys.action_pricing_config ??
    feature.pricing_keys.action_key ??
    null;

  return {
    feature,
    feature_key: feature.feature_key,
    action_key: actionKey,
    pricing_key: pricingKey,
    pricing_strategy: feature.pricing_strategy,
    charge_mode: feature.charge_mode,
    plan_tier: feature.report_type_mapping?.plan_tier ?? null,
    legacy_input: input,
  };
}

export function resolveActionKeyFromProcessType(processType: string): string | null {
  return resolveFeatureFromProcessType(processType)?.pricing_keys.usage_action_key ?? null;
}

export function getProcessTypeToActionKeyMap(): Record<string, string> {
  return MONETIZATION_FEATURE_REGISTRY.reduce<Record<string, string>>((acc, entry) => {
    const usageActionKey = entry.pricing_keys.usage_action_key;
    if (!usageActionKey) return acc;
    for (const processType of entry.process_type_mapping ?? []) {
      acc[processType] = usageActionKey;
    }
    return acc;
  }, {});
}

export function isKnownPricingKey(key: string): boolean {
  return resolveFeatureFromActionKey(key) !== null;
}

export function getFeatureDisplayGroup(actionKey: string): { label: string; color: string } {
  const feature = resolveFeatureFromActionKey(actionKey);
  return feature
    ? { label: feature.display_group, color: feature.display_color }
    : { label: 'Other', color: 'bg-gray-400' };
}

export function getReportChargingIdentity(input: {
  requested_type?: string | null;
  report_category: ReportCategory;
  report_type?: ReportType | string | null;
  usage_context?: Record<string, unknown> | null;
}): {
  feature_key: string;
  pricing_key: string;
  action_key: CreditAction;
  plan_tier: PlanTier | null;
  usage_context: Record<string, unknown>;
} {
  const resolution = resolveMonetizationFeature({
    requested_type: input.requested_type,
    report_category: input.report_category,
    report_type: input.report_type,
  });
  if (!resolution?.action_key || !resolution.pricing_key) {
    throw new Error(`No monetization registry entry for report category '${input.report_category}'`);
  }

  return {
    feature_key: resolution.feature_key,
    pricing_key: resolution.pricing_key,
    action_key: resolution.action_key as CreditAction,
    plan_tier: resolution.plan_tier,
    usage_context: {
      ...(input.usage_context ?? {}),
      report_category: input.report_category,
      report_type: input.report_type ?? null,
      requested_type: input.requested_type ?? null,
    },
  };
}
