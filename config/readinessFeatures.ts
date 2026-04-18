export const READINESS_FEATURES = [
  {
    key: 'company_profile_completed',
    label: 'Company profile complete',
    weight: 15,
    section: 'Foundation',
    color: '#3b82f6',
  },
  {
    key: 'website_connected',
    label: 'Website connected',
    weight: 10,
    section: 'Foundation',
    color: '#3b82f6',
  },
  {
    key: 'social_accounts_connected',
    label: 'Social accounts connected',
    weight: 15,
    section: 'Distribution',
    color: '#06b6d4',
  },
  {
    key: 'blog_created',
    label: 'First content created',
    weight: 15,
    section: 'Content',
    color: '#ec4899',
  },
  {
    key: 'report_generated',
    label: 'Readiness report generated',
    weight: 15,
    section: 'Content',
    color: '#ec4899',
  },
  {
    key: 'campaign_created',
    label: 'First campaign created',
    weight: 10,
    section: 'Activation',
    color: '#f97316',
  },
  {
    key: 'campaign_published',
    label: 'Campaign published',
    weight: 10,
    section: 'Activation',
    color: '#f97316',
  },
  {
    key: 'chrome_extension_installed',
    label: 'Chrome extension installed',
    weight: 5,
    section: 'Activation',
    color: '#f59e0b',
  },
  {
    key: 'api_configured',
    label: 'API keys configured',
    weight: 5,
    section: 'Activation',
    color: '#f59e0b',
  },
] as const;

export type ReadinessFeatureKey = (typeof READINESS_FEATURES)[number]['key'];

export const FEATURE_WEIGHTS: Record<ReadinessFeatureKey, number> = READINESS_FEATURES.reduce(
  (acc, feature) => {
    acc[feature.key] = feature.weight;
    return acc;
  },
  {} as Record<ReadinessFeatureKey, number>,
);

