/**
 * Customer Intelligence business-impact configuration (Phase 28). Config only — the Platform
 * Business Impact Engine owns the machinery.
 */
import type { ImpactGraphConfig, ImpactDimension } from '../platformIntelligence/businessImpact';

export type CustomerDimension = Extract<ImpactDimension, 'retention' | 'revenue' | 'authority' | 'conversion' | 'pipeline'>;

export const CUSTOMER_IMPACT_CONFIG: ImpactGraphConfig<CustomerDimension> = {
  graph: {
    build_customer_base: { dimensions: { revenue: 70, retention: 50 }, cascade: ['No customers', 'No retention base', 'No expansion revenue'] },
    instrument_advocacy: { dimensions: { authority: 55, retention: 40 }, cascade: ['No advocacy signal', 'Blind to sentiment', 'Churn risk hidden'] },
    address_customer_sentiment: { dimensions: { retention: 75, revenue: 55, authority: 45 }, cascade: ['Negative sentiment', 'Churn risk', 'Lost recurring revenue'] },
    instrument_retention: { dimensions: { retention: 70, revenue: 55 }, cascade: ['Retention not measured', 'Churn invisible', 'Revenue leak'] },
    instrument_product_adoption: { dimensions: { retention: 55, conversion: 40 }, cascade: ['Adoption unknown', 'Weak stickiness', 'Higher churn'] },
    instrument_ltv: { dimensions: { revenue: 60, retention: 40 }, cascade: ['LTV unknown', 'No expansion targeting', 'Suboptimal CAC payback'] },
  },
  moduleDimensions: {
    customer_base: { revenue: 60, retention: 50 }, customer_revenue: { revenue: 80 }, advocacy: { authority: 55, retention: 45 },
    relationship_strength: { retention: 60, authority: 40 }, customer_risk: { retention: 70, revenue: 45 }, retention_health: { retention: 80 },
    renewal_readiness: { revenue: 60, retention: 55 }, expansion_readiness: { revenue: 65, pipeline: 45 }, product_adoption: { retention: 55 },
    lifetime_value: { revenue: 70 }, customer_success_health: { retention: 60, revenue: 50 }, customer_maturity: { retention: 50, revenue: 40 },
  },
  dimensionTail: { retention: 'retention', revenue: 'recurring revenue', authority: 'brand advocacy', conversion: 'conversion', pipeline: 'expansion pipeline' },
};

export const CUSTOMER_LOW_EFFORT = new Set(['address_customer_sentiment', 'instrument_advocacy']);
export const CUSTOMER_HIGH_EFFORT = new Set(['build_customer_base', 'instrument_retention', 'instrument_ltv']);
