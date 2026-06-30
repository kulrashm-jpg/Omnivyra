/**
 * Product & Usage business-impact configuration (Phase 34). Config only — the Platform
 * Business Impact Engine owns the machinery.
 */
import type { ImpactGraphConfig, ImpactDimension } from '../platformIntelligence/businessImpact';

export type ProductDimension = Extract<ImpactDimension, 'retention' | 'conversion' | 'marketing' | 'revenue' | 'authority' | 'leads'>;

export const PRODUCT_IMPACT_CONFIG: ImpactGraphConfig<ProductDimension> = {
  graph: {
    complete_activation: { dimensions: { retention: 70, conversion: 50, marketing: 45 }, cascade: ['Incomplete activation', 'No first value', 'Higher churn risk'] },
    adopt_inactive_modules: { dimensions: { retention: 55, marketing: 50 }, cascade: ['Inactive modules', 'Lower stickiness', 'Weaker retention'] },
    increase_product_usage: { dimensions: { marketing: 55, conversion: 45, retention: 45 }, cascade: ['Low product usage', 'Less value realised', 'Lower retention'] },
    instrument_user_engagement: { dimensions: { retention: 50, conversion: 40 }, cascade: ['User engagement unknown', 'Blind to stickiness', 'Churn risk hidden'] },
    instrument_utilization: { dimensions: { revenue: 55, retention: 40 }, cascade: ['Utilization unknown', 'No expansion targeting', 'Suboptimal revenue'] },
  },
  moduleDimensions: {
    activation: { retention: 65, conversion: 45 }, feature_adoption: { retention: 60, marketing: 45 }, module_adoption: { retention: 55, marketing: 45 },
    content_creation: { marketing: 60, authority: 40 }, publishing: { marketing: 55 }, community_usage: { marketing: 50, authority: 45 },
    campaign_usage: { marketing: 55, leads: 45 }, lead_capture_usage: { leads: 60, conversion: 45 }, integration_usage: { marketing: 45, retention: 40 },
    workspace_engagement: { retention: 55, marketing: 45 }, account_health: { retention: 65, revenue: 45 }, user_engagement: { retention: 55 },
    stickiness: { retention: 70 }, utilization: { revenue: 60 }, expansion_readiness: { revenue: 60, retention: 45 }, power_users: { retention: 50 },
    product_health: { retention: 60, marketing: 45 }, product_maturity: { retention: 45, marketing: 40 },
  },
  dimensionTail: { retention: 'retention', conversion: 'conversion', marketing: 'product engagement', revenue: 'expansion revenue', authority: 'authority', leads: 'lead generation' },
};

export const PRODUCT_LOW_EFFORT = new Set(['complete_activation', 'adopt_inactive_modules']);
export const PRODUCT_HIGH_EFFORT = new Set(['instrument_user_engagement', 'instrument_utilization']);
